import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { FiSearch, FiPlus, FiDownload, FiUpload, FiClipboard, FiChevronLeft, FiEdit2, FiX } from "react-icons/fi";
import { fapi } from "../fapi.js";
import { useFx, useLoad, Sheet, Err, Loading, Empty, Act, PhotoInput, Reload, DateInput, waLink, money, num, date, dateTime, today } from "../ui.jsx";
import { smartFilter } from "../smartSearch.js";

// ============================================================
// مستودع المواد وقطع الغيار
// المحاسب/الإدارة: أصناف جديدة بسعرها + «دخل بضاعة» + جرد
// الإنتاج: «سحب» مواد أولية لخطه (كاسات، مطرات…)
// فني الصيانة: «سحب» قطع غيار لماكنة — والبحث بالرقم: «1X» = «١ x»
// ============================================================

export const normCode = (s) => String(s || "").replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d)).replace(/[\s\-_/.#]/g, "").toLowerCase();

// بحث ذكي: الرقم بالضبط أول، بعدين الرقم بيبدأ فيه، بعدين الاسم (بيتحمّل الأخطاء)
export function searchItems(items, q) {
  const n = normCode(q);
  if (!n) return items;
  const exact = items.filter((m) => m.code && normCode(m.code) === n);
  const starts = items.filter((m) => m.code && normCode(m.code) !== n && normCode(m.code).startsWith(n));
  const seen = new Set([...exact, ...starts].map((m) => m.id));
  const rest = smartFilter(items.filter((m) => !seen.has(m.id)), q, ["name", "code", "category", "specs", "supplier", "machine_name", "shelf"]);
  return [...exact, ...starts, ...rest];
}

const fmtQty = (n) => (Number.isInteger(Number(n)) ? num(n) : Number(n).toLocaleString("en-US", { maximumFractionDigits: 3 }));

// نوع الخط من اسمه — عشان الأيقونة واقتراحات أقسام قطع الغيار
export const lineType = (name) => (/قنا|قنين|مطر|bottle/i.test(name || "") ? "bottles" : /كاس|cup/i.test(name || "") ? "cups" : null);
const LINE_ICON = { bottles: "🍶", cups: "🥤" };
// أقسام قطع الغيار حسب مكانها بالخط
export const PART_GROUPS = {
  bottles: ["ماكنة النفخ", "ماكنة التعبئة", "ماكنة التسكير", "ماكنة الليبل", "ماكنة الشرنك", "طابعة التاريخ", "السيور والناقل", "كهرباء وحساسات", "هوا ومكابس"],
  cups: ["ماكنة التشكيل", "القوالب", "ماكنة التعبئة", "ماكنة التسكير (القصدير)", "القص والتقطيع", "طابعة التاريخ", "السيور والناقل", "كهرباء وحساسات", "هوا ومكابس"],
  any: ["ميكانيك", "كهرباء", "هوا ومكابس", "سيور", "بيرنغات", "حساسات"],
};

export default function Store() {
  const fx = useFx();
  const { data, error, reload } = useLoad(() => fapi.store(), []);
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState("");
  const [site, setSite] = useState(null);
  const [lineF, setLineF] = useState(undefined);
  const [sheet, setSheet] = useState(null);
  const C = data?.can || {};
  const views = [["items", "المستودع"], ["moves", "الحركة"], C.setup ? ["setup", "المصانع والخطوط"] : null].filter(Boolean);
  const view = views.find((t) => t[0] === params.get("view"))?.[0] || (["moves", "setup"].includes(params.get("tab")) ? params.get("tab") : "items");
  const onlyParts = !fx.can("f_store") && !fx.can("f_production") && fx.can("f_machines");
  const kind = params.get("tab") === "part" || (onlyParts && params.get("tab") !== "material") ? "part" : "material";
  const pLines = (data?.lines || []).filter((l) => l.active);
  const machineLine = new Map((data?.machines || []).map((m) => [m.id, m.line_id]));
  // الخط المختار: موظف الخط بيفتح على خطه، وغيره على أول خط
  const line = lineF !== undefined ? lineF : data?.my_lines?.length ? data.my_lines[0] : pLines[0]?.id ?? "all";
  const curLine = pLines.find((l) => l.id === line);
  const lt = lineType(curLine?.name);
  const inLine = (m) => line === "all" || (line === 0 ? !m.line_id && !machineLine.get(m.machine_id) : m.line_id === line || (!m.line_id && machineLine.get(m.machine_id) === line));
  const list = useMemo(() => {
    const xs = (data?.items || []).filter((m) => m.active && m.kind === kind && (!site || !m.site_id || m.site_id === site) && inLine(m));
    return q.trim() ? searchItems(xs, q) : xs;
  }, [data, kind, q, site, line]); // eslint-disable-line react-hooks/exhaustive-deps
  // مجمّعة حسب القسم (المادة/مكان القطعة بالماكنة)
  const groups = useMemo(() => {
    if (q.trim()) return [["", list]];
    const m = new Map();
    for (const x of list) { const k = x.category || (kind === "part" ? x.machine_name || "" : ""); if (!m.has(k)) m.set(k, []); m.get(k).push(x); }
    return [...m.entries()].sort((a, b) => (a[0] === "" ? 1 : b[0] === "" ? -1 : a[0].localeCompare(b[0], "ar")));
  }, [list, q, kind]);
  const done = () => { setSheet(null); reload(); };
  const sites = data?.sites?.filter((s) => s.active) || [];
  const canTake = kind === "part" ? C.take_part : C.take_material;
  const value = list.reduce((a, m) => a + m.value, 0);
  const countOf = (lid, k) => (data?.items || []).filter((m) => m.active && m.kind === k && (lid === 0 ? !m.line_id && !machineLine.get(m.machine_id) : m.line_id === lid || (!m.line_id && machineLine.get(m.machine_id) === lid))).length;
  const setTab = (k) => setParams({ tab: k });

  return (
    <div className="fx-page">
      <div className="fx-row" style={{ justifyContent: "space-between" }}>
        <h1 className="fx-h1" style={{ margin: 0 }}>المواد وقطع الغيار</h1>
        <Reload onClick={reload} />
      </div>
      {views.length > 1 && <div className="fx-tabs">{views.map(([k, l]) => <button key={k} className={view === k ? "on" : ""} onClick={() => setParams(k === "items" ? { tab: kind } : { view: k })}>{l}</button>)}</div>}
      <Err msg={error} />
      {!data && !error && <Loading />}

      {data && view === "items" && (
        <>
          {/* ١) أي خط */}
          {pLines.length > 0 && (
            <div className="fx-grid2" style={{ gridTemplateColumns: `repeat(${Math.min(3, pLines.length + 1)}, 1fr)` }}>
              {pLines.map((l) => (
                <button key={l.id} className={`fx-tile ${line === l.id ? "on" : ""}`} onClick={() => { setLineF(l.id); setQ(""); }}>
                  <span style={{ fontSize: 24 }}>{LINE_ICON[lineType(l.name)] || "⚙️"}</span>
                  <span className="n">{l.name}</span>
                  <small>{countOf(l.id, "material")} مادة · {countOf(l.id, "part")} قطعة</small>
                </button>
              ))}
              <button className={`fx-tile ${line === 0 ? "on" : ""}`} onClick={() => { setLineF(0); setQ(""); }}>
                <span style={{ fontSize: 24 }}>🧰</span><span className="n">عام</span><small>لكل الخطوط</small>
              </button>
            </div>
          )}
          {C.store && pLines.length > 0 && <button className={`fx-link ${line === "all" ? "on" : ""}`} style={{ justifySelf: "start" }} onClick={() => setLineF(line === "all" ? pLines[0].id : "all")}>{line === "all" ? "← رجوع للخطوط" : "اعرض كل المستودع مع بعض"}</button>}
          {!pLines.length && C.setup && <div className="fx-note">ضيف خطوطك (خط القناني، خط الكاسات) من «المصانع والخطوط» عشان كل خط يكون إله مواده وقطعه لحال.</div>}

          {/* ٢) مواد ولا قطع */}
          <div className="fx-pay-modes">
            <button type="button" className={kind === "material" ? "on" : ""} onClick={() => setTab("material")}>📦 المواد الأولية</button>
            <button type="button" className={kind === "part" ? "on" : ""} onClick={() => setTab("part")}>🔩 قطع الغيار</button>
          </div>

          <label className="fx-search"><FiSearch aria-hidden="true" />
            <input className="fx-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={kind === "part" ? "رقم القطعة (مثلًا 1X) أو اسمها" : "اسم المادة"} />
            {q && <button className="fx-plain" onClick={() => setQ("")} aria-label="امسح"><FiX /></button>}
          </label>
          {sites.length > 1 && (
            <div className="fx-chips">
              <button className={`fx-chip ${!site ? "on" : ""}`} onClick={() => setSite(null)}>كل المصانع</button>
              {sites.map((x) => <button key={x.id} className={`fx-chip ${site === x.id ? "on" : ""}`} onClick={() => setSite(x.id)}>{x.name}</button>)}
            </div>
          )}
          <div className="fx-actions3">
            {canTake && <button className="fx-bigbtn pri" onClick={() => setSheet({ kind: "take" })}><FiUpload /><span>سحب</span></button>}
            {C.store && <button className="fx-bigbtn" onClick={() => setSheet({ kind: "receive" })}><FiDownload /><span>دخل بضاعة</span></button>}
            {C.store && <button className="fx-bigbtn" onClick={() => setSheet({ kind: "count" })}><FiClipboard /><span>جرد</span></button>}
          </div>
          <div className="fx-row" style={{ justifyContent: "space-between" }}>
            <span className="fx-muted" style={{ fontSize: 13 }}>{num(list.length)} {kind === "part" ? "قطعة" : "مادة"} · قيمتها {money(value)} د.أ{list.some((m) => m.low) ? ` · ${list.filter((m) => m.low).length} قرّبت تخلص` : ""}</span>
            {C.store && <button className="fx-btn sm" onClick={() => setSheet({ kind: "edit", m: { kind, site_id: site, line_id: typeof line === "number" && line ? line : null, _lt: lt } })}><FiPlus /> {kind === "part" ? "قطعة جديدة" : "مادة جديدة"}</button>}
          </div>
          {C.store && kind === "material" && !q && lt && list.length < 3 && <button className="fx-btn sky block" onClick={() => setSheet({ kind: "starter", line })}>✨ ضيف مواد {curLine.name} الأساسية</button>}
          {list.length === 0 && <Empty title={q ? "ما لقيت إشي" : kind === "part" ? `ما في قطع غيار${curLine ? ` لـ${curLine.name}` : ""}` : `ما في مواد${curLine ? ` لـ${curLine.name}` : ""}`} text={q ? "جرّب الرقم أو جزء من الاسم." : C.store ? (kind === "part" ? "اكبس «قطعة جديدة» وضيفها برقمها وصورتها وسعرها." : "اكبس «مادة جديدة» أو «ضيف المواد الأساسية».") : "المحاسب بيضيف الأصناف."} />}
          {groups.map(([g, xs]) => (
            <div key={g || "_"} className="fx-stack" style={{ gap: 6 }}>
              {groups.length > 1 && <div className="fx-sec" style={{ margin: "6px 0 0" }}><h2 style={{ fontSize: 14 }}>{g || "بدون قسم"} <small className="fx-muted">({xs.length})</small></h2></div>}
              <div className="fx-list">
                {xs.map((m) => (
                  <button key={m.id} className="fx-item" onClick={() => setSheet({ kind: "item", id: m.id })}>
                    {m.photo_url ? <img src={m.photo_url} alt="" style={{ width: 44, height: 44, borderRadius: 10, objectFit: "cover" }} /> : <span className="fx-avatar">{kind === "part" ? "🔩" : "📦"}</span>}
                    <span className="t">
                      <b>{m.code ? <small className="fx-seq">{m.code}</small> : null}{m.name}</b>
                      <span>{[line === "all" && m.line_name, kind === "part" && m.machine_name !== g && m.machine_name, sites.length > 1 && m.site_name, m.shelf && `رف ${m.shelf}`, `${money(m.price)} د.أ`].filter(Boolean).join(" · ")}</span>
                    </span>
                    <span className="end" style={{ textAlign: "end" }}>
                      <b className="fx-num" style={{ color: m.low ? "var(--fx-crit)" : m.balance <= 0 ? "var(--fx-muted)" : "var(--fx-navy)" }}>{fmtQty(m.balance)}</b>
                      <span className="fx-muted" style={{ fontSize: 11.5, display: "block" }}>{m.unit}{m.low ? " · قرّب يخلص" : ""}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </>
      )}

      {data && view === "moves" && <Moves data={data} />}
      {data && view === "setup" && <Setup data={data} reload={reload} />}

      {sheet?.kind === "item" && <ItemSheet id={sheet.id} data={data} onClose={() => setSheet(null)} onEdit={(m) => setSheet({ kind: "edit", m })} onAct={(k, m) => setSheet({ kind: k, pre: m })} />}
      {sheet?.kind === "edit" && <ItemEdit m={sheet.m} data={data} onClose={() => setSheet(null)} onDone={done} />}
      {sheet?.kind === "take" && <TakeSheet data={data} kind={sheet.pre?.kind || kind} pre={sheet.pre} line0={typeof line === "number" && line ? line : null} onClose={() => setSheet(null)} onDone={done} />}
      {sheet?.kind === "receive" && <ReceiveSheet data={data} kind={sheet.pre?.kind || kind} pre={sheet.pre} onClose={() => setSheet(null)} onDone={done} />}
      {sheet?.kind === "count" && <CountSheet items={list} onClose={() => setSheet(null)} onDone={done} />}
      {sheet?.kind === "starter" && <StarterSheet data={data} line0={sheet.line} onClose={() => setSheet(null)} onDone={() => { setSheet(null); reload(); }} />}
      {sheet?.kind === "adjust" && <AdjustSheet m={sheet.pre} onClose={() => setSheet(null)} onDone={done} />}
    </div>
  );
}

// ---------- صنف واحد: كل تفاصيله وحركته ----------
function ItemSheet({ id, data, onClose, onEdit, onAct }) {
  const m = data.items.find((x) => x.id === id);
  const { data: moves } = useLoad(() => fapi.storeItemMoves(id), [id]);
  if (!m) return null;
  const C = data.can;
  const canTake = m.kind === "part" ? C.take_part : C.take_material;
  const K = { receive: ["📥", "دخل"], use: ["📤", "سحب"], adjust: ["✎", "تعديل"], count: ["📋", "جرد"] };
  return (
    <Sheet title={m.name} onClose={onClose}>
      <div className="fx-stack">
        {m.photo_url && <img src={m.photo_url} alt={m.name} style={{ width: "100%", maxHeight: 220, objectFit: "contain", borderRadius: 14, background: "#f4f8fb" }} />}
        <div className="fx-grid2">
          <div className="fx-card" style={{ textAlign: "center" }}><small className="fx-muted">الموجود</small><b className="fx-num" style={{ display: "block", fontSize: 26, color: m.low ? "var(--fx-crit)" : "var(--fx-navy)" }}>{fmtQty(m.balance)}</b><small>{m.unit}</small></div>
          <div className="fx-card" style={{ textAlign: "center" }}><small className="fx-muted">السعر</small><b className="fx-num" style={{ display: "block", fontSize: 22 }}>{money(m.price)}</b><small>د.أ لل{m.unit} · القيمة {money(m.value)}</small></div>
        </div>
        <div className="fx-card">
          {[
            ["الرقم", m.code], ["النوع", m.kind === "part" ? "قطعة غيار" : "مادة أولية"], ["التصنيف", m.category], ["المصنع", m.site_name], ["الماكنة", m.machine_name],
            ["مكانه", m.shelf && `رف ${m.shelf}`], ["المورد", m.supplier], ["حد الطلب", m.min_level ? `${fmtQty(m.min_level)} ${m.unit}` : null],
          ].filter(([, v]) => v).map(([k, v]) => <div key={k} className="fx-kv"><span>{k}</span><b>{v}</b></div>)}
          {m.specs && <p style={{ margin: "8px 0 0", whiteSpace: "pre-wrap", fontSize: 14 }}>{m.specs}</p>}
        </div>
        <div className="fx-grid2">
          {canTake && <button className="fx-btn pri" onClick={() => onAct("take", m)}><FiUpload /> سحب</button>}
          {C.store && <button className="fx-btn" onClick={() => onAct("receive", m)}><FiDownload /> دخل</button>}
          {C.store && <button className="fx-btn" onClick={() => onEdit(m)}><FiEdit2 /> عدّل التفاصيل</button>}
          {C.store && <button className="fx-btn" onClick={() => onAct("adjust", m)}>تعديل الكمية</button>}
        </div>
        <b>الحركة</b>
        {!moves && <Loading />}
        {moves?.length === 0 && <div className="fx-muted">ما في حركة لسا.</div>}
        <div className="fx-list">
          {moves?.map((x) => (
            <div key={x.id} className="fx-item">
              <span className="fx-avatar" style={{ fontSize: 17 }}>{K[x.kind]?.[0]}</span>
              <span className="t">
                <b>{K[x.kind]?.[1]} {fmtQty(Math.abs(x.qty))} {m.unit}{x.line_name ? ` · ${x.line_name}` : ""}{x.machine_name && m.kind === "part" ? ` · ${x.machine_name}` : ""}</b>
                <span>{dateTime(x.created_at)} · {x.taken_by_name || x.by_name || ""}{x.supplier ? ` · ${x.supplier}` : ""}{x.invoice_no ? ` · فاتورة ${x.invoice_no}` : ""}{x.note ? ` · ${x.note}` : ""}</span>
              </span>
              {x.cost != null && <span className="end fx-num" style={{ fontSize: 13 }}>{money(Math.abs(x.cost))}</span>}
            </div>
          ))}
        </div>
      </div>
    </Sheet>
  );
}

// ---------- صنف جديد / تعديل ----------
function ItemEdit({ m, data, onClose, onDone }) {
  const fx = useFx();
  const isNew = !m.id;
  const [f, setF] = useState(() => ({
    kind: m.kind || "material", name: m.name || "", code: m.code || "", category: m.category || "", unit: m.unit || (m.kind === "part" ? "حبة" : "كغم"),
    price: m.price ?? "", min_level: m.min_level || "", supplier: m.supplier || "", specs: m.specs || "", photo_url: m.photo_url || "",
    site_id: m.site_id || (data.sites.length === 1 ? data.sites[0].id : null), machine_id: m.machine_id || null, shelf: m.shelf || "", opening: "", active: m.active !== false,
    line_id: m.line_id || null,
  }));
  const set = (k) => (e) => setF({ ...f, [k]: e?.target ? e.target.value : e });
  const [err, setErr] = useState("");
  const lt2 = lineType(data.lines.find((l) => l.id === f.line_id)?.name);
  const cats = [...new Set([...data.items.filter((x) => x.kind === f.kind && x.category && (!f.line_id || x.line_id === f.line_id)).map((x) => x.category), ...(f.kind === "part" ? PART_GROUPS[lt2 || "any"] : [])])];
  const machines = data.machines.filter((x) => x.active && (!f.site_id || !x.site_id || x.site_id === f.site_id) && (!f.line_id || !x.line_id || x.line_id === f.line_id));
  return (
    <Sheet title={isNew ? "صنف جديد" : `تعديل ${m.name}`} onClose={onClose}>
      <div className="fx-stack">
        <div className="fx-pay-modes">
          <button type="button" className={f.kind === "material" ? "on" : ""} onClick={() => setF({ ...f, kind: "material" })}>📦 مادة أولية</button>
          <button type="button" className={f.kind === "part" ? "on" : ""} onClick={() => setF({ ...f, kind: "part", unit: f.unit === "كغم" ? "حبة" : f.unit })}>🔩 قطعة غيار</button>
        </div>
        <label className="fx-field">الاسم<input className="fx-input" value={f.name} onChange={set("name")} placeholder={f.kind === "part" ? "مثلًا: سير ماكنة الكاسات" : "مثلًا: رول بلاستيك PP"} autoFocus={isNew} /></label>
        <div className="fx-grid2">
          <label className="fx-field">الرقم/الحرف<input className="fx-input" dir="ltr" value={f.code} onChange={set("code")} placeholder="مثلًا 1X" /></label>
          <label className="fx-field">{f.kind === "part" ? "القسم (وين بالماكنة)" : "التصنيف"}<input className="fx-input" list="store-cats" value={f.category} onChange={set("category")} placeholder={f.kind === "part" ? "مثلًا: ماكنة الليبل" : "مثلًا: تغليف"} /></label>
          <datalist id="store-cats">{cats.map((c) => <option key={c} value={c} />)}</datalist>
        </div>
        {f.kind === "part" && cats.length > 0 && !f.category && <div className="fx-chips">{cats.slice(0, 10).map((c) => <button key={c} type="button" className="fx-chip" onClick={() => setF({ ...f, category: c })}>{c}</button>)}</div>}
        <div className="fx-field">الوحدة<div className="fx-chips">{data.units.map((u) => <button key={u} type="button" className={`fx-chip ${f.unit === u ? "on" : ""}`} onClick={() => setF({ ...f, unit: u })}>{u}</button>)}</div></div>
        <div className="fx-grid2">
          <label className="fx-field">السعر لل{f.unit} (د.أ)<input className="fx-input fx-num" type="number" inputMode="decimal" value={f.price} onChange={set("price")} /></label>
          <label className="fx-field">نبّهني لما يوصل<input className="fx-input fx-num" type="number" inputMode="decimal" value={f.min_level} onChange={set("min_level")} placeholder="0 = بدون" /></label>
        </div>
        {isNew && <label className="fx-field">الموجود هلأ بالمستودع ({f.unit})<input className="fx-input fx-num" type="number" inputMode="decimal" value={f.opening} onChange={set("opening")} placeholder="0" /></label>}
        {data.sites.length > 0 && (
          <div className="fx-field">بأي مصنع؟<div className="fx-chips">
            <button type="button" className={`fx-chip ${!f.site_id ? "on" : ""}`} onClick={() => setF({ ...f, site_id: null })}>عام</button>
            {data.sites.filter((s) => s.active).map((s) => <button key={s.id} type="button" className={`fx-chip ${f.site_id === s.id ? "on" : ""}`} onClick={() => setF({ ...f, site_id: s.id })}>{s.name}</button>)}
          </div></div>
        )}
        {data.lines.some((l) => l.active) && (
          <div className="fx-field">{f.kind === "part" ? "قطعة لأي خط؟" : "مستودع أي خط؟"}<div className="fx-chips">
            <button type="button" className={`fx-chip ${!f.line_id ? "on" : ""}`} onClick={() => setF({ ...f, line_id: null })}>عامة (لكل الخطوط)</button>
            {data.lines.filter((l) => l.active).map((l) => <button key={l.id} type="button" className={`fx-chip ${f.line_id === l.id ? "on" : ""}`} onClick={() => setF({ ...f, line_id: l.id })}>{l.name}</button>)}
          </div></div>
        )}
        {f.kind === "part" && machines.length > 0 && (
          <div className="fx-field">لأي ماكنة؟ (اختياري)<div className="fx-chips">
            <button type="button" className={`fx-chip ${!f.machine_id ? "on" : ""}`} onClick={() => setF({ ...f, machine_id: null })}>أكثر من وحدة</button>
            {machines.map((x) => <button key={x.id} type="button" className={`fx-chip ${f.machine_id === x.id ? "on" : ""}`} onClick={() => setF({ ...f, machine_id: x.id })}>{x.name}</button>)}
          </div></div>
        )}
        <div className="fx-grid2">
          <label className="fx-field">المورد<input className="fx-input" value={f.supplier} onChange={set("supplier")} /></label>
          <label className="fx-field">مكانه (رف)<input className="fx-input" value={f.shelf} onChange={set("shelf")} placeholder="مثلًا A3" /></label>
        </div>
        <label className="fx-field">المواصفات والتفاصيل<textarea value={f.specs} onChange={set("specs")} placeholder={f.kind === "part" ? "المقاس، الماركة، رقم المصنّع…" : "النوع، السماكة، اللون…"} /></label>
        <PhotoInput label="صورة الصنف" value={f.photo_url} onChange={(u) => setF({ ...f, photo_url: u })} />
        {!isNew && (
          <label className="fx-row" style={{ gap: 8 }}><input type="checkbox" checked={!f.active} onChange={(e) => setF({ ...f, active: !e.target.checked })} /> وقّف هالصنف (ما عاد نستعمله)</label>
        )}
        <Err msg={err} />
        <Act className="fx-btn pri block fx-huge" disabled={!f.name.trim()} onClick={async () => {
          setErr("");
          try {
            if (isNew) await fapi.storeAdd(f); else await fapi.storeEdit(m.id, f);
            fx.toast("انحفظ ✓");
            onDone();
          } catch (e) { setErr(e.message); }
        }}>✓ حفظ</Act>
      </div>
    </Sheet>
  );
}

// اختيار أصناف بكمياتها (مع بحث بالرقم)
function PickLines({ items, lines, setLines, withCost = false }) {
  const [q, setQ] = useState("");
  const found = q.trim() ? searchItems(items, q).slice(0, 8) : [];
  const add = (m) => { if (!lines.find((l) => l.id === m.id)) setLines([...lines, { id: m.id, qty: "", cost: withCost ? String(m.price || "") : "" }]); setQ(""); };
  return (
    <div className="fx-stack" style={{ gap: 8 }}>
      <label className="fx-search"><FiSearch aria-hidden="true" /><input className="fx-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="دوّر بالرقم أو الاسم وضيف" /></label>
      {found.length > 0 && (
        <div className="fx-list">
          {found.map((m) => (
            <button key={m.id} className="fx-item" onClick={() => add(m)}>
              <span className="t"><b>{m.code ? <small className="fx-seq">{m.code}</small> : null}{m.name}</b><span>موجود {fmtQty(m.balance)} {m.unit}</span></span>
              <FiPlus />
            </button>
          ))}
        </div>
      )}
      {!q && lines.length === 0 && items.length <= 12 && (
        <div className="fx-chips">{items.map((m) => <button key={m.id} type="button" className="fx-chip" onClick={() => add(m)}>{m.code ? `${m.code} · ` : ""}{m.name}</button>)}</div>
      )}
      {lines.map((l, i) => {
        const m = items.find((x) => x.id === l.id);
        if (!m) return null;
        const upd = (k, v) => setLines(lines.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
        return (
          <div key={l.id} className="fx-card" style={{ padding: 10 }}>
            <div className="fx-row" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
              <b style={{ fontSize: 14 }}>{m.code ? `${m.code} · ` : ""}{m.name}</b>
              <button className="fx-plain" onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label="شيل"><FiX /></button>
            </div>
            <div className={withCost ? "fx-grid2" : ""} style={{ marginTop: 6 }}>
              <label className="fx-field">الكمية ({m.unit}){!withCost && <small className="fx-muted"> — موجود {fmtQty(m.balance)}</small>}
                <input className="fx-input fx-num" type="number" inputMode="decimal" autoFocus value={l.qty} onChange={(e) => upd("qty", e.target.value)} />
              </label>
              {withCost && <label className="fx-field">سعر ال{m.unit}<input className="fx-input fx-num" type="number" inputMode="decimal" value={l.cost} onChange={(e) => upd("cost", e.target.value)} /></label>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------- سحب: الإنتاج لخطه، أو الفني لماكنة ----------
export function TakeSheet({ data, kind = "material", pre, machineId = null, downtimeId = null, line0 = null, onClose, onDone }) {
  const fx = useFx();
  const allItems = data.items.filter((m) => m.active && m.kind === kind && m.balance > 0);
  const myLines = data.lines.filter((l) => l.active && (data.my_lines.includes(l.id) || data.can.store || !data.my_lines.length));
  const [lineId, setLineId] = useState(() => (line0 && myLines.some((l) => l.id === line0) ? line0 : myLines.length === 1 ? myLines[0].id : data.my_lines.length === 1 ? data.my_lines[0] : null));
  const [machine, setMachine] = useState(machineId || pre?.machine_id || null);
  const [lines, setLines] = useState(() => (pre ? [{ id: pre.id, qty: "" }] : []));
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const ok = lines.some((l) => Number(l.qty) > 0) && (kind === "part" || lineId || data.can.store);
  const items = lineId ? allItems.filter((m) => !m.line_id || m.line_id === lineId) : allItems;
  return (
    <Sheet title={kind === "part" ? "سحب قطع غيار" : "سحب مواد للإنتاج"} onClose={onClose}>
      <div className="fx-stack">
        {kind === "material" && myLines.length > 0 && (
          <div className="fx-field">لأي خط؟<div className="fx-chips">{myLines.map((l) => <button key={l.id} type="button" className={`fx-chip ${lineId === l.id ? "on" : ""}`} onClick={() => setLineId(l.id)}>{l.name}</button>)}</div></div>
        )}
        {kind === "material" && myLines.length === 0 && <div className="fx-note warn">ما في خطوط إنتاج — الإدارة بتضيفها من «المصانع والخطوط».</div>}
        {kind === "part" && !machineId && data.machines.filter((m) => m.active).length > 0 && (
          <div className="fx-field">لأي ماكنة؟<div className="fx-chips">{data.machines.filter((m) => m.active).map((m) => <button key={m.id} type="button" className={`fx-chip ${machine === m.id ? "on" : ""}`} onClick={() => setMachine(machine === m.id ? null : m.id)}>{m.name}</button>)}</div></div>
        )}
        {items.length === 0 ? <div className="fx-note">ما في إشي موجود بالمستودع لتسحبه.</div> : <PickLines items={items} lines={lines} setLines={setLines} />}
        <label className="fx-field">ملاحظة (اختياري)<input className="fx-input" value={note} onChange={(e) => setNote(e.target.value)} /></label>
        <Err msg={err} />
        <Act className="fx-btn pri block fx-huge" disabled={!ok} onClick={async () => {
          setErr("");
          try {
            const r = await fapi.storeTake({ line_id: lineId, machine_id: machine, downtime_id: downtimeId, note, items: lines.filter((l) => Number(l.qty) > 0).map((l) => ({ material_id: l.id, qty: Number(l.qty) })) });
            fx.toast(`انسحب ✓ ${r.items.map((x) => `ضل ${fmtQty(x.left)} ${x.name}`).join("، ")}`);
            onDone(r);
          } catch (e) { setErr(e.message); }
        }}>✓ سحبت</Act>
      </div>
    </Sheet>
  );
}

// ---------- دخل بضاعة (فاتورة مورد) ----------
function ReceiveSheet({ data, kind, pre, onClose, onDone }) {
  const fx = useFx();
  const items = data.items.filter((m) => m.active && (pre ? m.kind === pre.kind : m.kind === kind));
  const [lines, setLines] = useState(() => (pre ? [{ id: pre.id, qty: "", cost: String(pre.price || "") }] : []));
  const [supplier, setSupplier] = useState(pre?.supplier || "");
  const { data: ps } = useLoad(() => fapi.partners().catch(() => null), []);
  const [partner, setPartner] = useState(null);
  const [msg, setMsg] = useState(null);
  const [inv, setInv] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const total = lines.reduce((a, l) => a + (Number(l.qty) || 0) * (Number(l.cost) || 0), 0);
  if (msg) {
    return (
      <Sheet title="ابعت للشركة إنك استلمت" onClose={onDone}>
        <div className="fx-stack">
          <div className="fx-card" style={{ whiteSpace: "pre-wrap" }}>{msg.text}</div>
          <a className="fx-btn ok block fx-huge" href={waLink(msg.phone, msg.text)} target="_blank" rel="noreferrer" onClick={onDone}>ابعت على واتساب</a>
          <button className="fx-btn block" onClick={onDone}>بعدين</button>
        </div>
      </Sheet>
    );
  }
  return (
    <Sheet title="دخل بضاعة للمستودع" onClose={onClose}>
      <div className="fx-stack">
        {ps?.partners?.some((p) => p.active && p.kind !== "buyer") && (
          <div className="fx-field">من أي شركة؟ <small className="fx-muted">(الفاتورة بتنضاف على حسابها)</small><div className="fx-chips">
            <button type="button" className={`fx-chip ${!partner ? "on" : ""}`} onClick={() => setPartner(null)}>مش مسجّلة</button>
            {ps.partners.filter((p) => p.active && p.kind !== "buyer").map((p) => <button key={p.id} type="button" className={`fx-chip ${partner === p.id ? "on" : ""}`} onClick={() => { setPartner(p.id); setSupplier(p.name); }}>{p.name}</button>)}
          </div></div>
        )}
        <div className="fx-grid2">
          <label className="fx-field">المورد<input className="fx-input" value={supplier} onChange={(e) => setSupplier(e.target.value)} /></label>
          <label className="fx-field">رقم الفاتورة<input className="fx-input" value={inv} onChange={(e) => setInv(e.target.value)} /></label>
        </div>
        <PickLines items={items} lines={lines} setLines={setLines} withCost />
        <label className="fx-field">ملاحظة (اختياري)<input className="fx-input" value={note} onChange={(e) => setNote(e.target.value)} /></label>
        {total > 0 && <div className="fx-pay-sum"><span>مجموع الفاتورة <b>{money(total)}</b> د.أ</span></div>}
        <Err msg={err} />
        <Act className="fx-btn ok block fx-huge" disabled={!lines.some((l) => Number(l.qty) > 0)} onClick={async () => {
          setErr("");
          try {
            const r = await fapi.storeReceive({ partner_id: partner, supplier, invoice_no: inv, note, items: lines.filter((l) => Number(l.qty) > 0).map((l) => ({ material_id: l.id, qty: Number(l.qty), unit_cost: l.cost })) });
            fx.toast("انضافت للمستودع ✓");
            if (r.partner?.phone) {
              const b = r.partner.balance;
              setMsg({ phone: r.partner.phone, text: `السادة ${r.partner.name} المحترمين،\nاستلمنا البضاعة${inv ? ` (فاتورة رقم ${inv})` : ""} بقيمة ${money(r.total)} د.أ.\nالرصيد بعدها: ${b > 0.005 ? `إلكم عنّا ${money(b)} د.أ` : b < -0.005 ? `عليكم إلنا ${money(-b)} د.أ` : "الحساب مسكّر"}.\n— ${fx.shop?.brand?.name || ""}` });
            } else onDone();
          } catch (e) { setErr(e.message); }
        }}>✓ دخلت المستودع</Act>
      </div>
    </Sheet>
  );
}

function CountSheet({ items, onClose, onDone }) {
  const fx = useFx();
  const [vals, setVals] = useState({});
  const [q, setQ] = useState("");
  const shown = q.trim() ? searchItems(items, q) : items;
  return (
    <Sheet title="جرد فعلي" onClose={onClose}>
      <div className="fx-stack">
        <div className="fx-note">عدّ الموجود بإيدك واكتبه. اللي بتتركه فاضي ما بيتغيّر.</div>
        <label className="fx-search"><FiSearch aria-hidden="true" /><input className="fx-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="دوّر" /></label>
        {shown.map((m) => {
          const v = vals[m.id];
          const diff = v === undefined || v === "" ? 0 : Number(v) - m.balance;
          return (
            <label key={m.id} className="fx-row" style={{ flexWrap: "nowrap" }}>
              <span className="fx-grow">{m.code ? <small className="fx-seq">{m.code}</small> : null}{m.name} <span className="fx-muted">(المحسوب {fmtQty(m.balance)} {m.unit})</span>
                {diff !== 0 && <small style={{ display: "block", color: diff < 0 ? "var(--fx-crit)" : "var(--fx-ok)" }}>{diff > 0 ? "+" : ""}{fmtQty(diff)} · {money(diff * m.price)} د.أ</small>}
              </span>
              <input className="fx-input fx-num" style={{ width: 100 }} type="number" inputMode="decimal" value={v ?? ""} onChange={(e) => setVals({ ...vals, [m.id]: e.target.value })} />
            </label>
          );
        })}
        <Act className="fx-btn pri block" disabled={!Object.values(vals).some((v) => v !== "")} onClick={async () => {
          const r = await fapi.storeCount(Object.entries(vals).filter(([, v]) => v !== "").map(([id, v]) => ({ material_id: Number(id), counted: Number(v) })));
          fx.toast(r.changed ? `تعدّل ${r.changed} صنف · الفرق ${money(r.value)} د.أ` : "الجرد مطابق ✓");
          onDone();
        }}>✓ احفظ الجرد</Act>
      </div>
    </Sheet>
  );
}

function AdjustSheet({ m, onClose, onDone }) {
  const fx = useFx();
  const [sign, setSign] = useState(-1);
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  return (
    <Sheet title={`تعديل كمية ${m.name}`} onClose={onClose}>
      <div className="fx-stack">
        <div className="fx-pay-modes">
          <button type="button" className={sign < 0 ? "on" : ""} onClick={() => setSign(-1)}>− نقص (كسر، ضياع)</button>
          <button type="button" className={sign > 0 ? "on" : ""} onClick={() => setSign(1)}>+ زيادة</button>
        </div>
        <label className="fx-field">كم ({m.unit})<input className="fx-input fx-num" type="number" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} /></label>
        <label className="fx-field">السبب<input className="fx-input" value={note} onChange={(e) => setNote(e.target.value)} /></label>
        <Err msg={err} />
        <Act className="fx-btn pri block" disabled={!(Number(qty) > 0) || !note.trim()} onClick={async () => {
          setErr("");
          try { await fapi.storeAdjust(m.id, { qty: sign * Number(qty), note }); fx.toast("انحفظ"); onDone(); } catch (e) { setErr(e.message); }
        }}>حفظ</Act>
      </div>
    </Sheet>
  );
}

// ---------- الحركة: شو دخل وشو انسحب، ولأي خط وماكنة ----------
function Moves({ data }) {
  const [from, setFrom] = useState(() => today().slice(0, 8) + "01");
  const [to, setTo] = useState(today());
  const [kind, setKind] = useState("all");
  const { data: mv, error } = useLoad(() => fapi.storeMoves({ from, to }), [from, to]);
  const K = { receive: "📥 دخل", use: "📤 سحب", adjust: "✎ تعديل", count: "📋 جرد" };
  const rows = (mv?.moves || []).filter((x) => kind === "all" || x.kind === kind);
  return (
    <div className="fx-stack">
      <div className="fx-grid2">
        <div className="fx-field">من<DateInput value={from} onChange={setFrom} ariaLabel="من" /></div>
        <div className="fx-field">لـ<DateInput value={to} onChange={setTo} ariaLabel="لـ" /></div>
      </div>
      <Err msg={error} />
      {!mv && !error && <Loading />}
      {mv && (
        <>
          <div className="fx-grid2">
            <div className="fx-card" style={{ textAlign: "center" }}><small className="fx-muted">دخل المستودع</small><b className="fx-num" style={{ display: "block", fontSize: 22, color: "var(--fx-ok)" }}>{money(mv.received)}</b></div>
            <div className="fx-card" style={{ textAlign: "center" }}><small className="fx-muted">انسحب واستُهلك</small><b className="fx-num" style={{ display: "block", fontSize: 22, color: "var(--fx-navy)" }}>{money(mv.used)}</b></div>
          </div>
          {mv.by_line.length > 0 && (
            <div className="fx-card"><b>صرف كل خط</b>{mv.by_line.map((l) => <div key={l.id} className="fx-kv"><span>{l.name} ({l.n} سحبة)</span><b>{money(l.cost)}</b></div>)}</div>
          )}
          {mv.by_machine.length > 0 && (
            <div className="fx-card"><b>قطع غيار لكل ماكنة</b>{mv.by_machine.map((l) => <div key={l.id} className="fx-kv"><span>{l.name} ({l.n})</span><b>{money(l.cost)}</b></div>)}</div>
          )}
          <div className="fx-chips">{[["all", "الكل"], ["receive", "دخل"], ["use", "سحب"], ["count", "جرد"]].map(([k, l]) => <button key={k} className={`fx-chip ${kind === k ? "on" : ""}`} onClick={() => setKind(k)}>{l}</button>)}</div>
          {rows.length === 0 && <div className="fx-muted">ما في حركة بهالفترة.</div>}
          <div className="fx-list">
            {rows.map((x) => (
              <div key={x.id} className="fx-item">
                <span className="t">
                  <b>{K[x.kind]} {fmtQty(Math.abs(x.qty))} {x.unit} {x.code ? `${x.code} · ` : ""}{x.name}</b>
                  <span>{dateTime(x.created_at)} · {x.taken_by_name || x.by_name || ""}{x.line_name ? ` · ${x.line_name}` : ""}{x.machine_name && x.item_kind === "part" ? ` · ${x.machine_name}` : ""}{x.supplier ? ` · ${x.supplier}` : ""}{x.note ? ` · ${x.note}` : ""}</span>
                </span>
                <span className="end fx-num" style={{ fontSize: 13 }}>{money(Math.abs(x.cost))}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ---------- المصانع والخطوط وموظفينها ----------
function Setup({ data, reload }) {
  const fx = useFx();
  const [sheet, setSheet] = useState(null);
  const { data: staff } = useLoad(() => fapi.storeStaff(), []);
  return (
    <div className="fx-stack">
      <div className="fx-sec"><h2>المصانع</h2><button className="fx-btn sm" onClick={() => setSheet({ kind: "site", s: {} })}><FiPlus /> مصنع</button></div>
      {data.sites.length === 0 && <div className="fx-note">إذا عندك أكثر من مصنع (١، ٢، ٣) ضيفهم هون — كل قطعة غيار وماكنة بتنربط بمصنعها.</div>}
      <div className="fx-list">
        {data.sites.map((s) => (
          <button key={s.id} className="fx-item" onClick={() => setSheet({ kind: "site", s })}>
            <span className="fx-avatar">🏭</span>
            <span className="t"><b>{s.name}</b><span>{data.machines.filter((m) => m.site_id === s.id).length} ماكنة · {data.items.filter((m) => m.site_id === s.id && m.kind === "part" && m.active).length} قطعة غيار{!s.active ? " · موقّف" : ""}</span></span>
            <FiChevronLeft />
          </button>
        ))}
      </div>

      <div className="fx-sec"><h2>خطوط الإنتاج</h2><button className="fx-btn sm" onClick={() => setSheet({ kind: "line", l: {} })}><FiPlus /> خط</button></div>
      {data.lines.length === 0 && <div className="fx-note">مثلًا «خط الكاسات» و«خط المطرات» — وكل خط بتحدد موظفينه (الموظف بيقدر يكون على خطين).</div>}
      <div className="fx-list">
        {data.lines.map((l) => (
          <button key={l.id} className="fx-item" onClick={() => setSheet({ kind: "line", l })}>
            <span className="fx-avatar">⚙️</span>
            <span className="t"><b>{l.name}{l.site_name ? ` · ${l.site_name}` : ""}</b><span>{l.users.length ? l.users.map((u) => u.full_name).join("، ") : "ما في موظفين"}{l.month_cost ? ` · سحب هالشهر ${money(l.month_cost)}` : ""}{!l.active ? " · موقّف" : ""}</span></span>
            <FiChevronLeft />
          </button>
        ))}
      </div>

      {data.machines.length > 0 && (data.sites.length > 0 || data.lines.length > 0) && (
        <>
          <div className="fx-sec"><h2>المكنات</h2></div>
          <div className="fx-list">
            {data.machines.filter((m) => m.active).map((m) => (
              <button key={m.id} className="fx-item" onClick={() => setSheet({ kind: "machine", m })}>
                <span className="fx-avatar">🛠️</span>
                <span className="t"><b>{m.name}</b><span>{[data.sites.find((s) => s.id === m.site_id)?.name, data.lines.find((l) => l.id === m.line_id)?.name].filter(Boolean).join(" · ") || "مش مربوطة بمصنع"}</span></span>
                <FiChevronLeft />
              </button>
            ))}
          </div>
        </>
      )}
      <p className="fx-muted" style={{ fontSize: 12.5 }}>المكنات نفسها بتنضاف من الإعدادات.</p>

      {sheet?.kind === "site" && <NameSheet title={sheet.s.id ? "تعديل المصنع" : "مصنع جديد"} value={sheet.s.name} active={sheet.s.active !== false} canStop={!!sheet.s.id} placeholder="مثلًا: مصنع ٢"
        onClose={() => setSheet(null)} onSave={async (name, active) => { sheet.s.id ? await fapi.editSite(sheet.s.id, { name, active }) : await fapi.addSite({ name }); fx.toast("انحفظ"); setSheet(null); reload(); }} />}
      {sheet?.kind === "line" && <LineSheet l={sheet.l} sites={data.sites} staff={staff || []} onClose={() => setSheet(null)} onDone={() => { setSheet(null); reload(); }} />}
      {sheet?.kind === "machine" && <MachineSheet m={sheet.m} data={data} onClose={() => setSheet(null)} onDone={() => { setSheet(null); reload(); }} />}
    </div>
  );
}

function NameSheet({ title, value, active, canStop, placeholder, onClose, onSave }) {
  const [name, setName] = useState(value || "");
  const [on, setOn] = useState(active);
  return (
    <Sheet title={title} onClose={onClose}>
      <div className="fx-stack">
        <label className="fx-field">الاسم<input className="fx-input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={placeholder} /></label>
        {canStop && <label className="fx-row" style={{ gap: 8 }}><input type="checkbox" checked={!on} onChange={(e) => setOn(!e.target.checked)} /> موقّف</label>}
        <Act className="fx-btn pri block" disabled={!name.trim()} onClick={() => onSave(name.trim(), on)}>حفظ</Act>
      </div>
    </Sheet>
  );
}

function LineSheet({ l, sites, staff, onClose, onDone }) {
  const fx = useFx();
  const [name, setName] = useState(l.name || "");
  const [site, setSite] = useState(l.site_id || (sites.length === 1 ? sites[0].id : null));
  const [users, setUsers] = useState(() => new Set((l.users || []).map((u) => u.id)));
  const [on, setOn] = useState(l.active !== false);
  const [err, setErr] = useState("");
  const toggle = (id) => setUsers((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  return (
    <Sheet title={l.id ? `خط ${l.name}` : "خط إنتاج جديد"} onClose={onClose}>
      <div className="fx-stack">
        <label className="fx-field">اسم الخط<input className="fx-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="مثلًا: خط الكاسات" /></label>
        {sites.length > 0 && <div className="fx-field">بأي مصنع؟<div className="fx-chips">{sites.filter((s) => s.active).map((s) => <button key={s.id} type="button" className={`fx-chip ${site === s.id ? "on" : ""}`} onClick={() => setSite(site === s.id ? null : s.id)}>{s.name}</button>)}</div></div>}
        <div className="fx-field">موظفين هالخط <small className="fx-muted">(اللي بيسحبوا مواد إله)</small>
          <div className="fx-chips">{staff.map((u) => <button key={u.id} type="button" className={`fx-chip ${users.has(u.id) ? "on" : ""}`} onClick={() => toggle(u.id)}>{users.has(u.id) ? "✓ " : ""}{u.full_name}</button>)}</div>
        </div>
        {l.id && <label className="fx-row" style={{ gap: 8 }}><input type="checkbox" checked={!on} onChange={(e) => setOn(!e.target.checked)} /> موقّف</label>}
        <Err msg={err} />
        <Act className="fx-btn pri block" disabled={!name.trim()} onClick={async () => {
          setErr("");
          try {
            const b = { name: name.trim(), site_id: site, user_ids: [...users], active: on };
            l.id ? await fapi.editPline(l.id, b) : await fapi.addPline(b);
            fx.toast("انحفظ"); onDone();
          } catch (e) { setErr(e.message); }
        }}>حفظ</Act>
      </div>
    </Sheet>
  );
}

function MachineSheet({ m, data, onClose, onDone }) {
  const [site, setSite] = useState(m.site_id || null);
  const [line, setLine] = useState(m.line_id || null);
  return (
    <Sheet title={m.name} onClose={onClose}>
      <div className="fx-stack">
        {data.sites.length > 0 && <div className="fx-field">المصنع<div className="fx-chips">{data.sites.filter((s) => s.active).map((s) => <button key={s.id} type="button" className={`fx-chip ${site === s.id ? "on" : ""}`} onClick={() => setSite(site === s.id ? null : s.id)}>{s.name}</button>)}</div></div>}
        {data.lines.length > 0 && <div className="fx-field">الخط<div className="fx-chips">{data.lines.filter((l) => l.active && (!site || !l.site_id || l.site_id === site)).map((l) => <button key={l.id} type="button" className={`fx-chip ${line === l.id ? "on" : ""}`} onClick={() => setLine(line === l.id ? null : l.id)}>{l.name}</button>)}</div></div>}
        <Act className="fx-btn pri block" onClick={async () => { await fapi.setMachineSite(m.id, { site_id: site, line_id: line }); onDone(); }}>حفظ</Act>
      </div>
    </Sheet>
  );
}

// المواد الأساسية لكل نوع خط — بتنضاف مرة وحدة، والمحاسب بيعبّي الأسعار والكميات
function StarterSheet({ data, line0, onClose, onDone }) {
  const fx = useFx();
  const lines = data.lines.filter((l) => l.active);
  const guess = (l) => (/مطر|قنا|قنين|bottle/i.test(l?.name || "") ? "bottles" : /كاس|cup/i.test(l?.name || "") ? "cups" : null);
  const [line, setLine] = useState(line0 || (lines.length === 1 ? lines[0].id : null));
  const [preset, setPreset] = useState(() => guess(lines.find((l) => l.id === (line0 || lines[0]?.id))) || "bottles");
  return (
    <Sheet title="المواد الأساسية للخط" onClose={onClose}>
      <div className="fx-stack">
        <div className="fx-note sky">بنضيف قائمة المواد اللي بيحتاجها الخط عادةً، بكمية وسعر صفر. بعدها المحاسب بيعدّل الأسعار وبيدخّل الكميات من «دخل بضاعة»، وبيقدر يشيل أي صنف ما بيلزمكم أو يضيف غيره.</div>
        <div className="fx-field">نوع الخط<div className="fx-chips">{Object.entries(data.starters || {}).map(([k, v]) => <button key={k} type="button" className={`fx-chip ${preset === k ? "on" : ""}`} onClick={() => setPreset(k)}>{v.label} ({v.n})</button>)}</div></div>
        {lines.length > 0 && (
          <div className="fx-field">لمستودع أي خط؟<div className="fx-chips">
            <button type="button" className={`fx-chip ${!line ? "on" : ""}`} onClick={() => setLine(null)}>عامة</button>
            {lines.map((l) => <button key={l.id} type="button" className={`fx-chip ${line === l.id ? "on" : ""}`} onClick={() => { setLine(l.id); const g = guess(l); if (g) setPreset(g); }}>{l.name}</button>)}
          </div></div>
        )}
        {lines.length === 0 && <div className="fx-note">ما في خطوط لسا — ضيف «خط المطرات» و«خط الكاسات» من «المصانع والخطوط» عشان كل خط يكون إله مستودعه.</div>}
        <Act className="fx-btn pri block fx-huge" onClick={async () => {
          const r = await fapi.storeStarter({ preset, line_id: line });
          fx.toast(r.added ? `انضاف ${r.added} صنف ✓` : "كل هالأصناف موجودة من قبل");
          onDone(r.added);
        }}>✨ ضيفهم</Act>
      </div>
    </Sheet>
  );
}
