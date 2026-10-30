import { Router } from "express";
import { query, logActivity } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { gate, can } from "../permissions.js";

const router = Router();
router.use(requireAuth, gate("cash"));

// نرجّع التاريخ كنص YYYY-MM-DD عشان ما يتزحلق يوم بسبب فرق التوقيت
const ENTRY_COLUMNS = `id, period_id, to_char(entry_date, 'YYYY-MM-DD') AS entry_date,
  sales_amount, expense_amount, expense_items, notes, meter_reading, bottles_total, bottles_delivery,
  created_by, created_at, updated_at`;

async function getOrCreateOpenPeriod() {
  const openResult = await query("SELECT * FROM cash_periods WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1");
  if (openResult.rows[0]) return openResult.rows[0];
  const created = await query("INSERT INTO cash_periods DEFAULT VALUES RETURNING *");
  return created.rows[0];
}

function getJordanToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Amman", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function isValidDateString(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function shiftDate(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const dayDiff = (a, b) => Math.round((new Date(`${a}T00:00:00Z`) - new Date(`${b}T00:00:00Z`)) / 86400000);
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m: 1..12

// يرجّع { value } أو { error }
function parseAmount(raw, label) {
  if (raw === undefined || raw === null || raw === "") return { value: 0 };
  const num = Number(raw);
  if (!Number.isFinite(num)) return { error: `قيمة ${label} غير صحيحة.` };
  if (num < 0) return { error: `${label} ما بتكون بالسالب.` };
  if (num > 99999999) return { error: `قيمة ${label} كبيرة كثير.` };
  return { value: Math.round(num * 100) / 100 };
}

// رقم اختياري: فاضي = null (يعني «احسبه لحاله»)
function parseOptionalInt(raw, label, max = 100000) {
  if (raw === undefined || raw === null || raw === "") return { value: null };
  const num = Number(raw);
  if (!Number.isFinite(num) || num < 0 || num > max) return { error: `قيمة ${label} غير صحيحة.` };
  return { value: Math.round(num) };
}
function parseOptionalNum(raw, label) {
  if (raw === undefined || raw === null || raw === "") return { value: null };
  const num = Number(raw);
  if (!Number.isFinite(num) || num < 0 || num > 1e11) return { error: `قيمة ${label} غير صحيحة.` };
  return { value: Math.round(num * 1000) / 1000 };
}

function validateDate(date) {
  if (!isValidDateString(date)) return "التاريخ غير صحيح.";
  if (date > getJordanToday()) return "ما بتقدر تسجّل يوم بالمستقبل.";
  return null;
}

// إذا انعدّل يوم تابع لفترة مؤرشفة، نحدّث أرقامها النهائية بالأرشيف
async function refreshClosedPeriodTotals(periodId) {
  await query(
    `UPDATE cash_periods p SET final_sales = t.s, final_expenses = t.e, final_cash = t.s - t.e
     FROM (SELECT COALESCE(SUM(sales_amount), 0) AS s, COALESCE(SUM(expense_amount), 0) AS e
           FROM cash_entries WHERE period_id = $1) t
     WHERE p.id = $1 AND p.ended_at IS NOT NULL`,
    [periodId]
  );
}

