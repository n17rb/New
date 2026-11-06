import { Router } from "express";
import { query, pool } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { requireFeature } from "../features.js";
import { createScheduledSnapshot } from "./backup.js";

// ============================================================
// تصفير البيانات (للمحلات اللي بتتدرّب) — ميزة بتنفتح من لوحة إدارة موج
// بس صاحب المحل (المدير العام) بيقدر يصفّر، وبعد ما يخلص التدريب بتنسكّر الميزة
// ============================================================
const router = Router();
router.use(requireAuth, requireFeature("data_reset"), requireRole("super_admin"));

// الحركات: كل شي صار (طلبات، رحلات، حساب، ديون، كوبونات…) — الزباين والمنتجات والحسابات بتضل
const MOVES = [
  "orders", "order_items", "order_edit_history", "trips", "trip_stops", "driver_ledger", "trip_inventory", "trip_track",
  "cash_periods", "cash_entries", "notifications", "coupon_ledger", "coupon_sales", "customer_debt_ledger", "bottle_ledger",
  "forecast_alerts", "reminder_fired_log", "activity_log", "wa_messages", "wa_outbox",
  "st_rounds", "st_round_items", "st_moves", "st_sales", "st_custody_log", "st_shifts", "st_shift_expenses",
  "attendance", "employee_transactions",
];
// الكامل: كمان الزباين وعناوينهم وأسعارهم الخاصة ومواعيدهم
const CUSTOMERS = ["customers", "customer_locations", "customer_product_prices", "customer_reminders"];

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
  const scope = req.body?.scope === "all" ? "all" : "moves";
  if (String(req.body?.confirm || "").trim() !== "صفّر" && String(req.body?.confirm || "").trim() !== "صفر") {
    return res.status(400).json({ error: "اكتب «صفّر» عشان نتأكد." });
  }
  // نسخة احتياطية قبل التصفير (بتضل بالنسخ الاحتياطي)
  try { await createScheduledSnapshot(); } catch (e) { console.error("reset snapshot:", e.message); }

  const tables = scope === "all" ? [...MOVES, ...CUSTOMERS] : MOVES;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`TRUNCATE ${tables.join(", ")} RESTART IDENTITY`);
    if (scope === "moves") {
      await client.query("UPDATE customers SET coupon_balance = 0, debt_balance = 0, bottles_out = 0");
    }
    await client.query("UPDATE st_custody SET amount = 0, updated_at = now()");
    await client.query("UPDATE st_items SET alerted = false");
    await client.query("SELECT setval('order_seq', 1, false)");
    if (scope === "all") await client.query("SELECT setval('customer_seq', 1, false)");
    await client.query(
      `INSERT INTO app_settings (key, value, updated_at) VALUES ('data_reset_at', $1, now())
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = now()`,
      [new Date().toISOString()]
    );
    await client.query("COMMIT");
    res.json({ ok: true, scope });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("reset:", err);
    res.status(500).json({ error: "ما زبط التصفير — ما تغيّر إشي. جرّب كمان مرة أو احكي مع الدعم." });
  } finally {
    client.release();
  }
});

export default router;
