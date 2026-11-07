import { Router } from "express";
import { query, pool, logActivity } from "../db.js";
import { can } from "../permissions.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePerm } from "../permissions.js";
import { jordanDate } from "../utils/forecast.js";

// ============================================================
// الجرد اليومي: كل شي دخل وطلع بيوم معيّن، ومين قبض شو
// ============================================================
const router = Router();
router.use(requireAuth, requirePerm("jard", "view"));

const isDate = (d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);
const n = (x) => Math.round((Number(x) || 0) * 100) / 100;
const DAY_SQL = (col) => `(${col} AT TIME ZONE 'Asia/Amman')::date = $1::date`;

router.get("/", async (req, res) => {
  const today = jordanDate();
  const date = isDate(req.query.date) && req.query.date <= today ? req.query.date : today;

  const stExp = await query(
    `SELECT e.user_id, u.full_name, e.name, e.amount::float AS amount, e.created_at
     FROM st_shift_expenses e LEFT JOIN users u ON u.id = e.user_id WHERE ${DAY_SQL("e.created_at")} ORDER BY e.created_at`,
    [date]
  ).catch(() => ({ rows: [] }));
  const [shopSales, custody] = await Promise.all([
    query(
      `SELECT s.created_by, u.full_name AS by_name, COUNT(*)::int AS count, COALESCE(SUM(s.total), 0)::float AS total
       FROM st_sales s LEFT JOIN users u ON u.id = s.created_by
       WHERE s.status = 'done' AND ${DAY_SQL("s.created_at")} GROUP BY s.created_by, u.full_name`,
      [date]
    ).catch(() => ({ rows: [] })),
    req.tenant?.features?.custody
      ? query("SELECT c.user_id, u.full_name, c.amount::float AS amount FROM st_custody c JOIN users u ON u.id = c.user_id WHERE c.amount > 0").catch(() => ({ rows: [] }))
      : { rows: [] },
  ]);
  const [byDriver, debtPayments, newDebts, couponSales, expenses, payroll, ordersSummary, bottles] = await Promise.all([
    // كل كابتن: كم سلّم، كم قبض كاش، كم كوبون، كم دين انضاف وكم انسدّ
    query(
      `SELECT t.driver_id, COALESCE(u.full_name, 'بدون كابتن') AS driver_name,
              COUNT(*)::int AS delivered,
              COALESCE(SUM(ts.cash_collected), 0)::float AS cash,
              COALESCE(SUM(ts.coupons_collected), 0)::int AS coupons,
              COALESCE(SUM(ts.paper_coupons), 0)::int AS paper_coupons,
              COALESCE(SUM(ts.debt_added), 0)::float AS debt_added,
              COALESCE(SUM(ts.debt_paid), 0)::float AS debt_paid,
              COALESCE(SUM(ts.amount_due), 0)::float AS amount_due,
              COALESCE(SUM(ts.empties_collected), 0)::int AS empties
       FROM trip_stops ts JOIN trips t ON t.id = ts.trip_id LEFT JOIN users u ON u.id = t.driver_id
       WHERE ts.delivered_at IS NOT NULL AND ${DAY_SQL("ts.delivered_at")}
       GROUP BY t.driver_id, u.full_name ORDER BY delivered DESC`,
      [date]
    ),
    // مين سدّد دين، كم، ومين قبض (مع التوصيل أو بالمحل)
    query(
      `SELECT l.id, l.customer_id, c.name AS customer_name, (-l.change_amount)::float AS amount, l.balance_after::float AS balance_after,
              l.notes, l.trip_id, l.created_at, l.created_by, u.full_name AS collected_by
       FROM customer_debt_ledger l JOIN customers c ON c.id = l.customer_id LEFT JOIN users u ON u.id = l.created_by
       WHERE l.reason = 'payment' AND ${DAY_SQL("l.created_at")} ORDER BY l.created_at`,
      [date]
    ),
    query(
      `SELECT l.id, l.customer_id, c.name AS customer_name, l.change_amount::float AS amount, l.reason, l.notes, l.created_at,
              u.full_name AS by_name
       FROM customer_debt_ledger l JOIN customers c ON c.id = l.customer_id LEFT JOIN users u ON u.id = l.created_by
       WHERE l.change_amount > 0 AND l.reason IN ('order_credit','coupon_package','manual') AND ${DAY_SQL("l.created_at")}
       ORDER BY l.created_at`,
      [date]
    ),
    query(
      `SELECT s.id, c.name AS customer_name, s.package_name_snapshot, s.coupons, s.price::float AS price,
              s.paid_amount::float AS paid, s.sold_by, s.trip_id, u.full_name AS sold_by_name, s.created_at
       FROM coupon_sales s JOIN customers c ON c.id = s.customer_id LEFT JOIN users u ON u.id = s.sold_by
       WHERE ${DAY_SQL("s.created_at")} ORDER BY s.created_at`,
      [date]
    ),
    query(
      `SELECT COALESCE(SUM(expense_amount), 0)::float AS expenses, COALESCE(SUM(sales_amount), 0)::float AS manual_sales,
              string_agg(NULLIF(notes, ''), ' · ') AS notes
       FROM cash_entries WHERE entry_date = $1::date`,
      [date]
    ),
    query(
      `SELECT t.id, e.name AS employee_name, t.kind, t.amount::float AS amount, t.note, u.full_name AS by_name
       FROM employee_transactions t JOIN employees e ON e.id = t.employee_id LEFT JOIN users u ON u.id = t.created_by
       WHERE t.entry_date = $1::date AND t.kind IN ('advance','payment') ORDER BY t.id`,
      [date]
    ),
    query(
      `SELECT COUNT(*) FILTER (WHERE ${DAY_SQL("created_at")})::int AS orders_created,
              COUNT(*) FILTER (WHERE status = 'CANCELLED' AND ${DAY_SQL("updated_at")})::int AS cancelled
       FROM orders`,
      [date]
    ),
    query(
      `SELECT oi.product_name_snapshot AS name, SUM(oi.quantity)::int AS qty, SUM(oi.coupon_quantity)::int AS by_coupon
       FROM trip_stops ts JOIN order_items oi ON oi.order_id = ts.order_id
       WHERE ts.delivered_at IS NOT NULL AND ${DAY_SQL("ts.delivered_at")}
       GROUP BY oi.product_name_snapshot ORDER BY qty DESC`,
      [date]
    ),
  ]);

  // كل واحد كم معه: كاش التوصيل + كاش الباقات اللي باعها (من الرحلة أو بالمحل)
  const drivers = byDriver.rows.map((d) => ({ ...d, pkg_count: 0, pkg_coupons: 0, pkg_cash: 0 }));
  for (const sale of couponSales.rows) {
    let d = drivers.find((x) => x.driver_id != null && x.driver_id === sale.sold_by);
    if (!d) {
      d = { driver_id: sale.sold_by, driver_name: sale.sold_by_name || "بدون اسم", delivered: 0, cash: 0, coupons: 0, paper_coupons: 0,
        debt_added: 0, debt_paid: 0, amount_due: 0, empties: 0, pkg_count: 0, pkg_coupons: 0, pkg_cash: 0, no_trip: true };
      drivers.push(d);
    }
    d.pkg_count += 1;
    d.pkg_coupons += sale.coupons;
    d.pkg_cash = n(d.pkg_cash + sale.paid);
  }
  // سداد ديون برا التوصيل (بالمحل أو سداد سريع): مع اللي قبضها
  const blank = (id, name) => ({ driver_id: id, driver_name: name || "بدون اسم", delivered: 0, cash: 0, coupons: 0, paper_coupons: 0,
    debt_added: 0, debt_paid: 0, amount_due: 0, empties: 0, pkg_count: 0, pkg_coupons: 0, pkg_cash: 0, no_trip: true });
  for (const p of debtPayments.rows) {
    if (p.trip_id) continue;
    let d = drivers.find((x) => x.driver_id != null && x.driver_id === p.created_by);
    if (!d) { d = blank(p.created_by, p.collected_by); drivers.push(d); }
    d.debt_cash = n((d.debt_cash || 0) + p.amount);
    d.debt_cash_count = (d.debt_cash_count || 0) + 1;
  }
  // بيع المحل (الكاشير): مع اللي باع
  for (const x of shopSales.rows) {
    let d = drivers.find((y) => y.driver_id != null && y.driver_id === x.created_by);
    if (!d) { d = blank(x.created_by, x.by_name); drivers.push(d); }
    d.shop_cash = n(x.total);
    d.shop_count = x.count;
  }
  // العهدة: مبلغ ثابت مع الشخص — بيبيّن لحاله وما بينحسب من الكاش
  for (const c of custody.rows) {
    const d = drivers.find((y) => y.driver_id === c.user_id);
    if (d) d.custody = n(c.amount);
  }
  // مصاريف المحطة (أخذ دينار…): بتنقص من اللي معه
  for (const e of stExp.rows) {
    let d = drivers.find((y) => y.driver_id != null && y.driver_id === e.user_id);
    if (!d) { d = blank(e.user_id, e.full_name); drivers.push(d); }
    d.st_expenses = n((d.st_expenses || 0) + e.amount);
  }
  for (const d of drivers) d.total_cash = n(d.cash + d.pkg_cash + (d.debt_cash || 0) + (d.shop_cash || 0) - (d.st_expenses || 0));
  const stExpTotal = n(stExp.rows.reduce((a, x) => a + x.amount, 0));
  const shopCash = n(shopSales.rows.reduce((a, x) => a + x.total, 0));
  const couponsUsed = drivers.reduce((s, d) => s + d.coupons, 0);
  const couponsPaper = drivers.reduce((s, d) => s + (d.paper_coupons || 0), 0);
  const tripCash = n(drivers.reduce((s, d) => s + d.cash, 0));
  const shopDebtPayments = n(debtPayments.rows.filter((p) => !p.trip_id).reduce((s, p) => s + p.amount, 0));
  const couponCash = n(couponSales.rows.reduce((s, x) => s + x.paid, 0));
  const exp = expenses.rows[0];
  const payrollOut = n(payroll.rows.reduce((s, x) => s + x.amount, 0));

  const moneyIn = n(tripCash + shopDebtPayments + couponCash + shopCash);
  const moneyOut = n(Number(exp.expenses) + payrollOut + stExpTotal);

  res.json({
    date,
    is_today: date === today,
    summary: {
      delivered: drivers.reduce((s, d) => s + d.delivered, 0),
      sales_value: n(drivers.reduce((s, d) => s + d.amount_due, 0)),
      trip_cash: tripCash,
      coupons_used: couponsUsed,
      coupons_paper: couponsPaper,
      coupons_electronic: couponsUsed - couponsPaper,
      packages_sold: couponSales.rows.length,
      coupons_sold: couponSales.rows.reduce((s, x) => s + x.coupons, 0),
      coupon_sales_value: n(couponSales.rows.reduce((s, x) => s + x.price, 0)),
      debt_added: n(newDebts.rows.reduce((s, x) => s + x.amount, 0)),
      debt_collected: n(debtPayments.rows.reduce((s, x) => s + x.amount, 0)),
      coupon_sales_cash: couponCash,
      shop_sales_cash: shopCash,
      shop_sales_count: shopSales.rows.reduce((a, x) => a + x.count, 0),
      shop_debt_payments: shopDebtPayments,
      expenses: n(exp.expenses),
      payroll_out: payrollOut,
      station_expenses: stExpTotal,
      money_in: moneyIn,
      money_out: moneyOut,
      net_cash: n(moneyIn - moneyOut),
      empties: drivers.reduce((s, d) => s + d.empties, 0),
      orders_created: ordersSummary.rows[0].orders_created,
      cancelled: ordersSummary.rows[0].cancelled,
    },
    drivers,
    debt_payments: debtPayments.rows,
    new_debts: newDebts.rows,
    coupon_sales: couponSales.rows,
    payroll: payroll.rows,
    custody: custody.rows,
    station_expenses: stExp.rows,
    expenses_notes: exp.notes,
    products: bottles.rows,
  });
});

