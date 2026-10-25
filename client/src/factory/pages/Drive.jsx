import { useCallback, useEffect, useRef, useState } from "react";
import { FiTruck, FiPhone, FiNavigation, FiAlertTriangle, FiPlus, FiMessageCircle, FiCheck, FiPlay } from "react-icons/fi";
import { fapi } from "../fapi.js";
import PushCard from "../PushCard.jsx";
import { InvoiceSheet } from "./StopSheet.jsx";
import TripsMap from "./TripsMap.jsx";
import { SalesStartCard, SalesDay, ExchangeEditor, exchangeList, PayBox, SellSheet } from "./Sales.jsx";
import { Who, navUrl } from "./Who.jsx";
import { sendOrQueue, useOutbox, dismissFailed, flush } from "../outbox.js";
import { PaySheet } from "./Debts.jsx";
import { smartFilter } from "../smartSearch.js";
import { useFx, useLoad, Sheet, Tip, Err, Loading, Empty, Act, PhotoInput, SendMessages, ProductArt, getLocation, waLink, money, num, time, today, bonusPreview } from "../ui.jsx";

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

  // لما الصادر يخلص (رجعت الشبكة) منحدّث الشاشة
  const boxN = useOutbox().items.length;
  const prevN = useRef(boxN);
  useEffect(() => { if (boxN < prevN.current) { reload(); } prevN.current = boxN; }, [boxN]); // eslint-disable-line react-hooks/exhaustive-deps

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
    if (r?.queued) return; // بينبعت لحاله لما ترجع الشبكة
    reload();
    loadExps();
    if (r?.invoice_token) {
      setInv({ o: { id: r.order_id, invoice_token: r.invoice_token, customer_name: r.customer_name, phone: r.phone }, msg: r.message_id });
      return;
    }
    if (r?.message_ids?.length) setMsgs(r.message_ids);
    else if (r?.message_id) setMsgs([r.message_id]);
  };

  // اللي انحفظ على التلفون (بدون شبكة) بيبين كأنه خلص
  const box = useOutbox();
  const queuedDone = new Map(box.items.filter((x) => x.kind === "deliver" || x.kind === "fail").map((x) => [x.ref, x.kind]));
  const stops = (t?.stops || []).map((o) => (queuedDone.has(o.id) && !["delivered", "failed"].includes(o.status) ? { ...o, status: queuedDone.get(o.id) === "deliver" ? "delivered" : "failed", queued: true } : o));
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
      <OutboxBar />
      {data?.offline && <div className="fx-note warn">📶 ما في شبكة — عم تشوف آخر نسخة محفوظة. شغلك بينحفظ على التلفون وبينبعت لحاله.</div>}
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
          onSold={(r) => { if (r?.queued) return; reload(); setInv({ o: { id: r.order_id, invoice_token: r.invoice_token, customer_name: r.customer_name, phone: r.phone }, msg: r.message_id }); }}
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

          {t.status === "active" && (
            <div className="fx-grid2">
              <button className="fx-btn sky" onClick={() => setSheet({ kind: "walkin" })}>🛒 بيع لزبون عالطريق</button>
              <button className="fx-btn" onClick={() => setSheet({ kind: "debt" })}>💵 قبض دين</button>
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
      {sheet?.kind === "debt" && <PickDebtor onClose={() => setSheet(null)} onPick={(c) => setSheet({ kind: "pay", c })} />}
      {sheet?.kind === "pay" && <PaySheet c={sheet.c} byDriver onClose={() => setSheet(null)} onDone={(r) => { setSheet(null); reload(); if (r?.message_id) setMsgs([r.message_id]); }} />}
      {sheet?.kind === "walkin" && t && (
        <SellSheet t={t} stock={data.car_stock} canCredit={data.can_credit} onClose={() => setSheet(null)}
          onDone={(r) => { setSheet(null); if (r?.queued) return; reload(); setInv({ o: { id: r.order_id, invoice_token: r.invoice_token, customer_name: r.customer_name, phone: r.phone }, msg: r.message_id }); }} />
      )}
      {sheet?.kind === "expense" && <ExpenseSheet kinds={exps?.kinds || []} onClose={() => setSheet(null)} onDone={done} />}
      {sheet?.kind === "cash" && t && <CashSheet t={t} onClose={() => setSheet(null)} />}
      {msgs && <SendMessages ids={msgs} title="ابعت للزبون وقت وصولك" onClose={() => setMsgs(null)} />}
      {inv && <InvoiceSheet o={inv.o} title={`✓ ${t?.kind === "sales" ? "انباع" : "انسلّم"} · ${inv.o.customer_name}`} onClose={() => setInv(null)} onSent={() => inv.msg && fapi.messageSent(inv.msg).catch(() => {})} />}
    </div>
  );
}


