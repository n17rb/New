import { MapContainer, Marker, Popup, Polyline } from "react-leaflet";
import MapTiles, { MAP_COLORS, pinHtml, carIconHtml, shopIconHtml, CAR_ICON_SIZE, CAR_ICON_ANCHOR, SHOP_ICON_SIZE, SHOP_ICON_ANCHOR } from "./MapTiles.jsx";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

function numberIcon(label, color) {
  return L.divIcon({
    className: "",
    html: pinHtml(label, color, 28),
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

export default function RoutePreviewMap({ stops, driverLocation, showDriverMarker, routeGeometry, shopLocation }) {
  const visibleStops = stops
    .map((s, i) => ({ ...s, originalIndex: i + 1 }))
    .filter((s) => !s.delivered_at && s.latitude != null && s.longitude != null);

  const shop = shopLocation && shopLocation.lat != null ? [shopLocation.lat, shopLocation.lon] : null;

  if (visibleStops.length === 0 && !driverLocation && !shop) return null;

  const center = visibleStops[0]
    ? [visibleStops[0].latitude, visibleStops[0].longitude]
    : driverLocation
      ? [driverLocation.lat, driverLocation.lng]
      : shop;

  const polylinePoints = Array.isArray(routeGeometry)
    ? routeGeometry.map(([lon, lat]) => [lat, lon])
    : null;

  return (
    <div style={{ height: 280, borderRadius: 16, overflow: "hidden", marginBottom: 12 }} className="map-frame">
      <MapContainer
        key={driverLocation ? `${driverLocation.lat.toFixed(4)}-${driverLocation.lng.toFixed(4)}` : "static"}
        center={center}
        zoom={13}
        style={{ height: "100%", width: "100%" }}
        scrollWheelZoom={false}
      >
        <MapTiles />

        {polylinePoints && (
          <Polyline positions={polylinePoints} pathOptions={{ color: MAP_COLORS.blue, weight: 5, opacity: 0.85, lineJoin: "round" }} />
        )}

        {visibleStops.map((s) => {
          const color = s.order_status === "FAILED" ? MAP_COLORS.fail : s.order_status === "CANCELLED" ? MAP_COLORS.muted : MAP_COLORS.blue;
          return (
            <Marker key={s.id} position={[s.latitude, s.longitude]} icon={numberIcon(s.originalIndex, color)}>
              <Popup>{s.originalIndex}. {s.customer_name}</Popup>
            </Marker>
          );
        })}
        {shop && (
          <Marker position={shop} icon={L.divIcon({ className: "", html: shopIconHtml(), iconSize: SHOP_ICON_SIZE, iconAnchor: SHOP_ICON_ANCHOR })}>
            <Popup>المحل — نهاية الرحلة</Popup>
          </Marker>
        )}
        {showDriverMarker && driverLocation && (
          <Marker position={[driverLocation.lat, driverLocation.lng]} icon={L.divIcon({ className: "", html: carIconHtml(), iconSize: CAR_ICON_SIZE, iconAnchor: CAR_ICON_ANCHOR })} zIndexOffset={1000}>
            <Popup>موقع السائق الحالي</Popup>
          </Marker>
        )}
      </MapContainer>
    </div>
  );
}
