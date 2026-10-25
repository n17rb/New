import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { FiAlertTriangle, FiClipboard, FiPlus, FiPower, FiTruck } from "react-icons/fi";
import { fapi } from "../fapi.js";
import { TakeSheet } from "./Store.jsx";
import { useFx, useLoad, Sheet, Tip, Err, Loading, Empty, Act, PhotoInput, Reload, ProductArt, num, time, dateTime, date } from "../ui.jsx";

export default function Stock() {
  const fx = useFx();
  const [params, setParams] = useSearchParams();
  const canStock = fx.can("f_stock");
  const canProd = fx.can("f_production");
  const canMach = fx.can("f_machines");
  const boss = fx.can("f_home");
  const tabs = [
    canStock || canProd || boss ? ["stock", "اليوم"] : null,
    canStock || boss ? ["load", "تحميل السيارات"] : null,
    canProd || canMach || boss ? ["prod", "المكنات"] : null,
    canStock || canProd || boss ? ["log", "السجل"] : null,
  ].filter(Boolean);
  const tab = tabs.find((t) => t[0] === params.get("tab"))?.[0] || tabs[0][0];
  return (
    <div className="fx-page">
      <h1 className="fx-h1">{canStock || boss ? "المستودع" : canProd ? "الإنتاج" : "المكنات والأعطال"}</h1>
      <div className="fx-tabs">
        {tabs.map(([k, l]) => <button key={k} className={tab === k ? "on" : ""} onClick={() => setParams({ tab: k })}>{l}</button>)}
      </div>
      {tab === "stock" && <Overview />}
      {tab === "load" && <Loading_ />}
      {tab === "prod" && <Production />}
      {tab === "log" && <Log />}
    </div>
  );
}

