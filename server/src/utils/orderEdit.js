import { pool } from "../db.js";

export function computeFinalTotal(subtotal, discountType, discountValue) {
  const sub = Number(subtotal);
  const val = Number(discountValue) || 0;
  if (!discountType || val <= 0) return sub;
  if (discountType === "percent") return Math.max(0, sub - (sub * val) / 100);
  return Math.max(0, sub - val);
}

// تعديل محتوى طلب (من صفحة الطلبات أو من جوّا الرحلة)
// items = [{product_id, quantity}] — بيرجع الطلب الجديد مع منتجاته، أو بيرمي خطأ مفهوم
export async function replaceOrderItems(orderId, items, userId) {
  if (!Array.isArray(items) || items.length === 0) throw new Error("يجب إرسال منتج واحد على الأقل.");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const orderResult = await client.query("SELECT * FROM orders WHERE id = $1 FOR UPDATE", [orderId]);
    const order = orderResult.rows[0];
    if (!order) throw new Error("الطلب غير موجود.");
    if (["DELIVERED", "CANCELLED"].includes(order.status)) {
      throw new Error("لا يمكن تعديل طلب تم تسليمه أو إلغاؤه.");
    }

    const oldItems = (await client.query("SELECT * FROM order_items WHERE order_id = $1", [order.id])).rows;

    const productIds = items.map((i) => i.product_id);
    const productsResult = await client.query(`SELECT * FROM products WHERE id = ANY($1::int[])`, [productIds]);
    const productsMap = Object.fromEntries(productsResult.rows.map((p) => [p.id, p]));

    // سعر الزبون الخاص (لو إله) — زي إنشاء الطلب بالضبط
    const customPricesResult = await client.query(
      `SELECT product_id, custom_price FROM customer_product_prices WHERE customer_id = $1 AND product_id = ANY($2::int[])`,
      [order.customer_id, productIds]
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

    const finalTotal = computeFinalTotal(subtotal, order.discount_type, order.discount_value);

    await client.query("DELETE FROM order_items WHERE order_id = $1", [order.id]);
    for (const item of preparedItems) {
      await client.query(
        `INSERT INTO order_items (order_id, product_id, product_name_snapshot, quantity, unit_price_snapshot, line_total)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [order.id, item.product_id, item.product_name_snapshot, item.quantity, item.unit_price_snapshot, item.line_total]
      );
    }

    const updated = (await client.query(
      `UPDATE orders SET subtotal = $1, final_total = $2, needs_quantity = false, updated_at = now() WHERE id = $3 RETURNING *`,
      [subtotal, finalTotal, order.id]
    )).rows[0];

    await client.query(
      `INSERT INTO order_edit_history (order_id, edited_by, old_snapshot, new_snapshot, diff_summary)
       VALUES ($1,$2,$3,$4,$5)`,
      [
        order.id,
        userId,
        JSON.stringify(oldItems),
        JSON.stringify(preparedItems),
        `تعديل من ${oldItems.length} صنف إلى ${preparedItems.length} صنف — الإجمالي الجديد ${finalTotal.toFixed(2)} JD`,
      ]
    );

    await client.query("COMMIT");
    return { ...updated, items: preparedItems };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
