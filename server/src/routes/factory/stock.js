import { Router } from "express";
import { query, logActivity } from "../../db.js";
import { canAction, can } from "../../permissions.js";
import { need, needAny, bad, round2, jordanDate, alert, pushTo, pushManagers } from "./lib.js";
import { confirmLoad } from "./driver.js";
import { loadTrips } from "./orders.js";

// ============================================================
// المصنع: المستودع (تحميل، مرتجع، تالف، جرد)، الإنتاج، المواد الخام، أعطال المكنات
//
// رصيد المستودع = إنتاج − تحميل + مرتجع − تالف من المستودع ± تعديل/جرد
// (تالف السيارة والماكنة ما بيأثر على رصيد المستودع: الكراتين أصلًا طلعت أو ما انتجت)
// ============================================================
const router = Router();
const viewStock = needAny(["f_stock"], ["f_production"], ["f_home"], ["f_dispatch"], ["f_machines"]);
const editMachines = needAny(["f_production", "edit"], ["f_machines", "edit"]);
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
  const [bal, todayMoves, demand, materials, openDown, byVehicle] = await Promise.all([
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
    query(
      `SELECT v.id, v.name AS vehicle_name, u.full_name AS driver_name,
              SUM(CASE WHEN m.kind = 'load' THEN m.qty ELSE 0 END)::int AS loaded,
              SUM(CASE WHEN m.kind = 'return' THEN m.qty ELSE 0 END)::int AS returned
       FROM f_stock_moves m JOIN f_vehicles v ON v.id = m.vehicle_id LEFT JOIN users u ON u.id = v.driver_id
       WHERE m.kind IN ('load','return') AND (m.created_at AT TIME ZONE 'Asia/Amman')::date = $1
       GROUP BY v.id, v.name, u.full_name ORDER BY loaded DESC`,
      [today]
    ),
  ]);
  const t = (pid, kind, src) => todayMoves.rows.filter((m) => m.product_id === pid && m.kind === kind && (!src || m.damage_source === src)).reduce((s, m) => s + m.qty, 0);
  res.json({
    products: bal.map((p) => ({
      ...p,
      today: {
        production: t(p.id, "production"), load: t(p.id, "load"), return: t(p.id, "return"), damage: t(p.id, "damage"),
        damage_wh: t(p.id, "damage", "warehouse"), adjust: t(p.id, "adjust") + t(p.id, "count"),
      },
      demand: demand.rows.find((d) => d.product_id === p.id)?.qty || 0,
    })),
    materials: materials.rows.map((m) => ({ ...m, balance: Number(m.balance), min_level: Number(m.min_level) })),
    downtime_open: openDown.rows,
    today_by_vehicle: byVehicle.rows,
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
  // أي مصنع أنتج: المختار، أو خط الماكنة، أو خط الموظف إذا إله خط واحد
  let lineId = Number(req.body?.line_id) || null;
  if (!lineId && req.body?.machine_id) lineId = (await query("SELECT line_id FROM f_machines WHERE id = $1", [req.body.machine_id])).rows[0]?.line_id || null;
  if (!lineId) { const mine = (await query("SELECT line_id FROM f_pline_users WHERE user_id = $1", [req.user.id])).rows; if (mine.length === 1) lineId = mine[0].line_id; }
  await query("INSERT INTO f_stock_moves (product_id, kind, qty, shift, machine_id, created_by, line_id) VALUES ($1,'production',$2,$3,$4,$5,$6)", [pid, qty, shift, req.body?.machine_id || null, req.user.id, lineId]);
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
  const names = new Map((await query("SELECT id, full_name FROM users WHERE id = ANY($1::int[])", [[...new Set(trips.map((t) => t.load_confirmed_by).filter(Boolean))]])).rows.map((u) => [u.id, u.full_name]));
  res.json(trips.map((t) => {
    const per = new Map();
    for (const o of t.stops.filter((s) => s.status !== "cancelled")) for (const i of o.items) per.set(i.product_id, { product_id: i.product_id, name: i.name, qty: (per.get(i.product_id)?.qty || 0) + i.qty + (i.bonus_qty || 0) });
    return {
      id: t.id, vehicle_name: t.vehicle_name, driver_name: t.driver_name, status: t.status, trip_date: t.trip_date, capacity: t.capacity, load: t.load,
      load_confirmed_at: t.load_confirmed_at, items: [...per.values()], extra_items: t.extra_items,
      returns_expected: t.status === "returned" ? expectedReturns(t) : null, returns_received: !!t.returns_received_at,
      exchanged: exchangedPer(t),
      loaded: (t.loaded_per || []).filter((x) => x.qty > 0).map((x) => ({ product_id: x.product_id, name: x.name, qty: x.qty })),
      load_confirmed_by_name: names.get(t.load_confirmed_by) || null,
      driver_ack_at: t.driver_ack_at, driver_ack_sig: t.driver_ack_sig, driver_ack_note: t.driver_ack_note,
    };
  }));
});