export function DeliverSheet({ o, canCredit, onClose, onDone }) {
  const fx = useFx();
  const [qty, setQty] = useState(() => Object.fromEntries(o.items.map((i) => [i.id, i.qty])));
  const [dmg, setDmg] = useState({});
  // البونص بيمشي مع الكمية لحاله (حسب قاعدة البونص)، إلا إذا انعدّل بالإيد
  const [bonEdit, setBonEdit] = useState({});
  const canBonus = fx.canAction?.("give_bonus");
  const rules = fx.boot.bonus_rules;
  const autoBon = (i) => (i.bonus_manual ? i.bonus_qty || 0 : bonusPreview(rules, o.customer_id, i.product_id, Number(qty[i.id]) || 0));
  const bon = Object.fromEntries(o.items.map((i) => [i.id, bonEdit[i.id] ?? autoBon(i)]));
  const setBon = (f) => setBonEdit((x) => f(x));
  const [freeB, setFreeB] = useState({}); // 🎁 بونص حر على أي صنف
  const [extra, setExtra] = useState(""); // add | exch | dmg | bonus — الإشي الزيادة المفتوح
  const [added, setAdded] = useState({}); // منتجات زيادة أخذها الزبون من السيارة
  const [exch, setExch] = useState({}); // استبدال تالف عند الزبون
  const extraProducts = fx.boot.products.filter((p) => p.active && !o.items.some((i) => i.product_id === p.id));
  // أسعار هالزبون (الخاصة) للمنتجات الزيادة — نفس اللي السيرفر بيحسبه
  const [prices, setPrices] = useState({});
  useEffect(() => { fapi.driverPrices(o.customer_id).then(setPrices).catch(() => {}); }, [o.customer_id]);
  const total = Math.round((o.items.reduce((s, i) => s + (Number(qty[i.id]) || 0) * i.price, 0)
    + Object.entries(added).reduce((s, [pid, q]) => s + (Number(q) || 0) * Number(prices[pid] ?? fx.boot.products.find((p) => p.id === Number(pid))?.price ?? 0), 0)) * 100) / 100;
  // الكاش بيمشي مع الفاتورة لحاله، إلا إذا اختار «دفع جزء» أو «كله دين»
  const [cashEdit, setCashEdit] = useState(() => (o.pay_terms === "credit" && canCredit ? "0" : null)); // null = دفع كامل
  const cashN = Number(cashEdit ?? total) || 0;
  const debt = Math.max(0, total - cashN);
  const [photo, setPhoto] = useState(null);
  const [err, setErr] = useState("");
  // كليك: جزء من المدفوع (أو كله) حوّله الزبون — ما بينحسب على كاشك
  const [cliqOn, setCliqOn] = useState(false);
  const [cliq, setCliq] = useState("");
  const [cliqPhoto, setCliqPhoto] = useState(null);
  const cliqN = cliqOn ? Math.min(cashN, Number(cliq) || 0) : 0;
  const cliqMissing = cliqN > 0 && !cliqPhoto;

  async function send() {
    setErr("");
    const loc = await getLocation(5000);
    try {
      // الدين فوق السقف ما بيوقف السائق — بيوصل تنبيه للإدارة لحاله
      const q = await sendOrQueue({ kind: "deliver", ref: o.id, label: `تسليم ${o.customer_name}`, path: `/driver/orders/${o.id}/deliver`, body: {
        items: o.items.map((i) => ({ item_id: i.id, delivered_qty: Number(qty[i.id]) || 0, damaged_qty: Number(dmg[i.id]) || 0, delivered_bonus: Number(bon[i.id]) || 0 })),
        add_items: [
          ...Object.entries(added).filter(([, q]) => Number(q) > 0).map(([product_id, q]) => ({ product_id: Number(product_id), qty: Number(q) })),
          ...Object.entries(freeB).filter(([, q]) => Number(q) > 0).map(([product_id, q]) => ({ product_id: Number(product_id), qty: 0, bonus: Number(q) })),
        ],
        exchanges: exchangeList(exch),
        cash: Math.round((cashN - cliqN) * 100) / 100, cliq: cliqN || undefined, cliq_photo: cliqN ? cliqPhoto : undefined, photo_url: photo, lat: loc?.lat, lng: loc?.lng, confirm_over_limit: true,
      } });
      if (q.queued) { fx.toast("📶 ما في شبكة — التسليم انحفظ على التلفون وبينبعت لحاله أول ما ترجع"); onDone({ queued: true }); return; }
      const r = q.data;
      fx.toast(r.remaining_stops ? `انسجل التسليم. باقي ${r.remaining_stops} وقفات.` : "انسجل التسليم. خلصت كل الوقفات!");
      onDone(r);
    } catch (e) { setErr(e.message); }
  }

  const step = (val, set, label) => (
    <div className="fx-stepper big">
      <button type="button" dir="ltr" onClick={() => set(Math.max(0, (Number(val) || 0) - 1))} aria-label="ناقص">−</button>
      <input className="fx-input" type="number" inputMode="numeric" min="0" value={val} onChange={(e) => set(e.target.value)} aria-label={label} />
      <button type="button" dir="ltr" onClick={() => set((Number(val) || 0) + 1)} aria-label="زايد">+</button>
    </div>
  );
  const hasDmg = Object.values(dmg).some((v) => Number(v) > 0);

  return (
    <Sheet title={`تسليم: ${o.customer_name}`} onClose={onClose}>
      <div className="fx-stack">
        {o.customer_balance > 0 && (
          <div className="fx-debt-alert"><span>⚠️ عليه دين قديم <b>{money(o.customer_balance)}</b> دينار — ذكّره بلطف.</span></div>
        )}

        {/* الأساسي: كم سلّمت من كل صنف */}
        {o.items.map((i) => {
          const got = Number(qty[i.id]);
          const back = Number.isFinite(got) && got < i.qty ? i.qty - got : 0;
          const more = Number.isFinite(got) && got > i.qty ? got - i.qty : 0;
          if (i.qty === 0) return (
            <div key={i.id} className="fx-field fx-free-bonus">
              <span className="fx-row" style={{ flexWrap: "nowrap" }}><ProductArt p={i} size={36} /><b>🎁 {i.name}</b> <span className="fx-muted">(بونص ببلاش)</span></span>
              {step(bon[i.id], (v) => setBon((x) => ({ ...x, [i.id]: v })), `بونص ${i.name}`)}
            </div>
          );
          return (
            <div key={i.id} className="fx-field">
              <span className="fx-row" style={{ flexWrap: "nowrap" }}><ProductArt p={i} size={36} /><b>{i.name}</b> <span className="fx-muted">(طلب {num(i.qty)})</span></span>
              {step(qty[i.id], (v) => setQty((x) => ({ ...x, [i.id]: v })), `سلّم من ${i.name}`)}
              {back > 0 && <small className="fx-dlv-hint warn">بيرجع معك {num(back)}</small>}
              {more > 0 && <small className="fx-dlv-hint">+{num(more)} زيادة من السيارة</small>}
              {(Number(bon[i.id]) > 0 || bonEdit[i.id] !== undefined) && (
                <small className="fx-dlv-hint ok fx-row" style={{ gap: 6 }}>
                  🎁 +
                  {canBonus
                    ? <input className="fx-input" style={{ width: 64, padding: "2px 6px", textAlign: "center" }} type="number" inputMode="numeric" min="0" value={bon[i.id]} onChange={(e) => setBon((x) => ({ ...x, [i.id]: e.target.value }))} aria-label={`بونص ${i.name}`} />
                    : <b>{num(bon[i.id])}</b>}
                  بونص ببلاش
                  {bonEdit[i.id] === undefined && <button type="button" className="fx-link" onClick={() => setBon((x) => ({ ...x, [i.id]: 0 }))}>(ما أخذه)</button>}
                </small>
              )}
            </div>
          );
        })}

        {Object.keys(added).map((pid) => {
          const p = fx.boot.products.find((x) => x.id === Number(pid));
          return (
            <div key={pid} className="fx-field">
              <span className="fx-row" style={{ flexWrap: "nowrap" }}><ProductArt p={p} size={36} /><b>{p?.name}</b> <span className="fx-muted">(زيادة)</span></span>
              {step(added[pid], (v) => setAdded((a) => { const n = { ...a, [pid]: v }; if (v !== "" && !Number(v)) delete n[pid]; return n; }), `زيادة ${p?.name}`)}
            </div>
          );
        })}

        {Object.keys(freeB).map((pid) => {
          const p = fx.boot.products.find((x) => x.id === Number(pid));
          return (
            <div key={`b${pid}`} className="fx-field fx-free-bonus">
              <span className="fx-row" style={{ flexWrap: "nowrap" }}><ProductArt p={p} size={36} /><b>🎁 {p?.name}</b> <span className="fx-muted">(بونص ببلاش)</span></span>
              {step(freeB[pid], (v) => setFreeB((a) => { const n = { ...a, [pid]: v }; if (v !== "" && !Number(v)) delete n[pid]; return n; }), `بونص ${p?.name}`)}
            </div>
          );
        })}
        {extra === "bonus" && (
          <div className="fx-chips">
            {fx.boot.products.filter((p) => p.active && !(String(p.id) in freeB)).map((p) => <button key={p.id} className="fx-chip" onClick={() => { setFreeB({ ...freeB, [p.id]: 1 }); setExtra(""); }}>🎁 {p.name}</button>)}
          </div>
        )}
        {extra === "add" && (
          <div className="fx-chips">
            {extraProducts.filter((p) => !(String(p.id) in added)).map((p) => <button key={p.id} className="fx-chip" onClick={() => { setAdded({ ...added, [p.id]: 1 }); setExtra(""); }}>+ {p.name}</button>)}
          </div>
        )}
        {(extra === "exch" || Object.keys(exch).length > 0) && (
          <ExchangeEditor value={exch} onChange={setExch} products={fx.boot.products.filter((p) => p.active)} startOpen onClose={() => setExtra("")} />
        )}
        {(extra === "dmg" || hasDmg) && (
          <div className="fx-exch" style={{ background: "#fdf2f2", borderColor: "#f5c2c2" }}>
            <span className="hd" style={{ color: "#a32020" }}>تالف من حمولتي (انكسر بالسيارة)</span>
            {o.items.map((i) => (
              <label key={i.id} className="fx-field">{i.name}
                <input className="fx-input" type="number" inputMode="numeric" min="0" value={dmg[i.id] || ""} placeholder="0" onChange={(e) => setDmg({ ...dmg, [i.id]: e.target.value })} />
              </label>
            ))}
          </div>
        )}

        {/* إشي ثاني؟ كبسات صغيرة بس لما تحتاجها */}
        <div className="fx-dlv-more">
          {extraProducts.length > 0 && extra !== "add" && <button type="button" onClick={() => setExtra("add")}>+ منتج زيادة</button>}
          {canBonus && extra !== "bonus" && <button type="button" onClick={() => setExtra("bonus")}>🎁 بونص على صنف</button>}
          {extra !== "exch" && !Object.keys(exch).length && <button type="button" onClick={() => setExtra("exch")}>🔁 بدل تالف</button>}
          {extra !== "dmg" && !hasDmg && <button type="button" onClick={() => setExtra("dmg")}>انكسر معي</button>}
        </div>

        <PayBox total={total} cash={cashEdit} onCash={setCashEdit} balance={o.customer_balance} canCredit={canCredit} />
        {cashN > 0 && (
          <CliqBox on={cliqOn} setOn={(v) => { setCliqOn(v); if (v && !cliq) setCliq(String(cashN)); }} amount={cliq} setAmount={setCliq} photo={cliqPhoto} setPhoto={setCliqPhoto} max={cashN} />
        )}
        <PhotoInput label="صورة (اختياري)" value={photo} onChange={setPhoto} kind="proof" />
        <Err msg={err} />
        <Act className="fx-btn ok block fx-huge" disabled={(debt > 0.005 && !canCredit) || cliqMissing} onClick={send}>
          <FiCheck /> تم التسليم{debt > 0.005 ? ` · دين ${money(debt)}` : ""}
        </Act>
      </div>
    </Sheet>
  );
}