// ============================================================
// كليك: التحويلات اللي الزبون قال إنه حوّلها وقت التسليم — صاحب المحل بيتأكد آخر اليوم
// ============================================================
async function insertNotification({ type, message, customerId, tripId }) {
  await query(
    "INSERT INTO notifications (type, message, related_customer_id, related_trip_id) VALUES ($1,$2,$3,$4)",
    [type, message, customerId || null, tripId || null]
  );
}
const canDecide = (u) => u.role === "super_admin" || can(u, "cash", "edit");

router.get("/cliq", async (req, res) => {
  const date = isDate(req.query.date) ? req.query.date : null;
  const rows = (await query(
    `SELECT ts.id, ts.cliq_amount, ts.cliq_status, ts.delivered_at, ts.cliq_decided_at,
            c.id AS customer_id, c.name AS customer_name, c.phone_normalized, u.full_name AS driver_name
     FROM trip_stops ts
     JOIN orders o ON o.id = ts.order_id
     JOIN customers c ON c.id = o.customer_id
     JOIN trips t ON t.id = ts.trip_id
     LEFT JOIN users u ON u.id = t.driver_id
     WHERE ts.cliq_status IS NOT NULL
       AND (ts.cliq_status = 'pending' OR ($1::date IS NOT NULL AND ${DAY_SQL("ts.delivered_at")}))
     ORDER BY (ts.cliq_status = 'pending') DESC, ts.delivered_at DESC
     LIMIT 300`,
    [date]
  )).rows;
  res.json({ can_decide: canDecide(req.user), rows });
});

