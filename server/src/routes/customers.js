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

router.post("/fix-locations", requireCanManageCustomers, async (req, res) => {
  const brokenResult = await query(
    `SELECT cl.id, cl.customer_id, cl.maps_url
     FROM customer_locations cl
     WHERE cl.maps_url IS NOT NULL AND (cl.latitude IS NULL OR cl.longitude IS NULL)`
  );

  let fixed = 0;
  const stillBroken = [];

  for (const row of brokenResult.rows) {
    let parsed = tryParseCoordsFromLink(row.maps_url);

    if (!parsed) {
      try {
        const response = await fetch(row.maps_url, {
          method: "GET",
          redirect: "follow",
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          },
        });
        parsed = tryParseCoordsFromLink(response.url);
      } catch {
        // تجاهل — يبقى بقائمة الفاشلين
      }
    }

    if (parsed) {
      await query(
        "UPDATE customer_locations SET latitude = $1, longitude = $2, updated_at = now() WHERE id = $3",
        [parsed.lat, parsed.lng, row.id]
      );
      fixed++;
    } else {
      stillBroken.push(row.customer_id);
    }
  }

  res.json({
    message: `تم إصلاح ${fixed} من أصل ${brokenResult.rows.length}.`,
    fixed_count: fixed,
    still_broken_customer_ids: stillBroken,
  });
});

