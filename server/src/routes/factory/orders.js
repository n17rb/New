import { Router } from "express";
import { query, pool, logActivity } from "../../db.js";
import { can } from "../../permissions.js";
import { planStops, sortNearest, km, pointOf } from "../../utils/factoryGeo.js";
import { canAction } from "../../permissions.js";
import { sendPushToUser } from "../../utils/push.js";
import { inferRegion } from "../../utils/jordanRegions.js";
import {
  need, needAny, bad, round2, jordanDate, priceFor, bonusFor, queueMessage, ensureTrackToken, itemsText, alert, closeAlerts, factoryPoint,
} from "./lib.js";

// ============================================================
// المصنع: الطلبات، بناء الرحلات وتوزيعها على السيارات، النقل بين السائقين، التأخير
// ============================================================
const router = Router();
const viewOrders = needAny(["f_orders"], ["f_dispatch"], ["f_home"], ["f_stock"]);
const editOrders = needAny(["f_orders", "edit"], ["f_dispatch", "edit"]);
const dispatch = need("f_dispatch", "edit");
const OPEN = ["new", "assigned", "onway", "delayed"];

const addDays = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
function dayWord(date) {
  const today = jordanDate();
  if (date === today) return "اليوم";
  if (date === addDays(today, 1)) return "بكرا";
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("ar-JO-u-nu-latn", { weekday: "long", day: "numeric", month: "numeric" });
}

// ---------- تحميل الطلبات مع تفاصيلها ----------
export async function loadOrders(where, params = []) {
  const r = await query(
    `SELECT o.*, to_char(o.due_date, 'YYYY-MM-DD') AS due_date,
            c.name AS customer_name, c.seq_no, c.photo_url, c.maps_url, c.governorate, c.district, c.phone, c.city, c.address, c.lat, c.lng, c.balance AS customer_balance, c.credit_limit, c.pay_terms, c.line_id,
            t.vehicle_id, t.status AS trip_status, t.load_confirmed_at AS trip_loaded_at, t.driver_id, v.name AS vehicle_name, u.full_name AS driver_name,
            cb.full_name AS created_by_name, eb.full_name AS edited_by_name
     FROM f_orders o JOIN f_customers c ON c.id = o.customer_id
     LEFT JOIN f_trips t ON t.id = o.trip_id LEFT JOIN f_vehicles v ON v.id = t.vehicle_id LEFT JOIN users u ON u.id = t.driver_id
     LEFT JOIN users cb ON cb.id = o.created_by LEFT JOIN users eb ON eb.id = o.edited_by
     WHERE ${where} ORDER BY o.urgent DESC, o.stop_seq NULLS LAST, o.id`,
    params
  );
  if (!r.rows.length) return [];
  const items = await query(
    `SELECT i.*, p.name, p.per_carton, p.image_url FROM f_order_items i JOIN f_products p ON p.id = i.product_id
     WHERE i.order_id = ANY($1::int[]) ORDER BY i.id`,
    [r.rows.map((o) => o.id)]
  );
  const byOrder = new Map();
  for (const i of items.rows) {
    if (!byOrder.has(i.order_id)) byOrder.set(i.order_id, []);
    byOrder.get(i.order_id).push({ ...i, price: Number(i.price) });
  }
  return r.rows.map((o) => {
    const its = byOrder.get(o.id) || [];
    const reg = o.governorate ? null : inferRegion(o.city);
    return {
      ...o,
      ...(reg ? { governorate: reg.governorate, district: reg.district } : {}),
      total: Number(o.total), cash_paid: Number(o.cash_paid), delivered_total: o.delivered_total == null ? null : Number(o.delivered_total),
      customer_balance: Number(o.customer_balance), credit_limit: Number(o.credit_limit),
      items: its, cartons: its.reduce((s, i) => s + i.qty + (i.bonus_qty || 0), 0), bonus: its.reduce((s, i) => s + (i.bonus_qty || 0), 0),
    };
  });
}

router.get("/orders", viewOrders, async (req, res) => {
  const scope = req.query.scope || "open";
  let where = "o.status = ANY($1::text[])";
  let params = [OPEN];
  if (scope === "done") {
    where = "o.status IN ('delivered','failed','cancelled') AND o.updated_at > now() - interval '3 days'";
    params = [];
  }
  if (req.query.customer) {
    where = "o.customer_id = $1";
    params = [Number(req.query.customer)];
  }
  res.json(await loadOrders(where, params));
});

