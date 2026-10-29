import { Router } from "express";
import { query } from "../../db.js";
import { can, canAction } from "../../permissions.js";
import { needAny, need, round2, jordanDate } from "./lib.js";
import { loadTrips } from "./orders.js";
import { settleTrip } from "./money.js";
import { alert, bad, pushTo } from "./lib.js";

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
  // رحلات اليوم + أي رحلة لسا مفتوحة (طلعت مبارح ولسا ما انحاسبت، أو جولة مندوب شغالة) — عشان ولا سائق شغال يغيب عن الجرد
  const openToo = date === jordanDate() ? ` OR (t.status = 'planned' AND t.trip_date <= $1) OR t.status = 'active' OR (t.status = 'returned' AND t.settled_at IS NULL)` : "";
  let where = `t.status <> 'cancelled' AND (t.trip_date = $1 OR (t.started_at AT TIME ZONE 'Asia/Amman')::date = $1${openToo})`;
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
      const back = g.loaded - g.delivered - g.bonus - g.exchanged - g.damaged;
      // سلّم أكثر من اللي انسجّل إنه طلع = تحميل ما انسجّل
      return { ...g, back: Math.max(0, back), over: Math.max(0, -back), short: t.returns_received_at ? Math.max(0, back - g.returned) : null };
    });

    const invoicesTotal = round2(delivered.reduce((a, o) => a + Number(o.delivered_total || 0), 0));
    const cashInv = round2(delivered.reduce((a, o) => a + Number(o.cash_paid || 0), 0));
    const cash = round2(cashInv + (t.debt_collected || 0));
    const expOk = t.expenses.filter((e) => e.status !== "rejected");
    return {
      id: t.id, kind: t.kind || "orders", status: t.status, vehicle_name: t.vehicle_name, trip_date: t.trip_date,
      started_at: t.started_at, returned_at: t.returned_at,
      load_confirmed: !!t.load_confirmed_at, returns_received_at: t.returns_received_at, settled_at: t.settled_at,
      goods,
      money: {
        invoices: invoicesTotal, cash, debt: round2(invoicesTotal - cashInv), debt_collected: t.debt_collected || 0,
        expenses: round2(expOk.reduce((a, e) => a + e.amount, 0)),
        expenses_pending: round2(t.expenses.filter((e) => e.status === "pending").reduce((a, e) => a + e.amount, 0)),
        due: round2(t.cash_due), handed: t.handed_cash, diff: t.cash_diff,
      },
      expenses: t.expenses.map((e) => ({ id: e.id, kind: e.kind, amount: e.amount, status: e.status, photo_url: e.photo_url, note: e.note, liters: e.liters, created_at: e.created_at, reject_reason: e.reject_reason })),
      invoices: delivered.sort((a, b) => new Date(a.delivered_at) - new Date(b.delivered_at)).map((o) => ({
        id: o.id, customer_name: o.customer_name, city: o.city, phone: o.phone, delivered_at: o.delivered_at,
        total: Number(o.delivered_total || 0), cash: Number(o.cash_paid || 0), debt: round2(Number(o.delivered_total || 0) - Number(o.cash_paid || 0)),
        invoice_token: o.invoice_token, proof_photo: o.proof_photo, edited_at: o.edited_at, edited_by_name: o.edited_by_name, signed: !!o.signature, sale: o.notes === "بيع مندوب",
        items: o.items.map((i) => ({ name: i.name, qty: i.delivered_qty ?? i.qty, ordered: i.qty, bonus: i.delivered_bonus ?? i.bonus_qty ?? 0, damaged: i.damaged_qty || 0, price: i.price })),
        exchanges: (o.exchanges || []).map((x) => ({ name: x.name, qty: x.qty })),
      })),
      collections: (t.debt_collections || []).map((g) => ({ id: g.id, customer_name: g.customer_name, amount: g.amount, at: g.created_at })),
      failed: t.stops.filter((o) => o.status === "failed").map((o) => ({ id: o.id, customer_name: o.customer_name, reason: o.fail_reason, cartons: o.cartons })),
      open: t.stops.filter((o) => ["assigned", "onway", "delayed"].includes(o.status)).map((o) => ({ id: o.id, customer_name: o.customer_name, cartons: o.cartons })),
    };
  };

  // الرحلات اللي رجعت ولسا ما انستلم كاشها (من اليوم أو من قبل) — للتسوية
  const drvIds = [...new Set(trips.map((t) => t.driver_id).filter(Boolean))];
  const unsettled = drvIds.length ? await loadTrips("t.driver_id = ANY($1::int[]) AND t.status = 'returned' AND t.settled_at IS NULL", [drvIds]) : [];
  const settleView = (t) => ({
    id: t.id, vehicle_name: t.vehicle_name, trip_date: t.trip_date, kind: t.kind || "orders",
    cash: round2(t.collected), expenses: round2(t.expenses_total), due: round2(t.cash_due),
    expenses_list: t.expenses.map((e) => ({ id: e.id, kind: e.kind, amount: e.amount, status: e.status, photo_url: e.photo_url, note: e.note })),
  });

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
      const x = goods.get(g.product_id) || { product_id: g.product_id, name: g.name, loaded: 0, delivered: 0, bonus: 0, exchanged: 0, damaged: 0, back: 0, returned: 0, over: 0 };
      for (const k of ["loaded", "delivered", "bonus", "exchanged", "damaged", "back", "returned", "over"]) x[k] += g[k];
      goods.set(g.product_id, x);
    }
    const open = d.trips.filter((t) => !t.settled_at);
    const toSettle = unsettled.filter((t) => t.driver_id === d.driver_id).sort((a, b) => a.trip_date.localeCompare(b.trip_date) || a.id - b.id).map(settleView);
    return {
      ...d,
      settle: {
        trips: toSettle,
        due: round2(toSettle.reduce((a, t) => a + t.due, 0)),
        older: round2(toSettle.filter((t) => !d.trips.some((x) => x.id === t.id)).reduce((a, t) => a + t.due, 0)),
        active: d.trips.filter((t) => t.status === "active").length,
      },
      custody: round2(Number(ledger.rows.find((l) => l.driver_id === d.driver_id)?.bal || 0)),
      totals: {
        invoices: sum((t) => t.money.invoices), cash: sum((t) => t.money.cash), debt: sum((t) => t.money.debt), debt_collected: sum((t) => t.money.debt_collected),
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
  // السواقين اللي ما إلهم ولا رحلة بهاليوم — عشان تعرف إنهم موجودين
  let idle = [];
  if (!req.query.driver_id && (can(req.user, "f_money") || can(req.user, "f_home") || can(req.user, "f_dispatch"))) {
    const us = (await query("SELECT id, full_name, role, permissions FROM users WHERE status = 'active' AND role <> 'super_admin'")).rows;
    const has = new Set(drivers.map((d) => d.driver_id));
    idle = us.filter((u) => can(u, "f_drive", "edit") && !has.has(u.id)).map((u) => ({ id: u.id, name: u.full_name }));
  }
  res.json({ date, drivers, idle_drivers: idle, can_review: canAction(req.user, "approve_expense"), can_settle: can(req.user, "f_money", "edit") });
});

