import { useEffect, useMemo, useState } from "react";
import { MapContainer, CircleMarker, Popup, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import MapTiles, { MAP_COLORS } from "../../components/MapTiles.jsx";
import { fapi } from "../fapi.js";
import { Err, Loading, num } from "../ui.jsx";

// ============================================================
// خريطة العملاء (نفس شاشة موج): كل زبون نقطة زرقا، وتحت الزباين حسب المنطقة
// ============================================================
function Fit({ points }) {
  const map = useMap();
  useEffect(() => { if (points.length) map.fitBounds(points, { padding: [24, 24], maxZoom: 13 }); }, [points.length]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

export default function Density() {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => { fapi.density().then(setRows).catch((e) => setErr(e.message)); }, []);

  const located = useMemo(() => (rows || []).filter((c) => c.lat != null && c.lng != null), [rows]);
  const regions = useMemo(() => {
    const m = new Map();
    for (const c of rows || []) {
      const k = (c.city || "").trim() || c.district?.replace(/^قصبة /, "") || "بدون منطقة";
      m.set(k, (m.get(k) || 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);
  const max = regions[0]?.[1] || 1;

  return (
    <div className="fx-page">
      <div>
        <h1 className="fx-h1" style={{ margin: 0 }}>خريطة العملاء</h1>
        {rows && <p className="fx-muted" style={{ margin: "4px 0 0" }}>{num(located.length)} عميل عندهم موقع محفوظ — شوف وين زباينك متجمّعين عشان تقرر وين تتوسع.</p>}
      </div>
      <Err msg={err} />
      {!rows && !err && <Loading />}
      {rows && located.length === 0 && <div className="fx-empty-soft">لسا ما في عملاء عندهم موقع محفوظ.</div>}
      {rows && located.length > 0 && (
        <div className="fx-live-map" style={{ height: 440 }}>
          <MapContainer center={[located[0].lat, located[0].lng]} zoom={11} style={{ height: "100%", width: "100%" }}>
            <MapTiles />
            {located.map((c) => (
              <CircleMarker key={c.id} center={[c.lat, c.lng]} radius={6} pathOptions={{ color: "#ffffff", weight: 1.5, fillColor: MAP_COLORS.blue, fillOpacity: 0.85 }}>
                <Popup>{c.name}{c.city ? ` — ${c.city}` : ""}</Popup>
              </CircleMarker>
            ))}
            <Fit points={located.map((c) => [c.lat, c.lng])} />
          </MapContainer>
        </div>
      )}

      {rows && regions.length > 0 && (
        <div className="fx-card">
          <h2 style={{ margin: "0 0 12px", fontSize: 17 }}>الزباين حسب المنطقة</h2>
          {regions.map(([name, count]) => (
            <div key={name} className="fx-rbar">
              <div className="h"><span>{name}</span><span className="fx-num fx-muted">{num(count)} زبون</span></div>
              <div className="track"><div style={{ width: `${Math.max(4, (count / max) * 100)}%` }} /></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
