import { Router } from "express";
import { query, logActivity } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth, requireRole("super_admin", "admin"));

async function getOrCreateOpenPeriod() {
  const openResult = await query("SELECT * FROM cash_periods WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1");
  if (openResult.rows[0]) return openResult.rows[0];

  const created = await query("INSERT INTO cash_periods DEFAULT VALUES RETURNING *");
  return created.rows[0];
}

router.get("/current", async (req, res) => {
  const period = await getOrCreateOpenPeriod();

  const entriesResult = await query(
    "SELECT * FROM cash_entries WHERE period_id = $1 ORDER BY entry_date ASC",
    [period.id]
  );
  const entries = entriesResult.rows;

  const totalSales = entries.reduce((sum, e) => sum + Number(e.sales_amount), 0);
  const totalExpenses = entries.reduce((sum, e) => sum + Number(e.expense_amount), 0);

  res.json({
    period_id: period.id,
    started_at: period.started_at,
    entries,
    total_sales: totalSales,
    total_expenses: totalExpenses,
    expected_cash: totalSales - totalExpenses,
  });
});

function getJordanToday() {
  const now = new Date();
  const jordanNow = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  return jordanNow.toISOString().slice(0, 10);
}

router.post("/entries", async (req, res) => {
  const { entry_date, sales_amount, expense_amount, notes } = req.body;
  const date = entry_date || getJordanToday();

  if (sales_amount == null && expense_amount == null) {
    return res.status(400).json({ error: "أدخل قيمة مبيعات أو صرفيات على الأقل." });
  }

  const period = await getOrCreateOpenPeriod();

  const existing = await query(
    "SELECT id FROM cash_entries WHERE period_id = $1 AND entry_date = $2",
    [period.id, date]
  );

  let result;
  if (existing.rows[0]) {
    result = await query(
      `UPDATE cash_entries SET
         sales_amount = COALESCE($1, sales_amount),
         expense_amount = COALESCE($2, expense_amount),
         notes = COALESCE($3, notes),
         updated_at = now()
       WHERE id = $4 RETURNING *`,
      [sales_amount, expense_amount, notes, existing.rows[0].id]
    );
  } else {
    result = await query(
      `INSERT INTO cash_entries (period_id, entry_date, sales_amount, expense_amount, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [period.id, date, sales_amount || 0, expense_amount || 0, notes || null, req.user.id]
    );
  }

  await logActivity({
    userId: req.user.id,
    action: "UPSERT_CASH_ENTRY",
    recordType: "cash_entry",
    recordId: result.rows[0].id,
    newValue: result.rows[0],
  });

  res.json(result.rows[0]);
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

  if (from) {
    params.push(from);
    conditions.push(`entry_date >= $${params.length}`);
  }
  if (to) {
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
    const firstHalfAvg = rows.slice(0, mid).reduce((s, r) => s + r.net, 0) / mid;
    const secondHalfAvg = rows.slice(mid).reduce((s, r) => s + r.net, 0) / Math.max(1, rows.length - mid);
    if (secondHalfAvg > firstHalfAvg * 1.03) trend = "up";
    else if (secondHalfAvg < firstHalfAvg * 0.97) trend = "down";
  }

  res.json({ group_by: groupBy, rows, trend });
});

export default router;
