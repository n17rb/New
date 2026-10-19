import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import bcrypt from "bcryptjs";
import { platformQuery, runSqlInSchema, runInTenant, query, quoteSchema, pool } from "../db.js";
import { invalidateForecastCache } from "./forecast.js";

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
  const trial = !tenant.is_demo && !tenant.paid_ever;
  const msLeft = new Date(tenant.subscription_ends_at).getTime() - Date.now();
  const daysLeft = Math.ceil(msLeft / DAY);
  if (msLeft <= 0) return { state: "expired", days_left: 0, ends_at: tenant.subscription_ends_at, is_demo: tenant.is_demo, trial };
  return {
    trial,
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
// is_demo = نسخة عرض: شغّالة بالكامل وبترجع لأولها كل يوم
// sample_data = تعبئة داتا تجريبية (زباين، طلبات، كابتن...) عشان الزبون يجرّب فورًا
export async function createTenant({ name, owner_name, phone, city, username, password, monthly_price, days, is_demo = false, sample_data = false, notes }) {
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
    const tenant = (await platformQuery("SELECT * FROM platform.tenants WHERE id = $1", [id])).rows[0];
    const hash = await bcrypt.hash(String(password), 10);
    const extra = await buildTenantData(tenant, {
      owner: { username: uname, password_hash: hash, full_name: owner_name || name },
      sample: !!(is_demo || sample_data),
    });
    await platformQuery(
      `INSERT INTO platform.subscription_log (tenant_id, action, days, ends_after, note) VALUES ($1, 'create', $2, $3, $4)`,
      [id, Math.round((ends - Date.now()) / DAY), ends, is_demo ? "نسخة عرض (بترجع لأولها كل يوم)" : sample_data ? "تجربة مع داتا تجريبية" : "اشتراك جديد"]
    );
    invalidateTenant(id);
    return { ...tenant, ...extra };
  } catch (err) {
    // تراجع كامل إذا صار أي خطأ
    await platformQuery("DELETE FROM platform.user_directory WHERE tenant_id = $1", [id]).catch(() => {});
    await platformQuery(`DROP SCHEMA IF EXISTS ${quoteSchema(schema)} CASCADE`).catch(() => {});
    await platformQuery("DELETE FROM platform.tenants WHERE id = $1", [id]).catch(() => {});
    throw err;
  }
}

// بيبني جداول المحل من الصفر: المدير، وداتا تجريبية (اختياري) مع حساب كابتن للتجربة
async function buildTenantData(tenant, { owner, sample }) {
  const schema = tenant.schema_name;
  await runSqlInSchema(schema, fs.readFileSync(SCHEMA_SQL_PATH, "utf-8"));
  let captain = null;
  await runInTenant(tenant, async () => {
    await query(
      `INSERT INTO users (username, password_hash, full_name, role, status, can_discount, can_delete_customer, can_edit_product_price, can_cancel_order)
       VALUES ($1, $2, $3, 'super_admin', 'active', true, true, true, true)`,
      [owner.username, owner.password_hash, owner.full_name]
    );
    await query(
      `INSERT INTO app_settings (key, value) VALUES ('shop_name', $1) ON CONFLICT (key) DO UPDATE SET value = $1`,
      [tenant.name]
    );
    if (sample) {
      // حساب كابتن للتجربة: بيقدر يجرّب الرحلات والتسليم من موبايل ثاني
      const capName = `${owner.username}_cap`.slice(0, 40);
      const owned = await findTenantIdByUsername(capName);
      if (!owned || Number(owned) === Number(tenant.id)) {
        const cap = await query(
          `INSERT INTO users (username, password_hash, full_name, role, status) VALUES ($1, $2, 'كابتن تجريبي', 'driver', 'active') RETURNING id`,
          [capName, owner.password_hash]
        );
        captain = { id: cap.rows[0].id, username: capName };
      }
      await seedDemoData({ captainId: captain?.id || null });
    }
  });
  await claimUsername(owner.username, tenant.id);
  if (captain) await claimUsername(captain.username, tenant.id);
  return { captain_username: captain?.username || null };
}

