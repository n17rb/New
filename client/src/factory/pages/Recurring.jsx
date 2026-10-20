import { useState } from "react";
import { FiRepeat, FiPause, FiPlay, FiTrash2, FiEdit2 } from "react-icons/fi";
import { fapi } from "../fapi.js";
import { useFx, useLoad, Sheet, Err, Loading, Act, num, date, today } from "../ui.jsx";
import { ProductPicker } from "./Orders.jsx";

// ============================================================
// الطلبات الثابتة: «كل ١٠ أيام بيوصله ٣٠٠ شرنك» — النظام بيسجّل الطلب لحاله قبل موعده بيوم
// ============================================================
const EVERY = [7, 10, 14, 15, 30];
const tomorrow = () => new Date(Date.now() + 86400000).toLocaleDateString("en-CA", { timeZone: "Asia/Amman" });
export const itemsText = (items) => items.map((i) => `${num(i.qty)} ${i.name}`).join("، ");
export const everyText = (n) => (n === 1 ? "كل يوم" : n === 7 ? "كل أسبوع" : n === 14 ? "كل أسبوعين" : n === 30 ? "كل شهر" : `كل ${n} أيام`);

export function RecurringSheet({ customer, rec, onClose, onSaved }) {
  const fx = useFx();
  const products = fx.boot.products.filter((p) => p.active);
  const [items, setItems] = useState(() => (rec?.items || []).map((i) => ({ product_id: i.product_id, qty: i.qty })));
  const [every, setEvery] = useState(rec?.every_days || 10);
  const [custom, setCustom] = useState(rec && !EVERY.includes(rec.every_days));
  const [start, setStart] = useState(rec?.next_date || tomorrow());
  const [notes, setNotes] = useState(rec?.notes || "");
  const [err, setErr] = useState("");
  const ok = items.some((i) => Number(i.qty) > 0) && every > 0;

  return (
    <Sheet title={rec ? "تعديل الطلب الثابت" : `طلب ثابت · ${customer.name}`} onClose={onClose}>
      <div className="fx-stack">
        <ProductPicker products={products} items={items} setItems={setItems} customerId={customer.id} noBonus />

        <div className="fx-sf">كل كم يوم؟
          <div className="fx-chips">
            {EVERY.map((n) => <button key={n} className={`fx-chip ${!custom && every === n ? "on" : ""}`} onClick={() => { setCustom(false); setEvery(n); }}>{everyText(n)}</button>)}
            <button className={`fx-chip ${custom ? "on" : ""}`} onClick={() => setCustom(true)}>غيره</button>
          </div>
          {custom && (
            <label className="fx-row" style={{ flexWrap: "nowrap", fontWeight: 400 }}>
              كل <input className="fx-input" style={{ width: 90, textAlign: "center" }} type="number" inputMode="numeric" min="1" max="365" value={every} onChange={(e) => setEvery(Math.round(Number(e.target.value)) || "")} /> يوم
            </label>
          )}
        </div>

        <div className="fx-sf">{rec ? "الموعد الجاي" : "أول مرة"}
          <div className="fx-chips">
            <button className={`fx-chip ${start === today() ? "on" : ""}`} onClick={() => setStart(today())}>اليوم</button>
            <button className={`fx-chip ${start === tomorrow() ? "on" : ""}`} onClick={() => setStart(tomorrow())}>بكرا</button>
            <input className="fx-input" style={{ width: "auto" }} type="date" value={start} onChange={(e) => setStart(e.target.value)} aria-label="التاريخ" />
          </div>
        </div>
        <label className="fx-sf">ملاحظة <span className="opt">(اختياري)</span><input className="fx-input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="مثلًا: بيحب ينزل الصبح" /></label>

        <div className="fx-note sky">
          النظام بيسجّل الطلب لحاله قبل موعده بيوم، {everyText(Number(every) || 0)}. إذا الزبون مربوط بخط وفي رحلة لسيارة الخط بيومه، بينحط عليها لحاله ومرتب من الأقرب.
        </div>
        <Err msg={err} />
        <Act className="fx-btn pri block fx-big" disabled={!ok} onClick={async () => {
          setErr("");
          try {
            const r = await fapi.saveRecurring({ id: rec?.id, customer_id: customer.id, every_days: every, next_date: start, notes, items: items.filter((i) => Number(i.qty) > 0) });
            fx.toast(r.created_order ? "انحفظ، وانضاف أول طلب لحاله" : r.skipped ? `انحفظ. عنده طلب مفتوح (#${r.skipped.open_order}) فما كررناه — الموعد الجاي ${date(r.skipped.next)}` : "انحفظ الطلب الثابت");
            onSaved();
          } catch (e) { setErr(e.message); }
        }}>احفظ</Act>
      </div>
    </Sheet>
  );
}

