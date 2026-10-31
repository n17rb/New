import { useEffect, useState } from "react";
import { api } from "../api.js";
import { useFeature } from "../auth.jsx";
import { ConfirmSheet } from "../components/Sheet.jsx";

const money = (n) => Number(n || 0).toFixed(2);
const time = (d) => new Date(d).toLocaleTimeString("ar-JO", { timeZone: "Asia/Amman", hour: "numeric", minute: "2-digit" });

// كاشير المحل: كبسة على المنتج = واحد زيادة، وبعدين «أكّد البيعة»
export default function Cashier() {
  const enabled = useFeature("cashier");
  const [d, setD] = useState(null);
  const [cart, setCart] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [voiding, setVoiding] = useState(null);

  const load = () => api.stCashier().then(setD).catch((e) => setError(e.message));
  useEffect(() => { if (enabled) load(); }, [enabled]);
  if (!enabled) return <div className="page"><div className="card text-secondary">هاي الميزة مش مفعّلة لمحلك.</div></div>;
  if (!d) return <div className="page">{error ? <div className="error-box">{error}</div> : <p className="text-secondary">جاري التحميل…</p>}</div>;

  const add = (id, n) => setCart((c) => {
    const v = Math.max(0, (c[id] || 0) + n);
    const next = { ...c, [id]: v };
    if (!v) delete next[id];
    return next;
  });
  const lines = d.products.filter((p) => cart[p.id]).map((p) => ({ ...p, qty: cart[p.id], total: cart[p.id] * p.unit_price }));
  const total = lines.reduce((a, x) => a + x.total, 0);

  async function sell() {
    setBusy(true);
    setError("");
    try {
      await api.stSell({ items: lines.map((x) => ({ product_id: x.id, qty: x.qty })) });
      setMsg(`✅ انسجّلت البيعة — ${money(total)} JD`);
      setTimeout(() => setMsg(""), 5000);
      setCart({});
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page cs-page">
      <div className="pr-head">
        <div>
          <h1 className="title-lg" style={{ margin: 0 }}>الكاشير</h1>
          <div className="pr-sub tabular-num">مبيعات اليوم: {money(d.total)} JD · {d.count} بيعة</div>
        </div>
      </div>
      {msg && <div className="success-box">{msg}</div>}
      {error && <div className="error-box">{error}</div>}

      <div className="cs-grid">
        {d.products.map((p) => (
          <button key={p.id} type="button" className={`cs-prod${cart[p.id] ? " on" : ""}`} onClick={() => add(p.id, 1)}>
            {cart[p.id] ? <span className="cs-badge tabular-num">{cart[p.id]}</span> : null}
            <b>{p.name}</b>
            <small className="tabular-num">{money(p.unit_price)} JD</small>
          </button>
        ))}
      </div>

      {lines.length > 0 && (
        <div className="cs-cart">
          {lines.map((x) => (
            <div key={x.id} className="cs-line">
              <span className="cs-line-n">{x.name}</span>
              <div className="ei-step">
                <button type="button" className="step-btn" onClick={() => add(x.id, -1)} aria-label="أقل">−</button>
                <span className="tabular-num">{x.qty}</span>
                <button type="button" className="step-btn plus" onClick={() => add(x.id, 1)} aria-label="أكثر">+</button>
              </div>
              <b className="tabular-num cs-line-t">{money(x.total)}</b>
            </div>
          ))}
          <div className="cs-total"><span>المجموع</span><b className="tabular-num">{money(total)} JD</b></div>
          <button className="btn-primary" style={{ background: "var(--success)" }} disabled={busy} onClick={sell}>{busy ? "لحظة…" : `أكّد البيعة · ${money(total)} JD`}</button>
          <button className="btn-secondary" style={{ marginTop: 8 }} disabled={busy} onClick={() => setCart({})}>فضّي</button>
        </div>
      )}

      {d.sales.length > 0 && (
        <>
          <div className="section-title">بيعات اليوم</div>
          <div className="list-group">
            {d.sales.map((s) => (
              <div key={s.id} className="list-row" style={{ cursor: "default", opacity: s.status === "void" ? 0.5 : 1 }}>
                <span className="list-text">
                  <span className="list-title">{s.items.map((x) => `${x.qty} ${x.name}`).join("، ")}</span>
                  <div className="list-sub">{time(s.created_at)}{s.by_name ? ` · ${s.by_name}` : ""}{s.status === "void" ? " · ملغية" : ""}</div>
                </span>
                <b className="tabular-num">{money(s.total)}</b>
                {d.can_void && s.status === "done" && <button type="button" className="debt-pay-btn" style={{ color: "var(--urgent)", background: "var(--urgent-soft)" }} onClick={() => setVoiding(s)}>إلغاء</button>}
              </div>
            ))}
          </div>
        </>
      )}

      <ConfirmSheet
        open={!!voiding}
        title="إلغاء البيعة؟"
        text={voiding ? `${voiding.items.map((x) => `${x.qty} ${x.name}`).join("، ")} — ${money(voiding.total)} JD. الكمية بترجع للمخزون.` : ""}
        confirmLabel="نعم، ألغيها"
        danger
        busy={busy}
        onConfirm={() => { const s = voiding; setVoiding(null); api.stVoidSale(s.id).then(load).catch((e) => setError(e.message)); }}
        onClose={() => setVoiding(null)}
      />
    </div>
  );
}