// التالف اللي أخذه السائق من الزباين (استبدال) — بيرجع معه للمستودع ليتفرز
function exchangedPer(t) {
  const per = new Map();
  for (const o of t.stops || []) if (o.status === "delivered") for (const x of o.exchanges || []) {
    const e = per.get(x.product_id) || { product_id: x.product_id, name: x.name, qty: 0 };
    e.qty += x.qty;
    per.set(x.product_id, e);
  }
  return [...per.values()].filter((x) => x.qty > 0);
}

export function expectedReturns(t) {
  // بعد التحميل: اللي طلع على السيارة − اللي انسلّم (مع البونص) − اللي تلف بالسيارة
  if (t.load_confirmed_at && t.loaded_per?.length) {
    const per = new Map();
    for (const m of t.loaded_per) per.set(m.product_id, { product_id: m.product_id, name: m.name, qty: (per.get(m.product_id)?.qty || 0) + m.qty });
    const sub = (pid, name, q) => { if (!q) return; const x = per.get(pid) || { product_id: pid, name, qty: 0 }; x.qty -= q; per.set(pid, x); };
    for (const o of t.stops) {
      if (o.status !== "delivered") continue;
      for (const i of o.items) sub(i.product_id, i.name, (i.delivered_qty ?? i.qty) + (i.delivered_bonus ?? i.bonus_qty ?? 0));
    }
    // الاستبدال: الجديد طلع من السيارة للزبون (والتالف اللي أخذناه بيرجع لحاله كتالف)
    for (const o of t.stops) if (o.status === "delivered") for (const x of o.exchanges || []) sub(x.product_id, x.name, x.qty);
    for (const d of t.damaged_per || []) sub(d.product_id, d.name, d.qty);
    return [...per.values()].filter((x) => x.qty > 0);
  }
  return expectedReturnsFromOrders(t);
}

function expectedReturnsFromOrders(t) {
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
  // السائق لازم يراجع العدد ويوقّع إنه استلم
  const t = (await query("SELECT t.driver_id, v.name FROM f_trips t JOIN f_vehicles v ON v.id = t.vehicle_id WHERE t.id = $1", [req.params.id])).rows[0];
  if (t?.driver_id && t.driver_id !== req.user.id) pushTo(t.driver_id, { title: `📦 ${req.user.full_name} حمّل ${t.name}`, body: "راجع العدد ووقّع إنك استلمت قبل ما تطلع.", url: "/f/drive", tag: `ld-${req.params.id}` }).catch(() => {});
  res.json({ ok: true });
});

