import { Router } from "express";
import { query } from "../../db.js";
import { can } from "../../permissions.js";
import { needAny, round2, jordanDate, alert, checkVehicleDocs } from "./lib.js";
import { loadTrips } from "./orders.js";
import { stockBalances } from "./stock.js";

// ============================================================
// المصنع: لوحة المالك، التنبيهات، التقارير، والمراقبة التلقائية
// ============================================================
const router = Router();
const home = needAny(["f_home"], ["f_reports"]);

router.get("/home", needAny(["f_home"]), async (req, res) => {
  const today = jordanDate();
  const [prod, sales, debts, trips, alerts, vehicles, pendingExp, stock, openOrders, dmgMonth] = await Promise.all([
    query("SELECT COALESCE(SUM(qty),0)::int AS n FROM f_stock_moves WHERE kind = 'production' AND (created_at AT TIME ZONE 'Asia/Amman')::date = $1", [today]),
    query(
      `SELECT COALESCE(SUM(delivered_total),0) AS total, COALESCE(SUM(cash_paid),0) AS cash, COUNT(*)::int AS n,
              COALESCE((SELECT SUM(COALESCE(i.delivered_qty, 0)) FROM f_order_items i JOIN f_orders o2 ON o2.id = i.order_id WHERE o2.status = 'delivered' AND (o2.delivered_at AT TIME ZONE 'Asia/Amman')::date = $1), 0)::int AS cartons
       FROM f_orders WHERE status = 'delivered' AND (delivered_at AT TIME ZONE 'Asia/Amman')::date = $1`,
      [today]
    ),
    query("SELECT COALESCE(SUM(balance),0) AS total, COUNT(*)::int AS n FROM f_customers WHERE active AND balance > 0.009"),
    loadTrips("t.status IN ('planned','active','returned') OR (t.trip_date = $1 AND t.status <> 'cancelled')", [today]),
    query("SELECT * FROM f_alerts WHERE closed_at IS NULL ORDER BY CASE level WHEN 'crit' THEN 0 WHEN 'warn' THEN 1 ELSE 2 END, id DESC LIMIT 30"),
    query("SELECT v.*, u.full_name AS driver_name FROM f_vehicles v LEFT JOIN users u ON u.id = v.driver_id WHERE v.status <> 'inactive' ORDER BY v.id"),
    query("SELECT COUNT(*)::int AS n FROM f_expenses WHERE status = 'pending'"),
    stockBalances(),
    query("SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE trip_id IS NULL)::int AS unassigned FROM f_orders WHERE status IN ('new','assigned','onway','delayed')"),
    query(
      `SELECT COALESCE(SUM(m.qty),0)::int AS n, COALESCE(SUM(m.qty * p.price),0) AS value FROM f_stock_moves m JOIN f_products p ON p.id = m.product_id
       WHERE m.kind = 'damage' AND date_trunc('month', m.created_at AT TIME ZONE 'Asia/Amman') = date_trunc('month', now() AT TIME ZONE 'Asia/Amman')`
    ),
  ]);
  const cashWithDrivers = round2(trips.filter((t) => ["active", "returned"].includes(t.status) && !t.settled_at).reduce((s, t) => s + t.cash_due, 0));
  const vstate = vehicles.rows.map((v) => {
    const t = trips.find((x) => x.vehicle_id === v.id && ["active", "returned", "planned"].includes(x.status));
    let state = v.status === "workshop" ? "shop" : "idle";
    if (t?.status === "active") state = t.tracking_lost ? "lost" : t.late ? "late" : "move";
    else if (t?.status === "returned") state = "back";
    else if (t?.status === "planned") state = "planned";
    return { id: v.id, name: v.name, driver_name: v.driver_name, governorate: v.governorate, lat: v.last_lat, lng: v.last_lng, last_seen_at: v.last_seen_at, state, trip_id: t?.id || null, done: t?.done || 0, stops: t?.stops.length || 0, load: t?.load || 0, capacity: v.capacity };
  });
  res.json({
    date: today,
    production: prod.rows[0].n,
    sales: { total: round2(sales.rows[0].total), cash: round2(sales.rows[0].cash), orders: sales.rows[0].n, cartons: sales.rows[0].cartons },
    cash_with_drivers: cashWithDrivers,
    debts: { total: round2(debts.rows[0].total), customers: debts.rows[0].n },
    open_orders: openOrders.rows[0],
    pending_expenses: pendingExp.rows[0].n,
    damage_month: { cartons: dmgMonth.rows[0].n, value: round2(dmgMonth.rows[0].value) },
    low_stock: stock.filter((p) => p.min_stock > 0 && p.balance <= p.min_stock).map((p) => ({ id: p.id, name: p.name, balance: p.balance, min: p.min_stock })),
    alerts: alerts.rows,
    vehicles: vstate,
    trips_today: trips.length,
  });
});

