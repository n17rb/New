import { Router } from "express";
import { query } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth, requireRole("super_admin", "admin"));

router.get("/", async (req, res) => {
  const result = await query(
    `SELECT * FROM notifications WHERE created_at > now() - interval '48 hours' ORDER BY created_at DESC LIMIT 100`
  );
  res.json(result.rows);
});

router.post("/mark-read", async (req, res) => {
  await query(`UPDATE notifications SET is_read = true WHERE created_at > now() - interval '48 hours'`);
  res.json({ message: "تم تحديد الكل كمقروء." });
});

export default router;