// تسوية: استلمت من السائق — كل رحلاته اللي رجعت ولسا ما انحاسبت، الأقدم أول
router.post("/jard/settle", need("f_money", "edit"), async (req, res) => {
  const driverId = Number(req.body?.driver_id);
  const handed = round2(req.body?.handed);
  if (!driverId) return bad(res, "اختار السائق.");
  if (!(handed >= 0)) return bad(res, "اكتب المبلغ اللي استلمته.");
  const trips = (await loadTrips("t.driver_id = $1 AND t.status = 'returned' AND t.settled_at IS NULL", [driverId]))
    .sort((a, b) => a.trip_date.localeCompare(b.trip_date) || a.id - b.id);
  if (!trips.length) return bad(res, "ما في رحلات راجعة بدها تسوية. إذا السائق لسا شغال، خليه يكبس «رجعت للمصنع» أول.");
  const pending = trips.flatMap((t) => t.expenses.filter((e) => e.status === "pending"));
  if (pending.length) return bad(res, `في ${pending.length} مصروف لسا ما وافقت عليه أو رفضته — قرّر فيهم أول.`);
  let left = handed;
  const out = [];
  trips.forEach((t, i) => {
    const due = round2(t.cash_due);
    const give = i === trips.length - 1 ? left : Math.min(due, left);
    left = round2(left - give);
    out.push([t, round2(give)]);
  });
  let required = 0, done = 0;
  for (const [t, give] of out) { const r = await settleTrip(t, give, req.user); if (!r.skipped) { done++; required += r.required; } }
  if (!done) return bad(res, "التسوية انسجّلت من قبل — حدّث الصفحة.");
  required = round2(required);
  const diff = round2(required - handed);
  const name = trips[0].driver_name || "السائق";
  if (diff > 0) await alert({ level: "crit", kind: "cash_short", ref: trips[0].id, title: `نقص ${diff.toFixed(2)} د.أ بكاش ${name}`, body: `المطلوب ${required.toFixed(2)} والمسلّم ${handed.toFixed(2)}. انسجّل عهدة عليه.` });
  else await alert({ level: "ok", kind: "cash_ok", ref: trips[0].id, title: `${name} سلّم ${handed.toFixed(2)} د.أ`, body: diff < 0 ? `زيادة ${(-diff).toFixed(2)} عن المطلوب.` : "مطابق للمطلوب ✓" });
  res.json({ ok: true, required, handed, diff, trips: trips.length });
});

