import crypto from "crypto";
import { query, currentTenant } from "../db.js";
import { computeForecasts, groupForecasts, jordanDate, jordanHour } from "./forecast.js";
import { sendPushToUser } from "./push.js";
import { can } from "../permissions.js";

// ============================================================
// واتساب التلقائي عبر WhatsApp Cloud API (الرسمي من Meta)
// الرسالة اللي بتنبعت للزبون لازم تكون «قالب» (Template) معتمد من Meta، فيه متغيرات:
//   {{1}} اسم الزبون   {{2}} اسم المحل   {{3}} الكمية اللي بياخذها عادةً
// ============================================================
const KEYS = ["wa_enabled", "wa_queue_token", "wa_device_user", "wa_coupons_auto", "wa_forecast_auto", "wa_provider", "wa_phone_id", "wa_token", "wa_template", "wa_lang", "wa_hour", "wa_last_run"];
const GRAPH = "https://graph.facebook.com/v21.0";

export async function getWaSettings() {
  const r = await query("SELECT key, value FROM app_settings WHERE key = ANY($1::text[])", [KEYS]);
  const m = Object.fromEntries(r.rows.map((x) => [x.key, x.value]));
  const hour = Number(m.wa_hour);
  return {
    enabled: m.wa_enabled === "1",
    // meta = WhatsApp Cloud API مباشرة · d360 = عن طريق 360dialog (بتسمح تضل على تطبيق واتساب أعمال بنفس الرقم)
    provider: m.wa_provider === "d360" ? "d360" : "meta",
    phone_id: m.wa_phone_id || "",
    token: m.wa_token || "",
    template: m.wa_template || "",
    lang: m.wa_lang || "ar",
    hour: Number.isInteger(hour) && hour >= 5 && hour <= 12 ? hour : 7,
    last_run: m.wa_last_run || null,
    device_user: m.wa_device_user || null,
    coupons_auto: m.wa_coupons_auto === "1",
    // تذكير التوقعات من موبايل الأندرويد — مطفي إلا إذا فعّلته
    forecast_auto: m.wa_forecast_auto === "1",
  };
}

export async function saveWaSettings(patch) {
  for (const [k, v] of Object.entries(patch)) {
    if (!KEYS.includes(k) || v === undefined) continue;
    await query(
      `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, now()) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()`,
      [k, String(v)]
    );
  }
}

export const isConfigured = (s) => !!(s.token && s.template && (s.provider === "d360" || s.phone_id));

