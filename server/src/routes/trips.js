import { Router } from "express";
import { pool, query, logActivity } from "../db.js";
import { notifyOrdersAddedToTrip } from "../utils/notify.js";
import { optimizeRoute, getShopLocation } from "../utils/routing.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

const AVERAGE_SPEED_KMH = 25;
const SERVICE_MINUTES_PER_STOP = 4;

function isPrivileged(user) {
  return user.role === "super_admin" || user.role === "admin";
}

function canOperateTrip(user, trip) {
  if (user.role === "super_admin") return true;
  return trip.driver_id === user.id;
}

// إعادة ترتيب كامل الطلبات الباقية بالرحلة (بعد إضافة طلب جديد مثلًا).
// - الطلبات المسلّمة/المتعذرة/الملغية بتضل بمكانها بأول القائمة
// - الباقي بيترتب بأحسن طريق من مكان السائق الحالي ← ... ← المحل
// - الطلبات المؤجلة لموعد لاحق بتنزل لآخر الرحلة
export async function reoptimizeTrip(tripId, { withGeometry = true } = {}) {
  const tripResult = await query("SELECT * FROM trips WHERE id = $1", [tripId]);
  const trip = tripResult.rows[0];
  if (!trip || trip.status === "COMPLETED") return null;

  const stopsResult = await query(
    `SELECT ts.id, ts.sequence_number, ts.delivered_at, ts.leg_distance_km, ts.postponed_at,
            o.status AS order_status, o.priority, o.requested_time,
            l.latitude, l.longitude
     FROM trip_stops ts
     JOIN orders o ON o.id = ts.order_id
     JOIN customers c ON c.id = o.customer_id
     LEFT JOIN LATERAL (
       SELECT latitude, longitude FROM customer_locations WHERE customer_id = c.id ORDER BY id ASC LIMIT 1
     ) l ON true
     WHERE ts.trip_id = $1
     ORDER BY ts.sequence_number ASC`,
    [tripId]
  );
  const all = stopsResult.rows;
  const now = new Date();
  const isDone = (s) => s.delivered_at || ["DELIVERED", "FAILED", "CANCELLED"].includes(s.order_status);

  const done = all.filter(isDone);
  const pending = all.filter((s) => !isDone(s));
  const timeLocked = pending
    .filter((s) => s.requested_time && new Date(s.requested_time) > now)
    .sort((x, y) => new Date(x.requested_time) - new Date(y.requested_time));
  // اللي أجّلهم السائق بيضلوا بالآخر بنفس ترتيب التأجيل
  const postponed = pending
    .filter((s) => s.postponed_at && !timeLocked.includes(s))
    .sort((x, y) => new Date(x.postponed_at) - new Date(y.postponed_at));
  const locked = [...timeLocked, ...postponed];
  const free = pending.filter((s) => !locked.includes(s));

  // نقطة البداية: موقع السائق لو حديث، وإلا آخر زبون تسلّم، وإلا بداية الرحلة، وإلا المحل
  const shop = await getShopLocation();
  let start = null;
  const locationFresh = trip.location_updated_at && now - new Date(trip.location_updated_at) < 30 * 60 * 1000;
  if (trip.current_latitude != null && locationFresh) {
    start = { lat: trip.current_latitude, lon: trip.current_longitude };
  } else {
    const lastDelivered = done
      .filter((s) => s.delivered_at && s.latitude != null)
      .sort((x, y) => new Date(y.delivered_at) - new Date(x.delivered_at))[0];
    if (lastDelivered) start = { lat: lastDelivered.latitude, lon: lastDelivered.longitude };
    else if (trip.start_latitude != null) start = { lat: trip.start_latitude, lon: trip.start_longitude };
  }

  const route = await optimizeRoute({
    start,
    end: shop,
    stops: free,
    mode: trip.route_mode === "urgent_smart" ? "urgent_smart" : "nearest",
    withGeometry,
  });

  const newOrder = [...done, ...route.ordered, ...locked];
  const legById = new Map();
  route.ordered.forEach((s, i) => legById.set(s.id, route.legDistancesKm[i]));

  const ids = newOrder.map((s) => s.id);
  const seqs = newOrder.map((_, i) => i + 1);
  const legs = newOrder.map((s) => (legById.has(s.id) ? legById.get(s.id) : locked.includes(s) ? null : s.leg_distance_km));

  await query(
    `UPDATE trip_stops ts SET sequence_number = u.seq, leg_distance_km = u.leg
     FROM unnest($1::int[], $2::int[], $3::numeric[]) AS u(id, seq, leg)
     WHERE ts.id = u.id`,
    [ids, seqs, legs]
  );

  const doneKm = done.reduce((sum, s) => sum + Number(s.leg_distance_km || 0), 0);
  await query(
    `UPDATE trips SET total_distance_km = $1, return_leg_km = $2, end_latitude = $3, end_longitude = $4,
       route_geometry = COALESCE($5, route_geometry)
     WHERE id = $6`,
    [
      doneKm + route.totalDistanceKm,
      route.returnLegKm,
      shop ? shop.lat : null,
      shop ? shop.lon : null,
      route.geometry ? JSON.stringify(route.geometry) : null,
      tripId,
    ]
  );

  return { stops: newOrder.length, total_distance_km: doneKm + route.totalDistanceKm };
}

