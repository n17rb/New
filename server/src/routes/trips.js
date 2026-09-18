import { Router } from "express";
import { pool, query, logActivity } from "../db.js";
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

function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function getRoadDistanceMatrix(points) {
  if (points.length > 60) return null;
  try {
    const coords = points.map((p) => `${p.lon},${p.lat}`).join(";");
    const url = `https://router.project-osrm.org/table/v1/driving/${coords}?annotations=distance`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.code !== "Ok" || !data.distances) return null;
    return data.distances;
  } catch {
    return null;
  }
}

async function getRouteGeometry(orderedPoints) {
  if (orderedPoints.length < 2 || orderedPoints.length > 60) return null;
  try {
    const coords = orderedPoints.map((p) => `${p.lon},${p.lat}`).join(";");
    const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.code !== "Ok" || !data.routes?.[0]?.geometry) return null;
    return data.routes[0].geometry.coordinates;
  } catch {
    return null;
  }
}

function twoOpt(routeIn, distFn, maxIterations = 40) {
  let best = [...routeIn];
  let improved = true;
  let iterations = 0;
  while (improved && iterations < maxIterations) {
    improved = false;
    iterations++;
    for (let i = 1; i < best.length - 2; i++) {
      for (let j = i + 1; j < best.length - 1; j++) {
        const a = best[i - 1], b = best[i], c = best[j], d = best[j + 1];
        const delta = (distFn(a, c) + distFn(b, d)) - (distFn(a, b) + distFn(c, d));
        if (delta < -1e-6) {
          const segment = best.slice(i, j + 1).reverse();
          best = [...best.slice(0, i), ...segment, ...best.slice(j + 1)];
          improved = true;
        }
      }
    }
  }
  return best;
}

function orOpt(routeIn, distFn, maxIterations = 20) {
  let best = [...routeIn];
  let improved = true;
  let iterations = 0;
  while (improved && iterations < maxIterations) {
    improved = false;
    iterations++;
    for (let i = 1; i < best.length - 1; i++) {
      const node = best[i], prev = best[i - 1], next = best[i + 1];
      const removalGain = distFn(prev, node) + distFn(node, next) - distFn(prev, next);
      let bestJ = null, bestCost = Infinity;
      for (let j = 0; j < best.length - 1; j++) {
        if (j === i - 1 || j === i) continue;
        const p = best[j], q = best[j + 1];
        const cost = distFn(p, node) + distFn(node, q) - distFn(p, q);
        if (cost < bestCost) { bestCost = cost; bestJ = j; }
      }
      if (bestJ !== null && bestCost < removalGain - 1e-6) {
        const without = [...best.slice(0, i), ...best.slice(i + 1)];
        const insertAt = bestJ < i ? bestJ + 1 : bestJ;
        without.splice(insertAt, 0, node);
        best = without;
        improved = true;
      }
    }
  }
  return best;
}

