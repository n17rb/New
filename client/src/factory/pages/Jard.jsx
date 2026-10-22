import { useEffect, useState } from "react";
import { FiChevronRight, FiChevronLeft, FiChevronDown, FiPrinter, FiCheck, FiX } from "react-icons/fi";
import { fapi } from "../fapi.js";
import { useFx, useLoad, Sheet, Err, Loading, Empty, Act, money, num, time, date, today } from "../ui.jsx";
import { InvoiceSheet } from "./StopSheet.jsx";

// ============================================================
// الجرد: لكل سائق بشاشة وحدة —
// شو معه كاش، شو لازم يرجّع، كل الفواتير تحت بعض، والمصاريف بصورها
// ============================================================
const shift = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

export default function Jard() {
  const fx = useFx();
  const mine = fx.can("f_drive", "edit") && !fx.can("f_money") && !fx.can("f_home") && !fx.can("f_stock") && !fx.can("f_dispatch");
  const [day, setDay] = useState(today());
  const [who, setWho] = useState(0);
  const { data, error, reload } = useLoad(() => (mine ? fapi.myJard({ date: day }) : fapi.jard({ date: day })), [day, mine]);
  const [inv, setInv] = useState(null);
  const drivers = data?.drivers || [];
  const shown = who ? drivers.filter((d) => d.driver_id === who) : drivers;
  const isToday = day === today();

  return (
    <div className="fx-page fx-jard">
      <div className="fx-row" style={{ justifyContent: "space-between" }}>
        <h1 className="fx-h1" style={{ margin: 0 }}>{mine ? "جردي" : "الجرد"}</h1>
        <button className="fx-btn sm fx-noprint" onClick={() => window.print()}><FiPrinter /> اطبع</button>
      </div>

      <div className="fx-jard-day fx-noprint">
        <button className="fx-plain" onClick={() => setDay(shift(day, -1))} aria-label="اليوم اللي قبل"><FiChevronRight /></button>
        <b>{isToday ? "اليوم" : day === shift(today(), -1) ? "مبارح" : ""} {date(day)}</b>
        <button className="fx-plain" disabled={isToday} onClick={() => setDay(shift(day, 1))} aria-label="اليوم اللي بعد"><FiChevronLeft /></button>
      </div>

      {!mine && drivers.length > 1 && (
        <div className="fx-chips fx-noprint">
          <button className={`fx-chip ${who === 0 ? "on" : ""}`} onClick={() => setWho(0)}>الكل ({drivers.length})</button>
          {drivers.map((d) => <button key={d.driver_id || 0} className={`fx-chip ${who === d.driver_id ? "on" : ""}`} onClick={() => setWho(d.driver_id)}>{d.driver_name}</button>)}
        </div>
      )}

      <Err msg={error} />
      {!data && !error && <Loading />}
      {data && drivers.length === 0 && <Empty title="ما في شغل بهاليوم" text="لما سائق يطلع برحلة أو يشتغل مندوب بيطلع جرده هون." />}

      {shown.map((d) => <DriverJard key={d.driver_id || 0} d={d} mine={mine} canReview={data.can_review} canSettle={data.can_settle} reload={reload} onInvoice={setInv} />)}

      {inv && <InvoiceSheet o={inv} title={`فاتورة · ${inv.customer_name}`} onClose={() => setInv(null)} />}
    </div>
  );
}

