import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { FiArrowRight, FiEdit2, FiChevronRight, FiChevronLeft, FiTrash2 } from "react-icons/fi";
import { FaWhatsapp } from "react-icons/fa";
import { api } from "../api.js";
import { usePerms } from "../auth.jsx";
import { shopName, whatsappNumber } from "../shop.js";
import EmployeeForm from "../components/EmployeeForm.jsx";
import { money, balanceText } from "./Payroll.jsx";

const KINDS = {
  advance: { label: "سحب / سلفة", short: "سحب", sign: -1 },
  bonus: { label: "مكافأة", short: "مكافأة", sign: 1 },
  deduction: { label: "خصم", short: "خصم", sign: -1 },
  payment: { label: "صرف راتب", short: "صرف", sign: -1 },
};

function monthLabel(m) {
  const [y, mm] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mm - 1, 15)).toLocaleDateString("ar-JO", { month: "long", year: "numeric" });
}
function shiftMonth(m, n) {
  const [y, mm] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mm - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function shortDate(d) {
  return new Date(`${d}T12:00:00Z`).toLocaleDateString("ar-JO", { day: "numeric", month: "short" });
}

export default function PayrollEmployee() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { canEdit } = usePerms();
  const editable = canEdit("payroll");
  const [month, setMonth] = useState(null);
  const [e, setE] = useState(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [txKind, setTxKind] = useState(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  function load(m = month) {
    api.payrollEmployee(id, m).then((r) => { setE(r); if (!month) setMonth(r.month.month); }).catch((err) => setError(err.message));
  }
  useEffect(() => { load(null); }, [id]);

  function openTx(kind) {
    setTxKind(kind);
    setAmount(kind === "payment" && e.balance > 0 ? String(e.balance) : "");
    setNote("");
  }

  async function saveTx() {
    setSaving(true);
    setError("");
    try {
      await api.payrollAddTransaction(e.id, { kind: txKind, amount: Number(amount), note });
      setTxKind(null);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function removeTx(t) {
    if (!confirm(`حذف ${KINDS[t.kind].label} ${money(t.amount)}؟`)) return;
    try {
      await api.payrollDeleteTransaction(t.id);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  if (!e) return <div className="page">{error ? <div className="error-box">{error}</div> : <p className="text-secondary">جاري التحميل...</p>}</div>;
  if (editing) return <div className="page"><EmployeeForm initial={e} onCancel={() => setEditing(false)} onSaved={() => { setEditing(false); load(); }} /></div>;

  const b = balanceText(e.balance);
  const m = e.month;
  const thisMonth = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Amman" }).slice(0, 7);

  const statement = [
    `مرحبا ${e.name} 👋`,
    `كشف حسابك من ${shopName()} — ${monthLabel(m.month)}`,
    "",
    `أيام الدوام: ${m.days.present}${m.days.half ? ` + ${m.days.half} نص يوم` : ""}${m.days.absent ? ` · غياب ${m.days.absent}` : ""}`,
    `المستحق عن الشهر: ${money(m.earned)}`,
    m.bonuses ? `مكافآت: ${money(m.bonuses)}` : null,
    m.advances ? `سحوبات: ${money(m.advances)}` : null,
    m.deductions ? `خصومات: ${money(m.deductions)}` : null,
    m.payments ? `انصرفلك: ${money(m.payments)}` : null,
    "",
    e.balance >= 0 ? `الباقي إلك: ${money(e.balance)}` : `عليك للمحل: ${money(-e.balance)}`,
  ].filter((x) => x !== null).join("\n");

  return (
    <div className="page">
      <button className="back-link" onClick={() => navigate("/payroll")}><FiArrowRight aria-hidden="true" /> الموظفين</button>

      <div className="card customer-hero">
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <span className="avatar" style={{ width: 52, height: 52, fontSize: "1.3rem", borderRadius: 16 }}>{e.name.trim().charAt(0)}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 className="customer-hero-name">{e.name}</h1>
            <div className="text-secondary" style={{ fontSize: "0.85rem" }}>
              {[e.job_title, e.pay_type === "daily" ? `يومية ${e.pay_amount} JD` : `راتب ${e.pay_amount} JD بالشهر`].filter(Boolean).join(" · ")}
            </div>
            {e.status !== "active" && <span className="badge" style={{ marginTop: 6 }}>ترك الشغل</span>}
          </div>
          {editable && <button className="icon-btn" onClick={() => setEditing(true)} aria-label="تعديل"><FiEdit2 size={16} /></button>}
        </div>
        <div className="pay-balance">
          <div className="text-secondary" style={{ fontSize: "0.8rem" }}>الحساب لهلّق</div>
          <div className="tabular-num" style={{ fontSize: "1.8rem", fontWeight: 800, color: b.color }}>{b.text}</div>
        </div>
        {editable && (
          <div className="chips" style={{ marginBottom: 0 }}>
            {Object.entries(KINDS).map(([k, v]) => (
              <button key={k} className={`chip${txKind === k ? " on" : ""}`} onClick={() => openTx(k)}>{v.label}</button>
            ))}
          </div>
        )}
        {txKind && (
          <div style={{ marginTop: 12 }}>
            <div className="field-row">
              <div className="field">
                <label htmlFor="tx-amount">المبلغ (JD)</label>
                <input id="tx-amount" type="number" inputMode="decimal" min="0" step="0.5" value={amount} onChange={(ev) => setAmount(ev.target.value)} autoFocus />
              </div>
              <div className="field">
                <label htmlFor="tx-note">{txKind === "deduction" ? "السبب" : "ملاحظة"}</label>
                <input id="tx-note" value={note} onChange={(ev) => setNote(ev.target.value)} />
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn-primary" disabled={saving || !Number(amount)} onClick={saveTx}>{saving ? "..." : `سجّل ${KINDS[txKind].short}`}</button>
              <button className="btn-secondary" style={{ width: "auto", padding: "0 16px" }} onClick={() => setTxKind(null)}>إلغاء</button>
            </div>
          </div>
        )}
      </div>

      {error && <div className="error-box">{error}</div>}

      <div className="date-nav">
        <button className="icon-btn" onClick={() => { const x = shiftMonth(month, -1); setMonth(x); load(x); }} aria-label="الشهر اللي قبل"><FiChevronRight /></button>
        <div style={{ flex: 1, textAlign: "center", fontWeight: 700 }}>{monthLabel(m.month)}</div>
        <button className="icon-btn" disabled={month >= thisMonth} onClick={() => { const x = shiftMonth(month, 1); setMonth(x); load(x); }} aria-label="الشهر اللي بعد"><FiChevronLeft /></button>
      </div>

      <div className="card">
        <div className="att-calendar">
          {e.days.map((d) => (
            <div key={d.date} className={`att-day ${d.status || "none"}`} title={d.date}>
              <span>{Number(d.date.slice(8))}</span>
            </div>
          ))}
        </div>
        <div className="att-legend">
          <span><i className="present" /> حاضر {m.days.present}</span>
          <span><i className="half" /> نص {m.days.half}</span>
          <span><i className="absent" /> غايب {m.days.absent}</span>
          <span><i className="off" /> عطلة {m.days.off}</span>
        </div>
        <div className="mini-ledger" style={{ marginTop: 10 }}>
          <div className="mini-ledger-row"><span>المستحق من الدوام</span><strong className="tabular-num">{money(m.earned)}</strong></div>
          {m.bonuses > 0 && <div className="mini-ledger-row"><span>مكافآت</span><strong className="tabular-num" style={{ color: "var(--success)" }}>+{money(m.bonuses)}</strong></div>}
          {m.advances > 0 && <div className="mini-ledger-row"><span>سحوبات</span><strong className="tabular-num" style={{ color: "var(--urgent)" }}>−{money(m.advances)}</strong></div>}
          {m.deductions > 0 && <div className="mini-ledger-row"><span>خصومات</span><strong className="tabular-num" style={{ color: "var(--urgent)" }}>−{money(m.deductions)}</strong></div>}
          {m.payments > 0 && <div className="mini-ledger-row"><span>انصرف راتب</span><strong className="tabular-num">−{money(m.payments)}</strong></div>}
        </div>
      </div>

      {e.transactions.length > 0 && (
        <>
          <div className="section-title">حركات {monthLabel(m.month)}</div>
          <div className="list-group">
            {e.transactions.map((t) => (
              <div key={t.id} className="list-row" style={{ cursor: "default" }}>
                <span className="list-text">
                  <span className="list-title">{KINDS[t.kind].label}</span>
                  <div className="list-sub">{shortDate(t.date)}{t.note ? ` · ${t.note}` : ""}{t.created_by_name ? ` · ${t.created_by_name}` : ""}</div>
                </span>
                <span className="tabular-num" style={{ fontWeight: 800, color: KINDS[t.kind].sign > 0 ? "var(--success)" : "var(--text)" }}>
                  {KINDS[t.kind].sign > 0 ? "+" : "−"}{Number(t.amount).toFixed(2)}
                </span>
                {editable && Date.now() - new Date(t.created_at).getTime() < 86400000 && (
                  <button className="icon-btn" style={{ width: 34, height: 34 }} onClick={() => removeTx(t)} aria-label="حذف"><FiTrash2 size={14} /></button>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {e.phone && (
        <a className="card icon-row" style={{ textDecoration: "none", color: "var(--text)", justifyContent: "space-between" }} href={`https://wa.me/${whatsappNumber(e.phone)}?text=${encodeURIComponent(statement)}`} target="_blank" rel="noreferrer">
          <span>ابعتله كشف حسابه</span>
          <FaWhatsapp style={{ color: "var(--whatsapp)" }} size={20} aria-hidden="true" />
        </a>
      )}
    </div>
  );
}
