import { Router } from "express";
import { query, logActivity } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { can } from "../permissions.js";
import { getWaSettings, saveWaSettings, isConfigured, sendTemplate, forecastRecipients, runForecastWhatsapp } from "../utils/whatsapp.js";
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
  const [recipients, log] = await Promise.all([
    forecastRecipients().catch(() => []),
    query(
      `SELECT w.*, c.name FROM wa_messages w LEFT JOIN customers c ON c.id = w.customer_id
       WHERE w.created_at > now() - interval '7 days' ORDER BY w.created_at DESC LIMIT 60`
    ),
  ]);
  res.json({
    settings: { enabled: s.enabled, phone_id: s.phone_id, token_masked: masked(s.token), has_token: !!s.token, template: s.template, lang: s.lang, hour: s.hour, last_run: s.last_run },
    configured: isConfigured(s),
    today, shop_name: currentTenant()?.name || "",
    recipients, log: log.rows,
  });
}));

router.put("/", wrap(async (req, res) => {
  const b = req.body || {};
  const patch = {};
  if (typeof b.enabled === "boolean") patch.wa_enabled = b.enabled ? "1" : "0";
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
  if (!isConfigured(s)) return res.status(400).json({ error: "عبّي رقم الهاتف (Phone number ID) والمفتاح واسم القالب أول." });
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

export default router;
