import { Router } from "express";
import { query } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  const result = await query(
    "SELECT * FROM personal_notes WHERE user_id = $1 ORDER BY created_at DESC LIMIT 200",
    [req.user.id]
  );
  res.json(result.rows);
});

router.post("/", async (req, res) => {
  const { content } = req.body;
  if (!content || !content.trim()) {
    return res.status(400).json({ error: "الملاحظة لا يمكن أن تكون فاضية." });
  }
  const result = await query(
    "INSERT INTO personal_notes (user_id, content) VALUES ($1, $2) RETURNING *",
    [req.user.id, content.trim()]
  );
  res.status(201).json(result.rows[0]);
});

router.delete("/:id", async (req, res) => {
  await query("DELETE FROM personal_notes WHERE id = $1 AND user_id = $2", [req.params.id, req.user.id]);
  res.json({ message: "تم حذف الملاحظة." });
});

export default router;
