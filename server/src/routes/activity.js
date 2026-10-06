import { Router } from "express";
import { query } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePerm } from "../permissions.js";

const router = Router();
router.use(requireAuth, requirePerm("activity_log", "view"));

router.get("/", async (req, res) => {
  const { record_type, limit } = req.query;
  const conditions = [];
  const params = [];

  if (record_type) {
    params.push(record_type);
    conditions.push(`al.record_type = $${params.length}`);
  }

  const whereClause = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
  params.push(Number(limit) || 200);

  const result = await query(
    `SELECT al.*, u.full_name AS user_name
     FROM activity_log al
     LEFT JOIN users u ON u.id = al.user_id
     ${whereClause}
     ORDER BY al.created_at DESC
     LIMIT $${params.length}`,
    params
  );
  res.json(result.rows);
});

export default router;
