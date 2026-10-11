import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { FiNavigation, FiPhone, FiCheckCircle, FiAlertTriangle, FiMapPin, FiRefreshCw } from "react-icons/fi";
import { FaWhatsapp } from "react-icons/fa";
import RoutePreviewMap from "../components/RoutePreviewMap.jsx";
import { BottleTypeBadge, NeedsQuantityBadge } from "../components/BottleType.jsx";
import ShopLocationCard from "../components/ShopLocationCard.jsx";
import { LoadInputs, TripLoadCard } from "../components/TripLoad.jsx";
import { usePerms } from "../auth.jsx";

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
  const perms = usePerms();
  // متابعة رحلات الكباتن الثانيين
  const isPrivileged = perms.can("trips");
  if (!isPrivileged && !perms.canEdit("delivery")) {
    return <div className="page"><p className="text-secondary">ما عندك صلاحية لقسم الرحلات.</p></div>;
  }
  return <UnifiedTripView user={user} isPrivileged={isPrivileged} />;
}

function UnifiedTripView({ user, isPrivileged }) {
  const perms = usePerms();
  const canManageTrips = perms.canEdit("trips");
  const canCreate = perms.canEdit("delivery") || canManageTrips;
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
        <OtherTripDetail tripId={selectedOtherId} isSuperAdmin={canManageTrips} onBack={() => { setSelectedOtherId(null); load(); }} />
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
        canCreate ? (
          <CreateTripForm isPrivileged={canManageTrips} onCreated={load} />
        ) : (
          <div className="card text-secondary">ما عندك رحلة شغّالة. تحت بتلاقي رحلات الكباتن.</div>
        )
      ) : (
        <ActiveTripView
          trip={myTrip}
          isSuperAdmin={false}
          isManagerViewOnly={false}
          canOperate={myTrip.can_operate}
          onChanged={load}
          onCompleted={(s) => setSummary(s)}
        />
      )}

      {isPrivileged && otherTrips.length > 0 && (
        <div className="card">
          <h2 className="title-md">رحلات الكباتن</h2>
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

function CreateTripForm({ isPrivileged, onCreated }) {
  const perms = usePerms();
  const [orders, setOrders] = useState([]);
  const [selected, setSelected] = useState({});
  const [routeMode, setRouteMode] = useState("nearest");
  const [useLocation, setUseLocation] = useState(true);
  const [drivers, setDrivers] = useState([]);
  const [assignTo, setAssignTo] = useState("self");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [products, setProducts] = useState([]);
  const [loadValues, setLoadValues] = useState({});
  const [showLoad, setShowLoad] = useState(false);

  async function loadOrders() {
    setFetching(true);
    setError("");
    try {
      const list = await api.getOrders({ status: "NEW", limit: 200, with_items: "true" });
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
    api.getProducts().then((list) => setProducts(list.filter((p) => p.status === "active"))).catch(() => {});
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
        load: Object.entries(loadValues)
          .filter(([, q]) => q > 0)
          .map(([product_id, quantity]) => ({ product_id: Number(product_id), quantity })),
      });
      onCreated();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // الحمولة المقترحة = مجموع كميات الطلبات المختارة لكل منتج
  const loadSuggestions = {};
  for (const o of orders) {
    if (!selected[o.id]) continue;
    for (const it of o.items || []) {
      loadSuggestions[it.product_id] = (loadSuggestions[it.product_id] || 0) + Number(it.quantity);
    }
  }

  if (fetching) {
    return <p className="text-secondary">جاري تحميل الطلبات الجديدة...</p>;
  }

  if (orders.length === 0) {
    return (
      <div>
        {perms.can("settings") ? <ShopLocationCard /> : null}
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

      {perms.can("settings") ? <ShopLocationCard /> : null}

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

      <div className="card" style={{ background: "var(--surface-2)", border: "none", marginBottom: 14 }}>
        <button
          type="button"
          onClick={() => setShowLoad(!showLoad)}
          aria-expanded={showLoad}
          style={{ all: "unset", display: "flex", justifyContent: "space-between", width: "100%", cursor: "pointer", fontWeight: 700 }}
        >
          <span>🚚 حمولة السيارة {Object.values(loadValues).some((v) => v > 0) ? `(${Object.values(loadValues).reduce((a, b) => a + b, 0)})` : "(اختياري)"}</span>
          <span className="text-secondary">{showLoad ? "إخفاء" : "تعبئة"}</span>
        </button>
        {showLoad && (
          <div style={{ marginTop: 8 }}>
            <LoadInputs products={products} values={loadValues} onChange={setLoadValues} suggestions={loadSuggestions} />
          </div>
        )}
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

  function deliverFast(stop, itemPayments, extra = {}) {
    setError("");
    setOptimistic((prev) => ({ ...prev, [stop.id]: true }));
    api.deliverStop(stop.id, itemPayments, extra)
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

      <TripLoadCard trip={trip} canOperate={canOperate} onChanged={onChanged} />

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
              <a
                href={`https://www.google.com/maps/dir/?api=1&destination=${trip.shop_location.lat},${trip.shop_location.lon}&travelmode=driving`}
                target="_blank"
                rel="noreferrer"
                style={{ fontWeight: 600, color: "inherit" }}
              >
                الرجوع للمحل
              </a>
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
        <div className="card back-to-shop">
          <div style={{ fontWeight: 800, fontSize: "1.05rem" }}>✅ خلّصت كل الطلبات</div>
          <p className="text-secondary" style={{ margin: "4px 0 12px" }}>
            {trip.shop_location ? "آخر محطة: الرجوع للمحل." : "حدد موقع المحل من الإعدادات عشان يطلعلك زر الرجوع."}
          </p>
          {trip.shop_location && (
            <a
              className="btn-primary icon-row"
              style={{ justifyContent: "center", textDecoration: "none", marginBottom: 8 }}
              href={`https://www.google.com/maps/dir/?api=1&destination=${trip.shop_location.lat},${trip.shop_location.lon}&travelmode=driving`}
              target="_blank"
              rel="noreferrer"
            >
              <FiNavigation aria-hidden="true" /> ارجع للمحل
            </a>
          )}
          <button className="btn-secondary" disabled={busy} onClick={handleComplete}>
            وصلت المحل — إنهاء الرحلة
          </button>
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

// المبلغ المطلوب كاش بعد الكوبونات والخصم (نفس حساب السيرفر)
function computeAmountDue(stop, couponQty = {}) {
  const cashPart = (stop.items || []).reduce((sum, it) => {
    const used = it.coupon_eligible ? Math.min(couponQty[it.id] || 0, it.quantity) : 0;
    return sum + (it.quantity - used) * Number(it.unit_price_snapshot);
  }, 0);
  const subtotal = Number(stop.subtotal) || 0;
  const finalTotal = Number(stop.final_total) || 0;
  const ratio = subtotal > 0 ? Math.min(1, finalTotal / subtotal) : 1;
  return Math.round(cashPart * ratio * 100) / 100;
}

function DeliveryPaymentForm({ stop, deliverFast, onCancel }) {
  const { canAction } = usePerms();
  const eligibleItems = stop.items.filter((it) => it.coupon_eligible);
  const returnableQty = stop.items.filter((it) => it.is_returnable).reduce((s, it) => s + it.quantity, 0);
  const oldDebt = Number(stop.debt_balance || 0);

  // افتراضيًا: لو معه كوبونات بنستخدمها على القوارير المؤهلة
  const [couponQty, setCouponQty] = useState(() => {
    const initial = {};
    let left = stop.coupon_balance || 0;
    eligibleItems.forEach((it) => {
      const use = Math.min(it.quantity, left);
      initial[it.id] = use;
      left -= use;
    });
    return initial;
  });
  const totalCoupons = Object.values(couponQty).reduce((sum, v) => sum + v, 0);
  const exceedsBalance = totalCoupons > (stop.coupon_balance || 0);
  const amountDue = computeAmountDue(stop, couponQty);

  const [received, setReceived] = useState(String(amountDue));
  const [touchedReceived, setTouchedReceived] = useState(false);
  const [empties, setEmpties] = useState(returnableQty);

  // لما تتغير الكوبونات، المبلغ المستلم بيتبعها (إلا إذا السائق غيّره بإيده)
  useEffect(() => {
    if (!touchedReceived) setReceived(String(amountDue));
  }, [amountDue]);

  const receivedNum = received === "" ? 0 : Number(received);
  const diff = Math.round((receivedNum - amountDue) * 100) / 100;
  const willAddDebt = diff < 0 ? -diff : 0;
  const willPayDebt = diff > 0 ? diff : 0;
  const tooMuch = willPayDebt > oldDebt + 0.001;
  const creditBlocked = willAddDebt > 0 && !canAction("give_credit");

  function setQty(itemId, value, max) {
    setCouponQty((prev) => ({ ...prev, [itemId]: Math.max(0, Math.min(max, value)) }));
  }

  function confirm() {
    const item_payments = eligibleItems.map((it) => ({ item_id: it.id, coupon_qty: couponQty[it.id] || 0 }));
    deliverFast(stop, item_payments, { cash_received: receivedNum, empties: returnableQty > 0 ? empties : undefined });
    onCancel();
  }

  return (
    <div className="card">
      <h2 className="title-md">تسليم {stop.customer_name}</h2>

      {eligibleItems.length > 0 && (stop.coupon_balance || 0) > 0 && (
        <div className="pay-section">
          <div className="pay-section-title">
            🎫 كوبونات <span className="text-secondary" style={{ fontWeight: 400 }}>(معه {stop.coupon_balance})</span>
          </div>
          {eligibleItems.map((it) => (
            <div key={it.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0" }}>
              <span style={{ fontSize: "0.9rem" }}>{it.product_name_snapshot} × {it.quantity}</span>
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button type="button" className="step-btn" onClick={() => setQty(it.id, (couponQty[it.id] || 0) - 1, it.quantity)} aria-label="كوبون أقل">−</button>
                <strong className="tabular-num" style={{ minWidth: 18, textAlign: "center" }}>{couponQty[it.id] || 0}</strong>
                <button type="button" className="step-btn plus" onClick={() => setQty(it.id, (couponQty[it.id] || 0) + 1, it.quantity)} aria-label="كوبون أكثر">+</button>
              </span>
            </div>
          ))}
          {exceedsBalance && <div style={{ color: "var(--urgent)", fontSize: "0.85rem" }}>معه {stop.coupon_balance} كوبون بس.</div>}
        </div>
      )}

      <div className="pay-section">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span className="pay-section-title" style={{ margin: 0 }}>💵 المطلوب كاش</span>
          <strong className="tabular-num" style={{ fontSize: "1.4rem" }}>{amountDue.toFixed(2)} JD</strong>
        </div>
        <div className="field" style={{ margin: "10px 0 6px" }}>
          <label htmlFor="pay-received">المبلغ اللي استلمته</label>
          <input
            id="pay-received"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            value={received}
            onChange={(e) => { setReceived(e.target.value); setTouchedReceived(true); }}
          />
        </div>
        <div className="chips" style={{ marginBottom: 4 }}>
          <button type="button" className={`chip${diff === 0 ? " on" : ""}`} onClick={() => { setReceived(String(amountDue)); setTouchedReceived(true); }}>كامل</button>
          {canAction("give_credit") && amountDue > 0 && (
            <button type="button" className={`chip${receivedNum === 0 && amountDue > 0 ? " on" : ""}`} onClick={() => { setReceived("0"); setTouchedReceived(true); }}>آجل (دين)</button>
          )}
          {oldDebt > 0 && (
            <button type="button" className={`chip${Math.abs(diff - oldDebt) < 0.005 ? " on" : ""}`} onClick={() => { setReceived(String(Math.round((amountDue + oldDebt) * 100) / 100)); setTouchedReceived(true); }}>
              + سدّد دينه ({oldDebt.toFixed(2)})
            </button>
          )}
        </div>
        {willAddDebt > 0 && !creditBlocked && (
          <div className="pay-note warn">رح ينضاف {willAddDebt.toFixed(2)} JD دين عليه{oldDebt > 0 ? ` (صار ${(oldDebt + willAddDebt).toFixed(2)})` : ""}</div>
        )}
        {creditBlocked && <div className="pay-note bad">ما عندك صلاحية البيع بالدين — لازم يدفع المبلغ كامل.</div>}
        {willPayDebt > 0 && !tooMuch && (
          <div className="pay-note ok">{willPayDebt.toFixed(2)} JD بتسدّد من دينه — بيضل عليه {(oldDebt - willPayDebt).toFixed(2)}</div>
        )}
        {tooMuch && <div className="pay-note bad">المبلغ أكثر من المطلوب{oldDebt > 0 ? ` ودينه (${oldDebt.toFixed(2)})` : ""}.</div>}
      </div>

      {returnableQty > 0 && (
        <div className="pay-section" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div className="pay-section-title" style={{ margin: 0 }}>♻️ فوارغ استلمتها</div>
            <div className="text-secondary" style={{ fontSize: "0.78rem" }}>نزّلت {returnableQty} قارورة</div>
          </div>
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button type="button" className="step-btn" onClick={() => setEmpties(Math.max(0, empties - 1))} aria-label="فوارغ أقل">−</button>
            <strong className="tabular-num" style={{ minWidth: 22, textAlign: "center" }}>{empties}</strong>
            <button type="button" className="step-btn plus" onClick={() => setEmpties(empties + 1)} aria-label="فوارغ أكثر">+</button>
          </span>
        </div>
      )}

      <button
        className="btn-primary icon-row"
        style={{ justifyContent: "center", marginTop: 6, marginBottom: 8, background: "var(--success)" }}
        disabled={exceedsBalance || tooMuch || creditBlocked || receivedNum < 0}
        onClick={confirm}
      >
        <FiCheckCircle /> تأكيد التسليم
      </button>
      <button className="btn-secondary" onClick={onCancel}>رجوع</button>
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

  // لو الزبون معه كوبونات بيستخدمها: بتفتح شاشة الدفع.
  // غير هيك: تسليم بضغطة وحدة وقبض المبلغ كامل كاش.
  const needsPaymentChoice = stop.coupon_balance > 0 && (stop.items || []).some((it) => it.coupon_eligible);
  const missingQuantity = !stop.items || stop.items.length === 0;
  const [showQuantityForm, setShowQuantityForm] = useState(false);
  const amountDue = missingQuantity ? 0 : computeAmountDue(stop);
  const debt = Number(stop.debt_balance || 0);

  function handleDeliverClick() {
    if (needsPaymentChoice) setShowPaymentForm(true);
    else deliverFast(stop, [], { cash_received: amountDue });
  }

  const etaText = stop.estimated_eta_minutes != null && stop.estimated_eta_minutes > 0
    ? `خلال حوالي ${Math.max(5, Math.round(stop.estimated_eta_minutes / 5) * 5)} دقيقة`
    : "خلال دقائق";
  const onMyWayLink = `https://wa.me/${stop.phone_normalized}?text=${encodeURIComponent(
    `مرحبا ${stop.customer_name} 🌊\nمعك مياه جوهرة الرابية — طلبك بالطريق وبيوصلك ${etaText} 💧`
  )}`;

  function handlePostponeSubmit() {
    withBusy(() => api.postponeStop(stop.id, { note: postponeNote, new_time: postponeTime })).then(() => {
      setShowPostponeForm(false);
      setShowFailMenu(false);
      setPostponeTime("");
      setPostponeNote("");
    });
  }

  if (showPaymentForm) {
    return <DeliveryPaymentForm stop={stop} deliverFast={deliverFast} onCancel={() => setShowPaymentForm(false)} />;
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
      <p className="tabular-num text-secondary" style={{ marginTop: 0 }}>#{stop.order_number} · {Number(stop.final_total).toFixed(2)} JD</p>

      {(debt > 0 || (stop.coupon_balance || 0) > 0) && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
          {debt > 0 && <span className="badge" style={{ background: "var(--urgent-soft)", color: "var(--urgent)" }}>عليه دين {debt.toFixed(2)} JD</span>}
          {(stop.coupon_balance || 0) > 0 && <span className="badge" style={{ background: "var(--primary-soft)", color: "var(--navy)" }}>🎫 معه {stop.coupon_balance} كوبون</span>}
        </div>
      )}

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

      <div className="quick-actions" style={{ marginTop: 0, marginBottom: 14 }}>
        {mapLink ? (
          <a className="quick-action primary" href={mapLink} target="_blank" rel="noreferrer">
            <FiNavigation aria-hidden="true" /><span>الملاحة</span>
          </a>
        ) : (
          <span className="quick-action disabled"><FiNavigation aria-hidden="true" /><span>بدون موقع</span></span>
        )}
        <a className="quick-action" href={`tel:${stop.phone_display}`}>
          <FiPhone aria-hidden="true" /><span>اتصال</span>
        </a>
        <a className="quick-action whatsapp" href={whatsappLink} target="_blank" rel="noreferrer">
          <FaWhatsapp aria-hidden="true" /><span>واتساب</span>
        </a>
        <a className="quick-action whatsapp" href={onMyWayLink} target="_blank" rel="noreferrer">
          <FaWhatsapp aria-hidden="true" /><span>أنا جاي</span>
        </a>
      </div>

      <button
        className="btn-primary icon-row"
        style={{ justifyContent: "center", marginBottom: 6, background: "var(--success)", opacity: missingQuantity ? 0.5 : 1 }}
        disabled={busy || missingQuantity}
        onClick={handleDeliverClick}
      >
        <FiCheckCircle />
        {needsPaymentChoice ? "تم التسليم" : amountDue > 0 ? `تم التسليم · قبضت ${amountDue.toFixed(2)} JD` : "تم التسليم"}
      </button>
      {!missingQuantity && !needsPaymentChoice && (
        <button
          className="btn-danger-text"
          style={{ width: "100%", color: "var(--primary)", marginBottom: 6, fontSize: "0.88rem" }}
          disabled={busy}
          onClick={() => setShowPaymentForm(true)}
        >
          دين، دفع جزئي، أو فوارغ
        </button>
      )}

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

      {(summary.total_debt_added > 0 || summary.total_debt_paid > 0 || summary.total_empties > 0) && (
        <div className="card" style={{ background: "var(--bg)" }}>
          {summary.total_debt_added > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>انباع بالدين</span>
              <span className="tabular-num" style={{ fontWeight: 700, color: "var(--urgent)" }}>{Number(summary.total_debt_added).toFixed(2)} JD</span>
            </div>
          )}
          {summary.total_debt_paid > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>تحصيل ديون قديمة</span>
              <span className="tabular-num" style={{ fontWeight: 700, color: "var(--success)" }}>{Number(summary.total_debt_paid).toFixed(2)} JD</span>
            </div>
          )}
          {summary.total_empties > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>فوارغ رجعت</span>
              <span className="tabular-num" style={{ fontWeight: 700 }}>{summary.total_empties}</span>
            </div>
          )}
        </div>
      )}

      {summary.load_summary?.length > 0 && (
        <div className="card" style={{ background: "var(--bg)" }}>
          <div className="text-secondary" style={{ marginBottom: 6 }}>حمولة السيارة</div>
          {summary.load_summary.map((l, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.9rem" }}>
              <span>{l.name}</span>
              <span className="tabular-num">حمّلت {l.loaded} · نزل {l.delivered} · <strong>رجع {l.returned}</strong></span>
            </div>
          ))}
        </div>
      )}

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