// البونص تلقائي من القواعد، أو يدوي من حساب عنده صلاحية «إعطاء بونص»
async function buildItems(customerId, rawItems, user) {
  const items = [];
  const manualOk = canAction(user, "give_bonus");
  for (const it of Array.isArray(rawItems) ? rawItems : []) {
    const qty = Math.round(Number(it.qty));
    if (!it.product_id || !(qty > 0)) continue;
    const p = (await query("SELECT id, name, active FROM f_products WHERE id = $1", [it.product_id])).rows[0];
    if (!p) throw new Error("منتج غير موجود.");
    const manual = manualOk && it.bonus_qty !== undefined && it.bonus_qty !== null && it.bonus_qty !== "" && it.bonus_manual === true;
    const bonus = manual ? Math.max(0, Math.round(Number(it.bonus_qty) || 0)) : await bonusFor(customerId, p.id, qty);
    items.push({ product_id: p.id, name: p.name, qty, bonus, bonus_manual: manual, price: await priceFor(customerId, p.id) });
  }
  if (!items.length) throw new Error("اختار منتج واحد على الأقل مع الكمية.");
  return items;
}

router.post("/orders", editOrders, async (req, res) => {
  const b = req.body || {};
  const customer = (await query("SELECT id, name FROM f_customers WHERE id = $1 AND active", [b.customer_id])).rows[0];
  if (!customer) return bad(res, "اختار الزبون.");
  let items; try { items = await buildItems(customer.id, b.items, req.user); } catch (e) { return bad(res, e.message); }
  const total = round2(items.reduce((s, i) => s + i.qty * i.price, 0));
  const due = /^\d{4}-\d{2}-\d{2}$/.test(b.due_date || "") ? b.due_date : jordanDate();
  const client = await pool.connect();
  let id;
  try {
    await client.query("BEGIN");
    // تلفونين سجّلوا نفس الطلب؟ قفل على الزبون، وإذا عنده طلب مفتوح منسأل قبل ما نكرر
    await client.query("SELECT id FROM f_customers WHERE id = $1 FOR UPDATE", [customer.id]);
    if (!b.allow_duplicate) {
      const open = (await client.query(
        `SELECT o.id, o.status, o.created_at, u.full_name AS by_name,
                (SELECT string_agg(i.qty || ' ' || p.name, '، ') FROM f_order_items i JOIN f_products p ON p.id = i.product_id WHERE i.order_id = o.id) AS items
         FROM f_orders o LEFT JOIN users u ON u.id = o.created_by
         WHERE o.customer_id = $1 AND o.status IN ('new','assigned','onway','delayed') ORDER BY o.id DESC LIMIT 3`,
        [customer.id]
      )).rows;
      if (open.length) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: `${customer.name} عنده طلب مفتوح.`, code: "duplicate", existing: open });
      }
    }
    id = (await client.query(
      "INSERT INTO f_orders (customer_id, due_date, urgent, notes, total, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
      [customer.id, due, !!b.urgent, b.notes ? String(b.notes).slice(0, 500) : null, total, req.user.id]
    )).rows[0].id;
    for (const i of items) {
      await client.query("INSERT INTO f_order_items (order_id, product_id, qty, price, bonus_qty, bonus_manual) VALUES ($1,$2,$3,$4,$5,$6)", [id, i.product_id, i.qty, i.price, i.bonus, i.bonus_manual]);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  const track = await ensureTrackToken(customer.id);
  const msg = await queueMessage({ customerId: customer.id, orderId: id, kind: "received", data: { customer: customer.name, order: id, items: itemsText(items), due: dayWord(due), track }, userId: req.user.id });
  await logActivity({ userId: req.user.id, action: "F_CREATE_ORDER", recordType: "f_order", recordId: id, newValue: { customer: customer.id, items, total } });
  res.status(201).json({ id, total, bonus: items.reduce((s, i) => s + i.bonus, 0), message_id: msg });
});

