import { useEffect, useState } from "react";
import { api } from "../api.js";

export default function DriverPerformance() {
  const [drivers, setDrivers] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.getDriverPerformance().then(setDrivers).catch((err) => setError(err.message));
  }, []);

  return (
    <div className="page">
      <h1 className="title-lg">أداء السائقين</h1>
      {error && <div className="error-box">{error}</div>}

      {!drivers && <p className="text-secondary">جاري التحميل...</p>}
      {drivers && drivers.length === 0 && <p className="text-secondary">لا يوجد سائقين بعد.</p>}

      {drivers && drivers.map((d) => (
        <div key={d.id} className="card">
          <h2 className="title-md">{d.full_name}</h2>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
            <span className="text-secondary">عدد الرحلات المكتملة</span>
            <span className="tabular-num" style={{ fontWeight: 700 }}>{d.trips_count}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
            <span className="text-secondary">إجمالي الطلبات المسلَّمة</span>
            <span className="tabular-num" style={{ fontWeight: 700, color: "var(--success)" }}>{d.delivered_count}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
            <span className="text-secondary">طلبات تعذر تسليمها</span>
            <span className="tabular-num" style={{ fontWeight: 700, color: "var(--urgent)" }}>{d.failed_count}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
            <span className="text-secondary">إجمالي المسافة المقطوعة</span>
            <span className="tabular-num" style={{ fontWeight: 700 }}>{d.total_distance_km.toFixed(1)} كم</span>
          </div>
        </div>
      ))}
    </div>
  );
}
