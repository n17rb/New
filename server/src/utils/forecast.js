import { query } from "../db.js";

// ============================================================
// توقعات الطلبات
// النظام بيتعلم من طلبات كل زبون المسلّمة:
//  - كم قارورة بيسحب باليوم (معدل الاستهلاك)
//  - كم ضايل عنده بالبيت هلّق تقريبًا (لأقرب ربع قارورة)
//  - متى مفروض يطلب الطلب الجاي، وكم عادةً بيطلب
// ============================================================

const DAY = 86400000;
const OPEN_STATUSES = ["NEW", "READY", "IN_ROUTE", "POSTPONED"];
const MAX_WINDOW = 7; // آخر ٧ طلبات (٦ فترات) — عشان التوقع يلحق تغيّر عادة الزبون

export function jordanDate(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Amman", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function jordanHour(d = new Date()) {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Amman", hour: "numeric", hourCycle: "h23" }).format(d));
}

function dateDiffDays(a, b) {
  // a - b بالأيام، التاريخين YYYY-MM-DD
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY);
}

function addDaysToDate(date, days) {
  const d = new Date(Date.parse(`${date}T12:00:00Z`) + days * DAY);
  return d.toISOString().slice(0, 10);
}

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const quarter = (n) => Math.round(n * 4) / 4;
const half = (n) => Math.round(n * 2) / 2;

// ---------- كلام عربي ----------
export function qtyWord(n) {
  n = Math.round(n);
  if (n === 1) return "قارورة";
  if (n === 2) return "قارورتين";
  if (n >= 3 && n <= 10) return `${n} قوارير`;
  return `${n} قارورة`;
}

export function qtyRangeLabel(lo, hi) {
  if (lo === hi) return qtyWord(lo);
  return `${qtyWord(lo)} أو ${qtyWord(hi)}`;
}

const FRACTION_WORDS = { 0.25: "ربع", 0.5: "نص", 0.75: "تلت أرباع" };

export function bottlesAmountLabel(x) {
  const q = quarter(Math.max(0, x));
  if (q === 0) return "خلصت تقريبًا";
  const whole = Math.floor(q);
  const frac = Math.round((q - whole) * 100) / 100;
  if (whole === 0) return `${FRACTION_WORDS[frac]} قارورة`;
  const base = qtyWord(whole);
  return frac ? `${base} و${FRACTION_WORDS[frac]}` : base;
}

function daysWord(d) {
  const h = half(d);
  const whole = Math.floor(h);
  const hasHalf = h - whole === 0.5;
  let base;
  if (whole === 0) return "نص يوم";
  if (whole === 1) base = "يوم";
  else if (whole === 2) base = "يومين";
  else if (whole <= 10) base = `${whole} أيام`;
  else base = `${whole} يوم`;
  return hasHalf ? `${base} ونص` : base;
}

function rateLabel(ratePerDay) {
  if (ratePerDay >= 1) {
    const r = Math.round(ratePerDay * 10) / 10;
    return `${r} قارورة باليوم`;
  }
  return `قارورة كل ${daysWord(1 / ratePerDay)}`;
}

function dueLabel(lateDays) {
  if (lateDays === 0) return "اليوم";
  if (lateDays === -1) return "بكرة";
  if (lateDays === -2) return "بعد بكرة";
  if (lateDays < 0) return `بعد ${daysWord(-lateDays)}`;
  if (lateDays === 1) return "متأخر يوم";
  return `متأخر ${daysWord(lateDays)}`;
}

// ---------- الإعدادات ----------
export async function getForecastSettings() {
  const r = await query("SELECT key, value FROM app_settings WHERE key IN ('forecast_min_orders','forecast_reset_at')");
  const map = Object.fromEntries(r.rows.map((x) => [x.key, x.value]));
  const minOrders = Math.min(10, Math.max(2, Number(map.forecast_min_orders) || 3));
  return { min_orders: minOrders, reset_at: map.forecast_reset_at || null };
}

