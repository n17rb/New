import { useEffect, useMemo, useState } from "react";
import { MapContainer, CircleMarker, Tooltip, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import MapTiles from "../../components/MapTiles.jsx";
import { fapi } from "../fapi.js";
import { useFx, Err, Loading, num, money } from "../ui.jsx";

// ============================================================
// خريطة كثافة الزباين: كل دائرة = منطقة صغيرة (~٢ كم)، كبرها ولونها حسب العدد
// ============================================================
const METRICS = [
  { key: "customers", label: "عدد الزباين", unit: "زبون", val: () => 1 },
  { key: "orders", label: "الطلبات (آخر شهر)", unit: "طلب", val: (c) => c.orders_30 },
  { key: "cartons", label: "الكراتين (آخر شهر)", unit: "كرتونة", val: (c) => c.cartons_30 },
  { key: "sales", label: "المبيعات (آخر شهر)", unit: "د.أ", val: (c) => c.sales_30 || 0, money: true },
];
const CELL = 0.02; // درجة ≈ ٢ كم
const heat = (t) => `hsl(${Math.round(210 - 210 * t)}, 85%, ${Math.round(52 - 8 * t)}%)`; // أزرق ← أحمر

function FitTo({ points, focus }) {
  const map = useMap();
  useEffect(() => {
    if (focus) return void map.flyTo(focus, 12, { duration: 0.6 });
    if (points.length) map.fitBounds(points, { padding: [24, 24], maxZoom: 12 });
  }, [points.length, focus]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

export default function Density() {
  const fx = useFx();
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState("");
  const [metric, setMetric] = useState("customers");
  const [focus, setFocus] = useState(null);
  useEffect(() => { fapi.density().then(setRows).catch((e) => setErr(e.message)); }, []);
  const M = METRICS.find((m) => m.key === metric);
  const metrics = METRICS.filter((m) => !(m.money && rows?.[0]?.sales_30 === undefined));

  const located = useMemo(() => (rows || []).filter((c) => c.lat != null && c.lng != null), [rows]);
  // تجميع بمربعات صغيرة
  const cells = useMemo(() => {
    const m = new Map();
    for (const c of located) {
      const k = `${Math.round(c.lat / CELL)}:${Math.round(c.lng / CELL)}`;
      const x = m.get(k) || { lat: 0, lng: 0, n: 0, v: 0, names: new Map() };
      x.lat += c.lat; x.lng += c.lng; x.n++; x.v += M.val(c);
      const nm = c.city || c.district || "";
      x.names.set(nm, (x.names.get(nm) || 0) + 1);
      m.set(k, x);
    }
    return [...m.values()].map((x) => ({ ...x, lat: x.lat / x.n, lng: x.lng / x.n, place: [...x.names.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "" })).filter((x) => x.v > 0);
  }, [located, M]);
  const max = Math.max(1, ...cells.map((c) => c.v));

  // ترتيب الألوية
  const byDistrict = useMemo(() => {
    const m = new Map();
    for (const c of rows || []) {
      const k = c.district ? `${c.governorate} › ${c.district.replace(/^قصبة /, "")}` : c.governorate || "غير محدد";
      const x = m.get(k) || { v: 0, n: 0, lat: 0, lng: 0, pts: 0 };
      x.v += M.val(c); x.n++;
      if (c.lat != null) { x.lat += c.lat; x.lng += c.lng; x.pts++; }
      m.set(k, x);
    }
    return [...m.entries()].map(([k, x]) => ({ k, ...x, center: x.pts ? [x.lat / x.pts, x.lng / x.pts] : null })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v);
  }, [rows, M]);
  const dmax = Math.max(1, ...byDistrict.map((d) => d.v));
  const fmt = (v) => (M.money ? money(v) : num(v));
  const total = byDistrict.reduce((s, d) => s + d.v, 0);

  return (
    <div className="fx-page" style={{ gap: 12 }}>
      <div className="fx-chead"><h1>خريطة الزباين</h1></div>
      <Err msg={err} />
      {!rows && !err && <Loading />}
      {rows && (
        <>
          <div className="fx-hscroll">
            {metrics.map((m) => <button key={m.key} className={`fx-chip ${metric === m.key ? "on" : ""}`} onClick={() => { setMetric(m.key); setFocus(null); }}>{m.label}</button>)}
          </div>
          <div className="fx-live-map" style={{ height: "48vh" }}>
            <MapContainer center={fx.boot.factory?.point || [31.95, 35.93]} zoom={8} style={{ height: "100%", width: "100%" }} scrollWheelZoom>
              <MapTiles />
              {cells.map((c, i) => {
                const t = c.v / max;
                return (
                  <CircleMarker key={i} center={[c.lat, c.lng]} radius={8 + 26 * Math.sqrt(t)}
                    pathOptions={{ color: heat(t), fillColor: heat(t), fillOpacity: 0.45 + 0.3 * t, weight: 1.5 }}>
                    <Tooltip direction="top">{c.place} · {fmt(c.v)} {M.unit}{metric !== "customers" ? ` (${c.n} زبون)` : ""}</Tooltip>
                  </CircleMarker>
                );
              })}
              <FitTo points={located.map((c) => [c.lat, c.lng])} focus={focus} />
            </MapContainer>
          </div>
          <div className="fx-heat-legend"><span>قليل</span><i /><span>كثير</span></div>
          {rows.length > located.length && <p className="fx-muted" style={{ margin: 0, fontSize: 12.5 }}>{rows.length - located.length} زبون بدون موقع محفوظ — ما بيطلعوا على الخريطة بس محسوبين تحت.</p>}

          <div className="fx-sec"><h2>حسب اللواء</h2><span className="fx-muted" style={{ fontSize: 13 }}>المجموع {fmt(total)} {M.unit}</span></div>
          <div className="fx-clist">
            {byDistrict.map((d) => (
              <button key={d.k} className="fx-crow fx-plain fx-dens-row" onClick={() => d.center && setFocus(d.center)} disabled={!d.center}>
                <span className="t">
                  <b>{d.k}</b>
                  <span className="bar"><i style={{ width: `${(d.v / dmax) * 100}%`, background: heat(d.v / dmax) }} /></span>
                </span>
                <span className="v"><b className="fx-num">{fmt(d.v)}</b><small>{metric === "customers" ? "زبون" : `${d.n} زبون`}</small></span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
