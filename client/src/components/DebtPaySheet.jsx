import { useEffect, useState } from "react";
import { api } from "../api.js";
import Sheet from "./Sheet.jsx";

// سداد دين سريع: اختار الزبون (أو جاي جاهز) ← المبلغ ← «تم السداد»
export default function DebtPaySheet({ open, customer = null, onClose, onDone }) {
  const [list, setList] = useState(null);
  const [q, setQ] = useState("");
  const [cust, setCust] = useState(null);
  const [mode, setMode] = useState("all"); // all | part
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setQ(""); setMode("all"); setAmount(""); setError("");
    setCust(customer);
    if (!customer) api.getDebtQuickList().then(setList).catch((e) => { setList([]); setError(e.message); });
  }, [open, customer?.id]);

  const debt = cust ? Number(cust.debt_balance) : 0;
  const pay = mode === "all" ? debt : Number(amount || 0);
  const term = q.trim();
  const shown = (list || []).filter((c) => !term || c.name.includes(term) || (c.phone_display || "").replace(/\D/g, "").includes(term.replace(/\D/g, "") || "x"));

  async function save() {
    setBusy(true);
    setError("");
    try {
      const r = await api.quickPayDebt(cust.id, { amount: Math.round(pay * 100) / 100 });
      onDone?.(r.debt_balance > 0
        ? `✅ ${cust.name} سدّد ${pay.toFixed(2)} — باقي عليه ${Number(r.debt_balance).toFixed(2)} JD`
        : `✅ ${cust.name} خلّص دينه (${pay.toFixed(2)} JD)`);
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} title="سداد دين" onClose={onClose}>
      {error && <div className="error-box">{error}</div>}
      {!cust ? (
        <>
          <input className="no-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="دوّر على الزبون…" aria-label="ابحث عن زبون" />
          {list === null && <p className="text-secondary no-hint">جاري التحميل…</p>}
          {list && list.length === 0 && <p className="text-secondary no-hint">ما في حدا عليه دين 🎉</p>}
          <div className="no-results">
            {shown.slice(0, 40).map((c) => (
              <button key={c.id} type="button" className="no-row" onClick={() => setCust(c)}>
                <span className="no-av" aria-hidden="true" style={{ background: "var(--urgent-soft)", color: "var(--urgent)" }}>{(c.name || "؟").trim()[0]}</span>
                <span className="no-t"><b>{c.name}</b><small>{c.region_name || c.phone_display}</small></span>
                <span className="tabular-num" style={{ fontWeight: 800, color: "var(--urgent)" }}>{Number(c.debt_balance).toFixed(2)}</span>
              </button>
            ))}
          </div>
          <button className="btn-secondary" style={{ marginTop: 12 }} onClick={onClose}>رجوع</button>
        </>
      ) : (
        <>
          <div className="sheet-who">
            <span className="sheet-who-n" style={{ background: "var(--urgent)" }}>{(cust.name || "؟").trim()[0]}</span>
            <span><b>{cust.name}</b><small className="tabular-num">عليه {debt.toFixed(2)} JD</small></span>
            {!customer && <button type="button" className="no-change" onClick={() => setCust(null)}>غيّر</button>}
          </div>
          <div className="seg" style={{ marginBottom: 10 }}>
            <button type="button" className={mode === "all" ? "on" : ""} onClick={() => setMode("all")}>سدّد كل الدين</button>
            <button type="button" className={mode === "part" ? "on" : ""} onClick={() => setMode("part")}>جزء منه</button>
          </div>
          {mode === "part" && (
            <div className="field">
              <input type="number" inputMode="decimal" min="0" max={debt} step="0.01" value={amount} autoFocus
                onChange={(e) => setAmount(e.target.value)} placeholder="كم دفع؟" aria-label="المبلغ" />
              {pay > 0 && pay < debt && <div className="pay-note" style={{ marginTop: 6 }}>رح يضل عليه {(debt - pay).toFixed(2)} JD</div>}
            </div>
          )}
          <div className="sheet-actions">
            <button className="btn-primary" style={{ background: "var(--success)" }} disabled={busy || !(pay > 0) || pay > debt + 0.001} onClick={save}>
              {busy ? "لحظة…" : `تم السداد · ${pay > 0 ? pay.toFixed(2) : "0.00"} JD`}
            </button>
            <button className="btn-secondary" disabled={busy} onClick={customer ? onClose : () => setCust(null)}>رجوع</button>
          </div>
        </>
      )}
    </Sheet>
  );
}
