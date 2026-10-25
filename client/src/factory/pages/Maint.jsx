import { useMemo, useState } from "react";
import { FiPlus, FiTruck, FiSearch, FiX } from "react-icons/fi";
import { fapi } from "../fapi.js";
import { useFx, useLoad, Sheet, Err, Loading, Empty, Act, PhotoInput, DateInput, Reload, money, num, date, today } from "../ui.jsx";
import { smartFilter } from "../smartSearch.js";

// ============================================================
// صيانة السيارات بالتفصيل: كل نوع إله خاناته
// زيت (ماتور/جير/دفرنس + فلاتر)، كوشوك (عدد، مكان، ماركة، مقاس)، بطارية (أمبير، كفالة)،
// فرامل، ميكانيك/كهرباء/سمكرة (قطع بأسعارها + أجرة) — مع بحث بكل السجل وكلفة كل سيارة بالسنة
// ============================================================
const KIND_ICON = { oil: "🛢️", tires: "🛞", battery: "🔋", brakes: "🛑", mechanic: "🔧", electric: "⚡", body: "🎨", other: "🧰" };
const KIND_ORDER = ["oil", "tires", "battery", "brakes", "mechanic", "electric", "body", "other"];
const OIL_FOR = [["ماتور", 5000, 90], ["جير", 40000, null], ["دفرنس", 40000, null], ["هيدروليك", 40000, null]];
const VISC = ["5W30", "10W40", "15W40", "20W50", "75W90", "80W90", "ATF"];
const FILTERS = ["فلتر زيت", "فلتر هوا", "فلتر ديزل", "فلتر مكيف"];
const TIRE_POS = ["أمامي يمين", "أمامي يسار", "خلفي يمين", "خلفي يسار", "خلفي داخلي يمين", "خلفي داخلي يسار", "سبير"];
const BRAKE_WHERE = ["أمامي", "خلفي"];
const BRAKE_WHAT = ["فحمات", "ديسكات", "طنابير", "زيت فرامل"];

const addDays = (from, n) => new Date(Date.parse(`${from}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const addMonths = (from, n) => { const d = new Date(`${from}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); };

function dueText(d) {
  const parts = [];
  if (d.km_left != null) parts.push(d.km_left <= 0 ? `فات بـ${num(-d.km_left)} كم` : `باقي ${num(d.km_left)} كم`);
  if (d.days_left != null) parts.push(d.days_left < 0 ? `فات بـ${num(-d.days_left)} يوم` : d.days_left === 0 ? "اليوم" : `باقي ${num(d.days_left)} يوم`);
  return parts.join(" · ");
}

// سطر يلخّص التفاصيل
export function maintSummary(h) {
  const d = h.details || {};
  const parts = Array.isArray(h.parts) ? h.parts : [];
  const bits = [];
  if (h.kind === "oil") bits.push([d.brand, d.viscosity, d.liters && `${d.liters} لتر`].filter(Boolean).join(" "), (d.filters || []).join("، "));
  else if (h.kind === "tires") bits.push([d.count && `${d.count} ×`, d.brand, d.size, d.condition].filter(Boolean).join(" "), d.tire_no && `رقم ${d.tire_no}`, (d.positions || []).join("، "), d.made && `صنع ${d.made}`);
  else if (h.kind === "battery") bits.push([d.brand, d.amp && `${d.amp} أمبير`].filter(Boolean).join(" "), d.serial && `رقم ${d.serial}`, h.warranty_until && `كفالة لحد ${date(h.warranty_until)}`);
  else if (h.kind === "brakes") bits.push([(d.where || []).join(" و"), (d.what || []).join("، ")].filter(Boolean).join(": "));
  if (parts.length && h.kind !== "tires" && h.kind !== "battery") bits.push(parts.map((p) => `${p.name}${p.qty > 1 ? ` ×${p.qty}` : ""}`).join("، "));
  if (h.workshop) bits.push(`🏪 ${h.workshop}`);
  return bits.filter(Boolean).join(" · ");
}

