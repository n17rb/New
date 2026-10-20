import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { FiAlertTriangle, FiClipboard, FiPlus, FiPower, FiTruck } from "react-icons/fi";
import { fapi } from "../fapi.js";
import { useFx, useLoad, Sheet, Tip, Err, Loading, Empty, Act, PhotoInput, Reload, num, money, time, dateTime, date } from "../ui.jsx";

export default function Stock() {
  const fx = useFx();
  const [params, setParams] = useSearchParams();
  const canStock = fx.can("f_stock");
  const canProd = fx.can("f_production");
  const tabs = [
    canStock || fx.can("f_home") ? ["stock", "المستودع"] : null,
    canStock || fx.can("f_home") ? ["load", "التحميل والمرتجع"] : null,
    canProd || fx.can("f_home") ? ["prod", "الإنتاج والمكنات"] : null,
    ["log", "السجل"],
  ].filter(Boolean);
  const tab = tabs.find((t) => t[0] === params.get("tab"))?.[0] || tabs[0][0];
  return (
    <div className="fx-page">
      <h1 className="fx-h1">{canStock ? "المستودع" : "الإنتاج"}</h1>
      <div className="fx-tabs">
        {tabs.map(([k, l]) => <button key={k} className={tab === k ? "on" : ""} onClick={() => setParams({ tab: k })}>{l}</button>)}
      </div>
      {tab === "stock" && <Balances />}
      {tab === "load" && <Loading_ />}
      {tab === "prod" && <Production />}
      {tab === "log" && <Log />}
    </div>
  );
}

// ---------- الأرصدة ----------
function Balances() {
  const fx = useFx();
  const edit = fx.can("f_stock", "edit");
  const { data, error, reload } = useLoad(() => fapi.stock(), []);
  const [sheet, setSheet] = useState(null);
  return (
    <>
      <Tip id="stock">الرصيد بيتحسب لحاله: إنتاج − تحميل + مرتجع − تالف. أي فرق بالجرد بيوصل للمالك.</Tip>
      <div className="fx-row">
        {(edit || fx.can("f_production", "edit")) && <button className="fx-btn danger" data-hl="damage-btn" onClick={() => setSheet("damage")}><FiAlertTriangle /> تالف</button>}
        {edit && <button className="fx-btn sky" onClick={() => setSheet("count")}><FiClipboard /> جرد</button>}
        {edit && fx.canAction("adjust_stock") && <button className="fx-btn" onClick={() => setSheet("adjust")}>تعديل يدوي</button>}
        <Reload onClick={reload} />
      </div>
      <Err msg={error} />
      {!data && !error && <Loading />}
      {data && data.products.length === 0 && <Empty title="ما في منتجات" text="ضيف المنتجات من الإعدادات." />}
      {data && data.products.length > 0 && (
        <div className="fx-stack">
          {data.products.map((p) => {
            const low = p.min_stock > 0 && p.balance <= p.min_stock;
            const short = p.demand > p.balance;
            return (
              <div key={p.id} className="fx-card fx-stack" style={{ gap: 6 }}>
                <div className="fx-row" style={{ justifyContent: "space-between" }}>
                  <b>{p.name}</b>
                  <b className="fx-num" style={{ fontSize: 20, color: low ? "var(--fx-crit)" : "var(--fx-navy)" }}>{num(p.balance)}</b>
                </div>
                <span className="fx-muted" style={{ fontSize: 12.5 }}>
                  اليوم: إنتاج {num(p.today.production)} · تحميل {num(p.today.load)} · مرتجع {num(p.today.return)} · تالف {num(p.today.damage)}
                </span>
                {short && <div className="fx-note warn">طلبات لبكرا {num(p.demand)} كرتونة والرصيد {num(p.balance)} — لازم تنتجوا {num(p.demand - p.balance)} كمان.</div>}
                {!short && low && <div className="fx-note crit">تحت الحد الأدنى ({num(p.min_stock)}).</div>}
              </div>
            );
          })}
        </div>
      )}
      {sheet === "damage" && <DamageSheet onClose={() => setSheet(null)} onDone={() => { setSheet(null); reload(); }} />}
      {sheet === "count" && data && <CountSheet products={data.products} onClose={() => setSheet(null)} onDone={() => { setSheet(null); reload(); }} />}
      {sheet === "adjust" && <AdjustSheet onClose={() => setSheet(null)} onDone={() => { setSheet(null); reload(); }} />}
    </>
  );
}

