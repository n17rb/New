import { Router } from "express";
import { query, logActivity } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { can, canAny, requirePerm } from "../permissions.js";

const router = Router();
router.use(requireAuth);

// الكباتن = أي حساب عنده صلاحية «التوصيل»
async function getCaptains() {
  const result = await query(
    `SELECT id, full_name, username, role, permissions, can_discount, can_delete_customer, can_edit_product_price, can_cancel_order
     FROM users WHERE status = 'active' ORDER BY full_name ASC`
  );
  return result.rows.filter((u) => can(u, "delivery", "edit"));
}

async function computeBalance(driverId) {
  const result = await query(
    `SELECT COALESCE(SUM(CASE WHEN entry_type = 'trip_due' THEN amount ELSE -amount END), 0) AS balance,
            COALESCE(SUM(CASE WHEN entry_type = 'trip_due' THEN coupons_redeemed ELSE -coupons_redeemed END), 0) AS coupon_balance
     FROM driver_ledger WHERE driver_id = $1`,
    [driverId]
  );
  return { balance: Number(result.rows[0].balance), coupon_balance: Number(result.rows[0].coupon_balance) };
}

router.get("/performance", requirePerm("reports", "view"), async (req, res) => {
  const result = await query(`
    SELECT u.id, u.full_name,
           COUNT(DISTINCT t.id)::int AS trips_count,
           COALESCE(SUM(t.total_distance_km), 0)::float AS total_distance_km,
           COUNT(ts.id) FILTER (WHERE ts.delivered_at IS NOT NULL)::int AS delivered_count,
           COUNT(ts.id) FILTER (WHERE o.status = 'FAILED')::int AS failed_count
    FROM users u
    LEFT JOIN trips t ON t.driver_id = u.id AND t.status = 'COMPLETED'
    LEFT JOIN trip_stops ts ON ts.trip_id = t.id
    LEFT JOIN orders o ON o.id = ts.order_id
    WHERE u.id = ANY($1::int[])
    GROUP BY u.id, u.full_name
    ORDER BY delivered_count DESC
  `, [(await getCaptains()).map((c) => c.id)]);

  res.json(result.rows);
});

router.get("/list", (req, res, next) => (canAny(req.user, [["driver_balances", "view"], ["reports", "view"], ["trips", "view"]]) ? next() : res.status(403).json({ error: "غير مصرح." })), async (req, res) => {
  const captains = await getCaptains();
  res.json(captains.map((c) => ({ id: c.id, full_name: c.full_name })));
});

router.get("/balances", requirePerm("driver_balances", "view"), async (req, res) => {
  const captains = await getCaptains();

  const rows = [];
  for (const c of captains) {
    const driver = { id: c.id, full_name: c.full_name, username: c.username };
    const { balance, coupon_balance } = await computeBalance(driver.id);
    rows.push({ ...driver, balance, coupon_balance });
  }
  res.json(rows);
});

router.get("/:id/balance", async (req, res) => {
  const driverId = Number(req.params.id);
  if (!can(req.user, "driver_balances", "view") && req.user.id !== driverId) {
    return res.status(403).json({ error: "غير مصرح لك بمشاهدة هذا الحساب." });
  }

  const { balance, coupon_balance } = await computeBalance(driverId);
  const historyResult = await query(
    `SELECT * FROM driver_ledger WHERE driver_id = $1 ORDER BY created_at DESC LIMIT 50`,
    [driverId]
  );

  res.json({ driver_id: driverId, balance, coupon_balance, history: historyResult.rows });
});

router.post("/:id/settle", requirePerm("driver_balances", "edit"), async (req, res) => {
  const { amount, coupons, notes } = req.body;
  if ((!amount || Number(amount) <= 0) && (!coupons || Number(coupons) <= 0)) {
    return res.status(400).json({ error: "أدخل قيمة كاش أو عدد كوبونات أكبر من صفر على الأقل." });
  }

  const driverId = Number(req.params.id);
  await query(
    `INSERT INTO driver_ledger (driver_id, entry_type, amount, coupons_redeemed, notes, created_by)
     VALUES ($1, 'settlement', $2, $3, $4, $5)`,
    [driverId, amount || 0, coupons || 0, notes || null, req.user.id]
  );

  await logActivity({
    userId: req.user.id,
    action: "SETTLE_DRIVER",
    recordType: "driver",
    recordId: driverId,
    newValue: { amount, coupons, notes },
  });

  const { balance, coupon_balance } = await computeBalance(driverId);
  res.json({ driver_id: driverId, balance, coupon_balance });
});

export default router;
