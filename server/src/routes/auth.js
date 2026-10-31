import { Router } from "express";
import bcrypt from "bcryptjs";
import { query, setRequestTenant } from "../db.js";
import { signToken, requireAuth, isPlatformAdmin } from "../middleware/auth.js";
import { findTenantIdByUsername, getTenant, tenantAccess, getPlatformSettings, normalizeUsername } from "../utils/tenants.js";
import { effectivePermissions, permissionsMeta } from "../permissions.js";
import { cleanFeatures } from "../features.js";

const router = Router();

router.post("/login", async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: "الرجاء إدخال اسم المستخدم وكلمة المرور." });
  }

  // موج: منعرف المحل من اسم المستخدم
  const tenantId = (await findTenantIdByUsername(username)) || 1;
  const tenant = await getTenant(tenantId);
  if (!tenant) return res.status(401).json({ error: "اسم المستخدم أو كلمة المرور غير صحيحة." });
  setRequestTenant(tenant);

  const result = await query("SELECT * FROM users WHERE lower(username) = lower($1)", [normalizeUsername(username)]);
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

  const token = signToken(user, tenant.id);
  res.json({ token, user: publicUser(user), shop: await shopInfo({ tenant, user }) });
});

function publicUser(user) {
  return {
    inspecting: !!user.inspecting,
    viewing_as: !!user.viewing_as,
    id: user.id,
    username: user.username,
    full_name: user.full_name,
    role: user.role,
    permissions: user._perms || effectivePermissions(user),
  };
}

// معلومات المحل والاشتراك للتطبيق
async function shopInfo(req) {
  const t = req.tenant;
  const access = tenantAccess(t);
  const info = {
    id: t.id,
    name: t.name,
    is_home: t.is_home,
    is_demo: t.is_demo,
    access,
    platform_admin: isPlatformAdmin({ tenant: t, user: req.user }),
    inspecting: !!req.user?.inspecting,
    plan: t.plan === "factory" ? "factory" : "shop",
    features: cleanFeatures(t.features),
  };
  if (info.plan === "factory") {
    // هوية المصنع: الاسم والشعار والرقم بيطلعوا بالتطبيق والفواتير ورسائل الزباين
    const r = await query("SELECT key, value FROM app_settings WHERE key IN ('brand_name','brand_logo','brand_phone','brand_tagline','brand_icon')").catch(() => ({ rows: [] }));
    const m = Object.fromEntries(r.rows.map((x) => [x.key, x.value]));
    const logo = m.brand_logo || null;
    info.brand = { name: m.brand_name || t.name, logo, icon: m.brand_icon || (logo === "/brands/al-mahdi.png" ? "/brands/al-mahdi-icon.png" : logo), phone: m.brand_phone || t.phone || null, tagline: m.brand_tagline || null };
  }
  if (access.state !== "active") {
    const s = await getPlatformSettings().catch(() => ({}));
    info.payment = {
      cliq_number: s.cliq_number, cliq_name: s.cliq_name, contact_phone: s.contact_phone,
      monthly_price: Number(t.monthly_price) || Number(s.default_monthly_price) || null,
    };
  }
  return info;
}

// بيانات المستخدم الحالي وصلاحياته الحالية + المحل والاشتراك — التطبيق بيسأل عنها عند الفتح
router.get("/me", requireAuth, async (req, res) => {
  res.json({ ...publicUser(req.user), shop: await shopInfo(req) });
});

// تعريف الأقسام والإجراءات والقوالب — لشاشة الصلاحيات
router.get("/permissions-meta", requireAuth, (req, res) => {
  res.json(permissionsMeta(req.tenant?.plan));
});

export default router;
