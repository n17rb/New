import { Router } from "express";
import bcrypt from "bcryptjs";
import { query, logActivity } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth, requireRole("super_admin"));

router.get("/", async (req, res) => {
  const result = await query(
    `SELECT id, username, full_name, role, status, can_discount, can_delete_customer, can_edit_product_price, can_cancel_order, created_at
     FROM users ORDER BY created_at ASC`
  );
  res.json(result.rows);
});

router.post("/", async (req, res) => {
  const { username, password, full_name, role, can_discount, can_delete_customer, can_edit_product_price, can_cancel_order } = req.body;

  if (!username || !password || !full_name || !role) {
    return res.status(400).json({ error: "الرجاء تعبئة كل الحقول المطلوبة." });
  }
  if (!["super_admin", "admin", "driver", "data_entry"].includes(role)) {
    return res.status(400).json({ error: "الدور يجب أن يكون super_admin أو admin أو driver أو data_entry." });
  }

  const password_hash = await bcrypt.hash(password, 10);
  const result = await query(
    `INSERT INTO users (username, password_hash, full_name, role, can_discount, can_delete_customer, can_edit_product_price, can_cancel_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id, username, full_name, role, status`,
    [username.trim(), password_hash, full_name.trim(), role,
     !!can_discount, !!can_delete_customer, !!can_edit_product_price, !!can_cancel_order]
  );

  await logActivity({ userId: req.user.id, action: "CREATE_USER", recordType: "user", recordId: result.rows[0].id, newValue: result.rows[0] });
  res.status(201).json(result.rows[0]);
});

router.put("/:id", async (req, res) => {
  const { username, full_name, status, can_discount, can_delete_customer, can_edit_product_price, can_cancel_order, password } = req.body;

  const targetId = req.params.id;

  if (username) {
    const dup = await query("SELECT id FROM users WHERE username = $1 AND id != $2", [username.trim(), targetId]);
    if (dup.rows[0]) {
      return res.status(400).json({ error: "اسم المستخدم هذا مستخدم بالفعل لحساب آخر." });
    }
  }

  let password_hash = null;
  if (password) {
    password_hash = await bcrypt.hash(password, 10);
  }

  const result = await query(
    `UPDATE users SET
       username = COALESCE(NULLIF($1, ''), username),
       full_name = COALESCE($2, full_name),
       status = COALESCE($3, status),
       can_discount = COALESCE($4, can_discount),
       can_delete_customer = COALESCE($5, can_delete_customer),
       can_edit_product_price = COALESCE($6, can_edit_product_price),
       can_cancel_order = COALESCE($7, can_cancel_order),
       password_hash = COALESCE($8, password_hash)
     WHERE id = $9
     RETURNING id, username, full_name, role, status, can_discount, can_delete_customer, can_edit_product_price, can_cancel_order`,
    [username, full_name, status, can_discount, can_delete_customer, can_edit_product_price, can_cancel_order, password_hash, targetId]
  );

  if (!result.rows[0]) return res.status(404).json({ error: "المستخدم غير موجود." });

  await logActivity({ userId: req.user.id, action: "UPDATE_USER", recordType: "user", recordId: targetId, newValue: result.rows[0] });
  res.json(result.rows[0]);
});

router.delete("/:id", async (req, res) => {
  const targetId = Number(req.params.id);

  if (targetId === req.user.id) {
    return res.status(400).json({ error: "لا يمكنك حذف حسابك أنت بنفسك." });
  }

  const target = await query("SELECT role FROM users WHERE id = $1", [targetId]);
  if (!target.rows[0]) return res.status(404).json({ error: "المستخدم غير موجود." });

  if (target.rows[0].role === "super_admin") {
    const superAdminCount = await query("SELECT COUNT(*)::int AS count FROM users WHERE role = 'super_admin' AND status = 'active'");
    if (superAdminCount.rows[0].count <= 1) {
      return res.status(400).json({ error: "لا يمكن حذف آخر حساب مدير بالنظام." });
    }
  }

  try {
    await query("DELETE FROM users WHERE id = $1", [targetId]);
    await logActivity({ userId: req.user.id, action: "DELETE_USER", recordType: "user", recordId: targetId });
    return res.json({ message: "تم حذف المستخدم نهائيًا.", deleted: true });
  } catch (err) {
    if (err.code === "23503") {
      await query("UPDATE users SET status = 'disabled' WHERE id = $1", [targetId]);
      await logActivity({ userId: req.user.id, action: "DISABLE_USER_INSTEAD_OF_DELETE", recordType: "user", recordId: targetId });
      return res.json({
        message: "هذا الحساب مرتبط بسجلات فعلية (طلبات أو رحلات سابقة) فما ينحذف نهائيًا حفاظًا على البيانات — تم تعطيله بدلًا من ذلك (ما يقدر يسجّل دخول).",
        deleted: false,
      });
    }
    throw err;
  }
});

export default router;
