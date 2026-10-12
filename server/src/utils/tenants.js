import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import bcrypt from "bcryptjs";
import { platformQuery, runSqlInSchema, runInTenant, query, quoteSchema } from "../db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_SQL_PATH = path.join(__dirname, "..", "..", "schema.sql");
const DAY = 86400000;

// ---------- كاش المحلات ----------
const tenantCache = new Map();
const TENANT_TTL = 15000;

export async function getTenant(id) {
  id = Number(id) || 1;
  const hit = tenantCache.get(id);
  if (hit && Date.now() - hit.at < TENANT_TTL) return hit.tenant;
  const r = await platformQuery("SELECT * FROM platform.tenants WHERE id = $1", [id]);
  const tenant = r.rows[0] || null;
  tenantCache.set(id, { tenant, at: Date.now() });
  return tenant;
}

export function invalidateTenant(id) {
  if (id == null) tenantCache.clear();
  else tenantCache.delete(Number(id));
}

export async function listTenants({ includeSuspended = true } = {}) {
  const r = await platformQuery(
    `SELECT * FROM platform.tenants ${includeSuspended ? "" : "WHERE status = 'active'"} ORDER BY id`
  );
  return r.rows;
}

// حالة الاشتراك: active | expiring (أسبوع أو أقل) | expired | suspended
export function tenantAccess(tenant) {
  if (!tenant) return { state: "expired", days_left: 0 };
  if (tenant.status === "suspended") return { state: "suspended", days_left: 0, is_demo: tenant.is_demo };
  if (tenant.is_home) return { state: "active", days_left: null, is_demo: false, is_home: true };
  if (!tenant.subscription_ends_at) return { state: "expired", days_left: 0, is_demo: tenant.is_demo };
  const msLeft = new Date(tenant.subscription_ends_at).getTime() - Date.now();
  const daysLeft = Math.ceil(msLeft / DAY);
  if (msLeft <= 0) return { state: "expired", days_left: 0, ends_at: tenant.subscription_ends_at, is_demo: tenant.is_demo };
  return {
    state: daysLeft <= 7 ? "expiring" : "active",
    days_left: daysLeft,
    ends_at: tenant.subscription_ends_at,
    is_demo: tenant.is_demo,
  };
}

// ---------- دليل أسماء المستخدمين ----------
export function normalizeUsername(u) {
  return String(u || "").trim().toLowerCase();
}

export async function findTenantIdByUsername(username) {
  const r = await platformQuery("SELECT tenant_id FROM platform.user_directory WHERE username = $1", [normalizeUsername(username)]);
  return r.rows[0]?.tenant_id || null;
}

// بيحجز اسم المستخدم لمحل. بيرجّع false إذا الاسم محجوز لمحل ثاني.
export async function claimUsername(username, tenantId) {
  const u = normalizeUsername(username);
  const r = await platformQuery(
    `INSERT INTO platform.user_directory (username, tenant_id) VALUES ($1, $2)
     ON CONFLICT (username) DO UPDATE SET tenant_id = platform.user_directory.tenant_id
     RETURNING tenant_id`,
    [u, tenantId]
  );
  return Number(r.rows[0].tenant_id) === Number(tenantId);
}

export async function releaseUsername(username, tenantId) {
  await platformQuery("DELETE FROM platform.user_directory WHERE username = $1 AND tenant_id = $2", [normalizeUsername(username), tenantId]);
}

// ---------- الإعدادات ----------
export async function getPlatformSettings() {
  const r = await platformQuery("SELECT key, value FROM platform.settings");
  return Object.fromEntries(r.rows.map((x) => [x.key, x.value]));
}

// ---------- الترحيل: schema.sql على كل المحلات ----------
export async function migrateAllTenants() {
  const sql = fs.readFileSync(SCHEMA_SQL_PATH, "utf-8");
  const tenants = await listTenants();
  for (const t of tenants) {
    if (t.schema_name === "public") continue; // public بينعمل قبل
    try {
      await runSqlInSchema(t.schema_name, sql);
    } catch (err) {
      console.error(`❌ فشل تحديث جداول المحل ${t.name}:`, err.message);
    }
  }
}

