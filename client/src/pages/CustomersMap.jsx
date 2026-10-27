import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MapContainer, CircleMarker, Marker, Popup, Tooltip, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { FiTruck, FiHome, FiCrosshair } from "react-icons/fi";
import { api } from "../api.js";
import MapTiles, { MAP_COLORS, carIconHtml, shopIconHtml, CAR_ICON_SIZE, CAR_ICON_ANCHOR, SHOP_ICON_SIZE, SHOP_ICON_ANCHOR } from "../components/MapTiles.jsx";

// آخر مكان وتكبير للخريطة — عشان لما ترجع من صفحة الزبون تلاقيها زي ما تركتها
const VIEW_KEY = "cmap_view";
function readView() {
  try { return JSON.parse(sessionStorage.getItem(VIEW_KEY) || "null"); } catch { return null; }
}
function saveView(v) {
  try { sessionStorage.setItem(VIEW_KEY, JSON.stringify(v)); } catch { /* ignore */ }
}

function ViewKeeper() {
  const map = useMapEvents({
    moveend: () => { const c = map.getCenter(); saveView({ lat: c.lat, lng: c.lng, zoom: map.getZoom() }); },
  });
  return null;
}

// زر «وين سيارتي» / «المحل»: بيطير الخريطة على المكان
function FlyTo({ target }) {
  const map = useMap();
  useEffect(() => {
    if (target && map?.flyTo) map.flyTo([target.lat, target.lon], Math.max(map.getZoom?.() || 14, 15), { duration: 0.8 });
  }, [target?.key]);
  return null;
}

const shopIcon = () => L.divIcon({ className: "", html: shopIconHtml("المحل"), iconSize: SHOP_ICON_SIZE, iconAnchor: SHOP_ICON_ANCHOR });
const carIcon = (label, stale) => L.divIcon({ className: "", html: carIconHtml({ label, stale }), iconSize: CAR_ICON_SIZE, iconAnchor: CAR_ICON_ANCHOR });

function timeAgo(iso) {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "هلّق";
  if (m < 60) return `قبل ${m} دقيقة`;
  return `قبل ${Math.round(m / 60)} ساعة`;
}

