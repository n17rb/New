import crypto from "crypto";
import { query, currentTenant } from "../../db.js";
import { can, canAction } from "../../permissions.js";
import { sendPushToUser } from "../../utils/push.js";
import { jordanDate } from "../../utils/forecast.js";
import { cityPoint } from "../../utils/factoryGeo.js";

export { jordanDate };
export const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

// كل مسارات المصنع بس للمشترك اللي باقته «مصنع»
export function requireFactory(req, res, next) {
  if (req.tenant?.plan === "factory") return next();
  return res.status(403).json({ error: "هذا القسم لباقة المصانع." });
}

export function need(section, level = "view") {
  return (req, res, next) => {
    if (can(req.user, section, level)) return next();
    return res.status(403).json({ error: level === "edit" && can(req.user, section, "view") ? "صلاحيتك هون مشاهدة بس." : "ما عندك صلاحية لهذا القسم." });
  };
}

// أي قسم من هدول بيكفي
export function needAny(...checks) {
  return (req, res, next) => {
    if (checks.some(([s, l]) => can(req.user, s, l || "view"))) return next();
    return res.status(403).json({ error: "ما عندك صلاحية لهذا القسم." });
  };
}

export function bad(res, msg, code = 400) {
  return res.status(code).json({ error: msg });
}

export function publicToken() {
  const t = currentTenant();
  return `${t?.id || 1}-${crypto.randomBytes(9).toString("base64url")}`;
}

export async function settings(keys) {
  const r = await query("SELECT key, value FROM app_settings WHERE key = ANY($1::text[])", [keys]);
  return Object.fromEntries(r.rows.map((x) => [x.key, x.value]));
}

export async function brand() {
  const s = await settings(["brand_name", "brand_phone", "brand_logo", "brand_tagline"]);
  const t = currentTenant();
  return { name: s.brand_name || t?.name || "المصنع", phone: s.brand_phone || t?.phone || "", logo: s.brand_logo || null, tagline: s.brand_tagline || "" };
}

export async function factoryPoint() {
  const s = await settings(["shop_latitude", "shop_longitude", "factory_city"]);
  const lat = Number(s.shop_latitude), lng = Number(s.shop_longitude);
  if (Number.isFinite(lat) && Number.isFinite(lng) && lat && lng) return [lat, lng];
  return cityPoint(s.factory_city) || cityPoint("عمّان");
}

// ---------- التنبيهات: بتطلع بلوحة المالك + إشعار على تلفون المدراء ----------
export async function alert({ level = "info", kind = "general", ref = null, title, body = "", dedupe = false }) {
  if (dedupe) {
    const ex = await query("SELECT id FROM f_alerts WHERE kind = $1 AND ref_id IS NOT DISTINCT FROM $2 AND closed_at IS NULL", [kind, ref]);
    if (ex.rows[0]) return ex.rows[0].id;
  }
  const r = await query(
    "INSERT INTO f_alerts (level, kind, ref_id, title, body) VALUES ($1,$2,$3,$4,$5) RETURNING id",
    [level, kind, ref, String(title).slice(0, 200), body]
  );
  if (level === "crit" || level === "warn") {
    const users = await query("SELECT id, role, permissions, can_discount, can_delete_customer, can_edit_product_price, can_cancel_order FROM users WHERE status = 'active'");
    for (const u of users.rows) {
      const wants = kind === "expense" ? canAction(u, "approve_expense") : can(u, "f_home", "view");
      if (wants) sendPushToUser(u.id, { title, body, url: "/f/alerts", tag: `fa-${r.rows[0].id}` }).catch(() => {});
    }
  }
  return r.rows[0].id;
}

export async function closeAlerts(kind, ref, userId = null) {
  await query("UPDATE f_alerts SET closed_at = now(), closed_by = $3 WHERE kind = $1 AND ref_id IS NOT DISTINCT FROM $2 AND closed_at IS NULL", [kind, ref, userId]);
}