// إرسال قالب لرقم واحد. بيرجّع {ok, id} أو {ok:false, error}
export async function sendTemplate(s, to, params) {
  const body = {
    messaging_product: "whatsapp",
    to: String(to).replace(/\D/g, ""),
    type: "template",
    template: {
      name: s.template,
      language: { code: s.lang || "ar" },
      components: [{ type: "body", parameters: params.map((text) => ({ type: "text", text: String(text || "-").slice(0, 200) })) }],
    },
  };
  try {
    const res = s.provider === "d360"
      ? await fetch("https://waba-v2.360dialog.io/messages", {
          method: "POST",
          headers: { "D360-API-KEY": s.token, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
      : await fetch(`${GRAPH}/${encodeURIComponent(s.phone_id)}/messages`, {
          method: "POST",
          headers: { Authorization: `Bearer ${s.token}`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data?.error?.error_user_msg || data?.error?.message || `HTTP ${res.status}` };
    return { ok: true, id: data?.messages?.[0]?.id || null };
  } catch (err) {
    return { ok: false, error: `ما قدرت أوصل لواتساب: ${err.message}` };
  }
}

// الزباين اللي مفروض يطلبوا اليوم (وما طلبوا لسا) — اللي بيوصلهم التذكير
export async function forecastRecipients() {
  const groups = groupForecasts(await computeForecasts({ fresh: true }));
  const list = groups.today.filter((f) => f.phone_normalized);
  if (!list.length) return [];
  const off = new Set((await query("SELECT id FROM customers WHERE wa_forecast_off = true AND id = ANY($1::int[])", [list.map((f) => f.customer_id)])).rows.map((r) => r.id));
  const sent = new Set((await query("SELECT customer_id FROM wa_messages WHERE kind = 'forecast' AND sent_on = $1 AND status = 'sent'", [jordanDate()])).rows.map((r) => r.customer_id));
  return list.map((f) => ({
    customer_id: f.customer_id, name: f.name, phone: f.phone_normalized, phone_display: f.phone_display,
    qty_label: f.qty_label, off: off.has(f.customer_id), sent_today: sent.has(f.customer_id),
  }));
}

// الاسم الأول (أو «أبو فلان») عشان الرسالة تكون أدفى
function firstName(name) {
  const parts = String(name || "").trim().split(/\s+/);
  return ["أبو", "ابو", "أم", "ام"].includes(parts[0]) ? parts.slice(0, 2).join(" ") : parts[0] || "";
}

// إرسال تذكيرات اليوم (مرة وحدة باليوم)
export async function runForecastWhatsapp({ force = false } = {}) {
  const s = await getWaSettings();
  if (!s.enabled || !isConfigured(s)) return { skipped: "off" };
  const today = jordanDate();
  if (!force) {
    const h = jordanHour();
    if (h < s.hour || s.last_run === today) return { skipped: "time" };
    // السيرفر كان طافي الصبح؟ ما بنبعت تذكير «الصبح» بنص النهار
    if (h > s.hour + 3) { await saveWaSettings({ wa_last_run: today }); return { skipped: "late" }; }
  }
  await saveWaSettings({ wa_last_run: today });

  const shop = currentTenant()?.name || "";
  const recipients = (await forecastRecipients()).filter((r) => !r.off && !r.sent_today);
  let ok = 0;
  const failed = [];
  for (const r of recipients) {
    const out = await sendTemplate(s, r.phone, [firstName(r.name), shop, r.qty_label || "مي"]);
    await query(
      `INSERT INTO wa_messages (customer_id, phone, kind, sent_on, status, wa_id, error) VALUES ($1,$2,'forecast',$3,$4,$5,$6)
       ON CONFLICT DO NOTHING`,
      [r.customer_id, r.phone, today, out.ok ? "sent" : "failed", out.id || null, out.ok ? null : out.error]
    );
    if (out.ok) ok++;
    else failed.push({ name: r.name, error: out.error });
  }

  // ملخص للمدير
  if (recipients.length) {
    const users = (await query("SELECT id, role, permissions FROM users WHERE status = 'active'")).rows.filter((u) => u.role === "super_admin" || can(u, "orders", "view"));
    const msg = `📤 انبعت تذكير واتساب لـ${ok} زبون مفروض يطلبوا اليوم${failed.length ? ` · ما وصل لـ${failed.length} (${failed[0].error})` : ""}`;
    for (const u of users) {
      await query("INSERT INTO notifications (type, message, target_user_id) VALUES ('WA_FORECAST', $1, $2)", [msg, u.id]);
      sendPushToUser(u.id, { title: "واتساب التوقعات", body: msg, url: "/settings/whatsapp" }).catch(() => {});
    }
  }
  return { sent: ok, failed: failed.length, total: recipients.length, errors: failed.slice(0, 5) };
}

// ============================================================
// جهاز أندرويد بيبعت من تطبيق واتساب أعمال نفسه (أتمتة على الموبايل)
// النظام بيجهّز «الدور»: مين ينبعتله اليوم ونص الرسالة، والموبايل بيسحب واحد واحد
// ============================================================
const DEFAULT_FORECAST_TEXT = "مرحبا {الاسم} 🌊\nمعك {المحل}.\nحسب حسابنا المي عندك قربت تخلص 💧\nبدك نجيبلك {الكمية} اليوم؟";

export async function getQueueToken({ regenerate = false } = {}) {
  const r = await query("SELECT value FROM app_settings WHERE key = 'wa_queue_token'");
  if (r.rows[0]?.value && !regenerate) return r.rows[0].value;
  const tenantId = currentTenant()?.id || 1;
  const token = `${tenantId}-${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
  await saveWaSettings({ wa_queue_token: token });
  return token;
}

async function forecastText() {
  const r = await query("SELECT value FROM app_settings WHERE key = 'message_templates'");
  try {
    const t = JSON.parse(r.rows[0]?.value || "{}").forecast_reminder;
    if (typeof t === "string" && t.trim()) return t;
  } catch {}
  return DEFAULT_FORECAST_TEXT;
}

// الرسايل اللي لسا ما انبعتت اليوم (للي مش مستثنيين)
export async function forecastQueue() {
  const shop = currentTenant()?.name || "";
  const tpl = await forecastText();
  const list = (await forecastRecipients()).filter((r) => !r.off && !r.sent_today);
  return list.map((r) => {
    const text = tpl.replaceAll("{الاسم}", firstName(r.name)).replaceAll("{المحل}", shop).replaceAll("{الكمية}", r.qty_label || "مي");
    return { customer_id: r.customer_id, name: r.name, phone: r.phone, text, url: `https://wa.me/${r.phone}?text=${encodeURIComponent(text)}` };
  });
}

export async function markQueueSent(customerId, phone) {
  await query(
    `INSERT INTO wa_messages (customer_id, phone, kind, sent_on, status, wa_id) VALUES ($1,$2,'forecast',$3,'sent','android') ON CONFLICT DO NOTHING`,
    [customerId, phone, jordanDate()]
  );
  // الرسالة الجاية بعد وقت عشوائي (١٫٥–٦ دقايق) — عشان تبين طبيعية مش برنامج
  const gap = 90 + Math.floor(Math.random() * 271);
  await query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ('wa_forecast_next_at', $1, now())
     ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = now()`,
    [new Date(Date.now() + gap * 1000).toISOString()]
  );
}

// ============================================================
// صندوق الرسايل (للأندرويد): رسايل بتنعمل وقت الحدث وبتستنى الموبايل يبعتها
// ============================================================
const DEFAULT_COUPONS_ADDED = "✨ أهلًا {الاسم}\nانضافلك {الكوبونات} 🎫\nرصيدك صار {الرصيد}\n{الباقي}\n\nتابع رصيدك أول بأول:\n{الرابط}\n\n{المحل} 💧";

export function couponsWord(n) {
  n = Number(n) || 0;
  if (n === 0) return "ما ضل عندك كوبونات";
  if (n === 1) return "كوبون واحد";
  if (n === 2) return "كوبونين";
  if (n >= 3 && n <= 10) return `${n} كوبونات`;
  return `${n} كوبون`;
}

async function templateText(key, fallback) {
  const r = await query("SELECT value FROM app_settings WHERE key = 'message_templates'");
  try {
    const t = JSON.parse(r.rows[0]?.value || "{}")[key];
    if (typeof t === "string" && t.trim()) return t;
  } catch {}
  return fallback;
}

// عنوان التطبيق (عشان رابط رصيد الكوبونات) — بنحفظه من آخر طلب إجا من التطبيق
export async function appOrigin(reqOrigin) {
  const ok = typeof reqOrigin === "string" && /^https?:\/\/[^/]+$/.test(reqOrigin) && !/localhost|127\.0\.0\.1/.test(reqOrigin);
  if (ok) {
    await query(`INSERT INTO app_settings (key, value, updated_at) VALUES ('app_origin', $1, now()) ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = now()`, [reqOrigin]).catch(() => {});
    return reqOrigin;
  }
  return (await query("SELECT value FROM app_settings WHERE key = 'app_origin'")).rows[0]?.value || null;
}

// رسايل الكوبونات التلقائية من موبايل الأندرويد: لازم تكون مشغّلة (مفتاح بصفحة واتساب تلقائي)
// إذا مطفية: الكابتن بيبعت بإيده زي قبل (زر واتساب)
async function androidOn() {
  const r = await query("SELECT key, value FROM app_settings WHERE key IN ('wa_queue_token','wa_coupons_auto')");
  const m = Object.fromEntries(r.rows.map((x) => [x.key, x.value]));
  return !!m.wa_queue_token && m.wa_coupons_auto === "1";
}

// تنبيه فوري لموبايل الأندرويد: إشعار من تطبيق موج نفسه لحساب «جهاز الإرسال» ← MacroDroid بيشتغل فورًا
export async function pingDevice() {
  const h = jordanHour();
  void h;
  const uid = Number((await query("SELECT value FROM app_settings WHERE key = 'wa_device_user'")).rows[0]?.value) || 0;
  if (!uid) return;
  sendPushToUser(uid, { title: "موج واتساب", body: "📤 رسالة واتساب جديدة بالدور", url: "/settings/whatsapp", tag: "wa-queue" })
    .catch((e) => console.error("push:", e.message));
}

// رسايل الكوبونات: إذا صار بيع باقة وبعده تسليم لنفس الزبون والرسالة لسا ما انبعتت،
// بندمجهم برسالة وحدة (أسرع للزبون وأأمن لواتساب من رسالتين ورا بعض)
const DEFAULT_COUPONS_USED = "أهلًا {الاسم} 💧\nوصلك طلبك وانخصم {المخصوم} 🎫\nرصيدك صار {الرصيد}\n\nتابع رصيدك:\n{الرابط}\n\n{المحل}";
async function couponText(c, meta, base) {
  const link = meta.walletToken && base ? `${base}/w/${meta.walletToken}` : "";
  const shop = currentTenant()?.name || "";
  const unpaid = meta.unpaid > 0 ? `باقي من ثمن الباقة: ${Number(meta.unpaid).toFixed(2)} دينار` : "";
  let text;
  if (meta.added > 0 && meta.used > 0) {
    text = [
      `✨ أهلًا ${firstName(c.name)}`,
      `انضافلك ${couponsWord(meta.added)} 🎫`,
      `ووصلك طلبك وانخصم ${couponsWord(meta.used)}`,
      `رصيدك صار ${couponsWord(c.coupon_balance)}`,
      unpaid,
      link ? `\nتابع رصيدك أول بأول:\n${link}` : "",
      shop ? `\n${shop} 💧` : "",
    ].filter(Boolean).join("\n");
  } else if (meta.added > 0) {
    const tpl = await templateText("coupons_added", DEFAULT_COUPONS_ADDED);
    text = tpl.replaceAll("{الاسم}", firstName(c.name)).replaceAll("{الكوبونات}", couponsWord(meta.added)).replaceAll("{الباقة}", "")
      .replaceAll("{الرصيد}", couponsWord(c.coupon_balance)).replaceAll("{الباقي}", unpaid).replaceAll("{الرابط}", link).replaceAll("{المحل}", shop);
  } else {
    const tpl = await templateText("coupons_used", DEFAULT_COUPONS_USED);
    text = tpl.replaceAll("{الاسم}", firstName(c.name)).replaceAll("{المخصوم}", couponsWord(meta.used))
      .replaceAll("{الرصيد}", couponsWord(c.coupon_balance)).replaceAll("{الرابط}", link).replaceAll("{المحل}", shop);
  }
  return text.replace(/\n{3,}/g, "\n\n").trim();
}
async function queueCouponEvent(customerId, delta, walletToken, origin) {
  if (!(await androidOn())) return false;
  const c = (await query("SELECT name, phone_normalized, coupon_balance FROM customers WHERE id = $1", [customerId])).rows[0];
  if (!c?.phone_normalized) return false;
  const base = await appOrigin(origin);
  const prev = (await query(
    `SELECT id, meta FROM wa_outbox WHERE customer_id = $1 AND status = 'pending' AND kind IN ('coupons_added','coupons_used','coupons_combo')
       AND created_at > now() - interval '15 minutes' ORDER BY id DESC LIMIT 1`,
    [customerId]
  )).rows[0];
  const old = prev?.meta || {};
  const meta = {
    added: (old.added || 0) + (delta.added || 0),
    used: (old.used || 0) + (delta.used || 0),
    unpaid: (old.unpaid || 0) + (delta.unpaid || 0),
    walletToken: walletToken || old.walletToken || null,
  };
  const kind = meta.added > 0 && meta.used > 0 ? "coupons_combo" : meta.added > 0 ? "coupons_added" : "coupons_used";
  const text = await couponText(c, meta, base);
  if (prev) {
    await query("UPDATE wa_outbox SET text = $1, kind = $2, meta = $3 WHERE id = $4 AND status = 'pending'", [text, kind, meta, prev.id]);
  } else {
    await query("INSERT INTO wa_outbox (customer_id, phone, kind, text, meta) VALUES ($1,$2,$3,$4,$5)", [customerId, c.phone_normalized, kind, text, meta]);
  }
  await pingDevice();
  return true;
}

// «انضافلك كوبونات»: بيع باقة أو إضافة
export async function queueCouponsAdded({ customerId, added, unpaid = 0, walletToken = null, origin = null }) {
  if (!(added > 0)) return false;
  return queueCouponEvent(customerId, { added, unpaid }, walletToken, origin);
}

// «انخصم كوبون»: بعد التسليم بكوبونات إلكترونية
export async function queueCouponsUsed({ customerId, used, walletToken = null, origin = null }) {
  if (!(used > 0)) return false;
  return queueCouponEvent(customerId, { used }, walletToken, origin);
}

// «تصحيح رصيد الكوبونات»: بعد تعديل يدوي (مثلًا انخصم زيادة بالغلط)
// إذا موبايل الأندرويد شغّال بتنحط بالدور، وإلا بنرجّع النص والرقم عشان تنبعت بإيدك
export async function couponBalanceMessage({ customerId, walletToken = null, origin = null }) {
  const c = (await query("SELECT name, phone_normalized, coupon_balance FROM customers WHERE id = $1", [customerId])).rows[0];
  if (!c) return null;
  const base = await appOrigin(origin);
  const text = [
    `أهلًا ${firstName(c.name)} 💧`,
    "صحّحنا رصيد كوبوناتك ✅",
    `رصيدك هلّق ${couponsWord(c.coupon_balance)} 🎫`,
    walletToken && base ? `\nتابع رصيدك:\n${base}/w/${walletToken}` : "",
    currentTenant()?.name ? `\n${currentTenant().name}` : "",
  ].filter(Boolean).join("\n");
  return { text, phone: c.phone_normalized, balance: c.coupon_balance };
}
export async function queueCouponFix({ customerId, walletToken = null, origin = null }) {
  const m = await couponBalanceMessage({ customerId, walletToken, origin });
  if (!m?.phone) return { queued: false, ...m };
  if (await androidOn()) {
    await query("INSERT INTO wa_outbox (customer_id, phone, kind, text) VALUES ($1,$2,'coupons_fix',$3)", [customerId, m.phone, m.text]);
    await pingDevice();
    return { queued: true, ...m };
  }
  return { queued: false, ...m };
}

// الرسالة الجاية للموبايل: أول إشي الصندوق (فورًا، أي ساعة)، وبعدين تذكير التوقعات (بوقته الصبح)
export async function nextQueued() {
  const h = jordanHour();
  {
    // رسايل الكوبونات بتنبعت أي ساعة (حتى بالليل) — الزبون لازم يعرف فورًا
    await query("UPDATE wa_outbox SET status = 'expired' WHERE status = 'pending' AND created_at < now() - interval '36 hours'");
    const o = (await query("SELECT * FROM wa_outbox WHERE status = 'pending' ORDER BY created_at LIMIT 1")).rows[0];
    if (o) {
      const left = (await query("SELECT COUNT(*)::int AS n FROM wa_outbox WHERE status = 'pending'")).rows[0].n;
      return { source: "outbox", id: o.id, customer_id: o.customer_id, phone: o.phone, text: o.text, url: `https://wa.me/${o.phone}?text=${encodeURIComponent(o.text)}`, left };
    }
  }
  const s = await getWaSettings();
  if (s.forecast_auto && h >= s.hour && h < s.hour + 5) {
    // فاصل عشوائي بين رسايل التوقعات (بينحدد بعد كل رسالة)
    const nextAt = (await query("SELECT value FROM app_settings WHERE key = 'wa_forecast_next_at'")).rows[0]?.value;
    if (nextAt && Date.now() < new Date(nextAt).getTime()) return null;
    const list = await forecastQueue();
    if (list[0]) return { source: "forecast", id: list[0].customer_id, ...list[0], left: list.length };
  }
  return null;
}

export async function markOutboxSent(id) {
  await query("UPDATE wa_outbox SET status = 'sent', sent_at = now() WHERE id = $1 AND status = 'pending'", [id]);
}
