import { Router } from "express";
import { query } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { getVapidPublicKey, isPushAvailable, sendPushToUser } from "../utils/push.js";

const router = Router();
router.use(requireAuth);

router.get("/public-key", async (req, res) => {
  if (!isPushAvailable()) return res.status(503).json({ error: "إشعارات الجهاز غير متاحة على السيرفر حاليًا." });
  const publicKey = await getVapidPublicKey();
  res.json({ publicKey });
});

router.post("/subscribe", async (req, res) => {
  const sub = req.body?.subscription;
  const endpoint = sub?.endpoint;
  const p256dh = sub?.keys?.p256dh;
  const auth = sub?.keys?.auth;
  if (typeof endpoint !== "string" || !endpoint.startsWith("https://") || !p256dh || !auth) {
    return res.status(400).json({ error: "بيانات الاشتراك غير صحيحة." });
  }

  // نفس الجهاز لو سجّل دخول بحساب ثاني، الاشتراك بينتقل للحساب الجديد
  await query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh,
       auth = EXCLUDED.auth, user_agent = EXCLUDED.user_agent`,
    [req.user.id, endpoint, p256dh, auth, (req.headers["user-agent"] || "").slice(0, 300)]
  );
  res.json({ ok: true });
});

router.post("/unsubscribe", async (req, res) => {
  const endpoint = req.body?.endpoint;
  if (endpoint) {
    await query("DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2", [endpoint, req.user.id]);
  }
  res.json({ ok: true });
});

router.post("/test", async (req, res) => {
  await sendPushToUser(req.user.id, { body: "✅ تجربة: إشعارات الجهاز شغّالة." });
  res.json({ ok: true });
});

export default router;
