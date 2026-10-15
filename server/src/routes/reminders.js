import { Router } from "express";
import { query, logActivity, currentSchema } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { can } from "../permissions.js";
import { sendPushToUser } from "../utils/push.js";
import { scheduleLabel, hourLabel } from "../utils/schedule.js";

const router = Router();
router.use(requireAuth);

// الساعة اللي بيبدأ فيها إرسال إشعار مواعيد اليوم (بتوقيت الأردن)
const REMINDER_HOUR = 7;

function canManage(user) {
  return can(user, "customers", "edit");
}

function getJordanNowParts() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Amman",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(new Date());
  const get = (type) => parts.find((p) => p.type === type)?.value;
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")),
    dow: weekdayMap[get("weekday")],
  };
}

// كل الزباين اللي إلهم أيام تسليم ثابتة — لقسم «المواعيد»
router.get("/schedule", async (req, res) => {
  const { date, dow } = getJordanNowParts();

  const result = await query(
    `SELECT c.id AS customer_id, c.name AS customer_name, c.phone_display, c.phone_normalized,
            c.sequential_number, c.bottle_type,
            cr.days_of_week, cr.notes,
            r.name AS region_name,
            today_order.status AS today_order_status,
            COALESCE(today_order.needs_quantity, false) AS today_order_needs_quantity
     FROM customer_reminders cr
     JOIN customers c ON c.id = cr.customer_id
     LEFT JOIN LATERAL (
       SELECT region_id FROM customer_locations WHERE customer_id = c.id ORDER BY id ASC LIMIT 1
     ) l ON true
     LEFT JOIN regions r ON r.id = l.region_id
     LEFT JOIN LATERAL (
       SELECT o.status, o.needs_quantity FROM orders o
       WHERE o.customer_id = c.id
         AND (o.created_at AT TIME ZONE 'Asia/Amman')::date = $1::date
         AND o.status <> 'CANCELLED'
       ORDER BY o.created_at DESC LIMIT 1
     ) today_order ON true
     WHERE c.status = 'active'
     ORDER BY c.name ASC`,
    [date]
  );

  res.json({ today: date, today_dow: dow, customers: result.rows });
});

router.get("/:customerId", async (req, res) => {
  const result = await query("SELECT * FROM customer_reminders WHERE customer_id = $1", [req.params.customerId]);
  res.json(result.rows[0] || null);
});

router.post("/:customerId", async (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: "غير مصرح." });

  const { days_of_week, notes } = req.body;
  if (!Array.isArray(days_of_week) || days_of_week.length === 0) {
    return res.status(400).json({ error: "اختر يوم واحد على الأقل." });
  }
  const cleanDays = [...new Set(days_of_week.map(Number))].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  if (cleanDays.length === 0) return res.status(400).json({ error: "الأيام غير صحيحة." });

  const existing = await query("SELECT id FROM customer_reminders WHERE customer_id = $1", [req.params.customerId]);
  let result;
  if (existing.rows[0]) {
    result = await query(
      "UPDATE customer_reminders SET days_of_week = $1, notes = $2 WHERE customer_id = $3 RETURNING *",
      [cleanDays, notes || null, req.params.customerId]
    );
  } else {
    result = await query(
      "INSERT INTO customer_reminders (customer_id, days_of_week, notes) VALUES ($1,$2,$3) RETURNING *",
      [req.params.customerId, cleanDays, notes || null]
    );
  }

  res.json(result.rows[0]);
});

router.delete("/:customerId", async (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: "غير مصرح." });
  await query("DELETE FROM customer_reminders WHERE customer_id = $1", [req.params.customerId]);
  res.json({ message: "تم حذف التذكير." });
});

function listNames(names) {
  if (names.length <= 4) return names.join("، ");
  return `${names.slice(0, 4).join("، ")} و${names.length - 4} غيرهم`;
}

