import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { FiPrinter, FiSettings, FiPlus } from "react-icons/fi";
import { fapi } from "../fapi.js";
import { useFx, useLoad, Sheet, Err, Loading, Empty, Act, DateInput, Reload, money, num, time, date, today } from "../ui.jsx";

// ============================================================
// خطي: فحص الجودة كل كم ساعة، الفلاتر ومواعيدها، تالف الخط، وورقة اليوم للطباعة
// ============================================================
const EVERY = [30, 60, 90, 120, 180, 240];
const fmtQty = (n) => (Number.isInteger(Number(n)) ? num(n) : Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 }));

function untilText(iso) {
  if (!iso) return { text: "ما في فحص اليوم لسا", late: true };
  const m = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
  if (m <= 0) return { text: m > -5 ? "حان وقته هلأ" : `متأخر ${m > -60 ? `${-m} دقيقة` : `${Math.round(-m / 60)} ساعة`}`, late: true };
  return { text: m < 60 ? `بعد ${m} دقيقة` : `بعد ${Math.floor(m / 60)} ساعة${m % 60 ? ` و${m % 60} دقيقة` : ""}`, late: false };
}

export default function Line() {
  const fx = useFx();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const fixed = Number(params.get("line")) || null; // جاي من صفحة المصنع
  const { data, error, reload } = useLoad(() => fapi.line(), []);
  const [pick, setPick] = useState(fixed);
  const [sheet, setSheet] = useState(null);
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 30000); return () => clearInterval(t); }, []);
  const lines = data?.lines || [];
  const l = lines.find((x) => x.id === pick) || lines.find((x) => x.mine) || lines[0];
  const plantName = (n) => (n || "").replace(/^خط\s*/, "مصنع ");
  const C = data?.can || {};
  const done = () => { setSheet(null); reload(); };
  const due = l ? untilText(l.next_check_at) : null;
  const fDue = l ? l.filters.filter((f) => f.state === "due").length : 0;

  return (
    <div className="fx-page">
      {fixed && l && <button className="fx-link" style={{ justifySelf: "start" }} onClick={() => nav(`/f/plant/${l.id}`)}>→ {plantName(l.name)}</button>}
      <div className="fx-row" style={{ justifyContent: "space-between" }}>
        <h1 className="fx-h1" style={{ margin: 0 }}>{l ? (fixed ? `التعقيم والفحوصات — ${plantName(l.name)}` : l.name) : "خط الإنتاج"}</h1>
        <span className="fx-row" style={{ gap: 6 }}>
          {C.setup && l && <button className="fx-btn sm" onClick={() => setSheet({ kind: "settings" })}><FiSettings /> إعدادات</button>}
          <Reload onClick={reload} />
        </span>
      </div>
      <Err msg={error} />
      {!data && !error && <Loading />}
      {data && !lines.length && <Empty title="ما في خطوط إنتاج" text="الإدارة بتضيف الخطوط من «المواد وقطع الغيار» ← «المصانع والخطوط»." />}
      {lines.length > 1 && !fixed && (
        <div className="fx-chips">{lines.map((x) => <button key={x.id} className={`fx-chip ${l?.id === x.id ? "on" : ""}`} onClick={() => setPick(x.id)}>{x.mine ? "★ " : ""}{x.name}</button>)}</div>
      )}

      {l && (
        <>
          <section className="fx-card fx-stack" style={{ gap: 8, borderInlineStart: `4px solid ${due.late ? "var(--fx-crit)" : "var(--fx-ok)"}` }}>
            <div className="fx-row" style={{ justifyContent: "space-between" }}>
              <span><small className="fx-muted">الفحص الجاي (كل {l.check_every_min >= 60 ? `${l.check_every_min / 60} ساعة` : `${l.check_every_min} دقيقة`})</small><br /><b style={{ fontSize: 18, color: due.late ? "var(--fx-crit)" : "var(--fx-ok)" }}>{due.text}</b></span>
              <span className="fx-muted" style={{ fontSize: 12.5 }}>{l.last_check_at ? `آخر فحص ${time(l.last_check_at)}` : ""}</span>
            </div>
            {C.record && <button className="fx-btn pri block fx-huge" onClick={() => setSheet({ kind: "check" })}>🧪 سجّل فحص هلأ</button>}
          </section>

          <div className="fx-grid2">
            <button className="fx-btn" onClick={() => setSheet({ kind: "filters" })}>🔁 الفلاتر{fDue ? ` (${fDue} مستحق)` : ""}</button>
            {C.record && <button className="fx-btn" onClick={() => setSheet({ kind: "waste" })}>⚠️ سجّل تالف</button>}
            <button className="fx-btn" onClick={() => setSheet({ kind: "print" })}><FiPrinter /> ورقة الفحوصات</button>
            <button className="fx-btn" onClick={() => nav("/f/store?tab=material")}>📤 سحب من المستودع</button>
          </div>

          {l.filters.filter((f) => f.state !== "ok").map((f) => (
            <div key={f.id} className={`fx-alert ${f.state === "due" ? "crit" : "warn"}`}>
              <div className="h"><b>🔁 {f.name}</b><time>{f.days_left == null ? "ما في غيار مسجّل" : f.days_left <= 0 ? `فات بـ${-f.days_left} يوم` : `باقي ${f.days_left} يوم`}</time></div>
              {C.record && <button className="fx-btn sm" onClick={() => setSheet({ kind: "change", f })}>✓ غيّرته</button>}
            </div>
          ))}

          <div className="fx-sec"><h2>فحوصات اليوم ({l.checks_today.length})</h2></div>
          {l.checks_today.length === 0 && <div className="fx-muted">ما في فحوصات اليوم لسا.</div>}
          <div className="fx-list">
            {l.checks_today.map((q) => (
              <div key={q.id} className="fx-item" style={{ alignItems: "flex-start" }}>
                <span className="fx-avatar" style={{ fontSize: 17 }}>{q.issues.length ? "⚠️" : "✅"}</span>
                <span className="t">
                  <b>{time(q.checked_at)} · {q.by_name || ""}</b>
                  <span>{[q.ozone != null && `أوزون ${Number(q.ozone)}`, q.tds != null && `TDS ${Number(q.tds)}`, q.ph != null && `pH ${Number(q.ph)}`, q.soft_before && `سوفتنر قبل ${q.soft_before}`, q.soft_after && `بعد ${q.soft_after}`, q.chlorine_before && `كلور قبل الكربون ${q.chlorine_before}`, q.chlorine && `كلور بعد الكربون ${q.chlorine}`].filter(Boolean).join(" · ")}</span>
                  {q.issues.length > 0 && <span style={{ color: "var(--fx-crit)" }}>{q.issues.join("، ")}</span>}
                  {q.note && <span>📝 {q.note}</span>}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {sheet?.kind === "check" && <CheckSheet l={l} colors={data.colors} onClose={() => setSheet(null)} onDone={done} />}
      {sheet?.kind === "filters" && <FiltersSheet l={l} canRecord={C.record} canSetup={C.setup} onChange={(f) => setSheet({ kind: "change", f })} onEdit={(f) => setSheet({ kind: "filter", f })} onClose={() => setSheet(null)} />}
      {sheet?.kind === "change" && <ChangeSheet f={sheet.f} onClose={() => setSheet(null)} onDone={done} />}
      {sheet?.kind === "filter" && <FilterEdit f={sheet.f} l={l} onClose={() => setSheet(null)} onDone={done} />}
      {sheet?.kind === "waste" && <WasteSheet l={l} onClose={() => setSheet(null)} onDone={done} />}
      {sheet?.kind === "print" && <PrintSheet l={l} onClose={() => setSheet(null)} />}
      {sheet?.kind === "settings" && <SettingsSheet l={l} colors={data.colors} onClose={() => setSheet(null)} onDone={done} />}
    </div>
  );
}

function ColorPick({ label, options, value, onChange }) {
  const dot = { "أحمر": "#e5484d", "أزرق": "#2f7de1", "أبيض": "#f4f4f4", "أصفر": "#f5c518" };
  return (
    <div className="fx-field">{label}
      <div className="fx-pay-modes">
        {options.map((o) => (
          <button key={o} type="button" className={value === o ? "on" : ""} onClick={() => onChange(value === o ? "" : o)}>
            <span style={{ display: "inline-block", width: 14, height: 14, borderRadius: 7, background: dot[o], border: "1px solid #ccc", verticalAlign: "middle", marginInlineEnd: 6 }} />{o}
          </button>
        ))}
      </div>
    </div>
  );
}

function CheckSheet({ l, colors, onClose, onDone }) {
  const fx = useFx();
  const [f, setF] = useState({ ozone: "", tds: "", ph: "", soft_before: "", soft_after: "", chlorine_before: "", chlorine: "", note: "" });
  const [err, setErr] = useState("");
  const [res, setRes] = useState(null);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v?.target ? v.target.value : v }));
  const L = l.limits || {};
  const range = (a, b) => (a != null || b != null ? `${a ?? "…"} – ${b ?? "…"}` : "");
  if (res) {
    return (
      <Sheet title="انسجّل الفحص" onClose={onDone}>
        <div className="fx-stack">
          {res.issues.length ? <div className="fx-note crit">⚠️ {res.issues.join("، ")} — وصل تنبيه للإدارة.</div> : <div className="fx-note ok">✅ كل الفحص ضمن الحدود.</div>}
          <button className="fx-btn block" onClick={onDone}>تمام</button>
        </div>
      </Sheet>
    );
  }
  const numIn = (k, label, hint) => (
    <label className="fx-field">{label}{hint ? <small className="fx-muted"> (المسموح {hint})</small> : null}
      <input className="fx-input fx-num" style={{ fontSize: 20, textAlign: "center", fontWeight: 800 }} type="number" inputMode="decimal" step="any" value={f[k]} onChange={set(k)} />
    </label>
  );
  return (
    <Sheet title={`فحص ${l.name} · ${time(new Date().toISOString())}`} onClose={onClose}>
      <div className="fx-stack">
        <div className="fx-grid2">
          {numIn("ozone", "أوزون", range(L.ozone_min, L.ozone_max))}
          {numIn("tds", "TDS", range(L.tds_min, L.tds_max))}
        </div>
        {numIn("ph", "pH", range(L.ph_min, L.ph_max))}
        <ColorPick label="عينة السوفتنر — قبل الجهاز" options={colors.soft} value={f.soft_before} onChange={set("soft_before")} />
        <ColorPick label="عينة السوفتنر — بعد الجهاز" options={colors.soft} value={f.soft_after} onChange={set("soft_after")} />
        <ColorPick label="الكلور — قبل الكربون" options={colors.cl} value={f.chlorine_before} onChange={set("chlorine_before")} />
        <ColorPick label="الكلور — بعد الكربون" options={colors.cl} value={f.chlorine} onChange={set("chlorine")} />
        <label className="fx-field">ملاحظة (اختياري)<input className="fx-input" value={f.note} onChange={set("note")} /></label>
        <Err msg={err} />
        <Act className="fx-btn pri block fx-huge" onClick={async () => {
          setErr("");
          try { const r = await fapi.lineCheck(l.id, f); fx.toast("انسجّل ✓"); setRes(r); } catch (e) { setErr(e.message); }
        }}>✓ سجّل الفحص</Act>
      </div>
    </Sheet>
  );
}

function FiltersSheet({ l, canRecord, canSetup, onChange, onEdit, onClose }) {
  return (
    <Sheet title={`فلاتر ${l.name}`} onClose={onClose}>
      <div className="fx-stack">
        {l.filters.length === 0 && <div className="fx-muted">ما في فلاتر مسجّلة{canSetup ? " — ضيفها من تحت." : "."}</div>}
        <div className="fx-list">
          {l.filters.map((f) => (
            <div key={f.id} className="fx-item">
              <span className="fx-avatar">🔁</span>
              <span className="t">
                <b>{f.name}</b>
                <span>كل {f.every_days} يوم · {f.last_changed ? `آخر غيار ${date(f.last_changed)}` : "ما في غيار مسجّل"}{f.material_name ? ` · بالمستودع ${fmtQty(f.material_balance)} ${f.material_unit}` : ""}</span>
                <span style={{ color: f.state === "due" ? "var(--fx-crit)" : f.state === "soon" ? "var(--fx-warn)" : "var(--fx-ok)", fontWeight: 700 }}>{f.days_left == null ? "مستحق" : f.days_left <= 0 ? `مستحق (فات ${-f.days_left} يوم)` : `باقي ${f.days_left} يوم`}</span>
              </span>
              <span className="fx-stack" style={{ gap: 4 }}>
                {canRecord && <button className="fx-btn sm ok" onClick={() => onChange(f)}>غيّرته</button>}
                {canSetup && <button className="fx-btn sm" onClick={() => onEdit(f)}>تعديل</button>}
              </span>
            </div>
          ))}
        </div>
        {canSetup && <button className="fx-btn block" onClick={() => onEdit({})}><FiPlus /> فلتر جديد</button>}
      </div>
    </Sheet>
  );
}

function ChangeSheet({ f, onClose, onDone }) {
  const fx = useFx();
  const [qty, setQty] = useState(String(f.qty_per_change || 1));
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  return (
    <Sheet title={`غيّرت ${f.name}`} onClose={onClose}>
      <div className="fx-stack">
        {f.material_name ? (
          <>
            <label className="fx-field">كم {f.material_unit} سحبت من «{f.material_name}»؟ <small className="fx-muted">(بالمستودع {fmtQty(f.material_balance)})</small>
              <input className="fx-input fx-num" style={{ fontSize: 22, textAlign: "center", fontWeight: 800 }} type="number" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />
            </label>
            {Number(qty) > 0 && <small className="fx-muted">بيضل بالمستودع {fmtQty(f.material_balance - Number(qty))} {f.material_unit}</small>}
          </>
        ) : <div className="fx-note">هالفلتر مش مربوط بصنف بالمستودع — بنسجّل الغيار بس.</div>}
        <label className="fx-field">ملاحظة (اختياري)<input className="fx-input" value={note} onChange={(e) => setNote(e.target.value)} /></label>
        <Err msg={err} />
        <Act className="fx-btn ok block fx-huge" onClick={async () => {
          setErr("");
          try {
            const r = await fapi.filterChange(f.id, { qty: f.material_name ? qty : 0, note });
            fx.toast(r.material ? `انسجّل — ضل ${fmtQty(r.left)} ${r.unit} بالمستودع` : "انسجّل الغيار ✓");
            onDone();
          } catch (e) { setErr(e.message); }
        }}>✓ غيّرته</Act>
      </div>
    </Sheet>
  );
}

function FilterEdit({ f, l, onClose, onDone }) {
  const fx = useFx();
  const { data: store } = useLoad(() => fapi.store(), []);
  const [v, setV] = useState({ name: f.name || "", every_days: f.every_days || 14, material_id: f.material_id || null, qty_per_change: f.qty_per_change || 1, last_changed: f.last_changed || "", line_id: f.id ? f.line_id : l.id, active: f.active !== false });
  const [err, setErr] = useState("");
  const items = (store?.items || []).filter((m) => m.active && m.kind === "material" && (!m.line_id || m.line_id === l.id));
  return (
    <Sheet title={f.id ? `تعديل ${f.name}` : "فلتر جديد"} onClose={onClose}>
      <div className="fx-stack">
        <label className="fx-field">اسم الفلتر<input className="fx-input" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="مثلًا: فلتر RO، فلتر رملي، فلتر كربون" /></label>
        <div className="fx-field">بيتغيّر كل كم يوم؟
          <div className="fx-chips">{[7, 14, 20, 30, 60, 90].map((d) => <button key={d} type="button" className={`fx-chip ${Number(v.every_days) === d ? "on" : ""}`} onClick={() => setV({ ...v, every_days: d })}>{d} يوم</button>)}</div>
          <input className="fx-input fx-num" type="number" inputMode="numeric" value={v.every_days} onChange={(e) => setV({ ...v, every_days: e.target.value })} />
        </div>
        <div className="fx-field">آخر مرة تغيّر<DateInput value={v.last_changed} onChange={(x) => setV({ ...v, last_changed: x })} ariaLabel="آخر غيار" /></div>
        <div className="fx-field">بينسحب من المستودع (اختياري)
          {!store && <Loading />}
          <div className="fx-chips">
            <button type="button" className={`fx-chip ${!v.material_id ? "on" : ""}`} onClick={() => setV({ ...v, material_id: null })}>ولا إشي</button>
            {items.map((m) => <button key={m.id} type="button" className={`fx-chip ${v.material_id === m.id ? "on" : ""}`} onClick={() => setV({ ...v, material_id: m.id })}>{m.name}</button>)}
          </div>
        </div>
        {v.material_id && <label className="fx-field">كم بينسحب كل غيار؟<input className="fx-input fx-num" type="number" inputMode="decimal" value={v.qty_per_change} onChange={(e) => setV({ ...v, qty_per_change: e.target.value })} /></label>}
        {f.id && <label className="fx-row" style={{ gap: 8 }}><input type="checkbox" checked={!v.active} onChange={(e) => setV({ ...v, active: !e.target.checked })} /> وقّف هالفلتر</label>}
        <Err msg={err} />
        <Act className="fx-btn pri block" disabled={!v.name.trim()} onClick={async () => {
          setErr("");
          try { f.id ? await fapi.editFilter(f.id, v) : await fapi.addFilter(v); fx.toast("انحفظ"); onDone(); } catch (e) { setErr(e.message); }
        }}>حفظ</Act>
      </div>
    </Sheet>
  );
}

function WasteSheet({ l, onClose, onDone }) {
  const fx = useFx();
  const { data: store } = useLoad(() => fapi.store(), []);
  const [vals, setVals] = useState({});
  const [hours, setHours] = useState("");
  const [machine, setMachine] = useState(null);
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const items = (store?.items || []).filter((m) => m.active && m.kind === "material" && (!m.line_id || m.line_id === l.id));
  const machines = (store?.machines || []).filter((m) => m.active && (!m.line_id || m.line_id === l.id));
  const picked = Object.entries(vals).filter(([, q]) => Number(q) > 0);
  const cost = picked.reduce((a, [id, q]) => a + Number(q) * (items.find((m) => m.id === Number(id))?.price || 0), 0);
  return (
    <Sheet title={`تالف ${l.name}`} onClose={onClose}>
      <div className="fx-stack">
        <div className="fx-note">شو خرب معك وإنت شغال؟ كراتين، مطرات، قصدير، بلاستيك، أغطية، ليبل…</div>
        {!store && <Loading />}
        {items.map((m) => (
          <label key={m.id} className="fx-row" style={{ flexWrap: "nowrap" }}>
            <span className="fx-grow">{m.name} <small className="fx-muted">({m.unit})</small></span>
            <input className="fx-input fx-num" style={{ width: 100 }} type="number" inputMode="decimal" value={vals[m.id] || ""} placeholder="0" onChange={(e) => setVals({ ...vals, [m.id]: e.target.value })} />
          </label>
        ))}
        {machines.length > 0 && <div className="fx-field">على أي ماكنة؟<div className="fx-chips">{machines.map((m) => <button key={m.id} type="button" className={`fx-chip ${machine === m.id ? "on" : ""}`} onClick={() => setMachine(machine === m.id ? null : m.id)}>{m.name}</button>)}</div></div>}
        <label className="fx-field">كم ساعة اشتغلت الماكنة؟ (اختياري)<input className="fx-input fx-num" type="number" inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} /></label>
        <label className="fx-field">السبب (اختياري)<input className="fx-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="مثلًا: الماكنة بتقطع الليبل" /></label>
        {cost > 0 && <div className="fx-pay-sum"><span>قيمة التالف تقريبًا <b>{money(cost)}</b> د.أ</span></div>}
        <Err msg={err} />
        <Act className="fx-btn pri block fx-huge" disabled={!picked.length} onClick={async () => {
          setErr("");
          try {
            await fapi.lineWaste({ line_id: l.id, machine_id: machine, run_hours: hours, note, items: picked.map(([id, q]) => ({ material_id: Number(id), qty: Number(q) })) });
            fx.toast("انسجّل التالف"); onDone();
          } catch (e) { setErr(e.message); }
        }}>✓ سجّل</Act>
      </div>
    </Sheet>
  );
}