router.get("/alerts", needAny(["f_home"], ["f_money"], ["f_dispatch"]), async (req, res) => {
  const r = await query(
    `SELECT a.*, u.full_name AS closed_by_name FROM f_alerts a LEFT JOIN users u ON u.id = a.closed_by
     WHERE a.closed_at IS NULL OR a.closed_at > now() - interval '2 days' ORDER BY a.closed_at IS NOT NULL, a.id DESC LIMIT 120`
  );
  res.json(r.rows);
});

router.get("/alerts/count", async (req, res) => {
  if (!can(req.user, "f_home") && !can(req.user, "f_money") && !can(req.user, "f_dispatch")) return res.json({ open: 0 });
  const r = await query("SELECT COUNT(*)::int AS n FROM f_alerts WHERE closed_at IS NULL AND level IN ('crit','warn')");
  res.json({ open: r.rows[0].n });
});

router.post("/alerts/:id/close", needAny(["f_home"], ["f_money"], ["f_dispatch"]), async (req, res) => {
  await query("UPDATE f_alerts SET closed_at = now(), closed_by = $1 WHERE id = $2 AND closed_at IS NULL", [req.user.id, req.params.id]);
  res.json({ ok: true });
});

// ---------- التقارير ----------
router.get("/reports", home, async (req, res) => {
  const isD = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || "");
  const to = isD(req.query.to) ? req.query.to : jordanDate();
  const from = isD(req.query.from) ? req.query.from : `${to.slice(0, 7)}-01`;
  const P = [from, to];
  const dl = "(o.delivered_at AT TIME ZONE 'Asia/Amman')::date BETWEEN $1 AND $2";
  const [byVehicle, byProduct, byCity, topCustomers, damage, damageDrivers, damageMachines, fuel, drivers, expenses, production, collections] = await Promise.all([
    query(
      `SELECT v.id, v.name, COUNT(DISTINCT t.id)::int AS trips, COUNT(o.id)::int AS orders, COALESCE(SUM(o.delivered_total),0) AS sales,
              COALESCE((SELECT SUM(e.amount) FROM f_expenses e WHERE e.vehicle_id = v.id AND e.status <> 'rejected' AND (e.created_at AT TIME ZONE 'Asia/Amman')::date BETWEEN $1 AND $2),0) AS expenses
       FROM f_vehicles v LEFT JOIN f_trips t ON t.vehicle_id = v.id AND t.trip_date BETWEEN $1 AND $2
       LEFT JOIN f_orders o ON o.trip_id = t.id AND o.status = 'delivered'
       GROUP BY v.id ORDER BY sales DESC`,
      P
    ),
    query(
      `SELECT p.id, p.name, COALESCE(SUM(i.delivered_qty),0)::int AS cartons, COALESCE(SUM(COALESCE(i.delivered_bonus, 0)),0)::int AS bonus, COALESCE(SUM(i.delivered_qty * i.price),0) AS sales
       FROM f_order_items i JOIN f_orders o ON o.id = i.order_id JOIN f_products p ON p.id = i.product_id
       WHERE o.status = 'delivered' AND ${dl} GROUP BY p.id ORDER BY sales DESC`,
      P
    ),
    query(
      `SELECT COALESCE(c.city,'بدون مدينة') AS city, COUNT(o.id)::int AS orders, COALESCE(SUM(o.delivered_total),0) AS sales
       FROM f_orders o JOIN f_customers c ON c.id = o.customer_id WHERE o.status = 'delivered' AND ${dl} GROUP BY 1 ORDER BY sales DESC`,
      P
    ),
    query(
      `SELECT c.id, c.name, c.city, COUNT(o.id)::int AS orders, COALESCE(SUM(o.delivered_total),0) AS sales, c.balance
       FROM f_orders o JOIN f_customers c ON c.id = o.customer_id WHERE o.status = 'delivered' AND ${dl} GROUP BY c.id ORDER BY sales DESC LIMIT 10`,
      P
    ),
    query(
      `SELECT m.damage_source AS source, COALESCE(SUM(m.qty),0)::int AS cartons, COALESCE(SUM(m.qty * p.price),0) AS value
       FROM f_stock_moves m JOIN f_products p ON p.id = m.product_id
       WHERE m.kind = 'damage' AND (m.created_at AT TIME ZONE 'Asia/Amman')::date BETWEEN $1 AND $2 GROUP BY 1`,
      P
    ),
    query(
      `SELECT u.full_name AS name, v.name AS vehicle, COALESCE(SUM(m.qty),0)::int AS cartons
       FROM f_stock_moves m JOIN f_vehicles v ON v.id = m.vehicle_id LEFT JOIN f_trips t ON t.id = m.trip_id LEFT JOIN users u ON u.id = COALESCE(t.driver_id, v.driver_id)
       WHERE m.kind = 'damage' AND m.damage_source = 'vehicle' AND (m.created_at AT TIME ZONE 'Asia/Amman')::date BETWEEN $1 AND $2
       GROUP BY u.full_name, v.name ORDER BY cartons DESC`,
      P
    ),
    query(
      `SELECT mc.name, COALESCE(SUM(m.qty),0)::int AS cartons,
              (SELECT COUNT(*)::int FROM f_downtime d WHERE d.machine_id = mc.id AND (d.started_at AT TIME ZONE 'Asia/Amman')::date BETWEEN $1 AND $2) AS stops,
              (SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(d.ended_at, now()) - d.started_at)))/60,0)::int FROM f_downtime d WHERE d.machine_id = mc.id AND (d.started_at AT TIME ZONE 'Asia/Amman')::date BETWEEN $1 AND $2) AS minutes,
              (SELECT d.reason FROM f_downtime d WHERE d.machine_id = mc.id AND (d.started_at AT TIME ZONE 'Asia/Amman')::date BETWEEN $1 AND $2 GROUP BY d.reason ORDER BY COUNT(*) DESC LIMIT 1) AS top_reason,
              (SELECT COUNT(*)::int FROM f_downtime d WHERE d.machine_id = mc.id AND (d.started_at AT TIME ZONE 'Asia/Amman')::date BETWEEN $1 AND $2 AND d.reason = (SELECT d2.reason FROM f_downtime d2 WHERE d2.machine_id = mc.id AND (d2.started_at AT TIME ZONE 'Asia/Amman')::date BETWEEN $1 AND $2 GROUP BY d2.reason ORDER BY COUNT(*) DESC LIMIT 1)) AS top_reason_count
       FROM f_machines mc LEFT JOIN f_stock_moves m ON m.machine_id = mc.id AND m.kind = 'damage' AND (m.created_at AT TIME ZONE 'Asia/Amman')::date BETWEEN $1 AND $2
       GROUP BY mc.id ORDER BY cartons DESC`,
      P
    ),
    query(
      `SELECT v.id, v.name,
              COALESCE((SELECT SUM(e.liters) FROM f_expenses e WHERE e.vehicle_id = v.id AND e.kind = 'ديزل' AND e.status <> 'rejected' AND (e.created_at AT TIME ZONE 'Asia/Amman')::date BETWEEN $1 AND $2),0) AS liters,
              COALESCE((SELECT SUM(e.amount) FROM f_expenses e WHERE e.vehicle_id = v.id AND e.kind = 'ديزل' AND e.status <> 'rejected' AND (e.created_at AT TIME ZONE 'Asia/Amman')::date BETWEEN $1 AND $2),0) AS cost,
              COALESCE((SELECT SUM(t.odo_end - t.odo_start) FROM f_trips t WHERE t.vehicle_id = v.id AND t.odo_end IS NOT NULL AND t.trip_date BETWEEN $1 AND $2),0)::int AS km,
              COALESCE((SELECT SUM(t.gps_km) FROM f_trips t WHERE t.vehicle_id = v.id AND t.trip_date BETWEEN $1 AND $2),0) AS gps_km
       FROM f_vehicles v ORDER BY v.id`,
      P
    ),
    query(
      `SELECT u.id, u.full_name AS name, COUNT(DISTINCT t.id)::int AS trips,
              COUNT(o.id) FILTER (WHERE o.status = 'delivered')::int AS delivered, COUNT(o.id) FILTER (WHERE o.status = 'failed')::int AS failed,
              COUNT(o.id) FILTER (WHERE o.status = 'delivered' AND o.eta_at IS NOT NULL AND o.delivered_at > o.eta_at + interval '30 minutes')::int AS late,
              COALESCE((SELECT SUM(l.amount) FROM f_driver_ledger l WHERE l.driver_id = u.id AND l.kind = 'shortage' AND (l.created_at AT TIME ZONE 'Asia/Amman')::date BETWEEN $1 AND $2),0) AS shortage
       FROM users u JOIN f_trips t ON t.driver_id = u.id AND t.trip_date BETWEEN $1 AND $2 LEFT JOIN f_orders o ON o.trip_id = t.id
       GROUP BY u.id ORDER BY delivered DESC`,
      P
    ),
    query(
      `SELECT kind, COUNT(*)::int AS n, COALESCE(SUM(amount),0) AS total FROM f_expenses
       WHERE status <> 'rejected' AND (created_at AT TIME ZONE 'Asia/Amman')::date BETWEEN $1 AND $2 GROUP BY kind ORDER BY total DESC`,
      P
    ),
    query(
      `SELECT to_char((created_at AT TIME ZONE 'Asia/Amman')::date, 'YYYY-MM-DD') AS day, SUM(qty)::int AS cartons FROM f_stock_moves
       WHERE kind = 'production' AND (created_at AT TIME ZONE 'Asia/Amman')::date BETWEEN $1 AND $2 GROUP BY 1 ORDER BY 1`,
      P
    ),
    query(
      `SELECT COALESCE(SUM(-amount) FILTER (WHERE kind = 'payment'),0) AS collected, COALESCE(SUM(amount) FILTER (WHERE kind = 'invoice'),0) AS invoiced
       FROM f_ledger WHERE (created_at AT TIME ZONE 'Asia/Amman')::date BETWEEN $1 AND $2`,
      P
    ),
  ]);
  const num = (rows, keys) => rows.map((r) => { const x = { ...r }; for (const k of keys) x[k] = round2(r[k]); return x; });
  const fleetFuel = fuel.rows.map((v) => ({ ...v, liters: Number(v.liters), cost: round2(v.cost), gps_km: Math.round(Number(v.gps_km)), per100: v.km > 0 && Number(v.liters) > 0 ? round2((Number(v.liters) / v.km) * 100) : null }));
  const rated = fleetFuel.filter((v) => v.per100);
  const avg = rated.length ? round2(rated.reduce((s, v) => s + v.per100, 0) / rated.length) : null;
  res.json({
    from, to,
    by_vehicle: num(byVehicle.rows, ["sales", "expenses"]).map((v) => ({ ...v, net: round2(v.sales - v.expenses) })),
    by_product: num(byProduct.rows, ["sales"]),
    by_city: num(byCity.rows, ["sales"]),
    top_customers: num(topCustomers.rows, ["sales", "balance"]),
    damage: num(damage.rows, ["value"]),
    damage_drivers: damageDrivers.rows,
    damage_machines: machinesFix(damageMachines.rows),
    fuel: fleetFuel.map((v) => ({ ...v, high: avg && v.per100 ? v.per100 > avg * 1.2 : false })),
    fuel_avg: avg,
    drivers: num(drivers.rows, ["shortage"]),
    expenses: num(expenses.rows, ["total"]),
    production: production.rows,
    collections: { collected: round2(collections.rows[0].collected), invoiced: round2(collections.rows[0].invoiced) },
  });
});