async function buildRoute(startLat, startLon, stops, routeMode) {
  const withLocation = stops.filter((s) => s.latitude != null && s.longitude != null);
  const withoutLocation = stops.filter((s) => s.latitude == null || s.longitude == null);

  if (withLocation.length === 0) {
    return { ordered: [...stops], legDistancesKm: stops.map(() => null), totalDistance: 0, distanceBefore: 0, geometry: null };
  }

  let anchorLat = startLat;
  let anchorLon = startLon;
  let remainingPoints = withLocation;
  let firstStopIsAnchor = null;

  if (anchorLat == null || anchorLon == null) {
    firstStopIsAnchor = withLocation[0];
    anchorLat = firstStopIsAnchor.latitude;
    anchorLon = firstStopIsAnchor.longitude;
    remainingPoints = withLocation.slice(1);
  }

  if (remainingPoints.length === 0) {
    return {
      ordered: [firstStopIsAnchor, ...withoutLocation],
      legDistancesKm: [0, ...withoutLocation.map(() => null)],
      totalDistance: 0,
      distanceBefore: 0,
      geometry: null,
    };
  }

  const allPoints = [{ lat: anchorLat, lon: anchorLon }, ...remainingPoints.map((s) => ({ lat: s.latitude, lon: s.longitude }))];
  const roadMatrix = await getRoadDistanceMatrix(allPoints);

  function realDist(i, j) {
    if (roadMatrix) return roadMatrix[i][j];
    return distanceKm(allPoints[i].lat, allPoints[i].lon, allPoints[j].lat, allPoints[j].lon) * 1000;
  }

  function effectiveDist(i, j) {
    if (routeMode === "urgent_smart" && j > 0 && remainingPoints[j - 1].priority === "urgent") {
      return realDist(i, j) * 0.7;
    }
    return realDist(i, j);
  }

  function routeRealDistance(r) {
    let total = 0;
    for (let i = 0; i < r.length - 1; i++) total += realDist(r[i], r[i + 1]);
    return total;
  }

  const remainingIdx = remainingPoints.map((_, i) => i + 1);
  let route = [0];
  let current = 0;
  while (remainingIdx.length) {
    let bestPos = 0, bestScore = Infinity;
    remainingIdx.forEach((idx, pos) => {
      const score = effectiveDist(current, idx);
      if (score < bestScore) { bestScore = score; bestPos = pos; }
    });
    const chosen = remainingIdx.splice(bestPos, 1)[0];
    route.push(chosen);
    current = chosen;
  }
  const distanceBefore = routeRealDistance(route);

  let improvedRoute = twoOpt(route, effectiveDist);
  improvedRoute = orOpt(improvedRoute, effectiveDist);
  improvedRoute = twoOpt(improvedRoute, effectiveDist);

  const totalDistance = routeRealDistance(improvedRoute);
  const orderedStops = improvedRoute.slice(1).map((idx) => remainingPoints[idx - 1]);
  const legDistancesForOrdered = [];
  for (let i = 1; i < improvedRoute.length; i++) {
    legDistancesForOrdered.push(realDist(improvedRoute[i - 1], improvedRoute[i]) / 1000);
  }
  const orderedAllPoints = improvedRoute.map((idx) => allPoints[idx]);
  const geometry = await getRouteGeometry(orderedAllPoints);

  const finalOrdered = firstStopIsAnchor ? [firstStopIsAnchor, ...orderedStops] : orderedStops;
  const finalLegDistances = firstStopIsAnchor ? [0, ...legDistancesForOrdered] : legDistancesForOrdered;

  return {
    ordered: [...finalOrdered, ...withoutLocation],
    legDistancesKm: [...finalLegDistances, ...withoutLocation.map(() => null)],
    totalDistance: totalDistance / 1000,
    distanceBefore: distanceBefore / 1000,
    geometry,
  };
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
            c.id AS customer_id, c.name AS customer_name, c.phone_normalized, c.phone_display, c.coupon_balance,
            l.latitude, l.longitude, l.maps_url, l.street, l.building_number, l.building_name,
            l.floor, l.apartment, l.side, l.access_notes, l.building_photo_url
     FROM trip_stops ts
     JOIN orders o ON o.id = ts.order_id
     JOIN customers c ON c.id = o.customer_id
     LEFT JOIN customer_locations l ON l.customer_id = c.id
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

  return {
    ...trip,
    stops: stopsWithEta,
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

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const ordersResult = await client.query(
      `SELECT o.id, o.priority, l.latitude, l.longitude
       FROM orders o
       JOIN customers c ON c.id = o.customer_id
       LEFT JOIN customer_locations l ON l.customer_id = c.id
       WHERE o.id = ANY($1::int[]) AND o.status IN ('NEW','READY','POSTPONED','FAILED')`,
      [order_ids]
    );

    if (ordersResult.rows.length === 0) {
      throw new Error("لا يوجد طلبات صالحة للإضافة للرحلة.");
    }

    const mode = route_mode === "nearest" ? "nearest" : "urgent_smart";
    const startLat = start_latitude ?? null;
    const startLon = start_longitude ?? null;

    const { ordered, legDistancesKm, totalDistance, distanceBefore, geometry } = await buildRoute(startLat, startLon, ordersResult.rows, mode);

    const tripResult = await client.query(
      `INSERT INTO trips (status, driver_id, start_latitude, start_longitude, total_distance_km, distance_before_km, route_geometry, created_by, started_at)
       VALUES ('STARTED', $1, $2, $3, $4, $5, $6, $7, now()) RETURNING *`,
      [finalDriverId, startLat, startLon, totalDistance, distanceBefore, geometry ? JSON.stringify(geometry) : null, req.user.id]
    );
    const trip = tripResult.rows[0];

    for (let i = 0; i < ordered.length; i++) {
      await client.query(
        `INSERT INTO trip_stops (trip_id, order_id, sequence_number, leg_distance_km) VALUES ($1, $2, $3, $4)`,
        [trip.id, ordered[i].id, i + 1, legDistancesKm[i]]
      );
      await client.query(`UPDATE orders SET status = 'IN_ROUTE', updated_at = now() WHERE id = $1`, [ordered[i].id]);
    }

    await client.query("COMMIT");

    await logActivity({
      userId: req.user.id,
      action: "CREATE_TRIP",
      recordType: "trip",
      recordId: trip.id,
      newValue: { stops: ordered.length, total_distance_km: totalDistance, distance_before_km: distanceBefore, driver_id: finalDriverId },
    });

    res.status(201).json({ ...trip, stopsCount: ordered.length });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(400).json({ error: err.message || "تعذّر إنشاء الرحلة." });
  } finally {
    client.release();
  }
});