// ---------- اليوم: أنتجنا، طلع مع السواقين، رجع، وضل بالمستودع ----------
function Overview() {
  const fx = useFx();
  const editStock = fx.can("f_stock", "edit");
  const editProd = fx.can("f_production", "edit");
  const { data, error, reload } = useLoad(() => fapi.stock(), []);
  const [sheet, setSheet] = useState(null);
  const [pick, setPick] = useState(null);
  const products = data?.products || [];
  const shown = pick ? products.filter((p) => p.id === pick) : products;
  const sum = (f) => shown.reduce((s, p) => s + f(p), 0);
  const T = {
    prod: sum((p) => p.today.production),
    load: sum((p) => p.today.load),
    ret: sum((p) => p.today.return),
    dmg: sum((p) => p.today.damage_wh || 0),
    adj: sum((p) => p.today.adjust || 0),
    bal: sum((p) => p.balance),
  };
  const opening = T.bal - T.prod + T.load - T.ret + T.dmg - T.adj;
  const pickedName = pick ? products.find((p) => p.id === pick)?.name : "";
  const done = () => { setSheet(null); reload(); };
  return (
    <>
      <Err msg={error} />
      {!data && !error && <Loading />}
      {data && products.length === 0 && <Empty title="ما في منتجات" text="ضيف المنتجات من الإعدادات." />}
      {data && products.length > 0 && (
        <>
          <section className="fx-flow" aria-label="حركة المستودع اليوم">
            <div className="fx-flow-h">
              <b>{pick ? pickedName : "كل المنتجات"} · اليوم</b>
              {pick ? <button className="fx-link" onClick={() => setPick(null)}>الكل</button> : <Reload onClick={reload} />}
            </div>
            {opening !== 0 && <FlowRow label="كان بالمستودع الصبح" value={opening} tone="muted" plain />}
            <FlowRow label="أنتجنا" value={T.prod} sign="+" tone="ok" />
            <FlowRow label="طلع مع السواقين" value={T.load} sign="−" tone="sky" />
            {T.ret > 0 && <FlowRow label="رجع من السواقين" value={T.ret} sign="+" tone="ok" />}
            {T.dmg > 0 && <FlowRow label="تالف بالمستودع" value={T.dmg} sign="−" tone="crit" />}
            {T.adj !== 0 && <FlowRow label="جرد وتعديل" value={Math.abs(T.adj)} sign={T.adj > 0 ? "+" : "−"} tone="warn" />}
            <div className="fx-flow-total">
              <span>ضل بالمستودع</span>
              <b className="fx-num">{num(T.bal)}</b>
              <small>كرتونة</small>
            </div>
          </section>

          {(editProd || editStock || fx.can("f_home")) && <SalvageCard canFix={editProd} onFixed={reload} />}

          {(editProd || editStock) && (
            <div className="fx-actions3">
              {editProd && <button className="fx-bigbtn pri" data-hl="prod-btn" onClick={() => setSheet("prod")}><FiPlus /><span>سجّل إنتاج</span></button>}
              {(editStock || editProd) && <button className="fx-bigbtn" data-hl="damage-btn" onClick={() => setSheet("damage")}><FiAlertTriangle /><span>تالف</span></button>}
              {editStock && <button className="fx-bigbtn" onClick={() => setSheet("count")}><FiClipboard /><span>جرد</span></button>}
            </div>
          )}

          <div className="fx-sec"><h2>الرصيد لكل منتج</h2><span className="fx-muted" style={{ fontSize: 12 }}>اكبس على منتج لتشوف حركته</span></div>
          <div className="fx-tiles">
            {products.map((p) => {
              const low = p.min_stock > 0 && p.balance <= p.min_stock;
              const short = p.demand > p.balance;
              return (
                <button key={p.id} className={`fx-tile ${pick === p.id ? "on" : ""} ${low || short ? "bad" : ""}`} onClick={() => setPick(pick === p.id ? null : p.id)}>
                  <ProductArt p={fx.boot.products.find((x) => x.id === p.id) || p} size={40} />
                  <span className="n">{p.name}</span>
                  <b className="fx-num">{num(p.balance)}</b>
                  <small>
                    {p.today.production ? <span className="up">+{num(p.today.production)}</span> : null}
                    {p.today.load ? <span className="down">−{num(p.today.load)}</span> : null}
                    {!p.today.production && !p.today.load ? "ما في حركة اليوم" : null}
                  </small>
                  {short ? <em>الطلبات {num(p.demand)} — ناقص {num(p.demand - p.balance)}</em> : low ? <em>تحت الحد ({num(p.min_stock)})</em> : null}
                </button>
              );
            })}
          </div>

          <div className="fx-sec"><h2>مع السواقين اليوم</h2></div>
          <div className="fx-list">
            {data.today_by_vehicle.length === 0 && <div className="fx-item"><span className="fx-muted">ما طلع إشي اليوم لسا.</span></div>}
            {data.today_by_vehicle.map((v) => (
              <div key={v.id} className="fx-item">
                <span className="fx-avatar"><FiTruck /></span>
                <span className="t"><b>{v.driver_name || "بدون سائق"}</b><span>{v.vehicle_name}{v.returned ? ` · رجّع ${num(v.returned)}` : ""}</span></span>
                <span className="end"><b className="fx-num" style={{ color: "var(--fx-navy)" }}>{num(v.loaded)}</b><span className="fx-muted" style={{ fontSize: 11.5 }}>كرتونة</span></span>
              </div>
            ))}
          </div>
          <Tip id="stock2">الحساب لحاله: اللي أنتجته − اللي طلع مع السواقين + اللي رجع = اللي ضل بالمستودع. التحميل بينخصم لما المستودع يأكّد تحميل السيارة.</Tip>
          {fx.can("f_stock", "edit") && fx.canAction("adjust_stock") && <button className="fx-link" onClick={() => setSheet("adjust")}>تعديل رصيد يدوي</button>}
        </>
      )}
      {sheet === "prod" && <ProdSheet onClose={() => setSheet(null)} onDone={done} />}
      {sheet === "damage" && <DamageSheet onClose={() => setSheet(null)} onDone={done} />}
      {sheet === "count" && data && <CountSheet products={data.products} onClose={() => setSheet(null)} onDone={done} />}
      {sheet === "adjust" && <AdjustSheet onClose={() => setSheet(null)} onDone={done} />}
    </>
  );
}