function DriverJard({ d, mine, canReview, canSettle, reload, onInvoice }) {
  const T = d.totals;
  const S = d.settle || { trips: [], due: 0, older: 0, active: 0 };
  const [showInv, setShowInv] = useState(false);
  const [settling, setSettling] = useState(false);
  const toSettle = S.trips.length > 0;
  const vehicles = [...new Set(d.trips.map((t) => t.vehicle_name))].join("، ");
  const returned = d.trips.some((t) => t.returns_received_at);
  const allBack = d.trips.every((t) => t.returns_received_at || !t.load_confirmed);
  return (
    <section className="fx-jard-drv">
      <header className="fx-jard-h">
        <span className="av">{(d.driver_name || "؟").trim()[0]}</span>
        <span className="t">
          <b>{mine ? "حسابي" : d.driver_name}</b>
          <small>{vehicles} · {d.trips.length === 1 ? (d.trips[0].kind === "sales" ? "مندوب" : "رحلة") : `${d.trips.length} رحلات`}</small>
        </span>
        <span className={`fx-pill ${T.settled ? "ok" : "warn"}`}>{T.settled ? "تسكّر ✓" : "لسا مفتوح"}</span>
      </header>

      {/* الأهم: كاش ومرتجع */}
      <div className="fx-jard-big">
        <div className={`tile ${toSettle ? "cash" : S.active ? "wait" : "ok"}`}>
          <small>{toSettle ? (mine ? "عليك تسلّم" : "عليه يسلّم") : S.active ? "لسا شغال" : "سلّم كاش"}</small>
          <b>{money(toSettle ? S.due : S.active ? T.cash : T.handed)}</b>
          <small>{toSettle && S.older > 0 ? `منها ${money(S.older)} من أيام قبل` : toSettle ? "دينار" : S.active ? "كاش معه لهلأ" : "دينار ✓"}</small>
        </div>
        <div className={`tile ${allBack && returned ? "ok" : "box"}`}>
          <small>{mine ? "رجّع للمستودع" : "لازم يرجّع"}</small>
          <b>{num(T.cartons_back)}</b>
          <small>كرتونة{T.damaged_from_customers ? ` + ${num(T.damaged_from_customers)} تالف` : ""}</small>
        </div>
      </div>

      {!mine && canSettle && toSettle && (
        <button className="fx-btn ok block fx-big" onClick={() => setSettling(true)}>💵 استلمت من {d.driver_name.split(" ")[0]} — تسوية</button>
      )}
      {!mine && !toSettle && S.active > 0 && <div className="fx-note">لسا شغال. لما يكبس «رجعت للمصنع» بيطلعلك زر التسوية هون.</div>}
      {settling && <SettleSheet d={d} canReview={canReview} reload={reload} onClose={() => setSettling(false)} />}

      {/* المصاري */}
      <div className="fx-card fx-jard-money">
        <h3>المصاري</h3>
        <div className="fx-kv"><span>فواتير ({T.invoices_count})</span><b>{money(T.invoices)}</b></div>
        <div className="fx-kv"><span>كاش انقبض من الزباين</span><b>{money(T.cash)}</b></div>
        {T.debt > 0 && <div className="fx-kv warn"><span>دين على الزباين</span><b>{money(T.debt)}</b></div>}
        {T.expenses > 0 && <div className="fx-kv"><span>− مصاريف</span><b>{money(T.expenses)}</b></div>}
        <div className="fx-kv total"><span>المطلوب يتسلّم</span><b>{money(T.due)} د.أ</b></div>
        {T.handed > 0 && <div className="fx-kv"><span>انستلم فعلًا</span><b>{money(T.handed)}</b></div>}
        {d.custody !== 0 && <div className={`fx-kv ${d.custody > 0 ? "bad" : ""}`}><span>{d.custody > 0 ? "عهدة عليه من قبل" : "إله من قبل"}</span><b>{money(Math.abs(d.custody))}</b></div>}
      </div>

      {/* البضاعة */}
      {d.goods.length > 0 && (
        <div className="fx-card">
          <h3 style={{ marginTop: 0 }}>البضاعة</h3>
          <small className="fx-muted">يرجع = طلع − سلّم − بونص − بدل تالف − تالف</small>
          <div className="fx-jard-goods">
            {d.goods.map((g) => (
              <div key={g.product_id} className="g">
                <div className="top">
                  <b>{g.name}</b>
                  <span className="back">يرجع <b>{num(g.back)}</b>{returned ? <small> · رجع {num(g.returned)}{g.returned < g.back ? <em> (ناقص {num(g.back - g.returned)})</em> : ""}</small> : null}</span>
                </div>
                <div className="nums">
                  <span>طلع <b>{num(g.loaded)}</b></span>
                  <span>سلّم <b>{num(g.delivered)}</b></span>
                  {g.bonus > 0 && <span className="ok">بونص <b>{num(g.bonus)}</b></span>}
                  {g.exchanged > 0 && <span className="ex">بدل تالف <b>{num(g.exchanged)}</b></span>}
                  {g.damaged > 0 && <span className="bad">تلف بالسيارة <b>{num(g.damaged)}</b></span>}
                </div>
                {g.over > 0 && <small className="over">⚠️ سلّم {num(g.over)} أكثر من اللي انسجّل إنه طلع — في تحميل ما انسجّل، تأكد مع المستودع.</small>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* المصاريف بصورها */}
      {d.trips.some((t) => t.expenses.length) && (
        <div className="fx-card">
          <h3 style={{ marginTop: 0 }}>المصاريف</h3>
          <div className="fx-stack" style={{ gap: 10 }}>
            {d.trips.flatMap((t) => t.expenses).map((e) => <ExpenseRow key={e.id} e={e} canReview={canReview && !mine} reload={reload} />)}
          </div>
        </div>
      )}

      {/* الفواتير تحت بعض */}
      {T.invoices_count > 0 && (
        <button className={`fx-jard-invbtn fx-noprint ${showInv ? "on" : ""}`} onClick={() => setShowInv(!showInv)} aria-expanded={showInv}>
          <span>🧾 الفواتير اللي سلّمها <b>({T.invoices_count})</b></span>
          <span className="amt">{money(T.invoices)}</span>
          <FiChevronDown className="chev" />
        </button>
      )}
      <div className={`fx-jard-invs ${showInv ? "" : "closed"}`}>
        {d.trips.flatMap((t) => t.invoices).map((o) => (
          <article key={o.id} className="fx-jard-inv">
            <div className="hd">
              <span className="t"><b>{o.customer_name}</b><small>#{o.id} · {time(o.delivered_at)}{o.city ? ` · ${o.city}` : ""}{o.sale ? " · بيع مندوب" : ""}</small></span>
              <button className="fx-btn sm fx-noprint" onClick={() => onInvoice({ id: o.id, invoice_token: o.invoice_token, customer_name: o.customer_name, phone: o.phone })}>الفاتورة</button>
            </div>
            <div className="lines">
              {o.items.filter((i) => i.qty > 0).map((i, k) => (
                <div key={k} className="ln"><span>{num(i.qty)} × {i.name}{i.qty !== i.ordered ? <small> (الطلب {num(i.ordered)})</small> : null}</span><b>{money(i.qty * i.price)}</b></div>
              ))}
              {o.items.filter((i) => i.bonus > 0).map((i, k) => (
                <div key={`b${k}`} className="ln ok"><span>+ {num(i.bonus)} {i.name} بونص</span><b>ببلاش</b></div>
              ))}
              {o.exchanges.map((x, k) => (
                <div key={`x${k}`} className="ln ex"><span>🔁 بدّلنا {num(x.qty)} {x.name} تالف بجديد</span><b>ببلاش</b></div>
              ))}
              {o.items.filter((i) => i.damaged > 0).map((i, k) => (
                <div key={`d${k}`} className="ln bad"><span>تالف رجع معه {num(i.damaged)} {i.name}</span><b>—</b></div>
              ))}
            </div>
            <div className="ft">
              <span>المجموع <b>{money(o.total)}</b></span>
              <span>كاش <b>{money(o.cash)}</b></span>
              {o.debt > 0 ? <span className="debt">دين <b>{money(o.debt)}</b></span> : <span className="paid">مدفوعة ✓</span>}
            </div>
          </article>
        ))}

        {showInv && T.invoices_count > 2 && <button className="fx-link fx-noprint" style={{ justifySelf: "center" }} onClick={() => setShowInv(false)}>▴ سكّر الفواتير</button>}
      </div>

      {d.trips.some((t) => t.failed.length || t.open.length) && (
        <div className="fx-card">
          {d.trips.flatMap((t) => t.failed).map((o) => <div key={o.id} className="fx-kv bad"><span>✗ {o.customer_name} — {o.reason || "ما تم"}</span><b>{num(o.cartons)} كرتونة</b></div>)}
          {d.trips.flatMap((t) => t.open).map((o) => <div key={o.id} className="fx-kv"><span>⏳ {o.customer_name} — لسا ما انسلّم</span><b>{num(o.cartons)} كرتونة</b></div>)}
        </div>
      )}
    </section>
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
