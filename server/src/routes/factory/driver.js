import { Router } from "express";
import { query, pool, logActivity } from "../../db.js";
import { can, canAction } from "../../permissions.js";
import { km } from "../../utils/factoryGeo.js";
import { need, bad, round2, jordanDate, postLedger, queueMessage, ensureTrackToken, itemsText, alert, publicToken, pushManagers, priceFor } from "./lib.js";
import { loadTrips, loadOrders, recomputeEta } from "./orders.js";

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
  const trip = trips.find((t) => t.status === "active") || trips.find((t) => t.status === "returned") || trips.sort((a, b) => a.trip_date.localeCompare(b.trip_date))[0] || null;
  const custody = Number((await query("SELECT COALESCE(SUM(amount),0) AS s FROM f_driver_ledger WHERE driver_id = $1", [req.user.id])).rows[0].s);
  const lastFuel = trip?.vehicle_id ? (await query(
    "SELECT fuel_end, to_char(returned_at AT TIME ZONE 'Asia/Amman','HH24:MI') AS at FROM f_trips WHERE vehicle_id = $1 AND fuel_end IS NOT NULL AND id <> $2 ORDER BY returned_at DESC LIMIT 1",
    [trip.vehicle_id, trip.id]
  )).rows[0] : null;
  res.json({ vehicles, trip, custody: round2(custody), fuel_levels: FUEL, last_fuel: lastFuel || null, can_credit: canAction(req.user, "give_credit") });
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

