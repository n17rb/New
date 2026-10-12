import jwt from "jsonwebtoken";
import { query, platformQuery, currentSchema, setRequestTenant } from "../db.js";
import { getTenant, tenantAccess } from "../utils/tenants.js";
import { effectivePermissions } from "../permissions.js";

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  console.error("❌ خطأ: متغير JWT_SECRET غير موجود في ملف .env");
  process.exit(1);
}

// التوكن فيه رقم المحل (tid) — التوكنات القديمة بدون tid = المحل الأساسي
export function signToken(user, tenantId = 1) {
  return jwt.sign(
    {
      id: user.id,
      tid: Number(tenantId) || 1,
      username: user.username,
      role: user.role,
      full_name: user.full_name,
    },
    JWT_SECRET,
    { expiresIn: "30d" }
  );
}

// توكن «معاينة» لإدارة موج: بيدخل على محل مشترك بوضع مشاهدة فقط
export function signInspectToken(tenantId, byUserId) {
  return jwt.sign({ id: 0, tid: Number(tenantId), imp: true, by: byUserId }, JWT_SECRET, { expiresIn: "2h" });
}

// بيانات المستخدم بتنقرأ من قاعدة البيانات مع كل طلب (مع ذاكرة قصيرة ٥ ثواني)
// عشان أي تغيير بالصلاحيات أو إيقاف الحساب يطبّق فورًا بدون تسجيل خروج.
const userCache = new Map();
const CACHE_MS = 5000;

export function invalidateUserCache(userId) {
  if (userId == null) {
    userCache.clear();
    return;
  }
  userCache.delete(`${currentSchema()}:${Number(userId)}`);
}

async function loadUser(id) {
  const key = `${currentSchema()}:${id}`;
  const cached = userCache.get(key);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.user;
  const result = await query(
    `SELECT id, username, full_name, role, status, permissions,
            can_discount, can_delete_customer, can_edit_product_price, can_cancel_order
     FROM users WHERE id = $1`,
    [id]
  );
  const user = result.rows[0] || null;
  if (user) user._perms = effectivePermissions(user);
  userCache.set(key, { user, at: Date.now() });
  return user;
}

// المسارات المسموحة حتى لو الاشتراك خالص أو المحل موقوف: عشان يقدر يدفع ويحكي مع الدعم
const ALWAYS_ALLOWED = ["/api/auth/me", "/api/subscription", "/api/support", "/api/push", "/api/settings/shop"];
function isAlwaysAllowed(url) {
  return ALWAYS_ALLOWED.some((p) => url === p || url.startsWith(p + "/") || url.startsWith(p + "?"));
}

const lastActive = new Map();
function touchTenant(tenantId) {
  const now = Date.now();
  if (now - (lastActive.get(tenantId) || 0) < 5 * 60 * 1000) return;
  lastActive.set(tenantId, now);
  platformQuery("UPDATE platform.tenants SET last_active_at = now() WHERE id = $1", [tenantId]).catch(() => {});
}

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "يجب تسجيل الدخول." });
  }

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: "جلسة الدخول منتهية، الرجاء تسجيل الدخول مجددًا." });
  }

  try {
    const tenant = await getTenant(payload.tid || 1);
    if (!tenant) return res.status(401).json({ error: "المحل غير موجود. سجّل دخول من جديد." });
    setRequestTenant(tenant);
    req.tenant = tenant;
    req.access = tenantAccess(tenant);

    if (payload.imp) {
      // معاينة من إدارة موج: صلاحيات كاملة للعرض، وما في أي تعديل
      req.user = {
        id: 0, username: "moj-support", full_name: "معاينة إدارة موج", role: "super_admin", status: "active",
        permissions: null, _perms: effectivePermissions({ role: "super_admin" }), inspecting: true, inspected_by: payload.by,
      };
      if (req.method !== "GET" && req.method !== "HEAD") {
        return res.status(403).json({ error: "وضع المعاينة: بتقدر تتفرج بس، ما بتقدر تعدّل إشي.", code: "INSPECT_READ_ONLY" });
      }
      return next();
    }

    const user = await loadUser(Number(payload.id));
    if (!user) return res.status(401).json({ error: "الحساب غير موجود. سجّل دخول من جديد." });
    if (user.status !== "active") return res.status(401).json({ error: "هذا الحساب موقوف. راجع الإدارة." });
    req.user = user;
    touchTenant(tenant.id);

    const url = req.originalUrl || req.url || "";
    if (!isAlwaysAllowed(url)) {
      if (req.access.state === "suspended") {
        return res.status(402).json({ error: "حساب المحل موقوف. تواصل مع دعم موج.", code: "SUSPENDED" });
      }
      if (req.access.state === "expired") {
        return res.status(402).json({ error: "انتهى اشتراك المحل. جدّد الاشتراك عشان ترجع تشتغل.", code: "EXPIRED" });
      }
      if (tenant.is_demo && req.method !== "GET" && req.method !== "HEAD") {
        return res.status(403).json({ error: "هذا حساب تجريبي — بتقدر تتفرج وتجرّب التنقل، بس ما بينحفظ أي تعديل.", code: "DEMO_READ_ONLY" });
      }
    }
    next();
  } catch (err) {
    next(err);
  }
}

// إدارة موج = المدير العام للمحل الأساسي
export function isPlatformAdmin(req) {
  return !!(req.tenant?.is_home && req.user?.role === "super_admin" && !req.user?.inspecting);
}

export function requirePlatformAdmin(req, res, next) {
  if (isPlatformAdmin(req)) return next();
  return res.status(403).json({ error: "هذا القسم لإدارة موج فقط." });
}

export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: "ليست لديك صلاحية لتنفيذ هذا الإجراء." });
    }
    next();
  };
}
