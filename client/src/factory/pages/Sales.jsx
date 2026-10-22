import { useCallback, useEffect, useState } from "react";
import { FiShoppingCart, FiPlus, FiSearch, FiPackage, FiAlertTriangle } from "react-icons/fi";
import { fapi } from "../fapi.js";
import { deliveredCartons } from "./StopSheet.jsx";
import { Who } from "./Who.jsx";
import { useFx, Sheet, Err, Act, SignaturePad, ProductArt, getLocation, money, num, time } from "../ui.jsx";

// ============================================================
// شغل المندوب: حمّل ← بيع لمحل ← بيع لمحل … ← رجعت للمصنع
// الجرد بيطلع لحاله: اللي حمّلته − اللي بعته = اللي لازم يرجع
// ============================================================

// زر «اليوم بشتغل مندوب»
export function SalesStartCard({ onStarted }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="fx-sales-start" onClick={() => setOpen(true)}>
        <span className="ic"><FiShoppingCart /></span>
        <span className="t"><b>اليوم بشتغل مندوب</b><small>بتحمّل بضاعة وبتلف تبيع على المحلات</small></span>
      </button>
      {open && (
        <LoadSheet
          title="شو حمّلت على السيارة؟"
          hint="اكتب عدد الكراتين اللي طلعت فيها من المصنع. هاد اللي بنحسب عليه الجرد آخر اليوم."
          btn="حمّلت — يلا نبلّش"
          onClose={() => setOpen(false)}
          onSubmit={async (items) => { await fapi.salesStart({ items }); setOpen(false); onStarted(); }}
        />
      )}
    </>
  );
}

// شاشة المندوب وهو شغال
export function SalesDay({ t, stock, canCredit, reload, onSold, openSheet }) {
  const fx = useFx();
  const [sheet, setSheet] = useState(null);
  const left = (stock || []).reduce((a, x) => a + Math.max(0, x.left), 0);
  const sold = t.stops.filter((o) => o.status === "delivered");
  // طلبات من الإدارة وهو شغال مندوب
  const orders = t.stops.filter((o) => ["assigned", "onway", "delayed"].includes(o.status));
  const soldTotal = sold.reduce((a, o) => a + Number(o.delivered_total || 0), 0);
  const active = t.status === "active";

  return (
    <>
      <div className="fx-drv-head">
        <b>{active ? "مندوب اليوم 🛒" : "خلّصت شغل المندوب ✓"}</b>
        <span>{t.vehicle_name} · بعت لـ {sold.length} محل · {money(soldTotal)} دينار</span>
      </div>

      {orders.length > 0 && (
        <div className="fx-drv-step fx-sales-orders">
          <span className="lbl">📦 طلبات إلك من الإدارة ({orders.length}) — من البضاعة اللي معك</span>
          {orders.map((o) => (
            <button key={o.id} className="fx-plain fx-sales-order" onClick={() => openSheet("stop", o)}>
              <Who o={o} />
              <span className="sub">{o.items.map((i) => `${num(i.qty)} ${i.name}`).join("، ")}{o.en_route_at ? " · 🚚 رايح عليه" : ""}</span>
              <span className="fx-btn ok block">سلّمه / انطلق لعنده</span>
            </button>
          ))}
        </div>
      )}

      {active && (
        <div className="fx-drv-step go">
          <span className="lbl">على السيارة هلأ</span>
          <b className="nm">{num(left)} كرتونة</b>
          <Act className="fx-btn ok block fx-huge" disabled={left <= 0} onClick={() => setSheet("sell")}>
            <FiShoppingCart /> بيع لمحل
          </Act>
          {left <= 0 && <small className="fx-muted">خلصت البضاعة — حمّل زيادة أو ارجع للمصنع.</small>}
        </div>
      )}

      {!active && (
        <div className="fx-drv-step">
          <span className="sub">سلّم للمحاسب <b className="fx-num">{money(t.cash_due)}</b> دينار.</span>
          {left > 0 && <span className="sub">ورجّع للمستودع: {stock.filter((x) => x.left > 0).map((x) => `${num(x.left)} ${x.name}`).join("، ")}</span>}
        </div>
      )}

      <div className="fx-sec"><h2>البضاعة على السيارة</h2></div>
      <div className="fx-drv-list">
        {(stock || []).map((x) => (
          <div key={x.product_id} className="r">
            <ProductArt p={x} size={34} />
            <span className="t"><b>{x.name}</b><small>حمّلت {num(x.loaded)} · بعت {num(x.sold)}{x.damaged ? ` · تالف ${num(x.damaged)}` : ""}</small></span>
            <b className={`fx-sales-left ${x.left <= 0 ? "zero" : ""}`}>{num(x.left)}</b>
          </div>
        ))}
      </div>
      {active && <button className="fx-link" style={{ justifySelf: "start" }} onClick={() => setSheet("load")}><FiPackage /> رجعت حمّلت زيادة</button>}

      {sold.length > 0 && (
        <>
          <div className="fx-sec"><h2>بعت اليوم</h2><span className="fx-muted" style={{ fontSize: 13 }}>{sold.length}</span></div>
          <div className="fx-drv-list">
            {[...sold].reverse().map((o) => (
              <button key={o.id} className="r fx-plain" style={{ width: "100%", textAlign: "start" }} onClick={() => onSold({ order_id: o.id, invoice_token: o.invoice_token, customer_name: o.customer_name, phone: o.phone })}>
                <span className="fx-n done">✓</span>
                <span className="t"><b>{o.customer_name}</b><small>{num(deliveredCartons(o))} كرتونة · {money(o.delivered_total)} دينار{Number(o.cash_paid) < Number(o.delivered_total) ? ` · دين ${money(o.delivered_total - o.cash_paid)}` : ""}</small></span>
                <small className="tm">{time(o.delivered_at)}</small>
              </button>
            ))}
          </div>
        </>
      )}

      {active && (
        <>
          <div className="fx-grid2">
            <button className="fx-btn" onClick={() => openSheet("expense")}><FiPlus /> مصروف</button>
            <button className="fx-btn" onClick={() => openSheet("cash")}>حسابي اليوم</button>
          </div>
          <Act className="fx-btn block" onClick={async () => {
            const r = await fapi.driverReturn(t.id, {});
            fx.toast(`سلّم ${money(r.required_cash)} دينار للمحاسب`);
            reload();
          }}>🏁 خلّصت ورجعت للمصنع</Act>
        </>
      )}
      <button className="fx-link" style={{ justifySelf: "start", color: "var(--fx-crit)" }} onClick={() => openSheet("problem")}><FiAlertTriangle /> صار معي مشكلة (عطل، حادث…)</button>

      {sheet === "load" && (
        <LoadSheet title="حمّلت زيادة" hint="اكتب بس الزيادة اللي حمّلتها هلأ." btn="ضيفها على السيارة" onClose={() => setSheet(null)}
          onSubmit={async (items) => { await fapi.salesLoad(t.id, { items }); fx.toast("انضافت على السيارة"); setSheet(null); reload(); }} />
      )}
      {sheet === "sell" && (
        <SellSheet t={t} stock={stock} canCredit={canCredit} onClose={() => setSheet(null)} onDone={(r) => { setSheet(null); onSold(r); }} />
      )}
    </>
  );
}