async function insertNotification({ type, message, customerId, tripId }) {
  await query(
    `INSERT INTO notifications (type, message, related_customer_id, related_trip_id) VALUES ($1,$2,$3,$4)`,
    [type, message, customerId || null, tripId || null]
  );
}

async function buildTripDetailResponse(trip, requestingUser) {
  const stopsResult = await query(
    `SELECT ts.*, o.order_number, o.status AS order_status, o.priority, o.final_total, o.notes AS order_notes, o.requested_time,
            o.needs_quantity, o.auto_from_reminder,
            c.id AS customer_id, c.name AS customer_name, c.phone_normalized, c.phone_display, c.coupon_balance, c.bottle_type,
            l.latitude, l.longitude, l.maps_url, l.street, l.building_number, l.building_name,
            l.floor, l.apartment, l.side, l.access_notes, l.building_photo_url
     FROM trip_stops ts
     JOIN orders o ON o.id = ts.order_id
     JOIN customers c ON c.id = o.customer_id
     LEFT JOIN LATERAL (
       SELECT * FROM customer_locations WHERE customer_id = c.id ORDER BY id ASC LIMIT 1
     ) l ON true
     WHERE ts.trip_id = $1
     ORDER BY ts.sequence_number ASC`,
    [trip.id]
  );
  const stops = stopsResult.rows;

  const orderIds = stops.map((s) => s.order_id);
  const itemsResult = orderIds.length
    ? await query(
        `SELECT oi.order_id, oi.id, oi.product_id, oi.product_name_snapshot, oi.quantity, oi.unit_price_snapshot, oi.coupon_quantity, p.coupon_eligible
         FROM order_items oi
         LEFT JOIN products p ON p.id = oi.product_id
         WHERE oi.order_id = ANY($1::int[]) ORDER BY oi.id ASC`,
        [orderIds]
      )
    : { rows: [] };
  const itemsByOrder = {};
  for (const row of itemsResult.rows) {
    if (!itemsByOrder[row.order_id]) itemsByOrder[row.order_id] = [];
    itemsByOrder[row.order_id].push({
      id: row.id,
      product_name_snapshot: row.product_name_snapshot,
      quantity: row.quantity,
      unit_price_snapshot: row.unit_price_snapshot,
      coupon_quantity: row.coupon_quantity,
      coupon_eligible: row.coupon_eligible,
    });
  }

  let cumulativeKm = 0;
  let cumulativeMinutes = 0;
  const now = new Date();
  const stopsWithEta = stops.map((s) => {
    const isPending = !s.delivered_at && s.order_status !== "FAILED" && s.order_status !== "CANCELLED";
    const isTimeLocked = isPending && s.requested_time && new Date(s.requested_time) > now;
    if (isPending) {
      const legKm = s.leg_distance_km != null ? Number(s.leg_distance_km) : 0;
      cumulativeKm += legKm;
      const drivingMinutes = (legKm / AVERAGE_SPEED_KMH) * 60;
      cumulativeMinutes += drivingMinutes + SERVICE_MINUTES_PER_STOP;
    }
    return {
      ...s,
      items: itemsByOrder[s.order_id] || [],
      estimated_eta_minutes: isPending ? Math.round(cumulativeMinutes) : null,
      remaining_distance_km: isPending ? Number(cumulativeKm.toFixed(1)) : null,
      is_time_locked: isTimeLocked,
    };
  });

  const lastDelivered = [...stops].filter((s) => s.delivered_at).sort((a, b) => new Date(b.delivered_at) - new Date(a.delivered_at))[0];

  // الرجوع للمحل بعد آخر طلب
  const shop = trip.end_latitude != null
    ? { lat: trip.end_latitude, lon: trip.end_longitude }
    : await getShopLocation();
  const returnLegKm = trip.return_leg_km != null ? Number(trip.return_leg_km) : null;
  if (shop && returnLegKm != null && trip.status !== "COMPLETED") {
    cumulativeKm += returnLegKm;
    cumulativeMinutes += (returnLegKm / AVERAGE_SPEED_KMH) * 60;
  }

  return {
    ...trip,
    stops: stopsWithEta,
    shop_location: shop,
    return_leg_km: returnLegKm,
    estimated_minutes_remaining: Math.round(cumulativeMinutes),
    total_remaining_distance_km: Number(cumulativeKm.toFixed(1)),
    can_operate: canOperateTrip(requestingUser, trip),
    last_delivered_stop_id: lastDelivered ? lastDelivered.id : null,
  };
}

