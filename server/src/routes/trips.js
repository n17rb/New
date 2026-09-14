import { Router } from "express";
import { pool, query, logActivity } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

router.use((req, res, next) => {
  if (req.user.role === "data_entry") {
    return res.status(403).json({ error: "ليست لديك صلاحية الوصول لهذا القسم." });
  }
  next();
});

function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function buildRoute(startLat, startLon, stops) {
  const withLocation = stops.filter((s) => s.latitude != null && s.longitude != null);
  const withoutLocation = stops.filter((s) => s.latitude == null || s.longitude == null);

  const remaining = [...withLocation];
  const ordered = [];
  let current = { lat: startLat, lon: startLon };
  let totalDistance = 0;

  while (remaining.length) {
    let bestIdx = 0;
    let bestScore = Infinity;
    let bestRealDistance = 0;

    remaining.forEach((s, idx) => {
      const realDistance = distanceKm(current.lat, current.lon, s.latitude, s.longitude);
      const score = s.priority === "urgent" ? realDistance * 0.7 : realDistance;
      if (score < bestScore) {
        bestScore = score;
        bestIdx = idx;
        bestRealDistance = realDistance;
      }
    });

    const [next] = remaining.splice(bestIdx, 1);
    ordered.push(next);
    totalDistance += bestRealDistance;
    current = { lat: next.latitude, lon: next.longitude };
  }

  return { ordered: [...ordered, ...withoutLocation], totalDistance };
}

async function getAverageStopMinutes() {
  const result = await query(`
    SELECT AVG(diff_seconds) AS avg_seconds FROM (
      SELECT EXTRACT(EPOCH FROM (delivered_at - LAG(delivered_at) OVER (PARTITION BY trip_id ORDER BY sequence_number))) AS diff_seconds
      FROM trip_stops WHERE delivered_at IS NOT NULL
    ) t WHERE diff_seconds IS NOT NULL AND diff_seconds > 0 AND diff_seconds < 3600
  `);
  const avgSeconds = result.rows[0]?.avg_seconds;
  return avgSeconds ? Number(avgSeconds) / 60 : 8;
}

