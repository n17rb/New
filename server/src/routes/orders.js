import { Router } from "express";
import { pool, query, logActivity } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { can, canAction, canAny } from "../permissions.js";
import { tryAutoAddToActiveTrip, rescheduleOrder } from "./trips.js";
import { cleanSchedule } from "../utils/schedule.js";
import { computeFinalTotal, replaceOrderItems } from "../utils/orderEdit.js";
import { notifyNewOrder } from "../utils/notify.js";
import { invalidateForecastCache } from "../utils/forecast.js";

const router = Router();
router.use(requireAuth);
router.use((req, res, next) => (req.method === "GET" ? requireOrdersView(req, res, next) : requireOrdersEdit(req, res, next)));

// قراءة الطلبات: لقسم الطلبات أو للكابتن (بيختار طلبات لرحلته)
function requireOrdersView(req, res, next) {
  if (canAny(req.user, [["orders", "view"], ["delivery", "edit"], ["trips", "view"]])) return next();
  return res.status(403).json({ error: "ما عندك صلاحية لقسم الطلبات." });
}

// تغيير الطلبات بده «تعديل» على الطلبات.
// تحديد كمية الطلب مسموح كمان للكابتن (بيحددها عند الباب).
function requireOrdersEdit(req, res, next) {
  const isItemsUpdate = req.method === "PUT" && /\/items$/.test(req.path);
  if (can(req.user, "orders", "edit") || (isItemsUpdate && can(req.user, "delivery", "edit"))) return next();
  const message = can(req.user, "orders", "view") ? "صلاحيتك على الطلبات مشاهدة فقط." : "ما عندك صلاحية لقسم الطلبات.";
  return res.status(403).json({ error: message });
}

async function nextOrderNumber(client) {
  const result = await client.query("SELECT nextval('order_seq') AS n");
  return String(result.rows[0].n).padStart(6, "0");
}


router.get("/", async (req, res) => {
  const { status, priority, customer_id, limit, from, to, q } = req.query;
  const conditions = [];
  const params = [];
  const isDate = (d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);

  // فلترة بالتاريخ (بتوقيت الأردن): from/to = YYYY-MM-DD
  if (isDate(from)) {
    params.push(from);
    conditions.push(`(o.created_at AT TIME ZONE 'Asia/Amman')::date >= $${params.length}::date`);
  }
  if (isDate(to)) {
    params.push(to);
    conditions.push(`(o.created_at AT TIME ZONE 'Asia/Amman')::date <= $${params.length}::date`);
  }
  if (q && String(q).trim()) {
    params.push(String(q).trim());
    conditions.push(`(c.name ILIKE '%' || $${params.length} || '%' OR o.order_number LIKE '%' || $${params.length} || '%' OR c.phone_display LIKE '%' || $${params.length} || '%')`);
  }

  if (status) {
    params.push(status);
    conditions.push(`o.status = $${params.length}`);
  }
  // scheduled=future: طلبات لأيام جاية — scheduled=now: الطلبات الجاهزة لليوم (بدون اللي موعدها بأيام جاية)
  if (req.query.scheduled === "future") {
    conditions.push(`o.scheduled_date > (now() AT TIME ZONE 'Asia/Amman')::date`);
  } else if (req.query.scheduled === "now") {
    conditions.push(`(o.scheduled_date IS NULL OR o.scheduled_date <= (now() AT TIME ZONE 'Asia/Amman')::date)`);
  }
  if (priority) {
    params.push(priority);
    conditions.push(`o.priority = $${params.length}`);
  }
  if (customer_id) {
    params.push(customer_id);
    conditions.push(`o.customer_id = $${params.length}`);
  }

  const whereClause = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
  params.push(Math.min(Number(limit) || 100, 1000));

  const result = await query(
    `SELECT o.*, c.name AS customer_name, c.phone_display AS customer_phone, c.bottle_type
     FROM orders o
     JOIN customers c ON c.id = o.customer_id
     ${whereClause}
     ORDER BY o.created_at DESC
     LIMIT $${params.length}`,
    params
  );
  // with_items=true: مع محتوى كل طلب (لحساب حمولة السيارة)
  if (req.query.with_items === "true" && result.rows.length) {
    const items = await query(
      `SELECT order_id, product_id, product_name_snapshot, quantity FROM order_items WHERE order_id = ANY($1::int[])`,
      [result.rows.map((o) => o.id)]
    );
    const byOrder = {};
    for (const it of items.rows) (byOrder[it.order_id] ||= []).push(it);
    for (const o of result.rows) o.items = byOrder[o.id] || [];
  }
  res.json(result.rows);
});

