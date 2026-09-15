import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { FiNavigation, FiPhone, FiCheckCircle, FiAlertTriangle } from "react-icons/fi";
import { FaWhatsapp } from "react-icons/fa";
import RoutePreviewMap from "../components/RoutePreviewMap.jsx";

function formatMinutes(mins) {
  if (mins <= 0) return "أقل من دقيقة";
  if (mins < 60) return `~${mins} دقيقة`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `~${h} ساعة${m > 0 ? ` و${m} دقيقة` : ""}`;
}

function formatClockTime(iso) {
  return new Date(iso).toLocaleTimeString("ar-JO", { timeZone: "Asia/Amman", hour: "2-digit", minute: "2-digit" });
}

export default function Trip({ user }) {
  const [trip, setTrip] = useState(undefined);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState(null);
  const [banner, setBanner] = useState("");
  const prevDeliveredRef = useRef(0);

  const isDriver = user.role === "driver";
  const isSuperAdmin = user.role === "super_admin";
  const isManagerViewOnly = user.role === "admin";

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
    const interval = setInterval(() => load(true), 12000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!trip || trip.status !== "STARTED" || !trip.can_operate || !navigator.geolocation) return;
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
  }, [trip?.id, trip?.status, trip?.can_operate]);

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

      {!trip && isDriver && <CreateTripForm onCreated={load} />}
      {!trip && !isDriver && <p className="text-secondary">لا توجد رحلة نشطة حاليًا.</p>}

      {trip && (
        <ActiveTripView
          trip={trip}
          isSuperAdmin={isSuperAdmin}
          isManagerViewOnly={isManagerViewOnly}
          canOperate={trip.can_operate}
          onChanged={load}
          onCompleted={(s) => setSummary(s)}
        />
      )}
    </div>
  );
}

function CreateTripForm({ onCreated }) {
  const [orders, setOrders] = useState([]);
  const [selected, setSelected] = useState({});
  const [routeMode, setRouteMode] = useState("urgent_smart");
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

      await api.createTrip({ order_ids: orderIds, start_latitude, start_longitude, route_mode: routeMode });
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

      <div className="field">
        <label>طريقة الترتيب</label>
        <div style={{ display: "flex", gap: 10 }}>
          <button
            type="button"
            className={routeMode === "nearest" ? "btn-primary" : "btn-secondary"}
            style={{ flex: 1 }}
            onClick={() => setRouteMode("nearest")}
          >
            الأقرب فالأبعد
          </button>
          <button
            type="button"
            className={routeMode === "urgent_smart" ? "btn-primary" : "btn-secondary"}
            style={{ flex: 1 }}
            onClick={() => setRouteMode("urgent_smart")}
          >
            🚨 ذكي (يرجّح المستعجل)
          </button>
        </div>
      </div>

      <p className="text-secondary" style={{ marginBottom: 14 }}>
        الطلبات المختارة ({Object.values(selected).filter(Boolean).length} من {orders.length}):
      </p>

      <div style={{ marginBottom: 16, maxHeight: 300, overflowY: "auto" }}>
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
        ابدأ الترتيب من موقعي الحالي (يحسّن أول نقطة، مو ضروري)
      </label>

      <button className="btn-primary" disabled={loading} onClick={handleCreate}>
        {loading ? "جاري البدء..." : "🚀 بدء الرحلة"}
      </button>
    </div>
  );
}