// يوم جديد بتاريخ قديم: لأي فترة بيتبع؟
// القاعدة: اليوم بيروح للفترة اللي تواريخها بتغطيه — لو كان بشهر مؤرشف، بيضل بالأرشيف
// وما بينضاف أبدًا لمبيعات الفترة الحالية.
async function periodForNewDate(date) {
  const open = await getOrCreateOpenPeriod();
  const r = await query(
    `SELECT p.id, p.ended_at, to_char((p.started_at AT TIME ZONE 'Asia/Amman')::date, 'YYYY-MM-DD') AS start_date,
            to_char(MIN(e.entry_date), 'YYYY-MM-DD') AS min_date, to_char(MAX(e.entry_date), 'YYYY-MM-DD') AS max_date
     FROM cash_periods p LEFT JOIN cash_entries e ON e.period_id = p.id
     GROUP BY p.id ORDER BY p.started_at ASC`
  );
  const periods = r.rows;
  const closed = periods.filter((p) => p.ended_at);
  const openRow = periods.find((p) => p.id === open.id) || { min_date: null, start_date: getJordanToday() };

  const month = date.slice(0, 7);
  // ١) فترة مؤرشفة أيامها بتغطي التاريخ
  const covering = closed.filter((p) => p.min_date && p.min_date <= date && date <= p.max_date);
  if (covering.length) return covering[covering.length - 1].id;
  // ٢) التاريخ ضمن أيام الفترة الحالية، أو بعد بدايتها
  if (openRow.min_date && date >= openRow.min_date) return open.id;
  if (date >= openRow.start_date) return open.id;
  // ٣) نفس الشهر: لو شهره مؤرشف بيروح لأرشيفه، ولو شهر الفترة الحالية بيروح إلها
  const sameMonth = closed.filter((p) => p.max_date && (p.max_date.slice(0, 7) === month || p.min_date.slice(0, 7) === month));
  if (sameMonth.length) return sameMonth[sameMonth.length - 1].id;
  if (month === openRow.start_date.slice(0, 7) || (openRow.min_date && month === openRow.min_date.slice(0, 7))) return open.id;
  // ٤) شهر قديم ما إله أي سجل: منعمله أرشيف لحاله عشان ما يختلط بالشهر الحالي
  const [y, m] = month.split("-").map(Number);
  const last = `${month}-${String(daysInMonth(y, m)).padStart(2, "0")}`;
  const created = await query(
    `INSERT INTO cash_periods (started_at, ended_at) VALUES (($1::date)::timestamp AT TIME ZONE 'Asia/Amman', ($2::date + 1)::timestamp AT TIME ZONE 'Asia/Amman' - interval '1 second')
     RETURNING id`,
    [`${month}-01`, last]
  );
  return created.rows[0].id;
}

// ---------------- القوارير والعداد ----------------
async function bottleSettings() {
  const r = await query("SELECT key, value FROM app_settings WHERE key IN ('meter_unit', 'bottle_liters')");
  const m = Object.fromEntries(r.rows.map((x) => [x.key, x.value]));
  const liters = Number(m.bottle_liters);
  return { meter_unit: m.meter_unit === "m3" ? "m3" : "liter", bottle_liters: Number.isFinite(liters) && liters > 0 ? liters : 19 };
}

// قوارير التوصيل لكل يوم (من التسليمات الفعلية بالرحلات): بس المنتجات اللي هي قوارير بترجع
async function deliveryBottlesByDate(from, to) {
  const r = await query(
    `SELECT to_char((ts.delivered_at AT TIME ZONE 'Asia/Amman')::date, 'YYYY-MM-DD') AS d, COALESCE(SUM(oi.quantity), 0)::int AS n
     FROM trip_stops ts
     JOIN orders o ON o.id = ts.order_id AND o.status = 'DELIVERED'
     JOIN order_items oi ON oi.order_id = o.id
     JOIN products p ON p.id = oi.product_id AND p.is_returnable = true
     WHERE ts.delivered_at IS NOT NULL
       AND (ts.delivered_at AT TIME ZONE 'Asia/Amman')::date BETWEEN $1::date AND $2::date
     GROUP BY 1`,
    [from, to]
  );
  return Object.fromEntries(r.rows.map((x) => [x.d, x.n]));
}