export default function Maint() {
  const fx = useFx();
  const edit = fx.can("f_maint", "edit");
  const { data, error, reload } = useLoad(() => fapi.maint(), []);
  const [tab, setTab] = useState("cars");
  const [sheet, setSheet] = useState(null);
  const done = () => { setSheet(null); reload(); };
  const dueCount = (data?.vehicles || []).reduce((a, v) => a + v.dues.filter((d) => d.state === "due").length, 0);
  return (
    <div className="fx-page">
      <div className="fx-row" style={{ justifyContent: "space-between" }}>
        <h1 className="fx-h1" style={{ margin: 0 }}>صيانة السيارات</h1>
        <Reload onClick={reload} />
      </div>
      <div className="fx-tabs">
        {[["cars", "السيارات"], ["log", "السجل والبحث"], ["cost", "التكاليف"]].map(([k, l]) => <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      <Err msg={error} />
      {!data && !error && <Loading />}
      {data && data.vehicles.length === 0 && <Empty icon={FiTruck} title="ما في سيارات" text="ضيف السيارات من الإعدادات." />}
      {data && data.vehicles.length > 0 && tab === "cars" && (
        <>
          <div className="fx-grid2">
            <div className="fx-card" style={{ textAlign: "center" }}><small className="fx-muted">مستحق هلأ</small><b className="fx-num" style={{ display: "block", fontSize: 26, color: dueCount ? "var(--fx-crit)" : "var(--fx-ok)" }}>{num(dueCount)}</b></div>
            <div className="fx-card" style={{ textAlign: "center" }}><small className="fx-muted">صرفنا هالشهر</small><b className="fx-num" style={{ display: "block", fontSize: 26 }}>{money(data.month_cost)}</b></div>
          </div>
          {edit && <button className="fx-btn pri block fx-huge" onClick={() => setSheet({ kind: "add" })}><FiPlus /> سجّل صيانة</button>}
          <div className="fx-stack">
            {data.vehicles.map((v) => <VehicleCard key={v.id} v={v} edit={edit} onAdd={(k) => setSheet({ kind: "add", v, k })} onOdo={() => setSheet({ kind: "odo", v })} onOpen={() => setSheet({ kind: "car", v })} />)}
          </div>
        </>
      )}
      {data && data.vehicles.length > 0 && tab === "log" && <LogSearch data={data} />}
      {data && data.vehicles.length > 0 && tab === "cost" && <Costs />}
      {sheet?.kind === "add" && data && <AddSheet vehicles={data.vehicles} kinds={data.kinds} v0={sheet.v} k0={sheet.k} onClose={() => setSheet(null)} onDone={done} />}
      {sheet?.kind === "odo" && <OdoSheet v={sheet.v} onClose={() => setSheet(null)} onDone={done} />}
      {sheet?.kind === "car" && <CarSheet v={sheet.v} kinds={data.kinds} onClose={() => setSheet(null)} />}
    </div>
  );
}

function VehicleCard({ v, edit, onAdd, onOdo, onOpen }) {
  const bad = v.dues.filter((d) => d.state !== "ok");
  const bat = v.battery;
  const batLeft = bat?.warranty_until ? Math.round((Date.parse(`${bat.warranty_until}T12:00:00Z`) - Date.parse(`${today()}T12:00:00Z`)) / 86400000) : null;
  return (
    <section className="fx-card fx-stack" style={{ gap: 10 }}>
      <div className="fx-row" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
        <span className="fx-row" style={{ gap: 10, flexWrap: "nowrap" }}>
          <span className="fx-avatar"><FiTruck /></span>
          <span><b>{v.name}</b>{v.plate ? <small className="fx-muted"> · {v.plate}</small> : null}<br /><small className="fx-muted">{v.driver_name || "بدون سائق"}</small></span>
        </span>
        <button className="fx-plain" style={{ textAlign: "end" }} onClick={() => edit && onOdo()} aria-label="العداد">
          <small className="fx-muted">العداد تقريبًا</small><br />
          <b className="fx-num">{v.km_now != null ? `${num(v.km_now)} كم` : edit ? "سجّله ✎" : "—"}</b>
        </button>
      </div>
      {bad.length === 0 && v.dues.length > 0 && <div className="fx-note ok">كل إشي تمام ✓</div>}
      {v.dues.length === 0 && <div className="fx-muted" style={{ fontSize: 13 }}>ما في مواعيد صيانة جاية مسجّلة.</div>}
      {v.dues.map((d) => (
        <div key={d.id} className="fx-kv">
          <span>{KIND_ICON[d.kind] || "🧰"} {d.label}</span>
          <b style={{ color: d.state === "due" ? "var(--fx-crit)" : d.state === "soon" ? "var(--fx-warn)" : "var(--fx-muted)", fontWeight: d.state === "ok" ? 500 : 800 }}>{dueText(d) || "—"}</b>
        </div>
      ))}
      {batLeft != null && <div className="fx-kv"><span>🔋 كفالة البطارية</span><b style={{ color: batLeft < 0 ? "var(--fx-muted)" : batLeft < 30 ? "var(--fx-warn)" : "var(--fx-ok)" }}>{batLeft < 0 ? "خلصت" : `لحد ${date(bat.warranty_until)}`}</b></div>}
      <div className="fx-row" style={{ gap: 8 }}>
        {edit && <button className="fx-btn sm pri" onClick={() => onAdd()}><FiPlus /> صيانة</button>}
        <button className="fx-btn sm" onClick={onOpen}>السجل ({v.history.length})</button>
        <span className="fx-muted" style={{ fontSize: 12.5 }}>هالسنة {money(v.year_cost)} د.أ</span>
      </div>
    </section>
  );
}

function HistoryList({ rows, kinds, showCar = false }) {
  if (!rows.length) return <div className="fx-muted">ما في إشي.</div>;
  return (
    <div className="fx-list">
      {rows.map((h) => (
        <div key={h.id} className="fx-item" style={{ alignItems: "flex-start" }}>
          <span className="fx-avatar" style={{ fontSize: 18 }}>{KIND_ICON[h.kind] || "🧰"}</span>
          <span className="t">
            <b>{showCar ? `${h.vehicle_name} · ` : ""}{h.title || kinds[h.kind]?.label}{h.cost ? ` · ${money(h.cost)} د.أ` : ""}</b>
            <span>{date(h.done_on)}{h.odo ? ` · عداد ${num(h.odo)}` : ""}{h.by_name ? ` · ${h.by_name}` : ""}</span>
            {maintSummary(h) && <span>{maintSummary(h)}</span>}
            {Array.isArray(h.parts) && h.parts.length > 0 && h.kind !== "tires" && h.kind !== "battery" && (
              <span>{h.parts.map((p) => `${p.code ? `[${p.code}] ` : ""}${p.name}${p.qty > 1 ? ` ×${p.qty}` : ""}${p.price ? ` ${money(p.price * p.qty)}` : ""}${p.shop && p.shop !== h.workshop ? ` (${p.shop})` : ""}`).join(" · ")}{h.labor ? ` · أجرة ${money(h.labor)}` : ""}</span>
            )}
            {h.note && <span>📝 {h.note}</span>}
          </span>
          {h.photo_url && <a href={h.photo_url} target="_blank" rel="noreferrer"><img className="fx-photo" src={h.photo_url} alt="" /></a>}
        </div>
      ))}
    </div>
  );
}

function CarSheet({ v, kinds, onClose }) {
  const [k, setK] = useState("all");
  const rows = v.history.filter((h) => k === "all" || h.kind === k);
  const used = KIND_ORDER.filter((x) => v.history.some((h) => h.kind === x));
  return (
    <Sheet title={`سجل ${v.name}`} onClose={onClose}>
      <div className="fx-stack">
        <div className="fx-kv"><span>كلفة الصيانة هالسنة</span><b>{money(v.year_cost)} د.أ</b></div>
        {used.length > 1 && <div className="fx-chips"><button className={`fx-chip ${k === "all" ? "on" : ""}`} onClick={() => setK("all")}>الكل</button>{used.map((x) => <button key={x} className={`fx-chip ${k === x ? "on" : ""}`} onClick={() => setK(x)}>{KIND_ICON[x]} {kinds[x]?.label}</button>)}</div>}
        <HistoryList rows={rows} kinds={kinds} />
      </div>
    </Sheet>
  );
}

// بحث بكل السجل: «ماتور»، «فلتر»، «ميشلان»، رقم قطعة…
function LogSearch({ data }) {
  const [q, setQ] = useState("");
  const [car, setCar] = useState(null);
  const all = useMemo(() => data.vehicles.flatMap((v) => v.history.map((h) => ({
    ...h, vehicle_name: v.name,
    hay: [h.title, data.kinds[h.kind]?.label, h.note, h.workshop, maintSummary(h), ...(h.parts || []).flatMap((p) => [p.name, p.code, p.note, p.shop]), ...Object.values(h.details || {}).flat()].filter(Boolean).join(" "),
  }))).sort((a, b) => (a.done_on < b.done_on ? 1 : -1)), [data]);
  const inCar = all.filter((h) => !car || h.vehicle_id === car);
  const rows = q.trim() ? smartFilter(inCar, q, ["hay"]) : inCar.slice(0, 60);
  const total = rows.reduce((a, h) => a + h.cost, 0);
  return (
    <div className="fx-stack">
      <label className="fx-search"><FiSearch aria-hidden="true" />
        <input className="fx-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="دوّر: ماتور، فلتر، كوشوك، اسم قطعة أو رقمها" />
        {q && <button className="fx-plain" onClick={() => setQ("")} aria-label="امسح"><FiX /></button>}
      </label>
      <div className="fx-chips">
        <button className={`fx-chip ${!car ? "on" : ""}`} onClick={() => setCar(null)}>كل السيارات</button>
        {data.vehicles.map((v) => <button key={v.id} className={`fx-chip ${car === v.id ? "on" : ""}`} onClick={() => setCar(v.id)}>{v.name}</button>)}
      </div>
      {q.trim() && <div className="fx-muted" style={{ fontSize: 13 }}>{num(rows.length)} نتيجة · مجموعها {money(total)} د.أ</div>}
      <HistoryList rows={rows} kinds={data.kinds} showCar={!car} />
    </div>
  );
}

function Costs() {
  const y0 = Number(today().slice(0, 4));
  const [year, setYear] = useState(y0);
  const { data, error } = useLoad(() => fapi.maintReport(year), [year]);
  const max = Math.max(1, ...(data?.vehicles || []).map((v) => v.total));
  return (
    <div className="fx-stack">
      <div className="fx-chips">{[y0, y0 - 1, y0 - 2].map((y) => <button key={y} className={`fx-chip ${year === y ? "on" : ""}`} onClick={() => setYear(y)}>{y}</button>)}</div>
      <Err msg={error} />
      {!data && !error && <Loading />}
      {data && (
        <>
          <div className="fx-card" style={{ textAlign: "center" }}><small className="fx-muted">كلفة صيانة كل السيارات {data.year}</small><b className="fx-num" style={{ display: "block", fontSize: 28 }}>{money(data.total)} <small>د.أ</small></b></div>
          {data.vehicles.length === 0 && <div className="fx-muted">ما في صيانة مسجّلة بهالسنة.</div>}
          {data.vehicles.map((v) => (
            <section key={v.vehicle_id} className="fx-card fx-stack" style={{ gap: 6 }}>
              <div className="fx-row" style={{ justifyContent: "space-between" }}><b>{v.name}</b><b className="fx-num">{money(v.total)} د.أ</b></div>
              <div className="fx-bar"><i style={{ width: `${(v.total / max) * 100}%` }} /></div>
              {KIND_ORDER.filter((k) => v.kinds[k]).map((k) => <div key={k} className="fx-kv"><span>{KIND_ICON[k]} {LABEL[k]}</span><b>{money(v.kinds[k])}</b></div>)}
              <small className="fx-muted">{v.n} مرة صيانة · أغلى شهر: {AR_M[v.months.indexOf(Math.max(...v.months))]} ({money(Math.max(...v.months))})</small>
            </section>
          ))}
        </>
      )}
    </div>
  );
}
const LABEL = { oil: "زيوت وفلاتر", tires: "كوشوك", battery: "بطاريات", brakes: "فرامل", mechanic: "ميكانيك وقطع", electric: "كهرباء", body: "سمكرة ودهان", other: "ثانية" };
const AR_M = ["كانون الثاني", "شباط", "آذار", "نيسان", "أيار", "حزيران", "تموز", "آب", "أيلول", "تشرين الأول", "تشرين الثاني", "كانون الأول"];

// ---------- تسجيل صيانة: كل نوع بخاناته ----------
function Chips({ options, value, onChange, multi = false }) {
  const on = (o) => (multi ? (value || []).includes(o) : value === o);
  const tap = (o) => (multi ? onChange(on(o) ? value.filter((x) => x !== o) : [...(value || []), o]) : onChange(value === o ? "" : o));
  return <div className="fx-chips">{options.map((o) => <button key={o} type="button" className={`fx-chip ${on(o) ? "on" : ""}`} onClick={() => tap(o)}>{on(o) && multi ? "✓ " : ""}{o}</button>)}</div>;
}

function PartsEditor({ parts, setParts }) {
  const upd = (i, k, v) => setParts(parts.map((p, j) => (j === i ? { ...p, [k]: v } : p)));
  return (
    <div className="fx-stack" style={{ gap: 8 }}>
      {parts.map((p, i) => (
        <div key={i} className="fx-card" style={{ padding: 10 }}>
          <div className="fx-row" style={{ flexWrap: "nowrap", gap: 6 }}>
            <input className="fx-input fx-grow" value={p.name} onChange={(e) => upd(i, "name", e.target.value)} placeholder="اسم القطعة (مثلًا: كلتش)" />
            <button type="button" className="fx-plain" onClick={() => setParts(parts.filter((_, j) => j !== i))} aria-label="شيل"><FiX /></button>
          </div>
          <div className="fx-row" style={{ gap: 6, marginTop: 6, flexWrap: "nowrap" }}>
            <input className="fx-input" style={{ flex: 1.2 }} dir="ltr" value={p.code || ""} onChange={(e) => upd(i, "code", e.target.value)} placeholder="رقمها" />
            <input className="fx-input fx-num" style={{ flex: 0.8 }} type="number" inputMode="numeric" value={p.qty} onChange={(e) => upd(i, "qty", e.target.value)} placeholder="العدد" />
            <input className="fx-input fx-num" style={{ flex: 1 }} type="number" inputMode="decimal" value={p.price} onChange={(e) => upd(i, "price", e.target.value)} placeholder="السعر" />
          </div>
          <input className="fx-input" style={{ marginTop: 6 }} value={p.shop || ""} onChange={(e) => upd(i, "shop", e.target.value)} placeholder="المحل اللي تغيّرت عنده / انشرت منه" />
        </div>
      ))}
      <button type="button" className="fx-btn sm" onClick={() => setParts([...parts, { name: "", code: "", qty: 1, price: "", shop: parts[parts.length - 1]?.shop || "" }])}><FiPlus /> ضيف قطعة</button>
    </div>
  );
}

function AddSheet({ vehicles, kinds, v0, k0, onClose, onDone }) {
  const fx = useFx();
  const [vid, setVid] = useState(v0?.id || (vehicles.length === 1 ? vehicles[0].id : null));
  const v = vehicles.find((x) => x.id === vid);
  const [kind, setKind] = useState(k0 || "oil");
  const [odo, setOdo] = useState(v0?.km_now != null ? String(v0.km_now) : "");
  const [doneOn, setDoneOn] = useState(today());
  const [d, setD] = useState({ oil_for: "ماتور", filters: ["فلتر زيت"], count: 4, positions: [], warranty_months: 12 });
  const [parts, setParts] = useState([]);
  const [labor, setLabor] = useState("");
  const [costOver, setCostOver] = useState("");
  const [title, setTitle] = useState("");
  const [workshop, setWorkshop] = useState("");
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState("");
  const init = (() => {
    const k = k0 || "oil";
    const km = k === "oil" ? 5000 : kinds[k]?.km || null, days = k === "oil" ? 90 : kinds[k]?.days || null;
    const o = v0?.km_now;
    return { km: km && o != null ? String(o + km) : "", date: days ? addDays(today(), days) : "" };
  })();
  const [nextKm, setNextKm] = useState(init.km);
  const [nextDate, setNextDate] = useState(init.date);
  const [err, setErr] = useState("");
  const setDet = (k, val) => setD((x) => ({ ...x, [k]: val }));

  // الموعد الجاي الافتراضي حسب النوع
  const suggest = (k = kind, dd = d, o = odo) => {
    let km = null, days = null;
    if (k === "oil") { const f = OIL_FOR.find((x) => x[0] === dd.oil_for) || OIL_FOR[0]; km = f[1]; days = f[2]; }
    else { km = kinds[k]?.km || null; days = kinds[k]?.days || null; }
    setNextKm(km && o ? String(Number(o) + km) : "");
    setNextDate(days ? addDays(doneOn, days) : "");
  };
  const pickKind = (k) => { setKind(k); suggest(k); };

  // الكلفة حسب النوع
  const tireCost = (Number(d.count) || 0) * (Number(d.unit_price) || 0);
  const partsCost = parts.reduce((a, p) => a + (Number(p.qty) || 0) * (Number(p.price) || 0), 0);
  const base = kind === "tires" ? tireCost : kind === "battery" ? Number(d.unit_price) || 0 : kind === "oil" ? (Number(d.oil_cost) || 0) + (d.filters || []).reduce((a, f) => a + (Number(d.fprices?.[f]) || 0), 0) + partsCost : partsCost;
  const autoCost = Math.round((base + (Number(labor) || 0)) * 100) / 100;
  const cost = costOver !== "" ? Number(costOver) : autoCost;

  function payload() {
    const det = {};
    let ttl = title, ps = parts.filter((p) => p.name.trim()).map((p) => ({ ...p, qty: Number(p.qty) || 1, price: Number(p.price) || 0 }));
    let warranty = null;
    if (kind === "oil") {
      Object.assign(det, { oil_for: d.oil_for, brand: d.brand, viscosity: d.viscosity, liters: Number(d.liters) || undefined, filters: d.filters });
      ttl = `زيت ${d.oil_for || "ماتور"}`;
      ps = [
        ...(d.oil_cost ? [{ name: `زيت ${d.oil_for} ${d.viscosity || ""}`.trim(), qty: 1, price: Number(d.oil_cost) }] : []),
        ...(d.filters || []).map((f) => ({ name: f, qty: 1, price: Number(d.fprices?.[f]) || 0, shop: workshop || undefined })),
        ...ps,
      ];
    } else if (kind === "tires") {
      Object.assign(det, { count: Number(d.count) || undefined, positions: d.positions, brand: d.brand, size: d.size, made: d.made, condition: d.condition, tire_no: d.tire_no });
      if (d.unit_price) ps = [{ name: `كوشوك ${d.brand || ""} ${d.size || ""}`.trim(), qty: Number(d.count) || 1, price: Number(d.unit_price) }];
    } else if (kind === "battery") {
      Object.assign(det, { brand: d.brand, amp: Number(d.amp) || undefined, serial: d.serial, warranty_months: Number(d.warranty_months) || undefined, shop: workshop || undefined });
      if (d.unit_price) ps = [{ name: `بطارية ${d.brand || ""} ${d.amp ? `${d.amp}A` : ""}`.trim(), qty: 1, price: Number(d.unit_price) }];
      if (Number(d.warranty_months) > 0) warranty = addMonths(doneOn, Number(d.warranty_months));
    } else if (kind === "brakes") {
      Object.assign(det, { where: d.where, what: d.what });
      ttl = ttl || ["فرامل", (d.where || []).join(" و")].filter(Boolean).join(" ");
    }
    return { vehicle_id: vid, kind, title: ttl || undefined, odo, cost, labor, workshop, note, photo_url: photo || undefined, details: det, parts: ps, next_km: nextKm, next_date: nextDate, done_on: doneOn, warranty_until: warranty };
  }

  return (
    <Sheet title="سجّل صيانة" onClose={onClose}>
      <div className="fx-stack">
        {!v0 && (
          <div className="fx-field">السيارة
            <div className="fx-chips">{vehicles.map((x) => <button key={x.id} type="button" className={`fx-chip ${vid === x.id ? "on" : ""}`} onClick={() => { setVid(x.id); const o = x.km_now != null ? String(x.km_now) : ""; setOdo(o); suggest(kind, d, o); }}>{x.name}</button>)}</div>
          </div>
        )}
        <div className="fx-field">شو انعمل؟
          <div className="fx-chips">{KIND_ORDER.map((k) => <button key={k} type="button" className={`fx-chip ${kind === k ? "on" : ""}`} onClick={() => pickKind(k)}>{KIND_ICON[k]} {kinds[k]?.label || LABEL[k]}</button>)}</div>
        </div>

        {kind === "oil" && (
          <div className="fx-card fx-stack" style={{ gap: 8 }}>
            <div className="fx-field">زيت شو؟<Chips options={OIL_FOR.map((x) => x[0])} value={d.oil_for} onChange={(val) => { const nd = { ...d, oil_for: val || "ماتور" }; setD(nd); suggest("oil", nd); }} /></div>
            <div className="fx-field">اللزوجة<Chips options={VISC} value={d.viscosity} onChange={(val) => setDet("viscosity", val)} /></div>
            <div className="fx-grid2">
              <label className="fx-field">الماركة<input className="fx-input" value={d.brand || ""} onChange={(e) => setDet("brand", e.target.value)} placeholder="مثلًا: توتال" /></label>
              <label className="fx-field">كم لتر<input className="fx-input fx-num" type="number" inputMode="decimal" value={d.liters || ""} onChange={(e) => setDet("liters", e.target.value)} /></label>
            </div>
            <label className="fx-field">سعر الزيت<input className="fx-input fx-num" type="number" inputMode="decimal" value={d.oil_cost || ""} onChange={(e) => setDet("oil_cost", e.target.value)} /></label>
            <div className="fx-field">شو غيّرت معه؟<Chips multi options={FILTERS} value={d.filters} onChange={(val) => setDet("filters", val)} /></div>
            {(d.filters || []).length > 0 && (
              <div className="fx-grid2">
                {d.filters.map((f) => (
                  <label key={f} className="fx-field">سعر {f}
                    <input className="fx-input fx-num" type="number" inputMode="decimal" value={d.fprices?.[f] || ""} onChange={(e) => setDet("fprices", { ...(d.fprices || {}), [f]: e.target.value })} />
                  </label>
                ))}
              </div>
            )}
          </div>
        )}

        {kind === "tires" && (
          <div className="fx-card fx-stack" style={{ gap: 8 }}>
            <div className="fx-field">كم كوشوك؟<Chips options={["1", "2", "4", "6"]} value={String(d.count || "")} onChange={(val) => setDet("count", Number(val) || "")} /></div>
            <div className="fx-field">وين ركبوا؟<Chips multi options={TIRE_POS} value={d.positions} onChange={(val) => { setDet("positions", val); if (val.length) setDet("count", val.length); }} /></div>
            <div className="fx-grid2">
              <label className="fx-field">الماركة<input className="fx-input" value={d.brand || ""} onChange={(e) => setDet("brand", e.target.value)} placeholder="مثلًا: ميشلان" /></label>
              <label className="fx-field">رقم الكوشوك<input className="fx-input" dir="ltr" value={d.tire_no || ""} onChange={(e) => setDet("tire_no", e.target.value)} placeholder="المكتوب على الجنب (DOT)" /></label>
              <label className="fx-field">المقاس<input className="fx-input" dir="ltr" value={d.size || ""} onChange={(e) => setDet("size", e.target.value)} placeholder="195/65R15" /></label>
              <label className="fx-field">سنة الصنع<input className="fx-input fx-num" inputMode="numeric" value={d.made || ""} onChange={(e) => setDet("made", e.target.value)} placeholder="2026" /></label>
              <label className="fx-field">سعر الوحدة<input className="fx-input fx-num" type="number" inputMode="decimal" value={d.unit_price || ""} onChange={(e) => setDet("unit_price", e.target.value)} /></label>
            </div>
            <Chips options={["جديد", "مستعمل"]} value={d.condition} onChange={(val) => setDet("condition", val)} />
          </div>
        )}

        {kind === "battery" && (
          <div className="fx-card fx-stack" style={{ gap: 8 }}>
            <div className="fx-grid2">
              <label className="fx-field">الماركة<input className="fx-input" value={d.brand || ""} onChange={(e) => setDet("brand", e.target.value)} placeholder="مثلًا: فارتا" /></label>
              <label className="fx-field">الأمبير<input className="fx-input fx-num" type="number" inputMode="numeric" value={d.amp || ""} onChange={(e) => setDet("amp", e.target.value)} placeholder="100" /></label>
              <label className="fx-field">الرقم التسلسلي<input className="fx-input" dir="ltr" value={d.serial || ""} onChange={(e) => setDet("serial", e.target.value)} /></label>
              <label className="fx-field">السعر<input className="fx-input fx-num" type="number" inputMode="decimal" value={d.unit_price || ""} onChange={(e) => setDet("unit_price", e.target.value)} /></label>
            </div>
            <div className="fx-field">الكفالة<Chips options={["0", "6", "12", "18", "24"]} value={String(d.warranty_months ?? "")} onChange={(val) => setDet("warranty_months", Number(val) || 0)} /></div>
            {Number(d.warranty_months) > 0 && <small className="fx-muted">بتخلص الكفالة {date(addMonths(doneOn, Number(d.warranty_months)))} — صوّر كرت الكفالة تحت.</small>}
          </div>
        )}

        {kind === "brakes" && (
          <div className="fx-card fx-stack" style={{ gap: 8 }}>
            <div className="fx-field">وين؟<Chips multi options={BRAKE_WHERE} value={d.where} onChange={(val) => setDet("where", val)} /></div>
            <div className="fx-field">شو تغيّر؟<Chips multi options={BRAKE_WHAT} value={d.what} onChange={(val) => setDet("what", val)} /></div>
          </div>
        )}

        {["mechanic", "electric", "body", "other"].includes(kind) && (
          <label className="fx-field">شو انعمل بالضبط؟<input className="fx-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={kind === "mechanic" ? "مثلًا: تغيير كلتش، نقلة ماتور" : kind === "electric" ? "مثلًا: دينمو" : kind === "body" ? "مثلًا: دهان باب" : ""} /></label>
        )}

        {!["tires", "battery"].includes(kind) && (
          <div className="fx-field">{kind === "oil" ? "قطع ثانية (اختياري)" : "القطع اللي تغيّرت"}<PartsEditor parts={parts} setParts={setParts} /></div>
        )}

        <div className="fx-grid2">
          <label className="fx-field">أجرة الفني/الكراج<input className="fx-input fx-num" type="number" inputMode="decimal" value={labor} onChange={(e) => setLabor(e.target.value)} placeholder="0" /></label>
          <label className="fx-field">{kind === "battery" ? "المحل اللي انشرت منه" : kind === "tires" ? "محل الكوشوك" : "الكراج/المحل"}<input className="fx-input" value={workshop} onChange={(e) => setWorkshop(e.target.value)} /></label>
        </div>
        <div className="fx-pay-sum">
          <span>الكلفة الكاملة <b>{money(cost)}</b> د.أ</span>
          <input className="fx-input fx-num" style={{ width: 110 }} type="number" inputMode="decimal" value={costOver} onChange={(e) => setCostOver(e.target.value)} placeholder="غيّرها" aria-label="الكلفة يدوي" />
        </div>
        <div className="fx-grid2">
          <label className="fx-field">العداد هلأ (كم)<input className="fx-input fx-num" type="number" inputMode="numeric" value={odo} onChange={(e) => { setOdo(e.target.value); suggest(kind, d, e.target.value); }} placeholder={v?.km_now != null ? String(v.km_now) : ""} /></label>
          <div className="fx-field">التاريخ<DateInput value={doneOn} onChange={setDoneOn} ariaLabel="تاريخ الصيانة" /></div>
        </div>
        <div className="fx-card" style={{ background: "var(--fx-sky-soft)" }}>
          <b style={{ fontSize: 14 }}>⏰ ذكّرني بالموعد الجاي</b>
          <div className="fx-stack" style={{ gap: 8, marginTop: 8 }}>
            <label className="fx-field">لما يوصل العداد (كم)<input className="fx-input fx-num" type="number" inputMode="numeric" value={nextKm} onChange={(e) => setNextKm(e.target.value)} placeholder="فاضي = بدون" /></label>
            <div className="fx-field">أو بتاريخ<DateInput value={nextDate} onChange={setNextDate} ariaLabel="تاريخ الموعد الجاي" /></div>
          </div>
        </div>
        <PhotoInput label="صورة الفاتورة/الكفالة (اختياري)" value={photo} onChange={setPhoto} />
        <label className="fx-field">ملاحظة (اختياري)<input className="fx-input" value={note} onChange={(e) => setNote(e.target.value)} /></label>
        <Err msg={err} />
        <Act className="fx-btn pri block fx-huge" disabled={!vid} onClick={async () => {
          setErr("");
          try { await fapi.addMaint(payload()); fx.toast("انسجّلت الصيانة ✓"); onDone(); } catch (e) { setErr(e.message); }
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
