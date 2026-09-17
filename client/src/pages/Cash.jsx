import { useEffect, useState } from "react";
import { api } from "../api.js";

function getJordanToday() {
  const now = new Date();
  const jordanString = now.toLocaleString("en-US", { timeZone: "Asia/Amman" });
  const jordanDate = new Date(jordanString);
  const year = jordanDate.getFullYear();
  const month = String(jordanDate.getMonth() + 1).padStart(2, "0");
  const day = String(jordanDate.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const GROUP_LABELS = { day: "يومي", week: "أسبوعي", month: "شهري", year: "سنوي" };
const TREND_LABELS = {
  up: { text: "📈 تصاعدي — الشغل بيزيد", color: "var(--success)" },
  down: { text: "📉 تنازلي — الشغل بينقص", color: "var(--urgent)" },
  flat: { text: "➖ مستقر — بدون تغيّر واضح", color: "var(--text-secondary)" },
};

function formatBucketLabel(bucket, groupBy) {
  const d = new Date(bucket);
  if (groupBy === "year") return d.getFullYear().toString();
  if (groupBy === "month") return d.toLocaleDateString("ar-JO", { year: "numeric", month: "long" });
  return d.toLocaleDateString("ar-JO", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function TrendSection() {
  const [groupBy, setGroupBy] = useState("month");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const params = { groupBy };
    if (fromDate) params.from = fromDate;
    if (toDate) params.to = toDate;
    api.getCashTrend(params).then(setData).catch((err) => setError(err.message));
  }, [groupBy, fromDate, toDate]);

  const width = 320;
  const height = 110;
  const padding = 10;

  let pathD = "";
  let points = [];
  if (data && data.rows.length > 0) {
    const values = data.rows.map((r) => r.net);
    const min = Math.min(...values, 0);
    const max = Math.max(...values, 0);
    const range = max - min || 1;
    points = data.rows.map((r, i) => {
      const x = data.rows.length === 1 ? width / 2 : padding + (i / (data.rows.length - 1)) * (width - padding * 2);
      const y = height - padding - ((r.net - min) / range) * (height - padding * 2);
      return { x, y, net: r.net, bucket: r.bucket };
    });
    pathD = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  }

  return (
    <div className="card">
      <h2 className="title-md">اتجاه الشغل عبر الوقت</h2>
      {error && <div className="error-box">{error}</div>}

      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        {Object.entries(GROUP_LABELS).map(([key, label]) => (
          <button
            key={key}
            className={groupBy === key ? "btn-primary" : "btn-secondary"}
            style={{ flex: 1, padding: "8px 4px", fontSize: "0.85rem" }}
            onClick={() => setGroupBy(key)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="field-row" style={{ marginBottom: 14 }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>من تاريخ (اختياري)</label>
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>إلى تاريخ (اختياري)</label>
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </div>
      </div>

      {!data && <p className="text-secondary">جاري التحميل...</p>}

      {data && data.rows.length === 0 && (
        <p className="text-secondary">ما فيه بيانات كافية بعد لعرض اتجاه — سجّل بضعة أيام وارجع تشيك.</p>
      )}

      {data && data.rows.length > 0 && (
        <>
          <div style={{ fontWeight: 700, color: TREND_LABELS[data.trend].color, marginBottom: 14 }}>
            {TREND_LABELS[data.trend].text}
          </div>

          <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: 130, marginBottom: 10 }}>
            <line x1={0} y1={height / 2} x2={width} y2={height / 2} stroke="var(--border)" strokeWidth="1" />
            <path d={pathD} fill="none" stroke={data.trend === "down" ? "var(--urgent)" : "var(--success)"} strokeWidth="2.5" />
            {points.map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r="3" fill={data.trend === "down" ? "var(--urgent)" : "var(--success)"} />
            ))}
          </svg>

          <div style={{ maxHeight: 220, overflowY: "auto" }}>
            {[...data.rows].reverse().map((r, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid var(--border)", fontSize: "0.85rem" }}>
                <span className="text-secondary">{formatBucketLabel(r.bucket, groupBy)}</span>
                <span className="tabular-num" style={{ fontWeight: 700, color: r.net >= 0 ? "var(--success)" : "var(--urgent)" }}>
                  {r.net >= 0 ? "+" : ""}{r.net.toFixed(2)} JD
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function Cash() {
  const [data, setData] = useState(null);
  const [history, setHistory] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const [error, setError] = useState("");
  const [sales, setSales] = useState("");
  const [expenses, setExpenses] = useState("");
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);

  async function load() {
    setError("");
    try {
      setData(await api.getCashCurrent());
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => { load(); }, []);

  const today = getJordanToday();
  const todayEntry = data?.entries.find((e) => e.entry_date.slice(0, 10) === today);

  useEffect(() => {
    if (todayEntry) {
      setSales(todayEntry.sales_amount);
      setExpenses(todayEntry.expense_amount);
    }
  }, [data]);

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      await api.saveCashEntry({
        entry_date: today,
        sales_amount: parseFloat(sales) || 0,
        expense_amount: parseFloat(expenses) || 0,
      });
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    if (!data) return;
    const confirmed = confirm(
      `تصفير الحساب الحالي؟\n\nإجمالي المبيعات: ${data.total_sales.toFixed(2)} JD\nإجمالي الصرفيات: ${data.total_expenses.toFixed(2)} JD\nالكاش المتوقع: ${data.expected_cash.toFixed(2)} JD\n\nهذا الإجراء يبدأ حساب جديد من الصفر — الأرقام القديمة تُحفظ بالسجل ولا تُحذف.`
    );
    if (!confirmed) return;

    setResetting(true);
    setError("");
    try {
      await api.resetCashPeriod();
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setResetting(false);
    }
  }

  async function toggleHistory() {
    if (!showHistory && !history) {
      try {
        setHistory(await api.getCashHistory());
      } catch (err) {
        setError(err.message);
        return;
      }
    }
    setShowHistory(!showHistory);
  }

  if (!data) return <div className="page"><p className="text-secondary">جاري التحميل...</p></div>;

  return (
    <div className="page">
      <h1 className="title-lg">الحساب اليومي</h1>
      {error && <div className="error-box">{error}</div>}

      <div className="card">
        <h2 className="title-md">إدخال اليوم ({today})</h2>
        <div className="field-row">
          <div className="field">
            <label>المبيعات (JD)</label>
            <input type="number" step="0.01" value={sales} onChange={(e) => setSales(e.target.value)} />
          </div>
          <div className="field">
            <label>الصرفيات (JD)</label>
            <input type="number" step="0.01" value={expenses} onChange={(e) => setExpenses(e.target.value)} />
          </div>
        </div>
        <button className="btn-primary" disabled={saving} onClick={handleSave}>
          {saving ? "جاري الحفظ..." : "حفظ إدخال اليوم"}
        </button>
      </div>

      <div className="card">
        <h2 className="title-md">المجموع منذ آخر تصفير</h2>
        <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
          <span>إجمالي المبيعات</span>
          <span className="tabular-num" style={{ fontWeight: 700, color: "var(--success)" }}>{data.total_sales.toFixed(2)} JD</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
          <span>إجمالي الصرفيات</span>
          <span className="tabular-num" style={{ fontWeight: 700, color: "var(--urgent)" }}>{data.total_expenses.toFixed(2)} JD</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0" }}>
          <span style={{ fontWeight: 700 }}>الكاش المتوقع بالدرج</span>
          <span className="tabular-num" style={{ fontWeight: 700, fontSize: "1.2rem" }}>{data.expected_cash.toFixed(2)} JD</span>
        </div>
      </div>

      <div className="card">
        <h2 className="title-md">جدول الأيام</h2>
        {data.entries.length === 0 && <p className="text-secondary">لا يوجد إدخالات بعد بهذه الفترة.</p>}
        {[...data.entries].reverse().map((e) => (
          <div key={e.id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
            <span className="tabular-num">{e.entry_date.slice(0, 10)}</span>
            <span className="tabular-num" style={{ color: "var(--success)" }}>+{Number(e.sales_amount).toFixed(2)}</span>
            <span className="tabular-num" style={{ color: "var(--urgent)" }}>-{Number(e.expense_amount).toFixed(2)}</span>
          </div>
        ))}
      </div>

      <TrendSection />

      <button className="btn-danger-text" disabled={resetting} onClick={handleReset}>
        {resetting ? "جاري التصفير..." : "🔄 تصفير الحساب (بدء فترة جديدة)"}
      </button>

      <button className="btn-secondary" style={{ marginTop: 10 }} onClick={toggleHistory}>
        {showHistory ? "إخفاء الأرشيف" : "📁 أرشيف الفترات المُصفَّرة سابقًا"}
      </button>

      {showHistory && history && (
        <div className="card">
          {history.length === 0 && <p className="text-secondary">لا يوجد فترات مُصفَّرة بعد.</p>}
          {history.map((p) => (
            <div key={p.id} style={{ padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
              <div className="text-secondary tabular-num" style={{ fontSize: "0.8rem" }}>
                {new Date(p.started_at).toLocaleDateString("ar-JO")} — {new Date(p.ended_at).toLocaleDateString("ar-JO")}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span className="tabular-num" style={{ color: "var(--success)" }}>مبيعات: {Number(p.final_sales).toFixed(2)}</span>
                <span className="tabular-num" style={{ color: "var(--urgent)" }}>صرفيات: {Number(p.final_expenses).toFixed(2)}</span>
                <span className="tabular-num" style={{ fontWeight: 700 }}>كاش: {Number(p.final_cash).toFixed(2)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
