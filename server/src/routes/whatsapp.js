import { Router } from "express";
import { query, logActivity } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { can } from "../permissions.js";
import { getWaSettings, saveWaSettings, isConfigured, sendTemplate, forecastRecipients, runForecastWhatsapp, getQueueToken, forecastQueue, markQueueSent, nextQueued, markOutboxSent } from "../utils/whatsapp.js";
import { getTenant } from "../utils/tenants.js";
import { setRequestTenant } from "../db.js";
import { jordanDate } from "../utils/forecast.js";
import { currentTenant } from "../db.js";

// إعدادات واتساب التلقائي — للمدير بس (فيها مفتاح سري)
const router = Router();
router.use(requireAuth, (req, res, next) => (req.user.role === "super_admin" || can(req.user, "settings", "edit") ? next() : res.status(403).json({ error: "هاي الإعدادات للمدير بس." })));

const wrap = (fn) => async (req, res) => {
  try { await fn(req, res); } catch (err) { console.error("whatsapp:", err); res.status(500).json({ error: "صار خطأ، جرّب كمان مرة." }); }
};
const masked = (t) => (t ? `••••${t.slice(-4)}` : "");

router.get("/", wrap(async (req, res) => {
  const s = await getWaSettings();
  const today = jordanDate();
  const [recipients, log, outbox] = await Promise.all([
    forecastRecipients().catch(() => []),
    query(
      `SELECT w.*, c.name FROM wa_messages w LEFT JOIN customers c ON c.id = w.customer_id
       WHERE w.created_at > now() - interval '7 days' ORDER BY w.created_at DESC LIMIT 60`
    ),
    query(
      `SELECT o.id, o.kind, o.status, o.created_at, o.sent_at, c.name FROM wa_outbox o LEFT JOIN customers c ON c.id = o.customer_id
       WHERE o.created_at > now() - interval '3 days' ORDER BY o.created_at DESC LIMIT 40`
    ),
  ]);
  res.json({
    settings: { provider: s.provider, enabled: s.enabled, phone_id: s.phone_id, token_masked: masked(s.token), has_token: !!s.token, template: s.template, lang: s.lang, hour: s.hour, last_run: s.last_run },
    configured: isConfigured(s),
    today, shop_name: currentTenant()?.name || "",
    queue_token: await getQueueToken(),
    device_user: Number(s.device_user) || null,
    coupons_auto: s.coupons_auto,
    users: (await query("SELECT id, full_name FROM users WHERE status = 'active' ORDER BY full_name")).rows,
    recipients, log: log.rows, outbox: outbox.rows,
  });
}));

router.put("/", wrap(async (req, res) => {
  const b = req.body || {};
  const patch = {};
  if (typeof b.enabled === "boolean") patch.wa_enabled = b.enabled ? "1" : "0";
  if (["meta", "d360"].includes(b.provider)) patch.wa_provider = b.provider;
  if (typeof b.coupons_auto === "boolean") patch.wa_coupons_auto = b.coupons_auto ? "1" : "0";
  if (b.device_user !== undefined) patch.wa_device_user = Number(b.device_user) > 0 ? Number(b.device_user) : "";
  if (b.phone_id != null) patch.wa_phone_id = String(b.phone_id).replace(/\D/g, "").slice(0, 30);
  if (b.token) patch.wa_token = String(b.token).trim().slice(0, 600);
  if (b.template != null) patch.wa_template = String(b.template).trim().replace(/[^a-z0-9_]/gi, "").toLowerCase().slice(0, 100);
  if (b.lang != null) patch.wa_lang = String(b.lang).trim().replace(/[^a-zA-Z_]/g, "").slice(0, 10) || "ar";
  if (b.hour != null) {
    const h = Number(b.hour);
    if (!Number.isInteger(h) || h < 5 || h > 12) return res.status(400).json({ error: "الساعة لازم تكون بين ٥ و١٢ الصبح." });
    patch.wa_hour = h;
  }
  await saveWaSettings(patch);
  await logActivity({ userId: req.user.id, action: "UPDATE_WHATSAPP", recordType: "settings", recordId: null, newValue: Object.keys(patch) });
  res.json({ ok: true });
}));

