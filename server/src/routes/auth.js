import { Router } from "express";
import bcrypt from "bcryptjs";
import { query } from "../db.js";
import { signToken, requireAuth } from "../middleware/auth.js";
import { effectivePermissions, SECTIONS, ACTIONS, TEMPLATES } from "../permissions.js";

const router = Router();

router.post("/login", async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: "الرجاء إدخال اسم المستخدم وكلمة المرور." });
  }

  const result = await query("SELECT * FROM users WHERE username = $1", [username.trim()]);
  const user = result.rows[0];

  if (!user) {
    return res.status(401).json({ error: "اسم المستخدم أو كلمة المرور غير صحيحة." });
  }

  if (user.status !== "active") {
    return res.status(403).json({ error: "هذا الحساب غير مفعّل. راجع الإدارة." });
  }

  const passwordOk = await bcrypt.compare(password, user.password_hash);
  if (!passwordOk) {
    return res.status(401).json({ error: "اسم المستخدم أو كلمة المرور غير صحيحة." });
  }

  const token = signToken(user);
  res.json({ token, user: publicUser(user) });
});

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    full_name: user.full_name,
    role: user.role,
    permissions: user._perms || effectivePermissions(user),
  };
}

// بيانات المستخدم الحالي وصلاحياته الحالية — التطبيق بيسأل عنها عند الفتح
router.get("/me", requireAuth, (req, res) => {
  res.json(publicUser(req.user));
});

// تعريف الأقسام والإجراءات والقوالب — لشاشة الصلاحيات
router.get("/permissions-meta", requireAuth, (req, res) => {
  res.json({ sections: SECTIONS, actions: ACTIONS, templates: TEMPLATES });
});

export default router;
