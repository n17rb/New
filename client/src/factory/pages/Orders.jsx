import { useEffect, useMemo, useState } from "react";
import { FiPlus, FiCheck, FiArrowUp, FiArrowDown, FiInfo, FiTrash2, FiSearch, FiShuffle } from "react-icons/fi";
import { fapi } from "../fapi.js";
import { useFx, useLoad, Sheet, Tip, Err, Loading, Empty, Act, StatusPill, ORDER_STATUS, SendMessages, money, num, time, date, today } from "../ui.jsx";

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

  const open = data || [];
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

  return (
    <div className="fx-page">
      <div className="fx-row" style={{ justifyContent: "space-between" }}>
        <h1 className="fx-h1">الطلبات</h1>
        {editOrders && <button className="fx-btn pri sm" data-hl="new-order" onClick={() => setSheet({ kind: "new" })}><FiPlus /> طلب جديد</button>}
      </div>
      <Tip id="orders">{dispatch ? "علّم على أكثر من طلب واكبس «رحلة جديدة» عشان تخصصهم لسيارة وحدة. الطلب اللي على سيارة بتنقله لسائق ثاني من «نقل»." : "سجّل طلبات الزباين هون، ومسؤول الحركة بيوزعها على السيارات."}</Tip>
      <Err msg={error} />
      {!data && !error && <Loading />}

      {data && (
        <>
          <div className="fx-sec"><h2>جديدة ({free.length})</h2>{dispatch && free.length > 1 && <button className="fx-link" onClick={() => setSel(sel.length === free.length ? [] : free.map((o) => o.id))}>{sel.length === free.length ? "إلغاء التحديد" : "حدد الكل"}</button>}</div>
          <div className="fx-list" data-hl="orders-list">
            {free.length === 0 && <div className="fx-item"><span className="fx-muted">كل الطلبات موزّعة على السيارات.</span></div>}
            {free.map((o) => (
              <OrderRow key={o.id} o={o} selectable={dispatch} on={sel.includes(o.id)} onToggle={() => toggle(o.id)} onInfo={() => setSheet({ kind: "info", o })} />
            ))}
          </div>

          <div className="fx-sec"><h2>على السيارات ({assigned.length})</h2></div>
          <div className="fx-list" data-hl="assigned-list">
            {assigned.length === 0 && <div className="fx-item"><span className="fx-muted">ولا طلب على سيارة لسا.</span></div>}
            {assigned.map((o) => (
              <div key={o.id} className="fx-item">
                <span className="t">
                  <b>{o.customer_name}</b>
                  <span>{o.city} · {itemsLine(o)}</span>
                  <span className="fx-row" style={{ gap: 6 }}>
                    <StatusPill map={ORDER_STATUS} value={o.status} />
                    <span className="fx-pill">{o.vehicle_name} · {o.driver_name || "بدون سائق"}</span>
                    {o.eta_at && <span className="fx-pill">يوصل {time(o.eta_at)}</span>}
                  </span>
                </span>
                <span className="end">
                  {dispatch && <button className="fx-btn sm" onClick={() => setSheet({ kind: "move", o })}><FiShuffle /> نقل</button>}
                  <button className="fx-link" onClick={() => setSheet({ kind: "info", o })}>تفاصيل</button>
                </span>
              </div>
            ))}
          </div>

          <div className="fx-sec"><h2>خلصت آخر ٣ أيام</h2>{!done && <button className="fx-link" onClick={() => fapi.orders({ scope: "done" }).then(setDone)}>اعرض</button>}</div>
          {done && (
            <div className="fx-list">
              {done.length === 0 && <div className="fx-item"><span className="fx-muted">ولا إشي.</span></div>}
              {done.map((o) => (
                <div key={o.id} className="fx-item">
                  <span className="t">
                    <b>{o.customer_name}</b>
                    <span>{itemsLine(o)}{o.fail_reason ? ` · ${o.fail_reason}` : ""}</span>
                  </span>
                  <span className="end">
                    <StatusPill map={ORDER_STATUS} value={o.status} />
                    {o.status === "failed" && dispatch && <Act className="fx-link" onClick={async () => { await fapi.reopenOrder(o.id); fx.toast("رجع للطلبات الجديدة"); setDone(null); reload(); }}>رجّعه للتوزيع</Act>}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {dispatch && sel.length > 0 && (
        <div className="fx-selbar">
          <span className="fx-grow">محدد <b>{sel.length}</b> طلب · <b className="fx-num">{num(selCartons)}</b> كرتونة</span>
          <button className="fx-btn sm" onClick={() => setSel([])}>إلغاء</button>
          <button className="fx-btn pri sm" data-hl="build-trip" onClick={() => setSheet({ kind: "trip" })}>رحلة جديدة</button>
        </div>
      )}

      {sheet?.kind === "new" && <OrderSheet onClose={() => setSheet(null)} onSaved={after} />}
      {sheet?.kind === "edit" && <OrderSheet order={sheet.o} onClose={() => setSheet(null)} onSaved={after} />}
      {sheet?.kind === "info" && <OrderInfo o={sheet.o} onClose={() => setSheet(null)} onEdit={() => setSheet({ kind: "edit", o: sheet.o })} onChanged={after} />}
      {sheet?.kind === "trip" && <TripBuilder orderIds={sel} orders={open} onClose={() => setSheet(null)} onSaved={after} />}
      {sheet?.kind === "move" && <TransferSheet o={sheet.o} onClose={() => setSheet(null)} onSaved={after} />}
      {msgs && <SendMessages ids={msgs} onClose={() => setMsgs(null)} />}
    </div>
  );
}

export function itemsLine(o) {
  return o.items.map((i) => `${num(i.qty)} ${i.name}`).join("، ");
}

function OrderRow({ o, selectable, on, onToggle, onInfo }) {
  return (
    <div className={`fx-item ${on ? "on" : ""}`}>
      {selectable && (
        <button className="fx-check" style={{ cursor: "pointer", background: on ? "var(--fx-navy)" : "none" }} onClick={onToggle} role="checkbox" aria-checked={on} aria-label={`اختار ${o.customer_name}`}>
          {on && <FiCheck />}
        </button>
      )}
      <button className="t" style={{ background: "none", border: 0, textAlign: "start", font: "inherit", color: "inherit", cursor: "pointer", padding: 0 }} onClick={selectable ? onToggle : onInfo}>
        <b>{o.customer_name}</b>
        <span>{o.city || "بدون مدينة"} · {itemsLine(o)}</span>
        <span className="fx-row" style={{ gap: 6 }}>
          {o.urgent && <span className="fx-pill crit">مستعجل</span>}
          {o.status === "delayed" && <span className="fx-pill warn">مؤجل{o.delay_reason ? `: ${o.delay_reason}` : ""}</span>}
          <span className="fx-pill">{date(o.due_date)}</span>
        </span>
      </button>
      <button className="fx-icon-btn" onClick={onInfo} aria-label="تفاصيل"><FiInfo /></button>
    </div>
  );
}

// ---------- طلب جديد / تعديل ----------
function OrderSheet({ order, onClose, onSaved }) {
  const fx = useFx();
  const products = fx.boot.products.filter((p) => p.active);
  const [q, setQ] = useState("");
  const [list, setList] = useState([]);
  const [cust, setCust] = useState(order ? { id: order.customer_id, name: order.customer_name, city: order.city } : null);
  const [items, setItems] = useState(order ? order.items.map((i) => ({ product_id: i.product_id, qty: i.qty })) : [{ product_id: products[0]?.id || "", qty: "" }]);
  const [due, setDue] = useState(order?.due_date || today());
  const [urgent, setUrgent] = useState(!!order?.urgent);
  const [notes, setNotes] = useState(order?.notes || "");
  const [err, setErr] = useState("");

  useEffect(() => {
    if (cust) return;
    const t = setTimeout(() => fapi.customers({ q }).then(setList).catch(() => {}), 250);
    return () => clearTimeout(t);
  }, [q, cust]);

  const setItem = (i, k, v) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, [k]: v } : x)));

  async function save() {
    setErr("");
    const body = { customer_id: cust?.id, items: items.filter((i) => i.product_id && Number(i.qty) > 0), due_date: due, urgent, notes };
    try {
      if (order) {
        await fapi.updateOrder(order.id, body);
        fx.toast("انحفظ التعديل");
        onSaved();
      } else {
        const r = await fapi.createOrder(body);
        fx.toast("انسجل الطلب");
        onSaved({ message_ids: [r.message_id] });
      }
    } catch (e) {
      setErr(e.message);
    }
  }

  return (
    <Sheet title={order ? `تعديل طلب #${order.id}` : "طلب جديد"} onClose={onClose}>
      <div className="fx-stack">
        {!cust ? (
          <>
            <label className="fx-field">الزبون
              <span className="fx-row" style={{ flexWrap: "nowrap" }}><FiSearch style={{ color: "var(--fx-muted)" }} /><input className="fx-input" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="اسم المحل أو التلفون أو المدينة" /></span>
            </label>
            <div className="fx-list" style={{ maxHeight: 260, overflow: "auto" }}>
              {list.map((c) => (
                <button key={c.id} className="fx-item" onClick={() => setCust(c)}>
                  <span className="t"><b>{c.name}</b><span>{c.city || ""}{c.line_name ? ` · ${c.line_name}` : ""}</span></span>
                </button>
              ))}
              {list.length === 0 && <div className="fx-item"><span className="fx-muted">ما لقيت. ضيف الزبون من شاشة الزباين أول.</span></div>}
            </div>
          </>
        ) : (
          <div className="fx-card soft fx-row">
            <span className="fx-grow"><b>{cust.name}</b><br /><span className="fx-muted">{cust.city}</span></span>
            {!order && <button className="fx-link" onClick={() => setCust(null)}>غيّر</button>}
          </div>
        )}

        {items.map((it, i) => (
          <div key={i} className="fx-row" style={{ flexWrap: "nowrap" }}>
            <select className="fx-grow" value={it.product_id} onChange={(e) => setItem(i, "product_id", Number(e.target.value))} aria-label="المنتج">
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <input className="fx-input" style={{ width: 110 }} type="number" inputMode="numeric" min="1" value={it.qty} placeholder="كراتين" onChange={(e) => setItem(i, "qty", e.target.value)} aria-label="عدد الكراتين" />
            {items.length > 1 && <button className="fx-icon-btn" onClick={() => setItems((xs) => xs.filter((_, j) => j !== i))} aria-label="شيل"><FiTrash2 /></button>}
          </div>
        ))}
        <button className="fx-link" style={{ justifySelf: "start" }} onClick={() => setItems((xs) => [...xs, { product_id: products[0]?.id || "", qty: "" }])}>+ منتج ثاني</button>

        <div className="fx-field">موعد التوصيل
          <div className="fx-chips">
            <button className={`fx-chip ${due === today() ? "on" : ""}`} onClick={() => setDue(today())}>اليوم</button>
            <button className={`fx-chip ${due === tomorrow() ? "on" : ""}`} onClick={() => setDue(tomorrow())}>بكرا</button>
            <input className="fx-input" style={{ width: "auto" }} type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="تاريخ" />
          </div>
        </div>
        <label className="fx-row"><input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} /> مستعجل</label>
        <label className="fx-field">ملاحظة (اختياري)<input className="fx-input" value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        <Err msg={err} />
        <Act className="fx-btn pri block" onClick={save} disabled={!cust}>{order ? "احفظ" : "سجّل الطلب"}</Act>
      </div>
    </Sheet>
  );
}

function OrderInfo({ o, onClose, onEdit, onChanged }) {
  const fx = useFx();
  const canEdit = (fx.can("f_orders", "edit") || fx.can("f_dispatch", "edit")) && ["new", "assigned", "delayed"].includes(o.status);
  return (
    <Sheet title={`طلب #${o.id}`} onClose={onClose}>
      <div className="fx-stack">
        <div className="fx-card">
          <div className="fx-kv"><span>الزبون</span><b>{o.customer_name}</b></div>
          <div className="fx-kv"><span>المدينة</span><b>{o.city || "—"}</b></div>
          {o.items.map((i) => <div key={i.id} className="fx-kv"><span>{i.name}</span><b>{num(i.qty)} × {money(i.price)}</b></div>)}
          <div className="fx-kv total"><span>المجموع</span><b>{money(o.total)} د.أ</b></div>
        </div>
        <div className="fx-row"><StatusPill map={ORDER_STATUS} value={o.status} />{o.vehicle_name && <span className="fx-pill">{o.vehicle_name}</span>}{o.eta_at && <span className="fx-pill">يوصل {time(o.eta_at)}</span>}</div>
        {o.notes && <div className="fx-note">{o.notes}</div>}
        {canEdit && <button className="fx-btn block" onClick={onEdit}>عدّل الطلب</button>}
        {canEdit && (
          <Act className="fx-btn danger block" onClick={async () => { await fapi.cancelOrder(o.id, "انلغى من الإدارة"); fx.toast("انلغى الطلب"); onChanged(); }}>
            إلغاء الطلب
          </Act>
        )}
      </div>
    </Sheet>
  );
}

// ---------- بناء رحلة: الطلبات المحددة على سيارة وحدة ----------
function TripBuilder({ orderIds, onClose, onSaved }) {
  const fx = useFx();
  const vehicles = fx.boot.vehicles.filter((v) => v.status === "active");
  const [vehicle, setVehicle] = useState(() => vehicles.find((v) => v.driver_id)?.id || vehicles[0]?.id);
  const [ids, setIds] = useState(orderIds);
  const [day, setDay] = useState(today());
  const [depart, setDepart] = useState("08:00");
  const [pv, setPv] = useState(null);
  const [err, setErr] = useState("");
  const [force, setForce] = useState(false);

  async function preview(sort = false) {
    if (!vehicle) return;
    try {
      const r = await fapi.previewTrip({ vehicle_id: vehicle, order_ids: ids, sort, date: day, depart_time: depart });
      setPv(r);
      if (sort) {
        setIds(r.stops.map((s) => s.id));
        fx.toast("ترتبت من الأقرب للأبعد");
      }
      setErr("");
    } catch (e) {
      setErr(e.message);
    }
  }
  useEffect(() => { preview(false); }, [vehicle, ids.join(","), day, depart]); // eslint-disable-line react-hooks/exhaustive-deps

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
    <Sheet title="رحلة جديدة" onClose={onClose}>
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
