import { useEffect, useState } from "react";
import { api } from "../api.js";

export default function DriverBalances() {
  const [drivers, setDrivers] = useState([]);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);

  async function load() {
    setError("");
    try {
      setDrivers(await api.getDriverBalances());
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => { load(); }, []);

  if (selected) {
    return (
      <div className="page">
        <DriverDetail driverId={selected.id} name={selected.full_name} onBack={() => { setSelected(null); load(); }} />
      </div>
    );
  }

  return (
    <div className="page">
      <h1 className="title-lg">أرصدة السائقين</h1>
      {error && <div className="error-box">{error}</div>}

      <div className="card" style={{ padding: 0 }}>
        {drivers.length === 0 && <p className="text-secondary" style={{ padding: 14 }}>لا يوجد سائقين بعد.</p>}
        {drivers.map((d) => (
          <div key={d.id} className="customer-row" style={{ padding: "12px 14px", cursor: "pointer" }} onClick={() => setSelected(d)}>
            <div style={{ fontWeight: 600 }}>{d.full_name}</div>
            <div style={{ textAlign: "left" }}>
              <div className="tabular-num" style={{ fontWeight: 700, color: d.balance > 0 ? "var(--urgent)" : "var(--success)" }}>
                {d.balance.toFixed(2)} JD
              </div>
              {d.coupon_balance !== 0 && (
                <div className="text-secondary tabular-num" style={{ fontSize: "0.8rem" }}>🎫 {d.coupon_balance}</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DriverDetail({ driverId, name, onBack }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [amount, setAmount] = useState("");
  const [coupons, setCoupons] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      setData(await api.getDriverBalance(driverId));
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => { load(); }, [driverId]);

  async function handleSettle() {
    const amt = Number(amount) || 0;
    const cpn = Number(coupons) || 0;
    if (amt <= 0 && cpn <= 0) {
      setError("أدخل قيمة كاش أو عدد كوبونات على الأقل.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await api.settleDriver(driverId, { amount: amt, coupons: cpn, notes });
      setAmount("");
      setCoupons("");
      setNotes("");
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (!data) return <p className="text-secondary">جاري التحميل...</p>;

  return (
    <div>
      <button className="btn-danger-text" style={{ marginBottom: 10 }} onClick={onBack}>← رجوع للأرصدة</button>

      <div className="card">
        <h2 className="title-md">{name}</h2>
        <div className="text-secondary">الكاش المستحق</div>
        <div className="tabular-num" style={{ fontSize: "1.8rem", fontWeight: 700, color: data.balance > 0 ? "var(--urgent)" : "var(--success)" }}>
          {data.balance.toFixed(2)} JD
        </div>
        <div className="text-secondary" style={{ marginTop: 10 }}>الكوبونات المستحق تسليمها</div>
        <div className="tabular-num" style={{ fontSize: "1.5rem", fontWeight: 700 }}>
          🎫 {data.coupon_balance}
        </div>
      </div>

      {error && <div className="error-box">{error}</div>}

      <div className="card">
        <h2 className="title-md">جرد / تسوية</h2>
        <p className="text-secondary" style={{ marginBottom: 10 }}>مثال: باع اليوم ٢٠ دينار كاش وجمع ١٠ كوبونات — اكتبهم مع بعض هون.</p>
        <div className="field-row">
          <div className="field">
            <label>الكاش المستلم (JD)</label>
            <input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="field">
            <label>عدد الكوبونات المستلمة</label>
            <input type="number" value={coupons} onChange={(e) => setCoupons(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label>ملاحظة (اختياري)</label>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <button className="btn-primary" disabled={saving} onClick={handleSettle}>
          {saving ? "جاري الحفظ..." : "تسجيل الجرد"}
        </button>
      </div>

      <div className="card">
        <h2 className="title-md">سجل الحساب (آخر 50 حركة)</h2>
        {data.history.length === 0 && <p className="text-secondary">لا يوجد حركات بعد.</p>}
        {data.history.map((h) => (
          <div key={h.id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
            <div>
              <div>{h.entry_type === "trip_due" ? "مستحق رحلة" : "تسوية"}</div>
              {h.notes && <div className="text-secondary" style={{ fontSize: "0.8rem" }}>{h.notes}</div>}
            </div>
            <div style={{ textAlign: "left" }}>
              <div className="tabular-num" style={{ fontWeight: 700, color: h.entry_type === "trip_due" ? "var(--urgent)" : "var(--success)" }}>
                {h.entry_type === "trip_due" ? "+" : "-"}{Number(h.amount).toFixed(2)} JD
              </div>
              {h.coupons_redeemed > 0 && (
                <div className="text-secondary tabular-num" style={{ fontSize: "0.8rem" }}>
                  {h.entry_type === "trip_due" ? "+" : "-"}{h.coupons_redeemed} 🎫
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
