import { useEffect, useState } from "react";
import { api } from "../api.js";

const GROUP_LABELS = { week: "أسبوعي", month: "شهري", year: "سنوي" };

function formatBucketLabel(bucket, groupBy) {
  const d = new Date(bucket);
  if (groupBy === "year") return d.getFullYear().toString();
  if (groupBy === "month") return d.toLocaleDateString("ar-JO", { year: "numeric", month: "long" });
  return d.toLocaleDateString("ar-JO", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export default function CustomerGrowth() {
  const [groupBy, setGroupBy] = useState("month");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.getCustomerGrowth(groupBy).then(setData).catch((err) => setError(err.message));
  }, [groupBy]);

  return (
    <div className="page">
      <h1 className="title-lg">نمو العملاء</h1>
      <p className="text-secondary" style={{ marginBottom: 14 }}>كم عميل جديد أضفت بكل فترة — قارن الفترات ببعض وشوف هل التوسع فعليًا بيزيد.</p>
      {error && <div className="error-box">{error}</div>}

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {Object.entries(GROUP_LABELS).map(([key, label]) => (
          <button
            key={key}
            className={groupBy === key ? "btn-primary" : "btn-secondary"}
            style={{ flex: 1, padding: "10px 4px", fontSize: "0.85rem" }}
            onClick={() => setGroupBy(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {!data && <p className="text-secondary">جاري التحميل...</p>}

      {data && (
        <>
          <div className="card">
            <div className="text-secondary">آخر فترة</div>
            <div className="tabular-num" style={{ fontSize: "1.8rem", fontWeight: 700, color: "var(--primary)" }}>
              {data.latest_count} عميل جديد
            </div>
            {data.difference != null && (
              <div style={{ color: data.difference >= 0 ? "var(--success)" : "var(--urgent)", fontWeight: 600 }}>
                {data.difference >= 0 ? "📈 زيادة" : "📉 نقصان"} {Math.abs(data.difference)} عن الفترة السابقة ({data.previous_count})
              </div>
            )}
          </div>

          <div className="card">
            <h2 className="title-md">كل الفترات</h2>
            {[...data.rows].reverse().map((r, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                <span className="text-secondary">{formatBucketLabel(r.bucket, groupBy)}</span>
                <span className="tabular-num" style={{ fontWeight: 700 }}>{r.new_customers} عميل</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