function FlowRow({ label, value, sign = "", tone, plain }) {
  return (
    <div className={`fx-flow-row ${tone}`}>
      <span className="dot" aria-hidden="true">{plain ? "" : sign}</span>
      <span className="l">{label}</span>
      <b className="fx-num">{sign && !plain ? `${sign} ` : ""}{num(value)}</b>
    </div>
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
            {t.load_confirmed_at && (
              <div className="fx-row" style={{ justifyContent: "space-between", gap: 8 }}>
                <small className={t.driver_ack_note ? "" : "fx-muted"} style={t.driver_ack_note ? { color: "var(--fx-crit)", fontWeight: 700 } : undefined}>
                  {t.driver_ack_at ? (t.driver_ack_note ? `⚠️ السائق: ${t.driver_ack_note}` : "✅ السائق وقّع إنه استلم العدد") : "⏳ بانتظار توقيع السائق"}
                </small>
                <button className="fx-btn sm" onClick={() => printLoad(fx, t)}>🖨️ ورقة التحميل</button>
              </div>
            )}
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

// ورقة التحميل زي الفاتورة: شو طلع على السيارة، مين حمّل، وتوقيع السائق
function printLoad(fx, t) {
  const esc = (x) => String(x ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const rows = (t.loaded?.length ? t.loaded : t.items).map((i, n) => `<tr><td>${n + 1}</td><td style="text-align:start">${esc(i.name)}</td><td>${i.qty}</td></tr>`).join("");
  const total = (t.loaded?.length ? t.loaded : t.items).reduce((a, i) => a + i.qty, 0);
  const b = fx.shop?.brand || {};
  const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>تحميل ${esc(t.vehicle_name)}</title>
<style>body{font-family:system-ui,Tahoma,sans-serif;margin:24px}h1{margin:0;font-size:20px}.top{display:flex;justify-content:space-between;border-bottom:3px solid #0456a2;padding-bottom:8px;margin-bottom:14px}
table{width:100%;border-collapse:collapse}th,td{border:1px solid #999;padding:7px;text-align:center}th{background:#eef5fb}.sig{display:flex;gap:30px;margin-top:30px}.sig div{flex:1;text-align:center;border-top:1px solid #333;padding-top:6px;font-size:13px}
.sig img{max-height:90px;display:block;margin:0 auto 4px}@media print{button{display:none}}</style></head><body>
<div class="top"><div><h1>ورقة تحميل — ${esc(t.vehicle_name)}</h1><div>${esc(b.name || "")}</div></div><div style="text-align:end">السائق: <b>${esc(t.driver_name || "")}</b><br>${esc(t.trip_date || "")}</div></div>
<table><thead><tr><th>#</th><th>الصنف</th><th>الكمية (كرتونة)</th></tr></thead><tbody>${rows}<tr><td colspan="2"><b>المجموع</b></td><td><b>${total}</b></td></tr></tbody></table>
${t.driver_ack_note ? `<p style="color:#b00"><b>ملاحظة السائق:</b> ${esc(t.driver_ack_note)}</p>` : ""}
<div class="sig"><div>${esc(t.load_confirmed_by_name || "أمين المستودع")}<br>حمّل</div><div>${t.driver_ack_sig ? `<img src="${t.driver_ack_sig}" alt="">` : "<br><br>"}${esc(t.driver_name || "السائق")} — استلم</div></div>
<button onclick="print()" style="margin-top:20px;padding:10px 18px">🖨️ اطبع / PDF</button></body></html>`;
  const w = window.open("", "_blank");
  if (!w) return fx.toast("اسمح بفتح النوافذ عشان تطبع");
  w.document.write(html);
  w.document.close();
  setTimeout(() => { try { w.print(); } catch { /* */ } }, 400);
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
  const expected = t.returns_expected || [];
  const exch = t.exchanged || [];
  const [vals, setVals] = useState({});
  const [good, setGood] = useState({});
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
  const [got, setGot] = useState({});
  const gotOf = (e) => (got[e.product_id] === undefined || got[e.product_id] === "" ? e.qty : Math.max(0, Number(got[e.product_id]) || 0));
  const goodOf = (e) => Math.max(0, Math.min(gotOf(e), Number(good[e.product_id] ?? 0) || 0));
  return (
    <Sheet title={`مرتجع ${t.vehicle_name}`} onClose={onClose}>
      <div className="fx-stack">
        <b>📦 بضاعة سليمة رجعت</b>
        {expected.length === 0 && <div className="fx-note ok">كل الحمولة انباعت — ما في مرتجع متوقع.</div>}
        {expected.map((e) => (
          <label key={e.product_id} className="fx-row" style={{ flexWrap: "nowrap" }}>
            <span className="fx-grow">{e.name} <span className="fx-muted">(المفروض {num(e.qty)})</span></span>
            <input className="fx-input" style={{ width: 110 }} type="number" inputMode="numeric" value={vals[e.product_id] ?? e.qty} onChange={(ev) => setVals({ ...vals, [e.product_id]: ev.target.value })} />
          </label>
        ))}
        {exch.length > 0 && (
          <div className="fx-card fx-stack" style={{ gap: 8, background: "var(--fx-warn-soft, #fff7e6)" }}>
            <b>🔁 تالف من الزباين — افرزه</b>
            <small className="fx-muted">السائق جاب هالتالف (بدّله للزباين). عدّه، واكتب كم منه بينفع يتصلّح أو ينعاد تغليفه — بيروح للإنتاج، والباقي بينشطب.</small>
            {exch.map((e) => (
              <div key={e.product_id} className="fx-stack" style={{ gap: 4 }}>
                <div className="fx-row" style={{ flexWrap: "nowrap", gap: 6 }}>
                  <span className="fx-grow">{e.name} <span className="fx-muted">(المفروض {num(e.qty)})</span></span>
                  <label className="fx-row" style={{ gap: 6, flexWrap: "nowrap" }}><small>وصلني</small>
                    <input className="fx-input" style={{ width: 76 }} type="number" inputMode="numeric" min="0" value={got[e.product_id] ?? e.qty} onChange={(ev) => setGot({ ...got, [e.product_id]: ev.target.value })} />
                  </label>
                  <label className="fx-row" style={{ gap: 6, flexWrap: "nowrap" }}><small>صالح</small>
                    <input className="fx-input" style={{ width: 90 }} type="number" inputMode="numeric" min="0" max={e.qty} value={good[e.product_id] ?? ""} placeholder="0" onChange={(ev) => setGood({ ...good, [e.product_id]: ev.target.value })} />
                  </label>
                </div>
                <small className="fx-muted">✓ {num(goodOf(e))} للإنتاج · ✗ {num(gotOf(e) - goodOf(e))} تالف نهائي{gotOf(e) < e.qty ? ` · ⚠️ ناقص ${num(e.qty - gotOf(e))}` : ""}</small>
              </div>
            ))}
          </div>
        )}
        <Act className="fx-btn pri block" onClick={async () => {
          const r = await fapi.receiveReturns(
            t.id,
            expected.map((e) => ({ product_id: e.product_id, qty: Number(vals[e.product_id] ?? e.qty) })),
            exch.map((e) => ({ product_id: e.product_id, received: gotOf(e), good: goodOf(e), bad: gotOf(e) - goodOf(e) }))
          );
          const g = exch.reduce((a, e) => a + goodOf(e), 0);
          fx.toast(g ? `انستلم المرتجع — و${g} كرتونة صالحة راحت للإنتاج` : "انستلم المرتجع ورجع للمستودع");
          setShort(r.short || []);
        }}>استلمت المرتجع</Act>
      </div>
    </Sheet>
  );
}

// ---------- التالف الصالح اللي فرزه أمين التحميل: الإنتاج بيصلّحه وبيرجع للمستودع ----------
function SalvageCard({ canFix, onFixed }) {
  const fx = useFx();
  const { data, reload } = useLoad(() => fapi.salvage(), []);
  const [sheet, setSheet] = useState(null);
  const [qty, setQty] = useState("");
  const open = (data || []).filter((s) => s.status === "pending" || s.status === "received");
  if (!open.length) return null;
  return (
    <section className="fx-card fx-stack" style={{ gap: 8, borderInlineStart: "4px solid var(--fx-warn)" }}>
      <b>📥 تالف صالح للتصليح</b>
      <small className="fx-muted">أمين المستودع فرزه من تالف الزباين. ١) أكّد إنك استلمت العدد ٢) صلّحه أو أعد تغليفه واكبس «صلّحته» — بيرجع لرصيد المستودع.</small>
      {open.map((s) => (
        <div key={s.id} className="fx-row" style={{ flexWrap: "nowrap", gap: 8 }}>
          <span className="fx-grow">
            <b>{num(s.status === "received" ? s.received_qty ?? s.good : s.good)} {s.name}</b><br />
            <small className="fx-muted">{s.status === "received" ? `استلمها ${s.received_by_name || ""} — بانتظار التصليح` : [s.vehicle_name, s.sorted_by_name && `من ${s.sorted_by_name}`, date(s.sorted_at)].filter(Boolean).join(" · ")}</small>
          </span>
          {canFix && s.status === "pending" && <button className="fx-btn sm" onClick={() => { setSheet({ kind: "recv", s }); setQty(String(s.good)); }}>✓ استلمت</button>}
          {canFix && s.status === "received" && <button className="fx-btn sm ok" onClick={() => { setSheet({ kind: "fix", s }); setQty(String(s.received_qty ?? s.good)); }}>♻️ صلّحته</button>}
        </div>
      ))}
      {sheet && (
        <Sheet title={sheet.kind === "recv" ? `استلام ${sheet.s.name}` : `تصليح ${sheet.s.name}`} onClose={() => setSheet(null)}>
          <div className="fx-stack">
            <label className="fx-field">{sheet.kind === "recv" ? `كم كرتونة استلمت فعليًا؟ (سلّمك ${num(sheet.s.good)})` : `كم كرتونة صارت جاهزة؟ (من ${num(sheet.s.received_qty ?? sheet.s.good)})`}
              <input className="fx-input fx-num" style={{ fontSize: 22, textAlign: "center", fontWeight: 800 }} type="number" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} />
            </label>
            <small className="fx-muted">{sheet.kind === "recv" ? "إذا العدد أقل، بيوصل تنبيه لأمين المستودع والإدارة." : "اللي ما زبط بينشطب كتالف، والجاهز بينضاف للإنتاج لحاله."}</small>
            <Act className="fx-btn ok block fx-huge" onClick={async () => {
              if (sheet.kind === "recv") { await fapi.salvageReceive(sheet.s.id, qty); fx.toast("انسجّل الاستلام ✓"); }
              else { const r = await fapi.fixSalvage(sheet.s.id, qty); fx.toast(`رجع ${r.qty} كرتونة للمستودع ✓`); onFixed?.(); }
              setSheet(null); reload();
            }}>{sheet.kind === "recv" ? "✓ استلمت" : "✓ رجّعها للمستودع"}</Act>
          </div>
        </Sheet>
      )}
    </section>
  );
}

// ---------- الإنتاج والمواد الخام والأعطال ----------
function Production() {
  const fx = useFx();
  const edit = fx.can("f_production", "edit") || fx.can("f_machines", "edit");
  const { data, error, reload } = useLoad(() => Promise.all([fapi.stock(), fapi.downtime()]), []);
  const [sheet, setSheet] = useState(null);
  const [stock, downs] = data || [];
  return (
    <>
      <Tip id="prod2">إذا وقفت ماكنة اكبس «ماكنة وقفت»، ولما ترجع سجّل كم خرب.</Tip>
      {edit && <button className="fx-btn danger block" onClick={() => setSheet({ kind: "down" })}><FiPower /> ماكنة وقفت</button>}
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
                  <div className="fx-row" style={{ gap: 6 }}>
                    {edit && <button className="fx-btn sm" onClick={() => setSheet({ kind: "up", d })}>رجعت تشتغل</button>}
                    {(fx.can("f_machines", "edit") || fx.can("f_store", "edit")) && <button className="fx-btn sm" onClick={() => setSheet({ kind: "part", d })}>🔩 سحب قطعة</button>}
                  </div>
                </div>
              ))}
            </div>
          )}
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
      {sheet?.kind === "down" && <DownSheet onClose={() => setSheet(null)} onDone={() => { setSheet(null); reload(); }} />}
      {sheet?.kind === "part" && <PartTake d={sheet.d} onClose={() => setSheet(null)} onDone={() => { setSheet(null); reload(); }} />}
      {sheet?.kind === "up" && <UpSheet d={sheet.d} onClose={() => setSheet(null)} onDone={() => { setSheet(null); reload(); }} />}
    </>
  );
}

// قطعة غيار للعطل: بتنسحب من المستودع وكلفتها بتنضاف على العطل
function PartTake({ d, onClose, onDone }) {
  const { data } = useLoad(() => fapi.store(), []);
  if (!data) return <Sheet title="سحب قطعة" onClose={onClose}><Loading /></Sheet>;
  return <TakeSheet data={data} kind="part" machineId={d.machine_id} downtimeId={d.id} onClose={onClose} onDone={onDone} />;
}

function ProdSheet({ onClose, onDone }) {
  const fx = useFx();
  const list = fx.boot.products.filter((p) => p.active);
  const [product, setProduct] = useState(list[0]?.id || "");
  const [qty, setQty] = useState("");
  const [shift, setShift] = useState(() => { const h = new Date().getHours(); return h < 14 ? "صبحي" : h < 22 ? "مسائي" : "ليلي"; });
  const [machine, setMachine] = useState("");
  const n = Number(qty) || 0;
  const name = list.find((p) => p.id === product)?.name || "";
  return (
    <Sheet title="سجّل إنتاج" onClose={onClose}>
      <div className="fx-stack">
        <div className="fx-field">شو أنتجتوا؟</div>
        <div className="fx-pick-grid">
          {list.map((p) => (
            <button key={p.id} className={`fx-pick ${product === p.id ? "on" : ""}`} onClick={() => setProduct(p.id)}>
              <ProductArt p={p} size={44} /><span>{p.name}</span>
            </button>
          ))}
        </div>
        <label className="fx-field">كم كرتونة؟
          <input className="fx-input fx-qty-big" type="number" inputMode="numeric" placeholder="0" value={qty} onChange={(e) => setQty(e.target.value)} />
        </label>
        <div className="fx-chips">{[100, 500, 1000].map((q) => <button key={q} className="fx-chip" onClick={() => setQty(String(n + q))}>+{num(q)}</button>)}{n > 0 && <button className="fx-chip" onClick={() => setQty("")}>صفّر</button>}</div>
        <div className="fx-chips">{["صبحي", "مسائي", "ليلي"].map((s) => <button key={s} className={`fx-chip ${shift === s ? "on" : ""}`} onClick={() => setShift(s)}>وردية {s}</button>)}</div>
        {fx.boot.machines.length > 0 && <select value={machine} onChange={(e) => setMachine(e.target.value)} aria-label="الماكنة"><option value="">الماكنة (اختياري)</option>{fx.boot.machines.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>}
        <Act className="fx-btn pri block" disabled={!(n > 0) || !product} onClick={async () => { await fapi.production({ product_id: product, qty: n, shift, machine_id: machine || null }); fx.toast(`انضاف ${num(n)} ${name} للمستودع`); onDone(); }}>
          {n > 0 ? `ضيف ${num(n)} كرتونة ${name} للمستودع` : "اكتب العدد"}
        </Act>
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

