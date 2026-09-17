import { Router } from "express";
import { query } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

function canManage(user) {
  return ["super_admin", "admin", "data_entry", "driver"].includes(user.role);
}

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

  const existing = await query("SELECT id FROM customer_reminders WHERE customer_id = $1", [req.params.customerId]);
  let result;
  if (existing.rows[0]) {
    result = await query(
      "UPDATE customer_reminders SET days_of_week = $1, notes = $2 WHERE customer_id = $3 RETURNING *",
      [days_of_week, notes || null, req.params.customerId]
    );
  } else {
    result = await query(
      "INSERT INTO customer_reminders (customer_id, days_of_week, notes) VALUES ($1,$2,$3) RETURNING *",
      [req.params.customerId, days_of_week, notes || null]
    );
  }

  res.json(result.rows[0]);
});

router.delete("/:customerId", async (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: "غير مصرح." });
  await query("DELETE FROM customer_reminders WHERE customer_id = $1", [req.params.customerId]);
  res.json({ message: "تم حذف التذكير." });
});

export async function checkAndFireReminders() {
  const now = new Date();
  const jordanNow = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  const todayDow = jordanNow.getUTCDay();
  const todayDate = jordanNow.toISOString().slice(0, 10);

  const dueResult = await query(
    `SELECT cr.customer_id, c.name AS customer_name
     FROM customer_reminders cr
     JOIN customers c ON c.id = cr.customer_id
     WHERE $1 = ANY(cr.days_of_week) AND c.status = 'active'`,
    [todayDow]
  );

  for (const row of dueResult.rows) {
    try {
      await query(
        "INSERT INTO reminder_fired_log (customer_id, fired_date) VALUES ($1, $2)",
        [row.customer_id, todayDate]
      );
      await query(
        `INSERT INTO notifications (type, message, related_customer_id) VALUES ('REMINDER', $1, $2)`,
        [`⏰ موعد التوصيل المعتاد اليوم لزبون ${row.customer_name}`, row.customer_id]
      );
    } catch {
      // تجاهل — يعني الإشعار انطلق أصلًا اليوم لهذا العميل
    }
  }
}

export default router;
