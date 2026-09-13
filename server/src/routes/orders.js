import { Router } from "express";
import { pool, query, logActivity } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

function isPrivileged(user) {
  return user.role === "super_admin" || user.role === "admin";
}

router.use((req, res, next) => {
  if (req.user.role === "data_entry") {
    return res.status(403).json({ error: "ليست لديك صلاحية الوصول لهذا القسم." });
  }
  next();
});

async function nextOrderNumber(client) {
  const result = await client.query("SELECT nextval('order_seq') AS n");
  return String(result.rows[0].n).padStart(6, "0");
}

function computeFinalTotal(subtotal, discountType, discountValue) {
  const sub = Number(subtotal);
  const val = Number(discountValue) || 0;
  if (!discountType || val <= 0) return sub;
  if (discountType === "percent") return Math.max(0, sub - (sub * val) / 100);
  return Math.max(0, sub - val);
}

router.get("/", async (req, res) => {
  const { status, priority, customer_id, limit } = req.query;
  const conditions = [];
  const params = [];

  if (status) {
    params.push(status);
    conditions.push(`o.status = $${params.length}`);
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
  params.push(Number(limit) || 100);

  const result = await query(
    `SELECT o.*, c.name AS customer_name, c.phone_display AS customer_phone
     FROM orders o
     JOIN customers c ON c.id = o.customer_id
     ${whereClause}
     ORDER BY o.created_at DESC
     LIMIT $${params.length}`,
    params
  );
  res.json(result.rows);
});

router.get("/:id", async (req, res) => {
  const orderResult = await query(
    `SELECT o.*, c.name AS customer_name, c.phone_display AS customer_phone
     FROM orders o JOIN customers c ON c.id = o.customer_id
     WHERE o.id = $1`,
    [req.params.id]
  );
  if (!orderResult.rows[0]) return res.status(404).json({ error: "الطلب غير موجود." });

  const itemsResult = await query("SELECT * FROM order_items WHERE order_id = $1 ORDER BY id ASC", [req.params.id]);
  res.json({ ...orderResult.rows[0], items: itemsResult.rows });
});

router.post("/", async (req, res) => {
  const { customer_id, items, priority, notes } = req.body;

  if (!customer_id || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "العميل والمنتجات مطلوبة (منتج واحد على الأقل)." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const productIds = items.map((i) => i.product_id);
    const productsResult = await client.query(`SELECT * FROM products WHERE id = ANY($1::int[])`, [productIds]);
    const productsMap = Object.fromEntries(productsResult.rows.map((p) => [p.id, p]));

    let subtotal = 0;
    const preparedItems = [];
    for (const item of items) {
      const product = productsMap[item.product_id];
      if (!product) throw new Error(`منتج غير موجود (ID: ${item.product_id}).`);
      const quantity = Number(item.quantity);
      if (!quantity || quantity <= 0) continue;

      const lineTotal = Number(product.unit_price) * quantity;
      subtotal += lineTotal;
      preparedItems.push({
        product_id: product.id,
        product_name_snapshot: product.name,
        quantity,
        unit_price_snapshot: product.unit_price,
        line_total: lineTotal,
      });
    }

    if (preparedItems.length === 0) throw new Error("لا يوجد أي منتج بكمية أكبر من صفر.");

    const orderNumber = await nextOrderNumber(client);
    const finalTotal = subtotal;

    const orderResult = await client.query(
      `INSERT INTO orders (order_number, customer_id, priority, subtotal, final_total, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [orderNumber, customer_id, priority === "urgent" ? "urgent" : "normal", subtotal, finalTotal, notes || null, req.user.id]
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

    res.status(201).json({ ...order, items: preparedItems });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(400).json({ error: err.message || "تعذّر إنشاء الطلب." });
  } finally {
    client.release();
  }
});

router.put("/:id/items", async (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "يجب إرسال منتج واحد على الأقل." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const orderResult = await client.query("SELECT * FROM orders WHERE id = $1 FOR UPDATE", [req.params.id]);
    const order = orderResult.rows[0];
    if (!order) throw new Error("الطلب غير موجود.");
    if (["DELIVERED", "CANCELLED"].includes(order.status)) {
      throw new Error("لا يمكن تعديل طلب تم تسليمه أو إلغاؤه.");
    }

    const oldItemsResult = await client.query("SELECT * FROM order_items WHERE order_id = $1", [order.id]);
    const oldItems = oldItemsResult.rows;

    const productIds = items.map((i) => i.product_id);
    const productsResult = await client.query(`SELECT * FROM products WHERE id = ANY($1::int[])`, [productIds]);
    const productsMap = Object.fromEntries(productsResult.rows.map((p) => [p.id, p]));

    let subtotal = 0;
    const preparedItems = [];
    for (const item of items) {
      const product = productsMap[item.product_id];
      if (!product) throw new Error(`منتج غير موجود (ID: ${item.product_id}).`);
      const quantity = Number(item.quantity);
      if (!quantity || quantity <= 0) continue;
      const lineTotal = Number(product.unit_price) * quantity;
      subtotal += lineTotal;
      preparedItems.push({
        product_id: product.id,
        product_name_snapshot: product.name,
        quantity,
        unit_price_snapshot: product.unit_price,
        line_total: lineTotal,
      });
    }
    if (preparedItems.length === 0) throw new Error("لا يوجد أي منتج بكمية أكبر من صفر.");

    const finalTotal = computeFinalTotal(subtotal, order.discount_type, order.discount_value);

    await client.query("DELETE FROM order_items WHERE order_id = $1", [order.id]);
    for (const item of preparedItems) {
      await client.query(
        `INSERT INTO order_items (order_id, product_id, product_name_snapshot, quantity, unit_price_snapshot, line_total)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [order.id, item.product_id, item.product_name_snapshot, item.quantity, item.unit_price_snapshot, item.line_total]
      );
    }

    const updatedOrderResult = await client.query(
      `UPDATE orders SET subtotal = $1, final_total = $2, updated_at = now() WHERE id = $3 RETURNING *`,
      [subtotal, finalTotal, order.id]
    );

    await client.query(
      `INSERT INTO order_edit_history (order_id, edited_by, old_snapshot, new_snapshot, diff_summary)
       VALUES ($1,$2,$3,$4,$5)`,
      [
        order.id,
        req.user.id,
        JSON.stringify(oldItems),
        JSON.stringify(preparedItems),
        `تعديل من ${oldItems.length} صنف إلى ${preparedItems.length} صنف — الإجمالي الجديد ${finalTotal.toFixed(2)} JD`,
      ]
    );

    await client.query("COMMIT");
    res.json({ ...updatedOrderResult.rows[0], items: preparedItems });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(400).json({ error: err.message || "تعذّر تعديل الطلب." });
  } finally {
    client.release();
  }
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
  if (!isPrivileged(req.user) && !req.user.can_discount) {
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
  if (!isPrivileged(req.user) && !req.user.can_cancel_order) {
    return res.status(403).json({ error: "ليست لديك صلاحية إلغاء الطلبات." });
  }
  const { reason } = req.body;
  const result = await query(
    "UPDATE orders SET status = 'CANCELLED', cancelled_reason = $1, updated_at = now() WHERE id = $2 RETURNING *",
    [reason || null, req.params.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: "الطلب غير موجود." });

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

router.post("/:id/postpone", async (req, res) => {
  const { postponed_to } = req.body;
  if (!postponed_to) return res.status(400).json({ error: "الرجاء تحديد الوقت الجديد." });

  const result = await query(
    "UPDATE orders SET status = 'POSTPONED', postponed_to = $1, updated_at = now() WHERE id = $2 RETURNING *",
    [postponed_to, req.params.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: "الطلب غير موجود." });

  await logActivity({
    userId: req.user.id,
    action: "POSTPONE_ORDER",
    recordType: "order",
    recordId: req.params.id,
    newValue: { postponed_to },
  });

  res.json(result.rows[0]);
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