router.get("/mine", async (req, res) => {
  const tripResult = await query(
    `SELECT t.*, u.full_name AS driver_name
     FROM trips t LEFT JOIN users u ON u.id = t.driver_id
     WHERE t.status IN ('PLANNED','STARTED') AND t.driver_id = $1
     ORDER BY t.created_at DESC LIMIT 1`,
    [req.user.id]
  );
  const trip = tripResult.rows[0];
  if (!trip) return res.json(null);

  res.json(await buildTripDetailResponse(trip, req.user));
});

router.get("/active-list", async (req, res) => {
  if (!isPrivileged(req.user)) return res.status(403).json({ error: "غير مصرح." });

  const tripsResult = await query(
    `SELECT t.*, u.full_name AS driver_name
     FROM trips t LEFT JOIN users u ON u.id = t.driver_id
     WHERE t.status IN ('PLANNED','STARTED')
     ORDER BY t.created_at DESC`
  );
  const trips = tripsResult.rows;
  if (trips.length === 0) return res.json([]);

  const tripIds = trips.map((t) => t.id);
  const stopsResult = await query(
    `SELECT ts.id, ts.trip_id, ts.delivered_at, o.status AS order_status, c.name AS customer_name
     FROM trip_stops ts
     JOIN orders o ON o.id = ts.order_id
     JOIN customers c ON c.id = o.customer_id
     WHERE ts.trip_id = ANY($1::int[])`,
    [tripIds]
  );

  const result = trips.map((t) => {
    const stops = stopsResult.rows.filter((s) => s.trip_id === t.id);
    return {
      ...t,
      delivered_count: stops.filter((s) => s.order_status === "DELIVERED").length,
      total_count: stops.length,
      stops,
    };
  });

  res.json(result);
});

router.get("/available-drivers", async (req, res) => {
  if (!isPrivileged(req.user)) return res.status(403).json({ error: "غير مصرح." });
  const result = await query(`SELECT id, full_name FROM users WHERE role = 'driver' AND status = 'active' ORDER BY full_name ASC`);
  res.json(result.rows);
});

router.get("/archive", async (req, res) => {
  if (!isPrivileged(req.user)) return res.status(403).json({ error: "غير مصرح." });

  const result = await query(
    `SELECT t.id, t.completed_at, t.started_at, t.total_distance_km, u.full_name AS driver_name,
            COUNT(ts.id)::int AS total_stops,
            COUNT(ts.id) FILTER (WHERE o.status = 'DELIVERED')::int AS delivered_count
     FROM trips t
     LEFT JOIN users u ON u.id = t.driver_id
     LEFT JOIN trip_stops ts ON ts.trip_id = t.id
     LEFT JOIN orders o ON o.id = ts.order_id
     WHERE t.status = 'COMPLETED'
     GROUP BY t.id, t.completed_at, t.started_at, t.total_distance_km, u.full_name
     ORDER BY t.completed_at DESC
     LIMIT 200`
  );
  res.json(result.rows);
});

router.get("/:id", async (req, res) => {
  const tripResult = await query(
    `SELECT t.*, u.full_name AS driver_name
     FROM trips t LEFT JOIN users u ON u.id = t.driver_id
     WHERE t.id = $1`,
    [req.params.id]
  );
  const trip = tripResult.rows[0];
  if (!trip) return res.status(404).json({ error: "الرحلة غير موجودة." });

  if (req.user.role === "data_entry") {
    return res.status(403).json({ error: "ليست لديك صلاحية الوصول لهذا القسم." });
  }
  if (req.user.role === "driver" && trip.driver_id !== req.user.id) {
    return res.status(403).json({ error: "هذه رحلة سائق آخر." });
  }

  res.json(await buildTripDetailResponse(trip, req.user));
});

router.post("/:id/location", async (req, res) => {
  const { latitude, longitude } = req.body;
  if (latitude == null || longitude == null) {
    return res.status(400).json({ error: "الإحداثيات مطلوبة." });
  }

  const tripResult = await query("SELECT * FROM trips WHERE id = $1", [req.params.id]);
  const trip = tripResult.rows[0];
  if (!trip) return res.status(404).json({ error: "الرحلة غير موجودة." });
  if (!canOperateTrip(req.user, trip)) {
    return res.status(403).json({ error: "غير مصرح." });
  }

  await query(
    `UPDATE trips SET current_latitude = $1, current_longitude = $2, location_updated_at = now() WHERE id = $3`,
    [latitude, longitude, req.params.id]
  );
  res.json({ ok: true });
});