router.get("/:id", async (req, res) => {
  const orderResult = await query(
    `SELECT o.*, c.name AS customer_name, c.phone_display AS customer_phone, c.phone_normalized AS customer_phone_normalized,
            c.bottle_type, c.coupon_balance, c.debt_balance,
            (SELECT t.driver_name FROM (SELECT u.full_name AS driver_name FROM trip_stops ts JOIN trips t2 ON t2.id = ts.trip_id
               LEFT JOIN users u ON u.id = t2.driver_id WHERE ts.order_id = o.id ORDER BY ts.id DESC LIMIT 1) t) AS driver_name
     FROM orders o JOIN customers c ON c.id = o.customer_id
     WHERE o.id = $1`,
    [req.params.id]
  );
  if (!orderResult.rows[0]) return res.status(404).json({ error: "الطلب غير موجود." });

  const itemsResult = await query("SELECT * FROM order_items WHERE order_id = $1 ORDER BY id ASC", [req.params.id]);
  res.json({ ...orderResult.rows[0], items: itemsResult.rows });
});

// مواعيد الطلبات: cleanSchedule بـ utils/schedule.js
export { cleanSchedule };

router.post("/", async (req, res) => {
  const { customer_id, items, priority, notes } = req.body;

  if (!customer_id || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "العميل والمنتجات مطلوبة (منتج واحد على الأقل)." });
  }
  let schedule;
  try {
    schedule = cleanSchedule(req.body);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const productIds = items.map((i) => i.product_id);
    const productsResult = await client.query(`SELECT * FROM products WHERE id = ANY($1::int[])`, [productIds]);
    const productsMap = Object.fromEntries(productsResult.rows.map((p) => [p.id, p]));

    const customPricesResult = await client.query(
      `SELECT product_id, custom_price FROM customer_product_prices WHERE customer_id = $1 AND product_id = ANY($2::int[])`,
      [customer_id, productIds]
    );
    const customPricesMap = Object.fromEntries(customPricesResult.rows.map((p) => [p.product_id, p.custom_price]));

    let subtotal = 0;
    const preparedItems = [];
    for (const item of items) {
      const product = productsMap[item.product_id];
      if (!product) throw new Error(`منتج غير موجود (ID: ${item.product_id}).`);
      const quantity = Number(item.quantity);
      if (!quantity || quantity <= 0) continue;

      const unitPrice = customPricesMap[item.product_id] != null ? Number(customPricesMap[item.product_id]) : Number(product.unit_price);
      const lineTotal = unitPrice * quantity;
      subtotal += lineTotal;
      preparedItems.push({
        product_id: product.id,
        product_name_snapshot: product.name,
        quantity,
        unit_price_snapshot: unitPrice,
        line_total: lineTotal,
      });
    }

    if (preparedItems.length === 0) throw new Error("لا يوجد أي منتج بكمية أكبر من صفر.");

    const orderNumber = await nextOrderNumber(client);
    const finalTotal = subtotal;

    const orderResult = await client.query(
      `INSERT INTO orders (order_number, customer_id, priority, subtotal, final_total, notes, requested_time, scheduled_date, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [orderNumber, customer_id, priority === "urgent" ? "urgent" : "normal", subtotal, finalTotal, notes || null,
       schedule.requested_time, schedule.scheduled_date, req.user.id]
    );
    const order = orderResult.rows[0];

    for (const item of preparedItems) {
      await client.query(
        `INSERT INTO order_items (order_id, product_id, product_name_snapshot, quantity, unit_price_snapshot, line_total)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [order.id, item.product_id, item.product_name_snapshot, item.quantity, item.unit_price_snapshot, item.line_total]
      );
    }

    await client.query("COMMIT");

    await logActivity({
      userId: req.user.id,
      action: "CREATE_ORDER",
      recordType: "order",
      recordId: order.id,
      newValue: { order_number: order.order_number, total: finalTotal, items: preparedItems },
    });

    invalidateForecastCache();
    res.status(201).json({ ...order, items: preparedItems });

    // لو انضاف تلقائيًا لرحلة شغّالة، إشعار الرحلة بيوصل لسائقها.
    // غير هيك، بيوصل إشعار «طلب جديد» لكل الكباتن والإدارة.
    tryAutoAddToActiveTrip(order.id, req.user.id)
      .catch(() => false)
      .then((addedToTrip) => {
        if (!addedToTrip) return notifyNewOrder({ orderId: order.id, actorId: req.user.id });
      })
      .catch((e) => console.error("notify error:", e.message));
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(400).json({ error: err.message || "تعذّر إنشاء الطلب." });
  } finally {
    client.release();
  }
});

router.put("/:id/items", async (req, res) => {
  try {
    res.json(await replaceOrderItems(req.params.id, req.body?.items, req.user.id));
  } catch (err) {
    res.status(400).json({ error: err.message || "تعذّر تعديل الطلب." });
  }
});