// استبدال تالف عند الزبون: بنوخذ منه التالف وبنعطيه بداله جديد ببلاش — بيطلع بالفاتورة
export function ExchangeEditor({ value, onChange, products }) {
  const [open, setOpen] = useState(Object.keys(value).length > 0);
  if (!open) return <button className="fx-link" style={{ justifySelf: "start" }} onClick={() => setOpen(true)}>🔁 عند الزبون تالف بدك تبدّله؟</button>;
  const ids = Object.keys(value);
  return (
    <div className="fx-exch">
      <span className="hd">🔁 استبدال تالف</span>
      <small>أخذت منه كراتين تالفة وأعطيته بدالها جديد ببلاش. ما بتنحسب عليه، وبتطلع بالفاتورة، والتالف رجّعه للمستودع.</small>
      {ids.map((pid) => {
        const p = products.find((x) => String(x.id ?? x.product_id) === pid);
        return (
          <label key={pid} className="fx-field">
            <span className="fx-row" style={{ flexWrap: "nowrap" }}><ProductArt p={p} size={32} />{p?.name}</span>
            <Stepper value={value[pid]} onChange={(v) => { const n = { ...value, [pid]: v }; if (!Number(v) && v !== "") delete n[pid]; onChange(n); }} label={`تالف ${p?.name}`} />
          </label>
        );
      })}
      <div className="fx-chips">
        {products.filter((p) => !(String(p.id ?? p.product_id) in value)).map((p) => (
          <button key={p.id ?? p.product_id} className="fx-chip" onClick={() => onChange({ ...value, [p.id ?? p.product_id]: 1 })}>+ {p.name}</button>
        ))}
      </div>
      {ids.length === 0 && <button className="fx-link" style={{ justifySelf: "start" }} onClick={() => setOpen(false)}>ما في تالف</button>}
    </div>
  );
}
export const exchangeList = (v) => Object.entries(v).filter(([, q]) => Number(q) > 0).map(([product_id, q]) => ({ product_id: Number(product_id), qty: Number(q) }));

