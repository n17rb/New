import { useEffect, useState } from "react";
import { LIVE_COLORS } from "./Live.jsx";
import TripsMap, { TRIP_COLORS } from "./TripsMap.jsx";
import { FiArrowUp, FiArrowDown, FiClock, FiNavigation, FiPhone } from "react-icons/fi";
import { fapi } from "../fapi.js";
import { useFx, useLoad, Sheet, Tip, Err, Loading, Empty, Act, StatusPill, ORDER_STATUS, TRIP_STATUS, SendMessages, Reload, money, num, time, date, dateTime, today, DateInput, arDate } from "../ui.jsx";
import { TransferSheet, itemsLine } from "./Orders.jsx";
import { StopSheet, deliveredCartons } from "./StopSheet.jsx";

export default function Trips() {
  const fx = useFx();
  const dispatch = fx.can("f_dispatch", "edit");
  const [day, setDay] = useState("");
  const { data, error, reload } = useLoad(() => fapi.trips(day ? { date: day } : {}), [day]);
  useEffect(() => { const f = () => reload(); window.addEventListener("fx-reload", f); return () => window.removeEventListener("fx-reload", f); }, [reload]);
  const [live, setLive] = useState(null);
  const [sel, setSel] = useState(null);
  const [sheet, setSheet] = useState(null);
  const [msgs, setMsgs] = useState(null);
  const isToday = !day;

  // الخريطة والرحلات بيتحدّثوا لحالهم كل ٣٠ ثانية
  useEffect(() => {
    if (!isToday) return;
    const load = () => fapi.live().then(setLive).catch(() => {});
    load();
    const t = setInterval(() => { load(); reload(); }, 30000);
    return () => clearInterval(t);
  }, [isToday]); // eslint-disable-line react-hooks/exhaustive-deps

  const liveBy = new Map((live?.vehicles || []).map((v) => [v.id, v]));
  // رحلة فاضية (كل طلباتها انتقلت أو انلغت) ما إلها داعي تبين
  const all = [...(data || [])].filter((t) => t.stops.length > 0 || t.status === "active").sort((a, b) => (RANK[a.status] ?? 9) - (RANK[b.status] ?? 9));
  const trips = all.filter((t) => ["planned", "active"].includes(t.status));
  const finished = all.filter((t) => !["planned", "active"].includes(t.status));
  const [showDone, setShowDone] = useState(false);
  const onRoad = trips.filter((t) => ["planned", "active"].includes(t.status));
  const colorOf = new Map(onRoad.map((t, i) => [t.id, TRIP_COLORS[i % TRIP_COLORS.length]]));
  const factory = live?.factory || fx.boot.factory?.point;

  function focus(t) {
    setSel(sel === t.id ? null : t.id);
    document.querySelector(".fx-live-map")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  return (
    <div className="fx-page">
      <div className="fx-chead">
        <h1>الرحلات</h1>
      </div>
      <details className="fx-trips-day">
        <summary>📅 {day ? arDate(day) : "اليوم"} <span className="fx-muted">— غيّر اليوم</span></summary>
        <DateInput value={day || today()} onChange={(v) => v && setDay(v === today() ? "" : v)} quick ariaLabel="اليوم" />
      </details>
      <Err msg={error} />
      {!data && !error && <Loading />}

      {isToday && onRoad.length > 0 && (
        <>
          <TripsMap trips={trips} live={live} factory={factory} selected={sel} onSelect={(id) => setSel(sel === id ? null : id)} />
          <div className="fx-trip-legend">
            <button className={!sel ? "on" : ""} onClick={() => setSel(null)}>كل السيارات</button>
            {onRoad.map((t) => (
              <button key={t.id} className={sel === t.id ? "on" : ""} onClick={() => setSel(sel === t.id ? null : t.id)}>
                <i style={{ background: colorOf.get(t.id) }} />{t.driver_name || t.vehicle_name}
              </button>
            ))}
          </div>
        </>
      )}

      {data && all.length === 0 && <Empty title="ما في رحلات" text="من الطلبات علّم على الطلبات واكبس «حطها على سيارة»." />}
      {data && trips.length === 0 && all.length > 0 && <div className="fx-empty-soft">كل السيارات رجعت 👌</div>}
      <div className="fx-stack" data-hl="trips-list">
        {trips.map((t, i) => (
          <TripCard key={t.id} t={t} lv={liveBy.get(t.vehicle_id)} color={colorOf.get(t.id)} on={sel === t.id} first={i === 0} dispatch={dispatch}
            onFocus={() => focus(t)} onOpen={(kind, o) => setSheet({ kind, t, o })} />
        ))}
      </div>

      {finished.length > 0 && (
        <>
          <button className="fx-link" style={{ justifySelf: "start" }} onClick={() => setShowDone(!showDone)}>{showDone ? "خبّي" : "اعرض"} اللي رجعت ({finished.length})</button>
          {showDone && <div className="fx-stack">{finished.map((t) => <TripCard key={t.id} t={t} lv={liveBy.get(t.vehicle_id)} dispatch={dispatch} onFocus={() => {}} onOpen={(kind, o) => setSheet({ kind, t, o })} />)}</div>}
        </>
      )}

      {sheet?.kind === "delay" && <DelaySheet t={sheet.t} onClose={() => setSheet(null)} onSaved={(r) => { setSheet(null); reload(); setMsgs(r.message_ids); }} />}
      {sheet?.kind === "order" && <TripDetail t={sheet.t} onClose={() => setSheet(null)} onChanged={() => { setSheet(null); reload(); }} onStop={(o) => setSheet({ kind: "stop", t: sheet.t, o, back: "order" })} />}
      {sheet?.kind === "stop" && <StopSheet o={sheet.o} t={sheet.t} onClose={() => setSheet(sheet.back ? { kind: sheet.back, t: sheet.t } : null)} />}
      {msgs && <SendMessages ids={msgs} title="رسالة التأخير للزباين" onClose={() => setMsgs(null)} />}
    </div>
  );
}

// ٨١ ← «ساعة و٢١ د»
const mins = (m) => (m >= 60 ? `${Math.floor(m / 60) === 1 ? "ساعة" : `${Math.floor(m / 60)} ساعات`}${m % 60 ? ` و${m % 60} د` : ""}` : `${m} د`);

const RANK = { active: 0, planned: 1, returned: 2, closed: 3 };

function tripState(t, lv) {
  if (t.status === "active") return lv?.state === "lost" ? ["التتبع مقطوع", "lost"] : ["بالطريق", "moving"];
  if (t.status === "planned") return [t.load_confirmed_at ? "جاهزة تطلع" : "لسا ما تحمّلت", "planned"];
  if (t.status === "returned") return ["رجعت للمصنع", "idle"];
  return ["خلصت", "idle"];
}

function FixedBtn({ t }) {
  const fx = useFx();
  return (
    <Act className="fx-btn ok sm" onClick={async () => { await fapi.tripFixed(t.id); fx.toast("تمام، انشال العطل"); window.dispatchEvent(new Event("fx-reload")); }}>
      ✓ رجعت تشتغل
    </Act>
  );
}

function TripCard({ t, lv, color, on, first, dispatch, onOpen, onFocus }) {
  const [label, key] = tripState(t, lv);
  const done = t.stops.filter((o) => ["delivered", "failed"].includes(o.status)).length;
  const next = lv?.next;
  const pct = t.stops.length ? Math.round((done / t.stops.length) * 100) : 0;
  return (
    <section className={`fx-trip ${on ? "on" : ""}`}>
      <button className="fx-plain fx-trip-h" onClick={onFocus}>
        <span className={`fx-cav ${color ? "route" : ""}`} style={{ background: color || LIVE_COLORS[key], color: "#fff", "--route": color }}>{t.vehicle_name?.replace(/\D/g, "") || "#"}</span>
        <span className="t">
          <b>{t.driver_name || "بدون سائق"}</b>
          <small>{t.kind === "sales" ? "🛒 مندوب · " : ""}{t.vehicle_name} · {num(t.load)} كرتونة</small>
        </span>
        <span className={`fx-trip-st ${key}`}>{label}</span>
      </button>

      {t.status === "active" && next && (
        <div className="fx-trip-next">
          <FiNavigation aria-hidden="true" />
          <span>رايح على <b>{next.customer_name}</b></span>
          <b className="eta">{next.minutes_away ? `بعد ${mins(next.minutes_away)}` : next.eta_at ? time(next.eta_at) : ""}</b>
        </div>
      )}
      {t.late > 0 && <div className="fx-trip-warn">متأخر عن {t.late} زبون</div>}
      {t.delay_reason && !t.problems?.length && <div className="fx-trip-warn">تأخير: {t.delay_reason}</div>}
      {(t.problems?.length > 0 || t.delay_reason === "عطل بالسيارة") && (
        <div className="fx-trip-prob">
          <span>🔧 {t.problems?.[0]?.title.replace(/^.*?:\s*/, "") || "عطل بالسيارة"}{t.problems?.[0] && <small> · {time(t.problems[0].created_at)}</small>}</span>
          {dispatch && <FixedBtn t={t} />}
        </div>
      )}

      {t.kind === "sales"
        ? <div className="fx-trip-prog"><span>باع لـ {done} محل · {money(t.collected)} كاش</span></div>
        : <div className="fx-trip-prog"><span>سلّم {done} من {t.stops.length}</span><div className="fx-bar"><i style={{ width: `${pct}%` }} /></div></div>}

      <div className="fx-trip-stops">
        {t.stops.map((o, i) => {
          const isNext = t.status === "active" && next?.id === o.id;
          return (
            <button key={o.id} className={`fx-plain fx-trip-stop ${isNext ? "next" : ""}`} onClick={() => onOpen("stop", o)}>
              <span className={`fx-n ${o.status === "delivered" ? "done" : o.status === "failed" ? "fail" : ""}`}>{o.status === "delivered" ? "✓" : o.status === "failed" ? "✗" : i + 1}</span>
              <span className="nm">{o.customer_name}</span>
              <span className="tm">
                {o.status === "delivered" ? `سلّم ${time(o.delivered_at)}` : o.status === "failed" ? "ما تم" : o.eta_at ? `يوصل ${time(o.eta_at)}` : ""}
              </span>
            </button>
          );
        })}
      </div>

      {["returned", "closed"].includes(t.status) && <TripSummary t={t} />}

      <div className="fx-trip-btns">
        <button className="fx-btn sm" onClick={() => onOpen("order")}>التفاصيل</button>
        {dispatch && ["planned", "active"].includes(t.status) && t.stops.some((o) => ["assigned", "onway"].includes(o.status)) && (
          <button className="fx-btn sm" data-hl={first ? "delay-btn" : undefined} onClick={() => onOpen("delay")}><FiClock /> تأخير</button>
        )}
        {lv?.driver_phone && <a className="fx-btn sm" href={`tel:${lv.driver_phone}`}><FiPhone /> اتصل</a>}
      </div>
      {lv?.minutes_ago != null && t.status === "active" && <small className="fx-muted" style={{ fontSize: 12 }}>آخر موقع {lv.minutes_ago < 1 ? "هلأ" : `قبل ${lv.minutes_ago} دقيقة`}</small>}
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