// بيفحص مواعيد اليوم ويبعث إشعار لكل الحسابات — مرة وحدة باليوم لكل زبون.
// ما بيبعث قبل الساعة ٧ الصبح عشان ما يزعج حدا بالليل.
export async function checkAndFireReminders() {
  const { date, hour, dow } = getJordanNowParts();
  if (hour < REMINDER_HOUR) return;

  const dueResult = await query(
    `SELECT cr.customer_id, cr.notes, c.name AS customer_name, c.bottle_type
     FROM customer_reminders cr
     JOIN customers c ON c.id = cr.customer_id
     WHERE $1 = ANY(cr.days_of_week) AND c.status = 'active'`,
    [dow]
  );

  // نسجّل اللي ما انبعتله إشعار اليوم بس (الفهرس الفريد بيمنع التكرار)
  const fresh = [];
  for (const row of dueResult.rows) {
    const inserted = await query(
      `INSERT INTO reminder_fired_log (customer_id, fired_date) VALUES ($1, $2)
       ON CONFLICT (customer_id, fired_date) DO NOTHING RETURNING id`,
      [row.customer_id, date]
    );
    if (inserted.rows[0]) fresh.push(row);
  }
  if (fresh.length === 0) return;

  // طلب تلقائي فاضي لكل زبون موعده اليوم (إلا إذا عنده طلب مفتوح أصلًا)
  for (const row of fresh) {
    row.autoOrder = await createReminderOrder(row).catch((e) => {
      console.error("auto order error:", e.message);
      return null;
    });
  }

  const usersResult = await query("SELECT id FROM users WHERE status = 'active'");

  for (const row of fresh) {
    const message = row.autoOrder
      ? `📅 اليوم موعد تسليم الزبون ${row.customer_name} — انضاف طلبه تلقائيًا، حدد عدد القوارير`
      : `📅 اليوم موعد تسليم الزبون ${row.customer_name}`;
    for (const u of usersResult.rows) {
      await query(
        `INSERT INTO notifications (type, message, related_customer_id, target_user_id) VALUES ('REMINDER', $1, $2, $3)`,
        [message, row.customer_id, u.id]
      );
    }
  }

  // إشعار جهاز واحد لكل شخص بيجمع كل زباين اليوم
  const names = fresh.map((r) => r.customer_name || "بدون اسم");
  const autoCount = fresh.filter((r) => r.autoOrder).length;
  let body = fresh.length === 1
    ? `اليوم موعد تسليم الزبون ${names[0]}`
    : `اليوم موعد تسليم ${fresh.length} زباين: ${listNames(names)}`;
  if (autoCount > 0) body += ` — انضاف ${autoCount === 1 ? "طلبه" : `${autoCount} طلبات`} تلقائيًا، حدد الكمية`;
  for (const u of usersResult.rows) {
    sendPushToUser(u.id, { title: "📅 مواعيد تسليم اليوم", body, url: "/notifications?tab=schedule", tag: `schedule-${date}` })
      .catch((e) => console.error("push error:", e.message));
  }
}

// ينشئ طلب فاضي (بدون كمية) لزبون موعده اليوم.
// ما بينشئ إشي إذا الزبون عنده طلب مفتوح (جديد/جاهز/بالطريق/مؤجل).
async function createReminderOrder(row) {
  const open = await query(
    `SELECT id FROM orders WHERE customer_id = $1 AND status IN ('NEW','READY','IN_ROUTE','POSTPONED') LIMIT 1`,
    [row.customer_id]
  );
  if (open.rows[0]) return null;

  const seq = await query("SELECT nextval('order_seq') AS n");
  const orderNumber = String(seq.rows[0].n).padStart(6, "0");
  const notes = ["📅 طلب تلقائي (موعد ثابت)", row.notes].filter(Boolean).join(" — ");

  const inserted = await query(
    `INSERT INTO orders (order_number, customer_id, status, priority, subtotal, final_total, notes, auto_from_reminder, needs_quantity)
     VALUES ($1, $2, 'NEW', 'normal', 0, 0, $3, true, true)
     RETURNING id`,
    [orderNumber, row.customer_id, notes]
  );
  const orderId = inserted.rows[0].id;

  await logActivity({
    userId: null,
    action: "AUTO_CREATE_REMINDER_ORDER",
    recordType: "order",
    recordId: orderId,
    newValue: { order_number: orderNumber, customer_id: row.customer_id },
  });
  return orderId;
}