function machinesFix(rows) {
  return rows.map((r) => ({ ...r, minutes: Number(r.minutes) || 0 }));
}

// ---------- مراقبة تلقائية كل ١٠ دقايق (السيرفر بيشغلها لكل مصنع) ----------
export async function factoryWatch() {
  await checkVehicleDocs();
  // سائق متأخر عن موعد زبون أكثر من نص ساعة
  const late = (await query(
    `SELECT o.id, o.eta_at, c.name, v.name AS vehicle, u.full_name AS driver
     FROM f_orders o JOIN f_customers c ON c.id = o.customer_id JOIN f_trips t ON t.id = o.trip_id
     JOIN f_vehicles v ON v.id = t.vehicle_id LEFT JOIN users u ON u.id = t.driver_id
     WHERE o.status = 'onway' AND t.status = 'active' AND o.eta_at < now() - interval '30 minutes'`
  )).rows;
  for (const o of late) {
    const mins = Math.round((Date.now() - new Date(o.eta_at).getTime()) / 60000);
    await alert({ level: "crit", kind: "late", ref: o.id, title: `${o.vehicle} متأخرة ${mins} دقيقة`, body: `عن موعد ${o.name}. السائق ${o.driver || ""}.`, dedupe: true });
  }
  // التتبع انقطع (التلفون انطفى أو الموقع مسكّر)
  const lost = (await query(
    `SELECT t.id, v.name, v.last_seen_at, u.full_name AS driver FROM f_trips t JOIN f_vehicles v ON v.id = t.vehicle_id LEFT JOIN users u ON u.id = t.driver_id
     WHERE t.status = 'active' AND (v.last_seen_at IS NULL OR v.last_seen_at < now() - interval '15 minutes')`
  )).rows;
  for (const t of lost) {
    const at = t.last_seen_at ? new Date(t.last_seen_at).toLocaleTimeString("ar-JO-u-nu-latn", { timeZone: "Asia/Amman", hour: "numeric", minute: "2-digit" }) : "من بداية الرحلة";
    await alert({ level: "crit", kind: "tracking", ref: t.id, title: `التتبع انقطع — ${t.name}`, body: `${t.driver || "السائق"} · آخر موقع ${at}. ممكن التلفون طفى أو التطبيق تسكّر.`, dedupe: true });
  }
}

export default router;