function Stepper({ value, onChange, max, label }) {
  const v = Number(value) || 0;
  return (
    <div className="fx-stepper big">
      <button type="button" dir="ltr" onClick={() => onChange(Math.max(0, v - 1))} aria-label="ناقص">−</button>
      <input className="fx-input" type="number" inputMode="numeric" min="0" max={max} value={value} placeholder="0" onChange={(e) => onChange(e.target.value)} aria-label={label} />
      <button type="button" dir="ltr" onClick={() => onChange(max != null ? Math.min(max, v + 1) : v + 1)} aria-label="زايد">+</button>
    </div>
  );
}

function LoadSheet({ title, hint, btn, onClose, onSubmit }) {
  const fx = useFx();
  const products = fx.boot.products.filter((p) => p.active);
  const [q, setQ] = useState({});
  const [err, setErr] = useState("");
  const items = Object.entries(q).filter(([, v]) => Number(v) > 0).map(([product_id, v]) => ({ product_id: Number(product_id), qty: Number(v) }));
  const total = items.reduce((a, x) => a + x.qty, 0);
  return (
    <Sheet title={title} onClose={onClose}>
      <div className="fx-stack">
        <div className="fx-note sky">{hint}</div>
        {products.map((p) => (
          <label key={p.id} className="fx-field">
            <span className="fx-row" style={{ flexWrap: "nowrap" }}><ProductArt p={p} size={36} />{p.name}</span>
            <Stepper value={q[p.id] ?? ""} onChange={(v) => setQ({ ...q, [p.id]: v })} label={`كراتين ${p.name}`} />
          </label>
        ))}
        <Err msg={err} />
        <Act className="fx-btn pri block fx-huge" disabled={!total} onClick={async () => {
          setErr("");
          try { await onSubmit(items); } catch (e) { setErr(e.message); }
        }}>{btn}{total ? ` (${num(total)} كرتونة)` : ""}</Act>
      </div>
    </Sheet>
  );
}

function SellSheet({ t, stock, canCredit, onClose, onDone }) {
  const [shop, setShop] = useState(null); // { id, name, balance } أو { new: true, name, phone }
  return shop
    ? <SellItems t={t} stock={stock} shop={shop} canCredit={canCredit} onBack={() => setShop(null)} onClose={onClose} onDone={onDone} />
    : <PickShop onPick={setShop} onClose={onClose} />;
}