// بتنادى من طلبات الإشعارات — بتضمن إن الفحص بيصير حتى لو السيرفر كان نايم وقت الفحص كل ساعة
const lastCheckAt = new Map(); // لكل محل لحاله
export function checkRemindersThrottled() {
  const now = Date.now();
  const key = currentSchema();
  if (now - (lastCheckAt.get(key) || 0) < 10 * 60 * 1000) return;
  lastCheckAt.set(key, now);
  checkAndFireReminders().catch((err) => console.error("reminder check error:", err.message));
  checkScheduledOrders().catch((err) => console.error("scheduled check error:", err.message));
}

export default router;

// ============================================================
// الطلبات بموعد: تذكير الصبح بطلبات اليوم المجدولة، وتذكير قبل الموعد بساعة
// ============================================================
async function usersForOrders(extraDriverId = null) {
  const r = await query(
    `SELECT id, role, permissions, can_discount, can_delete_customer, can_edit_product_price, can_cancel_order
     FROM users WHERE status = 'active'`
  );
  const ids = new Set(r.rows.filter((u) => can(u, "orders", "view") || can(u, "trips", "view")).map((u) => u.id));
  if (extraDriverId) ids.add(extraDriverId);
  return [...ids];
}

export async function checkScheduledOrders() {
  const { date, hour } = getJordanNowParts();

  // ١) الصبح (من ٧): ملخص طلبات اليوم المجدولة
  if (hour >= REMINDER_HOUR) {
    const morning = await query(
      `UPDATE orders o SET schedule_morning_at = now()
       FROM customers c
       WHERE c.id = o.customer_id AND o.scheduled_date = $1::date AND o.schedule_morning_at IS NULL
         AND (o.created_at AT TIME ZONE 'Asia/Amman')::date < $1::date
         AND o.status IN ('NEW','READY','POSTPONED','IN_ROUTE')
       RETURNING o.id, o.requested_time, o.scheduled_date, c.id AS customer_id, c.name AS customer_name`,
      [date]
    );
    if (morning.rows.length) {
      const rows = morning.rows.sort((a, b) => new Date(a.requested_time || 0) - new Date(b.requested_time || 0));
      const parts = rows.map((r) => {
        if (!r.requested_time) return `${r.customer_name} (بأي وقت)`;
        const hh = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Amman", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(r.requested_time)).split(":").map(Number);
        return `${r.customer_name} ${hourLabel(hh[0], hh[1])}`;
      });
      const body = rows.length === 1
        ? `📅 اليوم في طلب بموعد: ${parts[0]}`
        : `📅 اليوم في ${rows.length} طلبات بموعد: ${listNames(parts)}`;
      for (const uid of await usersForOrders()) {
        await query(`INSERT INTO notifications (type, message, target_user_id) VALUES ('SCHEDULED', $1, $2)`, [body, uid]);
        sendPushToUser(uid, { title: "📅 طلبات اليوم بموعد", body, url: "/orders", tag: `scheduled-${date}` }).catch(() => {});
      }
    }
  }

  // ٢) قبل الموعد بساعة تقريبًا
  const soon = await query(
    `UPDATE orders o SET schedule_reminded_at = now()
     FROM customers c
     WHERE c.id = o.customer_id AND o.requested_time IS NOT NULL AND o.schedule_reminded_at IS NULL
       AND o.requested_time BETWEEN now() - interval '10 minutes' AND now() + interval '75 minutes'
       AND o.status IN ('NEW','READY','POSTPONED','IN_ROUTE')
     RETURNING o.id, o.requested_time, o.scheduled_date, c.id AS customer_id, c.name AS customer_name,
       (SELECT t.driver_id FROM trip_stops ts JOIN trips t ON t.id = ts.trip_id WHERE ts.order_id = o.id AND t.status <> 'COMPLETED' LIMIT 1) AS driver_id`
  );
  for (const r of soon.rows) {
    const when = scheduleLabel(r);
    const body = `⏰ ${r.customer_name} موعده ${when} — جهّزوا الطلب`;
    for (const uid of await usersForOrders(r.driver_id)) {
      await query(
        `INSERT INTO notifications (type, message, related_customer_id, target_user_id) VALUES ('SCHEDULED', $1, $2, $3)`,
        [body, r.customer_id, uid]
      );
      sendPushToUser(uid, { title: "⏰ طلب موعده قرّب", body, url: "/orders", tag: `sched-${r.id}` }).catch(() => {});
    }
  }
}
