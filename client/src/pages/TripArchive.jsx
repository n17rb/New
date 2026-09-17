import { useEffect, useState } from "react";
import { api } from "../api.js";

export default function TripArchive() {
  const [trips, setTrips] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.getTripArchive().then(setTrips).catch((err) => setError(err.message));
  }, []);

  return (
    <div className="page">
      <h1 className="title-lg">أرشيف الرحلات</h1>
      <p className="text-secondary" style={{ marginBottom: 14 }}>سجل دائم لكل الرحلات المكتملة — لا يُحذف أبدًا.</p>
      {error && <div className="error-box">{error}</div>}

      <div className="card" style={{ padding: 0 }}>
        {!trips && <p className="text-secondary" style={{ padding: 14 }}>جاري التحميل...</p>}
        {trips && trips.length === 0 && <p className="text-secondary" style={{ padding: 14 }}>لا يوجد رحلات مكتملة بعد.</p>}
        {trips && trips.map((t) => (
          <div key={t.id} style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)" }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontWeight: 600 }}>{t.driver_name || "سائق غير معروف"}</span>
              <span className="text-secondary tabular-num" style={{ fontSize: "0.8rem" }}>
                {new Date(t.completed_at).toLocaleDateString("ar-JO", { timeZone: "Asia/Amman" })}
              </span>
            </div>
            <div className="text-secondary tabular-num" style={{ fontSize: "0.85rem", marginTop: 2 }}>
              {t.delivered_count} / {t.total_stops} تم التسليم · {Number(t.total_distance_km || 0).toFixed(1)} كم
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
