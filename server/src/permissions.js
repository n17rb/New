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
  { key: "debts", label: "ديون العملاء", hint: "مين عليه دين، تسجيل الدفعات وتعديل الدين" },
  { key: "jard", label: "الجرد اليومي", hint: "كم دخل وكم طلع كل يوم، ومين قبض شو", viewOnly: true },
  { key: "payroll", label: "الموظفين والرواتب", hint: "الدوام، الرواتب واليوميات، السحوبات والمستحقات" },
  { key: "coupons", label: "الكوبونات والباقات", hint: "بيع باقات الكوبونات للعملاء وإدارة الباقات" },
  { key: "chat", label: "صندوق رسائل الموظفين", hint: "يقرأ رسائل الموظفين ويرد عليهم باسم الإدارة" },
  { key: "reports", label: "التقارير", hint: "التقارير، أداء الكباتن، نمو العملاء، الخريطة", viewOnly: true },
  { key: "settings", label: "إعدادات المحل", hint: "موقع المحل اللي بتخلص فيه الرحلات" },
  { key: "activity_log", label: "سجل النشاط", hint: "مين عمل شو وإيمتى", viewOnly: true },
  { key: "backup", label: "النسخ الاحتياطي", hint: "تنزيل نسخة من كل البيانات", viewOnly: true },

  // ---------- باقة المصانع (بتظهر بس عند المصنع) ----------
  { key: "f_home", label: "لوحة المالك", hint: "حالة المصنع اليوم والتنبيهات", viewOnly: true, plan: "factory" },
  { key: "f_orders", label: "الطلبات", hint: "تسجيل طلبات الزباين وتعديلها", plan: "factory" },
  { key: "f_dispatch", label: "الحركة والرحلات", hint: "توزيع الطلبات على السيارات، النقل بين السائقين، رسائل التأخير", plan: "factory" },
  { key: "f_drive", label: "تطبيق السائق", hint: "رحلته، التسليم، المصاريف، تسليم الكاش", plan: "factory" },
  { key: "f_customers", label: "الزباين", hint: "بيانات الزباين وأسعارهم وكشف حسابهم", plan: "factory" },
  { key: "f_stock", label: "المستودع", hint: "تحميل السيارات، المرتجع، التالف، الجرد", plan: "factory" },
  { key: "f_production", label: "الإنتاج والمكنات", hint: "الإنتاج اليومي، المواد الخام، أعطال المكنات", plan: "factory" },
  { key: "f_money", label: "الحسابات", hint: "استلام الكاش من السائقين، المصاريف، الديون والتحصيل", plan: "factory" },
  { key: "f_maint", label: "صيانة السيارات", hint: "غيار الزيت، الميكانيك، الكوشوك، البطاريات، ومواعيدها", plan: "factory" },
  { key: "f_machines", label: "المكنات والأعطال", hint: "تشغيل المكنات، الأعطال وإصلاحها", plan: "factory" },
  { key: "f_fleet", label: "الإعدادات", hint: "المنتجات، السيارات، الخطوط، المكنات، شعار المصنع", plan: "factory" },
  { key: "f_reports", label: "التقارير", hint: "المبيعات، التوالف، الديزل، أداء السائقين", viewOnly: true, plan: "factory" },
];

// الأقسام اللي بتنفع للمصنع من أقسام المحل
const FACTORY_SHARED = ["payroll", "activity_log", "backup"];
const SHOP_ONLY_ACTIONS = ["adjust_coupons"];

