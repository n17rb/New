import { useEffect, useRef, useState } from "react";
import { MapContainer, Marker, Popup, Polyline, useMap } from "react-leaflet";
import MapTiles, { MAP_COLORS, pinHtml, carIconHtml, shopIconHtml, CAR_ICON_SIZE, CAR_ICON_ANCHOR, SHOP_ICON_SIZE, SHOP_ICON_ANCHOR } from "./MapTiles.jsx";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { api } from "../api.js";

function numberIcon(label, color) {
  return L.divIcon({
    className: "",
    html: pinHtml(label, color, 28),
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

const carIcon = L.divIcon({ className: "", html: carIconHtml(), iconSize: CAR_ICON_SIZE, iconAnchor: CAR_ICON_ANCHOR });
const shopIcon = L.divIcon({ className: "", html: shopIconHtml(), iconSize: SHOP_ICON_SIZE, iconAnchor: SHOP_ICON_ANCHOR });

// أول مرة بس: بنظبط الخريطة على كل النقاط. بعدها التقريب والتحريك إلك — ما بيرجع لحاله
function FitOnce({ points }) {
  const map = useMap();
  const done = useRef(false);
  useEffect(() => {
    if (done.current || points.length === 0) return;
    done.current = true;
    if (points.length === 1) map.setView(points[0], 15);
    else map.fitBounds(L.latLngBounds(points), { padding: [30, 30], maxZoom: 16 });
  }, [points.length]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

// «تابع السيارة»: الخريطة بتمشي مع السيارة (بنفس التقريب اللي اخترته)
function Follow({ pos, on }) {
  const map = useMap();
  useEffect(() => {
    if (on && pos) map.panTo(pos, { animate: true, duration: 0.8 });
  }, [on, pos?.[0], pos?.[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

// حركة ناعمة للسيارة بين موقعين بدل ما تنط
function SmoothCar({ pos }) {
  const ref = useRef(null);
  const last = useRef(pos);
  useEffect(() => {
    const m = ref.current;
    if (!m || !pos) return;
    const from = last.current || pos;
    last.current = pos;
    const start = performance.now();
    const dur = 1200;
    let raf;
    const step = (t) => {
      const k = Math.min(1, (t - start) / dur);
      m.setLatLng([from[0] + (pos[0] - from[0]) * k, from[1] + (pos[1] - from[1]) * k]);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [pos?.[0], pos?.[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!pos) return null;
  return (
    <Marker ref={ref} position={last.current || pos} icon={carIcon} zIndexOffset={1000}>
      <Popup>موقع السائق الحالي</Popup>
    </Marker>
  );
}

export default function RoutePreviewMap({ stops, driverLocation, showDriverMarker, routeGeometry, shopLocation, tripId = null }) {
  const [live, setLive] = useState(null); // [lat, lng] — أحدث من اللي إجا مع الرحلة
  const [follow, setFollow] = useState(false);

  // موقع السيارة لحظة بلحظة (كل ٣ ثواني) بدون ما تنعاد الخريطة
  useEffect(() => {
    if (!tripId || !showDriverMarker) return;
    let alive = true;
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      api.getTripLive(tripId).then((r) => {
        if (alive && r?.lat != null) setLive((p) => (p && p[0] === r.lat && p[1] === r.lng ? p : [r.lat, r.lng]));
      }).catch(() => {});
    };
    tick();
    const id = setInterval(tick, 3000);
    return () => { alive = false; clearInterval(id); };
  }, [tripId, showDriverMarker]);

  const visibleStops = stops
    .map((s, i) => ({ ...s, originalIndex: i + 1 }))
    .filter((s) => !s.delivered_at && s.latitude != null && s.longitude != null);

  const shop = shopLocation && shopLocation.lat != null ? [shopLocation.lat, shopLocation.lon] : null;
  const carPos = live || (driverLocation ? [driverLocation.lat, driverLocation.lng] : null);

  if (visibleStops.length === 0 && !carPos && !shop) return null;

  const center = visibleStops[0] ? [visibleStops[0].latitude, visibleStops[0].longitude] : carPos || shop;
  const fitPoints = [
    ...visibleStops.map((s) => [s.latitude, s.longitude]),
    ...(shop ? [shop] : []),
    ...(showDriverMarker && carPos ? [carPos] : []),
  ];

  const polylinePoints = Array.isArray(routeGeometry) ? routeGeometry.map(([lon, lat]) => [lat, lon]) : null;

  return (
    <div style={{ height: 280, borderRadius: 16, overflow: "hidden", marginBottom: 12, position: "relative" }} className="map-frame">
      <MapContainer center={center} zoom={13} style={{ height: "100%", width: "100%" }} scrollWheelZoom={false}>
        <MapTiles />
        <FitOnce points={fitPoints} />
        {showDriverMarker && <Follow pos={carPos} on={follow} />}

        {polylinePoints && (
          <Polyline positions={polylinePoints} pathOptions={{ color: MAP_COLORS.blue, weight: 5, opacity: 0.85, lineJoin: "round" }} />
        )}

        {visibleStops.map((s) => {
          const color = s.order_status === "FAILED" ? MAP_COLORS.fail : s.order_status === "CANCELLED" ? MAP_COLORS.muted : MAP_COLORS.blue;
          return (
            <Marker key={s.id} position={[s.latitude, s.longitude]} icon={numberIcon(s.originalIndex, color)}>
              <Popup>{s.originalIndex}. {s.customer_name}</Popup>
            </Marker>
          );
        })}
        {shop && (
          <Marker position={shop} icon={shopIcon}>
            <Popup>المحل — نهاية الرحلة</Popup>
          </Marker>
        )}
        {showDriverMarker && <SmoothCar pos={carPos} />}
      </MapContainer>
      {showDriverMarker && carPos && (
        <button type="button" className={`map-follow${follow ? " on" : ""}`} onClick={() => setFollow((v) => !v)}>
          {follow ? "● بتابع السيارة" : "تابع السيارة"}
        </button>
      )}
    </div>
  );
}