function PickShop({ onPick, onClose }) {
  const [q, setQ] = useState("");
  const [loc, setLoc] = useState(null);
  const [list, setList] = useState(null);
  const [isNew, setIsNew] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");

  useEffect(() => { getLocation(6000).then((l) => setLoc(l || false)); }, []);
  useEffect(() => {
    if (loc === null) return;
    const h = setTimeout(() => {
      fapi.driverShops({ q, lat: loc?.lat, lng: loc?.lng }).then(setList).catch(() => setList([]));
    }, q ? 300 : 0);
    return () => clearTimeout(h);
  }, [q, loc]);

  if (isNew) {
    return (
      <Sheet title="محل جديد" onClose={onClose}>
        <div className="fx-stack">
          <label className="fx-field">اسم المحل<input className="fx-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="مثلًا: سوبرماركت النور" autoFocus /></label>
          <label className="fx-field">رقم التلفون (اختياري)<input className="fx-input" type="tel" inputMode="tel" dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="07xxxxxxxx" /></label>
          <div className="fx-note sky">موقع المحل بينحفظ من مكانك هلأ.</div>
          <button className="fx-btn pri block fx-huge" disabled={!name.trim()} onClick={() => onPick({ new: true, name: name.trim(), phone: phone.trim(), balance: 0 })}>التالي</button>
          <button className="fx-link" onClick={() => setIsNew(false)}>رجوع للقائمة</button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet title="لمين بتبيع؟" onClose={onClose}>
      <div className="fx-stack">
        <button className="fx-btn sky block" onClick={() => setIsNew(true)}><FiPlus /> محل جديد</button>
        <label className="fx-search"><FiSearch aria-hidden="true" /><input className="fx-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="دوّر بالاسم أو الرقم" /></label>
        {loc && !q && <small className="fx-muted">الأقرب إلك أول</small>}
        {!list && <div className="fx-muted">بنجيب المحلات…</div>}
        {list && list.length === 0 && <div className="fx-muted">ما لقينا — سجّله «محل جديد».</div>}
        <div className="fx-drv-list">
          {list?.map((c) => (
            <button key={c.id} className="r fx-plain" style={{ width: "100%", textAlign: "start" }} onClick={() => onPick(c)}>
              <span className="t"><b>{c.name}</b><small>{[c.city, c.phone].filter(Boolean).join(" · ")}{c.balance > 0 ? ` · عليه ${money(c.balance)}` : ""}</small></span>
              {c.km != null && <small className="tm">{c.km < 1 ? `${Math.round(c.km * 1000)} م` : `${c.km} كم`}</small>}
            </button>
          ))}
        </div>
      </div>
    </Sheet>
  );
}

function SellItems({ t, stock, shop, canCredit, onBack, onClose, onDone }) {
  const fx = useFx();
  const avail = (stock || []).filter((x) => x.left > 0);
  const [q, setQ] = useState({});
  const [prices, setPrices] = useState(null);
  const [cash, setCash] = useState(null); // null = كاش كامل
  const [exch, setExch] = useState({});
  const [sig, setSig] = useState(null);
  const [over, setOver] = useState("");
  const [err, setErr] = useState("");
  const onSig = useCallback((v) => setSig(v), []);

  useEffect(() => { fapi.driverPrices(shop.new ? null : shop.id).then(setPrices).catch(() => setPrices({})); }, [shop]);

  const priceOf = (pid) => Number(prices?.[pid] ?? fx.boot.products.find((p) => p.id === pid)?.price ?? 0);
  const items = avail.map((x) => ({ product_id: x.product_id, qty: Math.min(x.left, Number(q[x.product_id]) || 0) })).filter((x) => x.qty > 0);
  const total = Math.round(items.reduce((a, x) => a + x.qty * priceOf(x.product_id), 0) * 100) / 100;
  const cashN = cash === null ? total : Number(cash) || 0;
  const debt = Math.max(0, Math.round((total - cashN) * 100) / 100);

  async function sell(confirm = false) {
    setErr("");
    const loc = await getLocation(5000);
    try {
      const r = await fapi.salesSell(t.id, {
        customer_id: shop.new ? undefined : shop.id,
        new_customer: shop.new ? { name: shop.name, phone: shop.phone } : undefined,
        items, exchanges: exchangeList(exch), cash: cashN, signature: sig, lat: loc?.lat, lng: loc?.lng, confirm_over_limit: confirm,
      });
      fx.toast(`انباع لـ ${r.customer_name} ✓`);
      onDone(r);
    } catch (e) {
      if (e.data?.code === "OVER_LIMIT") setOver(e.message);
      else setErr(e.message);
    }
  }

  return (
    <Sheet title={`بيع: ${shop.name}`} onClose={onClose}>
      <div className="fx-stack">
        <button className="fx-link" style={{ justifySelf: "start" }} onClick={onBack}>غيّر المحل</button>
        {shop.balance > 0 && <div className="fx-note warn">عليه من قبل {money(shop.balance)} دينار.</div>}
        {avail.map((x) => (
          <label key={x.product_id} className="fx-field">
            <span className="fx-row" style={{ flexWrap: "nowrap" }}>
              <ProductArt p={x} size={36} />{x.name}
              <span className="fx-muted">({money(priceOf(x.product_id))} · معك {num(x.left)})</span>
            </span>
            <Stepper value={q[x.product_id] ?? ""} max={x.left} onChange={(v) => setQ({ ...q, [x.product_id]: v })} label={`كراتين ${x.name}`} />
            {Number(q[x.product_id]) > x.left && <small style={{ color: "var(--fx-crit)" }}>معك بس {num(x.left)}</small>}
          </label>
        ))}
        <ExchangeEditor value={exch} onChange={setExch} products={avail} />
        <div className="fx-card">
          <div className="fx-kv"><span>المجموع</span><b>{money(total)}</b></div>
          <label className="fx-field" style={{ paddingBlock: 8 }}>دفع كاش (دينار)
            <input className="fx-input" type="number" inputMode="decimal" value={cash === null ? (total ? String(total) : "") : cash} onChange={(e) => setCash(e.target.value)} placeholder="0" />
          </label>
          {debt > 0 && <div className="fx-kv bad"><span>بيصير عليه دين</span><b>{money(debt)}</b></div>}
        </div>
        {debt > 0 && !canCredit && <div className="fx-note crit">ما عندك صلاحية تبيع بالدين — خذ المبلغ كامل.</div>}
        <details className="fx-sales-sig">
          <summary>توقيع صاحب المحل (اختياري)</summary>
          <SignaturePad onChange={onSig} />
        </details>
        {over && (
          <div className="fx-note warn fx-stack">
            <span>{over}</span>
            <Act className="fx-btn sm" onClick={() => sell(true)}>كمّل وبلّغ الإدارة</Act>
          </div>
        )}
        <Err msg={err} />
        <Act className="fx-btn ok block fx-huge" disabled={(!items.length && !exchangeList(exch).length) || (debt > 0 && !canCredit)} onClick={() => sell(false)}>
          بيع{total ? ` · ${money(total)} دينار` : ""}
        </Act>
      </div>
    </Sheet>
  );
}
