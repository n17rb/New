import { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, CircleMarker, Circle, Popup } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { api } from "../api.js";

// خريطة كثافة الزباين: كل زبون بيرسم هالة خفيفة، ووين ما الهالات تتراكب بتغمق = كثافة أعلى
export default function CustomersMap() {
  const [customers, setCustomers] = useState(null);
  const [error, setError] = useState("");
  const [mode, setMode] = useState("heat");

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
  if (!customers) return <div className="page"><p className="text-secondary">جاري التحميل...</p></div>;
  if (customers.length === 0) return <div className="page"><p className="text-secondary">لا يوجد عملاء عندهم موقع محفوظ بعد.</p></div>;

  const lat = customers.reduce((s, c) => s + Number(c.latitude), 0) / customers.length;
  const lon = customers.reduce((s, c) => s + Number(c.longitude), 0) / customers.length;
  const max = regions[0]?.[1] || 1;

  return (
    <div className="page">
      <h1 className="title-lg">خريطة كثافة الزباين</h1>
      <p className="text-secondary" style={{ marginBottom: 12 }}>
        {customers.length} زبون عندهم موقع محفوظ — الأماكن الأغمق فيها زباين أكثر، عشان تعرف وين تتوسع.
      </p>

      <div className="seg" style={{ marginBottom: 10 }}>
        <button className={mode === "heat" ? "on" : ""} onClick={() => setMode("heat")}>كثافة</button>
        <button className={mode === "dots" ? "on" : ""} onClick={() => setMode("dots")}>نقاط</button>
      </div>

      <div style={{ height: 420, borderRadius: 14, overflow: "hidden" }}>
        <MapContainer center={[lat, lon]} zoom={12} style={{ height: "100%", width: "100%" }}>
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap" />
          {mode === "heat" && customers.map((c) => (
            <Circle
              key={`h${c.id}`}
              center={[c.latitude, c.longitude]}
              radius={420}
              pathOptions={{ stroke: false, fillColor: "#FF4D2E", fillOpacity: 0.14 }}
            />
          ))}
          {customers.map((c) => (
            <CircleMarker
              key={c.id}
              center={[c.latitude, c.longitude]}
              radius={mode === "heat" ? 3 : 6}
              pathOptions={{ color: "#ffffff", weight: 1, fillColor: "#0A66F5", fillOpacity: mode === "heat" ? 0.9 : 0.7 }}
            >
              <Popup>{c.name}{c.region_name ? ` — ${c.region_name}` : ""}</Popup>
            </CircleMarker>
          ))}
        </MapContainer>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <h2 className="title-md" style={{ marginTop: 0 }}>الزباين حسب المنطقة</h2>
        {regions.map(([name, count]) => (
          <div key={name} style={{ marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.9rem", marginBottom: 4 }}>
              <span style={{ fontWeight: 600 }}>{name}</span>
              <span className="tabular-num text-secondary">{count} زبون</span>
            </div>
            <div style={{ height: 8, borderRadius: 99, background: "var(--bg)", overflow: "hidden" }}>
              <div style={{ width: `${Math.max(4, (count / max) * 100)}%`, height: "100%", borderRadius: 99, background: "linear-gradient(90deg, #FF8A3D, #FF4D2E)" }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
