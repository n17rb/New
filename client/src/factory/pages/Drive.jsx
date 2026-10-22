import { useCallback, useEffect, useState } from "react";
import { FiTruck, FiPhone, FiNavigation, FiAlertTriangle, FiPlus, FiMessageCircle, FiCheck, FiPlay } from "react-icons/fi";
import { fapi } from "../fapi.js";
import PushCard from "../PushCard.jsx";
import { InvoiceSheet } from "./StopSheet.jsx";
import TripsMap from "./TripsMap.jsx";
import { SalesStartCard, SalesDay, ExchangeEditor, exchangeList } from "./Sales.jsx";
import { Who, navUrl } from "./Who.jsx";
import { useFx, useLoad, Sheet, Tip, Err, Loading, Empty, Act, PhotoInput, SendMessages, ProductArt, getLocation, waLink, money, num, time, today } from "../ui.jsx";

// ============================================================
// شاشة السائق: كل إشي بكبسة — قبل ما يطلع، عند كل زبون، المصاريف، والرجعة
// ============================================================
export default function Drive() {
  const fx = useFx();
  const { data, error, reload } = useLoad(() => fapi.driverToday(), []);
  const [exps, setExps] = useState(null);
  const [sheet, setSheet] = useState(null);
  const [msgs, setMsgs] = useState(null);
  const [inv, setInv] = useState(null);
  const [me, setMe] = useState(null);
  const [busy, setBusy] = useState(false);
  const t = data?.trip;

  const loadExps = useCallback(() => fapi.myExpenses().then(setExps).catch(() => {}), []);
  useEffect(() => { loadExps(); }, [loadExps]);

  // مكاني على الخريطة (كل دقيقة)
  useEffect(() => {
    let on = true;
    const tick = () => getLocation(8000).then((l) => on && l && setMe([l.lat, l.lng]));
    tick();
    const i = setInterval(tick, 60000);
    return () => { on = false; clearInterval(i); };
  }, []);

  // الشاشة بتضل شاغلة والرحلة شغالة (عشان التتبع)
  useEffect(() => {
    if (t?.status !== "active" || !("wakeLock" in navigator)) return;
    let lock = null;
    navigator.wakeLock.request("screen").then((l) => { lock = l; }).catch(() => {});
    return () => { lock?.release?.().catch(() => {}); };
  }, [t?.status]);

  const done = (r) => {
    setSheet(null);
    reload();
    loadExps();
    if (r?.invoice_token) {
      setInv({ o: { id: r.order_id, invoice_token: r.invoice_token, customer_name: r.customer_name, phone: r.phone }, msg: r.message_id });
      return;
    }
    if (r?.message_ids?.length) setMsgs(r.message_ids);
    else if (r?.message_id) setMsgs([r.message_id]);
  };

  const stops = t?.stops || [];
  const open = stops.filter((o) => ["assigned", "onway"].includes(o.status));
  const current = t?.status === "active" ? open.find((o) => o.en_route_at) : null;
  const next = current ? null : open[0];

  async function act(fn, okMsg) {
    setBusy(true);
    try {
      const loc = await getLocation(6000);
      const r = await fn(loc || {});
      if (okMsg) fx.toast(okMsg);
      reload();
      if (r?.message_id) setMsgs([r.message_id]);
    } catch (e) { fx.toast(e.message); } finally { setBusy(false); }
  }

  const factory = fx.boot.factory?.point;
  const mapLive = me && t ? { factory, vehicles: [{ id: t.vehicle_id, lat: me[0], lng: me[1], heading: null, minutes_ago: 0 }] } : null;

  return (
    <div className="fx-page">
      <PushCard who="driver" />
      <Err msg={error} />
      {!data && !error && <Loading />}

      {data?.problems?.map((p) => (
        <div key={p.id} className="fx-drv-prob">
          <span>🔧 <b>{p.title.replace(/^.*?:\s*/, "")}</b><small>بلّغت الساعة {time(p.created_at)}</small></span>
          <Act className="fx-btn ok block" onClick={async () => { await fapi.problemResolve(p.id); fx.toast(p.kind === "breakdown" ? "تمام، الإدارة عرفت إن السيارة رجعت تشتغل" : "تمام، الإدارة عرفت"); reload(); }}>
            ✓ {p.kind === "breakdown" ? "السيارة رجعت تشتغل" : "انحلت المشكلة"}
          </Act>
          <button className="fx-link" onClick={async () => { await fapi.problemResolve(p.id, { mistake: true }); fx.toast("انلغى البلاغ"); reload(); }}>بعتها بالغلط — شيلها</button>
        </div>
      ))}

      {data?.unsettled?.length > 0 && (
        <div className="fx-note warn">لسا عليك تسلّم <b className="fx-num">{money(data.unsettled.reduce((a, u) => a + Number(u.cash_due || 0), 0))}</b> دينار للمحاسب من {data.unsettled.length === 1 ? "رحلة ماضية" : `${data.unsettled.length} رحلات ماضية`}.</div>
      )}
      {data && !t && (
        <Empty icon={FiTruck} title="ما في طلبات إلك اليوم" text="لما يوزعولك طلبات بتطلع هون وبيوصلك إشعار. أو اشتغل مندوب وبيع على المحلات." />
      )}

      {data && t?.status !== "active" && <SalesStartCard onStarted={() => { fx.toast("يلا! بالتوفيق 🛒"); reload(); }} />}

      {t?.kind === "sales" && (
        <SalesDay t={t} stock={data.car_stock} canCredit={data.can_credit} reload={reload}
          onSold={(r) => { reload(); setInv({ o: { id: r.order_id, invoice_token: r.invoice_token, customer_name: r.customer_name, phone: r.phone }, msg: r.message_id }); }}
          openSheet={(kind, o) => setSheet({ kind, o })} />
      )}

      {t && t.kind !== "sales" && (
        <>
          <div className="fx-drv-head">
            <b>رحلتي اليوم</b>
            <span>{stops.length} زبون · {num(t.load)} كرتونة · {t.vehicle_name}</span>
          </div>

          {/* الخطوة الجاية: زر وحدة كبير */}
          {t.status === "planned" && (
            <div className="fx-drv-step">
              <span className="lbl">أول زبون</span>
              <b className="nm">{stops[0]?.customer_name}</b>
              <Act className="fx-btn pri block fx-huge" disabled={busy} onClick={() => act((loc) => fapi.driverStart(t.id, loc), "يلا! بلشت الرحلة")}>
                <FiPlay /> ابدأ الرحلة
              </Act>
              <small className="fx-muted">أول ما تبلش بنحسب وقت وصولك للزبون الأول وبتبعتله رسالة.</small>
            </div>
          )}

          {current && (
            <div className="fx-drv-step go">
              <span className="lbl">🚚 رايح على</span>
              <Who o={current} />
              {current.eta_at && <span className="eta">بتوصل حوالي <b>{time(current.eta_at)}</b></span>}
              <span className="sub">{current.items.map((i) => `${num(i.qty)} ${i.name}`).join("، ")}</span>
              <div className="fx-grid2">
                <a className="fx-btn sky" href={navUrl(current)} target="_blank" rel="noreferrer"><FiNavigation /> الطريق</a>
                {current.phone ? <a className="fx-btn" href={`tel:${current.phone}`}><FiPhone /> اتصل</a> : <span />}
              </div>
              <button className="fx-btn ok block fx-huge" onClick={() => setSheet({ kind: "deliver", o: current })}><FiCheck /> وصلت — تم التسليم</button>
              <button className="fx-link" onClick={() => setSheet({ kind: "fail", o: current })}>ما زبط التسليم؟</button>
            </div>
          )}

          {t.status === "active" && next && (
            <div className="fx-drv-step">
              <span className="lbl">الزبون {stops.findIndex((o) => o.id === next.id) + 1} من {stops.length}</span>
              <Who o={next} />
              <span className="sub">{num(next.cartons)} كرتونة</span>
              <Act className="fx-btn pri block fx-huge" disabled={busy} onClick={() => act((loc) => fapi.driverGo(next.id, loc), "انحسب وقت وصولك")}>
                <FiNavigation /> انطلق لعنده
              </Act>
              <small className="fx-muted">بنحسب وقت وصولك من مكانك هلأ وبتبعتله رسالة.</small>
            </div>
          )}

          {t.status === "active" && open.length === 0 && (
            <div className="fx-drv-step">
              <b className="nm">خلصت كل الزباين 👏</b>
              <Act className="fx-btn pri block fx-huge" onClick={async () => { const r = await fapi.driverReturn(t.id, {}); fx.toast(`سلّم ${money(r.required_cash)} دينار للمحاسب`); reload(); }}>
                🏁 رجعت للمصنع
              </Act>
            </div>
          )}

          {t.status === "returned" && (
            <div className="fx-drv-step">
              <b className="nm">رجعت للمصنع ✓</b>
              <span className="sub">سلّم للمحاسب <b className="fx-num">{money(t.cash_due)}</b> دينار، والكراتين الراجعة للمستودع.</span>
            </div>
          )}

          {["planned", "active"].includes(t.status) && <TripsMap trips={[t]} live={mapLive} factory={factory} selected={null} onSelect={() => {}} height="34vh" />}

          <div className="fx-sec"><h2>زباينك بالترتيب</h2><span className="fx-muted" style={{ fontSize: 13 }}>{t.done}/{stops.length}</span></div>
          {open.length > 1 && ["planned", "active"].includes(t.status) && (
            <Act className="fx-btn sky block" disabled={busy} onClick={() => act((loc) => fapi.driverResort(t.id, loc), "ترتّبوا من مكانك: الأقرب فالأقرب")}>
              📍 رتّب الباقي من مكاني
            </Act>
          )}
          <small className="fx-muted">اكبس على أي زبون: تسلّمه أو تنطلق لعنده، بأي ترتيب بدك.</small>
          <div className="fx-drv-list">
            {stops.map((o, i) => {
              const isCur = current?.id === o.id;
              const isDone = ["delivered", "failed"].includes(o.status);
              return (
                <button key={o.id} className={`r fx-plain ${isCur ? "cur" : ""} ${isDone ? "done" : ""}`} style={{ width: "100%", textAlign: "start" }}
                  onClick={() => isDone
                    ? (o.status === "delivered" && setInv({ o: { id: o.id, invoice_token: o.invoice_token, customer_name: o.customer_name, phone: o.phone } }))
                    : setSheet({ kind: "stop", o })}>
                  <span className={`fx-n ${o.status === "delivered" ? "done" : o.status === "failed" ? "fail" : ""}`}>{o.status === "delivered" ? "✓" : o.status === "failed" ? "✗" : i + 1}</span>
                  <span className="t"><b>{o.customer_name}</b><small>{o.city} · {num(o.cartons)} كرتونة</small></span>
                  <small className="tm">{o.status === "delivered" ? `سلّمت ${time(o.delivered_at)}` : o.status === "failed" ? "ما تم" : isCur && o.eta_at ? time(o.eta_at) : "›"}</small>
                </button>
              );
            })}
          </div>

          {["active", "returned"].includes(t.status) && (
            <div className="fx-grid2">
              <button className="fx-btn" data-hl="expense-btn" onClick={() => setSheet({ kind: "expense" })}><FiPlus /> مصروف</button>
              <button className="fx-btn" onClick={() => setSheet({ kind: "cash" })}>حسابي اليوم</button>
            </div>
          )}
          <button className="fx-link" style={{ justifySelf: "start", color: "var(--fx-crit)" }} onClick={() => setSheet({ kind: "problem" })}><FiAlertTriangle /> صار معي مشكلة (عطل، حادث…)</button>
        </>
      )}

      {sheet?.kind === "deliver" && <DeliverSheet o={sheet.o} canCredit={data.can_credit} onClose={() => setSheet(null)} onDone={done} />}
      {sheet?.kind === "stop" && (
        <Sheet title={sheet.o.customer_name} onClose={() => setSheet(null)}>
          <div className="fx-stack">
            <Who o={sheet.o} big />
            <span className="sub fx-muted">{sheet.o.items.map((i) => `${num(i.qty)} ${i.name}`).join("، ")}</span>
            <button className="fx-btn ok block fx-huge" onClick={() => setSheet({ kind: "deliver", o: sheet.o })}><FiCheck /> تم التسليم</button>
            {current?.id !== sheet.o.id && (
              <Act className="fx-btn pri block" disabled={busy} onClick={async () => { const o = sheet.o; setSheet(null); await act((loc) => fapi.driverGo(o.id, loc), `انطلقت لعند ${o.customer_name}`); }}>
                <FiNavigation /> انطلق لعنده هلأ
              </Act>
            )}
            <div className="fx-grid2">
              <a className="fx-btn sky" href={navUrl(sheet.o)} target="_blank" rel="noreferrer"><FiNavigation /> الطريق</a>
              {sheet.o.phone ? <a className="fx-btn" href={`tel:${sheet.o.phone}`}><FiPhone /> اتصل</a> : <span />}
            </div>
            <button className="fx-link" onClick={() => setSheet({ kind: "fail", o: sheet.o })}>ما زبط التسليم؟</button>
          </div>
        </Sheet>
      )}
      {sheet?.kind === "fail" && <FailSheet o={sheet.o} onClose={() => setSheet(null)} onDone={done} />}
      {sheet?.kind === "problem" && <ProblemSheet onClose={() => setSheet(null)} onDone={() => { setSheet(null); reload(); }} />}
      {sheet?.kind === "expense" && <ExpenseSheet kinds={exps?.kinds || []} onClose={() => setSheet(null)} onDone={done} />}
      {sheet?.kind === "cash" && t && <CashSheet t={t} onClose={() => setSheet(null)} />}
      {msgs && <SendMessages ids={msgs} title="ابعت للزبون وقت وصولك" onClose={() => setMsgs(null)} />}
      {inv && <InvoiceSheet o={inv.o} title={`✓ ${t?.kind === "sales" ? "انباع" : "انسلّم"} · ${inv.o.customer_name}`} onClose={() => setInv(null)} onSent={() => inv.msg && fapi.messageSent(inv.msg).catch(() => {})} />}
    </div>
  );
}


