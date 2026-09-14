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

export default function RoutePreviewMap({ stops, driverLocation }) {
  const withCoords = stops.filter((s) => s.latitude != null && s.longitude != null);
  if (withCoords.length === 0) return null;

  const center = [withCoords[0].latitude, withCoords[0].longitude];

  return (
    <div style={{ height: 260, borderRadius: 10, overflow: "hidden", marginBottom: 12 }}>
      <MapContainer center={center} zoom={13} style={{ height: "100%", width: "100%" }} scrollWheelZoom={false}>
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap" />
        {withCoords.map((s, i) => {
          const color = s.delivered_at ? "#2E7D5B" : s.order_status === "FAILED" ? "#C1443C" : s.order_status === "CANCELLED" ? "#6B7B80" : "#0094FF";
          return (
            <Marker key={s.id} position={[s.latitude, s.longitude]} icon={numberIcon(i + 1, color)}>
              <Popup>{i + 1}. {s.customer_name}</Popup>
            </Marker>
          );
        })}
        {driverLocation && (
          <Marker position={[driverLocation.lat, driverLocation.lng]} icon={numberIcon("🚚", "#B8862E")} />
        )}
      </MapContainer>
    </div>
  );
}
