import { useEffect, useState } from "react";
import { api } from "../api.js";

const PERIODS = [
  { key: "day", label: "يومي" },
  { key: "week", label: "أسبوعي" },
  { key: "month", label: "شهري" },
  { key: "year", label: "سنوي" },
];

export default function Reports() {
  const [period, setPeriod] = useState("day");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  async function load() {
    setError("");
    try {
      setData(await api.getReportsSummary(period));
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => { load(); }, [period]);

  return (
    <div className="page">
      <h1 className="title-lg">التقارير</h1>
      {error && <div className="error-box">{error}</div>}

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {PERIODS.map((p) => (
          <button
            key={p.key}
            className={period === p.key ? "btn-primary" : "btn-secondary"}
            style={{ flex: 1, padding: "10px 4px", fontSize: "0.85rem" }}
            onClick={() => setPeriod(p.key)}
          >
            {p.label}
          </button>
        ))}
      </div>

      {!data ? (
        <p className="text-secondary">جاري التحميل...</p>
      ) : (
        <>
          <div className="card">
            <div className="text-secondary">إجمالي المبيعات (الطلبات المسلَّمة)</div>
            <div className="tabular-num" style={{ fontSize: "1.8rem", fontWeight: 700, color: "var(--primary)" }}>
              {data.total_sales.toFixed(2)} JD
            </div>
          </div>

          <div className="card">
            <StatRow label="عدد الطلبات" value={data.total_orders} />
            <StatRow label="تم التسليم" value={data.delivered} color="var(--success)" />
            <StatRow label="ملغاة" value={data.cancelled} color="var(--urgent)" />
            <StatRow label="تعذر تسليمها" value={data.failed} color="var(--warning)" />
            <StatRow label="مستعجلة" value={data.urgent} />
            <StatRow label="إجمالي الخصومات" value={`${data.total_discounts.toFixed(2)} JD`} last />
          </div>

          <div className="card">
            <div className="text-secondary" style={{ marginBottom: 4 }}>طلبات بانتظار التوزيع الآن (بغض النظر عن الفترة)</div>
            <div className="tabular-num" style={{ fontSize: "1.3rem", fontWeight: 700 }}>{data.pending_now}</div>
          </div>

          <div className="card">
            <h2 className="title-md">جرد المنتجات الموزَّعة (المسلَّمة بهذه الفترة)</h2>
            {data.products.length === 0 && <p className="text-secondary">لا يوجد بيانات بهذه الفترة.</p>}
            {data.products.map((p, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                <span>{p.product_name_snapshot}</span>
                <div style={{ textAlign: "left" }}>
                  <div className="tabular-num" style={{ fontWeight: 700 }}>{p.total_quantity}</div>
                  <div className="text-secondary tabular-num" style={{ fontSize: "0.75rem" }}>{Number(p.total_value).toFixed(2)} JD</div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function StatRow({ label, value, color, last }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", padding: "8px 0",
      borderBottom: last ? "none" : "1px solid var(--border)",
    }}>
      <span>{label}</span>
      <span className="tabular-num" style={{ fontWeight: 700, color: color || "inherit" }}>{value}</span>
    </div>
  );
}
