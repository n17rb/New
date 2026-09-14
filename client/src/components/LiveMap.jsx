import { MapContainer, TileLayer, Marker } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const driverIcon = L.divIcon({
  className: "",
  html: `<div style="background:#0094FF;width:22px;height:22px;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.4)"></div>`,
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

export default function LiveMap({ latitude, longitude }) {
  if (!latitude || !longitude) return null;

  return (
    <div style={{ height: 220, borderRadius: 10, overflow: "hidden", marginBottom: 12 }}>
      <MapContainer
        key={`${latitude.toFixed(4)}-${longitude.toFixed(4)}`}
        center={[latitude, longitude]}
        zoom={15}
        style={{ height: "100%", width: "100%" }}
        scrollWheelZoom={false}
      >
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap" />
        <Marker position={[latitude, longitude]} icon={driverIcon} />
      </MapContainer>
    </div>
  );
}
