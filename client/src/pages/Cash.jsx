import { useEffect, useState } from "react";
import { api } from "../api.js";

export default function Cash() {
  const [data, setData] = useState(null);
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

  const today = new Date().toISOString().slice(0, 10);
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

      <button className="btn-danger-text" disabled={resetting} onClick={handleReset}>
        {resetting ? "جاري التصفير..." : "🔄 تصفير الحساب (بدء فترة جديدة)"}
      </button>
    </div>
  );
}
