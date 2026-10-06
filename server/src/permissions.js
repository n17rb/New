// ============================================================
// نظام الصلاحيات
// كل قسم إله ٣ مستويات: none (مخفي) / view (متفرج) / edit (تعديل)
// وفي صلاحيات إجراءات خاصة (نعم/لا) مثل الخصم والإلغاء.
// المدير العام (super_admin) دايمًا إله كل شي.
// ============================================================

export const SECTIONS = [
  { key: "dashboard", label: "الرئيسية", hint: "ملخص اليوم والأرقام السريعة", viewOnly: true },
  { key: "customers", label: "العملاء", hint: "قائمة العملاء، المواقع، الأسعار الخاصة، أيام التسليم" },
  { key: "orders", label: "الطلبات", hint: "تسجيل الطلبات وتعديلها وتأجيلها" },
  { key: "delivery", label: "التوصيل (كابتن)", hint: "يبدأ رحلة لنفسه ويسلّم الطلبات" },
  { key: "trips", label: "كل الرحلات", hint: "متابعة رحلات الكباتن وتوزيع الرحلات عليهم" },
  { key: "products", label: "المنتجات والمناطق", hint: "المنتجات وأسعارها والمناطق" },
  { key: "cash", label: "الحساب اليومي", hint: "مبيعات وصرفيات كل يوم" },
  { key: "driver_balances", label: "ذمم الكباتن", hint: "الكاش والكوبونات اللي مع الكباتن والتسوية" },
  { key: "reports", label: "التقارير", hint: "التقارير، أداء الكباتن، نمو العملاء، الخريطة", viewOnly: true },
  { key: "settings", label: "إعدادات المحل", hint: "موقع المحل اللي بتخلص فيه الرحلات" },
  { key: "activity_log", label: "سجل النشاط", hint: "مين عمل شو وإيمتى", viewOnly: true },
  { key: "backup", label: "النسخ الاحتياطي", hint: "تنزيل نسخة من كل البيانات", viewOnly: true },
];

export const ACTIONS = [
  { key: "discount", label: "إعطاء خصم على طلب" },
  { key: "cancel_order", label: "إلغاء طلب" },
  { key: "delete_customer", label: "حذف عميل" },
  { key: "edit_prices", label: "تعديل أسعار المنتجات" },
  { key: "adjust_coupons", label: "تعديل رصيد كوبونات العميل يدويًا" },
];

export const LEVELS = ["none", "view", "edit"];
const RANK = { none: 0, view: 1, edit: 2 };

// قوالب جاهزة — بتعبّي الصلاحيات، وبعدين المدير بيعدّل اللي بده
export const TEMPLATES = {
  admin: {
    label: "مساعد مدير",
    sections: {
      dashboard: "view", customers: "edit", orders: "edit", delivery: "edit", trips: "edit",
      products: "edit", cash: "edit", driver_balances: "edit", reports: "view", settings: "edit",
      activity_log: "none", backup: "none",
    },
    actions: { discount: true, cancel_order: true, delete_customer: true, edit_prices: true, adjust_coupons: false },
  },
  driver: {
    label: "كابتن توصيل",
    sections: {
      dashboard: "none", customers: "edit", orders: "edit", delivery: "edit", trips: "none",
      products: "view", cash: "none", driver_balances: "none", reports: "none", settings: "none",
      activity_log: "none", backup: "none",
    },
    actions: { discount: false, cancel_order: false, delete_customer: false, edit_prices: false, adjust_coupons: false },
  },
  data_entry: {
    label: "موظف إدخال",
    sections: {
      dashboard: "none", customers: "edit", orders: "none", delivery: "none", trips: "none",
      products: "view", cash: "none", driver_balances: "none", reports: "none", settings: "none",
      activity_log: "none", backup: "none",
    },
    actions: { discount: false, cancel_order: false, delete_customer: false, edit_prices: false, adjust_coupons: false },
  },
  viewer: {
    label: "متفرج",
    sections: {
      dashboard: "view", customers: "view", orders: "view", delivery: "none", trips: "view",
      products: "view", cash: "view", driver_balances: "view", reports: "view", settings: "view",
      activity_log: "none", backup: "none",
    },
    actions: { discount: false, cancel_order: false, delete_customer: false, edit_prices: false, adjust_coupons: false },
  },
};

export const ROLES = ["super_admin", "admin", "driver", "data_entry", "viewer", "staff"];

function fullAccess() {
  return {
    sections: Object.fromEntries(SECTIONS.map((s) => [s.key, s.viewOnly ? "view" : "edit"])),
    actions: Object.fromEntries(ACTIONS.map((a) => [a.key, true])),
    is_owner: true,
  };
}

// تنظيف أي صلاحيات جاية من برا (من شاشة المستخدمين)
export function sanitizePermissions(input) {
  const sections = {};
  for (const s of SECTIONS) {
    let level = input?.sections?.[s.key];
    if (!LEVELS.includes(level)) level = "none";
    if (s.viewOnly && level === "edit") level = "view";
    sections[s.key] = level;
  }
  const actions = {};
  for (const a of ACTIONS) actions[a.key] = input?.actions?.[a.key] === true;
  return { sections, actions };
}

// صلاحيات المستخدم الفعلية
export function effectivePermissions(user) {
  if (!user) return sanitizePermissions(null);
  if (user.role === "super_admin") return fullAccess();

  if (user.permissions && typeof user.permissions === "object") {
    return { ...sanitizePermissions(user.permissions), is_owner: false };
  }

  // حسابات قديمة قبل نظام الصلاحيات: منطلع صلاحياتها من الدور القديم
  const template = TEMPLATES[user.role] || TEMPLATES.viewer;
  const legacy = sanitizePermissions(template);
  if (user.can_discount) legacy.actions.discount = true;
  if (user.can_delete_customer) legacy.actions.delete_customer = true;
  if (user.can_edit_product_price) legacy.actions.edit_prices = true;
  if (user.can_cancel_order) legacy.actions.cancel_order = true;
  return { ...legacy, is_owner: false };
}

export function can(user, section, level = "view") {
  const perms = user?._perms || effectivePermissions(user);
  return RANK[perms.sections[section] || "none"] >= RANK[level];
}

export function canAction(user, action) {
  const perms = user?._perms || effectivePermissions(user);
  return perms.actions[action] === true;
}

export function canAny(user, checks) {
  return checks.some(([section, level]) => can(user, section, level));
}

const DENIED = "ما عندك صلاحية لهذا القسم.";
const VIEW_ONLY = "صلاحيتك على هذا القسم مشاهدة فقط.";

// يتطلب مستوى معيّن على قسم
export function requirePerm(section, level = "view") {
  return (req, res, next) => {
    if (can(req.user, section, level)) return next();
    const message = level === "edit" && can(req.user, section, "view") ? VIEW_ONLY : DENIED;
    return res.status(403).json({ error: message });
  };
}

// القراءة بدها «متفرج»، وأي تغيير بده «تعديل»
export function gate(section) {
  return (req, res, next) => {
    const level = req.method === "GET" || req.method === "HEAD" ? "view" : "edit";
    return requirePerm(section, level)(req, res, next);
  };
}

export function requireAction(action, message) {
  return (req, res, next) => {
    if (canAction(req.user, action)) return next();
    return res.status(403).json({ error: message || "ما عندك صلاحية لهذا الإجراء." });
  };
}

export function requireOwner(req, res, next) {
  if (req.user?.role === "super_admin") return next();
  return res.status(403).json({ error: "هذا الإجراء للمدير العام فقط." });
}