router.post("/stops/:stopId/deliver", async (req, res) => {
  const { item_payments } = req.body;

  const stopResult = await query(
    `SELECT ts.*, c.name AS customer_name, c.coupon_balance, o.customer_id
     FROM trip_stops ts
     JOIN orders o ON o.id = ts.order_id JOIN customers c ON c.id = o.customer_id
     WHERE ts.id = $1`,
    [req.params.stopId]
  );
  const stop = stopResult.rows[0];
  if (!stop) return res.status(404).json({ error: "التوقف غير موجود." });

  const tripResult = await query("SELECT * FROM trips WHERE id = $1", [stop.trip_id]);
  const trip = tripResult.rows[0];
  if (!canOperateTrip(req.user, trip)) return res.status(403).json({ error: "غير مصرح." });

  const itemsResult = await query(
    `SELECT oi.*, p.coupon_eligible, p.grants_coupons
     FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id
     WHERE oi.order_id = $1`,
    [stop.order_id]
  );
  const items = itemsResult.rows;

  const paymentMap = {};
  (item_payments || []).forEach((p) => { paymentMap[p.item_id] = Number(p.coupon_qty) || 0; });

  let totalCouponsUsed = 0;
  let cashCollected = 0;
  let couponsGranted = 0;

  for (const item of items) {
    let couponQty = paymentMap[item.id] || 0;
    if (!item.coupon_eligible) couponQty = 0;
    couponQty = Math.min(couponQty, item.quantity);

    totalCouponsUsed += couponQty;
    cashCollected += (item.quantity - couponQty) * Number(item.unit_price_snapshot);

    await query("UPDATE order_items SET coupon_quantity = $1 WHERE id = $2", [couponQty, item.id]);

    if (item.grants_coupons) {
      couponsGranted += item.grants_coupons * item.quantity;
    }
  }

  if (totalCouponsUsed > stop.coupon_balance) {
    return res.status(400).json({ error: `رصيد الكوبونات غير كافي — المتبقي للعميل فقط ${stop.coupon_balance} كوبون.` });
  }

  let newBalance = stop.coupon_balance;

  if (totalCouponsUsed > 0) {
    newBalance -= totalCouponsUsed;
    await query(
      `INSERT INTO coupon_ledger (customer_id, change_amount, reason, order_id, balance_after, created_by)
       VALUES ($1, $2, 'order_payment', $3, $4, $5)`,
      [stop.customer_id, -totalCouponsUsed, stop.order_id, newBalance, req.user.id]
    );
  }

  if (couponsGranted > 0) {
    newBalance += couponsGranted;
    await query(
      `INSERT INTO coupon_ledger (customer_id, change_amount, reason, order_id, balance_after, created_by)
       VALUES ($1, $2, 'recharge', $3, $4, $5)`,
      [stop.customer_id, couponsGranted, stop.order_id, newBalance, req.user.id]
    );
  }

  if (totalCouponsUsed > 0 || couponsGranted > 0) {
    await query("UPDATE customers SET coupon_balance = $1 WHERE id = $2", [newBalance, stop.customer_id]);
  }

  await query(
    "UPDATE trip_stops SET delivered_at = now(), cash_collected = $1, coupons_collected = $2 WHERE id = $3",
    [cashCollected, totalCouponsUsed, stop.id]
  );
  await query("UPDATE orders SET status = 'DELIVERED', updated_at = now() WHERE id = $1", [stop.order_id]);

  await logActivity({ userId: req.user.id, action: "DELIVER_ORDER", recordType: "order", recordId: stop.order_id });

  const countResult = await query(
    `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE delivered_at IS NOT NULL)::int AS delivered
     FROM trip_stops WHERE trip_id = $1`,
    [trip.id]
  );
  await insertNotification({
    type: "DELIVERY",
    message: `✅ ${trip.driver_name || "السائق"} سلّم طلب ${stop.customer_name} — ${countResult.rows[0].delivered}/${countResult.rows[0].total}`,
    customerId: null,
    tripId: trip.id,
  });

  if (totalCouponsUsed > 0) {
    await insertNotification({
      type: "COUPON",
      message: `🎫 خصم ${totalCouponsUsed} كوبون من ${stop.customer_name} — الرصيد المتبقي: ${newBalance}`,
      customerId: stop.customer_id,
      tripId: trip.id,
    });
  }
  if (couponsGranted > 0) {
    await insertNotification({
      type: "COUPON",
      message: `🎫 تعبئة ${couponsGranted} كوبون لـ${stop.customer_name} — الرصيد الجديد: ${newBalance}`,
      customerId: stop.customer_id,
      tripId: trip.id,
    });
  }

  res.json({ message: "تم تسجيل التسليم.", cash_collected: cashCollected, coupons_used: totalCouponsUsed, coupons_granted: couponsGranted });
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

  await query("UPDATE trip_stops SET sequence_number = $1 WHERE id = $2", [newSeq, stop.id]);

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

async function cheapestInsert(trip, newOrder) {
  const remainingResult = await query(
    `SELECT ts.id, ts.sequence_number, l.latitude, l.longitude
     FROM trip_stops ts
     JOIN orders o ON o.id = ts.order_id
     JOIN customers c ON c.id = o.customer_id
     LEFT JOIN customer_locations l ON l.customer_id = c.id
     WHERE ts.trip_id = $1 AND ts.delivered_at IS NULL AND o.status NOT IN ('FAILED','CANCELLED')
     ORDER BY ts.sequence_number ASC`,
    [trip.id]
  );
  const remaining = remainingResult.rows;

  let insertAfterSeq;
  let newLegDistance = null;
  let nextStopIdToUpdate = null;
  let extraDistance = 0;

  if (remaining.length === 0 || newOrder.latitude == null || newOrder.longitude == null) {
    const maxSeqResult = await query("SELECT COALESCE(MAX(sequence_number), 0) AS max_seq FROM trip_stops WHERE trip_id = $1", [trip.id]);
    insertAfterSeq = maxSeqResult.rows[0].max_seq;
    const last = remaining[remaining.length - 1];
    if (last && last.latitude != null && newOrder.latitude != null) {
      newLegDistance = distanceKm(last.latitude, last.longitude, newOrder.latitude, newOrder.longitude);
      extraDistance = newLegDistance;
    }
  } else {
    let bestCost = Infinity;
    insertAfterSeq = remaining[remaining.length - 1].sequence_number;

    for (let i = 0; i < remaining.length; i++) {
      const prev = i === 0
        ? { latitude: trip.current_latitude ?? remaining[0].latitude, longitude: trip.current_longitude ?? remaining[0].longitude }
        : remaining[i - 1];
      const curr = remaining[i];
      if (prev.latitude == null || curr.latitude == null) continue;

      const cost =
        distanceKm(prev.latitude, prev.longitude, newOrder.latitude, newOrder.longitude) +
        distanceKm(newOrder.latitude, newOrder.longitude, curr.latitude, curr.longitude) -
        distanceKm(prev.latitude, prev.longitude, curr.latitude, curr.longitude);

      if (cost < bestCost) {
        bestCost = cost;
        insertAfterSeq = i === 0 ? curr.sequence_number - 1 : remaining[i - 1].sequence_number;
        newLegDistance = distanceKm(prev.latitude, prev.longitude, newOrder.latitude, newOrder.longitude);
        nextStopIdToUpdate = curr.id;
        extraDistance = cost;
      }
    }

    const last = remaining[remaining.length - 1];
    if (last.latitude != null) {
      const costAtEnd = distanceKm(last.latitude, last.longitude, newOrder.latitude, newOrder.longitude);
      if (costAtEnd < bestCost) {
        bestCost = costAtEnd;
        insertAfterSeq = last.sequence_number;
        newLegDistance = costAtEnd;
        nextStopIdToUpdate = null;
        extraDistance = costAtEnd;
      }
    }
  }

  await query("UPDATE trip_stops SET sequence_number = sequence_number + 1 WHERE trip_id = $1 AND sequence_number > $2", [trip.id, insertAfterSeq]);
  await query(
    "INSERT INTO trip_stops (trip_id, order_id, sequence_number, leg_distance_km) VALUES ($1, $2, $3, $4)",
    [trip.id, newOrder.id, insertAfterSeq + 1, newLegDistance]
  );
  await query("UPDATE orders SET status = 'IN_ROUTE', updated_at = now() WHERE id = $1", [newOrder.id]);

  if (nextStopIdToUpdate && newOrder.latitude != null) {
    const nextStopLoc = await query(
      `SELECT l.latitude, l.longitude FROM trip_stops ts
       JOIN orders o ON o.id = ts.order_id JOIN customers c ON c.id = o.customer_id
       LEFT JOIN customer_locations l ON l.customer_id = c.id WHERE ts.id = $1`,
      [nextStopIdToUpdate]
    );
    const nextLoc = nextStopLoc.rows[0];
    if (nextLoc && nextLoc.latitude != null) {
      const updatedLeg = distanceKm(newOrder.latitude, newOrder.longitude, nextLoc.latitude, nextLoc.longitude);
      await query("UPDATE trip_stops SET leg_distance_km = $1 WHERE id = $2", [updatedLeg, nextStopIdToUpdate]);
    }
  }

  if (extraDistance > 0) {
    await query("UPDATE trips SET total_distance_km = COALESCE(total_distance_km, 0) + $1 WHERE id = $2", [extraDistance, trip.id]);
  }
}

router.post("/:id/add-order", async (req, res) => {
  const { order_id } = req.body;
  if (!order_id) return res.status(400).json({ error: "رقم الطلب مطلوب." });

  const tripResult = await query("SELECT * FROM trips WHERE id = $1", [req.params.id]);
  const trip = tripResult.rows[0];
  if (!trip) return res.status(404).json({ error: "الرحلة غير موجودة." });
  if (!canOperateTrip(req.user, trip)) return res.status(403).json({ error: "غير مصرح." });
  if (trip.status !== "STARTED") return res.status(400).json({ error: "الرحلة ليست جارية حاليًا." });

  const orderResult = await query(
    `SELECT o.id, o.status, l.latitude, l.longitude
     FROM orders o
     JOIN customers c ON c.id = o.customer_id
     LEFT JOIN customer_locations l ON l.customer_id = c.id
     WHERE o.id = $1`,
    [order_id]
  );
  const newOrder = orderResult.rows[0];
  if (!newOrder || !["NEW", "READY"].includes(newOrder.status)) {
    return res.status(400).json({ error: "هذا الطلب غير صالح للإضافة لرحلة جارية." });
  }

  await cheapestInsert(trip, newOrder);

  await logActivity({
    userId: req.user.id,
    action: "ADD_ORDER_TO_TRIP",
    recordType: "trip",
    recordId: trip.id,
    newValue: { order_id: newOrder.id },
  });

  res.json({ message: "تمت إضافة الطلب للرحلة بأفضل موضع ممكن." });
});

export async function tryAutoAddToActiveTrip(orderId) {
  const activeResult = await query(`SELECT * FROM trips WHERE status = 'STARTED'`);
  if (activeResult.rows.length !== 1) return false;
  const trip = activeResult.rows[0];

  const orderResult = await query(
    `SELECT o.id, o.status, l.latitude, l.longitude
     FROM orders o
     JOIN customers c ON c.id = o.customer_id
     LEFT JOIN customer_locations l ON l.customer_id = c.id
     WHERE o.id = $1`,
    [orderId]
  );
  const order = orderResult.rows[0];
  if (!order || order.status !== "NEW") return false;

  await cheapestInsert(trip, order);
  await logActivity({ userId: null, action: "AUTO_ADD_ORDER_TO_TRIP", recordType: "trip", recordId: trip.id, newValue: { order_id: orderId } });
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
