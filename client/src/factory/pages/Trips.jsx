import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { FiMapPin, FiArrowUp, FiArrowDown, FiClock, FiChevronLeft, FiMap } from "react-icons/fi";
import { fapi } from "../fapi.js";
import { useFx, useLoad, Sheet, Tip, Err, Loading, Empty, Act, StatusPill, ORDER_STATUS, TRIP_STATUS, SendMessages, Reload, money, num, time, date, dateTime, today } from "../ui.jsx";
import { TransferSheet, itemsLine } from "./Orders.jsx";
import { StopSheet, deliveredCartons } from "./StopSheet.jsx";

export default function Trips() {
  const fx = useFx();
  const nav = useNavigate();
  const dispatch = fx.can("f_dispatch", "edit");
  const [day, setDay] = useState("");
  const { data, error, reload } = useLoad(() => fapi.trips(day ? { date: day } : {}), [day]);
  const [sheet, setSheet] = useState(null);
  const [msgs, setMsgs] = useState(null);

  return (
    <div className="fx-page">
      <div className="fx-row" style={{ justifyContent: "space-between" }}>
        <h1 className="fx-h1">الرحلات</h1>
        <div className="fx-row">
          <button className="fx-btn sm sky" onClick={() => nav("/f/live")}><FiMap /> الخريطة</button>
          <input className="fx-input" style={{ width: 150 }} type="date" value={day || today()} onChange={(e) => setDay(e.target.value === today() ? "" : e.target.value)} aria-label="اليوم" />
          <Reload onClick={reload} />
        </div>
      </div>
      <Tip id="trips">كل الرحلات الشغالة هون. إذا سيارة تعطلت، زر «تأخير» بيجهّز رسالة لكل زباينها مع السبب والموعد الجديد.</Tip>
      <Err msg={error} />
      {!data && !error && <Loading />}
      {data && data.length === 0 && <Empty title="ما في رحلات" text="من شاشة الطلبات علّم على الطلبات واكبس «رحلة جديدة»." />}
      <div className="fx-stack" data-hl="trips-list">
        {data?.map((t, i) => (
          <TripCard key={t.id} t={t} first={i === 0} dispatch={dispatch} onOpen={(kind, o) => setSheet({ kind, t, o })} />
        ))}
      </div>

      {sheet?.kind === "delay" && <DelaySheet t={sheet.t} onClose={() => setSheet(null)} onSaved={(r) => { setSheet(null); reload(); setMsgs(r.message_ids); }} />}
      {sheet?.kind === "order" && <TripDetail t={sheet.t} onClose={() => setSheet(null)} onChanged={() => { setSheet(null); reload(); }} onStop={(o) => setSheet({ kind: "stop", t: sheet.t, o, back: "order" })} />}
      {sheet?.kind === "stop" && <StopSheet o={sheet.o} t={sheet.t} onClose={() => setSheet(sheet.back ? { kind: sheet.back, t: sheet.t } : null)} />}
      {msgs && <SendMessages ids={msgs} title="رسالة التأخير للزباين" onClose={() => setMsgs(null)} />}
    </div>
  );
}

