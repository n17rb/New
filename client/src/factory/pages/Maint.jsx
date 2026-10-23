import { useState } from "react";
import { FiPlus, FiTruck } from "react-icons/fi";
import { fapi } from "../fapi.js";
import { useFx, useLoad, Sheet, Err, Loading, Empty, Act, PhotoInput, DateInput, Reload, money, num, date, today } from "../ui.jsx";

// ============================================================
// صيانة السيارات: كل سيارة، كم ماشية، شو مستحق قريب، وسجل كل اللي انعمل إلها
// ============================================================
const KIND_ICON = { oil: "🛢️", mechanic: "🔧", tires: "🛞", battery: "🔋", brakes: "🛑", other: "🧰" };
const KIND_ORDER = ["oil", "mechanic", "tires", "battery", "brakes", "other"];

function addDays(n) {
  return new Date(Date.now() + n * 86400000).toLocaleDateString("en-CA", { timeZone: "Asia/Amman" });
}

function dueText(d) {
  const parts = [];
  if (d.km_left != null) parts.push(d.km_left <= 0 ? `فات بـ${num(-d.km_left)} كم` : `باقي ${num(d.km_left)} كم`);
  if (d.days_left != null) parts.push(d.days_left < 0 ? `فات بـ${num(-d.days_left)} يوم` : d.days_left === 0 ? "اليوم" : `باقي ${num(d.days_left)} يوم`);
  return parts.join(" · ");
}

