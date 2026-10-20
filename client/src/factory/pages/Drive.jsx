import { useCallback, useEffect, useState } from "react";
import { FiTruck, FiPhone, FiNavigation, FiAlertTriangle, FiPlus, FiMessageCircle, FiCheck } from "react-icons/fi";
import { fapi } from "../fapi.js";
import PushCard from "../PushCard.jsx";
import { useFx, useLoad, Sheet, Tip, Err, Loading, Empty, Act, PhotoInput, SignaturePad, SendMessages, ProductArt, getLocation, waLink, money, num, time, today } from "../ui.jsx";

// ============================================================
// شاشة السائق: كل إشي بكبسة — قبل ما يطلع، عند كل زبون، المصاريف، والرجعة
// ============================================================
export default function Drive() {
  const fx = useFx();
  const { data, error, reload } = useLoad(() => fapi.driverToday(), []);
  const [exps, setExps] = useState(null);
  const [sheet, setSheet] = useState(null);
  const [msgs, setMsgs] = useState(null);
  const t = data?.trip;

  const loadExps = useCallback(() => fapi.myExpenses().then(setExps).catch(() => {}), []);
  useEffect(() => { loadExps(); }, [loadExps]);

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
    if (r?.message_ids?.length) setMsgs(r.message_ids);
    else if (r?.message_id) setMsgs([r.message_id]);
  };

  return (
    <div className="fx-page">
      <PushCard who="driver" />
      <div className="fx-card fx-row">
        <span className="fx-avatar"><FiTruck /></span>
        <span className="fx-grow" style={{ display: "grid" }}>
          <b>{fx.user.full_name}</b>
          <span className="fx-muted">{data?.vehicles?.map((v) => v.name).join("، ") || "ما إلك سيارة لسا"}</span>
        </span>
        <button className="fx-btn danger sm" onClick={() => setSheet({ kind: "problem" })}><FiAlertTriangle /> مشكلة</button>
      </div>
      <Tip id="drive">الرحلة ما بتبلش إلا بعد صورة العداد والديزل وتأكيد الحمولة. خلي التطبيق مفتوح بالطريق عشان الإدارة تشوف وين إنت.</Tip>
      <Err msg={error} />
      {!data && !error && <Loading />}

      {data && !t && (
        <Empty icon={FiTruck} title="ما في رحلة إلك اليوم" text="لما مسؤول الحركة يوزعلك طلبات، بتطلع هون مع ترتيب الوقفات." />
      )}

      {t && t.status === "planned" && <BeforeStart t={t} levels={data.fuel_levels} lastFuel={data.last_fuel} onDone={done} />}

      {t && ["active", "returned"].includes(t.status) && (
        <>
          <div className="fx-row">
            <button className="fx-btn pri fx-grow" data-hl="expense-btn" onClick={() => setSheet({ kind: "expense" })}><FiPlus /> مصروف</button>
            <button className="fx-btn sky fx-grow" onClick={() => setSheet({ kind: "cash" })}>حسابي اليوم</button>
          </div>
          <div className="fx-sec"><h2>وقفاتك ({t.done}/{t.stops.length})</h2><span className="fx-pill sky">{num(t.load)} كرتونة</span></div>
          <div className="fx-stack" data-hl="stops">
            {t.stops.map((o, i) => (
              <StopCard key={o.id} o={o} n={i + 1} active={t.status === "active"} onDeliver={() => setSheet({ kind: "deliver", o })} onFail={() => setSheet({ kind: "fail", o })} />
            ))}
          </div>
          {t.status === "active" && <EndTrip t={t} levels={data.fuel_levels} onDone={done} />}
          {t.status === "returned" && (
            <div className="fx-card soft fx-stack">
              <b>رجعت للمصنع</b>
              <span>سلّم للمحاسب <b className="fx-num">{money(t.cash_due)}</b> دينار، وأمين المستودع بيستلم الكراتين الراجعة.</span>
            </div>
          )}
        </>
      )}

      {exps?.list?.filter((e) => e.created_at?.slice(0, 10) >= today().slice(0, 8) + "01").length > 0 && (
        <>
          <div className="fx-sec"><h2>مصاريفي هالشهر</h2></div>
          <div className="fx-list">
            {exps.list.slice(0, 8).map((e) => (
              <div key={e.id} className="fx-item">
                <span className="t"><b>{e.kind} · {money(e.amount)}</b><span>{new Date(e.created_at).toLocaleDateString("ar-JO-u-nu-latn")}</span></span>
                <span className={`fx-pill ${e.status === "approved" ? "ok" : e.status === "rejected" ? "crit" : "warn"}`}>{e.status === "approved" ? "معتمد" : e.status === "rejected" ? "مرفوض" : "بانتظار الموافقة"}</span>
              </div>
            ))}
          </div>
        </>
      )}
      {data && <p className="fx-muted" style={{ margin: 0 }}>عُهد عليك: {money(data.custody)} د.أ</p>}

      {sheet?.kind === "deliver" && <DeliverSheet o={sheet.o} canCredit={data.can_credit} onClose={() => setSheet(null)} onDone={done} />}
      {sheet?.kind === "fail" && <FailSheet o={sheet.o} onClose={() => setSheet(null)} onDone={done} />}
      {sheet?.kind === "problem" && <ProblemSheet onClose={() => setSheet(null)} onDone={() => { setSheet(null); reload(); }} />}
      {sheet?.kind === "expense" && <ExpenseSheet kinds={exps?.kinds || []} onClose={() => setSheet(null)} onDone={done} />}
      {sheet?.kind === "cash" && t && <CashSheet t={t} onClose={() => setSheet(null)} />}
      {msgs && <SendMessages ids={msgs} title="ابعت للزبون" onClose={() => setMsgs(null)} />}
    </div>
  );
}