// ---------- كشف حساب الزبون ----------
export async function postLedger(client, { customerId, kind, amount, orderId = null, tripId = null, method = null, chequeNo = null, chequeDate = null, note = null, userId = null }) {
  const q = client ? (t, p) => client.query(t, p) : query;
  const r = await q("UPDATE f_customers SET balance = balance + $1 WHERE id = $2 RETURNING balance", [round2(amount), customerId]);
  const after = r.rows[0]?.balance ?? 0;
  await q(
    `INSERT INTO f_ledger (customer_id, kind, amount, balance_after, order_id, trip_id, method, cheque_no, cheque_date, note, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [customerId, kind, round2(amount), after, orderId, tripId, method, chequeNo, chequeDate || null, note, userId]
  );
  return Number(after);
}

// ---------- السعر: سعر الزبون الخاص أو سعر المنتج ----------
export async function priceFor(customerId, productId) {
  const r = await query(
    `SELECT COALESCE(cp.price, p.price) AS price FROM f_products p
     LEFT JOIN f_customer_prices cp ON cp.product_id = p.id AND cp.customer_id = $1 WHERE p.id = $2`,
    [customerId, productId]
  );
  return Number(r.rows[0]?.price ?? 0);
}

// ---------- رسائل الزباين ----------
const fmtTime = (iso) => {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("ar-JO-u-nu-latn", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Amman" });
};
const fmtMoney = (n) => Number(n || 0).toFixed(2);

export function trackLink(token) {
  const base = process.env.APP_URL || "https://new-1-tb2d.onrender.com";
  return token ? `${base}/t/${token}` : "";
}

export function invoiceLink(token) {
  const base = process.env.APP_URL || "https://new-1-tb2d.onrender.com";
  return token ? `${base}/t/i/${token}` : "";
}

export async function ensureTrackToken(customerId) {
  const r = await query("SELECT track_token FROM f_customers WHERE id = $1", [customerId]);
  if (r.rows[0]?.track_token) return r.rows[0].track_token;
  const tok = publicToken();
  await query("UPDATE f_customers SET track_token = $1 WHERE id = $2", [tok, customerId]);
  return tok;
}

export async function messageText(kind, d) {
  const b = await brand();
  const sign = `\n— ${b.name}${b.phone ? ` ${b.phone}` : ""}`;
  const link = d.track ? `\nتابع طلبك: ${trackLink(d.track)}` : "";
  switch (kind) {
    case "received":
      return `أهلاً ${d.customer}. وصلنا طلبك رقم ${d.order}: ${d.items}.${d.due ? ` موعد التوصيل: ${d.due}.` : ""}${link}${sign}`;
    case "scheduled":
      return `طلبك رقم ${d.order} رح يوصل ${d.day || "اليوم"} حوالي الساعة ${fmtTime(d.eta)} مع السائق ${d.driver} (${d.vehicle}).${link}${sign}`;
    case "onway":
      return `السائق ${d.driver} طلع من المصنع وهو بالطريق إلك. الوصول المتوقع حوالي ${fmtTime(d.eta)}.${link}${sign}`;
    case "delivered":
      return `تم تسليم طلبك رقم ${d.order}: ${d.items}.\nقيمة الفاتورة: ${fmtMoney(d.total)} د.أ\nالمدفوع: ${fmtMoney(d.paid)} د.أ\nرصيدك الحالي: ${fmtMoney(d.balance)} د.أ\nالفاتورة: ${invoiceLink(d.invoice)}${sign}`;
    case "delay":
      return `نعتذر منك، طلبك رقم ${d.order} رح يتأخر بسبب ${d.reason}. الموعد الجديد: ${d.when}.${d.note ? ` ${d.note}` : ""}${link}${sign}`;
    case "failed":
      return `حاولنا نوصلك طلبك رقم ${d.order} بس ما زبط (${d.reason}). رح نتواصل معك لموعد جديد.${sign}`;
    case "transfer":
      return `صار طلبك رقم ${d.order} مع السائق ${d.driver} (${d.vehicle}). الموعد ما تغيّر.${link}${sign}`;
    case "payment":
      return `وصلتنا دفعتك ${fmtMoney(d.amount)} د.أ. شكرًا إلك. رصيدك الحالي: ${fmtMoney(d.balance)} د.أ.${sign}`;
    default:
      return `${d.body}${sign}`;
  }
}

export async function queueMessage({ customerId, orderId = null, kind, data, userId = null }) {
  const body = await messageText(kind, data);
  const r = await query(
    "INSERT INTO f_messages (customer_id, order_id, kind, body, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id",
    [customerId, orderId, kind, body, userId]
  );
  return r.rows[0].id;
}

export function itemsText(items) {
  return items.map((i) => `${i.qty} كرتونة ${i.name}`).join("، ");
}

export function canSeeAllMoney(user) {
  return can(user, "f_money", "view") || can(user, "f_home", "view");
}