// كل الأيام المسجّلة (من كل الفترات) مجمّعة حسب التاريخ، مع حساب القوارير
async function loadDays(from, to, settings) {
  const r = await query(
    `SELECT to_char(entry_date, 'YYYY-MM-DD') AS d,
            SUM(sales_amount)::float AS sales, SUM(expense_amount)::float AS expenses,
            MAX(meter_reading)::float AS meter, MAX(bottles_total) AS bt, MAX(bottles_delivery) AS bd,
            string_agg(notes, ' — ') AS notes
     FROM cash_entries WHERE entry_date <= $1::date
     GROUP BY entry_date ORDER BY entry_date ASC`,
    [to]
  );
  const delivery = await deliveryBottlesByDate(from, to);
  const factor = settings.meter_unit === "m3" ? 1000 : 1;
  const days = [];
  let prevMeter = null;
  for (const row of r.rows) {
    let meterBottles = null, meterDays = null, meterWarning = null, liters = null;
    if (row.meter != null) {
      if (prevMeter) {
        const diff = row.meter - prevMeter.value;
        if (diff < 0) meterWarning = "القراءة أقل من اللي قبلها — تأكد من الرقم";
        else {
          liters = Math.round(diff * factor * 10) / 10;
          meterBottles = Math.round(liters / settings.bottle_liters);
          meterDays = dayDiff(row.d, prevMeter.date);
        }
      }
      prevMeter = { value: row.meter, date: row.d };
    }
    if (row.d < from) continue;
    const deliveryAuto = delivery[row.d] || 0;
    const deliveryBottles = row.bd != null ? row.bd : deliveryAuto;
    const total = row.bt != null ? row.bt : meterBottles;
    // يوم انسجل فيه عداد/قوارير بس (بدون فلوس) ما بنحسبه «مبيعات صفر»
    const moneyEmpty = !row.sales && !row.expenses;
    days.push({
      date: row.d, sales: moneyEmpty ? null : row.sales, expenses: moneyEmpty ? null : row.expenses, notes: row.notes,
      meter_reading: row.meter, meter_liters: liters, meter_bottles: meterBottles, meter_days: meterDays, meter_warning: meterWarning,
      bottles_total: total, bottles_total_manual: row.bt != null,
      bottles_delivery: deliveryBottles, bottles_delivery_auto: deliveryAuto, bottles_delivery_manual: row.bd != null,
      bottles_shop: total != null ? Math.max(0, total - deliveryBottles) : null,
      // للرسم: لو ما في عداد ولا رقم يدوي، منعرض التوصيل لحاله
      bottles: total != null ? total : deliveryBottles || null,
    });
  }
  // أيام فيها توصيل بس (ما انسجل إلها حساب)
  const have = new Set(days.map((d) => d.date));
  for (const [d, n] of Object.entries(delivery)) {
    if (have.has(d) || d < from || d > to) continue;
    days.push({ date: d, sales: null, expenses: null, notes: null, meter_reading: null, meter_bottles: null, bottles_total: null,
      bottles_delivery: n, bottles_delivery_auto: n, bottles_shop: null, bottles: n, delivery_only: true });
  }
  days.sort((a, b) => (a.date < b.date ? -1 : 1));

  // قراءة عداد بعد كم يوم بدون قراءات: منوزّع القوارير على الأيام اللي فاتت (تقديري)
  // عشان الرسم والمقارنات ما يطلع فيها يوم «طاير» ويوم صفر
  const byDate = new Map(days.map((d) => [d.date, d]));
  for (const d of [...days]) {
    if (!(d.meter_days > 1) || d.bottles_total_manual || d.meter_bottles == null) continue;
    const n = d.meter_days;
    const share = Math.floor(d.meter_bottles / n);
    let rest = d.meter_bottles - share * (n - 1);
    for (let k = 1; k < n; k++) {
      const date = shiftDate(d.date, -k);
      if (date < from) { rest += share; continue; }
      let x = byDate.get(date);
      if (!x) {
        x = { date, sales: null, expenses: null, notes: null, meter_reading: null, meter_bottles: null, bottles_total: null,
          bottles_delivery: delivery[date] || 0, bottles_delivery_auto: delivery[date] || 0, bottles_shop: null, bottles: null, virtual: true };
        byDate.set(date, x);
        days.push(x);
      }
      if (x.bottles_total_manual) { rest += share; continue; }
      x.bottles_total = share;
      x.bottles_estimated = true;
      x.bottles_shop = Math.max(0, share - (x.bottles_delivery || 0));
      x.bottles = share;
    }
    d.bottles_total = rest;
    d.bottles_estimated = true;
    d.bottles_shop = Math.max(0, rest - (d.bottles_delivery || 0));
    d.bottles = rest;
  }
  days.sort((a, b) => (a.date < b.date ? -1 : 1));
  return days;
}

