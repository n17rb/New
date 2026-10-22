import { useEffect, useState } from "react";
import { TileLayer } from "react-leaflet";
import { request } from "../api.js";

// ============================================================
// خريطة جوجل الحقيقية (إذا مفتاح جوجل مركّب على السيرفر)، وإلا OpenStreetMap زي قبل
// ============================================================
export const MAP_COLORS = { blue: "#0A66F5", navy: "#0846B8", done: "#1F9D55", fail: "#D64545", muted: "#8A9BB0" };

let sessionPromise = null;
function googleSession() {
  if (!sessionPromise) {
    sessionPromise = request("/geocode/map-session")
      .then((r) => (r?.enabled ? r : null))
      .catch(() => { sessionPromise = null; return null; });
  }
  return sessionPromise;
}

export default function MapTiles() {
  const [g, setG] = useState(undefined); // undefined = عم بنشيك، null = بدون جوجل
  useEffect(() => { let on = true; googleSession().then((r) => on && setG(r)); return () => { on = false; }; }, []);
  if (g === undefined) return null;
  if (g) {
    return (
      <TileLayer
        key="google"
        url={`https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session=${g.session}&key=${g.key}`}
        attribution="خرائط Google"
        maxZoom={21}
        tileSize={256}
      />
    );
  }
  return <TileLayer key="osm" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap" />;
}

// دبوس مرقّم بشكل موج
export function pinHtml(label, color = MAP_COLORS.blue, size = 28) {
  return `<div style="background:${color};color:#fff;width:${size}px;height:${size}px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:${Math.round(size * 0.45)}px;border:2.5px solid #fff;box-shadow:0 3px 10px rgba(8,40,110,.35);font-family:inherit">${label}</div>`;
}
