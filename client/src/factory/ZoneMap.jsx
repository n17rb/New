import { useEffect, useMemo, useState } from "react";
import { MapContainer, Polygon, CircleMarker, Tooltip, Polyline, useMap, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import MapTiles from "../components/MapTiles.jsx";
import { fapi } from "./fapi.js";
import { Sheet, Act, num, useFx } from "./ui.jsx";
import { gov as govOf, zonesFor } from "./RegionFilter.jsx";

// ============================================================
// خريطة المناطق: بترسم حدود كل منطقة بإيدك على الخريطة،
// وأي زبون موقعه جوّا الحدود بيدخل فيها لحاله
// ============================================================
const COLORS = ["#2f80ed", "#27ae60", "#f2994a", "#9b51e0", "#eb5757", "#00a3a3", "#c2185b", "#8d6e63", "#5c6bc0", "#7cb342"];
const CENTERS = { "إربد": [[32.5556, 35.85], 11], "الرمثا": [[32.559, 36.0069], 12], "جرش": [[32.28, 35.9], 12], "عجلون": [[32.333, 35.75], 12], "المفرق": [[32.34, 36.21], 11] };

function Clicks({ on, onAdd }) {
  useMapEvents({ click: (e) => on && onAdd([Math.round(e.latlng.lat * 1e6) / 1e6, Math.round(e.latlng.lng * 1e6) / 1e6]) });
  return null;
}
function Resize() {
  const map = useMap();
  useEffect(() => { const t = setTimeout(() => map.invalidateSize(), 350); return () => clearTimeout(t); }, [map]);
  return null;
}
const ptsOf = (z) => { const p = typeof z?.polygon === "string" ? JSON.parse(z.polygon) : z?.polygon; return Array.isArray(p) && p.length >= 3 ? p : null; };

export default function ZoneMap({ gov: g, onClose }) {
  const fx = useFx();
  const zs = zonesFor(fx.boot.lines || [], g);
  const color = (id) => COLORS[Math.max(0, zs.findIndex((z) => z.id === id)) % COLORS.length];
  const [cust, setCust] = useState([]);
  const [sel, setSel] = useState(null);
  const [draft, setDraft] = useState(null); // نقاط الرسم الحالي
  const [add, setAdd] = useState("");
  const [busy, setBusy] = useState(false);
  const loadCust = () => fapi.customers().then((l) => setCust(l.filter((c) => c.lat != null && c.lng != null && Number(c.lat)))).catch(() => {});
  useEffect(() => { loadCust(); }, []);
  const mine = useMemo(() => cust.filter((c) => govOf(c) === g || zs.some((z) => z.id === c.line_id)), [cust, g, zs]);
  const count = (id) => mine.filter((c) => c.line_id === id).length;
  const z = zs.find((x) => x.id === sel);
  const [center, zoom] = CENTERS[g] || [mine[0] ? [Number(mine[0].lat), Number(mine[0].lng)] : [32.0, 36.0], 11];

  const save = async (poly) => {
    setBusy(true);
    try {
      const r = await fapi.linePolygon(z.id, poly);
      await fx.reloadBoot?.();
      await loadCust();
      setDraft(null);
      fx.toast(poly ? `انحفظت حدود «${z.name}» — فيها ${num(r.customers)} زبون${r.moved > 0 ? ` (انضاف ${num(r.moved)})` : ""}` : `انشالت حدود «${z.name}»`);
    } catch (e) { fx.toast(e.message); } finally { setBusy(false); }
  };

  return (
    <Sheet title={`خريطة مناطق ${g}`} onClose={onClose}>
      <div className="fx-stack" style={{ gap: 10 }}>
        <div className="zm-map">
          <MapContainer center={center} zoom={zoom} style={{ height: "100%", width: "100%" }} doubleClickZoom={!draft}>
            <MapTiles />
            <Resize />
            <Clicks on={!!draft} onAdd={(p) => setDraft((d) => [...d, p])} />
            {zs.map((x) => {
              const pts = x.id === sel && draft ? null : ptsOf(x);
              return pts && (
                <Polygon key={`${x.id}-${pts.length}`} positions={pts} eventHandlers={{ click: () => !draft && setSel(x.id) }}
                  pathOptions={{ color: color(x.id), weight: x.id === sel ? 3.5 : 2, fillOpacity: x.id === sel ? 0.22 : 0.12 }}>
                  <Tooltip permanent direction="center" className="zm-label">{x.name}</Tooltip>
                </Polygon>
              );
            })}
            {mine.map((c) => (
              <CircleMarker key={c.id} center={[Number(c.lat), Number(c.lng)]} radius={5} interactive={!draft}
                pathOptions={{ color: "#fff", weight: 1.2, fillColor: zs.some((x) => x.id === c.line_id) ? color(c.line_id) : "#8a9bb0", fillOpacity: 0.95 }}>
                {!draft && <Tooltip>{c.name}{c.line_name ? ` — ${c.line_name}` : " — بدون منطقة"}</Tooltip>}
              </CircleMarker>
            ))}
            {draft && draft.length > 0 && (
              <>
                {draft.length >= 3
                  ? <Polygon positions={draft} pathOptions={{ color: color(sel), weight: 3, dashArray: "6 6", fillOpacity: 0.18 }} interactive={false} />
                  : <Polyline positions={draft} pathOptions={{ color: color(sel), weight: 3, dashArray: "6 6" }} interactive={false} />}
                {draft.map((p, i) => <CircleMarker key={i} center={p} radius={i === 0 ? 8 : 6} interactive={false} pathOptions={{ color: "#fff", weight: 2, fillColor: color(sel), fillOpacity: 1 }} />)}
              </>
            )}
          </MapContainer>
        </div>

        {draft ? (
          <div className="fx-card fx-stack" style={{ gap: 8, padding: 12 }}>
            <b>✏️ عم ترسم حدود «{z?.name}»</b>
            <small className="fx-muted">اكبس على الخريطة حوالين المنطقة نقطة ورا نقطة (٣ نقاط على الأقل). الخط بيسكّر لحاله بين آخر نقطة وأول نقطة.</small>
            <div className="fx-row" style={{ gap: 8 }}>
              <button className="fx-btn" disabled={!draft.length} onClick={() => setDraft(draft.slice(0, -1))}>↩️ تراجع نقطة</button>
              <button className="fx-btn" disabled={!draft.length} onClick={() => setDraft([])}>امسح الكل</button>
              <button className="fx-btn" onClick={() => setDraft(null)}>إلغاء</button>
            </div>
            <Act className="fx-btn ok block fx-big" disabled={busy || draft.length < 3} onClick={() => save(draft)}>✓ احفظ الحدود</Act>
          </div>
        ) : (
          <>
            <small className="fx-muted">اختار منطقة وبعدين اكبس «ارسم حدودها». أي زبون موقعه جوّا الحدود بيدخل فيها لحاله — والجداد كمان.</small>
            <div className="zm-zones">
              {zs.map((x) => (
                <button key={x.id} className={x.id === sel ? "on" : ""} onClick={() => setSel(x.id === sel ? null : x.id)}>
                  <i style={{ background: color(x.id) }} />
                  <span>{x.name}</span>
                  <small>{num(count(x.id))}{ptsOf(x) ? " · 🗺️" : ""}</small>
                </button>
              ))}
            </div>
            {z && (
              <div className="fx-row" style={{ gap: 8 }}>
                <button className="fx-btn pri fx-grow" onClick={() => setDraft(ptsOf(z) ? [...ptsOf(z)] : [])}>✏️ {ptsOf(z) ? "عدّل حدودها" : "ارسم حدودها"}</button>
                {ptsOf(z) && <Act className="fx-btn danger" disabled={busy} onClick={() => save(null)}>شيل الحدود</Act>}
              </div>
            )}
            <div className="fx-row" style={{ flexWrap: "nowrap", gap: 8 }}>
              <input className="fx-input fx-grow" value={add} onChange={(e) => setAdd(e.target.value)} placeholder="منطقة جديدة (اسمها)" />
              <Act className="fx-btn" disabled={busy || !add.trim()} onClick={async () => {
                const l = await fapi.saveLine({ name: add.trim(), governorate: g });
                await fx.reloadBoot?.(); setAdd(""); setSel(l.id); setDraft([]);
              }}>ضيف وارسم</Act>
            </div>
            <button className="fx-btn block" onClick={onClose}>تم</button>
          </>
        )}
      </div>
    </Sheet>
  );
}
