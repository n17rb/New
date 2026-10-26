import { useEffect, useState } from "react";
import { FiChevronRight, FiChevronLeft, FiChevronDown, FiPrinter, FiCheck, FiX, FiArrowRight, FiEdit2, FiFileText, FiBox, FiDollarSign, FiCreditCard, FiAlertCircle } from "react-icons/fi";
import { fapi } from "../fapi.js";
import { useFx, useLoad, Sheet, Err, Loading, Empty, Act, money, num, time, date, today } from "../ui.jsx";
import { InvoiceSheet } from "./StopSheet.jsx";

// ============================================================
// الجرد — بسيط ومريح:
// فوق: ملخص اليوم بثلاث أرقام، وتحته كرت صغير لكل سائق.
// بتكبس على السائق ← حسابه لحاله: رقمين كبار، زر التسوية، والتفاصيل بتبويبات (وحدة وحدة)
// ============================================================
const shift = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

// حالة السائق بكلمة ورقم
function stateOf(d) {
  const S = d.settle || { trips: [], due: 0, active: 0 };
  if (S.trips.length > 0) return { key: "due", label: "بستنى تسوية", amount: S.due, cls: "due" };
  if (S.active) return { key: "work", label: "بالشغل", amount: d.totals.cash, cls: "work" };
  return { key: "done", label: "تسكّر", amount: 0, cls: "done" };
}

