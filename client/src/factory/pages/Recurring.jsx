import { useState } from "react";
import { FiRepeat, FiPause, FiPlay, FiTrash2, FiEdit2 } from "react-icons/fi";
import { fapi } from "../fapi.js";
import { useFx, useLoad, Sheet, Err, Loading, Act, num, date, today, DateInput } from "../ui.jsx";

// ============================================================
// الطلبات الثابتة: «كل ١٠ أيام بيوصله ٣٠٠ شرنك» — النظام بيسجّل الطلب لحاله قبل موعده بيوم
// ============================================================
const EVERY = [7, 10, 14, 15, 30];
const tomorrow = () => new Date(Date.now() + 86400000).toLocaleDateString("en-CA", { timeZone: "Asia/Amman" });
export const itemsText = (items) => items.map((i) => `${num(i.qty)} ${i.name}`).join("، ");
export const everyText = (n) => (n === 1 ? "كل يوم" : n === 7 ? "كل أسبوع" : n === 14 ? "كل أسبوعين" : n === 30 ? "كل شهر" : `كل ${n} أيام`);

export function RecurringSheet({ customer, rec, onClose, onSaved }) {
  const fx = useFx();
  const [every, setEvery] = useState(rec?.every_days || 10);
  const [custom, setCustom] = useState(rec && !EVERY.includes(rec.every_days));
  const [start, setStart] = useState(rec?.next_date || tomorrow());
  const [err, setErr] = useState("");
  const { data: last } = useLoad(() => fapi.orders({ customer: customer.id }).then((l) => l.find((o) => o.status !== "cancelled") || null), [customer.id]);

  return (
    <Sheet title={`كل كم يوم بيوصّل لـ${customer.name}؟`} onClose={onClose}>
      <div className="fx-stack">
        <div className="fx-chips fx-every">
          {EVERY.map((n) => <button key={n} className={`fx-chip ${!custom && every === n ? "on" : ""}`} onClick={() => { setCustom(false); setEvery(n); }}>{everyText(n)}</button>)}
          <button className={`fx-chip ${custom ? "on" : ""}`} onClick={() => setCustom(true)}>عدد ثاني</button>
        </div>
        {custom && (
          <label className="fx-row" style={{ flexWrap: "nowrap" }}>
            كل <input className="fx-input" style={{ width: 90, textAlign: "center", fontSize: 18, fontWeight: 800 }} type="number" inputMode="numeric" min="1" max="365" value={every} onChange={(e) => setEvery(Math.round(Number(e.target.value)) || "")} /> يوم
          </label>
        )}

        <div className="fx-sf">أول مرة
          <div className="fx-chips">
            <button className={`fx-chip ${start === today() ? "on" : ""}`} onClick={() => setStart(today())}>اليوم</button>
            <button className={`fx-chip ${start === tomorrow() ? "on" : ""}`} onClick={() => setStart(tomorrow())}>بكرا</button>
          </div>
          <DateInput value={start} onChange={setStart} ariaLabel="التاريخ" />
        </div>

        <div className="fx-note sky">
          {rec?.items?.length
            ? <>بيتسجّل لحاله: {itemsText(rec.items)}.</>
            : last
              ? <>بيتسجّل لحاله نفس آخر طلب: <b>{last.items.map((i) => `${num(i.delivered_qty ?? i.qty)} ${i.name}`).join("، ")}</b>. السائق بيعدّل الكمية عند الزبون حسب اللي بياخذه.</>
              : <>ما إله طلب سابق، فبيوصلك <b>تذكير</b> بموعده عشان تتصل فيه.</>}
        </div>
        <Err msg={err} />
        <Act className="fx-btn pri block fx-big" disabled={!(every > 0)} onClick={async () => {
          setErr("");
          try {
            const r = await fapi.saveRecurring({ id: rec?.id, customer_id: customer.id, every_days: every, next_date: start, items: rec?.items || [] });
            fx.toast(r.created_order ? "انحفظ، وانضاف أول طلب لحاله" : r.skipped ? `انحفظ. عنده طلب مفتوح (#${r.skipped.open_order}) — الموعد الجاي ${date(r.skipped.next)}` : `انحفظ: ${everyText(Number(every))}`);
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
      <div className="h"><FiRepeat aria-hidden="true" /><b>موعد ثابت</b>
        {data && data.length === 0 && <button className="fx-btn sm pri" onClick={() => setSheet({})}>كل كم يوم؟</button>}
      </div>
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
        <span>{r.items?.length ? itemsText(r.items) : "بيكرر آخر طلب"}</span>
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
      <div className="fx-chead"><h1>المواعيد الثابتة {data && <span className="n fx-num">{data.filter((r) => r.active).length}</span>}</h1></div>
      <Err msg={error} />
      {!data && !error && <Loading />}
      {data && data.length === 0 && <div className="fx-empty-soft">ما في طلبات ثابتة. افتح أي زبون من «العملاء» واكبس «كل كم يوم؟».</div>}
      <div className="fx-clist">
        {data?.map((r) => (
          <div key={r.id} className="fx-crow"><RecRow r={r} showName onEdit={() => setSheet({ rec: r })} onChanged={reload} /></div>
        ))}
      </div>
      {sheet && <RecurringSheet customer={{ id: sheet.rec.customer_id, name: sheet.rec.customer_name }} rec={sheet.rec} onClose={() => setSheet(null)} onSaved={() => { setSheet(null); reload(); }} />}
    </div>
  );
}
