import jwt from "jsonwebtoken";
import { query } from "../db.js";
import { effectivePermissions } from "../permissions.js";

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  console.error("❌ خطأ: متغير JWT_SECRET غير موجود في ملف .env");
  process.exit(1);
}

export function signToken(user) {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      role: user.role,
      full_name: user.full_name,
      can_discount: user.can_discount,
      can_delete_customer: user.can_delete_customer,
      can_edit_product_price: user.can_edit_product_price,
      can_cancel_order: user.can_cancel_order,
    },
    JWT_SECRET,
    { expiresIn: "30d" }
  );
}

// بيانات المستخدم بتنقرأ من قاعدة البيانات مع كل طلب (مع ذاكرة قصيرة ٥ ثواني)
// عشان أي تغيير بالصلاحيات أو إيقاف الحساب يطبّق فورًا بدون تسجيل خروج.
const userCache = new Map();
const CACHE_MS = 5000;

export function invalidateUserCache(userId) {
  if (userId == null) userCache.clear();
  else userCache.delete(Number(userId));
}

async function loadUser(id) {
  const cached = userCache.get(id);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.user;
  const result = await query(
    `SELECT id, username, full_name, role, status, permissions,
            can_discount, can_delete_customer, can_edit_product_price, can_cancel_order
     FROM users WHERE id = $1`,
    [id]
  );
  const user = result.rows[0] || null;
  if (user) user._perms = effectivePermissions(user);
  userCache.set(id, { user, at: Date.now() });
  return user;
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
    const user = await loadUser(Number(payload.id));
    if (!user) return res.status(401).json({ error: "الحساب غير موجود. سجّل دخول من جديد." });
    if (user.status !== "active") return res.status(401).json({ error: "هذا الحساب موقوف. راجع الإدارة." });
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: "ليست لديك صلاحية لتنفيذ هذا الإجراء." });
    }
    next();
  };
}