router.put("/orders/:id", editOrders, async (req, res) => {
  const o = (await query(
    "SELECT o.*, t.load_confirmed_at, t.driver_id, t.status AS trip_status FROM f_orders o LEFT JOIN f_trips t ON t.id = o.trip_id WHERE o.id = $1",
    [req.params.id]
  )).rows[0];
  if (!o) return bad(res, "الطلب غير موجود.", 404);
  if (["delivered", "cancelled", "failed"].includes(o.status)) return bad(res, o.status === "delivered" ? "الطلب انسلّم — ما بينفع يتعدّل." : "الطلب مسكّر — ما بينفع يتعدّل.");
  if ((o.status === "onway" || o.load_confirmed_at) && !can(req.user, "f_dispatch", "edit")) return bad(res, "الطلب محمّل على السيارة — مسؤول الحركة بيعدّله.");
  let items; try { items = await buildItems(o.customer_id, req.body?.items, req.user); } catch (e) { return bad(res, e.message); }
  const before = (await query("SELECT SUM(qty + bonus_qty)::int AS n FROM f_order_items WHERE order_id = $1", [o.id])).rows[0].n || 0;
  const after = items.reduce((s, i) => s + i.qty + i.bonus, 0);
  const total = round2(items.reduce((s, i) => s + i.qty * i.price, 0));
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM f_order_items WHERE order_id = $1", [o.id]);
    for (const i of items) await client.query("INSERT INTO f_order_items (order_id, product_id, qty, price, bonus_qty, bonus_manual) VALUES ($1,$2,$3,$4,$5,$6)", [o.id, i.product_id, i.qty, i.price, i.bonus, i.bonus_manual]);
    const due = /^\d{4}-\d{2}-\d{2}$/.test(req.body?.due_date || "") ? req.body.due_date : null;
    await client.query(
      "UPDATE f_orders SET total = $1, urgent = $2, notes = $3, due_date = COALESCE($4, due_date), edited_by = $6, edited_at = now(), updated_at = now() WHERE id = $5",
      [total, !!req.body?.urgent, req.body?.notes || null, due, o.id, req.user.id]
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  if (o.trip_id) await recomputeEta(o.trip_id);
  // السائق لازم يعرف إذا الطلب تغيّر وهو محمّل أو بالطريق
  let warning = null;
  if (o.trip_id && (o.load_confirmed_at || o.status === "onway")) {
    const diff = after - before;
    warning = diff > 0 ? `السيارة محمّلة: لازم ينحمّل ${diff} كرتونة زيادة، وإلا السائق بيسلّم الموجود معه بس.` : diff < 0 ? `${-diff} كرتونة بترجع مع السائق للمستودع.` : null;
    if (o.driver_id) sendPushToUser(o.driver_id, { title: `تعدّل طلب #${o.id}`, body: `الكميات الجديدة: ${itemsText(items)}`, url: "/f/drive", tag: `fo-${o.id}` }).catch(() => {});
  }
  await logActivity({ userId: req.user.id, action: "F_UPDATE_ORDER", recordType: "f_order", recordId: o.id, newValue: { items, total } });
  res.json({ ok: true, total, warning });
});

router.post("/orders/:id/cancel", editOrders, async (req, res) => {
  const o = (await query(
    "SELECT o.*, t.load_confirmed_at, t.driver_id FROM f_orders o LEFT JOIN f_trips t ON t.id = o.trip_id WHERE o.id = $1",
    [req.params.id]
  )).rows[0];
  if (!o) return bad(res, "الطلب غير موجود.", 404);
  if (!["new", "assigned", "delayed", "failed", "onway"].includes(o.status)) return bad(res, "الطلب انسلّم أو انلغى من قبل.");
  if (!can(req.user, "f_dispatch", "edit") && o.status !== "new") return bad(res, "الطلب موزّع على سيارة — مسؤول الحركة بيلغيه.");
  const reason = String(req.body?.reason || "انلغى").slice(0, 200);
  // إذا الكراتين محمّلة، الطلب بيضل على الرحلة (ملغي) عشان المرتجع ينحسب صح
  const loaded = !!(o.trip_id && (o.load_confirmed_at || o.status === "onway"));
  await query(
    `UPDATE f_orders SET status = 'cancelled', trip_id = ${loaded ? "trip_id" : "NULL"}, fail_reason = $1, edited_by = $3, edited_at = now(), updated_at = now() WHERE id = $2`,
    [reason, o.id, req.user.id]
  );
  if (o.trip_id) {
    await recomputeEta(o.trip_id);
    if (!loaded) await dropIfEmpty(o.trip_id);
    if (loaded && o.driver_id) sendPushToUser(o.driver_id, { title: `انلغى طلب #${o.id}`, body: `${reason}. الكراتين بترجع معك للمستودع.`, url: "/f/drive", tag: `fo-${o.id}` }).catch(() => {});
  }
  await logActivity({ userId: req.user.id, action: "F_CANCEL_ORDER", recordType: "f_order", recordId: o.id, newValue: { reason } });
  res.json({ ok: true, returns: loaded });
});

// طلب ما تسلّم أو تأجل: بيرجع للطلبات الجديدة عشان ينحط برحلة ثانية
router.post("/orders/:id/reopen", dispatch, async (req, res) => {
  const due = /^\d{4}-\d{2}-\d{2}$/.test(req.body?.due_date || "") ? req.body.due_date : jordanDate();
  await query(
    "UPDATE f_orders SET status = 'new', trip_id = NULL, stop_seq = NULL, eta_at = NULL, due_date = $1, updated_at = now() WHERE id = $2 AND status IN ('failed','delayed')",
    [due, req.params.id]
  );
  res.json({ ok: true });
});

// ============================================================
// الرحلات
// ============================================================
export async function loadTrips(where, params = []) {
  const r = await query(
    `SELECT t.*, to_char(t.trip_date, 'YYYY-MM-DD') AS trip_date, v.name AS vehicle_name, v.capacity, v.governorate, v.plate,
            v.last_lat, v.last_lng, v.last_seen_at, u.full_name AS driver_name, u.id AS driver_user_id
     FROM f_trips t JOIN f_vehicles v ON v.id = t.vehicle_id LEFT JOIN users u ON u.id = t.driver_id
     WHERE ${where} ORDER BY t.trip_date DESC, v.id`,
    params
  );
  if (!r.rows.length) return [];
  const ids = r.rows.map((t) => t.id);
  const [orders, exps, extras, moved] = await Promise.all([
    loadOrders("o.trip_id = ANY($1::int[])", [ids]),
    query("SELECT * FROM f_expenses WHERE trip_id = ANY($1::int[]) ORDER BY id", [ids]),
    query(
      `SELECT m.trip_id, m.product_id, p.name, SUM(m.qty)::int AS qty FROM f_stock_moves m JOIN f_products p ON p.id = m.product_id
       WHERE m.trip_id = ANY($1::int[]) AND m.kind = 'load' AND m.reason = 'زيادة للبيع' GROUP BY m.trip_id, m.product_id, p.name`,
      [ids]
    ),
    // اللي طلع فعلًا على السيارة، واللي تلف فيها — منهم بنحسب المرتجع حتى لو الطلب تعدّل أو انلغى بعد التحميل
    query(
      `SELECT m.trip_id, m.product_id, p.name, m.kind, SUM(m.qty)::int AS qty FROM f_stock_moves m JOIN f_products p ON p.id = m.product_id
       WHERE m.trip_id = ANY($1::int[]) AND (m.kind = 'load' OR (m.kind = 'damage' AND m.damage_source = 'vehicle')) GROUP BY m.trip_id, m.product_id, p.name, m.kind`,
      [ids]
    ),
  ]);
  const now = Date.now();
  return r.rows.map((t) => {
    const stops = orders.filter((o) => o.trip_id === t.id && o.status !== "cancelled").sort((a, b) => (a.stop_seq ?? 999) - (b.stop_seq ?? 999));
    const cancelled_stops = orders.filter((o) => o.trip_id === t.id && o.status === "cancelled");
    const loaded_per = moved.rows.filter((m) => m.trip_id === t.id && m.kind === "load");
    const damaged_per = moved.rows.filter((m) => m.trip_id === t.id && m.kind === "damage");
    const expenses = exps.rows.filter((e) => e.trip_id === t.id).map((e) => ({ ...e, amount: Number(e.amount) }));
    const load = stops.reduce((s, o) => s + o.cartons, 0) + (t.extra_cartons || 0);
    const collected = round2(stops.filter((o) => o.status === "delivered").reduce((s, o) => s + o.cash_paid, 0));
    const expTotal = round2(expenses.filter((e) => e.status !== "rejected").reduce((s, e) => s + e.amount, 0));
    const late = stops.filter((o) => ["assigned", "onway"].includes(o.status) && o.eta_at && t.status === "active" && now - new Date(o.eta_at).getTime() > 30 * 60000).length;
    return {
      ...t,
      gps_km: Number(t.gps_km),
      required_cash: t.required_cash == null ? null : Number(t.required_cash),
      handed_cash: t.handed_cash == null ? null : Number(t.handed_cash),
      cash_diff: t.cash_diff == null ? null : Number(t.cash_diff),
      stops, expenses, load, collected, expenses_total: expTotal, cash_due: round2(collected - expTotal),
      extra_items: extras.rows.filter((x) => x.trip_id === t.id),
      cancelled_stops, loaded_per, damaged_per,
      done: stops.filter((o) => ["delivered", "failed"].includes(o.status)).length,
      late,
      tracking_lost: t.status === "active" && (!t.last_seen_at || now - new Date(t.last_seen_at).getTime() > 15 * 60000),
    };
  });
}

// إشعار على تلفون سائق الرحلة (طلب جديد، نقل، ترتيب)
async function notifyDriver(tripId, title, body) {
  if (!tripId) return;
  const t = (await query("SELECT driver_id FROM f_trips WHERE id = $1", [tripId])).rows[0];
  if (t?.driver_id) sendPushToUser(t.driver_id, { title, body, url: "/f/drive", tag: `ft-${tripId}` }).catch(() => {});
}

// رحلة لسا ما تحمّلت وصارت فاضية (كل طلباتها انتقلت أو تأجلت) بتنلغى لحالها
async function dropIfEmpty(tripId) {
  if (!tripId) return;
  await query(
    `UPDATE f_trips SET status = 'cancelled' WHERE id = $1 AND status = 'planned' AND load_confirmed_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM f_orders o WHERE o.trip_id = $1 AND o.status NOT IN ('cancelled'))`,
    [tripId]
  );
}

// يعيد حساب ترتيب ومواعيد وقفات رحلة
export async function recomputeEta(tripId, { fromNow = false } = {}) {
  const t = (await query("SELECT t.*, to_char(t.trip_date,'YYYY-MM-DD') AS d, v.last_lat, v.last_lng FROM f_trips t JOIN f_vehicles v ON v.id = t.vehicle_id WHERE t.id = $1", [tripId])).rows[0];
  if (!t) return;
  const stops = (await query(
    `SELECT o.id, o.stop_seq, c.lat, c.lng, c.city FROM f_orders o JOIN f_customers c ON c.id = o.customer_id
     WHERE o.trip_id = $1 AND o.status IN ('assigned','onway','delayed') ORDER BY o.stop_seq NULLS LAST, o.id`,
    [tripId]
  )).rows;
  const start = fromNow && t.last_lat ? [t.last_lat, t.last_lng] : await factoryPoint();
  const plan = planStops(start, stops, { date: t.d, departTime: t.depart_time, startAt: fromNow ? new Date().toISOString() : null });
  for (const l of plan.legs) await query("UPDATE f_orders SET eta_at = $1 WHERE id = $2", [l.eta_at, l.id]);
}

router.get("/trips", needAny(["f_dispatch"], ["f_home"], ["f_stock"], ["f_money"]), async (req, res) => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || "") ? req.query.date : null;
  if (req.query.scope === "settle") return res.json(await loadTrips("t.status IN ('active','returned') OR (t.status = 'closed' AND t.settled_at > now() - interval '2 days')"));
  if (date) return res.json(await loadTrips("t.trip_date = $1 AND t.status <> 'cancelled'", [date]));
  // الافتراضي: رحلات اليوم + أي رحلة لسا ما تسكّرت
  res.json(await loadTrips("(t.trip_date = $1 OR t.status IN ('planned','active','returned')) AND t.status <> 'cancelled'", [jordanDate()]));
});

