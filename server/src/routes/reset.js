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

// كل جزء بيتصفّر لحاله (صاحب المحل بيختار) — $1 و $2 = من تاريخ ولتاريخ (بتوقيت الأردن)، أو null = كل الأيام
const D = (col) => `(($1::date IS NULL OR (${col} AT TIME ZONE 'Asia/Amman')::date >= $1::date) AND ($2::date IS NULL OR (${col} AT TIME ZONE 'Asia/Amman')::date <= $2::date))`;
const DD = (col) => `(($1::date IS NULL OR ${col} >= $1::date) AND ($2::date IS NULL OR ${col} <= $2::date))`;
const ORDERS_IN = `SELECT id FROM orders WHERE ${D("created_at")}`;
const TRIPS_IN = `SELECT id FROM trips WHERE ${D("created_at")}`;
const PARTS = {
  cash: [
    `DELETE FROM cash_entries WHERE ${DD("entry_date")}`,
    // الأرشيفات اللي فضيت (المفتوحة بتضل)
    "DELETE FROM cash_periods p WHERE p.ended_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM cash_entries e WHERE e.period_id = p.id) AND ($1::date IS NULL OR TRUE) AND ($2::date IS NULL OR TRUE)",
  ],
  drivers: [
    `DELETE FROM driver_ledger WHERE ${D("created_at")}`,
  ],
  station: [
    `DELETE FROM st_shift_expenses WHERE ${D("created_at")}`,
    `DELETE FROM st_shifts WHERE ${D("opened_at")}`,
    `DELETE FROM st_sales WHERE ${D("created_at")}`,
    `DELETE FROM st_rounds WHERE ${D("opened_at")}`,
  ],
  custody: [
    `DELETE FROM st_custody_log WHERE ${D("created_at")}`,
    "UPDATE st_custody SET amount = 0, updated_at = now() WHERE ($1::date IS NULL OR TRUE) AND ($2::date IS NULL OR TRUE)",
  ],
  payroll: [
    `DELETE FROM employee_transactions WHERE ${DD("entry_date")}`,
    `DELETE FROM attendance WHERE ${DD("work_date")}`,
  ],
  // الطلبات والرحلات: سجل الديون والكوبونات بيضل، بس بينفك ربطه بالطلب
  orders: [
    `UPDATE coupon_ledger SET order_id = NULL WHERE order_id IN (${ORDERS_IN})`,
    `UPDATE customer_debt_ledger SET order_id = NULL WHERE order_id IN (${ORDERS_IN})`,
    `UPDATE customer_debt_ledger SET trip_id = NULL WHERE trip_id IN (${TRIPS_IN})`,
    `UPDATE notifications SET related_trip_id = NULL WHERE related_trip_id IN (${TRIPS_IN})`,
    `DELETE FROM driver_ledger WHERE trip_id IN (${TRIPS_IN})`,
    `DELETE FROM trip_stops WHERE order_id IN (${ORDERS_IN})`,
    `DELETE FROM trips WHERE id IN (${TRIPS_IN})`,
    `DELETE FROM orders WHERE id IN (${ORDERS_IN})`,
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
  const isDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const from = isDate(req.body?.from) ? req.body.from : null;
  const to = isDate(req.body?.to) ? req.body.to : null;
  if (from && to && from > to) return res.status(400).json({ error: "تاريخ «من» لازم يكون قبل «لـ»." });
  const word = String(req.body?.confirm || "").trim();
  if (word !== "صفّر" && word !== "صفر") return res.status(400).json({ error: "اكتب «صفّر» عشان نتأكد." });

  // نسخة احتياطية قبل التصفير (بتضل بالنسخ الاحتياطي)
  try { await createScheduledSnapshot(); } catch (e) { console.error("reset snapshot:", e.message); }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const p of parts) for (const sql of PARTS[p]) await client.query(sql, [from, to]);
    // إذا ما ضل ولا طلب، الترقيم بيرجع من ١
    if (parts.includes("orders")) {
      const left = (await client.query("SELECT COUNT(*)::int AS n FROM orders")).rows[0].n;
      if (!left) await client.query("SELECT setval('order_seq', 1, false)");
    }
    await client.query(
      `INSERT INTO app_settings (key, value, updated_at) VALUES ('data_reset_at', $1, now())
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = now()`,
      [new Date().toISOString()]
    );
    await client.query("COMMIT");
    res.json({ ok: true, parts, from, to });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("reset:", err);
    res.status(500).json({ error: "ما زبط التصفير — ما تغيّر إشي. جرّب كمان مرة أو احكي مع الدعم." });
  } finally {
    client.release();
  }
});

export default router;
