import { TileLayer } from "react-leaflet";

// خريطة OpenStreetMap العادية (زي ما كانت من الأول)
export const MAP_COLORS = { blue: "#0A66F5", navy: "#0846B8", done: "#1F9D55", fail: "#D64545", muted: "#8A9BB0" };

export default function MapTiles() {
  return <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap" />;
}

// دبوس مرقّم بشكل موج
export function pinHtml(label, color = MAP_COLORS.blue, size = 28) {
  return `<div style="background:${color};color:#fff;width:${size}px;height:${size}px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:${Math.round(size * 0.45)}px;border:2.5px solid #fff;box-shadow:0 3px 10px rgba(8,40,110,.35);font-family:inherit">${label}</div>`;
}