router.get("/trips/:id", needAny(["f_dispatch"], ["f_home"], ["f_stock"], ["f_money"], ["f_drive", "edit"]), async (req, res) => {
  const t = (await loadTrips("t.id = $1", [req.params.id]))[0];
  if (!t) return bad(res, "الرحلة غير موجودة.", 404);
  if (!can(req.user, "f_dispatch") && !can(req.user, "f_home") && !can(req.user, "f_money") && !can(req.user, "f_stock") && t.driver_id !== req.user.id) return bad(res, "مش رحلتك.", 403);
  const pos = await query("SELECT lat, lng, at FROM f_positions WHERE trip_id = $1 ORDER BY id DESC LIMIT 400", [t.id]);
  res.json({ ...t, positions: pos.rows.reverse() });
});

// معاينة رحلة قبل الاعتماد: الحمولة والمسافات والمواعيد
async function previewTrip({ vehicleId, orderIds, sort = false, date, departTime = "08:00" }) {
  const v = (await query("SELECT v.*, u.full_name AS driver_name FROM f_vehicles v LEFT JOIN users u ON u.id = v.driver_id WHERE v.id = $1", [vehicleId])).rows[0];
  if (!v) throw new Error("اختار السيارة.");
  const orders = await loadOrders("o.id = ANY($1::int[])", [orderIds]);
  let stops = orderIds.map((id) => orders.find((o) => o.id === Number(id))).filter(Boolean);
  const factory = await factoryPoint();
  if (sort) stops = sortNearest(factory, stops);
  const existing = (await query(
    `SELECT t.id, t.extra_cartons, COALESCE((SELECT SUM(i.qty + i.bonus_qty) FROM f_orders o JOIN f_order_items i ON i.order_id = o.id WHERE o.trip_id = t.id AND o.status IN ('assigned','onway','delayed') AND NOT (o.id = ANY($3::int[]))), 0)::int AS cartons
     FROM f_trips t WHERE t.vehicle_id = $1 AND t.trip_date = $2 AND t.status IN ('planned','active') ORDER BY t.id LIMIT 1`,
    [v.id, date, orderIds]
  )).rows[0];
  const plan = planStops(factory, stops, { date, departTime });
  const newLoad = stops.reduce((s, o) => s + o.cartons, 0);
  const already = existing ? existing.cartons + existing.extra_cartons : 0;
  return {
    vehicle: { id: v.id, name: v.name, capacity: v.capacity, driver_id: v.driver_id, driver_name: v.driver_name, status: v.status },
    existing_trip_id: existing?.id || null,
    already_loaded: already,
    load: newLoad + already,
    over: newLoad + already - v.capacity,
    stops: plan.legs.map((l) => ({ id: l.id, customer_name: l.customer_name, city: l.city, cartons: l.cartons, leg_km: l.leg_km, eta_at: l.eta_at, from_factory_km: km(factory, pointOf(l)) })),
    total_km: plan.total_km,
  };
}

