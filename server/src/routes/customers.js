import { Router } from "express";
import { query, logActivity } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { normalizePhone, formatPhoneForDisplay } from "../utils/phone.js";
import { uploadSingleImage, saveCompressedImage } from "../middleware/upload.js";

const router = Router();
router.use(requireAuth);

function canManageCustomers(user) {
  return ["super_admin", "admin", "data_entry", "driver"].includes(user.role);
}

function canDeleteCustomer(user) {
  return user.role === "super_admin" || user.role === "admin" || user.can_delete_customer;
}

function requireCanManageCustomers(req, res, next) {
  if (!canManageCustomers(req.user)) {
    return res.status(403).json({ error: "ليست لديك صلاحية إضافة أو تعديل بيانات العملاء." });
  }
  next();
}

function requireCanDeleteCustomer(req, res, next) {
  if (!canDeleteCustomer(req.user)) {
    return res.status(403).json({ error: "ليست لديك صلاحية حذف العملاء." });
  }
  next();
}

async function nextAutoSequentialNumber() {
  const result = await query("SELECT nextval('customer_seq') AS n");
  return String(result.rows[0].n).padStart(6, "0");
}

router.get("/", async (req, res) => {
  const q = (req.query.q || "").trim();
  const regionId = req.query.region_id;

  if (!q && !regionId) {
    const result = await query(
      `SELECT c.*, l.region_id, l.maps_url, l.latitude, l.longitude, r.name AS region_name
       FROM customers c
       LEFT JOIN customer_locations l ON l.customer_id = c.id
       LEFT JOIN regions r ON r.id = l.region_id
       WHERE c.status = 'active'
       ORDER BY c.created_at DESC
       LIMIT 50`
    );
    return res.json(result.rows);
  }

  const conditions = ["c.status = 'active'"];
  const params = [];

  if (q) {
    params.push(q);
    conditions.push(`(c.phone_display LIKE $${params.length} || '%' OR c.sequential_number = $${params.length} OR c.name ILIKE '%' || $${params.length} || '%')`);
  }
  if (regionId) {
    params.push(regionId);
    conditions.push(`l.region_id = $${params.length}`);
  }

  const result = await query(
    `SELECT c.*, l.region_id, l.maps_url, l.latitude, l.longitude, r.name AS region_name
     FROM customers c
     LEFT JOIN customer_locations l ON l.customer_id = c.id
     LEFT JOIN regions r ON r.id = l.region_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY c.created_at DESC
     LIMIT 50`,
    params
  );
  res.json(result.rows);
});

router.get("/all-locations", async (req, res) => {
  const result = await query(
    `SELECT c.id, c.name, l.latitude, l.longitude, r.name AS region_name
     FROM customers c
     JOIN customer_locations l ON l.customer_id = c.id
     LEFT JOIN regions r ON r.id = l.region_id
     WHERE c.status = 'active' AND l.latitude IS NOT NULL AND l.longitude IS NOT NULL`
  );
  res.json(result.rows);
});

router.get("/overdue", async (req, res) => {
  const result = await query(`
    WITH stats AS (
      SELECT customer_id,
             AVG(diff_days) AS avg_days,
             MAX(created_at) AS last_order_at,
             COUNT(*) AS delivered_count
      FROM (
        SELECT customer_id, created_at,
               EXTRACT(EPOCH FROM (created_at - LAG(created_at) OVER (PARTITION BY customer_id ORDER BY created_at))) / 86400 AS diff_days
        FROM orders WHERE status = 'DELIVERED'
      ) t
      WHERE diff_days IS NULL OR diff_days > 0
      GROUP BY customer_id
      HAVING COUNT(*) >= 3
    )
    SELECT c.id, c.name, c.phone_display, c.sequential_number,
           s.avg_days, s.last_order_at,
           EXTRACT(EPOCH FROM (now() - s.last_order_at)) / 86400 AS days_since_last_order
    FROM stats s
    JOIN customers c ON c.id = s.customer_id
    WHERE c.status = 'active'
      AND EXTRACT(EPOCH FROM (now() - s.last_order_at)) / 86400 > s.avg_days
    ORDER BY (EXTRACT(EPOCH FROM (now() - s.last_order_at)) / 86400 - s.avg_days) DESC
    LIMIT 100
  `);
  res.json(result.rows.map((r) => ({
    ...r,
    avg_days: Number(r.avg_days),
    days_since_last_order: Math.floor(Number(r.days_since_last_order)),
  })));
});

