import { useMemo, useState } from "react";
import { FiPrinter, FiSearch, FiMessageCircle, FiCheckSquare, FiSquare } from "react-icons/fi";
import { fapi } from "../fapi.js";
import RegionFilter, { matchRegion } from "../RegionFilter.jsx";
import { useFx, useLoad, Sheet, Err, Loading, Empty, Act, SendMessages, PhotoInput, money, date, DateInput } from "../ui.jsx";
import { smartFilter } from "../smartSearch.js";

// ============================================================
// الديون: مين عليه وقديش ومن إمتى — بتنطبع، وبتذكّر بلطف برسالة محترمة
// ============================================================
const SORTS = [["big", "الأكبر"], ["old", "الأقدم"], ["name", "بالاسم"]];

export function DebtsView({ page = false }) {
  const fx = useFx();
  const { data, error, reload } = useLoad(() => fapi.debts(), []);
  const [q, setQ] = useState("");
  const [region, setRegion] = useState(null);
  const [sort, setSort] = useState("big");
  const [sel, setSel] = useState(() => new Set());
  const [msgs, setMsgs] = useState(null);
  const [paying, setPaying] = useState(null);
  const [adding, setAdding] = useState(false);
  const canPay = fx.can("f_money", "edit") || fx.can("f_customers", "edit");
  const canRemind = fx.can("f_money", "edit") || fx.can("f_customers", "edit") || fx.can("f_home");

  const list = useMemo(() => {
    const n = q.trim();
    const inRegion = (data?.customers || []).filter((c) => matchRegion(c, region));
    // بحث ذكي (بيتحمّل الأخطاء الإملائية) — وإذا في بحث بنرتّب حسب الأقرب
    if (n) return smartFilter(inRegion, n);
    const xs = inRegion;
    return xs.sort((a, b) => (sort === "old" ? b.days - a.days : sort === "name" ? a.name.localeCompare(b.name, "ar") : b.balance - a.balance));
  }, [data, q, region, sort]);
  const total = list.reduce((a, c) => a + c.balance, 0);
  const withPhone = list.filter((c) => c.phone);
  const toggle = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  async function remind(ids) {
    const r = await fapi.remindDebts(ids);
    if (r.skipped) fx.toast(`${r.skipped} بدون رقم تلفون`);
    setMsgs(r.ids);
    setSel(new Set());
  }

  return (
    <div className="fx-stack fx-debts">
      <Err msg={error} />
      {!data && !error && <Loading />}
      {data && (
        <>
          {/* للطباعة بس */}
          <div className="fx-print-only fx-debts-ph">
            <b>كشف الديون</b>
            <span>{fx.boot.factory?.name || ""} · {date(new Date().toISOString())}{region ? ` · ${[region.gov, region.dist, region.area].filter(Boolean).join(" › ")}` : ""}</span>
          </div>

          <div className="fx-debts-total">
            <div>
              <small>مجموع الديون{region || q ? " (المعروض)" : ""}</small>
              <b>{money(total)} <span>د.أ</span></b>
              <small>{list.length} زبون</small>
            </div>
            <div className="ages">
              {[["0-30", "أقل من شهر"], ["31-60", "شهر–شهرين"], ["61-90", "شهرين–3"], ["90+", "أكثر من 3 شهور"]].map(([k, l]) => (
                <span key={k} className={k === "61-90" || k === "90+" ? "old" : ""}><small>{l}</small><b>{money(data.buckets[k])}</b></span>
              ))}
            </div>
          </div>

          <div className="fx-noprint fx-stack" style={{ gap: 8 }}>
            <label className="fx-search"><FiSearch aria-hidden="true" /><input className="fx-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="دوّر بالاسم، الرقم أو التلفون" /></label>
            <div className="fx-row" style={{ justifyContent: "space-between", gap: 8 }}>
              <RegionFilter items={data.customers} value={region} onChange={setRegion} noun="زبون" />
              <div className="fx-chips" style={{ flexWrap: "nowrap" }}>{SORTS.map(([k, l]) => <button key={k} className={`fx-chip ${sort === k ? "on" : ""}`} onClick={() => setSort(k)}>{l}</button>)}</div>
            </div>
            {canPay && <button className="fx-btn pri block" onClick={() => setAdding(true)}>➕ سجّل دين على زبون</button>}
            <div className="fx-grid2">
              <button className="fx-btn" onClick={() => window.print()}><FiPrinter /> اطبع الكشف</button>
              {canRemind && (sel.size > 0
                ? <Act className="fx-btn ok" onClick={() => remind([...sel])}><FiMessageCircle /> ذكّر المحددين ({sel.size})</Act>
                : <Act className="fx-btn sky" disabled={!withPhone.length} onClick={() => remind(withPhone.map((c) => c.id))}><FiMessageCircle /> ذكّر الكل ({withPhone.length})</Act>)}
            </div>
          </div>

          {list.length === 0 && <Empty title="ما في ديون" text={data.customers.length ? "ما في حدا بهالبحث." : "ولا زبون عليه دين 👏"} />}

          {/* القائمة (وهي نفسها اللي بتنطبع كجدول) */}
          <div className="fx-debts-list">
            {list.map((c) => (
              <div key={c.id} className={`d ${sel.has(c.id) ? "on" : ""}`}>
                {canRemind && (
                  <button className="fx-plain chk fx-noprint" onClick={() => toggle(c.id)} aria-label={`اختار ${c.name}`}>
                    {sel.has(c.id) ? <FiCheckSquare /> : <FiSquare />}
                  </button>
                )}
                <span className="t">
                  <b>{c.seq_no ? <small className="fx-seq">#{c.seq_no}</small> : null}{c.name}</b>
                  <small>{[c.city, c.phone].filter(Boolean).join(" · ")}</small>
                  <small className={c.days > 60 ? "old" : ""}>من {c.days} يوم{c.last_payment_at ? ` · آخر دفعة ${date(c.last_payment_at)}${c.last_payment_by ? ` مع ${c.last_payment_by}` : ""}` : " · ما في دفعات"}{c.over_limit ? " · فوق السقف" : ""}</small>
                  {c.reminded_at && <small className="fx-noprint rem">✓ انذكّر {date(c.reminded_at)}</small>}
                </span>
                <span className="amt">
                  <b className={c.days > 60 || c.over_limit ? "old" : ""}>{money(c.balance)}</b>
                  <span className="fx-row fx-noprint" style={{ gap: 6, flexWrap: "nowrap" }}>
                    {canPay && <button className="fx-btn sm ok" onClick={() => setPaying(c)}>💵 دفع</button>}
                    {canRemind && c.phone && <Act className="fx-btn sm" onClick={() => remind([c.id])}><FiMessageCircle /> ذكّره</Act>}
                  </span>
                </span>
              </div>
            ))}
          </div>
          {list.length > 0 && (
            <div className="fx-print-only fx-debts-pt"><span>المجموع</span><b>{money(total)} د.أ</b></div>
          )}

          {data.cheques.length > 0 && (
            <div className="fx-card fx-noprint">
              <h3 style={{ marginTop: 0 }}>شيكات قريبة</h3>
              {data.cheques.map((c) => <div key={c.id} className="fx-kv"><span>{c.customer_name} · شيك {c.cheque_no} · يصرف {date(c.cheque_date?.slice?.(0, 10) || c.cheque_date)}</span><b>{money(-c.amount)}</b></div>)}
            </div>
          )}
        </>
      )}
      {adding && <AddDebtSheet onClose={() => setAdding(false)} onDone={() => { setAdding(false); reload(); }} />}
      {paying && <PaySheet c={paying} onClose={() => setPaying(null)} onDone={(r) => { setPaying(null); reload(); if (r?.message_id) setMsgs([r.message_id]); }} />}
      {msgs && <SendMessages ids={msgs} title="رسائل تذكير لطيفة — اكبس «ابعت» لكل وحدة" onClose={() => { setMsgs(null); reload(); }} />}
    </div>
  );
}

// الزبون دفع من دينه: كامل أو جزء، كاش أو شيك أو تحويل — وبتطلع رسالة شكر فيها رصيده الجديد
const METHODS = [["cash", "كاش"], ["cliq", "كليك"], ["cheque", "شيك"], ["transfer", "تحويل"]];
export function PaySheet({ c, onClose, onDone, byDriver = false }) {
  const fx = useFx();
  const bal = Number(c.balance) || 0;
  const [full, setFull] = useState(true);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [chq, setChq] = useState("");
  const [chqDate, setChqDate] = useState("");
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState(null);
  const [err, setErr] = useState("");
  const amt = full ? bal : Number(amount) || 0;
  const after = Math.round((bal - amt) * 100) / 100;
  return (
    <Sheet title={`دفعة من ${c.name}`} onClose={onClose}>
      <div className="fx-stack">
        <div className="fx-pay-total"><span>عليه هلأ</span><b>{money(bal)} <small>د.أ</small></b></div>
        <div className="fx-pay-modes">
          <button type="button" className={full ? "on" : ""} onClick={() => setFull(true)}>✓ دفع كامل</button>
          <button type="button" className={!full ? "on" : ""} onClick={() => setFull(false)}>دفع جزء</button>
        </div>
        {!full && (
          <label className="fx-field">قديش دفع؟
            <input className="fx-input fx-num" style={{ fontSize: 22, textAlign: "center", fontWeight: 800 }} type="number" inputMode="decimal" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
          </label>
        )}
        {byDriver
          ? (
            <>
              <div className="fx-pay-modes">
                <button type="button" className={method !== "cliq" ? "on" : ""} onClick={() => setMethod("cash")}>💵 كاش</button>
                <button type="button" className={method === "cliq" ? "on" : ""} onClick={() => setMethod("cliq")}>📲 كليك</button>
              </div>
              {method === "cliq"
                ? <PhotoInput label="صوّر وصل الكليك من تلفون الزبون" hint="لازم — بتوصل للمحاسب" value={photo} onChange={setPhoto} kind="cliq" />
                : <div className="fx-note sky">المبلغ بينضاف على الكاش اللي معك، وبتسلّمه مع حساب رحلتك.</div>}
            </>
          )
          : <div className="fx-chips">{METHODS.map(([k, l]) => <button key={k} type="button" className={`fx-chip ${method === k ? "on" : ""}`} onClick={() => setMethod(k)}>{l}</button>)}</div>}
        {!byDriver && method === "cliq" && <PhotoInput label="صورة وصل الكليك" value={photo} onChange={setPhoto} kind="cliq" />}
        {method === "cheque" && (
          <div className="fx-grid2">
            <label className="fx-field">رقم الشيك<input className="fx-input" value={chq} onChange={(e) => setChq(e.target.value)} /></label>
            <div className="fx-field">تاريخ الصرف<DateInput value={chqDate} onChange={setChqDate} ariaLabel="تاريخ الصرف" /></div>
          </div>
        )}
        <label className="fx-field">ملاحظة (اختياري)<input className="fx-input" value={note} onChange={(e) => setNote(e.target.value)} /></label>
        <div className="fx-pay-sum">
          <span>دفع <b>{money(amt)}</b></span>
          {after > 0.005 ? <span className="debt">بيضل عليه <b>{money(after)}</b></span> : after < -0.005 ? <span className="ok">بيصير إله <b>{money(-after)}</b></span> : <span className="ok">سدّ كل الدين ✓</span>}
        </div>
        <Err msg={err} />
        <Act className="fx-btn ok block fx-huge" disabled={!(amt > 0) || (method === "cheque" && !chq) || (method === "cliq" && !photo)} onClick={async () => {
          setErr("");
          try {
            const r = await fapi.payment(c.id, { amount: amt, method: byDriver && method !== "cliq" ? "cash" : method, photo_url: method === "cliq" ? photo : undefined, cheque_no: chq || undefined, cheque_date: chqDate || undefined, note, by_driver: byDriver || undefined });
            fx.toast(r.balance > 0.009 ? `انسجّلت — بيضل عليه ${money(r.balance)}` : "انسجّلت — سدّ كل الدين ✓");
            onDone(r);
          } catch (e) { setErr(e.message); }
        }}>✓ استلمت {money(amt)} دينار</Act>
      </div>
    </Sheet>
  );
}

export default function Debts() {
  return (
    <div className="fx-page">
      <h1 className="fx-h1 fx-noprint">الديون</h1>
      <DebtsView page />
    </div>
  );
}

// الإدارة بتسجّل دين: على زبون موجود، أو زبون جديد (بدون موقع — السائق بيحفظه بأول زيارة)
function AddDebtSheet({ onClose, onDone }) {
  const fx = useFx();
  const { data: all } = useLoad(() => fapi.customers(), []);
  const [q, setQ] = useState("");
  const [c, setC] = useState(null);
  const [isNew, setIsNew] = useState(false);
  const [nc, setNc] = useState({ name: "", phone: "", city: "" });
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [done, setDone] = useState(null);
  const list = (all || []);
  const found = q.trim() ? smartFilter(list, q).slice(0, 8) : [];
  if (done) {
    return (
      <Sheet title="انسجّل الدين" onClose={onDone}>
        <div className="fx-stack">
          <div className="fx-note ok">صار على {done.name} <b>{money(done.balance)}</b> دينار.</div>
          {done.no_location && <div className="fx-note warn">📍 موقع {done.name} مش محفوظ — أول ما سائق يروح عنده بيطلب منه يحفظ الموقع قبل ما يعمل فاتورة.</div>}
          <button className="fx-btn block" onClick={onDone}>تمام</button>
        </div>
      </Sheet>
    );
  }
  return (
    <Sheet title="سجّل دين على زبون" onClose={onClose}>
      <div className="fx-stack">
        {!c && !isNew && (
          <>
            <label className="fx-search"><FiSearch aria-hidden="true" /><input className="fx-input" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="دوّر على الزبون بالاسم أو التلفون" /></label>
            {!all && <Loading />}
            <div className="fx-list">
              {found.map((x) => (
                <button key={x.id} className="fx-item" onClick={() => setC(x)}>
                  <span className="t"><b>{x.seq_no ? <small className="fx-seq">#{x.seq_no}</small> : null}{x.name}</b><span>{[x.city, x.phone, x.lat == null && "📍 بدون موقع"].filter(Boolean).join(" · ")}</span></span>
                  <b className="fx-num">{money(x.balance)}</b>
                </button>
              ))}
            </div>
            {q.trim() && found.length === 0 && all && <div className="fx-muted">ما لقيته.</div>}
            <button className="fx-btn block" onClick={() => { setIsNew(true); setNc({ ...nc, name: q.trim() }); }}>➕ زبون جديد مش مسجّل</button>
          </>
        )}
        {isNew && (
          <div className="fx-card fx-stack" style={{ gap: 8 }}>
            <b>زبون جديد</b>
            <label className="fx-field">الاسم<input className="fx-input" value={nc.name} onChange={(e) => setNc({ ...nc, name: e.target.value })} /></label>
            <div className="fx-grid2">
              <label className="fx-field">التلفون<input className="fx-input" dir="ltr" inputMode="tel" value={nc.phone} onChange={(e) => setNc({ ...nc, phone: e.target.value })} /></label>
              <label className="fx-field">المنطقة<input className="fx-input" value={nc.city} onChange={(e) => setNc({ ...nc, city: e.target.value })} /></label>
            </div>
            <small className="fx-muted">📍 الموقع بيحفظه السائق لما يروح عنده — ما بيقدر يعمله فاتورة قبل ما يحفظه.</small>
            <button className="fx-link" style={{ justifySelf: "start" }} onClick={() => setIsNew(false)}>رجوع للبحث</button>
          </div>
        )}
        {c && (
          <div className="fx-card">
            <div className="fx-row" style={{ justifyContent: "space-between" }}>
              <b>{c.name}</b><button className="fx-link" onClick={() => setC(null)}>غيّر</button>
            </div>
            <small className="fx-muted">عليه هلأ {money(c.balance)}{c.lat == null ? " · 📍 موقعه مش محفوظ" : ""}</small>
          </div>
        )}
        {(c || isNew) && (
          <>
            <label className="fx-field">مبلغ الدين<input className="fx-input fx-num" style={{ fontSize: 22, textAlign: "center", fontWeight: 800 }} type="number" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
            <label className="fx-field">السبب (اختياري)<input className="fx-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="مثلًا: دين قديم من الدفتر" /></label>
            <Err msg={err} />
            <Act className="fx-btn pri block fx-huge" disabled={!(Number(amount) > 0) || (isNew && !nc.name.trim())} onClick={async () => {
              setErr("");
              try {
                let cust = c;
                if (isNew) cust = await fapi.saveCustomer({ name: nc.name.trim(), phone: nc.phone.trim(), city: nc.city.trim() });
                const r = await fapi.customerDebt(cust.id, { amount, note });
                fx.toast("انسجّل ✓");
                setDone({ name: cust.name, balance: r.balance, no_location: r.no_location });
              } catch (e) { setErr(e.message); }
            }}>✓ سجّل الدين</Act>
          </>
        )}
      </div>
    </Sheet>
  );
}