router.post("/trips/preview", dispatch, async (req, res) => {
  const b = req.body || {};
  try {
    res.json(await previewTrip({ vehicleId: b.vehicle_id, orderIds: (b.order_ids || []).map(Number), sort: !!b.sort, date: b.date || jordanDate(), departTime: b.depart_time || "08:00" }));
  } catch (e) {
    bad(res, e.message);
  }
});

// اعتماد رحلة: الطلبات بتنحط على السيارة بالترتيب، والسائق والزباين بيوصلهم
router.post("/trips", dispatch, async (req, res) => {
  const b = req.body || {};
  const date = /^\d{4}-\d{2}-\d{2}$/.test(b.date || "") ? b.date : jordanDate();
  const orderIds = (b.order_ids || []).map(Number).filter(Boolean);
  if (!orderIds.length) return bad(res, "اختار الطلبات.");
  let pv;
  try { pv = await previewTrip({ vehicleId: b.vehicle_id, orderIds, date, departTime: b.depart_time || "08:00" }); } catch (e) { return bad(res, e.message); }
  if (pv.vehicle.status !== "active") return bad(res, "السيارة مش شغالة (بالصيانة أو موقفة).");
  if (pv.over > 0 && !b.force) return bad(res, `الحمولة أكبر من سعة السيارة بـ${pv.over} كرتونة.`);
  const bad1 = (await query("SELECT id FROM f_orders WHERE id = ANY($1::int[]) AND status NOT IN ('new','delayed','assigned')", [orderIds])).rows;
  if (bad1.length) return bad(res, "في طلبات طلعت أو خلصت — حدّث الصفحة.");

  let tripId = pv.existing_trip_id;
  if (!tripId) {
    tripId = (await query(
      "INSERT INTO f_trips (vehicle_id, driver_id, trip_date, depart_time, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id",
      [pv.vehicle.id, pv.vehicle.driver_id, date, /^\d{1,2}:\d{2}$/.test(b.depart_time || "") ? b.depart_time : "08:00", req.user.id]
    )).rows[0].id;
  }
  const maxSeq = Number((await query("SELECT COALESCE(MAX(stop_seq), 0) AS m FROM f_orders WHERE trip_id = $1 AND NOT (id = ANY($2::int[]))", [tripId, orderIds])).rows[0].m);
  const trip = (await query("SELECT status FROM f_trips WHERE id = $1", [tripId])).rows[0];
  let seq = maxSeq;
  for (const id of orderIds) {
    seq++;
    await query(
      "UPDATE f_orders SET trip_id = $1, stop_seq = $2, status = $3, due_date = $4, updated_at = now() WHERE id = $5",
      [tripId, seq, trip.status === "active" ? "onway" : "assigned", date, id]
    );
  }
  await recomputeEta(tripId, { fromNow: trip.status === "active" });
  const orders = await loadOrders("o.id = ANY($1::int[])", [orderIds]);
  const msgIds = [];
  for (const o of orders) {
    const track = await ensureTrackToken(o.customer_id);
    msgIds.push(await queueMessage({
      customerId: o.customer_id, orderId: o.id, kind: "scheduled",
      data: { order: o.id, day: dayWord(date), eta: o.eta_at, driver: pv.vehicle.driver_name || "السائق", vehicle: pv.vehicle.name, track }, userId: req.user.id,
    }));
  }
  {
    const cartons = orders.reduce((a, o) => a + o.cartons, 0);
    const names = orders.slice(0, 3).map((o) => o.customer_name).join("، ") + (orders.length > 3 ? ` و${orders.length - 3} غيرهم` : "");
    await notifyDriver(tripId, pv.existing_trip_id ? `انضافلك ${orders.length} طلب 🚚` : `عندك رحلة جديدة 🚚`, `${names} · ${cartons} كرتونة. افتح «رحلتي» تشوف الترتيب.`);
  }
  if (pv.over > 0) await alert({ level: "warn", kind: "overload", ref: tripId, title: `${pv.vehicle.name} محمّلة فوق سعتها`, body: `${pv.load} كرتونة والسعة ${pv.vehicle.capacity}.`, dedupe: true });
  await logActivity({ userId: req.user.id, action: "F_BUILD_TRIP", recordType: "f_trip", recordId: tripId, newValue: { vehicle: pv.vehicle.id, orders: orderIds } });
  res.status(201).json({ trip_id: tripId, message_ids: msgIds });
});