// ---------------- routes ----------------
router.get("/current", async (req, res) => {
  const period = await getOrCreateOpenPeriod();
  const entriesResult = await query(
    `SELECT ${ENTRY_COLUMNS} FROM cash_entries WHERE period_id = $1 ORDER BY entry_date ASC`,
    [period.id]
  );
  const entries = entriesResult.rows;
  const totalSales = entries.reduce((sum, e) => sum + Number(e.sales_amount), 0);
  const totalExpenses = entries.reduce((sum, e) => sum + Number(e.expense_amount), 0);

  // القوارير لكل يوم بالفترة
  const settings = await bottleSettings();
  let bottlesByDate = {};
  if (entries.length) {
    const days = await loadDays(entries[0].entry_date, getJordanToday(), settings);
    bottlesByDate = Object.fromEntries(days.map((d) => [d.date, d]));
  }
  const withBottles = entries.map((e) => {
    const d = bottlesByDate[e.entry_date];
    return { ...e, bottles: d?.bottles ?? null, bottles_shop: d?.bottles_shop ?? null, bottles_delivery_calc: d?.bottles_delivery ?? null };
  });

  res.json({
    period_id: period.id,
    started_at: period.started_at,
    today: getJordanToday(),
    entries: withBottles,
    total_sales: totalSales,
    total_expenses: totalExpenses,
    expected_cash: totalSales - totalExpenses,
    total_bottles: withBottles.reduce((s, e) => s + (e.bottles || 0), 0),
  });
});

// جلب يوم معيّن (لو موجود) — بيدوّر بكل الفترات، ومعه القوارير والعداد
router.get("/entries/:date", async (req, res) => {
  const { date } = req.params;
  const dateError = validateDate(date);
  if (dateError) return res.status(400).json({ error: dateError });

  const result = await query(
    `SELECT ${ENTRY_COLUMNS},
            (SELECT ended_at IS NOT NULL FROM cash_periods WHERE id = cash_entries.period_id) AS in_closed_period
     FROM cash_entries WHERE entry_date = $1
     ORDER BY period_id DESC LIMIT 1`,
    [date]
  );
  const settings = await bottleSettings();
  const prev = await query(
    `SELECT to_char(entry_date, 'YYYY-MM-DD') AS date, meter_reading::float AS meter_reading
     FROM cash_entries WHERE meter_reading IS NOT NULL AND entry_date < $1::date ORDER BY entry_date DESC LIMIT 1`,
    [date]
  );
  const delivery = await deliveryBottlesByDate(date, date);
  const days = await loadDays(date, date, settings);
  res.json({
    date,
    entry: result.rows[0] || null,
    day: days.find((d) => d.date === date) || null,
    prev_meter: prev.rows[0] || null,
    delivery_auto: delivery[date] || 0,
    settings,
  });
});

