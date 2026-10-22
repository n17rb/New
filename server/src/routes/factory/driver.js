import { Router } from "express";
import { query, pool, logActivity } from "../../db.js";
import { can, canAction } from "../../permissions.js";
import { km, chainNearest } from "../../utils/factoryGeo.js";
import { smartFilter } from "../../utils/smartSearch.js";
import { need, bad, round2, jordanDate, postLedger, queueMessage, ensureTrackToken, itemsText, alert, publicToken, pushManagers, priceFor, bonusFor, once } from "./lib.js";
import { cleanCustomer, nextSeq } from "./customers.js";
import { loadTrips, loadOrders, recomputeEta } from "./orders.js";
import { factoryPoint } from "./lib.js";

// ============================================================
// المصنع: تطبيق السائق — فتح الرحلة، التسليم، المصاريف، الإبلاغ، الرجوع
// ============================================================
const router = Router();
const drive = need("f_drive", "edit");
const FUEL = ["فاضي", "ربع", "نص", "ثلاث أرباع", "مليان"];

async function myTrip(req, id) {
  const t = (await loadTrips("t.id = $1", [id]))[0];
  if (!t) return null;
  if (t.driver_id !== req.user.id && !can(req.user, "f_dispatch", "edit")) return null;
  return t;
}

// رحلتي اليوم
router.get("/driver/today", drive, async (req, res) => {
  const vehicles = (await query("SELECT id, name, capacity, governorate, plate FROM f_vehicles WHERE driver_id = $1 AND status <> 'inactive'", [req.user.id])).rows;
  const trips = await loadTrips(
    "t.driver_id = $1 AND t.status IN ('planned','active','returned') AND t.trip_date <= $2",
    [req.user.id, jordanDate()]
  );
  // الرحلة الشغالة أولًا، بعدين الجاية (حتى لو في رحلة راجعة لسا ما انحاسبت)، وآخر إشي الراجعة
  const byDate = (a, b) => a.trip_date.localeCompare(b.trip_date) || a.id - b.id;
  const planned = trips.filter((t) => t.status === "planned").sort(byDate);
  const returned = trips.filter((t) => t.status === "returned").sort(byDate);
  const trip = trips.find((t) => t.status === "active") || planned[0] || returned[0] || null;
  // رحلة رجعت ولسا ما سلّم حسابها — بنذكّره فيها فوق
  const unsettled = returned.filter((t) => t.id !== trip?.id).map((t) => ({ id: t.id, vehicle_name: t.vehicle_name, cash_due: t.cash_due, trip_date: t.trip_date }));
  const custody = Number((await query("SELECT COALESCE(SUM(amount),0) AS s FROM f_driver_ledger WHERE driver_id = $1", [req.user.id])).rows[0].s);
  const lastFuel = trip?.vehicle_id ? (await query(
    "SELECT fuel_end, to_char(returned_at AT TIME ZONE 'Asia/Amman','HH24:MI') AS at FROM f_trips WHERE vehicle_id = $1 AND fuel_end IS NOT NULL AND id <> $2 ORDER BY returned_at DESC LIMIT 1",
    [trip.vehicle_id, trip.id]
  )).rows[0] : null;
  const problems = (await query(
    "SELECT id, title, kind, created_at FROM f_alerts WHERE user_id = $1 AND kind IN ('breakdown','problem') AND closed_at IS NULL AND created_at > now() - interval '3 days' ORDER BY id DESC",
    [req.user.id]
  )).rows;
  const car_stock = trip && (trip.kind === "sales" || ["planned", "active"].includes(trip.status)) ? await carStock(trip.id) : null;
  res.json({ problems, unsettled, car_stock, vehicles, trip, custody: round2(custody), fuel_levels: FUEL, last_fuel: lastFuel || null, can_credit: canAction(req.user, "give_credit") });
});

// صور وقراءات البداية والنهاية (عداد + ديزل)
router.post("/driver/trips/:id/check", drive, async (req, res) => {
  const t = await myTrip(req, req.params.id);
  if (!t) return bad(res, "الرحلة مش إلك.", 403);
  const kind = req.body?.kind;
  const photo = req.body?.photo_url || null;
  if (!photo) return bad(res, "صوّر أول.");
  if (kind === "odo_start" || kind === "odo_end") {
    const v = Math.round(Number(req.body?.value));
    if (!(v > 0)) return bad(res, "اكتب رقم العداد.");
    if (kind === "odo_end" && t.odo_start && v < t.odo_start) return bad(res, "رقم العداد أقل من رقم الصبح.");
    await query(`UPDATE f_trips SET ${kind} = $1, photo_${kind} = $2 WHERE id = $3`, [v, photo, t.id]);
  } else if (kind === "fuel_start" || kind === "fuel_end") {
    const lvl = String(req.body?.value || "");
    if (!FUEL.includes(lvl)) return bad(res, "اختار مستوى الديزل.");
    await query(`UPDATE f_trips SET ${kind} = $1, photo_${kind} = $2 WHERE id = $3`, [lvl, photo, t.id]);
  } else return bad(res, "نوع غير معروف.");
  res.json({ ok: true });
});

// تأكيد الحمولة (السائق أو أمين المستودع)
export async function confirmLoad(tripId, userId, extra = []) {
  const t = (await query("SELECT * FROM f_trips WHERE id = $1", [tripId])).rows[0];
  if (!t) throw new Error("الرحلة غير موجودة.");
  if (t.load_confirmed_at) return;
  const items = (await query(
    `SELECT i.product_id, SUM(i.qty + i.bonus_qty)::int AS qty FROM f_orders o JOIN f_order_items i ON i.order_id = o.id
     WHERE o.trip_id = $1 AND o.status IN ('assigned','onway','delayed') GROUP BY i.product_id`,
    [tripId]
  )).rows;
  for (const i of items) {
    await query("INSERT INTO f_stock_moves (product_id, kind, qty, trip_id, vehicle_id, created_by) VALUES ($1,'load',$2,$3,$4,$5)", [i.product_id, i.qty, tripId, t.vehicle_id, userId]);
  }
  let extraTotal = 0;
  for (const e of extra) {
    const q = Math.round(Number(e.qty));
    if (e.product_id && q > 0) {
      await query("INSERT INTO f_stock_moves (product_id, kind, qty, trip_id, vehicle_id, reason, created_by) VALUES ($1,'load',$2,$3,$4,'زيادة للبيع',$5)", [e.product_id, q, tripId, t.vehicle_id, userId]);
      extraTotal += q;
    }
  }
  await query("UPDATE f_trips SET load_confirmed_at = now(), load_confirmed_by = $1, extra_cartons = $2 WHERE id = $3", [userId, extraTotal, tripId]);
}

