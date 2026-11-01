import { useEffect, useState } from "react";
import { api } from "../api.js";
import { useFeature } from "../auth.jsx";
import Sheet, { ConfirmSheet } from "../components/Sheet.jsx";
import { usePerms } from "../auth.jsx";

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

      <ShiftCard refreshKey={d.count} />

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

      <ShiftCard refreshKey={d.count} history />

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

// ============================================================
// الوردية وجرد الكاش: كاش أول الوردية + البيع + سداد الديون + الباقات − المصاريف = المفروض
// ============================================================
const EXP_QUICK = ["أخذ دينار", "مواصلات", "أكل", "قهوة", "مواد تنظيف"];

function ShiftCard({ refreshKey, history = false }) {
  const { canEdit } = usePerms();
  const editable = canEdit("cashier");
  const [d, setD] = useState(null);
  const [sheet, setSheet] = useState(null); // open | exp | close
  const [amount, setAmount] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(null);
  const [openShift, setOpenShift] = useState(null);

  const load = () => api.stShift().then(setD).catch((e) => setError(e.message));
  useEffect(() => { load(); }, [refreshKey]);
  if (!d) return error ? <div className="error-box">{error}</div> : null;
  const sh = d.shift;
  if (history && !d.recent.length) return null;

  async function run(fn) {
    setBusy(true);
    setError("");
    try {
      const r = await fn();
      setSheet(null);
      setAmount("");
      setName("");
      load();
      return r;
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {!history && done && (
        <div className={`sh-done ${done.diff === 0 ? "ok" : done.diff < 0 ? "bad" : "warn"}`}>
          <b>{done.diff === 0 ? "✓ الكاش مطابق" : done.diff < 0 ? `⚠️ ناقص ${money(-done.diff)} JD` : `زايد ${money(done.diff)} JD`}</b>
          <span className="tabular-num">المفروض {money(done.expected)} · عدّيت {money(done.counted_cash)}</span>
          <button type="button" className="link-btn" onClick={() => setDone(null)}>تمام</button>
        </div>
      )}

      {history ? null : !sh ? (
        editable && (
          <button type="button" className="sh-start" onClick={() => { setAmount(String(d.suggested_opening || "")); setError(""); setSheet("open"); }}>
            <span>🧮</span>
            <span className="sh-start-t"><b>ابدأ الوردية</b><small>اكتب كم في كاش بالدرج هلّق</small></span>
          </button>
        )
      ) : (
        <div className="sh-card">
          <div className="sh-head">
            <span className="trip-sum-live"><i aria-hidden="true" /> الوردية شغّالة</span>
            <span className="text-secondary" style={{ fontSize: "0.78rem" }}>من {time(sh.opened_at)}</span>
          </div>
          <div className="sh-rows tabular-num">
            <div><span>كاش أول الوردية</span><b>{money(sh.opening_cash)}</b></div>
            <div><span>بيع المحل ({sh.sales.n})</span><b className="green">+ {money(sh.sales.t)}</b></div>
            {sh.debts.t > 0 && <div><span>سداد ديون ({sh.debts.n})</span><b className="green">+ {money(sh.debts.t)}</b></div>}
            {sh.packages.t > 0 && <div><span>باقات كوبونات ({sh.packages.n})</span><b className="green">+ {money(sh.packages.t)}</b></div>}
            {sh.expenses.map((e) => (
              <div key={e.id} className="sh-exp">
                <span>{e.name}{editable && <button type="button" onClick={() => run(() => api.stDelShiftExpense(e.id))} aria-label="احذف">×</button>}</span>
                <b className="red">− {money(e.amount)}</b>
              </div>
            ))}
            <div className="sh-total"><span>المفروض بالدرج</span><b>{money(sh.expected)} JD</b></div>
          </div>
          {editable && (
            <div className="vh-acts2" style={{ marginTop: 10 }}>
              <button className="btn-secondary" onClick={() => { setError(""); setSheet("exp"); }}>+ مصروف</button>
              <button className="btn-primary" onClick={() => { setAmount(""); setError(""); setSheet("close"); }}>سكّر وعدّ الكاش</button>
            </div>
          )}
        </div>
      )}

      {history && d.recent.length > 0 && (
        <>
          <div className="section-title">جرد المحطة (آخر الورديات)</div>
          <div className="vh-past">
            {d.recent.map((r) => (
              <div key={r.id} className="vh-past-row">
                <button type="button" className="vh-past-h" onClick={() => setOpenShift(openShift === r.id ? null : r.id)}>
                  <span><b>{r.full_name}</b> · {new Date(r.opened_at).toLocaleDateString("ar-JO", { timeZone: "Asia/Amman", weekday: "short", day: "numeric" })} {time(r.opened_at)}{r.status === "open" ? " · شغّالة" : ""}</span>
                  <span className="tabular-num">
                    {r.status === "closed"
                      ? r.diff === 0 ? <b className="green">✓</b> : <b className={r.diff < 0 ? "red" : ""}>{r.diff < 0 ? `ناقص ${money(-r.diff)}` : `زايد ${money(r.diff)}`}</b>
                      : money(r.expected)}
                  </span>
                </button>
                {openShift === r.id && (
                  <div className="vh-rep">
                    <div className="sh-rows tabular-num">
                      <div><span>كاش أول الوردية</span><b>{money(r.opening_cash)}</b></div>
                      <div><span>بيع المحل ({r.sales.n})</span><b>+ {money(r.sales.t)}</b></div>
                      {r.debts.t > 0 && <div><span>سداد ديون</span><b>+ {money(r.debts.t)}</b></div>}
                      {r.packages.t > 0 && <div><span>باقات</span><b>+ {money(r.packages.t)}</b></div>}
                      {r.expenses.map((e) => <div key={e.id}><span>{e.name}</span><b className="red">− {money(e.amount)}</b></div>)}
                      <div className="sh-total"><span>المفروض</span><b>{money(r.expected_cash ?? r.expected)}</b></div>
                      {r.counted_cash != null && <div><span>عدّ</span><b>{money(r.counted_cash)}</b></div>}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      <Sheet open={sheet === "open"} title="بداية الوردية" onClose={() => setSheet(null)}>
        {error && <div className="error-box">{error}</div>}
        <label className="pr-field">
          <span>كم في كاش بالدرج هلّق؟ (الكاش القديم)</span>
          <span className="pr-money"><input type="number" inputMode="decimal" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" dir="ltr" autoFocus /><em>JD</em></span>
        </label>
        <div className="sheet-actions">
          <button className="btn-primary" disabled={busy || amount === ""} onClick={() => run(() => api.stOpenShift({ opening_cash: Number(amount) }))}>ابدأ</button>
          <button className="btn-secondary" onClick={() => setSheet(null)}>رجوع</button>
        </div>
      </Sheet>

      <Sheet open={sheet === "exp"} title="مصروف من الدرج" onClose={() => setSheet(null)}>
        {error && <div className="error-box">{error}</div>}
        <div className="exp-quick" style={{ marginTop: 0 }}>
          {EXP_QUICK.map((q) => <button key={q} type="button" className={name === q ? "on" : ""} onClick={() => setName(q)}>{q}</button>)}
        </div>
        <label className="pr-field"><span>على شو؟</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="مثلًا أخذ دينار" maxLength={80} /></label>
        <label className="pr-field">
          <span>المبلغ</span>
          <span className="pr-money"><input type="number" inputMode="decimal" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" dir="ltr" /><em>JD</em></span>
        </label>
        <div className="sheet-actions">
          <button className="btn-primary" disabled={busy || !name.trim() || !(Number(amount) > 0)} onClick={() => run(() => api.stShiftExpense({ name: name.trim(), amount: Number(amount) }))}>سجّل المصروف</button>
          <button className="btn-secondary" onClick={() => setSheet(null)}>رجوع</button>
        </div>
      </Sheet>

      {sh && (
        <Sheet open={sheet === "close"} title="سكّر الوردية — عدّ الكاش" onClose={() => setSheet(null)}>
          {error && <div className="error-box">{error}</div>}
          <p className="text-secondary" style={{ marginTop: 0 }}>عدّ الكاش اللي بالدرج واكتبه. المفروض يكون <b className="tabular-num">{money(sh.expected)} JD</b>.</p>
          <label className="pr-field">
            <span>كم عدّيت؟</span>
            <span className="pr-money"><input type="number" inputMode="decimal" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" dir="ltr" autoFocus /><em>JD</em></span>
          </label>
          {amount !== "" && (() => {
            const diff = Math.round((Number(amount) - sh.expected) * 100) / 100;
            return <div className={`pay-note${diff < 0 ? " warn" : ""}`}>{diff === 0 ? "✓ مطابق" : diff < 0 ? `ناقص ${money(-diff)} JD` : `زايد ${money(diff)} JD`}</div>;
          })()}
          <div className="sheet-actions">
            <button className="btn-primary" disabled={busy || amount === ""} onClick={async () => { const r = await run(() => api.stCloseShift({ counted_cash: Number(amount) })); if (r) setDone(r); }}>أكّد وسكّر الوردية</button>
            <button className="btn-secondary" onClick={() => setSheet(null)}>رجوع</button>
          </div>
        </Sheet>
      )}
    </>
  );
}