// ترتيب الوقفات يدويًا أو من الأقرب للأبعد
router.put("/trips/:id/stops", dispatch, async (req, res) => {
  let ids = (req.body?.order_ids || []).map(Number);
  if (req.body?.sort) {
    const orders = await loadOrders("o.trip_id = $1 AND o.status IN ('assigned','onway','delayed')", [req.params.id]);
    ids = sortNearest(await factoryPoint(), orders).map((o) => o.id);
  }
  let seq = 0;
  for (const id of ids) await query("UPDATE f_orders SET stop_seq = $1 WHERE id = $2 AND trip_id = $3", [++seq, id, req.params.id]);
  const t = (await query("SELECT status FROM f_trips WHERE id = $1", [req.params.id])).rows[0];
  await recomputeEta(Number(req.params.id), { fromNow: t?.status === "active" });
  await notifyDriver(Number(req.params.id), "تغيّر ترتيب الوقفات", "افتح «رحلتي» تشوف الترتيب الجديد.");
  res.json({ ok: true });
});

router.put("/trips/:id", dispatch, async (req, res) => {
  const t = (await query("SELECT * FROM f_trips WHERE id = $1", [req.params.id])).rows[0];
  if (!t) return bad(res, "الرحلة غير موجودة.", 404);
  const depart = /^\d{1,2}:\d{2}$/.test(req.body?.depart_time || "") ? req.body.depart_time : t.depart_time;
  const driver = req.body?.driver_id !== undefined ? (req.body.driver_id ? Number(req.body.driver_id) : null) : t.driver_id;
  await query("UPDATE f_trips SET depart_time = $1, driver_id = $2 WHERE id = $3", [depart, driver, t.id]);
  if (t.status === "planned") await recomputeEta(t.id);
  res.json({ ok: true });
});

