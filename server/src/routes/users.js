import { Router } from "express";
import bcrypt from "bcryptjs";
import { query, logActivity } from "../db.js";
import { requireAuth, invalidateUserCache } from "../middleware/auth.js";
import { requireOwner, sanitizePermissions, effectivePermissions, TEMPLATES, ROLES } from "../permissions.js";

const router = Router();
// إدارة المستخدمين والصلاحيات للمدير العام بس
router.use(requireAuth, requireOwner);

const USER_COLUMNS = `id, username, full_name, role, status, permissions,
  can_discount, can_delete_customer, can_edit_product_price, can_cancel_order, created_at`;

function present(user) {
  const { permissions, can_discount, can_delete_customer, can_edit_product_price, can_cancel_order, ...rest } = user;
  return { ...rest, effective_permissions: effectivePermissions(user) };
}

router.get("/", async (req, res) => {
  const result = await query(`SELECT ${USER_COLUMNS} FROM users ORDER BY created_at ASC`);
  res.json(result.rows.map(present));
});

function cleanRole(role) {
  return ROLES.includes(role) ? role : "staff";
}

router.post("/", async (req, res) => {
  const { username, password, full_name, role, permissions } = req.body || {};

  if (!username || !password || !full_name) {
    return res.status(400).json({ error: "الرجاء تعبئة الاسم واسم المستخدم وكلمة المرور." });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ error: "كلمة المرور لازم تكون ٦ أحرف على الأقل." });
  }
  const dup = await query("SELECT id FROM users WHERE username = $1", [username.trim()]);
  if (dup.rows[0]) return res.status(400).json({ error: "اسم المستخدم هذا مستخدم لحساب ثاني." });

  const finalRole = cleanRole(role);
  const finalPermissions = finalRole === "super_admin"
    ? null
    : sanitizePermissions(permissions || TEMPLATES[finalRole] || TEMPLATES.viewer);

  const password_hash = await bcrypt.hash(password, 10);
  const result = await query(
    `INSERT INTO users (username, password_hash, full_name, role, permissions)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${USER_COLUMNS}`,
    [username.trim(), password_hash, full_name.trim(), finalRole, finalPermissions ? JSON.stringify(finalPermissions) : null]
  );

  const created = result.rows[0];
  await logActivity({
    userId: req.user.id,
    action: "CREATE_USER",
    recordType: "user",
    recordId: created.id,
    newValue: { username: created.username, full_name: created.full_name, role: created.role, permissions: finalPermissions },
  });
  res.status(201).json(present(created));
});

async function activeOwnersCount(excludeId) {
  const r = await query(
    "SELECT COUNT(*)::int AS count FROM users WHERE role = 'super_admin' AND status = 'active' AND id <> $1",
    [excludeId]
  );
  return r.rows[0].count;
}

router.put("/:id", async (req, res) => {
  const targetId = Number(req.params.id);
  const { username, full_name, status, password, role, permissions } = req.body || {};

  const beforeResult = await query(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [targetId]);
  const before = beforeResult.rows[0];
  if (!before) return res.status(404).json({ error: "المستخدم غير موجود." });

  if (username) {
    const dup = await query("SELECT id FROM users WHERE username = $1 AND id != $2", [username.trim(), targetId]);
    if (dup.rows[0]) return res.status(400).json({ error: "اسم المستخدم هذا مستخدم لحساب ثاني." });
  }
  if (password && String(password).length < 6) {
    return res.status(400).json({ error: "كلمة المرور لازم تكون ٦ أحرف على الأقل." });
  }
  if (status && !["active", "disabled"].includes(status)) {
    return res.status(400).json({ error: "الحالة غير صحيحة." });
  }

  const newRole = role !== undefined ? cleanRole(role) : before.role;

  // ما بنسمح يضل النظام بدون مدير عام
  const losingOwner = before.role === "super_admin" && (newRole !== "super_admin" || status === "disabled");
  if (losingOwner && (await activeOwnersCount(targetId)) === 0) {
    return res.status(400).json({ error: "هذا آخر مدير عام بالنظام — ما بينفع تغيّر دوره أو توقفه." });
  }
  if (targetId === req.user.id && status === "disabled") {
    return res.status(400).json({ error: "ما بتقدر توقف حسابك إنت." });
  }

  let newPermissions;
  if (newRole === "super_admin") newPermissions = null;
  else if (permissions !== undefined) newPermissions = sanitizePermissions(permissions);
  else if (before.permissions) newPermissions = before.permissions;
  else newPermissions = sanitizePermissions(effectivePermissions(before));

  const password_hash = password ? await bcrypt.hash(password, 10) : null;

  const result = await query(
    `UPDATE users SET
       username = COALESCE(NULLIF($1, ''), username),
       full_name = COALESCE(NULLIF($2, ''), full_name),
       status = COALESCE($3, status),
       password_hash = COALESCE($4, password_hash),
       role = $5,
       permissions = $6
     WHERE id = $7
     RETURNING ${USER_COLUMNS}`,
    [username?.trim(), full_name?.trim(), status || null, password_hash, newRole,
     newPermissions ? JSON.stringify(newPermissions) : null, targetId]
  );

  invalidateUserCache(targetId);

  await logActivity({
    userId: req.user.id,
    action: "UPDATE_USER",
    recordType: "user",
    recordId: targetId,
    oldValue: { role: before.role, status: before.status, permissions: before.permissions },
    newValue: { role: newRole, status: result.rows[0].status, permissions: newPermissions, password_changed: !!password },
  });
  res.json(present(result.rows[0]));
});

router.delete("/:id", async (req, res) => {
  const targetId = Number(req.params.id);

  if (targetId === req.user.id) {
    return res.status(400).json({ error: "لا يمكنك حذف حسابك أنت بنفسك." });
  }

  const target = await query("SELECT role FROM users WHERE id = $1", [targetId]);
  if (!target.rows[0]) return res.status(404).json({ error: "المستخدم غير موجود." });

  if (target.rows[0].role === "super_admin" && (await activeOwnersCount(targetId)) === 0) {
    return res.status(400).json({ error: "لا يمكن حذف آخر مدير عام بالنظام." });
  }

  try {
    await query("DELETE FROM users WHERE id = $1", [targetId]);
    invalidateUserCache(targetId);
    await logActivity({ userId: req.user.id, action: "DELETE_USER", recordType: "user", recordId: targetId });
    return res.json({ message: "تم حذف المستخدم نهائيًا.", deleted: true });
  } catch (err) {
    if (err.code === "23503") {
      await query("UPDATE users SET status = 'disabled' WHERE id = $1", [targetId]);
      invalidateUserCache(targetId);
      await logActivity({ userId: req.user.id, action: "DISABLE_USER_INSTEAD_OF_DELETE", recordType: "user", recordId: targetId });
      return res.json({
        message: "هذا الحساب مرتبط بسجلات فعلية (طلبات أو رحلات سابقة) فما ينحذف نهائيًا حفاظًا على البيانات — تم إيقافه بدلًا من ذلك (ما يقدر يسجّل دخول).",
        deleted: false,
      });
    }
    throw err;
  }
});

export default router;
