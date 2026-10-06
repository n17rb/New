import { Router } from "express";
import { query } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { can, requirePerm } from "../permissions.js";

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
          WHERE c.status = 'active' AND $2 = ANY(cr.days_of_week)) AS appointments_today`,
    [today, dow]
  );
  const row = result.rows[0];

  // قيمة المبيعات بتظهر بس للي عنده تقارير أو حساب يومي
  if (!can(req.user, "reports", "view") && !can(req.user, "cash", "view")) delete row.delivered_value_today;

  res.json({ today, ...row });
});

export default router;
