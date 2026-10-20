import { Router } from "express";
import { query, logActivity } from "../../db.js";
import { canAction } from "../../permissions.js";
import { need, needAny, bad, round2, jordanDate, alert } from "./lib.js";
import { confirmLoad } from "./driver.js";
import { loadTrips } from "./orders.js";

// ============================================================
// المصنع: المستودع (تحميل، مرتجع، تالف، جرد)، الإنتاج، المواد الخام، أعطال المكنات
//
// رصيد المستودع = إنتاج − تحميل + مرتجع − تالف من المستودع ± تعديل/جرد
// (تالف السيارة والماكنة ما بيأثر على رصيد المستودع: الكراتين أصلًا طلعت أو ما انتجت)
// ============================================================
const router = Router();
const viewStock = needAny(["f_stock"], ["f_production"], ["f_home"], ["f_dispatch"]);
const editStock = need("f_stock", "edit");
const editProd = need("f_production", "edit");

const BAL_SQL = `
  SELECT p.id, p.name, p.per_carton, p.min_stock, p.price,
    COALESCE(SUM(CASE
      WHEN m.kind = 'production' THEN m.qty
      WHEN m.kind = 'load' THEN -m.qty
      WHEN m.kind = 'return' THEN m.qty
      WHEN m.kind = 'damage' AND m.damage_source = 'warehouse' THEN -m.qty
      WHEN m.kind IN ('adjust','count') THEN m.qty
      ELSE 0 END), 0)::int AS balance
  FROM f_products p LEFT JOIN f_stock_moves m ON m.product_id = p.id
  WHERE p.active GROUP BY p.id ORDER BY p.sort_order, p.id`;

export async function stockBalances() {
  return (await query(BAL_SQL)).rows.map((r) => ({ ...r, price: Number(r.price) }));
}