function BeforeStart({ t, levels, lastFuel, onDone }) {
  const fx = useFx();
  const [odo, setOdo] = useState(t.odo_start || "");
  const [odoPhoto, setOdoPhoto] = useState(t.photo_odo_start || null);
  const [fuel, setFuel] = useState(t.fuel_start || "");
  const [fuelPhoto, setFuelPhoto] = useState(t.photo_fuel_start || null);
  const [err, setErr] = useState("");
  const loaded = !!t.load_confirmed_at;
  const per = new Map();
  t.stops.forEach((o) => o.items.forEach((i) => per.set(i.name, (per.get(i.name) || 0) + i.qty)));

  async function start() {
    setErr("");
    try {
      if (!t.photo_odo_start || Number(odo) !== t.odo_start) await fapi.driverCheck(t.id, { kind: "odo_start", value: odo, photo_url: odoPhoto });
      if (!t.photo_fuel_start || fuel !== t.fuel_start) await fapi.driverCheck(t.id, { kind: "fuel_start", value: fuel, photo_url: fuelPhoto });
      const r = await fapi.driverStart(t.id);
      fx.toast("بلشت الرحلة. الزباين بيعرفوا إنك بالطريق.");
      onDone(r);
    } catch (e) {
      setErr(e.message);
    }
  }

  return (
    <section className="fx-card fx-stack">
      <h2 style={{ margin: 0, fontSize: 16 }}>قبل ما تطلع</h2>
      <p className="fx-muted" style={{ margin: 0 }}>الصور من الكاميرا مباشرة، ومعها الوقت والموقع.</p>
      <PhotoInput label="صوّر عداد الكيلومترات" value={odoPhoto} onChange={setOdoPhoto} kind="odo" />
      <label className="fx-field">رقم العداد<input className="fx-input" type="number" inputMode="numeric" value={odo} onChange={(e) => setOdo(e.target.value)} placeholder="مثلًا 45210" /></label>
      <PhotoInput label="صوّر مؤشر الديزل" value={fuelPhoto} onChange={setFuelPhoto} kind="fuel" />
      <div className="fx-field">الديزل هلأ
        <div className="fx-chips">{levels.map((l) => <button key={l} className={`fx-chip ${fuel === l ? "on" : ""}`} onClick={() => setFuel(l)}>{l}</button>)}</div>
        {lastFuel?.fuel_end && <small className="fx-muted">آخر مرة رجعت السيارة كان «{lastFuel.fuel_end}».</small>}
      </div>
      <div className="fx-step on" style={{ cursor: "default" }}>
        <span className="fx-check" style={loaded ? undefined : { background: "none", borderColor: "var(--fx-line)" }}>{loaded && <FiCheck />}</span>
        <span className="t">
          <b>الحمولة: {num(t.load)} كرتونة</b>
          <small style={{ color: loaded ? "var(--fx-ok)" : "var(--fx-muted)" }}>{[...per].map(([n, q]) => `${num(q)} ${n}`).join("، ")}{loaded ? " · متأكدة" : ""}</small>
        </span>
      </div>
      {!loaded && <Act className="fx-btn sky" onClick={async () => { await fapi.driverConfirmLoad(t.id); fx.toast("تأكدت الحمولة"); onDone(); }}>عدّيت الكراتين — أكّد الحمولة</Act>}
      <Err msg={err} />
      <Act className="fx-btn pri block" disabled={!odoPhoto || !odo || !fuel || !fuelPhoto || !loaded} onClick={start}>ابدأ الرحلة</Act>
    </section>
  );
}

