import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api.js";

export default function OverdueCustomers() {
  const [customers, setCustomers] = useState(null);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    api.getOverdueCustomers().then(setCustomers).catch((err) => setError(err.message));
  }, []);

  return (
    <div className="page">
      <h1 className="title-lg">عملاء متأخرين عن معدلهم</h1>
      <p className="text-secondary" style={{ marginBottom: 16 }}>
        بناءً على تاريخ كل عميل الحقيقي (٣ طلبات مسلَّمة على الأقل) — بيّن مين تجاوز معدله العادي بدون طلب جديد.
      </p>
      {error && <div className="error-box">{error}</div>}

      <div className="card" style={{ padding: 0 }}>
        {!customers && <p className="text-secondary" style={{ padding: 14 }}>جاري التحميل...</p>}
        {customers && customers.length === 0 && <p className="text-secondary" style={{ padding: 14 }}>لا يوجد عملاء متأخرين حاليًا 🎉</p>}
        {customers && customers.map((c) => (
          <div key={c.id} className="customer-row" style={{ padding: "12px 14px", cursor: "pointer" }} onClick={() => navigate(`/customers/${c.id}`)}>
            <div>
              <div style={{ fontWeight: 600 }}>{c.name}</div>
              <div className="text-secondary tabular-num">{c.phone_display} · معدله كل {c.avg_days.toFixed(1)} يوم</div>
            </div>
            <span className="badge" style={{ background: "var(--urgent)", color: "#fff", borderColor: "var(--urgent)" }}>
              متأخر {c.days_since_last_order} يوم
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
