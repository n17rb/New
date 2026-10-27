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

// ============================================================
// أيقونات الخريطة: السيارة والمحل (بدل الإيموجي)
// ============================================================
const TRUCK_SVG = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="5" width="14" height="11" rx="1.5"/><path d="M15 9h4l3 3.5V16h-7z"/><circle cx="6" cy="18" r="2" fill="#fff"/><circle cx="18" cy="18" r="2" fill="#fff"/></svg>`;
const SHOP_SVG = `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9.5 4.5 4h15L21 9.5"/><path d="M3 9.5a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0"/><path d="M5 12.5V20h14v-7.5"/><path d="M10 20v-4h4v4"/></svg>`;

export const CAR_COLOR = "#FF8A00";

// سيارة: دائرة برتقالية فيها شاحنة، وحولها نبض خفيف
export function carIconHtml({ label = "", stale = false } = {}) {
  return `<div class="mpin-car${stale ? " stale" : ""}"><div class="mpin-car-b">${TRUCK_SVG}</div>${label ? `<div class="mpin-label">${label}</div>` : ""}</div>`;
}
export const CAR_ICON_SIZE = [40, 40];
export const CAR_ICON_ANCHOR = [20, 20];

// المحل: دبوس كحلي فيه محل
export function shopIconHtml(label = "") {
  return `<div class="mpin-shop"><div class="mpin-shop-b"><span>${SHOP_SVG}</span></div>${label ? `<div class="mpin-label">${label}</div>` : ""}</div>`;
}
export const SHOP_ICON_SIZE = [40, 48];
export const SHOP_ICON_ANCHOR = [20, 46];
