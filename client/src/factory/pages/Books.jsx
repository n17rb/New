import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { FiPlus, FiPrinter, FiMessageCircle, FiSearch, FiX } from "react-icons/fi";
import { fapi } from "../fapi.js";
import { useFx, useLoad, Sheet, Err, Loading, Empty, Act, PhotoInput, DateInput, SignaturePad, Reload, waLink, money, num, date, dateTime, today } from "../ui.jsx";
import { smartFilter } from "../smartSearch.js";

// ============================================================
// الدفاتر: الشركات (مين إله علينا ومين علينا إله) بفواتير رسمية، إعادة التدوير،
// الصندوق (دخل وصرف عام)، التسليم بين المحاسب والإدارة بتوقيع، والملخّص
// ============================================================
const KINDS = {
  purchase: { label: "فاتورة شراء", hint: "استلمنا بضاعة — صار علينا", icon: "📥" },
  paid: { label: "دفعنا", hint: "دفعنا للشركة", icon: "💸" },
  sale: { label: "فاتورة بيع", hint: "بعنا لهم — صار إلنا", icon: "📤" },
  received: { label: "قبضنا", hint: "قبضنا منهم", icon: "💵" },
  adjust: { label: "تسوية", hint: "+ علينا / − إلنا", icon: "✎" },
};
const balText = (b) => (b > 0.005 ? `علينا إلهم ${money(b)}` : b < -0.005 ? `إلنا عندهم ${money(-b)}` : "الحساب مسكّر ✓");
const balColor = (b) => (b > 0.005 ? "var(--fx-crit)" : b < -0.005 ? "var(--fx-ok)" : "var(--fx-muted)");

export default function Books() {
  const [params, setParams] = useSearchParams();
  const tabs = [["partners", "الشركات"], ["cash", "الصندوق"], ["utils", "الكهربا والمي"], ["recycle", "إعادة التدوير"], ["handover", "التسليم"], ["summary", "الملخّص"]];
  const tab = tabs.find((t) => t[0] === params.get("tab"))?.[0] || "partners";
  return (
    <div className="fx-page">
      <h1 className="fx-h1">الدفاتر</h1>
      <div className="fx-tabs">{tabs.map(([k, l]) => <button key={k} className={tab === k ? "on" : ""} onClick={() => setParams({ tab: k })}>{l}</button>)}</div>
      {tab === "partners" && <Partners />}
      {tab === "cash" && <Cash />}
      {tab === "utils" && <Utilities />}
      {tab === "recycle" && <Recycle />}
      {tab === "handover" && <Handover />}
      {tab === "summary" && <Summary />}
    </div>
  );
}

// ---------- الشركات ----------
function Partners() {
  const fx = useFx();
  const edit = fx.can("f_money", "edit");
  const { data, error, reload } = useLoad(() => fapi.partners(), []);
  const [q, setQ] = useState("");
  const [sheet, setSheet] = useState(null);
  const list = data ? (q.trim() ? smartFilter(data.partners, q, ["name", "contact", "phone"]) : data.partners) : [];
  return (
    <div className="fx-stack">
      <Err msg={error} />
      {!data && !error && <Loading />}
      {data && (
        <>
          <div className="fx-grid2">
            <div className="fx-card" style={{ textAlign: "center" }}><small className="fx-muted">علينا للشركات</small><b className="fx-num" style={{ display: "block", fontSize: 22, color: "var(--fx-crit)" }}>{money(data.we_owe)}</b></div>
            <div className="fx-card" style={{ textAlign: "center" }}><small className="fx-muted">إلنا عند الشركات</small><b className="fx-num" style={{ display: "block", fontSize: 22, color: "var(--fx-ok)" }}>{money(data.they_owe)}</b></div>
          </div>
          <div className="fx-row" style={{ gap: 8, flexWrap: "nowrap" }}>
            <label className="fx-search fx-grow"><FiSearch aria-hidden="true" /><input className="fx-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="دوّر على شركة" /></label>
            {edit && <button className="fx-btn pri" onClick={() => setSheet({ kind: "new" })}><FiPlus /> شركة</button>}
          </div>
          {list.length === 0 && <Empty title="ما في شركات" text={edit ? "ضيف الشركات اللي بتشتري منها (كرتون، بلاستيك…) أو اللي بتبيعلها." : ""} />}
          <div className="fx-list">
            {list.map((p) => (
              <button key={p.id} className="fx-item" onClick={() => setSheet({ kind: "open", id: p.id })}>
                <span className="fx-avatar">{p.kind === "buyer" ? "🛒" : "🏭"}</span>
                <span className="t"><b>{p.name}</b><span>{[p.kind === "buyer" ? "بيشتري منّا" : p.kind === "both" ? "بنشتري وبنبيع" : "مورد", p.phone].filter(Boolean).join(" · ")}{!p.active ? " · موقّف" : ""}</span></span>
                <span className="end" style={{ textAlign: "end" }}><b className="fx-num" style={{ color: balColor(p.balance) }}>{money(Math.abs(p.balance))}</b><span className="fx-muted" style={{ fontSize: 11.5, display: "block" }}>{p.balance > 0.005 ? "علينا" : p.balance < -0.005 ? "إلنا" : "مسكّر"}</span></span>
              </button>
            ))}
          </div>
        </>
      )}
      {sheet?.kind === "new" && <PartnerEdit p={{}} onClose={() => setSheet(null)} onDone={() => { setSheet(null); reload(); }} />}
      {sheet?.kind === "open" && <PartnerSheet id={sheet.id} edit={edit} onClose={() => { setSheet(null); reload(); }} />}
    </div>
  );
}