export default function Jard() {
  const fx = useFx();
  const mine = fx.can("f_drive", "edit") && !fx.can("f_money") && !fx.can("f_home") && !fx.can("f_stock") && !fx.can("f_dispatch");
  const [day, setDay] = useState(today());
  const [open, setOpen] = useState(null);
  const { data, error, reload } = useLoad(() => (mine ? fapi.myJard({ date: day }) : fapi.jard({ date: day })), [day, mine]);
  const [inv, setInv] = useState(null);
  const drivers = data?.drivers || [];
  const isToday = day === today();
  const one = mine || drivers.length === 1 ? drivers[0] : drivers.find((d) => (d.driver_id || 0) === open);
  useEffect(() => { setOpen(null); }, [day]);
  useEffect(() => { if (open != null) window.scrollTo({ top: 0 }); }, [open]);

  const sum = drivers.reduce((a, d) => {
    const st = stateOf(d);
    if (st.key === "due") a.due += st.amount;
    if (st.key === "work") a.work += 1;
    a.back += Number(d.totals.cartons_back) || 0;
    return a;
  }, { due: 0, work: 0, back: 0 });

  const dayBar = (
    <div className="jd-day fx-noprint">
      <button className="fx-plain" onClick={() => setDay(shift(day, -1))} aria-label="اليوم اللي قبل"><FiChevronRight /></button>
      <span><b>{isToday ? "اليوم" : day === shift(today(), -1) ? "مبارح" : "يوم"}</b><small>{date(day)}</small></span>
      <button className="fx-plain" disabled={isToday} onClick={() => setDay(shift(day, 1))} aria-label="اليوم اللي بعد"><FiChevronLeft /></button>
    </div>
  );

  // حساب سائق واحد
  if (data && one) {
    return (
      <div className="fx-page jd">
        <div className="jd-top">
          {!mine && drivers.length > 1
            ? <button className="jd-back fx-noprint" onClick={() => setOpen(null)}><FiArrowRight /> كل السائقين</button>
            : <h1 className="fx-h1" style={{ margin: 0 }}>{mine ? "جردي" : "الجرد"}</h1>}
          <button className="jd-print fx-noprint" onClick={() => window.print()} aria-label="اطبع"><FiPrinter /></button>
        </div>
        {(mine || drivers.length === 1) && dayBar}
        <DriverJard d={one} mine={mine} canReview={data.can_review} canSettle={data.can_settle} reload={reload} onInvoice={setInv} />
        {inv && <InvoiceSheet o={inv} title={`فاتورة · ${inv.customer_name}`} onClose={() => setInv(null)} />}
      </div>
    );
  }

  return (
    <div className="fx-page jd">
      <div className="jd-top">
        <h1 className="fx-h1" style={{ margin: 0 }}>{mine ? "جردي" : "الجرد"}</h1>
        <button className="jd-print fx-noprint" onClick={() => window.print()} aria-label="اطبع"><FiPrinter /></button>
      </div>
      {dayBar}

      <Err msg={error} />
      {!data && !error && <Loading />}
      {data && drivers.length === 0 && <Empty title="ما في شغل بهاليوم" text="لما سائق يطلع برحلة أو يشتغل مندوب بيطلع جرده هون." />}

      {drivers.length > 0 && (
        <div className="jd-sum">
          <div><small>مطلوب تسليم</small><b>{money(sum.due)}</b></div>
          <div><small>بالشغل</small><b>{num(sum.work)}</b></div>
          <div><small>كراتين راجعة</small><b>{num(sum.back)}</b></div>
        </div>
      )}

      <div className="jd-list fx-noprint">
        {drivers.map((d) => {
          const st = stateOf(d);
          const veh = [...new Set(d.trips.map((t) => t.vehicle_name))].join("، ");
          const pend = d.trips.flatMap((t) => t.expenses).filter((e) => e.status === "pending").length;
          return (
            <button key={d.driver_id || 0} className={`jd-card ${st.cls}`} onClick={() => setOpen(d.driver_id || 0)}>
              <span className="av">{(d.driver_name || "؟").trim()[0]}</span>
              <span className="t">
                <b>{d.driver_name}</b>
                <small>{veh}{pend ? ` · ${pend} مصروف بستنى` : ""}</small>
              </span>
              <span className="n">
                <small>{st.label}</small>
                <b>{st.key === "done" ? <FiCheck /> : money(st.amount)}</b>
              </span>
              <FiChevronLeft className="go" aria-hidden="true" />
            </button>
          );
        })}
      </div>

      {!mine && isToday && data?.idle_drivers?.length > 0 && (
        <details className="jd-idle fx-noprint">
          <summary>{data.idle_drivers.length} بدون رحلة اليوم</summary>
          <p>{data.idle_drivers.map((x) => x.name).join("، ")}</p>
          <small>لتحمّل لواحد منهم اعمله رحلة من «الرحلات»، أو خلّيه يبلّش «جولة بيع» من رحلتي.</small>
        </details>
      )}

      {/* للطباعة: كل السائقين بالتفصيل */}
      <div className="jd-printall">
        {drivers.map((d) => <DriverJard key={d.driver_id || 0} d={d} mine={mine} canReview={false} canSettle={false} reload={reload} onInvoice={() => {}} />)}
      </div>
      {inv && <InvoiceSheet o={inv} title={`فاتورة · ${inv.customer_name}`} onClose={() => setInv(null)} />}
    </div>
  );
}

