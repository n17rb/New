import { useEffect, useState } from "react";
import { FiSearch, FiX, FiUserPlus } from "react-icons/fi";
import { fapi } from "./fapi.js";
import { useFx, useLoad, Sheet, Err, Loading, Act, ProductArt, CliqBox, SignaturePad, money, num } from "./ui.jsx";
import { InvoiceSheet } from "./pages/StopSheet.jsx";

// ============================================================
// بيع على أرض المصنع: زبون إجا عالمصنع — بتختار مين، شو اشترى، وكم دفع. الكراتين بتطلع من المستودع والفاتورة جاهزة
// ============================================================
export default function CounterSaleSheet({ onClose, onDone }) {
  const fx = useFx();
  const [who, setWho] = useState({ mode: "walkin" }); // walkin | new | existing
  const [q, setQ] = useState("");
  const [list, setList] = useState([]);
  useEffect(() => {
    if (who.mode !== "pick" || !q.trim()) { setList([]); return undefined; }
    const t = setTimeout(() => fapi.customers({ q }).then(setList).catch(() => {}), 250);
    return () => clearTimeout(t);
  }, [q, who.mode]);
  const cid = who.mode === "existing" ? who.c.id : null;
  const { data, error } = useLoad(() => fapi.counterInfo(cid), [cid]);
  const [qty, setQty] = useState({});
  const [bon, setBon] = useState({});
  const [cashEdit, setCashEdit] = useState(null);
  const [cliqOn, setCliqOn] = useState(false);
  const [cliq, setCliq] = useState("");
  const [cliqPhoto, setCliqPhoto] = useState(null);
  const [sig, setSig] = useState(null);
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [inv, setInv] = useState(null);
  const stock = data?.stock || [];
  const lines = stock.filter((p) => Number(qty[p.id]) > 0 || Number(bon[p.id]) > 0);
  const total = Math.round(stock.reduce((a, p) => a + (Number(qty[p.id]) || 0) * p.price, 0) * 100) / 100;
  const cliqN = cliqOn ? Number(cliq) || 0 : 0;
  const cashN = cashEdit === null ? Math.max(0, total - cliqN) : Number(cashEdit) || 0;
  const debt = Math.max(0, Math.round((total - cashN - cliqN) * 100) / 100);
  const step = (v, set) => (
    <div className="fx-stepper">
      <button type="button" dir="ltr" onClick={() => set(Math.max(0, (Number(v) || 0) - 1))}>−</button>
      <input className="fx-input" type="number" inputMode="numeric" min="0" value={v ?? ""} placeholder="0" onChange={(e) => set(e.target.value)} />
      <button type="button" dir="ltr" onClick={() => set((Number(v) || 0) + 1)}>+</button>
    </div>
  );
  async function sell(confirmShort = false) {
    setErr("");
    try {
      const r = await fapi.counterSale({
        customer_id: cid || undefined, new_name: who.mode === "new" ? who.name : undefined, new_phone: who.mode === "new" ? who.phone : undefined,
        items: lines.map((p) => ({ product_id: p.id, qty: Number(qty[p.id]) || 0, bonus: Number(bon[p.id]) || 0 })),
        cash: cashN, cliq: cliqN || undefined, cliq_photo: cliqN ? cliqPhoto : undefined, signature: sig || undefined, note, confirm_short: confirmShort,
      });
      fx.toast(`انباع ${money(r.total)} د.أ لـ${r.customer_name}`);
      setInv({ o: { id: r.order_id, invoice_token: r.invoice_token, customer_name: r.customer_name, phone: r.phone } });
    } catch (e) {
      if (e.data?.code === "SHORT" && window.confirm(e.message)) return sell(true);
      setErr(e.message);
    }
  }
  if (inv) return <InvoiceSheet o={inv.o} title={`✓ انباع · ${inv.o.customer_name}`} onClose={() => { setInv(null); onDone?.(); }} />;
  return (
    <Sheet title="🏭 بيع من المصنع" onClose={onClose}>
      <div className="fx-stack">
        <b>مين الزبون؟</b>
        {who.mode === "existing" ? (
          <div className="fx-row cs-who"><span className="fx-grow"><b>{who.c.name}</b><small className="fx-muted"> {who.c.city || ""}</small></span><button className="fx-icon-btn sm" onClick={() => setWho({ mode: "walkin" })} aria-label="غيّر"><FiX /></button></div>
        ) : (
          <div className="cs-modes">
            <button className={who.mode === "walkin" ? "on" : ""} onClick={() => setWho({ mode: "walkin" })}>زبون نقدي</button>
            <button className={who.mode === "pick" ? "on" : ""} onClick={() => setWho({ mode: "pick" })}><FiSearch /> زبون عندي</button>
            <button className={who.mode === "new" ? "on" : ""} onClick={() => setWho({ mode: "new", name: "", phone: "" })}><FiUserPlus /> زبون جديد</button>
          </div>
        )}
        {who.mode === "pick" && (
          <>
            <input className="fx-input" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="اسم، تلفون، أو رقم الزبون" />
            <div className="fx-list" style={{ maxHeight: 220, overflow: "auto" }}>
              {list.map((c) => <button key={c.id} className="fx-item" onClick={() => setWho({ mode: "existing", c })}><span className="t"><b>{c.name}</b><span>{[c.city, c.phone].filter(Boolean).join(" · ")}</span></span></button>)}
            </div>
          </>
        )}
        {who.mode === "new" && (
          <div className="fx-grid2">
            <input className="fx-input" value={who.name} onChange={(e) => setWho({ ...who, name: e.target.value })} placeholder="الاسم" />
            <input className="fx-input" dir="ltr" inputMode="tel" value={who.phone} onChange={(e) => setWho({ ...who, phone: e.target.value })} placeholder="07XXXXXXXX" />
          </div>
        )}
        {who.mode === "walkin" && <small className="fx-muted">بدون اسم — كاش بس. إذا بدك يبقى إله حساب أو دين اختار «زبون جديد».</small>}

        <b>شو اشترى؟</b>
        <Err msg={error} />
        {!data && !error && <Loading />}
        {stock.map((p) => (
          <div key={p.id} className={`cs-prod ${Number(qty[p.id]) > 0 ? "on" : ""}`}>
            <div className="r1">
              <ProductArt p={p} size={40} />
              <span className="t"><b>{p.name}</b><small>{money(p.price)} د.أ · بالمستودع {num(p.balance)}</small></span>
              {step(qty[p.id], (v) => setQty({ ...qty, [p.id]: v }))}
            </div>
            {Number(qty[p.id]) > 0 && (
              <div className="r2"><span>🎁 بونص</span>{step(bon[p.id], (v) => setBon({ ...bon, [p.id]: v }))}</div>
            )}
          </div>
        ))}

        {total > 0 && (
          <>
            <div className="fx-pay-total"><span>المجموع</span><b>{money(total)} <small>د.أ</small></b></div>
            <label className="fx-field">قديش دفع كاش؟
              <input className="fx-input fx-num" style={{ fontSize: 20, textAlign: "center", fontWeight: 800 }} type="number" inputMode="decimal" value={cashEdit ?? String(Math.max(0, total - cliqN))} onChange={(e) => setCashEdit(e.target.value)} />
            </label>
            <CliqBox on={cliqOn} setOn={setCliqOn} amount={cliq} setAmount={setCliq} photo={cliqPhoto} setPhoto={setCliqPhoto} max={total} />
            {debt > 0 && <div className="fx-note warn">باقي عليه <b>{money(debt)}</b> دينار — بينسجّل دين على حسابه.</div>}
            <SignaturePad onChange={setSig} label="توقيع الزبون (اختياري)" />
            <label className="fx-field">ملاحظة (اختياري)<input className="fx-input" value={note} onChange={(e) => setNote(e.target.value)} /></label>
          </>
        )}
        <Err msg={err} />
        <Act className="fx-btn ok block fx-huge" disabled={!lines.length || (who.mode === "new" && !who.name?.trim()) || who.mode === "pick" || (cliqN > 0 && !cliqPhoto)} onClick={() => sell(false)}>
          {lines.length ? `✓ بيع ${money(total)} د.أ` : "اختار شو اشترى"}
        </Act>
      </div>
    </Sheet>
  );
}
