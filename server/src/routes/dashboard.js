import { Router } from "express";
import { query } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { can, canAny, requirePerm } from "../permissions.js";
import { computeForecasts, groupForecasts } from "../utils/forecast.js";

const router = Router();
router.use(requireAuth, requirePerm("dashboard", "view"));

function jordanToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Amman", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

// ملخص اليوم للشاشة الرئيسية — استعلام واحد سريع
router.get("/", async (req, res) => {
  const today = jordanToday();
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay();

  const result = await query(
    `SELECT
       (SELECT COUNT(*)::int FROM orders WHERE status = 'NEW') AS new_orders,
       (SELECT COUNT(*)::int FROM orders WHERE status = 'NEW' AND needs_quantity) AS needs_quantity,
       (SELECT COUNT(*)::int FROM orders WHERE status = 'IN_ROUTE') AS in_route,
       (SELECT COUNT(*)::int FROM orders WHERE status = 'DELIVERED'
          AND (updated_at AT TIME ZONE 'Asia/Amman')::date = $1::date) AS delivered_today,
       (SELECT COALESCE(SUM(final_total), 0)::float FROM orders WHERE status = 'DELIVERED'
          AND (updated_at AT TIME ZONE 'Asia/Amman')::date = $1::date) AS delivered_value_today,
       (SELECT COUNT(*)::int FROM trips WHERE status IN ('PLANNED','STARTED')) AS active_trips,
       (SELECT COUNT(*)::int FROM customer_reminders cr JOIN customers c ON c.id = cr.customer_id
          WHERE c.status = 'active' AND $2 = ANY(cr.days_of_week)) AS appointments_today,
       (SELECT COALESCE(SUM(debt_balance), 0)::float FROM customers WHERE status = 'active' AND debt_balance > 0) AS debts_total,
       (SELECT COUNT(*)::int FROM customers WHERE status = 'active' AND debt_balance > 0) AS debtors_count`,
    [today, dow]
  );
  const row = result.rows[0];

  // قيمة المبيعات بتظهر بس للي عنده تقارير أو حساب يومي
  if (!can(req.user, "reports", "view") && !can(req.user, "cash", "view")) delete row.delivered_value_today;
  if (!can(req.user, "debts", "view")) {
    delete row.debts_total;
    delete row.debtors_count;
  }

  // توقعات اليوم (مين مفروض يطلب ومين متأخر)
  if (canAny(req.user, [["orders", "view"], ["customers", "view"]])) {
    try {
      const g = groupForecasts(await computeForecasts());
      row.forecast_today = g.today.length;
      row.forecast_tomorrow = g.tomorrow.length;
      row.forecast_late = g.late.length;
      row.forecast_bottles = g.expected_bottles_today;
      row.forecast_names = g.today.slice(0, 3).map((f) => f.name);
    } catch (e) {
      console.error("forecast dashboard error:", e.message);
    }
  }

  res.json({ today, ...row });
});

export default router;