// الإدارة بتعدّل اللي محمّل على السيارة (السائق ما بيقدر) — بنسجّل الفرق حركة تحميل
router.post("/trips/:id/load-edit", needAny(["f_dispatch", "edit"], ["f_stock", "edit"]), async (req, res) => {
  const t = (await query("SELECT t.*, v.name AS vehicle_name FROM f_trips t JOIN f_vehicles v ON v.id = t.vehicle_id WHERE t.id = $1", [req.params.id])).rows[0];
  if (!t) return bad(res, "الرحلة غير موجودة.", 404);
  if (!["planned", "active", "returned"].includes(t.status)) return bad(res, "الرحلة تسكّرت — ما بتنعدّل حمولتها.");
  if (t.returns_received_at) return bad(res, "المرتجع انستلم — صحّح من المستودع.");
  const reason = String(req.body?.reason || "").trim().slice(0, 200) || "تعديل من الإدارة";
  const cur = new Map((await query("SELECT product_id, SUM(qty)::int AS q FROM f_stock_moves WHERE trip_id = $1 AND kind = 'load' GROUP BY product_id", [t.id])).rows.map((r) => [r.product_id, r.q]));
  const changes = [];
  for (const x of Array.isArray(req.body?.items) ? req.body.items : []) {
    if (x.loaded === "" || x.loaded === null || x.loaded === undefined) continue; // خانة فاضية = ما تغيّر
    const pid = Number(x.product_id), want = Math.round(Number(x.loaded));
    if (!pid || !(want >= 0) || want > 100000) continue;
    const p = (await query("SELECT id, name FROM f_products WHERE id = $1", [pid])).rows[0];
    if (!p) continue;
    const diff = want - (cur.get(pid) || 0);
    if (!diff) continue;
    await query("INSERT INTO f_stock_moves (product_id, kind, qty, trip_id, vehicle_id, reason, created_by) VALUES ($1,'load',$2,$3,$4,$5,$6)", [pid, diff, t.id, t.vehicle_id, `تعديل الحمولة: ${reason}`, req.user.id]);
    changes.push(`${p.name} ${cur.get(pid) || 0} ← ${want}`);
  }
  if (!changes.length) return bad(res, "ما في إشي تغيّر.");
  if (!t.load_confirmed_at) await query("UPDATE f_trips SET load_confirmed_at = now(), load_confirmed_by = $1 WHERE id = $2", [req.user.id, t.id]);
  await alert({ level: "info", kind: "load_edit", ref: t.id, title: `📦 ${req.user.full_name} عدّل حمولة ${t.vehicle_name}`, body: `${changes.join("، ")} — ${reason}` });
  if (t.driver_id) await pushTo(t.driver_id, { title: "📦 الإدارة عدّلت حمولتك", body: changes.join("، "), url: "/f/drive", tag: `load-${t.id}` });
  res.json({ ok: true, changes });
});

// جردي أنا (السائق)
router.get("/driver/jard", need("f_drive", "edit"), async (req, res) => {
  const date = isDate(req.query.date) ? req.query.date : jordanDate();
  res.json({ date, drivers: await buildJard(date, req.user.id), mine: true });
});

export default router;
