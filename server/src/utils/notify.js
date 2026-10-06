import { query } from "../db.js";
import { sendPushToUser } from "./push.js";

function listNames(names) {
  if (names.length <= 3) return names.join("، ");
  return `${names.slice(0, 3).join("، ")} و${names.length - 3} غيرهم`;
}

// يرسل إشعار لسائق الرحلة ولكل حسابات الإدارة لما يُضاف طلب (أو أكثر) على رحلة.
// actorId = اللي عمل الإضافة، ما بيوصله إشعار عن شي هو عمله.
export async function notifyOrdersAddedToTrip({ tripId, orderIds, actorId = null, isNewTrip = false }) {
  if (!tripId || !orderIds || orderIds.length === 0) return;

  const tripResult = await query(
    `SELECT t.id, t.driver_id, u.full_name AS driver_name
     FROM trips t LEFT JOIN users u ON u.id = t.driver_id
     WHERE t.id = $1`,
    [tripId]
  );
  const trip = tripResult.rows[0];
  if (!trip) return;

  const customersResult = await query(
    `SELECT o.id, o.order_number, c.id AS customer_id, c.name AS customer_name
     FROM orders o JOIN customers c ON c.id = o.customer_id
     WHERE o.id = ANY($1::int[])`,
    [orderIds]
  );
  const rows = customersResult.rows;
  if (rows.length === 0) return;

  const names = rows.map((r) => r.customer_name || "بدون اسم");
  const singleCustomerId = rows.length === 1 ? rows[0].customer_id : null;
  const driverName = trip.driver_name || "السائق";

  let driverMessage;
  let adminMessage;
  if (isNewTrip) {
    driverMessage = `🚚 رحلة جديدة إلك فيها ${rows.length} طلب: ${listNames(names)}`;
    adminMessage = `🚚 رحلة جديدة لـ ${driverName} فيها ${rows.length} طلب: ${listNames(names)}`;
  } else if (rows.length === 1) {
    driverMessage = `📦 انضاف طلب جديد على رحلتك: ${names[0]}`;
    adminMessage = `📦 انضاف طلب على رحلة ${driverName}: ${names[0]}`;
  } else {
    driverMessage = `📦 انضاف ${rows.length} طلبات على رحلتك: ${listNames(names)}`;
    adminMessage = `📦 انضاف ${rows.length} طلبات على رحلة ${driverName}: ${listNames(names)}`;
  }

  const recipients = new Map(); // userId -> message
  if (trip.driver_id && trip.driver_id !== actorId) recipients.set(trip.driver_id, driverMessage);

  const adminsResult = await query(
    `SELECT id FROM users WHERE status = 'active' AND role IN ('super_admin','admin')`
  );
  for (const a of adminsResult.rows) {
    if (a.id === actorId || recipients.has(a.id)) continue;
    recipients.set(a.id, adminMessage);
  }

  for (const [userId, message] of recipients) {
    await query(
      `INSERT INTO notifications (type, message, related_customer_id, related_trip_id, target_user_id)
       VALUES ('TRIP_ORDER_ADDED', $1, $2, $3, $4)`,
      [message, singleCustomerId, tripId, userId]
    );
    sendPushToUser(userId, { body: message, url: "/notifications" })
      .catch((e) => console.error("push error:", e.message));
  }
}

// طلب جديد مش على رحلة: بيوصل إشعار لكل الكباتن (السائقين) والإدارة عشان حدا يروح يوصّله.
// actorId = اللي سجّل الطلب، ما بيوصله إشعار.
export async function notifyNewOrder({ orderId, actorId = null }) {
  if (!orderId) return;

  const orderResult = await query(
    `SELECT o.id, o.priority, o.notes, c.id AS customer_id, c.name AS customer_name, c.bottle_type, r.name AS region_name
     FROM orders o
     JOIN customers c ON c.id = o.customer_id
     LEFT JOIN LATERAL (
       SELECT region_id FROM customer_locations WHERE customer_id = c.id ORDER BY id ASC LIMIT 1
     ) l ON true
     LEFT JOIN regions r ON r.id = l.region_id
     WHERE o.id = $1`,
    [orderId]
  );
  const order = orderResult.rows[0];
  if (!order) return;

  const itemsResult = await query(
    "SELECT product_name_snapshot, quantity FROM order_items WHERE order_id = $1 ORDER BY id ASC",
    [orderId]
  );
  const itemsText = itemsResult.rows
    .map((i) => `${Number(i.quantity)} × ${i.product_name_snapshot}`)
    .join("، ");

  const urgent = order.priority === "urgent" ? "⚡ مستعجل — " : "";
  const region = order.region_name ? ` (${order.region_name})` : "";
  const bottle = order.bottle_type === "new" ? " · قوارير جديدة 🆕" : order.bottle_type === "used" ? " · قوارير مستعملة ♻️" : "";
  const message = `🆕 ${urgent}طلب جديد: ${order.customer_name || "بدون اسم"}${region}${itemsText ? ` — ${itemsText}` : ""}${bottle}`;

  const recipientsResult = await query(
    `SELECT id FROM users WHERE status = 'active' AND role IN ('driver','super_admin','admin')`
  );

  for (const u of recipientsResult.rows) {
    if (u.id === actorId) continue;
    await query(
      `INSERT INTO notifications (type, message, related_customer_id, target_user_id)
       VALUES ('NEW_ORDER', $1, $2, $3)`,
      [message, order.customer_id, u.id]
    );
    sendPushToUser(u.id, { title: "طلب جديد 🚚", body: message, url: "/orders" })
      .catch((e) => console.error("push error:", e.message));
  }
}
