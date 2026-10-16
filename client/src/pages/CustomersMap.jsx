import { useEffect, useMemo, useState } from "react";
import { MapContainer, CircleMarker, Popup } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { api } from "../api.js";
import MapTiles, { MAP_COLORS } from "../components/MapTiles.jsx";

export default function CustomersMap() {
  const [customers, setCustomers] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.getAllCustomerLocations().then(setCustomers).catch((err) => setError(err.message));
  }, []);

  const regions = useMemo(() => {
    if (!customers) return [];
    const m = new Map();
    for (const c of customers) {
      const k = c.region_name || "بدون منطقة";
      m.set(k, (m.get(k) || 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [customers]);

  if (error) return <div className="page"><div className="error-box">{error}</div></div>;
  if (!customers) return <div className="page"><h1 className="title-lg">خريطة العملاء</h1><div className="skeleton" style={{ height: 420 }} /></div>;
  if (customers.length === 0) return <div className="page"><p className="text-secondary">لا يوجد عملاء عندهم موقع محفوظ بعد.</p></div>;

  const lat = customers.reduce((s, c) => s + Number(c.latitude), 0) / customers.length;
  const lon = customers.reduce((s, c) => s + Number(c.longitude), 0) / customers.length;
  const max = regions[0]?.[1] || 1;

  return (
    <div className="page">
      <h1 className="title-lg">خريطة العملاء</h1>
      <p className="text-secondary" style={{ marginBottom: 12 }}>
        {customers.length} عميل عندهم موقع محفوظ — شوف وين زباينك متجمّعين عشان تقرر وين تتوسع.
      </p>

      <div className="map-frame" style={{ height: 440 }}>
        <MapContainer center={[lat, lon]} zoom={12} style={{ height: "100%", width: "100%" }}>
          <MapTiles />
          {customers.map((c) => (
            <CircleMarker
              key={c.id}
              center={[c.latitude, c.longitude]}
              radius={6}
              pathOptions={{ color: "#ffffff", weight: 1.5, fillColor: MAP_COLORS.blue, fillOpacity: 0.85 }}
            >
              <Popup>{c.name}{c.region_name ? ` — ${c.region_name}` : ""}</Popup>
            </CircleMarker>
          ))}
        </MapContainer>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <h2 className="title-md" style={{ marginTop: 0 }}>الزباين حسب المنطقة</h2>
        {regions.map(([name, count]) => (
          <div key={name} className="region-bar">
            <div className="region-bar-h">
              <span>{name}</span>
              <span className="tabular-num text-secondary">{count} زبون</span>
            </div>
            <div className="region-bar-track"><div style={{ width: `${Math.max(4, (count / max) * 100)}%` }} /></div>
          </div>
        ))}
      </div>
    </div>
  );
}
