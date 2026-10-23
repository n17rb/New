import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { query } from "../db.js";
import { resolveCoordsFromMapsLink, isValidLatLon } from "../utils/routing.js";

const router = Router();
router.use(requireAuth);

router.post("/resolve-link", async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "الرابط مطلوب." });

  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });
    res.json({ resolved_url: response.url });
  } catch (err) {
    res.status(400).json({ error: "تعذّر فتح الرابط للتحقق من الإحداثيات." });
  }
});

// ============================================================
// خريطة جوجل الحقيقية (Map Tiles API) — نفس شكل خرائط جوجل، بلون فاتح مريح
// المفتاح: GOOGLE_MAPS_KEY بـRender (فعّل «Map Tiles API» بنفس مشروع جوجل، وقيّد المفتاح على دومين التطبيق)
// ============================================================
const MAP_STYLE = [
  { featureType: "poi.business", stylers: [{ visibility: "off" }] },
  { featureType: "poi", elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#cfe6f7" }] },
  { featureType: "landscape", elementType: "geometry", stylers: [{ color: "#f5f8fb" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#ffffff" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#e4eef8" }] },
];
let mapSession = null;
router.get("/map-session", async (req, res) => {
  const key = process.env.GOOGLE_MAPS_KEY;
  if (!key) return res.json({ enabled: false });
  if (mapSession && Date.now() < mapSession.until) return res.json({ enabled: true, key, session: mapSession.session });
  try {
    const r = await fetch(`https://tile.googleapis.com/v1/createSession?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mapType: "roadmap", language: "ar", region: "JO", scale: "scaleFactor2x", highDpi: true, styles: MAP_STYLE }),
    });
    const j = await r.json();
    if (!j.session) {
      console.error("map session:", r.status, j?.error?.message || "");
      return res.json({ enabled: false });
    }
    // الجلسة بتعيش أسبوعين — منجدّدها قبل بيوم
    const exp = Number(j.expiry) * 1000 || Date.now() + 13 * 86400000;
    mapSession = { session: j.session, until: exp - 86400000 };
    res.json({ enabled: true, key, session: j.session });
  } catch (e) {
    res.json({ enabled: false });
  }
});

// ============================================================
// معلومات المكان: من موقع (إحداثيات) أو رابط خرائط ← المحافظة واسم المنطقة
// وبيطابقها مع مناطق المحل الموجودة (أو بيقترح منطقة جديدة)
// ============================================================
const placeCache = new Map();

// توحيد الكتابة العربية للمقارنة: ة/ه، ى/ي، أ/إ/آ/ا، وبدون «ال» وبدون مسافات زيادة
export function normArabic(s) {
  return String(s || "")
    .replace(/[\u064B-\u0652\u0640]/g, "")
    .replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي")
    .replace(/^(حي|منطقه|منطقة|ضاحيه|ضاحية)\s+/, "")
    .split(/\s+/).map((w) => w.replace(/^ال(?=..)/, "")).join(" ")
    .trim();
}

export function matchRegion(regions, candidates) {
  for (const cand of candidates) {
    const c = normArabic(cand);
    if (c.length < 2) continue;
    const exact = regions.find((r) => normArabic(r.name) === c);
    if (exact) return exact;
    const part = regions.find((r) => {
      const n = normArabic(r.name);
      return n.length >= 3 && c.length >= 3 && (n.includes(c) || c.includes(n));
    });
    if (part) return part;
  }
  return null;
}

async function reverseGeocode(lat, lon) {
  const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  if (placeCache.has(key)) return placeCache.get(key);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=17&addressdetails=1&accept-language=ar`,
      { headers: { "User-Agent": "MojWaterApp/1.0 (water shop management)", "Accept-Language": "ar" }, signal: ctrl.signal }
    );
    const j = await r.json();
    const a = j?.address || {};
    const out = {
      governorate: a.state || a.province || a.region || null,
      areas: [a.neighbourhood, a.suburb, a.quarter, a.residential, a.village, a.town, a.hamlet, a.city_district, a.district, a.city].filter(Boolean),
      street: a.road || null,
    };
    if (placeCache.size > 2000) placeCache.clear();
    placeCache.set(key, out);
    return out;
  } catch {
    return { governorate: null, areas: [], street: null };
  } finally {
    clearTimeout(timer);
  }
}

export async function placeInfo({ latitude, longitude, url }) {
  let lat = latitude != null ? Number(latitude) : null;
  let lon = longitude != null ? Number(longitude) : null;
  if ((lat == null || lon == null || !isValidLatLon(lat, lon)) && url) {
    const c = await resolveCoordsFromMapsLink(String(url));
    if (c) { lat = c.lat; lon = c.lon; }
  }
  if (lat == null || lon == null || !isValidLatLon(lat, lon)) return null;
  const g = await reverseGeocode(lat, lon);
  const regions = (await query("SELECT id, name FROM regions WHERE status = 'active'")).rows;
  const match = matchRegion(regions, g.areas);
  // اسم المنطقة المقترح: أدق اسم (الحي) — بدون «محافظة/لواء»
  const suggested = (g.areas.find((x) => !/^(محافظة|لواء|قضاء)/.test(x)) || null);
  return {
    latitude: lat,
    longitude: lon,
    maps_url: `https://www.google.com/maps?q=${lat},${lon}`,
    governorate: g.governorate,
    street: g.street,
    region_id: match?.id || null,
    region_name: match?.name || suggested,
    region_is_new: !match && !!suggested,
  };
}

router.post("/place", async (req, res) => {
  const { latitude, longitude, url } = req.body || {};
  const info = await placeInfo({ latitude, longitude, url });
  if (!info) return res.status(400).json({ error: "ما قدرت أعرف الموقع من هالرابط — جرّب «موقعي الحالي» أو انسخ الرابط من زر «مشاركة» بخرائط جوجل." });
  res.json(info);
});

export default router;
