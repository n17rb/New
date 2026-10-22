import { Router } from "express";
import { query } from "../../db.js";
import { canAction } from "../../permissions.js";
import { needAny, need, round2, jordanDate } from "./lib.js";
import { loadTrips } from "./orders.js";

// ============================================================
// الجرد اليومي: لكل سائق بشاشة وحدة —
// البضاعة (حمّل / سلّم / بونص / استبدال / تالف / لازم يرجع / رجع)،
// المصاري (فواتير / كاش / دين / مصاريف / المطلوب / سلّم)، وكل الفواتير تحت بعض
// ============================================================
const router = Router();
const viewJard = needAny(["f_money"], ["f_home"], ["f_stock"], ["f_dispatch"]);

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "");

async function buildJard(date, driverId = null) {
  const params = [date];
  let where = `t.status <> 'cancelled' AND (t.trip_date = $1 OR (t.started_at AT TIME ZONE 'Asia/Amman')::date = $1)`;
  if (driverId) { params.push(driverId); where += ` AND t.driver_id = $2`; }
  const trips = await loadTrips(where, params);
  if (!trips.length) return [];
  const ids = trips.map((t) => t.id);
  const [returns, ledger] = await Promise.all([
    query(
      `SELECT trip_id, product_id, SUM(qty)::int AS qty FROM f_stock_moves WHERE trip_id = ANY($1::int[]) AND kind = 'return' GROUP BY trip_id, product_id`,
      [ids]
    ),
    query(
      "SELECT driver_id, COALESCE(SUM(amount),0) AS bal FROM f_driver_ledger WHERE driver_id = ANY($1::int[]) GROUP BY driver_id",
      [[...new Set(trips.map((t) => t.driver_id).filter(Boolean))]]
    ),
  ]);

  const tripView = (t) => {
    // البضاعة لكل منتج
    const per = new Map();
    const row = (pid, name) => {
      if (!per.has(pid)) per.set(pid, { product_id: pid, name, loaded: 0, delivered: 0, bonus: 0, exchanged: 0, damaged: 0, returned: 0 });
      return per.get(pid);
    };
    for (const m of t.loaded_per || []) row(m.product_id, m.name).loaded += m.qty;
    const delivered = t.stops.filter((o) => o.status === "delivered");
    for (const o of delivered) {
      for (const i of o.items) {
        const r = row(i.product_id, i.name);
        r.delivered += i.delivered_qty ?? i.qty;
        r.bonus += i.delivered_bonus ?? i.bonus_qty ?? 0;
      }
      for (const x of o.exchanges || []) row(x.product_id, x.name).exchanged += x.qty;
    }
    for (const d of t.damaged_per || []) row(d.product_id, d.name).damaged += d.qty;
    for (const r of returns.rows.filter((x) => x.trip_id === t.id)) {
      const name = t.loaded_per?.find((m) => m.product_id === r.product_id)?.name || "";
      row(r.product_id, name).returned += r.qty;
    }
    const goods = [...per.values()].map((g) => {
      const back = t.load_confirmed_at ? g.loaded - g.delivered - g.bonus - g.exchanged - g.damaged : 0;
      return { ...g, back: Math.max(0, back), short: t.returns_received_at ? Math.max(0, back - g.returned) : null };
    });

    const invoicesTotal = round2(delivered.reduce((a, o) => a + Number(o.delivered_total || 0), 0));
    const cash = round2(delivered.reduce((a, o) => a + Number(o.cash_paid || 0), 0));
    const expOk = t.expenses.filter((e) => e.status !== "rejected");
    return {
      id: t.id, kind: t.kind || "orders", status: t.status, vehicle_name: t.vehicle_name, trip_date: t.trip_date,
      started_at: t.started_at, returned_at: t.returned_at,
      load_confirmed: !!t.load_confirmed_at, returns_received_at: t.returns_received_at, settled_at: t.settled_at,
      goods,
      money: {
        invoices: invoicesTotal, cash, debt: round2(invoicesTotal - cash),
        expenses: round2(expOk.reduce((a, e) => a + e.amount, 0)),
        expenses_pending: round2(t.expenses.filter((e) => e.status === "pending").reduce((a, e) => a + e.amount, 0)),
        due: round2(t.cash_due), handed: t.handed_cash, diff: t.cash_diff,
      },
      expenses: t.expenses.map((e) => ({ id: e.id, kind: e.kind, amount: e.amount, status: e.status, photo_url: e.photo_url, note: e.note, liters: e.liters, created_at: e.created_at, reject_reason: e.reject_reason })),
      invoices: delivered.sort((a, b) => new Date(a.delivered_at) - new Date(b.delivered_at)).map((o) => ({
        id: o.id, customer_name: o.customer_name, city: o.city, phone: o.phone, delivered_at: o.delivered_at,
        total: Number(o.delivered_total || 0), cash: Number(o.cash_paid || 0), debt: round2(Number(o.delivered_total || 0) - Number(o.cash_paid || 0)),
        invoice_token: o.invoice_token, proof_photo: o.proof_photo, signed: !!o.signature, sale: o.notes === "بيع مندوب",
        items: o.items.map((i) => ({ name: i.name, qty: i.delivered_qty ?? i.qty, ordered: i.qty, bonus: i.delivered_bonus ?? i.bonus_qty ?? 0, damaged: i.damaged_qty || 0, price: i.price })),
        exchanges: (o.exchanges || []).map((x) => ({ name: x.name, qty: x.qty })),
      })),
      failed: t.stops.filter((o) => o.status === "failed").map((o) => ({ id: o.id, customer_name: o.customer_name, reason: o.fail_reason, cartons: o.cartons })),
      open: t.stops.filter((o) => ["assigned", "onway", "delayed"].includes(o.status)).map((o) => ({ id: o.id, customer_name: o.customer_name, cartons: o.cartons })),
    };
  };

  // نجمّع حسب السائق
  const byDriver = new Map();
  for (const t of trips) {
    const key = t.driver_id || 0;
    if (!byDriver.has(key)) byDriver.set(key, { driver_id: t.driver_id, driver_name: t.driver_name || "بدون سائق", trips: [] });
    byDriver.get(key).trips.push(tripView(t));
  }
  return [...byDriver.values()].map((d) => {
    const sum = (f) => round2(d.trips.reduce((a, t) => a + (f(t) || 0), 0));
    const goods = new Map();
    for (const t of d.trips) for (const g of t.goods) {
      const x = goods.get(g.product_id) || { product_id: g.product_id, name: g.name, loaded: 0, delivered: 0, bonus: 0, exchanged: 0, damaged: 0, back: 0, returned: 0 };
      for (const k of ["loaded", "delivered", "bonus", "exchanged", "damaged", "back", "returned"]) x[k] += g[k];
      goods.set(g.product_id, x);
    }
    const open = d.trips.filter((t) => !t.settled_at);
    return {
      ...d,
      custody: round2(Number(ledger.rows.find((l) => l.driver_id === d.driver_id)?.bal || 0)),
      totals: {
        invoices: sum((t) => t.money.invoices), cash: sum((t) => t.money.cash), debt: sum((t) => t.money.debt),
        expenses: sum((t) => t.money.expenses), due: sum((t) => t.money.due),
        handed: sum((t) => t.money.handed), due_open: round2(open.reduce((a, t) => a + t.money.due, 0)),
        settled: open.length === 0,
        invoices_count: d.trips.reduce((a, t) => a + t.invoices.length, 0),
        cartons_out: d.trips.reduce((a, t) => a + t.goods.reduce((b, g) => b + g.delivered + g.bonus + g.exchanged, 0), 0),
        cartons_back: [...goods.values()].reduce((a, g) => a + g.back, 0),
        damaged_from_customers: d.trips.reduce((a, t) => a + t.goods.reduce((b, g) => b + g.exchanged, 0), 0),
      },
      goods: [...goods.values()],
    };
  }).sort((a, b) => b.totals.invoices - a.totals.invoices);
}

router.get("/jard", viewJard, async (req, res) => {
  const date = isDate(req.query.date) ? req.query.date : jordanDate();
  const drivers = await buildJard(date, Number(req.query.driver_id) || null);
  res.json({ date, drivers, can_review: canAction(req.user, "approve_expense") });
});

// جردي أنا (السائق)
router.get("/driver/jard", need("f_drive", "edit"), async (req, res) => {
  const date = isDate(req.query.date) ? req.query.date : jordanDate();
  res.json({ date, drivers: await buildJard(date, req.user.id), mine: true });
});

export default router;
