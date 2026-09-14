import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { FiNavigation, FiPhone, FiCheckCircle, FiAlertTriangle } from "react-icons/fi";
import { FaWhatsapp } from "react-icons/fa";

function formatMinutes(mins) {
  if (mins <= 0) return "أقل من دقيقة";
  if (mins < 60) return `~${mins} دقيقة`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `~${h} ساعة${m > 0 ? ` و${m} دقيقة` : ""}`;
}

export default function Trip() {
  const [trip, setTrip] = useState(undefined);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState(null);
  const [banner, setBanner] = useState("");
  const prevDeliveredRef = useRef(0);

  async function load(silent = false) {
    if (!silent) setError("");
    try {
      const result = await api.getActiveTrip();
      if (result) {
        const deliveredCount = result.stops.filter((s) => s.order_status === "DELIVERED").length;
        if (silent && deliveredCount > prevDeliveredRef.current) {
          setBanner("🎉 تم تسليم طلب جديد بالرحلة");
          setTimeout(() => setBanner(""), 5000);
        }
        prevDeliveredRef.current = deliveredCount;
      }
      setTrip(result);
    } catch (err) {
      if (!silent) setError(err.message);
    }
  }

  useEffect(() => {
    load();
    const interval = setInterval(() => load(true), 15000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!trip || trip.status !== "STARTED" || !navigator.geolocation) return;
    const sendLocation = () => {
      navigator.geolocation.getCurrentPosition(
        (pos) => api.updateTripLocation(trip.id, pos.coords.latitude, pos.coords.longitude).catch(() => {}),
        () => {},
        { enableHighAccuracy: true, timeout: 10000 }
      );
    };
    sendLocation();
    const interval = setInterval(sendLocation, 20000);
    return () => clearInterval(interval);
  }, [trip?.id, trip?.status]);

  if (summary) {
    return (
      <div className="page">
        <TripSummary summary={summary} onDone={() => { setSummary(null); load(); }} />
      </div>
    );
  }

  if (trip === undefined) {
    return <div className="page"><p className="text-secondary">جاري التحميل...</p></div>;
  }

  return (
    <div className="page">
      <h1 className="title-lg">الرحلة</h1>
      {banner && <div className="success-box">{banner}</div>}
      {error && <div className="error-box">{error}</div>}

      {!trip ? (
        <CreateTripForm onCreated={load} />
      ) : (
        <ActiveTripView trip={trip} onChanged={load} onCompleted={(s) => setSummary(s)} />
      )}
    </div>
  );
}

