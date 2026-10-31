import { useEffect, useState } from "react";
import { FiSearch, FiPhone, FiChevronLeft, FiEdit2, FiClock, FiAlertTriangle, FiXCircle, FiPercent, FiZap, FiRotateCcw, FiArrowRight, FiTruck } from "react-icons/fi";
import { FaWhatsapp } from "react-icons/fa";
import { api } from "../api.js";
import { usePerms } from "../auth.jsx";
import { BottleTypeBadge, NeedsQuantityBadge } from "../components/BottleType.jsx";
import SchedulePicker from "../components/SchedulePicker.jsx";
import Sheet, { ConfirmSheet } from "../components/Sheet.jsx";
import { scheduleLabel } from "../schedule.js";
import CouponChip from "../components/CouponChip.jsx";

// الحالات: اسم + لون ناعم
export const STATUS_META = {
  NEW: { label: "جديد", tone: "blue" },
  READY: { label: "جاهز", tone: "blue" },
  IN_ROUTE: { label: "بالطريق", tone: "amber" },
  DELIVERED: { label: "تسلّم", tone: "green" },
  CANCELLED: { label: "ملغي", tone: "gray" },
  FAILED: { label: "تعذّر", tone: "red" },
  POSTPONED: { label: "مؤجل", tone: "amber" },
};

