import { useEffect, useRef, useState } from "react";
import { FiPlus, FiSearch, FiMapPin, FiMessageCircle, FiPhone, FiLink, FiEdit2, FiCamera, FiX, FiCheck, FiShoppingCart, FiUser, FiHome, FiNavigation, FiChevronDown, FiSettings, FiSave, FiImage } from "react-icons/fi";
import { fapi } from "../fapi.js";
import { OrderSheet } from "./Orders.jsx";
import { useFx, Sheet, Tip, Err, Loading, Empty, Act, StatusPill, ORDER_STATUS, SendMessages, LocationPicker, waLink, money, num, date, dateTime } from "../ui.jsx";

const KIND = { invoice: "فاتورة", payment: "دفعة", return: "مرتجع", adjust: "تعديل", opening: "رصيد افتتاحي" };

export default function Customers() {
  const fx = useFx();
  const [q, setQ] = useState("");
  const [line, setLine] = useState("");
  const [list, setList] = useState(null);
  const [error, setError] = useState("");
  const [sheet, setSheet] = useState(null);
  const canAdd = fx.can("f_customers", "edit") || fx.can("f_orders", "edit") || fx.can("f_drive", "edit");
  const canOrder = fx.can("f_orders", "edit") || fx.can("f_dispatch", "edit");
  const [msgs, setMsgs] = useState(null);

  const load = () => fapi.customers({ q, line }).then(setList).catch((e) => setError(e.message));
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [q, line]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="fx-page">
      <div className="fx-row" style={{ justifyContent: "space-between" }}>
        <span style={{ display: "grid" }}>
          <h1 className="fx-h1" style={{ margin: 0 }}>العملاء</h1>
          {list && <span className="fx-muted">إجمالي العملاء: <b className="fx-num" style={{ color: "var(--fx-ink)" }}>{num(list.length)}</b></span>}
        </span>
      </div>
      {canAdd && <button className="fx-btn pri block fx-big" data-hl="new-customer" onClick={() => setSheet({ kind: "edit", c: null })}><FiPlus /> زبون جديد</button>}
      <Tip id="customers2">اكبس «طلب جديد» جنب الزبون عشان تسجّله طلب. واكبس على اسمه تشوف حسابه وموقعه.</Tip>
      <div className="fx-row" style={{ flexWrap: "nowrap" }}>
        <FiSearch style={{ color: "var(--fx-muted)" }} />
        <input className="fx-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="اسم، رقم، تلفون، أو مدينة" />
      </div>
      {fx.boot.lines.length > 0 && (
        <div className="fx-hscroll">
          <button className={`fx-chip ${!line ? "on" : ""}`} onClick={() => setLine("")}>الكل</button>
          {fx.boot.lines.map((l) => <button key={l.id} className={`fx-chip ${line === l.id ? "on" : ""}`} onClick={() => setLine(l.id)}>{l.name}</button>)}
        </div>
      )}
      <Err msg={error} />
      {!list && !error && <Loading />}
      {list && list.length === 0 && <Empty title="ما في زباين" text={q ? "جرّب اسم ثاني." : "ضيف أول زبون من زر «زبون جديد»."} />}
      {list && list.length > 0 && (
        <div className="fx-list">
          {list.map((c) => (
            <div key={c.id} className="fx-item fx-cust-row">
              <button className="fx-plain fx-cust-main" onClick={() => setSheet({ kind: "view", id: c.id })}>
                {c.photo_url ? <img className="fx-avatar fx-avatar-img" src={c.photo_url} alt="" loading="lazy" /> : <span className="fx-avatar">{c.name.trim().charAt(0)}</span>}
                <span className="t">
                  <b style={{ fontSize: 16 }}>{c.name}</b>
                  <span className="fx-num" dir="ltr" style={{ textAlign: "right" }}>{[c.seq_no ? `#${c.seq_no}` : null, c.phone].filter(Boolean).join(" · ")}</span>
                  <span>{[c.city, c.address].filter(Boolean).join(" · ") || "بدون عنوان"}{c.open_orders ? ` · ${c.open_orders} طلب مفتوح` : ""}</span>
                  {c.balance !== undefined && c.balance > 0 && <span style={{ color: c.credit_limit && c.balance > c.credit_limit ? "var(--fx-crit)" : "var(--fx-muted)", fontSize: 12.5 }}>عليه {money(c.balance)} د.أ</span>}
                </span>
              </button>
              {canOrder && <button className="fx-order-btn" onClick={() => setSheet({ kind: "order", c })} aria-label={`طلب جديد لـ${c.name}`}><FiShoppingCart /><span>طلب جديد</span></button>}
            </div>
          ))}
        </div>
      )}
      {sheet?.kind === "edit" && <CustomerEdit c={sheet.c} onClose={() => setSheet(null)} onSaved={() => { setSheet(null); load(); }} />}
      {sheet?.kind === "view" && <CustomerView id={sheet.id} onClose={() => setSheet(null)} onEdit={(c) => setSheet({ kind: "edit", c })} onChanged={load} onOrder={canOrder ? (c) => setSheet({ kind: "order", c, back: c.id }) : null} />}
      {sheet?.kind === "order" && (
        <OrderSheet customer={sheet.c} onClose={() => setSheet(sheet.back ? { kind: "view", id: sheet.back } : null)}
          onSaved={(r) => { setSheet(sheet.back ? { kind: "view", id: sheet.back } : null); load(); if (r?.message_ids?.[0]) setMsgs(r.message_ids); }} />
      )}
      {msgs && <SendMessages ids={msgs} title="ابعت للزبون إنه وصلنا طلبه" onClose={() => setMsgs(null)} />}
    </div>
  );
}