router.post("/", requireCanManageCustomers, async (req, res) => {
  const { name, phone, phone_alt, notes, sequential_number } = req.body;

  if (!name || !phone) {
    return res.status(400).json({ error: "الاسم ورقم الهاتف مطلوبان." });
  }

  const normalized = normalizePhone(phone);
  const existingPhone = await query("SELECT * FROM customers WHERE phone_normalized = $1", [normalized]);
  if (existingPhone.rows[0]) {
    return res.status(200).json({
      alreadyExists: true,
      message: "رقم الهاتف موجود مسبقًا — تم عرض العميل الحالي بدل إنشاء عميل جديد.",
      customer: existingPhone.rows[0],
    });
  }

  let seqNumber = (sequential_number || "").trim();
  if (seqNumber) {
    const existingSeq = await query("SELECT id FROM customers WHERE sequential_number = $1", [seqNumber]);
    if (existingSeq.rows[0]) {
      return res.status(400).json({ error: `الرقم التسلسلي "${seqNumber}" مستخدم لعميل آخر مسبقًا.` });
    }
  } else {
    seqNumber = await nextAutoSequentialNumber();
  }

  const inserted = await query(
    `INSERT INTO customers (sequential_number, name, phone_normalized, phone_display, phone_alt, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [seqNumber, name.trim(), normalized, formatPhoneForDisplay(normalized), phone_alt || null, notes || null, req.user.id]
  );
  const customer = inserted.rows[0];

  await query(`INSERT INTO customer_locations (customer_id) VALUES ($1)`, [customer.id]);

  await logActivity({
    userId: req.user.id,
    action: "CREATE_CUSTOMER",
    recordType: "customer",
    recordId: customer.id,
    newValue: { name: customer.name, phone: customer.phone_display, sequential_number: seqNumber },
  });

  res.status(201).json({ alreadyExists: false, customer });
});

router.put("/:id", requireCanManageCustomers, async (req, res) => {
  const { id } = req.params;
  const before = await query("SELECT * FROM customers WHERE id = $1", [id]);
  if (!before.rows[0]) return res.status(404).json({ error: "العميل غير موجود." });

  const {
    name, phone, sequential_number, notes,
    region_id, street, building_number, building_name,
    floor, apartment, side, access_notes,
    latitude, longitude, maps_url, preferred_delivery_note,
  } = req.body;

  let phoneNormalized = before.rows[0].phone_normalized;
  let phoneDisplay = before.rows[0].phone_display;

  if (phone) {
    const newNormalized = normalizePhone(phone);
    if (newNormalized !== before.rows[0].phone_normalized) {
      const dup = await query(
        "SELECT id FROM customers WHERE phone_normalized = $1 AND id != $2",
        [newNormalized, id]
      );
      if (dup.rows[0]) {
        return res.status(400).json({ error: "رقم الهاتف هذا مستخدم لعميل آخر مسبقًا." });
      }
      phoneNormalized = newNormalized;
      phoneDisplay = formatPhoneForDisplay(newNormalized);
    }
  }

  if (sequential_number && sequential_number.trim() !== before.rows[0].sequential_number) {
    const dupSeq = await query(
      "SELECT id FROM customers WHERE sequential_number = $1 AND id != $2",
      [sequential_number.trim(), id]
    );
    if (dupSeq.rows[0]) {
      return res.status(400).json({ error: `الرقم التسلسلي "${sequential_number}" مستخدم لعميل آخر مسبقًا.` });
    }
  }

  const updated = await query(
    `UPDATE customers SET
       name = COALESCE($1, name),
       phone_normalized = $2,
       phone_display = $3,
       sequential_number = COALESCE(NULLIF($4, ''), sequential_number),
       notes = COALESCE($5, notes),
       updated_at = now()
     WHERE id = $6 RETURNING *`,
    [name, phoneNormalized, phoneDisplay, sequential_number, notes, id]
  );

  await query(
    `UPDATE customer_locations SET
      region_id = COALESCE($1, region_id),
      street = COALESCE($2, street),
      building_number = COALESCE($3, building_number),
      building_name = COALESCE($4, building_name),
      floor = COALESCE($5, floor),
      apartment = COALESCE($6, apartment),
      side = COALESCE($7, side),
      access_notes = COALESCE($8, access_notes),
      latitude = COALESCE($9, latitude),
      longitude = COALESCE($10, longitude),
      maps_url = COALESCE($11, maps_url),
      preferred_delivery_note = COALESCE($13, preferred_delivery_note),
      updated_at = now()
     WHERE customer_id = $12`,
    [region_id, street, building_number, building_name, floor, apartment, side,
     access_notes, latitude, longitude, maps_url, id, preferred_delivery_note]
  );

  await logActivity({
    userId: req.user.id,
    action: "UPDATE_CUSTOMER",
    recordType: "customer",
    recordId: id,
    oldValue: before.rows[0],
    newValue: updated.rows[0],
  });

  res.json(updated.rows[0]);
});

router.delete("/:id", requireCanDeleteCustomer, async (req, res) => {
  const result = await query(
    "UPDATE customers SET status = 'archived', updated_at = now() WHERE id = $1 RETURNING *",
    [req.params.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: "العميل غير موجود." });

  await logActivity({
    userId: req.user.id,
    action: "ARCHIVE_CUSTOMER",
    recordType: "customer",
    recordId: req.params.id,
  });

  res.json({ message: "تم حذف العميل." });
});

router.post("/:id/photo", requireCanManageCustomers, uploadSingleImage, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "لم يتم إرفاق صورة." });

  const photoUrl = await saveCompressedImage(req.file.buffer, `customer-${req.params.id}`);

  await query(
    "UPDATE customer_locations SET building_photo_url = $1, updated_at = now() WHERE customer_id = $2",
    [photoUrl, req.params.id]
  );

  await logActivity({
    userId: req.user.id,
    action: "UPLOAD_CUSTOMER_PHOTO",
    recordType: "customer",
    recordId: req.params.id,
  });

  res.json({ photoUrl });
});

router.get("/:id/prices", async (req, res) => {
  const result = await query(
    `SELECT cpp.*, p.name AS product_name, p.unit_price AS default_price
     FROM customer_product_prices cpp JOIN products p ON p.id = cpp.product_id
     WHERE cpp.customer_id = $1 ORDER BY p.sort_order ASC`,
    [req.params.id]
  );
  res.json(result.rows);
});

router.post("/:id/prices", requireCanManageCustomers, async (req, res) => {
  const { product_id, custom_price } = req.body;
  if (!product_id || custom_price == null) {
    return res.status(400).json({ error: "المنتج والسعر الخاص مطلوبان." });
  }

  const result = await query(
    `INSERT INTO customer_product_prices (customer_id, product_id, custom_price)
     VALUES ($1, $2, $3)
     ON CONFLICT (customer_id, product_id) DO UPDATE SET custom_price = $3
     RETURNING *`,
    [req.params.id, product_id, custom_price]
  );

  await logActivity({
    userId: req.user.id,
    action: "SET_CUSTOMER_PRICE",
    recordType: "customer",
    recordId: req.params.id,
    newValue: { product_id, custom_price },
  });

  res.json(result.rows[0]);
});

router.delete("/:id/prices/:productId", requireCanManageCustomers, async (req, res) => {
  await query(
    "DELETE FROM customer_product_prices WHERE customer_id = $1 AND product_id = $2",
    [req.params.id, req.params.productId]
  );
  res.json({ message: "تم حذف السعر الخاص — رجع للسعر العام." });
});

router.post("/bulk-import", requireCanManageCustomers, async (req, res) => {
  const { rows } = req.body;
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: "لا يوجد بيانات للاستيراد." });
  }

  let imported = 0;
  let skipped = 0;
  const errors = [];

  for (const row of rows) {
    const name = (row.name || "").trim();
    const phone = (row.phone || "").trim();
    if (!name || !phone) {
      skipped++;
      continue;
    }

    try {
      const normalized = normalizePhone(phone);
      const existing = await query("SELECT id FROM customers WHERE phone_normalized = $1", [normalized]);
      if (existing.rows[0]) {
        skipped++;
        continue;
      }

      const seqNumber = await nextAutoSequentialNumber();
      const inserted = await query(
        `INSERT INTO customers (sequential_number, name, phone_normalized, phone_display, created_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [seqNumber, name, normalized, formatPhoneForDisplay(normalized), req.user.id]
      );
      await query(`INSERT INTO customer_locations (customer_id) VALUES ($1)`, [inserted.rows[0].id]);
      imported++;
    } catch (err) {
      errors.push(`${name}: ${err.message}`);
      skipped++;
    }
  }

  await logActivity({
    userId: req.user.id,
    action: "BULK_IMPORT_CUSTOMERS",
    recordType: "customer",
    recordId: null,
    newValue: { imported, skipped },
  });

  res.json({ imported, skipped, errors: errors.slice(0, 10) });
});

export default router;