// رسالة تجربة لرقمك
router.post("/test", wrap(async (req, res) => {
  const s = await getWaSettings();
  if (!isConfigured(s)) return res.status(400).json({ error: "عبّي المفتاح واسم القالب (وPhone number ID إذا ربط مباشر مع Meta) أول." });
  const phone = String(req.body?.phone || "").replace(/\D/g, "").replace(/^0/, "962");
  if (phone.length < 10) return res.status(400).json({ error: "اكتب رقم صحيح." });
  const out = await sendTemplate(s, phone, ["يوسف", currentTenant()?.name || "المحل", "قارورتين"]);
  await query("INSERT INTO wa_messages (phone, kind, sent_on, status, wa_id, error) VALUES ($1,'test',$2,$3,$4,$5)",
    [phone, jordanDate(), out.ok ? "test" : "failed", out.id || null, out.ok ? null : out.error]);
  if (!out.ok) return res.status(400).json({ error: `واتساب رفض: ${out.error}` });
  res.json({ ok: true });
}));

// ابعت تذكيرات اليوم هلّق (للي لسا ما وصلهم)
router.post("/run-now", wrap(async (req, res) => {
  const r = await runForecastWhatsapp({ force: true });
  if (r.skipped === "off") return res.status(400).json({ error: "شغّل الإرسال التلقائي وعبّي الإعدادات أول." });
  res.json(r);
}));

// زبون ما بده تذكير (أو رجّعه)
router.put("/customers/:id", wrap(async (req, res) => {
  await query("UPDATE customers SET wa_forecast_off = $1 WHERE id = $2", [!!req.body?.off, req.params.id]);
  res.json({ ok: true });
}));

// رابط جديد لجهاز الأندرويد (القديم بيوقف)
router.post("/queue-token", wrap(async (req, res) => {
  res.json({ token: await getQueueToken({ regenerate: true }) });
}));

export default router;

// ---------- للموبايل (بدون دخول، بالرابط السري) ----------
export const waPublicRouter = Router();
async function queueTenant(req, res) {
  const token = String(req.params.token || "");
  const m = token.match(/^(\d+)-[a-f0-9]{24}$/);
  if (!m) { res.status(404).json({ error: "رابط غير صحيح." }); return null; }
  const tenant = await getTenant(Number(m[1]));
  if (!tenant || tenant.status !== "active") { res.status(404).json({ error: "رابط غير صحيح." }); return null; }
  setRequestTenant(tenant);
  const saved = (await query("SELECT value FROM app_settings WHERE key = 'wa_queue_token'")).rows[0]?.value;
  if (saved !== token) { res.status(404).json({ error: "رابط غير صحيح." }); return null; }
  return tenant;
}
// كل الدور
waPublicRouter.get("/wa-queue/:token", async (req, res) => {
  try {
    if (!(await queueTenant(req, res))) return;
    const list = await forecastQueue();
    res.json({ date: jordanDate(), count: list.length, messages: list });
  } catch (err) { console.error("wa-queue:", err); res.status(500).json({ error: "صار خطأ." }); }
});
// الرسالة الجاية بس (أسهل للأتمتة) — done=true يعني ما في إشي هلّق
// done_url: الرابط اللي الموبايل بيفتحه بعد ما يبعت (عشان ما تنعاد)
waPublicRouter.get("/wa-queue/:token/next", async (req, res) => {
  try {
    if (!(await queueTenant(req, res))) return;
    const n = await nextQueued();
    if (!n) return res.json({ done: true, phone: "", text: "", url: "", done_url: "", customer_id: 0, left: 0 });
    const base = `${req.protocol === "http" && req.get("x-forwarded-proto") ? req.get("x-forwarded-proto") : req.protocol}://${req.get("host")}/api/public/wa-queue/${req.params.token}`;
    const done_url = n.source === "outbox" ? `${base}/sent-outbox/${n.id}` : `${base}/sent/${n.customer_id}`;
    res.json({ done: false, ...n, done_url });
  } catch (err) { console.error("wa-queue:", err); res.status(500).json({ error: "صار خطأ." }); }
});
waPublicRouter.all("/wa-queue/:token/sent-outbox/:id", async (req, res) => {
  try {
    if (!(await queueTenant(req, res))) return;
    await markOutboxSent(Number(req.params.id));
    res.json({ ok: true });
  } catch (err) { console.error("wa-queue:", err); res.status(500).json({ error: "صار خطأ." }); }
});
// انبعتت (الموبايل بيبلّغ عشان ما تنعاد)
waPublicRouter.all("/wa-queue/:token/sent/:customerId", async (req, res) => {
  try {
    if (!(await queueTenant(req, res))) return;
    const c = (await query("SELECT id, phone_normalized FROM customers WHERE id = $1", [req.params.customerId])).rows[0];
    if (!c) return res.status(404).json({ error: "الزبون غير موجود." });
    await markQueueSent(c.id, c.phone_normalized);
    res.json({ ok: true });
  } catch (err) { console.error("wa-queue:", err); res.status(500).json({ error: "صار خطأ." }); }
});
