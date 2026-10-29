import { useEffect, useMemo, useRef, useState } from "react";
import { FiPlus, FiCheck, FiArrowUp, FiArrowDown, FiInfo, FiTrash2, FiSearch, FiShuffle, FiEdit2, FiX, FiTruck, FiChevronLeft } from "react-icons/fi";
import { fapi } from "../fapi.js";
import { useFx, useLoad, Sheet, Tip, Err, Loading, Empty, Act, StatusPill, ORDER_STATUS, SendMessages, ProductArt, bonusPreview, money, num, time, date, today, DateInput } from "../ui.jsx";
import { StopSheet } from "./StopSheet.jsx";
import { PlaceChips, matchPlace } from "../RegionFilter.jsx";
import { FiGift } from "react-icons/fi";

const tomorrow = () => new Date(Date.now() + 86400000).toLocaleDateString("en-CA", { timeZone: "Asia/Amman" });

export default function Orders() {
  const fx = useFx();
  const dispatch = fx.can("f_dispatch", "edit");
  const editOrders = fx.can("f_orders", "edit") || dispatch;
  const { data, error, reload } = useLoad(() => fapi.orders(), []);
  const [done, setDone] = useState(null);
  const [sel, setSel] = useState([]);
  const [sheet, setSheet] = useState(null);
  const [msgs, setMsgs] = useState(null);

  // المناطق اللي اختارها (بتنحفظ على هالتلفون)
  const [region, setRegionS] = useState(() => { try { const v = JSON.parse(localStorage.getItem("fx-orders-place") || "null"); return v && typeof v === "object" ? { gov: v.gov || null, areas: Array.isArray(v.areas) ? v.areas : [] } : { gov: null, areas: [] }; } catch { return { gov: null, areas: [] }; } });
  const setRegion = (v) => { setRegionS(v); try { localStorage.setItem("fx-orders-place", JSON.stringify(v)); } catch { /* */ } };
  const all = data || [];
  const open = all.filter((o) => matchPlace(o, region));
  const free = open.filter((o) => !o.trip_id && ["new", "delayed"].includes(o.status));
  const assigned = open.filter((o) => o.trip_id);
  const selCartons = sel.reduce((s, id) => s + (open.find((o) => o.id === id)?.cartons || 0), 0);

  function toggle(id) {
    setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }
  function after(result) {
    setSheet(null);
    setSel([]);
    reload();
    if (result?.message_ids?.length) setMsgs(result.message_ids);
  }

  const [tab, setTab] = useState(null);
  const cur = tab || (free.length || !assigned.length ? "free" : "cars");
  useEffect(() => { if (cur === "done" && !done) fapi.orders({ scope: "done" }).then(setDone).catch(() => {}); }, [cur, done]);
  // الطلبات اللي على السيارات، مجمّعة لكل سيارة
  const byCar = useMemo(() => {
    const m = new Map();
    for (const o of assigned) {
      const k = o.trip_id;
      if (!m.has(k)) m.set(k, { trip_id: k, vehicle_name: o.vehicle_name, driver_name: o.driver_name, trip_status: o.trip_status, orders: [] });
      m.get(k).orders.push(o);
    }
    return [...m.values()];
  }, [assigned]);

  return (
    <div className="fx-page">
      <div className="fx-chead">
        <h1>الطلبات</h1>
        {editOrders && <button className="fx-cadd" data-hl="new-order" onClick={() => setSheet({ kind: "new" })}><FiPlus /> طلب جديد</button>}
      </div>
      <Err msg={error} />
      {!data && !error && <Loading />}

      {data && (
        <>
          <div className="fx-steps" role="tablist">
            <button role="tab" aria-selected={cur === "free"} className={cur === "free" ? "on" : ""} onClick={() => setTab("free")}>
              <i>1</i><span>جديدة</span>{free.length > 0 && <b>{free.length}</b>}
            </button>
            <button role="tab" aria-selected={cur === "cars"} className={cur === "cars" ? "on" : ""} onClick={() => setTab("cars")}>
              <i>2</i><span>بالسيارات</span>{assigned.length > 0 && <b>{assigned.length}</b>}
            </button>
            <button role="tab" aria-selected={cur === "done" } className={cur === "done" ? "on" : ""} onClick={() => setTab("done")}>
              <i>3</i><span>خلصت</span>
            </button>
          </div>

          {editOrders && <PostponeCard onDone={reload} />}

          {all.length > 0 && <PlaceChips items={all} value={region} onChange={(r) => { setRegion(r); setSel([]); }} noun="طلب" />}

          {cur === "free" && (
            <>
              {dispatch && free.length > 0 && (
                <div className="fx-hint-line">
                  <span>اختار الطلبات وحطها على سيارة</span>
                  {free.length > 1 && <button className="fx-link" onClick={() => setSel(sel.length === free.length ? [] : free.map((o) => o.id))}>{sel.length === free.length ? "إلغاء" : "اختار الكل"}</button>}
                </div>
              )}
              <div className="fx-clist" data-hl="orders-list">
                {free.length === 0 && <div className="fx-empty-soft">ما في طلبات بدها سيارة 👌</div>}
                {free.map((o) => (
                  <OrderRow key={o.id} o={o} selectable={dispatch} on={sel.includes(o.id)} onToggle={() => toggle(o.id)} onInfo={() => setSheet({ kind: "info", o })} />
                ))}
              </div>
            </>
          )}

          {cur === "cars" && (
            <div className="fx-stack" data-hl="assigned-list">
              {byCar.length === 0 && <div className="fx-empty-soft">ولا طلب على سيارة لسا.</div>}
              {byCar.map((g) => (
                <section key={g.trip_id} className="fx-cargroup">
                  <div className="h">
                    <span className="fx-cav"><FiTruck /></span>
                    <span className="t"><b>{g.driver_name || "بدون سائق"}</b><small>{g.vehicle_name} · {g.trip_status === "active" ? "بالطريق" : "لسا ما طلعت"} · {g.orders.length} طلب</small></span>
                  </div>
                  {g.orders.map((o) => (
                    <div key={o.id} className="row">
                      <button className="fx-plain t" onClick={() => setSheet({ kind: "info", o })}>
                        <b>{o.customer_name}</b>
                        <small>{num(o.cartons)} كرتونة{o.eta_at ? ` · يوصل ${time(o.eta_at)}` : ""}</small>
                      </button>
                      <StatusPill map={ORDER_STATUS} value={o.status} />
                      {dispatch && <button className="fx-link" onClick={() => setSheet({ kind: "move", o })}>نقل</button>}
                    </div>
                  ))}
                </section>
              ))}
            </div>
          )}

          {cur === "done" && (
            <div className="fx-clist">
              {!done && <Loading />}
              {done && done.length === 0 && <div className="fx-empty-soft">ما خلص إشي آخر ٣ أيام.</div>}
              {done?.filter((o) => matchPlace(o, region)).map((o) => (
                <div key={o.id} className="fx-crow">
                  <button className="fx-plain fx-crow-main" onClick={() => setSheet({ kind: "info", o })}>
                    <span className="t">
                      <b>{o.customer_name}</b>
                      <small>{o.status === "delivered" ? `${o.driver_name || "السائق"} سلّم ${time(o.delivered_at)} · كاش ${money(o.cash_paid)}` : o.fail_reason || itemsLine(o)}</small>
                    </span>
                  </button>
                  <StatusPill map={ORDER_STATUS} value={o.status} />
                  {o.status === "failed" && dispatch && <Act className="fx-link" onClick={async () => { await fapi.reopenOrder(o.id); fx.toast("رجع للطلبات الجديدة"); setDone(null); reload(); }}>رجّعه</Act>}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {dispatch && sel.length > 0 && (
        <div className="fx-selbar">
          <span className="fx-grow"><b>{sel.length}</b> طلب · <b className="fx-num">{num(selCartons)}</b> كرتونة</span>
          <button className="fx-btn sm" onClick={() => setSel([])}>إلغاء</button>
          <button className="fx-btn pri" data-hl="build-trip" onClick={() => setSheet({ kind: "trip" })}><FiTruck /> حطها على سيارة</button>
        </div>
      )}

      {sheet?.kind === "new" && <OrderSheet onClose={() => setSheet(null)} onSaved={after} />}
      {sheet?.kind === "edit" && <OrderSheet order={sheet.o} onClose={() => setSheet(null)} onSaved={after} />}
      {sheet?.kind === "info" && ["delivered", "failed"].includes(sheet.o.status) && <StopSheet o={sheet.o} onClose={() => setSheet(null)} />}
      {sheet?.kind === "info" && !["delivered", "failed"].includes(sheet.o.status) && <OrderInfo o={sheet.o} onClose={() => setSheet(null)} onEdit={() => setSheet({ kind: "edit", o: sheet.o })} onChanged={after} />}
      {sheet?.kind === "trip" && <TripBuilder orderIds={sel} orders={open} onClose={() => setSheet(null)} onSaved={after} />}
      {sheet?.kind === "move" && <TransferSheet o={sheet.o} onClose={() => setSheet(null)} onSaved={after} />}
      {msgs && <SendMessages ids={msgs} onClose={() => setMsgs(null)} />}
    </div>
  );
}

export function itemsLine(o) {
  return o.items.map((i) => (i.qty > 0 ? `${num(i.qty)} ${i.name}${i.bonus_qty ? ` +${num(i.bonus_qty)} بونص` : ""}` : `🎁 ${num(i.bonus_qty)} ${i.name} بونص`)).join("، ");
}

function OrderRow({ o, selectable, on, onToggle, onInfo }) {
  return (
    <div className={`fx-crow ${on ? "sel" : ""}`}>
      {selectable && (
        <button className={`fx-check2 ${on ? "on" : ""}`} onClick={onToggle} role="checkbox" aria-checked={on} aria-label={`اختار ${o.customer_name}`}>
          {on && <FiCheck />}
        </button>
      )}
      <button className="fx-plain fx-crow-main" onClick={selectable ? onToggle : onInfo}>
        <span className="t">
          <b>{o.customer_name}</b>
          <small>{[o.city, `${num(o.cartons)} كرتونة`].filter(Boolean).join(" · ")}{o.due_date && o.due_date !== today() ? ` · ${date(o.due_date)}` : ""}</small>
          {(o.urgent || o.status === "delayed" || o.recurring_id) && (
            <span className="tags">
              {o.recurring_id && <i className="o">🔁 طلب ثابت</i>}
              {o.urgent && <i className="d bad">مستعجل</i>}
              {o.status === "delayed" && <i className="d">مؤجل</i>}
            </span>
          )}
        </span>
      </button>
      <button className="fx-icon-btn sm" onClick={onInfo} aria-label="تفاصيل"><FiChevronLeft /></button>
    </div>
  );
}

// ---------- طلب جديد / تعديل ----------
const OPEN_ST = ["new", "assigned", "onway", "delayed"];
const toItems = (o) => o.items.filter((i) => i.qty > 0).map((i) => ({ product_id: i.product_id, qty: i.qty, bonus_qty: i.bonus_manual ? i.bonus_qty : undefined, bonus_manual: !!i.bonus_manual }));
// أسطر «بونص حر» (صنف ببلاش بدون شراء)
const toFree = (o) => Object.fromEntries((o?.items || []).filter((i) => i.qty === 0 && i.bonus_qty > 0).map((i) => [i.product_id, i.bonus_qty]));

export function OrderSheet({ order: orderProp, customer, onClose, onSaved }) {
  const fx = useFx();
  const products = fx.boot.products.filter((p) => p.active);
  const [order, setOrder] = useState(orderProp || null);
  const [q, setQ] = useState("");
  const [list, setList] = useState([]);
  const [cust, setCust] = useState(orderProp ? { id: orderProp.customer_id, name: orderProp.customer_name, city: orderProp.city } : customer || null);
  const [items, setItems] = useState(orderProp ? toItems(orderProp) : []);
  const [freeB, setFreeB] = useState(() => toFree(orderProp));
  const [due, setDue] = useState(orderProp?.due_date || today());
  const [urgent, setUrgent] = useState(!!orderProp?.urgent);
  const [notes, setNotes] = useState(orderProp?.notes || "");
  const [err, setErr] = useState("");
  const [openOrders, setOpenOrders] = useState([]);
  const [dup, setDup] = useState(null);

  // طلب مفتوح لنفس الزبون؟ (ممكن حدا ثاني سجّله من تلفون ثاني)
  useEffect(() => {
    setOpenOrders([]);
    if (!cust || order) return;
    fapi.orders({ customer: cust.id }).then((l) => setOpenOrders(l.filter((o) => OPEN_ST.includes(o.status)))).catch(() => {});
  }, [cust?.id, order]); // eslint-disable-line react-hooks/exhaustive-deps

  function editExisting(o) {
    setOrder(o);
    setItems(toItems(o));
    setFreeB(toFree(o));
    setDue(o.due_date || today());
    setUrgent(!!o.urgent);
    setNotes(o.notes || "");
    setDup(null);
    setOpenOrders([]);
  }

  useEffect(() => {
    if (cust) return;
    const t = setTimeout(() => fapi.customers({ q }).then(setList).catch(() => {}), 250);
    return () => clearTimeout(t);
  }, [q, cust]);


  async function save(allowDuplicate = false) {
    setErr("");
    const body = { customer_id: cust?.id, items: [
      ...items.filter((i) => i.product_id && Number(i.qty) > 0).map((i) => ({ ...i, bonus_qty: i.bonus_manual ? Number(i.bonus_qty) || 0 : undefined })),
      ...Object.entries(freeB).filter(([, n]) => Number(n) > 0).map(([pid, n]) => ({ product_id: Number(pid), qty: 0, bonus_qty: Number(n), bonus_manual: true })),
    ], due_date: due, urgent, notes, allow_duplicate: allowDuplicate };
    try {
      if (order) {
        const r = await fapi.updateOrder(order.id, body);
        fx.toast(r.warning ? `انحفظ التعديل · ${r.warning}` : "انحفظ التعديل");
        onSaved();
      } else {
        const r = await fapi.createOrder(body);
        fx.toast(r.bonus ? `انسجل الطلب · مع ${num(r.bonus)} كرتونة بونص` : "انسجل الطلب");
        onSaved({ message_ids: [r.message_id] });
      }
    } catch (e) {
      if (e.data?.code === "duplicate") {
        // ممكن انضاف هلأ من تلفون ثاني: منجيب الطلبات المفتوحة كاملة
        const l = await fapi.orders({ customer: cust.id }).catch(() => []);
        setDup(l.filter((o) => OPEN_ST.includes(o.status)));
      } else setErr(e.message);
    }
  }

  return (
    <Sheet title={order ? `تعديل طلب #${order.id}` : "طلب جديد"} onClose={onClose}>
      <div className="fx-stack">
        {order && order.status === "onway" && <div className="fx-note warn">الطلب مع السائق بالطريق. التعديل بيوصله إشعار، وإذا زدت الكمية لازم تكون معه بالسيارة.</div>}
        {!cust ? (
          <>
            <label className="fx-field">الزبون
              <span className="fx-row" style={{ flexWrap: "nowrap" }}><FiSearch style={{ color: "var(--fx-muted)" }} /><input className="fx-input" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="اسم المحل، رقمه، التلفون أو المدينة" /></span>
            </label>
            <div className="fx-list" style={{ maxHeight: 260, overflow: "auto" }}>
              {list.map((c) => (
                <button key={c.id} className="fx-item" onClick={() => setCust(c)}>
                  <span className="t"><b>{c.seq_no ? <span className="fx-seq">#{c.seq_no}</span> : null}{c.name}</b><span>{c.city || ""}{c.line_name ? ` · ${c.line_name}` : ""}</span></span>
                </button>
              ))}
              {list.length === 0 && <div className="fx-item"><span className="fx-muted">ما لقيت. ضيف الزبون من شاشة الزباين أول.</span></div>}
            </div>
          </>
        ) : (
          <div className="fx-card soft fx-row fx-ord-cust">
            {cust.photo_url ? <img className="fx-avatar fx-avatar-img" src={cust.photo_url} alt="" /> : <span className="fx-avatar">{(cust.name || "").trim().charAt(0)}</span>}
            <span className="fx-grow"><b>{cust.seq_no ? <span className="fx-seq">#{cust.seq_no}</span> : null}{cust.name}</b><br /><span className="fx-muted">{[cust.city, cust.address].filter(Boolean).join(" · ")}</span></span>
            {!order && !customer && <button className="fx-link" onClick={() => setCust(null)}>غيّر</button>}
          </div>
        )}

        {!order && openOrders.length > 0 && (
          <div className="fx-dup">
            <b>⚠️ هالزبون عنده طلب مفتوح</b>
            {openOrders.map((o) => (
              <div key={o.id} className="fx-dup-row">
                <span className="t">
                  <b>#{o.id} · {itemsLine(o)}</b>
                  <small>{o.created_by_name ? `سجّله ${o.created_by_name} · ` : ""}{date(o.created_at)} {time(o.created_at)} · {ORDER_STATUS[o.status]?.[0] || o.status}</small>
                </span>
                <button className="fx-btn sm pri" onClick={() => editExisting(o)}>عدّله</button>
              </div>
            ))}
            <small className="fx-muted">إذا الزبون غيّر الكمية، عدّل طلبه بدل ما تضيف طلب ثاني.</small>
          </div>
        )}

        {cust && <ProductPicker products={products} items={items} setItems={setItems} customerId={cust.id} />}
        {cust && fx.canAction("give_bonus") && <FreeBonus products={products} value={freeB} onChange={setFreeB} />}

        <div className="fx-field">موعد التوصيل
          <div className="fx-chips fx-due">
            <button className={`fx-chip ${due === today() ? "on" : ""}`} onClick={() => setDue(today())}>اليوم</button>
            <button className={`fx-chip ${due === tomorrow() ? "on" : ""}`} onClick={() => setDue(tomorrow())}>بكرا</button>
          </div>
          <DateInput value={due} onChange={setDue} ariaLabel="تاريخ التوصيل" />
        </div>
        <label className="fx-row"><input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} /> مستعجل</label>
        <label className="fx-field">ملاحظة (اختياري)<input className="fx-input" value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        <Err msg={err} />
        {dup && (
          <Sheet title="انتبه: في طلب مفتوح" onClose={() => setDup(null)}>
            <div className="fx-stack">
              <p style={{ margin: 0 }}>{cust?.name} عنده طلب مفتوح (ممكن حدا سجّله من تلفون ثاني):</p>
              {dup.map((o) => (
                <div key={o.id} className="fx-dup-row card">
                  <span className="t">
                    <b>#{o.id} · {itemsLine(o)}</b>
                    <small>{o.created_by_name ? `سجّله ${o.created_by_name} · ` : ""}{date(o.created_at)} {time(o.created_at)}</small>
                  </span>
                  <button className="fx-btn sm pri" onClick={() => editExisting(o)}>عدّله بدل</button>
                </div>
              ))}
              <Act className="fx-btn block" onClick={() => save(true)}>لا، هاد طلب ثاني منفصل — ضيفه</Act>
              <button className="fx-link" onClick={() => setDup(null)}>رجوع</button>
            </div>
          </Sheet>
        )}
        <Act className="fx-btn pri block" onClick={() => save(false)} disabled={!cust || !items.some((i) => Number(i.qty) > 0)}>
          {order ? "احفظ" : "سجّل الطلب"}{items.some((i) => Number(i.qty) > 0) ? ` · ${num(items.reduce((t, i) => t + (Number(i.qty) || 0), 0))} كرتونة` : ""}
        </Act>
      </div>
    </Sheet>
  );
}

// «شرنك 600 مل» ← «600 مل»، «شرنك 1500 مل» ← «1.5 لتر»، «كاس رقم 1» ← «كاس رقم 1»
function sizeLabel(name = "") {
  const ml = String(name).match(/(\d+(?:\.\d+)?)\s*(مل|ml)/i);
  if (ml) { const n = Number(ml[1]); return n >= 1000 ? `${n / 1000} لتر` : `${n} مل`; }
  const l = String(name).match(/(\d+(?:\.\d+)?)\s*(لتر|ل\b|L)/i);
  if (l) return `${l[1]} لتر`;
  return String(name).trim();
}

// اختيار المنتجات بالصور، والكمية بأزرار سريعة (المصانع بتطلب مئات الكراتين)
const QUICK = [10, 20, 50, 100, 200, 500];
export function ProductPicker({ products, items, setItems, customerId, noBonus = false }) {
  const fx = useFx();
  const canBonus = fx.canAction("give_bonus");
  const setBonus = (id, patch) => setItems((xs) => xs.map((x) => (x.product_id === id ? { ...x, ...patch } : x)));
  const pick = (id) => {
    const adding = !items.some((x) => x.product_id === id);
    setItems((xs) => (xs.some((x) => x.product_id === id) ? xs.filter((x) => x.product_id !== id) : [...xs, { product_id: id, qty: "" }]));
    // بننزل لخانة الكمية عشان يكتب العدد على طول
    if (adding) setTimeout(() => document.getElementById(`qty-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 60);
  };
  const setQty = (id, q) => setItems((xs) => xs.map((x) => (x.product_id === id ? { ...x, qty: q } : x)));
  if (!products.length) return <div className="fx-note warn">ما في منتجات. ضيفها من الإعدادات.</div>;
  return (
    <>
      <div className="fx-ord-h">شو بده؟ <span>اكبس على المنتج</span></div>
      <div className="fx-prods">
        {products.map((p) => {
          const it = items.find((x) => x.product_id === p.id);
          return (
            <button key={p.id} type="button" className={`fx-prod ${it ? "on" : ""}`} onClick={() => pick(p.id)} aria-pressed={!!it}>
              {it && <span className="tick">{Number(it.qty) > 0 ? num(it.qty) : "✓"}</span>}
              <span className="pic">{p.image_url ? <img src={p.image_url} alt={p.name} loading="lazy" /> : <ProductArt p={p} size={96} />}</span>
              <span className="pill">{[sizeLabel(p.name), p.per_carton ? `${p.per_carton} حبة` : null].filter(Boolean).join(" • ")}</span>
              <b>{p.name}</b>
              <span className="price">{money(p.price)} د.أ</span>
            </button>
          );
        })}
      </div>
      {items.map((it) => {
        const p = products.find((x) => x.id === it.product_id);
        if (!p) return null;
        const q = Number(it.qty) || 0;
        return (
          <div key={it.product_id} id={`qty-${it.product_id}`} className="fx-qty">
            <div className="top">
              <ProductArt p={p} size={44} />
              <b className="fx-grow">{p.name}</b>
              <div className="fx-stepper">
                <button type="button" onClick={() => setQty(p.id, Math.max(0, q - 1))} aria-label="ناقص واحد" dir="ltr">−</button>
                <input className="fx-input" type="number" inputMode="numeric" min="1" value={it.qty} placeholder="0" onChange={(e) => setQty(p.id, e.target.value)} aria-label={`كراتين ${p.name}`} />
                <button type="button" onClick={() => setQty(p.id, q + 1)} aria-label="زايد واحد" dir="ltr">+</button>
              </div>
            </div>
            <div className="fx-chips">{QUICK.map((n) => <button key={n} type="button" className={`fx-chip ${q === n ? "on" : ""}`} onClick={() => setQty(p.id, n)}>{n}</button>)}</div>
            {!noBonus && <BonusLine p={p} q={q} it={it} auto={bonusPreview(fx.boot.bonus_rules, customerId, p.id, q)} canBonus={canBonus} onChange={(patch) => setBonus(p.id, patch)} />}
          </div>
        );
      })}
    </>
  );
}

// 🎁 بونص حر: أي صنف ببلاش مع الطلب (مثلًا على ١٠٠ كرتونة: كبير + وسط + بيبي)
export function FreeBonus({ products, value, onChange }) {
  const [open, setOpen] = useState(Object.keys(value).length > 0);
  if (!open) return <button type="button" className="fx-link" style={{ justifySelf: "start" }} onClick={() => setOpen(true)}>🎁 بدك تعطيه بونص من صنف ثاني؟</button>;
  return (
    <div className="fx-exch" style={{ background: "#effaf3", borderColor: "#b7e2c7" }}>
      <span className="hd" style={{ color: "#14653a" }}>🎁 بونص ببلاش — على أي صنف</span>
      {Object.keys(value).map((pid) => {
        const p = products.find((x) => x.id === Number(pid));
        const n = Number(value[pid]) || 0;
        return (
          <div key={pid} className="fx-row" style={{ flexWrap: "nowrap", gap: 8 }}>
            <ProductArt p={p} size={34} /><b className="fx-grow">{p?.name}</b>
            <div className="fx-stepper">
              <button type="button" dir="ltr" onClick={() => onChange((v) => { const x = { ...v, [pid]: Math.max(0, n - 1) }; if (!x[pid]) delete x[pid]; return x; })}>−</button>
              <input className="fx-input" type="number" inputMode="numeric" min="0" value={value[pid]} onChange={(e) => onChange((v) => ({ ...v, [pid]: e.target.value }))} aria-label={`بونص ${p?.name}`} />
              <button type="button" dir="ltr" onClick={() => onChange((v) => ({ ...v, [pid]: n + 1 }))}>+</button>
            </div>
          </div>
        );
      })}
      <div className="fx-chips">
        {products.filter((p) => !(String(p.id) in value)).map((p) => <button key={p.id} type="button" className="fx-chip" onClick={() => onChange((v) => ({ ...v, [p.id]: 5 }))}>+ {p.name}</button>)}
      </div>
    </div>
  );
}

// سطر البونص تحت الكمية: تلقائي من القواعد، والمدير بيقدر يغيّره
function BonusLine({ q, it, auto, canBonus, onChange }) {
  const bonus = it.bonus_manual ? Number(it.bonus_qty) || 0 : auto;
  if (!q && !it.bonus_manual) return null;
  return (
    <div className="fx-bonus">
      <FiGift aria-hidden="true" />
      {it.bonus_manual ? (
        <span className="fx-row" style={{ gap: 6, flexWrap: "nowrap" }}>
          بونص
          <input className="fx-input" style={{ width: 80, padding: "6px 8px", textAlign: "center" }} type="number" inputMode="numeric" min="0" value={it.bonus_qty ?? ""} onChange={(e) => onChange({ bonus_qty: e.target.value })} aria-label="البونص" />
          كرتونة
        </span>
      ) : (
        <span>{bonus ? <>بونص <b>{num(bonus)}</b> كرتونة ببلاش</> : "بدون بونص"}</span>
      )}
      {bonus > 0 && <span className="fx-muted" style={{ fontSize: 12 }}>· بيستلم {num(q + bonus)} وبيدفع حق {num(q)}</span>}
      {canBonus && (
        <button type="button" className="fx-link" style={{ marginInlineStart: "auto" }} onClick={() => onChange(it.bonus_manual ? { bonus_manual: false, bonus_qty: undefined } : { bonus_manual: true, bonus_qty: auto })}>
          {it.bonus_manual ? "رجّعه تلقائي" : "عدّل"}
        </button>
      )}
    </div>
  );
}

const CANCEL_REASONS = ["الزبون لغى", "طلب مكرر", "انسجل غلط", "الزبون مسكّر"];
function OrderInfo({ o, onClose, onEdit, onChanged }) {
  const fx = useFx();
  const dispatch = fx.can("f_dispatch", "edit");
  const editor = fx.can("f_orders", "edit") || dispatch;
  const loaded = !!o.trip_loaded_at || o.status === "onway";
  const canEdit = editor && OPEN_ST.includes(o.status) && (!loaded || dispatch);
  const canCancel = editor && [...OPEN_ST, "failed"].includes(o.status) && (o.status === "new" || dispatch);
  const [cancel, setCancel] = useState(false);
  const [reason, setReason] = useState(CANCEL_REASONS[0]);
  if (cancel) {
    return (
      <Sheet title={`إلغاء طلب #${o.id}`} onClose={() => setCancel(false)}>
        <div className="fx-stack">
          <p style={{ margin: 0 }}><b>{o.customer_name}</b> · {itemsLine(o)}</p>
          <div className="fx-field">ليش انلغى؟
            <div className="fx-chips">{CANCEL_REASONS.map((r) => <button key={r} className={`fx-chip ${reason === r ? "on" : ""}`} onClick={() => setReason(r)}>{r}</button>)}</div>
          </div>
          {loaded && <div className="fx-note warn">الكراتين محمّلة على السيارة: بترجع مع السائق للمستودع، والسائق بيوصله إشعار.</div>}
          <Act className="fx-btn danger block" onClick={async () => { await fapi.cancelOrder(o.id, reason); fx.toast("انلغى الطلب"); onChanged(); }}>أكّد الإلغاء</Act>
          <button className="fx-btn block" onClick={() => setCancel(false)}>لا، رجوع</button>
        </div>
      </Sheet>
    );
  }
  return (
    <Sheet title={`طلب #${o.id}`} onClose={onClose}>
      <div className="fx-stack">
        <div className="fx-card">
          <div className="fx-kv"><span>الزبون</span><b>{o.seq_no ? <span className="fx-seq">#{o.seq_no}</span> : null}{o.customer_name}</b></div>
          <div className="fx-kv"><span>المدينة</span><b>{[o.city, o.address].filter(Boolean).join(" · ") || "—"}</b></div>
          {o.phone && <div className="fx-kv"><span>التلفون</span><b dir="ltr"><a href={`tel:${o.phone}`}>{o.phone}</a></b></div>}
          {(o.lat || o.maps_url) && <div className="fx-kv"><span>الموقع</span><b><a className="fx-link" href={o.lat ? `https://www.google.com/maps?q=${o.lat},${o.lng}` : o.maps_url} target="_blank" rel="noreferrer">افتح على الخريطة</a></b></div>}
          {o.items.map((i) => (
            <div key={i.id}>
              <div className="fx-kv"><span>{i.name}</span><b>{num(i.qty)} × {money(i.price)}</b></div>
              {i.bonus_qty > 0 && <div className="fx-kv good"><span>+ بونص {i.name}</span><b>{num(i.bonus_qty)} ببلاش</b></div>}
            </div>
          ))}
          <div className="fx-kv total"><span>المجموع</span><b>{money(o.total)} د.أ</b></div>
        </div>
        <div className="fx-row"><StatusPill map={ORDER_STATUS} value={o.status} />{o.vehicle_name && <span className="fx-pill">{o.vehicle_name}</span>}{o.eta_at && <span className="fx-pill">يوصل {time(o.eta_at)}</span>}</div>
        <p className="fx-muted" style={{ margin: 0, fontSize: 13 }}>
          {o.created_by_name ? `سجّله ${o.created_by_name}` : "انسجل"} {date(o.created_at)} {time(o.created_at)}
          {o.edited_at ? ` · آخر تعديل ${o.edited_by_name || ""} ${time(o.edited_at)}` : ""}
        </p>
        {o.notes && <div className="fx-note">{o.notes}</div>}
        {(canEdit || canCancel) && (
          <div className="fx-grid2">
            {canEdit && <button className="fx-btn pri" onClick={onEdit}><FiEdit2 /> عدّل الكميات</button>}
            {canCancel && <button className="fx-btn danger" onClick={() => setCancel(true)}><FiX /> إلغاء الطلب</button>}
          </div>
        )}
        {editor && loaded && !dispatch && <div className="fx-note">الطلب محمّل على السيارة — التعديل والإلغاء من مسؤول الحركة.</div>}
      </div>
    </Sheet>
  );
}

// ---------- بناء رحلة: الطلبات المحددة على سيارة وحدة ----------
function TripBuilder({ orderIds, orders, onClose, onSaved }) {
  const fx = useFx();
  const vehicles = fx.boot.vehicles.filter((v) => v.status === "active");
  // بنختار لحالنا أصغر سيارة إلها سائق وبتساع الحمولة
  const [vehicle, setVehicle] = useState(() => {
    const need = (orders || []).filter((o) => orderIds.includes(o.id)).reduce((a, o) => a + (o.cartons || 0), 0);
    const withDriver = vehicles.filter((v) => v.driver_id);
    const fits = withDriver.filter((v) => v.capacity >= need).sort((a, b) => a.capacity - b.capacity);
    return (fits[0] || [...withDriver].sort((a, b) => b.capacity - a.capacity)[0] || vehicles[0])?.id;
  });
  const [ids, setIds] = useState(orderIds);
  const [day, setDay] = useState(today());
  const [depart, setDepart] = useState("08:00");
  const [pv, setPv] = useState(null);
  const [err, setErr] = useState("");
  const [force, setForce] = useState(false);

  const firstSort = useRef(true);
  async function preview(sort = false, quiet = false) {
    if (!vehicle) return;
    try {
      const r = await fapi.previewTrip({ vehicle_id: vehicle, order_ids: ids, sort, date: day, depart_time: depart });
      setPv(r);
      if (sort) {
        const next = r.stops.map((s) => s.id);
        if (next.join(",") !== ids.join(",")) setIds(next);
        if (!quiet) fx.toast("ترتبت من الأقرب للأبعد");
      }
      setErr("");
    } catch (e) {
      setErr(e.message);
    }
  }
  // أول مرة بنرتبهم لحالهم من الأقرب للأبعد
  useEffect(() => { const first = firstSort.current; firstSort.current = false; preview(first, true); }, [vehicle, ids.join(","), day, depart]); // eslint-disable-line react-hooks/exhaustive-deps

  function move(i, d) {
    setIds((xs) => {
      const a = [...xs];
      [a[i], a[i + d]] = [a[i + d], a[i]];
      return a;
    });
  }

  if (!vehicles.length) {
    return <Sheet title="رحلة جديدة" onClose={onClose}><Empty title="ما في سيارات شغالة" text="ضيف سيارة من الإعدادات أول." /></Sheet>;
  }
  const over = pv && pv.over > 0;
  return (
    <Sheet title="حطها على سيارة" onClose={onClose}>
      <div className="fx-stack">
        <div className="fx-field">اليوم
          <div className="fx-chips">
            <button className={`fx-chip ${day === today() ? "on" : ""}`} onClick={() => setDay(today())}>اليوم</button>
            <button className={`fx-chip ${day === tomorrow() ? "on" : ""}`} onClick={() => setDay(tomorrow())}>بكرا</button>
            <label className="fx-row" style={{ gap: 6 }}>الطلعة <input className="fx-input" style={{ width: 140 }} type="time" value={depart} onChange={(e) => setDepart(e.target.value)} /></label>
          </div>
        </div>
        <div className="fx-field">السيارة
          <div className="fx-hscroll">
            {vehicles.map((v) => (
              <button key={v.id} className={`fx-pick ${v.id === vehicle ? "on" : ""}`} onClick={() => setVehicle(v.id)}>
                <b>{v.name}</b>
                <span>{v.driver_name || "بدون سائق"} · {v.governorate || ""}</span>
                <span>حمولة {num(v.capacity)}</span>
              </button>
            ))}
          </div>
        </div>

        {pv && (
          <>
            <div>
              <div className="fx-row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
                <span className="fx-muted">الحمولة</span>
                <b className="fx-num">{num(pv.load)} من {num(pv.vehicle.capacity)} كرتونة</b>
              </div>
              <div className={`fx-bar ${over ? "over" : ""}`}><i style={{ width: `${Math.min(100, (pv.load / pv.vehicle.capacity) * 100)}%` }} /></div>
              {pv.already_loaded > 0 && <p className="fx-muted" style={{ margin: "6px 0 0" }}>منها {num(pv.already_loaded)} على السيارة من رحلة اليوم — الطلبات الجديدة بتنضاف عليها.</p>}
              {over ? (
                <div className="fx-note crit" style={{ marginTop: 8 }}>أكبر من سعة السيارة بـ{num(pv.over)} كرتونة. شيل طلب أو اختار سيارة أكبر.</div>
              ) : (
                <p className="fx-muted" style={{ margin: "6px 0 0" }}>في مجال لـ{num(-pv.over)} كرتونة كمان للبيع من السيارة.</p>
              )}
              {!pv.vehicle.driver_id && <div className="fx-note warn" style={{ marginTop: 8 }}>السيارة ما إلها سائق. اربطها بسائق من الإعدادات عشان توصله الرحلة.</div>}
            </div>

            <div className="fx-sec"><h2>ترتيب الوقفات</h2><button className="fx-btn sm sky" onClick={() => preview(true)}>رتّب من الأقرب للأبعد</button></div>
            <div className="fx-card" style={{ paddingBlock: 4 }}>
              {pv.stops.map((s, i) => (
                <div key={s.id} className="fx-stop">
                  <span className="fx-n">{i + 1}</span>
                  <span className="t" style={{ display: "grid" }}>
                    <b>{s.customer_name}</b>
                    <span className="fx-muted">{s.city || ""} · {num(s.cartons)} كرتونة{s.leg_km != null ? ` · ${s.leg_km} كم` : ""} · يوصل {time(s.eta_at)}</span>
                  </span>
                  <span className="fx-ud">
                    <button disabled={i === 0} onClick={() => move(i, -1)} aria-label="لفوق"><FiArrowUp /></button>
                    <button disabled={i === pv.stops.length - 1} onClick={() => move(i, 1)} aria-label="لتحت"><FiArrowDown /></button>
                  </span>
                </div>
              ))}
            </div>
            <p className="fx-muted" style={{ margin: 0 }}>تقريبًا {num(pv.total_km)} كم لآخر وقفة. المواعيد تقريبية وبتتحدث لما السائق يطلع.</p>
            {over && <label className="fx-row"><input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} /> بعرف إنها فوق السعة، كمّل</label>}
          </>
        )}
        <Err msg={err} />
        <Act
          className="fx-btn pri block"
          disabled={!pv || (over && !force)}
          onClick={async () => {
            const r = await fapi.createTrip({ vehicle_id: vehicle, order_ids: ids, date: day, depart_time: depart, force });
            fx.toast("اعتمدت الرحلة ووصلت للسائق");
            onSaved(r);
          }}
        >
          اعتمد الرحلة
        </Act>
      </div>
    </Sheet>
  );
}

// ---------- نقل طلب لسيارة ثانية ----------
const REASONS = ["السيارة امتلت", "عطل بالسيارة", "السائق غايب", "أقرب لخط السيارة الثانية", "طلب الزبون"];
export function TransferSheet({ o, onClose, onSaved }) {
  const fx = useFx();
  const from = fx.boot.vehicles.find((v) => v.id === o.vehicle_id);
  const list = useMemo(
    () => fx.boot.vehicles.filter((v) => v.status === "active" && v.id !== o.vehicle_id).sort((a, b) => (b.governorate === from?.governorate) - (a.governorate === from?.governorate)),
    [fx.boot.vehicles, o.vehicle_id, from?.governorate]
  );
  const [to, setTo] = useState(null);
  const [reason, setReason] = useState("");
  return (
    <Sheet title={`نقل طلب #${o.id}`} onClose={onClose}>
      <div className="fx-stack">
        <p style={{ margin: 0 }}>{o.customer_name} · {num(o.cartons)} كرتونة. هلأ مع <b>{o.vehicle_name} ({o.driver_name || "بدون سائق"})</b>.</p>
        <div className="fx-field">انقله لـ
          <div className="fx-hscroll">
            {list.map((v) => (
              <button key={v.id} className={`fx-pick ${to === v.id ? "on" : ""}`} onClick={() => setTo(v.id)}>
                <b>{v.name}</b><span>{v.driver_name || "بدون سائق"}</span><span>{v.governorate}{v.governorate === from?.governorate ? " · نفس المحافظة" : ""}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="fx-field">السبب
          <div className="fx-chips">{REASONS.map((r) => <button key={r} className={`fx-chip ${reason === r ? "on" : ""}`} onClick={() => setReason(r)}>{r}</button>)}</div>
        </div>
        {o.status === "onway" && <div className="fx-note warn">الكراتين محمّلة على السيارة الأولى. بيوصل تنبيه عشان تنتقل للسيارة الثانية.</div>}
        <Act className="fx-btn pri block" disabled={!to || !reason} onClick={async () => {
          const r = await fapi.transfer(o.id, { vehicle_id: to, reason });
          fx.toast("انتقل الطلب ووصل السائقين");
          onSaved(r);
        }}>انقل وبلّغ</Act>
      </div>
    </Sheet>
  );
}

// طلبات التأجيل من السواقين: «الزبون بده إياه بعد ٤ أيام» — ثبّت الموعد أو ارفض
function PostponeCard({ onDone }) {
  const fx = useFx();
  const { data, reload } = useLoad(() => fapi.postpones(), []);
  const [dates, setDates] = useState({});
  if (!data?.length) return null;
  return (
    <section className="fx-card fx-stack" style={{ gap: 10, borderInlineStart: "4px solid var(--fx-sky)" }}>
      <b>🗓️ طلبات تأجيل من السواقين ({data.length})</b>
      {data.map((p) => {
        const d = dates[p.id] ?? p.postpone_to;
        return (
          <div key={p.id} className="fx-stack" style={{ gap: 6, paddingBottom: 8, borderBottom: "1px solid var(--fx-line, #eee)" }}>
            <div className="fx-row" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
              <span><b>{p.customer_name}</b> <small className="fx-muted">#{p.id} · {num(p.cartons)} كرتونة</small><br />
                <small className="fx-muted">{p.driver_name || "السائق"}: بده إياه {date(p.postpone_to)}{p.postpone_note ? ` — ${p.postpone_note}` : ""}</small></span>
            </div>
            <DateInput value={d} onChange={(v) => setDates({ ...dates, [p.id]: v })} ariaLabel="موعد التسليم" />
            <div className="fx-grid2">
              <Act className="fx-btn ok" disabled={!d} onClick={async () => { await fapi.confirmPostpone(p.id, d); fx.toast(`انثبّت على ${date(d)} ✓`); reload(); onDone?.(); }}>✓ ثبّت الموعد</Act>
              <Act className="fx-btn" onClick={async () => { if (!confirm("ما بدك تأجّله؟ الطلب بيضل «ما تم».")) return; await fapi.rejectPostpone(p.id); reload(); onDone?.(); }}>ما بدنا</Act>
            </div>
          </div>
        );
      })}
    </section>
  );
}
