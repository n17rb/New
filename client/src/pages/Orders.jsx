import { useEffect, useState } from "react";
import { api } from "../api.js";

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

export default function Orders({ user }) {
  const [orders, setOrders] = useState([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState(null);

  async function load() {
    setError("");
    try {
      const params = {};
      if (statusFilter) params.status = statusFilter;
      if (priorityFilter) params.priority = priorityFilter;
      setOrders(await api.getOrders(params));
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => { load(); }, [statusFilter, priorityFilter]);

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

  return (
    <div className="page">
      <h1 className="title-lg">الطلبات</h1>
      {error && <div className="error-box">{error}</div>}

      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ flex: 1, padding: 10, borderRadius: 8, border: "1px solid var(--border)" }}>
          <option value="">كل الحالات</option>
          {Object.entries(STATUS_LABELS).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
        <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)} style={{ flex: 1, padding: 10, borderRadius: 8, border: "1px solid var(--border)" }}>
          <option value="">كل الأولويات</option>
          <option value="urgent">🚨 مستعجل فقط</option>
          <option value="normal">عادي فقط</option>
        </select>
      </div>

      <div className="card" style={{ padding: 0 }}>
        {orders.length === 0 && <p className="text-secondary" style={{ padding: 14 }}>لا يوجد طلبات مطابقة.</p>}
        {orders.map((o) => (
          <div key={o.id} className="customer-row" style={{ padding: "12px 14px", cursor: "pointer" }} onClick={() => setSelectedId(o.id)}>
            <div>
              <div style={{ fontWeight: 600 }}>
                #{o.order_number} · {o.customer_name}
                {o.priority === "urgent" && <span style={{ color: "var(--urgent)" }}> 🚨</span>}
              </div>
              <div className="text-secondary tabular-num">{o.customer_phone} · {formatOrderTime(o.created_at)}</div>
            </div>
            <div style={{ textAlign: "left" }}>
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

  const isPrivileged = user.role === "super_admin" || user.role === "admin";
  const canDiscount = isPrivileged || user.can_discount;
  const canCancel = isPrivileged || user.can_cancel_order;

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
      await load();
    } catch (err) {
      setError(err.message);
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
        onSaved={() => { setEditingItems(false); load(); }}
      />
    );
  }

  const isFinal = ["DELIVERED", "CANCELLED"].includes(order.status);

  function toggleUrgent() {
    withBusy(() => api.setOrderPriority(order.id, order.priority === "urgent" ? "normal" : "urgent"));
  }

  function handleCancel() {
    const reason = prompt("سبب الإلغاء؟ (العميل غير موجود / طلب الإلغاء / عنوان غير صحيح / آخر)");
    if (reason === null) return;
    withBusy(() => api.cancelOrder(order.id, reason));
  }

  function handleFail() {
    const reason = prompt("سبب تعذر التسليم؟ (لا يرد / غير موجود / مشكلة وصول / آخر)");
    if (reason === null) return;
    withBusy(() => api.failDelivery(order.id, reason));
  }

  function handlePostpone() {
    const reason = prompt("سبب التأجيل؟ (مثال: مو موجود، طلب وقت تاني)");
    if (reason === null) return;
    const when = prompt("أجّل لأي وقت؟ (مثال: 2026-09-15T14:00)");
    if (!when) return;
    withBusy(() => api.postponeOrder(order.id, when, reason));
  }

  function handleDiscount() {
    const value = prompt("قيمة الخصم؟ (رقم فقط)");
    if (!value) return;
    const isPercent = confirm("هل هذا خصم بالنسبة % ؟ (إلغاء = خصم بقيمة JD)");
    const reason = prompt("سبب الخصم (اختياري)") || "";
    withBusy(() => api.applyDiscount(order.id, {
      discount_type: isPercent ? "percent" : "amount",
      discount_value: parseFloat(value),
      reason,
    }));
  }

  return (
    <div className="card">
      <button className="btn-danger-text" style={{ marginBottom: 10 }} onClick={onBack}>← رجوع لقائمة الطلبات</button>

      <h2 className="title-md">
        طلب #{order.order_number}
        {order.priority === "urgent" && <span style={{ color: "var(--urgent)" }}> 🚨 مستعجل</span>}
      </h2>
      <p className="text-secondary tabular-num">{order.customer_name} · {order.customer_phone}</p>
      <p className="text-secondary tabular-num" style={{ marginTop: -6 }}>🕐 {formatOrderTime(order.created_at)}</p>
      <span className="badge" style={{ marginBottom: 12, display: "inline-block", ...statusBadgeStyle(order.status) }}>{STATUS_LABELS[order.status] || order.status}</span>

      {error && <div className="error-box">{error}</div>}

      <div className="card" style={{ background: "var(--bg)" }}>
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

      {!isFinal && (
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

      {(order.status === "POSTPONED" || order.status === "FAILED") && (
        <button className="btn-primary" style={{ marginTop: 10 }} disabled={busy} onClick={() => withBusy(() => api.reactivateOrder(order.id))}>
          إعادة الطلب لقائمة التوزيع
        </button>
      )}
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
