import { Router } from "express";
import { pool, query, logActivity } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { can, canAction } from "../permissions.js";
import { hasFeature } from "../features.js";
import { sendPushToUser } from "../utils/push.js";

// ============================================================
// المحطة: السيارات والجولات، مخزون المحطة والتوالف، الكاشير، العهدة
// كل جزء مقفول بميزته (من لوحة موج) + صلاحية «المحطة والسيارات» أو «الكاشير»
// ============================================================
const router = Router();
router.use(requireAuth);

const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const int = (n) => Math.max(0, Math.floor(Number(n) || 0));
const fail = (status, msg) => Object.assign(new Error(msg), { status });
const DAY = (col) => `(${col} AT TIME ZONE 'Asia/Amman')::date = $1::date`;
const isDate = (d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);

function feature(key) {
  return (req, res, next) => (hasFeature(req.tenant, key) ? next() : res.status(403).json({ error: "هاي الميزة مش مفعّلة لمحلك." }));
}
function perm(section, level) {
  return (req, res, next) => (can(req.user, section, level) ? next() : res.status(403).json({ error: level === "edit" ? "ما عندك صلاحية تعديل هون." : "ما عندك صلاحية لهذا القسم." }));
}
// أي مشكلة: رسالة واضحة بدل ما يعلق الطلب
const wrap = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (!err.status) console.error("station error:", err);
    res.status(err.status || 500).json({ error: err.status ? err.message : "صار خطأ، جرّب كمان مرة." });
  }
};

async function notifyUsers(test, { type, message, title, url, actorId }) {
  const users = (await query("SELECT id, role, permissions FROM users WHERE status = 'active'")).rows.filter(test);
  for (const u of users) {
    if (u.id === actorId) continue;
    await query("INSERT INTO notifications (type, message, target_user_id) VALUES ($1, $2, $3)", [type, message, u.id]);
    sendPushToUser(u.id, { title, body: message, url }).catch(() => {});
  }
}
const isManager = (u) => u.role === "super_admin" || can(u, "station", "edit") || can(u, "jard", "view");
const userName = async (id) => (id ? (await query("SELECT full_name FROM users WHERE id = $1", [id])).rows[0]?.full_name : null);

// ============================================================
// المخزون
// ============================================================
async function stockLevels(db = { query }) {
  const r = await db.query(
    `SELECT i.*, p.name AS product_name, p.unit_price::float AS sale_price,
            COALESCE(SUM(m.qty) FILTER (WHERE m.status = 'approved'), 0)::int AS qty,
            COALESCE(SUM(-m.qty) FILTER (WHERE m.status = 'pending'), 0)::int AS pending_damage
     FROM st_items i
     LEFT JOIN products p ON p.id = i.product_id
     LEFT JOIN st_moves m ON m.item_id = i.id
     WHERE i.status = 'active'
     GROUP BY i.id, p.name, p.unit_price
     ORDER BY i.sort_order, i.id`
  );
  return r.rows.map((x) => ({ ...x, cost_price: Number(x.cost_price), value: r2(x.qty * Number(x.cost_price)) }));
}

// بعد أي حركة: إذا الصنف نزل تحت حد التنبيه بيوصل إشعار (مرة وحدة لحد ما يرجع يرتفع)
async function checkLowStock(itemIds, actorId) {
  if (!itemIds.length) return;
  const r = await query(
    `SELECT i.id, i.name, i.unit, i.low_alert, i.alerted, COALESCE(SUM(m.qty) FILTER (WHERE m.status = 'approved'), 0)::int AS qty
     FROM st_items i LEFT JOIN st_moves m ON m.item_id = i.id
     WHERE i.id = ANY($1::int[]) GROUP BY i.id`,
    [itemIds]
  );
  for (const it of r.rows) {
    if (it.low_alert > 0 && it.qty <= it.low_alert && !it.alerted) {
      await query("UPDATE st_items SET alerted = true WHERE id = $1", [it.id]);
      await notifyUsers(isManager, {
        type: "LOW_STOCK", title: "المخزون قرب يخلص ⚠️", url: "/station", actorId: null,
        message: `⚠️ ${it.name} قرب يخلص بالمحطة: باقي ${it.qty} ${it.unit} (حد التنبيه ${it.low_alert})`,
      });
    } else if (it.qty > it.low_alert && it.alerted) {
      await query("UPDATE st_items SET alerted = false WHERE id = $1", [it.id]);
    }
  }
}

