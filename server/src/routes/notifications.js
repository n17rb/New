import { Router } from "express";
import { query } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { can } from "../permissions.js";
import { checkRemindersThrottled } from "./reminders.js";

const router = Router();
router.use(requireAuth);

// الإشعارات العامة (القديمة) بتظهر للي بيتابع الرحلات
function isPrivileged(user) {
  return can(user, "trips", "view");
}

// كل مستخدم بيشوف الإشعارات الموجّهة إله،
// والإدارة كمان بتشوف الإشعارات العامة (القديمة اللي ما إلها مستخدم محدد)
function visibilityCondition(user) {
  return isPrivileged(user)
    ? "(target_user_id = $1 OR target_user_id IS NULL)"
    : "target_user_id = $1";
}

router.get("/", async (req, res) => {
  // التطبيق بيسأل عن الإشعارات كل ١٥ ثانية — فرصة نتأكد إن مواعيد اليوم انبعتت
  checkRemindersThrottled();

  const result = await query(
    `SELECT * FROM notifications
     WHERE created_at > now() - interval '48 hours' AND ${visibilityCondition(req.user)}
     ORDER BY created_at DESC LIMIT 100`,
    [req.user.id]
  );
  res.json(result.rows);
});

router.post("/mark-read", async (req, res) => {
  await query(
    `UPDATE notifications SET is_read = true
     WHERE created_at > now() - interval '48 hours' AND ${visibilityCondition(req.user)}`,
    [req.user.id]
  );
  res.json({ message: "تم تحديد الكل كمقروء." });
});

export default router;