// استلام المرتجع من السيارة لما ترجع
router.post("/stock/trips/:id/returns", editStock, async (req, res) => {
  const t = (await loadTrips("t.id = $1", [req.params.id]))[0];
  if (!t) return bad(res, "الرحلة غير موجودة.", 404);
  if (t.status !== "returned" && t.status !== "closed") return bad(res, "السيارة لسا ما رجعت.");
  if (t.returns_received_at) return bad(res, "المرتجع انستلم من قبل.");
  // بنحجز الاستلام أول: لو انكبس مرتين بنفس اللحظة، المرتجع ما بيدخل المستودع مرتين
  const claim = await query("UPDATE f_trips SET returns_received_at = now(), returns_received_by = $1 WHERE id = $2 AND returns_received_at IS NULL RETURNING id", [req.user.id, t.id]);
  if (!claim.rows.length) return bad(res, "المرتجع انستلم من قبل.");
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
  // فرز التالف اللي جابه من الزباين: الصالح بيروح للإنتاج يصلّحه، والخربان بينشطب
  const exch = exchangedPer(t);
  const salvageNew = [];
  for (const sv of Array.isArray(req.body?.salvage) ? req.body.salvage : []) {
    const e = exch.find((x) => x.product_id === Number(sv.product_id));
    if (!e) continue;
    const got = sv.received == null || sv.received === "" ? e.qty : Math.max(0, Math.round(Number(sv.received) || 0));
    const good = Math.max(0, Math.min(got, Math.round(Number(sv.good) || 0)));
    const badQ = Math.max(0, got - good);
    if (got < e.qty) await alert({ level: "warn", kind: "salvage_short", ref: t.id, title: `تالف ناقص مع ${t.driver_name || "السائق"}`, body: `${e.name}: المفروض ${e.qty} ووصل ${got}.` });
    if (!good && !badQ) continue;
    const sv2 = (await query(
      "INSERT INTO f_salvage (trip_id, product_id, good, bad, status, sorted_by, expected) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id",
      [t.id, e.product_id, good, badQ, good > 0 ? "pending" : "done", req.user.id, e.qty]
    )).rows[0];
    if (good > 0) salvageNew.push({ id: sv2.id, name: e.name, good });
  }
  // الإنتاج بيوصله إشعار: في تالف صالح بانتظارك تأكّد استلامه
  if (salvageNew.length) {
    const prod = (await query("SELECT id, role, permissions FROM users WHERE status = 'active'")).rows.filter((u) => u.role !== "super_admin" && can(u, "f_production", "edit"));
    const txt = salvageNew.map((x) => `${x.good} ${x.name}`).join("، ");
    for (const u of prod) pushTo(u.id, { title: `📥 تالف صالح للتصليح: ${txt}`, body: `من ${req.user.full_name} — أكّد إنك استلمت العدد.`, url: "/f/stock" }).catch(() => {});
  }
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

// ---------- التالف الصالح: أمين التحميل فرزه، والإنتاج بيصلّحه/بيعيد تغليفه وبيرجع للمستودع ----------
router.get("/stock/salvage", viewStock, async (req, res) => {
  const r = await query(
    `SELECT s.*, p.name, v.name AS vehicle_name, u1.full_name AS sorted_by_name, u2.full_name AS fixed_by_name, (SELECT full_name FROM users WHERE id = s.received_by) AS received_by_name
     FROM f_salvage s JOIN f_products p ON p.id = s.product_id
     LEFT JOIN f_trips t ON t.id = s.trip_id LEFT JOIN f_vehicles v ON v.id = t.vehicle_id
     LEFT JOIN users u1 ON u1.id = s.sorted_by LEFT JOIN users u2 ON u2.id = s.fixed_by
     WHERE s.status IN ('pending','received') OR s.sorted_at > now() - interval '7 days' ORDER BY s.status IN ('pending','received') DESC, s.id DESC LIMIT 100`
  );
  res.json(r.rows);
});

// الإنتاج بيأكّد إنه استلم من أمين المستودع (بالعدد الصحيح)
router.post("/stock/salvage/:id/receive", editProd, async (req, res) => {
  const s = (await query("SELECT s.*, p.name FROM f_salvage s JOIN f_products p ON p.id = s.product_id WHERE s.id = $1", [req.params.id])).rows[0];
  if (!s) return bad(res, "غير موجود.", 404);
  if (s.status !== "pending") return bad(res, "انستلم من قبل.");
  const qty = req.body?.qty == null || req.body.qty === "" ? s.good : Math.round(Number(req.body.qty));
  if (!(qty >= 0 && qty <= s.good)) return bad(res, `اكتب رقم من 0 لـ${s.good}.`);
  await query("UPDATE f_salvage SET status = 'received', received_qty = $1, received_by = $2, received_at = now() WHERE id = $3 AND status = 'pending'", [qty, req.user.id, s.id]);
  if (qty < s.good) {
    await alert({ level: "warn", kind: "salvage_short", ref: s.id, title: `الإنتاج استلم ${qty} من ${s.good} ${s.name}`, body: `أمين المستودع سلّم ${s.good} والإنتاج عدّ ${qty}. استلمه ${req.user.full_name}.` });
    if (s.sorted_by) pushTo(s.sorted_by, { title: "⚠️ فرق بتسليم التالف للإنتاج", body: `${s.name}: سلّمت ${s.good} والإنتاج عدّ ${qty}.`, url: "/f/stock" }).catch(() => {});
  } else if (s.sorted_by) {
    pushTo(s.sorted_by, { title: `✅ الإنتاج استلم ${qty} ${s.name}`, body: req.user.full_name, url: "/f/stock" }).catch(() => {});
  }
  res.json({ ok: true, qty });
});

router.post("/stock/salvage/:id/fix", editProd, async (req, res) => {
  const s = (await query("SELECT s.*, p.name FROM f_salvage s JOIN f_products p ON p.id = s.product_id WHERE s.id = $1", [req.params.id])).rows[0];
  if (!s) return bad(res, "غير موجود.", 404);
  if (s.status === "pending") return bad(res, "أكّد استلامك أول.");
  if (s.status !== "received") return bad(res, "انسجّل من قبل.");
  const max = s.received_qty ?? s.good;
  const qty = req.body?.qty == null || req.body.qty === "" ? max : Math.round(Number(req.body.qty));
  if (!(qty >= 0 && qty <= max)) return bad(res, `اكتب رقم من 0 لـ${max}.`);
  const u = await query("UPDATE f_salvage SET status = 'done', fixed_qty = $1, fixed_by = $2, fixed_at = now() WHERE id = $3 AND status = 'received' RETURNING id", [qty, req.user.id, s.id]);
  if (!u.rows[0]) return bad(res, "انسجّل من قبل.");
  if (qty > 0) await query("INSERT INTO f_stock_moves (product_id, kind, qty, reason, created_by) VALUES ($1,'production',$2,'تصليح تالف من الزباين',$3)", [s.product_id, qty, req.user.id]);
  await pushManagers({ title: `♻️ الإنتاج صلّح ${qty} ${s.name}`, body: `من ${max} استلمهم — رجعوا لرصيد المستودع. ${req.user.full_name}.`, url: "/f/stock", tag: `sv-${s.id}` });
  res.json({ ok: true, qty });
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
router.post("/stock/downtime", editMachines, async (req, res) => {
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
router.post("/stock/downtime/:id/end", editMachines, async (req, res) => {
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