// حركات لمنتجات (تحميل، مرتجع، بيع محل): بتنخصم من صنف المحطة المربوط بالمنتج
async function moveProducts(db, rows, { kind, roundId = null, saleId = null, userId, note = null }) {
  const pids = rows.filter((x) => x.qty).map((x) => x.product_id);
  if (!pids.length) return [];
  const items = (await db.query("SELECT id, product_id, cost_price FROM st_items WHERE product_id = ANY($1::int[]) AND status = 'active'", [pids])).rows;
  const touched = [];
  for (const row of rows) {
    const it = items.find((x) => x.product_id === row.product_id);
    if (!it || !row.qty) continue;
    await db.query(
      `INSERT INTO st_moves (item_id, kind, qty, round_id, sale_id, unit_cost, note, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [it.id, kind, row.qty, roundId, saleId, it.cost_price, note, userId]
    );
    touched.push(it.id);
  }
  return touched;
}

router.get("/stock", feature("station_stock"), perm("station", "view"), wrap(async (req, res) => {
  const items = await stockLevels();
  const pending = (await query(
    `SELECT m.id, m.qty, m.note, m.created_at, m.round_id, i.name, i.unit, u.full_name AS by_name
     FROM st_moves m JOIN st_items i ON i.id = m.item_id LEFT JOIN users u ON u.id = m.created_by
     WHERE m.status = 'pending' ORDER BY m.created_at`
  )).rows;
  const products = (await query("SELECT id, name, unit_price::float AS unit_price FROM products WHERE status = 'active' ORDER BY sort_order, id")).rows;
  res.json({
    items, pending, products,
    capital: r2(items.reduce((s, x) => s + Math.max(0, x.qty) * x.cost_price, 0)),
    can_approve: req.user.role === "super_admin" || canAction(req.user, "approve_damage"),
  });
}));

router.post("/stock/items", feature("station_stock"), perm("station", "edit"), wrap(async (req, res) => {
  const b = req.body || {};
  const name = String(b.name || "").trim().slice(0, 100);
  if (!name) throw fail(400, "اكتب اسم الصنف.");
  const productId = Number(b.product_id) > 0 ? Number(b.product_id) : null;
  if (productId) {
    const used = await query("SELECT name FROM st_items WHERE product_id = $1 AND status = 'active'", [productId]);
    if (used.rows[0]) throw fail(400, `هذا المنتج مربوط من قبل بـ«${used.rows[0].name}».`);
  }
  const it = (await query(
    `INSERT INTO st_items (name, product_id, unit, cost_price, low_alert, sort_order)
     VALUES ($1,$2,$3,$4,$5, COALESCE((SELECT MAX(sort_order) FROM st_items), 0) + 1) RETURNING *`,
    [name, productId, String(b.unit || "حبة").slice(0, 20), Math.max(0, Number(b.cost_price) || 0), b.low_alert === "" || b.low_alert == null ? 100 : int(b.low_alert)]
  )).rows[0];
  const opening = int(b.opening_qty);
  if (opening > 0) {
    await query("INSERT INTO st_moves (item_id, kind, qty, unit_cost, note, created_by) VALUES ($1,'in',$2,$3,'رصيد أول',$4)", [it.id, opening, it.cost_price, req.user.id]);
  }
  res.status(201).json(it);
}));

router.put("/stock/items/:id", feature("station_stock"), perm("station", "edit"), wrap(async (req, res) => {
  const b = req.body || {};
  const productId = b.product_id === null || b.product_id === "" ? null : Number(b.product_id) > 0 ? Number(b.product_id) : undefined;
  if (productId) {
    const used = await query("SELECT name FROM st_items WHERE product_id = $1 AND status = 'active' AND id <> $2", [productId, req.params.id]);
    if (used.rows[0]) throw fail(400, `هذا المنتج مربوط من قبل بـ«${used.rows[0].name}».`);
  }
  const r = await query(
    `UPDATE st_items SET name = COALESCE(NULLIF($1, ''), name), unit = COALESCE(NULLIF($2, ''), unit),
       cost_price = COALESCE($3, cost_price), low_alert = COALESCE($4, low_alert),
       product_id = CASE WHEN $5::boolean THEN $6::int ELSE product_id END,
       status = COALESCE($7, status)
     WHERE id = $8 RETURNING *`,
    [String(b.name || "").trim().slice(0, 100), String(b.unit || "").slice(0, 20),
     b.cost_price != null && b.cost_price !== "" ? Math.max(0, Number(b.cost_price) || 0) : null,
     b.low_alert != null && b.low_alert !== "" ? int(b.low_alert) : null,
     productId !== undefined, productId ?? null,
     ["active", "archived"].includes(b.status) ? b.status : null, req.params.id]
  );
  if (!r.rows[0]) throw fail(404, "الصنف غير موجود.");
  await checkLowStock([r.rows[0].id]);
  res.json(r.rows[0]);
}));

// حركة يدوية: إدخال بضاعة (بسعرها)، جرد (تعديل للرقم الفعلي)، أو تالف (بيستنى موافقة)
router.post("/stock/items/:id/move", feature("station_stock"), perm("station", "edit"), wrap(async (req, res) => {
  const it = (await query("SELECT * FROM st_items WHERE id = $1", [req.params.id])).rows[0];
  if (!it) throw fail(404, "الصنف غير موجود.");
  const b = req.body || {};
  const note = String(b.note || "").trim().slice(0, 200) || null;
  if (b.kind === "in") {
    const qty = int(b.qty);
    if (!qty) throw fail(400, "اكتب الكمية.");
    const cost = b.unit_cost != null && b.unit_cost !== "" ? Math.max(0, Number(b.unit_cost) || 0) : Number(it.cost_price);
    await query("INSERT INTO st_moves (item_id, kind, qty, unit_cost, note, created_by) VALUES ($1,'in',$2,$3,$4,$5)", [it.id, qty, cost, note, req.user.id]);
    if (b.unit_cost != null && b.unit_cost !== "") await query("UPDATE st_items SET cost_price = $1 WHERE id = $2", [cost, it.id]);
  } else if (b.kind === "count") {
    const actual = Math.floor(Number(b.actual));
    if (!Number.isFinite(actual) || actual < 0) throw fail(400, "اكتب العدد الفعلي.");
    const cur = (await query("SELECT COALESCE(SUM(qty) FILTER (WHERE status = 'approved'), 0)::int AS q FROM st_moves WHERE item_id = $1", [it.id])).rows[0].q;
    if (actual !== cur) {
      await query("INSERT INTO st_moves (item_id, kind, qty, unit_cost, note, created_by) VALUES ($1,'adjust',$2,$3,$4,$5)",
        [it.id, actual - cur, it.cost_price, note || `جرد: كان ${cur} وطلع ${actual}`, req.user.id]);
    }
  } else if (b.kind === "damage") {
    const qty = int(b.qty);
    if (!qty) throw fail(400, "اكتب كم تالف.");
    const approver = req.user.role === "super_admin" || canAction(req.user, "approve_damage");
    const roundId = Number(b.round_id) > 0 ? Number(b.round_id) : null;
    const m = (await query(
      `INSERT INTO st_moves (item_id, kind, qty, status, round_id, unit_cost, note, created_by, approved_by, approved_at)
       VALUES ($1,'damage',$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [it.id, -qty, approver ? "approved" : "pending", roundId, it.cost_price, note, req.user.id, approver ? req.user.id : null, approver ? new Date() : null]
    )).rows[0];
    if (roundId && approver) await query("UPDATE st_round_items SET damaged = damaged + $1 WHERE round_id = $2 AND product_id = $3", [qty, roundId, it.product_id]);
    if (!approver) {
      const by = await userName(req.user.id);
      await notifyUsers((u) => u.role === "super_admin" || canAction(u, "approve_damage"), {
        type: "DAMAGE_PENDING", title: "تالف بيستنى موافقتك", url: "/station", actorId: req.user.id,
        message: `🧯 ${by || "موظف"} سجّل تالف: ${qty} ${it.unit} ${it.name}${note ? ` (${note})` : ""} — بيستنى موافقتك`,
      });
    }
    await logActivity({ userId: req.user.id, action: "STOCK_DAMAGE", recordType: "st_item", recordId: it.id, newValue: { qty, status: m.status, note } });
  } else {
    throw fail(400, "نوع الحركة غير معروف.");
  }
  await checkLowStock([it.id]);
  res.json({ ok: true });
}));