router.post("/entries", async (req, res) => {
  const { entry_date, sales_amount, notes, meter_reading, bottles_total, bottles_delivery } = req.body || {};
  let { expense_amount } = req.body || {};

  // تفاصيل الصرفيات (على شو انصرفت): المجموع بينحسب منها
  let expenseItems = undefined;
  if (Array.isArray(req.body?.expense_items)) {
    expenseItems = [];
    for (const it of req.body.expense_items.slice(0, 50)) {
      const name = String(it?.name || "").trim().slice(0, 60);
      const amount = Math.round(Number(it?.amount) * 100) / 100;
      if (!name && !(amount > 0)) continue;
      if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: `اكتب مبلغ صحيح لـ«${name || "صرفية"}».` });
      expenseItems.push({ name: name || "صرفيات", amount });
    }
    expense_amount = expenseItems.length ? String(Math.round(expenseItems.reduce((a, x) => a + x.amount, 0) * 100) / 100) : (expense_amount ?? "");
    if (!expenseItems.length) expenseItems = null;
  }
  const date = entry_date || getJordanToday();
  const dateError = validateDate(date);
  if (dateError) return res.status(400).json({ error: dateError });

  const empty = (v) => v == null || v === "";
  if (empty(sales_amount) && empty(expense_amount) && empty(meter_reading) && empty(bottles_total) && empty(bottles_delivery)) {
    return res.status(400).json({ error: "أدخل مبيعات أو صرفيات أو قراءة العداد أو عدد القوارير." });
  }

  const sales = parseAmount(sales_amount, "المبيعات");
  if (sales.error) return res.status(400).json({ error: sales.error });
  const expenses = parseAmount(expense_amount, "الصرفيات");
  if (expenses.error) return res.status(400).json({ error: expenses.error });
  const meter = parseOptionalNum(meter_reading, "قراءة العداد");
  if (meter.error) return res.status(400).json({ error: meter.error });
  const bt = parseOptionalInt(bottles_total, "عدد القوارير");
  if (bt.error) return res.status(400).json({ error: bt.error });
  const bd = parseOptionalInt(bottles_delivery, "قوارير التوصيل");
  if (bd.error) return res.status(400).json({ error: bd.error });

  let cleanNotes = null;
  if (notes != null) {
    if (typeof notes !== "string") return res.status(400).json({ error: "الملاحظة لازم تكون نص." });
    cleanNotes = notes.trim().slice(0, 500) || null;
  }

  // لو اليوم مسجّل من قبل (حتى لو بفترة مؤرشفة) نعدّله هو نفسه — وبيضل بفترته
  const existing = await query(
    `SELECT ${ENTRY_COLUMNS} FROM cash_entries WHERE entry_date = $1 ORDER BY period_id DESC LIMIT 1`,
    [date]
  );
  const oldEntry = existing.rows[0] || null;

  let saved;
  if (oldEntry) {
    const result = await query(
      `UPDATE cash_entries SET sales_amount = $1, expense_amount = $2, notes = $3,
         meter_reading = $4, bottles_total = $5, bottles_delivery = $6,
         expense_items = CASE WHEN $8::boolean THEN $9::text::jsonb ELSE expense_items END, updated_at = now()
       WHERE id = $7 RETURNING ${ENTRY_COLUMNS}`,
      [sales.value, expenses.value, cleanNotes, meter.value, bt.value, bd.value, oldEntry.id, expenseItems !== undefined, expenseItems ? JSON.stringify(expenseItems) : null]
    );
    saved = result.rows[0];
  } else {
    const periodId = await periodForNewDate(date);
    const result = await query(
      `INSERT INTO cash_entries (period_id, entry_date, sales_amount, expense_amount, notes, meter_reading, bottles_total, bottles_delivery, created_by, expense_items)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::text::jsonb) RETURNING ${ENTRY_COLUMNS}`,
      [periodId, date, sales.value, expenses.value, cleanNotes, meter.value, bt.value, bd.value, req.user.id, expenseItems ? JSON.stringify(expenseItems) : null]
    );
    saved = result.rows[0];
  }
  await refreshClosedPeriodTotals(saved.period_id);
  const closed = await query("SELECT ended_at IS NOT NULL AS c FROM cash_periods WHERE id = $1", [saved.period_id]);

  await logActivity({
    userId: req.user.id,
    action: oldEntry ? "UPDATE_CASH_ENTRY" : "CREATE_CASH_ENTRY",
    recordType: "cash_entry",
    recordId: saved.id,
    oldValue: oldEntry,
    newValue: saved,
  });

  res.json({ ...saved, in_closed_period: !!closed.rows[0]?.c });
});

// إعدادات العداد: وحدة القراءة وسعة القارورة
router.put("/settings", async (req, res) => {
  if (!can(req.user, "cash", "edit")) return res.status(403).json({ error: "ما عندك صلاحية." });
  const unit = req.body?.meter_unit === "m3" ? "m3" : "liter";
  const liters = Number(req.body?.bottle_liters);
  if (!Number.isFinite(liters) || liters < 1 || liters > 100) return res.status(400).json({ error: "سعة القارورة غير صحيحة." });
  for (const [k, v] of [["meter_unit", unit], ["bottle_liters", String(liters)]]) {
    await query(
      `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()`,
      [k, v]
    );
  }
  res.json({ meter_unit: unit, bottle_liters: liters });
});

