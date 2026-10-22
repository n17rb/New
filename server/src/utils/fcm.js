import crypto from "crypto";

// ============================================================
// إشعارات تطبيق الأندرويد (Firebase Cloud Messaging) — بدون مكتبات زيادة
// المفتاح: متغير FCM_SERVICE_ACCOUNT بـRender (محتوى ملف الـJSON من Firebase، أو نفسه base64)
// ============================================================
let creds;
function getCreds() {
  if (creds !== undefined) return creds;
  const raw = process.env.FCM_SERVICE_ACCOUNT || "";
  try {
    const txt = raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
    const j = JSON.parse(txt);
    creds = j.client_email && j.private_key && j.project_id ? j : null;
  } catch { creds = null; }
  if (!creds && raw) console.error("⚠️ FCM_SERVICE_ACCOUNT مش صحيح — إشعارات التطبيق معطّلة");
  return creds;
}
export const fcmEnabled = () => !!getCreds();

const b64url = (b) => Buffer.from(b).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
let cached = { token: null, exp: 0 };
async function accessToken() {
  const c = getCreds();
  if (!c) return null;
  if (cached.token && Date.now() < cached.exp - 60000) return cached.token;
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = b64url(JSON.stringify({ iss: c.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: c.token_uri || "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const sig = b64url(crypto.createSign("RSA-SHA256").update(`${head}.${body}`).sign(c.private_key));
  const r = await fetch(c.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${head}.${body}.${sig}` }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(`FCM auth: ${j.error || r.status}`);
  cached = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return cached.token;
}

// بيرجّع "gone" إذا التوكن انتهى (التطبيق انمسح) عشان نشيله
export async function sendFcm(token, { title, body, url = "/", tag }) {
  const c = getCreds();
  if (!c) return "off";
  const at = await accessToken();
  const r = await fetch(`https://fcm.googleapis.com/v1/projects/${c.project_id}/messages:send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${at}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        token,
        notification: { title, body },
        data: { url: String(url || "/"), tag: String(tag || "") },
        android: { priority: "HIGH", notification: { channel_id: "orders", sound: "default", tag: tag || undefined, default_vibrate_timings: true } },
      },
    }),
  });
  if (r.ok) return "ok";
  const j = await r.json().catch(() => ({}));
  const code = j?.error?.details?.find?.((d) => d.errorCode)?.errorCode || j?.error?.status;
  if (r.status === 404 || code === "UNREGISTERED" || code === "INVALID_ARGUMENT") return "gone";
  console.error("fcm error:", r.status, code || "");
  return "err";
}