// موافقة / رفض التالف
router.post("/stock/moves/:id/:decision", feature("station_stock"), wrap(async (req, res) => {
  if (!(req.user.role === "super_admin" || canAction(req.user, "approve_damage"))) throw fail(403, "الموافقة على التوالف للإدارة بس.");
  const ok = req.params.decision === "approve";
  if (!ok && req.params.decision !== "reject") throw fail(400, "قرار غير معروف.");
  const m = (await query(
    `UPDATE st_moves SET status = $1, approved_by = $2, approved_at = now() WHERE id = $3 AND status = 'pending' RETURNING *`,
    [ok ? "approved" : "rejected", req.user.id, req.params.id]
  )).rows[0];
  if (!m) throw fail(400, "هذا التالف انحسم من قبل.");
  const it = (await query("SELECT * FROM st_items WHERE id = $1", [m.item_id])).rows[0];
  if (ok && m.round_id && it?.product_id) {
    await query("UPDATE st_round_items SET damaged = damaged + $1 WHERE round_id = $2 AND product_id = $3", [-m.qty, m.round_id, it.product_id]);
  }
  if (m.created_by && m.created_by !== req.user.id) {
    const msg = `${ok ? "✅ انقبل" : "❌ انرفض"} التالف: ${-m.qty} ${it?.unit || ""} ${it?.name || ""}`;
    await query("INSERT INTO notifications (type, message, target_user_id) VALUES ('DAMAGE_DECISION', $1, $2)", [msg, m.created_by]);
    sendPushToUser(m.created_by, { body: msg, url: "/station" }).catch(() => {});
  }
  await checkLowStock([m.item_id]);
  res.json({ ok: true });
}));

router.get("/stock/items/:id/moves", feature("station_stock"), perm("station", "view"), wrap(async (req, res) => {
  const r = await query(
    `SELECT m.*, u.full_name AS by_name FROM st_moves m LEFT JOIN users u ON u.id = m.created_by
     WHERE m.item_id = $1 ORDER BY m.created_at DESC LIMIT 100`,
    [req.params.id]
  );
  res.json(r.rows);
}));

// ============================================================
// السيارات والجولات
// ============================================================
// اللي انباع من السيارة بالجولة = اللي سلّمه السائق بالرحلات من وقت التحميل
async function deliveredInRound(round, db = { query }) {
  const r = await db.query(
    `SELECT oi.product_id, SUM(oi.quantity)::int AS qty
     FROM trip_stops ts JOIN trips t ON t.id = ts.trip_id JOIN order_items oi ON oi.order_id = ts.order_id
     WHERE t.driver_id = $1 AND ts.delivered_at >= $2 AND ts.delivered_at <= COALESCE($3, now())
     GROUP BY oi.product_id`,
    [round.driver_id, round.opened_at, round.closed_at]
  );
  return Object.fromEntries(r.rows.map((x) => [x.product_id, x.qty]));
}