// بداية الرحلة
router.post("/driver/trips/:id/start", drive, async (req, res) => {
  const t = await myTrip(req, req.params.id);
  if (!t) return bad(res, "الرحلة مش إلك.", 403);
  if (t.status !== "planned") return bad(res, "الرحلة بلشت من قبل.");
  if (!t.odo_start || !t.photo_odo_start) return bad(res, "صوّر عداد الكيلومترات أول.");
  if (!t.fuel_start || !t.photo_fuel_start) return bad(res, "صوّر مؤشر الديزل أول.");
  if (!t.load_confirmed_at) return bad(res, "لازم الحمولة تتأكد قبل ما تطلع.");
  await query("UPDATE f_trips SET status = 'active', started_at = now() WHERE id = $1", [t.id]);
  await query("UPDATE f_orders SET status = 'onway', updated_at = now() WHERE trip_id = $1 AND status = 'assigned'", [t.id]);
  await query("UPDATE f_vehicles SET last_seen_at = now() WHERE id = $1", [t.vehicle_id]);
  await recomputeEta(t.id, { fromNow: true });

  // الديزل بالليل: إذا الصبح أقل من المسا والسيارة ما طلعت
  const prev = (await query("SELECT fuel_end FROM f_trips WHERE vehicle_id = $1 AND fuel_end IS NOT NULL AND id <> $2 ORDER BY returned_at DESC NULLS LAST LIMIT 1", [t.vehicle_id, t.id])).rows[0];
  if (prev && FUEL.indexOf(t.fuel_start) < FUEL.indexOf(prev.fuel_end)) {
    await alert({
      level: "crit", kind: "fuel_night", ref: t.id,
      title: `الديزل نزل بالليل — ${t.vehicle_name}`,
      body: `المسا كان «${prev.fuel_end}» والصبح «${t.fuel_start}» بدون ما تتحرك السيارة. السائق: ${t.driver_name || ""}.`,
    });
  }
  const orders = await loadOrders("o.trip_id = $1 AND o.status = 'onway'", [t.id]);
  const ids = [];
  for (const o of orders) {
    const track = await ensureTrackToken(o.customer_id);
    ids.push(await queueMessage({ customerId: o.customer_id, orderId: o.id, kind: "onway", data: { driver: t.driver_name || "السائق", eta: o.eta_at, track }, userId: req.user.id }));
  }
  await pushManagers({ title: `🚚 ${t.driver_name || "السائق"} طلع بالرحلة`, body: `${t.vehicle_name} · ${orders.length} زبون. تابعه على الخريطة.`, url: "/f/trips", tag: `ts-${t.id}` });
  res.json({ ok: true, message_ids: ids });
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
router.post("/driver/orders/:id/deliver", drive, async (req, res) => {
  const o = (await loadOrders("o.id = $1", [req.params.id]))[0];
  if (!o) return bad(res, "الطلب غير موجود.", 404);
  const t = o.trip_id ? await myTrip(req, o.trip_id) : null;
  if (!t) return bad(res, "الطلب مش على رحلتك.", 403);
  if (t.status !== "active") return bad(res, "ابدأ الرحلة أول.");
  if (o.status === "delivered") return bad(res, "الطلب مسلّم من قبل.");
  const b = req.body || {};
  if (!b.signature && !b.photo_url) return bad(res, "خلي الزبون يوقّع، أو صوّر البضاعة عنده.");
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
  // الموقع بعيد عن الزبون؟
  if (b.lat && c.lat) {
    const d = km([Number(b.lat), Number(b.lng)], [c.lat, c.lng]);
    if (d > 3) await alert({ level: "warn", kind: "far_delivery", ref: o.id, title: `تسليم بعيد عن موقع الزبون — ${c.name}`, body: `السائق سجّل التسليم على بعد ${d} كم من موقع الزبون المحفوظ.` });
  } else if (b.lat && !c.lat) {
    await query("UPDATE f_customers SET lat = $1, lng = $2 WHERE id = $3", [Number(b.lat), Number(b.lng), c.id]);
  }
  if (overLimit) await alert({ level: "crit", kind: "credit", ref: c.id, title: `دين فوق السقف — ${c.name}`, body: `صار عليه ${balance.toFixed(2)} د.أ بعد تسليم طلب #${o.id} مع ${t.driver_name || "السائق"}.` });
  const track = await ensureTrackToken(c.id);
  const msg = await queueMessage({
    customerId: c.id, orderId: o.id, kind: "delivered",
    data: { order: o.id, items: itemsText([...lines.filter((l) => l.dq > 0 || l.db > 0).map((l) => ({ qty: l.dq, name: l.name, bonus: l.db })), ...added.map((a) => ({ qty: a.qty, name: a.name }))]), total, paid: cash, balance, invoice: token, track }, userId: req.user.id,
  });
  const left = (await query("SELECT COUNT(*)::int AS n FROM f_orders WHERE trip_id = $1 AND status IN ('assigned','onway')", [t.id])).rows[0].n;
  await logActivity({ userId: req.user.id, action: "F_DELIVER", recordType: "f_order", recordId: o.id, newValue: { total, cash, debt } });
  const cartons = lines.reduce((a, l) => a + l.dq + l.db, 0) + added.reduce((a, x) => a + x.qty, 0);
  await pushManagers({
    title: `✅ ${t.driver_name || "السائق"} سلّم ${c.name}`,
    body: `${cartons} كرتونة · فاتورة ${total.toFixed(2)} · كاش ${cash.toFixed(2)}${debt > 0 ? ` · دين ${debt.toFixed(2)}` : ""}${left ? ` · باقي ${left} وقفات` : " · خلّص كل الوقفات"}`,
    url: "/f/trips", tag: `fd-${o.id}`,
  });
  res.json({ ok: true, total, cash, debt, balance, message_id: msg, remaining_stops: left, order_id: o.id, invoice_token: token, customer_name: c.name, phone: c.phone });
});

router.post("/driver/orders/:id/fail", drive, async (req, res) => {
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
});

// زر «بلّغ عن مشكلة»
router.post("/driver/problem", drive, async (req, res) => {
  const kind = String(req.body?.kind || "").trim();
  if (!kind) return bad(res, "اختار شو المشكلة.");
  const v = (await query("SELECT v.id, v.name FROM f_vehicles v WHERE v.driver_id = $1 ORDER BY v.id LIMIT 1", [req.user.id])).rows[0];
  const trip = v ? (await query("SELECT id FROM f_trips WHERE vehicle_id = $1 AND status IN ('planned','active') ORDER BY id DESC LIMIT 1", [v.id])).rows[0] : null;
  const where = req.body?.lat ? ` · الموقع: https://maps.google.com/?q=${Number(req.body.lat)},${Number(req.body.lng)}` : "";
  await alert({
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
  res.json({ ok: true, trip_id: trip?.id || null });
});

// ---------- المصاريف ----------
const EXP_KINDS = ["ديزل", "تصليح", "بنشر", "غسيل", "مخالفة", "أكل", "غيره"];
router.get("/driver/expenses", drive, async (req, res) => {
  const r = await query("SELECT * FROM f_expenses WHERE driver_id = $1 ORDER BY id DESC LIMIT 40", [req.user.id]);
  res.json({ kinds: EXP_KINDS, list: r.rows.map((e) => ({ ...e, amount: Number(e.amount) })) });
});

router.post("/driver/expenses", drive, async (req, res) => {
  const b = req.body || {};
  const kind = EXP_KINDS.includes(b.kind) ? b.kind : null;
  const amount = round2(b.amount);
  if (!kind) return bad(res, "اختار نوع المصروف.");
  if (!(amount > 0)) return bad(res, "اكتب المبلغ.");
  if (!b.photo_url) return bad(res, "صوّر الفاتورة.");
  if (kind === "ديزل" && (!b.odo || !b.odo_photo_url)) return bad(res, "صوّر العداد واكتب رقمه.");
  const v = (await query("SELECT id, name FROM f_vehicles WHERE driver_id = $1 ORDER BY id LIMIT 1", [req.user.id])).rows[0];
  const trip = v ? (await query("SELECT id FROM f_trips WHERE vehicle_id = $1 AND status IN ('active','returned','planned') ORDER BY (status='active') DESC, id DESC LIMIT 1", [v.id])).rows[0] : null;
  const r = await query(
    `INSERT INTO f_expenses (trip_id, vehicle_id, driver_id, kind, amount, liters, odo, photo_url, odo_photo_url, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [trip?.id || null, v?.id || null, req.user.id, kind, amount, Number(b.liters) || null, Number(b.odo) || null, b.photo_url, b.odo_photo_url || null, b.note ? String(b.note).slice(0, 300) : null]
  );
  await alert({ level: "warn", kind: "expense", ref: r.rows[0].id, title: `مصروف ${kind} ${amount.toFixed(2)} د.أ — ${req.user.full_name}`, body: `${v?.name || ""}${b.liters ? ` · ${b.liters} لتر` : ""}${b.odo ? ` · العداد ${b.odo}` : ""} · بانتظار موافقتك.` });
  res.status(201).json(r.rows[0]);
});

// ---------- الرجوع للمصنع ----------
router.post("/driver/trips/:id/return", drive, async (req, res) => {
  const t = await myTrip(req, req.params.id);
  if (!t) return bad(res, "الرحلة مش إلك.", 403);
  if (t.status !== "active") return bad(res, "الرحلة مش شغالة.");
  const open = t.stops.filter((o) => ["assigned", "onway"].includes(o.status));
  if (open.length && !req.body?.force) return bad(res, `لسا في ${open.length} وقفات ما خلصت — سلّمها أو سجّلها «ما تم».`);
  if (!t.odo_end || !t.photo_odo_end || !t.fuel_end || !t.photo_fuel_end) return bad(res, "صوّر العداد والديزل قبل ما تسكّر.");
  await query("UPDATE f_trips SET status = 'returned', returned_at = now(), required_cash = $1 WHERE id = $2", [t.cash_due, t.id]);
  // الكيلومترات بالعداد مقابل التتبع
  const odoKm = t.odo_end - t.odo_start;
  if (t.gps_km > 5 && odoKm > t.gps_km * 1.3 + 10) {
    await alert({ level: "warn", kind: "km_mismatch", ref: t.id, title: `الكيلومترات مش مطابقة — ${t.vehicle_name}`, body: `العداد ${odoKm} كم والتتبع ${Math.round(t.gps_km)} كم. يمكن السيارة مشيت والتلفون مسكّر.` });
  }
  await alert({ level: "info", kind: "returned", ref: t.id, title: `${t.vehicle_name} رجعت — ${t.driver_name || ""}`, body: `الكاش المطلوب ${t.cash_due.toFixed(2)} د.أ. بانتظار تسليم الكاش والمرتجع.` });
  res.json({ ok: true, required_cash: t.cash_due });
});

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

export default router;