export default function Maint() {
  const fx = useFx();
  const edit = fx.can("f_maint", "edit");
  const { data, error, reload } = useLoad(() => fapi.maint(), []);
  const [sheet, setSheet] = useState(null);
  const [open, setOpen] = useState(null);
  const done = () => { setSheet(null); reload(); };
  const dueCount = (data?.vehicles || []).reduce((a, v) => a + v.dues.filter((d) => d.state === "due").length, 0);
  return (
    <div className="fx-page">
      <div className="fx-row" style={{ justifyContent: "space-between" }}>
        <h1 className="fx-h1" style={{ margin: 0 }}>صيانة السيارات</h1>
        <Reload onClick={reload} />
      </div>
      <Err msg={error} />
      {!data && !error && <Loading />}
      {data && data.vehicles.length === 0 && <Empty icon={FiTruck} title="ما في سيارات" text="ضيف السيارات من الإعدادات." />}
      {data && data.vehicles.length > 0 && (
        <>
          <div className="fx-grid2">
            <div className="fx-card" style={{ textAlign: "center" }}><small className="fx-muted">مستحق هلأ</small><b className="fx-num" style={{ display: "block", fontSize: 26, color: dueCount ? "var(--fx-crit)" : "var(--fx-ok)" }}>{num(dueCount)}</b></div>
            <div className="fx-card" style={{ textAlign: "center" }}><small className="fx-muted">صرفنا هالشهر</small><b className="fx-num" style={{ display: "block", fontSize: 26 }}>{money(data.month_cost)}</b></div>
          </div>
          {edit && <button className="fx-btn pri block fx-huge" onClick={() => setSheet({ kind: "add" })}><FiPlus /> سجّل صيانة</button>}
          <div className="fx-stack">
            {data.vehicles.map((v) => {
              const bad = v.dues.filter((d) => d.state !== "ok");
              return (
                <section key={v.id} className="fx-card fx-stack" style={{ gap: 10 }}>
                  <div className="fx-row" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
                    <span className="fx-row" style={{ gap: 10, flexWrap: "nowrap" }}>
                      <span className="fx-avatar"><FiTruck /></span>
                      <span><b>{v.name}</b>{v.plate ? <small className="fx-muted"> · {v.plate}</small> : null}<br /><small className="fx-muted">{v.driver_name || "بدون سائق"}</small></span>
                    </span>
                    <button className="fx-plain" style={{ textAlign: "end" }} onClick={() => edit && setSheet({ kind: "odo", v })} aria-label="العداد">
                      <small className="fx-muted">العداد تقريبًا</small><br />
                      <b className="fx-num">{v.km_now != null ? `${num(v.km_now)} كم` : edit ? "سجّله ✎" : "—"}</b>
                    </button>
                  </div>
                  {bad.length === 0 && v.dues.length > 0 && <div className="fx-note ok">كل إشي تمام ✓</div>}
                  {v.dues.length === 0 && <div className="fx-muted" style={{ fontSize: 13 }}>ما في مواعيد صيانة جاية مسجّلة.</div>}
                  {v.dues.map((d) => (
                    <div key={d.id} className={`fx-kv ${d.state === "due" ? "crit" : d.state === "soon" ? "warn" : ""}`}>
                      <span>{KIND_ICON[d.kind] || "🧰"} {d.label}</span>
                      <b style={{ color: d.state === "due" ? "var(--fx-crit)" : d.state === "soon" ? "var(--fx-warn)" : "var(--fx-muted)", fontWeight: d.state === "ok" ? 500 : 800 }}>{dueText(d) || "—"}</b>
                    </div>
                  ))}
                  <div className="fx-row" style={{ gap: 8 }}>
                    {edit && <button className="fx-btn sm pri" onClick={() => setSheet({ kind: "add", v })}><FiPlus /> صيانة لهالسيارة</button>}
                    {v.history.length > 0 && <button className="fx-btn sm" onClick={() => setOpen(open === v.id ? null : v.id)}>{open === v.id ? "سكّر السجل" : `السجل (${v.history.length})`}</button>}
                    {v.month_cost > 0 && <span className="fx-muted" style={{ fontSize: 12.5 }}>هالشهر {money(v.month_cost)} د.أ</span>}
                  </div>
                  {open === v.id && (
                    <div className="fx-list">
                      {v.history.map((h) => (
                        <div key={h.id} className="fx-item">
                          <span className="fx-avatar" style={{ fontSize: 18 }}>{KIND_ICON[h.kind] || "🧰"}</span>
                          <span className="t">
                            <b>{h.title || data.kinds[h.kind]?.label}{h.cost ? ` · ${money(h.cost)} د.أ` : ""}</b>
                            <span>{date(h.done_on)}{h.odo ? ` · عداد ${num(h.odo)}` : ""}{h.by_name ? ` · ${h.by_name}` : ""}{h.note ? ` · ${h.note}` : ""}</span>
                          </span>
                          {h.photo_url && <a href={h.photo_url} target="_blank" rel="noreferrer"><img className="fx-photo" src={h.photo_url} alt="" /></a>}
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        </>
      )}
      {sheet?.kind === "add" && data && <AddSheet vehicles={data.vehicles} kinds={data.kinds} v0={sheet.v} onClose={() => setSheet(null)} onDone={done} />}
      {sheet?.kind === "odo" && <OdoSheet v={sheet.v} onClose={() => setSheet(null)} onDone={done} />}
    </div>
  );
}

function AddSheet({ vehicles, kinds, v0, onClose, onDone }) {
  const fx = useFx();
  const [vid, setVid] = useState(v0?.id || (vehicles.length === 1 ? vehicles[0].id : null));
  const [kind, setKind] = useState("oil");
  const v = vehicles.find((x) => x.id === vid);
  const [odo, setOdo] = useState(v0?.km_now != null ? String(v0.km_now) : "");
  const [cost, setCost] = useState("");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState("");
  const [doneOn, setDoneOn] = useState(today());
  const defNext = (k, o) => {
    const K = kinds[k] || {};
    return { km: K.km && o ? String(Number(o) + K.km) : "", date: K.days ? addDays(K.days) : "" };
  };
  const [nextKm, setNextKm] = useState(() => defNext("oil", odo).km);
  const [nextDate, setNextDate] = useState(() => defNext("oil", odo).date);
  const pickKind = (k) => { setKind(k); const n = defNext(k, odo); setNextKm(n.km); setNextDate(n.date); };
  const pickVehicle = (x) => { setVid(x.id); const o = x.km_now != null ? String(x.km_now) : ""; setOdo(o); setNextKm(defNext(kind, o).km); };
  const [err, setErr] = useState("");
  return (
    <Sheet title="سجّل صيانة" onClose={onClose}>
      <div className="fx-stack">
        {!v0 && (
          <div className="fx-field">السيارة
            <div className="fx-chips">{vehicles.map((x) => <button key={x.id} type="button" className={`fx-chip ${vid === x.id ? "on" : ""}`} onClick={() => pickVehicle(x)}>{x.name}</button>)}</div>
          </div>
        )}
        <div className="fx-field">شو انعمل؟
          <div className="fx-chips">{KIND_ORDER.map((k) => <button key={k} type="button" className={`fx-chip ${kind === k ? "on" : ""}`} onClick={() => pickKind(k)}>{KIND_ICON[k]} {kinds[k]?.label}</button>)}</div>
        </div>
        {(kind === "mechanic" || kind === "other") && <label className="fx-field">شو بالضبط؟<input className="fx-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={kind === "mechanic" ? "مثلًا: تغيير كلتش" : "مثلًا: فلتر هوا"} /></label>}
        <div className="fx-grid2">
          <label className="fx-field">العداد هلأ (كم)<input className="fx-input fx-num" type="number" inputMode="numeric" value={odo} onChange={(e) => { setOdo(e.target.value); const K = kinds[kind]; if (K?.km && e.target.value) setNextKm(String(Number(e.target.value) + K.km)); }} placeholder={v?.km_now != null ? String(v.km_now) : ""} /></label>
          <label className="fx-field">الكلفة (د.أ)<input className="fx-input fx-num" type="number" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0" /></label>
        </div>
        <div className="fx-field">إمتى انعملت؟<DateInput value={doneOn} onChange={setDoneOn} ariaLabel="تاريخ الصيانة" /></div>
        <div className="fx-card" style={{ background: "var(--fx-sky-soft, #eef6ff)" }}>
          <b style={{ fontSize: 14 }}>⏰ ذكّرني بالموعد الجاي</b>
          <div className="fx-stack" style={{ gap: 8, marginTop: 8 }}>
            <label className="fx-field">لما يوصل العداد (كم)<input className="fx-input fx-num" type="number" inputMode="numeric" value={nextKm} onChange={(e) => setNextKm(e.target.value)} placeholder="فاضي = بدون" /></label>
            <div className="fx-field">أو بتاريخ<DateInput value={nextDate} onChange={setNextDate} ariaLabel="تاريخ الموعد الجاي" /></div>
            <small className="fx-muted">أيهم بيجي أول بيوصلك تنبيه.</small>
          </div>
        </div>
        <PhotoInput label="صورة الفاتورة (اختياري)" value={photo} onChange={setPhoto} />
        <label className="fx-field">ملاحظة (اختياري)<input className="fx-input" value={note} onChange={(e) => setNote(e.target.value)} /></label>
        <Err msg={err} />
        <Act className="fx-btn pri block fx-huge" disabled={!vid} onClick={async () => {
          setErr("");
          try {
            await fapi.addMaint({ vehicle_id: vid, kind, title: title || undefined, odo, cost, note, photo_url: photo || undefined, next_km: nextKm, next_date: nextDate, done_on: doneOn });
            fx.toast("انسجّلت الصيانة ✓");
            onDone();
          } catch (e) { setErr(e.message); }
        }}>✓ سجّل</Act>
      </div>
    </Sheet>
  );
}

function OdoSheet({ v, onClose, onDone }) {
  const fx = useFx();
  const [odo, setOdo] = useState(v.km_now != null ? String(v.km_now) : "");
  return (
    <Sheet title={`عداد ${v.name}`} onClose={onClose}>
      <div className="fx-stack">
        <label className="fx-field">كم مكتوب على العداد هلأ؟
          <input className="fx-input fx-num" style={{ fontSize: 22, textAlign: "center", fontWeight: 800 }} type="number" inputMode="numeric" autoFocus value={odo} onChange={(e) => setOdo(e.target.value)} />
        </label>
        <small className="fx-muted">بعدها النظام بيحسب لحاله من تتبع السيارة ومن صور عداد السائق.</small>
        <Act className="fx-btn pri block" disabled={!odo} onClick={async () => { await fapi.setOdo(v.id, odo); fx.toast("انحفظ"); onDone(); }}>حفظ</Act>
      </div>
    </Sheet>
  );
}
