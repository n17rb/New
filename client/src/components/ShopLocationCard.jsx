import { useEffect, useState } from "react";
import { FiMapPin } from "react-icons/fi";
import { api } from "../api.js";
import { usePerms } from "../auth.jsx";

// موقع المحل — كل رحلة بتخلص فيه
export default function ShopLocationCard({ compact = false }) {
  const { canEdit } = usePerms();
  const editable = canEdit("settings");
  const [shop, setShop] = useState(undefined);
  const [editing, setEditing] = useState(false);
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    api.getShopLocation().then((r) => setShop(r)).catch(() => setShop(null));
  }, []);

  async function save(body) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const r = await api.setShopLocation(body);
      setShop({ latitude: r.latitude, longitude: r.longitude });
      setMessage(r.message);
      setEditing(false);
      setLink("");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function useMyLocation() {
    if (!navigator.geolocation) {
      setError("الجهاز ما بيدعم تحديد الموقع.");
      return;
    }
    if (!confirm("متأكد إنك موجود هلّق بالمحل؟ رح ينحفظ موقعك الحالي كموقع المحل.")) return;
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => save({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      () => { setBusy(false); setError("ما قدرت آخذ موقعك — اسمح للتطبيق بالوصول للموقع."); },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  }

  if (shop === undefined) return null;
  if (!shop && !editable) {
    return <p className="text-secondary">موقع المحل مش محدد لسا.</p>;
  }

  if (shop && !editing) {
    return (
      <div className="text-secondary" style={{ fontSize: "0.85rem", marginBottom: compact ? 0 : 12, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        🏪 كل رحلة بتخلص بالرجوع للمحل
        <a href={`https://www.google.com/maps?q=${shop.latitude},${shop.longitude}`} target="_blank" rel="noreferrer">(شوف الموقع)</a>
        {editable && (
          <button type="button" onClick={() => setEditing(true)} style={{ background: "none", border: "none", color: "var(--primary)", cursor: "pointer", padding: 0, fontSize: "0.85rem" }}>
            تغيير
          </button>
        )}
        {message && <span style={{ color: "var(--success)" }}>{message}</span>}
      </div>
    );
  }

  return (
    <div className="card" style={{ border: shop ? undefined : "2px solid var(--warning)" }}>
      <h2 className="title-md" style={{ marginTop: 0, display: "flex", alignItems: "center", gap: 6 }}>
        <FiMapPin /> موقع المحل
      </h2>
      {!shop && (
        <p style={{ marginTop: 0, fontSize: "0.9rem" }}>
          حدد موقع المحل مرة وحدة، وبعدها كل رحلة بتترتب من الأقرب للأبعد وبتخلص بالرجوع للمحل تلقائيًا.
        </p>
      )}
      {error && <div className="error-box">{error}</div>}
      <button className="btn-primary" disabled={busy} onClick={useMyLocation} style={{ marginBottom: 10 }}>
        📍 أنا بالمحل هلّق — استخدم موقعي
      </button>
      <div className="field" style={{ marginBottom: 8 }}>
        <label>أو الصق رابط موقع المحل من خرائط جوجل</label>
        <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://maps.app.goo.gl/..." dir="ltr" />
      </div>
      <button className="btn-secondary" disabled={busy || !link.trim()} onClick={() => save({ maps_url: link.trim() })} style={{ marginBottom: shop ? 8 : 0 }}>
        {busy ? "جاري الحفظ..." : "حفظ الرابط"}
      </button>
      {shop && <button className="btn-secondary" onClick={() => { setEditing(false); setError(""); }}>إلغاء</button>}
    </div>
  );
}