router.get("/:id", async (req, res) => {
  const result = await query(
    `SELECT c.*,
            l.latitude, l.longitude, l.maps_url, l.region_id,
            l.street, l.building_number, l.building_name, l.floor,
            l.apartment, l.side, l.access_notes, l.building_photo_url, l.preferred_delivery_note
     FROM customers c
     LEFT JOIN customer_locations l ON l.customer_id = c.id
     WHERE c.id = $1`,
    [req.params.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: "العميل غير موجود." });
  res.json(result.rows[0]);
});

router.get("/:id/history", async (req, res) => {
  const customerId = req.params.id;

  const ordersResult = await query(
    `SELECT id, order_number, status, final_total, created_at
     FROM orders WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 100`,
    [customerId]
  );

  const itemsResult = await query(
    `SELECT o.id AS order_id, oi.product_name_snapshot, oi.quantity
     FROM order_items oi JOIN orders o ON o.id = oi.order_id
     WHERE o.customer_id = $1
     ORDER BY o.created_at DESC`,
    [customerId]
  );

  const itemsByOrder = {};
  for (const row of itemsResult.rows) {
    if (!itemsByOrder[row.order_id]) itemsByOrder[row.order_id] = [];
    itemsByOrder[row.order_id].push({ product_name_snapshot: row.product_name_snapshot, quantity: row.quantity });
  }

  const orders = ordersResult.rows.map((o) => ({ ...o, items: itemsByOrder[o.id] || [] }));

  const avgDaysResult = await query(
    `SELECT AVG(diff_days) AS avg_days FROM (
       SELECT EXTRACT(EPOCH FROM (created_at - LAG(created_at) OVER (ORDER BY created_at))) / 86400 AS diff_days
       FROM orders WHERE customer_id = $1 AND status = 'DELIVERED'
     ) t WHERE diff_days IS NOT NULL AND diff_days > 0`,
    [customerId]
  );
  const avgDaysBetweenOrders = avgDaysResult.rows[0].avg_days ? Number(avgDaysResult.rows[0].avg_days) : null;

  const productStatsResult = await query(
    `SELECT oi.product_name_snapshot, COUNT(DISTINCT o.id)::int AS order_count,
            SUM(oi.quantity)::int AS total_quantity,
            ROUND(AVG(oi.quantity), 1)::float AS avg_quantity_per_order
     FROM order_items oi JOIN orders o ON o.id = oi.order_id
     WHERE o.customer_id = $1 AND o.status = 'DELIVERED'
     GROUP BY oi.product_name_snapshot
     ORDER BY total_quantity DESC`,
    [customerId]
  );

  res.json({
    orders,
    total_orders: orders.length,
    last_order_at: orders[0]?.created_at || null,
    avg_days_between_orders: avgDaysBetweenOrders,
    product_stats: productStatsResult.rows,
  });
});

function tryParseCoordsFromLink(link) {
  if (!link) return null;
  const dPattern = link.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if (dPattern) return { lat: parseFloat(dPattern[1]), lng: parseFloat(dPattern[2]) };
  const commaPattern = link.match(/(-?\d+\.\d+),\s*(-?\d+\.\d+)/);
  if (commaPattern) return { lat: parseFloat(commaPattern[1]), lng: parseFloat(commaPattern[2]) };
  return null;
}

router.post("/fix-locations", requ