function DeliverSheet({ o, canCredit, onClose, onDone }) {
  const fx = useFx();
  const [qty, setQty] = useState(() => Object.fromEntries(o.items.map((i) => [i.id, i.qty])));
  const [dmg, setDmg] = useState({});
  const [bon, setBon] = useState(() => Object.fromEntries(o.items.map((i) => [i.id, i.bonus_qty || 0])));
  const [showDmg, setShowDmg] = useState(false);
  const [added, setAdded] = useState({}); // منتجات زيادة أخذها الزبون من السيارة
  const [showAdd, setShowAdd] = useState(false);
  const [exch, setExch] = useState({}); // استبدال تالف عند الزبون
  const extraProducts = fx.boot.products.filter((p) => p.active && !o.items.some((i) => i.product_id === p.id));
  const total = o.items.reduce((s, i) => s + (Number(qty[i.id]) || 0) * i.price, 0)
    + Object.entries(added).reduce((s, [pid, q]) => s + (Number(q) || 0) * (fx.boot.products.find((p) => p.id === Number(pid))?.price || 0), 0);
  const [cash, setCash] = useState(() => (o.pay_terms === "credit" ? "" : String(Math.round(total * 100) / 100)));
  const [photo, setPhoto] = useState(null);
  const [overMsg, setOverMsg] = useState("");
  const [err, setErr] = useState("");
  const cashN = Number(cash) || 0;
  const debt = Math.max(0, total - cashN);

  async function send(confirm = false) {
    setErr("");
    const loc = await getLocation(5000);
    try {
      const r = await fapi.deliver(o.id, {
        items: o.items.map((i) => ({ item_id: i.id, delivered_qty: Number(qty[i.id]) || 0, damaged_qty: Number(dmg[i.id]) || 0, delivered_bonus: Number(bon[i.id]) || 0 })),
        add_items: Object.entries(added).filter(([, q]) => Number(q) > 0).map(([product_id, q]) => ({ product_id: Number(product_id), qty: Number(q) })),
        exchanges: exchangeList(exch),
        cash: cashN, photo_url: photo, lat: loc?.lat, lng: loc?.lng, confirm_over_limit: confirm,
      });
      fx.toast(r.remaining_stops ? `انسجل التسليم. باقي ${r.remaining_stops} وقفات.` : "انسجل التسليم. خلصت كل الوقفات!");
      onDone(r);
    } catch (e) {
      if (/سقف|زبون كاش/.test(e.message)) setOverMsg(e.message);
      else setErr(e.message);
    }
  }

  return (
    <Sheet title={`تسليم: ${o.customer_name}`} onClose={onClose}>
      <div className="fx-stack">
        {o.customer_balance > 0 && (
          <div className="fx-debt-alert">
            <span>⚠️ <b>{o.customer_name}</b> عليه دين قديم <b>{money(o.customer_balance)}</b> دينار. ذكّره بلطف — إذا بدّه يدفع، زيده على الكاش.</span>
            <button type="button" className="fx-btn sm" onClick={() => setCash(String(Math.round((total + o.customer_balance) * 100) / 100))}>دفع الفاتورة + الدين ({money(total + o.customer_balance)})</button>
          </div>
        )}
        <div className="fx-note sky">سلّم حسب اللي أخذه الزبون: نزّل أو زيد العدد. الفاتورة بتنحسب على اللي سلّمته.</div>
        {o.items.map((i) => {
          const got = Number(qty[i.id]);
          const back = Number.isFinite(got) && got < i.qty ? i.qty - got : 0;
          const more = Number.isFinite(got) && got > i.qty ? got - i.qty : 0;
          return (
          <label key={i.id} className="fx-field">
            <span className="fx-row" style={{ flexWrap: "nowrap" }}><ProductArt p={i} size={36} />{i.name} <span className="fx-muted">(المطلوب {num(i.qty)})</span></span>
            <div className="fx-stepper big">
              <button type="button" dir="ltr" onClick={() => setQty({ ...qty, [i.id]: Math.max(0, (Number(qty[i.id]) || 0) - 1) })} aria-label="ناقص">−</button>
              <input className="fx-input" type="number" inputMode="numeric" min="0" value={qty[i.id]} onChange={(e) => setQty({ ...qty, [i.id]: e.target.value })} aria-label={`سلّم من ${i.name}`} />
              <button type="button" dir="ltr" onClick={() => setQty({ ...qty, [i.id]: (Number(qty[i.id]) || 0) + 1 })} aria-label="زايد">+</button>
            </div>
            {back > 0 && <small style={{ color: "#b06a00", fontWeight: 600 }}>سلّمت {num(got)} بدل {num(i.qty)} · بيرجع معك {num(back)} كرتونة</small>}
            {more > 0 && <small style={{ color: "var(--fx-navy)", fontWeight: 600 }}>أخذ {num(more)} زيادة من اللي معك بالسيارة</small>}
            {i.bonus_qty > 0 && (
              <span className="fx-bonus" style={{ marginTop: 6 }}>
                + بونص ببلاش
                <input className="fx-input" style={{ width: 80, padding: "6px 8px", textAlign: "center" }} type="number" inputMode="numeric" min="0" max={i.bonus_qty} value={bon[i.id]} onChange={(e) => setBon({ ...bon, [i.id]: e.target.value })} aria-label={`بونص ${i.name}`} />
                كرتونة (ما بتنحسب بالفاتورة)
              </span>
            )}
          </label>
          );
        })}
        {Object.keys(added).map((pid) => {
          const p = fx.boot.products.find((x) => x.id === Number(pid));
          const q = Number(added[pid]) || 0;
          return (
            <div key={pid} className="fx-field">
              <span className="fx-row" style={{ flexWrap: "nowrap" }}><ProductArt p={p} size={36} />{p?.name} <span className="fx-muted">(زيادة)</span></span>
              <div className="fx-stepper big">
                <button type="button" dir="ltr" onClick={() => setAdded((a) => { const n = { ...a, [pid]: Math.max(0, q - 1) }; if (!n[pid]) delete n[pid]; return n; })} aria-label="ناقص">−</button>
                <input className="fx-input" type="number" inputMode="numeric" min="0" value={added[pid]} onChange={(e) => setAdded({ ...added, [pid]: e.target.value })} aria-label={`زيادة ${p?.name}`} />
                <button type="button" dir="ltr" onClick={() => setAdded({ ...added, [pid]: q + 1 })} aria-label="زايد">+</button>
              </div>
            </div>
          );
        })}
        {extraProducts.length > 0 && (!showAdd ? (
          <button className="fx-link" style={{ justifySelf: "start" }} onClick={() => setShowAdd(true)}>+ أخذ منتج ثاني من السيارة؟</button>
        ) : (
          <div className="fx-chips">
            {extraProducts.filter((p) => !(String(p.id) in added)).map((p) => <button key={p.id} className="fx-chip" onClick={() => { setAdded({ ...added, [p.id]: 1 }); setShowAdd(false); }}>{p.name}</button>)}
          </div>
        ))}
        <ExchangeEditor value={exch} onChange={setExch} products={fx.boot.products.filter((p) => p.active)} />
        {!showDmg ? (
          <button className="fx-link" style={{ justifySelf: "start" }} onClick={() => setShowDmg(true)}>في كراتين تالفة من حمولتي؟</button>
        ) : (
          o.items.map((i) => (
            <label key={i.id} className="fx-field">تالف من {i.name}
              <input className="fx-input" type="number" inputMode="numeric" min="0" value={dmg[i.id] || ""} onChange={(e) => setDmg({ ...dmg, [i.id]: e.target.value })} />
            </label>
          ))
        )}
        <div className="fx-card">
          <div className="fx-kv"><span>قيمة الفاتورة</span><b>{money(total)}</b></div>
          <label className="fx-field" style={{ paddingBlock: 8 }}>دفع كاش (دينار)
            <input className="fx-input" type="number" inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value)} placeholder="0" />
          </label>
          <div className={`fx-kv ${debt > 0 ? "bad" : ""}`}><span>عليه دين</span><b>{money(debt)}</b></div>
          <div className="fx-kv"><span>رصيده بعد الفاتورة</span><b>{money(o.customer_balance + debt - Math.max(0, cashN - total))}</b></div>
        </div>
        {debt > 0 && !canCredit && <div className="fx-note crit">ما عندك صلاحية تبيع بالدين — خذ المبلغ كامل.</div>}
        <PhotoInput label="صوّر البضاعة عند الزبون (اختياري)" value={photo} onChange={setPhoto} kind="proof" />
        {overMsg && (
          <div className="fx-note warn fx-stack">
            <span>{overMsg}</span>
            <Act className="fx-btn sm" onClick={() => send(true)}>كمّل وبلّغ الإدارة</Act>
          </div>
        )}
        <Err msg={err} />
        <Act className="fx-btn pri block" onClick={() => send(false)}>أكّد التسليم</Act>
      </div>
    </Sheet>
  );
}