router.post("/trips/:id/cancel", dispatch, async (req, res) => {
  const t = (await query("SELECT * FROM f_trips WHERE id = $1", [req.params.id])).rows[0];
  if (!t) return bad(res, "الرحلة غير موجودة.", 404);
  if (t.status !== "planned" || t.load_confirmed_at) return bad(res, "الرحلة تحمّلت أو طلعت — ما بتنلغى. انقل طلباتها لسيارة ثانية بدلها.");
  await query("UPDATE f_orders SET status = 'new', trip_id = NULL, stop_seq = NULL, eta_at = NULL WHERE trip_id = $1 AND status IN ('assigned','delayed')", [t.id]);
  await query("UPDATE f_trips SET status = 'cancelled' WHERE id = $1", [t.id]);
  res.json({ ok: true });
});

// نقل طلب من سيارة لسيارة
router.post("/orders/:id/transfer", dispatch, async (req, res) => {
  const o = (await loadOrders("o.id = $1", [req.params.id]))[0];
  if (!o) return bad(res, "الطلب غير موجود.", 404);
  if (!["assigned", "onway", "delayed", "new"].includes(o.status)) return bad(res, "الطلب خلص — ما بينتقل.");
  const reason = String(req.body?.reason || "").trim();
  if (!reason) return bad(res, "اختار سبب النقل.");
  const target = (await query("SELECT v.*, u.full_name AS driver_name FROM f_vehicles v LEFT JOIN users u ON u.id = v.driver_id WHERE v.id = $1", [req.body?.vehicle_id])).rows[0];
  if (!target) return bad(res, "اختار السيارة.");
  if (target.status !== "active") return bad(res, "السيارة هاي مش شغالة.");
  if (o.vehicle_id === target.id) return bad(res, "الطلب أصلًا على هالسيارة.");
  const date = o.trip_id ? (await query("SELECT to_char(trip_date,'YYYY-MM-DD') AS d FROM f_trips WHERE id = $1", [o.trip_id])).rows[0].d : jordanDate();
  let tt = (await query("SELECT id, status FROM f_trips WHERE vehicle_id = $1 AND trip_date = $2 AND status IN ('planned','active') ORDER BY id LIMIT 1", [target.id, date])).rows[0];
  if (!tt) {
    tt = (await query("INSERT INTO f_trips (vehicle_id, driver_id, trip_date, created_by) VALUES ($1,$2,$3,$4) RETURNING id, status", [target.id, target.driver_id, date, req.user.id])).rows[0];
  }
  const seq = Number((await query("SELECT COALESCE(MAX(stop_seq),0)+1 AS s FROM f_orders WHERE trip_id = $1", [tt.id])).rows[0].s);
  const fromTrip = o.trip_id;
  await query("UPDATE f_orders SET trip_id = $1, stop_seq = $2, status = $3, updated_at = now() WHERE id = $4", [tt.id, seq, tt.status === "active" ? "onway" : "assigned", o.id]);
  if (fromTrip) {
    await recomputeEta(fromTrip, { fromNow: o.trip_status === "active" });
    await dropIfEmpty(fromTrip);
  }
  await recomputeEta(tt.id, { fromNow: tt.status === "active" });
  const loaded = o.trip_status === "active" || o.status === "onway";
  await alert({
    level: "info", kind: "transfer", ref: o.id,
    title: `طلب #${o.id} انتقل من ${o.vehicle_name || "بدون سيارة"} لـ${target.name}`,
    body: `${o.customer_name} · ${o.cartons} كرتونة · السبب: ${reason}${loaded ? " · الكراتين محمّلة على السيارة الأولى، لازم تنتقل." : ""}`,
  });
  const track = await ensureTrackToken(o.customer_id);
  const msg = await queueMessage({ customerId: o.customer_id, orderId: o.id, kind: "transfer", data: { order: o.id, driver: target.driver_name || "السائق", vehicle: target.name, track }, userId: req.user.id });
  await logActivity({ userId: req.user.id, action: "F_TRANSFER_ORDER", recordType: "f_order", recordId: o.id, newValue: { from: o.vehicle_id, to: target.id, reason } });
  await notifyDriver(tt.id, `انضافلك طلب: ${o.customer_name} 🚚`, `${o.cartons} كرتونة${o.city ? ` · ${o.city}` : ""}. افتح «رحلتي».`);
  if (fromTrip) await notifyDriver(fromTrip, `انشال طلب ${o.customer_name} منك`, `انتقل لـ${target.name}.${loaded ? " الكراتين اللي معك إله لازم تنتقل." : ""}`);
  res.json({ ok: true, trip_id: tt.id, message_ids: [msg], cartons_loaded: loaded });
});