// تغيير موعد الطلب (أو إلغاء الموعد)
router.put("/:id/schedule", async (req, res) => {
  let schedule;
  try {
    schedule = cleanSchedule(req.body || {});
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  const r = await query(
    `UPDATE orders SET scheduled_date = $1, requested_time = $2, schedule_reminded_at = NULL, schedule_morning_at = NULL, updated_at = now()
     WHERE id = $3 AND status IN ('NEW','READY','POSTPONED','IN_ROUTE') RETURNING *`,
    [schedule.scheduled_date, schedule.requested_time, req.params.id]
  );
  if (!r.rows[0]) return res.status(400).json({ error: "ما بينفع تغيّر موعد هذا الطلب." });
  await logActivity({ userId: req.user.id, action: "SCHEDULE_ORDER", recordType: "order", recordId: Number(req.params.id), newValue: schedule });
  res.json(r.rows[0]);
});

router.put("/:id/priority", async (req, res) => {
  const { priority } = req.body;
  if (!["normal", "urgent"].includes(priority)) {
    return res.status(400).json({ error: "الأولوية يجب أن تكون normal أو urgent." });
  }
  const result = await query(
    "UPDATE orders SET priority = $1, updated_at = now() WHERE id = $2 RETURNING *",
    [priority, req.params.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: "الطلب غير موجود." });
  res.json(result.rows[0]);
});

router.put("/:id/discount", async (req, res) => {
  if (!canAction(req.user, "discount")) {
    return res.status(403).json({ error: "ليست لديك صلاحية إعطاء خصم." });
  }

  const { discount_type, discount_value, reason } = req.body;
  if (!["amount", "percent"].includes(discount_type)) {
    return res.status(400).json({ error: "نوع الخصم يجب أن يكون amount أو percent." });
  }

  const orderResult = await query("SELECT * FROM orders WHERE id = $1", [req.params.id]);
  const order = orderResult.rows[0];
  if (!order) return res.status(404).json({ error: "الطلب غير موجود." });

  const finalTotal = computeFinalTotal(order.subtotal, discount_type, discount_value);

  const updated = await query(
    `UPDATE orders SET discount_type = $1, discount_value = $2, discount_by = $3, discount_reason = $4,
       final_total = $5, updated_at = now()
     WHERE id = $6 RETURNING *`,
    [discount_type, discount_value, req.user.id, reason || null, finalTotal, req.params.id]
  );

  await logActivity({
    userId: req.user.id,
    action: "APPLY_DISCOUNT",
    recordType: "order",
    recordId: req.params.id,
    oldValue: { final_total: order.final_total },
    newValue: { discount_type, discount_value, final_total: finalTotal, reason },
  });

  res.json(updated.rows[0]);
});

router.post("/:id/cancel", async (req, res) => {
  if (!canAction(req.user, "cancel_order")) {
    return res.status(403).json({ error: "ليست لديك صلاحية إلغاء الطلبات." });
  }
  const { reason } = req.body;
  const result = await query(
    "UPDATE orders SET status = 'CANCELLED', cancelled_reason = $1, updated_at = now() WHERE id = $2 AND status <> 'DELIVERED' RETURNING *",
    [reason || null, req.params.id]
  );
  if (!result.rows[0]) return res.status(400).json({ error: "الطلب مش موجود أو تسلّم — ما بينلغى." });

  await logActivity({
    userId: req.user.id,
    action: "CANCEL_ORDER",
    recordType: "order",
    recordId: req.params.id,
    newValue: { reason },
  });

  res.json(result.rows[0]);
});

router.post("/:id/fail", async (req, res) => {
  const { reason } = req.body;
  const result = await query(
    "UPDATE orders SET status = 'FAILED', failed_reason = $1, updated_at = now() WHERE id = $2 RETURNING *",
    [reason || null, req.params.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: "الطلب غير موجود." });

  await logActivity({
    userId: req.user.id,
    action: "FAIL_DELIVERY",
    recordType: "order",
    recordId: req.params.id,
    newValue: { reason },
  });

  res.json(result.rows[0]);
});

// تأجيل الطلب ليوم/ساعة: بيرجع «جديد» بموعده الجديد، وبيطلع من أي رحلة شغّالة لو ما تسلّم.
// بيوم الموعد بيطلع لحاله بقائمة الطلبات الجاهزة للتوزيع.
router.post("/:id/postpone", async (req, res) => {
  const { reason } = req.body || {};
  let schedule;
  try {
    schedule = cleanSchedule({
      scheduled_date: req.body?.scheduled_date || null,
      requested_time: req.body?.requested_time || req.body?.postponed_to || null,
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  const order = await rescheduleOrder(req.params.id, { ...schedule, note: reason ? `تأجيل: ${reason}` : "تم التأجيل" });
  if (!order) return res.status(400).json({ error: "ما بينفع تأجّل هذا الطلب." });

  await logActivity({
    userId: req.user.id,
    action: "POSTPONE_ORDER",
    recordType: "order",
    recordId: req.params.id,
    newValue: { ...schedule, reason },
  });

  res.json(order);
});

router.post("/:id/reactivate", async (req, res) => {
  const result = await query(
    "UPDATE orders SET status = 'NEW', updated_at = now() WHERE id = $1 RETURNING *",
    [req.params.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: "الطلب غير موجود." });
  res.json(result.rows[0]);
});

export default router;
