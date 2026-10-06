import { Router } from "express";
import { query, logActivity } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { gate } from "../permissions.js";

const router = Router();
router.use(requireAuth, gate("cash"));

// نرجّع التاريخ كنص YYYY-MM-DD عشان ما يتزحلق يوم بسبب فرق التوقيت
const ENTRY_COLUMNS = `id, period_id, to_char(entry_date, 'YYYY-MM-DD') AS entry_date,
  sales_amount, expense_amount, notes, created_by, created_at, updated_at`;

async function getOrCreateOpenPeriod() {
  const openResult = await query("SELECT * FROM cash_periods WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1");
  if (openResult.rows[0]) return openResult.rows[0];

  const created = await query("INSERT INTO cash_periods DEFAULT VALUES RETURNING *");
  return created.rows[0];
}

function getJordanToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Amman",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function isValidDateString(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

// يرجّع { value } أو { error }
function parseAmount(raw, label) {
  if (raw === undefined || raw === null || raw === "") return { value: 0 };
  const num = Number(raw);
  if (!Number.isFinite(num)) return { error: `قيمة ${label} غير صحيحة.` };
  if (num < 0) return { error: `${label} ما بتكون بالسالب.` };
  if (num > 99999999) return { error: `قيمة ${label} كبيرة كثير.` };
  return { value: Math.round(num * 100) / 100 };
}

function validateDate(date) {
  if (!isValidDateString(date)) return "التاريخ غير صحيح.";
  if (date > getJordanToday()) return "ما بتقدر تسجّل يوم بالمستقبل.";
  return null;
}

// إذا انعدّل يوم تابع لفترة مُصفَّرة، نحدّث أرقامها النهائية بالأرشيف
async function refreshClosedPeriodTotals(periodId) {
  await query(
    `UPDATE cash_periods p SET
       final_sales = t.s,
       final_expenses = t.e,
       final_cash = t.s - t.e
     FROM (
       SELECT COALESCE(SUM(sales_amount), 0) AS s, COALESCE(SUM(expense_amount), 0) AS e
       FROM cash_entries WHERE period_id = $1
     ) t
     WHERE p.id = $1 AND p.ended_at IS NOT NULL`,
    [periodId]
  );
}

router.get("/current", async (req, res) => {
  const period = await getOrCreateOpenPeriod();

  const entriesResult = await query(
    `SELECT ${ENTRY_COLUMNS} FROM cash_entries WHERE period_id = $1 ORDER BY entry_date ASC`,
    [period.id]
  );
  const entries = entriesResult.rows;

  const totalSales = entries.reduce((sum, e) => sum + Number(e.sales_amount), 0);
  const totalExpenses = entries.reduce((sum, e) => sum + Number(e.expense_amount), 0);

  res.json({
    period_id: period.id,
    started_at: period.started_at,
    today: getJordanToday(),
    entries,
    total_sales: totalSales,
    total_expenses: totalExpenses,
    expected_cash: totalSales - totalExpenses,
  });
});

// جلب إدخال يوم معيّن (لو موجود) — بيدوّر بكل الفترات
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

  res.json({ date, entry: result.rows[0] || null });
});

router.post("/entries", async (req, res) => {
  const { entry_date, sales_amount, expense_amount, notes } = req.body || {};
  const date = entry_date || getJordanToday();

  const dateError = validateDate(date);
  if (dateError) return res.status(400).json({ error: dateError });

  if ((sales_amount == null || sales_amount === "") && (expense_amount == null || expense_amount === "")) {
    return res.status(400).json({ error: "أدخل قيمة مبيعات أو صرفيات على الأقل." });
  }

  const sales = parseAmount(sales_amount, "المبيعات");
  if (sales.error) return res.status(400).json({ error: sales.error });
  const expenses = parseAmount(expense_amount, "الصرفيات");
  if (expenses.error) return res.status(400).json({ error: expenses.error });

  let cleanNotes = null;
  if (notes != null) {
    if (typeof notes !== "string") return res.status(400).json({ error: "الملاحظة لازم تكون نص." });
    cleanNotes = notes.trim().slice(0, 500) || null;
  }

  // لو اليوم مسجّل من قبل (حتى لو بفترة مُصفَّرة) نعدّله هو بدل ما نعمل نسخة ثانية
  const existing = await query(
    `SELECT ${ENTRY_COLUMNS} FROM cash_entries WHERE entry_date = $1 ORDER BY period_id DESC LIMIT 1`,
    [date]
  );
  const oldEntry = existing.rows[0] || null;

  let saved;
  if (oldEntry) {
    const result = await query(
      `UPDATE cash_entries SET
         sales_amount = $1,
         expense_amount = $2,
         notes = $3,
         updated_at = now()
       WHERE id = $4
       RETURNING ${ENTRY_COLUMNS}`,
      [sales.value, expenses.value, cleanNotes, oldEntry.id]
    );
    saved = result.rows[0];
    await refreshClosedPeriodTotals(saved.period_id);
  } else {
    const period = await getOrCreateOpenPeriod();
    const result = await query(
      `INSERT INTO cash_entries (period_id, entry_date, sales_amount, expense_amount, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING ${ENTRY_COLUMNS}`,
      [period.id, date, sales.value, expenses.value, cleanNotes, req.user.id]
    );
    saved = result.rows[0];
  }

  await logActivity({
    userId: req.user.id,
    action: oldEntry ? "UPDATE_CASH_ENTRY" : "CREATE_CASH_ENTRY",
    recordType: "cash_entry",
    recordId: saved.id,
    oldValue: oldEntry,
    newValue: saved,
  });

  res.json(saved);
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
    "SELECT * FROM cash_periods WHERE ended_at IS NOT NULL ORDER BY ended_at DESC LIMIT 24"
  );
  res.json(result.rows);
});

router.get("/trend", async (req, res) => {
  const groupBy = ["day", "week", "month", "year"].includes(req.query.groupBy) ? req.query.groupBy : "day";
  const { from, to } = req.query;

  const conditions = [];
  const params = [groupBy];

  if (from && isValidDateString(from)) {
    params.push(from);
    conditions.push(`entry_date >= $${params.length}`);
  }
  if (to && isValidDateString(to)) {
    params.push(to);
    conditions.push(`entry_date <= $${params.length}`);
  }

  const whereClause = conditions.length ? "AND " + conditions.join(" AND ") : "";

  const result = await query(
    `SELECT date_trunc($1, entry_date::timestamp) AS bucket,
            SUM(sales_amount)::float AS total_sales,
            SUM(expense_amount)::float AS total_expenses
     FROM cash_entries
     WHERE true ${whereClause}
     GROUP BY bucket
     ORDER BY bucket ASC`,
    params
  );

  const rows = result.rows.map((r) => ({
    bucket: r.bucket,
    total_sales: r.total_sales,
    total_expenses: r.total_expenses,
    net: r.total_sales - r.total_expenses,
  }));

  let trend = "flat";
  if (rows.length >= 2) {
    const mid = Math.ceil(rows.length / 2);
    // الاتجاه محسوب على المبيعات فقط (بدون خصم الصرفيات)
    const firstHalfAvg = rows.slice(0, mid).reduce((s, r) => s + r.total_sales, 0) / mid;
    const secondHalfAvg = rows.slice(mid).reduce((s, r) => s + r.total_sales, 0) / Math.max(1, rows.length - mid);
    if (secondHalfAvg > firstHalfAvg * 1.03) trend = "up";
    else if (secondHalfAvg < firstHalfAvg * 0.97) trend = "down";
  }

  res.json({ group_by: groupBy, rows, trend });
});

export default router;