router.post("/driver/trips/:id/confirm-load", drive, async (req, res) => {
  const t = await myTrip(req, req.params.id);
  if (!t) return bad(res, "الرحلة مش إلك.", 403);
  await confirmLoad(t.id, req.user.id, []);
  res.json({ ok: true });
});

// بداية الرحلة (من الزر، أو لحالها لما يسلّم/ينطلق لأي زبون قبل ما يكبس «ابدأ»)
async function startTrip(t, userId = t.driver_id) {
  if (!t.load_confirmed_at) await confirmLoad(t.id, userId, []);
  await query("UPDATE f_trips SET status = 'active', started_at = now() WHERE id = $1 AND status = 'planned'", [t.id]);
  await query("UPDATE f_orders SET status = 'onway', updated_at = now() WHERE trip_id = $1 AND status = 'assigned'", [t.id]);
  await query("UPDATE f_vehicles SET last_seen_at = now() WHERE id = $1", [t.vehicle_id]);
  t.status = "active";
  await pushManagers({ title: `🚚 ${t.driver_name || "السائق"} طلع بالرحلة`, body: `${t.vehicle_name} · ${t.stops.length} زبون. تابعه على الخريطة.`, url: "/f/trips", tag: `ts-${t.id}` });
}

// رتّب الباقي من مكاني هلأ (الأقرب فالأقرب)
router.post("/driver/trips/:id/resort", drive, async (req, res) => {
  const t = await myTrip(req, req.params.id);
  if (!t) return bad(res, "الرحلة مش إلك.", 403);
  const lat = Number(req.body?.lat), lng = Number(req.body?.lng);
  let start = Number.isFinite(lat) && lat ? [lat, lng] : null;
  if (!start) {
    const v = (await query("SELECT last_lat, last_lng FROM f_vehicles WHERE id = $1", [t.vehicle_id])).rows[0];
    start = v?.last_lat != null && t.status === "active" ? [v.last_lat, v.last_lng] : await factoryPoint();
  } else {
    await query("UPDATE f_vehicles SET last_lat = $1, last_lng = $2, last_seen_at = now() WHERE id = $3", [lat, lng, t.vehicle_id]);
  }
  const done = t.stops.filter((o) => ["delivered", "failed"].includes(o.status));
  const open = t.stops.filter((o) => !["delivered", "failed"].includes(o.status));
  let seq = 0;
  for (const o of done) await query("UPDATE f_orders SET stop_seq = $1 WHERE id = $2", [++seq, o.id]);
  for (const o of chainNearest(start, open)) await query("UPDATE f_orders SET stop_seq = $1 WHERE id = $2", [++seq, o.id]);
  await recomputeEta(t.id, { fromNow: t.status === "active" });
  res.json({ ok: true });
});

// بداية الرحلة
router.post("/driver/trips/:id/start", drive, async (req, res) => {
  const t = await myTrip(req, req.params.id);
  if (!t) return bad(res, "الرحلة مش إلك.", 403);
  if (t.status !== "planned") return bad(res, "الرحلة بلشت من قبل.");
  // بدون صور عداد وديزل: إذا الحمولة ما تأكدت من المستودع، كبسة «ابدأ» بتأكدها
  await startTrip(t, req.user.id);
  // أول زبون: بنحسب وقت الوصول من مكان السائق وبنجهّزله رسالة
  const first = (await loadOrders("o.trip_id = $1 AND o.status = 'onway'", [t.id]))[0];
  const go = first ? await goTo(first, t, req) : null;
  res.json({ ok: true, ...(go || {}) });
});

// «انطلق لعند الزبون»: وقت الوصول من مكان السائق هلأ (خط مستقيم × ١.٣، والسرعة حسب المسافة + دقيقتين)
async function goTo(o, t, req) {
  let lat = Number(req.body?.lat), lng = Number(req.body?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !lat) {
    const v = (await query("SELECT last_lat, last_lng FROM f_vehicles WHERE id = $1", [t.vehicle_id])).rows[0];
    lat = v?.last_lat; lng = v?.last_lng;
  }
  let minutes = null;
  if (lat != null && o.lat != null) {
    const d = km([lat, lng], [o.lat, o.lng]) * 1.3;
    const speed = d > 25 ? 70 : d > 8 ? 50 : 35; // طريق سريع / بين المناطق / جوّا البلد
    minutes = Math.max(3, Math.round((d / speed) * 60) + 2);
  }
  const eta = minutes != null ? new Date(Date.now() + minutes * 60000) : o.eta_at ? new Date(o.eta_at) : null;
  await query("UPDATE f_orders SET en_route_at = NULL WHERE trip_id = $1 AND id <> $2", [t.id, o.id]);
  await query("UPDATE f_orders SET en_route_at = now(), eta_at = COALESCE($2, eta_at), updated_at = now() WHERE id = $1", [o.id, eta]);
  const track = await ensureTrackToken(o.customer_id);
  const msg = await queueMessage({
    customerId: o.customer_id, orderId: o.id, kind: "coming",
    data: { driver: t.driver_name || "السائق", eta, minutes, order: o.id, track }, userId: req.user.id,
  });
  return { message_id: msg, eta_at: eta, minutes, order_id: o.id };
}

router.post("/driver/orders/:id/go", drive, async (req, res) => {
  const o = (await loadOrders("o.id = $1", [req.params.id]))[0];
  if (!o) return bad(res, "الطلب غير موجود.", 404);
  const t = await myTrip(req, o.trip_id);
  if (!t) return bad(res, "الطلب مش على رحلتك.", 403);
  if (t.status === "planned") await startTrip(t);
  else if (t.status !== "active") return bad(res, "الرحلة مش شغالة.");
  if (!["onway", "assigned"].includes(o.status)) return bad(res, "هالطلب خلص.");
  res.json({ ok: true, ...(await goTo(o, t, req)) });
});

