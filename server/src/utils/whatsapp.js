import { query, currentTenant } from "../db.js";
import { computeForecasts, groupForecasts, jordanDate, jordanHour } from "./forecast.js";
import { sendPushToUser } from "./push.js";
import { can } from "../permissions.js";

// ============================================================
// واتساب التلقائي عبر WhatsApp Cloud API (الرسمي من Meta)
// الرسالة اللي بتنبعت للزبون لازم تكون «قالب» (Template) معتمد من Meta، فيه متغيرات:
//   {{1}} اسم الزبون   {{2}} اسم المحل   {{3}} الكمية اللي بياخذها عادةً
// ============================================================
const KEYS = ["wa_enabled", "wa_provider", "wa_phone_id", "wa_token", "wa_template", "wa_lang", "wa_hour", "wa_last_run"];
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
