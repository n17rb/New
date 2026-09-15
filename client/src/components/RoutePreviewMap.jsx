import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

function numberIcon(label, color) {
  return L.divIcon({
    className: "",
    html: `<div style="background:${color};color:#fff;width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.4)">${label}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

export default function RoutePreviewMap({ stops, driverLocation, showDriverMarker }) {
  const visibleStops = stops
    .map((s, i) => ({ ...s, originalIndex: i + 1 }))
    .filter((s) => !s.delivered_at && s.latitude != null && s.longitude != null);

  if (visibleStops.length === 0 && !driverLocation) return null;

  const center = visibleStops[0]
    ? [visibleStops[0].latitude, visibleStops[0].longitude]
    : [driverLocation.lat, driverLocation.lng];

  return (
    <div style={{ height: 280, borderRadius: 10, overflow: "hidden", marginBottom: 12 }}>
      <MapContainer
        key={driverLocation ? `${driverLocation.lat.toFixed(4)}-${driverLocation.lng.toFixed(4)}` : "static"}
        center={center}
        zoom={13}
        style={{ height: "100%", width: "100%" }}
        scrollWheelZoom={false}
      >
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap" />
        {visibleStops.map((s) => {
          const color = s.order_status === "FAILED" ? "#C1443C" : s.order_status === "CANCELLED" ? "#6B7B80" : "#0094FF";
          return (
            <Marker key={s.id} position={[s.latitude, s.longitude]} icon={numberIcon(s.originalIndex, color)}>
              <Popup>{s.originalIndex}. {s.customer_name}</Popup>
            </Marker>
          );
        })}
        {showDriverMarker && driverLocation && (
          <Marker position={[driverLocation.lat, driverLocation.lng]} icon={numberIcon("🚚", "#B8862E")}>
            <Popup>موقع السائق الحالي</Popup>
          </Marker>
        )}
      </MapContainer>
    </div>
  );
}