// ملخص الجولة: الكميات، الكاش، الدين، الكوبونات (المستعملة والمباعة بالأحجام)
async function roundSummary(round) {
  const items = (await query("SELECT * FROM st_round_items WHERE round_id = $1 ORDER BY id", [round.id])).rows;
  const delivered = await deliveredInRound(round);
  const lines = items.map((it) => {
    const sold = round.status === "closed" && it.sold != null ? it.sold : delivered[it.product_id] || 0;
    const remaining = it.loaded - sold - it.damaged;
    const returned = it.returned;
    return { product_id: it.product_id, name: it.name, loaded: it.loaded, sold, damaged: it.damaged, remaining, returned,
      shortage: returned != null ? remaining - returned : null };
  });
  const money = (await query(
    `SELECT COUNT(*)::int AS stops, COALESCE(SUM(ts.cash_collected), 0)::float AS cash, COALESCE(SUM(ts.debt_added), 0)::float AS debt,
            COALESCE(SUM(ts.debt_paid), 0)::float AS debt_paid, COALESCE(SUM(ts.coupons_collected), 0)::int AS coupons_used,
            COALESCE(SUM(ts.paper_coupons), 0)::int AS paper_coupons
     FROM trip_stops ts JOIN trips t ON t.id = ts.trip_id
     WHERE t.driver_id = $1 AND ts.delivered_at >= $2 AND ts.delivered_at <= COALESCE($3, now())`,
    [round.driver_id, round.opened_at, round.closed_at]
  )).rows[0];
  const pk = (await query(
    `SELECT s.coupons, COUNT(*)::int AS count, COALESCE(SUM(s.paid_amount), 0)::float AS paid, COALESCE(SUM(s.price), 0)::float AS value
     FROM coupon_sales s WHERE s.sold_by = $1 AND s.created_at >= $2 AND s.created_at <= COALESCE($3, now())
     GROUP BY s.coupons ORDER BY s.coupons`,
    [round.driver_id, round.opened_at, round.closed_at]
  )).rows;
  return {
    lines, ...money,
    packages: pk,
    package_cash: r2(pk.reduce((s, x) => s + x.paid, 0)),
    total_cash: r2(money.cash + pk.reduce((s, x) => s + x.paid, 0)),
  };
}

async function roundRow(id) {
  return (await query(
    `SELECT r.*, v.name AS vehicle_name, u.full_name AS driver_name
     FROM st_rounds r JOIN st_vehicles v ON v.id = r.vehicle_id LEFT JOIN users u ON u.id = r.driver_id WHERE r.id = $1`,
    [id]
  )).rows[0];
}