function ActiveTripView({ trip, isSuperAdmin, isManagerViewOnly, canOperate, onChanged, onCompleted }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const currentStop = trip.stops.find((s) => !s.delivered_at && s.order_status !== "FAILED" && s.order_status !== "CANCELLED");
  const deliveredCount = trip.stops.filter((s) => s.order_status === "DELIVERED").length;
  const totalCount = trip.stops.length;
  const remainingCount = totalCount - deliveredCount - trip.stops.filter((s) => s.order_status === "FAILED").length;

  const remainingKm = trip.total_distance_km && totalCount > 0
    ? (Number(trip.total_distance_km) * (remainingCount / totalCount)).toFixed(1)
    : null;

  let estimatedFinishLabel = null;
  if (trip.status === "STARTED" && trip.estimated_minutes_remaining != null) {
    const finishDate = new Date(Date.now() + trip.estimated_minutes_remaining * 60000);
    estimatedFinishLabel = `${formatMinutes(trip.estimated_minutes_remaining)} (حوالي الساعة ${formatClockTime(finishDate)})`;
  }

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
    const remaining = remainingCount;
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
          رحلة جارية
          {trip.driver_name && ` · السائق: ${trip.driver_name}`}
        </div>
        <div className="tabular-num" style={{ fontSize: "1.3rem", fontWeight: 700 }}>
          {deliveredCount} / {totalCount} تم التسليم
        </div>
        {trip.started_at && (
          <div className="text-secondary">🕐 وقت البدء: {formatClockTime(trip.started_at)}</div>
        )}
        {remainingKm && (
          <div className="text-secondary">المسافة المتبقية التقريبية: {remainingKm} كم</div>
        )}
        {estimatedFinishLabel && (
          <div className="text-secondary" style={{ marginTop: 4 }}>⏱️ الوقت المتوقع لإنهاء الرحلة: {estimatedFinishLabel}</div>
        )}
        {isManagerViewOnly && (
          <div className="text-secondary" style={{ marginTop: 6, fontStyle: "italic" }}>وضع العرض فقط — التحكم بالرحلة للسائق</div>
        )}
      </div>

      <RoutePreviewMap
        stops={trip.stops}
        driverLocation={trip.current_latitude ? { lat: trip.current_latitude, lng: trip.current_longitude } : null}
        showDriverMarker={isSuperAdmin || isManagerViewOnly}
      />

      {canOperate && trip.status === "STARTED" && currentStop && (
        <StopCard stop={currentStop} busy={busy} withBusy={withBusy} />
      )}

      {canOperate && trip.status === "STARTED" && !currentStop && (
        <div className="success-box">كل التوقفات انتهت — جاهز لإنهاء الرحلة.</div>
      )}

      {canOperate && (
        <button className="btn-danger-text" style={{ marginTop: 16 }} disabled={busy} onClick={handleComplete}>
          إنهاء الرحلة
        </button>
      )}
    </div>
  );
}

function StopCard({ stop, busy, withBusy }) {
  const [showFailMenu, setShowFailMenu] = useState(false);
  const [showPostponeForm, setShowPostponeForm] = useState(false);
  const [postponeTime, setPostponeTime] = useState("");
  const [postponeNote, setPostponeNote] = useState("");

  const mapLink = stop.maps_url || (stop.latitude && stop.longitude ? `https://www.google.com/maps?q=${stop.latitude},${stop.longitude}` : null);
  const whatsappLink = `https://wa.me/${stop.phone_normalized}`;

  function handlePostponeSubmit() {
    withBusy(() => api.postponeStop(stop.id, { note: postponeNote, new_time: postponeTime })).then(() => {
      setShowPostponeForm(false);
      setShowFailMenu(false);
      setPostponeTime("");
      setPostponeNote("");
    });
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

      {!showFailMenu && (
        <button className="btn-danger-text icon-row" style={{ justifyContent: "center" }} disabled={busy} onClick={() => setShowFailMenu(true)}>
          <FiAlertTriangle /> تعذر التسليم
        </button>
      )}

      {showFailMenu && !showPostponeForm && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <button className="btn-secondary" disabled={busy} onClick={() => withBusy(() => api.failStop(stop.id, "خارج المنزل"))}>
            خارج المنزل
          </button>
          <button className="btn-secondary" disabled={busy} onClick={() => withBusy(() => api.failStop(stop.id, "لا يرد"))}>
            لا يرد
          </button>
          <button className="btn-secondary" disabled={busy} onClick={() => setShowPostponeForm(true)}>
            ⏰ تأجيل (يرجعله بنفس الرحلة لاحقًا)
          </button>
          <button className="btn-secondary" onClick={() => setShowFailMenu(false)}>رجوع</button>
        </div>
      )}

      {showPostponeForm && (
        <div className="card" style={{ background: "var(--bg)" }}>
          <div className="field">
            <label>الموعد الجديد المطلوب (اختياري)</label>
            <input type="datetime-local" value={postponeTime} onChange={(e) => setPostponeTime(e.target.value)} />
          </div>
          <div className="field">
            <label>ملاحظة (مثال: طلب يوصله بعد الظهر)</label>
            <input value={postponeNote} onChange={(e) => setPostponeNote(e.target.value)} />
          </div>
          <button className="btn-primary" style={{ marginBottom: 8 }} disabled={busy} onClick={handlePostponeSubmit}>
            تأكيد التأجيل
          </button>
          <button className="btn-secondary" onClick={() => setShowPostponeForm(false)}>إلغاء</button>
        </div>
      )}
    </div>
  );
}

function TripSummary({ summary, onDone }) {
  return (
    <div className="card">
      <h2 className="title-md">ملخص الرحلة</h2>

      {summary.started_at && summary.completed_at && (
        <p className="text-secondary">
          🕐 من {formatClockTime(summary.started_at)} إلى {formatClockTime(summary.completed_at)}
        </p>
      )}

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