function PartnerEdit({ p, onClose, onDone }) {
  const fx = useFx();
  const [f, setF] = useState({ name: p.name || "", kind: p.kind || "supplier", phone: p.phone || "", contact: p.contact || "", tax_no: p.tax_no || "", address: p.address || "", notes: p.notes || "", opening: "", active: p.active !== false });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const [err, setErr] = useState("");
  return (
    <Sheet title={p.id ? `تعديل ${p.name}` : "شركة جديدة"} onClose={onClose}>
      <div className="fx-stack">
        <label className="fx-field">اسم الشركة<input className="fx-input" value={f.name} onChange={set("name")} autoFocus={!p.id} /></label>
        <div className="fx-chips">{[["supplier", "مورد (بنشتري منه)"], ["buyer", "بيشتري منّا"], ["both", "الثنين"]].map(([k, l]) => <button key={k} type="button" className={`fx-chip ${f.kind === k ? "on" : ""}`} onClick={() => setF({ ...f, kind: k })}>{l}</button>)}</div>
        <div className="fx-grid2">
          <label className="fx-field">رقم الواتساب<input className="fx-input" dir="ltr" inputMode="tel" value={f.phone} onChange={set("phone")} placeholder="07XXXXXXXX" /></label>
          <label className="fx-field">الشخص المسؤول<input className="fx-input" value={f.contact} onChange={set("contact")} /></label>
          <label className="fx-field">الرقم الضريبي<input className="fx-input" dir="ltr" value={f.tax_no} onChange={set("tax_no")} /></label>
          <label className="fx-field">العنوان<input className="fx-input" value={f.address} onChange={set("address")} /></label>
        </div>
        {!p.id && <label className="fx-field">رصيد سابق (اختياري) <small className="fx-muted">+ علينا إلهم، − إلنا عندهم</small><input className="fx-input fx-num" type="number" inputMode="decimal" value={f.opening} onChange={set("opening")} /></label>}
        <label className="fx-field">ملاحظات<input className="fx-input" value={f.notes} onChange={set("notes")} /></label>
        {p.id && <label className="fx-row" style={{ gap: 8 }}><input type="checkbox" checked={!f.active} onChange={(e) => setF({ ...f, active: !e.target.checked })} /> موقّفة</label>}
        <Err msg={err} />
        <Act className="fx-btn pri block" disabled={!f.name.trim()} onClick={async () => {
          setErr("");
          try { p.id ? await fapi.editPartner(p.id, f) : await fapi.addPartner(f); fx.toast("انحفظ"); onDone(); } catch (e) { setErr(e.message); }
        }}>حفظ</Act>
      </div>
    </Sheet>
  );
}

