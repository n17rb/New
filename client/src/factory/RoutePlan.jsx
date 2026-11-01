import { useEffect, useMemo, useState } from "react";
import { MapContainer, Marker, Polyline, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import MapTiles, { pinHtml } from "../components/MapTiles.jsx";
import { fapi } from "./fapi.js";
import { Sheet, Err, Loading, num } from "./ui.jsx";

// ============================================================
// خط الرحلة للطلبات المحددة: مرتبة من المصنع للأقرب فالأقرب،
// والبرنامج بيقترح تبديل طلب بطلب أقرب عشان الرحلة تصير أقصر وأوفر
// ============================================================
function Fit({ pts }) {
  const map = useMap();
  useEffect(() => {
    const t = setTimeout(() => { map.invalidateSize(); if (pts.length) map.fitBounds(pts, { padding: [30, 30], maxZoom: 14 }); }, 300);
    return () => clearTimeout(t);
  }, [map, pts.map((p) => p.join(",")).join("|")]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
const icon = (label, color, size = 28) => L.divIcon({ html: pinHtml(label, color, size), className: "", iconSize: [size, size], iconAnchor: [size / 2, size / 2] });

export default function RoutePlan({ ids, pool, onApply, onTrip, onClose }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const key = ids.join(",");
  useEffect(() => { setData(null); setErr(""); fapi.routePlan(ids, pool).then(setData).catch((e) => setErr(e.message)); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const line = useMemo(() => (data ? [data.start, ...data.stops.map((s) => [s.lat, s.lng]), data.start] : []), [data]);
  const sug = data?.suggestion;

  return (
    <Sheet title="خط الرحلة" onClose={onClose}>
      <div className="fx-stack" style={{ gap: 10 }}>
        <Err msg={err} />
        {!data && !err && <Loading />}
        {data && (
          <>
            <div className="rp-km"><span>من المصنع ولفّة كاملة ورجوع:</span><b className="fx-num">{num(data.km)}</b><span>كم تقريبًا</span></div>
            <div className="rp-map">
              <MapContainer center={data.start} zoom={11} style={{ height: "100%", width: "100%" }}>
                <MapTiles />
                <Polyline positions={line} pathOptions={{ color: "#0a66f5", weight: 4, opacity: 0.75 }} />
                <Marker position={data.start} icon={icon("🏭", "#10304d", 32)} />
                {data.stops.map((s) => <Marker key={s.id} position={[s.lat, s.lng]} icon={icon(String(s.seq), s.urgent ? "#d64545" : "#0a66f5")} />)}
                <Fit pts={line} />
              </MapContainer>
            </div>

            {sug && (
              <div className="rp-sug">
                <b className="h">💡 في خيار أوفر: بتوفر {num(sug.saved_km)} كم ({num(sug.km)} بدل {num(data.km)})</b>
                {sug.swaps.map((w, i) => (
                  <div key={i} className="rp-sw">بدل <s>{w.out}</s>{w.out_city ? ` (${w.out_city})` : ""} خذ <ins>{w.in}</ins>{w.in_city ? ` (${w.in_city})` : ""}</div>
                ))}
                <small className="fx-muted">نفس الحجم تقريبًا، بس أقرب على باقي الطلبات.</small>
                <button className="fx-btn ok block" onClick={() => onApply(sug.ids)}>✓ خذ الاقتراح</button>
              </div>
            )}

            <div className="rp-list">
              {data.stops.map((s) => (
                <div key={s.id} className="rp-stop">
                  <span className="rp-n" style={s.urgent ? { background: "#d64545" } : undefined}>{s.seq}</span>
                  <span className="t"><b>{s.name}</b><small>{[s.city, `${num(s.cartons)} كرتونة`, s.seq === 1 ? `${num(s.leg_km)} كم من المصنع` : `${num(s.leg_km)} كم من اللي قبله`].filter(Boolean).join(" · ")}{!s.exact ? " · موقع تقريبي" : ""}</small></span>
                </div>
              ))}
            </div>
            {data.no_location.length > 0 && <div className="fx-note warn">بدون موقع (مش على الخط): {data.no_location.join("، ")}</div>}
            <button className="fx-btn pri block fx-big" onClick={onTrip}>🚚 حطها على سيارة</button>
          </>
        )}
      </div>
    </Sheet>
  );
}