// موقع السائق كل دقيقة (والتطبيق مفتوح)
router.post("/driver/ping", drive, async (req, res) => {
  const lat = Number(req.body?.lat), lng = Number(req.body?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.json({ ok: false });
  const v = (await query("SELECT id, last_lat, last_lng, last_seen_at FROM f_vehicles WHERE driver_id = $1 AND status <> 'inactive' ORDER BY id LIMIT 1", [req.user.id])).rows[0];
  if (!v) return res.json({ ok: false });
  const trip = (await query("SELECT id FROM f_trips WHERE vehicle_id = $1 AND status = 'active' ORDER BY id DESC LIMIT 1", [v.id])).rows[0];
  if (v.last_lat != null && trip) {
    const d = km([v.last_lat, v.last_lng], [lat, lng]) / 1.25;
    if (d > 0.05 && d < 20) await query("UPDATE f_trips SET gps_km = gps_km + $1 WHERE id = $2", [round2(d), trip.id]);
  }
  await query("UPDATE f_vehicles SET last_lat = $1, last_lng = $2, last_seen_at = now() WHERE id = $3", [lat, lng, v.id]);
  if (trip) {
    await query("INSERT INTO f_positions (trip_id, vehicle_id, lat, lng) VALUES ($1,$2,$3,$4)", [trip.id, v.id, lat, lng]);
    await query("UPDATE f_alerts SET closed_at = now() WHERE kind = 'tracking' AND ref_id = $1 AND closed_at IS NULL", [trip.id]);
  }
  res.json({ ok: true });
});

// التسليم عند الزبون
router.post("/driver/orders/:id/deliver", drive, once(async (req, res) => {
  const o = (await loadOrders("o.id = $1", [req.params.id]))[0];
  if (!o) return bad(res, "الطلب غير موجود.", 404);
  const t = o.trip_id ? await myTrip(req, o.trip_id) : null;
  if (!t) return bad(res, "الطلب مش على رحلتك.", 403);
  if (o.status === "delivered") return bad(res, "الطلب مسلّم من قبل.");
  if (t.status === "planned") await startTrip(t);
  else if (t.status !== "active") return bad(res, "الرحلة مش شغالة.");
  const b = req.body || {};
  return deliverOrder(req, res, o, t, b);
}));

// تسجيل التسليم (للطلبات العادية، ولبيع المندوب على الطريق)
async function deliverOrder(req, res, o, t, b, { sale = false } = {}) {
  const byItem = new Map((b.items || []).map((i) => [Number(i.item_id), i]));
  let total = 0;
  const lines = [];
  for (const it of o.items) {
    const x = byItem.get(it.id) || {};
    const dq = x.delivered_qty == null ? it.qty : Math.round(Number(x.delivered_qty));
    const dmg = Math.max(0, Math.round(Number(x.damaged_qty) || 0));
    const bonus = it.bonus_qty || 0;
    const db = x.delivered_bonus == null ? bonus : Math.round(Number(x.delivered_bonus));
    // الزبون ممكن ياخذ أقل أو أكثر من المطلوب (الزيادة من اللي على السيارة)
    if (!(dq >= 0) || dq > 100000) return bad(res, `كمية ${it.name} غير صحيحة.`);
    if (!(db >= 0) || db > bonus) return bad(res, `بونص ${it.name} غير صحيح.`);
    if (dmg > Math.max(0, it.qty + bonus - dq - db)) return bad(res, `التالف من ${it.name} أكثر من الراجع.`);
    total += dq * it.price; // البونص ببلاش: ما بينحسب بالفاتورة
    lines.push({ ...it, dq, dmg, db });
  }
  // منتج ما كان بالطلب وأخذه الزبون من السيارة
  const added = [];
  for (const x of Array.isArray(b.add_items) ? b.add_items : []) {
    const q = Math.round(Number(x.qty));
    if (!x.product_id || !(q > 0) || q > 100000) continue;
    const p = (await query("SELECT id, name FROM f_products WHERE id = $1 AND active", [x.product_id])).rows[0];
    if (!p) continue;
    const price = await priceFor(o.customer_id, p.id);
    total += q * price;
    added.push({ product_id: p.id, name: p.name, qty: q, price });
  }
  // استبدال تالف: أخذنا من الزبون كراتين تالفة وأعطيناه بدالها جديد (ما بينحسب بالفاتورة)
  const exchanges = [];
  for (const x of Array.isArray(b.exchanges) ? b.exchanges : []) {
    const q = Math.round(Number(x.qty));
    if (!x.product_id || !(q > 0) || q > 100000) continue;
    const p = (await query("SELECT id, name FROM f_products WHERE id = $1", [x.product_id])).rows[0];
    if (p) exchanges.push({ product_id: p.id, name: p.name, qty: q });
  }
  total = round2(total);
  const cash = round2(b.cash);
  if (cash < 0) return bad(res, "المبلغ غير صحيح.");
  const debt = round2(total - cash);
  const c = (await query("SELECT * FROM f_customers WHERE id = $1", [o.customer_id])).rows[0];
  const newBal = round2(Number(c.balance) + debt);
  let overLimit = false;
  if (debt > 0) {
    if (!canAction(req.user, "give_credit")) return bad(res, "ما عندك صلاحية تبيع بالدين — خذ المبلغ كامل.");
    overLimit = Number(c.credit_limit) > 0 ? newBal > Number(c.credit_limit) : c.pay_terms === "cash";
    if (overLimit && !b.confirm_over_limit) {
      return res.status(409).json({ error: `الزبون رح يصير عليه ${newBal.toFixed(2)} د.أ${Number(c.credit_limit) > 0 ? ` وسقفه ${Number(c.credit_limit).toFixed(2)}` : " وهو زبون كاش"}. إذا كملت بيوصل تنبيه للإدارة.`, code: "OVER_LIMIT" });
    }
  }
  const token = o.invoice_token || publicToken();
  const client = await pool.connect();
  let balance;
  try {
    await client.query("BEGIN");
    // قفل على الطلب: إذا انسلّم بنفس اللحظة من كبسة ثانية، ما بنسجّله مرتين
    const cur = (await client.query("SELECT status FROM f_orders WHERE id = $1 FOR UPDATE", [o.id])).rows[0];
    if (!cur || cur.status === "delivered") {
      await client.query("ROLLBACK");
      return bad(res, "الطلب مسلّم من قبل.");
    }
    for (const x of exchanges) {
      await client.query("INSERT INTO f_order_exchanges (order_id, product_id, qty) VALUES ($1,$2,$3)", [o.id, x.product_id, x.qty]);
      await client.query(
        "INSERT INTO f_stock_moves (product_id, kind, qty, damage_source, trip_id, vehicle_id, reason, photo_url, created_by) VALUES ($1,'damage',$2,'customer',$3,$4,$5,$6,$7)",
        [x.product_id, x.qty, t.id, t.vehicle_id, `استبدال تالف عند ${o.customer_name}`, b.exchange_photo || null, req.user.id]
      );
    }
    for (const a of added) {
      await client.query("INSERT INTO f_order_items (order_id, product_id, qty, price, delivered_qty, bonus_qty, delivered_bonus) VALUES ($1,$2,$3,$4,$3,0,0)", [o.id, a.product_id, a.qty, a.price]);
    }
    for (const l of lines) {
      await client.query("UPDATE f_order_items SET delivered_qty = $1, damaged_qty = $2, delivered_bonus = $3 WHERE id = $4", [l.dq, l.dmg, l.db, l.id]);
      if (l.dmg > 0) {
        await client.query(
          "INSERT INTO f_stock_moves (product_id, kind, qty, damage_source, trip_id, vehicle_id, reason, photo_url, created_by) VALUES ($1,'damage',$2,'vehicle',$3,$4,$5,$6,$7)",
          [l.product_id, l.dmg, t.id, t.vehicle_id, b.damage_reason || "تالف عند التسليم", b.photo_url || null, req.user.id]
        );
      }
    }
    await client.query(
      `UPDATE f_orders SET status = 'delivered', delivered_total = $1, cash_paid = $2, signature = $3, proof_photo = $4,
         delivered_lat = $5, delivered_lng = $6, delivered_at = now(), invoice_token = $7, updated_at = now() WHERE id = $8`,
      [total, cash, b.signature ? String(b.signature).slice(0, 200000) : null, b.photo_url || null, Number(b.lat) || null, Number(b.lng) || null, token, o.id]
    );
    balance = await postLedger(client, { customerId: c.id, kind: "invoice", amount: total, orderId: o.id, tripId: t.id, note: `فاتورة طلب #${o.id}`, userId: req.user.id });
    if (cash > 0) balance = await postLedger(client, { customerId: c.id, kind: "payment", amount: -cash, orderId: o.id, tripId: t.id, method: "cash", note: `كاش مع ${t.driver_name || "السائق"}`, userId: req.user.id });
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  // سلّم أكثر من اللي انسجّل إنه طلع على السيارة؟ معناها في تحميل ما انسجّل — منسجّله هلأ عشان المستودع والجرد يضلوا مزبوطين
  if (t.load_confirmed_at) {
    const over = (await query(
      `WITH l AS (SELECT product_id, SUM(qty)::int AS q FROM f_stock_moves WHERE trip_id = $1 AND kind = 'load' GROUP BY product_id),
            s AS (SELECT i.product_id, SUM(COALESCE(i.delivered_qty,0) + COALESCE(i.delivered_bonus,0))::int AS q FROM f_orders o JOIN f_order_items i ON i.order_id = o.id WHERE o.trip_id = $1 AND o.status = 'delivered' GROUP BY i.product_id),
            x AS (SELECT x.product_id, SUM(x.qty)::int AS q FROM f_order_exchanges x JOIN f_orders o ON o.id = x.order_id WHERE o.trip_id = $1 AND o.status = 'delivered' GROUP BY x.product_id),
          r AS (SELECT i.product_id, SUM(i.qty + i.bonus_qty)::int AS q FROM f_orders o JOIN f_order_items i ON i.order_id = o.id WHERE o.trip_id = $1 AND o.status IN ('assigned','onway','delayed') GROUP BY i.product_id),
            d AS (SELECT product_id, SUM(qty)::int AS q FROM f_stock_moves WHERE trip_id = $1 AND kind = 'damage' AND damage_source = 'vehicle' GROUP BY product_id)
       SELECT p.id, p.name, COALESCE(s.q,0) + COALESCE(x.q,0) + COALESCE(d.q,0) - COALESCE(l.q,0) AS over
       FROM f_products p LEFT JOIN l ON l.product_id = p.id LEFT JOIN s ON s.product_id = p.id LEFT JOIN x ON x.product_id = p.id LEFT JOIN d ON d.product_id = p.id
       WHERE COALESCE(s.q,0) + COALESCE(x.q,0) + COALESCE(d.q,0) > COALESCE(l.q,0)`,
      [t.id]
    )).rows;
    for (const r of over) {
      await query("INSERT INTO f_stock_moves (product_id, kind, qty, trip_id, vehicle_id, reason, created_by) VALUES ($1,'load',$2,$3,$4,'تحميل ما انسجّل (بان من التسليم)',$5)", [r.id, r.over, t.id, t.vehicle_id, req.user.id]);
    }
    if (over.length) {
      await alert({ level: "warn", kind: "load_fix", ref: t.id, title: `${t.driver_name || "السائق"} سلّم أكثر من المحمّل`, body: `${over.map((r) => `${r.over} ${r.name}`).join("، ")} — انسجّلوا طالعين من المستودع. تأكد من التحميل.` });
    }
  }

  // الموقع بعيد عن الزبون؟
  if (b.lat && c.lat) {
    const d = km([Number(b.lat), Number(b.lng)], [c.lat, c.lng]);
    if (d > 3) await alert({ level: "warn", kind: "far_delivery", ref: o.id, title: `تسليم بعيد عن موقع الزبون — ${c.name}`, body: `السائق سجّل التسليم على بعد ${d} كم من موقع الزبون المحفوظ.` });
  } else if (b.lat && !c.lat) {
    await query("UPDATE f_customers SET lat = $1, lng = $2 WHERE id = $3", [Number(b.lat), Number(b.lng), c.id]);
  }
  if (debt > 0 && !overLimit) await alert({ level: "warn", kind: "new_debt", ref: c.id, title: `💳 ${c.name} دفع ${cash.toFixed(2)} من ${total.toFixed(2)}`, body: `صار عليه دين ${debt.toFixed(2)} د.أ — رصيده الكلي ${balance.toFixed(2)}. مع ${t.driver_name || "السائق"}.` });
  if (overLimit) await alert({ level: "crit", kind: "credit", ref: c.id, title: `دين فوق السقف — ${c.name}`, body: `صار عليه ${balance.toFixed(2)} د.أ بعد تسليم طلب #${o.id} مع ${t.driver_name || "السائق"}.` });
  const track = await ensureTrackToken(c.id);
  const msg = await queueMessage({
    customerId: c.id, orderId: o.id, kind: "delivered",
    data: { order: o.id, items: itemsText([...lines.filter((l) => l.dq > 0 || l.db > 0).map((l) => ({ qty: l.dq, name: l.name, bonus: l.db })), ...added.map((a) => ({ qty: a.qty, name: a.name }))]) + (exchanges.length ? `\n🔁 استبدال تالف: ${exchanges.map((x) => `${x.qty} ${x.name}`).join("، ")} (أخذنا التالف وأعطيناك بداله جديد)` : ""), total, paid: cash, balance, invoice: token, track }, userId: req.user.id,
  });
  const left = (await query("SELECT COUNT(*)::int AS n FROM f_orders WHERE trip_id = $1 AND status IN ('assigned','onway')", [t.id])).rows[0].n;
  await logActivity({ userId: req.user.id, action: "F_DELIVER", recordType: "f_order", recordId: o.id, newValue: { total, cash, debt } });
  const cartons = lines.reduce((a, l) => a + l.dq + l.db, 0) + added.reduce((a, x) => a + x.qty, 0);
  const exTxt = exchanges.length ? ` · بدّل ${exchanges.reduce((a, x) => a + x.qty, 0)} تالف` : "";
  await pushManagers({
    title: sale ? `🛒 ${t.driver_name || "المندوب"} باع لـ ${c.name}` : `✅ ${t.driver_name || "السائق"} سلّم ${c.name}`,
    body: `${cartons} كرتونة${exTxt} · فاتورة ${total.toFixed(2)} · كاش ${cash.toFixed(2)}${debt > 0 ? ` · دين ${debt.toFixed(2)}` : ""}${sale ? "" : left ? ` · باقي ${left} وقفات` : " · خلّص كل الوقفات"}`,
    url: "/f/trips", tag: `fd-${o.id}`,
  });
  res.json({ ok: true, total, cash, debt, balance, message_id: msg, remaining_stops: left, order_id: o.id, invoice_token: token, customer_name: c.name, phone: c.phone });
}

router.post("/driver/orders/:id/fail", drive, once(async (req, res) => {
  const o = (await loadOrders("o.id = $1", [req.params.id]))[0];
  if (!o) return bad(res, "الطلب غير موجود.", 404);
  const t = o.trip_id ? await myTrip(req, o.trip_id) : null;
  if (!t) return bad(res, "الطلب مش على رحلتك.", 403);
  const reason = String(req.body?.reason || "").trim();
  if (!reason) return bad(res, "اختار السبب.");
  if (!req.body?.photo_url) return bad(res, "صوّر المحل كإثبات إنك وصلت.");
  await query(
    "UPDATE f_orders SET status = 'failed', fail_reason = $1, proof_photo = $2, delivered_lat = $3, delivered_lng = $4, updated_at = now() WHERE id = $5",
    [reason, req.body.photo_url, Number(req.body?.lat) || null, Number(req.body?.lng) || null, o.id]
  );
  await alert({ level: "warn", kind: "failed", ref: o.id, title: `ما تسلّم طلب #${o.id} — ${o.customer_name}`, body: `${reason}. السائق ${t.driver_name || ""} صوّر المحل.` });
  const msg = await queueMessage({ customerId: o.customer_id, orderId: o.id, kind: "failed", data: { order: o.id, reason }, userId: req.user.id });
  res.json({ ok: true, message_id: msg });
}));

// زر «بلّغ عن مشكلة»
router.post("/driver/problem", drive, once(async (req, res) => {
  const kind = String(req.body?.kind || "").trim();
  if (!kind) return bad(res, "اختار شو المشكلة.");
  const v = (await query("SELECT v.id, v.name FROM f_vehicles v WHERE v.driver_id = $1 ORDER BY v.id LIMIT 1", [req.user.id])).rows[0];
  const trip = v ? (await query("SELECT id FROM f_trips WHERE vehicle_id = $1 AND status IN ('planned','active') ORDER BY id DESC LIMIT 1", [v.id])).rows[0] : null;
  const where = req.body?.lat ? ` · الموقع: https://maps.google.com/?q=${Number(req.body.lat)},${Number(req.body.lng)}` : "";
  const alertId = await alert({
    level: "crit", kind: kind === "عطل بالسيارة" ? "breakdown" : "problem", ref: trip?.id || null,
    title: `${req.user.full_name}${v ? ` (${v.name})` : ""}: ${kind}`,
    body: `${req.body?.note ? String(req.body.note).slice(0, 400) + " · " : ""}${new Date().toLocaleTimeString("ar-JO-u-nu-latn", { timeZone: "Asia/Amman", hour: "numeric", minute: "2-digit" })}${where}${req.body?.photo_url ? " · مع صورة" : ""}`,
  });
  if (kind === "بضاعة مضروبة" && req.body?.product_id && Number(req.body?.qty) > 0 && trip) {
    await query(
      "INSERT INTO f_stock_moves (product_id, kind, qty, damage_source, trip_id, vehicle_id, reason, photo_url, created_by) VALUES ($1,'damage',$2,'vehicle',$3,$4,$5,$6,$7)",
      [req.body.product_id, Math.round(Number(req.body.qty)), trip.id, v.id, req.body?.note || "بضاعة مضروبة بالسيارة", req.body?.photo_url || null, req.user.id]
    );
  }
  await query("UPDATE f_alerts SET user_id = $1 WHERE id = $2", [req.user.id, alertId]);
  res.json({ ok: true, trip_id: trip?.id || null, alert_id: alertId });
}));

// المشكلة انحلت (السيارة رجعت تشتغل) — أو انبعتت بالغلط
router.post("/driver/problem/:id/resolve", drive, async (req, res) => {
  const a = (await query("SELECT * FROM f_alerts WHERE id = $1 AND user_id = $2 AND kind IN ('breakdown','problem')", [req.params.id, req.user.id])).rows[0];
  if (!a) return bad(res, "البلاغ غير موجود.", 404);
  await query("UPDATE f_alerts SET closed_at = now(), closed_by = $1 WHERE id = $2 AND closed_at IS NULL", [req.user.id, a.id]);
  if (a.kind === "breakdown" && a.ref_id) await query("UPDATE f_trips SET delay_reason = NULL WHERE id = $1 AND delay_reason = 'عطل بالسيارة'", [a.ref_id]);
  const mistake = req.body?.mistake === true;
  await pushManagers({
    title: mistake ? `↩️ ${req.user.full_name} لغى البلاغ` : `✅ ${req.user.full_name}: انحلت المشكلة`,
    body: mistake ? `«${a.title}» انبعت بالغلط.` : `${a.kind === "breakdown" ? "السيارة رجعت تشتغل" : "المشكلة انحلت"} وكمّل شغله.`,
    url: "/f/trips", tag: `fa-${a.id}`,
  });
  res.json({ ok: true });
});

// ---------- المصاريف ----------
const EXP_KINDS = ["ديزل", "تصليح", "بنشر", "غسيل", "مخالفة", "أكل", "غيره"];
router.get("/driver/expenses", drive, async (req, res) => {
  const r = await query("SELECT * FROM f_expenses WHERE driver_id = $1 ORDER BY id DESC LIMIT 40", [req.user.id]);
  res.json({ kinds: EXP_KINDS, list: r.rows.map((e) => ({ ...e, amount: Number(e.amount) })) });
});

router.post("/driver/expenses", drive, once(async (req, res) => {
  const b = req.body || {};
  const kind = EXP_KINDS.includes(b.kind) ? b.kind : null;
  const amount = round2(b.amount);
  if (!kind) return bad(res, "اختار نوع المصروف.");
  if (!(amount > 0)) return bad(res, "اكتب المبلغ.");
  const v = (await query("SELECT id, name FROM f_vehicles WHERE driver_id = $1 ORDER BY id LIMIT 1", [req.user.id])).rows[0];
  const trip = v ? (await query("SELECT id FROM f_trips WHERE vehicle_id = $1 AND status IN ('active','returned','planned') ORDER BY (status='active') DESC, id DESC LIMIT 1", [v.id])).rows[0] : null;
  const r = await query(
    `INSERT INTO f_expenses (trip_id, vehicle_id, driver_id, kind, amount, liters, odo, photo_url, odo_photo_url, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [trip?.id || null, v?.id || null, req.user.id, kind, amount, Number(b.liters) || null, Number(b.odo) || null, b.photo_url || null, null, b.note ? String(b.note).slice(0, 300) : null]
  );
  await alert({ level: "warn", kind: "expense", ref: r.rows[0].id, title: `مصروف ${kind} ${amount.toFixed(2)} د.أ — ${req.user.full_name}`, body: `${v?.name || ""}${b.liters ? ` · ${b.liters} لتر` : ""}${b.photo_url ? "" : " · بدون صورة"} · بانتظار موافقتك.` });
  res.status(201).json(r.rows[0]);
}));

// ---------- الرجوع للمصنع ----------
router.post("/driver/trips/:id/return", drive, once(async (req, res) => {
  const t = await myTrip(req, req.params.id);
  if (!t) return bad(res, "الرحلة مش إلك.", 403);
  if (t.status !== "active") return bad(res, "الرحلة مش شغالة.");
  const open = t.stops.filter((o) => ["assigned", "onway"].includes(o.status));
  if (open.length && !req.body?.force) return bad(res, `لسا في ${open.length} وقفات ما خلصت — سلّمها أو سجّلها «ما تم».`);
  await query("UPDATE f_trips SET status = 'returned', returned_at = now(), required_cash = $1 WHERE id = $2", [t.cash_due, t.id]);
  // الكيلومترات بالعداد مقابل التتبع
  const odoKm = t.odo_end && t.odo_start ? t.odo_end - t.odo_start : 0;
  if (odoKm && t.gps_km > 5 && odoKm > t.gps_km * 1.3 + 10) {
    await alert({ level: "warn", kind: "km_mismatch", ref: t.id, title: `الكيلومترات مش مطابقة — ${t.vehicle_name}`, body: `العداد ${odoKm} كم والتتبع ${Math.round(t.gps_km)} كم. يمكن السيارة مشيت والتلفون مسكّر.` });
  }
  await alert({ level: "info", kind: "returned", ref: t.id, title: `${t.vehicle_name} رجعت — ${t.driver_name || ""}`, body: `الكاش المطلوب ${t.cash_due.toFixed(2)} د.أ. بانتظار تسليم الكاش والمرتجع.` });
  res.json({ ok: true, required_cash: t.cash_due });
}));

// حسابي (العُهد)
router.get("/driver/account", drive, async (req, res) => {
  const [ledger, month] = await Promise.all([
    query("SELECT * FROM f_driver_ledger WHERE driver_id = $1 ORDER BY id DESC LIMIT 40", [req.user.id]),
    query(
      `SELECT COUNT(DISTINCT t.id)::int AS trips, COALESCE(SUM(o.cash_paid),0) AS collected, COUNT(o.id) FILTER (WHERE o.status='delivered')::int AS delivered
       FROM f_trips t LEFT JOIN f_orders o ON o.trip_id = t.id
       WHERE t.driver_id = $1 AND date_trunc('month', t.trip_date) = date_trunc('month', CURRENT_DATE)`,
      [req.user.id]
    ),
  ]);
  const custody = Number((await query("SELECT COALESCE(SUM(amount),0) AS s FROM f_driver_ledger WHERE driver_id = $1", [req.user.id])).rows[0].s);
  res.json({ custody: round2(custody), ledger: ledger.rows.map((x) => ({ ...x, amount: Number(x.amount) })), month: { ...month.rows[0], collected: Number(month.rows[0].collected) } });
});

// ============================================================
// شغل المندوب: بيحمّل بضاعة على السيارة، بيلف على المحلات وبيبيع مباشرة
// الجرد: اللي طلع (تحميل) − اللي انباع − التالف = لازم يرجع للمستودع
// ============================================================
async function carStock(tripId) {
  const r = await query(
    `WITH l AS (SELECT product_id, SUM(qty)::int AS q FROM f_stock_moves WHERE trip_id = $1 AND kind = 'load' GROUP BY product_id),
          s AS (SELECT i.product_id, SUM(COALESCE(i.delivered_qty,0) + COALESCE(i.delivered_bonus,0))::int AS q
                FROM f_orders o JOIN f_order_items i ON i.order_id = o.id WHERE o.trip_id = $1 AND o.status = 'delivered' GROUP BY i.product_id),
          d AS (SELECT product_id, SUM(qty)::int AS q FROM f_stock_moves WHERE trip_id = $1 AND kind = 'damage' AND damage_source = 'vehicle' GROUP BY product_id),
          x AS (SELECT x.product_id, SUM(x.qty)::int AS q FROM f_order_exchanges x JOIN f_orders o ON o.id = x.order_id WHERE o.trip_id = $1 AND o.status = 'delivered' GROUP BY x.product_id),
          r AS (SELECT i.product_id, SUM(i.qty + i.bonus_qty)::int AS q FROM f_orders o JOIN f_order_items i ON i.order_id = o.id WHERE o.trip_id = $1 AND o.status IN ('assigned','onway','delayed') GROUP BY i.product_id)
     SELECT p.id AS product_id, p.name, p.image_url, COALESCE(l.q,0) AS loaded, COALESCE(r.q,0) AS reserved, COALESCE(s.q,0) AS sold, COALESCE(d.q,0) AS damaged, COALESCE(x.q,0) AS exchanged,
            COALESCE(l.q,0) - COALESCE(s.q,0) - COALESCE(d.q,0) - COALESCE(x.q,0) AS left
     FROM f_products p LEFT JOIN l ON l.product_id = p.id LEFT JOIN s ON s.product_id = p.id LEFT JOIN d ON d.product_id = p.id LEFT JOIN x ON x.product_id = p.id LEFT JOIN r ON r.product_id = p.id
     WHERE l.q IS NOT NULL ORDER BY p.id`,
    [tripId]
  );
  return r.rows;
}

function cleanLoad(items) {
  const out = [];
  for (const x of Array.isArray(items) ? items : []) {
    const q = Math.round(Number(x.qty));
    if (x.product_id && q > 0 && q <= 100000) out.push({ product_id: Number(x.product_id), qty: q });
  }
  return out;
}

async function addLoad(t, items, userId) {
  let n = 0;
  for (const x of items) {
    const p = (await query("SELECT id FROM f_products WHERE id = $1 AND active", [x.product_id])).rows[0];
    if (!p) continue;
    await query("INSERT INTO f_stock_moves (product_id, kind, qty, trip_id, vehicle_id, reason, created_by) VALUES ($1,'load',$2,$3,$4,'تحميل مندوب',$5)", [p.id, x.qty, t.id, t.vehicle_id, userId]);
    n += x.qty;
  }
  await query("UPDATE f_trips SET extra_cartons = extra_cartons + $1 WHERE id = $2", [n, t.id]);
  return n;
}

// «اليوم بشتغل مندوب»: رحلة بيع بدون طلبات، بالحمولة اللي طلعت على السيارة
router.post("/driver/sales/start", drive, once(async (req, res) => {
  const items = cleanLoad(req.body?.items);
  if (!items.length) return bad(res, "اكتب شو حمّلت على السيارة.");
  const busy = (await query("SELECT id FROM f_trips WHERE driver_id = $1 AND status = 'active'", [req.user.id])).rows[0];
  if (busy) return bad(res, "عندك رحلة شغالة — خلّصها أول.");
  const vid = Number(req.body?.vehicle_id) || (await query("SELECT id FROM f_vehicles WHERE driver_id = $1 AND status <> 'inactive' ORDER BY id LIMIT 1", [req.user.id])).rows[0]?.id;
  const v = vid ? (await query("SELECT id, name FROM f_vehicles WHERE id = $1 AND status <> 'inactive'", [vid])).rows[0] : null;
  if (!v) return bad(res, "ما في سيارة مربوطة فيك. خلي الإدارة تربطك بسيارة.");
  const t = (await query(
    `INSERT INTO f_trips (vehicle_id, driver_id, trip_date, status, kind, started_at, load_confirmed_at, load_confirmed_by)
     VALUES ($1,$2,$3,'active','sales',now(),now(),$2) RETURNING *`,
    [v.id, req.user.id, jordanDate()]
  )).rows[0];
  const n = await addLoad(t, items, req.user.id);
  // طلباته اللي لسا ما طلعت بتنضم لشغل المندوب (بيسلّمها من اللي حمّله)
  const moved = await query(
    `UPDATE f_orders SET trip_id = $1, status = 'onway', updated_at = now()
     WHERE status = 'assigned' AND trip_id IN (SELECT id FROM f_trips WHERE driver_id = $2 AND status = 'planned' AND trip_date <= $3) RETURNING id`,
    [t.id, req.user.id, jordanDate()]
  );
  if (moved.rowCount) {
    await query("UPDATE f_trips SET status = 'cancelled' WHERE driver_id = $1 AND status = 'planned' AND trip_date <= $2 AND NOT EXISTS (SELECT 1 FROM f_orders o WHERE o.trip_id = f_trips.id AND o.status NOT IN ('cancelled'))", [req.user.id, jordanDate()]);
    await recomputeEta(t.id, { fromNow: true });
  }
  await pushManagers({ title: `🛒 ${req.user.full_name} طلع مندوب اليوم`, body: `${v.name} · حمّل ${n} كرتونة للبيع على المحلات.`, url: "/f/trips", tag: `ts-${t.id}` });
  res.json({ ok: true, trip_id: t.id });
}));

// رجع حمّل زيادة من المصنع
router.post("/driver/sales/:id/load", drive, once(async (req, res) => {
  const t = await myTrip(req, req.params.id);
  if (!t || t.kind !== "sales") return bad(res, "الرحلة مش إلك.", 403);
  if (t.status !== "active") return bad(res, "الرحلة مش شغالة.");
  const items = cleanLoad(req.body?.items);
  if (!items.length) return bad(res, "اكتب شو حمّلت.");
  const n = await addLoad(t, items, req.user.id);
  await pushManagers({ title: `📦 ${t.driver_name || "المندوب"} حمّل زيادة`, body: `${n} كرتونة على ${t.vehicle_name}.`, url: "/f/trips", tag: `tl-${t.id}` });
  res.json({ ok: true, stock: await carStock(t.id) });
}));

// المحلات القريبة مني (عشان أختار بسرعة)
router.get("/driver/shops", drive, async (req, res) => {
  const lat = Number(req.query.lat), lng = Number(req.query.lng);
  const q = String(req.query.q || "").trim();
  let rows = (await query(
    "SELECT id, name, contact_name, phone, city, address, lat, lng, balance, seq_no FROM f_customers WHERE active ORDER BY name LIMIT 5000"
  )).rows;
  if (q) rows = smartFilter(rows, q);
  const near = Number.isFinite(lat) && lat;
  const list = rows.map((c) => ({ ...c, balance: Number(c.balance), km: near && c.lat != null ? km([lat, lng], [c.lat, c.lng]) : null }));
  if (!q) list.sort((a, b) => (a.km ?? 1e9) - (b.km ?? 1e9) || a.name.localeCompare(b.name, "ar"));
  res.json(list.slice(0, 40));
});

// أسعار المحل (الخاصة أو العامة)
router.get("/driver/prices", drive, async (req, res) => {
  const cid = Number(req.query.customer_id) || null;
  const ps = (await query("SELECT id, price FROM f_products WHERE active")).rows;
  const out = {};
  for (const p of ps) out[p.id] = cid ? await priceFor(cid, p.id) : Number(p.price);
  res.json(out);
});

// بيع لمحل: طلب بينعمل ويتسلّم بنفس اللحظة من اللي على السيارة
router.post("/driver/sales/:id/sell", drive, once(async (req, res) => {
  const t = await myTrip(req, req.params.id);
  // بيع لمحل بيزبط من شغل المندوب ومن رحلة الطلبات العادية (زبون وقّفه عالطريق)
  if (!t) return bad(res, "الرحلة مش إلك.", 403);
  if (t.status === "planned") await startTrip(t);
  else if (t.status !== "active") return bad(res, "الرحلة مش شغالة.");
  const b = req.body || {};
  // المحل: موجود أو جديد
  let c;
  if (b.customer_id) {
    c = (await query("SELECT * FROM f_customers WHERE id = $1 AND active", [b.customer_id])).rows[0];
    if (!c) return bad(res, "المحل غير موجود.");
  } else {
    let nc; try { nc = await cleanCustomer({ ...(b.new_customer || {}), lat: b.lat, lng: b.lng }); } catch (e) { return bad(res, e.message); }
    if (nc.phone) {
      const same = (await query("SELECT * FROM f_customers WHERE phone = $1 AND active LIMIT 1", [nc.phone])).rows[0];
      if (same) c = same;
    }
    if (!c) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("LOCK TABLE f_customers IN SHARE ROW EXCLUSIVE MODE");
        const seq = await nextSeq(client);
        c = (await client.query(
          `INSERT INTO f_customers (name, phone, city, address, lat, lng, kind, pay_terms, governorate, district, created_by, seq_no)
           VALUES ($1,$2,$3,$4,$5,$6,'محل','cash',$7,$8,$9,$10) RETURNING *`,
          [nc.name, nc.phone, nc.city, nc.address, nc.lat, nc.lng, nc.governorate, nc.district, req.user.id, seq]
        )).rows[0];
        await client.query("COMMIT");
      } catch (err) { await client.query("ROLLBACK").catch(() => {}); throw err; } finally { client.release(); }
      await pushManagers({ title: `🏪 محل جديد: ${c.name}`, body: `سجّله ${req.user.full_name} وهو بيلف مندوب.`, url: "/f/customers", tag: `nc-${c.id}` });
    }
  }
  // الكميات: ما بتزيد عن اللي على السيارة
  const left = new Map((await carStock(t.id)).map((x) => [x.product_id, x]));
  const items = [];
  for (const x of Array.isArray(b.items) ? b.items : []) {
    const qty = Math.round(Number(x.qty));
    if (!x.product_id || !(qty > 0)) continue;
    const st = left.get(Number(x.product_id));
    if (!st) return bad(res, "في منتج مش محمّل على السيارة.");
    if (qty > st.left) return bad(res, `على السيارة بس ${st.left} ${st.name}.`);
    const bonus = Math.min(await bonusFor(c.id, st.product_id, qty), st.left - qty);
    items.push({ product_id: st.product_id, name: st.name, qty, bonus, price: await priceFor(c.id, st.product_id) });
  }
  const exch = [];
  for (const x of Array.isArray(b.exchanges) ? b.exchanges : []) {
    const qty = Math.round(Number(x.qty));
    if (!x.product_id || !(qty > 0)) continue;
    const st = left.get(Number(x.product_id));
    const used = items.filter((i) => i.product_id === Number(x.product_id)).reduce((a, i) => a + i.qty + i.bonus, 0);
    if (!st || qty > st.left - used) return bad(res, `ما معك ${st ? st.name : "هالمنتج"} كفاية للاستبدال.`);
    exch.push({ product_id: st.product_id, qty });
  }
  if (!items.length && !exch.length) return bad(res, "اختار شو بدك تبيع.");
  const total = round2(items.reduce((a, i) => a + i.qty * i.price, 0));
  const cash = b.cash === undefined || b.cash === "" || b.cash === null ? total : round2(b.cash);
  if (!(cash >= 0)) return bad(res, "المبلغ غير صحيح.");
  const debt = round2(total - cash);
  if (debt > 0) {
    if (!canAction(req.user, "give_credit")) return bad(res, "ما عندك صلاحية تبيع بالدين — خذ المبلغ كامل.");
    const newBal = round2(Number(c.balance) + debt);
    const over = Number(c.credit_limit) > 0 ? newBal > Number(c.credit_limit) : c.pay_terms === "cash";
    if (over && !b.confirm_over_limit) {
      return res.status(409).json({ error: `${c.name} رح يصير عليه ${newBal.toFixed(2)} د.أ${Number(c.credit_limit) > 0 ? ` وسقفه ${Number(c.credit_limit).toFixed(2)}` : " وهو زبون كاش"}. إذا كملت بيوصل تنبيه للإدارة.`, code: "OVER_LIMIT", customer_id: c.id });
    }
  }
  const oid = (await query(
    "INSERT INTO f_orders (customer_id, status, trip_id, due_date, notes, total, created_by) VALUES ($1,'onway',$2,$3,'بيع مندوب',$4,$5) RETURNING id",
    [c.id, t.id, jordanDate(), total, req.user.id]
  )).rows[0].id;
  for (const i of items) {
    await query("INSERT INTO f_order_items (order_id, product_id, qty, price, bonus_qty, bonus_manual) VALUES ($1,$2,$3,$4,$5,false)", [oid, i.product_id, i.qty, i.price, i.bonus]);
  }
  const o = (await loadOrders("o.id = $1", [oid]))[0];
  // البيع كله أو ولا إشي: إذا التسليم ما زبط منشيل الطلب اللي انعمل
  const drop = () => query("DELETE FROM f_orders WHERE id = $1 AND status <> 'delivered'", [oid]).catch(() => {});
  try {
    await deliverOrder(req, res, o, t, { cash, signature: b.signature, photo_url: b.photo_url, lat: b.lat, lng: b.lng, confirm_over_limit: true, exchanges: exch, exchange_photo: b.exchange_photo }, { sale: true });
  } catch (e) { await drop(); throw e; }
  if (res.statusCode >= 400) await drop();
}));

export default router;