const FAILS = ["المحل مسكّر", "الزبون رفض الاستلام", "ما معه مصاري", "ما لقيت الموقع"];
function FailSheet({ o, onClose, onDone }) {
  const fx = useFx();
  const [reason, setReason] = useState("");
  const [photo, setPhoto] = useState(null);
  return (
    <Sheet title={`ما تم: ${o.customer_name}`} onClose={onClose}>
      <div className="fx-stack">
        <div className="fx-chips">{FAILS.map((r) => <button key={r} className={`fx-chip ${reason === r ? "on" : ""}`} onClick={() => setReason(r)}>{r}</button>)}</div>
        <PhotoInput label="صوّر المحل" hint="إثبات إنك وصلت" value={photo} onChange={setPhoto} kind="fail" />
        <Act className="fx-btn pri block" disabled={!reason || !photo} onClick={async () => {
          const loc = await getLocation(5000);
          const r = await fapi.fail(o.id, { reason, photo_url: photo, lat: loc?.lat, lng: loc?.lng });
          fx.toast("انسجل ووصل للإدارة");
          onDone(r);
        }}>سجّل وبلّغ الإدارة</Act>
      </div>
    </Sheet>
  );
}

const PROBLEMS = ["عطل بالسيارة", "حادث", "بضاعة مضروبة", "مشكلة بالدفع", "الطريق مسكّر", "غيره"];
function ProblemSheet({ onClose, onDone }) {
  const fx = useFx();
  const [kind, setKind] = useState("");
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState(null);
  const [product, setProduct] = useState(fx.boot.products[0]?.id || "");
  const [qty, setQty] = useState("");
  const [sent, setSent] = useState(false);
  if (sent) {
    return (
      <Sheet title="وصل البلاغ" onClose={onDone}>
        <div className="fx-stack">
          <div className="fx-note ok">وصل تنبيه للإدارة فورًا مع موقعك.</div>
          {kind === "عطل بالسيارة" && <p style={{ margin: 0 }}>مسؤول الحركة رح يبلّغ زباينك بالتأخير، أو ينقل طلباتك لسيارة ثانية.</p>}
          <button className="fx-btn block" onClick={onDone}>رجوع</button>
        </div>
      </Sheet>
    );
  }
  return (
    <Sheet title="بلّغ عن مشكلة" onClose={onClose}>
      <div className="fx-stack">
        <div className="fx-chips">{PROBLEMS.map((r) => <button key={r} className={`fx-chip ${kind === r ? "on" : ""}`} onClick={() => setKind(r)}>{r}</button>)}</div>
        {kind === "بضاعة مضروبة" && (
          <div className="fx-grid2">
            <select value={product} onChange={(e) => setProduct(e.target.value)} aria-label="المنتج">{fx.boot.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
            <input className="fx-input" type="number" inputMode="numeric" placeholder="كم كرتونة" value={qty} onChange={(e) => setQty(e.target.value)} />
          </div>
        )}
        <label className="fx-field">تفاصيل (اختياري)<textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="شو صار؟" /></label>
        <PhotoInput label="صوّر (اختياري)" value={photo} onChange={setPhoto} kind="problem" />
        <Act className="fx-btn danger block" disabled={!kind} onClick={async () => {
          const loc = await getLocation(5000);
          await fapi.problem({ kind, note, photo_url: photo, lat: loc?.lat, lng: loc?.lng, product_id: kind === "بضاعة مضروبة" ? product : undefined, qty: kind === "بضاعة مضروبة" ? qty : undefined });
          setSent(true);
        }}>ابعت للإدارة هلأ</Act>
      </div>
    </Sheet>
  );
}

function ExpenseSheet({ kinds, onClose, onDone }) {
  const fx = useFx();
  const [kind, setKind] = useState("ديزل");
  const [amount, setAmount] = useState("");
  const [liters, setLiters] = useState("");
  const [photo, setPhoto] = useState(null);
  const [note, setNote] = useState("");
  const diesel = kind === "ديزل";
  return (
    <Sheet title="مصروف جديد" onClose={onClose}>
      <div className="fx-stack">
        <div className="fx-chips">{(kinds.length ? kinds : ["ديزل"]).map((k) => <button key={k} className={`fx-chip ${kind === k ? "on" : ""}`} onClick={() => setKind(k)}>{k}</button>)}</div>
        <div className="fx-grid2">
          <label className="fx-field">المبلغ (دينار)<input className="fx-input" type="number" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
          {diesel && <label className="fx-field">كم لتر (اختياري)<input className="fx-input" type="number" inputMode="decimal" value={liters} onChange={(e) => setLiters(e.target.value)} /></label>}
        </div>
        <label className="fx-field">ملاحظة (اختياري)<input className="fx-input" value={note} onChange={(e) => setNote(e.target.value)} /></label>
        <PhotoInput label="صوّر الفاتورة (اختياري)" value={photo} onChange={setPhoto} kind="receipt" />
        <div className="fx-note">المصروف بينخصم من الكاش اللي بتسلّمه. إذا الإدارة رفضته بيرجع عليك.</div>
        <Act className="fx-btn pri block" disabled={!(Number(amount) > 0)} onClick={async () => {
          await fapi.addExpense({ kind, amount, liters, photo_url: photo, note });
          fx.toast("انبعت للإدارة للموافقة");
          onDone();
        }}>ابعت للإدارة</Act>
      </div>
    </Sheet>
  );
}

function CashSheet({ t, onClose }) {
  return (
    <Sheet title="حسابي اليوم" onClose={onClose}>
      <div className="fx-card">
        <div className="fx-kv"><span>كاش محصّل من الزباين</span><b>{money(t.collected)}</b></div>
        {t.expenses.filter((e) => e.status !== "rejected").map((e) => (
          <div key={e.id} className="fx-kv"><span>− {e.kind}{e.status === "pending" ? " (بانتظار الموافقة)" : ""}</span><b>{money(e.amount)}</b></div>
        ))}
        <div className="fx-kv total"><span>المطلوب تسلّمه</span><b>{money(t.cash_due)} د.أ</b></div>
      </div>
      <p className="fx-muted">مثال: حصّلت 500 وعبّيت ديزل بـ20، بتسلّم 480. إذا سلّمت أقل، الفرق بينسجّل عهدة عليك.</p>
    </Sheet>
  );
}