export function StatusPill({ status }) {
  const m = STATUS_META[status] || { label: status, tone: "gray" };
  return <span className={`st-pill ${m.tone}`}>{m.label}</span>;
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString("ar-JO", { timeZone: "Asia/Amman", hour: "numeric", minute: "2-digit" });
}
function formatDayTime(iso) {
  return new Date(iso).toLocaleString("ar-JO", { timeZone: "Asia/Amman", weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit" });
}

function jordanToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Amman", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function shiftDays(dateStr, n) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// الفترات: الأسبوع بيبدأ السبت (زي الشغل بالأردن)
const PERIODS = [
  { key: "today", label: "اليوم", range: (t) => [t, t] },
  { key: "yesterday", label: "أمس", range: (t) => [shiftDays(t, -1), shiftDays(t, -1)] },
  {
    key: "week",
    label: "هالأسبوع",
    range: (t) => {
      const dow = new Date(`${t}T12:00:00Z`).getUTCDay(); // 0=أحد ... 6=سبت
      const sinceSat = (dow + 1) % 7;
      return [shiftDays(t, -sinceSat), t];
    },
  },
  { key: "month", label: "هالشهر", range: (t) => [`${t.slice(0, 8)}01`, t] },
  { key: "all", label: "الكل", range: () => [null, null] },
  { key: "scheduled", label: "📅 بموعد", range: () => [null, null] },
];

const STATUS_CHIPS = [
  { key: "", label: "الكل" },
  { key: "NEW", label: "جديد" },
  { key: "IN_ROUTE", label: "بالطريق" },
  { key: "DELIVERED", label: "تسلّم" },
  { key: "FAILED", label: "تعذّر" },
  { key: "CANCELLED", label: "ملغي" },
];

function itemsText(items) {
  if (!items || !items.length) return "";
  return items.map((it) => `${it.quantity} × ${it.product_name_snapshot}`).join("، ");
}

export default function Orders({ user }) {
  const [orders, setOrders] = useState([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [urgentOnly, setUrgentOnly] = useState(false);
  const [period, setPeriod] = useState("today");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState(null);

  async function load() {
    setError("");
    setLoading(true);
    try {
      const params = { limit: 500, with_items: "true" };
      if (statusFilter) params.status = statusFilter;
      if (urgentOnly) params.priority = "urgent";
      const [from, to] = PERIODS.find((p) => p.key === period).range(jordanToday());
      if (period === "scheduled") params.scheduled = "future";
      if (from) params.from = from;
      if (to) params.to = to;
      if (search.trim()) params.q = search.trim();
      setOrders(await api.getOrders(params));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [statusFilter, urgentOnly, period, search]);

  if (selectedId) {
    return (
      <div className="page">
        <OrderDetail
          orderId={selectedId}
          user={user}
          onBack={() => { setSelectedId(null); load(); }}
        />
      </div>
    );
  }

  const active = orders.filter((o) => o.status !== "CANCELLED");
  const total = active.reduce((sum, o) => sum + Number(o.final_total || 0), 0);
  const delivered = orders.filter((o) => o.status === "DELIVERED").length;
  const waiting = orders.filter((o) => ["NEW", "READY", "IN_ROUTE"].includes(o.status)).length;

  return (
    <div className="page">
      <div className="ord-head">
        <h1 className="title-lg" style={{ margin: 0 }}>الطلبات</h1>
        <button className={`ord-urgent-toggle${urgentOnly ? " on" : ""}`} onClick={() => setUrgentOnly(!urgentOnly)} aria-pressed={urgentOnly}>
          🚨 المستعجل
        </button>
      </div>
      {error && <div className="error-box">{error}</div>}

      <div className="ord-search">
        <FiSearch aria-hidden="true" />
        <input placeholder="دوّر باسم، تلفون، أو رقم طلب" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="بحث بالطلبات" />
      </div>

      <div className="chips" role="radiogroup" aria-label="الفترة">
        {PERIODS.map((p) => (
          <button key={p.key} className={`chip${period === p.key ? " on" : ""}`} role="radio" aria-checked={period === p.key} onClick={() => setPeriod(p.key)}>
            {p.label}
          </button>
        ))}
      </div>

      <div className="ord-stats">
        <div className="ord-stat"><b className="tabular-num">{orders.length}</b><span>طلب</span></div>
        <div className="ord-stat blue"><b className="tabular-num">{waiting}</b><span>بستنى</span></div>
        <div className="ord-stat green"><b className="tabular-num">{delivered}</b><span>تسلّم</span></div>
        <div className="ord-stat"><b className="tabular-num">{total.toFixed(total >= 100 ? 0 : 2)}</b><span>JD</span></div>
      </div>

      <div className="seg ord-status-seg" role="radiogroup" aria-label="الحالة">
        {STATUS_CHIPS.map((c) => (
          <button key={c.key || "all"} className={statusFilter === c.key ? "on" : ""} role="radio" aria-checked={statusFilter === c.key} onClick={() => setStatusFilter(c.key)}>
            {c.label}
          </button>
        ))}
      </div>

      {loading && orders.length === 0 && <p className="text-secondary" style={{ padding: 14 }}>جاري التحميل...</p>}
      {!loading && orders.length === 0 && (
        <div className="ord-empty">
          <div style={{ fontSize: "2rem" }}>📭</div>
          <div>ما في طلبات هون</div>
        </div>
      )}

      <div className="ord-list">
        {orders.map((o) => {
          const tone = (STATUS_META[o.status] || {}).tone || "gray";
          return (
            <button key={o.id} className={`ord-card tone-${tone}${o.status === "CANCELLED" ? " dim" : ""}`} onClick={() => setSelectedId(o.id)}>
              <span className="ord-avatar" aria-hidden="true">{(o.customer_name || "؟").trim().charAt(0)}</span>
              <span className="ord-main">
                <span className="ord-name">
                  {o.customer_name}
                  <CouponChip balance={o.coupon_balance} />
                  {o.wants_coupons && <span className="want-tag">🎫 بدو باقة</span>}
                  {o.priority === "urgent" && <span className="ord-flag">🚨</span>}
                </span>
                <span className="ord-items">{itemsText(o.items) || (o.wants_coupons && !o.needs_quantity ? "باقة كوبونات بس" : <NeedsQuantityBadge order={o} />)}</span>
                <span className="ord-meta tabular-num">
                  #{o.order_number} · {formatTime(o.created_at)}
                  {scheduleLabel(o) && !["DELIVERED", "CANCELLED"].includes(o.status) && <span className="sched-badge">📅 {scheduleLabel(o)}</span>}
                </span>
              </span>
              <span className="ord-side">
                <span className="ord-total tabular-num">{Number(o.final_total).toFixed(2)}</span>
                <StatusPill status={o.status} />
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const FAIL_REASONS = ["لا يرد", "مش موجود بالبيت", "العنوان غلط", "مشكلة بالوصول"];
const POSTPONE_REASONS = ["الزبون طلب", "مش موجود هلّق", "ما في وقت اليوم"];

function OrderDetail({ orderId, user, onBack }) {
  const [order, setOrder] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingItems, setEditingItems] = useState(false);
  const [sheet, setSheet] = useState(null); // cancel | postpone | fail | discount | schedule
  const [scheduleDraft, setScheduleDraft] = useState(null);
  const [postponeReason, setPostponeReason] = useState("");
  const [discount, setDiscount] = useState({ value: "", type: "amount", reason: "" });

  const perms = usePerms();
  const canEditOrders = perms.canEdit("orders");
  const canDiscount = canEditOrders && perms.canAction("discount");
  const canCancel = canEditOrders && perms.canAction("cancel_order");

  async function load() {
    try {
      setOrder(await api.getOrder(orderId));
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => { load(); }, [orderId]);

  function flash(msg) {
    setNotice(msg);
    setTimeout(() => setNotice(""), 4000);
  }

  async function run(fn, msg) {
    setBusy(true);
    setError("");
    try {
      await fn();
      setSheet(null);
      await load();
      if (msg) flash(msg);
    } catch (err) {
      setError(err.message);
      setSheet(null);
    } finally {
      setBusy(false);
    }
  }

  if (!order) return <p className="text-secondary">جاري التحميل...</p>;

  if (editingItems) {
    return (
      <EditOrderItemsForm
        order={order}
        onCancel={() => setEditingItems(false)}
        onSaved={() => { setEditingItems(false); load(); flash("✅ انحفظ محتوى الطلب"); }}
      />
    );
  }

  const isFinal = ["DELIVERED", "CANCELLED"].includes(order.status);
  const sched = scheduleLabel(order);

  function openPostpone() {
    setScheduleDraft({ scheduled_date: null, requested_time: null });
    setPostponeReason("");
    setSheet("postpone");
  }

  function submitPostpone() {
    const d = scheduleDraft || {};
    const label = d.requested_time || d.scheduled_date ? scheduleLabel(d) : null;
    run(
      () => api.postponeOrder(order.id, { scheduled_date: d.scheduled_date, requested_time: d.requested_time, reason: postponeReason }),
      label ? `⏰ تأجّل لـ ${label}` : "✅ رجع لقائمة التوزيع"
    );
  }

  function submitDiscount() {
    const value = parseFloat(discount.value);
    if (!value || value <= 0) return;
    run(() => api.applyDiscount(order.id, { discount_type: discount.type, discount_value: value, reason: discount.reason }), "✅ انضاف الخصم");
  }

  const phoneDigits = order.customer_phone_normalized || "";

  return (
    <div className="od">
      <button className="od-back" onClick={onBack}><FiArrowRight aria-hidden="true" /> الطلبات</button>

      {notice && <div className="success-box">{notice}</div>}
      {error && <div className="error-box">{error}</div>}

      <div className="od-hero">
        <div className="od-hero-top">
          <StatusPill status={order.status} />
          <span className="text-secondary tabular-num">#{order.order_number}</span>
        </div>
        <h2 className="od-name">
          {order.customer_name}
          {order.priority === "urgent" && <span className="od-urgent">🚨 مستعجل</span>}
        </h2>
        <div className="od-sub tabular-num">
          <BottleTypeBadge type={order.bottle_type} /> <span>{formatDayTime(order.created_at)}</span>
        </div>
        {order.driver_name && order.status === "IN_ROUTE" && (
          <div className="od-driver"><FiTruck aria-hidden="true" /> مع {order.driver_name} بالرحلة</div>
        )}
        {(Number(order.debt_balance) > 0 || Number(order.coupon_balance) > 0 || order.wants_coupons) && (
          <div className="od-tags">
            {order.wants_coupons && <span className="od-tag blue">🎫 بدو باقة كوبونات{order.wants_package_name ? `: ${order.wants_package_name}` : ""}</span>}
            {Number(order.debt_balance) > 0 && <span className="od-tag red">عليه {Number(order.debt_balance).toFixed(2)} JD</span>}
            {Number(order.coupon_balance) > 0 && <span className="od-tag blue">🎫 معه {order.coupon_balance} كوبون</span>}
          </div>
        )}
        {order.customer_phone && (
          <div className="od-contact">
            <a href={`tel:${order.customer_phone}`} className="od-contact-btn"><FiPhone aria-hidden="true" /> اتصال</a>
            {phoneDigits && (
              <a href={`https://wa.me/${phoneDigits}`} target="_blank" rel="noreferrer" className="od-contact-btn wa"><FaWhatsapp aria-hidden="true" /> واتساب</a>
            )}
          </div>
        )}
      </div>

      {order.status === "CANCELLED" && order.cancelled_reason && <div className="od-note gray">سبب الإلغاء: {order.cancelled_reason}</div>}
      {order.status === "FAILED" && order.failed_reason && <div className="od-note red">تعذّر: {order.failed_reason}</div>}

      {!isFinal && (
        <button className="od-sched" onClick={() => canEditOrders && openPostpone()} disabled={!canEditOrders}>
          <FiClock aria-hidden="true" />
          <span style={{ flex: 1 }}>
            <b>{sched ? `موعده ${sched}` : "بدون موعد — بأقرب وقت"}</b>
          </span>
          {canEditOrders && <span className="od-sched-link">{sched ? "غيّر" : "حدّد موعد"}</span>}
        </button>
      )}

      {order.needs_quantity && !isFinal && canEditOrders && (
        <div className="od-note amber">
          <div style={{ fontWeight: 700, marginBottom: 8 }}>📅 طلب تلقائي — لسا ما انحدد شو بده</div>
          <button className="btn-primary" disabled={busy} onClick={() => setEditingItems(true)}>حدد عدد القوارير</button>
        </div>
      )}

      <div className="od-receipt">
        {order.items.length === 0 && <p className="text-secondary" style={{ margin: 0 }}>لا يوجد منتجات بعد.</p>}
        {order.items.map((item) => (
          <div key={item.id} className="od-line">
            <span><b className="tabular-num">{item.quantity} ×</b> {item.product_name_snapshot}</span>
            <span className="tabular-num">{Number(item.line_total).toFixed(2)}</span>
          </div>
        ))}
        {order.discount_value > 0 && (
          <>
            <div className="od-line muted">
              <span>المجموع</span>
              <span className="tabular-num">{Number(order.subtotal).toFixed(2)}</span>
            </div>
            <div className="od-line red">
              <span>خصم</span>
              <span className="tabular-num">-{order.discount_type === "percent" ? `${order.discount_value}%` : Number(order.discount_value).toFixed(2)}</span>
            </div>
          </>
        )}
        <div className="od-line total">
          <span>المطلوب</span>
          <span className="tabular-num">{Number(order.final_total).toFixed(2)} JD</span>
        </div>
      </div>

      {order.notes && <div className="od-note">📝 {order.notes}</div>}

      {!isFinal && canEditOrders && (
        <>
          {order.status === "IN_ROUTE" && (
            <p className="text-secondary" style={{ fontSize: "0.8rem", margin: "0 4px 8px" }}>
              الطلب مع كابتن برحلة شغّالة — أي تعديل بيوصله لحاله.
            </p>
          )}
          <div className="od-actions">
            <button className="od-act" disabled={busy} onClick={() => setEditingItems(true)}>
              <FiEdit2 aria-hidden="true" /><span>تعديل الطلب</span>
            </button>
            <button className="od-act" disabled={busy} onClick={openPostpone}>
              <FiClock aria-hidden="true" /><span>تأجيل</span>
            </button>
            <button className={`od-act${order.priority === "urgent" ? " on" : ""}`} disabled={busy}
              onClick={() => run(() => api.setOrderPriority(order.id, order.priority === "urgent" ? "normal" : "urgent"), order.priority === "urgent" ? "رجع عادي" : "🚨 صار مستعجل")}>
              <FiZap aria-hidden="true" /><span>{order.priority === "urgent" ? "شيل المستعجل" : "مستعجل"}</span>
            </button>
            {canDiscount && (
              <button className="od-act" disabled={busy} onClick={() => { setDiscount({ value: "", type: "amount", reason: "" }); setSheet("discount"); }}>
                <FiPercent aria-hidden="true" /><span>خصم</span>
              </button>
            )}
            <button className="od-act warn" disabled={busy} onClick={() => setSheet("fail")}>
              <FiAlertTriangle aria-hidden="true" /><span>تعذّر التسليم</span>
            </button>
            {canCancel && (
              <button className="od-act danger" disabled={busy} onClick={() => setSheet("cancel")}>
                <FiXCircle aria-hidden="true" /><span>إلغاء الطلب</span>
              </button>
            )}
          </div>
        </>
      )}

      {(order.status === "POSTPONED" || order.status === "FAILED") && canEditOrders && (
        <button className="btn-primary icon-row" style={{ justifyContent: "center", marginTop: 12 }} disabled={busy}
          onClick={() => run(() => api.reactivateOrder(order.id), "✅ رجع لقائمة التوزيع")}>
          <FiRotateCcw aria-hidden="true" /> رجّعه لقائمة التوزيع
        </button>
      )}

      {/* إلغاء: تأكيد بس */}
      <ConfirmSheet
        open={sheet === "cancel"}
        title="إلغاء الطلب؟"
        text={`طلب ${order.customer_name} (#${order.order_number}) رح ينلغى${order.status === "IN_ROUTE" ? " وينشال من الرحلة" : ""}.`}
        confirmLabel="نعم، ألغِ الطلب"
        danger
        busy={busy}
        onConfirm={() => run(() => api.cancelOrder(order.id), "انلغى الطلب")}
        onClose={() => setSheet(null)}
      />

      {/* تأجيل: اليوم الساعة كذا / بكرة / ... */}
      <Sheet open={sheet === "postpone"} title="أجّل لإمتى؟" onClose={() => setSheet(null)}>
        <SchedulePicker value={scheduleDraft} onChange={setScheduleDraft} />
        <div className="sheet-label">السبب (اختياري)</div>
        <div className="chips" style={{ flexWrap: "wrap" }}>
          {POSTPONE_REASONS.map((r) => (
            <button key={r} type="button" className={`chip${postponeReason === r ? " on" : ""}`} onClick={() => setPostponeReason(postponeReason === r ? "" : r)}>{r}</button>
          ))}
        </div>
        <div className="sheet-actions">
          <button className="btn-primary" disabled={busy} onClick={submitPostpone}>
            {busy ? "لحظة..." : scheduleDraft?.scheduled_date ? "تأكيد التأجيل" : "رجّعه لقائمة اليوم"}
          </button>
          <button className="btn-secondary" disabled={busy} onClick={() => setSheet(null)}>رجوع</button>
        </div>
      </Sheet>

      {/* تعذّر: كبسة وحدة على السبب */}
      <Sheet open={sheet === "fail"} title="ليش تعذّر التسليم؟" onClose={() => setSheet(null)}>
        <div className="sheet-options">
          {FAIL_REASONS.map((r) => (
            <button key={r} className="sheet-option" disabled={busy} onClick={() => run(() => api.failDelivery(order.id, r), "تسجّل: تعذّر التسليم")}>
              {r} <FiChevronLeft aria-hidden="true" />
            </button>
          ))}
        </div>
        <button className="btn-secondary" style={{ marginTop: 10 }} onClick={() => setSheet(null)}>رجوع</button>
      </Sheet>

      {/* خصم */}
      <Sheet open={sheet === "discount"} title="خصم على الطلب" onClose={() => setSheet(null)}>
        <div className="seg" style={{ marginBottom: 10 }}>
          <button type="button" className={discount.type === "amount" ? "on" : ""} onClick={() => setDiscount({ ...discount, type: "amount" })}>دينار JD</button>
          <button type="button" className={discount.type === "percent" ? "on" : ""} onClick={() => setDiscount({ ...discount, type: "percent" })}>نسبة %</button>
        </div>
        <div className="field">
          <input type="number" inputMode="decimal" min="0" step="0.01" placeholder={discount.type === "percent" ? "مثلًا 10" : "مثلًا 0.50"}
            value={discount.value} onChange={(e) => setDiscount({ ...discount, value: e.target.value })} aria-label="قيمة الخصم" autoFocus />
        </div>
        <div className="field">
          <input placeholder="السبب (اختياري)" value={discount.reason} onChange={(e) => setDiscount({ ...discount, reason: e.target.value })} aria-label="سبب الخصم" />
        </div>
        <div className="sheet-actions">
          <button className="btn-primary" disabled={busy || !(parseFloat(discount.value) > 0)} onClick={submitDiscount}>تطبيق الخصم</button>
          <button className="btn-secondary" onClick={() => setSheet(null)}>رجوع</button>
        </div>
      </Sheet>
    </div>
  );
}

function EditOrderItemsForm({ order, onCancel, onSaved }) {
  const [products, setProducts] = useState([]);
  const [quantities, setQuantities] = useState(() => {
    const initial = {};
    order.items.forEach((it) => { initial[it.product_id] = it.quantity; });
    return initial;
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getProducts().then(setProducts).catch((err) => setError(err.message));
  }, []);

  function changeQty(productId, delta) {
    setQuantities((prev) => {
      const current = prev[productId] || 0;
      const next = Math.max(0, current + delta);
      return { ...prev, [productId]: next };
    });
  }

  const total = products.reduce((sum, p) => sum + (quantities[p.id] || 0) * Number(p.unit_price), 0);
  const hasAnyItem = Object.values(quantities).some((q) => q > 0);

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      const items = Object.entries(quantities)
        .filter(([, qty]) => qty > 0)
        .map(([product_id, quantity]) => ({ product_id: Number(product_id), quantity }));
      await api.updateOrderItems(order.id, items);
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="od">
      <button className="od-back" onClick={onCancel}><FiArrowRight aria-hidden="true" /> رجوع للطلب</button>
      <div className="card">
        <h2 className="title-md">تعديل طلب {order.customer_name}</h2>
        {error && <div className="error-box">{error}</div>}

        <div style={{ marginBottom: 16 }}>
          {products.filter((p) => p.status !== "inactive" || quantities[p.id]).map((p) => (
            <div key={p.id} className="od-qty-row">
              <div>
                <div style={{ fontWeight: 600 }}>{p.name}</div>
                <div className="text-secondary tabular-num">{Number(p.unit_price).toFixed(2)} JD</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <button type="button" className="step-btn" onClick={() => changeQty(p.id, -1)} aria-label="أقل">−</button>
                <span className="tabular-num" style={{ minWidth: 22, textAlign: "center", fontWeight: 800, fontSize: "1.05rem" }}>{quantities[p.id] || 0}</span>
                <button type="button" className="step-btn plus" onClick={() => changeQty(p.id, 1)} aria-label="أكثر">+</button>
              </div>
            </div>
          ))}
        </div>

        <div className="od-newtotal">
          <span className="text-secondary">المجموع الجديد</span>
          <b className="tabular-num">{total.toFixed(2)} JD</b>
        </div>

        <button className="btn-primary" style={{ marginBottom: 10 }} disabled={!hasAnyItem || saving} onClick={handleSave}>
          {saving ? "جاري الحفظ..." : "حفظ"}
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel}>إلغاء</button>
      </div>
    </div>
  );
}