router.get("/active", async (req, res) => {
  const tripResult = await query(
    `SELECT * FROM trips WHERE status IN ('PLANNED','STARTED') ORDER BY created_at DESC LIMIT 1`
  );
  const trip = tripResult.rows[0];
  if (!trip) return res.json(null);

  const stopsResult = await query(
    `SELECT ts.*, o.order_number, o.status AS order_status, o.priority, o.final_total, o.notes AS order_notes,
            c.id AS customer_id, c.name AS customer_name, c.phone_normalized, c.phone_display,
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

  const remainingCount = stopsResult.rows.filter(
    (s) => !s.delivered_at && s.order_status !== "FAILED" && s.order_status !== "CANCELLED"
  ).length;
  const avgStopMinutes = await getAverageStopMinutes();
  const estimatedMinutesRemaining = Math.round(remainingCount * avgStopMinutes);

  res.json({ ...trip, stops: stopsResult.rows, estimated_minutes_remaining: estimatedMinutesRemaining });
});

router.post("/:id/location", async (req, res) => {
  const { latitude, longitude } = req.body;
  if (latitude == null || longitude == null) {
    return res.status(400).json({ error: "الإحداثيات مطلوبة." });
  }
  const result = await query(
    `UPDATE trips SET current_latitude = $1, current_longitude = $2, location_updated_at = now()
     WHERE id = $3 RETURNING id`,
    [latitude, longitude, req.params.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: "الرحلة غير موجودة." });
  res.json({ ok: true });
});

router.post("/", async (req, res) => {
  const { order_ids, start_latitude, start_longitude } = req.body;

  if (!Array.isArray(order_ids) || order_ids.length === 0) {
    return res.status(400).json({ error: "الرجاء اختيار طلب واحد على الأقل." });
  }

  const existingActive = await query(`SELECT id FROM trips WHERE status IN ('PLANNED','STARTED')`);
  if (existingActive.rows[0]) {
    return res.status(400).json({ error: "يوجد رحلة نشطة بالفعل. أنهِ الرحلة الحالية أولًا." });
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

    const startLat = start_latitude ?? null;
    const startLon = start_longitude ?? null;

    let ordered, totalDistance;
    if (startLat != null && startLon != null) {
      const result = buildRoute(startLat, startLon, ordersResult.rows);
      ordered = result.ordered;
      totalDistance = result.totalDistance;
    } else {
      ordered = [...ordersResult.rows].sort((a, b) => (a.priority === "urgent" ? -1 : 1));
      totalDistance = null;
    }

    const tripResult = await client.query(
      `INSERT INTO trips (status, driver_id, start_latitude, start_longitude, total_distance_km, created_by)
       VALUES ('PLANNED', $1, $2, $3, $4, $5) RETURNING *`,
      [req.user.role === "driver" ? req.user.id : null, startLat, startLon, totalDistance, req.user.id]
    );
    const trip = tripResult.rows[0];

    for (let i = 0; i < ordered.length; i++) {
      await client.query(
        `INSERT INTO trip_stops (trip_id, order_id, sequence_number) VALUES ($1, $2, $3)`,
        [trip.id, ordered[i].id, i + 1]
      );
      await client.query(`UPDATE orders SET status = 'IN_ROUTE', updated_at = now() WHERE id = $1`, [ordered[i].id]);
    }

    await client.query("COMMIT");

    await logActivity({
      userId: req.user.id,
      action: "CREATE_TRIP",
      recordType: "trip",
      recordId: trip.id,
      newValue: { stops: ordered.length, total_distance_km: totalDistance },
    });

    res.status(201).json({ ...trip, stopsCount: ordered.length });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(400).json({ error: err.message || "تعذّر إنشاء الرحلة." });
  } finally {
    client.release();
  }
});

router.post("/:id/start", async (req, res) => {
  const result = await query(
    `UPDATE trips SET status = 'STARTED', started_at = now() WHERE id = $1 AND status = 'PLANNED' RETURNING *`,
    [req.params.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: "الرحلة غير موجودة أو بدأت مسبقًا." });
  res.json(result.rows[0]);
});

router.post("/stops/:stopId/deliver", async (req, res) => {
  const stopResult = await query("SELECT * FROM trip_stops WHERE id = $1", [req.params.stopId]);
  const stop = stopResult.rows[0];
  if (!stop) return res.status(404).json({ error: "التوقف غير موجود." });

  await query("UPDATE trip_stops SET delivered_at = now() WHERE id = $1", [stop.id]);
  await query("UPDATE orders SET status = 'DELIVERED', updated_at = now() WHERE id = $1", [stop.order_id]);

  await logActivity({
    userId: req.user.id,
    action: "DELIVER_ORDER",
    recordType: "order",
    recordId: stop.order_id,
  });

  res.json({ message: "تم تسجيل التسليم." });
});

router.post("/stops/:stopId/fail", async (req, res) => {
  const { reason } = req.body;
  const stopResult = await query("SELECT * FROM trip_stops WHERE id = $1", [req.params.stopId]);
  const stop = stopResult.rows[0];
  if (!stop) return res.status(404).json({ error: "التوقف غير موجود." });

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

router.post("/:id/complete", async (req, res) => {
  const tripResult = await query("SELECT * FROM trips WHERE id = $1", [req.params.id]);
  const trip = tripResult.rows[0];
  if (!trip) return res.status(404).json({ error: "الرحلة غير موجودة." });

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
    await query(
      `UPDATE orders SET status = 'NEW', updated_at = now() WHERE id = ANY($1::int[])`,
      [remaining.map((r) => r.order_id)]
    );
  }

  await query(`UPDATE trips SET status = 'COMPLETED', completed_at = now() WHERE id = $1`, [trip.id]);

  const totalValue = delivered.reduce((sum, s) => sum + Number(s.final_total), 0);

  if (trip.driver_id && delivered.length > 0) {
    await query(
      `INSERT INTO driver_ledger (driver_id, trip_id, entry_type, amount, created_by)
       VALUES ($1, $2, 'trip_due', $3, $4)`,
      [trip.driver_id, trip.id, totalValue, req.user.id]
    );
  }

  res.json({
    trip_id: trip.id,
    total_stops: stops.length,
    delivered: delivered.length,
    failed: failed.length,
    returned_to_queue: remaining.length,
    total_delivered_value: totalValue,
    products_summary: itemsSummaryResult.rows,
  });
});

export default router;