// ---------- الحساب ----------
function analyzeCustomer(events, { minOrders, now, today, resetAt }) {
  const count = events.length;
  const base = { orders_count: count, needed_orders: Math.max(0, minOrders - count) };
  if (count < minOrders || count < 2) return { ...base, status: "learning" };

  const win = events.slice(-MAX_WINDOW);
  // معدل كل فترة = اللي انشرب بين طلبين ÷ عدد الأيام بينهم
  const rates = [];
  const intervals = [];
  for (let i = 0; i < win.length - 1; i++) {
    const days = (win[i + 1].t - win[i].t) / DAY;
    if (days < 0.5) continue;
    intervals.push(days);
    rates.push(win[i].q / days);
  }
  if (rates.length === 0) return { ...base, status: "learning" };

  // الوسيط بدل المعدل: سفرة أو أسبوع غياب ما بيخرب التوقع
  const rate = median(rates);
  if (!rate || rate <= 0) return { ...base, status: "learning" };

  const mean = rates.reduce((s, x) => s + x, 0) / rates.length;
  const sd = Math.sqrt(rates.reduce((s, x) => s + (x - mean) ** 2, 0) / rates.length);
  const cv = mean > 0 ? sd / mean : 1;
  const confidence = rates.length >= 4 && cv < 0.35 ? "high" : rates.length >= 2 && cv < 0.6 ? "medium" : "low";

  const last = win[win.length - 1];
  const daysSince = Math.max(0, (now - last.t) / DAY);
  const remainingRaw = Math.max(0, last.q - rate * daysSince);
  const remaining = quarter(remainingRaw);
  const dueAt = new Date(last.t + (last.q / rate) * DAY);
  const dueDate = jordanDate(dueAt);
  const lateDays = dateDiffDays(today, dueDate);
  const avgInterval = median(intervals);

  // الكمية اللي عادةً بيطلبها (آخر ٤ طلبات)
  const recentQ = win.slice(-4).map((e) => e.q);
  const typical = Math.max(1, Math.round(median(recentQ)));
  let lo = Math.max(1, Math.min(...recentQ));
  let hi = Math.max(...recentQ);
  if (hi - lo > 2) { lo = Math.max(1, typical - 1); hi = typical + 1; }

  // المنتج اللي بيطلبه عادةً
  const productCounts = {};
  for (const e of win) for (const pid of e.products) productCounts[pid] = (productCounts[pid] || 0) + 1;
  const usualProductId = Object.entries(productCounts).sort((a, b) => b[1] - a[1])[0]?.[0];

  // «منقطع» = متأخر كثير عن عادته
  const lostAfter = Math.max(10, Math.round(avgInterval * 2.5));

  let status;
  if (lateDays > lostAfter) status = "lost";
  else if (lateDays >= 1) status = "late";
  else if (lateDays === 0) status = "today";
  else if (lateDays === -1) status = "tomorrow";
  else status = "ok";

  // بعد «تصفير المتأخرين»: اللي كان موعده قبل التصفير وما طلب من وقتها — بيروح لقائمة القدام وما بينبعتله تنبيه
  if (resetAt && (status === "late" || status === "lost") && last.t < resetAt.getTime() && dueAt < resetAt) {
    status = "stale";
  }

  return {
    ...base,
    status,
    rate_per_day: Math.round(rate * 1000) / 1000,
    rate_label: rateLabel(rate),
    avg_interval_days: Math.round(avgInterval * 10) / 10,
    interval_label: `كل ${daysWord(avgInterval)} تقريبًا`,
    last_order_at: new Date(last.t).toISOString(),
    last_qty: last.q,
    days_since_last: Math.floor(daysSince),
    remaining,
    remaining_label: bottlesAmountLabel(remainingRaw),
    days_left: Math.round((remainingRaw / rate) * 10) / 10,
    due_date: dueDate,
    late_days: lateDays,
    due_label: dueLabel(lateDays),
    qty_typical: typical,
    qty_lo: lo,
    qty_hi: hi,
    qty_label: qtyRangeLabel(lo, hi),
    usual_product_id: usualProductId ? Number(usualProductId) : null,
    confidence,
  };
}

let cache = { at: 0, data: null };

export function invalidateForecastCache() {
  cache = { at: 0, data: null };
}

