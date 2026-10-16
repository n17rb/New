import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FiChevronLeft } from "react-icons/fi";
import { api } from "../api.js";

const dayKey = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Amman" }).format(new Date(d));
const dayTitle = (k) => {
  const today = dayKey(new Date());
  const y = dayKey(new Date(Date.now() - 86400000));
  if (k === today) return "اليوم";
  if (k === y) return "مبارح";
  return new Date(`${k}T12:00:00Z`).toLocaleDateString("ar-JO", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
};
const clock = (d) => new Date(d).toLocaleTimeString("ar-JO", { timeZone: "Asia/Amman", hour: "numeric", minute: "2-digit" });

// رسمة صغيرة لشكل الرحلة (ترتيب التوقفات)
function RouteSketch({ points }) {
  if (!points || points.length < 2) return <div className="sketch empty">🚚</div>;
  const lats = points.map((p) => p[0]), lons = points.map((p) => p[1]);
  const [a, b, c, d] = [Math.min(...lats), Math.max(...lats), Math.min(...lons), Math.max(...lons)];
  const span = Math.max(b - a, (d - c) * 0.85, 0.002);
  const P = (p) => [6 + ((p[1] - c) / (span / 0.85)) * 52 + (52 - ((d - c) / (span / 0.85)) * 52) / 2, 6 + ((b - p[0]) / span) * 52 + (52 - ((b - a) / span) * 52) / 2];
  const pts = points.map(P);
  return (
    <svg className="sketch" viewBox="0 0 64 64" aria-hidden="true">
      <polyline points={pts.map((p) => p.join(",")).join(" ")} fill="none" stroke="var(--primary)" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
      {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={i === 0 ? 3.2 : 2.4} fill={i === 0 ? "var(--navy)" : "var(--surface)"} stroke="var(--primary)" strokeWidth="1.5" />)}
    </svg>
  );
}

export default function TripArchive() {
  const navigate = useNavigate();
  const [trips, setTrips] = useState(null);
  const [driver, setDriver] = useState("all");
  const [error, setError] = useState("");

  useEffect(() => { api.getTripArchive().then(setTrips).catch((err) => setError(err.message)); }, []);

  const drivers = useMemo(() => {
    const m = new Map();
    (trips || []).forEach((t) => m.set(t.driver_id, t.driver_name || "كابتن"));
    return [...m.entries()];
  }, [trips]);

  const groups = useMemo(() => {
    const list = (trips || []).filter((t) => driver === "all" || String(t.driver_id) === driver);
    const g = new Map();
    for (const t of list) {
      const k = dayKey(t.completed_at);
      if (!g.has(k)) g.set(k, []);
      g.get(k).push(t);
    }
    return [...g.entries()];
  }, [trips, driver]);

  return (
    <div className="page">
      <h1 className="title-lg">أرشيف الرحلات</h1>
      <p className="text-secondary" style={{ marginTop: -6, marginBottom: 12 }}>كل رحلة مكتملة — اضغط عليها تشوفها على الخريطة: كيف ترتّبت، ووين مشي الكابتن، ومتى سلّم كل زبون.</p>
      {error && <div className="error-box">{error}</div>}

      {drivers.length > 1 && (
        <div className="chip-row">
          <button className={`chip${driver === "all" ? " on" : ""}`} onClick={() => setDriver("all")}>الكل</button>
          {drivers.map(([id, name]) => (
            <button key={id} className={`chip${driver === String(id) ? " on" : ""}`} onClick={() => setDriver(String(id))}>{name}</button>
          ))}
        </div>
      )}

      {!trips && <div className="skeleton" style={{ height: 200 }} />}
      {trips && trips.length === 0 && <div className="card text-secondary">لا يوجد رحلات مكتملة بعد.</div>}

      {groups.map(([k, list]) => (
        <div key={k}>
          <div className="section-title">{dayTitle(k)} <span className="text-secondary" style={{ fontWeight: 500 }}>· {list.length} {list.length === 1 ? "رحلة" : "رحلات"}</span></div>
          <div className="list-group">
            {list.map((t) => {
              const mins = t.started_at ? Math.round((new Date(t.completed_at) - new Date(t.started_at)) / 60000) : null;
              return (
                <button key={t.id} className="list-row trip-arch-row" onClick={() => navigate(`/trip-archive/${t.id}`)}>
                  <RouteSketch points={t.points} />
                  <span className="list-text">
                    <span className="list-title">{t.driver_name || "كابتن"} <span className="text-secondary" style={{ fontWeight: 500, fontSize: "0.8rem" }}>· {clock(t.started_at || t.completed_at)}</span></span>
                    <div className="list-sub tabular-num">
                      {t.delivered_count}/{t.total_stops} تسليم · {Number(t.total_distance_km || 0).toFixed(1)} كم{mins != null ? ` · ${mins} د` : ""}{t.bottles ? ` · ${t.bottles} قارورة` : ""}
                    </div>
                    {t.regions?.length > 0 && <div className="list-sub">{t.regions.slice(0, 3).join("، ")}{t.regions.length > 3 ? "…" : ""}</div>}
                  </span>
                  <FiChevronLeft className="list-chevron" aria-hidden="true" />
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