// بطاقة صغيرة بصفحة الزبون
export function RecurringCard({ customer }) {
  const { data, reload } = useLoad(() => fapi.recurring({ customer: customer.id }), [customer.id]);
  const [sheet, setSheet] = useState(null);
  return (
    <div className="fx-rec">
      <div className="h"><FiRepeat aria-hidden="true" /><b>طلب ثابت</b>
        <button className="fx-link" onClick={() => setSheet({})}>+ ضيف</button>
      </div>
      {data && data.length === 0 && <small className="fx-muted">إذا بياخذ نفس الطلب كل كم يوم، ضيفه هون وبينضاف لحاله.</small>}
      {data?.map((r) => <RecRow key={r.id} r={r} onEdit={() => setSheet({ rec: r })} onChanged={reload} />)}
      {sheet && <RecurringSheet customer={customer} rec={sheet.rec} onClose={() => setSheet(null)} onSaved={() => { setSheet(null); reload(); }} />}
    </div>
  );
}

function RecRow({ r, onEdit, onChanged, showName }) {
  const fx = useFx();
  return (
    <div className={`fx-rec-row ${r.active ? "" : "off"}`}>
      <span className="t">
        {showName && <b>{r.customer_name}</b>}
        <span>{itemsText(r.items)}</span>
        <small>{everyText(r.every_days)} · {r.active ? `الجاي ${date(r.next_date)}` : "موقّف"}</small>
      </span>
      <button className="fx-icon-btn sm" onClick={onEdit} aria-label="عدّل"><FiEdit2 /></button>
      <Act className="fx-icon-btn sm" onClick={async () => { await fapi.saveRecurring({ id: r.id, active: !r.active }); fx.toast(r.active ? "توقّف" : "رجع يشتغل"); onChanged(); }} aria-label={r.active ? "وقّف" : "شغّل"}>{r.active ? <FiPause /> : <FiPlay />}</Act>
      <Act className="fx-icon-btn sm" onClick={async () => { await fapi.deleteRecurring(r.id); fx.toast("انحذف"); onChanged(); }} aria-label="احذف"><FiTrash2 /></Act>
    </div>
  );
}

// كل الطلبات الثابتة (من «المزيد»)
export default function Recurring() {
  const { data, error, reload } = useLoad(() => fapi.recurring(), []);
  const [sheet, setSheet] = useState(null);
  return (
    <div className="fx-page">
      <div className="fx-chead"><h1>الطلبات الثابتة {data && <span className="n fx-num">{data.filter((r) => r.active).length}</span>}</h1></div>
      <Err msg={error} />
      {!data && !error && <Loading />}
      {data && data.length === 0 && <div className="fx-empty-soft">ما في طلبات ثابتة. افتح أي زبون من «العملاء» واكبس «طلب ثابت ← ضيف».</div>}
      <div className="fx-clist">
        {data?.map((r) => (
          <div key={r.id} className="fx-crow"><RecRow r={r} showName onEdit={() => setSheet({ rec: r })} onChanged={reload} /></div>
        ))}
      </div>
      {sheet && <RecurringSheet customer={{ id: sheet.rec.customer_id, name: sheet.rec.customer_name }} rec={sheet.rec} onClose={() => setSheet(null)} onSaved={() => { setSheet(null); reload(); }} />}
    </div>
  );
}