function CreateTripForm({ onCreated }) {
  const [orders, setOrders] = useState([]);
  const [selected, setSelected] = useState({});
  const [useLocation, setUseLocation] = useState(true);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.getOrders({ status: "NEW", limit: 200 }).then((list) => {
      setOrders(list);
      const all = {};
      list.forEach((o) => { all[o.id] = true; });
      setSelected(all);
    }).catch((err) => setError(err.message));
  }, []);

  function toggle(id) {
    setSelected((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  async function handleCreate() {
    setError("");
    const orderIds = Object.entries(selected).filter(([, v]) => v).map(([id]) => Number(id));
    if (orderIds.length === 0) {
      setError("اختر طلب واحد على الأقل.");
      return;
    }

    setLoading(true);
    try {
      let start_latitude, start_longitude;
      if (useLocation && navigator.geolocation) {
        const pos = await new Promise((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000 })
        ).catch(() => null);
        if (pos) {
          start_latitude = pos.coords.latitude;
          start_longitude = pos.coords.longitude;
        }
      }

      await api.createTrip({ order_ids: orderIds, start_latitude, start_longitude });
      onCreated();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (orders.length === 0) {
    return <p className="text-secondary">لا يوجد طلبات جديدة جاهزة للتوزيع حاليًا.</p>;
  }

  return (
    <div className="card">
      {error && <div className="error-box">{error}</div>}
      <h2 className="title-md">إنشاء رحلة جديدة</h2>
      <p className="text-secondary" style={{ marginBottom: 14 }}>
        الطلبات المختارة ({Object.values(selected).filter(Boolean).length} من {orders.length}):
      </p>

      <div style={{ marginBottom: 16, maxHeight: 320, overflowY: "auto" }}>
        {orders.map((o) => (
          <label key={o.id} className="customer-row" style={{ cursor: "pointer" }}>
            <div className="icon-row">
              <input type="checkbox" checked={!!selected[o.id]} onChange={() => toggle(o.id)} />
              <div>
                <div style={{ fontWeight: 600 }}>
                  #{o.order_number} · {o.customer_name}
                  {o.priority === "urgent" && <span style={{ color: "var(--urgent)" }}> 🚨</span>}
                </div>
                <div className="text-secondary tabular-num">{Number(o.final_total).toFixed(2)} JD</div>
              </div>
            </div>
          </label>
        ))}
      </div>

      <label className="icon-row" style={{ marginBottom: 16, fontWeight: 600 }}>
        <input type="checkbox" checked={useLocation} onChange={(e) => setUseLocation(e.target.checked)} />
        ابدأ الترتيب من موقعي الحالي (يعطي أدق نتيجة)
      </label>

      <button className="btn-primary" disabled={loading} onClick={handleCreate}>
        {loading ? "جاري إنشاء الرحلة..." : "🚚 إنشاء الرحلة وترتيبها"}
      </button>
    </div>
  );
}

function ActiveTripView({ trip, onChanged, onCompleted }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const currentStop = trip.stops.find((s) => !s.delivered_at && s.order_status !== "FAILED" && s.order_status !== "CANCELLED");
  const deliveredCount = trip.stops.filter((s) => s.order_status === "DELIVERED").length;
  const totalCount = trip.stops.length;

  const lastLocationLink = trip.current_latitude && trip.current_longitude
    ? `https://www.google.com/maps?q=${trip.current_latitude},${trip.current_longitude}`
    : null;

  async function withBusy(fn) {
    setBusy(true);
    setError("");
    try {
      await fn();
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleComplete() {
    const remaining = totalCount - deliveredCount - trip.stops.filter((s) => s.order_status === "FAILED").length;
    if (remaining > 0 && !confirm(`يوجد ${remaining} طلب لم يُسلَّم بعد. إنهاء الرحلة رح يرجعهم لقائمة الطلبات الجديدة. متابعة؟`)) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const summary = await api.completeTrip(trip.id);
      onCompleted(summary);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {error && <div className="error-box">{error}</div>}

      <div className="card">
        <div className="text-secondary">
          {trip.status === "PLANNED" ? "رحلة جاهزة للبدء" : "رحلة جارية"}
          {trip.total_distance_km && ` · المسافة التقريبية ${Number(trip.total_distance_km).toFixed(1)} كم`}
        </div>
        <div className="tabular-num" style={{ fontSize: "1.3rem", fontWeight: 700 }}>
          {deliveredCount} / {totalCount} تم التسليم
        </div>
        {trip.status === "STARTED" && trip.estimated_minutes_remaining != null && (
          <div className="text-secondary" style={{ marginTop: 4 }}>
            ⏱️ الوقت المتوقع لإنهاء الرحلة: {formatMinutes(trip.estimated_minutes_remaining)}
          </div>
        )}
        {lastLocationLink && (
          <a href={lastLocationLink} target="_blank" rel="noreferrer" className="text-secondary" style={{ display: "block", marginTop: 4, color: "var(--primary)" }}>
            📍 آخر موقع معروف للموزع (اضغط لفتحه على الخريطة)
          </a>
        )}
      </div>

      {trip.status === "PLANNED" && (
        <button className="btn-primary" style={{ marginBottom: 12 }} disabled={busy} onClick={() => withBusy(() => api.startTrip(trip.id))}>
          ▶️ بدء الرحلة
        </button>
      )}

      {trip.status === "STARTED" && currentStop && (
        <StopCard stop={currentStop} busy={busy} withBusy={withBusy} />
      )}

      {trip.status === "STARTED" && !currentStop && (
        <div className="success-box">كل التوقفات انتهت — جاهز لإنهاء الرحلة.</div>
      )}

      <button className="btn-danger-text" style={{ marginTop: 16 }} disabled={busy} onClick={handleComplete}>
        إنهاء الرحلة
      </button>
    </div>
  );
}

function StopCard({ stop, busy, withBusy }) {
  const mapLink = stop.maps_url || (stop.latitude && stop.longitude ? `https://www.google.com/maps?q=${stop.latitude},${stop.longitude}` : null);
  const whatsappLink = `https://wa.me/${stop.phone_normalized}`;

  function handleFail() {
    const reason = prompt("سبب تعذر التسليم؟ (لا يرد / غير موجود / مشكلة وصول / آخر)");
    if (reason === null) return;
    withBusy(() => api.failStop(stop.id, reason));
  }

  return (
    <div className="card">
      {stop.building_photo_url && (
        <img src={stop.building_photo_url} alt="صورة العمارة" style={{ width: "100%", borderRadius: 8, marginBottom: 12 }} />
      )}

      <h2 className="title-md">
        {stop.customer_name}
        {stop.priority === "urgent" && <span style={{ color: "var(--urgent)" }}> 🚨 مستعجل</span>}
      </h2>
      <p className="tabular-num text-secondary">#{stop.order_number} · {Number(stop.final_total).toFixed(2)} JD</p>

      <p className="text-secondary" style={{ lineHeight: 1.8 }}>
        {stop.street && <>الشارع: {stop.street}<br /></>}
        {stop.building_number && <>عمارة: {stop.building_number} {stop.building_name && `(${stop.building_name})`}<br /></>}
        {stop.floor && <>الطابق: {stop.floor}<br /></>}
        {stop.apartment && <>شقة: {stop.apartment} {stop.side && `— ${stop.side}`}<br /></>}
        {stop.access_notes && <>ملاحظة: {stop.access_notes}<br /></>}
        {stop.order_notes && <>📝 {stop.order_notes}</>}
      </p>

      <div className="icon-row" style={{ marginBottom: 16 }}>
        {mapLink && (
          <a className="icon-btn map" href={mapLink} target="_blank" rel="noreferrer" title="الملاحة">
            <FiNavigation size={16} />
          </a>
        )}
        <a className="icon-btn whatsapp" href={whatsappLink} target="_blank" rel="noreferrer" title="واتساب">
          <FaWhatsapp size={16} />
        </a>
        <a className="icon-btn" href={`tel:${stop.phone_display}`} title="اتصال">
          <FiPhone size={16} />
        </a>
      </div>

      <button
        className="btn-primary icon-row"
        style={{ justifyContent: "center", marginBottom: 10, background: "var(--success)" }}
        disabled={busy}
        onClick={() => withBusy(() => api.deliverStop(stop.id))}
      >
        <FiCheckCircle /> تم التسليم
      </button>
      <button className="btn-danger-text icon-row" style={{ justifyContent: "center" }} disabled={busy} onClick={handleFail}>
        <FiAlertTriangle /> تعذر التسليم
      </button>
    </div>
  );
}

function TripSummary({ summary, onDone }) {
  return (
    <div className="card">
      <h2 className="title-md">ملخص الرحلة</h2>

      <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
        <span>إجمالي التوقفات</span>
        <span className="tabular-num" style={{ fontWeight: 700 }}>{summary.total_stops}</span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
        <span>تم التسليم</span>
        <span className="tabular-num" style={{ fontWeight: 700, color: "var(--success)" }}>{summary.delivered}</span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
        <span>تعذر التسليم</span>
        <span className="tabular-num" style={{ fontWeight: 700, color: "var(--urgent)" }}>{summary.failed}</span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
        <span>رجعت لقائمة الطلبات</span>
        <span className="tabular-num" style={{ fontWeight: 700 }}>{summary.returned_to_queue}</span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", marginBottom: 14 }}>
        <span style={{ fontWeight: 700 }}>إجمالي قيمة التسليم</span>
        <span className="tabular-num" style={{ fontWeight: 700, fontSize: "1.2rem" }}>{summary.total_delivered_value.toFixed(2)} JD</span>
      </div>

      {summary.products_summary.length > 0 && (
        <div className="card" style={{ background: "var(--bg)" }}>
          <div className="text-secondary" style={{ marginBottom: 6 }}>المنتجات الموزعة</div>
          {summary.products_summary.map((p, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between" }}>
              <span>{p.product_name_snapshot}</span>
              <span className="tabular-num">{p.total_quantity}</span>
            </div>
          ))}
        </div>
      )}

      <button className="btn-primary" style={{ marginTop: 16 }} onClick={onDone}>تم</button>
    </div>
  );
}
