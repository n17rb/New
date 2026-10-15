import { useEffect, useState } from "react";
import { FiPlus, FiMinus, FiClipboard, FiX } from "react-icons/fi";
import { api } from "../api.js";
import { usePerms } from "../auth.jsx";

const REASONS = {
  lend: "سلّمناه عهدة",
  return: "استرجعنا",
  delivery: "توصيل",
  adjust: "جرد / تعديل",
  undo: "تراجع عن تسليم",
};

function shortDate(d) {
  return new Date(d).toLocaleDateString("ar-JO", { timeZone: "Asia/Amman", day: "numeric", month: "short" });
}

// بطاقة عهدة القوارير بصفحة الزبون: كم قارورة للمحل عنده، وتسليم/استرجاع/جرد
export default function BottleCustody({ customer, onChanged }) {
  const { canEdit } = usePerms();
  const editable = canEdit("customers");
  const [data, setData] = useState(null);
  const [mode, setMode] = useState(null); // lend | return | adjust
  const [count, setCount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showHistory, setShowHistory] = useState(false);

  function load() {
    api.getCustomerBottles(customer.id).then(setData).catch(() => setData(null));
  }
  useEffect(load, [customer.id]);

  async function save() {
    setBusy(true);
    setError("");
    try {
      await api.moveBottles(customer.id, { kind: mode, count: Number(count), note });
      setMode(null);
      setCount("");
      setNote("");
      load();
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const out = data?.bottles_out ?? customer.bottles_out ?? 0;
  const agreed = data?.bottles_agreed ?? customer.bottles_agreed ?? 0;
  const value = data?.bottle_value ? out * data.bottle_value : null;

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
        <div>
          <div style={{ fontWeight: 800 }}>🫙 عهدة القوارير</div>
          <div className="text-secondary" style={{ fontSize: "0.8rem" }}>قوارير المحل اللي عند الزبون — بترجع للمحل إذا قطع التعامل</div>
        </div>
        <div style={{ textAlign: "left" }}>
          <div className="tabular-num" style={{ fontSize: "1.6rem", fontWeight: 800, color: "var(--navy)", lineHeight: 1 }}>{out}</div>
          <div className="text-secondary" style={{ fontSize: "0.72rem" }}>قارورة عنده</div>
        </div>
      </div>
      {(agreed > 0 || value) && (
        <div className="chips" style={{ margin: "8px 0 0" }}>
          {agreed > 0 && <span className="badge">العهدة المتفق عليها: {agreed}</span>}
          {agreed > 0 && out !== agreed && (
            <span className="badge" style={{ background: out > agreed ? "var(--warning-soft)" : "var(--primary-soft)", color: out > agreed ? "var(--warning)" : "var(--navy)" }}>
              {out > agreed ? `زيادة ${out - agreed}` : `ناقص ${agreed - out}`}
            </span>
          )}
          {value != null && <span className="badge">قيمتها {value.toFixed(2)} JD</span>}
        </div>
      )}

      {error && <div className="error-box" style={{ marginTop: 10 }}>{error}</div>}

      {editable && !mode && (
        <div className="fc-actions">
          <button className="fc-btn primary" onClick={() => setMode("lend")}><FiPlus aria-hidden="true" /> سلّمته عهدة</button>
          <button className="fc-btn" onClick={() => setMode("return")}><FiMinus aria-hidden="true" /> استرجعت</button>
          <button className="fc-btn quiet" onClick={() => { setMode("adjust"); setCount(String(out)); }} aria-label="جرد"><FiClipboard aria-hidden="true" /> جرد</button>
        </div>
      )}

      {mode && (
        <div style={{ marginTop: 12 }}>
          <div className="field-row">
            <div className="field">
              <label htmlFor="bt-count">{mode === "adjust" ? "عنده فعليًا كم قارورة؟" : mode === "lend" ? "كم قارورة سلّمته؟" : "كم قارورة استرجعت؟"}</label>
              <input id="bt-count" type="number" inputMode="numeric" min="0" value={count} onChange={(e) => setCount(e.target.value)} autoFocus />
            </div>
            <div className="field">
              <label htmlFor="bt-note">{mode === "adjust" ? "السبب" : "ملاحظة"}</label>
              <input id="bt-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder={mode === "adjust" ? "جرد عند الزبون" : "اختياري"} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn-primary" disabled={busy || count === ""} onClick={save}>{busy ? "..." : "حفظ"}</button>
            <button className="btn-secondary icon-row" style={{ width: "auto", padding: "0 14px" }} onClick={() => setMode(null)} aria-label="إلغاء"><FiX aria-hidden="true" /></button>
          </div>
        </div>
      )}

      {data?.history?.length > 0 && (
        <>
          <button className="btn-danger-text" style={{ color: "var(--text-secondary)", fontSize: "0.82rem", marginTop: 8, padding: 0 }} onClick={() => setShowHistory(!showHistory)}>
            {showHistory ? "إخفاء الحركات" : `الحركات (${data.history.length})`}
          </button>
          {showHistory && (
            <div className="mini-ledger">
              {data.history.map((h) => (
                <div key={h.id} className="mini-ledger-row">
                  <span>
                    {REASONS[h.reason] || h.reason}
                    {h.note && <div className="text-secondary" style={{ fontSize: "0.75rem" }}>{h.note}</div>}
                    <div className="text-secondary" style={{ fontSize: "0.75rem" }}>{shortDate(h.created_at)}{h.by_name ? ` · ${h.by_name}` : ""}</div>
                  </span>
                  <span className="tabular-num" style={{ fontWeight: 700 }}>
                    {h.change > 0 ? "+" : ""}{h.change}
                    <div className="text-secondary" style={{ fontSize: "0.72rem", fontWeight: 400 }}>صار {h.balance_after}</div>
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
