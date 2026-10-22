import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";

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

export default router;