// ---------- إنشاء محل جديد ----------
export async function createTenant({ name, owner_name, phone, city, username, password, monthly_price, days, is_demo = false, notes }) {
  const uname = normalizeUsername(username);
  if (!name || !uname || !password) throw new Error("اسم المحل واسم المستخدم وكلمة السر مطلوبين.");
  if (!/^[a-z0-9._-]{3,40}$/.test(uname)) throw new Error("اسم المستخدم لازم يكون أحرف إنجليزي أو أرقام (٣ أحرف على الأقل) بدون مسافات.");
  if (String(password).length < 6) throw new Error("كلمة السر ٦ أحرف على الأقل.");
  if (await findTenantIdByUsername(uname)) throw new Error("اسم المستخدم هذا محجوز — اختار اسم ثاني.");

  const ends = new Date(Date.now() + Math.max(1, Number(days) || 14) * DAY);
  const ins = await platformQuery(
    `INSERT INTO platform.tenants (name, schema_name, owner_name, phone, city, monthly_price, subscription_ends_at, is_demo, notes)
     VALUES ($1, 'pending_' || md5(random()::text), $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [name.trim(), owner_name || null, phone || null, city || null, Number(monthly_price) || 0, ends, !!is_demo, notes || null]
  );
  const id = ins.rows[0].id;
  const schema = `shop_${id}`;
  try {
    await platformQuery(`CREATE SCHEMA IF NOT EXISTS ${quoteSchema(schema)}`);
    await platformQuery("UPDATE platform.tenants SET schema_name = $1 WHERE id = $2", [schema, id]);
    await runSqlInSchema(schema, fs.readFileSync(SCHEMA_SQL_PATH, "utf-8"));

    const tenant = (await platformQuery("SELECT * FROM platform.tenants WHERE id = $1", [id])).rows[0];
    const hash = await bcrypt.hash(String(password), 10);
    await runInTenant(tenant, async () => {
      await query(
        `INSERT INTO users (username, password_hash, full_name, role, status, can_discount, can_delete_customer, can_edit_product_price, can_cancel_order)
         VALUES ($1, $2, $3, 'super_admin', 'active', true, true, true, true)`,
        [uname, hash, owner_name || name]
      );
      await query(
        `INSERT INTO app_settings (key, value) VALUES ('shop_name', $1)
         ON CONFLICT (key) DO UPDATE SET value = $1`,
        [name.trim()]
      );
      if (is_demo) await seedDemoData();
    });
    await claimUsername(uname, id);
    await platformQuery(
      `INSERT INTO platform.subscription_log (tenant_id, action, days, ends_after, note) VALUES ($1, 'create', $2, $3, $4)`,
      [id, Math.round((ends - Date.now()) / DAY), ends, is_demo ? "حساب تجريبي" : "اشتراك جديد"]
    );
    invalidateTenant(id);
    return tenant;
  } catch (err) {
    // تراجع كامل إذا صار أي خطأ
    await platformQuery(`DROP SCHEMA IF EXISTS ${quoteSchema(schema)} CASCADE`).catch(() => {});
    await platformQuery("DELETE FROM platform.tenants WHERE id = $1", [id]).catch(() => {});
    throw err;
  }
}

// تمديد الاشتراك (من آخر تاريخ، أو من اليوم إذا كان خالص)
export async function extendTenant(tenantId, { days, amount = null, note = null, action = "extend" }) {
  const t = await getTenant(tenantId);
  if (!t) throw new Error("المحل غير موجود.");
  const before = t.subscription_ends_at ? new Date(t.subscription_ends_at) : null;
  const base = before && before > new Date() ? before : new Date();
  const after = new Date(base.getTime() + Number(days) * DAY);
  await platformQuery(
    "UPDATE platform.tenants SET subscription_ends_at = $1, warned_on = NULL WHERE id = $2",
    [after, tenantId]
  );
  await platformQuery(
    `INSERT INTO platform.subscription_log (tenant_id, action, days, ends_before, ends_after, amount, note) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [tenantId, action, Number(days), before, after, amount, note]
  );
  invalidateTenant(tenantId);
  return after;
}

// ---------- داتا تجريبية للحسابات الديمو ----------
const DEMO_NAMES = [
  "أبو أحمد", "أم عمر", "مكتب النور", "عيادة الشفاء", "سارة خالد", "أبو محمد", "مطعم السنابل", "أم يزن",
  "شركة الأفق", "أبو فادي", "روضة الأطفال", "صالون الريم", "أم ليث", "أبو سامي", "مخبز الخير", "د. رامي",
  "أم ريم", "أبو خليل", "محل الأمانة", "أبو زيد",
];

async function seedDemoData() {
  const regions = ["الحي الشرقي", "وسط البلد", "الحي الغربي"];
  const regionIds = [];
  for (const r of regions) {
    const x = await query("INSERT INTO regions (name) VALUES ($1) ON CONFLICT DO NOTHING RETURNING id", [r]).catch(() => ({ rows: [] }));
    if (x.rows[0]) regionIds.push(x.rows[0].id);
  }
  const prod = await query("SELECT id, unit_price FROM products WHERE status = 'active' ORDER BY sort_order, id LIMIT 1");
  let product = prod.rows[0];
  if (!product) {
    product = (await query(
      "INSERT INTO products (name, unit_price, coupon_eligible, is_returnable, sort_order) VALUES ('جالون ١٩ لتر', 1.5, true, true, 1) RETURNING id, unit_price"
    )).rows[0];
  }
  for (let i = 0; i < DEMO_NAMES.length; i++) {
    const phone = `96279${String(1000000 + i * 7919).slice(0, 7)}`;
    const c = (await query(
      `INSERT INTO customers (sequential_number, name, phone_normalized, phone_display, bottle_type, coupon_balance, debt_balance)
       VALUES (lpad(nextval('customer_seq')::text, 6, '0'), $1, $2, $3, $4, $5, $6) RETURNING id`,
      [DEMO_NAMES[i], phone, `0${phone.slice(3)}`, i % 3 ? "used" : "new", i % 4 === 0 ? 7 : 0, i % 5 === 0 ? 4.5 : 0]
    )).rows[0];
    await query("INSERT INTO customer_locations (customer_id, region_id) VALUES ($1, $2)", [c.id, regionIds[i % regionIds.length] || null]);
    const every = 3 + (i % 5);
    const qty = 1 + (i % 3);
    for (let k = 5; k >= 1; k--) {
      const n = (await query("SELECT nextval('order_seq') AS n")).rows[0].n;
      const total = Number(product.unit_price) * qty;
      const o = (await query(
        `INSERT INTO orders (order_number, customer_id, status, subtotal, final_total, created_at, updated_at)
         VALUES ($1, $2, 'DELIVERED', $3, $3, now() - ($4 || ' days')::interval, now() - ($4 || ' days')::interval) RETURNING id`,
        [String(n).padStart(6, "0"), c.id, total, String(k * every)]
      )).rows[0];
      await query(
        `INSERT INTO order_items (order_id, product_id, product_name_snapshot, quantity, unit_price_snapshot, line_total)
         SELECT $1, id, name, $2, $3, $4 FROM products WHERE id = $5`,
        [o.id, qty, product.unit_price, total, product.id]
      );
    }
  }
  await query("DELETE FROM app_settings WHERE key IN ('forecast_learn_from','forecast_reset_at')");
}
