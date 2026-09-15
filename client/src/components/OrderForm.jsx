import { useEffect, useState } from "react";
import { api } from "../api.js";

export default function OrderForm({ customer, user, onClose, onCreated }) {
  const [products, setProducts] = useState([]);
  const [quantities, setQuantities] = useState({});
  const [priority, setPriority] = useState("normal");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(null);
  const [loading, setLoading] = useState(false);
  const [lastOrder, setLastOrder] = useState(null);

  useEffect(() => {
    api.getProducts().then(setProducts).catch((err) => setError(err.message));
    api.getOrders({ customer_id: customer.id, limit: 1 })
      .then((orders) => { if (orders[0]) setLastOrder(orders[0]); })
      .catch(() => {});
  }, [customer.id]);

  function changeQty(productId, delta) {
    setQuantities((prev) => {
      const current = prev[productId] || 0;
      const next = Math.max(0, current + delta);
      return { ...prev, [productId]: next };
    });
  }

  async function repeatLastOrder() {
    if (!lastOrder) return;
    try {
      const full = await api.getOrder(lastOrder.id);
      const next = {};
      for (const item of full.items) next[item.product_id] = item.quantity;
      setQuantities(next);
    } catch (err) {
      setError(err.message);
    }
  }

  const total = products.reduce((sum, p) => sum + (quantities[p.id] || 0) * Number(p.unit_price), 0);
  const hasAnyItem = Object.values(quantities).some((q) => q > 0);

  async function handleSubmit() {
    setError("");
    setLoading(true);
    try {
      const items = Object.entries(quantities)
        .filter(([, qty]) => qty > 0)
        .map(([product_id, quantity]) => ({ product_id: Number(product_id), quantity }));

      const order = await api.createOrder({
        customer_id: customer.id,
        items,
        priority,
        notes: notes || undefined,
      });
      setSuccess(order);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div className="card">
        <div className="success-box">تم إرسال الطلب بنجاح — رقم الطلب #{success.order_number}</div>
        <p className="tabular-num" style={{ fontWeight: 700, fontSize: "1.2rem" }}>
          الإجمالي: {Number(success.final_total).toFixed(2)} JD
        </p>
        {user?.role === "driver" && (
          <AddToActiveTripButton orderId={success.id} onDone={onCreated} />
        )}
        <button className="btn-primary" onClick={onCreated}>تم</button>
      </div>
    );
  }

  return (
    <div className="card">
      <h2 className="title-md">طلب جديد — {customer.name}</h2>
      {error && <div className="error-box">{error}</div>}

      {lastOrder && (
        <button type="button" className="btn-secondary" style={{ marginBottom: 14 }} onClick={repeatLastOrder}>
          🔁 تكرار آخر طلب
        </button>
      )}

      <div style={{ marginBottom: 16 }}>
        {products.map((p) => (
          <div
            key={p.id}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "10px 0",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <div>
              <div style={{ fontWeight: 600 }}>{p.name}</div>
              <div className="text-secondary tabular-num">{Number(p.unit_price).toFixed(2)} JD</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button
                type="button"
                onClick={() => changeQty(p.id, -1)}
                style={{ width: 36, height: 36, borderRadius: 8, border: "1px solid var(--border)", background: "#fff", fontSize: "1.1rem" }}
              >
                −
              </button>
              <span className="tabular-num" style={{ minWidth: 20, textAlign: "center", fontWeight: 700 }}>
                {quantities[p.id] || 0}
              </span>
              <button
                type="button"
                onClick={() => changeQty(p.id, 1)}
                style={{ width: 36, height: 36, borderRadius: 8, border: "none", background: "var(--primary)", color: "#fff", fontSize: "1.1rem" }}
              >
                +
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="field">
        <label>الأولوية</label>
        <div style={{ display: "flex", gap: 10 }}>
          <button
            type="button"
            className={priority === "normal" ? "btn-primary" : "btn-secondary"}
            style={{ flex: 1 }}
            onClick={() => setPriority("normal")}
          >
            عادي
          </button>
          <button
            type="button"
            className="btn-secondary"
            style={{
              flex: 1,
              background: priority === "urgent" ? "var(--urgent)" : undefined,
              borderColor: "var(--urgent)",
              color: priority === "urgent" ? "#fff" : "var(--urgent)",
            }}
            onClick={() => setPriority("urgent")}
          >
            🚨 مستعجل
          </button>
        </div>
      </div>

      <div className="field">
        <label>ملاحظة (اختياري)</label>
        <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="مثال: اتصل قبل الوصول" />
      </div>

      <div className="card" style={{ background: "var(--bg)", textAlign: "center", marginBottom: 14 }}>
        <div className="text-secondary">الإجمالي</div>
        <div className="tabular-num" style={{ fontSize: "1.6rem", fontWeight: 700 }}>
          {total.toFixed(2)} JD
        </div>
      </div>

      <button className="btn-primary" style={{ marginBottom: 10 }} disabled={!hasAnyItem || loading} onClick={handleSubmit}>
        {loading ? "جاري الإرسال..." : "إرسال الطلب"}
      </button>
      <button type="button" className="btn-secondary" onClick={onClose}>إلغاء</button>
    </div>
  );
}

function AddToActiveTripButton({ orderId, onDone }) {
  const [trip, setTrip] = useState(undefined);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const [added, setAdded] = useState(false);

  useEffect(() => {
    api.getMyTrip().then(setTrip).catch(() => setTrip(null));
  }, []);

  async function handleAdd() {
    setAdding(true);
    setError("");
    try {
      await api.addOrderToTrip(trip.id, orderId);
      setAdded(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setAdding(false);
    }
  }

  if (trip === undefined) return null;
  if (!trip || trip.status !== "STARTED" || !trip.can_operate) return null;

  if (added) {
    return <div className="success-box">تمت إضافة الطلب لرحلتك الجارية بأفضل موضع ممكن.</div>;
  }

  return (
    <div style={{ marginBottom: 10 }}>
      {error && <div className="error-box">{error}</div>}
      <button className="btn-secondary" disabled={adding} onClick={handleAdd}>
        {adding ? "جاري الإضافة..." : "🚚 أضف هذا الطلب لرحلتي الجارية الآن"}
      </button>
    </div>
  );
}
