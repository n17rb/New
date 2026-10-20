import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FiPlus, FiChevronRight, FiChevronLeft, FiZap } from "react-icons/fi";
import { api, request } from "../api.js";
import { readShop } from "../shop.js";
import { usePerms, ViewOnlyNote } from "../auth.jsx";
import EmployeeForm from "../components/EmployeeForm.jsx";

export const ATT = [
  { key: "present", label: "حاضر", short: "ح" },
  { key: "half", label: "نص", short: "½" },
  { key: "absent", label: "غايب", short: "غ" },
  { key: "off", label: "عطلة", short: "ع" },
];

export const money = (n) => `${Number(n || 0).toFixed(2)} JD`;

export function balanceText(b) {
  if (Math.abs(b) < 0.005) return { text: "خالص", color: "var(--text-secondary)" };
  if (b > 0) return { text: `إله ${money(b)}`, color: "var(--success)" };
  return { text: `عليه ${money(-b)}`, color: "var(--urgent)" };
}

function addDays(date, n) {
  return new Date(Date.parse(`${date}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
}

function dayTitle(date, today) {
  if (date === today) return "اليوم";
  if (date === addDays(today, -1)) return "مبارح";
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("ar-JO", { weekday: "long", day: "numeric", month: "long" });
}

export default function Payroll() {
  const navigate = useNavigate();
  const { canEdit } = usePerms();
  const editable = canEdit("payroll");
  const [date, setDate] = useState(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [showLeft, setShowLeft] = useState(false);

  function load(d = date) {
    api.payrollSummary(d).then((r) => { setData(r); if (!date) setDate(r.date); }).catch((err) => setError(err.message));
  }
  useEffect(() => { load(null); }, []);

  async function mark(emp, status) {
    const next = emp.day_status === status ? null : status;
    setData((prev) => ({ ...prev, employees: prev.employees.map((e) => (e.id === emp.id ? { ...e, day_status: next } : e)) }));
    try {
      await api.payrollAttendance({ date, items: [{ employee_id: emp.id, status: next }] });
      load(date);
    } catch (err) {
      setError(err.message);
      load(date);
    }
  }

  async function markAllPresent() {
    const items = data.employees.filter((e) => e.status === "active" && !e.day_status).map((e) => ({ employee_id: e.id, status: "present" }));
    if (!items.length) return;
    try {
      await api.payrollAttendance({ date, items });
      load(date);
    } catch (err) {
      setError(err.message);
    }
  }

  function go(n) {
    const d = addDays(date, n);
    if (d > data.today) return;
    setDate(d);
    load(d);
  }

  if (adding) {
    return <div className="page"><EmployeeForm onCancel={() => setAdding(false)} onSaved={() => { setAdding(false); load(date); }} /></div>;
  }

  const active = data ? data.employees.filter((e) => e.status === "active") : [];
  const left = data ? data.employees.filter((e) => e.status !== "active") : [];

  return (
    <div className="page">
      <h1 className="title-lg">الموظفين والرواتب</h1>
      <ViewOnlyNote section="payroll" />
      {error && <div className="error-box">{error}</div>}

      {data && (
        <div className="today-strip">
          <div className="today-cell" style={{ cursor: "default" }}>
            <div className="today-num tabular-num">{data.totals.present}<span style={{ fontSize: "0.9rem", color: "var(--text-secondary)" }}>/{data.totals.active}</span></div>
            <div className="today-label">داوموا {dayTitle(data.date, data.today)}</div>
          </div>
          <div className="today-cell" style={{ cursor: "default" }}>
            <div className="today-num tabular-num" style={{ fontSize: "1.25rem" }}>{Math.round(data.totals.due)}</div>
            <div className="today-label">مستحقات الكل JD</div>
          </div>
          <div className="today-cell" style={{ cursor: "default" }}>
            <div className="today-num tabular-num" style={{ color: data.totals.unmarked ? "var(--warning)" : undefined }}>{data.totals.unmarked}</div>
            <div className="today-label">لسا ما انسجّل</div>
          </div>
        </div>
      )}

      {data && (
        <div className="date-nav">
          <button className="icon-btn" onClick={() => go(-1)} aria-label="اليوم اللي قبل"><FiChevronRight /></button>
          <div style={{ flex: 1, textAlign: "center", fontWeight: 700 }}>دوام {dayTitle(date, data.today)}</div>
          <button className="icon-btn" onClick={() => go(1)} disabled={date >= data.today} aria-label="اليوم اللي بعد"><FiChevronLeft /></button>
        </div>
      )}

      {readShop()?.plan === "factory" && data && <SocialSecurityCard editable={editable} onDone={() => load(date)} />}

      {editable && data && data.totals.unmarked > 0 && (
        <button className="btn-secondary" style={{ marginBottom: 10 }} onClick={markAllPresent}>سجّل الباقيين حاضرين ({data.totals.unmarked})</button>
      )}

      {data && active.length === 0 && (
        <div className="card text-secondary">ما في موظفين لسا. {editable && "ضيف أول موظف — يومية أو راتب شهري."}</div>
      )}

      {active.length > 0 && (
        <div className="list-group">
          {active.map((e) => {
            const b = balanceText(e.balance);
            return (
              <div key={e.id} className="fc-row">
                <div className="fc-head">
                  <span className="avatar" style={{ width: 40, height: 40 }}>{e.name.trim().charAt(0)}</span>
                  <button onClick={() => navigate(`/payroll/${e.id}`)} style={{ all: "unset", flex: 1, minWidth: 0, cursor: "pointer" }}>
                    <div className="fc-name">{e.name}</div>
                    <div className="fc-sub">
                      {[e.job_title, e.pay_type === "daily" ? `يومية ${e.pay_amount} JD` : `راتب ${e.pay_amount} JD`].filter(Boolean).join(" · ")}
                    </div>
                  </button>
                  <span className="tabular-num" style={{ fontWeight: 800, color: b.color, fontSize: "0.9rem", whiteSpace: "nowrap" }}>{b.text}</span>
                </div>
                {e.auto_present && !e.day_status && (
                  <div className="fc-sub icon-row" style={{ marginTop: 6, color: "var(--primary)" }}><FiZap aria-hidden="true" /> سلّم طلبات {dayTitle(date, data.today)} — غالبًا داوم</div>
                )}
                <div className="att-seg" role="radiogroup" aria-label={`دوام ${e.name}`}>
                  {ATT.map((s) => (
                    <button
                      key={s.key}
                      role="radio"
                      aria-checked={e.day_status === s.key}
                      className={`att-${s.key}${e.day_status === s.key ? " on" : ""}`}
                      disabled={!editable}
                      onClick={() => mark(e, s.key)}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editable && (
        <button className="btn-primary icon-row" style={{ justifyContent: "center" }} onClick={() => setAdding(true)}>
          <FiPlus aria-hidden="true" /> موظف جديد
        </button>
      )}

      {left.length > 0 && (
        <>
          <button className="btn-danger-text" style={{ color: "var(--text-secondary)", marginTop: 14, fontSize: "0.85rem" }} onClick={() => setShowLeft(!showLeft)}>
            {showLeft ? "إخفاء" : "عرض"} اللي تركوا الشغل ({left.length})
          </button>
          {showLeft && (
            <div className="list-group" style={{ opacity: 0.75 }}>
              {left.map((e) => {
                const b = balanceText(e.balance);
                return (
                  <button key={e.id} className="list-row" onClick={() => navigate(`/payroll/${e.id}`)}>
                    <span className="list-text"><span className="list-title">{e.name}</span></span>
                    <span className="tabular-num" style={{ color: b.color, fontWeight: 700 }}>{b.text}</span>
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}


// الضمان الاجتماعي (باقة المصانع): حصة الموظف بتنخصم من راتبه مرة بالشهر بكبسة
function SocialSecurityCard({ editable, onDone }) {
  const [ss, setSs] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () => request("/payroll/social-security").then(setSs).catch(() => {});
  useEffect(() => { load(); }, []);
  if (!ss || ss.employees.length === 0) return null;
  const pending = ss.employees.filter((e) => e.deducted == null);
  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
        <b>الضمان الاجتماعي · {ss.month}</b>
        <span className="tabular-num">{ss.total.toFixed(2)} JD</span>
      </div>
      <div className="text-secondary" style={{ fontSize: "0.85rem", marginTop: 4 }}>
        {ss.employees.length} موظف مشترك · حصة الموظف {ss.rate}% · {pending.length ? `لسا ما انخصم عن ${pending.length}` : "انخصم عن الكل هالشهر"}
      </div>
      {editable && pending.length > 0 && (
        <button className="btn-secondary" style={{ marginTop: 10 }} disabled={busy} onClick={async () => {
          setBusy(true);
          try { await request("/payroll/social-security", { method: "POST", body: { month: ss.month } }); await load(); onDone(); } finally { setBusy(false); }
        }}>اخصم الضمان لهالشهر</button>
      )}
    </div>
  );
}