function DriverJard({ d, mine, canReview, canSettle, reload, onInvoice }) {
  const T = d.totals;
  const S = d.settle || { trips: [], due: 0, older: 0, active: 0 };
  const [tab, setTab] = useState("money");
  const [settling, setSettling] = useState(false);
  const [editLoad, setEditLoad] = useState(false);
  const fx = useFx();
  const canLoad = !mine && (fx.can("f_dispatch", "edit") || fx.can("f_stock", "edit")) && d.trips.some((t) => ["planned", "active", "returned"].includes(t.status) && !t.returns_received_at);
  const toSettle = S.trips.length > 0;
  const vehicles = [...new Set(d.trips.map((t) => t.vehicle_name))].join("، ");
  const returned = d.trips.some((t) => t.returns_received_at);
  const allBack = d.trips.every((t) => t.returns_received_at || !t.load_confirmed);
  const backDone = d.goods.reduce((a, g) => a + g.returned, 0);
  const missing = d.goods.reduce((a, g) => a + Math.max(0, g.back - g.returned), 0);
  const custodyNew = d.trips.reduce((a, t) => a + Math.max(0, Number(t.money.diff) || 0), 0);
  const exps = d.trips.flatMap((t) => t.expenses);
  const pend = exps.filter((e) => e.status === "pending").length;
  const invs = d.trips.flatMap((t) => t.invoices);
  const failed = d.trips.flatMap((t) => t.failed);
  const openO = d.trips.flatMap((t) => t.open);
  const collections = d.trips.flatMap((t) => t.collections || []);
  const tabs = [
    ["money", "المصاري", FiDollarSign],
    d.goods.length ? ["goods", "البضاعة", FiBox] : null,
    invs.length || failed.length || openO.length ? ["inv", `الفواتير`, FiFileText, invs.length] : null,
    exps.length ? ["exp", "المصاريف", FiCreditCard, pend ? `${pend}!` : exps.length] : null,
  ].filter(Boolean);
  const cur = tabs.some((t) => t[0] === tab) ? tab : "money";
  const pane = (k) => `jd-pane ${cur === k ? "" : "off"}`;

  return (
    <section className="jd-drv">
      <header className="jd-h">
        <span className="av">{(d.driver_name || "؟").trim()[0]}</span>
        <span className="t">
          <b>{mine ? "حسابي" : d.driver_name}</b>
          <small>{vehicles} · {d.trips.length === 1 ? (d.trips[0].kind === "sales" ? "مندوب" : "رحلة") : `${d.trips.length} رحلات`}</small>
        </span>
        <span className={`fx-pill ${T.settled ? "ok" : "warn"}`}>{T.settled ? "تسكّر" : "مفتوح"}</span>
      </header>

      <div className="jd-big">
        {toSettle ? (
          <div className="tile cash">
            <small>{mine ? "عليك تسلّم" : "عليه يسلّم"}</small>
            <b>{money(S.due)}</b>
            <small>{S.older > 0 ? `منها ${money(S.older)} من أيام قبل` : "دينار"}</small>
          </div>
        ) : S.active ? (
          <div className="tile wait">
            <small>كاش {mine ? "معك" : "معه"} لهلأ</small>
            <b>{money(T.cash)}</b>
            <small>لسا بالشغل</small>
          </div>
        ) : (
          <div className="tile ok">
            <small>{mine ? "عليك هلأ" : "عليه هلأ"}</small>
            <b>0.00</b>
            <small>{custodyNew > 0 ? `نقص ${money(custodyNew)} انسجّل عهدة` : `سلّم ${money(T.handed)}`}</small>
          </div>
        )}
        {allBack && returned ? (
          <div className={`tile ${missing ? "cash" : "ok"}`}>
            <small>{missing ? "ناقص من المرتجع" : "الكراتين"}</small>
            <b>{missing ? num(missing) : <FiCheck />}</b>
            <small>رجّع {num(backDone)} كرتونة</small>
          </div>
        ) : (
          <div className="tile box">
            <small>{mine ? "رجّع للمستودع" : "لازم يرجّع"}</small>
            <b>{num(T.cartons_back)}</b>
            <small>كرتونة{T.damaged_from_customers ? ` + ${num(T.damaged_from_customers)} تالف` : ""}</small>
          </div>
        )}
      </div>

      {!mine && canSettle && toSettle && (
        <button className="fx-btn ok block fx-big fx-noprint" onClick={() => setSettling(true)}><FiCheck /> استلمت من {d.driver_name.split(" ")[0]} — سكّر الحساب</button>
      )}
      {!mine && !toSettle && S.active > 0 && <div className="jd-hint fx-noprint">لما يكبس «رجعت للمصنع» بيطلعلك زر التسوية هون.</div>}
      {editLoad && <LoadEditSheet d={d} reload={reload} onClose={() => setEditLoad(false)} />}
      {settling && <SettleSheet d={d} canReview={canReview} reload={reload} onClose={() => setSettling(false)} />}

      {tabs.length > 1 && (
        <div className="jd-tabs fx-noprint" role="tablist">
          {tabs.map(([k, l, Ic, n]) => (
            <button key={k} role="tab" aria-selected={cur === k} className={cur === k ? "on" : ""} onClick={() => setTab(k)}>
              <Ic aria-hidden="true" /><span>{l}</span>{n ? <i className={String(n).endsWith("!") ? "warn" : ""}>{String(n).replace("!", "")}</i> : null}
            </button>
          ))}
        </div>
      )}

      {/* المصاري */}
      <div className={pane("money")}>
        <div className="jd-card-in">
          <h3>المصاري</h3>
          <Row l={`فواتير (${T.invoices_count})`} v={money(T.invoices)} />
          <Row l="كاش من الزباين" v={money(T.cash)} />
          {T.debt > 0 && <Row l="دين جديد على الزباين" v={money(T.debt)} c="warn" />}
          {T.debt_collected > 0 && <Row l="ديون قديمة قبضها" v={money(T.debt_collected)} c="good" />}
          {collections.length > 0 && (
            <div className="jd-sub">
              {collections.map((g) => <Row key={g.id} l={`${g.customer_name} · ${time(g.at)}`} v={money(g.amount)} />)}
            </div>
          )}
          {T.expenses > 0 && <Row l="ناقص مصاريف" v={`− ${money(T.expenses)}`} />}
          <div className="jd-total"><span>المطلوب يتسلّم</span><b>{money(T.due)} <small>د.أ</small></b></div>
          {T.handed > 0 && <Row l="انستلم فعلًا" v={money(T.handed)} c="good" />}
          {d.custody !== 0 && <Row l={d.custody > 0 ? "عهدة عليه من قبل" : "إله من قبل"} v={money(Math.abs(d.custody))} c={d.custody > 0 ? "bad" : ""} />}
        </div>
      </div>

      {/* البضاعة */}
      {d.goods.length > 0 && (
        <div className={pane("goods")}>
          <div className="jd-card-in">
            <div className="jd-h3"><h3>البضاعة</h3>{canLoad && <button className="jd-mini fx-noprint" onClick={() => setEditLoad(true)}><FiEdit2 /> عدّل الحمولة</button>}</div>
            {d.goods.map((g) => (
              <div key={g.product_id} className="jd-good">
                <div className="r1">
                  <b>{g.name}</b>
                  <span className="back"><small>يرجع</small> <b>{num(g.back)}</b></span>
                </div>
                <div className="r2">
                  <span>طلع {num(g.loaded)}</span>
                  <span>سلّم {num(g.delivered)}</span>
                  {g.bonus > 0 && <span className="ok">بونص {num(g.bonus)}</span>}
                  {g.exchanged > 0 && <span className="ex">بدل تالف {num(g.exchanged)}</span>}
                  {g.damaged > 0 && <span className="bad">تلف {num(g.damaged)}</span>}
                </div>
                {returned && <small className={g.returned < g.back ? "miss" : "fine"}>رجع {num(g.returned)}{g.returned < g.back ? ` · ناقص ${num(g.back - g.returned)}` : " ✓"}</small>}
                {g.over > 0 && <small className="miss"><FiAlertCircle /> سلّم {num(g.over)} أكثر من المسجّل — تأكد مع المستودع</small>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* الفواتير */}
      {(invs.length > 0 || failed.length > 0 || openO.length > 0) && (
        <div className={pane("inv")}>
          <div className="jd-invs">
            {invs.map((o) => <InvoiceCard key={o.id} o={o} onInvoice={onInvoice} />)}
            {(failed.length > 0 || openO.length > 0) && (
              <div className="jd-card-in">
                <h3>ما انسلّم</h3>
                {failed.map((o) => <Row key={o.id} l={`${o.customer_name} — ${o.reason || "ما تم"}`} v={`${num(o.cartons)} كرتونة`} c="bad" />)}
                {openO.map((o) => <Row key={o.id} l={`${o.customer_name} — لسا`} v={`${num(o.cartons)} كرتونة`} />)}
              </div>
            )}
          </div>
        </div>
      )}

      {/* المصاريف */}
      {exps.length > 0 && (
        <div className={pane("exp")}>
          <div className="jd-card-in">
            <h3>المصاريف</h3>
            <div className="fx-stack" style={{ gap: 12 }}>
              {exps.map((e) => <ExpenseRow key={e.id} e={e} canReview={canReview && !mine} reload={reload} />)}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function Row({ l, v, c = "" }) {
  return <div className={`jd-row ${c}`}><span>{l}</span><b>{v}</b></div>;
}

// فاتورة مطوية: اسم الزبون والمبلغ، وبتفتح على التفاصيل
function InvoiceCard({ o, onInvoice }) {
  const [open, setOpen] = useState(false);
  return (
    <article className={`jd-inv ${open ? "open" : ""}`}>
      <button className="hd" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="t">
          <b>{o.customer_name}{o.edited_at ? <small className="fx-edited"> · معدّلة</small> : null}</b>
          <small>{time(o.delivered_at)}{o.city ? ` · ${o.city}` : ""}{o.sale ? " · بيع مندوب" : ""}</small>
        </span>
        <span className="amt">
          <b>{money(o.total)}</b>
          {o.debt > 0 ? <small className="debt">دين {money(o.debt)}</small> : <small className="paid">مدفوعة</small>}
        </span>
        <FiChevronDown className="chev fx-noprint" aria-hidden="true" />
      </button>
      <div className="body">
        {o.items.filter((i) => i.qty > 0).map((i, k) => (
          <div key={k} className="ln"><span>{num(i.qty)} × {i.name}{i.qty !== i.ordered ? <small> (الطلب {num(i.ordered)})</small> : null}</span><b>{money(i.qty * i.price)}</b></div>
        ))}
        {o.items.filter((i) => i.bonus > 0).map((i, k) => <div key={`b${k}`} className="ln ok"><span>+ {num(i.bonus)} {i.name} بونص</span><b>ببلاش</b></div>)}
        {o.exchanges.map((x, k) => <div key={`x${k}`} className="ln ex"><span>بدّلنا {num(x.qty)} {x.name} تالف</span><b>ببلاش</b></div>)}
        {o.items.filter((i) => i.damaged > 0).map((i, k) => <div key={`d${k}`} className="ln bad"><span>تالف رجع {num(i.damaged)} {i.name}</span><b>—</b></div>)}
        <div className="ft">
          <span>كاش <b>{money(o.cash)}</b></span>
          <button className="jd-mini fx-noprint" onClick={() => onInvoice({ id: o.id, invoice_token: o.invoice_token, customer_name: o.customer_name, phone: o.phone })}><FiFileText /> الفاتورة</button>
        </div>
      </div>
    </article>
  );
}

// تعديل الحمولة (الإدارة بس): كم صار على السيارة من كل صنف
function LoadEditSheet({ d, reload, onClose }) {
  const fx = useFx();
  const trips = d.trips.filter((t) => ["planned", "active", "returned"].includes(t.status) && !t.returns_received_at);
  const [tid, setTid] = useState(trips[0]?.id);
  const t = trips.find((x) => x.id === tid) || trips[0];
  const [vals, setVals] = useState({});
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");
  useEffect(() => { setVals(Object.fromEntries((t?.goods || []).map((g) => [g.product_id, String(g.loaded)]))); }, [tid]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!t) return null;
  const names = Object.fromEntries([...fx.boot.products.map((p) => [p.id, p.name]), ...t.goods.map((g) => [g.product_id, g.name])]);
  const ids = Object.keys(vals);
  return (
    <Sheet title={`حمولة ${t.vehicle_name}`} onClose={onClose}>
      <div className="fx-stack">
        {trips.length > 1 && <div className="fx-chips">{trips.map((x) => <button key={x.id} className={`fx-chip ${x.id === t.id ? "on" : ""}`} onClick={() => setTid(x.id)}>{x.kind === "sales" ? "مندوب" : "رحلة"} #{x.id}</button>)}</div>}
        <div className="fx-note sky">اكتب كم صار على السيارة من كل صنف. الفرق بينسجّل طالع أو راجع من المستودع، والجرد بيتعدّل لحاله، والسائق بيوصله إشعار.</div>
        {ids.map((pid) => {
          const g = t.goods.find((x) => x.product_id === Number(pid));
          return (
            <label key={pid} className="fx-field">
              <span>{names[pid]} {g ? <span className="fx-muted">(كان {num(g.loaded)} · سلّم {num(g.delivered + g.bonus + g.exchanged)})</span> : <span className="fx-muted">(جديد)</span>}</span>
              <input className="fx-input fx-num" style={{ textAlign: "center", fontSize: 20, fontWeight: 800 }} type="number" inputMode="numeric" min="0" value={vals[pid]} onChange={(e) => setVals({ ...vals, [pid]: e.target.value })} />
            </label>
          );
        })}
        <div className="fx-chips">{fx.boot.products.filter((p) => p.active && !(String(p.id) in vals)).map((p) => <button key={p.id} className="fx-chip" onClick={() => setVals({ ...vals, [p.id]: "0" })}>+ {p.name}</button>)}</div>
        <label className="fx-field">السبب (اختياري)<input className="fx-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مثلًا: رجع حمّل زيادة" /></label>
        <Err msg={err} />
        <Act className="fx-btn pri block fx-big" onClick={async () => {
          setErr("");
          try {
            const r = await fapi.loadEdit(t.id, { reason, items: ids.map((pid) => ({ product_id: Number(pid), loaded: vals[pid] === "" ? "" : Number(vals[pid]) || 0 })) });
            fx.toast(`انعدّلت الحمولة: ${r.changes.join("، ")}`);
            onClose(); reload();
          } catch (e) { setErr(e.message); }
        }}>احفظ الحمولة</Act>
      </div>
    </Sheet>
  );
}

// تسوية: المصاريف أول (وافق/ارفض)، بعدين قديش استلمت فعلًا
function SettleSheet({ d, canReview, reload, onClose }) {
  const fx = useFx();
  const S = d.settle;
  const exps = S.trips.flatMap((t) => t.expenses_list);
  const pending = exps.filter((e) => e.status === "pending");
  const okExp = exps.filter((e) => e.status === "approved").reduce((a, e) => a + e.amount, 0);
  const cash = S.trips.reduce((a, t) => a + t.cash, 0);
  const [handed, setHanded] = useState(String(S.due));
  const [touched, setTouched] = useState(false);
  useEffect(() => { if (!touched) setHanded(String(S.due)); }, [S.due, touched]);
  const h = Number(handed) || 0;
  const diff = Math.round((S.due - h) * 100) / 100;
  const [err, setErr] = useState("");
  return (
    <Sheet title={`تسوية مع ${d.driver_name}`} onClose={onClose}>
      <div className="fx-stack">
        <div className="fx-card">
          <div className="fx-kv"><span>كاش انقبض من الزباين</span><b>{money(cash)}</b></div>
          <div className="fx-kv"><span>− مصاريف موافق عليها</span><b>{money(okExp)}</b></div>
          {pending.length > 0 && <div className="fx-kv warn"><span>− مصاريف بستنى قرارك</span><b>{money(pending.reduce((a, e) => a + e.amount, 0))}</b></div>}
          <div className="fx-kv total"><span>المطلوب منه</span><b>{money(S.due)} د.أ</b></div>
          {S.trips.length > 1 && <small className="fx-muted">من {S.trips.length} رحلات{S.older > 0 ? ` (منها ${money(S.older)} من أيام قبل)` : ""}</small>}
        </div>

        {pending.length > 0 && (
          <div className="fx-stack" style={{ gap: 10 }}>
            <b>١. قرّر بالمصاريف</b>
            {pending.map((e) => <ExpenseRow key={e.id} e={e} canReview={canReview} reload={reload} />)}
            {!canReview && <div className="fx-note warn">ما عندك صلاحية توافق على المصاريف — خلي المسؤول يوافق أول.</div>}
          </div>
        )}

        <label className="fx-sf">{pending.length ? "٢. " : ""}قديش استلمت منه فعلًا؟
          <input className="fx-input fx-num" style={{ fontSize: 24, textAlign: "center", fontWeight: 800 }} type="number" inputMode="decimal" value={handed}
            onChange={(e) => { setTouched(true); setHanded(e.target.value); }} />
        </label>
        {handed !== "" && (diff > 0
          ? <div className="fx-note warn">ناقص <b>{money(diff)}</b> دينار — بينسجّل عهدة عليه.</div>
          : diff < 0 ? <div className="fx-note sky">زيادة <b>{money(-diff)}</b> دينار — بتنسجّل إله.</div>
          : <div className="fx-note ok">مطابق ✓</div>)}
        <Err msg={err} />
        <Act className="fx-btn ok block fx-big" disabled={pending.length > 0 || handed === ""} onClick={async () => {
          setErr("");
          try {
            const r = await fapi.jardSettle({ driver_id: d.driver_id, handed: h });
            fx.toast(r.diff > 0 ? `انسجّل — ناقص ${money(r.diff)} عهدة عليه` : "انسجّلت التسوية ✓");
            onClose(); reload();
          } catch (e) { setErr(e.message); }
        }}>✓ استلمت {money(h)} دينار — سكّر الحساب</Act>
      </div>
    </Sheet>
  );
}

const ST = { approved: ["ok", "معتمد"], rejected: ["crit", "مرفوض"], pending: ["warn", "بستنى موافقة"] };
function ExpenseRow({ e, canReview, reload }) {
  const fx = useFx();
  const [big, setBig] = useState(false);
  const [cls, label] = ST[e.status] || ST.pending;
  return (
    <div className="fx-jard-exp">
      {e.photo_url
        ? <button className="fx-plain ph" onClick={() => setBig(true)}><img src={e.photo_url} alt={`فاتورة ${e.kind}`} /></button>
        : <span className="ph none">بدون صورة</span>}
      <div className="t">
        <b>{e.kind} · {money(e.amount)} د.أ</b>
        <small>{time(e.created_at)}{e.liters ? ` · ${e.liters} لتر` : ""}{e.note ? ` · ${e.note}` : ""}</small>
        <span className={`fx-pill ${cls}`} style={{ justifySelf: "start" }}>{label}</span>
        {canReview && e.status === "pending" && (
          <div className="fx-row fx-noprint">
            <Act className="fx-btn ok sm" onClick={async () => { await fapi.approveExpense(e.id); fx.toast("انعتمد"); reload(); }}><FiCheck /> وافق</Act>
            <Act className="fx-btn danger sm" onClick={async () => { await fapi.rejectExpense(e.id); fx.toast("انرفض ورجع على السائق"); reload(); }}><FiX /> ارفض</Act>
          </div>
        )}
      </div>
      {big && (
        <div className="fx-jard-zoom" onClick={() => setBig(false)} role="dialog" aria-label="صورة الفاتورة">
          <img src={e.photo_url} alt={`فاتورة ${e.kind}`} />
        </div>
      )}
    </div>
  );
}