router.post("/reset", async (req, res) => {
  const period = await getOrCreateOpenPeriod();
  const entriesResult = await query("SELECT * FROM cash_entries WHERE period_id = $1", [period.id]);
  const totalSales = entriesResult.rows.reduce((sum, e) => sum + Number(e.sales_amount), 0);
  const totalExpenses = entriesResult.rows.reduce((sum, e) => sum + Number(e.expense_amount), 0);

  await query(
    `UPDATE cash_periods SET ended_at = now(), closed_by = $1, final_sales = $2, final_expenses = $3, final_cash = $4
     WHERE id = $5`,
    [req.user.id, totalSales, totalExpenses, totalSales - totalExpenses, period.id]
  );
  const newPeriod = await query("INSERT INTO cash_periods DEFAULT VALUES RETURNING *");

  await logActivity({
    userId: req.user.id,
    action: "RESET_CASH_PERIOD",
    recordType: "cash_period",
    recordId: period.id,
    newValue: { final_sales: totalSales, final_expenses: totalExpenses, final_cash: totalSales - totalExpenses },
  });

  res.json({
    message: "تم التصفير بنجاح — بدأت فترة حساب جديدة.",
    closed_period: { total_sales: totalSales, total_expenses: totalExpenses, final_cash: totalSales - totalExpenses },
    new_period_id: newPeriod.rows[0].id,
  });
});

router.get("/history", async (req, res) => {
  const result = await query(
    `SELECT p.*, to_char(MIN(e.entry_date), 'YYYY-MM-DD') AS first_day, to_char(MAX(e.entry_date), 'YYYY-MM-DD') AS last_day,
            COUNT(e.id)::int AS days_count
     FROM cash_periods p LEFT JOIN cash_entries e ON e.period_id = p.id
     WHERE p.ended_at IS NOT NULL
     GROUP BY p.id ORDER BY p.ended_at DESC LIMIT 36`
  );
  res.json(result.rows);
});

// أيام فترة مؤرشفة (للمراجعة والتعديل)
router.get("/history/:id", async (req, res) => {
  const p = await query("SELECT * FROM cash_periods WHERE id = $1", [req.params.id]);
  if (!p.rows[0]) return res.status(404).json({ error: "الفترة غير موجودة." });
  const e = await query(`SELECT ${ENTRY_COLUMNS} FROM cash_entries WHERE period_id = $1 ORDER BY entry_date ASC`, [req.params.id]);
  res.json({ period: p.rows[0], entries: e.rows });
});

// ---------------- التحليل الذكي ----------------
// مقارنة عادلة حتى بنص الشهر: نفس عدد الأيام من الشهر الماضي، ومعدل يومي، وتوقع آخر الشهر والشهر الجاي
function sumRange(days, from, to, key) {
  let s = 0, n = 0;
  for (const d of days) if (d.date >= from && d.date <= to && d[key] != null) { s += d[key]; n++; }
  return { sum: Math.round(s * 100) / 100, days: n };
}
const pct = (a, b) => (b > 0 ? Math.round(((a - b) / b) * 1000) / 10 : null);
const monthKey = (d) => d.slice(0, 7);
const MONTHS_AR = ["كانون الثاني", "شباط", "آذار", "نيسان", "أيار", "حزيران", "تموز", "آب", "أيلول", "تشرين الأول", "تشرين الثاني", "كانون الأول"];
const WEEKDAYS_AR = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

