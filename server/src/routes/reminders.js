import { Router } from "express";
import { query } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { sendPushToUser } from "../utils/push.js";

const router = Router();
router.use(requireAuth);

// الساعة اللي بيبدأ فيها إرسال إشعار مواعيد اليوم (بتوقيت الأردن)
const REMINDER_HOUR = 7;

function canManage(user) {
  return ["super_admin", "admin", "data_entry", "driver"].includes(user.role);
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
            today_order.status AS today_order_status
     FROM customer_reminders cr
     JOIN customers c ON c.id = cr.customer_id
     LEFT JOIN LATERAL (
       SELECT region_id FROM customer_locations WHERE customer_id = c.id ORDER BY id ASC LIMIT 1
     ) l ON true
     LEFT JOIN regions r ON r.id = l.region_id
     LEFT JOIN LATERAL (
       SELECT o.status FROM orders o
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
    `SELECT cr.customer_id, c.name AS customer_name, c.bottle_type
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

  const usersResult = await query("SELECT id FROM users WHERE status = 'active'");

  for (const row of fresh) {
    const message = `📅 اليوم موعد تسليم الزبون ${row.customer_name}`;
    for (const u of usersResult.rows) {
      await query(
        `INSERT INTO notifications (type, message, related_customer_id, target_user_id) VALUES ('REMINDER', $1, $2, $3)`,
        [message, row.customer_id, u.id]
      );
    }
  }

  // إشعار جهاز واحد لكل شخص بيجمع كل زباين اليوم
  const names = fresh.map((r) => r.customer_name || "بدون اسم");
  const body = fresh.length === 1
    ? `اليوم موعد تسليم الزبون ${names[0]}`
    : `اليوم موعد تسليم ${fresh.length} زباين: ${listNames(names)}`;
  for (const u of usersResult.rows) {
    sendPushToUser(u.id, { title: "📅 مواعيد تسليم اليوم", body, url: "/notifications?tab=schedule", tag: `schedule-${date}` })
      .catch((e) => console.error("push error:", e.message));
  }
}

// بتنادى من طلبات الإشعارات — بتضمن إن الفحص بيصير حتى لو السيرفر كان نايم وقت الفحص كل ساعة
let lastCheckAt = 0;
export function checkRemindersThrottled() {
  const now = Date.now();
  if (now - lastCheckAt < 10 * 60 * 1000) return;
  lastCheckAt = now;
  checkAndFireReminders().catch((err) => console.error("reminder check error:", err.message));
}

export default router;
