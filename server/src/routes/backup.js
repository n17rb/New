import { Router } from "express";
import { query } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth, requireRole("super_admin"));

export async function buildSnapshot() {
  const [customers, locations, products, orders, orderItems, users] = await Promise.all([
    query("SELECT * FROM customers"),
    query("SELECT * FROM customer_locations"),
    query("SELECT * FROM products"),
    query("SELECT * FROM orders"),
    query("SELECT * FROM order_items"),
    query("SELECT id, username, full_name, role, status, created_at FROM users"),
  ]);

  return {
    generated_at: new Date().toISOString(),
    customers: customers.rows,
    customer_locations: locations.rows,
    products: products.rows,
    orders: orders.rows,
    order_items: orderItems.rows,
    users: users.rows,
  };
}

export async function createScheduledSnapshot() {
  const snapshot = await buildSnapshot();
  await query("INSERT INTO backup_snapshots (data) VALUES ($1)", [JSON.stringify(snapshot)]);
  await query(
    `DELETE FROM backup_snapshots WHERE id NOT IN (SELECT id FROM backup_snapshots ORDER BY created_at DESC LIMIT 14)`
  );
}

router.get("/export", async (req, res) => {
  const snapshot = await buildSnapshot();
  res.setHeader("Content-Disposition", `attachment; filename="backup-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json(snapshot);
});

router.get("/latest", async (req, res) => {
  const result = await query("SELECT * FROM backup_snapshots ORDER BY created_at DESC LIMIT 1");
  if (!result.rows[0]) return res.json(null);
  res.json({ created_at: result.rows[0].created_at, id: result.rows[0].id });
});

router.get("/history", async (req, res) => {
  const result = await query("SELECT id, created_at FROM backup_snapshots ORDER BY created_at DESC LIMIT 14");
  res.json(result.rows);
});

router.get("/:id/download", async (req, res) => {
  const result = await query("SELECT * FROM backup_snapshots WHERE id = $1", [req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: "النسخة غير موجودة." });
  res.setHeader("Content-Disposition", `attachment; filename="backup-${result.rows[0].created_at.toISOString().slice(0, 10)}.json"`);
  res.json(result.rows[0].data);
});

export default router;
