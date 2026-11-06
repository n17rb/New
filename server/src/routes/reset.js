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

// ============================================================
// مسح شغلات معيّنة: بتختار اليوم ← النوع ← بتعلّم على الغلطات بس وبتمسحها
// ============================================================
const RANGE = (col) => `(${col} AT TIME ZONE 'Asia/Amman')::date BETWEEN $1::date AND $2::date`;
const KINDS = {
  rounds: {
    list: `SELECT r.id, 'جولة ' || r.round_no || ' · ' || COALESCE(v.name, 'سيارة') AS title,
                  COALESCE(u.full_name, '') || CASE WHEN r.status = 'open' THEN ' · مفتوحة' ELSE '' END AS sub,
                  NULL::numeric AS amount, r.opened_at AS at
           FROM st_rounds r LEFT JOIN st_vehicles v ON v.id = r.vehicle_id LEFT JOIN users u ON u.id = r.driver_id
           WHERE ${RANGE("r.opened_at")} ORDER BY r.opened_at DESC LIMIT 500`,
    // تحميل الجولة ومرتجعها بيرجعوا للمخزون كأنهم ما صاروا
    del: ["DELETE FROM st_moves WHERE round_id = ANY($1::int[])", "DELETE FROM st_rounds WHERE id = ANY($1::int[])"],
  },
  shifts: {
    list: `SELECT s.id, 'وردية ' || COALESCE(u.full_name, '') AS title,
                  'افتتاح ' || s.opening_cash || CASE WHEN s.status = 'open' THEN ' · مفتوحة' ELSE ' · مسكّرة' END AS sub,
                  s.counted_cash AS amount, s.opened_at AS at
           FROM st_shifts s LEFT JOIN users u ON u.id = s.user_id
           WHERE ${RANGE("s.opened_at")} ORDER BY s.opened_at DESC LIMIT 500`,
    del: ["DELETE FROM st_shifts WHERE id = ANY($1::int[])"],
  },
  expenses: {
    list: `SELECT e.id, e.name AS title, COALESCE(u.full_name, '') AS sub, e.amount, e.created_at AS at
           FROM st_shift_expenses e LEFT JOIN users u ON u.id = e.user_id
           WHERE ${RANGE("e.created_at")} ORDER BY e.created_at DESC LIMIT 500`,
    del: ["DELETE FROM st_shift_expenses WHERE id = ANY($1::int[])"],
  },
  sales: {
    list: `SELECT x.id, 'بيعة كاشير' || CASE WHEN x.status = 'void' THEN ' (ملغية)' ELSE '' END AS title,
                  COALESCE(u.full_name, '') AS sub, x.total AS amount, x.created_at AS at
           FROM st_sales x LEFT JOIN users u ON u.id = x.created_by
           WHERE ${RANGE("x.created_at")} ORDER BY x.created_at DESC LIMIT 500`,
    del: ["DELETE FROM st_moves WHERE sale_id = ANY($1::int[])", "DELETE FROM st_sales WHERE id = ANY($1::int[])"],
  },
  cash: {
    list: `SELECT c.id, 'الحساب اليومي' AS title,
                  'مبيعات ' || c.sales_amount || ' · صرفيات ' || c.expense_amount AS sub,
                  c.sales_amount - c.expense_amount AS amount, (c.entry_date::timestamp AT TIME ZONE 'Asia/Amman') AS at
           FROM cash_entries c WHERE c.entry_date BETWEEN $1::date AND $2::date ORDER BY c.entry_date DESC LIMIT 500`,
    del: ["DELETE FROM cash_entries WHERE id = ANY($1::int[])"],
  },
  drivers: {
    list: `SELECT l.id, CASE l.entry_type WHEN 'settlement' THEN 'قبض من الكابتن' ELSE 'مستحق رحلة' END AS title,
                  COALESCE(u.full_name, '') AS sub, l.amount, l.created_at AS at
           FROM driver_ledger l LEFT JOIN users u ON u.id = l.driver_id
           WHERE ${RANGE("l.created_at")} ORDER BY l.created_at DESC LIMIT 500`,
    del: ["DELETE FROM driver_ledger WHERE id = ANY($1::int[])"],
  },
  custody: {
    list: `SELECT g.id, 'عهدة ' || COALESCE(u.full_name, '') AS title,
                  g.amount_before || ' ← ' || g.amount_after AS sub, g.amount_after AS amount, g.created_at AS at
           FROM st_custody_log g LEFT JOIN users u ON u.id = g.user_id
           WHERE ${RANGE("g.created_at")} ORDER BY g.created_at DESC LIMIT 500`,
    // العهدة بترجع لآخر قيمة صحيحة ضلّت
    del: [
      `UPDATE st_custody c SET amount = COALESCE((SELECT g.amount_before FROM st_custody_log g WHERE g.user_id = c.user_id AND g.id = ANY($1::int[]) ORDER BY g.id LIMIT 1), c.amount), updated_at = now()
       WHERE c.user_id IN (SELECT user_id FROM st_custody_log WHERE id = ANY($1::int[]))`,
      "DELETE FROM st_custody_log WHERE id = ANY($1::int[])",
    ],
  },
  payroll: {
    list: `SELECT t.id, CASE t.kind WHEN 'advance' THEN 'سحبة/سلفة' WHEN 'bonus' THEN 'مكافأة' WHEN 'deduction' THEN 'خصم' WHEN 'payment' THEN 'دفعة راتب' ELSE t.kind END AS title,
                  COALESCE(e.name, '') AS sub, t.amount, (t.entry_date::timestamp AT TIME ZONE 'Asia/Amman') AS at
           FROM employee_transactions t LEFT JOIN employees e ON e.id = t.employee_id
           WHERE t.entry_date BETWEEN $1::date AND $2::date ORDER BY t.entry_date DESC, t.id DESC LIMIT 500`,
    del: ["DELETE FROM employee_transactions WHERE id = ANY($1::int[])"],
  },
  orders: {
    list: `SELECT o.id, '#' || o.order_number || ' · ' || COALESCE(c.name, '') AS title,
                  CASE o.status WHEN 'DELIVERED' THEN 'مسلّم' WHEN 'CANCELLED' THEN 'ملغي' WHEN 'FAILED' THEN 'متعذّر' WHEN 'POSTPONED' THEN 'مؤجل' ELSE 'مفتوح' END AS sub,
                  o.final_total AS amount, o.created_at AS at
           FROM orders o LEFT JOIN customers c ON c.id = o.customer_id
           WHERE ${RANGE("o.created_at")} ORDER BY o.created_at DESC LIMIT 500`,
    // سجل الديون والكوبونات بيضل، بس بينفك ربطه بالطلب
    del: [
      "UPDATE coupon_ledger SET order_id = NULL WHERE order_id = ANY($1::int[])",
      "UPDATE customer_debt_ledger SET order_id = NULL WHERE order_id = ANY($1::int[])",
      "DELETE FROM trip_stops WHERE order_id = ANY($1::int[])",
      "DELETE FROM orders WHERE id = ANY($1::int[])",
    ],
  },
};

const isDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

router.get("/items", async (req, res) => {
  const k = KINDS[req.query.kind];
  const { from, to } = req.query;
  if (!k) return res.status(400).json({ error: "نوع غير معروف." });
  if (!isDate(from) || !isDate(to) || from > to) return res.status(400).json({ error: "التاريخ مش مزبوط." });
  const rows = (await query(k.list, [from, to])).rows;
  res.json(rows);
});

router.post("/items", async (req, res) => {
  const k = KINDS[req.body?.kind];
  if (!k) return res.status(400).json({ error: "نوع غير معروف." });
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  if (!ids.length) return res.status(400).json({ error: "علّم على اللي بدك تمسحه." });
  const word = String(req.body?.confirm || "").trim();
  if (word !== "صفّر" && word !== "صفر" && word !== "امسح") return res.status(400).json({ error: "اكتب «امسح» عشان نتأكد." });
  try { await createScheduledSnapshot(); } catch (e) { console.error("reset snapshot:", e.message); }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const sql of k.del) await client.query(sql, [ids]);
    await client.query(
      `INSERT INTO app_settings (key, value, updated_at) VALUES ('data_reset_at', $1, now())
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = now()`,
      [new Date().toISOString()]
    );
    await client.query("COMMIT");
    res.json({ ok: true, deleted: ids.length });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("reset items:", err);
    res.status(500).json({ error: "ما زبط المسح — ما تغيّر إشي." });
  } finally {
    client.release();
  }
});

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
