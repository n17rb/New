// ============================================================
// ميزات المحل: إضافات بتنفتح لمحل معيّن من لوحة إدارة موج
// (المحل اللي ما إله الميزة ما بيشوفها أبدًا — ولا محل يوسف نفسه إلا إذا فتحها)
// ============================================================
export const FEATURES = [
  { key: "expense_details", label: "تفصيل الصرفيات", hint: "أنواع صرفيات (يومية، أسبوعية، شهرية) بيعدّلها صاحب المحل — بدل رقم واحد" },
  { key: "debt_quick_pay", label: "سداد الديون السريع", hint: "زر «سدّد» بقائمة الديون، وخانة للكابتن يسجّل فيها سداد زبون — وبينحسب بالجرد" },
];

const KEYS = new Set(FEATURES.map((f) => f.key));

export function cleanFeatures(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) if (KEYS.has(k) && v === true) out[k] = true;
  return out;
}

export function hasFeature(tenant, key) {
  return !!tenant?.features?.[key];
}

// حارس للراوترات: الميزة لازم تكون مفتوحة لهالمحل
export function requireFeature(key) {
  return (req, res, next) => {
    if (hasFeature(req.tenant, key)) return next();
    return res.status(403).json({ error: "هاي الميزة مش مفعّلة لمحلك." });
  };
}
