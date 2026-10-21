import { useEffect, useMemo } from "react";
import { MapContainer, Marker, Polyline, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import MapTiles from "../../components/MapTiles.jsx";
import { time } from "../ui.jsx";

// ============================================================
// خريطة الرحلات: المصنع، وكل رحلة خط بلونها من المصنع (أو من مكان السيارة هلأ)
// لزباينها بالترتيب، وعلى كل زبون وقت الوصول المتوقع
// ============================================================
export const TRIP_COLORS = ["#0A66F5", "#1F9D55", "#E8590C", "#9C36B5", "#D6336C", "#0CA678", "#F59F00", "#495057"];

const factoryIcon = L.divIcon({
  className: "",
  iconSize: [46, 46], iconAnchor: [23, 23],
  html: `<div style="width:46px;height:46px;border-radius:14px;background:#0846B8;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;border:3px solid #fff;box-shadow:0 4px 12px rgba(8,40,110,.4);font:700 10px system-ui"><span style="font-size:20px;line-height:1">🏭</span>المصنع</div>`,
});
function carIcon(color, n, heading, stale) {
  const arrow = heading != null
    ? `<div style="position:absolute;inset:-12px;transform:rotate(${heading}deg)"><div style="margin:0 auto;width:0;height:0;border-left:8px solid transparent;border-right:8px solid transparent;border-bottom:12px solid ${color}"></div></div>` : "";
  return L.divIcon({
    className: "", iconSize: [40, 40], iconAnchor: [20, 20],
    html: `<div style="position:relative;width:40px;height:40px">${arrow}<div style="width:40px;height:40px;border-radius:50%;background:${stale ? "#8A9BB0" : color};color:#fff;display:flex;align-items:center;justify-content:center;font:800 16px system-ui;border:3px solid #fff;box-shadow:0 3px 10px rgba(8,40,110,.4)">🚚</div><div style="position:absolute;top:-6px;inset-inline-end:-6px;background:#fff;color:${color};border-radius:10px;font:800 11px system-ui;padding:0 5px;border:1.5px solid ${color}">${n}</div></div>`,
  });
}
function stopIcon(color, label, done, failed) {
  const bg = done ? "#1F9D55" : failed ? "#D64545" : "#fff";
  const fg = done || failed ? "#fff" : color;
  return L.divIcon({
    className: "", iconSize: [26, 26], iconAnchor: [13, 13],
    html: `<div style="width:26px;height:26px;border-radius:50%;background:${bg};color:${fg};border:2.5px solid ${done || failed ? "#fff" : color};display:flex;align-items:center;justify-content:center;font:800 12px system-ui;box-shadow:0 2px 6px rgba(0,0,0,.25)">${label}</div>`,
  });
}

function Fit({ points, key2 }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 1) map.setView(points[0], 12);
    else if (points.length > 1) map.fitBounds(points, { padding: [36, 36], maxZoom: 13 });
  }, [key2]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

export default function TripsMap({ trips, live, factory, selected, onSelect, height = "46vh" }) {
  const liveBy = new Map((live?.vehicles || []).map((v) => [v.id, v]));
  const routes = useMemo(() => trips.filter((t) => ["planned", "active"].includes(t.status)).map((t, i) => {
    const lv = liveBy.get(t.vehicle_id);
    const color = TRIP_COLORS[i % TRIP_COLORS.length];
    const carNow = t.status === "active" && lv?.lat != null ? [lv.lat, lv.lng] : null;
    const stops = t.stops.filter((o) => o.lat != null);
    const open = stops.filter((o) => ["assigned", "onway"].includes(o.status));
    // الخط: من مكان السيارة (أو المصنع إذا لسا ما طلعت) للزباين اللي ضايلين بالترتيب
    const path = [carNow || factory, ...open.map((o) => [o.lat, o.lng])].filter(Boolean);
    return { t, color, lv, carNow, stops, path, num: (t.vehicle_name || "").replace(/\D/g, "") || "•" };
  }), [trips, live, factory]); // eslint-disable-line react-hooks/exhaustive-deps

  const focusRoute = routes.find((r) => r.t.id === selected);
  const pts = focusRoute
    ? [...focusRoute.path, ...focusRoute.stops.map((o) => [o.lat, o.lng])]
    : [factory, ...routes.flatMap((r) => [...r.path, ...r.stops.map((o) => [o.lat, o.lng])])].filter(Boolean);

  return (
    <div className="fx-live-map" style={{ height }}>
      <MapContainer center={factory || [31.95, 35.93]} zoom={10} style={{ height: "100%", width: "100%" }} scrollWheelZoom>
        <MapTiles />
        {factory && <Marker position={factory} icon={factoryIcon} zIndexOffset={500}><Tooltip direction="top" offset={[0, -22]}>المصنع</Tooltip></Marker>}
        {routes.map((r) => {
          const dim = selected && r.t.id !== selected;
          let n = 0;
          return (
            <span key={r.t.id}>
              {r.path.length > 1 && (
                <Polyline positions={r.path} pathOptions={{ color: r.color, weight: dim ? 3 : 5, opacity: dim ? 0.25 : 0.9, dashArray: r.t.status === "active" ? null : "10 8" }}
                  eventHandlers={{ click: () => onSelect(r.t.id) }} />
              )}
              {r.stops.map((o) => {
                const done = o.status === "delivered", failed = o.status === "failed";
                const label = done ? "✓" : failed ? "✗" : ++n;
                const tm = done ? `سلّم ${time(o.delivered_at)}` : failed ? "ما تم" : o.eta_at ? time(o.eta_at) : "";
                return (
                  <Marker key={o.id} position={[o.lat, o.lng]} icon={stopIcon(r.color, label, done, failed)} opacity={dim ? 0.35 : 1}
                    eventHandlers={{ click: () => onSelect(r.t.id) }}>
                    <Tooltip direction="top" offset={[0, -12]} permanent={!dim && !!tm && (!selected || r.t.id === selected)} className="fx-eta-tip">
                      {selected === r.t.id ? `${o.customer_name} · ` : ""}{tm}
                    </Tooltip>
                  </Marker>
                );
              })}
              {r.carNow && (
                <Marker position={r.carNow} icon={carIcon(r.color, r.num, r.lv?.heading, r.lv?.minutes_ago > 15)} zIndexOffset={1000} opacity={dim ? 0.4 : 1}
                  eventHandlers={{ click: () => onSelect(r.t.id) }}>
                  <Tooltip direction="top" offset={[0, -20]}>{r.t.driver_name || r.t.vehicle_name}{r.lv?.minutes_ago != null ? ` · قبل ${r.lv.minutes_ago} د` : ""}</Tooltip>
                </Marker>
              )}
            </span>
          );
        })}
        <Fit points={pts} key2={`${selected || "all"}:${routes.length}:${pts.length}`} />
      </MapContainer>
    </div>
  );
}