router.post("/", async (req, res) => {
  const { order_ids, start_latitude, start_longitude, route_mode, driver_id } = req.body;

  let finalDriverId;
  if (req.user.role === "driver") {
    finalDriverId = req.user.id;
  } else if (isPrivileged(req.user)) {
    finalDriverId = driver_id || req.user.id;
  } else {
    return res.status(403).json({ error: "ليست لديك صلاحية إنشاء رحلة." });
  }

  if (!Array.isArray(order_ids) || order_ids.length === 0) {
    return res.status(400).json({ error: "الرجاء اختيار طلب واحد على الأقل." });
  }

  const existingActive = await query(
    `SELECT id FROM trips WHERE status IN ('PLANNED','STARTED') AND driver_id = $1`,
    [finalDriverId]
  );
  if (existingActive.rows[0]) {
    return res.status(400).json({ error: "يوجد رحلة نشطة بالفعل لهذا السائق. أنهِها أولًا قبل ما تبدأ رحلة جديدة." });
  }

  // نحسب المسار قبل ما نفتح العملية بقاعدة البيانات (حساب الطرق ممكن ياخذ كم ثانية)
  const ordersResult = await query(
    `SELECT o.id, o.priority, l.latitude, l.longitude
     FROM orders o
     JOIN customers c ON c.id = o.customer_id
     LEFT JOIN LATERAL (
       SELECT latitude, longitude FROM customer_locations WHERE customer_id = c.id ORDER BY id ASC LIMIT 1
     ) l ON true
     WHERE o.id = ANY($1::int[]) AND o.status IN ('NEW','READY','POSTPONED','FAILED')`,
    [order_ids]
  );
  if (ordersResult.rows.length === 0) {
    return res.status(400).json({ error: "لا يوجد طلبات صالحة للإضافة للرحلة." });
  }

  const mode = route_mode === "urgent_smart" ? "urgent_smart" : "nearest";
  const startLat = start_latitude ?? null;
  const startLon = start_longitude ?? null;
  const shop = await getShopLocation();

  const route = await optimizeRoute({
    start: startLat != null && startLon != null ? { lat: startLat, lon: startLon } : null,
    end: shop,
    stops: ordersResult.rows,
    mode,
  });
  const { ordered, legDistancesKm } = route;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const tripResult = await client.query(
      `INSERT INTO trips (status, driver_id, start_latitude, start_longitude, total_distance_km, distance_before_km,
                          route_geometry, created_by, started_at, return_leg_km, end_latitude, end_longitude, route_mode)
       VALUES ('STARTED', $1, $2, $3, $4, $5, $6, $7, now(), $8, $9, $10, $11) RETURNING *`,
      [
        finalDriverId, startLat, startLon, route.totalDistanceKm, route.distanceBeforeKm,
        route.geometry ? JSON.stringify(route.geometry) : null, req.user.id,
        route.returnLegKm, shop ? shop.lat : null, shop ? shop.lon : null, mode,
      ]
    );
    const trip = tripResult.rows[0];

    // سطر واحد لكل الطلبات بدل سطر لكل طلب — أسرع بكثير
    await client.query(
      `INSERT INTO trip_stops (trip_id, order_id, sequence_number, leg_distance_km)
       SELECT $1, u.order_id, u.seq, u.leg
       FROM unnest($2::int[], $3::int[], $4::numeric[]) AS u(order_id, seq, leg)`,
      [trip.id, ordered.map((o) => o.id), ordered.map((_, i) => i + 1), legDistancesKm]
    );
    await client.query(
      `UPDATE orders SET status = 'IN_ROUTE', updated_at = now() WHERE id = ANY($1::int[])`,
      [ordered.map((o) => o.id)]
    );

    await client.query("COMMIT");

    await logActivity({
      userId: req.user.id,
      action: "CREATE_TRIP",
      recordType: "trip",
      recordId: trip.id,
      newValue: {
        stops: ordered.length,
        total_distance_km: route.totalDistanceKm,
        distance_before_km: route.distanceBeforeKm,
        driver_id: finalDriverId,
        ends_at_shop: !!shop,
      },
    });

    notifyOrdersAddedToTrip({
      tripId: trip.id,
      orderIds: ordered.map((o) => o.id),
      actorId: req.user.id,
      isNewTrip: true,
    }).catch((e) => console.error("notify error:", e.message));

    res.status(201).json({ ...trip, stopsCount: ordered.length, ends_at_shop: !!shop });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(400).json({ error: err.message || "تعذّر إنشاء الرحلة." });
  } finally {
    client.release();
  }
});