function analyzeMetric(days, key, today) {
  const [y, m, dd] = today.split("-").map(Number);
  const monthStart = `${today.slice(0, 7)}-01`;
  const todayRecorded = days.some((d) => d.date === today && d[key] != null);
  // الأيام اللي «خلصت» من الشهر: اليوم بينحسب بس إذا انسجل
  const elapsed = Math.max(1, todayRecorded ? dd : dd - 1);
  const lastElapsedDate = todayRecorded ? today : shiftDate(today, -1);

  const prevY = m === 1 ? y - 1 : y, prevM = m === 1 ? 12 : m - 1;
  const prevStart = `${prevY}-${String(prevM).padStart(2, "0")}-01`;
  const prevDays = daysInMonth(prevY, prevM);
  const prevSameDay = `${prevY}-${String(prevM).padStart(2, "0")}-${String(Math.min(elapsed, prevDays)).padStart(2, "0")}`;
  const prevEnd = `${prevY}-${String(prevM).padStart(2, "0")}-${String(prevDays).padStart(2, "0")}`;

  const mtd = sumRange(days, monthStart, lastElapsedDate, key);
  const prevMtd = sumRange(days, prevStart, prevSameDay, key);
  const prevFull = sumRange(days, prevStart, prevEnd, key);

  // معدل يومي حديث (آخر ١٤ يوم مسجّلة) — أدق من معدل الشهر كله
  const recent = days.filter((d) => d[key] != null && d.date <= lastElapsedDate).slice(-14);
  const recentAvg = recent.length ? recent.reduce((s, d) => s + d[key], 0) / recent.length : 0;
  const mtdAvg = mtd.sum / elapsed;
  const blended = recent.length >= 5 ? 0.5 * mtdAvg + 0.5 * recentAvg : mtdAvg;
  const dim = daysInMonth(y, m);
  const projected = Math.round((mtd.sum + blended * (dim - elapsed)) * 100) / 100;

  // آخر ٧ أيام مقابل الـ٧ اللي قبلهم
  const w1 = sumRange(days, shiftDate(lastElapsedDate, -6), lastElapsedDate, key);
  const w0 = sumRange(days, shiftDate(lastElapsedDate, -13), shiftDate(lastElapsedDate, -7), key);

  // المجاميع الشهرية (آخر ١٢ شهر) — الشهر الحالي متوقع
  const monthly = {};
  for (const d of days) if (d[key] != null) monthly[monthKey(d.date)] = (monthly[monthKey(d.date)] || 0) + d[key];
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const dt = new Date(Date.UTC(y, m - 1 - i, 1));
    const k = dt.toISOString().slice(0, 7);
    const isCurrent = i === 0;
    months.push({ month: k, label: MONTHS_AR[dt.getUTCMonth()], total: Math.round((monthly[k] || 0) * 100) / 100, current: isCurrent, projected: isCurrent ? projected : null });
  }
  const firstWithData = months.findIndex((x) => x.total > 0);
  const series = firstWithData >= 0 ? months.slice(firstWithData) : [];

  // توقع الشهر الجاي: متوسط نسبة النمو الشهري (وسيط، محصور ±٢٠٪) على المتوقع لهالشهر
  const full = series.filter((x) => !x.current && x.total > 0);
  const ratios = [];
  for (let i = 1; i < full.length; i++) ratios.push(full[i].total / full[i - 1].total);
  if (full.length && full[full.length - 1].total > 0 && projected > 0) ratios.push(projected / full[full.length - 1].total);
  ratios.sort((a, b) => a - b);
  const median = ratios.length ? ratios[Math.floor(ratios.length / 2)] : 1;
  const growth = Math.min(1.2, Math.max(0.8, median));
  const nextMonth = projected > 0 ? Math.round(projected * growth * 100) / 100 : null;
  const spread = ratios.length >= 2 ? Math.min(0.2, (ratios[ratios.length - 1] - ratios[0]) / 2) : 0.12;
  const confidence = ratios.length >= 4 ? "high" : ratios.length >= 2 ? "medium" : "low";

  // أقوى وأضعف يوم بالأسبوع (آخر ٨ أسابيع)
  const wd = Array.from({ length: 7 }, () => ({ s: 0, n: 0 }));
  for (const d of days) {
    if (d[key] == null || d.date < shiftDate(today, -56)) continue;
    const w = new Date(`${d.date}T12:00:00Z`).getUTCDay();
    wd[w].s += d[key]; wd[w].n++;
  }
  const wdAvg = wd.map((x, i) => ({ day: WEEKDAYS_AR[i], avg: x.n >= 2 ? x.s / x.n : null })).filter((x) => x.avg != null);
  wdAvg.sort((a, b) => b.avg - a.avg);

  let verdict = "flat";
  const paceRef = pct(mtd.sum, prevMtd.sum);
  const weekRef = pct(w1.sum, w0.sum);
  const signal = paceRef != null ? paceRef : weekRef;
  if (signal != null) verdict = signal >= 3 ? "up" : signal <= -3 ? "down" : "flat";

  return {
    month_to_date: mtd.sum, elapsed_days: elapsed, days_in_month: dim,
    prev_same_period: prevMtd.sum, pace_pct: paceRef,
    prev_month_total: prevFull.sum, prev_month_label: MONTHS_AR[prevM - 1], month_label: MONTHS_AR[m - 1],
    daily_avg: Math.round(mtdAvg * 100) / 100, recent_daily_avg: Math.round(recentAvg * 100) / 100,
    projected_month: projected, projected_vs_prev_pct: pct(projected, prevFull.sum),
    week: w1.sum, prev_week: w0.sum, week_pct: weekRef,
    next_month: nextMonth, next_month_low: nextMonth != null ? Math.round(nextMonth * (1 - spread)) : null,
    next_month_high: nextMonth != null ? Math.round(nextMonth * (1 + spread)) : null,
    growth_pct: Math.round((growth - 1) * 1000) / 10, confidence,
    best_day: wdAvg[0] ? { day: wdAvg[0].day, avg: Math.round(wdAvg[0].avg * 100) / 100 } : null,
    worst_day: wdAvg.length > 1 ? { day: wdAvg[wdAvg.length - 1].day, avg: Math.round(wdAvg[wdAvg.length - 1].avg * 100) / 100 } : null,
    verdict,
    months: series,
  };
}