router.post("/cliq/:id/:action", async (req, res) => {
  if (!canDecide(req.user)) return res.status(403).json({ error: "تأكيد الكليك لصاحب المحل أو اللي معه صلاحية الحساب اليومي." });
  const action = req.params.action;
  if (!["approve", "reject"].includes(action)) return res.status(400).json({ error: "طلب غير معروف." });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const st = (await client.query(
      `SELECT ts.*, o.customer_id, c.name AS customer_name FROM trip_stops ts
       JOIN orders o ON o.id = ts.order_id JOIN customers c ON c.id = o.customer_id
       WHERE ts.id = $1 FOR UPDATE OF ts`,
      [req.params.id]
    )).rows[0];
    if (!st || st.cliq_status !== "pending") {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "هاد الكليك انقرر قبل." });
    }
    const amount = n(st.cliq_amount);
    let newDebt = null;
    if (action === "reject") {
      // ما حوّل: المبلغ بيترحّل دين عليه
      const c = (await client.query("UPDATE customers SET debt_balance = debt_balance + $1 WHERE id = $2 RETURNING debt_balance", [amount, st.customer_id])).rows[0];
      newDebt = n(c.debt_balance);
      await client.query(
        `INSERT INTO customer_debt_ledger (customer_id, change_amount, reason, order_id, trip_id, balance_after, notes, created_by)
         VALUES ($1, $2, 'order_credit', $3, $4, $5, 'كليك ما وصل', $6)`,
        [st.customer_id, amount, st.order_id, st.trip_id, newDebt, req.user.id]
      );
    }
    await client.query(
      "UPDATE trip_stops SET cliq_status = $1, cliq_decided_at = now(), cliq_decided_by = $2 WHERE id = $3",
      [action === "approve" ? "approved" : "rejected", req.user.id, st.id]
    );
    await client.query("COMMIT");
    await logActivity({ userId: req.user.id, action: action === "approve" ? "CLIQ_APPROVE" : "CLIQ_REJECT", recordType: "trip_stop", recordId: st.id, newValue: { amount, customer: st.customer_name } }).catch(() => {});
    if (action === "reject") {
      await insertNotification({
        type: "DEBT",
        message: `💳 كليك ${st.customer_name} (${amount.toFixed(2)} JD) ما وصل — انضاف دين، صار عليه ${newDebt.toFixed(2)} JD`,
        customerId: st.customer_id,
        tripId: st.trip_id,
      }).catch(() => {});
    }
    res.json({ ok: true, status: action === "approve" ? "approved" : "rejected", debt_balance: newDebt });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
});

export default router;