function CustomerEdit({ c, onClose, onSaved }) {
  const fx = useFx();
  const canMoney = fx.can("f_money", "edit");
  const canPrices = fx.can("f_customers", "edit");
  const [f, setF] = useState(() => ({
    name: c?.name || "", contact_name: c?.contact_name || "", phone: c?.phone || "", city: c?.city || "", address: c?.address || "",
    line_id: c?.line_id || "", lat: c?.lat ?? "", lng: c?.lng ?? "", kind: c?.kind || "", pay_terms: c?.pay_terms || "cash",
    credit_limit: c?.credit_limit || "", notes: c?.notes || "", opening_balance: "",
    seq_no: c?.seq_no ?? "", photo_url: c?.photo_url || "", maps_url: c?.maps_url || "",
  }));
  const seqTouched = useRef(false);

  // الرقم الجاي بيتعبّى لحاله
  useEffect(() => {
    if (c) return;
    fapi.nextCustomerSeq().then((r) => { if (!seqTouched.current) setF((x) => ({ ...x, seq_no: r.next })); }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [prices, setPrices] = useState(() => Object.fromEntries((c?.prices || []).map((p) => [p.product_id, p.price])));
  const [err, setErr] = useState("");
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const save = async () => {
    setErr("");
    try {
      await fapi.saveCustomer({ ...f, id: c?.id, prices: Object.entries(prices).map(([product_id, price]) => ({ product_id: Number(product_id), price })) });
      fx.toast("انحفظ الزبون");
      onSaved();
    } catch (e) { setErr(e.message); }
  };

  return (
    <Sheet title={c ? `تعديل ${c.name}` : "إضافة زبون جديد"} onClose={onClose}>
      <div className="fx-stack fx-form">
        <FormSection n={1} icon={FiUser} title="المعلومات الأساسية" sub="اسم الزبون وتلفونه ووين محله">
          <IconField icon={FiHome}><input className="fx-input" value={f.name} onChange={set("name")} placeholder="اسم المحل" aria-label="اسم المحل" /></IconField>
          <div className="fx-grid2">
            <IconField icon={FiPhone}><input className="fx-input" inputMode="tel" value={f.phone} onChange={set("phone")} placeholder="رقم التلفون" aria-label="رقم التلفون" /></IconField>
            <IconField icon={FiMapPin} end={<FiChevronDown aria-hidden="true" />}>
              <input className="fx-input" list="fx-cities" value={f.city} onChange={set("city")} placeholder="المدينة" aria-label="المدينة" />
              <datalist id="fx-cities">{fx.boot.cities.map((x) => <option key={x} value={x} />)}</datalist>
            </IconField>
          </div>
          <IconField icon={FiNavigation}><input className="fx-input" value={f.address} onChange={set("address")} placeholder="العنوان (الشارع، العمارة، جنب...)" aria-label="العنوان" /></IconField>
          <div className="fx-seqline">
            <span>رقم الزبون</span>
            <input className="fx-input fx-num" dir="ltr" inputMode="numeric" value={f.seq_no} placeholder="تلقائي" aria-label="رقم الزبون"
              onChange={(e) => { seqTouched.current = true; setF({ ...f, seq_no: e.target.value.replace(/[^\d]/g, "") }); }} />
          </div>
        </FormSection>

        <FormSection n={2} icon={FiMapPin} title="الموقع الجغرافي" sub="إذا إنت عند الزبون اكبس الزر، أو الصق رابط موقعه">
          <LocationPicker bare hereLabel="تحديد موقع الزبون" hl="customer-location"
            lat={f.lat} lng={f.lng} onChange={(p) => { setF((x) => ({ ...x, ...p })); if (p.lat !== "") fx.toast("انحفظ موقع الزبون"); }} />
        </FormSection>

        <FormSection n={3} icon={FiCamera} title="صورة المحل (اختيارية)" sub="صورة العمارة أو المحل عشان السائق يعرفه">
          <BuildingPhoto value={f.photo_url} onChange={(u) => setF((x) => ({ ...x, photo_url: u }))} />
        </FormSection>

        <details className="fx-sec-card fx-sec-more" open={!!c && (c.pay_terms === "credit" || (c.prices || []).length > 0)}>
          <summary className="fx-sec-head">
            <span className="fx-sec-ic"><FiSettings /></span>
            <span className="fx-sec-t"><b><span className="fx-sec-n">4</span>الإعدادات الإضافية</b><small>الدين، الأسعار الخاصة، الملاحظات (اختيارية)</small></span>
            <FiChevronDown className="fx-sec-chev" aria-hidden="true" />
          </summary>
          <div className="fx-stack" style={{ marginTop: 12 }}>
            <div className="fx-grid2">
              <label className="fx-field">اسم صاحبه<input className="fx-input" value={f.contact_name} onChange={set("contact_name")} /></label>
              <label className="fx-field">الخط
                <select value={f.line_id} onChange={set("line_id")}>
                  <option value="">بدون</option>
                  {fx.boot.lines.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </label>
            </div>
            <div className="fx-field">طريقة الدفع
              <div className="fx-chips">
                <button className={`fx-chip ${f.pay_terms === "cash" ? "on" : ""}`} onClick={() => setF({ ...f, pay_terms: "cash" })}>كاش</button>
                <button className={`fx-chip ${f.pay_terms === "credit" ? "on" : ""}`} onClick={() => setF({ ...f, pay_terms: "credit" })}>دين (ذمم)</button>
              </div>
            </div>
            {f.pay_terms === "credit" && <label className="fx-field">سقف الدين (دينار)<input className="fx-input" type="number" inputMode="decimal" value={f.credit_limit} onChange={set("credit_limit")} /></label>}
            {!c && canMoney && <label className="fx-field">رصيد قديم عليه (اختياري)<input className="fx-input" type="number" inputMode="decimal" value={f.opening_balance} onChange={set("opening_balance")} /></label>}
            {canPrices && fx.boot.products.length > 0 && (
              <div className="fx-field">أسعار خاصة لهالزبون (فاضي = السعر العادي)
                <div className="fx-stack" style={{ marginTop: 8 }}>
                  {fx.boot.products.filter((p) => p.active).map((p) => (
                    <label key={p.id} className="fx-row" style={{ flexWrap: "nowrap" }}>
                      <span className="fx-grow">{p.name} <span className="fx-muted">(العادي {money(p.price)})</span></span>
                      <input className="fx-input" style={{ width: 110 }} type="number" inputMode="decimal" value={prices[p.id] ?? ""} onChange={(e) => setPrices({ ...prices, [p.id]: e.target.value })} placeholder="—" />
                    </label>
                  ))}
                </div>
              </div>
            )}
            <label className="fx-field">ملاحظات<input className="fx-input" value={f.notes} onChange={set("notes")} /></label>
          </div>
        </details>

        <Err msg={err} />
        <div className="fx-savebar">
          <Act className="fx-btn pri block fx-big" disabled={!f.name.trim()} onClick={save}><FiSave /> حفظ الزبون</Act>
        </div>
      </div>
    </Sheet>
  );
}

// قسم بالنموذج: رقم، عنوان، شرح قصير، وأيقونة
function FormSection({ n, icon: Icon, title, sub, children }) {
  return (
    <section className="fx-sec-card">
      <div className="fx-sec-head">
        <span className="fx-sec-ic"><Icon /></span>
        <span className="fx-sec-t"><b><span className="fx-sec-n">{n}</span>{title}</b>{sub && <small>{sub}</small>}</span>
      </div>
      <div className="fx-stack" style={{ marginTop: 12 }}>{children}</div>
    </section>
  );
}

function IconField({ icon: Icon, end, children }) {
  return (
    <div className="fx-iconfield">
      <Icon aria-hidden="true" />
      {children}
      {end && <span className="end">{end}</span>}
    </div>
  );
}

// صورة العمارة أو المحل: بتصوّر من الكاميرا، أو بتختار من المعرض
function BuildingPhoto({ value, onChange }) {
  const fx = useFx();
  const cam = useRef(null);
  const gal = useRef(null);
  const [busy, setBusy] = useState(false);
  async function pick(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    try { onChange((await fapi.upload(file, "building")).url); } catch (err) { fx.toast(err.message); } finally { setBusy(false); }
  }
  return (
    <div className="fx-stack" style={{ gap: 8 }}>
      {value ? (
        <div className="fx-building-wrap">
          <img className="fx-building" src={value} alt="صورة المحل" />
          <button type="button" className="fx-icon-btn sm" aria-label="امسح الصورة" onClick={() => onChange("")}><FiX /></button>
        </div>
      ) : (
        <button type="button" className="fx-drop" disabled={busy} onClick={() => cam.current?.click()}>
          <FiImage aria-hidden="true" />
          <b>{busy ? "عم بنرفع الصورة..." : "اضغط لتصوير المحل"}</b>
        </button>
      )}
      <button type="button" className="fx-link" disabled={busy} onClick={() => gal.current?.click()} style={{ justifySelf: "center" }}>{value ? "غيّر الصورة من المعرض" : "أو اختار من المعرض"}</button>
      {value && <button type="button" className="fx-link" disabled={busy} onClick={() => cam.current?.click()} style={{ justifySelf: "center" }}>صوّر من جديد</button>}
      <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={pick} />
      <input ref={gal} type="file" accept="image/*" hidden onChange={pick} />
    </div>
  );
}

function CustomerView({ id, onClose, onEdit, onChanged, onOrder }) {
  const fx = useFx();
  const [c, setC] = useState(null);
  const [err, setErr] = useState("");
  const [pay, setPay] = useState(false);
  const [msgs, setMsgs] = useState(null);
  const [custom, setCustom] = useState("");
  const load = () => fapi.customer(id).then(setC).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const canPay = fx.can("f_money", "edit") || fx.can("f_customers", "edit");

  if (msgs) return <SendMessages ids={msgs} onClose={() => setMsgs(null)} />;
  if (pay && c) return <PaymentSheet c={c} onClose={() => setPay(false)} onSaved={(r) => { setPay(false); load(); onChanged(); fx.toast("انسجلت الدفعة"); if (r?.message_ids) setMsgs(r.message_ids); }} />;
  return (
    <Sheet title={c?.name || "الزبون"} onClose={onClose}>
      <Err msg={err} />
      {!c && !err && <Loading />}
      {c && (
        <div className="fx-stack">
          {c.photo_url && <a href={c.photo_url} target="_blank" rel="noreferrer"><img className="fx-building" src={c.photo_url} alt={`صورة محل ${c.name}`} /></a>}
          <div className="fx-row" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
            <span style={{ display: "grid" }}>
              <b style={{ fontSize: 18 }}>{c.seq_no ? <span className="fx-seq">#{c.seq_no}</span> : null}{c.name}</b>
              <span className="fx-muted">{[c.city, c.address].filter(Boolean).join(" · ") || "بدون عنوان"}{c.line_name ? ` · ${c.line_name}` : ""}</span>
            </span>
            {fx.can("f_customers", "edit") && <button className="fx-btn sm" onClick={() => onEdit(c)}><FiEdit2 /> عدّل</button>}
          </div>
          {onOrder && <button className="fx-btn pri block fx-big" onClick={() => onOrder(c)}><FiShoppingCart /> طلب جديد لهالزبون</button>}
          <div className="fx-quick">
            {c.phone ? <a href={`tel:${c.phone}`}><FiPhone /><span>اتصل</span></a> : <span className="off"><FiPhone /><span>بدون رقم</span></span>}
            {c.phone ? <a href={waLink(c.phone, "")} target="_blank" rel="noreferrer" className="wa"><FiMessageCircle /><span>واتساب</span></a> : <span className="off"><FiMessageCircle /><span>واتساب</span></span>}
            {(c.lat || c.maps_url) ? <a href={c.lat ? `https://www.google.com/maps?q=${c.lat},${c.lng}` : c.maps_url} target="_blank" rel="noreferrer" className="sky"><FiMapPin /><span>الموقع</span></a> : <span className="off"><FiMapPin /><span>بدون موقع</span></span>}
            {canPay && <button onClick={() => setPay(true)}><FiCheck /><span>دفعة</span></button>}
          </div>
          <div className="fx-card">
            <div className="fx-kv"><span>الرصيد عليه</span><b style={{ color: c.balance > 0 ? "var(--fx-crit)" : "var(--fx-ok)", fontSize: 18 }}>{money(c.balance)} د.أ</b></div>
            {c.pay_terms === "credit" && <div className="fx-kv"><span>سقف الدين</span><b>{money(c.credit_limit)}</b></div>}
            {c.phone && <div className="fx-kv"><span>التلفون</span><b dir="ltr">{c.phone}</b></div>}
          </div>

          <div className="fx-sec"><h2>آخر الطلبات</h2></div>
          <div className="fx-list">
            {c.orders.length === 0 && <div className="fx-item"><span className="fx-muted">ما في طلبات لسا.</span></div>}
            {c.orders.slice(0, 8).map((o) => (
              <div key={o.id} className="fx-item">
                <span className="t"><b>#{o.id} · {o.items}</b><span>{date(o.created_at)}{o.delivered_total != null ? ` · ${money(o.delivered_total)}` : ""}</span></span>
                <StatusPill map={ORDER_STATUS} value={o.status} />
              </div>
            ))}
          </div>

          <div className="fx-sec"><h2>كشف الحساب</h2></div>
          <div className="fx-table">
            <table>
              <thead><tr><th>التاريخ</th><th>البيان</th><th>المبلغ</th><th>الرصيد</th></tr></thead>
              <tbody>
                {c.ledger.map((g) => (
                  <tr key={g.id}>
                    <td>{dateTime(g.created_at)}</td>
                    <td>{KIND[g.kind]}{g.method === "cheque" ? ` (شيك ${g.cheque_no || ""})` : ""}{g.note ? ` · ${g.note}` : ""}</td>
                    <td style={{ color: g.amount < 0 ? "var(--fx-ok)" : "inherit" }}>{money(g.amount)}</td>
                    <td>{money(g.balance_after)}</td>
                  </tr>
                ))}
                {c.ledger.length === 0 && <tr><td colSpan={4} className="fx-muted">ما في حركات.</td></tr>}
              </tbody>
            </table>
          </div>
          <details className="fx-more">
            <summary>رسائل للزبون</summary>
            <div className="fx-stack" style={{ marginTop: 10 }}>
          {c.phone && (
            <Act className="fx-btn wa block" onClick={async () => {
              const r = await fapi.trackLink(c.id);
              window.open(waLink(c.phone, r.text), "_blank");
            }}><FiLink /> ابعتله رابط متابعة طلباته وكشف حسابه</Act>
          )}
          <div className="fx-row" style={{ flexWrap: "nowrap" }}>
            <input className="fx-input" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="رسالة خاصة من الإدارة..." />
            <Act className="fx-btn wa" disabled={!custom.trim()} onClick={async () => { const r = await fapi.sendMessage({ body: custom, customer_ids: [c.id] }); setCustom(""); setMsgs(r.ids); }}><FiMessageCircle /></Act>
          </div>

            </div>
          </details>
        </div>
      )}
    </Sheet>
  );
}

function PaymentSheet({ c, onClose, onSaved }) {
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [chequeNo, setChequeNo] = useState("");
  const [chequeDate, setChequeDate] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  return (
    <Sheet title={`دفعة من ${c.name}`} onClose={onClose}>
      <div className="fx-stack">
        <p className="fx-muted" style={{ margin: 0 }}>عليه هلأ {money(c.balance)} د.أ</p>
        <label className="fx-field">المبلغ (دينار)<input className="fx-input" type="number" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        <div className="fx-chips">
          {[["cash", "كاش"], ["cheque", "شيك"], ["transfer", "تحويل / كليك"]].map(([k, l]) => <button key={k} className={`fx-chip ${method === k ? "on" : ""}`} onClick={() => setMethod(k)}>{l}</button>)}
        </div>
        {method === "cheque" && (
          <div className="fx-grid2">
            <label className="fx-field">رقم الشيك<input className="fx-input" value={chequeNo} onChange={(e) => setChequeNo(e.target.value)} /></label>
            <label className="fx-field">تاريخ الصرف<input className="fx-input" type="date" value={chequeDate} onChange={(e) => setChequeDate(e.target.value)} /></label>
          </div>
        )}
        <label className="fx-field">ملاحظة<input className="fx-input" value={note} onChange={(e) => setNote(e.target.value)} /></label>
        <Err msg={err} />
        <Act className="fx-btn pri block" disabled={!(Number(amount) > 0)} onClick={async () => {
          setErr("");
          try {
            await fapi.payment(c.id, { amount, method, cheque_no: chequeNo, cheque_date: chequeDate, note });
            const m = await fapi.messages({ customer: c.id });
            onSaved({ message_ids: m.filter((x) => x.kind === "payment" && !x.sent_at).slice(0, 1).map((x) => x.id) });
          } catch (e) { setErr(e.message); }
        }}>سجّل الدفعة {Number(amount) > 0 ? `(${num(amount)})` : ""}</Act>
      </div>
    </Sheet>
  );
}
