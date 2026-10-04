import { query } from "../db.js";

// مكتبة web-push بتنحمّل بشكل آمن: لو مش موجودة لأي سبب، السيرفر بيضل شغّال
// والإشعارات بالتطبيق بتضل توصل — بس إشعارات الجهاز بتتوقف.
let webpush = null;
try {
  webpush = (await import("web-push")).default;
} catch (err) {
  console.error("⚠️ مكتبة web-push غير متوفرة — إشعارات الجهاز معطّلة:", err.message);
}

let vapidReadyPromise = null;

async function loadOrCreateVapidKeys() {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  }

  const existing = await query("SELECT key, value FROM app_settings WHERE key IN ('vapid_public_key','vapid_private_key')");
  const map = Object.fromEntries(existing.rows.map((r) => [r.key, r.value]));
  if (map.vapid_public_key && map.vapid_private_key) {
    return { publicKey: map.vapid_public_key, privateKey: map.vapid_private_key };
  }

  // أول مرة: نولّد المفاتيح ونحفظها بقاعدة البيانات (ما بتتغير بعدين)
  const keys = webpush.generateVAPIDKeys();
  await query(
    `INSERT INTO app_settings (key, value) VALUES ('vapid_public_key', $1), ('vapid_private_key', $2)
     ON CONFLICT (key) DO NOTHING`,
    [keys.publicKey, keys.privateKey]
  );
  // لو سيرفر ثاني سبقنا بنفس اللحظة، ناخذ المحفوظ
  const saved = await query("SELECT key, value FROM app_settings WHERE key IN ('vapid_public_key','vapid_private_key')");
  const savedMap = Object.fromEntries(saved.rows.map((r) => [r.key, r.value]));
  return { publicKey: savedMap.vapid_public_key, privateKey: savedMap.vapid_private_key };
}

export async function getVapidPublicKey() {
  if (!webpush) return null;
  if (!vapidReadyPromise) {
    vapidReadyPromise = loadOrCreateVapidKeys()
      .then((keys) => {
        webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:admin@jawharat-rabieh.app", keys.publicKey, keys.privateKey);
        return keys.publicKey;
      })
      .catch((err) => {
        vapidReadyPromise = null;
        throw err;
      });
  }
  return vapidReadyPromise;
}

export function isPushAvailable() {
  return !!webpush;
}

// يبعث إشعار لكل أجهزة المستخدم. الاشتراكات المنتهية بتنحذف لحالها.
export async function sendPushToUser(userId, { title = "جوهرة الرابية", body, url = "/notifications", tag } = {}) {
  if (!webpush || !userId || !body) return;
  await getVapidPublicKey();

  const subs = await query("SELECT * FROM push_subscriptions WHERE user_id = $1", [userId]);
  const payload = JSON.stringify({ title, body, url, tag: tag || `n-${Date.now()}` });

  await Promise.all(
    subs.rows.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
          { TTL: 60 * 60 * 24, urgency: "high" }
        );
        await query("UPDATE push_subscriptions SET last_used_at = now() WHERE id = $1", [s.id]);
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          await query("DELETE FROM push_subscriptions WHERE id = $1", [s.id]);
        } else {
          console.error("push error:", err.statusCode || "", err.message);
        }
      }
    })
  );
}