export const ACTIONS = [
  { key: "discount", label: "إعطاء خصم على طلب" },
  { key: "cancel_order", label: "إلغاء طلب" },
  { key: "delete_customer", label: "حذف عميل" },
  { key: "edit_prices", label: "تعديل أسعار المنتجات" },
  { key: "adjust_coupons", label: "تعديل رصيد كوبونات العميل يدويًا" },
  { key: "give_credit", label: "البيع بالدين (الزبون بيدفع بعدين)" },
  { key: "chat_with_admin", label: "مراسلة الإدارة بالشات" },
  { key: "approve_expense", label: "الموافقة على مصاريف السائقين", plan: "factory" },
  { key: "adjust_stock", label: "تعديل رصيد المستودع يدويًا", plan: "factory" },
  { key: "give_bonus", label: "إعطاء بونص (كراتين ببلاش) يدويًا على الطلب", plan: "factory" },
  { key: "self_attendance", label: "يسجّل حضوره بنفسه («وصلت»)" },
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
      debts: "edit", coupons: "edit", chat: "edit", activity_log: "none", backup: "none", jard: "view", payroll: "edit",
    },
    actions: { discount: true, cancel_order: true, delete_customer: true, edit_prices: true, adjust_coupons: false, give_credit: true, chat_with_admin: true },
  },
  driver: {
    label: "كابتن توصيل",
    sections: {
      dashboard: "none", customers: "edit", orders: "edit", delivery: "edit", trips: "none",
      products: "view", cash: "none", driver_balances: "none", reports: "none", settings: "none",
      debts: "none", coupons: "none", chat: "none", activity_log: "none", backup: "none",
    },
    actions: { discount: false, cancel_order: false, delete_customer: false, edit_prices: false, adjust_coupons: false, give_credit: true, chat_with_admin: true },
  },
  data_entry: {
    label: "موظف إدخال",
    sections: {
      dashboard: "none", customers: "edit", orders: "none", delivery: "none", trips: "none",
      products: "view", cash: "none", driver_balances: "none", reports: "none", settings: "none",
      debts: "none", coupons: "none", chat: "none", activity_log: "none", backup: "none",
    },
    actions: { discount: false, cancel_order: false, delete_customer: false, edit_prices: false, adjust_coupons: false, give_credit: false, chat_with_admin: true },
  },
  viewer: {
    label: "متفرج",
    sections: {
      dashboard: "view", customers: "view", orders: "view", delivery: "none", trips: "view",
      products: "view", cash: "view", driver_balances: "view", reports: "view", settings: "view",
      debts: "view", coupons: "view", chat: "none", activity_log: "none", backup: "none", jard: "view", payroll: "view",
    },
    actions: { discount: false, cancel_order: false, delete_customer: false, edit_prices: false, adjust_coupons: false, give_credit: false, chat_with_admin: true },
  },
};

// قوالب المصنع
const F = (o) => ({ f_home: "none", f_orders: "none", f_dispatch: "none", f_drive: "none", f_customers: "none", f_stock: "none", f_production: "none", f_money: "none", f_fleet: "none", f_reports: "none", f_maint: "none", f_machines: "none", payroll: "none", ...o });
export const FACTORY_TEMPLATES = {
  admin: {
    label: "مدير",
    sections: F({ f_home: "view", f_orders: "edit", f_dispatch: "edit", f_customers: "edit", f_stock: "edit", f_production: "edit", f_money: "edit", f_fleet: "edit", f_reports: "view", f_maint: "edit", f_machines: "edit", payroll: "edit" }),
    actions: { discount: true, give_credit: true, approve_expense: true, adjust_stock: true, give_bonus: true, delete_customer: true, self_attendance: true },
  },
  dispatcher: {
    label: "مسؤول الحركة",
    sections: F({ f_home: "view", f_orders: "edit", f_dispatch: "edit", f_customers: "edit", f_stock: "view" }),
    actions: { give_credit: true },
  },
  driver: {
    label: "سائق",
    sections: F({ f_drive: "edit" }),
    actions: { give_credit: true },
  },
  warehouse: {
    label: "تحميل السيارات والمستودع",
    sections: F({ f_stock: "edit", f_production: "view" }),
    actions: {},
  },
  production: {
    label: "الإنتاج",
    sections: F({ f_production: "edit", f_stock: "view" }),
    actions: {},
  },
  technician: {
    label: "فني صيانة ومشغّل مكنات",
    sections: F({ f_machines: "edit", f_production: "view" }),
    actions: {},
  },
  fleet_maint: {
    label: "صيانة السيارات (زيت، ميكانيك، كوشوك، بطاريات)",
    sections: F({ f_maint: "edit" }),
    actions: {},
  },
  accountant: {
    label: "محاسب",
    sections: F({ f_home: "view", f_money: "edit", f_customers: "view", f_reports: "view", payroll: "edit" }),
    actions: { approve_expense: true },
  },
  viewer: {
    label: "متفرج",
    sections: F({ f_home: "view", f_orders: "view", f_dispatch: "view", f_customers: "view", f_stock: "view", f_production: "view", f_money: "view", f_fleet: "view", f_reports: "view", f_maint: "view", f_machines: "view", payroll: "view" }),
    actions: {},
  },
};

// الأقسام والقوالب اللي بتظهر بشاشة الصلاحيات حسب باقة المشترك
export function permissionsMeta(plan) {
  const factory = plan === "factory";
  return {
    sections: SECTIONS.filter((s) => (factory ? s.plan === "factory" || FACTORY_SHARED.includes(s.key) : s.plan !== "factory")),
    actions: ACTIONS.filter((a) => (factory ? !SHOP_ONLY_ACTIONS.includes(a.key) && (a.plan === "factory" || ["discount", "give_credit", "self_attendance"].includes(a.key)) : a.plan !== "factory")),
    templates: factory ? FACTORY_TEMPLATES : TEMPLATES,
  };
}

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
  // نوع الحساب اللي اختاره المدير (سائق، محاسب…) — بيضل حتى لو عدّل صلاحياته
  const template = typeof input?.template === "string" && /^[a-z_]{1,30}$/.test(input.template) ? input.template : undefined;
  return template ? { sections, actions, template } : { sections, actions };
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
