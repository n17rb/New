import { useEffect, useState } from "react";
import { MapContainer, TileLayer, CircleMarker, Popup } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { api } from "../api.js";

export default function CustomersMap() {
  const [customers, setCustomers] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.getAllCustomerLocations().then(setCustomers).catch((err) => setError(err.message));
  }, []);

  if (error) return <div className="page"><div className="error-box">{error}</div></div>;
  if (!customers) return <div className="page"><p className="text-secondary">جاري التحميل...</p></div>;
  if (customers.length === 0) return <div className="page"><p className="text-secondary">لا يوجد عملاء عندهم موقع محفوظ بعد.</p></div>;

  const center = [customers[0].latitude, customers[0].longitude];

  return (
    <div className="page">
      <h1 className="title-lg">خريطة العملاء</h1>
      <p className="text-secondary" style={{ marginBottom: 12 }}>
        {customers.length} عميل عندهم موقع محفوظ — شوف الكثافة حسب المنطقة عشان تقرر وين تتوسع.
      </p>

      <div style={{ height: 460, borderRadius: 10, overflow: "hidden" }}>
        <MapContainer center={center} zoom={12} style={{ height: "100%", width: "100%" }}>
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap" />
          {customers.map((c) => (
            <CircleMarker key={c.id} center={[c.latitude, c.longitude]} radius={6} pathOptions={{ color: "#0094FF", fillColor: "#0094FF", fillOpacity: 0.6 }}>
              <Popup>{c.name}{c.region_name ? ` — ${c.region_name}` : ""}</Popup>
            </CircleMarker>
          ))}
        </MapContainer>
      </div>
    </div>
  );
}