router.get("/stock", viewStock, async (req, res) => {
  const today = jordanDate();
  const tomorrow = new Date(Date.parse(`${today}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
  const [bal, todayMoves, demand, materials, openDown] = await Promise.all([
    stockBalances(),
    query(
      `SELECT product_id, kind, damage_source, SUM(qty)::int AS qty FROM f_stock_moves
       WHERE (created_at AT TIME ZONE 'Asia/Amman')::date = $1 GROUP BY product_id, kind, damage_source`,
      [today]
    ),
    query(
      `SELECT i.product_id, SUM(i.qty + i.bonus_qty)::int AS qty FROM f_orders o JOIN f_order_items i ON i.order_id = o.id
       WHERE o.status IN ('new','assigned','delayed') AND o.due_date <= $1 GROUP BY i.product_id`,
      [tomorrow]
    ),
    query("SELECT * FROM f_materials WHERE active ORDER BY id"),
    query("SELECT d.*, m.name AS machine_name FROM f_downtime d JOIN f_machines m ON m.id = d.machine_id WHERE d.ended_at IS NULL ORDER BY d.id"),
  ]);
  const t = (pid, kind, src) => todayMoves.rows.filter((m) => m.product_id === pid && m.kind === kind && (!src || m.damage_source === src)).reduce((s, m) => s + m.qty, 0);
  res.json({
    products: bal.map((p) => ({
      ...p,
      today: { production: t(p.id, "production"), load: t(p.id, "load"), return: t(p.id, "return"), damage: t(p.id, "damage") },
      demand: demand.rows.find((d) => d.product_id === p.id)?.qty || 0,
    })),
    materials: materials.rows.map((m) => ({ ...m, balance: Number(m.balance), min_level: Number(m.min_level) })),
    downtime_open: openDown.rows,
  });
});

router.get("/stock/moves", viewStock, async (req, res) => {
  const params = [];
  let where = "m.created_at > now() - interval '14 days'";
  if (req.query.product) { params.push(Number(req.query.product)); where += ` AND m.product_id = $${params.length}`; }
  if (req.query.kind) { params.push(String(req.query.kind)); where += ` AND m.kind = $${params.length}`; }
  const r = await query(
    `SELECT m.*, p.name AS product_name, v.name AS vehicle_name, mc.name AS machine_name, u.full_name AS by_name
     FROM f_stock_moves m JOIN f_products p ON p.id = m.product_id LEFT JOIN f_vehicles v ON v.id = m.vehicle_id
     LEFT JOIN f_machines mc ON mc.id = m.machine_id LEFT JOIN users u ON u.id = m.created_by
     WHERE ${where} ORDER BY m.id DESC LIMIT 200`,
    params
  );
  res.json(r.rows);
});

// ---------- الإنتاج ----------
router.post("/stock/production", editProd, async (req, res) => {
  const pid = Number(req.body?.product_id);
  const qty = Math.round(Number(req.body?.qty));
  if (!pid || !(qty > 0)) return bad(res, "اختار المنتج واكتب عدد الكراتين.");
  const shift = ["صبحي", "مسائي", "ليلي"].includes(req.body?.shift) ? req.body.shift : null;
  await query("INSERT INTO f_stock_moves (product_id, kind, qty, shift, machine_id, created_by) VALUES ($1,'production',$2,$3,$4,$5)", [pid, qty, shift, req.body?.machine_id || null, req.user.id]);
  // خصم المواد الخام حسب «وصفة» المنتج
  const recipe = (await query("SELECT r.*, m.name, m.balance, m.min_level FROM f_recipes r JOIN f_materials m ON m.id = r.material_id WHERE r.product_id = $1", [pid])).rows;
  for (const r of recipe) {
    const use = round2(Number(r.qty_per_carton) * qty);
    const after = (await query("UPDATE f_materials SET balance = balance - $1 WHERE id = $2 RETURNING balance, min_level, name", [use, r.material_id])).rows[0];
    await query("INSERT INTO f_material_moves (material_id, kind, qty, note, created_by) VALUES ($1,'use',$2,$3,$4)", [r.material_id, -use, `إنتاج ${qty} كرتونة`, req.user.id]);
    if (Number(after.balance) <= Number(after.min_level)) {
      await alert({ level: "warn", kind: "material_low", ref: r.material_id, title: `${after.name} قرب يخلص`, body: `الرصيد ${Number(after.balance).toLocaleString("en-US")} — اطلب من المورد قبل ما يوقف الإنتاج.`, dedupe: true });
    }
  }
  res.status(201).json({ ok: true });
});

// ---------- التالف ----------
router.post("/stock/damage", needAny(["f_stock", "edit"], ["f_production", "edit"]), async (req, res) => {
  const pid = Number(req.body?.product_id);
  const qty = Math.round(Number(req.body?.qty));
  const source = ["warehouse", "machine", "vehicle", "customer"].includes(req.body?.source) ? req.body.source : "warehouse";
  if (!pid || !(qty > 0)) return bad(res, "اختار المنتج واكتب العدد.");
  const reason = String(req.body?.reason || "").trim();
  if (!reason) return bad(res, "اكتب السبب.");
  await query(
    "INSERT INTO f_stock_moves (product_id, kind, qty, damage_source, vehicle_id, machine_id, downtime_id, reason, photo_url, created_by) VALUES ($1,'damage',$2,$3,$4,$5,$6,$7,$8,$9)",
    [pid, qty, source, req.body?.vehicle_id || null, req.body?.machine_id || null, req.body?.downtime_id || null, reason.slice(0, 300), req.body?.photo_url || null, req.user.id]
  );
  if (qty >= 20) await alert({ level: "warn", kind: "damage", ref: null, title: `تالف ${qty} كرتونة`, body: reason });
  res.status(201).json({ ok: true });
});

// ---------- الجرد الفعلي ----------
router.post("/stock/count", editStock, async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  const bal = new Map((await stockBalances()).map((p) => [p.id, p]));
  const diffs = [];
  for (const it of items) {
    const p = bal.get(Number(it.product_id));
    const counted = Math.round(Number(it.counted));
    if (!p || !(counted >= 0)) continue;
    const diff = counted - p.balance;
    if (diff !== 0) {
      await query("INSERT INTO f_stock_moves (product_id, kind, qty, reason, created_by) VALUES ($1,'count',$2,$3,$4)", [p.id, diff, `جرد: المحسوب ${p.balance} والموجود ${counted}`, req.user.id]);
      diffs.push(`${p.name}: ${diff > 0 ? "+" : ""}${diff}`);
    }
  }
  if (diffs.length) await alert({ level: "warn", kind: "count", ref: null, title: "فرق بالجرد", body: `${diffs.join(" · ")} — جرد ${req.user.full_name}.` });
  res.json({ ok: true, diffs });
});

router.post("/stock/adjust", editStock, async (req, res) => {
  if (!canAction(req.user, "adjust_stock")) return bad(res, "ما عندك صلاحية تعدّل الرصيد يدويًا.", 403);
  const pid = Number(req.body?.product_id), qty = Math.round(Number(req.body?.qty));
  const reason = String(req.body?.reason || "").trim();
  if (!pid || !qty) return bad(res, "اختار المنتج والكمية (+ أو −).");
  if (!reason) return bad(res, "ما في تعديل بدون سبب.");
  await query("INSERT INTO f_stock_moves (product_id, kind, qty, reason, created_by) VALUES ($1,'adjust',$2,$3,$4)", [pid, qty, reason.slice(0, 300), req.user.id]);
  await alert({ level: "info", kind: "adjust", ref: pid, title: `تعديل رصيد يدوي (${qty > 0 ? "+" : ""}${qty})`, body: `${reason} — ${req.user.full_name}` });
  res.json({ ok: true });
});

// ---------- التحميل: شو لازم يطلع على كل سيارة اليوم ----------
router.get("/stock/loading", viewStock, async (req, res) => {
  const trips = await loadTrips("t.status IN ('planned','active','returned') AND t.trip_date <= $1", [jordanDate()]);
  res.json(trips.map((t) => {
    const per = new Map();
    for (const o of t.stops.filter((s) => s.status !== "cancelled")) for (const i of o.items) per.set(i.product_id, { product_id: i.product_id, name: i.name, qty: (per.get(i.product_id)?.qty || 0) + i.qty + (i.bonus_qty || 0) });
    return {
      id: t.id, vehicle_name: t.vehicle_name, driver_name: t.driver_name, status: t.status, trip_date: t.trip_date, capacity: t.capacity, load: t.load,
      load_confirmed_at: t.load_confirmed_at, items: [...per.values()], extra_items: t.extra_items,
      returns_expected: t.status === "returned" ? expectedReturns(t) : null, returns_received: !!t.returns_received_at,
    };
  }));
});

export function expectedReturns(t) {
  const per = new Map();
  const add = (pid, name, q) => {
    if (!q) return;
    const x = per.get(pid) || { product_id: pid, name, qty: 0 };
    x.qty += q;
    per.set(pid, x);
  };
  for (const o of t.stops) {
    for (const i of o.items) {
      const b = i.bonus_qty || 0;
      if (o.status === "delivered") add(i.product_id, i.name, i.qty + b - (i.delivered_qty ?? i.qty) - (i.delivered_bonus ?? b) - (i.damaged_qty || 0));
      else if (["failed", "onway", "assigned"].includes(o.status)) add(i.product_id, i.name, i.qty + b);
    }
  }
  for (const x of t.extra_items || []) add(x.product_id, x.name, x.qty);
  return [...per.values()].filter((x) => x.qty > 0);
}

router.post("/stock/trips/:id/load", editStock, async (req, res) => {
  try {
    await confirmLoad(Number(req.params.id), req.user.id, Array.isArray(req.body?.extra) ? req.body.extra : []);
  } catch (e) {
    return bad(res, e.message);
  }
  res.json({ ok: true });
});

// استلام المرتجع من السيارة لما ترجع
router.post("/stock/trips/:id/returns", editStock, async (req, res) => {
  const t = (await loadTrips("t.id = $1", [req.params.id]))[0];
  if (!t) return bad(res, "الرحلة غير موجودة.", 404);
  if (t.status !== "returned" && t.status !== "closed") return bad(res, "السيارة لسا ما رجعت.");
  if (t.returns_received_at) return bad(res, "المرتجع انستلم من قبل.");
  const expected = expectedReturns(t);
  const got = new Map((req.body?.items || []).map((i) => [Number(i.product_id), Math.max(0, Math.round(Number(i.qty) || 0))]));
  const short = [];
  for (const e of expected) {
    const q = got.has(e.product_id) ? got.get(e.product_id) : e.qty;
    if (q > 0) await query("INSERT INTO f_stock_moves (product_id, kind, qty, trip_id, vehicle_id, created_by) VALUES ($1,'return',$2,$3,$4,$5)", [e.product_id, q, t.id, t.vehicle_id, req.user.id]);
    if (q < e.qty) short.push({ ...e, missing: e.qty - q });
  }
  for (const [pid, q] of got) {
    if (!expected.find((e) => e.product_id === pid) && q > 0) await query("INSERT INTO f_stock_moves (product_id, kind, qty, trip_id, vehicle_id, reason, created_by) VALUES ($1,'return',$2,$3,$4,'زيادة عن المتوقع',$5)", [pid, q, t.id, t.vehicle_id, req.user.id]);
  }
  await query("UPDATE f_trips SET returns_received_at = now(), returns_received_by = $1 WHERE id = $2", [req.user.id, t.id]);
  if (short.length && t.driver_id) {
    const prices = new Map((await query("SELECT id, price FROM f_products")).rows.map((p) => [p.id, Number(p.price)]));
    const value = round2(short.reduce((s, x) => s + x.missing * (prices.get(x.product_id) || 0), 0));
    await query(
      "INSERT INTO f_driver_ledger (driver_id, kind, amount, trip_id, note, created_by) VALUES ($1,'shortage',$2,$3,$4,$5)",
      [t.driver_id, value, t.id, `نقص كراتين: ${short.map((x) => `${x.missing} ${x.name}`).join("، ")}`, req.user.id]
    );
    await alert({ level: "crit", kind: "carton_short", ref: t.id, title: `نقص كراتين مع ${t.driver_name || "السائق"}`, body: `${short.map((x) => `${x.missing} ${x.name}`).join("، ")} — انسجّلت عهدة ${value.toFixed(2)} د.أ.` });
  }
  await maybeClose(t.id);
  res.json({ ok: true, short });
});

export async function maybeClose(tripId) {
  const t = (await query("SELECT * FROM f_trips WHERE id = $1", [tripId])).rows[0];
  if (t && t.status === "returned" && t.settled_at && t.returns_received_at) {
    await query("UPDATE f_trips SET status = 'closed' WHERE id = $1", [tripId]);
    await query("UPDATE f_alerts SET closed_at = now() WHERE kind = 'returned' AND ref_id = $1 AND closed_at IS NULL", [tripId]);
  }
}

// ---------- المواد الخام ----------
router.post("/stock/materials/:id/receive", editProd, async (req, res) => {
  const qty = Number(req.body?.qty);
  if (!(qty > 0)) return bad(res, "اكتب الكمية.");
  await query("UPDATE f_materials SET balance = balance + $1 WHERE id = $2", [qty, req.params.id]);
  await query("INSERT INTO f_material_moves (material_id, kind, qty, cost, note, created_by) VALUES ($1,'receive',$2,$3,$4,$5)", [req.params.id, qty, Number(req.body?.cost) || null, req.body?.note || null, req.user.id]);
  await query("UPDATE f_alerts SET closed_at = now() WHERE kind = 'material_low' AND ref_id = $1 AND closed_at IS NULL", [req.params.id]);
  res.json({ ok: true });
});
router.post("/stock/materials/:id/adjust", editProd, async (req, res) => {
  const qty = Number(req.body?.qty);
  if (!qty) return bad(res, "اكتب الكمية (+ أو −).");
  if (!String(req.body?.note || "").trim()) return bad(res, "اكتب السبب.");
  await query("UPDATE f_materials SET balance = balance + $1 WHERE id = $2", [qty, req.params.id]);
  await query("INSERT INTO f_material_moves (material_id, kind, qty, note, created_by) VALUES ($1,'adjust',$2,$3,$4)", [req.params.id, qty, req.body.note, req.user.id]);
  res.json({ ok: true });
});

// ---------- أعطال المكنات ----------
router.get("/stock/downtime", viewStock, async (req, res) => {
  const r = await query(
    `SELECT d.*, m.name AS machine_name, EXTRACT(EPOCH FROM (COALESCE(d.ended_at, now()) - d.started_at))::int / 60 AS minutes,
            (SELECT COALESCE(SUM(qty),0)::int FROM f_stock_moves s WHERE s.downtime_id = d.id) AS damaged
     FROM f_downtime d JOIN f_machines m ON m.id = d.machine_id ORDER BY d.id DESC LIMIT 60`
  );
  res.json(r.rows);
});
router.post("/stock/downtime", editProd, async (req, res) => {
  const mid = Number(req.body?.machine_id);
  const reason = String(req.body?.reason || "").trim();
  if (!mid || !reason) return bad(res, "اختار الماكنة والسبب.");
  const open = (await query("SELECT id FROM f_downtime WHERE machine_id = $1 AND ended_at IS NULL", [mid])).rows[0];
  if (open) return bad(res, "الماكنة مسجّلة واقفة من قبل.");
  const r = await query("INSERT INTO f_downtime (machine_id, reason, note, created_by) VALUES ($1,$2,$3,$4) RETURNING id", [mid, reason.slice(0, 100), req.body?.note || null, req.user.id]);
  const m = (await query("SELECT name FROM f_machines WHERE id = $1", [mid])).rows[0];
  await alert({ level: "warn", kind: "downtime", ref: r.rows[0].id, title: `${m?.name || "ماكنة"} وقفت`, body: `السبب: ${reason}.` });
  res.status(201).json({ id: r.rows[0].id });
});
router.post("/stock/downtime/:id/end", editProd, async (req, res) => {
  const d = (await query("SELECT d.*, m.name FROM f_downtime d JOIN f_machines m ON m.id = d.machine_id WHERE d.id = $1", [req.params.id])).rows[0];
  if (!d) return bad(res, "غير موجود.", 404);
  if (d.ended_at) return bad(res, "الماكنة مسجّلة شغالة من قبل.");
  await query("UPDATE f_downtime SET ended_at = now(), repair_cost = $1 WHERE id = $2", [Number(req.body?.repair_cost) || 0, d.id]);
  let dmg = 0;
  for (const it of req.body?.damaged || []) {
    const q = Math.round(Number(it.qty));
    if (it.product_id && q > 0) {
      await query("INSERT INTO f_stock_moves (product_id, kind, qty, damage_source, machine_id, downtime_id, reason, created_by) VALUES ($1,'damage',$2,'machine',$3,$4,$5,$6)", [it.product_id, q, d.machine_id, d.id, `عطل: ${d.reason}`, req.user.id]);
      dmg += q;
    }
  }
  const mins = Math.round((Date.now() - new Date(d.started_at).getTime()) / 60000);
  await query("UPDATE f_alerts SET closed_at = now() WHERE kind = 'downtime' AND ref_id = $1 AND closed_at IS NULL", [d.id]);
  await alert({ level: dmg ? "warn" : "info", kind: "downtime_end", ref: d.id, title: `${d.name} رجعت تشتغل`, body: `وقفت ${mins} دقيقة (${d.reason})${dmg ? ` · تالف ${dmg} كرتونة` : ""}.` });
  await logActivity({ userId: req.user.id, action: "F_DOWNTIME_END", recordType: "f_downtime", recordId: d.id, newValue: { mins, dmg } });
  res.json({ ok: true, minutes: mins, damaged: dmg });
});

export default router;
