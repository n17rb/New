import { Router } from "express";
import bcrypt from "bcryptjs";
import { platformQuery, runInTenant, query, quoteSchema } from "../db.js";
import { requireAuth, requirePlatformAdmin, signInspectToken } from "../middleware/auth.js";
import { uploadSingleImage, saveCompressedImage } from "../middleware/upload.js";
import {
  listTenants, getTenant, tenantAccess, createTenant, extendTenant, invalidateTenant,
  getPlatformSettings, findTenantIdByUsername, claimUsername,
} from "../utils/tenants.js";
import { notifyTenantManagers } from "../utils/platformNotify.js";

// ============================================================
// لوحة إدارة موج: المحلات المشتركة، الاشتراكات، الدفعات، الدعم الفني
// ============================================================
const router = Router();
router.use(requireAuth, requirePlatformAdmin);

const DAY = 86400000;

// أرقام استخدام كل محل (من جداوله)
async function tenantStats(t) {
  const s = quoteSchema(t.schema_name);
  try {
    const r = await platformQuery(
      `SELECT
         (SELECT COUNT(*)::int FROM ${s}.customers WHERE status = 'active') AS customers,
         (SELECT COUNT(*)::int FROM ${s}.users WHERE status = 'active') AS users,
         (SELECT COUNT(*)::int FROM ${s}.orders WHERE created_at > now() - interval '30 days') AS orders_30d,
         (SELECT COUNT(*)::int FROM ${s}.orders WHERE status = 'DELIVERED' AND updated_at > now() - interval '30 days') AS delivered_30d,
         (SELECT COUNT(*)::int FROM ${s}.orders WHERE created_at > now() - interval '1 day') AS orders_today,
         (SELECT MAX(created_at) FROM ${s}.orders) AS last_order_at`
    );
    return r.rows[0];
  } catch {
    return null;
  }
}

function present(t, stats = null, extra = {}) {
  return {
    id: t.id, name: t.name, owner_name: t.owner_name, phone: t.phone, city: t.city, status: t.status,
    is_demo: t.is_demo, is_home: t.is_home, monthly_price: Number(t.monthly_price),
    subscription_ends_at: t.subscription_ends_at, notes: t.notes, created_at: t.created_at,
    last_active_at: t.last_active_at, access: tenantAccess(t), stats, ...extra,
  };
}

router.get("/overview", async (req, res) => {
  const tenants = await listTenants();
  const paying = tenants.filter((t) => !t.is_home && !t.is_demo);
  const counts = { total: paying.length, active: 0, expiring: 0, expired: 0, suspended: 0, demo: tenants.filter((t) => t.is_demo).length };
  let mrr = 0;
  for (const t of paying) {
    const a = tenantAccess(t);
    counts[a.state] = (counts[a.state] || 0) + 1;
    if (a.state === "active" || a.state === "expiring") mrr += Number(t.monthly_price) || 0;
  }
  const [pending, unread, revenue] = await Promise.all([
    platformQuery("SELECT COUNT(*)::int AS n FROM platform.payments WHERE status = 'pending'"),
    platformQuery("SELECT COUNT(*)::int AS n FROM platform.support_messages WHERE NOT from_support AND read_at IS NULL"),
    platformQuery(
      `SELECT COALESCE(SUM(amount), 0)::float AS month
       FROM platform.payments WHERE status = 'approved'
         AND date_trunc('month', reviewed_at AT TIME ZONE 'Asia/Amman') = date_trunc('month', now() AT TIME ZONE 'Asia/Amman')`
    ),
  ]);
  res.json({
    counts,
    monthly_recurring: mrr,
    revenue_this_month: revenue.rows[0].month,
    pending_payments: pending.rows[0].n,
    unread_support: unread.rows[0].n,
  });
});

router.get("/tenants", async (req, res) => {
  const tenants = await listTenants();
  const unread = await platformQuery(
    `SELECT tenant_id, COUNT(*)::int AS n FROM platform.support_messages WHERE NOT from_support AND read_at IS NULL GROUP BY tenant_id`
  );
  const unreadMap = Object.fromEntries(unread.rows.map((r) => [r.tenant_id, r.n]));
  const out = [];
  for (const t of tenants) out.push(present(t, await tenantStats(t), { unread_support: unreadMap[t.id] || 0 }));
  res.json(out);
});

