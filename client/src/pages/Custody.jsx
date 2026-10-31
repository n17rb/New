import { useEffect, useState } from "react";
import { api } from "../api.js";
import { useFeature } from "../auth.jsx";
import Sheet from "../components/Sheet.jsx";

const money = (n) => Number(n || 0).toFixed(2);

// العهدة: مبلغ ثابت مع الشخص (فراطة) — ما بينحسب من الكاش اللي بيسلّمه
export default function Custody() {
  const enabled = useFeature("custody");
  const [d, setD] = useState(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [edit, setEdit] = useState(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => api.stCustody().then(setD).catch((e) => setError(e.message));
  useEffect(() => { if (enabled) load(); }, [enabled]);
  if (!enabled) return <div className="page"><div className="card text-secondary">هاي الميزة مش مفعّلة لمحلك.</div></div>;
  if (!d) return <div className="page">{error ? <div className="error-box">{error}</div> : <p className="text-secondary">جاري التحميل…</p>}</div>;

  async function save() {
    setBusy(true);
    setError("");
    try {
      await api.stSetCustody(edit.user_id, { amount: Number(amount || 0), note });
      setMsg(`✅ عهدة ${edit.full_name} صارت ${money(amount || 0)} JD`);
      setTimeout(() => setMsg(""), 5000);
      setEdit(null);
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const withAmount = d.people.filter((p) => p.amount > 0);
  const without = d.people.filter((p) => !(p.amount > 0));

  return (
    <div className="page">
      <div className="pr-head">
        <div>
          <h1 className="title-lg" style={{ margin: 0 }}>العهدة</h1>
          <div className="pr-sub">مصاري ثابتة مع الموظف (فراطة) — مش من الكاش اللي بيسلّمه</div>
        </div>
      </div>
      {msg && <div className="success-box">{msg}</div>}
      {error && <div className="error-box">{error}</div>}

      <div className="stn-hero"><div><span>مجموع العهد</span><b className="tabular-num">{money(d.total)}<small> JD</small></b></div></div>

      <div className="pr-list">
        {[...withAmount, ...(d.can_edit ? without : [])].map((p) => (
          <button key={p.user_id} type="button" className="pr-row" disabled={!d.can_edit}
            onClick={() => { setEdit(p); setAmount(p.amount ? String(p.amount) : ""); setNote(p.note || ""); setError(""); }}>
            <span className="pr-ic" aria-hidden="true">{(p.full_name || "؟").trim()[0]}</span>
            <span className="pr-t">
              <b>{p.full_name}</b>
              {(p.note || p.updated_by_name) && <span className="pr-tags"><span className="pr-tag">{p.note || ""}{p.note && p.updated_by_name ? " · " : ""}{p.updated_by_name ? `سجّلها ${p.updated_by_name}` : ""}</span></span>}
            </span>
            <span className="pr-price tabular-num">{p.amount > 0 ? money(p.amount) : "—"}{p.amount > 0 && <small>JD</small>}</span>
          </button>
        ))}
      </div>
      {!d.can_edit && withAmount.length === 0 && <div className="pr-empty">ما معك عهدة</div>}

      <Sheet open={!!edit} title={edit ? `عهدة ${edit.full_name}` : ""} onClose={() => setEdit(null)}>
        {error && <div className="error-box">{error}</div>}
        <label className="pr-field">
          <span>المبلغ اللي معه</span>
          <span className="pr-money">
            <input type="number" inputMode="decimal" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" dir="ltr" autoFocus />
            <em>JD</em>
          </span>
        </label>
        <label className="pr-field"><span>ملاحظة (اختياري)</span><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="مثلًا فراطة للسيارة" /></label>
        <div className="sheet-actions">
          <button className="btn-primary" disabled={busy || amount === "" || Number(amount) < 0} onClick={save}>حفظ</button>
          <button className="btn-secondary" onClick={() => setEdit(null)}>رجوع</button>
        </div>
        {edit?.amount > 0 && <button type="button" className="pr-archive" disabled={busy} onClick={() => { setAmount("0"); }}>رجّع العهدة (صفّرها)</button>}
      </Sheet>
    </div>
  );
}
