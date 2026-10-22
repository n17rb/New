import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FiPlus, FiSearch, FiMapPin, FiMessageCircle, FiPhone, FiLink, FiEdit2, FiCamera, FiX, FiCheck, FiShoppingCart, FiImage, FiMap } from "react-icons/fi";
import { fapi } from "../fapi.js";
import { OrderSheet } from "./Orders.jsx";
import { RecurringCard } from "./Recurring.jsx";
import RegionFilter, { matchRegion } from "../RegionFilter.jsx";
import { GOVERNORATES, inferRegion } from "../regions.js";
import { useFx, Sheet, Tip, Err, Loading, Empty, Act, StatusPill, ORDER_STATUS, SendMessages, getLocation, waLink, money, num, date, dateTime, DateInput } from "../ui.jsx";

const KIND = { invoice: "فاتورة", payment: "دفعة", return: "مرتجع", adjust: "تعديل", opening: "رصيد افتتاحي" };

export default function Customers() {
  const fx = useFx();
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [line, setLine] = useState("");
  const [list, setList] = useState(null);
  const [error, setError] = useState("");
  const [sheet, setSheet] = useState(null);
  const canAdd = fx.can("f_customers", "edit") || fx.can("f_orders", "edit") || fx.can("f_drive", "edit");
  const canOrder = fx.can("f_orders", "edit") || fx.can("f_dispatch", "edit");
  const [msgs, setMsgs] = useState(null);
  const [region, setRegion] = useState(null);
  const shown = (list || []).filter((c) => matchRegion(c, region));

  const load = () => fapi.customers({ q, line }).then(setList).catch((e) => setError(e.message));
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [q, line]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="fx-page">
      <div className="fx-chead">
        <h1>العملاء {list && <span className="n fx-num">{num(shown.length)}</span>}</h1>
        <span className="fx-row" style={{ gap: 8, flexWrap: "nowrap" }}>
        <button className="fx-icon-btn" onClick={() => nav("/f/density")} aria-label="خريطة العملاء"><FiMap /></button>
        {canAdd && <button className="fx-cadd" data-hl="new-customer" onClick={() => setSheet({ kind: "edit", c: null })}><FiPlus /> زبون</button>}
        </span>
      </div>
      <div className="fx-csearch">
        <FiSearch aria-hidden="true" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="دوّر باسم، رقم، أو تلفون" aria-label="بحث" />
      </div>
      {list && list.length > 0 && <RegionFilter items={list} value={region} onChange={setRegion} noun="زبون" />}
      <Err msg={error} />
      {!list && !error && <Loading />}
      {list && list.length === 0 && <Empty title="ما في زباين" text={q ? "جرّب اسم ثاني." : "ضيف أول زبون من زر «زبون جديد»."} />}
      {list && list.length > 0 && (
        <div className="fx-clist">
          {shown.map((c) => (
            <div key={c.id} className="fx-crow">
              <button className="fx-plain fx-crow-main" onClick={() => setSheet({ kind: "view", id: c.id })}>
                {c.photo_url ? <img className="fx-cav img" src={c.photo_url} alt="" loading="lazy" /> : <span className="fx-cav">{c.name.trim().charAt(0)}</span>}
                <span className="t">
                  <b>{c.name}</b>
                  <small>{[c.seq_no ? `#${c.seq_no}` : null, c.city || c.address].filter(Boolean).join(" · ") || "—"}</small>
                  {(c.open_orders > 0 || (c.balance !== undefined && c.balance > 0)) && (
                    <span className="tags">
                      {c.open_orders > 0 && <i className="o">{c.open_orders} طلب مفتوح</i>}
                      {c.balance !== undefined && c.balance > 0 && <i className={c.credit_limit && c.balance > c.credit_limit ? "d bad" : "d"}>عليه {money(c.balance)}</i>}
                    </span>
                  )}
                </span>
              </button>
              {canOrder && <button className="fx-corder" onClick={() => setSheet({ kind: "order", c })} aria-label={`طلب جديد لـ${c.name}`}><FiShoppingCart /><span>طلب</span></button>}
            </div>
          ))}
        </div>
      )}
      {sheet?.kind === "edit" && <CustomerEdit c={sheet.c} onClose={() => setSheet(null)} onSaved={() => { setSheet(null); load(); }} />}
      {sheet?.kind === "view" && <CustomerView id={sheet.id} onClose={() => setSheet(null)} onEdit={(c) => setSheet({ kind: "edit", c })} onChanged={load} onOrder={canOrder ? (c) => setSheet({ kind: "order", c, back: c.id }) : null} />}
      {sheet?.kind === "order" && (
        <OrderSheet customer={sheet.c} onClose={() => setSheet(sheet.back ? { kind: "view", id: sheet.back } : null)}
          onSaved={(r) => { setSheet(null); load(); if (r?.message_ids?.[0]) setMsgs(r.message_ids); }} />
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
    governorate: c?.governorate || "", district: c?.district || "", region_manual: false,
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
    <Sheet title={c ? `تعديل ${c.name}` : "زبون جديد"} onClose={onClose}>
      <div className="fx-stack fx-simple">
        <div className="fx-name-seq">
          <label className="fx-sf">اسم الزبون / المحل
            <input className="fx-input" value={f.name} onChange={set("name")} placeholder="مثلًا: بقالة الأمل" />
          </label>
          <label className="fx-sf">الرقم
            <input className="fx-input fx-num" dir="ltr" inputMode="numeric" value={f.seq_no} placeholder="تلقائي"
              onChange={(e) => { seqTouched.current = true; setF({ ...f, seq_no: e.target.value.replace(/[^\d]/g, "") }); }} />
          </label>
        </div>
        <label className="fx-sf">رقم التلفون
          <input className="fx-input" inputMode="tel" dir="ltr" value={f.phone} onChange={set("phone")} placeholder="07XXXXXXXX" />
        </label>

        <div className="fx-sf">الموقع
          <SimpleLocation f={f} setF={setF} />
        </div>
        <AutoRegion f={f} setF={setF} />

        <div className="fx-sf"><span>صورة المحل <span className="opt">(اختياري)</span></span>
          <BuildingPhoto value={f.photo_url} onChange={(u) => setF((x) => ({ ...x, photo_url: u }))} />
        </div>

        <details className="fx-sf-more" open={!!c && (c.pay_terms === "credit" || (c.prices || []).length > 0)}>
          <summary>تفاصيل زيادة <span className="opt">(العنوان، صاحب المحل، الدين، الأسعار...)</span></summary>
          <div className="fx-stack" style={{ marginTop: 12 }}>
            <label className="fx-sf">العنوان بالتفصيل<input className="fx-input" value={f.address} onChange={set("address")} placeholder="الشارع، العمارة، جنب..." /></label>
            <label className="fx-sf">اسم صاحبه<input className="fx-input" value={f.contact_name} onChange={set("contact_name")} /></label>
            {fx.boot.lines.length > 0 && (
              <label className="fx-sf">الخط
                <select value={f.line_id} onChange={set("line_id")}>
                  <option value="">بدون</option>
                  {fx.boot.lines.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </label>
            )}
            <div className="fx-sf">طريقة الدفع
              <div className="fx-chips">
                <button className={`fx-chip ${f.pay_terms === "cash" ? "on" : ""}`} onClick={() => setF({ ...f, pay_terms: "cash" })}>كاش</button>
                <button className={`fx-chip ${f.pay_terms === "credit" ? "on" : ""}`} onClick={() => setF({ ...f, pay_terms: "credit" })}>دين (ذمم)</button>
              </div>
            </div>
            {f.pay_terms === "credit" && <label className="fx-sf">سقف الدين (دينار)<input className="fx-input" type="number" inputMode="decimal" value={f.credit_limit} onChange={set("credit_limit")} /></label>}
            {!c && canMoney && <label className="fx-sf">رصيد قديم عليه<input className="fx-input" type="number" inputMode="decimal" value={f.opening_balance} onChange={set("opening_balance")} /></label>}
            {canPrices && fx.boot.products.length > 0 && (
              <div className="fx-sf"><span>أسعار خاصة <span className="opt">(فاضي = السعر العادي)</span></span>
                <div className="fx-stack" style={{ marginTop: 6 }}>
                  {fx.boot.products.filter((p) => p.active).map((p) => (
                    <label key={p.id} className="fx-row" style={{ flexWrap: "nowrap", fontWeight: 400 }}>
                      <span className="fx-grow">{p.name} <span className="fx-muted">({money(p.price)})</span></span>
                      <input className="fx-input" style={{ width: 100 }} type="number" inputMode="decimal" value={prices[p.id] ?? ""} onChange={(e) => setPrices({ ...prices, [p.id]: e.target.value })} placeholder="—" />
                    </label>
                  ))}
                </div>
              </div>
            )}
            <label className="fx-sf">ملاحظات<input className="fx-input" value={f.notes} onChange={set("notes")} /></label>
          </div>
        </details>

        <Err msg={err} />
        <Act className="fx-btn pri block fx-big" disabled={!f.name.trim()} onClick={save}>احفظ الزبون</Act>
      </div>
    </Sheet>
  );
}

// المنطقة واللواء والمحافظة: بيطلعوا لحالهم من الموقع — بدون ما تكتب إشي
function AutoRegion({ f, setF }) {
  const fx = useFx();
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState(false);
  const key = f.lat !== "" && f.lat != null ? `${Number(f.lat).toFixed(5)},${Number(f.lng).toFixed(5)}` : "";
  const last = useRef(key && f.governorate ? key : "");
  useEffect(() => {
    if (!key || key === last.current || f.region_manual) return;
    last.current = key;
    setBusy(true);
    fapi.customerRegion(f.lat, f.lng)
      .then((r) => setF((x) => ({ ...x, governorate: r.governorate || x.governorate, district: r.district || x.district, city: r.city || x.city })))
      .catch(() => {})
      .finally(() => setBusy(false));
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const has = f.governorate || f.city;
  if (!edit && key) {
    return (
      <div className="fx-auto-region">
        <span className="ic">📍</span>
        <span className="t">
          {busy ? <span className="fx-muted">بنعرف المنطقة من الموقع…</span> : has ? (
            <><b>{f.city || f.district}</b><small>{[f.district && `لواء ${f.district.replace(/^قصبة /, "")}`, f.governorate && `محافظة ${f.governorate}`].filter(Boolean).join(" · ")}</small></>
          ) : <span className="fx-muted">ما عرفنا المنطقة</span>}
        </span>
        <button type="button" className="fx-link" onClick={() => setEdit(true)}>تعديل</button>
      </div>
    );
  }
  if (!edit && !key) {
    return <button type="button" className="fx-link" style={{ justifySelf: "start" }} onClick={() => setEdit(true)}>ما في موقع؟ اكتب المنطقة</button>;
  }
  return (
    <div className="fx-sf">المنطقة
      <input className="fx-input" list="fx-cities" value={f.city} placeholder="مثلًا: الشجرة"
        onChange={(e) => { const city = e.target.value; const r = inferRegion(city); setF((x) => ({ ...x, city, ...(r.governorate && !x.region_manual ? { governorate: r.governorate, district: r.district } : {}) })); }} />
      <datalist id="fx-cities">{fx.boot.cities.map((x) => <option key={x} value={x} />)}</datalist>
      <RegionPick f={f} setF={setF} />
    </div>
  );
}

// المحافظة واللواء: بيتعبّوا لحالهم من اسم المنطقة، وبتقدر تغيّرهم
function RegionPick({ f, setF }) {
  const dists = GOVERNORATES[f.governorate] || null;
  const govOf = (d) => Object.keys(GOVERNORATES).find((g) => GOVERNORATES[g].includes(d)) || "";
  return (
    <div className="fx-grid2">
      <select value={f.governorate} onChange={(e) => setF((x) => ({ ...x, governorate: e.target.value, district: (GOVERNORATES[e.target.value] || [])[0] || "", region_manual: true }))} aria-label="المحافظة">
        <option value="">المحافظة</option>
        {Object.keys(GOVERNORATES).map((g) => <option key={g} value={g}>{g}</option>)}
      </select>
      {/* اللواء دايمًا ظاهر: إذا اخترته قبل المحافظة، المحافظة بتتعبّى لحالها */}
      <select value={f.district} onChange={(e) => setF((x) => ({ ...x, district: e.target.value, governorate: x.governorate && GOVERNORATES[x.governorate]?.includes(e.target.value) ? x.governorate : govOf(e.target.value), region_manual: true }))} aria-label="اللواء">
        <option value="">اللواء</option>
        {dists
          ? dists.map((d) => <option key={d} value={d}>لواء {d.replace(/^قصبة /, "")}</option>)
          : Object.entries(GOVERNORATES).map(([g, ds]) => (
              <optgroup key={g} label={g}>{ds.map((d) => <option key={d} value={d}>لواء {d.replace(/^قصبة /, "")}</option>)}</optgroup>
            ))}
      </select>
    </div>
  );
}

// الموقع بكبستين: «أنا عنده هلأ» أو «الصق رابط» (خانة الرابط بتطلع بس لما تحتاجها)
function SimpleLocation({ f, setF }) {
  const fx = useFx();
  const [busy, setBusy] = useState("");
  const [linkOpen, setLinkOpen] = useState(false);
  const [link, setLink] = useState("");
  const has = f.lat !== "" && f.lat != null;
  async function here() {
    setBusy("gps");
    const loc = await getLocation(12000, 0);
    setBusy("");
    if (!loc) return fx.toast("ما قدرنا نجيب الموقع — شغّل الموقع (GPS) بالتلفون.");
    setF((x) => ({ ...x, lat: loc.lat, lng: loc.lng, maps_url: `https://www.google.com/maps?q=${loc.lat},${loc.lng}` }));
  }
  async function fromLink(raw) {
    const url = String(raw || "").trim().match(/https?:\/\/\S+/)?.[0];
    if (!url) return fx.toast("الصق رابط الموقع (بيبلّش بـ https://)");
    setBusy("link");
    try {
      const p = await fapi.resolveMapLink(url);
      setF((x) => ({ ...x, lat: p.lat, lng: p.lng, maps_url: url }));
      setLink(""); setLinkOpen(false);
    } catch (e) { fx.toast(e.message); } finally { setBusy(""); }
  }
  if (has) {
    return (
      <div className="fx-loc-ok">
        <FiCheck aria-hidden="true" />
        <span className="fx-grow">الموقع محفوظ</span>
        <a href={`https://www.google.com/maps?q=${f.lat},${f.lng}`} target="_blank" rel="noreferrer">شوفه</a>
        <button type="button" onClick={() => setF((x) => ({ ...x, lat: "", lng: "", maps_url: "" }))}>غيّره</button>
      </div>
    );
  }
  return (
    <div className="fx-stack" style={{ gap: 8 }}>
      <div className="fx-grid2">
        <button type="button" className="fx-soft-btn" onClick={here} disabled={!!busy}><FiMapPin /> {busy === "gps" ? "لحظة..." : "أنا عنده هلأ"}</button>
        <button type="button" className={`fx-soft-btn ${linkOpen ? "on" : ""}`} onClick={() => setLinkOpen(!linkOpen)} disabled={!!busy}><FiLink /> الصق رابط</button>
      </div>
      {linkOpen && (
        <div className="fx-row" style={{ flexWrap: "nowrap" }}>
          <input className="fx-input" dir="ltr" autoFocus value={link} onChange={(e) => setLink(e.target.value)}
            onPaste={(e) => { const t = e.clipboardData.getData("text"); if (/https?:\/\//.test(t)) { e.preventDefault(); setLink(t); fromLink(t); } }}
            placeholder="https://maps.app.goo.gl/..." />
          <button type="button" className="fx-btn sm pri" disabled={!link.trim() || !!busy} onClick={() => fromLink(link)}>{busy === "link" ? "..." : "ثبّت"}</button>
        </div>
      )}
    </div>
  );
}

// صورة المحل: كبسة وحدة بتفتح الكاميرا، أو من المعرض
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
    <div>
      {value ? (
        <div className="fx-photo-row">
          <img src={value} alt="صورة المحل" />
          <button type="button" onClick={() => cam.current?.click()} disabled={busy}>{busy ? "لحظة..." : "صوّر من جديد"}</button>
          <button type="button" onClick={() => onChange("")}>شيلها</button>
        </div>
      ) : (
        <div className="fx-grid2">
          <button type="button" className="fx-soft-btn" disabled={busy} onClick={() => cam.current?.click()}><FiCamera /> {busy ? "لحظة..." : "صوّر"}</button>
          <button type="button" className="fx-soft-btn" disabled={busy} onClick={() => gal.current?.click()}><FiImage /> من المعرض</button>
        </div>
      )}
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
  if (pay && c) return <PaymentSheet c={c} onClose={() => setPay(false)} onSaved={(r) => { setPay(false); load(); onChanged(); fx.toast("انسجلت الدفعة"); if (r?.message_ids) setMsgs(r.message_ids); else if (r?.message_id) setMsgs([r.message_id]); }} />;
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
          <RecurringCard customer={c} />
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
            <div className="fx-field">تاريخ الصرف<DateInput value={chequeDate} onChange={setChequeDate} ariaLabel="تاريخ الصرف" /></div>
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