router.get("/vehicles", feature("vehicles"), wrap(async (req, res) => {
  const mine = !can(req.user, "station", "view");
  if (mine && !can(req.user, "delivery", "edit")) throw fail(403, "ما عندك صلاحية لهذا القسم.");
  const vehicles = (await query("SELECT * FROM st_vehicles WHERE status = 'active' ORDER BY sort_order, id")).rows;
  const open = (await query(
    `SELECT r.*, u.full_name AS driver_name FROM st_rounds r LEFT JOIN users u ON u.id = r.driver_id WHERE r.status = 'open'`
  )).rows;
  const out = [];
  for (const v of vehicles) {
    const round = open.find((r) => r.vehicle_id === v.id) || null;
    if (mine && round?.driver_id !== req.user.id) continue;
    const today = (await query(
      `SELECT COUNT(*)::int AS n FROM st_rounds WHERE vehicle_id = $1 AND ${DAY("opened_at")}`,
      [new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Amman" })]
    )).rows[0].n;
    out.push({ ...v, round: round ? { ...round, summary: await roundSummary(round) } : null, rounds_today: today });
  }
  const drivers = (await query("SELECT id, full_name, role, permissions FROM users WHERE status = 'active' ORDER BY full_name")).rows
    .filter((u) => can(u, "delivery", "edit")).map((u) => ({ id: u.id, full_name: u.full_name }));
  const products = (await query("SELECT id, name FROM products WHERE status = 'active' ORDER BY sort_order, id")).rows;
  res.json({ vehicles: out, drivers, products, can_edit: can(req.user, "station", "edit") });
}));

router.post("/vehicles", feature("vehicles"), perm("station", "edit"), wrap(async (req, res) => {
  const name = String(req.body?.name || "").trim().slice(0, 60);
  if (!name) throw fail(400, "اكتب اسم السيارة (مثلًا سيارة ١).");
  const v = (await query(
    "INSERT INTO st_vehicles (name, plate, sort_order) VALUES ($1, $2, COALESCE((SELECT MAX(sort_order) FROM st_vehicles), 0) + 1) RETURNING *",
    [name, String(req.body?.plate || "").trim().slice(0, 30) || null]
  )).rows[0];
  res.status(201).json(v);
}));

router.put("/vehicles/:id", feature("vehicles"), perm("station", "edit"), wrap(async (req, res) => {
  const b = req.body || {};
  if (b.status === "archived") {
    const open = await query("SELECT 1 FROM st_rounds WHERE vehicle_id = $1 AND status = 'open'", [req.params.id]);
    if (open.rows[0]) throw fail(400, "السيارة فيها جولة مفتوحة — سكّرها أول.");
  }
  const r = await query(
    "UPDATE st_vehicles SET name = COALESCE(NULLIF($1, ''), name), plate = COALESCE($2, plate), status = COALESCE($3, status) WHERE id = $4 RETURNING *",
    [String(b.name || "").trim().slice(0, 60), b.plate != null ? String(b.plate).trim().slice(0, 30) : null, ["active", "archived"].includes(b.status) ? b.status : null, req.params.id]
  );
  if (!r.rows[0]) throw fail(404, "السيارة غير موجودة.");
  res.json(r.rows[0]);
}));

// تفاصيل سيارة: الجولة الحالية + آخر الجولات بملخصها
router.get("/vehicles/:id", feature("vehicles"), wrap(async (req, res) => {
  const v = (await query("SELECT * FROM st_vehicles WHERE id = $1", [req.params.id])).rows[0];
  if (!v) throw fail(404, "السيارة غير موجودة.");
  const rounds = (await query(
    `SELECT r.*, u.full_name AS driver_name FROM st_rounds r LEFT JOIN users u ON u.id = r.driver_id
     WHERE r.vehicle_id = $1 ORDER BY r.opened_at DESC LIMIT 20`,
    [v.id]
  )).rows;
  const viewer = can(req.user, "station", "view");
  if (!viewer && !(can(req.user, "delivery", "edit") && rounds[0]?.status === "open" && rounds[0].driver_id === req.user.id)) {
    throw fail(403, "ما عندك صلاحية لهذا القسم.");
  }
  const list = [];
  for (const r of rounds) list.push({ ...r, summary: await roundSummary(r) });
  res.json({ vehicle: v, rounds: list, can_edit: can(req.user, "station", "edit") });
}));

// تحميل جولة جديدة (موظف المحطة): السائق + الكميات
router.post("/vehicles/:id/rounds", feature("vehicles"), perm("station", "edit"), wrap(async (req, res) => {
  const v = (await query("SELECT * FROM st_vehicles WHERE id = $1 AND status = 'active'", [req.params.id])).rows[0];
  if (!v) throw fail(404, "السيارة غير موجودة.");
  const driverId = Number(req.body?.driver_id) || null;
  if (!driverId) throw fail(400, "اختار السائق.");
  const lines = (Array.isArray(req.body?.items) ? req.body.items : []).map((x) => ({ product_id: Number(x.product_id), qty: int(x.qty) })).filter((x) => x.product_id > 0 && x.qty > 0);
  if (!lines.length) throw fail(400, "حدد شو حمّلت (كمية وحدة على الأقل).");
  const busy = await query(
    `SELECT v.name FROM st_rounds r JOIN st_vehicles v ON v.id = r.vehicle_id WHERE r.status = 'open' AND r.driver_id = $1 AND r.vehicle_id <> $2`,
    [driverId, v.id]
  );
  if (busy.rows[0]) throw fail(400, `هذا السائق عنده جولة مفتوحة على «${busy.rows[0].name}» — سكّرها أول.`);

  const products = (await query("SELECT id, name FROM products WHERE id = ANY($1::int[])", [lines.map((x) => x.product_id)])).rows;
  const client = await pool.connect();
  let round, touched = [];
  try {
    await client.query("BEGIN");
    const open = await client.query("SELECT id FROM st_rounds WHERE vehicle_id = $1 AND status = 'open' FOR UPDATE", [v.id]);
    if (open.rows[0]) throw fail(400, "السيارة فيها جولة مفتوحة — سجّل المرتجع وسكّرها أول.");
    const no = (await client.query(
      `SELECT COUNT(*)::int + 1 AS n FROM st_rounds WHERE vehicle_id = $1 AND (opened_at AT TIME ZONE 'Asia/Amman')::date = (now() AT TIME ZONE 'Asia/Amman')::date`,
      [v.id]
    )).rows[0].n;
    round = (await client.query(
      "INSERT INTO st_rounds (vehicle_id, driver_id, round_no, opened_by, note) VALUES ($1,$2,$3,$4,$5) RETURNING *",
      [v.id, driverId, no, req.user.id, String(req.body?.note || "").trim().slice(0, 200) || null]
    )).rows[0];
    for (const l of lines) {
      const p = products.find((x) => x.id === l.product_id);
      if (!p) continue;
      await client.query("INSERT INTO st_round_items (round_id, product_id, name, loaded) VALUES ($1,$2,$3,$4)", [round.id, p.id, p.name, l.qty]);
    }
    if (hasFeature(req.tenant, "station_stock")) {
      touched = await moveProducts(client, lines.map((l) => ({ product_id: l.product_id, qty: -l.qty })), { kind: "load", roundId: round.id, userId: req.user.id });
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  await checkLowStock(touched, req.user.id);
  const text = lines.map((l) => `${l.qty} ${products.find((p) => p.id === l.product_id)?.name || ""}`).join("، ");
  if (driverId !== req.user.id) {
    const msg = `🚚 انحمّلت «${v.name}» جولة ${round.round_no}: ${text}`;
    await query("INSERT INTO notifications (type, message, target_user_id) VALUES ('ROUND_LOADED', $1, $2)", [msg, driverId]);
    sendPushToUser(driverId, { body: msg, url: `/vehicles/${v.id}` }).catch(() => {});
  }
  await logActivity({ userId: req.user.id, action: "ROUND_LOAD", recordType: "st_round", recordId: round.id, newValue: { vehicle: v.name, driver_id: driverId, items: lines } });
  res.status(201).json(await roundRow(round.id));
}));

// تحميل زيادة على نفس الجولة
router.post("/rounds/:id/add", feature("vehicles"), perm("station", "edit"), wrap(async (req, res) => {
  const round = await roundRow(req.params.id);
  if (!round || round.status !== "open") throw fail(400, "الجولة مش مفتوحة.");
  const lines = (Array.isArray(req.body?.items) ? req.body.items : []).map((x) => ({ product_id: Number(x.product_id), qty: int(x.qty) })).filter((x) => x.product_id > 0 && x.qty > 0);
  if (!lines.length) throw fail(400, "حدد الكمية.");
  const products = (await query("SELECT id, name FROM products WHERE id = ANY($1::int[])", [lines.map((x) => x.product_id)])).rows;
  for (const l of lines) {
    const p = products.find((x) => x.id === l.product_id);
    if (!p) continue;
    await query(
      `INSERT INTO st_round_items (round_id, product_id, name, loaded) VALUES ($1,$2,$3,$4)
       ON CONFLICT (round_id, product_id) DO UPDATE SET loaded = st_round_items.loaded + EXCLUDED.loaded`,
      [round.id, p.id, p.name, l.qty]
    );
  }
  let touched = [];
  if (hasFeature(req.tenant, "station_stock")) {
    touched = await moveProducts({ query }, lines.map((l) => ({ product_id: l.product_id, qty: -l.qty })), { kind: "load", roundId: round.id, userId: req.user.id, note: "تحميل زيادة" });
  }
  await checkLowStock(touched, req.user.id);
  res.json(await roundRow(round.id));
}));

// رجعت السيارة: المرتجع ← بيرجع للمحطة، والجولة بتتسكّر (رصيد السيارة بيتصفّر)
router.post("/rounds/:id/close", feature("vehicles"), perm("station", "edit"), wrap(async (req, res) => {
  const round = await roundRow(req.params.id);
  if (!round || round.status !== "open") throw fail(400, "الجولة مسكّرة من قبل.");
  const retMap = Object.fromEntries((Array.isArray(req.body?.returned) ? req.body.returned : []).map((x) => [Number(x.product_id), int(x.qty)]));
  const delivered = await deliveredInRound(round);
  const items = (await query("SELECT * FROM st_round_items WHERE round_id = $1", [round.id])).rows;
  const back = [];
  const shortages = [];
  for (const it of items) {
    const sold = delivered[it.product_id] || 0;
    const expected = it.loaded - sold - it.damaged;
    const ret = retMap[it.product_id] ?? Math.max(0, expected);
    await query("UPDATE st_round_items SET sold = $1, returned = $2 WHERE id = $3", [sold, ret, it.id]);
    if (ret > 0) back.push({ product_id: it.product_id, qty: ret });
    if (expected - ret !== 0) shortages.push(`${it.name}: ${expected - ret > 0 ? `ناقص ${expected - ret}` : `زايد ${ret - expected}`}`);
  }
  await query("UPDATE st_rounds SET status = 'closed', closed_at = now(), closed_by = $1 WHERE id = $2", [req.user.id, round.id]);
  let touched = [];
  if (hasFeature(req.tenant, "station_stock")) {
    touched = await moveProducts({ query }, back, { kind: "return", roundId: round.id, userId: req.user.id });
  }
  await checkLowStock(touched, req.user.id);
  const closed = await roundRow(round.id);
  const summary = await roundSummary(closed);
  const msg = `🔁 رجعت «${round.vehicle_name}» من جولة ${round.round_no} (${round.driver_name || "—"}): كاش ${summary.total_cash.toFixed(2)} JD${summary.debt ? ` · دين ${summary.debt.toFixed(2)}` : ""}${shortages.length ? ` · ⚠️ ${shortages.join("، ")}` : " · الأرقام مطابقة ✓"}`;
  await notifyUsers((u) => u.role === "super_admin" || can(u, "jard", "view"), { type: "ROUND_CLOSED", title: "رجعت السيارة", message: msg, url: `/vehicles/${round.vehicle_id}`, actorId: req.user.id });
  await logActivity({ userId: req.user.id, action: "ROUND_CLOSE", recordType: "st_round", recordId: round.id, newValue: { returned: retMap, shortages } });
  res.json({ ...closed, summary });
}));

// ============================================================
// الكاشير (بيع المحل)
// ============================================================
router.get("/cashier", feature("cashier"), perm("cashier", "view"), wrap(async (req, res) => {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Amman" });
  const products = (await query("SELECT id, name, unit_price::float AS unit_price FROM products WHERE status = 'active' ORDER BY sort_order, id")).rows;
  const seeAll = can(req.user, "station", "view") || req.user.role === "super_admin";
  const sales = (await query(
    `SELECT s.*, u.full_name AS by_name FROM st_sales s LEFT JOIN users u ON u.id = s.created_by
     WHERE ${DAY("s.created_at")} ${seeAll ? "" : "AND s.created_by = $2"} ORDER BY s.created_at DESC`,
    seeAll ? [today] : [today, req.user.id]
  )).rows;
  const done = sales.filter((s) => s.status === "done");
  res.json({ products, sales, total: r2(done.reduce((a, s) => a + Number(s.total), 0)), count: done.length, can_void: req.user.role === "super_admin" || can(req.user, "station", "edit") });
}));

router.post("/cashier/sales", feature("cashier"), perm("cashier", "edit"), wrap(async (req, res) => {
  const lines = (Array.isArray(req.body?.items) ? req.body.items : []).map((x) => ({ product_id: Number(x.product_id), qty: int(x.qty) })).filter((x) => x.product_id > 0 && x.qty > 0);
  if (!lines.length) throw fail(400, "اختار شو انباع.");
  const products = (await query("SELECT id, name, unit_price FROM products WHERE id = ANY($1::int[])", [lines.map((x) => x.product_id)])).rows;
  const costs = (await query("SELECT product_id, cost_price FROM st_items WHERE product_id = ANY($1::int[]) AND status = 'active'", [lines.map((x) => x.product_id)])).rows;
  const items = [];
  for (const l of lines) {
    const p = products.find((x) => x.id === l.product_id);
    if (!p) continue;
    const price = Number(p.unit_price);
    const cost = Number(costs.find((c) => c.product_id === p.id)?.cost_price || 0);
    items.push({ product_id: p.id, name: p.name, qty: l.qty, price, total: r2(price * l.qty), cost: r2(cost * l.qty) });
  }
  if (!items.length) throw fail(400, "المنتجات مش موجودة.");
  const total = r2(items.reduce((a, x) => a + x.total, 0));
  const costTotal = r2(items.reduce((a, x) => a + x.cost, 0));
  const sale = (await query(
    "INSERT INTO st_sales (items, total, cost_total, note, created_by) VALUES ($1::text::jsonb, $2, $3, $4, $5) RETURNING *",
    [JSON.stringify(items), total, costTotal, String(req.body?.note || "").trim().slice(0, 200) || null, req.user.id]
  )).rows[0];
  let touched = [];
  if (hasFeature(req.tenant, "station_stock")) {
    touched = await moveProducts({ query }, items.map((x) => ({ product_id: x.product_id, qty: -x.qty })), { kind: "shop_sale", saleId: sale.id, userId: req.user.id });
  }
  await checkLowStock(touched, req.user.id);
  const by = await userName(req.user.id);
  await notifyUsers((u) => u.role === "super_admin" || can(u, "jard", "view") || can(u, "station", "edit"), {
    type: "SHOP_SALE", title: "بيعة بالمحل 🧾", url: "/cashier", actorId: req.user.id,
    message: `🧾 ${by || "الكاشير"} باع: ${items.map((x) => `${x.qty} ${x.name}`).join("، ")} — ${total.toFixed(2)} JD`,
  });
  res.status(201).json(sale);
}));

// إلغاء بيعة غلط (الإدارة): بترجع الكمية للمخزون
router.post("/cashier/sales/:id/void", feature("cashier"), wrap(async (req, res) => {
  if (!(req.user.role === "super_admin" || can(req.user, "station", "edit"))) throw fail(403, "الإلغاء للإدارة بس.");
  const s = (await query("UPDATE st_sales SET status = 'void', voided_by = $1 WHERE id = $2 AND status = 'done' RETURNING *", [req.user.id, req.params.id])).rows[0];
  if (!s) throw fail(400, "البيعة ملغية من قبل.");
  await query("DELETE FROM st_moves WHERE sale_id = $1 AND kind = 'shop_sale'", [s.id]);
  res.json({ ok: true });
}));

// ============================================================
// العهدة
// ============================================================
router.get("/custody", feature("custody"), wrap(async (req, res) => {
  const all = can(req.user, "station", "view");
  const r = await query(
    `SELECT u.id AS user_id, u.full_name, u.role, COALESCE(c.amount, 0)::float AS amount, c.note, c.updated_at, ub.full_name AS updated_by_name
     FROM users u LEFT JOIN st_custody c ON c.user_id = u.id LEFT JOIN users ub ON ub.id = c.updated_by
     WHERE u.status = 'active' ${all ? "" : "AND u.id = $1"} ORDER BY COALESCE(c.amount, 0) DESC, u.full_name`,
    all ? [] : [req.user.id]
  );
  res.json({ people: r.rows, total: r2(r.rows.reduce((a, x) => a + x.amount, 0)), can_edit: can(req.user, "station", "edit") });
}));

router.put("/custody/:userId", feature("custody"), perm("station", "edit"), wrap(async (req, res) => {
  const amount = r2(req.body?.amount);
  if (!Number.isFinite(amount) || amount < 0) throw fail(400, "اكتب مبلغ صحيح.");
  const u = (await query("SELECT id, full_name FROM users WHERE id = $1", [req.params.userId])).rows[0];
  if (!u) throw fail(404, "الموظف غير موجود.");
  const before = Number((await query("SELECT amount FROM st_custody WHERE user_id = $1", [u.id])).rows[0]?.amount || 0);
  const note = String(req.body?.note || "").trim().slice(0, 200) || null;
  await query(
    `INSERT INTO st_custody (user_id, amount, note, updated_by, updated_at) VALUES ($1,$2,$3,$4, now())
     ON CONFLICT (user_id) DO UPDATE SET amount = EXCLUDED.amount, note = EXCLUDED.note, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [u.id, amount, note, req.user.id]
  );
  await query("INSERT INTO st_custody_log (user_id, amount_before, amount_after, note, created_by) VALUES ($1,$2,$3,$4,$5)", [u.id, before, amount, note, req.user.id]);
  if (u.id !== req.user.id && before !== amount) {
    const msg = `💼 عهدتك صارت ${amount.toFixed(2)} JD${note ? ` (${note})` : ""}`;
    await query("INSERT INTO notifications (type, message, target_user_id) VALUES ('CUSTODY', $1, $2)", [msg, u.id]);
    sendPushToUser(u.id, { body: msg, url: "/custody" }).catch(() => {});
  }
  res.json({ ok: true });
}));

router.get("/custody/:userId/log", feature("custody"), perm("station", "view"), wrap(async (req, res) => {
  const r = await query(
    `SELECT l.*, u.full_name AS by_name FROM st_custody_log l LEFT JOIN users u ON u.id = l.created_by WHERE l.user_id = $1 ORDER BY l.created_at DESC LIMIT 50`,
    [req.params.userId]
  );
  res.json(r.rows);
}));

// ============================================================
// ملخص المحطة: مبيعات المحطة، مبيعات المركبات، المخزون، الربح، والإجمالي
// ============================================================
router.get("/summary", (req, res, next) => (["vehicles", "station_stock", "cashier"].some((k) => hasFeature(req.tenant, k)) ? next() : res.status(403).json({ error: "هاي الميزة مش مفعّلة لمحلك." })), perm("station", "view"), wrap(async (req, res) => {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Amman" });
  const date = isDate(req.query.date) && req.query.date <= today ? req.query.date : today;
  const f = req.tenant?.features || {};

  // مبيعات المحطة (الكاشير)
  const shopRows = f.cashier ? (await query(`SELECT items, total, cost_total FROM st_sales WHERE status = 'done' AND ${DAY("created_at")}`, [date])).rows : [];
  const shopByProduct = {};
  for (const s of shopRows) for (const it of s.items) {
    const x = (shopByProduct[it.product_id] ||= { product_id: it.product_id, name: it.name, qty: 0, total: 0, cost: 0 });
    x.qty += it.qty; x.total = r2(x.total + it.total); x.cost = r2(x.cost + (it.cost || 0));
  }
  const shop = { count: shopRows.length, total: r2(shopRows.reduce((a, s) => a + Number(s.total), 0)), products: Object.values(shopByProduct) };

  // مبيعات المركبات (التوصيل)
  const veh = (await query(
    `SELECT oi.product_id, oi.product_name_snapshot AS name, SUM(oi.quantity)::int AS qty, COALESCE(SUM(oi.line_total), 0)::float AS total
     FROM trip_stops ts JOIN order_items oi ON oi.order_id = ts.order_id
     WHERE ts.delivered_at IS NOT NULL AND ${DAY("ts.delivered_at")} GROUP BY oi.product_id, oi.product_name_snapshot ORDER BY qty DESC`,
    [date]
  )).rows;
  const vehMoney = (await query(
    `SELECT COUNT(*)::int AS stops, COALESCE(SUM(cash_collected), 0)::float AS cash, COALESCE(SUM(debt_added), 0)::float AS debt
     FROM trip_stops WHERE delivered_at IS NOT NULL AND ${DAY("delivered_at")}`,
    [date]
  )).rows[0];
  const vehicles = { ...vehMoney, total: r2(veh.reduce((a, x) => a + x.total, 0)), products: veh };

  // الربح (حسب سعر الجملة لكل صنف)
  const costMap = f.station_stock
    ? Object.fromEntries((await query("SELECT product_id, cost_price FROM st_items WHERE product_id IS NOT NULL AND status = 'active'")).rows.map((x) => [x.product_id, Number(x.cost_price)]))
    : {};
  const profitRows = {};
  for (const x of veh) {
    const p = (profitRows[x.product_id] ||= { product_id: x.product_id, name: x.name, qty: 0, revenue: 0, cost: 0 });
    p.qty += x.qty; p.revenue = r2(p.revenue + x.total); p.cost = r2(p.cost + x.qty * (costMap[x.product_id] || 0));
  }
  for (const x of shop.products) {
    const p = (profitRows[x.product_id] ||= { product_id: x.product_id, name: x.name, qty: 0, revenue: 0, cost: 0 });
    p.qty += x.qty; p.revenue = r2(p.revenue + x.total); p.cost = r2(p.cost + x.qty * (costMap[x.product_id] || 0));
  }
  const profit = Object.values(profitRows).map((p) => ({ ...p, has_cost: costMap[p.product_id] != null, profit: r2(p.revenue - p.cost) }));

  // المخزون + اللي بالسيارات هلّق
  const stock = f.station_stock ? await stockLevels() : [];
  const onVehicles = [];
  if (f.vehicles) {
    const open = (await query(
      `SELECT r.*, v.name AS vehicle_name, u.full_name AS driver_name FROM st_rounds r JOIN st_vehicles v ON v.id = r.vehicle_id
       LEFT JOIN users u ON u.id = r.driver_id WHERE r.status = 'open' ORDER BY v.sort_order, v.id`
    )).rows;
    for (const r of open) {
      const s = await roundSummary(r);
      onVehicles.push({ round_id: r.id, vehicle_id: r.vehicle_id, vehicle_name: r.vehicle_name, driver_name: r.driver_name, round_no: r.round_no,
        lines: s.lines.map((l) => ({ name: l.name, product_id: l.product_id, remaining: l.remaining })), cash: s.total_cash });
    }
  }
  // الإجمالي لكل منتج: بالمحطة + بالسيارات
  const totals = {};
  for (const it of stock) {
    const key = it.product_id ? `p${it.product_id}` : `i${it.id}`;
    totals[key] = { name: it.name, unit: it.unit, station: it.qty, vehicles: 0 };
  }
  for (const v of onVehicles) for (const l of v.lines) {
    const key = `p${l.product_id}`;
    (totals[key] ||= { name: l.name, unit: "", station: 0, vehicles: 0 }).vehicles += l.remaining;
  }

  res.json({
    date, is_today: date === today, features: f,
    shop, vehicles, on_vehicles: onVehicles,
    stock, capital: r2(stock.reduce((a, x) => a + Math.max(0, x.qty) * x.cost_price, 0)),
    totals: Object.values(totals).map((t) => ({ ...t, total: t.station + t.vehicles })),
    profit, profit_total: r2(profit.reduce((a, p) => a + p.profit, 0)),
    sales_total: r2(shop.total + vehicles.total),
  });
}));

export default router;
