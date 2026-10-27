import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { MapContainer, Marker, Polyline, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { FiArrowRight, FiPlay, FiPause, FiClock, FiMapPin, FiCheckCircle, FiXCircle } from "react-icons/fi";
import { api } from "../api.js";
import MapTiles, { MAP_COLORS, pinHtml, carIconHtml, shopIconHtml, CAR_ICON_SIZE, CAR_ICON_ANCHOR, SHOP_ICON_SIZE, SHOP_ICON_ANCHOR } from "../components/MapTiles.jsx";

const icon = (label, color, size = 28) => L.divIcon({ className: "", html: pinHtml(label, color, size), iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
const clock = (d) => (d ? new Date(d).toLocaleTimeString("ar-JO", { timeZone: "Asia/Amman", hour: "numeric", minute: "2-digit" }) : "—");
const dateLong = (d) => new Date(d).toLocaleDateString("ar-JO", { timeZone: "Asia/Amman", weekday: "long", day: "numeric", month: "long" });
const dur = (m) => (m == null ? "—" : m >= 60 ? `${Math.floor(m / 60)} س ${m % 60} د` : `${m} دقيقة`);

export default function TripReplay() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [trip, setTrip] = useState(null);
  const [error, setError] = useState("");
  const [t, setT] = useState(1); // 0..1 على مدة الرحلة
  const [playing, setPlaying] = useState(false);
  const raf = useRef(null);

  useEffect(() => { api.getTripReplay(id).then(setTrip).catch((e) => setError(e.message)); }, [id]);

  const model = useMemo(() => {
    if (!trip) return null;
    const located = trip.stops.filter((s) => s.latitude != null && s.longitude != null);
    const shop = trip.shop ? [trip.shop.lat, trip.shop.lon] : null;
    const planned = [...(trip.start ? [[trip.start.lat, trip.start.lon]] : shop ? [shop] : []), ...located.map((s) => [s.latitude, s.longitude]), ...(shop ? [shop] : [])];
    const track = trip.track.map(([la, lo, at]) => ({ pos: [la, lo], at: new Date(at).getTime() }));
    const t0 = new Date(trip.started_at || trip.created_at).getTime();
    const t1 = new Date(trip.completed_at || (track.length ? track[track.length - 1].at : Date.now())).getTime();
    return { located, shop, planned, track, t0, t1: Math.max(t1, t0 + 60000) };
  }, [trip]);

  // تشغيل الإعادة
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    const step = (now) => {
      const dt = now - last; last = now;
      setT((x) => {
        const nx = x + dt / 14000;
        if (nx >= 1) { setPlaying(false); return 1; }
        return nx;
      });
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [playing]);

  if (error) return <div className="page"><div className="error-box">{error}</div></div>;
  if (!trip || !model) return <div className="page"><div className="skeleton" style={{ height: 360 }} /></div>;

  const now = model.t0 + (model.t1 - model.t0) * t;
  const passed = model.track.filter((p) => p.at <= now);
  const truck = passed.length ? passed[passed.length - 1].pos : null;
  const doneAt = (s) => s.delivered_at && new Date(s.delivered_at).getTime() <= now;
  const allPts = [...model.planned, ...model.track.map((p) => p.pos)];
  const bounds = allPts.length ? L.latLngBounds(allPts).pad(0.12) : null;
  const saved = trip.distance_before_km && trip.total_distance_km ? Math.max(0, trip.distance_before_km - trip.total_distance_km) : 0;
  const tot = trip.totals;

  return (
    <div className="page">
      <button className="link-btn" style={{ marginBottom: 8 }} onClick={() => navigate("/trip-archive")}><FiArrowRight /> أرشيف الرحلات</button>
      <h1 className="title-lg" style={{ marginBottom: 2 }}>رحلة {trip.driver_name || "كابتن"}</h1>
      <p className="text-secondary" style={{ marginTop: 0 }}>{dateLong(trip.started_at || trip.created_at)} · من {clock(trip.started_at)} لـ {clock(trip.completed_at)}</p>

      <div className="replay-stats">
        <div><FiClock /><b className="tabular-num">{dur(trip.duration_minutes)}</b><span>مدة الرحلة</span></div>
        <div><FiMapPin /><b className="tabular-num">{trip.total_distance_km != null ? `${trip.total_distance_km.toFixed(1)} كم` : "—"}</b><span>{saved > 0.05 ? `وفّرنا ${saved.toFixed(1)} كم` : "المسافة"}</span></div>
        <div><FiCheckCircle /><b className="tabular-num">{tot.delivered}/{trip.stops.length}</b><span>تم التسليم{tot.failed ? ` · ${tot.failed} تعذّر` : ""}</span></div>
      </div>

      {bounds && (
        <div className="map-frame replay-map">
          <MapContainer bounds={bounds} style={{ height: "100%", width: "100%" }} scrollWheelZoom={false}>
            <MapTiles />
            {model.planned.length > 1 && <Polyline positions={model.planned} pathOptions={{ color: MAP_COLORS.blue, weight: 3, opacity: 0.55, dashArray: "6 8" }} />}
            {model.track.length > 1 && <Polyline positions={model.track.map((p) => p.pos)} pathOptions={{ color: "#FFB066", weight: 4, opacity: 0.5 }} />}
            {passed.length > 1 && <Polyline positions={passed.map((p) => p.pos)} pathOptions={{ color: "#FF8A00", weight: 5, opacity: 0.95 }} />}
            {model.shop && <Marker position={model.shop} icon={L.divIcon({ className: "", html: shopIconHtml(), iconSize: SHOP_ICON_SIZE, iconAnchor: SHOP_ICON_ANCHOR })}><Popup>المحل</Popup></Marker>}
            {model.located.map((s) => {
              const st = s.order_status === "FAILED" ? MAP_COLORS.fail : doneAt(s) ? MAP_COLORS.done : MAP_COLORS.muted;
              return (
                <Marker key={s.id} position={[s.latitude, s.longitude]} icon={icon(s.sequence_number, st)}>
                  <Popup>{s.sequence_number}. {s.customer_name}{s.delivered_at ? ` — سلّم ${clock(s.delivered_at)}` : ""}</Popup>
                </Marker>
              );
            })}
            {truck && <Marker position={truck} icon={L.divIcon({ className: "", html: carIconHtml(), iconSize: CAR_ICON_SIZE, iconAnchor: CAR_ICON_ANCHOR })} zIndexOffset={1000} />}
          </MapContainer>
        </div>
      )}

      {model.track.length > 1 ? (
        <div className="replay-bar">
          <button className="replay-play" onClick={() => { if (t >= 1) setT(0); setPlaying((p) => !p); }} aria-label={playing ? "إيقاف" : "تشغيل"}>
            {playing ? <FiPause /> : <FiPlay />}
          </button>
          <input type="range" min="0" max="1000" value={Math.round(t * 1000)} onChange={(e) => { setPlaying(false); setT(Number(e.target.value) / 1000); }} />
          <span className="tabular-num replay-time">{clock(now)}</span>
        </div>
      ) : (
        <p className="text-secondary" style={{ fontSize: "0.8rem" }}>
          ما في مسار مسجّل لهالرحلة (الكابتن ما كان مفعّل الموقع، أو الرحلة قبل هالميزة) — الخط المنقّط هو الترتيب اللي رتّبه النظام.
        </p>
      )}
      <div className="replay-legend">
        <span><i style={{ borderTop: `3px dashed ${MAP_COLORS.blue}` }} /> ترتيب النظام</span>
        <span><i style={{ background: "#FF8A00" }} /> وين مشي الكابتن</span>
        <span><i className="dot" style={{ background: MAP_COLORS.done }} /> انسلّم</span>
      </div>

      <div className="kpi-grid" style={{ margin: "12px 0" }}>
        <div className="kpi"><div className="kpi-l">قوارير انسلّمت</div><div className="kpi-v tabular-num">{tot.bottles}</div></div>
        <div className="kpi"><div className="kpi-l">فوارغ رجعت</div><div className="kpi-v tabular-num">{tot.empties}</div></div>
        <div className="kpi"><div className="kpi-l">كاش انقبض</div><div className="kpi-v tabular-num">{tot.cash.toFixed(2)} JD</div></div>
        <div className="kpi"><div className="kpi-l">كوبونات · دين جديد</div><div className="kpi-v tabular-num">{tot.coupons} · {tot.debt_added.toFixed(2)}</div></div>
      </div>

      <div className="card" style={{ padding: "6px 0" }}>
        <h2 className="title-md" style={{ padding: "8px 14px 0" }}>التوقفات بالترتيب</h2>
        {trip.stops.map((s) => {
          const failed = s.order_status === "FAILED";
          const done = !!s.delivered_at;
          const moved = done && s.actual_rank && s.actual_rank !== s.sequence_number;
          return (
            <div key={s.id} className={`replay-stop${done && doneAt(s) ? " done" : ""}`}>
              <span className="replay-num" style={{ background: failed ? MAP_COLORS.fail : done ? MAP_COLORS.done : MAP_COLORS.muted }}>{s.sequence_number}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700 }}>{s.customer_name}</div>
                <div className="text-secondary" style={{ fontSize: "0.78rem" }}>
                  {[s.region_name, s.qty ? `${s.qty} قطعة` : null, s.leg_distance_km ? `${Number(s.leg_distance_km).toFixed(1)} كم` : null].filter(Boolean).join(" · ")}
                  {moved && <span style={{ color: "var(--warning)" }}> · سلّمه {s.actual_rank} بدل {s.sequence_number}</span>}
                </div>
              </div>
              <div style={{ textAlign: "left", flex: "0 0 auto" }}>
                {failed ? <span className="badge" style={{ background: "var(--urgent-soft)", color: "var(--urgent)" }}><FiXCircle /> تعذّر</span>
                  : done ? <div className="tabular-num" style={{ fontWeight: 700, color: "var(--success)" }}>{clock(s.delivered_at)}</div>
                  : <span className="badge">ما انسلّم</span>}
                {s.cash_collected > 0 && <div className="tabular-num text-secondary" style={{ fontSize: "0.75rem" }}>{Number(s.cash_collected).toFixed(2)} JD</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