function StopCard({ o, n, active, onDeliver, onFail }) {
  const dest = o.lat ? `${o.lat},${o.lng}` : encodeURIComponent(`${o.city || ""} الأردن`);
  const [big, setBig] = useState(false);
  const closed = ["delivered", "failed"].includes(o.status);
  return (
    <div className="fx-card fx-stack" style={closed ? { background: "var(--fx-surface-2)" } : undefined}>
      <div className="fx-row" style={{ flexWrap: "nowrap" }}>
        <span className={`fx-n ${o.status === "delivered" ? "done" : o.status === "failed" ? "fail" : ""}`}>{n}</span>
        <span className="fx-grow" style={{ display: "grid" }}>
          <b>{o.seq_no ? <span className="fx-seq">#{o.seq_no}</span> : null}{o.customer_name}</b>
          <span className="fx-muted">{o.city}{o.address ? ` · ${o.address}` : ""}</span>
          <span className="fx-muted">{o.items.map((i) => `${num(i.qty)} ${i.name}${i.bonus_qty ? ` +${num(i.bonus_qty)} بونص` : ""}`).join("، ")}{o.eta_at && !closed ? ` · يوصل ${time(o.eta_at)}` : ""}</span>
        </span>
      </div>
      {o.photo_url && !closed && (
        <button className="fx-building-btn" onClick={() => setBig(!big)} aria-label="صورة المحل">
          <img className={`fx-building ${big ? "" : "small"}`} src={o.photo_url} alt={`صورة محل ${o.customer_name}`} loading="lazy" />
        </button>
      )}
      {o.status === "delivered" && <div className="fx-note ok">سلّمت · قيمة الفاتورة {money(o.delivered_total)} · كاش {money(o.cash_paid)}</div>}
      {o.status === "failed" && <div className="fx-note crit">ما تسلّم: {o.fail_reason}</div>}
      {!closed && (
        <div className="fx-row">
          {active && <button className="fx-btn pri fx-grow" onClick={onDeliver}>تسليم</button>}
          {active && <button className="fx-btn" onClick={onFail}>ما تم</button>}
          <a className="fx-btn sky sm" href={`https://www.google.com/maps/dir/?api=1&destination=${dest}`} target="_blank" rel="noreferrer" aria-label="الطريق"><FiNavigation /></a>
          {o.phone && <a className="fx-btn sm" href={`tel:${o.phone}`} aria-label="اتصال"><FiPhone /></a>}
          {o.phone && <a className="fx-btn wa sm" href={waLink(o.phone, "")} target="_blank" rel="noreferrer" aria-label="واتساب"><FiMessageCircle /></a>}
        </div>
      )}
    </div>
  );
}

function DeliverSheet({ o, canCredit, onClose, onDone }) {
  const fx = useFx();
  const [qty, setQty] = useState(() => Object.fromEntries(o.items.map((i) => [i.id, i.qty])));
  const [dmg, setDmg] = useState({});
  const [bon, setBon] = useState(() => Object.fromEntries(o.items.map((i) => [i.id, i.bonus_qty || 0])));
  const [showDmg, setShowDmg] = useState(false);
  const total = o.items.reduce((s, i) => s + (Number(qty[i.id]) || 0) * i.price, 0);
  const [cash, setCash] = useState(() => (o.pay_terms === "credit" ? "" : String(Math.round(total * 100) / 100)));
  const [sig, setSig] = useState(null);
  const [photo, setPhoto] = useState(null);
  const [overMsg, setOverMsg] = useState("");
  const [err, setErr] = useState("");
  const onSig = useCallback((v) => setSig(v), []);
  const cashN = Number(cash) || 0;
  const debt = Math.max(0, total - cashN);

  async function send(confirm = false) {
    setErr("");
    const loc = await getLocation(5000);
    try {
      const r = await fapi.deliver(o.id, {
        items: o.items.map((i) => ({ item_id: i.id, delivered_qty: Number(qty[i.id]) || 0, damaged_qty: Number(dmg[i.id]) || 0, delivered_bonus: Number(bon[i.id]) || 0 })),
        cash: cashN, signature: sig, photo_url: photo, lat: loc?.lat, lng: loc?.lng, confirm_over_limit: confirm,
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
        <div className="fx-note sky">الزبون بدّه أقل؟ نزّل العدد هون. الفاتورة بتنحسب على اللي سلّمته، والباقي بيرجع معك للمستودع.</div>
        {o.items.map((i) => {
          const got = Number(qty[i.id]);
          const back = Number.isFinite(got) && got < i.qty ? i.qty - got : 0;
          return (
          <label key={i.id} className="fx-field">
            <span className="fx-row" style={{ flexWrap: "nowrap" }}><ProductArt p={i} size={36} />{i.name} <span className="fx-muted">(المطلوب {num(i.qty)})</span></span>
            <div className="fx-stepper big">
              <button type="button" dir="ltr" onClick={() => setQty({ ...qty, [i.id]: Math.max(0, (Number(qty[i.id]) || 0) - 1) })} aria-label="ناقص">−</button>
              <input className="fx-input" type="number" inputMode="numeric" min="0" max={i.qty} value={qty[i.id]} onChange={(e) => setQty({ ...qty, [i.id]: e.target.value })} aria-label={`سلّم من ${i.name}`} />
              <button type="button" dir="ltr" disabled={(Number(qty[i.id]) || 0) >= i.qty} onClick={() => setQty({ ...qty, [i.id]: Math.min(i.qty, (Number(qty[i.id]) || 0) + 1) })} aria-label="زايد">+</button>
            </div>
            {back > 0 && <small style={{ color: "#b06a00", fontWeight: 600 }}>سلّمت {num(got)} بدل {num(i.qty)} · بيرجع معك {num(back)} كرتونة</small>}
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
        {!showDmg ? (
          <button className="fx-link" style={{ justifySelf: "start" }} onClick={() => setShowDmg(true)}>في كراتين تالفة؟</button>
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
        <SignaturePad onChange={onSig} />
        <PhotoInput label="صوّر البضاعة عند الزبون (اختياري)" value={photo} onChange={setPhoto} kind="proof" />
        {overMsg && (
          <div className="fx-note warn fx-stack">
            <span>{overMsg}</span>
            <Act className="fx-btn sm" onClick={() => send(true)}>كمّل وبلّغ الإدارة</Act>
          </div>
        )}
        <Err msg={err} />
        <Act className="fx-btn pri block" disabled={!sig && !photo} onClick={() => send(false)}>أكّد التسليم</Act>
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
  const [odo, setOdo] = useState("");
  const [photo, setPhoto] = useState(null);
  const [odoPhoto, setOdoPhoto] = useState(null);
  const [note, setNote] = useState("");
  const diesel = kind === "ديزل";
  const ok = Number(amount) > 0 && photo && (!diesel || (odo && odoPhoto));
  return (
    <Sheet title="مصروف جديد" onClose={onClose}>
      <div className="fx-stack">
        <div className="fx-chips">{(kinds.length ? kinds : ["ديزل"]).map((k) => <button key={k} className={`fx-chip ${kind === k ? "on" : ""}`} onClick={() => setKind(k)}>{k}</button>)}</div>
        <div className="fx-grid2">
          <label className="fx-field">المبلغ (دينار)<input className="fx-input" type="number" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
          {diesel && <label className="fx-field">كم لتر<input className="fx-input" type="number" inputMode="decimal" value={liters} onChange={(e) => setLiters(e.target.value)} /></label>}
        </div>
        <PhotoInput label="صوّر الفاتورة" hint="إجباري" value={photo} onChange={setPhoto} kind="receipt" />
        {diesel && (
          <>
            <PhotoInput label="صوّر العداد" hint="عشان نحسب استهلاك السيارة" value={odoPhoto} onChange={setOdoPhoto} kind="odo" />
            <label className="fx-field">رقم العداد<input className="fx-input" type="number" inputMode="numeric" value={odo} onChange={(e) => setOdo(e.target.value)} /></label>
          </>
        )}
        {!diesel && <label className="fx-field">ملاحظة<input className="fx-input" value={note} onChange={(e) => setNote(e.target.value)} /></label>}
        <div className="fx-note">المصروف بينخصم من الكاش اللي بتسلّمه. إذا الإدارة رفضته بيرجع عليك.</div>
        <Act className="fx-btn pri block" disabled={!ok} onClick={async () => {
          await fapi.addExpense({ kind, amount, liters, odo, photo_url: photo, odo_photo_url: odoPhoto, note });
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

function EndTrip({ t, levels, onDone }) {
  const fx = useFx();
  const left = t.stops.filter((o) => ["assigned", "onway"].includes(o.status)).length;
  const [odo, setOdo] = useState("");
  const [odoPhoto, setOdoPhoto] = useState(null);
  const [fuel, setFuel] = useState("");
  const [fuelPhoto, setFuelPhoto] = useState(null);
  const [open, setOpen] = useState(false);
  if (left > 0 && !open) return null;
  return (
    <section className="fx-card fx-stack">
      <h2 style={{ margin: 0, fontSize: 16 }}>رجعت للمصنع؟</h2>
      {left > 0 && <div className="fx-note warn">لسا في {left} وقفات. إذا ما رح تكملها، سجّلها «ما تم» أول.</div>}
      <PhotoInput label="صوّر العداد" value={odoPhoto} onChange={setOdoPhoto} kind="odo" />
      <label className="fx-field">رقم العداد<input className="fx-input" type="number" inputMode="numeric" value={odo} onChange={(e) => setOdo(e.target.value)} placeholder={t.odo_start ? `أكبر من ${t.odo_start}` : ""} /></label>
      <PhotoInput label="صوّر مؤشر الديزل" value={fuelPhoto} onChange={setFuelPhoto} kind="fuel" />
      <div className="fx-chips">{levels.map((l) => <button key={l} className={`fx-chip ${fuel === l ? "on" : ""}`} onClick={() => setFuel(l)}>{l}</button>)}</div>
      <Act className="fx-btn pri block" disabled={!odo || !odoPhoto || !fuel || !fuelPhoto || left > 0} onClick={async () => {
        await fapi.driverCheck(t.id, { kind: "odo_end", value: odo, photo_url: odoPhoto });
        await fapi.driverCheck(t.id, { kind: "fuel_end", value: fuel, photo_url: fuelPhoto });
        const r = await fapi.driverReturn(t.id, {});
        fx.toast(`سكّرت الرحلة. سلّم ${money(r.required_cash)} دينار للمحاسب.`);
        onDone();
      }}>سكّر الرحلة</Act>
    </section>
  );
}
