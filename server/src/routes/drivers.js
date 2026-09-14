import { Router } from "express";
import { query, logActivity } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

function isPrivileged(user) {
  return user.role === "super_admin" || user.role === "admin";
}

async function computeBalance(driverId) {
  const result = await query(
    `SELECT COALESCE(SUM(CASE WHEN entry_type = 'trip_due' THEN amount ELSE -amount END), 0) AS balance
     FROM driver_ledger WHERE driver_id = $1`,
    [driverId]
  );
  return Number(result.rows[0].balance);
}

router.get("/balances", requireRole("super_admin", "admin"), async (req, res) => {
  const driversResult = await query(
    `SELECT id, full_name, username FROM users WHERE role = 'driver' AND status = 'active' ORDER BY full_name ASC`
  );

  const rows = [];
  for (const driver of driversResult.rows) {
    const balance = await computeBalance(driver.id);
    rows.push({ ...driver, balance });
  }
  res.json(rows);
});

router.get("/:id/balance", async (req, res) => {
  const driverId = Number(req.params.id);
  if (!isPrivileged(req.user) && req.user.id !== driverId) {
    return res.status(403).json({ error: "غير مصرح لك بمشاهدة هذا الحساب." });
  }

  const balance = await computeBalance(driverId);
  const historyResult = await query(
    `SELECT * FROM driver_ledger WHERE driver_id = $1 ORDER BY created_at DESC LIMIT 50`,
    [driverId]
  );

  res.json({ driver_id: driverId, balance, history: historyResult.rows });
});

router.post("/:id/settle", requireRole("super_admin", "admin"), async (req, res) => {
  const { amount, notes } = req.body;
  if (!amount || Number(amount) <= 0) {
    return res.status(400).json({ error: "قيمة التسوية يجب أن تكون أكبر من صفر." });
  }

  const driverId = Number(req.params.id);
  await query(
    `INSERT INTO driver_ledger (driver_id, entry_type, amount, notes, created_by)
     VALUES ($1, 'settlement', $2, $3, $4)`,
    [driverId, amount, notes || null, req.user.id]
  );

  await logActivity({
    userId: req.user.id,
    action: "SETTLE_DRIVER",
    recordType: "driver",
    recordId: driverId,
    newValue: { amount, notes },
  });

  const balance = await computeBalance(driverId);
  res.json({ driver_id: driverId, balance });
});

export default router;