// تأخير: رسالة لكل زباين الرحلة (أو طلبات محددة) مع السبب والموعد الجديد
router.post("/trips/:id/delay", dispatch, async (req, res) => {
  const t = (await query("SELECT * FROM f_trips WHERE id = $1", [req.params.id])).rows[0];
  if (!t) return bad(res, "الرحلة غير موجودة.", 404);
  const reason = String(req.body?.reason || "").trim();
  const when = String(req.body?.when || "").trim();
  if (!reason || !when) return bad(res, "اختار السبب والموعد الجديد.");
  const nextDay = !!req.body?.next_day;
  const only = Array.isArray(req.body?.order_ids) && req.body.order_ids.length ? req.body.order_ids.map(Number) : null;
  const orders = (await loadOrders("o.trip_id = $1 AND o.status IN ('assigned','onway','delayed')", [t.id])).filter((o) => !only || only.includes(o.id));
  if (!orders.length) return bad(res, "ما في طلبات مفتوحة على هالرحلة.");
  const msgIds = [];
  const tomorrow = addDays(jordanDate(), 1);
  for (const o of orders) {
    if (nextDay) {
      await query("UPDATE f_orders SET status = 'delayed', delay_reason = $1, trip_id = NULL, stop_seq = NULL, eta_at = NULL, due_date = $2, updated_at = now() WHERE id = $3", [reason, tomorrow, o.id]);
    } else {
      await query("UPDATE f_orders SET delay_reason = $1, updated_at = now() WHERE id = $2", [reason, o.id]);
    }
    const track = await ensureTrackToken(o.customer_id);
    msgIds.push(await queueMessage({ customerId: o.customer_id, orderId: o.id, kind: "delay", data: { order: o.id, reason, when, note: req.body?.note || "", track }, userId: req.user.id }));
  }
  await query("UPDATE f_trips SET delay_reason = $1 WHERE id = $2", [reason, t.id]);
  if (nextDay) await dropIfEmpty(t.id);
  await alert({ level: "warn", kind: "delay", ref: t.id, title: `تأخير رحلة — ${reason}`, body: `${orders.length} زباين وصلهم رسالة. الموعد الجديد: ${when}.` });
  await closeAlerts("breakdown", t.id, req.user.id);
  res.json({ ok: true, message_ids: msgIds });
});

export default router;