export default function CustomersMap() {
  const navigate = useNavigate();
  const [customers, setCustomers] = useState(null);
  const [extras, setExtras] = useState({ shop: null, cars: [] });
  const [me, setMe] = useState(null);
  const [fly, setFly] = useState(null);
  const [error, setError] = useState("");
  const savedView = useRef(readView());

  useEffect(() => {
    api.getAllCustomerLocations().then(setCustomers).catch((err) => setError(err.message));
    const loadExtras = () => api.getMapExtras().then(setExtras).catch(() => {});
    loadExtras();
    const t = setInterval(loadExtras, 20000);
    // مكانك إنت (التلفون)
    let watch = null;
    if (navigator.geolocation) {
      watch = navigator.geolocation.watchPosition(
        (p) => setMe({ lat: p.coords.latitude, lon: p.coords.longitude }),
        () => {},
        { enableHighAccuracy: true, maximumAge: 20000, timeout: 15000 }
      );
    }
    return () => { clearInterval(t); if (watch != null) navigator.geolocation.clearWatch(watch); };
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
  if (!customers) return <div className="page"><h1 className="title-lg">خريطة العملاء</h1><div className="skeleton" style={{ height: 420 }} /></div>;
  if (customers.length === 0 && !extras.shop) return <div className="page"><p className="text-secondary">لا يوجد عملاء عندهم موقع محفوظ بعد.</p></div>;

  const pts = customers.length ? customers : [{ latitude: extras.shop.lat, longitude: extras.shop.lon }];
  const lat = pts.reduce((s, c) => s + Number(c.latitude), 0) / pts.length;
  const lon = pts.reduce((s, c) => s + Number(c.longitude), 0) / pts.length;
  const start = savedView.current ? { center: [savedView.current.lat, savedView.current.lng], zoom: savedView.current.zoom } : { center: [lat, lon], zoom: 12 };
  const max = regions[0]?.[1] || 1;

  const myCar = extras.cars.find((c) => c.is_me) || null;
  const anyCar = myCar || extras.cars[0] || null;
  const staleMs = 5 * 60 * 1000;

  return (
    <div className="page">
      <h1 className="title-lg">خريطة العملاء</h1>
      <p className="text-secondary" style={{ marginBottom: 10 }}>
        {customers.length} عميل عندهم موقع محفوظ — اكبس على أي زبون بيفتحلك معلوماته.
      </p>

      <div className="map-tools">
        {anyCar && (
          <button className="map-tool car" onClick={() => setFly({ lat: anyCar.lat, lon: anyCar.lon, key: `car-${Date.now()}` })}>
            <FiTruck aria-hidden="true" /> {myCar ? "وين سيارتي" : `وين ${anyCar.driver_name || "السيارة"}`}
          </button>
        )}
        {extras.shop && (
          <button className="map-tool" onClick={() => setFly({ ...extras.shop, key: `shop-${Date.now()}` })}>
            <FiHome aria-hidden="true" /> المحل
          </button>
        )}
        {me && (
          <button className="map-tool" onClick={() => setFly({ ...me, key: `me-${Date.now()}` })}>
            <FiCrosshair aria-hidden="true" /> مكاني
          </button>
        )}
      </div>

      <div className="map-frame" style={{ height: 460 }}>
        <MapContainer center={start.center} zoom={start.zoom} style={{ height: "100%", width: "100%" }}>
          <MapTiles />
          <ViewKeeper />
          <FlyTo target={fly} />
          {customers.map((c) => (
            <CircleMarker
              key={c.id}
              center={[c.latitude, c.longitude]}
              radius={7}
              pathOptions={{ color: "#ffffff", weight: 1.5, fillColor: MAP_COLORS.blue, fillOpacity: 0.85 }}
              eventHandlers={{ click: () => navigate(`/customers/${c.id}`, { state: { from: "/customers-map" } }) }}
            >
              <Tooltip direction="top" offset={[0, -6]}>{c.name}</Tooltip>
            </CircleMarker>
          ))}
          {me && (
            <CircleMarker center={[me.lat, me.lon]} radius={8} pathOptions={{ color: "#fff", weight: 3, fillColor: "#2F86FF", fillOpacity: 1 }}>
              <Popup>مكانك هلّق</Popup>
            </CircleMarker>
          )}
          {extras.shop && (
            <Marker position={[extras.shop.lat, extras.shop.lon]} icon={shopIcon()} zIndexOffset={500}>
              <Popup>المحل</Popup>
            </Marker>
          )}
          {extras.cars.map((car) => {
            const stale = Date.now() - new Date(car.location_updated_at).getTime() > staleMs;
            return (
              <Marker key={car.trip_id} position={[car.lat, car.lon]} icon={carIcon(car.is_me ? "سيارتي" : car.driver_name || "", stale)} zIndexOffset={1000}>
                <Popup>
                  {car.is_me ? "سيارتك" : `سيارة ${car.driver_name || "الكابتن"}`}<br />
                  آخر تحديث: {timeAgo(car.location_updated_at)}
                </Popup>
              </Marker>
            );
          })}
        </MapContainer>
      </div>

      <div className="map-legend">
        <span><i style={{ background: MAP_COLORS.blue }} /> زبون</span>
        {extras.cars.length > 0 && <span><i style={{ background: "#FF8A00" }} /> سيارة برحلة</span>}
        {extras.shop && <span><i style={{ background: MAP_COLORS.navy, borderRadius: 3 }} /> المحل</span>}
        {me && <span><i style={{ background: "#2F86FF" }} /> مكانك</span>}
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <h2 className="title-md" style={{ marginTop: 0 }}>الزباين حسب المنطقة</h2>
        {regions.map(([name, count]) => (
          <div key={name} className="region-bar">
            <div className="region-bar-h">
              <span>{name}</span>
              <span className="tabular-num text-secondary">{count} زبون</span>
            </div>
            <div className="region-bar-track"><div style={{ width: `${Math.max(4, (count / max) * 100)}%` }} /></div>
          </div>
        ))}
      </div>
    </div>
  );
}
