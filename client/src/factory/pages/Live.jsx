import { useEffect, useMemo, useState } from "react";
import { MapContainer, Marker, Polyline, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { FiPhone, FiNavigation } from "react-icons/fi";
import MapTiles from "../../components/MapTiles.jsx";
import { fapi } from "../fapi.js";
import { Err, Loading, num, time } from "../ui.jsx";

// ============================================================
// وين السيارات هلأ: كل سيارة على الخريطة، لوين متجهة، ووقفاتها الجاية بالترتيب
// ============================================================
const COLORS = { moving: "#1F9D55", planned: "#0A66F5", lost: "#D64545", idle: "#8A9BB0" };
const LABEL = { moving: "بالطريق", planned: "جاهزة تطلع", lost: "التتبع مقطوع", idle: "بالمصنع" };

function carIcon(v, active) {
  const c = COLORS[v.state] || COLORS.idle;
  const n = (v.name || "").replace(/\D/g, "") || "•";
  const arrow = v.heading != null
    ? `<div style="position:absolute;inset:-9px;transform:rotate(${v.heading}deg)"><div style="margin:0 auto;width:0;height:0;border-left:7px solid transparent;border-right:7px solid transparent;border-bottom:10px solid ${c}"></div></div>`
    : "";
  const size = active ? 40 : 34;
  return L.divIcon({
    className: "",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<div style="position:relative;width:${size}px;height:${size}px">${arrow}<div style="width:${size}px;height:${size}px;border-radius:50%;background:${c};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:15px;border:3px solid #fff;box-shadow:0 3px 10px rgba(8,40,110,.35)">${n}</div></div>`,
  });
}
const stopIcon = (i) => L.divIcon({ className: "", iconSize: [22, 22], iconAnchor: [11, 11], html: `<div style="width:22px;height:22px;border-radius:50%;background:#fff;color:#0846B8;border:2px solid #0846B8;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:11px">${i}</div>` });
const factoryIcon = L.divIcon({ className: "", iconSize: [30, 30], iconAnchor: [15, 15], html: `<div style="width:30px;height:30px;border-radius:9px;background:#0846B8;color:#fff;display:flex;align-items:center;justify-content:center;font-size:16px;border:2px solid #fff">🏭</div>` });

function Focus({ point }) {
  const map = useMap();
  useEffect(() => { if (point) map.flyTo(point, 13, { duration: 0.6 }); }, [point, map]);
  return null;
}

export default function Live() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [sel, setSel] = useState(null);
  const load = () => fapi.live().then((d) => { setData(d); setErr(""); }).catch((e) => setErr(e.message));
  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);

  const withPos = useMemo(() => (data?.vehicles || []).filter((v) => v.lat != null), [data]);
  const center = data?.factory || [31.95, 35.93];
  const chosen = withPos.find((v) => v.id === sel);

  return (
    <div className="fx-page" style={{ gap: 12 }}>
      <h1 className="fx-h1" style={{ margin: 0 }}>وين السيارات</h1>
      <Err msg={err} />
      {!data && !err && <Loading />}
      {data && (
        <>
          <div className="fx-live-map">
            <MapContainer center={center} zoom={9} style={{ height: "100%", width: "100%" }} scrollWheelZoom>
              <MapTiles />
              <Marker position={center} icon={factoryIcon}><Tooltip direction="top">المصنع</Tooltip></Marker>
              {withPos.map((v) => (
                <Marker key={v.id} position={[v.lat, v.lng]} icon={carIcon(v, v.id === sel)} eventHandlers={{ click: () => setSel(v.id) }}>
                  <Tooltip direction="top" offset={[0, -16]}>{v.name} · {v.driver_name || "بدون سائق"}</Tooltip>
                </Marker>
              ))}
              {chosen && chosen.route.length > 0 && (
                <>
                  <Polyline positions={[[chosen.lat, chosen.lng], ...chosen.route.map((s) => [s.lat, s.lng])]} pathOptions={{ color: COLORS[chosen.state] || "#0A66F5", weight: 4, dashArray: "8 8" }} />
                  {chosen.route.map((s, i) => <Marker key={s.id} position={[s.lat, s.lng]} icon={stopIcon(i + 1)}><Tooltip direction="top">{i + 1}. {s.customer_name}</Tooltip></Marker>)}
                </>
              )}
              <Focus point={chosen ? [chosen.lat, chosen.lng] : null} />
            </MapContainer>
          </div>
          <p className="fx-muted" style={{ margin: 0, fontSize: 12.5 }}>بتتحدّث كل ٣٠ ثانية. السهم بيوري لوين السيارة متجهة. اكبس على سيارة تشوف طريقها ووقفاتها بالترتيب.</p>

          <div className="fx-clist">
            {data.vehicles.map((v) => (
              <button key={v.id} className={`fx-crow fx-plain fx-live-row ${sel === v.id ? "on" : ""}`} onClick={() => setSel(v.id)} disabled={v.lat == null}>
                <span className="fx-cav" style={{ background: COLORS[v.state], color: "#fff" }}>{(v.name || "").replace(/\D/g, "") || "•"}</span>
                <span className="t" style={{ flex: 1, display: "grid", gap: 2, minWidth: 0 }}>
                  <b>{v.driver_name || "بدون سائق"} <span className="fx-muted" style={{ fontWeight: 400, fontSize: 13 }}>· {v.name}</span></b>
                  <small>
                    {LABEL[v.state]}
                    {v.next ? ` · رايح على ${v.next.customer_name}${v.next.eta_at ? ` (${time(v.next.eta_at)})` : ""}` : ""}
                  </small>
                  <small>
                    {v.trip_id ? `${v.done}/${v.stops} وقفات · ${num(v.load)} كرتونة` : "ما عنده رحلة"}
                    {v.minutes_ago != null ? ` · آخر موقع ${v.minutes_ago < 1 ? "هلأ" : `قبل ${v.minutes_ago} د`}` : " · ما في موقع"}
                  </small>
                </span>
                <span className="fx-row" style={{ gap: 6, flexWrap: "nowrap" }}>
                  {v.lat != null && <a className="fx-icon-btn sm" href={`https://www.google.com/maps?q=${v.lat},${v.lng}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} aria-label="افتح بخرائط جوجل"><FiNavigation /></a>}
                  {v.driver_phone && <a className="fx-icon-btn sm" href={`tel:${v.driver_phone}`} onClick={(e) => e.stopPropagation()} aria-label="اتصل بالسائق"><FiPhone /></a>}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
