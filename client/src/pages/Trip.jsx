import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { FiNavigation, FiPhone, FiCheckCircle, FiAlertTriangle, FiMapPin, FiRefreshCw } from "react-icons/fi";
import { FaWhatsapp } from "react-icons/fa";
import RoutePreviewMap from "../components/RoutePreviewMap.jsx";
import { BottleTypeBadge, NeedsQuantityBadge } from "../components/BottleType.jsx";

function formatMinutes(mins) {
  if (mins <= 0) return "أقل من دقيقة";
  if (mins < 60) return `~${mins} دقيقة`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `~${h} ساعة${m > 0 ? ` و${m} دقيقة` : ""}`;
}

function formatClockTime(input) {
  const d = typeof input === "number" ? new Date(Date.now() + input * 60000) : new Date(input);
  return d.toLocaleTimeString("ar-JO", { timeZone: "Asia/Amman", hour: "2-digit", minute: "2-digit" });
}

export default function Trip({ user }) {
  const isPrivileged = user.role === "super_admin" || user.role === "admin";
  if (user.role === "data_entry") {
    return <div className="page"><p className="text-secondary">لا يوجد وصول لهذا القسم.</p></div>;
  }
  return <UnifiedTripView user={user} isPrivileged={isPrivileged} />;
}

