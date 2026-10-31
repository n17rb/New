import { useEffect, useRef, useState } from "react";
import { renderMessage } from "../messages.js";
import { ReceiptBanner, receiptLink, receiptFromStop } from "../components/Receipt.jsx";
import { api } from "../api.js";
import { FiNavigation, FiPhone, FiCheckCircle, FiAlertTriangle, FiMapPin, FiRefreshCw, FiClock, FiXCircle, FiHome, FiCamera, FiEdit2, FiTruck, FiPhoneOff, FiRotateCw, FiCalendar, FiGrid, FiChevronLeft, FiPlus } from "react-icons/fi";
import Sheet, { ConfirmSheet } from "../components/Sheet.jsx";
import CustomerEditSheet from "../components/CustomerEditSheet.jsx";
import { EditItemsSheet, SellPackageSheet, NewOrderSheet } from "../components/TripStopSheets.jsx";
import SchedulePicker from "../components/SchedulePicker.jsx";
import { FaWhatsapp } from "react-icons/fa";
import RoutePreviewMap from "../components/RoutePreviewMap.jsx";
import { BottleTypeBadge, NeedsQuantityBadge } from "../components/BottleType.jsx";
import ShopLocationCard from "../components/ShopLocationCard.jsx";
import { LoadInputs, TripLoadCard } from "../components/TripLoad.jsx";
import { usePerms } from "../auth.jsx";
import { scheduleLabel } from "../schedule.js";
import CouponChip from "../components/CouponChip.jsx";

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
  // الترتيب دايمًا من الأقرب للأبعد (أقصر طريق)
  const routeMode = "nearest";
  const [useLocation, setUseLocation] = useState(true);
  const [drivers, setDrivers] = useState([]);
  const [assignTo, setAssignTo] = useState("self");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [products, setProducts] = useState([]);
  const [loadValues, setLoadValues] = useState({});
  const [showLoad, setShowLoad] = useState(false);
  const [futureCount, setFutureCount] = useState(0);

  async function loadOrders() {
    setFetching(true);
    setError("");
    try {
      // طلبات اليوم بس — المجدولة لأيام جاية بتستنى يومها
      const list = await api.getOrders({ status: "NEW", limit: 300, with_items: "true", scheduled: "now" });
      api.getOrders({ status: "NEW", limit: 300, scheduled: "future" }).then((f) => setFutureCount(f.length)).catch(() => {});
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

  const selectedCount = Object.values(selected).filter(Boolean).length;
  const allOn = selectedCount === orders.length;
  const loadTotal = Object.values(loadValues).reduce((a, b) => a + (b || 0), 0);

  return (
    <div className="ct">
      {error && <div className="error-box">{error}</div>}

      <div className="ct-head">
        <div>
          <h2 className="ct-title">رحلة جديدة</h2>
          <div className="ct-sub">{orders.length} طلب جاهز للتوزيع</div>
        </div>
        <button type="button" className="ct-refresh" onClick={loadOrders} aria-label="تحديث الطلبات"><FiRefreshCw aria-hidden="true" /></button>
      </div>

      {futureCount > 0 && <div className="ct-note">📅 في {futureCount} طلب بموعد لأيام جاية — بيطلعوا هون بيومهم.</div>}

      {isPrivileged && drivers.length > 0 && (
        <div className="ct-sec">
          <div className="ct-label">مين بيوصّل؟</div>
          <div className="ct-drivers">
            <button type="button" className={`ct-driver${assignTo === "self" ? " on" : ""}`} onClick={() => setAssignTo("self")}>أنا</button>
            {drivers.map((d) => (
              <button key={d.id} type="button" className={`ct-driver${String(assignTo) === String(d.id) ? " on" : ""}`} onClick={() => setAssignTo(String(d.id))}>
                {d.full_name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="ct-sec">
        <div className="ct-label-row">
          <span className="ct-label" style={{ margin: 0 }}>الطلبات <span className="ct-count">{selectedCount} من {orders.length}</span></span>
          {orders.length > 1 && (
            <button type="button" className="link-btn" onClick={() => {
              const next = {};
              orders.forEach((o) => { next[o.id] = !allOn; });
              setSelected(next);
            }}>{allOn ? "شيل الكل" : "اختار الكل"}</button>
          )}
        </div>
        <div className="ct-orders">
          {orders.map((o) => {
            const on = !!selected[o.id];
            const qty = (o.items || []).reduce((a, it) => a + Number(it.quantity || 0), 0);
            return (
              <button key={o.id} type="button" className={`ct-order${on ? " on" : ""}`} onClick={() => toggle(o.id)} aria-pressed={on}>
                <span className="ct-check" aria-hidden="true">{on ? <FiCheckCircle /> : null}</span>
                <span className="ct-o-main">
                  <span className="ct-o-name">
                    {o.customer_name}
                    {o.priority === "urgent" && <span className="ct-flag">🚨</span>}
                  </span>
                  <span className="ct-o-meta tabular-num">
                    #{o.order_number}{qty > 0 ? ` · ${qty} قارورة` : ""}
                    {" "}<BottleTypeBadge type={o.bottle_type} />
                    {" "}<NeedsQuantityBadge order={o} />
                  </span>
                  {scheduleLabel(o) && <span className="sched-badge" style={{ marginTop: 4, alignSelf: "flex-start" }}>📅 {scheduleLabel(o)}</span>}
                </span>
                <span className="ct-o-total tabular-num">{Number(o.final_total).toFixed(2)}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="ct-sec ct-load">
        <button type="button" className="ct-load-head" onClick={() => setShowLoad(!showLoad)} aria-expanded={showLoad}>
          <FiTruck aria-hidden="true" />
          <span style={{ flex: 1 }}>حمولة السيارة {loadTotal > 0 ? <b className="tabular-num">({loadTotal})</b> : <span className="text-secondary">(اختياري)</span>}</span>
          <span className="link-btn">{showLoad ? "إخفاء" : "تعبئة"}</span>
        </button>
        {showLoad && (
          <div style={{ marginTop: 8 }}>
            <LoadInputs products={products} values={loadValues} onChange={setLoadValues} suggestions={loadSuggestions} />
          </div>
        )}
      </div>

      <label className="ct-switch">
        <span>
          <b>ابدأ من موقعي الحالي</b>
          <small>لو طفيتها، الترتيب بيبدأ من المحل</small>
        </span>
        <input type="checkbox" checked={useLocation} onChange={(e) => setUseLocation(e.target.checked)} />
        <i aria-hidden="true" />
      </label>

      {perms.can("settings") ? <div className="ct-shop"><ShopLocationCard compact /></div> : null}

      <button className="btn-primary ct-start" disabled={loading || selectedCount === 0} onClick={handleCreate}>
        {loading ? "جاري البدء..." : `ابدأ الرحلة · ${selectedCount} ${selectedCount === 1 ? "طلب" : "طلبات"}`}
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
  // آخر تسليم: بيطلع زر «ابعتله إيصال على واتساب»
  const [receipt, setReceipt] = useState(null);
  // الزبون اللي اختاره الكابتن من القائمة (بدل التالي بالترتيب)
  const [selectedStopId, setSelectedStopId] = useState(null);
  const cardRef = useRef(null);

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
    setReceipt(null);
    setSelectedStopId(null);
    api.deliverStop(stop.id, itemPayments, extra)
      .then((result) => {
        if (result && !result.already_delivered) setReceipt({ stop, result });
        onChanged();
      })
      .catch((err) => {
        setOptimistic((prev) => {
          const next = { ...prev };
          delete next[stop.id];
          return next;
        });
        setError(`ما تسجّل تسليم ${stop.customer_name}: ${err.message}`);
      });
  }

  const [reorderSheet, setReorderSheet] = useState(false);
  const [newOrderOpen, setNewOrderOpen] = useState(false);
  const routeStyle = trip.route_style === "loop" ? "loop" : "area";

  async function handleReorder(style) {
    setReorderSheet(false);
    setReordering(true);
    setReorderMessage("");
    setError("");
    try {
      const r = await api.reoptimizeTrip(trip.id, style);
      setReorderMessage(r.message);
      setTimeout(() => setReorderMessage(""), 5000);
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setReordering(false);
    }
  }

  const isOpenStop = (s) => !s.delivered_at && s.order_status !== "FAILED" && s.order_status !== "CANCELLED";
  const nextStop = stops.find((s) => isOpenStop(s) && !s.is_time_locked);
  const pickedStop = stops.find((s) => s.id === selectedStopId && isOpenStop(s));
  // زبون خلص (تسلّم/تعذّر/انلغى) واخترته من القائمة: بنعرض تفاصيله
  const closedStop = stops.find((s) => s.id === selectedStopId && !isOpenStop(s)) || null;
  const currentStop = closedStop ? null : pickedStop || nextStop;

  function pickStop(s) {
    setSelectedStopId(isOpenStop(s) && s.id === nextStop?.id ? null : s.id);
    setTimeout(() => cardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 30);
  }
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
      setSelectedStopId(null);
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

      {/* ملخص الرحلة */}
      <div className="trip-sum">
        <div className="trip-sum-top">
          <span className="trip-sum-live"><i aria-hidden="true" /> رحلة جارية</span>
          {trip.driver_name && <span className="trip-sum-driver">{trip.driver_name}</span>}
        </div>
        <div className="trip-sum-count tabular-num">
          <b>{deliveredCount}</b> <span>من {totalCount} تم التسليم</span>
        </div>
        <div className="trip-sum-bar" aria-hidden="true"><span style={{ width: `${totalCount ? Math.round((deliveredCount / totalCount) * 100) : 0}%` }} /></div>
        <div className="trip-sum-grid">
          <div className="tsg cash">
            <span>كاش معك</span>
            <b className="tabular-num">{(stops.reduce((a, x) => a + (x.order_status === "DELIVERED" ? Number(x.cash_collected || 0) : 0), 0) + Number(trip.package_cash || 0)).toFixed(2)} <small>JD</small></b>
            {Number(trip.package_cash || 0) > 0 && <small className="tsg-sub">منها {Number(trip.package_cash).toFixed(2)} باقات</small>}
          </div>
          <div className="tsg coupon">
            <span>كوبونات</span>
            <b className="tabular-num">{stops.reduce((a, x) => a + (x.order_status === "DELIVERED" ? Number(x.coupons_collected || 0) : 0), 0)}</b>
          </div>
          {remainingKm && (
            <div className="tsg">
              <span>المسافة الباقية</span>
              <b className="tabular-num">{remainingKm} <small>كم</small></b>
            </div>
          )}
          {trip.status === "STARTED" && trip.estimated_minutes_remaining != null && (
            <div className="tsg">
              <span>بتخلص حوالي</span>
              <b className="tabular-num">{formatClockTime(trip.estimated_minutes_remaining)}</b>
            </div>
          )}
        </div>
        <div className="trip-sum-foot tabular-num">
          {trip.started_at && <span>بدأت {formatClockTime(trip.started_at)}</span>}
          {trip.total_distance_km > 0 && <span>المسافة الكلية {Number(trip.total_distance_km).toFixed(1)} كم</span>}
          {trip.distance_before_km > trip.total_distance_km && (
            <span className="ok">وفّرنا {(Number(trip.distance_before_km) - Number(trip.total_distance_km)).toFixed(1)} كم</span>
          )}
        </div>
        {isManagerViewOnly && <div className="trip-sum-foot">وضع العرض فقط — التحكم بالرحلة للسائق</div>}
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
            <div className="trip-head-btns">
              {(canOperate || isSuperAdmin) && (
                <button type="button" className="trip-add-btn" onClick={() => setNewOrderOpen(true)}>
                  <FiPlus aria-hidden="true" /> طلب جديد
                </button>
              )}
              <button
                className="btn-secondary"
                style={{ width: "auto", padding: "6px 10px", fontSize: "0.8rem", display: "flex", alignItems: "center", gap: 4 }}
                disabled={reordering}
                onClick={() => setReorderSheet(true)}
              >
                <FiRefreshCw /> {reordering ? "جاري الترتيب..." : "رتّب"}
              </button>
            </div>
          )}
        </div>
        <NewOrderSheet
          open={newOrderOpen}
          tripId={trip.id}
          onClose={() => setNewOrderOpen(false)}
          onSaved={(msg) => {
            setReorderMessage(msg);
            setTimeout(() => setReorderMessage(""), 6000);
            onChanged();
          }}
        />
        <Sheet open={reorderSheet} title="كيف بدك ترتّب الرحلة؟" onClose={() => setReorderSheet(false)}>
          <div className="ro-opts">
            <button type="button" className={`ro-opt${routeStyle === "area" ? " on" : ""}`} onClick={() => handleReorder("area")}>
              <span className="ro-ic"><FiGrid aria-hidden="true" /></span>
              <span className="ro-t">
                <b>منطقة منطقة {routeStyle === "area" && <em>المستعمل هلّق</em>}</b>
                <small>بتخلّص كل طلبات المنطقة اللي أنت فيها (مثلًا الرابية كلها) وبعدين بتطلع للي بعدها</small>
              </span>
            </button>
            <button type="button" className={`ro-opt${routeStyle === "loop" ? " on" : ""}`} onClick={() => handleReorder("loop")}>
              <span className="ro-ic"><FiRotateCw aria-hidden="true" /></span>
              <span className="ro-t">
                <b>دائرة بأقصر طريق {routeStyle === "loop" && <em>المستعمل هلّق</em>}</b>
                <small>بتاخذ الأقرب فالأقرب وأنت طالع، والباقي بتمر عليهم وأنت راجع للمحل</small>
              </span>
            </button>
          </div>
          <button className="btn-secondary" style={{ marginTop: 12 }} onClick={() => setReorderSheet(false)}>رجوع</button>
        </Sheet>
        {reorderMessage && <div className="success-box" style={{ marginBottom: 8 }}>{reorderMessage}</div>}
        {stops.length > 1 && trip.status === "STARTED" && (
          <div className="text-secondary" style={{ fontSize: "0.75rem", marginBottom: 4 }}>اكبس على أي زبون (حتى اللي تسلّم) بيفتحلك تفاصيله</div>
        )}
        {stops.map((s, i) => (
          <div
            key={s.id}
            onClick={() => pickStop(s)}
            style={{
              display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 4px", borderBottom: "1px solid var(--border)",
              cursor: "pointer",
              background: ((currentStop && s.id === currentStop.id) || (closedStop && s.id === closedStop.id)) && trip.status === "STARTED" ? "var(--primary-soft)" : undefined,
              borderRadius: (currentStop && s.id === currentStop.id) || (closedStop && s.id === closedStop.id) ? 8 : 0,
            }}
          >
            <div className="icon-row">
              <span style={{
                width: 24, height: 24, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "0.75rem", fontWeight: 700, color: "#fff",
                background: s.order_status === "DELIVERED" ? "var(--success)" : s.order_status === "FAILED" ? "var(--urgent)" : s.order_status === "CANCELLED" ? "var(--text-secondary)" : "var(--primary)",
              }}>
                {i + 1}
              </span>
              <span>{s.customer_name}</span>
              <CouponChip balance={s.coupon_balance} />
              {s.wants_coupons && !s.package_sold && !s.delivered_at && <span className="want-tag">🎫 بدو باقة</span>}
              <BottleTypeBadge type={s.bottle_type} />
              {!s.latitude && <span className="text-secondary" style={{ fontSize: "0.75rem" }}> (بدون موقع محفوظ)</span>}
              {s.is_time_locked && <span style={{ color: "var(--warning)", fontSize: "0.75rem" }}> ⏰ لموعد {formatClockTime(s.requested_time)}</span>}
            </div>
            <div style={{ textAlign: "left" }}>
              {s.order_status === "DELIVERED" && s.cash_collected != null && s.phone_normalized && (
                <a
                  href={receiptLink(s.phone_normalized, receiptFromStop(s))}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`إيصال ${s.customer_name} على واتساب`}
                  title="ابعت الإيصال على واتساب"
                  style={{ color: "var(--whatsapp)", marginLeft: 6, verticalAlign: "middle" }}
                >
                  <FaWhatsapp size={16} />
                </a>
              )}
              <span className="badge">{s.order_status === "DELIVERED" ? "تم" : s.order_status === "FAILED" ? "تعذر" : s.order_status === "CANCELLED" ? "ملغي" : "قيد الانتظار"}</span>
              {s.order_status === "DELIVERED" && (Number(s.cash_collected || 0) > 0 || Number(s.coupons_collected || 0) > 0) && (
                <div className="tabular-num" style={{ fontSize: "0.7rem", marginTop: 2, fontWeight: 700 }}>
                  {Number(s.coupons_collected || 0) > 0 && <span style={{ color: "var(--navy)" }}>🎫 {s.coupons_collected} </span>}
                  {Number(s.cash_collected || 0) > 0 && <span style={{ color: "var(--success)" }}>💵 {Number(s.cash_collected).toFixed(2)}</span>}
                </div>
              )}
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
                background: "var(--navy)", color: "#fff",
              }}><FiHome size={13} aria-hidden="true" /></span>
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

      {canOperate && receipt && <ReceiptBanner receipt={receipt} onClose={() => setReceipt(null)} />}

      <div ref={cardRef} style={{ scrollMarginTop: 90 }}>
        {closedStop && (
          <ClosedStopCard
            key={`c${closedStop.id}`}
            stop={closedStop}
            index={stops.findIndex((s) => s.id === closedStop.id) + 1}
            canOperate={canOperate}
            busy={busy}
            onUndo={() => withBusy(() => api.undoDeliver(closedStop.id))}
            onBack={() => setSelectedStopId(null)}
            onRefresh={onChanged}
          />
        )}
        {trip.status === "STARTED" && currentStop && (canOperate || isSuperAdmin) && (
          <StopCard
            key={currentStop.id}
            stop={currentStop}
            index={stops.findIndex((s) => s.id === currentStop.id) + 1}
            picked={!!pickedStop && pickedStop.id !== nextStop?.id}
            onBackToNext={() => setSelectedStopId(null)}
            readOnly={!canOperate}
            busy={busy}
            withBusy={withBusy}
            deliverFast={deliverFast}
            onRefresh={onChanged}
          />
        )}
      </div>

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
// الكوبون بينقبل بس على المنتج المعلّم «يقبل كوبون» (الشرنكات والكراتين وغيرها كاش)
const couponable = (it) => !!it.coupon_eligible;

function computeAmountDue(stop, couponQty = {}) {
  const cashPart = (stop.items || []).reduce((sum, it) => {
    const used = couponable(it) ? Math.min(couponQty[it.id] || 0, it.quantity) : 0;
    return sum + (it.quantity - used) * Number(it.unit_price_snapshot);
  }, 0);
  const subtotal = Number(stop.subtotal) || 0;
  const finalTotal = Number(stop.final_total) || 0;
  const ratio = subtotal > 0 ? Math.min(1, finalTotal / subtotal) : 1;
  return Math.round(cashPart * ratio * 100) / 100;
}

// بعد «تم التسليم»: خيارين كبار — كاش أو كوبون (والتفاصيل للحالات الخاصة)
function PayChoice({ stop, busy, deliverFast, onDetails, onCancel }) {
  const items = stop.items || [];
  const eligible = items.filter(couponable);
  const eligibleQty = eligible.reduce((s, it) => s + it.quantity, 0);
  const balance = Math.max(0, Number(stop.coupon_balance || 0));
  const cashAll = computeAmountDue(stop);
  const allCoupons = Object.fromEntries(eligible.map((it) => [it.id, it.quantity]));
  const cashWithCoupons = computeAmountDue(stop, allCoupons);
  const canCoupon = eligibleQty > 0;
  const enoughCoupons = balance >= eligibleQty;
  const paper = Math.max(0, eligibleQty - balance);

  function payCash() {
    deliverFast(stop, eligible.map((it) => ({ item_id: it.id, coupon_qty: 0 })), { cash_received: cashAll });
    onCancel();
  }
  function payCoupons() {
    // زبون ما إله رصيد بالنظام = كوبون ورقي مباشرة بدون سؤال.
    // السؤال بيطلع بس لما يكون إله رصيد ناقص (عشان تعرف إنه رح ينخصم من رصيده)
    if (!enoughCoupons && balance > 0) {
      const ok = window.confirm(
        `رصيده بالنظام ${balance} كوبون بس.\nإذا استلمت منه ${eligibleQty} كوبون: بنخصم ${balance} من رصيده، و${paper} بتنحسب كوبونات ورقية.\n\nتأكيد؟`
      );
      if (!ok) return;
    }
    deliverFast(stop, eligible.map((it) => ({ item_id: it.id, coupon_qty: it.quantity })), { cash_received: cashWithCoupons, allow_paper_coupons: !enoughCoupons });
    onCancel();
  }

  return (
    <div className="card pay-choice">
      <h2 className="title-md" style={{ marginBottom: 4 }}>كيف حاسب {stop.customer_name}؟</h2>
      <p className="text-secondary" style={{ marginTop: 0, fontSize: "0.82rem" }}>
        {items.map((it) => `${it.quantity} × ${it.product_name_snapshot}`).join("، ")}
      </p>
      <div className="pay-choice-grid">
        <button className="pay-choice-btn cash" disabled={busy} onClick={payCash}>
          <span className="pc-ic">💵</span>
          <span className="pc-t">كاش</span>
          <span className="pc-v tabular-num">{cashAll.toFixed(2)} JD</span>
        </button>
        <button className="pay-choice-btn coupon" disabled={busy || !canCoupon} onClick={payCoupons}>
          <span className="pc-ic">🎫</span>
          <span className="pc-t">كوبون</span>
          <span className="pc-v tabular-num">{canCoupon ? `${eligibleQty} كوبون` : "الطلب ما بيقبل كوبون"}</span>
          {canCoupon && (
            <span className="pc-s">
              {enoughCoupons
                ? `معه ${balance} · بيضل ${balance - eligibleQty}`
                : balance > 0 ? `معه ${balance} بالنظام · الباقي ورقي` : "كوبون ورقي"}
              {cashWithCoupons > 0 ? ` · + ${cashWithCoupons.toFixed(2)} JD كاش` : ""}
            </span>
          )}
        </button>
      </div>
      <button className="link-btn" style={{ width: "100%", justifyContent: "center", margin: "10px 0 6px" }} onClick={onDetails}>
        دين، دفع جزئي، كاش وكوبون مع بعض، أو فوارغ
      </button>
      <button className="btn-secondary" onClick={onCancel}>رجوع</button>
    </div>
  );
}

function DeliveryPaymentForm({ stop, deliverFast, onCancel }) {
  const { canAction } = usePerms();
  const eligibleItems = stop.items.filter(couponable);
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

// زبون خلص (تسلّم أو تعذّر أو انلغى) — تفاصيل البيت والتواصل، وتراجع عن التسليم
function ClosedStopCard({ stop, index, canOperate, busy, onUndo, onBack, onRefresh }) {
  const [editing, setEditing] = useState(false);
  const [confirmUndo, setConfirmUndo] = useState(false);
  const delivered = stop.order_status === "DELIVERED" || !!stop.delivered_at;
  // رابط الفاتورة جوّا رسالة الإيصال
  const [invoiceToken, setInvoiceToken] = useState(null);
  useEffect(() => {
    if (delivered && stop.order_id) api.getInvoiceLink(stop.order_id).then((r) => setInvoiceToken(r.token)).catch(() => {});
  }, [stop.order_id, delivered]);
  const mapLink = (stop.latitude && stop.longitude) ? `https://www.google.com/maps?q=${stop.latitude},${stop.longitude}` : stop.maps_url || null;
  const sideTxt = stop.side === "يسار" ? "شمال الدرج" : stop.side === "يمين" ? "يمين الدرج" : stop.side;
  const rows = [
    ["المنطقة", stop.region_name],
    ["الشارع", stop.street],
    ["العمارة", [stop.building_number, stop.building_name].filter(Boolean).join(" · ")],
    ["الطابق", stop.floor],
    ["الشقة", stop.apartment],
    ["الجهة", sideTxt],
  ].filter(([, v]) => v);
  const cash = Number(stop.cash_collected || 0);
  const coupons = Number(stop.coupons_collected || 0);

  return (
    <div className="card closed-card">
      <div className={`closed-status ${delivered ? "ok" : stop.order_status === "FAILED" ? "bad" : "muted"}`}>
        <span>
          {delivered ? `✓ تسلّم${stop.delivered_at ? ` الساعة ${formatClockTime(stop.delivered_at)}` : ""}` : stop.order_status === "FAILED" ? "تعذّر التسليم" : "انلغى"}
        </span>
        <button className="link-btn" onClick={onBack}>رجوع للتالي</button>
      </div>

      {stop.building_photo_url && (
        <div className="sc-photo"><img src={stop.building_photo_url} alt="صورة البيت" /></div>
      )}

      <div className="sc-head">
        {index ? <span className="sc-num tabular-num" style={{ background: delivered ? "var(--success)" : "var(--mist)" }}>{index}</span> : null}
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 className="sc-name">{stop.customer_name}</h2>
          <div className="sc-sub tabular-num">#{stop.order_number}</div>
        </div>
        <button type="button" className="sc-edit" onClick={() => setEditing(true)} aria-label="تعديل بيانات الزبون"><FiEdit2 aria-hidden="true" /></button>
      </div>
      <CustomerEditSheet open={editing} c={stop} onClose={() => setEditing(false)} onSaved={() => onRefresh?.()} />

      {delivered && (
        <div className="sc-order">
          <div className="sc-sec-t">اللي استلمته</div>
          {(stop.items || []).map((it, i) => (
            <div key={i} className="sc-item">
              <span className="sc-qty tabular-num">{it.quantity}</span>
              <span className="sc-pname">{it.product_name_snapshot}</span>
            </div>
          ))}
          <div className="sc-total">
            <span>{coupons > 0 && cash > 0 ? "كوبون + كاش" : coupons > 0 ? "كوبون" : "كاش"}</span>
            <b className="tabular-num">
              {coupons > 0 && <span style={{ color: "var(--primary)" }}>🎫 {coupons}{cash > 0 ? " + " : ""}</span>}
              {(cash > 0 || coupons === 0) && `${cash.toFixed(2)} JD`}
            </b>
          </div>
        </div>
      )}

      {rows.length > 0 && (
        <div className="sc-addr">
          <div className="sc-sec-t">العنوان</div>
          <div className="sc-addr-grid">
            {rows.map(([k, v]) => (
              <div key={k} className={`sc-cell${k === "الجهة" ? " hl" : ""}`}><span>{k}</span><b>{v}</b></div>
            ))}
          </div>
          {stop.access_notes && <div className="sc-note">🔔 {stop.access_notes}</div>}
        </div>
      )}

      <div className="quick-actions" style={{ marginTop: 0, marginBottom: delivered && canOperate ? 12 : 0 }}>
        {mapLink ? (
          <a className="quick-action primary" href={mapLink} target="_blank" rel="noreferrer"><FiNavigation aria-hidden="true" /><span>الملاحة</span></a>
        ) : (
          <span className="quick-action disabled"><FiNavigation aria-hidden="true" /><span>بدون موقع</span></span>
        )}
        <a className="quick-action" href={`tel:${stop.phone_display}`}><FiPhone aria-hidden="true" /><span>اتصال</span></a>
        <a className="quick-action whatsapp" href={`https://wa.me/${stop.phone_normalized}`} target="_blank" rel="noreferrer"><FaWhatsapp aria-hidden="true" /><span>واتساب</span></a>
        {delivered && stop.cash_collected != null && stop.phone_normalized && (
          <a className="quick-action whatsapp" href={receiptLink(stop.phone_normalized, { ...receiptFromStop(stop), invoiceToken })} target="_blank" rel="noreferrer"><FaWhatsapp aria-hidden="true" /><span>الإيصال</span></a>
        )}
      </div>

      {delivered && canOperate && (
        <button className="btn-secondary" disabled={busy} onClick={() => setConfirmUndo(true)}>↩️ تراجع عن التسليم (رجّعه لسا ما تسلّم)</button>
      )}
      <ConfirmSheet
        open={confirmUndo}
        title="تراجع عن التسليم؟"
        text={`طلب ${stop.customer_name} برجع «لسا ما تسلّم»، والكاش والكوبونات اللي انسجّلت عليه بتنشال.`}
        confirmLabel="نعم، تراجع"
        busy={busy}
        onConfirm={() => { setConfirmUndo(false); onUndo(); }}
        onClose={() => setConfirmUndo(false)}
      />
    </div>
  );
}

function StopCard({ stop, index, picked, onBackToNext, readOnly, busy, withBusy, deliverFast, onRefresh }) {
  const { canAction } = usePerms();
  const canCancel = canAction("cancel_order");
  const [showFailMenu, setShowFailMenu] = useState(false);
  const [showPostponeForm, setShowPostponeForm] = useState(false);
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [showPayChoice, setShowPayChoice] = useState(false);
  const [otherDay, setOtherDay] = useState(false);
  const [dayDraft, setDayDraft] = useState(null);
  const [postponeNote, setPostponeNote] = useState("");
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editingItems, setEditingItems] = useState(false);
  const [selling, setSelling] = useState(false);
  const [stopMsg, setStopMsg] = useState("");
  function afterSheet(msg) {
    setStopMsg(msg || "");
    if (msg) setTimeout(() => setStopMsg(""), 4000);
    onRefresh?.();
  }
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [photoMsg, setPhotoMsg] = useState("");

  // صورة البيت: أول ما تختارها بتنرفع وبتنحفظ — بدون زر حفظ
  async function uploadPhoto(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setPhotoPreview(URL.createObjectURL(file));
    setPhotoBusy(true);
    setPhotoMsg("");
    try {
      await api.uploadCustomerPhoto(stop.customer_id, file);
      setPhotoMsg("✅ انحفظت صورة البيت");
      setTimeout(() => setPhotoMsg(""), 3000);
      onRefresh?.();
    } catch (err) {
      setPhotoPreview(null);
      setPhotoMsg(`ما انحفظت الصورة: ${err.message}`);
    } finally {
      setPhotoBusy(false);
    }
  }

  const mapLink = (stop.latitude && stop.longitude)
    ? `https://www.google.com/maps?q=${stop.latitude},${stop.longitude}`
    : stop.maps_url || null;
  const whatsappLink = `https://wa.me/${stop.phone_normalized}`;

  // لو الزبون معه كوبونات بيستخدمها: بتفتح شاشة الدفع.
  // غير هيك: تسليم بضغطة وحدة وقبض المبلغ كامل كاش.
  const needsPaymentChoice = stop.coupon_balance > 0 && (stop.items || []).some((it) => it.coupon_eligible);
  // طلب باقة كوبونات بس (بدون مي)
  const couponOnly = !!stop.wants_coupons && !stop.needs_quantity && (!stop.items || stop.items.length === 0);
  const missingQuantity = !couponOnly && (!stop.items || stop.items.length === 0);
  const [showQuantityForm, setShowQuantityForm] = useState(false);
  const amountDue = missingQuantity ? 0 : computeAmountDue(stop);
  const debt = Number(stop.debt_balance || 0);

  function handleDeliverClick() {
    // دايمًا بنسأل: حاسب كاش ولا كوبون؟ عشان جرد السيارة يطلع مضبوط
    if (couponOnly) { deliverFast(stop, [], { cash_received: 0 }); return; }
    if (!missingQuantity) { setShowPayChoice(true); return; }
    if (needsPaymentChoice) setShowPaymentForm(true);
    else deliverFast(stop, [], { cash_received: amountDue });
  }

  const etaText = stop.estimated_eta_minutes != null && stop.estimated_eta_minutes > 0
    ? `خلال حوالي ${Math.max(5, Math.round(stop.estimated_eta_minutes / 5) * 5)} دقيقة`
    : "خلال دقائق";
  const onMyWayLink = `https://wa.me/${stop.phone_normalized}?text=${encodeURIComponent(
    renderMessage("on_my_way", { "الاسم": stop.customer_name, "الوقت": etaText })
  )}`;

  // تأجيل: آخر الرحلة / بعد ساعة / بعد ساعتين / يوم ثاني (بيطلع من الرحلة)
  function postpone(body) {
    withBusy(() => api.postponeStop(stop.id, { note: postponeNote, ...body })).then(() => {
      setShowPostponeForm(false);
      setShowFailMenu(false);
      setOtherDay(false);
      setDayDraft(null);
      setPostponeNote("");
    });
  }
  const inHours = (h) => new Date(Date.now() + h * 3600 * 1000).toISOString();

  if (showPayChoice && !showPaymentForm) {
    return (
      <PayChoice
        stop={stop}
        busy={busy}
        deliverFast={deliverFast}
        onDetails={() => { setShowPayChoice(false); setShowPaymentForm(true); }}
        onCancel={() => setShowPayChoice(false)}
      />
    );
  }

  if (showPaymentForm) {
    return <DeliveryPaymentForm stop={stop} deliverFast={deliverFast} onCancel={() => setShowPaymentForm(false)} />;
  }

  return (
    <div className="card" style={picked ? { border: "2px solid var(--warning)" } : undefined}>
      {picked && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, background: "var(--warning-soft)", color: "var(--warning)", borderRadius: 10, padding: "8px 12px", marginBottom: 12, fontSize: "0.82rem", fontWeight: 700 }}>
          <span>اخترته من القائمة</span>
          <button className="link-btn" onClick={onBackToNext}>رجوع للتالي بالترتيب</button>
        </div>
      )}
      {/* صورة البيت: تصوير مباشر وبتنحفظ لحالها */}
      {(stop.building_photo_url || photoPreview) ? (
        <div className="sc-photo">
          <img src={photoPreview || stop.building_photo_url} alt="صورة البيت" />
          <label className="sc-photo-btn">
            <FiCamera aria-hidden="true" /> {photoBusy ? "جاري الحفظ…" : "غيّر الصورة"}
            <input type="file" accept="image/*" capture="environment" onChange={uploadPhoto} disabled={photoBusy} hidden />
          </label>
        </div>
      ) : (
        <label className="sc-photo-add">
          <FiCamera aria-hidden="true" /> {photoBusy ? "جاري الحفظ…" : "صوّر البيت"}
          <input type="file" accept="image/*" capture="environment" onChange={uploadPhoto} disabled={photoBusy} hidden />
        </label>
      )}
      {photoMsg && <div className="sc-photo-msg">{photoMsg}</div>}

      <div className="sc-head">
        {index ? <span className="sc-num tabular-num">{index}</span> : null}
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 className="sc-name">
            {stop.customer_name}
            <CouponChip balance={stop.coupon_balance} label />
            {stop.priority === "urgent" && <span className="sc-urgent">🚨 مستعجل</span>}
          </h2>
          <div className="sc-sub tabular-num">#{stop.order_number}</div>
        </div>
        <button type="button" className="sc-edit" onClick={() => setEditing(true)} aria-label="تعديل بيانات الزبون" title="تعديل بيانات الزبون">
          <FiEdit2 aria-hidden="true" />
        </button>
      </div>
      <CustomerEditSheet
        open={editing}
        c={stop}
        onClose={() => setEditing(false)}
        onSaved={() => onRefresh?.()}
      />

      {(debt > 0 || (stop.coupon_balance || 0) > 0) && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
          {debt > 0 && <span className="badge" style={{ background: "var(--urgent-soft)", color: "var(--urgent)" }}>عليه دين {debt.toFixed(2)} JD</span>}
          {(stop.coupon_balance || 0) > 0 && <span className="badge" style={{ background: "var(--primary-soft)", color: "var(--navy)" }}>🎫 معه {stop.coupon_balance} كوبون</span>}
        </div>
      )}

      <BottleTypeBadge type={stop.bottle_type} large />

      {stop.is_time_locked && stop.requested_time && (
        <div style={{ marginBottom: 10 }}><span className="badge" style={{ background: "var(--warning-soft)", color: "var(--warning)" }}>⏰ موعده {formatClockTime(stop.requested_time)}</span></div>
      )}

      {stop.wants_coupons && !readOnly && (
        stop.package_sold ? (
          <div className="sc-want done">✓ انباعتله الباقة اللي طلبها</div>
        ) : (
          <button type="button" className="sc-want" onClick={() => setSelling(true)}>
            <span className="sc-want-ic" aria-hidden="true">🎫</span>
            <span className="sc-want-t">
              <b>الزبون طالب باقة كوبونات</b>
              <small>{stop.wants_package_name ? `بدو: ${stop.wants_package_name}` : "اسأله أي باقة بدو"}{couponOnly ? " · باقة بس، بدون مي" : ""}</small>
            </span>
            <span className="sc-want-go">بيع</span>
          </button>
        )
      )}

      {missingQuantity && !showQuantityForm && !readOnly && (
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
        <div className="sc-order">
          <div className="sc-sec-row">
            <span className="sc-sec-t" style={{ margin: 0 }}>الطلب</span>
            {!readOnly && (
              <button type="button" className="sc-mini-btn" onClick={() => setEditingItems(true)}>
                <FiEdit2 aria-hidden="true" /> تعديل
              </button>
            )}
          </div>
          {stop.items.map((it, i) => (
            <div key={i} className="sc-item">
              <span className="sc-qty tabular-num">{it.quantity}</span>
              <span className="sc-pname">{it.product_name_snapshot}</span>
              <span className="sc-price tabular-num">{(Number(it.unit_price_snapshot || 0) * it.quantity).toFixed(2)}</span>
            </div>
          ))}
          <div className="sc-total">
            <span>المطلوب</span>
            <b className="tabular-num">{Number(stop.final_total).toFixed(2)} JD</b>
          </div>
        </div>
      )}

      {!readOnly && (
        <button type="button" className="sc-sell2" onClick={() => setSelling(true)}>
          <span className="sc-sell2-ic" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4z"/><path d="M14 6v12" strokeDasharray="2 2"/></svg>
          </span>
          <span className="sc-sell2-t">
            <b>بيع باقة كوبونات</b>
            <small>{(stop.coupon_balance || 0) > 0 ? `معه هلّق ${stop.coupon_balance} كوبون` : "ما معه كوبونات — اعرض عليه باقة"}</small>
          </span>
          <FiChevronLeft className="sc-sell2-c" aria-hidden="true" />
        </button>
      )}
      {stopMsg && <div className="success-box" style={{ marginBottom: 10 }}>{stopMsg}</div>}
      <EditItemsSheet open={editingItems} stop={stop} onClose={() => setEditingItems(false)} onSaved={afterSheet} />
      <SellPackageSheet open={selling} stop={stop} preselect={stop.wants_coupons ? stop.wants_package_id : null} onClose={() => setSelling(false)} onSaved={afterSheet} />

      {(() => {
        const sideTxt = stop.side === "يسار" ? "شمال الدرج" : stop.side === "يمين" ? "يمين الدرج" : stop.side;
        const rows = [
          ["المنطقة", stop.region_name],
          ["الشارع", stop.street],
          ["العمارة", [stop.building_number, stop.building_name].filter(Boolean).join(" · ")],
          ["الطابق", stop.floor],
          ["الشقة", stop.apartment],
          ["الجهة", sideTxt],
        ].filter(([, v]) => v);
        if (!rows.length && !stop.access_notes && !stop.order_notes) {
          return (
            <button type="button" className="sc-addr-empty" onClick={() => setEditing(true)}>
              ما في عنوان مفصّل لهالزبون — اكبس لتضيفه
            </button>
          );
        }
        return (
          <div className="sc-addr">
            <div className="sc-sec-t">العنوان</div>
            {rows.length > 0 && (
              <div className="sc-addr-grid">
                {rows.map(([k, v]) => (
                  <div key={k} className={`sc-cell${k === "الجهة" ? " hl" : ""}`}>
                    <span>{k}</span>
                    <b>{v}</b>
                  </div>
                ))}
              </div>
            )}
            {stop.access_notes && <div className="sc-note">🔔 {stop.access_notes}</div>}
            {stop.order_notes && <div className="sc-note">📝 {stop.order_notes}</div>}
          </div>
        );
      })()}

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
        {!readOnly && (
          <a className="quick-action whatsapp" href={onMyWayLink} target="_blank" rel="noreferrer">
            <FaWhatsapp aria-hidden="true" /><span>أنا جاي</span>
          </a>
        )}
      </div>

      {readOnly && canCancel && (
        <button className="btn-danger-text icon-row" style={{ justifyContent: "center" }} disabled={busy} onClick={() => setConfirmCancel(true)}>
          ❌ إلغاء الطلب
        </button>
      )}

      {!readOnly && (<>

      <button
        className="btn-primary icon-row"
        style={{ justifyContent: "center", marginBottom: 6, background: "var(--success)", opacity: missingQuantity ? 0.5 : 1 }}
        disabled={busy || missingQuantity}
        onClick={handleDeliverClick}
      >
        <FiCheckCircle />
        تم التسليم
      </button>

      {/* تحت «تم التسليم»: تأجيل · تعذّر · إلغاء */}
      <div className="stop-sub-actions">
        <button disabled={busy} onClick={() => { setOtherDay(false); setDayDraft(null); setPostponeNote(""); setShowPostponeForm(true); }}><FiClock aria-hidden="true" /> تأجيل</button>
        <button disabled={busy} onClick={() => setShowFailMenu(true)}><FiAlertTriangle aria-hidden="true" /> تعذّر</button>
        {canCancel && <button className="danger" disabled={busy} onClick={() => setConfirmCancel(true)}><FiXCircle aria-hidden="true" /> إلغاء</button>}
      </div>

      {/* تعذّر التسليم: كبسة وحدة على السبب */}
      <Sheet open={showFailMenu} title="تعذّر التسليم" onClose={() => setShowFailMenu(false)}>
        <div className="sheet-who">
          <span className="sheet-who-n tabular-num">{index || "•"}</span>
          <span><b>{stop.customer_name}</b><small className="tabular-num">#{stop.order_number}</small></span>
        </div>
        <div className="sheet-q">شو صار؟</div>
        <div className="sopts">
          {[
            ["لا يرد", "اتصلت وما رد", FiPhoneOff],
            ["خارج المنزل", "ما في حدا بالبيت", FiHome],
            ["العنوان غلط", "ما لقيت المكان", FiMapPin],
          ].map(([r, sub, Ic]) => (
            <button key={r} className="sopt warn" disabled={busy} onClick={() => withBusy(() => api.failStop(stop.id, r)).then(() => setShowFailMenu(false))}>
              <span className="sopt-ic"><Ic aria-hidden="true" /></span>
              <span className="sopt-t"><b>{r}</b><small>{sub}</small></span>
            </button>
          ))}
        </div>
        <button className="btn-secondary" style={{ marginTop: 12 }} onClick={() => setShowFailMenu(false)}>رجوع</button>
      </Sheet>

      {/* تأجيل */}
      <Sheet open={showPostponeForm} title="تأجيل الطلب" onClose={() => setShowPostponeForm(false)}>
        <div className="sheet-who">
          <span className="sheet-who-n tabular-num">{index || "•"}</span>
          <span><b>{stop.customer_name}</b><small className="tabular-num">#{stop.order_number}</small></span>
        </div>
        {!otherDay ? (
          <>
            <div className="sheet-q">لإمتى بدك تأجّله؟</div>
            <div className="sopts">
              <button className="sopt" disabled={busy} onClick={() => postpone({})}>
                <span className="sopt-ic"><FiRotateCw aria-hidden="true" /></span>
                <span className="sopt-t"><b>آخر الرحلة</b><small>بترجعله بعد ما تخلّص الباقي</small></span>
              </button>
              <button className="sopt" disabled={busy} onClick={() => postpone({ new_time: inHours(1) })}>
                <span className="sopt-ic"><FiClock aria-hidden="true" /></span>
                <span className="sopt-t"><b>بعد ساعة</b><small className="tabular-num">الساعة {formatClockTime(60)}</small></span>
              </button>
              <button className="sopt" disabled={busy} onClick={() => postpone({ new_time: inHours(2) })}>
                <span className="sopt-ic"><FiClock aria-hidden="true" /></span>
                <span className="sopt-t"><b>بعد ساعتين</b><small className="tabular-num">الساعة {formatClockTime(120)}</small></span>
              </button>
              <button className="sopt" disabled={busy} onClick={() => setOtherDay(true)}>
                <span className="sopt-ic"><FiCalendar aria-hidden="true" /></span>
                <span className="sopt-t"><b>بكرة أو يوم ثاني</b><small>بيطلع من الرحلة وبيرجع بيومه</small></span>
              </button>
            </div>
            <div className="sheet-q" style={{ marginTop: 14 }}>السبب <span>(اختياري)</span></div>
            <div className="chips" style={{ flexWrap: "wrap", marginBottom: 0 }}>
              {["الزبون طلب", "مش موجود هلّق"].map((r) => (
                <button key={r} type="button" className={`chip${postponeNote === r ? " on" : ""}`} onClick={() => setPostponeNote(postponeNote === r ? "" : r)}>{r}</button>
              ))}
            </div>
            <button className="btn-secondary" style={{ marginTop: 12 }} onClick={() => setShowPostponeForm(false)}>رجوع</button>
          </>
        ) : (
          <>
            <div className="sheet-q">اختار اليوم والساعة</div>
            <SchedulePicker value={dayDraft} onChange={setDayDraft} />
            <div className="sheet-actions">
              <button
                className="btn-primary"
                disabled={busy || !dayDraft?.scheduled_date}
                onClick={() => postpone({ other_day: true, scheduled_date: dayDraft.scheduled_date, new_time: dayDraft.requested_time || undefined })}
              >
                تأكيد التأجيل
              </button>
              <button className="btn-secondary" onClick={() => setOtherDay(false)}>رجوع</button>
            </div>
          </>
        )}
      </Sheet>
      </>)}

      <ConfirmSheet
        open={confirmCancel}
        title="إلغاء الطلب؟"
        text={`طلب ${stop.customer_name} (#${stop.order_number}) رح ينلغى وينشال من الرحلة. ما بينحسب عليه إشي.`}
        confirmLabel="نعم، ألغِ الطلب"
        danger
        busy={busy}
        onConfirm={() => withBusy(() => api.cancelStop(stop.id)).then(() => setConfirmCancel(false))}
        onClose={() => setConfirmCancel(false)}
      />
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
      {summary.packages_cash > 0 && (
        <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
          <span>باقات كوبونات انباعت ({summary.packages_sold})</span>
          <span className="tabular-num" style={{ fontWeight: 700, color: "var(--success)" }}>+ {Number(summary.packages_cash).toFixed(2)} JD</span>
        </div>
      )}
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
