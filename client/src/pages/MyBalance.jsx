import { useEffect, useState } from "react";
import { api } from "../api.js";

export default function MyBalance({ user }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  async function load() {
    setError("");
    try {
      setData(await api.getDriverBalance(user.id));
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => { load(); }, []);

  if (error) return <div className="page"><div className="error-box">{error}</div></div>;
  if (!data) return <div className="page"><p className="text-secondary">جاري التحميل...</p></div>;

  return (
    <div className="page">
      <h1 className="title-lg">رصيدي</h1>

      <div className="card">
        <div className="text-secondary">المبلغ المستحق عليك تسليمه للمحل</div>
        <div className="tabular-num" style={{ fontSize: "1.8rem", fontWeight: 700, color: data.balance > 0 ? "var(--urgent)" : "var(--success)" }}>
          {data.balance.toFixed(2)} JD
        </div>
      </div>

      <div className="card">
        <h2 className="title-md">سجل الحساب (آخر 50 حركة)</h2>
        {data.history.length === 0 && <p className="text-secondary">لا يوجد حركات بعد.</p>}
        {data.history.map((h) => (
          <div key={h.id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
            <div>
              <div>{h.entry_type === "trip_due" ? "مستحق رحلة" : "تسليم مبلغ للمحل"}</div>
              {h.notes && <div className="text-secondary" style={{ fontSize: "0.8rem" }}>{h.notes}</div>}
            </div>
            <span className="tabular-num" style={{ fontWeight: 700, color: h.entry_type === "trip_due" ? "var(--urgent)" : "var(--success)" }}>
              {h.entry_type === "trip_due" ? "+" : "-"}{Number(h.amount).toFixed(2)} JD
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