function UnifiedTripView({ user, isPrivileged }) {
  const [myTrip, setMyTrip] = useState(undefined);
  const [otherTrips, setOtherTrips] = useState([]);
  const [selectedOtherId, setSelectedOtherId] = useState(null);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState(null);
  const [banner, setBanner] = useState("");
  const prevDeliveredRef = useRef(0);

  async function load(silent = false) {
    if (!silent) setError("");
    try {
      const mine = await api.getMyTrip();
      if (mine) {
        const deliveredCount = mine.stops.filter((s) => s.order_status === "DELIVERED").length;
        if (silent && deliveredCount > prevDeliveredRef.current) {
          setBanner("🎉 تم تسليم طلب جديد بالرحلة");
          setTimeout(() => setBanner(""), 5000);
        }
        prevDeliveredRef.current = deliveredCount;
      }
      setMyTrip(mine);

      if (isPrivileged) {
        const all = await api.getActiveTripsList();
        setOtherTrips(all.filter((t) => t.driver_id !== user.id));
      }
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
    if (!myTrip || myTrip.status !== "STARTED" || !navigator.geolocation) return;
    const sendLocation = () => {
      navigator.geolocation.getCurrentPosition(
        (pos) => api.updateTripLocation(myTrip.id, pos.coords.latitude, pos.coords.longitude).catch(() => {}),
        () => {},
        { enableHighAccuracy: true, timeout: 10000 }
      );
    };
    sendLocation();
    const interval = setInterval(sendLocation, 20000);

    function handleVisibility() {
      if (document.visibilityState === "visible") sendLocation();
    }
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [myTrip?.id, myTrip?.status]);

  if (selectedOtherId) {
    return (
      <div className="page">
        <OtherTripDetail tripId={selectedOtherId} isSuperAdmin={user.role === "super_admin"} onBack={() => { setSelectedOtherId(null); load(); }} />
      </div>
    );
  }

  if (summary) {
    return (
      <div className="page">
        <TripSummary summary={summary} onDone={() => { setSummary(null); load(); }} />
      </div>
    );
  }

  if (myTrip === undefined) {
    return <div className="page"><p className="text-secondary">جاري التحميل...</p></div>;
  }

  return (
    <div className="page">
      <h1 className="title-lg">الرحلة</h1>
      {banner && <div className="success-box">{banner}</div>}
      {error && <div className="error-box">{error}</div>}

      {!myTrip ? (
        <CreateTripForm isPrivileged={isPrivileged} onCreated={load} />
      ) : (
        <ActiveTripView
          trip={myTrip}
          isSuperAdmin={user.role === "super_admin"}
          isManagerViewOnly={false}
          canOperate={myTrip.can_operate}
          onChanged={load}
          onCompleted={(s) => setSummary(s)}
        />
      )}

      {isPrivileged && otherTrips.length > 0 && (
        <div className="card">
          <h2 className="title-md">رحلات سائقين آخرين (عرض فقط)</h2>
          {otherTrips.map((t) => (
            <div key={t.id} className="customer-row" style={{ padding: "10px 0", cursor: "pointer" }} onClick={() => setSelectedOtherId(t.id)}>
              <div>
                <div style={{ fontWeight: 600 }}>{t.driver_name || "سائق غير معروف"}</div>
                <div className="text-secondary tabular-num">{t.delivered_count} / {t.total_count} تم التسليم</div>
              </div>
              <span className="badge">{t.status === "STARTED" ? "جارية" : "جاهزة"}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function OtherTripDetail({ tripId, isSuperAdmin, onBack }) {
  const [trip, setTrip] = useState(undefined);
  const [error, setError] = useState("");

  async function load() {
    try {
      setTrip(await api.getTripDetail(tripId));
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 12000);
    return () => clearInterval(interval);
  }, [tripId]);

  if (trip === undefined) return <p className="text-secondary">جاري التحميل...</p>;
  if (!trip) return <div className="error-box">تعذّر تحميل الرحلة.</div>;

  return (
    <div>
      <button className="btn-danger-text" style={{ marginBottom: 10 }} onClick={onBack}>← رجوع</button>
      {error && <div className="error-box">{error}</div>}
      <ActiveTripView
        trip={trip}
        isSuperAdmin={isSuperAdmin}
        isManagerViewOnly={!isSuperAdmin}
        canOperate={trip.can_operate}
        onChanged={load}
        onCompleted={() => onBack()}
      />
    </div>
  );
}

function ShopLocationCard({ compact = false }) {
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

  if (shop && !editing) {
    return (
      <div className="text-secondary" style={{ fontSize: "0.85rem", marginBottom: compact ? 0 : 12, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        🏪 كل رحلة بتخلص بالرجوع للمحل
        <a href={`https://www.google.com/maps?q=${shop.latitude},${shop.longitude}`} target="_blank" rel="noreferrer">(شوف الموقع)</a>
        <button type="button" onClick={() => setEditing(true)} style={{ background: "none", border: "none", color: "var(--primary, #0094FF)", cursor: "pointer", padding: 0, fontSize: "0.85rem" }}>
          تغيير
        </button>
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

function CreateTripForm({ isPrivileged, onCreated }) {
  const [orders, setOrders] = useState([]);
  const [selected, setSelected] = useState({});
  const [routeMode, setRouteMode] = useState("nearest");
  const [useLocation, setUseLocation] = useState(true);
  const [drivers, setDrivers] = useState([]);
  const [assignTo, setAssignTo] = useState("self");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);

  async function loadOrders() {
    setFetching(true);
    setError("");
    try {
      const list = await api.getOrders({ status: "NEW", limit: 200 });
      setOrders(list);
      const all = {};
      list.forEach((o) => { all[o.id] = true; });
      setSelected(all);
    } catch (err) {
      setError(err.message);
    } finally {
      setFetching(false);
    }
  }

  useEffect(() => {
    loadOrders();
    if (isPrivileged) {
      api.getAvailableDrivers().then(setDrivers).catch(() => {});
    }
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
    if (isPrivileged && assignTo !== "self" && !assignTo) {
      setError("اختر السائق المسؤول عن الرحلة.");
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

      await api.createTrip({
        order_ids: orderIds,
        start_latitude,
        start_longitude,
        route_mode: routeMode,
        driver_id: isPrivileged && assignTo !== "self" ? Number(assignTo) : undefined,
      });
      onCreated();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (fetching) {
    return <p className="text-secondary">جاري تحميل الطلبات الجديدة...</p>;
  }

  if (orders.length === 0) {
    return (
      <div>
        {isPrivileged ? <ShopLocationCard /> : null}
        <p className="text-secondary" style={{ marginBottom: 10 }}>لا يوجد طلبات جديدة جاهزة للتوزيع حاليًا.</p>
        <button className="btn-secondary" onClick={loadOrders}>🔄 تحديث</button>
      </div>
    );
  }

  return (
    <div className="card">
      {error && <div className="error-box">{error}</div>}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <h2 className="title-md" style={{ margin: 0 }}>إنشاء رحلة جديدة</h2>
        <button className="btn-secondary" style={{ width: "auto", padding: "8px 12px" }} onClick={loadOrders}>🔄 تحديث</button>
      </div>

      {isPrivileged ? <ShopLocationCard /> : null}

      {isPrivileged && (
        <div className="field">
          <label>مين اللي رح يوصّل هذه الرحلة؟</label>
          <select value={assignTo} onChange={(e) => setAssignTo(e.target.value)}>
            <option value="self">أنا بنفسي</option>
            {drivers.map((d) => (
              <option key={d.id} value={d.id}>{d.full_name}</option>
            ))}
          </select>
        </div>
      )}

      <div className="field">
        <label>طريقة الترتيب</label>
        <div style={{ display: "flex", gap: 10 }}>
          <button
            type="button"
            className={routeMode === "nearest" ? "btn-primary" : "btn-secondary"}
            style={{ flex: 1 }}
            onClick={() => setRouteMode("nearest")}
          >
            الأقرب فالأبعد (أقصر طريق)
          </button>
          <button
            type="button"
            className={routeMode === "urgent_smart" ? "btn-primary" : "btn-secondary"}
            style={{ flex: 1 }}
            onClick={() => setRouteMode("urgent_smart")}
          >
            🚨 المستعجل أولًا
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
                  {" "}<BottleTypeBadge type={o.bottle_type} />
                  {" "}<NeedsQuantityBadge order={o} />
                </div>
                <div className="text-secondary tabular-num">{Number(o.final_total).toFixed(2)} JD</div>
              </div>
            </div>
          </label>
        ))}
      </div>

      <label className="icon-row" style={{ marginBottom: 16, fontWeight: 600 }}>
        <input type="checkbox" checked={useLocation} onChange={(e) => setUseLocation(e.target.checked)} />
        ابدأ الترتيب من موقعي الحالي (لو مطفي بيبدأ من المحل)
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
  const [reordering, setReordering] = useState(false);
  const [reorderMessage, setReorderMessage] = useState("");
  // التوقفات اللي انضغط عليها «تم التسليم» وبنستنى رد السيرفر — بتظهر متسلّمة فورًا
  const [optimistic, setOptimistic] = useState({});

  useEffect(() => {
    // لما توصل البيانات الحقيقية من السيرفر، ما عاد في داعي للحالة المؤقتة
    setOptimistic((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const s of trip.stops) {
        if (next[s.id] && s.delivered_at) { delete next[s.id]; changed = true; }
      }
      return changed ? next : prev;
    });
  }, [trip]);

  const stops = trip.stops.map((s) =>
    optimistic[s.id] && !s.delivered_at
      ? { ...s, delivered_at: new Date().toISOString(), order_status: "DELIVERED", estimated_eta_minutes: null }
      : s
  );

  function deliverFast(stop, itemPayments) {
    setError("");
    setOptimistic((prev) => ({ ...prev, [stop.id]: true }));
    api.deliverStop(stop.id, itemPayments)
      .then(() => onChanged())
      .catch((err) => {
        setOptimistic((prev) => {
          const next = { ...prev };
          delete next[stop.id];
          return next;
        });
        setError(`ما تسجّل تسليم ${stop.customer_name}: ${err.message}`);
      });
  }

  async function handleReorder() {
    setReordering(true);
    setReorderMessage("");
    setError("");
    try {
      const r = await api.reoptimizeTrip(trip.id);
      setReorderMessage(r.message);
      setTimeout(() => setReorderMessage(""), 5000);
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setReordering(false);
    }
  }

  const currentStop = stops.find((s) => !s.delivered_at && s.order_status !== "FAILED" && s.order_status !== "CANCELLED" && !s.is_time_locked);
  const nextLockedStop = [...stops].filter((s) => s.is_time_locked).sort((a, b) => new Date(a.requested_time) - new Date(b.requested_time))[0];
  const deliveredCount = stops.filter((s) => s.order_status === "DELIVERED").length;
  const totalCount = stops.length;
  const remainingCount = totalCount - deliveredCount - stops.filter((s) => s.order_status === "FAILED").length;

  const remainingKm = trip.total_remaining_distance_km != null ? trip.total_remaining_distance_km.toFixed(1) : null;

  let estimatedFinishLabel = null;
  if (trip.status === "STARTED" && trip.estimated_minutes_remaining != null) {
    estimatedFinishLabel = `${formatMinutes(trip.estimated_minutes_remaining)} (حوالي الساعة ${formatClockTime(trip.estimated_minutes_remaining)})`;
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
        {trip.total_distance_km > 0 && (
          <div className="text-secondary">
            المسافة الكلية: {Number(trip.total_distance_km).toFixed(1)} كم
            {trip.distance_before_km > trip.total_distance_km && (
              <> · وفّرنا {(Number(trip.distance_before_km) - Number(trip.total_distance_km)).toFixed(1)} كم بالتحسين ✅</>
            )}
          </div>
        )}
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

      {(isSuperAdmin || isManagerViewOnly) && !trip.current_latitude && (
        <div className="card" style={{ background: "var(--bg)" }}>
          🚚 لسا ما وصلنا أول تحديث موقع من السائق — تأكد إنه فاتح صفحة "الرحلة" بجهازه وموافق على إذن الموقع بالمتصفح.
        </div>
      )}

      {(isSuperAdmin || isManagerViewOnly) && trip.current_latitude && trip.location_updated_at && (
        <div className="text-secondary" style={{ marginBottom: 12, fontSize: "0.8rem" }}>
          📍 آخر تحديث موقع: {formatClockTime(trip.location_updated_at)}
          {(Date.now() - new Date(trip.location_updated_at).getTime()) > 3 * 60 * 1000 && (
            <span style={{ color: "var(--urgent)" }}> — تحديث قديم، تأكد السائق فاتح التطبيق</span>
          )}
        </div>
      )}

      <RoutePreviewMap
        shopLocation={trip.shop_location}
        stops={stops}
        driverLocation={trip.current_latitude ? { lat: trip.current_latitude, lng: trip.current_longitude } : null}
        showDriverMarker={isSuperAdmin || isManagerViewOnly}
        routeGeometry={trip.route_geometry}
      />

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <h2 className="title-md" style={{ margin: 0 }}>كل توقفات الرحلة بالترتيب</h2>
          {trip.status === "STARTED" && (canOperate || isSuperAdmin || isManagerViewOnly) && (
            <button
              className="btn-secondary"
              style={{ width: "auto", padding: "6px 10px", fontSize: "0.8rem", display: "flex", alignItems: "center", gap: 4 }}
              disabled={reordering}
              onClick={handleReorder}
            >
              <FiRefreshCw /> {reordering ? "جاري الترتيب..." : "رتّب من جديد"}
            </button>
          )}
        </div>
        {reorderMessage && <div className="success-box" style={{ marginBottom: 8 }}>{reorderMessage}</div>}
        {stops.map((s, i) => (
          <div key={s.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
            <div className="icon-row">
              <span style={{
                width: 24, height: 24, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "0.75rem", fontWeight: 700, color: "#fff",
                background: s.order_status === "DELIVERED" ? "var(--success)" : s.order_status === "FAILED" ? "var(--urgent)" : s.order_status === "CANCELLED" ? "var(--text-secondary)" : "var(--primary)",
              }}>
                {i + 1}
              </span>
              <span>{s.customer_name}</span>
              <BottleTypeBadge type={s.bottle_type} />
              {!s.latitude && <span className="text-secondary" style={{ fontSize: "0.75rem" }}> (بدون موقع محفوظ)</span>}
              {s.is_time_locked && <span style={{ color: "var(--warning)", fontSize: "0.75rem" }}> ⏰ لموعد {formatClockTime(s.requested_time)}</span>}
            </div>
            <div style={{ textAlign: "left" }}>
              <span className="badge">{s.order_status === "DELIVERED" ? "تم" : s.order_status === "FAILED" ? "تعذر" : s.order_status === "CANCELLED" ? "ملغي" : "قيد الانتظار"}</span>
              {s.estimated_eta_minutes != null && (
                <div className="text-secondary tabular-num" style={{ fontSize: "0.7rem", marginTop: 2 }}>
                  متوقع: {formatClockTime(s.estimated_eta_minutes)}
                  {s.remaining_distance_km != null && ` · ${s.remaining_distance_km} كم`}
                </div>
              )}
            </div>
          </div>
        ))}
        {trip.shop_location && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0 2px" }}>
            <div className="icon-row">
              <span style={{
                width: 24, height: 24, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "0.8rem", background: "#B8862E", color: "#fff",
              }}>🏪</span>
              <span style={{ fontWeight: 600 }}>الرجوع للمحل</span>
            </div>
            {trip.return_leg_km != null && (
              <span className="text-secondary tabular-num" style={{ fontSize: "0.75rem" }}>{Number(trip.return_leg_km).toFixed(1)} كم من آخر زبون</span>
            )}
          </div>
        )}
      </div>

      {canOperate && trip.status === "STARTED" && currentStop && (
        <StopCard key={currentStop.id} stop={currentStop} busy={busy} withBusy={withBusy} deliverFast={deliverFast} />
      )}

      {canOperate && trip.status === "STARTED" && !currentStop && nextLockedStop && (
        <div className="card" style={{ background: "var(--bg)" }}>
          ⏰ باقي {stops.filter((s) => s.is_time_locked).length} طلب مؤجل لموعد محدد — أقرب موعد: {formatClockTime(nextLockedStop.requested_time)} (زبون {nextLockedStop.customer_name}). رح يظهر تلقائيًا لما يجي وقته.
        </div>
      )}

      {canOperate && trip.status === "STARTED" && !currentStop && !nextLockedStop && (
        <div className="success-box">
          كل التوقفات انتهت{trip.shop_location ? " — ارجع للمحل وأنهِ الرحلة 🏪" : " — جاهز لإنهاء الرحلة."}
        </div>
      )}

      {canOperate && trip.last_delivered_stop_id && (
        <button
          className="btn-secondary"
          style={{ marginTop: 10 }}
          disabled={busy}
          onClick={() => withBusy(() => api.undoDeliver(trip.last_delivered_stop_id))}
        >
          ↩️ تراجع عن آخر تسليم (لو ضغطت بالغلط)
        </button>
      )}

      {canOperate && (
        <button className="btn-danger-text" style={{ marginTop: 16 }} disabled={busy} onClick={handleComplete}>
          إنهاء الرحلة
        </button>
      )}
    </div>
  );
}

function DeliveryPaymentForm({ stop, busy, deliverFast, onCancel }) {
  const eligibleItems = stop.items.filter((it) => it.coupon_eligible);
  const [couponQty, setCouponQty] = useState(() => {
    const initial = {};
    eligibleItems.forEach((it) => { initial[it.id] = it.coupon_quantity || 0; });
    return initial;
  });

  const totalCouponsSelected = Object.values(couponQty).reduce((sum, v) => sum + v, 0);
  const exceedsBalance = totalCouponsSelected > stop.coupon_balance;

  const cashTotal = stop.items.reduce((sum, it) => {
    const used = couponQty[it.id] || 0;
    return sum + (it.quantity - used) * Number(it.unit_price_snapshot);
  }, 0);

  function setQty(itemId, value, max) {
    const v = Math.max(0, Math.min(max, value));
    setCouponQty((prev) => ({ ...prev, [itemId]: v }));
  }

  function handleConfirm() {
    const item_payments = eligibleItems.map((it) => ({ item_id: it.id, coupon_qty: couponQty[it.id] || 0 }));
    deliverFast(stop, item_payments);
    onCancel();
  }

  return (
    <div className="card">
      <h2 className="title-md">طريقة الدفع — {stop.customer_name}</h2>
      <p className="text-secondary" style={{ marginBottom: 12 }}>
        رصيد كوبونات العميل الحالي: <strong className="tabular-num">{stop.coupon_balance}</strong>
      </p>

      {stop.items.map((it) => {
        if (!it.coupon_eligible) {
          return (
            <div key={it.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
              <span>{it.product_name_snapshot} × {it.quantity}</span>
              <span className="text-secondary">كاش دايمًا (غير مؤهل لكوبون)</span>
            </div>
          );
        }
        return (
          <div key={it.id} style={{ padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ fontWeight: 600 }}>{it.product_name_snapshot} (الكمية: {it.quantity})</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span className="text-secondary" style={{ fontSize: "0.85rem" }}>كوبون:</span>
              <button type="button" onClick={() => setQty(it.id, (couponQty[it.id] || 0) - 1, it.quantity)} style={{ width: 32, height: 32, borderRadius: 8, border: "1px solid var(--border)", background: "#fff" }}>−</button>
              <span className="tabular-num" style={{ minWidth: 20, textAlign: "center", fontWeight: 700 }}>{couponQty[it.id] || 0}</span>
              <button type="button" onClick={() => setQty(it.id, (couponQty[it.id] || 0) + 1, it.quantity)} style={{ width: 32, height: 32, borderRadius: 8, border: "none", background: "var(--primary)", color: "#fff" }}>+</button>
              <span className="text-secondary" style={{ fontSize: "0.85rem" }}>
                · كاش: {it.quantity - (couponQty[it.id] || 0)}
              </span>
            </div>
          </div>
        );
      })}

      <div className="card" style={{ background: "var(--bg)", marginTop: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span>إجمالي الكاش المطلوب</span>
          <span className="tabular-num" style={{ fontWeight: 700 }}>{cashTotal.toFixed(2)} JD</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span>كوبونات مستخدمة</span>
          <span className="tabular-num" style={{ fontWeight: 700, color: exceedsBalance ? "var(--urgent)" : "inherit" }}>{totalCouponsSelected}</span>
        </div>
        {exceedsBalance && (
          <p className="text-secondary" style={{ color: "var(--urgent)", marginTop: 6, marginBottom: 0 }}>
            ⚠️ هذا أكتر من رصيد العميل ({stop.coupon_balance} فقط) — خفّض العدد.
          </p>
        )}
      </div>

      <button className="btn-primary icon-row" style={{ justifyContent: "center", marginTop: 14, marginBottom: 10, background: "var(--success)" }} disabled={busy || exceedsBalance} onClick={handleConfirm}>
        <FiCheckCircle /> تأكيد التسليم
      </button>
      <button className="btn-secondary" onClick={onCancel}>إلغاء</button>
    </div>
  );
}

// تحديد كمية طلب تلقائي من شاشة التوصيل مباشرة
function QuickQuantityForm({ stop, onSaved, onCancel }) {
  const [products, setProducts] = useState([]);
  const [quantities, setQuantities] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.getProducts()
      .then((list) => setProducts(list.filter((p) => p.status === "active")))
      .catch((err) => setError(err.message));
  }, []);

  function changeQty(id, delta) {
    setQuantities((prev) => ({ ...prev, [id]: Math.max(0, (prev[id] || 0) + delta) }));
  }

  const hasAny = Object.values(quantities).some((q) => q > 0);

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      const items = Object.entries(quantities)
        .filter(([, q]) => q > 0)
        .map(([product_id, quantity]) => ({ product_id: Number(product_id), quantity }));
      await api.updateOrderItems(stop.order_id, items);
      onSaved();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div className="card" style={{ background: "var(--bg)" }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>كم بده {stop.customer_name}؟</div>
      {error && <div className="error-box">{error}</div>}
      {products.map((p) => (
        <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
          <span style={{ fontWeight: 600 }}>{p.name}</span>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button type="button" onClick={() => changeQty(p.id, -1)} style={{ width: 36, height: 36, borderRadius: 8, border: "1px solid var(--border)", background: "#fff", fontSize: "1.1rem" }}>−</button>
            <span className="tabular-num" style={{ minWidth: 20, textAlign: "center", fontWeight: 700 }}>{quantities[p.id] || 0}</span>
            <button type="button" onClick={() => changeQty(p.id, 1)} style={{ width: 36, height: 36, borderRadius: 8, border: "none", background: "var(--primary)", color: "#fff", fontSize: "1.1rem" }}>+</button>
          </div>
        </div>
      ))}
      <button className="btn-primary" style={{ marginTop: 12, marginBottom: 8 }} disabled={!hasAny || saving} onClick={handleSave}>
        {saving ? "جاري الحفظ..." : "حفظ الكمية"}
      </button>
      <button className="btn-secondary" onClick={onCancel}>إلغاء</button>
    </div>
  );
}

function StopCard({ stop, busy, withBusy, deliverFast }) {
  const [showFailMenu, setShowFailMenu] = useState(false);
  const [showPostponeForm, setShowPostponeForm] = useState(false);
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [postponeTime, setPostponeTime] = useState("");
  const [postponeNote, setPostponeNote] = useState("");

  const mapLink = (stop.latitude && stop.longitude)
    ? `https://www.google.com/maps?q=${stop.latitude},${stop.longitude}`
    : stop.maps_url || null;
  const whatsappLink = `https://wa.me/${stop.phone_normalized}`;

  // لو الزبون ما عنده كوبونات يستخدمها: تسليم بضغطة وحدة.
  // غير هيك بتفتح شاشة الدفع (كاش/كوبون).
  const needsPaymentChoice = stop.coupon_balance > 0 && (stop.items || []).some((it) => it.coupon_eligible);
  const missingQuantity = !stop.items || stop.items.length === 0;
  const [showQuantityForm, setShowQuantityForm] = useState(false);

  function handleDeliverClick() {
    if (needsPaymentChoice) setShowPaymentForm(true);
    else deliverFast(stop, []);
  }

  function handlePostponeSubmit() {
    withBusy(() => api.postponeStop(stop.id, { note: postponeNote, new_time: postponeTime })).then(() => {
      setShowPostponeForm(false);
      setShowFailMenu(false);
      setPostponeTime("");
      setPostponeNote("");
    });
  }

  if (showPaymentForm) {
    return <DeliveryPaymentForm stop={stop} busy={busy} deliverFast={deliverFast} onCancel={() => setShowPaymentForm(false)} />;
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

      <BottleTypeBadge type={stop.bottle_type} large />

      {missingQuantity && !showQuantityForm && (
        <div className="card" style={{ border: "2px solid #E8A020", background: "rgba(232, 160, 32, 0.08)" }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>📅 طلب تلقائي — لسا ما انحدد عدد القوارير</div>
          <button className="btn-primary" onClick={() => setShowQuantityForm(true)}>حدد الكمية</button>
        </div>
      )}
      {missingQuantity && showQuantityForm && (
        <QuickQuantityForm
          stop={stop}
          onCancel={() => setShowQuantityForm(false)}
          onSaved={() => withBusy(async () => { setShowQuantityForm(false); })}
        />
      )}

      {stop.items && stop.items.length > 0 && (
        <div className="card" style={{ background: "var(--bg)" }}>
          <div className="text-secondary" style={{ marginBottom: 4 }}>محتوى الطلب:</div>
          {stop.items.map((it, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between" }}>
              <span>{it.product_name_snapshot}</span>
              <span className="tabular-num" style={{ fontWeight: 700 }}>× {it.quantity}</span>
            </div>
          ))}
        </div>
      )}

      <p className="text-secondary" style={{ lineHeight: 1.8 }}>
        {stop.street && <>الشارع: {stop.street}<br /></>}
        {stop.building_number && <>عمارة: {stop.building_number} {stop.building_name && `(${stop.building_name})`}<br /></>}
        {stop.floor && <>الطابق: {stop.floor}<br /></>}
        {stop.apartment && <>شقة: {stop.apartment}<br /></>}
        {stop.side && <>الجهة: {stop.side}<br /></>}
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
        style={{ justifyContent: "center", marginBottom: 10, background: "var(--success)", opacity: missingQuantity ? 0.5 : 1 }}
        disabled={busy || missingQuantity}
        onClick={handleDeliverClick}
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
      <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
        <span style={{ fontWeight: 700 }}>الكاش المُحصَّل</span>
        <span className="tabular-num" style={{ fontWeight: 700, fontSize: "1.2rem", color: "var(--success)" }}>{summary.total_cash_collected.toFixed(2)} JD</span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", marginBottom: 14 }}>
        <span style={{ fontWeight: 700 }}>كوبونات مُحصَّلة</span>
        <span className="tabular-num" style={{ fontWeight: 700, fontSize: "1.2rem" }}>🎫 {summary.total_coupons_collected}</span>
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
