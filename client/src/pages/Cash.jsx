import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { FiChevronRight, FiChevronLeft, FiEdit2 } from "react-icons/fi";

function getJordanToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Amman",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function shiftDate(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function formatDayLabel(dateStr) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  return d.toLocaleDateString("ar-JO", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
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
  const today = getJordanToday();

  const [data, setData] = useState(null);
  const [history, setHistory] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [selectedDate, setSelectedDate] = useState(today);
  const [dayLoading, setDayLoading] = useState(false);
  const [dayInClosedPeriod, setDayInClosedPeriod] = useState(false);
  const [dayExists, setDayExists] = useState(false);
  const [sales, setSales] = useState("");
  const [expenses, setExpenses] = useState("");
  const [notes, setNotes] = useState("");

  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const formRef = useRef(null);

  async function load() {
    try {
      setData(await api.getCashCurrent());
    } catch (err) {
      setError(err.message);
    }
  }

  async function loadDay(date) {
    setDayLoading(true);
    setError("");
    setSuccess("");
    try {
      const result = await api.getCashEntry(date);
      const entry = result.entry;
      setDayExists(!!entry);
      setDayInClosedPeriod(!!entry?.in_closed_period);
      setSales(entry ? String(Number(entry.sales_amount)) : "");
      setExpenses(entry ? String(Number(entry.expense_amount)) : "");
      setNotes(entry?.notes || "");
    } catch (err) {
      setError(err.message);
    } finally {
      setDayLoading(false);
    }
  }

  useEffect(() => { load(); }, []);
  useEffect(() => { loadDay(selectedDate); }, [selectedDate]);

  function goToDate(date) {
    if (!date) return;
    setSelectedDate(date > today ? today : date);
  }

  function openDayFromTable(date) {
    goToDate(date);
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function handleSave() {
    setError("");
    setSuccess("");

    const salesNum = sales === "" ? 0 : Number(sales);
    const expensesNum = expenses === "" ? 0 : Number(expenses);

    if (selectedDate > today) {
      setError("ما بتقدر تسجّل يوم بالمستقبل.");
      return;
    }
    if (!Number.isFinite(salesNum) || !Number.isFinite(expensesNum)) {
      setError("تأكد إن الأرقام صحيحة.");
      return;
    }
    if (salesNum < 0 || expensesNum < 0) {
      setError("المبيعات والصرفيات ما بتكون بالسالب.");
      return;
    }

    setSaving(true);
    try {
      await api.saveCashEntry({
        entry_date: selectedDate,
        sales_amount: salesNum,
        expense_amount: expensesNum,
        notes: notes.trim(),
      });
      const wasExisting = dayExists;
      await Promise.all([load(), loadDay(selectedDate)]);
      setSuccess(wasExisting ? "تم تعديل اليوم ✓" : "تم حفظ اليوم ✓");
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
      setHistory(null);
      await load();
      loadDay(selectedDate);
    } catch (err) {
      setError(err.message);
    } finally {
      setResetting(false);
    }
  }

  async function toggleHistory() {
    if (!showHistory) {
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

  const isToday = selectedDate === today;
  const navBtnStyle = { flex: "0 0 auto", padding: "8px 12px", display: "flex", alignItems: "center", gap: 4, width: "auto" };

  return (
    <div className="page">
      <h1 className="title-lg">الحساب اليومي</h1>
      {error && <div className="error-box">{error}</div>}

      <div className="card" ref={formRef}>
        <h2 className="title-md">{isToday ? "إدخال اليوم" : "تعديل يوم سابق"}</h2>

        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
          <button className="btn-secondary" style={navBtnStyle} onClick={() => goToDate(shiftDate(selectedDate, -1))}>
            <FiChevronRight /> قبل
          </button>
          <input
            type="date"
            value={selectedDate}
            max={today}
            onChange={(e) => goToDate(e.target.value)}
            style={{ flex: 1, minWidth: 0, textAlign: "center" }}
          />
          <button
            className="btn-secondary"
            style={{ ...navBtnStyle, opacity: isToday ? 0.4 : 1 }}
            disabled={isToday}
            onClick={() => goToDate(shiftDate(selectedDate, 1))}
          >
            بعد <FiChevronLeft />
          </button>
        </div>

        <div className="text-secondary" style={{ fontSize: "0.85rem", marginBottom: 10, display: "flex", justifyContent: "space-between", gap: 8 }}>
          <span>{formatDayLabel(selectedDate)}</span>
          {!isToday && (
            <button
              style={{ background: "none", border: "none", color: "var(--primary, #0094FF)", padding: 0, cursor: "pointer", fontSize: "0.85rem" }}
              onClick={() => goToDate(today)}
            >
              رجوع لليوم
            </button>
          )}
        </div>

        {dayLoading ? (
          <p className="text-secondary">جاري تحميل اليوم...</p>
        ) : (
          <>
            {!dayExists && <p className="text-secondary" style={{ fontSize: "0.85rem", marginTop: 0 }}>هذا اليوم مش مسجّل — عبّي الأرقام واحفظ.</p>}
            {dayInClosedPeriod && (
              <p className="text-secondary" style={{ fontSize: "0.85rem", marginTop: 0 }}>
                هذا اليوم تابع لفترة مُصفَّرة — تعديله بيحدّث أرقامها بالأرشيف.
              </p>
            )}

            <div className="field-row">
              <div className="field">
                <label>المبيعات (JD)</label>
                <input type="number" inputMode="decimal" step="0.01" min="0" value={sales} onChange={(e) => setSales(e.target.value)} placeholder="0" />
              </div>
              <div className="field">
                <label>الصرفيات (JD)</label>
                <input type="number" inputMode="decimal" step="0.01" min="0" value={expenses} onChange={(e) => setExpenses(e.target.value)} placeholder="0" />
              </div>
            </div>

            <div className="field">
              <label>ملاحظة (اختياري)</label>
              <textarea rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="مثلاً: صرفنا على تصليح السيارة" />
            </div>

            {success && <div style={{ color: "var(--success)", fontWeight: 700, marginBottom: 8 }}>{success}</div>}

            <button className="btn-primary" disabled={saving} onClick={handleSave}>
              {saving ? "جاري الحفظ..." : dayExists ? "حفظ التعديل" : "حفظ اليوم"}
            </button>
          </>
        )}
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
        <p className="text-secondary" style={{ fontSize: "0.8rem", marginTop: 0 }}>اضغط على أي يوم لتعديله.</p>
        {data.entries.length === 0 && <p className="text-secondary">لا يوجد إدخالات بعد بهذه الفترة.</p>}
        {[...data.entries].reverse().map((e) => {
          const date = e.entry_date.slice(0, 10);
          const isSelected = date === selectedDate;
          return (
            <div
              key={e.id}
              role="button"
              tabIndex={0}
              onClick={() => openDayFromTable(date)}
              onKeyDown={(ev) => { if (ev.key === "Enter") openDayFromTable(date); }}
              style={{
                padding: "8px 6px",
                borderBottom: "1px solid var(--border)",
                cursor: "pointer",
                borderRadius: 6,
                background: isSelected ? "rgba(0, 148, 255, 0.08)" : "transparent",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <span className="tabular-num" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <FiEdit2 size={13} style={{ opacity: 0.5 }} /> {date}
                </span>
                <span className="tabular-num" style={{ color: "var(--success)" }}>+{Number(e.sales_amount).toFixed(2)}</span>
                <span className="tabular-num" style={{ color: "var(--urgent)" }}>-{Number(e.expense_amount).toFixed(2)}</span>
              </div>
              {e.notes && (
                <div className="text-secondary" style={{ fontSize: "0.8rem", marginTop: 3 }}>{e.notes}</div>
              )}
            </div>
          );
        })}
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