function PartnerSheet({ id, edit, onClose }) {
  const fx = useFx();
  const { data, error, reload } = useLoad(() => fapi.partner(id), [id]);
  const [sheet, setSheet] = useState(null);
  const [msg, setMsg] = useState(null);
  const p = data?.partner;
  async function statement() {
    const r = await fapi.partnerMessage(id);
    setMsg({ text: r.text, phone: r.phone });
  }
  return (
    <Sheet title={p?.name || "…"} onClose={onClose}>
      <div className="fx-stack">
        <Err msg={error} />
        {!data && !error && <Loading />}
        {p && (
          <>
            <div className="fx-pay-total"><span>الرصيد</span><b style={{ color: balColor(p.balance) }}>{balText(p.balance)} <small>د.أ</small></b></div>
            {edit && (
              <div className="fx-grid2">
                {Object.entries(KINDS).map(([k, v]) => <button key={k} className="fx-btn" onClick={() => setSheet({ kind: k })}>{v.icon} {v.label}</button>)}
                <button className="fx-btn" onClick={() => setSheet({ kind: "edit" })}>✎ بيانات الشركة</button>
              </div>
            )}
            {p.phone && <button className="fx-btn sky block" onClick={statement}><FiMessageCircle /> ابعتلهم الرصيد على واتساب</button>}
            <b>الحركة</b>
            {data.entries.length === 0 && <div className="fx-muted">ما في حركة.</div>}
            <div className="fx-list">
              {data.entries.map((e) => (
                <div key={e.id} className="fx-item" style={{ alignItems: "flex-start" }}>
                  <span className="fx-avatar" style={{ fontSize: 17 }}>{KINDS[e.kind]?.icon}</span>
                  <span className="t">
                    <b>{KINDS[e.kind]?.label} {money(e.amount)}{e.official_no ? ` · رسمية #${e.official_no}` : e.ref_no ? ` · رقم ${e.ref_no}` : ""}</b>
                    <span>{date(e.doc_date)}{e.method ? ` · ${e.method}` : ""}{e.by_name ? ` · ${e.by_name}` : ""} · بعدها {balText(e.balance_after)}</span>
                    {e.note && <span>📝 {e.note}</span>}
                    <span className="fx-row" style={{ gap: 6, marginTop: 4 }}>
                      {["purchase", "sale"].includes(e.kind) && <button className="fx-btn sm" onClick={() => printInvoice(fx, p, e)}><FiPrinter /> فاتورة PDF</button>}
                      {e.file_url ? <a className="fx-btn sm" href={e.file_url} target="_blank" rel="noreferrer">📎 النسخة المختومة</a>
                        : edit && ["purchase", "sale", "paid", "received"].includes(e.kind) && <button className="fx-btn sm" onClick={() => setSheet({ kind: "file", e })}>📎 ارفق المختومة</button>}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
      {sheet?.kind === "edit" && <PartnerEdit p={p} onClose={() => setSheet(null)} onDone={() => { setSheet(null); reload(); }} />}
      {sheet && KINDS[sheet.kind] && <EntrySheet p={p} kind={sheet.kind} onClose={() => setSheet(null)} onDone={(r) => { setSheet(null); reload(); if (r?.message) setMsg({ text: r.message, phone: r.phone }); }} />}
      {sheet?.kind === "file" && <FileSheet e={sheet.e} onClose={() => setSheet(null)} onDone={() => { setSheet(null); reload(); }} />}
      {msg && <MsgSheet m={msg} onClose={() => setMsg(null)} />}
    </Sheet>
  );
}

function MsgSheet({ m, onClose }) {
  return (
    <Sheet title="رسالة للشركة" onClose={onClose}>
      <div className="fx-stack">
        <div className="fx-card" style={{ whiteSpace: "pre-wrap", fontSize: 14.5 }}>{m.text}</div>
        {m.phone ? <a className="fx-btn ok block fx-huge" href={waLink(m.phone, m.text)} target="_blank" rel="noreferrer" onClick={onClose}><FiMessageCircle /> ابعت على واتساب</a>
          : <div className="fx-note">ما في رقم واتساب للشركة — ضيفه من «بيانات الشركة».</div>}
        <button className="fx-btn block" onClick={onClose}>بعدين</button>
      </div>
    </Sheet>
  );
}

function EntrySheet({ p, kind, onClose, onDone }) {
  const fx = useFx();
  const K = KINDS[kind];
  const withItems = kind === "purchase" || kind === "sale";
  const [items, setItems] = useState(withItems ? [{ name: "", qty: "", unit: "", price: "" }] : []);
  const [amount, setAmount] = useState("");
  const [d, setD] = useState(today());
  const [ref, setRef] = useState("");
  const [method, setMethod] = useState(kind === "paid" || kind === "received" ? "كاش" : "");
  const [note, setNote] = useState("");
  const [file, setFile] = useState("");
  const [err, setErr] = useState("");
  const itemsTotal = items.reduce((a, i) => a + (Number(i.qty) || 0) * (Number(i.price) || 0), 0);
  const total = amount !== "" ? Number(amount) : itemsTotal;
  const upd = (i, k, v) => setItems(items.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  return (
    <Sheet title={`${K.icon} ${K.label} — ${p.name}`} onClose={onClose}>
      <div className="fx-stack">
        <div className="fx-note sky">{K.hint}</div>
        {withItems && (
          <div className="fx-stack" style={{ gap: 8 }}>
            {items.map((it, i) => (
              <div key={i} className="fx-card" style={{ padding: 10 }}>
                <div className="fx-row" style={{ flexWrap: "nowrap", gap: 6 }}>
                  <input className="fx-input fx-grow" value={it.name} onChange={(e) => upd(i, "name", e.target.value)} placeholder="الصنف (مثلًا: بلاستيك PP)" />
                  {items.length > 1 && <button type="button" className="fx-plain" onClick={() => setItems(items.filter((_, j) => j !== i))} aria-label="شيل"><FiX /></button>}
                </div>
                <div className="fx-row" style={{ gap: 6, marginTop: 6, flexWrap: "nowrap" }}>
                  <input className="fx-input fx-num" style={{ flex: 1 }} type="number" inputMode="decimal" value={it.qty} onChange={(e) => upd(i, "qty", e.target.value)} placeholder="الكمية" />
                  <input className="fx-input" style={{ flex: 0.8 }} value={it.unit} onChange={(e) => upd(i, "unit", e.target.value)} placeholder="الوحدة" />
                  <input className="fx-input fx-num" style={{ flex: 1 }} type="number" inputMode="decimal" value={it.price} onChange={(e) => upd(i, "price", e.target.value)} placeholder="السعر" />
                </div>
              </div>
            ))}
            <button type="button" className="fx-btn sm" onClick={() => setItems([...items, { name: "", qty: "", unit: "", price: "" }])}><FiPlus /> صنف</button>
          </div>
        )}
        <label className="fx-field">{withItems ? "المجموع (أو اكتبه إذا مختلف)" : kind === "adjust" ? "المبلغ (+ علينا، − إلنا)" : "المبلغ"}
          <input className="fx-input fx-num" style={{ fontSize: 20, textAlign: "center", fontWeight: 800 }} type="number" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={withItems ? money(itemsTotal) : "0"} />
        </label>
        <div className="fx-grid2">
          <div className="fx-field">التاريخ<DateInput value={d} onChange={setD} ariaLabel="التاريخ" /></div>
          {kind !== "adjust" && <label className="fx-field">{kind === "purchase" ? "رقم فاتورتهم" : "رقم المرجع"}<input className="fx-input" value={ref} onChange={(e) => setRef(e.target.value)} /></label>}
        </div>
        {(kind === "paid" || kind === "received") && <div className="fx-chips">{["كاش", "شيك", "حوالة", "كليك"].map((m) => <button key={m} type="button" className={`fx-chip ${method === m ? "on" : ""}`} onClick={() => setMethod(m)}>{m}</button>)}</div>}
        <label className="fx-field">{kind === "adjust" ? "السبب" : "ملاحظة (اختياري)"}<input className="fx-input" value={note} onChange={(e) => setNote(e.target.value)} /></label>
        {kind !== "adjust" && <PhotoInput label={kind === "purchase" ? "صورة فاتورتهم (اختياري)" : "صورة الوصل/الفاتورة المختومة (اختياري)"} value={file} onChange={setFile} kind="doc" />}
        <Err msg={err} />
        <Act className="fx-btn pri block fx-huge" disabled={!total || (kind === "adjust" && !note.trim())} onClick={async () => {
          setErr("");
          try {
            const r = await fapi.partnerEntry(p.id, { kind, amount: amount !== "" ? amount : undefined, items: withItems ? items.filter((i) => i.name.trim()) : undefined, doc_date: d, ref_no: ref, method, note, file_url: file || undefined });
            fx.toast(`انسجّل — ${balText(r.balance)}`);
            onDone(r);
          } catch (e) { setErr(e.message); }
        }}>✓ سجّل {total ? money(total) : ""}</Act>
      </div>
    </Sheet>
  );
}

function FileSheet({ e, onClose, onDone }) {
  const [file, setFile] = useState("");
  return (
    <Sheet title="ارفق النسخة المختومة" onClose={onClose}>
      <div className="fx-stack">
        <div className="fx-note">اطبع الفاتورة، اختمها ووقّعها، وصوّرها هون — بتضل محفوظة مع الحركة.</div>
        <PhotoInput label="صوّر الفاتورة المختومة" value={file} onChange={setFile} kind="doc" />
        <Act className="fx-btn pri block" disabled={!file} onClick={async () => { await fapi.entryFile(e.id, file); onDone(); }}>حفظ</Act>
      </div>
    </Sheet>
  );
}

// فاتورة رسمية للطباعة/PDF — بتنختم وبتتصوّر وبتترفق
function printInvoice(fx, p, e) {
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const b = fx.shop?.brand || {};
  const name = b.name || fx.boot.factory?.name || fx.shop?.name || "";
  const sale = e.kind === "sale";
  const items = Array.isArray(e.items) && e.items.length ? e.items : [{ name: e.note || (sale ? "بضاعة" : "مشتريات"), qty: 1, unit: "", price: e.amount }];
  const rows = items.map((i, n) => `<tr><td>${n + 1}</td><td style="text-align:start">${esc(i.name)}</td><td>${Number(i.qty) || ""} ${esc(i.unit || "")}</td><td>${money(i.price)}</td><td>${money((Number(i.qty) || 0) * (Number(i.price) || 0))}</td></tr>`).join("");
  const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>فاتورة ${e.official_no || e.ref_no || e.id}</title>
<style>body{font-family:system-ui,Tahoma,sans-serif;margin:24px;color:#111}.top{display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #0456a2;padding-bottom:10px}
.top img{max-height:70px}h1{margin:0;font-size:22px}.box{display:flex;gap:16px;margin:16px 0}.box div{flex:1;border:1px solid #ccc;border-radius:8px;padding:10px;font-size:14px;line-height:1.8}
table{width:100%;border-collapse:collapse;font-size:14px}th,td{border:1px solid #999;padding:7px;text-align:center}th{background:#eef5fb}.tot td{font-weight:800;font-size:16px}
.sig{display:flex;gap:30px;margin-top:40px}.sig div{flex:1;border-top:1px solid #333;padding-top:8px;text-align:center;font-size:13px;min-height:70px}@media print{button{display:none}}</style></head><body>
<div class="top"><div>${b.logo ? `<img src="${esc(b.logo)}" alt="">` : `<h1>${esc(name)}</h1>`}<div style="font-size:13px;color:#555">${esc(b.phone || "")}</div></div>
<div style="text-align:end"><h1>${sale ? "فاتورة بيع" : "فاتورة شراء"}</h1><div>رقم: <b>${esc(e.official_no || e.ref_no || e.id)}</b></div><div>التاريخ: <b>${esc(e.doc_date)}</b></div></div></div>
<div class="box"><div><b>${sale ? "البائع" : "المشتري"}:</b> ${esc(name)}</div><div><b>${sale ? "المشتري" : "البائع"}:</b> ${esc(p.name)}${p.tax_no ? `<br>الرقم الضريبي: ${esc(p.tax_no)}` : ""}${p.address ? `<br>${esc(p.address)}` : ""}${p.phone ? `<br>${esc(p.phone)}` : ""}</div></div>
<table><thead><tr><th>#</th><th>الصنف</th><th>الكمية</th><th>السعر</th><th>المجموع</th></tr></thead><tbody>${rows}
<tr class="tot"><td colspan="4">المجموع الكلي (دينار أردني)</td><td>${money(e.amount)}</td></tr></tbody></table>
${e.note ? `<p style="font-size:13px">ملاحظات: ${esc(e.note)}</p>` : ""}
<div class="sig"><div>توقيع وختم ${esc(name)}</div><div>توقيع وختم ${esc(p.name)}</div></div>
<button onclick="print()" style="margin-top:24px;padding:10px 18px;font-size:15px">🖨️ اطبع / احفظ PDF</button></body></html>`;
  const w = window.open("", "_blank");
  if (!w) return fx.toast("اسمح بفتح النوافذ عشان تطبع");
  w.document.write(html);
  w.document.close();
  setTimeout(() => { try { w.print(); } catch { /* من الزر */ } }, 500);
}

// ---------- الصندوق ----------
const CASH_CATS = { in: ["مبيعات مباشرة", "بيع أرض/أصول", "قرض", "رأس مال", "دخل ثاني"], out: ["إيجار", "رواتب", "كهربا", "مي", "ضرايب ورسوم", "صيانة", "مصاريف مكتب", "مصاريف ثانية"] };
function Cash() {
  const fx = useFx();
  const edit = fx.can("f_money", "edit");
  const [from, setFrom] = useState(() => today().slice(0, 8) + "01");
  const [to, setTo] = useState(today());
  const { data, error, reload } = useLoad(() => fapi.cashbook({ from, to }), [from, to]);
  const [sheet, setSheet] = useState(null);
  return (
    <div className="fx-stack">
      <div className="fx-grid2">
        <div className="fx-field">من<DateInput value={from} onChange={setFrom} ariaLabel="من" /></div>
        <div className="fx-field">لـ<DateInput value={to} onChange={setTo} ariaLabel="لـ" /></div>
      </div>
      <Err msg={error} />
      {!data && !error && <Loading />}
      {data && (
        <>
          <div className="fx-grid2">
            <div className="fx-card" style={{ textAlign: "center" }}><small className="fx-muted">دخل</small><b className="fx-num" style={{ display: "block", fontSize: 22, color: "var(--fx-ok)" }}>{money(data.in)}</b></div>
            <div className="fx-card" style={{ textAlign: "center" }}><small className="fx-muted">صرف</small><b className="fx-num" style={{ display: "block", fontSize: 22, color: "var(--fx-crit)" }}>{money(data.out)}</b></div>
          </div>
          {edit && (
            <div className="fx-grid2">
              <button className="fx-btn ok" onClick={() => setSheet("in")}>+ دخل</button>
              <button className="fx-btn" onClick={() => setSheet("out")}>− صرف</button>
            </div>
          )}
          {data.rows.length === 0 && <div className="fx-muted">ما في حركة بهالفترة.</div>}
          <div className="fx-list">
            {data.rows.map((x) => (
              <div key={x.id} className="fx-item">
                <span className="fx-avatar">{x.kind === "in" ? "⬇️" : "⬆️"}</span>
                <span className="t"><b>{x.category}</b><span>{date(x.doc_date)}{x.by_name ? ` · ${x.by_name}` : ""}{x.note ? ` · ${x.note}` : ""}</span></span>
                <span className="end fx-num" style={{ color: x.kind === "in" ? "var(--fx-ok)" : "var(--fx-crit)", fontWeight: 800 }}>{x.kind === "in" ? "+" : "−"}{money(x.amount)}</span>
                {x.file_url && <a href={x.file_url} target="_blank" rel="noreferrer"><img className="fx-photo" src={x.file_url} alt="" /></a>}
              </div>
            ))}
          </div>
        </>
      )}
      {sheet && <CashSheet kind={sheet} cats={data?.categories || []} onClose={() => setSheet(null)} onDone={() => { setSheet(null); reload(); }} />}
    </div>
  );
}
function CashSheet({ kind, cats, onClose, onDone }) {
  const fx = useFx();
  const used = cats.filter((c) => c.kind === kind).map((c) => c.category);
  const opts = [...new Set([...used, ...CASH_CATS[kind]])].slice(0, 12);
  const [cat, setCat] = useState("");
  const [amount, setAmount] = useState("");
  const [d, setD] = useState(today());
  const [note, setNote] = useState("");
  const [file, setFile] = useState("");
  const [err, setErr] = useState("");
  return (
    <Sheet title={kind === "in" ? "دخل للصندوق" : "صرف من الصندوق"} onClose={onClose}>
      <div className="fx-stack">
        <div className="fx-chips">{opts.map((c) => <button key={c} type="button" className={`fx-chip ${cat === c ? "on" : ""}`} onClick={() => setCat(c)}>{c}</button>)}</div>
        <label className="fx-field">البند<input className="fx-input" value={cat} onChange={(e) => setCat(e.target.value)} placeholder="أو اكتب بند جديد" /></label>
        <label className="fx-field">المبلغ<input className="fx-input fx-num" style={{ fontSize: 20, textAlign: "center", fontWeight: 800 }} type="number" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        <div className="fx-field">التاريخ<DateInput value={d} onChange={setD} ariaLabel="التاريخ" /></div>
        <label className="fx-field">ملاحظة<input className="fx-input" value={note} onChange={(e) => setNote(e.target.value)} /></label>
        <PhotoInput label="صورة الوصل (اختياري)" value={file} onChange={setFile} kind="doc" />
        <Err msg={err} />
        <Act className="fx-btn pri block" disabled={!cat.trim() || !(Number(amount) > 0)} onClick={async () => {
          setErr("");
          try { await fapi.addCash({ kind, category: cat, amount, doc_date: d, note, file_url: file || undefined }); fx.toast("انسجّل"); onDone(); } catch (e) { setErr(e.message); }
        }}>حفظ</Act>
      </div>
    </Sheet>
  );
}

// ---------- إعادة التدوير ----------
const MATS = ["كرتون", "بلاستيك", "نايلون", "قصدير"];
function Recycle() {
  const fx = useFx();
  const edit = fx.can("f_money", "edit");
  const { data, error, reload } = useLoad(() => fapi.recycle(), []);
  const [sheet, setSheet] = useState(null);
  return (
    <div className="fx-stack">
      <Err msg={error} />
      {!data && !error && <Loading />}
      {data && (
        <>
          {edit && (
            <div className="fx-grid2">
              <button className="fx-btn" onClick={() => setSheet({ kind: "in" })}>♻️ جمعنا تالف</button>
              <button className="fx-btn ok" onClick={() => setSheet({ kind: "sale" })}>💰 بعنا</button>
            </div>
          )}
          {data.materials.length === 0 && <Empty title="ما في إشي لسا" text="سجّل الكرتون والبلاستيك والنايلون التالف لما ينجمع، وبعدين لما ينباع بسعر الطن." />}
          {data.materials.map((m) => (
            <section key={m.material} className="fx-card">
              <b>♻️ {m.material}</b>
              <div className="fx-kv"><span>موجود هلأ</span><b>{num(m.left_kg)} كغ</b></div>
              <div className="fx-kv"><span>انباع</span><b>{num(m.sold_kg)} كغ · {money(m.amount)} د.أ</b></div>
              <div className="fx-kv"><span>قبضنا</span><b style={{ color: "var(--fx-ok)" }}>{money(m.received)}</b></div>
              {m.due > 0.005 && <div className="fx-kv"><span>باقي إلنا</span><b style={{ color: "var(--fx-crit)" }}>{money(m.due)}</b></div>}
            </section>
          ))}
          <div className="fx-list">
            {data.rows.map((x) => (
              <div key={x.id} className="fx-item">
                <span className="fx-avatar">{x.kind === "in" ? "♻️" : "💰"}</span>
                <span className="t">
                  <b>{x.kind === "in" ? "جمعنا" : "بعنا"} {num(x.kg)} كغ {x.material}{x.price_ton ? ` · ${money(x.price_ton)} للطن` : ""}</b>
                  <span>{date(x.doc_date)}{x.partner_name ? ` · ${x.partner_name}` : ""}{x.kind === "sale" ? ` · ${money(x.amount)} د.أ · قبضنا ${money(x.received)}` : ""}{x.note ? ` · ${x.note}` : ""}</span>
                </span>
                {edit && x.kind === "sale" && x.amount - x.received > 0.005 && <button className="fx-btn sm ok" onClick={() => setSheet({ kind: "recv", x })}>قبضت</button>}
              </div>
            ))}
          </div>
        </>
      )}
      {(sheet?.kind === "in" || sheet?.kind === "sale") && <RecycleSheet kind={sheet.kind} onClose={() => setSheet(null)} onDone={() => { setSheet(null); reload(); }} />}
      {sheet?.kind === "recv" && <RecvSheet x={sheet.x} onClose={() => setSheet(null)} onDone={() => { setSheet(null); reload(); }} />}
    </div>
  );
}
function RecycleSheet({ kind, onClose, onDone }) {
  const fx = useFx();
  const { data: ps } = useLoad(() => (kind === "sale" ? fapi.partners() : Promise.resolve(null)), [kind]);
  const [f, setF] = useState({ material: "كرتون", kg: "", price_ton: "", received: "", partner_id: null, note: "", doc_date: today() });
  const [err, setErr] = useState("");
  const amount = (Number(f.kg) / 1000) * (Number(f.price_ton) || 0);
  return (
    <Sheet title={kind === "in" ? "جمعنا تالف للتدوير" : "بعنا تالف"} onClose={onClose}>
      <div className="fx-stack">
        <div className="fx-chips">{MATS.map((m) => <button key={m} type="button" className={`fx-chip ${f.material === m ? "on" : ""}`} onClick={() => setF({ ...f, material: m })}>{m}</button>)}</div>
        <label className="fx-field">الوزن (كغ)<input className="fx-input fx-num" type="number" inputMode="decimal" value={f.kg} onChange={(e) => setF({ ...f, kg: e.target.value })} /></label>
        {kind === "sale" && (
          <>
            <label className="fx-field">سعر الطن (د.أ)<input className="fx-input fx-num" type="number" inputMode="decimal" value={f.price_ton} onChange={(e) => setF({ ...f, price_ton: e.target.value })} /></label>
            {amount > 0 && <div className="fx-pay-sum"><span>المبلغ <b>{money(amount)}</b> د.أ</span></div>}
            <label className="fx-field">قديش قبضت هلأ؟<input className="fx-input fx-num" type="number" inputMode="decimal" value={f.received} onChange={(e) => setF({ ...f, received: e.target.value })} placeholder={amount ? money(amount) : "0"} /></label>
            {ps?.partners?.length > 0 && (
              <div className="fx-field">لمين بعت؟ (اختياري — بينسجّل على حسابه)<div className="fx-chips">
                <button type="button" className={`fx-chip ${!f.partner_id ? "on" : ""}`} onClick={() => setF({ ...f, partner_id: null })}>مش مسجّل</button>
                {ps.partners.filter((p) => p.active && p.kind !== "supplier").map((p) => <button key={p.id} type="button" className={`fx-chip ${f.partner_id === p.id ? "on" : ""}`} onClick={() => setF({ ...f, partner_id: p.id })}>{p.name}</button>)}
              </div></div>
            )}
          </>
        )}
        <div className="fx-field">التاريخ<DateInput value={f.doc_date} onChange={(v) => setF({ ...f, doc_date: v })} ariaLabel="التاريخ" /></div>
        <label className="fx-field">ملاحظة<input className="fx-input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></label>
        <Err msg={err} />
        <Act className="fx-btn pri block" disabled={!(Number(f.kg) > 0)} onClick={async () => {
          setErr("");
          try { await fapi.addRecycle({ ...f, kind, received: f.received === "" && kind === "sale" ? amount : f.received }); fx.toast("انسجّل"); onDone(); } catch (e) { setErr(e.message); }
        }}>حفظ</Act>
      </div>
    </Sheet>
  );
}
function RecvSheet({ x, onClose, onDone }) {
  const left = Math.round((x.amount - x.received) * 100) / 100;
  const [a, setA] = useState(String(left));
  const [err, setErr] = useState("");
  return (
    <Sheet title={`قبضت ثمن ${x.material}`} onClose={onClose}>
      <div className="fx-stack">
        <label className="fx-field">المبلغ (الباقي {money(left)})<input className="fx-input fx-num" type="number" inputMode="decimal" value={a} onChange={(e) => setA(e.target.value)} /></label>
        <Err msg={err} />
        <Act className="fx-btn ok block" onClick={async () => { setErr(""); try { await fapi.recycleReceive(x.id, a); onDone(); } catch (e) { setErr(e.message); } }}>✓ قبضت</Act>
      </div>
    </Sheet>
  );
}

// ---------- التسليم بين المحاسب والإدارة ----------
function Handover() {
  const fx = useFx();
  const { data, error, reload } = useLoad(() => fapi.handovers(), []);
  const [sheet, setSheet] = useState(null);
  const canGive = fx.can("f_money", "edit") || fx.can("f_home");
  return (
    <div className="fx-stack">
      <div className="fx-note sky">المحاسب بيسلّم المصاري للإدارة (أو العكس)، والمستلم بيوقّع على تلفونه إنه استلم — وبيضل موثّق.</div>
      {canGive && <button className="fx-btn pri block fx-huge" onClick={() => setSheet({ kind: "give" })}>💼 سلّمت مبلغ</button>}
      <Err msg={error} />
      {!data && !error && <Loading />}
      <div className="fx-list">
        {data?.rows.map((h) => (
          <div key={h.id} className="fx-item" style={{ alignItems: "flex-start" }}>
            <span className="fx-avatar">{h.status === "confirmed" ? "✅" : h.status === "rejected" ? "✖️" : "⏳"}</span>
            <span className="t">
              <b>{h.from_name} ← {h.to_name} · {money(h.amount)} د.أ</b>
              <span>{dateTime(h.created_at)}{h.note ? ` · ${h.note}` : ""}</span>
              <span>{h.status === "confirmed" ? `وقّع الاستلام ${dateTime(h.confirmed_at)}` : h.status === "rejected" ? "رفض الاستلام" : "بانتظار توقيع المستلم"}</span>
              {h.signature && <img src={h.signature} alt="التوقيع" style={{ maxWidth: 180, background: "#fff", border: "1px solid #eee", borderRadius: 8, marginTop: 4 }} />}
            </span>
            {h.mine_to_sign && <button className="fx-btn sm ok" onClick={() => setSheet({ kind: "sign", h })}>✍️ وقّع</button>}
          </div>
        ))}
      </div>
      {data?.rows.length === 0 && <div className="fx-muted">ما في تسليمات.</div>}
      {sheet?.kind === "give" && data && <GiveSheet people={data.people} onClose={() => setSheet(null)} onDone={() => { setSheet(null); reload(); }} />}
      {sheet?.kind === "sign" && <SignSheet h={sheet.h} onClose={() => setSheet(null)} onDone={() => { setSheet(null); reload(); }} />}
    </div>
  );
}
function GiveSheet({ people, onClose, onDone }) {
  const fx = useFx();
  const [to, setTo] = useState(people.length === 1 ? people[0].id : null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  return (
    <Sheet title="سلّمت مبلغ" onClose={onClose}>
      <div className="fx-stack">
        <div className="fx-field">لمين؟<div className="fx-chips">{people.map((p) => <button key={p.id} type="button" className={`fx-chip ${to === p.id ? "on" : ""}`} onClick={() => setTo(p.id)}>{p.full_name}</button>)}</div></div>
        <label className="fx-field">المبلغ<input className="fx-input fx-num" style={{ fontSize: 22, textAlign: "center", fontWeight: 800 }} type="number" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        <label className="fx-field">ملاحظة (مثلًا: كاش السواقين لـ٢٥/١٠)<input className="fx-input" value={note} onChange={(e) => setNote(e.target.value)} /></label>
        <Err msg={err} />
        <Act className="fx-btn pri block" disabled={!to || !(Number(amount) > 0)} onClick={async () => {
          setErr("");
          try { await fapi.addHandover({ to_user: to, amount, note }); fx.toast("انبعت — بيوصله إشعار يوقّع"); onDone(); } catch (e) { setErr(e.message); }
        }}>✓ سلّمت</Act>
      </div>
    </Sheet>
  );
}
function SignSheet({ h, onClose, onDone }) {
  const fx = useFx();
  const [sig, setSig] = useState(null);
  const [err, setErr] = useState("");
  return (
    <Sheet title={`استلام ${money(h.amount)} د.أ من ${h.from_name}`} onClose={onClose}>
      <div className="fx-stack">
        {h.note && <div className="fx-note">{h.note}</div>}
        <SignaturePad onChange={setSig} label="توقيعك إنك استلمت" hint="وقّع بإصبعك هون" />
        <Err msg={err} />
        <Act className="fx-btn ok block fx-huge" disabled={!sig} onClick={async () => { setErr(""); try { await fapi.confirmHandover(h.id, sig); fx.toast("انوقّع ✓"); onDone(); } catch (e) { setErr(e.message); } }}>✓ استلمت المبلغ</Act>
        <Act className="fx-btn block" onClick={async () => { if (!confirm("ما استلمت هالمبلغ؟")) return; await fapi.rejectHandover(h.id); onDone(); }}>ما استلمت</Act>
      </div>
    </Sheet>
  );
}

// ---------- الملخّص ----------
function Summary() {
  const fx = useFx();
  const [period, setPeriod] = useState("month");
  const [day, setDay] = useState(today());
  const { data, error } = useLoad(() => fapi.booksSummary({ period, date: day }), [period, day]);
  const Row = ({ l, v, tone }) => <div className="fx-kv"><span>{l}</span><b style={{ color: tone }}>{money(v)}</b></div>;
  function print() {
    const w = window.open("", "_blank");
    if (!w || !data) return;
    const el = document.getElementById("books-summary");
    w.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>ملخّص ${data.from} — ${data.to}</title><style>body{font-family:system-ui,Tahoma,sans-serif;margin:20px}.fx-card{border:1px solid #ccc;border-radius:8px;padding:10px;margin-bottom:10px}.fx-kv{display:flex;justify-content:space-between;padding:3px 0}</style></head><body><h2>${fx.shop?.brand?.name || ""} — ملخّص ${data.from} لـ ${data.to}</h2>${el?.innerHTML || ""}</body></html>`);
    w.document.close();
    setTimeout(() => { try { w.print(); } catch { /* */ } }, 400);
  }
  return (
    <div className="fx-stack">
      <div className="fx-chips">{[["day", "يومي"], ["week", "أسبوعي"], ["month", "شهري"], ["year", "سنوي"]].map(([k, l]) => <button key={k} className={`fx-chip ${period === k ? "on" : ""}`} onClick={() => setPeriod(k)}>{l}</button>)}</div>
      <div className="fx-field">لأي {period === "day" ? "يوم" : period === "week" ? "أسبوع (أي يوم فيه)" : period === "month" ? "شهر (أي يوم فيه)" : "سنة"}؟<DateInput value={day} onChange={setDay} ariaLabel="التاريخ" /></div>
      <Err msg={error} />
      {!data && !error && <Loading />}
      {data && (
        <>
          <div className="fx-row" style={{ justifyContent: "space-between" }}><small className="fx-muted">من {date(data.from)} لـ {date(data.to)}</small><button className="fx-btn sm" onClick={print}><FiPrinter /> اطبع</button></div>
          <div id="books-summary" className="fx-stack">
            <section className="fx-card" style={{ textAlign: "center" }}>
              <small className="fx-muted">الصافي (دخل − صرف)</small>
              <b className="fx-num" style={{ display: "block", fontSize: 28, color: data.totals.net >= 0 ? "var(--fx-ok)" : "var(--fx-crit)" }}>{money(data.totals.net)}</b>
              <small>دخل {money(data.totals.income)} · صرف {money(data.totals.spend)}</small>
            </section>
            <section className="fx-card"><b>المبيعات</b>
              <Row l={`فواتير الزباين (${num(data.sales.count)})`} v={data.sales.invoices} />
              <Row l="فواتير بيع لشركات" v={data.sales.partner_sales} />
              <Row l={`إعادة تدوير (${num(data.sales.recycle_kg)} كغ)`} v={data.sales.recycle} />
            </section>
            <section className="fx-card"><b>اللي انقبض</b>
              <Row l="كاش من الزباين" v={data.collected.cash} tone="var(--fx-ok)" />
              <Row l="كليك" v={data.collected.cliq} tone="var(--fx-ok)" />
              <Row l="شيكات وتحويلات" v={data.collected.other} tone="var(--fx-ok)" />
              <Row l="من الشركات" v={data.collected.partners} tone="var(--fx-ok)" />
              <Row l="دخل ثاني (الصندوق)" v={data.collected.other_income} tone="var(--fx-ok)" />
            </section>
            <section className="fx-card"><b>اللي انصرف</b>
              <Row l="مصاريف السواقين" v={data.spent.driver_expenses} tone="var(--fx-crit)" />
              <Row l="مصاريف الصندوق" v={data.spent.cashbook} tone="var(--fx-crit)" />
              <Row l="دفعنا للموردين" v={data.spent.suppliers} tone="var(--fx-crit)" />
              <Row l="صيانة السيارات" v={data.spent.maintenance} tone="var(--fx-crit)" />
              <Row l="كهربا" v={data.spent.electricity} tone="var(--fx-crit)" />
              <Row l="مي" v={data.spent.water} tone="var(--fx-crit)" />
              <Row l="مولّدات" v={data.spent.generators} tone="var(--fx-crit)" />
              <Row l="مشتريات (فواتير موردين)" v={data.purchases} />
            </section>
            <section className="fx-card"><b>الإنتاج</b>
              <div className="fx-kv"><span>أنتجنا</span><b>{num(data.production.cartons)} كرتونة</b></div>
              <Row l="مواد انسحبت للإنتاج" v={data.production.materials_used} />
              <Row l="تالف الخطوط" v={data.production.waste} tone="var(--fx-crit)" />
            </section>
            <section className="fx-card"><b>الوضع هلأ</b>
              <Row l="قيمة مواد المستودع" v={data.now.store_value} />
              <Row l="ديون الزباين (إلنا)" v={data.now.customer_debts} tone="var(--fx-ok)" />
              <Row l="إلنا عند الشركات" v={data.now.they_owe} tone="var(--fx-ok)" />
              <Row l="علينا للشركات" v={data.now.we_owe} tone="var(--fx-crit)" />
            </section>
          </div>
        </>
      )}
    </div>
  );
}

// ---------- الكهربا والمي والمولّدات ----------
const MK = { elec: { icon: "⚡", label: "عداد كهربا", unit: "كيلوواط" }, trans: { icon: "🔆", label: "محوّل كهربا", unit: "كيلوواط" }, water: { icon: "💧", label: "مي", unit: "متر³" }, gen: { icon: "🔌", label: "مولّد", unit: "ساعة" } };
function Utilities() {
  const fx = useFx();
  const edit = fx.can("f_money", "edit");
  const { data, error, reload } = useLoad(() => fapi.meters(), []);
  const [sheet, setSheet] = useState(null);
  const [open, setOpen] = useState(null);
  return (
    <div className="fx-stack">
      <Err msg={error} />
      {!data && !error && <Loading />}
      {data && (
        <>
          <div className="fx-grid2">
            <div className="fx-card" style={{ textAlign: "center" }}><small className="fx-muted">هالشهر</small><b className="fx-num" style={{ display: "block", fontSize: 22 }}>{money(data.month_total)}</b></div>
            <div className="fx-card" style={{ textAlign: "center" }}><small className="fx-muted">مش مدفوع</small><b className="fx-num" style={{ display: "block", fontSize: 22, color: data.unpaid_total > 0 ? "var(--fx-crit)" : "var(--fx-ok)" }}>{money(data.unpaid_total)}</b></div>
          </div>
          {edit && <button className="fx-btn block" onClick={() => setSheet({ kind: "meter", m: {} })}><FiPlus /> عداد جديد (كهربا، محوّل، مي، مولّد)</button>}
          {data.meters.length === 0 && <Empty title="ما في عدادات" text="ضيف عداد الكهربا برقمه، وعداد المي، والمولّدات." />}
          {data.meters.map((m) => (
            <section key={m.id} className="fx-card fx-stack" style={{ gap: 8, opacity: m.active ? 1 : 0.6 }}>
              <div className="fx-row" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
                <span><b>{MK[m.kind].icon} {m.name}</b><br /><small className="fx-muted">{[m.line_name && `لـ${m.line_name}`, m.number && `رقم ${m.number}`, m.site_name].filter(Boolean).join(" · ") || MK[m.kind].label}</small></span>
                <span style={{ textAlign: "end" }}><small className="fx-muted">هالسنة</small><br /><b className="fx-num">{money(m.year)}</b></span>
              </div>
              <div className="fx-kv"><span>هالشهر</span><b>{money(m.month)}</b></div>
              {m.last_reading != null && <div className="fx-kv"><span>آخر قراءة</span><b className="fx-num">{num(m.last_reading)}</b></div>}
              {m.unpaid > 0 && <div className="fx-kv"><span>مش مدفوع</span><b style={{ color: "var(--fx-crit)" }}>{money(m.unpaid)}</b></div>}
              <div className="fx-row" style={{ gap: 8 }}>
                {edit && m.active && <button className="fx-btn sm pri" onClick={() => setSheet({ kind: "entry", m })}><FiPlus /> {m.kind === "elec" || m.kind === "trans" ? "فاتورة/قراءة" : m.kind === "water" ? "قراءة" : "تعبئة/فاتورة"}</button>}
                {m.entries.length > 0 && <button className="fx-btn sm" onClick={() => setOpen(open === m.id ? null : m.id)}>{open === m.id ? "سكّر" : `السجل (${m.entries.length})`}</button>}
                {edit && <button className="fx-btn sm" onClick={() => setSheet({ kind: "meter", m })}>تعديل</button>}
              </div>
              {open === m.id && (
                <div className="fx-list">
                  {m.entries.map((e) => (
                    <div key={e.id} className="fx-item">
                      <span className="t">
                        <b>{date(e.doc_date)} · {money(e.amount)} د.أ{e.bill_no ? ` · فاتورة ${e.bill_no}` : ""}</b>
                        <span>{[e.reading != null && `قراءة ${num(e.reading)}`, e.consumption != null && `استهلاك ${num(e.consumption)} ${MK[m.kind].unit}`, e.unit_price != null && `× ${e.unit_price}`, e.liters != null && `${num(e.liters)} لتر ديزل`, e.by_name, e.note].filter(Boolean).join(" · ")}</span>
                      </span>
                      {e.photo_url && <a href={e.photo_url} target="_blank" rel="noreferrer"><img className="fx-photo" src={e.photo_url} alt="" /></a>}
                      {e.paid ? <span className="fx-pill ok">مدفوعة</span> : edit && <Act className="fx-btn sm ok" onClick={async () => { await fapi.meterPaid(e.id); reload(); }}>دفعت</Act>}
                    </div>
                  ))}
                </div>
              )}
            </section>
          ))}
        </>
      )}
      {sheet?.kind === "meter" && <MeterSheet m={sheet.m} lines={data?.lines || []} onClose={() => setSheet(null)} onDone={() => { setSheet(null); reload(); }} />}
      {sheet?.kind === "entry" && <MeterEntrySheet m={sheet.m} onClose={() => setSheet(null)} onDone={() => { setSheet(null); reload(); }} />}
    </div>
  );
}
function MeterSheet({ m, lines, onClose, onDone }) {
  const fx = useFx();
  const [f, setF] = useState({ kind: m.kind || "elec", name: m.name || "", number: m.number || "", notes: m.notes || "", active: m.active !== false, line_id: m.line_id || null });
  const [err, setErr] = useState("");
  return (
    <Sheet title={m.id ? `تعديل ${m.name}` : "عداد جديد"} onClose={onClose}>
      <div className="fx-stack">
        {!m.id && <div className="fx-chips">{Object.entries(MK).map(([k, v]) => <button key={k} type="button" className={`fx-chip ${f.kind === k ? "on" : ""}`} onClick={() => setF({ ...f, kind: k })}>{v.icon} {v.label}</button>)}</div>}
        <label className="fx-field">الاسم<input className="fx-input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={f.kind === "elec" ? "مثلًا: كهربا المصنع ١" : f.kind === "trans" ? "مثلًا: محوّل خط القناني" : f.kind === "water" ? "مثلًا: عداد المي على التنك" : "مثلًا: المولّد الكبير"} /></label>
        {lines.length > 0 && (
          <div className="fx-field">{f.kind === "trans" ? "محوّل أي خط؟" : "لأي خط؟ (اختياري)"}<div className="fx-chips">
            <button type="button" className={`fx-chip ${!f.line_id ? "on" : ""}`} onClick={() => setF({ ...f, line_id: null })}>عام</button>
            {lines.map((l) => <button key={l.id} type="button" className={`fx-chip ${f.line_id === l.id ? "on" : ""}`} onClick={() => setF({ ...f, line_id: l.id, name: f.name || (f.kind === "trans" ? `محوّل ${l.name}` : f.name) })}>{l.name}</button>)}
          </div></div>
        )}
        <label className="fx-field">{f.kind === "gen" ? "الرقم/الموديل" : f.kind === "trans" ? "رقم المحوّل/العداد" : "رقم العداد"}<input className="fx-input" dir="ltr" value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} /></label>
        <label className="fx-field">ملاحظات<input className="fx-input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>
        {m.id && <label className="fx-row" style={{ gap: 8 }}><input type="checkbox" checked={!f.active} onChange={(e) => setF({ ...f, active: !e.target.checked })} /> موقّف</label>}
        <Err msg={err} />
        <Act className="fx-btn pri block" onClick={async () => { setErr(""); try { m.id ? await fapi.editMeter(m.id, f) : await fapi.addMeter(f); fx.toast("انحفظ"); onDone(); } catch (e) { setErr(e.message); } }}>حفظ</Act>
      </div>
    </Sheet>
  );
}
function MeterEntrySheet({ m, onClose, onDone }) {
  const fx = useFx();
  const water = m.kind === "water", gen = m.kind === "gen";
  const [f, setF] = useState({ doc_date: today(), reading: "", unit_price: m.last_price != null ? String(m.last_price) : "", amount: "", liters: "", bill_no: "", paid: false, photo_url: "", note: "" });
  const [err, setErr] = useState("");
  const set = (k) => (e) => setF({ ...f, [k]: e?.target ? e.target.value : e });
  const prev = m.last_reading;
  const cons = f.reading !== "" && prev != null ? Math.round((Number(f.reading) - prev) * 100) / 100 : null;
  const auto = cons != null && f.unit_price !== "" ? Math.round(cons * Number(f.unit_price) * 100) / 100 : null;
  return (
    <Sheet title={`${MK[m.kind].icon} ${m.name}`} onClose={onClose}>
      <div className="fx-stack">
        <div className="fx-field">{water ? "تاريخ القراءة" : "تاريخ الفاتورة"}<DateInput value={f.doc_date} onChange={set("doc_date")} ariaLabel="التاريخ" /></div>
        {(water || !gen) && (
          <label className="fx-field">قراءة العداد {water ? "الجديدة" : "(اختياري)"}{prev != null ? <small className="fx-muted"> — القديمة {num(prev)}</small> : null}
            <input className="fx-input fx-num" style={{ fontSize: 20, textAlign: "center", fontWeight: 800 }} type="number" inputMode="decimal" value={f.reading} onChange={set("reading")} />
          </label>
        )}
        {cons != null && <div className="fx-note sky">الاستهلاك: <b>{num(cons)} {MK[m.kind].unit}</b>{cons < 0 ? " — القراءة أقل من القديمة!" : ""}</div>}
        {water && (
          <label className="fx-field">سعر المتر هالمرة (د.أ) <small className="fx-muted">بيتغيّر — اكتبه كل مرة</small>
            <input className="fx-input fx-num" type="number" inputMode="decimal" value={f.unit_price} onChange={set("unit_price")} />
          </label>
        )}
        {gen && <label className="fx-field">ديزل (لتر)<input className="fx-input fx-num" type="number" inputMode="decimal" value={f.liters} onChange={set("liters")} /></label>}
        <label className="fx-field">{water ? "المبلغ" : gen ? "الكلفة" : "قيمة الفاتورة"} (د.أ){auto != null ? <small className="fx-muted"> — محسوب {money(auto)}</small> : null}
          <input className="fx-input fx-num" style={{ fontSize: 20, textAlign: "center", fontWeight: 800 }} type="number" inputMode="decimal" value={f.amount} onChange={set("amount")} placeholder={auto != null ? money(auto) : "0"} />
        </label>
        {!water && <label className="fx-field">رقم الفاتورة<input className="fx-input" dir="ltr" value={f.bill_no} onChange={set("bill_no")} /></label>}
        <label className="fx-row" style={{ gap: 8 }}><input type="checkbox" checked={f.paid} onChange={(e) => setF({ ...f, paid: e.target.checked })} /> مدفوعة</label>
        <PhotoInput label={water ? "صورة العداد (اختياري)" : "صورة الفاتورة (اختياري)"} value={f.photo_url} onChange={set("photo_url")} kind="doc" />
        <label className="fx-field">ملاحظة<input className="fx-input" value={f.note} onChange={set("note")} /></label>
        <Err msg={err} />
        <Act className="fx-btn pri block fx-huge" disabled={f.amount === "" && f.reading === "" && auto == null} onClick={async () => {
          setErr("");
          try { const r = await fapi.meterEntry(m.id, f); fx.toast(`انسجّل — ${money(r.amount)} د.أ`); onDone(); } catch (e) { setErr(e.message); }
        }}>✓ سجّل</Act>
      </div>
    </Sheet>
  );
}
