import { invalidateForecastCache } from "../utils/forecast.js";
import { Router } from "express";
import { pool, query, logActivity } from "../db.js";
import { notifyOrdersAddedToTrip } from "../utils/notify.js";
import { optimizeRoute, getShopLocation } from "../utils/routing.js";
import { planDistribution } from "../utils/dispatch.js";
import { requireAuth } from "../middleware/auth.js";
import { can, canAction } from "../permissions.js";

const router = Router();
router.use(requireAuth);

const AVERAGE_SPEED_KMH = 25;
const SERVICE_MINUTES_PER_STOP = 4;

// متابعة كل الرحلات
function isPrivileged(user) {
  return can(user, "trips", "view");
}

// تشغيل رحلة (تسليم، تأجيل، إنهاء...): صاحب الرحلة الكابتن، أو اللي عنده «تعديل» على كل الرحلات
function canOperateTrip(user, trip) {
  if (can(user, "trips", "edit")) return true;
  return trip.driver_id === user.id && can(user, "delivery", "edit");
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
  // الطلبات اللي موعدها بعيد (أكثر من ١٢ ساعة) بتضل بآخر الرحلة.
  // اللي موعدها خلال اليوم بتدخل بالترتيب الذكي وبتنحط بمكان بيوصلها الكابتن فيه قريب من موعدها.
  const timeLocked = pending
    .filter((s) => s.requested_time && new Date(s.requested_time).getTime() > now.getTime() + 12 * 3600 * 1000)
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
  const minById = new Map();
  route.ordered.forEach((s, i) => {
    legById.set(s.id, route.legDistancesKm[i]);
    minById.set(s.id, route.legMinutes?.[i] ?? null);
  });

  const ids = newOrder.map((s) => s.id);
  const seqs = newOrder.map((_, i) => i + 1);
  const legs = newOrder.map((s) => (legById.has(s.id) ? legById.get(s.id) : locked.includes(s) ? null : s.leg_distance_km));
  const mins = newOrder.map((s) => (minById.has(s.id) ? minById.get(s.id) : null));

  await query(
    `UPDATE trip_stops ts SET sequence_number = u.seq, leg_distance_km = u.leg,
       leg_minutes = CASE WHEN u.mins IS NULL AND ts.delivered_at IS NOT NULL THEN ts.leg_minutes ELSE u.mins END
     FROM unnest($1::int[], $2::int[], $3::numeric[], $4::numeric[]) AS u(id, seq, leg, mins)
     WHERE ts.id = u.id`,
    [ids, seqs, legs, mins]
  );

  const doneKm = done.reduce((sum, s) => sum + Number(s.leg_distance_km || 0), 0);
  await query(
    `UPDATE trips SET total_distance_km = $1, return_leg_km = $2, end_latitude = $3, end_longitude = $4,
       route_geometry = COALESCE($5, route_geometry), total_minutes = $7
     WHERE id = $6`,
    [
      doneKm + route.totalDistanceKm,
      route.returnLegKm,
      shop ? shop.lat : null,
      shop ? shop.lon : null,
      route.geometry ? JSON.stringify(route.geometry) : null,
      tripId,
      route.totalMinutes,
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
            c.debt_balance, c.bottles_out, o.subtotal,
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
        `SELECT oi.order_id, oi.id, oi.product_id, oi.product_name_snapshot, oi.quantity, oi.unit_price_snapshot, oi.coupon_quantity, p.coupon_eligible, p.is_returnable
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
      is_returnable: row.is_returnable,
      product_id: row.product_id,
    });
  }

  let cumulativeKm = 0;
  let cumulativeMinutes = 0;
  const now = new Date();
  const stopsWithEta = stops.map((s) => {
    const isPending = !s.delivered_at && s.order_status !== "FAILED" && s.order_status !== "CANCELLED";
    // الطلب اللي إله موعد بينفتح للتسليم قبل موعده بـ٢٠ دقيقة
    const isTimeLocked = isPending && s.requested_time && new Date(s.requested_time).getTime() > now.getTime() + 20 * 60 * 1000;
    if (isPending) {
      const legKm = s.leg_distance_km != null ? Number(s.leg_distance_km) : 0;
      cumulativeKm += legKm;
      // وقت السواقة الحقيقي من الخرائط، وإذا مش موجود منقدّره من المسافة
      const drivingMinutes = s.leg_minutes != null ? Number(s.leg_minutes) : (legKm / AVERAGE_SPEED_KMH) * 60;
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

  // حمولة السيارة: المحمّل، اللي نزل، الباقي، واللي لسا مطلوب للطلبات الباقية
  const loadResult = await query(
    "SELECT product_id, product_name_snapshot, loaded_quantity FROM trip_inventory WHERE trip_id = $1 ORDER BY id",
    [trip.id]
  );
  const loadMap = new Map();
  for (const row of loadResult.rows) {
    loadMap.set(row.product_id, { product_id: row.product_id, name: row.product_name_snapshot, loaded: row.loaded_quantity, delivered: 0, needed: 0 });
  }
  for (const st of stops) {
    const isDone = st.delivered_at || ["FAILED", "CANCELLED"].includes(st.order_status);
    for (const it of itemsByOrder[st.order_id] || []) {
      if (!loadMap.has(it.product_id)) {
        loadMap.set(it.product_id, { product_id: it.product_id, name: it.product_name_snapshot, loaded: null, delivered: 0, needed: 0 });
      }
      const entry = loadMap.get(it.product_id);
      if (st.delivered_at) entry.delivered += Number(it.quantity);
      else if (!isDone) entry.needed += Number(it.quantity);
    }
  }
  const load = [...loadMap.values()].map((e) => ({
    ...e,
    remaining: e.loaded == null ? null : e.loaded - e.delivered,
    short: e.loaded == null ? 0 : Math.max(0, e.needed - (e.loaded - e.delivered)),
  }));
  const emptiesCollected = stops.reduce((sum, st) => sum + Number(st.empties_collected || 0), 0);

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
    load,
    has_load: loadResult.rows.length > 0,
    empties_collected_total: emptiesCollected,
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
  if (!can(req.user, "trips", "edit")) return res.status(403).json({ error: "غير مصرح." });
  const result = await query(
    `SELECT id, full_name, role, permissions, can_discount, can_delete_customer, can_edit_product_price, can_cancel_order
     FROM users WHERE status = 'active' ORDER BY full_name ASC`
  );
  res.json(result.rows.filter((u) => can(u, "delivery", "edit")).map((u) => ({ id: u.id, full_name: u.full_name })));
});

router.get("/archive", async (req, res) => {
  if (!isPrivileged(req.user)) return res.status(403).json({ error: "غير مصرح." });
  const params = [];
  let where = "t.status = 'COMPLETED'";
  if (req.query.driver_id) { params.push(Number(req.query.driver_id)); where += ` AND t.driver_id = $${params.length}`; }
  const result = await query(
    `SELECT t.id, t.completed_at, t.started_at, t.total_distance_km, t.distance_before_km, t.driver_id, u.full_name AS driver_name,
            COUNT(ts.id)::int AS total_stops,
            COUNT(ts.id) FILTER (WHERE o.status = 'DELIVERED')::int AS delivered_count,
            COALESCE(SUM(ts.returnable_delivered), 0)::int AS bottles,
            COALESCE(SUM(ts.cash_collected), 0)::float AS cash,
            (SELECT COUNT(*)::int FROM trip_track tt WHERE tt.trip_id = t.id) AS track_points,
            ARRAY_AGG(DISTINCT r.name) FILTER (WHERE r.name IS NOT NULL) AS regions,
            json_agg(json_build_array(l.latitude, l.longitude) ORDER BY ts.sequence_number) FILTER (WHERE l.latitude IS NOT NULL) AS points
     FROM trips t
     LEFT JOIN users u ON u.id = t.driver_id
     LEFT JOIN trip_stops ts ON ts.trip_id = t.id
     LEFT JOIN orders o ON o.id = ts.order_id
     LEFT JOIN LATERAL (SELECT region_id, latitude, longitude FROM customer_locations WHERE customer_id = o.customer_id ORDER BY id LIMIT 1) l ON true
     LEFT JOIN regions r ON r.id = l.region_id
     WHERE ${where}
     GROUP BY t.id, u.full_name
     ORDER BY t.completed_at DESC
     LIMIT 200`,
    params
  );
  res.json(result.rows);
});

// إعادة عرض رحلة من الأرشيف: الخريطة، ترتيب التوقفات، وين راح الكابتن فعليًا، ومتى سلّم كل زبون
router.get("/:id/replay", async (req, res) => {
  const t = await query(
    `SELECT t.*, u.full_name AS driver_name FROM trips t LEFT JOIN users u ON u.id = t.driver_id WHERE t.id = $1`,
    [req.params.id]
  );
  const trip = t.rows[0];
  if (!trip) return res.status(404).json({ error: "الرحلة غير موجودة." });
  if (!isPrivileged(req.user) && trip.driver_id !== req.user.id) return res.status(403).json({ error: "غير مصرح." });

  const stops = await query(
    `SELECT ts.id, ts.sequence_number, ts.delivered_at, ts.cash_collected, ts.coupons_collected, ts.debt_added, ts.debt_paid,
            ts.returnable_delivered, ts.empties_collected, ts.leg_distance_km, ts.leg_minutes, ts.postponed_at,
            o.order_number, o.status AS order_status, o.final_total, o.requested_time,
            c.id AS customer_id, c.name AS customer_name, r.name AS region_name, l.latitude, l.longitude,
            (SELECT COALESCE(SUM(quantity), 0)::int FROM order_items WHERE order_id = o.id) AS qty
     FROM trip_stops ts
     JOIN orders o ON o.id = ts.order_id
     JOIN customers c ON c.id = o.customer_id
     LEFT JOIN LATERAL (SELECT * FROM customer_locations WHERE customer_id = c.id ORDER BY id ASC LIMIT 1) l ON true
     LEFT JOIN regions r ON r.id = l.region_id
     WHERE ts.trip_id = $1
     ORDER BY ts.sequence_number ASC`,
    [trip.id]
  );
  const track = await query(
    "SELECT latitude, longitude, recorded_at FROM trip_track WHERE trip_id = $1 ORDER BY id ASC LIMIT 5000",
    [trip.id]
  );
  // ترتيب التسليم الفعلي
  const deliveredOrder = stops.rows.filter((s) => s.delivered_at).sort((a, b) => new Date(a.delivered_at) - new Date(b.delivered_at));
  const actualRank = new Map(deliveredOrder.map((s, i) => [s.id, i + 1]));
  const shop = await getShopLocation();
  const minutes = trip.started_at && trip.completed_at ? Math.round((new Date(trip.completed_at) - new Date(trip.started_at)) / 60000) : null;

  res.json({
    id: trip.id, status: trip.status, driver_name: trip.driver_name,
    created_at: trip.created_at, started_at: trip.started_at, completed_at: trip.completed_at, duration_minutes: minutes,
    total_distance_km: trip.total_distance_km != null ? Number(trip.total_distance_km) : null,
    distance_before_km: trip.distance_before_km != null ? Number(trip.distance_before_km) : null,
    planned_minutes: trip.total_minutes != null ? Number(trip.total_minutes) : null,
    route_mode: trip.route_mode,
    shop: shop ? { lat: shop.lat, lon: shop.lon } : null,
    start: trip.start_latitude != null ? { lat: trip.start_latitude, lon: trip.start_longitude } : null,
    stops: stops.rows.map((s) => ({ ...s, actual_rank: actualRank.get(s.id) || null })),
    track: track.rows.map((p) => [p.latitude, p.longitude, p.recorded_at]),
    totals: {
      delivered: stops.rows.filter((s) => s.order_status === "DELIVERED").length,
      failed: stops.rows.filter((s) => s.order_status === "FAILED").length,
      bottles: stops.rows.reduce((a, s) => a + (s.returnable_delivered || 0), 0),
      empties: stops.rows.reduce((a, s) => a + (s.empties_collected || 0), 0),
      cash: stops.rows.reduce((a, s) => a + Number(s.cash_collected || 0), 0),
      coupons: stops.rows.reduce((a, s) => a + (s.coupons_collected || 0), 0),
      debt_added: stops.rows.reduce((a, s) => a + Number(s.debt_added || 0), 0),
    },
  });
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

  if (!isPrivileged(req.user) && trip.driver_id !== req.user.id) {
    return res.status(403).json({ error: "هذه رحلة كابتن ثاني." });
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
  // مسار الكابتن الفعلي للأرشيف: نقطة جديدة إذا تحرك ٢٠ متر أو مرّت دقيقتين
  if (trip.status === "STARTED") {
    const lat = Number(latitude), lon = Number(longitude);
    if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      const last = await query("SELECT latitude, longitude, recorded_at FROM trip_track WHERE trip_id = $1 ORDER BY id DESC LIMIT 1", [trip.id]);
      const p = last.rows[0];
      const moved = p ? Math.hypot((lat - p.latitude) * 111000, (lon - p.longitude) * 94000) : Infinity;
      const age = p ? Date.now() - new Date(p.recorded_at).getTime() : Infinity;
      if (moved >= 20 || age >= 120000) {
        await query("INSERT INTO trip_track (trip_id, latitude, longitude) VALUES ($1, $2, $3)", [trip.id, lat, lon]);
      }
    }
  }
  res.json({ ok: true });
});

router.post("/", async (req, res) => {
  const { order_ids, start_latitude, start_longitude, route_mode, driver_id } = req.body;

  let finalDriverId;
  if (can(req.user, "trips", "edit")) {
    finalDriverId = driver_id || req.user.id;
  } else if (can(req.user, "delivery", "edit")) {
    finalDriverId = req.user.id;
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

  try {
    const { trip, count, endsAtShop } = await createTripRecord({
      driverId: finalDriverId,
      orderIds: order_ids,
      actorId: req.user.id,
      start: start_latitude != null && start_longitude != null ? { lat: start_latitude, lon: start_longitude } : null,
      mode: route_mode,
      load: req.body.load,
    });
    res.status(201).json({ ...trip, stopsCount: count, ends_at_shop: endsAtShop });
  } catch (err) {
    res.status(400).json({ error: err.message || "تعذّر إنشاء الرحلة." });
  }
});

// إنشاء رحلة لكابتن (من صفحة الرحلة أو من «التوزيع على الكباتن»)
async function createTripRecord({ driverId, orderIds, actorId, start = null, mode = "nearest", load = [] }) {
  const ordersResult = await query(
    `SELECT o.id, o.priority, o.requested_time, l.latitude, l.longitude
     FROM orders o
     JOIN customers c ON c.id = o.customer_id
     LEFT JOIN LATERAL (
       SELECT latitude, longitude FROM customer_locations WHERE customer_id = c.id ORDER BY id ASC LIMIT 1
     ) l ON true
     WHERE o.id = ANY($1::int[]) AND o.status IN ('NEW','READY','POSTPONED','FAILED')`,
    [orderIds]
  );
  if (ordersResult.rows.length === 0) throw new Error("لا يوجد طلبات صالحة للإضافة للرحلة.");

  const routeMode = mode === "urgent_smart" ? "urgent_smart" : "nearest";
  const shop = await getShopLocation();
  const route = await optimizeRoute({ start, end: shop, stops: ordersResult.rows, mode: routeMode });
  const { ordered, legDistancesKm } = route;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const tripResult = await client.query(
      `INSERT INTO trips (status, driver_id, start_latitude, start_longitude, total_distance_km, distance_before_km,
                          route_geometry, created_by, started_at, return_leg_km, end_latitude, end_longitude, route_mode, total_minutes)
       VALUES ('STARTED', $1, $2, $3, $4, $5, $6, $7, now(), $8, $9, $10, $11, $12) RETURNING *`,
      [
        driverId, start?.lat ?? null, start?.lon ?? null, route.totalDistanceKm, route.distanceBeforeKm,
        route.geometry ? JSON.stringify(route.geometry) : null, actorId,
        route.returnLegKm, shop ? shop.lat : null, shop ? shop.lon : null, routeMode, route.totalMinutes,
      ]
    );
    const trip = tripResult.rows[0];
    await client.query(
      `INSERT INTO trip_stops (trip_id, order_id, sequence_number, leg_distance_km, leg_minutes)
       SELECT $1, u.order_id, u.seq, u.leg, u.mins
       FROM unnest($2::int[], $3::int[], $4::numeric[], $5::numeric[]) AS u(order_id, seq, leg, mins)`,
      [trip.id, ordered.map((o) => o.id), ordered.map((_, i) => i + 1), legDistancesKm, route.legMinutes]
    );
    await client.query(`UPDATE orders SET status = 'IN_ROUTE', updated_at = now() WHERE id = ANY($1::int[])`, [ordered.map((o) => o.id)]);

    const loadItems = (Array.isArray(load) ? load : [])
      .map((i) => ({ product_id: Number(i.product_id), quantity: Math.floor(Number(i.quantity)) }))
      .filter((i) => Number.isInteger(i.product_id) && i.product_id > 0 && i.quantity > 0 && i.quantity <= 5000);
    if (loadItems.length) {
      await client.query(
        `INSERT INTO trip_inventory (trip_id, product_id, product_name_snapshot, loaded_quantity)
         SELECT $1, p.id, p.name, u.qty
         FROM unnest($2::int[], $3::int[]) AS u(pid, qty) JOIN products p ON p.id = u.pid`,
        [trip.id, loadItems.map((i) => i.product_id), loadItems.map((i) => i.quantity)]
      );
    }
    await client.query("COMMIT");

    await logActivity({
      userId: actorId, action: "CREATE_TRIP", recordType: "trip", recordId: trip.id,
      newValue: { stops: ordered.length, total_distance_km: route.totalDistanceKm, distance_before_km: route.distanceBeforeKm, driver_id: driverId, ends_at_shop: !!shop },
    });
    notifyOrdersAddedToTrip({ tripId: trip.id, orderIds: ordered.map((o) => o.id), actorId, isNewTrip: true })
      .catch((e) => console.error("notify error:", e.message));
    return { trip, count: ordered.length, endsAtShop: !!shop };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ============================================================
// توزيع الطلبات على كذا كابتن
// ============================================================
async function ordersForPlanning(orderIds) {
  const r = await query(
    `SELECT o.id, o.order_number, o.priority, o.requested_time, o.scheduled_date, c.name AS customer_name,
            r.name AS region_name, l.latitude, l.longitude,
            COALESCE((SELECT SUM(oi.quantity) FROM order_items oi WHERE oi.order_id = o.id), 0)::int AS bottles
     FROM orders o
     JOIN customers c ON c.id = o.customer_id
     LEFT JOIN LATERAL (SELECT latitude, longitude, region_id FROM customer_locations WHERE customer_id = c.id ORDER BY id LIMIT 1) l ON true
     LEFT JOIN regions r ON r.id = l.region_id
     WHERE o.id = ANY($1::int[]) AND o.status IN ('NEW','READY','POSTPONED','FAILED')`,
    [orderIds]
  );
  return r.rows;
}

router.post("/plan", async (req, res) => {
  if (!can(req.user, "trips", "edit")) return res.status(403).json({ error: "التوزيع على الكباتن بده صلاحية تعديل الرحلات." });
  const orderIds = (req.body?.order_ids || []).map(Number).filter(Boolean);
  const driverIds = [...new Set((req.body?.driver_ids || []).map(Number).filter(Boolean))];
  if (!orderIds.length) return res.status(400).json({ error: "اختار طلبات." });
  if (!driverIds.length) return res.status(400).json({ error: "اختار كابتن واحد على الأقل." });
  const driversR = await query(
    `SELECT id, full_name, role, permissions, can_discount, can_delete_customer, can_edit_product_price, can_cancel_order
     FROM users WHERE id = ANY($1::int[]) AND status = 'active'`,
    [driverIds]
  );
  const drivers = driversR.rows.filter((u) => can(u, "delivery", "edit"));
  if (!drivers.length) return res.status(400).json({ error: "الكباتن اللي اخترتهم ما عندهم صلاحية توصيل." });
  const orders = await ordersForPlanning(orderIds);
  if (!orders.length) return res.status(400).json({ error: "ما في طلبات جاهزة للتوزيع." });
  const active = await query(
    "SELECT driver_id, id FROM trips WHERE status IN ('PLANNED','STARTED') AND driver_id = ANY($1::int[])",
    [drivers.map((d) => d.id)]
  );
  const activeMap = Object.fromEntries(active.rows.map((r) => [r.driver_id, r.id]));
  const groups = await planDistribution({ orders, drivers, shop: await getShopLocation() });
  res.json({
    groups: groups.map((g) => ({
      ...g,
      has_active_trip: !!activeMap[g.driver_id],
      orders: g.orders.map((o) => ({
        id: o.id, order_number: o.order_number, customer_name: o.customer_name, region_name: o.region_name,
        bottles: o.bottles, priority: o.priority, requested_time: o.requested_time, has_location: o.latitude != null,
        latitude: o.latitude, longitude: o.longitude,
      })),
    })),
  });
});

// اعتماد التوزيع: رحلة لكل كابتن (أو إضافة على رحلته الشغّالة)
router.post("/plan/apply", async (req, res) => {
  if (!can(req.user, "trips", "edit")) return res.status(403).json({ error: "غير مصرح." });
  const groups = (req.body?.groups || []).filter((g) => g.driver_id && Array.isArray(g.order_ids) && g.order_ids.length);
  if (!groups.length) return res.status(400).json({ error: "ما في توزيع." });
  const allIds = groups.flatMap((g) => g.order_ids.map(Number));
  if (new Set(allIds).size !== allIds.length) return res.status(400).json({ error: "في طلب مكرر بأكثر من كابتن." });

  const results = [];
  for (const g of groups) {
    const driverId = Number(g.driver_id);
    const orderIds = g.order_ids.map(Number);
    try {
      const active = (await query("SELECT * FROM trips WHERE status IN ('PLANNED','STARTED') AND driver_id = $1 LIMIT 1", [driverId])).rows[0];
      if (active) {
        const ok = (await query(
          "SELECT id FROM orders WHERE id = ANY($1::int[]) AND status IN ('NEW','READY','POSTPONED','FAILED')",
          [orderIds]
        )).rows.map((r) => r.id);
        for (const oid of ok) {
          await query(
            `INSERT INTO trip_stops (trip_id, order_id, sequence_number)
             SELECT $1, $2, COALESCE(MAX(sequence_number), 0) + 1 FROM trip_stops WHERE trip_id = $1`,
            [active.id, oid]
          );
        }
        if (ok.length) {
          await query("UPDATE orders SET status = 'IN_ROUTE', updated_at = now() WHERE id = ANY($1::int[])", [ok]);
          await reoptimizeTrip(active.id);
          notifyOrdersAddedToTrip({ tripId: active.id, orderIds: ok, actorId: req.user.id }).catch(() => {});
        }
        results.push({ driver_id: driverId, trip_id: active.id, added: ok.length, appended: true });
      } else {
        const { trip, count } = await createTripRecord({ driverId, orderIds, actorId: req.user.id });
        results.push({ driver_id: driverId, trip_id: trip.id, added: count, appended: false });
      }
    } catch (err) {
      results.push({ driver_id: driverId, error: err.message });
    }
  }
  res.json({ results });
});

const round2 = (n) => Math.round(Number(n) * 100) / 100;

// التسليم: كوبونات + كاش + دين (آجل أو جزئي) + تسديد دين قديم + الفوارغ
// body: { item_payments: [{item_id, coupon_qty}], cash_received?, empties? }
//  - cash_received أقل من المطلوب ← الباقي بينضاف دين على الزبون (بدها صلاحية البيع بالدين)
//  - cash_received أكثر من المطلوب ← الزيادة بتسدّد من دينه القديم
router.post("/stops/:stopId/deliver", async (req, res) => {
  const { item_payments, cash_received, empties } = req.body || {};

  const stopResult = await query(
    `SELECT ts.*, c.name AS customer_name, c.coupon_balance, c.debt_balance, o.customer_id, o.status AS order_status,
            o.subtotal, o.final_total,
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

  if (stop.delivered_at || stop.order_status === "DELIVERED") {
    return res.json({ message: "هذا الطلب متسلّم من قبل.", already_delivered: true });
  }

  const itemsResult = await query(
    `SELECT oi.*, p.coupon_eligible, p.grants_coupons, p.is_returnable
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
  let cashPart = 0;
  let couponsGranted = 0;
  let returnableDelivered = 0;
  const couponUpdates = [];

  for (const item of items) {
    let couponQty = paymentMap[item.id] || 0;
    if (!item.coupon_eligible) couponQty = 0;
    couponQty = Math.max(0, Math.min(Math.floor(couponQty), item.quantity));

    totalCouponsUsed += couponQty;
    cashPart += (item.quantity - couponQty) * Number(item.unit_price_snapshot);
    if (couponQty !== (item.coupon_quantity || 0)) couponUpdates.push({ id: item.id, qty: couponQty });
    if (item.grants_coupons) couponsGranted += item.grants_coupons * item.quantity;
    if (item.is_returnable) returnableDelivered += item.quantity;
  }

  if (totalCouponsUsed > stop.coupon_balance) {
    return res.status(400).json({ error: `رصيد الكوبونات غير كافي — المتبقي للعميل فقط ${stop.coupon_balance} كوبون.` });
  }

  // الخصم على الطلب بينطبق على الجزء الكاش
  const subtotal = Number(stop.subtotal) || 0;
  const finalTotal = Number(stop.final_total) || 0;
  const discountRatio = subtotal > 0 ? Math.min(1, finalTotal / subtotal) : 1;
  const amountDue = round2(cashPart * discountRatio);

  let received = cash_received == null || cash_received === "" ? amountDue : round2(cash_received);
  if (!Number.isFinite(received) || received < 0) {
    return res.status(400).json({ error: "المبلغ المستلم غير صحيح." });
  }

  const oldDebt = round2(stop.debt_balance);
  let debtAdded = 0;
  let debtPaid = 0;
  if (received < amountDue) {
    debtAdded = round2(amountDue - received);
    if (!canAction(req.user, "give_credit")) {
      return res.status(403).json({ error: "ما عندك صلاحية البيع بالدين — لازم يدفع المبلغ كامل." });
    }
  } else if (received > amountDue) {
    debtPaid = round2(received - amountDue);
    if (debtPaid > oldDebt + 0.001) {
      return res.status(400).json({
        error: oldDebt > 0
          ? `المبلغ أكثر من المطلوب. المطلوب ${amountDue.toFixed(2)} ودينه القديم ${oldDebt.toFixed(2)} بس.`
          : `المبلغ أكثر من المطلوب (${amountDue.toFixed(2)} JD).`,
      });
    }
  }

  let emptiesCollected = empties == null || empties === "" ? returnableDelivered : Math.max(0, Math.floor(Number(empties)) || 0);
  if (emptiesCollected > 500) emptiesCollected = 500;

  let newBalance = stop.coupon_balance;
  let newDebt = oldDebt;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const lock = await client.query(
      `UPDATE trip_stops SET delivered_at = now(), cash_collected = $1, coupons_collected = $2,
         amount_due = $3, debt_added = $4, debt_paid = $5, returnable_delivered = $6, empties_collected = $7
       WHERE id = $8 AND delivered_at IS NULL RETURNING id`,
      [received, totalCouponsUsed, amountDue, debtAdded, debtPaid, returnableDelivered, emptiesCollected, stop.id]
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

    if (debtAdded > 0) {
      newDebt = round2(newDebt + debtAdded);
      await client.query(
        `INSERT INTO customer_debt_ledger (customer_id, change_amount, reason, order_id, trip_id, balance_after, notes, created_by)
         VALUES ($1, $2, 'order_credit', $3, $4, $5, $6, $7)`,
        [stop.customer_id, debtAdded, stop.order_id, stop.trip_id, newDebt,
         received > 0 ? `دفع ${received.toFixed(2)} من ${amountDue.toFixed(2)}` : "آجل", req.user.id]
      );
    }
    if (debtPaid > 0) {
      newDebt = round2(newDebt - debtPaid);
      await client.query(
        `INSERT INTO customer_debt_ledger (customer_id, change_amount, reason, order_id, trip_id, balance_after, notes, created_by)
         VALUES ($1, $2, 'payment', $3, $4, $5, 'دفعة مع التوصيل', $6)`,
        [stop.customer_id, -debtPaid, stop.order_id, stop.trip_id, newDebt, req.user.id]
      );
    }

    const bottlesR = await client.query(
      `UPDATE customers SET coupon_balance = $1, debt_balance = $2, bottles_out = GREATEST(0, bottles_out + $3)
       WHERE id = $4 RETURNING bottles_out`,
      [newBalance, newDebt, returnableDelivered - emptiesCollected, stop.customer_id]
    );
    // سجل عهدة القوارير: كم نزل وكم فارغ رجع
    if (returnableDelivered || emptiesCollected) {
      await client.query(
        `INSERT INTO bottle_ledger (customer_id, change, reason, balance_after, order_id, trip_id, note, created_by)
         VALUES ($1, $2, 'delivery', $3, $4, $5, $6, $7)`,
        [stop.customer_id, returnableDelivered - emptiesCollected, bottlesR.rows[0]?.bottles_out ?? 0, stop.order_id, stop.trip_id,
         `نزل ${returnableDelivered} مليان · رجع ${emptiesCollected} فارغ`, req.user.id]
      );
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  invalidateForecastCache();
  res.json({
    message: "تم تسجيل التسليم.",
    amount_due: amountDue,
    cash_collected: received,
    debt_added: debtAdded,
    debt_paid: debtPaid,
    debt_balance: newDebt,
    coupons_used: totalCouponsUsed,
    coupons_granted: couponsGranted,
    coupon_balance: newBalance,
  });

  (async () => {
    await logActivity({
      userId: req.user.id, action: "DELIVER_ORDER", recordType: "order", recordId: stop.order_id,
      newValue: { amount_due: amountDue, received, debt_added: debtAdded, debt_paid: debtPaid, coupons: totalCouponsUsed, empties: emptiesCollected },
    });

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
    if (debtAdded > 0) {
      await insertNotification({
        type: "DEBT",
        message: `💳 انضاف دين ${debtAdded.toFixed(2)} JD على ${stop.customer_name} — صار عليه ${newDebt.toFixed(2)} JD`,
        customerId: stop.customer_id,
        tripId: stop.trip_id,
      });
    }
    if (debtPaid > 0) {
      await insertNotification({
        type: "DEBT",
        message: `💵 ${stop.customer_name} دفع ${debtPaid.toFixed(2)} JD من دينه — باقي عليه ${newDebt.toFixed(2)} JD`,
        customerId: stop.customer_id,
        tripId: stop.trip_id,
      });
    }
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

// التراجع عن تسليم: بيرجّع الكوبونات والدين والقوارير زي ما كانوا
router.post("/stops/:stopId/undo-deliver", async (req, res) => {
  const stopResult = await query(
    `SELECT ts.*, o.customer_id FROM trip_stops ts
     JOIN orders o ON o.id = ts.order_id
     WHERE ts.id = $1`,
    [req.params.stopId]
  );
  const stop = stopResult.rows[0];
  if (!stop) return res.status(404).json({ error: "التوقف غير موجود." });
  if (!stop.delivered_at) return res.status(400).json({ error: "هذا التوقف لسا ما تسلّم أصلًا." });

  const tripResult = await query("SELECT * FROM trips WHERE id = $1", [stop.trip_id]);
  if (!canOperateTrip(req.user, tripResult.rows[0])) return res.status(403).json({ error: "غير مصرح." });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const customer = (await client.query(
      "SELECT coupon_balance, debt_balance FROM customers WHERE id = $1 FOR UPDATE",
      [stop.customer_id]
    )).rows[0];

    const ledgerResult = await client.query(
      "SELECT COALESCE(SUM(change_amount), 0) AS net FROM coupon_ledger WHERE order_id = $1",
      [stop.order_id]
    );
    const netCoupons = Number(ledgerResult.rows[0].net);
    let couponBalance = customer.coupon_balance;
    if (netCoupons !== 0) {
      couponBalance -= netCoupons;
      await client.query(
        `INSERT INTO coupon_ledger (customer_id, change_amount, reason, order_id, balance_after, created_by, notes)
         VALUES ($1, $2, 'delivery_undo', $3, $4, $5, 'تراجع عن تسليم')`,
        [stop.customer_id, -netCoupons, stop.order_id, couponBalance, req.user.id]
      );
    }

    const netDebt = round2(Number(stop.debt_added || 0) - Number(stop.debt_paid || 0));
    let debtBalance = round2(customer.debt_balance);
    if (netDebt !== 0) {
      debtBalance = round2(debtBalance - netDebt);
      await client.query(
        `INSERT INTO customer_debt_ledger (customer_id, change_amount, reason, order_id, trip_id, balance_after, notes, created_by)
         VALUES ($1, $2, 'delivery_undo', $3, $4, $5, 'تراجع عن تسليم', $6)`,
        [stop.customer_id, -netDebt, stop.order_id, stop.trip_id, debtBalance, req.user.id]
      );
    }

    const bottlesChange = Number(stop.returnable_delivered || 0) - Number(stop.empties_collected || 0);
    const bottlesR = await client.query(
      "UPDATE customers SET coupon_balance = $1, debt_balance = $2, bottles_out = GREATEST(0, bottles_out - $3) WHERE id = $4 RETURNING bottles_out",
      [couponBalance, debtBalance, bottlesChange, stop.customer_id]
    );
    if (bottlesChange) {
      await client.query(
        `INSERT INTO bottle_ledger (customer_id, change, reason, balance_after, order_id, trip_id, note, created_by)
         VALUES ($1, $2, 'undo', $3, $4, $5, 'تراجع عن تسليم', $6)`,
        [stop.customer_id, -bottlesChange, bottlesR.rows[0]?.bottles_out ?? 0, stop.order_id, stop.trip_id, req.user.id]
      );
    }

    await client.query("UPDATE order_items SET coupon_quantity = 0 WHERE order_id = $1", [stop.order_id]);
    await client.query(
      `UPDATE trip_stops SET delivered_at = NULL, cash_collected = NULL, coupons_collected = 0, amount_due = NULL,
         debt_added = 0, debt_paid = 0, returnable_delivered = 0, empties_collected = 0
       WHERE id = $1`,
      [stop.id]
    );
    await client.query("UPDATE orders SET status = 'IN_ROUTE', updated_at = now() WHERE id = $1", [stop.order_id]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }

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
  if (!canAction(req.user, "cancel_order")) {
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

// تحميل السيارة: كم حمّل من كل منتج (بينحفظ من جديد كل مرة)
router.post("/:id/load", async (req, res) => {
  const tripResult = await query("SELECT * FROM trips WHERE id = $1", [req.params.id]);
  const trip = tripResult.rows[0];
  if (!trip) return res.status(404).json({ error: "الرحلة غير موجودة." });
  if (!canOperateTrip(req.user, trip)) return res.status(403).json({ error: "غير مصرح." });
  if (trip.status === "COMPLETED") return res.status(400).json({ error: "الرحلة منتهية." });

  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  const clean = items
    .map((i) => ({ product_id: Number(i.product_id), quantity: Math.floor(Number(i.quantity)) }))
    .filter((i) => Number.isInteger(i.product_id) && i.product_id > 0 && Number.isFinite(i.quantity) && i.quantity >= 0 && i.quantity <= 5000);

  const products = clean.length
    ? (await query("SELECT id, name FROM products WHERE id = ANY($1::int[])", [clean.map((i) => i.product_id)])).rows
    : [];
  const names = Object.fromEntries(products.map((p) => [p.id, p.name]));

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM trip_inventory WHERE trip_id = $1", [trip.id]);
    const rows = clean.filter((i) => names[i.product_id] && i.quantity > 0);
    if (rows.length) {
      await client.query(
        `INSERT INTO trip_inventory (trip_id, product_id, product_name_snapshot, loaded_quantity)
         SELECT $1, u.pid, u.pname, u.qty FROM unnest($2::int[], $3::text[], $4::int[]) AS u(pid, pname, qty)`,
        [trip.id, rows.map((r) => r.product_id), rows.map((r) => names[r.product_id]), rows.map((r) => r.quantity)]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  await logActivity({ userId: req.user.id, action: "LOAD_TRIP", recordType: "trip", recordId: trip.id, newValue: { items: clean } });
  res.json({ message: "تم حفظ حمولة السيارة." });
});

router.post("/:id/reoptimize", async (req, res) => {
  const tripResult = await query("SELECT * FROM trips WHERE id = $1", [req.params.id]);
  const trip = tripResult.rows[0];
  if (!trip) return res.status(404).json({ error: "الرحلة غير موجودة." });
  if (!canOperateTrip(req.user, trip)) return res.status(403).json({ error: "غير مصرح." });
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
    `SELECT o.id, o.status, o.requested_time,
            (o.scheduled_date > (now() AT TIME ZONE 'Asia/Amman')::date) AS future_day
     FROM orders o WHERE o.id = $1`,
    [orderId]
  );
  const order = orderResult.rows[0];
  if (!order || order.status !== "NEW") return false;
  // الطلب المجدول ليوم جاي أو لساعة بعيدة بيستنى — ما بينضاف للرحلة الشغالة هلّق
  if (order.future_day) return false;
  if (order.requested_time && new Date(order.requested_time).getTime() > Date.now() + 2 * 3600 * 1000) return false;

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
  const totalDebtAdded = delivered.reduce((sum, s) => sum + Number(s.debt_added || 0), 0);
  const totalDebtPaid = delivered.reduce((sum, s) => sum + Number(s.debt_paid || 0), 0);
  const totalEmpties = delivered.reduce((sum, s) => sum + Number(s.empties_collected || 0), 0);

  const loadSummary = (await query(
    `SELECT ti.product_name_snapshot AS name, ti.loaded_quantity AS loaded,
            COALESCE((SELECT SUM(oi.quantity) FROM trip_stops ts2 JOIN order_items oi ON oi.order_id = ts2.order_id
                      WHERE ts2.trip_id = ti.trip_id AND ts2.delivered_at IS NOT NULL AND oi.product_id = ti.product_id), 0)::int AS delivered
     FROM trip_inventory ti WHERE ti.trip_id = $1 ORDER BY ti.id`,
    [trip.id]
  )).rows.map((r) => ({ ...r, returned: r.loaded - r.delivered }));

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
    total_debt_added: totalDebtAdded,
    total_debt_paid: totalDebtPaid,
    total_empties: totalEmpties,
    load_summary: loadSummary,
    products_summary: itemsSummaryResult.rows,
  });
});

export default router;