function DamageSheet({ onClose, onDone, presetSource }) {
  const fx = useFx();
  const [source, setSource] = useState(presetSource || "warehouse");
  const [product, setProduct] = useState(fx.boot.products[0]?.id || "");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [machine, setMachine] = useState(fx.boot.machines[0]?.id || "");
  const [photo, setPhoto] = useState(null);
  const SRC = [["warehouse", "بالمستودع"], ["vehicle", "بالسيارة"], ["machine", "من الماكنة"]];
  return (
    <Sheet title="تسجيل تالف" onClose={onClose}>
      <div className="fx-stack">
        <div className="fx-chips">{SRC.map(([k, l]) => <button key={k} className={`fx-chip ${source === k ? "on" : ""}`} onClick={() => setSource(k)}>{l}</button>)}</div>
        <div className="fx-grid2">
          <select value={product} onChange={(e) => setProduct(e.target.value)} aria-label="المنتج">{fx.boot.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          <input className="fx-input" type="number" inputMode="numeric" placeholder="كم كرتونة" value={qty} onChange={(e) => setQty(e.target.value)} />
        </div>
        {source === "vehicle" && <select value={vehicle} onChange={(e) => setVehicle(e.target.value)} aria-label="السيارة"><option value="">اختار السيارة</option>{fx.boot.vehicles.map((v) => <option key={v.id} value={v.id}>{v.name} · {v.driver_name || ""}</option>)}</select>}
        {source === "machine" && <select value={machine} onChange={(e) => setMachine(e.target.value)} aria-label="الماكنة">{fx.boot.machines.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>}
        <label className="fx-field">السبب<input className="fx-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مثلًا: كراتين مسرّبة، وقعت من الرف" /></label>
        <PhotoInput label="صوّر التالف" value={photo} onChange={setPhoto} kind="damage" />
        <Act className="fx-btn danger block" disabled={!qty || !reason} onClick={async () => {
          await fapi.damage({ product_id: product, qty, source, reason, vehicle_id: vehicle || null, machine_id: source === "machine" ? machine : null, photo_url: photo });
          fx.toast("انسجل التالف");
          onDone();
        }}>سجّل</Act>
      </div>
    </Sheet>
  );
}

function CountSheet({ products, onClose, onDone }) {
  const fx = useFx();
  const [vals, setVals] = useState({});
  const [result, setResult] = useState(null);
  if (result) {
    return (
      <Sheet title="نتيجة الجرد" onClose={onDone}>
        <div className="fx-stack">
          {result.length === 0 ? <div className="fx-note ok">الجرد مطابق تمامًا.</div> : <div className="fx-note warn">في فرق: {result.join(" · ")}. انسجل ووصل للمالك.</div>}
          <button className="fx-btn block" onClick={onDone}>تمام</button>
        </div>
      </Sheet>
    );
  }
  return (
    <Sheet title="جرد فعلي" onClose={onClose}>
      <div className="fx-stack">
        <p className="fx-muted" style={{ margin: 0 }}>عدّ الكراتين الموجودة واكتب العدد. النظام بيقارنه بالرصيد المحسوب.</p>
        {products.map((p) => (
          <label key={p.id} className="fx-row" style={{ flexWrap: "nowrap" }}>
            <span className="fx-grow">{p.name}</span>
            <input className="fx-input" style={{ width: 120 }} type="number" inputMode="numeric" value={vals[p.id] ?? ""} onChange={(e) => setVals({ ...vals, [p.id]: e.target.value })} placeholder="العدد" />
          </label>
        ))}
        <Act className="fx-btn pri block" disabled={!Object.values(vals).some((v) => v !== "")} onClick={async () => {
          const r = await fapi.count(Object.entries(vals).filter(([, v]) => v !== "").map(([product_id, counted]) => ({ product_id: Number(product_id), counted: Number(counted) })));
          setResult(r.diffs);
          fx.toast("انحفظ الجرد");
        }}>احفظ الجرد</Act>
      </div>
    </Sheet>
  );
}

function AdjustSheet({ onClose, onDone }) {
  const fx = useFx();
  const [product, setProduct] = useState(fx.boot.products[0]?.id || "");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("");
  return (
    <Sheet title="تعديل رصيد يدوي" onClose={onClose}>
      <div className="fx-stack">
        <div className="fx-note warn">كل تعديل يدوي بيوصل للمالك مع السبب.</div>
        <div className="fx-grid2">
          <select value={product} onChange={(e) => setProduct(e.target.value)}>{fx.boot.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          <input className="fx-input" type="number" inputMode="numeric" placeholder="+50 أو -20" value={qty} onChange={(e) => setQty(e.target.value)} />
        </div>
        <label className="fx-field">السبب<input className="fx-input" value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        <Act className="fx-btn pri block" disabled={!qty || !reason} onClick={async () => { await fapi.adjustStock({ product_id: product, qty, reason }); fx.toast("انحفظ"); onDone(); }}>احفظ</Act>
      </div>
    </Sheet>
  );
}

// ---------- التحميل والمرتجع ----------
function Loading_() {
  const fx = useFx();
  const edit = fx.can("f_stock", "edit");
  const { data, error, reload } = useLoad(() => fapi.loading(), []);
  const [sheet, setSheet] = useState(null);
  return (
    <>
      <Tip id="loading">كل سيارة إلها قائمة باللي لازم يطلع عليها. بعد ما تعدّ الكراتين اكبس «أكّد التحميل». ولما ترجع، عدّ الراجع واكبس «استلمت المرتجع».</Tip>
      <Err msg={error} />
      {!data && !error && <Loading />}
      {data && data.length === 0 && <Empty icon={FiTruck} title="ما في سيارات لتحميل اليوم" />}
      <div className="fx-stack">
        {data?.map((t) => (
          <section key={t.id} className="fx-card fx-stack">
            <div className="fx-row" style={{ justifyContent: "space-between" }}>
              <b>{t.vehicle_name} · {t.driver_name || "بدون سائق"}</b>
              <span className={`fx-pill ${t.status === "returned" ? "warn" : t.load_confirmed_at ? "ok" : "sky"}`}>
                {t.status === "returned" ? (t.returns_received ? "المرتجع مستلم" : "رجعت — استلم المرتجع") : t.load_confirmed_at ? "تحمّلت" : "لسا ما تحمّلت"}
              </span>
            </div>
            <div>
              {t.items.map((i) => <div key={i.product_id} className="fx-kv"><span>{i.name}</span><b>{num(i.qty)}</b></div>)}
              {t.extra_items.map((i) => <div key={`x${i.product_id}`} className="fx-kv"><span>{i.name} (زيادة للبيع)</span><b>{num(i.qty)}</b></div>)}
              <div className="fx-kv total"><span>المجموع</span><b>{num(t.load)} من {num(t.capacity)}</b></div>
            </div>
            {edit && t.status === "planned" && !t.load_confirmed_at && <button className="fx-btn pri" onClick={() => setSheet({ kind: "load", t })}>أكّد التحميل</button>}
            {edit && t.status === "returned" && !t.returns_received && <button className="fx-btn pri" onClick={() => setSheet({ kind: "ret", t })}>استلم المرتجع</button>}
          </section>
        ))}
      </div>
      {sheet?.kind === "load" && <LoadSheet t={sheet.t} onClose={() => setSheet(null)} onDone={() => { setSheet(null); reload(); }} />}
      {sheet?.kind === "ret" && <ReturnSheet t={sheet.t} onClose={() => setSheet(null)} onDone={() => { setSheet(null); reload(); }} />}
    </>
  );
}

function LoadSheet({ t, onClose, onDone }) {
  const fx = useFx();
  const [extra, setExtra] = useState({});
  const room = t.capacity - t.load;
  return (
    <Sheet title={`تحميل ${t.vehicle_name}`} onClose={onClose}>
      <div className="fx-stack">
        {t.items.map((i) => <div key={i.product_id} className="fx-kv"><span>{i.name}</span><b>{num(i.qty)}</b></div>)}
        {room > 0 && (
          <details>
            <summary className="fx-link">زيادة للبيع من السيارة (في مجال لـ{num(room)})</summary>
            <div className="fx-stack" style={{ marginTop: 8 }}>
              {fx.boot.products.filter((p) => p.active).map((p) => (
                <label key={p.id} className="fx-row" style={{ flexWrap: "nowrap" }}>
                  <span className="fx-grow">{p.name}</span>
                  <input className="fx-input" style={{ width: 110 }} type="number" inputMode="numeric" value={extra[p.id] || ""} onChange={(e) => setExtra({ ...extra, [p.id]: e.target.value })} />
                </label>
              ))}
            </div>
          </details>
        )}
        <Act className="fx-btn pri block" onClick={async () => {
          await fapi.confirmLoad(t.id, Object.entries(extra).filter(([, q]) => Number(q) > 0).map(([product_id, qty]) => ({ product_id: Number(product_id), qty: Number(qty) })));
          fx.toast("تأكد التحميل وانخصم من المستودع");
          onDone();
        }}>عدّيت الكراتين — أكّد</Act>
      </div>
    </Sheet>
  );
}

function ReturnSheet({ t, onClose, onDone }) {
  const fx = useFx();
  const { data: trip } = useLoad(() => fapi.settlements().then((l) => l.find((x) => x.id === t.id)), [t.id]);
  const expected = trip?.returns_expected || [];
  const [vals, setVals] = useState({});
  const [short, setShort] = useState(null);
  if (short) {
    return (
      <Sheet title="انستلم المرتجع" onClose={onDone}>
        <div className="fx-stack">
          {short.length ? <div className="fx-note crit">ناقص: {short.map((x) => `${x.missing} ${x.name}`).join("، ")} — انسجّلت عهدة على السائق.</div> : <div className="fx-note ok">المرتجع مطابق.</div>}
          <button className="fx-btn block" onClick={onDone}>تمام</button>
        </div>
      </Sheet>
    );
  }
  return (
    <Sheet title={`مرتجع ${t.vehicle_name}`} onClose={onClose}>
      <div className="fx-stack">
        {!trip && <Loading />}
        {trip && expected.length === 0 && <div className="fx-note ok">كل الحمولة انباعت — ما في مرتجع متوقع.</div>}
        {expected.map((e) => (
          <label key={e.product_id} className="fx-row" style={{ flexWrap: "nowrap" }}>
            <span className="fx-grow">{e.name} <span className="fx-muted">(المفروض {num(e.qty)})</span></span>
            <input className="fx-input" style={{ width: 110 }} type="number" inputMode="numeric" value={vals[e.product_id] ?? e.qty} onChange={(ev) => setVals({ ...vals, [e.product_id]: ev.target.value })} />
          </label>
        ))}
        <Act className="fx-btn pri block" disabled={!trip} onClick={async () => {
          const r = await fapi.receiveReturns(t.id, expected.map((e) => ({ product_id: e.product_id, qty: Number(vals[e.product_id] ?? e.qty) })));
          fx.toast("انستلم المرتجع ورجع للمستودع");
          setShort(r.short || []);
        }}>استلمت المرتجع</Act>
      </div>
    </Sheet>
  );
}

// ---------- الإنتاج والمواد الخام والأعطال ----------
function Production() {
  const fx = useFx();
  const edit = fx.can("f_production", "edit");
  const { data, error, reload } = useLoad(() => Promise.all([fapi.stock(), fapi.downtime()]), []);
  const [sheet, setSheet] = useState(null);
  const [stock, downs] = data || [];
  return (
    <>
      <Tip id="prod">سجّل الإنتاج كل وردية، والمواد الخام بتنخصم لحالها. إذا وقفت ماكنة اكبس «ماكنة وقفت» وبس ترجع سجّل التالف.</Tip>
      {edit && (
        <div className="fx-row">
          <button className="fx-btn pri fx-grow" data-hl="prod-btn" onClick={() => setSheet({ kind: "prod" })}><FiPlus /> سجّل إنتاج</button>
          <button className="fx-btn danger" onClick={() => setSheet({ kind: "down" })}><FiPower /> ماكنة وقفت</button>
        </div>
      )}
      <Err msg={error} />
      {!data && !error && <Loading />}
      {data && (
        <>
          {stock.downtime_open.length > 0 && (
            <div className="fx-stack">
              {stock.downtime_open.map((d) => (
                <div key={d.id} className="fx-alert crit">
                  <div className="h"><b>{d.machine_name} واقفة</b><time>من {time(d.started_at)}</time></div>
                  <p>{d.reason}</p>
                  {edit && <button className="fx-btn sm" onClick={() => setSheet({ kind: "up", d })}>رجعت تشتغل</button>}
                </div>
              ))}
            </div>
          )}
          <div className="fx-sec"><h2>إنتاج اليوم</h2></div>
          <div className="fx-card">
            {stock.products.map((p) => <div key={p.id} className="fx-kv"><span>{p.name}</span><b>{num(p.today.production)}</b></div>)}
          </div>
          <div className="fx-sec"><h2>المواد الخام</h2></div>
          <div className="fx-list">
            {stock.materials.length === 0 && <div className="fx-item"><span className="fx-muted">ضيف المواد الخام من الإعدادات.</span></div>}
            {stock.materials.map((m) => (
              <div key={m.id} className="fx-item">
                <span className="t"><b>{m.name}</b><span>الحد الأدنى {num(m.min_level)} {m.unit}</span></span>
                <span className="end">
                  <b className="fx-num" style={{ color: m.balance <= m.min_level ? "var(--fx-crit)" : "inherit" }}>{num(m.balance)} {m.unit}</b>
                  {edit && <button className="fx-link" onClick={() => setSheet({ kind: "mat", m })}>استلام</button>}
                </span>
              </div>
            ))}
          </div>
          <div className="fx-sec"><h2>آخر الأعطال</h2></div>
          <div className="fx-list">
            {downs.length === 0 && <div className="fx-item"><span className="fx-muted">ما في أعطال مسجّلة.</span></div>}
            {downs.slice(0, 10).map((d) => (
              <div key={d.id} className="fx-item">
                <span className="t"><b>{d.machine_name} · {d.reason}</b><span>{dateTime(d.started_at)} · {num(d.minutes)} دقيقة{d.damaged ? ` · تالف ${num(d.damaged)}` : ""}</span></span>
                {!d.ended_at && <span className="fx-pill crit">واقفة</span>}
              </div>
            ))}
          </div>
        </>
      )}
      {sheet?.kind === "prod" && <ProdSheet onClose={() => setSheet(null)} onDone={() => { setSheet(null); reload(); }} />}
      {sheet?.kind === "down" && <DownSheet onClose={() => setSheet(null)} onDone={() => { setSheet(null); reload(); }} />}
      {sheet?.kind === "up" && <UpSheet d={sheet.d} onClose={() => setSheet(null)} onDone={() => { setSheet(null); reload(); }} />}
      {sheet?.kind === "mat" && <MaterialSheet m={sheet.m} onClose={() => setSheet(null)} onDone={() => { setSheet(null); reload(); }} />}
    </>
  );
}

function ProdSheet({ onClose, onDone }) {
  const fx = useFx();
  const [product, setProduct] = useState(fx.boot.products[0]?.id || "");
  const [qty, setQty] = useState("");
  const [shift, setShift] = useState("صبحي");
  const [machine, setMachine] = useState("");
  return (
    <Sheet title="سجّل إنتاج" onClose={onClose}>
      <div className="fx-stack">
        <div className="fx-chips">{["صبحي", "مسائي", "ليلي"].map((s) => <button key={s} className={`fx-chip ${shift === s ? "on" : ""}`} onClick={() => setShift(s)}>{s}</button>)}</div>
        <div className="fx-grid2">
          <select value={product} onChange={(e) => setProduct(e.target.value)} aria-label="المنتج">{fx.boot.products.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          <input className="fx-input" type="number" inputMode="numeric" placeholder="عدد الكراتين" value={qty} onChange={(e) => setQty(e.target.value)} />
        </div>
        {fx.boot.machines.length > 0 && <select value={machine} onChange={(e) => setMachine(e.target.value)} aria-label="الماكنة"><option value="">الماكنة (اختياري)</option>{fx.boot.machines.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>}
        <Act className="fx-btn pri block" disabled={!(Number(qty) > 0)} onClick={async () => { await fapi.production({ product_id: product, qty, shift, machine_id: machine || null }); fx.toast("انسجل الإنتاج ودخل المستودع"); onDone(); }}>سجّل</Act>
      </div>
    </Sheet>
  );
}

const DOWN_REASONS = ["تسريب بالختم", "انقطاع كهربا", "عطل ميكانيكي", "نقص مواد خام", "تنظيف وصيانة", "غيره"];
function DownSheet({ onClose, onDone }) {
  const fx = useFx();
  const [machine, setMachine] = useState(fx.boot.machines[0]?.id || "");
  const [reason, setReason] = useState("");
  if (!fx.boot.machines.length) return <Sheet title="ماكنة وقفت" onClose={onClose}><Empty title="ما في مكنات" text="ضيف المكنات من الإعدادات." /></Sheet>;
  return (
    <Sheet title="ماكنة وقفت" onClose={onClose}>
      <div className="fx-stack">
        <select value={machine} onChange={(e) => setMachine(e.target.value)}>{fx.boot.machines.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
        <div className="fx-chips">{DOWN_REASONS.map((r) => <button key={r} className={`fx-chip ${reason === r ? "on" : ""}`} onClick={() => setReason(r)}>{r}</button>)}</div>
        <Act className="fx-btn danger block" disabled={!reason} onClick={async () => { await fapi.startDowntime({ machine_id: machine, reason }); fx.toast("انسجل التوقف ووصل للمالك"); onDone(); }}>سجّل التوقف</Act>
      </div>
    </Sheet>
  );
}

function UpSheet({ d, onClose, onDone }) {
  const fx = useFx();
  const [vals, setVals] = useState({});
  const [cost, setCost] = useState("");
  return (
    <Sheet title={`${d.machine_name} رجعت تشتغل`} onClose={onClose}>
      <div className="fx-stack">
        <p className="fx-muted" style={{ margin: 0 }}>كم كرتونة خربت بسبب العطل؟ (اتركها فاضية إذا ولا إشي)</p>
        {fx.boot.products.filter((p) => p.active).map((p) => (
          <label key={p.id} className="fx-row" style={{ flexWrap: "nowrap" }}>
            <span className="fx-grow">{p.name}</span>
            <input className="fx-input" style={{ width: 110 }} type="number" inputMode="numeric" value={vals[p.id] || ""} onChange={(e) => setVals({ ...vals, [p.id]: e.target.value })} />
          </label>
        ))}
        <label className="fx-field">كلفة التصليح (اختياري)<input className="fx-input" type="number" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} /></label>
        <Act className="fx-btn pri block" onClick={async () => {
          const r = await fapi.endDowntime(d.id, { repair_cost: cost, damaged: Object.entries(vals).filter(([, q]) => Number(q) > 0).map(([product_id, qty]) => ({ product_id: Number(product_id), qty: Number(qty) })) });
          fx.toast(`وقفت ${r.minutes} دقيقة${r.damaged ? ` · تالف ${r.damaged}` : ""}`);
          onDone();
        }}>احفظ</Act>
      </div>
    </Sheet>
  );
}

function MaterialSheet({ m, onClose, onDone }) {
  const fx = useFx();
  const [qty, setQty] = useState("");
  const [cost, setCost] = useState("");
  return (
    <Sheet title={`استلام ${m.name}`} onClose={onClose}>
      <div className="fx-stack">
        <div className="fx-grid2">
          <label className="fx-field">الكمية ({m.unit})<input className="fx-input" type="number" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} /></label>
          <label className="fx-field">الكلفة (اختياري)<input className="fx-input" type="number" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} /></label>
        </div>
        <Act className="fx-btn pri block" disabled={!(Number(qty) > 0)} onClick={async () => { await fapi.receiveMaterial(m.id, { qty, cost }); fx.toast("انضاف للرصيد"); onDone(); }}>احفظ</Act>
      </div>
    </Sheet>
  );
}

// ---------- السجل ----------
const MOVE = { production: ["إنتاج", "ok"], load: ["تحميل", "sky"], return: ["مرتجع", "sky"], damage: ["تالف", "crit"], adjust: ["تعديل", "warn"], count: ["جرد", "warn"] };
function Log() {
  const { data, error } = useLoad(() => fapi.moves({}), []);
  return (
    <>
      <Err msg={error} />
      {!data && !error && <Loading />}
      {data && (
        <div className="fx-list">
          {data.length === 0 && <div className="fx-item"><span className="fx-muted">ما في حركات آخر أسبوعين.</span></div>}
          {data.map((m) => (
            <div key={m.id} className="fx-item">
              <span className="t">
                <b>{m.product_name} · {num(Math.abs(m.qty))}</b>
                <span>{date(m.created_at)} {time(m.created_at)}{m.vehicle_name ? ` · ${m.vehicle_name}` : ""}{m.machine_name ? ` · ${m.machine_name}` : ""}{m.reason ? ` · ${m.reason}` : ""}{m.by_name ? ` · ${m.by_name}` : ""}</span>
              </span>
              <span className={`fx-pill ${MOVE[m.kind]?.[1] || ""}`}>{MOVE[m.kind]?.[0] || m.kind}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

