import { TileLayer } from "react-leaflet";

// خريطة بألوان هادية بتمشي مع ثيم موج (فاتح/ليلي)
export const MAP_COLORS = { blue: "#0A66F5", navy: "#0846B8", done: "#1F9D55", fail: "#D64545", muted: "#8A9BB0" };

export default function MapTiles() {
  const dark = typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "dark";
  return (
    <TileLayer
      key={dark ? "dark" : "light"}
      url={dark
        ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        : "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"}
      subdomains="abcd"
      maxZoom={20}
      attribution='&copy; OpenStreetMap &copy; CARTO'
    />
  );
}

// دبوس مرقّم بشكل موج
export function pinHtml(label, color = MAP_COLORS.blue, size = 28) {
  return `<div style="background:${color};color:#fff;width:${size}px;height:${size}px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:${Math.round(size * 0.45)}px;border:2.5px solid #fff;box-shadow:0 3px 10px rgba(8,40,110,.35);font-family:inherit">${label}</div>`;
}
