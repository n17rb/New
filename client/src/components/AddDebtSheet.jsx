import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import Sheet from "./Sheet.jsx";

// دين جديد بسرعة: دوّر على الزبون ← اكتب المبلغ ← سجّل
export default function AddDebtSheet({ open, onClose, onDone }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [cust, setCust] = useState(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const amountRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setQ(""); setResults([]); setCust(null); setAmount(""); setNote(""); setError("");
  }, [open]);

  useEffect(() => {
    if (!open || cust) return;
    const term = q.trim();
    if (term.length < 2) { setResults([]); return; }
    let alive = true;
    setSearching(true);
    const t = setTimeout(() => {
      api.getCustomers({ q: term })
        .then((r) => alive && setResults(r.slice(0, 12)))
        .catch((e) => alive && setError(e.message))
        .finally(() => alive && setSearching(false));
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [q, open, cust]);

  function choose(c) {
    setCust(c);
    setError("");
    setTimeout(() => amountRef.current?.focus(), 80);
  }

  const n = Number(amount);
  async function save() {
    setBusy(true);
    setError("");
    try {
      const r = await api.adjustDebt(cust.id, { amount: Math.round(n * 100) / 100, notes: note.trim() || "دين" });
      onDone?.(`✅ انسجّل ${n.toFixed(2)} JD دين على ${cust.name} — صار عليه ${Number(r.debt_balance).toFixed(2)}`);
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const place = (c) => [c.region_name, c.building_number && `عمارة ${c.building_number}`].filter(Boolean).join(" · ");

  return (
    <Sheet open={open} title="دين جديد" onClose={onClose}>
      {error && <div className="error-box">{error}</div>}
      {!cust ? (
        <>
          <input className="no-search" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="اسم الزبون أو رقمه…" aria-label="ابحث عن زبون" />
          {searching && <p className="text-secondary no-hint">جاري البحث…</p>}
          {!searching && q.trim().length >= 2 && results.length === 0 && <p className="text-secondary no-hint">ما لقيت حدا بهالاسم</p>}
          <div className="no-results">
            {results.map((c) => (
              <button key={c.id} type="button" className="no-row" onClick={() => choose(c)}>
                <span className="no-av" aria-hidden="true">{(c.name || "؟").trim()[0]}</span>
                <span className="no-t">
                  <b>{c.name}</b>
                  <small>{place(c) || c.phone_display || ""}</small>
                </span>
                {Number(c.debt_balance) > 0 && <span className="tabular-num" style={{ fontWeight: 800, color: "var(--urgent)", fontSize: "0.85rem" }}>{Number(c.debt_balance).toFixed(2)}</span>}
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="sheet-who">
            <span className="sheet-who-n">{(cust.name || "؟").trim()[0]}</span>
            <span><b>{cust.name}</b><small className="tabular-num">{Number(cust.debt_balance) > 0 ? `عليه هلّق ${Number(cust.debt_balance).toFixed(2)} JD` : "ما عليه دين"}</small></span>
            <button type="button" className="no-change" onClick={() => setCust(null)}>غيّر</button>
          </div>
          <label className="pr-field">
            <span>كم الدين؟</span>
            <span className="pr-money">
              <input ref={amountRef} type="number" inputMode="decimal" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00" dir="ltr" onKeyDown={(e) => { if (e.key === "Enter" && n > 0) save(); }} />
              <em>JD</em>
            </span>
          </label>
          <input className="no-search" style={{ fontSize: "0.9rem" }} value={note} onChange={(e) => setNote(e.target.value)} placeholder="ملاحظة (اختياري) — مثلًا ٣ قوارير" />
          {n > 0 && <div className="pay-note warn" style={{ marginTop: 8 }}>رح يصير عليه {(Number(cust.debt_balance || 0) + n).toFixed(2)} JD</div>}
          <div className="sheet-actions">
            <button className="btn-primary" style={{ background: "var(--urgent)" }} disabled={busy || !(n > 0)} onClick={save}>{busy ? "لحظة…" : `سجّل الدين${n > 0 ? ` · ${n.toFixed(2)} JD` : ""}`}</button>
            <button className="btn-secondary" disabled={busy} onClick={onClose}>رجوع</button>
          </div>
        </>
      )}
    </Sheet>
  );
}