router.post("/stops/:stopId/deliver", async (req, res) => {
  const { item_payments } = req.body || {};

  // استعلام واحد بيجيب التوقف + الرحلة + السائق + العميل
  const stopResult = await query(
    `SELECT ts.*, c.name AS customer_name, c.coupon_balance, o.customer_id, o.status AS order_status,
            t.driver_id, t.status AS trip_status, u.full_name AS driver_name
     FROM trip_stops ts
     JOIN orders o ON o.id = ts.order_id
     JOIN customers c ON c.id = o.customer_id
     JOIN trips t ON t.id = ts.trip_id
     LEFT JOIN users u ON u.id = t.driver_id
     WHERE ts.id = $1`,
    [req.params.stopId]
  );
  const stop = stopResult.rows[0];
  if (!stop) return res.status(404).json({ error: "التوقف غير موجود." });
  if (!canOperateTrip(req.user, { driver_id: stop.driver_id })) return res.status(403).json({ error: "غير مصرح." });

  // لو انضغط الزر مرتين — ما نسجّل التسليم مرتين
  if (stop.delivered_at || stop.order_status === "DELIVERED") {
    return res.json({ message: "هذا الطلب متسلّم من قبل.", already_delivered: true });
  }

  const itemsResult = await query(
    `SELECT oi.*, p.coupon_eligible, p.grants_coupons
     FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id
     WHERE oi.order_id = $1`,
    [stop.order_id]
  );
  const items = itemsResult.rows;
  if (items.length === 0) {
    return res.status(400).json({ error: "هذا الطلب ما إله كمية — حدد عدد القوارير قبل التسليم." });
  }

  const paymentMap = {};
  (item_payments || []).forEach((p) => { paymentMap[p.item_id] = Number(p.coupon_qty) || 0; });

  let totalCouponsUsed = 0;
  let cashCollected = 0;
  let couponsGranted = 0;
  const couponUpdates = [];

  for (const item of items) {
    let couponQty = paymentMap[item.id] || 0;
    if (!item.coupon_eligible) couponQty = 0;
    couponQty = Math.max(0, Math.min(couponQty, item.quantity));

    totalCouponsUsed += couponQty;
    cashCollected += (item.quantity - couponQty) * Number(item.unit_price_snapshot);
    if (couponQty !== (item.coupon_quantity || 0)) couponUpdates.push({ id: item.id, qty: couponQty });
    if (item.grants_coupons) couponsGranted += item.grants_coupons * item.quantity;
  }

  if (totalCouponsUsed > stop.coupon_balance) {
    return res.status(400).json({ error: `رصيد الكوبونات غير كافي — المتبقي للعميل فقط ${stop.coupon_balance} كوبون.` });
  }

  let newBalance = stop.coupon_balance;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // نقفل التوقف عشان لو وصل طلبين بنفس اللحظة ما يتسجّل التسليم مرتين
    const lock = await client.query(
      "UPDATE trip_stops SET delivered_at = now(), cash_collected = $1, coupons_collected = $2 WHERE id = $3 AND delivered_at IS NULL RETURNING id",
      [cashCollected, totalCouponsUsed, stop.id]
    );
    if (!lock.rows[0]) {
      await client.query("ROLLBACK");
      return res.json({ message: "هذا الطلب متسلّم من قبل.", already_delivered: true });
    }

    await client.query("UPDATE orders SET status = 'DELIVERED', updated_at = now() WHERE id = $1", [stop.order_id]);

    if (couponUpdates.length) {
      await client.query(
        `UPDATE order_items oi SET coupon_quantity = u.qty
         FROM unnest($1::int[], $2::int[]) AS u(id, qty) WHERE oi.id = u.id`,
        [couponUpdates.map((c) => c.id), couponUpdates.map((c) => c.qty)]
      );
    }

    if (totalCouponsUsed > 0) {
      newBalance -= totalCouponsUsed;
      await client.query(
        `INSERT INTO coupon_ledger (customer_id, change_amount, reason, order_id, balance_after, created_by)
         VALUES ($1, $2, 'order_payment', $3, $4, $5)`,
        [stop.customer_id, -totalCouponsUsed, stop.order_id, newBalance, req.user.id]
      );
    }
    if (couponsGranted > 0) {
      newBalance += couponsGranted;
      await client.query(
        `INSERT INTO coupon_ledger (customer_id, change_amount, reason, order_id, balance_after, created_by)
         VALUES ($1, $2, 'recharge', $3, $4, $5)`,
        [stop.customer_id, couponsGranted, stop.order_id, newBalance, req.user.id]
      );
    }
    if (totalCouponsUsed > 0 || couponsGranted > 0) {
      await client.query("UPDATE customers SET coupon_balance = $1 WHERE id = $2", [newBalance, stop.customer_id]);
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  // نرد على السائق فورًا — السجل والإشعارات بتكمل بالخلفية
  res.json({ message: "تم تسجيل التسليم.", cash_collected: cashCollected, coupons_used: totalCouponsUsed, coupons_granted: couponsGranted });

  (async () => {
    await logActivity({ userId: req.user.id, action: "DELIVER_ORDER", recordType: "order", recordId: stop.order_id });

    const countResult = await query(
      `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE delivered_at IS NOT NULL)::int AS delivered
       FROM trip_stops WHERE trip_id = $1`,
      [stop.trip_id]
    );
    await insertNotification({
      type: "DELIVERY",
      message: `✅ ${stop.driver_name || "السائق"} سلّم طلب ${stop.customer_name} — ${countResult.rows[0].delivered}/${countResult.rows[0].total}`,
      customerId: null,
      tripId: stop.trip_id,
    });
    if (totalCouponsUsed > 0) {
      await insertNotification({
        type: "COUPON",
        message: `🎫 خصم ${totalCouponsUsed} كوبون من ${stop.customer_name} — الرصيد المتبقي: ${newBalance}`,
        customerId: stop.customer_id,
        tripId: stop.trip_id,
      });
    }
    if (couponsGranted > 0) {
      await insertNotification({
        type: "COUPON",
        message: `🎫 تعبئة ${couponsGranted} كوبون لـ${stop.customer_name} — الرصيد الجديد: ${newBalance}`,
        customerId: stop.customer_id,
        tripId: stop.trip_id,
      });
    }
  })().catch((e) => console.error("after-deliver error:", e.message));
});

router.post("/stops/:stopId/undo-deliver", async (req, res) => {
  const stopResult = await query(
    `SELECT ts.*, o.customer_id, c.coupon_balance FROM trip_stops ts
     JOIN orders o ON o.id = ts.order_id JOIN customers c ON c.id = o.customer_id
     WHERE ts.id = $1`,
    [req.params.stopId]
  );
  const stop = stopResult.rows[0];
  if (!stop) return res.status(404).json({ error: "التوقف غير موجود." });
  if (!stop.delivered_at) return res.status(400).json({ error: "هذا التوقف لسا ما تسلّم أصلًا." });

  const tripResult = await query("SELECT * FROM trips WHERE id = $1", [stop.trip_id]);
  if (!canOperateTrip(req.user, tripResult.rows[0])) return res.status(403).json({ error: "غير مصرح." });

  const ledgerResult = await query(
    "SELECT COALESCE(SUM(change_amount), 0) AS net FROM coupon_ledger WHERE order_id = $1",
    [stop.order_id]
  );
  const netChange = Number(ledgerResult.rows[0].net);
  if (netChange !== 0) {
    const restoredBalance = stop.coupon_balance - netChange;
    await query("UPDATE customers SET coupon_balance = $1 WHERE id = $2", [restoredBalance, stop.customer_id]);
    await query(
      `INSERT INTO coupon_ledger (customer_id, change_amount, reason, order_id, balance_after, created_by)
       VALUES ($1, $2, 'manual_adjustment', $3, $4, $5)`,
      [stop.customer_id, -netChange, stop.order_id, restoredBalance, req.user.id]
    );
  }

  await query("UPDATE order_items SET coupon_quantity = 0 WHERE order_id = $1", [stop.order_id]);
  await query("UPDATE trip_stops SET delivered_at = NULL, cash_collected = NULL, coupons_collected = 0 WHERE id = $1", [stop.id]);
  await query("UPDATE orders SET status = 'IN_ROUTE', updated_at = now() WHERE id = $1", [stop.order_id]);

  await logActivity({ userId: req.user.id, action: "UNDO_DELIVER_ORDER", recordType: "order", recordId: stop.order_id });

  res.json({ message: "تم التراجع عن التسليم." });
});

router.post("/stops/:stopId/fail", async (req, res) => {
  const stopResult = await query("SELECT * FROM trip_stops WHERE id = $1", [req.params.stopId]);
  const stop = stopResult.rows[0];
  if (!stop) return res.status(404).json({ error: "التوقف غير موجود." });

  const tripResult = await query("SELECT * FROM trips WHERE id = $1", [stop.trip_id]);
  if (!canOperateTrip(req.user, tripResult.rows[0])) return res.status(403).json({ error: "غير مصرح." });

  const { reason } = req.body;
  await query(
    "UPDATE orders SET status = 'FAILED', failed_reason = $1, updated_at = now() WHERE id = $2",
    [reason || null, stop.order_id]
  );

  await logActivity({
    userId: req.user.id,
    action: "FAIL_DELIVERY",
    recordType: "order",
    recordId: stop.order_id,
    newValue: { reason },
  });

  res.json({ message: "تم تسجيل تعذر التسليم." });
});

router.post("/stops/:stopId/postpone", async (req, res) => {
  const stopResult = await query("SELECT * FROM trip_stops WHERE id = $1", [req.params.stopId]);
  const stop = stopResult.rows[0];
  if (!stop) return res.status(404).json({ error: "التوقف غير موجود." });

  const tripResult = await query("SELECT * FROM trips WHERE id = $1", [stop.trip_id]);
  if (!canOperateTrip(req.user, tripResult.rows[0])) return res.status(403).json({ error: "غير مصرح." });

  const { note, new_time } = req.body;
  const maxSeqResult = await query("SELECT COALESCE(MAX(sequence_number), 0) AS max_seq FROM trip_stops WHERE trip_id = $1", [stop.trip_id]);
  const newSeq = maxSeqResult.rows[0].max_seq + 1;

  await query("UPDATE trip_stops SET sequence_number = $1, postponed_at = now() WHERE id = $2", [newSeq, stop.id]);

  const noteAppend = [new_time ? `الموعد المطلوب: ${new_time}` : null, note || null].filter(Boolean).join(" — ");
  await query(
    `UPDATE orders SET
       requested_time = COALESCE($1, requested_time),
       notes = COALESCE(notes || ' | ', '') || $2,
       updated_at = now()
     WHERE id = $3`,
    [new_time || null, noteAppend || "تم التأجيل", stop.order_id]
  );

  await logActivity({
    userId: req.user.id,
    action: "POSTPONE_IN_TRIP",
    recordType: "order",
    recordId: stop.order_id,
    newValue: { note, new_time },
  });

  res.json({ message: "تم تأجيل التوقف لنهاية هذه الرحلة." });
});

router.post("/stops/:stopId/cancel", async (req, res) => {
  if (!isPrivileged(req.user) && !req.user.can_cancel_order) {
    return res.status(403).json({ error: "ليست لديك صلاحية إلغاء الطلبات." });
  }

  const { reason } = req.body;
  const stopResult = await query("SELECT * FROM trip_stops WHERE id = $1", [req.params.stopId]);
  const stop = stopResult.rows[0];
  if (!stop) return res.status(404).json({ error: "التوقف غير موجود." });

  await query(
    "UPDATE orders SET status = 'CANCELLED', cancelled_reason = $1, updated_at = now() WHERE id = $2",
    [reason || null, stop.order_id]
  );

  await logActivity({
    userId: req.user.id,
    action: "CANCEL_ORDER",
    recordType: "order",
    recordId: stop.order_id,
    newValue: { reason },
  });

  res.json({ message: "تم إلغاء الطلب." });
});

// يضيف طلب لآخر الرحلة، وبعدين بيعيد ترتيب كل الباقي بأحسن طريق
async function appendOrderAndReoptimize(trip, orderId) {
  await query(
    `INSERT INTO trip_stops (trip_id, order_id, sequence_number)
     SELECT $1, $2, COALESCE(MAX(sequence_number), 0) + 1 FROM trip_stops WHERE trip_id = $1`,
    [trip.id, orderId]
  );
  await query("UPDATE orders SET status = 'IN_ROUTE', updated_at = now() WHERE id = $1", [orderId]);
  await reoptimizeTrip(trip.id);
}

router.post("/:id/reoptimize", async (req, res) => {
  const tripResult = await query("SELECT * FROM trips WHERE id = $1", [req.params.id]);
  const trip = tripResult.rows[0];
  if (!trip) return res.status(404).json({ error: "الرحلة غير موجودة." });
  if (!canOperateTrip(req.user, trip) && !isPrivileged(req.user)) return res.status(403).json({ error: "غير مصرح." });
  if (trip.status === "COMPLETED") return res.status(400).json({ error: "الرحلة منتهية." });

  const result = await reoptimizeTrip(trip.id);
  res.json({ message: "تم ترتيب الرحلة من جديد بأحسن طريق.", ...result });
});

router.post("/:id/add-order", async (req, res) => {
  const { order_id } = req.body;
  if (!order_id) return res.status(400).json({ error: "رقم الطلب مطلوب." });

  const tripResult = await query("SELECT * FROM trips WHERE id = $1", [req.params.id]);
  const trip = tripResult.rows[0];
  if (!trip) return res.status(404).json({ error: "الرحلة غير موجودة." });
  if (!canOperateTrip(req.user, trip)) return res.status(403).json({ error: "غير مصرح." });
  if (trip.status !== "STARTED") return res.status(400).json({ error: "الرحلة ليست جارية حاليًا." });

  const orderResult = await query(
    "SELECT o.id, o.status FROM orders o WHERE o.id = $1",
    [order_id]
  );
  const newOrder = orderResult.rows[0];
  if (!newOrder || !["NEW", "READY"].includes(newOrder.status)) {
    return res.status(400).json({ error: "هذا الطلب غير صالح للإضافة لرحلة جارية." });
  }

  await appendOrderAndReoptimize(trip, newOrder.id);

  await logActivity({
    userId: req.user.id,
    action: "ADD_ORDER_TO_TRIP",
    recordType: "trip",
    recordId: trip.id,
    newValue: { order_id: newOrder.id },
  });

  notifyOrdersAddedToTrip({ tripId: trip.id, orderIds: [newOrder.id], actorId: req.user.id })
    .catch((e) => console.error("notify error:", e.message));

  res.json({ message: "تمت إضافة الطلب وإعادة ترتيب الرحلة بأحسن طريق." });
});

export async function tryAutoAddToActiveTrip(orderId, actorId = null) {
  const activeResult = await query(`SELECT * FROM trips WHERE status = 'STARTED'`);
  if (activeResult.rows.length !== 1) return false;
  const trip = activeResult.rows[0];

  const orderResult = await query(
    "SELECT o.id, o.status FROM orders o WHERE o.id = $1",
    [orderId]
  );
  const order = orderResult.rows[0];
  if (!order || order.status !== "NEW") return false;

  await appendOrderAndReoptimize(trip, order.id);
  await logActivity({ userId: null, action: "AUTO_ADD_ORDER_TO_TRIP", recordType: "trip", recordId: trip.id, newValue: { order_id: orderId } });
  notifyOrdersAddedToTrip({ tripId: trip.id, orderIds: [orderId], actorId })
    .catch((e) => console.error("notify error:", e.message));
  return true;
}

router.post("/:id/complete", async (req, res) => {
  const tripResult = await query("SELECT * FROM trips WHERE id = $1", [req.params.id]);
  const trip = tripResult.rows[0];
  if (!trip) return res.status(404).json({ error: "الرحلة غير موجودة." });
  if (!canOperateTrip(req.user, trip)) return res.status(403).json({ error: "غير مصرح." });

  const stopsResult = await query(
    `SELECT ts.*, o.status AS order_status, o.final_total
     FROM trip_stops ts JOIN orders o ON o.id = ts.order_id
     WHERE ts.trip_id = $1`,
    [trip.id]
  );
  const stops = stopsResult.rows;

  const delivered = stops.filter((s) => s.order_status === "DELIVERED");
  const failed = stops.filter((s) => s.order_status === "FAILED");
  const remaining = stops.filter((s) => !["DELIVERED", "FAILED", "CANCELLED"].includes(s.order_status));

  const itemsSummaryResult = await query(
    `SELECT oi.product_name_snapshot, SUM(oi.quantity)::int AS total_quantity
     FROM order_items oi
     JOIN trip_stops ts ON ts.order_id = oi.order_id
     JOIN orders o ON o.id = oi.order_id
     WHERE ts.trip_id = $1 AND o.status = 'DELIVERED'
     GROUP BY oi.product_name_snapshot
     ORDER BY total_quantity DESC`,
    [trip.id]
  );

  if (remaining.length > 0) {
    await query(`UPDATE orders SET status = 'NEW', updated_at = now() WHERE id = ANY($1::int[])`, [remaining.map((r) => r.order_id)]);
  }

  const completedResult = await query(
    `UPDATE trips SET status = 'COMPLETED', completed_at = now() WHERE id = $1 RETURNING started_at, completed_at`,
    [trip.id]
  );

  const totalCash = delivered.reduce((sum, s) => sum + Number(s.cash_collected || 0), 0);
  const totalCoupons = delivered.reduce((sum, s) => sum + Number(s.coupons_collected || 0), 0);

  if (trip.driver_id && delivered.length > 0) {
    await query(
      `INSERT INTO driver_ledger (driver_id, trip_id, entry_type, amount, coupons_redeemed, created_by)
       VALUES ($1, $2, 'trip_due', $3, $4, $5)`,
      [trip.driver_id, trip.id, totalCash, totalCoupons, req.user.id]
    );
  }

  res.json({
    trip_id: trip.id,
    started_at: completedResult.rows[0].started_at,
    completed_at: completedResult.rows[0].completed_at,
    total_stops: stops.length,
    delivered: delivered.length,
    failed: failed.length,
    returned_to_queue: remaining.length,
    total_delivered_value: totalCash + totalCoupons,
    total_cash_collected: totalCash,
    total_coupons_collected: totalCoupons,
    products_summary: itemsSummaryResult.rows,
  });
});

export default router;