// بيرجّع داتا المحل لأولها: sample=true داتا تجريبية جديدة، false = محل فاضي نظيف.
// المدير بيضل بنفس اسم المستخدم وكلمة السر. رسائل الدعم والاشتراك ما بتنلمس.
export async function resetTenantData(tenantId, { sample = true } = {}) {
  const tenant = (await platformQuery("SELECT * FROM platform.tenants WHERE id = $1", [tenantId])).rows[0];
  if (!tenant) throw new Error("المحل غير موجود.");
  if (tenant.is_home || tenant.schema_name === "public") throw new Error("ما بينفع تمسح داتا المحل الأساسي.");
  const schema = quoteSchema(tenant.schema_name);
  const ownerR = await platformQuery(
    `SELECT username, password_hash, full_name FROM ${schema}.users WHERE role = 'super_admin' ORDER BY id LIMIT 1`
  );
  const owner = ownerR.rows[0];
  if (!owner) throw new Error("ما لقيت مدير المحل.");
  await platformQuery("DELETE FROM platform.user_directory WHERE tenant_id = $1", [tenant.id]);
  await platformQuery(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await platformQuery(`CREATE SCHEMA ${schema}`);
  const extra = await buildTenantData(tenant, { owner: { ...owner, username: normalizeUsername(owner.username) }, sample });
  await platformQuery(
    "INSERT INTO platform.subscription_log (tenant_id, action, note) VALUES ($1, 'reset', $2)",
    [tenant.id, sample ? "رجعت الداتا التجريبية لأولها" : "انمسحت الداتا — بداية نظيفة"]
  );
  invalidateTenant(tenant.id);
  return extra;
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

async function seedDemoData({ captainId = null } = {}) {
  // موقع افتراضي للمحل (عمّان) والزباين حواليه — عشان الخريطة وترتيب الرحلات يشتغلوا بالتجربة
  const CENTER = { lat: 31.9539, lon: 35.9106 };
  await query(
    `INSERT INTO app_settings (key, value) VALUES ('shop_latitude', $1), ('shop_longitude', $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [String(CENTER.lat), String(CENTER.lon)]
  );
  const regions = ["الحي الشرقي", "وسط البلد", "الحي الغربي"];
  const regionIds = [];
  for (const r of regions) {
    const x = await query("INSERT INTO regions (name) VALUES ($1) RETURNING id", [r]).catch(() => ({ rows: [] }));
    if (x.rows[0]) regionIds.push(x.rows[0].id);
  }
  const prod = await query("SELECT id, unit_price FROM products WHERE status = 'active' AND (coupon_eligible OR is_returnable) ORDER BY sort_order, id LIMIT 1");
  let product = prod.rows[0];
  if (!product) {
    product = (await query(
      "INSERT INTO products (name, unit_price, coupon_eligible, is_returnable, sort_order) VALUES ('جالون ١٩ لتر', 1.5, true, true, 1) RETURNING id, unit_price"
    )).rows[0];
  }
  await query(
    "INSERT INTO coupon_packages (name, coupons, bonus_coupons, price, description) VALUES ('باقة التوفير', 10, 1, 15, 'الأوفر للبيوت'), ('باقة العائلة', 20, 3, 28, 'للعائلات الكبيرة')"
  ).catch(() => {});

  const customerIds = [];
  for (let i = 0; i < DEMO_NAMES.length; i++) {
    const phone = `96279${String(1000000 + i * 7919).slice(0, 7)}`;
    const debt = i % 5 === 0 ? 4.5 : 0;
    const c = (await query(
      `INSERT INTO customers (sequential_number, name, phone_normalized, phone_display, bottle_type, coupon_balance, debt_balance, is_sample)
       VALUES (lpad(nextval('customer_seq')::text, 6, '0'), $1, $2, $3, $4, $5, $6, true) RETURNING id`,
      [DEMO_NAMES[i], phone, `0${phone.slice(3)}`, i % 3 ? "used" : "new", i % 4 === 0 ? 7 : 0, debt]
    )).rows[0];
    customerIds.push(c.id);
    if (debt) {
      await query(
        "INSERT INTO customer_debt_ledger (customer_id, change_amount, reason, balance_after, notes) VALUES ($1, $2, 'manual', $2, 'رصيد افتتاحي (تجريبي)')",
        [c.id, debt]
      ).catch(() => {});
    }
    const angle = (i / DEMO_NAMES.length) * Math.PI * 2;
    const dist = 0.008 + (i % 4) * 0.006;
    await query(
      `INSERT INTO customer_locations (customer_id, region_id, latitude, longitude, street, building_number, floor)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [c.id, regionIds[i % regionIds.length] || null, CENTER.lat + Math.sin(angle) * dist, CENTER.lon + Math.cos(angle) * dist,
       `شارع ${["الجامعة", "المدينة", "الملكة رانيا", "الأمير حسن"][i % 4]}`, String(1 + (i % 12)), ["الأرضي", "الأول", "الثاني", "الثالث"][i % 4]]
    );
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

  // طلبات جديدة اليوم — جاهزة يعمل فيها رحلة ويجرّب التسليم
  for (let j = 0; j < 6; j++) {
    const cid = customerIds[(j * 3) % customerIds.length];
    const qty = 1 + (j % 3);
    const total = Number(product.unit_price) * qty;
    const n = (await query("SELECT nextval('order_seq') AS n")).rows[0].n;
    const o = (await query(
      `INSERT INTO orders (order_number, customer_id, status, priority, subtotal, final_total, created_at)
       VALUES ($1, $2, 'NEW', $3, $4, $4, now() - ($5 || ' minutes')::interval) RETURNING id`,
      [String(n).padStart(6, "0"), cid, j === 0 ? "urgent" : "normal", total, String(10 + j * 17)]
    )).rows[0];
    await query(
      `INSERT INTO order_items (order_id, product_id, product_name_snapshot, quantity, unit_price_snapshot, line_total)
       SELECT $1, id, name, $2, $3, $4 FROM products WHERE id = $5`,
      [o.id, qty, product.unit_price, total, product.id]
    );
  }

  // موظفين تجريبيين للدوام والرواتب
  const owner = (await query("SELECT id, full_name FROM users WHERE role = 'super_admin' ORDER BY id LIMIT 1")).rows[0];
  const emps = [
    { name: "كابتن تجريبي", job: "كابتن", type: "daily", amount: 12, user: captainId },
    { name: "عامل تعبئة", job: "تعبئة", type: "monthly", amount: 300, user: null },
  ];
  for (const e of emps) {
    const r = await query(
      `INSERT INTO employees (name, job_title, pay_type, pay_amount, user_id, start_date, is_sample) VALUES ($1,$2,$3,$4,$5, CURRENT_DATE - 10, true) RETURNING id`,
      [e.name, e.job, e.type, e.amount, e.user]
    ).catch(() => ({ rows: [] }));
    const eid = r.rows[0]?.id;
    if (!eid) continue;
    for (let d = 10; d >= 1; d--) {
      await query(
        "INSERT INTO attendance (employee_id, work_date, status, recorded_by) VALUES ($1, CURRENT_DATE - $2::int, $3, $4) ON CONFLICT DO NOTHING",
        [eid, d, d % 6 === 0 ? "off" : d === 4 ? "half" : "present", owner?.id || null]
      ).catch(() => {});
    }
    await query(
      "INSERT INTO employee_transactions (employee_id, kind, amount, entry_date, note, created_by) VALUES ($1, 'advance', 10, CURRENT_DATE - 3, 'سحب (تجريبي)', $2)",
      [eid, owner?.id || null]
    ).catch(() => {});
  }

  await query("DELETE FROM app_settings WHERE key IN ('forecast_learn_from','forecast_reset_at')");
}


// ============================================================
// حذف الداتا التجريبية بس (الزباين والموظفين الوهميين وطلباتهم)
// الزباين والطلبات الحقيقية اللي ضافها المحل ما بتنلمس أبدًا
// لازم تنادى جوّا سياق المحل (runInTenant أو طلب API للمحل)
// ============================================================
const DEMO_REGIONS = ["الحي الشرقي", "وسط البلد", "الحي الغربي"];
const DEMO_CENTER = { lat: "31.9539", lon: "35.9106" };

export async function sampleDataCount() {
  const r = await query(
    `SELECT (SELECT COUNT(*)::int FROM customers WHERE is_sample) AS customers,
            (SELECT COUNT(*)::int FROM employees WHERE is_sample) AS employees`
  );
  return r.rows[0];
}

export async function removeSampleData() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const ids = (await client.query("SELECT id FROM customers WHERE is_sample")).rows.map((r) => r.id);
    let orders = [], trips = [], deletedTrips = 0;
    if (ids.length) {
      orders = (await client.query("SELECT id FROM orders WHERE customer_id = ANY($1::int[])", [ids])).rows.map((r) => r.id);
      if (orders.length) {
        trips = (await client.query("SELECT DISTINCT trip_id FROM trip_stops WHERE order_id = ANY($1::int[])", [orders])).rows.map((r) => r.trip_id);
        await client.query("DELETE FROM trip_stops WHERE order_id = ANY($1::int[])", [orders]);
      }
      await client.query("DELETE FROM coupon_ledger WHERE customer_id = ANY($1::int[]) OR order_id = ANY($2::int[])", [ids, orders]);
      await client.query("DELETE FROM customer_debt_ledger WHERE customer_id = ANY($1::int[]) OR order_id = ANY($2::int[])", [ids, orders]);
      await client.query("DELETE FROM notifications WHERE related_customer_id = ANY($1::int[])", [ids]);
      if (orders.length) await client.query("DELETE FROM orders WHERE id = ANY($1::int[])", [orders]);
      await client.query("DELETE FROM customers WHERE id = ANY($1::int[])", [ids]);
      // رحلات صارت فاضية (كانت كلها طلبات تجريبية)
      if (trips.length) {
        const empty = (await client.query(
          "SELECT t.id FROM trips t WHERE t.id = ANY($1::int[]) AND NOT EXISTS (SELECT 1 FROM trip_stops s WHERE s.trip_id = t.id)",
          [trips]
        )).rows.map((r) => r.id);
        if (empty.length) {
          await client.query("DELETE FROM driver_ledger WHERE trip_id = ANY($1::int[])", [empty]);
          await client.query("UPDATE notifications SET related_trip_id = NULL WHERE related_trip_id = ANY($1::int[])", [empty]);
          await client.query("UPDATE customer_debt_ledger SET trip_id = NULL WHERE trip_id = ANY($1::int[])", [empty]);
          await client.query("DELETE FROM trips WHERE id = ANY($1::int[])", [empty]);
          deletedTrips = empty.length;
        }
      }
    }
    // الموظفين التجريبيين (والكابتن التجريبي بينطفى حسابه)
    const emps = (await client.query("DELETE FROM employees WHERE is_sample RETURNING user_id")).rows;
    const capIds = emps.map((e) => e.user_id).filter(Boolean);
    if (capIds.length) {
      await client.query("UPDATE users SET status = 'disabled' WHERE id = ANY($1::int[]) AND role = 'driver' AND full_name = 'كابتن تجريبي'", [capIds]);
    }
    // المناطق التجريبية إذا ما ضل عليها ولا زبون
    await client.query(
      `DELETE FROM regions r WHERE r.name = ANY($1::text[])
         AND NOT EXISTS (SELECT 1 FROM customer_locations l WHERE l.region_id = r.id)`,
      [DEMO_REGIONS]
    ).catch(() => {});
    // موقع المحل الافتراضي التجريبي — عشان يحدد موقعه الحقيقي
    const loc = (await client.query("SELECT key, value FROM app_settings WHERE key IN ('shop_latitude','shop_longitude')")).rows;
    const m = Object.fromEntries(loc.map((x) => [x.key, x.value]));
    if (m.shop_latitude === DEMO_CENTER.lat && m.shop_longitude === DEMO_CENTER.lon) {
      await client.query("DELETE FROM app_settings WHERE key IN ('shop_latitude','shop_longitude')");
    }
    await client.query("COMMIT");
    try { invalidateForecastCache(); } catch { /* تجاهل */ }
    return { customers: ids.length, orders: orders.length, trips: deletedTrips, employees: emps.length };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