export async function computeCashInsights() {
  const today = getJordanToday();
  const settings = await bottleSettings();
  const from = shiftDate(`${today.slice(0, 7)}-01`, -370);
  const days = await loadDays(from, today, settings);
  const daily = [];
  for (let i = 59; i >= 0; i--) {
    const d = shiftDate(today, -i);
    const row = days.find((x) => x.date === d);
    daily.push({ date: d, sales: row?.sales ?? null, expenses: row?.expenses ?? null, bottles: row?.bottles ?? null, bottles_shop: row?.bottles_shop ?? null, bottles_delivery: row?.bottles_delivery ?? null });
  }
  return {
    today,
    settings,
    sales: analyzeMetric(days, "sales", today),
    bottles: analyzeMetric(days, "bottles", today),
    expenses: analyzeMetric(days, "expenses", today),
    recorded_days_60: daily.filter((d) => d.sales != null).length,
    daily,
  };
}

router.get("/insights", async (req, res) => {
  res.json(await computeCashInsights());
});

// الاتجاه القديم (بيضل موجود للتوافق)
router.get("/trend", async (req, res) => {
  const groupBy = ["day", "week", "month", "year"].includes(req.query.groupBy) ? req.query.groupBy : "day";
  const { from, to } = req.query;
  const conditions = [];
  const params = [groupBy];
  if (from && isValidDateString(from)) { params.push(from); conditions.push(`entry_date >= $${params.length}`); }
  if (to && isValidDateString(to)) { params.push(to); conditions.push(`entry_date <= $${params.length}`); }
  const whereClause = conditions.length ? "AND " + conditions.join(" AND ") : "";
  const result = await query(
    `SELECT date_trunc($1, entry_date::timestamp) AS bucket, SUM(sales_amount)::float AS total_sales, SUM(expense_amount)::float AS total_expenses
     FROM cash_entries WHERE true ${whereClause} GROUP BY bucket ORDER BY bucket ASC`,
    params
  );
  const rows = result.rows.map((r) => ({ bucket: r.bucket, total_sales: r.total_sales, total_expenses: r.total_expenses, net: r.total_sales - r.total_expenses }));
  let trend = "flat";
  if (rows.length >= 2) {
    const mid = Math.ceil(rows.length / 2);
    const a = rows.slice(0, mid).reduce((s, r) => s + r.total_sales, 0) / mid;
    const b = rows.slice(mid).reduce((s, r) => s + r.total_sales, 0) / Math.max(1, rows.length - mid);
    if (b > a * 1.03) trend = "up";
    else if (b < a * 0.97) trend = "down";
  }
  res.json({ group_by: groupBy, rows, trend });
});

export default router;
