import { useEffect, useState } from "react";
import { api } from "../api.js";
import { usePerms, ViewOnlyNote } from "../auth.jsx";
import { BottleTypeBadge, NeedsQuantityBadge } from "../components/BottleType.jsx";
import SchedulePicker from "../components/SchedulePicker.jsx";
import Sheet, { ConfirmSheet } from "../components/Sheet.jsx";
import { scheduleLabel } from "../schedule.js";

const STATUS_LABELS = {
  NEW: "جديد",
  READY: "جاهز",
  IN_ROUTE: "في الطريق",
  DELIVERED: "تم التسليم",
  CANCELLED: "ملغي",
  FAILED: "تعذر التسليم",
  POSTPONED: "مؤجل",
};

const STATUS_COLORS = {
  DELIVERED: "var(--success)",
  CANCELLED: "var(--urgent)",
  IN_ROUTE: "var(--warning)",
  POSTPONED: "#B8862E",
  FAILED: "var(--urgent)",
};

function statusBadgeStyle(status) {
  const color = STATUS_COLORS[status];
  if (!color) return {};
  return { background: color, color: "#fff", borderColor: color };
}

function formatOrderTime(iso) {
  return new Date(iso).toLocaleString("ar-JO", {
    timeZone: "Asia/Amman",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
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
  { key: "", label: "كل الحالات" },
  { key: "NEW", label: "جديد" },
  { key: "IN_ROUTE", label: "بالطريق" },
  { key: "DELIVERED", label: "تسلّم" },
  { key: "POSTPONED", label: "مؤجل" },
  { key: "FAILED", label: "تعذّر" },
  { key: "CANCELLED", label: "ملغي" },
];

export default function Orders({ user }) {
  const [orders, setOrders] = useState([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [period, setPeriod] = useState("today");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState(null);

  async function load() {
    setError("");
    setLoading(true);
    try {
      const params = { limit: 500 };
      if (statusFilter) params.status = statusFilter;
      if (priorityFilter) params.priority = priorityFilter;
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
  }, [statusFilter, priorityFilter, period, search]);

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

  return (
    <div className="page">
      <h1 className="title-lg">الطلبات</h1>
      {error && <div className="error-box">{error}</div>}

      <div className="chips" role="radiogroup" aria-label="الفترة">
        {PERIODS.map((p) => (
          <button key={p.key} className={`chip${period === p.key ? " on" : ""}`} role="radio" aria-checked={period === p.key} onClick={() => setPeriod(p.key)}>
            {p.label}
          </button>
        ))}
      </div>

      <div className="field-row" style={{ marginBottom: 4 }}>
        <div className="field" style={{ flex: 2 }}>
          <input placeholder="اسم، تلفون، أو رقم طلب" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="بحث بالطلبات" />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)} aria-label="الأولوية">
            <option value="">الكل</option>
            <option value="urgent">مستعجل</option>
            <option value="normal">عادي</option>
          </select>
        </div>
      </div>

      <div className="chips" role="radiogroup" aria-label="الحالة">
        {STATUS_CHIPS.map((c) => (
          <button key={c.key || "all"} className={`chip${statusFilter === c.key ? " on" : ""}`} role="radio" aria-checked={statusFilter === c.key} onClick={() => setStatusFilter(c.key)}>
            {c.label}
          </button>
        ))}
      </div>

      <div className="today-strip" style={{ marginBottom: 12 }}>
        <div className="today-cell" style={{ cursor: "default" }}>
          <div className="today-num tabular-num">{orders.length}</div>
          <div className="today-label">طلب</div>
        </div>
        <div className="today-cell" style={{ cursor: "default" }}>
          <div className="today-num tabular-num">{delivered}</div>
          <div className="today-label">تسلّم</div>
        </div>
        <div className="today-cell" style={{ cursor: "default" }}>
          <div className="today-num tabular-num" style={{ fontSize: total >= 1000 ? "1.15rem" : undefined }}>{total.toFixed(0)}</div>
          <div className="today-label">المجموع JD</div>
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        {loading && orders.length === 0 && <p className="text-secondary" style={{ padding: 14 }}>جاري التحميل...</p>}
        {!loading && orders.length === 0 && <p className="text-secondary" style={{ padding: 14 }}>ما في طلبات بهالفترة.</p>}
        {orders.map((o) => (
          <div key={o.id} className="customer-row" style={{ padding: "12px 14px", cursor: "pointer" }} onClick={() => setSelectedId(o.id)}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>
                {o.customer_name}
                {o.priority === "urgent" && <span style={{ color: "var(--urgent)" }}> 🚨</span>}
                {" "}<BottleTypeBadge type={o.bottle_type} />
                {" "}<NeedsQuantityBadge order={o} />
              </div>
              <div className="text-secondary tabular-num">#{o.order_number} · {formatOrderTime(o.created_at)}</div>
              {scheduleLabel(o) && !["DELIVERED", "CANCELLED"].includes(o.status) && (
                <span className="sched-badge" style={{ marginTop: 4 }}>📅 {scheduleLabel(o)}</span>
              )}
            </div>
            <div style={{ textAlign: "left", flexShrink: 0 }}>
              <div className="tabular-num" style={{ fontWeight: 700 }}>{Number(o.final_total).toFixed(2)} JD</div>
              <span className="badge" style={statusBadgeStyle(o.status)}>{STATUS_LABELS[o.status] || o.status}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function OrderDetail({ orderId, user, onBack }) {
  const [order, setOrder] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingItems, setEditingItems] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState(false);
  const [scheduleDraft, setScheduleDraft] = useState(null);
  const [sheet, setSheet] = useState(null); // cancel | postpone | fail | discount
  const [postponeDraft, setPostponeDraft] = useState(null);
  const [postponeReason, setPostponeReason] = useState("");
  const [discount, setDiscount] = useState({ value: "", type: "amount", reason: "" });
  const [notice, setNotice] = useState("");

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

  async function withBusy(fn) {
    setBusy(true);
    setError("");
    try {
      await fn();
      setSheet(null);
      await load();
    } catch (err) {
      setError(err.message);
      setSheet(null);
    } finally {
      setBusy(false);
    }
  }
  function flash(msg) {
    setNotice(msg);
    setTimeout(() => setNotice(""), 4000);
  }

  if (!order) return <p className="text-secondary">جاري التحميل...</p>;

  if (editingItems) {
    return (
      <EditOrderItemsForm
        order={order}
        onCancel={() => setEditingItems(false)}
        onSaved={() => { setEditingItems(false); load(); }}
      />
    );
  }

  const isFinal = ["DELIVERED", "CANCELLED"].includes(order.status);

  function toggleUrgent() {
    withBusy(() => api.setOrderPriority(order.id, order.priority === "urgent" ? "normal" : "urgent"));
  }

  // إلغاء: تأكيد بس — تأجيل/تعذّر/خصم: لوحات بدل نوافذ المتصفح
  function handleCancel() { setSheet("cancel"); }
  function handleFail() { setSheet("fail"); }
  function handlePostpone() {
    setPostponeDraft({ scheduled_date: null, requested_time: null });
    setPostponeReason("");
    setSheet("postpone");
  }
  function submitPostpone() {
    const d = postponeDraft || {};
    const label = d.requested_time || d.scheduled_date ? scheduleLabel(d) : null;
    withBusy(() => api.postponeOrder(order.id, { scheduled_date: d.scheduled_date, requested_time: d.requested_time, reason: postponeReason }))
      .then(() => flash(label ? `⏰ تأجّل لـ ${label}` : "✅ رجع لقائمة التوزيع"));
  }
  function handleDiscount() {
    setDiscount({ value: "", type: "amount", reason: "" });
    setSheet("discount");
  }
  function submitDiscount() {
    const value = parseFloat(discount.value);
    if (!value || value <= 0) return;
    withBusy(() => api.applyDiscount(order.id, { discount_type: discount.type, discount_value: value, reason: discount.reason }));
  }

  return (
    <div className="card">
      <button className="btn-danger-text" style={{ marginBottom: 10 }} onClick={onBack}>← رجوع لقائمة الطلبات</button>

      <h2 className="title-md">
        طلب #{order.order_number}
        {order.priority === "urgent" && <span style={{ color: "var(--urgent)" }}> 🚨 مستعجل</span>}
      </h2>
      <p className="text-secondary tabular-num">{order.customer_name} · {order.customer_phone}</p>
      <BottleTypeBadge type={order.bottle_type} large />
      <p className="text-secondary tabular-num" style={{ marginTop: -6 }}>🕐 {formatOrderTime(order.created_at)}</p>
      <span className="badge" style={{ marginBottom: 12, display: "inline-block", ...statusBadgeStyle(order.status) }}>{STATUS_LABELS[order.status] || order.status}</span>

      {!isFinal && (
        <div className="card" style={{ background: "var(--surface-2)", border: "none", padding: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <span style={{ fontWeight: 700 }}>{scheduleLabel(order) ? `📅 موعده ${scheduleLabel(order)}` : "بدون موعد — بأقرب وقت"}</span>
            {canEditOrders && !editingSchedule && (
              <button className="chip" onClick={() => { setScheduleDraft({ scheduled_date: order.scheduled_date ? String(order.scheduled_date).slice(0, 10) : null, requested_time: order.requested_time }); setEditingSchedule(true); }}>
                {scheduleLabel(order) ? "غيّر الموعد" : "حدّد موعد"}
              </button>
            )}
          </div>
          {editingSchedule && (
            <div style={{ marginTop: 10 }}>
              <SchedulePicker value={scheduleDraft} onChange={setScheduleDraft} />
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button className="btn-primary" disabled={busy} onClick={() => withBusy(async () => { await api.setOrderSchedule(order.id, scheduleDraft); setEditingSchedule(false); })}>حفظ الموعد</button>
                <button className="btn-secondary" style={{ width: "auto", padding: "0 16px" }} onClick={() => setEditingSchedule(false)}>إلغاء</button>
              </div>
            </div>
          )}
        </div>
      )}

      {error && <div className="error-box">{error}</div>}
      {notice && <div className="success-box">{notice}</div>}

      {order.needs_quantity && !isFinal && canEditOrders && (
        <div className="card" style={{ border: "2px solid #E8A020", background: "rgba(232, 160, 32, 0.08)" }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>📅 هذا طلب تلقائي لزبون موعده اليوم — لسا ما انحدد شو بده</div>
          <button className="btn-primary" disabled={busy} onClick={() => setEditingItems(true)}>
            حدد عدد القوارير
          </button>
        </div>
      )}

      <div className="card" style={{ background: "var(--bg)" }}>
        {order.items.length === 0 && <p className="text-secondary" style={{ margin: 0 }}>لا يوجد منتجات بعد.</p>}
        {order.items.map((item) => (
          <div key={item.id} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
            <span>{item.product_name_snapshot} × {item.quantity}</span>
            <span className="tabular-num">{Number(item.line_total).toFixed(2)} JD</span>
          </div>
        ))}
        <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "8px 0" }} />
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span>الإجمالي الفرعي</span>
          <span className="tabular-num">{Number(order.subtotal).toFixed(2)} JD</span>
        </div>
        {order.discount_value > 0 && (
          <div style={{ display: "flex", justifyContent: "space-between", color: "var(--urgent)" }}>
            <span>الخصم</span>
            <span className="tabular-num">
              -{order.discount_type === "percent" ? `${order.discount_value}%` : `${Number(order.discount_value).toFixed(2)} JD`}
            </span>
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: "1.1rem" }}>
          <span>الإجمالي النهائي</span>
          <span className="tabular-num">{Number(order.final_total).toFixed(2)} JD</span>
        </div>
      </div>

      {order.notes && <p className="text-secondary">📝 {order.notes}</p>}

      {!isFinal && canEditOrders && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 16 }}>
          <button className="btn-secondary" disabled={busy} onClick={() => setEditingItems(true)}>
            ✏️ تعديل محتوى الطلب
          </button>
          {order.status === "IN_ROUTE" && (
            <p className="text-secondary" style={{ margin: "-4px 0 0", fontSize: "0.8rem" }}>
              هذا الطلب مع سائق برحلة جارية — أي تعديل هون بينعكس عنده تلقائيًا بأقرب تحديث.
            </p>
          )}

          <button className="btn-secondary" disabled={busy} onClick={toggleUrgent}>
            {order.priority === "urgent" ? "إلغاء المستعجل" : "🚨 تحويل لمستعجل"}
          </button>

          {canDiscount && <button className="btn-secondary" disabled={busy} onClick={handleDiscount}>💸 إعطاء خصم</button>}

          <button className="btn-secondary" disabled={busy} onClick={handlePostpone}>⏰ تأجيل</button>
          <button className="btn-secondary" disabled={busy} onClick={handleFail}>⚠️ تعذر التسليم</button>

          {canCancel && <button className="btn-danger-text" disabled={busy} onClick={handleCancel}>❌ إلغاء الطلب</button>}
        </div>
      )}

      {(order.status === "POSTPONED" || order.status === "FAILED") && canEditOrders && (
        <button className="btn-primary" style={{ marginTop: 10 }} disabled={busy} onClick={() => withBusy(() => api.reactivateOrder(order.id))}>
          إعادة الطلب لقائمة التوزيع
        </button>
      )}

      <ConfirmSheet
        open={sheet === "cancel"}
        title="إلغاء الطلب؟"
        text={`طلب ${order.customer_name} (#${order.order_number}) رح ينلغى${order.status === "IN_ROUTE" ? " وينشال من الرحلة" : ""}.`}
        confirmLabel="نعم، ألغِ الطلب"
        danger
        busy={busy}
        onConfirm={() => withBusy(() => api.cancelOrder(order.id))}
        onClose={() => setSheet(null)}
      />

      <Sheet open={sheet === "postpone"} title="أجّل لإمتى؟" onClose={() => setSheet(null)}>
        <SchedulePicker value={postponeDraft} onChange={setPostponeDraft} />
        <div className="sheet-label">السبب (اختياري)</div>
        <div className="chips" style={{ flexWrap: "wrap" }}>
          {["الزبون طلب", "مش موجود هلّق", "ما في وقت اليوم"].map((r) => (
            <button key={r} type="button" className={`chip${postponeReason === r ? " on" : ""}`} onClick={() => setPostponeReason(postponeReason === r ? "" : r)}>{r}</button>
          ))}
        </div>
        <div className="sheet-actions">
          <button className="btn-primary" disabled={busy} onClick={submitPostpone}>
            {busy ? "لحظة..." : postponeDraft?.scheduled_date ? "تأكيد التأجيل" : "رجّعه لقائمة اليوم"}
          </button>
          <button className="btn-secondary" disabled={busy} onClick={() => setSheet(null)}>رجوع</button>
        </div>
      </Sheet>

      <Sheet open={sheet === "fail"} title="ليش تعذّر التسليم؟" onClose={() => setSheet(null)}>
        <div className="sheet-options">
          {["لا يرد", "مش موجود بالبيت", "العنوان غلط", "مشكلة بالوصول"].map((r) => (
            <button key={r} className="sheet-option" disabled={busy} onClick={() => withBusy(() => api.failDelivery(order.id, r))}>{r}</button>
          ))}
        </div>
        <button className="btn-secondary" style={{ marginTop: 10 }} onClick={() => setSheet(null)}>رجوع</button>
      </Sheet>

      <Sheet open={sheet === "discount"} title="خصم على الطلب" onClose={() => setSheet(null)}>
        <div className="seg" style={{ marginBottom: 10 }}>
          <button type="button" className={discount.type === "amount" ? "on" : ""} onClick={() => setDiscount({ ...discount, type: "amount" })}>دينار JD</button>
          <button type="button" className={discount.type === "percent" ? "on" : ""} onClick={() => setDiscount({ ...discount, type: "percent" })}>نسبة %</button>
        </div>
        <div className="field">
          <input type="number" inputMode="decimal" min="0" step="0.01" placeholder={discount.type === "percent" ? "مثلًا 10" : "مثلًا 0.50"}
            value={discount.value} onChange={(e) => setDiscount({ ...discount, value: e.target.value })} aria-label="قيمة الخصم" />
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
    <div className="card">
      <h2 className="title-md">تعديل طلب #{order.order_number}</h2>
      {error && <div className="error-box">{error}</div>}

      <div style={{ marginBottom: 16 }}>
        {products.map((p) => (
          <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
            <div>
              <div style={{ fontWeight: 600 }}>{p.name}</div>
              <div className="text-secondary tabular-num">{Number(p.unit_price).toFixed(2)} JD</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button type="button" onClick={() => changeQty(p.id, -1)} style={{ width: 36, height: 36, borderRadius: 8, border: "1px solid var(--border)", background: "#fff", fontSize: "1.1rem" }}>−</button>
              <span className="tabular-num" style={{ minWidth: 20, textAlign: "center", fontWeight: 700 }}>{quantities[p.id] || 0}</span>
              <button type="button" onClick={() => changeQty(p.id, 1)} style={{ width: 36, height: 36, borderRadius: 8, border: "none", background: "var(--primary)", color: "#fff", fontSize: "1.1rem" }}>+</button>
            </div>
          </div>
        ))}
      </div>

      <div className="card" style={{ background: "var(--bg)", textAlign: "center", marginBottom: 14 }}>
        <div className="text-secondary">الإجمالي الجديد (قبل أي خصم سابق)</div>
        <div className="tabular-num" style={{ fontSize: "1.6rem", fontWeight: 700 }}>{total.toFixed(2)} JD</div>
      </div>

      <button className="btn-primary" style={{ marginBottom: 10 }} disabled={!hasAnyItem || saving} onClick={handleSave}>
        {saving ? "جاري الحفظ..." : "حفظ التعديلات"}
      </button>
      <button type="button" className="btn-secondary" onClick={onCancel}>إلغاء</button>
    </div>
  );
}