router.get("/tenants/:id", async (req, res) => {
  const t = await getTenant(req.params.id);
  if (!t) return res.status(404).json({ error: "المحل غير موجود." });
  const [payments, log, owners] = await Promise.all([
    platformQuery("SELECT * FROM platform.payments WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 30", [t.id]),
    platformQuery("SELECT * FROM platform.subscription_log WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 30", [t.id]),
    platformQuery(`SELECT id, username, full_name, role, status FROM ${quoteSchema(t.schema_name)}.users ORDER BY id`),
  ]);
  res.json(present(t, await tenantStats(t), { payments: payments.rows, log: log.rows, users: owners.rows }));
});

router.post("/tenants", async (req, res) => {
  const s = await getPlatformSettings();
  const b = req.body || {};
  try {
    const t = await createTenant({
      name: b.name, owner_name: b.owner_name, phone: b.phone, city: b.city,
      username: b.username, password: b.password,
      monthly_price: b.monthly_price ?? s.default_monthly_price,
      days: b.days ?? (b.is_demo ? 30 : s.trial_days),
      is_demo: !!b.is_demo, notes: b.notes,
    });
    res.status(201).json(present(await getTenant(t.id)));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put("/tenants/:id", async (req, res) => {
  const t = await getTenant(req.params.id);
  if (!t) return res.status(404).json({ error: "المحل غير موجود." });
  const b = req.body || {};
  if (b.status && !["active", "suspended"].includes(b.status)) return res.status(400).json({ error: "الحالة غير صحيحة." });
  if (t.is_home && b.status === "suspended") return res.status(400).json({ error: "ما بينفع توقف المحل الأساسي." });
  await platformQuery(
    `UPDATE platform.tenants SET
       name = COALESCE(NULLIF($1, ''), name), owner_name = COALESCE($2, owner_name), phone = COALESCE($3, phone),
       city = COALESCE($4, city), monthly_price = COALESCE($5, monthly_price), notes = COALESCE($6, notes),
       status = COALESCE($7, status), is_demo = COALESCE($8, is_demo)
     WHERE id = $9`,
    [b.name?.trim(), b.owner_name ?? null, b.phone ?? null, b.city ?? null,
     b.monthly_price != null && b.monthly_price !== "" ? Number(b.monthly_price) : null, b.notes ?? null,
     b.status || null, t.is_home ? false : (typeof b.is_demo === "boolean" ? b.is_demo : null), t.id]
  );
  if (b.status && b.status !== t.status) {
    await platformQuery(
      "INSERT INTO platform.subscription_log (tenant_id, action, note) VALUES ($1, $2, $3)",
      [t.id, b.status === "suspended" ? "suspend" : "resume", b.reason || null]
    );
  }
  invalidateTenant(t.id);
  res.json(present(await getTenant(t.id)));
});

// تمديد: بالأيام أو الشهور (من آخر تاريخ أو من اليوم إذا خالص)
router.post("/tenants/:id/extend", async (req, res) => {
  const t = await getTenant(req.params.id);
  if (!t) return res.status(404).json({ error: "المحل غير موجود." });
  if (t.is_home) return res.status(400).json({ error: "المحل الأساسي ما إله اشتراك." });
  const days = Number(req.body?.days) || (Number(req.body?.months) || 0) * 30;
  if (!days || days < -365 || days > 1100) return res.status(400).json({ error: "عدد الأيام غير صحيح." });
  const ends = await extendTenant(t.id, { days, amount: req.body?.amount ?? null, note: req.body?.note || null, action: days > 0 ? "extend" : "reduce" });
  if (days > 0) {
    notifyTenantManagers(t, {
      message: `✅ تم تجديد اشتراك موج — فعّال لحد ${ends.toLocaleDateString("ar-JO", { timeZone: "Asia/Amman", day: "numeric", month: "long", year: "numeric" })}. شكرًا إلك 💙`,
    }).catch(() => {});
  }
  res.json(present(await getTenant(t.id)));
});

// معاينة المحل: توكن مشاهدة فقط لساعتين
router.post("/tenants/:id/inspect", async (req, res) => {
  const t = await getTenant(req.params.id);
  if (!t) return res.status(404).json({ error: "المحل غير موجود." });
  res.json({ token: signInspectToken(t.id, req.user.id), shop: { id: t.id, name: t.name } });
});

// تغيير كلمة سر مدير المحل (لو نسيها)
router.post("/tenants/:id/reset-password", async (req, res) => {
  const t = await getTenant(req.params.id);
  if (!t) return res.status(404).json({ error: "المحل غير موجود." });
  const { user_id, password } = req.body || {};
  if (!password || String(password).length < 6) return res.status(400).json({ error: "كلمة السر ٦ أحرف على الأقل." });
  const hash = await bcrypt.hash(String(password), 10);
  const r = await runInTenant(t, () => query("UPDATE users SET password_hash = $1 WHERE id = $2 RETURNING username", [hash, user_id]));
  if (!r.rows[0]) return res.status(404).json({ error: "المستخدم غير موجود." });
  await platformQuery("INSERT INTO platform.subscription_log (tenant_id, action, note) VALUES ($1, 'password_reset', $2)", [t.id, r.rows[0].username]);
  res.json({ ok: true });
});

// ---------- الدفعات ----------
router.get("/payments", async (req, res) => {
  const status = ["pending", "approved", "rejected"].includes(req.query.status) ? req.query.status : null;
  const r = await platformQuery(
    `SELECT p.*, t.name AS tenant_name, t.monthly_price, t.subscription_ends_at
     FROM platform.payments p JOIN platform.tenants t ON t.id = p.tenant_id
     ${status ? "WHERE p.status = $1" : ""}
     ORDER BY (p.status = 'pending') DESC, p.created_at DESC LIMIT 100`,
    status ? [status] : []
  );
  res.json(r.rows);
});

router.post("/payments/:id/approve", async (req, res) => {
  const p = (await platformQuery("SELECT * FROM platform.payments WHERE id = $1", [req.params.id])).rows[0];
  if (!p) return res.status(404).json({ error: "الدفعة غير موجودة." });
  if (p.status !== "pending") return res.status(400).json({ error: "هذه الدفعة انراجعت من قبل." });
  const months = Math.min(36, Math.max(1, Math.floor(Number(req.body?.months) || p.months || 1)));
  const amount = req.body?.amount != null && req.body.amount !== "" ? Number(req.body.amount) : p.amount;
  const upd = await platformQuery(
    `UPDATE platform.payments SET status = 'approved', months = $1, amount = $2, reviewed_at = now(), review_note = $3
     WHERE id = $4 AND status = 'pending' RETURNING id`,
    [months, amount, req.body?.note || null, p.id]
  );
  if (!upd.rows[0]) return res.status(400).json({ error: "هذه الدفعة انراجعت من قبل." });
  const ends = await extendTenant(p.tenant_id, { days: months * 30, amount, note: `دفعة كليك #${p.id}`, action: "payment" });
  const t = await getTenant(p.tenant_id);
  notifyTenantManagers(t, {
    message: `✅ استلمنا تحويلك وتجدد الاشتراك ${months === 1 ? "شهر" : `${months} شهور`} — فعّال لحد ${ends.toLocaleDateString("ar-JO", { timeZone: "Asia/Amman", day: "numeric", month: "long", year: "numeric" })}. شكرًا 💙`,
  }).catch(() => {});
  res.json({ ok: true, ends_at: ends });
});

router.post("/payments/:id/reject", async (req, res) => {
  const note = String(req.body?.note || "").trim();
  if (!note) return res.status(400).json({ error: "اكتب سبب الرفض عشان يوصل للمحل." });
  const r = await platformQuery(
    `UPDATE platform.payments SET status = 'rejected', reviewed_at = now(), review_note = $1
     WHERE id = $2 AND status = 'pending' RETURNING tenant_id`,
    [note, req.params.id]
  );
  if (!r.rows[0]) return res.status(400).json({ error: "الدفعة مش قيد المراجعة." });
  const t = await getTenant(r.rows[0].tenant_id);
  notifyTenantManagers(t, { message: `⚠️ ما قدرنا نعتمد إيصال التحويل: ${note}` }).catch(() => {});
  res.json({ ok: true });
});

// ---------- الدعم الفني (صندوق إدارة موج) ----------
const MSG_COLS = "id, tenant_id, from_support, sender_name, body, image_url, read_at, created_at";

router.get("/support/threads", async (req, res) => {
  const r = await platformQuery(
    `SELECT t.id AS tenant_id, t.name AS tenant_name, t.owner_name,
            last.body AS last_body, last.image_url AS last_image, last.created_at AS last_at, last.from_support AS last_from_support,
            (SELECT COUNT(*)::int FROM platform.support_messages m WHERE m.tenant_id = t.id AND NOT m.from_support AND m.read_at IS NULL) AS unread
     FROM platform.tenants t
     JOIN LATERAL (SELECT * FROM platform.support_messages m WHERE m.tenant_id = t.id ORDER BY id DESC LIMIT 1) last ON true
     ORDER BY last.created_at DESC`
  );
  res.json(r.rows);
});

router.get("/support/thread/:tenantId", async (req, res) => {
  const t = await getTenant(req.params.tenantId);
  if (!t) return res.status(404).json({ error: "المحل غير موجود." });
  const r = await platformQuery(
    `SELECT ${MSG_COLS} FROM platform.support_messages WHERE tenant_id = $1 ORDER BY id DESC LIMIT 80`,
    [t.id]
  );
  res.json({ tenant: { id: t.id, name: t.name, owner_name: t.owner_name, phone: t.phone }, messages: r.rows.reverse() });
});

async function supportReply(req, tenant, { body, image_url }) {
  const s = await getPlatformSettings();
  const r = await platformQuery(
    `INSERT INTO platform.support_messages (tenant_id, from_support, sender_name, sender_user_id, body, image_url)
     VALUES ($1, true, $2, $3, $4, $5) RETURNING ${MSG_COLS}`,
    [tenant.id, s.support_name || "دعم موج", req.user.id, body || null, image_url || null]
  );
  notifyTenantManagers(tenant, {
    type: "SUPPORT", title: s.support_name || "دعم موج",
    message: body ? body.slice(0, 120) : "📷 صورة من الدعم الفني", url: "/support",
  }).catch(() => {});
  return r.rows[0];
}

router.post("/support/thread/:tenantId", async (req, res) => {
  const t = await getTenant(req.params.tenantId);
  if (!t) return res.status(404).json({ error: "المحل غير موجود." });
  const body = String(req.body?.body || "").trim();
  if (!body) return res.status(400).json({ error: "اكتب رسالة." });
  res.status(201).json(await supportReply(req, t, { body }));
});

router.post("/support/thread/:tenantId/image", uploadSingleImage, async (req, res) => {
  const t = await getTenant(req.params.tenantId);
  if (!t) return res.status(404).json({ error: "المحل غير موجود." });
  if (!req.file) return res.status(400).json({ error: "ما في صورة." });
  const url = await saveCompressedImage(req.file.buffer, "support-reply");
  res.status(201).json(await supportReply(req, t, { body: String(req.body?.body || "").trim() || null, image_url: url }));
});

router.post("/support/thread/:tenantId/read", async (req, res) => {
  await platformQuery(
    "UPDATE platform.support_messages SET read_at = now() WHERE tenant_id = $1 AND NOT from_support AND read_at IS NULL",
    [req.params.tenantId]
  );
  res.json({ ok: true });
});

// ---------- إعدادات المنصة ----------
const SETTING_KEYS = ["support_name", "cliq_number", "cliq_name", "contact_phone", "default_monthly_price", "trial_days"];

router.get("/settings", async (req, res) => {
  res.json(await getPlatformSettings());
});

router.put("/settings", async (req, res) => {
  for (const key of SETTING_KEYS) {
    if (req.body?.[key] === undefined) continue;
    const value = String(req.body[key]).trim().slice(0, 200);
    if (!value) continue;
    await platformQuery(
      `INSERT INTO platform.settings (key, value, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()`,
      [key, value]
    );
  }
  res.json(await getPlatformSettings());
});

router.post("/settings/support-photo", uploadSingleImage, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "ما في صورة." });
  const url = await saveCompressedImage(req.file.buffer, "support-avatar");
  await platformQuery(
    `INSERT INTO platform.settings (key, value, updated_at) VALUES ('support_photo_url', $1, now())
     ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = now()`,
    [url]
  );
  res.json({ support_photo_url: url });
});

// فحص اسم مستخدم قبل إنشاء محل
router.get("/username-available", async (req, res) => {
  const u = String(req.query.u || "").trim().toLowerCase();
  res.json({ available: !!u && !(await findTenantIdByUsername(u)) });
});

export default router;