// بيرجّع توقع كل الزباين النشطين (أو زبون واحد). محفوظ ٢٠ ثانية بالذاكرة.
export async function computeForecasts({ customerId = null, fresh = false } = {}) {
  if (!customerId && !fresh && cache.data && Date.now() - cache.at < 20000) return cache.data;

  const settings = await getForecastSettings();
  const now = Date.now();
  const today = jordanDate();
  const resetAt = settings.reset_at ? new Date(settings.reset_at) : null;

  const params = [];
  let customerFilter = "";
  if (customerId) {
    params.push(customerId);
    customerFilter = `AND c.id = $${params.length}`;
  }

  const [itemsResult, customersResult, productsResult] = await Promise.all([
    query(
      `SELECT o.id AS order_id, o.customer_id, o.created_at, oi.product_id, oi.quantity,
              COALESCE(p.is_returnable OR p.coupon_eligible, false) AS is_water
       FROM orders o
       JOIN customers c ON c.id = o.customer_id AND c.status = 'active'
       JOIN order_items oi ON oi.order_id = o.id
       LEFT JOIN products p ON p.id = oi.product_id
       WHERE o.status = 'DELIVERED' AND o.created_at > now() - interval '400 days' ${customerFilter}
       ORDER BY o.customer_id, o.created_at, o.id`,
      params
    ),
    query(
      `SELECT c.id, c.name, c.phone_display, c.phone_normalized, c.sequential_number, c.bottle_type,
              c.coupon_balance, c.debt_balance, c.forecast_disabled, c.forecast_snooze_until::text AS forecast_snooze_until,
              r.name AS region_name,
              EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id AND o.status = ANY($${params.length + 1}::text[])) AS has_open_order,
              EXISTS (SELECT 1 FROM customer_reminders cr WHERE cr.customer_id = c.id) AS has_schedule
       FROM customers c
       LEFT JOIN LATERAL (SELECT region_id FROM customer_locations WHERE customer_id = c.id ORDER BY id LIMIT 1) l ON true
       LEFT JOIN regions r ON r.id = l.region_id
       WHERE c.status = 'active' ${customerFilter}`,
      [...params, OPEN_STATUSES]
    ),
    query("SELECT id, name, (is_returnable OR coupon_eligible) AS is_water FROM products"),
  ]);

  const productNames = Object.fromEntries(productsResult.rows.map((p) => [p.id, p.name]));
  // لو المحل معلّم منتجات المي، منحسب قوارير المي بس. غير هيك كل المنتجات.
  const shopHasWater = productsResult.rows.some((p) => p.is_water);

  // طلبات كل زبون → «تسليمات» (طلبين بنفس الـ١٢ ساعة بيعتبروا طلب واحد)
  const eventsByCustomer = new Map();
  const orders = new Map();
  for (const row of itemsResult.rows) {
    if (shopHasWater && !row.is_water) continue;
    let o = orders.get(row.order_id);
    if (!o) {
      o = { customer_id: row.customer_id, t: new Date(row.created_at).getTime(), q: 0, products: new Set() };
      orders.set(row.order_id, o);
    }
    o.q += Number(row.quantity) || 0;
    if (row.product_id) o.products.add(row.product_id);
  }
  for (const o of orders.values()) {
    if (o.q <= 0) continue;
    const list = eventsByCustomer.get(o.customer_id) || [];
    const prev = list[list.length - 1];
    if (prev && o.t - prev.t < DAY / 2) {
      prev.q += o.q;
      for (const p of o.products) prev.products.add(p);
    } else {
      list.push({ t: o.t, q: o.q, products: new Set(o.products) });
    }
    eventsByCustomer.set(o.customer_id, list);
  }

  const results = [];
  for (const c of customersResult.rows) {
    const events = eventsByCustomer.get(c.id) || [];
    const f = analyzeCustomer(events, { minOrders: settings.min_orders, now, today, resetAt });
    const baseStatus = f.status;
    let status = baseStatus;
    if (c.forecast_disabled) status = "disabled";
    else if (c.has_open_order) status = "ordered";
    else if (c.forecast_snooze_until && c.forecast_snooze_until >= today && baseStatus !== "learning") status = "snoozed";

    results.push({
      customer_id: c.id,
      name: c.name,
      phone_display: c.phone_display,
      phone_normalized: c.phone_normalized,
      sequential_number: c.sequential_number,
      bottle_type: c.bottle_type,
      region_name: c.region_name,
      coupon_balance: c.coupon_balance,
      debt_balance: Number(c.debt_balance || 0),
      has_schedule: c.has_schedule,
      snooze_until: c.forecast_snooze_until,
      ...f,
      usual_product_name: f.usual_product_id ? productNames[f.usual_product_id] || null : null,
      base_status: baseStatus,
      status,
    });
  }

  const data = { today, settings, customers: results };
  if (!customerId) cache = { at: Date.now(), data };
  return data;
}

// تجميع للعرض: اليوم، بكرة، متأخرين، منقطعين...
export function groupForecasts(data) {
  const groups = { today: [], tomorrow: [], late: [], lost: [], stale: [], snoozed: [], ordered: [] };
  let learning = 0;
  let tracked = 0;
  for (const f of data.customers) {
    if (f.base_status === "learning") { learning++; continue; }
    if (f.status === "disabled") continue;
    tracked++;
    if (groups[f.status]) groups[f.status].push(f);
  }
  groups.late.sort((a, b) => a.late_days - b.late_days);
  groups.lost.sort((a, b) => a.late_days - b.late_days);
  groups.stale.sort((a, b) => a.late_days - b.late_days);
  groups.today.sort((a, b) => a.remaining - b.remaining);
  return {
    today: data.today,
    settings: data.settings,
    learning_count: learning,
    tracked_count: tracked,
    expected_bottles_today: groups.today.reduce((s, f) => s + f.qty_typical, 0),
    ...groups,
  };
}

export { addDaysToDate };