// الزبون دفع بالكليك: المبلغ + صورة الوصل من تلفونه (بتوصل للمحاسب والإدارة)
export function CliqBox({ on, setOn, amount, setAmount, photo, setPhoto, max }) {
  return (
    <div className="fx-card fx-stack" style={{ gap: 8, padding: 12 }}>
      <label className="fx-row" style={{ gap: 8 }}>
        <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} />
        <b>📲 دفع بالكليك (حوالة)</b>
      </label>
      {on && (
        <>
          <label className="fx-field">قديش حوّل بالكليك؟{max ? <small className="fx-muted"> (من {money(max)})</small> : null}
            <input className="fx-input fx-num" type="number" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <PhotoInput label="صوّر وصل الكليك من تلفون الزبون" hint="لازم — بتوصل للمحاسب" value={photo} onChange={setPhoto} kind="cliq" />
          {Number(amount) > 0 && !photo && <small style={{ color: "var(--fx-crit)" }}>صوّر الوصل عشان تكمّل.</small>}
          <small className="fx-muted">مبلغ الكليك ما بينحسب على الكاش اللي معك.</small>
        </>
      )}
    </div>
  );
}

const FAILS = ["المحل مسكّر", "الزبون رفض الاستلام", "ما معه مصاري", "ما لقيت الموقع"];
const PP_DAYS = [1, 2, 3, 4, 5, 7, 10, 14];
function addDaysAr(n) {
  return new Date(Date.now() + n * 86400000).toLocaleDateString("ar-JO-u-nu-latn", { timeZone: "Asia/Amman", weekday: "long", day: "numeric", month: "numeric" });
}
function FailSheet({ o, onClose, onDone }) {
  const fx = useFx();
  const [reason, setReason] = useState("");
  const [photo, setPhoto] = useState(null);
  const [pp, setPp] = useState(false);
  const [days, setDays] = useState(null);
  const [note, setNote] = useState("");
  if (pp) {
    return (
      <Sheet title={`تأجيل: ${o.customer_name}`} onClose={onClose}>
        <div className="fx-stack">
          <b>الزبون بده إياه بعد كم يوم؟</b>
          <div className="fx-chips">{PP_DAYS.map((d) => <button key={d} className={`fx-chip ${days === d ? "on" : ""}`} onClick={() => setDays(d)}>{d === 1 ? "بكرا" : d === 7 ? "أسبوع" : d === 14 ? "أسبوعين" : `${d} أيام`}</button>)}</div>
          {days && <div className="fx-note sky">يعني يوم {addDaysAr(days)}</div>}
          <label className="fx-field">ملاحظة (اختياري)<input className="fx-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="مثلًا: بعد ما يفضى المحل" /></label>
          <div className="fx-note">إنت ما بتأجّل — بتبعت طلب، ومدخل الطلبات بيثبّت الموعد. البضاعة بترجع معك.</div>
          <Act className="fx-btn pri block fx-huge" disabled={!days} onClick={async () => {
            const loc = await getLocation(5000);
            const q = await sendOrQueue({ kind: "postpone", ref: o.id, label: `تأجيل: ${o.customer_name}`, path: `/driver/orders/${o.id}/postpone`, body: { days, note, lat: loc?.lat, lng: loc?.lng } });
            fx.toast(q.queued ? "📶 انحفظ على التلفون وبينبعت لحاله" : "انبعت طلب التأجيل لمدخل الطلبات ✓");
            onDone(q.queued ? { queued: true } : q.data);
          }}>🗓️ ابعت طلب التأجيل</Act>
          <button className="fx-link" onClick={() => setPp(false)}>رجوع</button>
        </div>
      </Sheet>
    );
  }
  return (
    <Sheet title={`ما تم: ${o.customer_name}`} onClose={onClose}>
      <div className="fx-stack">
        <button className="fx-btn sky block" onClick={() => setPp(true)}>🗓️ الزبون بده إياه بعدين (تأجيل)</button>
        <div className="fx-chips">{FAILS.map((r) => <button key={r} className={`fx-chip ${reason === r ? "on" : ""}`} onClick={() => setReason(r)}>{r}</button>)}</div>
        <PhotoInput label="صوّر المحل (اختياري)" hint="إثبات إنك وصلت" value={photo} onChange={setPhoto} kind="fail" />
        <Act className="fx-btn pri block" disabled={!reason} onClick={async () => {
          const loc = await getLocation(5000);
          const q = await sendOrQueue({ kind: "fail", ref: o.id, label: `ما تم: ${o.customer_name}`, path: `/driver/orders/${o.id}/fail`, body: { reason, photo_url: photo, lat: loc?.lat, lng: loc?.lng } });
          fx.toast(q.queued ? "📶 انحفظ على التلفون وبينبعت لحاله" : "انسجل ووصل للإدارة");
          onDone(q.queued ? { queued: true } : q.data);
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
          const q = await sendOrQueue({ kind: "expense", label: `مصروف ${kind} ${amount}`, path: "/driver/expenses", body: { kind, amount, liters, photo_url: photo, note } });
          fx.toast(q.queued ? "📶 المصروف انحفظ على التلفون وبينبعت لحاله" : "انبعت للإدارة للموافقة");
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
        <div className="fx-kv"><span>كاش من الفواتير</span><b>{money(t.collected - (t.debt_collected || 0))}</b></div>
        {t.debt_collected > 0 && <div className="fx-kv"><span>+ ديون قبضتها ({t.debt_collections.length})</span><b>{money(t.debt_collected)}</b></div>}
        {t.expenses.filter((e) => e.status !== "rejected").map((e) => (
          <div key={e.id} className="fx-kv"><span>− {e.kind}{e.status === "pending" ? " (بانتظار الموافقة)" : ""}</span><b>{money(e.amount)}</b></div>
        ))}
        <div className="fx-kv total"><span>المطلوب تسلّمه</span><b>{money(t.cash_due)} د.أ</b></div>
      </div>
      <p className="fx-muted">مثال: حصّلت 500 وعبّيت ديزل بـ20، بتسلّم 480. إذا سلّمت أقل، الفرق بينسجّل عهدة عليك.</p>
    </Sheet>
  );
}


// عمليات محفوظة على التلفون بتستنى الشبكة
function OutboxBar() {
  const box = useOutbox();
  const [busy, setBusy] = useState(false);
  if (!box.items.length && !box.failed.length) return null;
  return (
    <div className="fx-stack" style={{ gap: 8 }}>
      {box.items.length > 0 && (
        <div className="fx-outbox">
          <span>📶 <b>{box.items.length}</b> {box.items.length === 1 ? "عملية محفوظة" : "عمليات محفوظة"} على التلفون — بتنبعت لحالها أول ما ترجع الشبكة.</span>
          <button className="fx-btn sm" disabled={busy} onClick={async () => { setBusy(true); await flush().catch(() => {}); setBusy(false); }}>{busy ? "عم ببعت…" : "ابعت هلأ"}</button>
        </div>
      )}
      {box.failed.map((f) => (
        <div key={f.key} className="fx-note crit fx-row" style={{ justifyContent: "space-between" }}>
          <span>ما انقبلت: {f.label} — {f.error}</span>
          <button className="fx-link" onClick={() => dismissFailed(f.key)}>تمام</button>
        </div>
      ))}
    </div>
  );
}

// قبض دين: الزباين اللي عليهم دين، الأقرب لمكانك أول
function PickDebtor({ onClose, onPick }) {
  const [list, setList] = useState(null);
  const [q, setQ] = useState("");
  useEffect(() => {
    getLocation(6000).then((l) => fapi.driverShops({ lat: l?.lat, lng: l?.lng })).then((xs) => setList(xs.filter((c) => c.balance > 0.009))).catch(() => setList([]));
  }, []);
  const shown = list ? (q.trim() ? smartFilter(list, q) : list) : null;
  return (
    <Sheet title="مين دفع من دينه؟" onClose={onClose}>
      <div className="fx-stack">
        <input className="fx-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="دوّر بالاسم أو الرقم" />
        {!list && <Loading />}
        {shown && shown.length === 0 && <div className="fx-muted">ما في زباين عليهم دين{q ? " بهالبحث" : ""}.</div>}
        <div className="fx-drv-list">
          {shown?.map((c) => (
            <button key={c.id} className="r fx-plain" style={{ width: "100%", textAlign: "start" }} onClick={() => onPick(c)}>
              <span className="t"><b>{c.name}</b><small>{[c.city, c.km != null ? `${c.km} كم` : null].filter(Boolean).join(" · ")}</small></span>
              <b style={{ color: "#b06a00" }}>{money(c.balance)}</b>
            </button>
          ))}
        </div>
      </div>
    </Sheet>
  );
}
