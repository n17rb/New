import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { can } from "../permissions.js";
import { logActivity } from "../db.js";
import { getShopLocation, setShopLocation, resolveCoordsFromMapsLink, isValidLatLon } from "../utils/routing.js";

const router = Router();
router.use(requireAuth);

function isPrivileged(user) {
  return can(user, "settings", "edit");
}

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
