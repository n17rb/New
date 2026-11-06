import { Router } from "express";
import { query, pool } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { requireFeature } from "../features.js";
import { createScheduledSnapshot } from "./backup.js";

// ============================================================
// تصفير الحسابات (للمحلات اللي بتتدرّب) — ميزة بتنفتح من لوحة إدارة موج
// بس صاحب المحل (المدير العام) بيقدر يصفّر، وبعد ما يخلص التدريب بتنسكّر الميزة
// الزباين والديون والكوبونات والمنتجات والحسابات ما بتنمسح أبدًا
// ============================================================
const router = Router();
router.use(requireAuth, requireFeature("data_reset"), requireRole("super_admin"));

// كل جزء بيتصفّر لحاله (صاحب المحل بيختار)
const PARTS = {
  cash: [
    "DELETE FROM cash_entries",
    "DELETE FROM cash_periods",
  ],
  drivers: [
    "DELETE FROM driver_ledger",
  ],
  station: [
    "DELETE FROM st_shift_expenses",
    "DELETE FROM st_shifts",
    "DELETE FROM st_sales",
    "DELETE FROM st_round_items",
    "DELETE FROM st_rounds",
  ],
  custody: [
    "DELETE FROM st_custody_log",
    "UPDATE st_custody SET amount = 0, updated_at = now()",
  ],
  payroll: [
    "DELETE FROM employee_transactions",
    "DELETE FROM attendance",
  ],
  // الطلبات والرحلات: سجل الديون والكوبونات بيضل، بس بينفك ربطه بالطلب
  orders: [
    "UPDATE coupon_ledger SET order_id = NULL WHERE order_id IS NOT NULL",
    "UPDATE customer_debt_ledger SET order_id = NULL, trip_id = NULL WHERE order_id IS NOT NULL OR trip_id IS NOT NULL",
    "UPDATE notifications SET related_trip_id = NULL WHERE related_trip_id IS NOT NULL",
    "DELETE FROM driver_ledger",
    "DELETE FROM trips",
    "DELETE FROM orders",
    "SELECT setval('order_seq', 1, false)",
  ],
};

async function count(sql) {
  try { return (await query(sql)).rows[0].n; } catch { return 0; }
}

router.get("/summary", async (req, res) => {
  const [orders, trips, customers, cash] = await Promise.all([
    count("SELECT COUNT(*)::int AS n FROM orders"),
    count("SELECT COUNT(*)::int AS n FROM trips"),
    count("SELECT COUNT(*)::int AS n FROM customers"),
    count("SELECT COUNT(*)::int AS n FROM cash_entries"),
  ]);
  const last = (await query("SELECT value FROM app_settings WHERE key = 'data_reset_at'")).rows[0]?.value || null;
  res.json({ orders, trips, customers, cash, last_reset_at: last });
});

router.post("/", async (req, res) => {
  const parts = Array.isArray(req.body?.parts) ? req.body.parts.filter((p) => PARTS[p]) : [];
  if (!parts.length) return res.status(400).json({ error: "اختار شو بدك تصفّر." });
  const word = String(req.body?.confirm || "").trim();
  if (word !== "صفّر" && word !== "صفر") return res.status(400).json({ error: "اكتب «صفّر» عشان نتأكد." });

  // نسخة احتياطية قبل التصفير (بتضل بالنسخ الاحتياطي)
  try { await createScheduledSnapshot(); } catch (e) { console.error("reset snapshot:", e.message); }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const p of parts) for (const sql of PARTS[p]) await client.query(sql);
    await client.query(
      `INSERT INTO app_settings (key, value, updated_at) VALUES ('data_reset_at', $1, now())
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = now()`,
      [new Date().toISOString()]
    );
    await client.query("COMMIT");
    res.json({ ok: true, parts });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("reset:", err);
    res.status(500).json({ error: "ما زبط التصفير — ما تغيّر إشي. جرّب كمان مرة أو احكي مع الدعم." });
  } finally {
    client.release();
  }
});

export default router;