// ورقة الفحوصات اليومية: بتفتح صفحة نظيفة للطباعة أو الحفظ PDF
function PrintSheet({ l, onClose }) {
  const fx = useFx();
  const [day, setDay] = useState(today());
  const { data, error } = useLoad(() => fapi.lineSheet(l.id, day), [l.id, day]);
  function print() {
    const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    const brand = fx.boot.factory?.name || fx.shop?.name || "";
    const rows = (data.checks || []).map((q, i) => `<tr class="${q.issues.length ? "bad" : ""}"><td>${i + 1}</td><td>${esc(time(q.checked_at))}</td><td>${q.ozone ?? ""}</td><td>${q.tds ?? ""}</td><td>${q.ph ?? ""}</td><td>${esc(q.soft_before || "")}</td><td>${esc(q.soft_after || "")}</td><td>${esc(q.chlorine_before || "")}</td><td>${esc(q.chlorine || "")}</td><td>${esc(q.by_name || "")}</td><td>${esc([q.issues.join("، "), q.note].filter(Boolean).join(" · "))}</td><td></td></tr>`).join("");
    const empty = Array.from({ length: Math.max(0, 8 - (data.checks || []).length) }, () => "<tr>" + "<td>&nbsp;</td>".repeat(12) + "</tr>").join("");
    const list = (xs, f) => (xs.length ? `<ul>${xs.map(f).join("")}</ul>` : "<p class='m'>—</p>");
    const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>فحوصات ${esc(l.name)} ${day}</title>
<style>body{font-family:system-ui,Tahoma,sans-serif;margin:18px;color:#111}h1{font-size:20px;margin:0}h2{font-size:15px;margin:16px 0 6px}.top{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #0456a2;padding-bottom:8px}
table{width:100%;border-collapse:collapse;font-size:12.5px}th,td{border:1px solid #999;padding:5px;text-align:center}th{background:#eef5fb}tr.bad td{background:#fde8e8}ul{margin:0;padding-inline-start:18px;font-size:13px}.m{color:#777;margin:0}
.sig{display:flex;gap:40px;margin-top:28px;font-size:13px}.sig div{flex:1;border-top:1px solid #333;padding-top:6px}@media print{button{display:none}}</style></head><body>
<div class="top"><div><h1>ورقة الفحوصات اليومية — ${esc(l.name)}</h1><div class="m">${esc(brand)}${l.site_name ? " · " + esc(l.site_name) : ""}</div></div><b>${esc(date(day))} · ${day}</b></div>
<h2>فحوصات الجودة</h2><table><thead><tr><th>#</th><th>الساعة</th><th>أوزون</th><th>TDS</th><th>pH</th><th>سوفتنر قبل</th><th>سوفتنر بعد</th><th>كلور قبل الكربون</th><th>كلور بعد الكربون</th><th>الموظف</th><th>ملاحظات</th><th>توقيع</th></tr></thead><tbody>${rows}${empty}</tbody></table>
<h2>غيار الفلاتر</h2>${list(data.filter_changes, (c) => `<li>${esc(time(c.changed_at))} — ${esc(c.filter_name)}${c.qty ? ` (${c.qty})` : ""} — ${esc(c.by_name || "")}</li>`)}
<h2>المواد المسحوبة للخط</h2>${list(data.used, (x) => `<li>${esc(time(x.created_at))} — ${x.qty} ${esc(x.unit)} ${esc(x.name)} — ${esc(x.by_name || "")}</li>`)}
<h2>التالف</h2>${list(data.waste, (x) => `<li>${esc(time(x.created_at))} — ${x.qty} ${esc(x.unit)} ${esc(x.name)}${x.machine_name ? " · " + esc(x.machine_name) : ""}${x.run_hours ? ` · ${Number(x.run_hours)} ساعة` : ""} — ${esc(x.by_name || "")}${x.note ? " · " + esc(x.note) : ""}</li>`)}
<div class="sig"><div>مسؤول الخط</div><div>مسؤول الجودة</div><div>الإدارة</div></div>
<button onclick="print()" style="margin-top:20px;padding:10px 18px;font-size:15px">🖨️ اطبع / احفظ PDF</button></body></html>`;
    const w = window.open("", "_blank");
    if (!w) return fx.toast("اسمح بفتح النوافذ عشان تطبع");
    w.document.write(html);
    w.document.close();
    setTimeout(() => { try { w.print(); } catch { /* المستخدم بيطبع من الزر */ } }, 400);
  }
  return (
    <Sheet title="ورقة الفحوصات" onClose={onClose}>
      <div className="fx-stack">
        <div className="fx-field">أي يوم؟<DateInput value={day} onChange={setDay} ariaLabel="اليوم" /></div>
        <Err msg={error} />
        {!data && !error && <Loading />}
        {data && (
          <>
            <div className="fx-card">
              <div className="fx-kv"><span>فحوصات</span><b>{data.checks.length}{data.checks.some((q) => q.issues.length) ? ` (${data.checks.filter((q) => q.issues.length).length} فيها مشكلة)` : ""}</b></div>
              <div className="fx-kv"><span>غيار فلاتر</span><b>{data.filter_changes.length}</b></div>
              <div className="fx-kv"><span>مواد انسحبت</span><b>{data.used.length}</b></div>
              <div className="fx-kv"><span>تالف</span><b>{data.waste.length}{data.waste.length ? ` · ${money(data.waste.reduce((a, x) => a + x.cost, 0))} د.أ` : ""}</b></div>
            </div>
            <button className="fx-btn pri block fx-huge" onClick={print}><FiPrinter /> اطبع / احفظ PDF</button>
            <small className="fx-muted">الفحوصات بتضل محفوظة لكل يوم — بتقدر ترجع لأي تاريخ وتطبعه.</small>
          </>
        )}
      </div>
    </Sheet>
  );
}

function SettingsSheet({ l, colors, onClose, onDone }) {
  const fx = useFx();
  const L = l.limits || {};
  const [every, setEvery] = useState(l.check_every_min);
  const [lim, setLim] = useState({ ...L });
  const [hours, setHours] = useState(() => Object.fromEntries(l.members.map((m) => [m.id, { start_time: m.hours?.start_time || "07:00", end_time: m.hours?.end_time || "15:00", days: m.hours?.days || "0123456" }])));
  const [err, setErr] = useState("");
  const DAYS = ["أحد", "اثنين", "ثلاثاء", "أربعاء", "خميس", "جمعة", "سبت"];
  const limIn = (k, label) => <label className="fx-field">{label}<input className="fx-input fx-num" type="number" inputMode="decimal" step="any" value={lim[k] ?? ""} onChange={(e) => setLim({ ...lim, [k]: e.target.value })} /></label>;
  return (
    <Sheet title={`إعدادات ${l.name}`} onClose={onClose}>
      <div className="fx-stack">
        <div className="fx-field">التذكير بالفحص كل…
          <div className="fx-chips">{EVERY.map((m) => <button key={m} type="button" className={`fx-chip ${Number(every) === m ? "on" : ""}`} onClick={() => setEvery(m)}>{m >= 60 ? `${m / 60} ساعة` : `${m} دقيقة`}</button>)}</div>
        </div>
        <b>الحدود المسموحة (اللي برّاها بيوصل تنبيه)</b>
        <div className="fx-grid2">{limIn("tds_min", "TDS من")}{limIn("tds_max", "TDS لـ")}{limIn("ph_min", "pH من")}{limIn("ph_max", "pH لـ")}{limIn("ozone_min", "أوزون من")}{limIn("ozone_max", "أوزون لـ")}</div>
        <ColorPick label="السوفتنر بعد الجهاز — اللون الغلط" options={colors.soft} value={lim.soft_bad || "أحمر"} onChange={(v) => setLim({ ...lim, soft_bad: v || "أحمر" })} />
        <ColorPick label="الكلور بعد الكربون — اللون الغلط" options={colors.cl} value={lim.cl_bad || "أصفر"} onChange={(v) => setLim({ ...lim, cl_bad: v || "أصفر" })} />
        <b>دوام موظفين الخط (التذكير بيوصل بس وهو بدوامه)</b>
        {l.members.length === 0 && <div className="fx-muted">ما في موظفين على الخط — ضيفهم من «المصانع والخطوط».</div>}
        {l.members.map((m) => {
          const h = hours[m.id];
          const set = (k, v) => setHours({ ...hours, [m.id]: { ...h, [k]: v } });
          return (
            <div key={m.id} className="fx-card" style={{ padding: 10 }}>
              <b>{m.full_name}</b>
              <div className="fx-grid2" style={{ marginTop: 6 }}>
                <label className="fx-field">من<input className="fx-input fx-num" dir="ltr" value={h.start_time} onChange={(e) => set("start_time", e.target.value)} placeholder="07:00" /></label>
                <label className="fx-field">لـ<input className="fx-input fx-num" dir="ltr" value={h.end_time} onChange={(e) => set("end_time", e.target.value)} placeholder="15:00" /></label>
              </div>
              <div className="fx-chips" style={{ marginTop: 6 }}>{DAYS.map((d, i) => <button key={i} type="button" className={`fx-chip ${h.days.includes(String(i)) ? "on" : ""}`} onClick={() => set("days", h.days.includes(String(i)) ? h.days.replace(String(i), "") : (h.days + i).split("").sort().join(""))}>{d}</button>)}</div>
            </div>
          );
        })}
        <Err msg={err} />
        <Act className="fx-btn pri block" onClick={async () => {
          setErr("");
          try {
            await fapi.lineSettings(l.id, { check_every_min: every, limits: lim });
            for (const [uid, h] of Object.entries(hours)) await fapi.workHours(uid, h);
            fx.toast("انحفظ"); onDone();
          } catch (e) { setErr(e.message); }
        }}>حفظ</Act>
      </div>
    </Sheet>
  );
}
