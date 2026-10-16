import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { can } from "../permissions.js";
import { logActivity, query } from "../db.js";
import { getShopLocation, setShopLocation, resolveCoordsFromMapsLink, isValidLatLon } from "../utils/routing.js";

const router = Router();
router.use(requireAuth);

function isPrivileged(user) {
  return can(user, "settings", "edit");
}

// ============================================================
// نصوص رسائل الزباين (واتساب): المدير بيعدّلها وبتنحفظ للمحل كله
// ============================================================
const MESSAGE_KEYS = ["receipt", "on_my_way", "invoice", "debt_reminder", "statement", "coupons_added", "coupons_low", "forecast_reminder", "win_back", "bottles_collect"];

async function readTemplates() {
  const r = await query("SELECT value FROM app_settings WHERE key = 'message_templates'");
  try {
    const obj = JSON.parse(r.rows[0]?.value || "{}");
    return Object.fromEntries(Object.entries(obj).filter(([k, v]) => MESSAGE_KEYS.includes(k) && typeof v === "string" && v.trim()));
  } catch {
    return {};
  }
}

router.get("/messages", async (req, res) => {
  res.json({ templates: await readTemplates() });
});

router.put("/messages", async (req, res) => {
  if (!isPrivileged(req.user) && req.user.role !== "super_admin") return res.status(403).json({ error: "تعديل نصوص الرسائل للإدارة بس." });
  const incoming = req.body?.templates;
  if (!incoming || typeof incoming !== "object") return res.status(400).json({ error: "بيانات غير صحيحة." });
  const current = await readTemplates();
  for (const [k, v] of Object.entries(incoming)) {
    if (!MESSAGE_KEYS.includes(k)) continue;
    if (v == null || String(v).trim() === "") delete current[k]; // رجوع للنص الأصلي
    else current[k] = String(v).slice(0, 2000);
  }
  await query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ('message_templates', $1, now())
     ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = now()`,
    [JSON.stringify(current)]
  );
  await logActivity({ userId: req.user.id, action: "UPDATE_MESSAGE_TEMPLATES", recordType: "settings", recordId: null, newValue: Object.keys(incoming) });
  res.json({ templates: current });
});

router.get("/shop-location", async (req, res) => {
  const shop = await getShopLocation();
  res.json(shop ? { latitude: shop.lat, longitude: shop.lon } : null);
});

// بيقبل إحداثيات مباشرة، أو رابط خرائط جوجل (حتى المختصر)
router.put("/shop-location", async (req, res) => {
  if (!isPrivileged(req.user)) return res.status(403).json({ error: "ما عندك صلاحية تعديل إعدادات المحل." });

  const { latitude, longitude, maps_url } = req.body || {};
  let lat = latitude != null ? Number(latitude) : null;
  let lon = longitude != null ? Number(longitude) : null;

  if ((lat == null || lon == null) && maps_url) {
    const coords = await resolveCoordsFromMapsLink(maps_url);
    if (!coords) {
      return res.status(400).json({ error: "ما قدرت أطلع الموقع من هذا الرابط. افتح الموقع بخرائط جوجل، اضغط مطوّل على مكان المحل، وانسخ الأرقام اللي بتطلع (مثل 31.97, 35.85)." });
    }
    lat = coords.lat;
    lon = coords.lon;
  }

  if (!isValidLatLon(lat, lon)) return res.status(400).json({ error: "الموقع غير صحيح." });

  await setShopLocation(lat, lon);
  await logActivity({
    userId: req.user.id,
    action: "SET_SHOP_LOCATION",
    recordType: "settings",
    recordId: null,
    newValue: { latitude: lat, longitude: lon },
  });
  res.json({ latitude: lat, longitude: lon, message: "تم حفظ موقع المحل ✓ — كل الرحلات رح تخلص فيه." });
});

export default router;
