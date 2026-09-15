import { Router } from "express";
import { query } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth, requireRole("super_admin", "admin"));

function getPeriodStartUtc(period) {
  const now = new Date();
  const jordanNow = new Date(now.getTime() + 3 * 60 * 60 * 1000);

  let start;
  if (period === "week") {
    const day = jordanNow.getUTCDay();
    start = new Date(Date.UTC(jordanNow.getUTCFullYear(), jordanNow.getUTCMonth(), jordanNow.getUTCDate() - day));
  } else if (period === "month") {
    start = new Date(Date.UTC(jordanNow.getUTCFullYear(), jordanNow.getUTCMonth(), 1));
  } else if (period === "year") {
    start = new Date(Date.UTC(jordanNow.getUTCFullYear(), 0, 1));
  } else {
    start = new Date(Date.UTC(jordanNow.getUTCFullYear(), jordanNow.getUTCMonth(), jordanNow.getUTCDate()));
  }
  return new Date(start.getTime() - 3 * 60 * 60 * 1000);
}

router.get("/summary", async (req, res) => {
  const period = ["day", "week", "month", "year"].includes(req.query.period) ? req.query.period : "day";
  const startUtc = getPeriodStartUtc(period);

  const ordersResult = await query(
    `SELECT id, status, priority, final_total, discount_value
     FROM orders WHERE created_at >= $1`,
    [startUtc]
  );
  const orders = ordersResult.rows;

  const delivered = orders.filter((o) => o.status === "DELIVERED");
  const cancelled = orders.filter((o) => o.status === "CANCELLED");
  const failed = orders.filter((o) => o.status === "FAILED");
  const urgent = orders.filter((o) => o.priority === "urgent");

  const totalSales = delivered.reduce((sum, o) => sum + Number(o.final_total), 0);
  const totalDiscounts = orders.reduce((sum, o) => sum + (Number(o.discount_value) || 0), 0);

  const productsResult = await query(
    `SELECT oi.product_name_snapshot, SUM(oi.quantity)::int AS total_quantity, SUM(oi.line_total)::numeric AS total_value
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     WHERE o.created_at >= $1 AND o.status = 'DELIVERED'
     GROUP BY oi.product_name_snapshot
     ORDER BY total_quantity DESC`,
    [startUtc]
  );

  const pendingResult = await query(`SELECT COUNT(*)::int AS count FROM orders WHERE status = 'NEW'`);

  res.json({
    period,
    period_start: startUtc,
    total_orders: orders.length,
    delivered: delivered.length,
    cancelled: cancelled.length,
    failed: failed.length,
    urgent: urgent.length,
    total_sales: totalSales,
    total_discounts: totalDiscounts,
    products: productsResult.rows,
    pending_now: pendingResult.rows[0].count,
  });
});

export default router;
