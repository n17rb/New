import { Router } from "express";
import { platformQuery } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { can } from "../permissions.js";
import { uploadSingleImage, saveCompressedImage } from "../middleware/upload.js";
import { tenantAccess, getPlatformSettings, resetTenantData } from "../utils/tenants.js";
import { notifyPlatformAdmins } from "../utils/platformNotify.js";

// اشتراك المحل بموج: الحالة، طريقة الدفع (كليك)، وإرسال إيصال التحويل
const router = Router();
router.use(requireAuth);

function isManager(user) {
  return user.role === "super_admin" || can(user, "settings", "edit");
}

router.get("/", async (req, res) => {
  const t = req.tenant;
  const s = await getPlatformSettings();
  const payments = await platformQuery(
    `SELECT id, amount, months, status, receipt_url, note, review_note, created_at, reviewed_at
     FROM platform.payments WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 12`,
    [t.id]
  );
  res.json({
    shop: { id: t.id, name: t.name, is_home: t.is_home, is_demo: t.is_demo },
    access: tenantAccess(t),
    monthly_price: Number(t.monthly_price) || Number(s.default_monthly_price) || null,
    payment: { cliq_number: s.cliq_number, cliq_name: s.cliq_name, contact_phone: s.contact_phone },
    can_pay: isManager(req.user) && !req.user.inspecting,
    payments: payments.rows,
  });
});

// إرسال إيصال تحويل كليك (صورة) — بيوصل لإدارة موج للمراجعة
router.post("/payment", uploadSingleImage, async (req, res) => {
  if (!isManager(req.user)) return res.status(403).json({ error: "إرسال الدفعة لمدير المحل بس." });
  if (req.tenant.is_home) return res.status(400).json({ error: "هذا المحل الأساسي — ما بده اشتراك." });
  if (!req.file) return res.status(400).json({ error: "ارفق صورة إيصال التحويل." });

  const months = Math.min(12, Math.max(1, Math.floor(Number(req.body?.months) || 1)));
  const amount = req.body?.amount ? Number(req.body.amount) : null;
  if (amount != null && (!Number.isFinite(amount) || amount < 0)) return res.status(400).json({ error: "المبلغ غير صحيح." });

  const pending = await platformQuery(
    "SELECT COUNT(*)::int AS n FROM platform.payments WHERE tenant_id = $1 AND status = 'pending'",
    [req.tenant.id]
  );
  if (pending.rows[0].n >= 3) return res.status(400).json({ error: "عندك دفعات لسا قيد المراجعة — استنى لحد ما تنراجع." });

  const url = await saveCompressedImage(req.file.buffer, `receipt-t${req.tenant.id}`);
  const r = await platformQuery(
    `INSERT INTO platform.payments (tenant_id, amount, months, receipt_url, note, submitted_by_name)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [req.tenant.id, amount, months, url, (req.body?.note || "").slice(0, 500) || null, req.user.full_name]
  );
  res.status(201).json(r.rows[0]);

  notifyPlatformAdmins({
    message: `💳 ${req.tenant.name} بعت إيصال تحويل${amount ? ` ${amount} دينار` : ""} لـ${months === 1 ? "شهر" : `${months} شهور`} — راجعه`,
    url: "/platform?tab=payments",
  }).catch(() => {});
});

// التجربة المجانية: صاحب المحل بيمسح الداتا التجريبية ويبدأ بداتاه الحقيقية (بيضل نفس الحساب)
router.post("/clear-sample", async (req, res) => {
  if (req.user.role !== "super_admin") return res.status(403).json({ error: "هذا للمدير العام للمحل بس." });
  if (req.tenant.is_home || req.tenant.is_demo) return res.status(400).json({ error: "ما بينفع هون." });
  if (String(req.body?.confirm || "").trim() !== "امسح") return res.status(400).json({ error: "اكتب «امسح» للتأكيد." });
  await resetTenantData(req.tenant.id, { sample: false });
  res.json({ ok: true });
});

export default router;