function TripCard({ t, first, dispatch, onOpen }) {
  const pct = Math.min(100, (t.load / t.capacity) * 100);
  return (
    <section className="fx-card fx-stack">
      <div className="fx-row">
        <span className="fx-avatar">{t.vehicle_name?.replace(/\D/g, "") || "#"}</span>
        <span className="fx-grow" style={{ display: "grid" }}>
          <b>{t.vehicle_name} · {t.driver_name || "بدون سائق"}</b>
          <span className="fx-muted">{date(t.trip_date)} · طلعة {t.depart_time} · {t.done}/{t.stops.length} وقفات</span>
        </span>
        <StatusPill map={TRIP_STATUS} value={t.status} />
      </div>
      <div className="fx-row" style={{ gap: 6 }}>
        {t.late > 0 && <span className="fx-pill crit">متأخر عن {t.late} زبون</span>}
        {t.tracking_lost && <span className="fx-pill crit">التتبع مقطوع</span>}
        {t.load_confirmed_at ? <span className="fx-pill ok">الحمولة متأكدة</span> : t.status === "planned" && <span className="fx-pill warn">لسا ما تحمّلت</span>}
        {t.delay_reason && <span className="fx-pill warn">تأخير: {t.delay_reason}</span>}
      </div>
      <div>
        <div className="fx-row" style={{ justifyContent: "space-between", fontSize: 13 }}><span className="fx-muted">الحمولة</span><b className="fx-num">{num(t.load)} / {num(t.capacity)}</b></div>
        <div className={`fx-bar ${t.load > t.capacity ? "over" : ""}`}><i style={{ width: `${pct}%` }} /></div>
      </div>
      {t.status !== "planned" && <TripSummary t={t} />}
      <div>
        {t.stops.map((o, i) => (
          <button key={o.id} className="fx-stop fx-stop-btn" onClick={() => onOpen("stop", o)}>
            <span className={`fx-n ${o.status === "delivered" ? "done" : o.status === "failed" ? "fail" : ""}`}>{i + 1}</span>
            <span style={{ display: "grid" }}>
              <b style={{ fontSize: 14 }}>{o.seq_no ? <span className="fx-seq">#{o.seq_no}</span> : null}{o.customer_name}</b>
              <span className="fx-muted">{o.city} · {num(o.cartons)} كرتونة{o.eta_at && !["delivered", "failed"].includes(o.status) ? ` · يوصل ${time(o.eta_at)}` : ""}</span>
              {o.status === "delivered" && <span className="fx-ok-line">سلّم {time(o.delivered_at)} · {num(deliveredCartons(o))} كرتونة · فاتورة {money(o.delivered_total)} · كاش {money(o.cash_paid)}</span>}
              {o.status === "failed" && <span className="fx-crit-line">ما تسلّم: {o.fail_reason}</span>}
            </span>
            <span className="fx-row" style={{ gap: 4, flexWrap: "nowrap" }}><StatusPill map={ORDER_STATUS} value={o.status} /><FiChevronLeft aria-hidden="true" className="fx-muted" /></span>
          </button>
        ))}
      </div>
      {["active", "returned"].includes(t.status) && (
        <div className="fx-row fx-muted" style={{ fontSize: 13 }}>كاش محصّل {money(t.collected)} · مصاريف {money(t.expenses_total)} · المطلوب {money(t.cash_due)}</div>
      )}
      <div className="fx-row">
        {dispatch && ["planned", "active"].includes(t.status) && t.stops.some((o) => ["assigned", "onway"].includes(o.status)) && (
          <button className="fx-btn danger sm" data-hl={first ? "delay-btn" : undefined} onClick={() => onOpen("delay")}><FiClock /> تأخير</button>
        )}
        <button className="fx-btn sm" onClick={() => onOpen("order")}>تفاصيل وترتيب</button>
        {t.last_lat && (
          <a className="fx-btn sm sky" href={`https://maps.google.com/?q=${t.last_lat},${t.last_lng}`} target="_blank" rel="noreferrer"><FiMapPin /> وين هي؟</a>
        )}
      </div>
      {t.last_seen_at && t.status === "active" && <span className="fx-muted" style={{ fontSize: 12 }}>آخر موقع {time(t.last_seen_at)}</span>}
    </section>
  );
}

const DELAY_REASONS = ["عطل بالسيارة", "ضغط طلبات", "الطقس", "نقص بالمخزون", "الطريق مسكّر"];
const WHEN = [["اليوم المسا", false], ["بكرا الصبح", true], ["بكرا الظهر", true]];

function DelaySheet({ t, onClose, onSaved }) {
  const [reason, setReason] = useState(t.delay_reason || "عطل بالسيارة");
  const [when, setWhen] = useState("بكرا الصبح");
  const [note, setNote] = useState("");
  const open = t.stops.filter((o) => ["assigned", "onway"].includes(o.status));
  const nextDay = (WHEN.find((w) => w[0] === when) || [null, /بكرا/.test(when)])[1];
  return (
    <Sheet title={`تأخير ${t.vehicle_name}`} onClose={onClose}>
      <div className="fx-stack">
        <div className="fx-field">السبب
          <div className="fx-chips">{DELAY_REASONS.map((r) => <button key={r} className={`fx-chip ${reason === r ? "on" : ""}`} onClick={() => setReason(r)}>{r}</button>)}</div>
        </div>
        <div className="fx-field">الموعد الجديد
          <div className="fx-chips">{WHEN.map(([w]) => <button key={w} className={`fx-chip ${when === w ? "on" : ""}`} onClick={() => setWhen(w)}>{w}</button>)}</div>
        </div>
        <label className="fx-field">كلمة زيادة للزبون (اختياري)<input className="fx-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="مثلًا: والسائق بيتصل فيك قبل ما يوصل" /></label>
        <div className="fx-note sky">«نعتذر منك، طلبك رقم … رح يتأخر بسبب {reason}. الموعد الجديد: {when}.{note ? ` ${note}` : ""}»</div>
        {nextDay && <p className="fx-muted" style={{ margin: 0 }}>الطلبات بترجع لقائمة «جديدة» عشان توزعها بكرا.</p>}
        <Act className="fx-btn pri block" onClick={async () => onSaved(await fapi.delayTrip(t.id, { reason, when, note, next_day: nextDay }))}>
          جهّز الرسائل لـ{open.length} زباين
        </Act>
      </div>
    </Sheet>
  );
}

function TripDetail({ t, onClose, onChanged, onStop }) {
  const fx = useFx();
  const dispatch = fx.can("f_dispatch", "edit");
  const movable = t.stops.filter((o) => ["assigned", "onway"].includes(o.status));
  const [ids, setIds] = useState(movable.map((o) => o.id));
  const [move, setMove] = useState(null);
  const changed = ids.join(",") !== movable.map((o) => o.id).join(",");
  const swap = (i, d) => setIds((xs) => { const a = [...xs]; [a[i], a[i + d]] = [a[i + d], a[i]]; return a; });
  const odoKm = t.odo_end && t.odo_start ? t.odo_end - t.odo_start : null;

  if (move) return <TransferSheet o={move} onClose={() => setMove(null)} onSaved={() => { setMove(null); onChanged(); }} />;
  return (
    <Sheet title={`${t.vehicle_name} · ${date(t.trip_date)}`} onClose={onClose}>
      <div className="fx-stack">
        {dispatch && movable.length > 1 && (
          <>
            <div className="fx-sec"><h2>ترتيب الوقفات</h2>
              <Act className="fx-btn sm sky" onClick={async () => { await fapi.reorderStops(t.id, { sort: true }); fx.toast("ترتبت من الأقرب للأبعد"); onChanged(); }}>من الأقرب للأبعد</Act>
            </div>
            <div className="fx-card" style={{ paddingBlock: 4 }}>
              {ids.map((id, i) => {
                const o = movable.find((x) => x.id === id);
                return (
                  <div key={id} className="fx-stop">
                    <span className="fx-n">{i + 1}</span>
                    <span style={{ display: "grid" }}><b style={{ fontSize: 14 }}>{o.customer_name}</b><span className="fx-muted">{o.city}</span></span>
                    <span className="fx-ud">
                      <button disabled={i === 0} onClick={() => swap(i, -1)} aria-label="لفوق"><FiArrowUp /></button>
                      <button disabled={i === ids.length - 1} onClick={() => swap(i, 1)} aria-label="لتحت"><FiArrowDown /></button>
                    </span>
                  </div>
                );
              })}
            </div>
            {changed && <Act className="fx-btn pri" onClick={async () => { await fapi.reorderStops(t.id, { order_ids: ids }); fx.toast("انحفظ الترتيب ووصل للسائق"); onChanged(); }}>احفظ الترتيب</Act>}
          </>
        )}

        <div className="fx-sec"><h2>الطلبات</h2></div>
        <div className="fx-list">
          {t.stops.map((o) => (
            <div key={o.id} className="fx-item">
              <button className="t fx-plain" onClick={() => onStop(o)}><b>{o.seq_no ? <span className="fx-seq">#{o.seq_no}</span> : null}{o.customer_name}</b><span>{itemsLine(o)}</span>{o.fail_reason && <span style={{ color: "var(--fx-crit)" }}>{o.fail_reason}</span>}</button>
              <span className="end">
                <StatusPill map={ORDER_STATUS} value={o.status} />
                <button className="fx-link" onClick={() => onStop(o)}>التفاصيل</button>
                {dispatch && ["assigned", "onway"].includes(o.status) && <button className="fx-link" onClick={() => setMove(o)}>نقل</button>}
              </span>
            </div>
          ))}
        </div>

        <div className="fx-sec"><h2>السيارة والسائق</h2></div>
        <div className="fx-card">
          <div className="fx-kv"><span>عداد الطلعة</span><b>{t.odo_start ? num(t.odo_start) : "—"}</b></div>
          <div className="fx-kv"><span>عداد الرجعة</span><b>{t.odo_end ? num(t.odo_end) : "—"}</b></div>
          <div className="fx-kv"><span>كيلومترات العداد / التتبع</span><b>{odoKm != null ? num(odoKm) : "—"} / {num(Math.round(t.gps_km))}</b></div>
          <div className="fx-kv"><span>الديزل طلعة / رجعة</span><b>{t.fuel_start || "—"} / {t.fuel_end || "—"}</b></div>
          <div className="fx-kv"><span>بدأت / رجعت</span><b>{t.started_at ? time(t.started_at) : "—"} / {t.returned_at ? time(t.returned_at) : "—"}</b></div>
          <div className="fx-row" style={{ marginTop: 8 }}>
            {[t.photo_odo_start, t.photo_fuel_start, t.photo_odo_end, t.photo_fuel_end].filter(Boolean).map((p) => (
              <a key={p} href={p} target="_blank" rel="noreferrer"><img className="fx-photo" src={p} alt="صورة" /></a>
            ))}
          </div>
        </div>
        {t.expenses.length > 0 && (
          <div className="fx-card">
            {t.expenses.map((e) => <div key={e.id} className="fx-kv"><span>{e.kind} · {e.status === "pending" ? "بانتظار الموافقة" : e.status === "approved" ? "معتمد" : "مرفوض"}</span><b>{money(e.amount)}</b></div>)}
          </div>
        )}
        {dispatch && t.status === "planned" && !t.load_confirmed_at && (
          <Act className="fx-btn danger block" onClick={async () => { await fapi.cancelTrip(t.id); fx.toast("انلغت الرحلة ورجعت الطلبات"); onChanged(); }}>ألغِ الرحلة</Act>
        )}
        {t.settled_at && <p className="fx-muted" style={{ margin: 0 }}>انستلم الكاش {dateTime(t.settled_at)}: {money(t.handed_cash)} د.أ</p>}
      </div>
    </Sheet>
  );
}


// ملخص الرحلة: سلّم لكم زبون، كم كرتونة، وكم كاش
function TripSummary({ t }) {
  const done = t.stops.filter((o) => o.status === "delivered");
  const failed = t.stops.filter((o) => o.status === "failed").length;
  const cartons = done.reduce((s, o) => s + deliveredCartons(o), 0);
  const cash = done.reduce((s, o) => s + (o.cash_paid || 0), 0);
  const debt = done.reduce((s, o) => s + Math.max(0, (o.delivered_total || 0) - (o.cash_paid || 0)), 0);
  return (
    <div className="fx-trip-sum">
      <div><b className="fx-num">{done.length}/{t.stops.length}</b><span>سلّم</span></div>
      <div><b className="fx-num">{num(cartons)}</b><span>كرتونة</span></div>
      <div><b className="fx-num">{money(cash)}</b><span>كاش</span></div>
      <div><b className="fx-num">{money(debt)}</b><span>دين</span></div>
      {failed > 0 && <div className="bad"><b className="fx-num">{failed}</b><span>ما تم</span></div>}
    </div>
  );
}

