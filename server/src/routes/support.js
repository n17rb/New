import { Router } from "express";
import { platformQuery } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { can } from "../permissions.js";
import { uploadSingleImage, saveCompressedImage } from "../middleware/upload.js";
import { getPlatformSettings } from "../utils/tenants.js";
import { notifyPlatformAdmins } from "../utils/platformNotify.js";

// الدعم الفني: محادثة المحل مع إدارة موج (نفس شكل شات الموظفين)
const router = Router();
router.use(requireAuth);

function canUseSupport(req) {
  if (req.tenant.is_home) return false;
  return req.user.role === "super_admin" || can(req.user, "settings", "edit");
}

router.use((req, res, next) => (canUseSupport(req) || req.user.inspecting ? next() : res.status(403).json({ error: "الدعم الفني لمدير المحل." })));

const COLS = "id, from_support, sender_name, body, image_url, read_at, created_at";

async function supportProfile() {
  const s = await getPlatformSettings();
  return { name: s.support_name || "دعم موج", photo_url: s.support_photo_url || null, phone: s.contact_phone || null };
}

router.get("/unread", async (req, res) => {
  const r = await platformQuery(
    "SELECT COUNT(*)::int AS count FROM platform.support_messages WHERE tenant_id = $1 AND from_support AND read_at IS NULL",
    [req.tenant.id]
  );
  res.json(r.rows[0]);
});

router.get("/thread", async (req, res) => {
  const before = Number(req.query.before) || null;
  const r = await platformQuery(
    `SELECT ${COLS} FROM platform.support_messages
     WHERE tenant_id = $1 ${before ? "AND id < $2" : ""}
     ORDER BY id DESC LIMIT 60`,
    before ? [req.tenant.id, before] : [req.tenant.id]
  );
  res.json({ support: await supportProfile(), messages: r.rows.reverse(), has_more: r.rows.length === 60 });
});

async function addMessage(req, { body, image_url }) {
  const r = await platformQuery(
    `INSERT INTO platform.support_messages (tenant_id, from_support, sender_name, sender_user_id, body, image_url)
     VALUES ($1, false, $2, $3, $4, $5) RETURNING ${COLS}`,
    [req.tenant.id, req.user.full_name, req.user.id, body || null, image_url || null]
  );
  notifyPlatformAdmins({
    message: `💬 ${req.tenant.name}: ${body ? body.slice(0, 80) : "📷 صورة"}`,
    url: `/platform/support/${req.tenant.id}`,
    title: "دعم موج",
  }).catch(() => {});
  return r.rows[0];
}

router.post("/thread", async (req, res) => {
  const body = String(req.body?.body || "").trim();
  if (!body) return res.status(400).json({ error: "اكتب رسالة." });
  if (body.length > 2000) return res.status(400).json({ error: "الرسالة طويلة كثير." });
  res.status(201).json(await addMessage(req, { body }));
});

router.post("/thread/image", uploadSingleImage, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "ما في صورة." });
  const url = await saveCompressedImage(req.file.buffer, `support-t${req.tenant.id}`);
  res.status(201).json(await addMessage(req, { body: String(req.body?.body || "").trim() || null, image_url: url }));
});

router.post("/read", async (req, res) => {
  if (req.user.inspecting) return res.json({ ok: true });
  await platformQuery(
    "UPDATE platform.support_messages SET read_at = now() WHERE tenant_id = $1 AND from_support AND read_at IS NULL",
    [req.tenant.id]
  );
  res.json({ ok: true });
});

export default router;
