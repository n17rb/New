import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { FiPlus, FiChevronRight, FiChevronLeft, FiTruck, FiCheck, FiX } from "react-icons/fi";
import { api } from "../api.js";
import { useFeature, usePerms } from "../auth.jsx";
import Sheet from "../components/Sheet.jsx";

const money = (n) => Number(n || 0).toFixed(2);
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Amman" });
const shift = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const dayTitle = (d, isToday) => (isToday ? "اليوم" : new Date(`${d}T12:00:00Z`).toLocaleDateString("ar-JO", { weekday: "long", day: "numeric", month: "long" }));
const KIND = { in: "دخل بضاعة", load: "تحميل سيارة", return: "مرتجع سيارة", shop_sale: "بيع المحل", damage: "تالف", adjust: "جرد" };

// ============================================================
// المحطة: الملخص (محطة + مركبات + إجمالي + ربح) والمخزون
// ============================================================
export default function Station() {
  const hasStock = useFeature("station_stock");
  const [tab, setTab] = useState("sum");
  return (
    <div className="page">
      <h1 className="title-lg">المحطة</h1>
      {hasStock && (
        <div className="seg" style={{ marginBottom: 14 }}>
          <button type="button" className={tab === "sum" ? "on" : ""} onClick={() => setTab("sum")}>الملخص</button>
          <button type="button" className={tab === "stock" ? "on" : ""} onClick={() => setTab("stock")}>المخزون</button>
        </div>
      )}
      {tab === "sum" ? <Summary /> : <Stock />}
    </div>
  );
}

function Summary() {
  const [date, setDate] = useState(today());
  const [d, setD] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => { setD(null); api.stSummary(date).then(setD).catch((e) => setError(e.message)); }, [date]);
  if (error) return <div className="error-box">{error}</div>;

  return (
    <>
      <div className="date-nav">
        <button className="icon-btn" onClick={() => setDate(shift(date, -1))} aria-label="اليوم اللي قبل"><FiChevronRight /></button>
        <div style={{ flex: 1, textAlign: "center", fontWeight: 700 }}>{d ? dayTitle(d.date, d.is_today) : "…"}</div>
        <button className="icon-btn" onClick={() => setDate(shift(date, 1))} disabled={date >= today()} aria-label="اليوم اللي بعد"><FiChevronLeft /></button>
      </div>
      {!d ? <p className="text-secondary">جاري الحساب…</p> : (
        <>
          <div className="stn-hero">
            <div><span>مجموع المبيعات</span><b className="tabular-num">{money(d.sales_total)}<small> JD</small></b></div>
            {d.features.station_stock && <div><span>الربح</span><b className="tabular-num green">{money(d.profit_total)}<small> JD</small></b></div>}
          </div>

          <div className="stn-two">
            <div className="stn-box">
              <div className="stn-box-h">🏪 مبيعات المحطة</div>
              <b className="tabular-num">{money(d.shop.total)} <small>JD</small></b>
              <small>{d.shop.count} بيعة</small>
              {d.shop.products.map((p) => <div key={p.product_id} className="stn-line tabular-num"><span>{p.name}</span><span>{p.qty}</span></div>)}
            </div>
            <div className="stn-box">
              <div className="stn-box-h">🚚 مبيعات المركبات</div>
              <b className="tabular-num">{money(d.vehicles.total)} <small>JD</small></b>
              <small>{d.vehicles.stops} زبون · كاش {money(d.vehicles.cash)}{d.vehicles.debt ? ` · دين ${money(d.vehicles.debt)}` : ""}</small>
              {d.vehicles.products.map((p) => <div key={p.product_id} className="stn-line tabular-num"><span>{p.name}</span><span>{p.qty}</span></div>)}
            </div>
          </div>

          {d.on_vehicles.length > 0 && (
            <>
              <div className="section-title">بالسيارات هلّق</div>
              <div className="list-group">
                {d.on_vehicles.map((v) => (
                  <Link key={v.round_id} to={`/vehicles/${v.vehicle_id}`} className="list-row">
                    <span className="list-icon"><FiTruck aria-hidden="true" /></span>
                    <span className="list-text">
                      <span className="list-title">{v.vehicle_name} · جولة {v.round_no}</span>
                      <div className="list-sub tabular-num">{v.driver_name} · {v.lines.map((l) => `${l.remaining} ${l.name}`).join("، ")}</div>
                    </span>
                    <span className="tabular-num" style={{ fontWeight: 800 }}>{money(v.cash)}</span>
                  </Link>
                ))}
              </div>
            </>
          )}

          {d.totals.length > 0 && (
            <>
              <div className="section-title">المخزون: المحطة + السيارات</div>
              <div className="card" style={{ padding: 10 }}>
                <table className="vh-table tabular-num">
                  <thead><tr><th>الصنف</th><th>بالمحطة</th><th>بالسيارات</th><th>المجموع</th></tr></thead>
                  <tbody>
                    {d.totals.map((t) => (
                      <tr key={t.name}><td>{t.name}</td><td>{t.station}</td><td>{t.vehicles || "—"}</td><td><b>{t.total}</b></td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {d.features.station_stock && d.profit.length > 0 && (
            <>
              <div className="section-title">الربح حسب سعر الجملة</div>
              <div className="card" style={{ padding: 10 }}>
                <table className="vh-table tabular-num">
                  <thead><tr><th>الصنف</th><th>انباع</th><th>البيع</th><th>الجملة</th><th>الربح</th></tr></thead>
                  <tbody>
                    {d.profit.map((p) => (
                      <tr key={p.product_id}>
                        <td>{p.name}</td><td>{p.qty}</td><td>{money(p.revenue)}</td><td>{p.has_cost ? money(p.cost) : "—"}</td>
                        <td><b className={p.profit < 0 ? "red" : "green"}>{money(p.profit)}</b></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {d.profit.some((p) => !p.has_cost) && <div className="text-secondary" style={{ fontSize: "0.75rem", marginTop: 6 }}>«—» يعني الصنف مش مربوط بسعر جملة بالمخزون، فربحه محسوب كامل.</div>}
              </div>
              <div className="stn-cap">رأس مال المحطة (المخزون بسعر الجملة): <b className="tabular-num">{money(d.capital)} JD</b></div>
            </>
          )}
        </>
      )}
    </>
  );
}

// ============================================================
// المخزون
// ============================================================
function Stock() {
  const { canEdit } = usePerms();
  const editable = canEdit("station");
  const [d, setD] = useState(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [editing, setEditing] = useState(null); // صنف أو {}
  const [moving, setMoving] = useState(null); // {item, kind}
  const [history, setHistory] = useState(null);

  const load = () => api.stStock().then(setD).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);
  const flash = (m) => { setMsg(m); setTimeout(() => setMsg(""), 6000); load(); };

  if (!d) return error ? <div className="error-box">{error}</div> : <p className="text-secondary">جاري التحميل…</p>;

  return (
    <>
      {msg && <div className="success-box">{msg}</div>}
      {error && <div className="error-box">{error}</div>}

      <div className="stn-hero">
        <div><span>رأس المال (بسعر الجملة)</span><b className="tabular-num">{money(d.capital)}<small> JD</small></b></div>
        {editable && <button type="button" className="pr-add" onClick={() => setEditing({})}><FiPlus aria-hidden="true" /> صنف</button>}
      </div>

      {d.pending.length > 0 && (
        <div className="stn-pending">
          <div className="stn-pending-h">🧯 توالف بتستنى موافقة</div>
          {d.pending.map((m) => (
            <div key={m.id} className="stn-pend-row">
              <span className="stn-pend-t"><b>{-m.qty} {m.unit} {m.name}</b><small>{m.by_name || "—"}{m.note ? ` · ${m.note}` : ""}</small></span>
              {d.can_approve ? (
                <>
                  <button type="button" className="stn-ok" onClick={() => api.stDecide(m.id, "approve").then(() => flash("✅ انقبل التالف وانخصم")).catch((e) => setError(e.message))} aria-label="موافق"><FiCheck /></button>
                  <button type="button" className="stn-no" onClick={() => api.stDecide(m.id, "reject").then(() => flash("انرفض التالف")).catch((e) => setError(e.message))} aria-label="رفض"><FiX /></button>
                </>
              ) : <small className="text-secondary">بيستنى</small>}
            </div>
          ))}
        </div>
      )}

      {d.items.length === 0 && <div className="pr-empty">ما في أصناف لسا — ضيف (مثلًا جالون، قارورة، كرتونة، شرنك، فلتر، أغطية)</div>}
      <div className="pr-list">
        {d.items.map((it) => {
          const low = it.low_alert > 0 && it.qty <= it.low_alert;
          return (
            <div key={it.id} className={`stn-item${low ? " low" : ""}`}>
              <button type="button" className="stn-item-main" onClick={() => setHistory(it)}>
                <span className="stn-item-t">
                  <b>{it.name}</b>
                  <small className="tabular-num">
                    جملة {money(it.cost_price)}{it.sale_price != null ? ` · بيع ${money(it.sale_price)}` : ""} · قيمته {money(it.value)}
                    {it.pending_damage ? ` · ${it.pending_damage} تالف بيستنى` : ""}
                  </small>
                </span>
                <span className={`stn-qty tabular-num${low ? " low" : ""}`}><b>{it.qty}</b><small>{it.unit}{low ? " ⚠️" : ""}</small></span>
              </button>
              {editable && (
                <div className="stn-item-acts">
                  <button type="button" onClick={() => setMoving({ item: it, kind: "in" })}>+ إدخال</button>
                  <button type="button" onClick={() => setMoving({ item: it, kind: "count" })}>جرد</button>
                  <button type="button" className="red" onClick={() => setMoving({ item: it, kind: "damage" })}>تالف</button>
                  <button type="button" onClick={() => setEditing(it)}>تعديل</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="pr-note">المخزون بينخصم لحاله: تحميل السيارات، بيع المحل، والتوالف (بعد الموافقة). والمرتجع بيرجع عليه. بيوصلك تنبيه لما أي صنف يوصل حد التنبيه.</p>

      <ItemSheet open={!!editing} item={editing} products={d.products} onClose={() => setEditing(null)} onSaved={(m) => { setEditing(null); flash(m); }} />
      <MoveSheet open={!!moving} move={moving} onClose={() => setMoving(null)} onSaved={(m) => { setMoving(null); flash(m); }} />
      <HistorySheet item={history} onClose={() => setHistory(null)} />
    </>
  );
}

function ItemSheet({ open, item, products, onClose, onSaved }) {
  const isNew = item && !item.id;
  const [f, setF] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open || !item) return;
    setError("");
    setF({ name: item.name || "", product_id: item.product_id || "", unit: item.unit || "حبة", cost_price: item.cost_price != null ? String(item.cost_price) : "", low_alert: item.low_alert != null ? String(item.low_alert) : "100", opening_qty: "" });
  }, [open, item?.id]);
  if (!item) return null;
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function save() {
    setBusy(true);
    setError("");
    try {
      const body = { ...f, product_id: f.product_id ? Number(f.product_id) : null };
      if (isNew) await api.stAddItem(body);
      else await api.stUpdateItem(item.id, body);
      onSaved(isNew ? "✅ انضاف الصنف" : "✅ انحفظ");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function archive() {
    setBusy(true);
    try { await api.stUpdateItem(item.id, { status: "archived" }); onSaved("انشال الصنف"); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <Sheet open={open} title={isNew ? "صنف جديد بالمحطة" : `تعديل ${item.name}`} onClose={onClose}>
      {error && <div className="error-box">{error}</div>}
      <label className="pr-field"><span>الاسم</span><input value={f.name || ""} onChange={set("name")} placeholder="مثلًا كرتونة مي ٥٠٠ مل" /></label>
      <label className="pr-field">
        <span>مربوط بمنتج بيتباع؟ <small>(عشان ينخصم لحاله مع التحميل والبيع)</small></span>
        <select className="stn-select" value={f.product_id || ""} onChange={(e) => {
          const p = products.find((x) => String(x.id) === e.target.value);
          setF((x) => ({ ...x, product_id: e.target.value, name: x.name || p?.name || "" }));
        }}>
          <option value="">لا — صنف لحاله (فلاتر، أغطية…)</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <div className="loc-two">
        <label className="pr-field"><span>سعر الجملة (عليك)</span><input type="number" inputMode="decimal" step="0.001" min="0" value={f.cost_price || ""} onChange={set("cost_price")} placeholder="0.00" dir="ltr" /></label>
        <label className="pr-field"><span>الوحدة</span><input value={f.unit || ""} onChange={set("unit")} placeholder="حبة" /></label>
      </div>
      <div className="loc-two">
        <label className="pr-field"><span>نبّهني لما يوصل</span><input type="number" inputMode="numeric" min="0" value={f.low_alert || ""} onChange={set("low_alert")} placeholder="100" dir="ltr" /></label>
        {isNew && <label className="pr-field"><span>الموجود هلّق</span><input type="number" inputMode="numeric" min="0" value={f.opening_qty || ""} onChange={set("opening_qty")} placeholder="0" dir="ltr" /></label>}
      </div>
      <div className="sheet-actions">
        <button className="btn-primary" disabled={busy || !String(f.name || "").trim()} onClick={save}>{isNew ? "إضافة" : "حفظ"}</button>
        <button className="btn-secondary" onClick={onClose}>رجوع</button>
      </div>
      {!isNew && <button type="button" className="pr-archive" disabled={busy} onClick={archive}>شيل الصنف</button>}
    </Sheet>
  );
}

function MoveSheet({ open, move, onClose, onSaved }) {
  const [qty, setQty] = useState("");
  const [cost, setCost] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { if (open) { setQty(move?.kind === "count" ? String(move.item.qty) : ""); setCost(""); setNote(""); setError(""); } }, [open, move?.item?.id, move?.kind]);
  if (!move) return null;
  const { item, kind } = move;
  const titles = { in: `إدخال ${item.name}`, count: `جرد ${item.name}`, damage: `تالف ${item.name}` };

  async function save() {
    setBusy(true);
    setError("");
    try {
      const body = kind === "count" ? { kind, actual: Number(qty), note } : { kind, qty: Number(qty), note, ...(kind === "in" && cost !== "" ? { unit_cost: Number(cost) } : {}) };
      await api.stMove(item.id, body);
      onSaved(kind === "in" ? "✅ انضافت البضاعة" : kind === "count" ? "✅ انحفظ الجرد" : "✅ انسجّل التالف");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} title={titles[kind]} onClose={onClose}>
      {error && <div className="error-box">{error}</div>}
      <p className="text-secondary" style={{ marginTop: 0, fontSize: "0.82rem" }}>
        {kind === "count" ? `بالنظام: ${item.qty} ${item.unit} — اكتب العدد الفعلي اللي عدّيته` : kind === "damage" ? "التالف بينخصم بعد موافقة الإدارة" : `الموجود هلّق: ${item.qty} ${item.unit}`}
      </p>
      <label className="pr-field"><span>{kind === "count" ? "العدد الفعلي" : "الكمية"}</span>
        <input type="number" inputMode="numeric" min="0" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus dir="ltr" />
      </label>
      {kind === "in" && (
        <label className="pr-field"><span>سعر الجملة للحبة <small>(اختياري — آخر سعر {money(item.cost_price)})</small></span>
          <input type="number" inputMode="decimal" step="0.001" min="0" value={cost} onChange={(e) => setCost(e.target.value)} placeholder={money(item.cost_price)} dir="ltr" />
        </label>
      )}
      <label className="pr-field"><span>ملاحظة (اختياري)</span><input value={note} onChange={(e) => setNote(e.target.value)} placeholder={kind === "damage" ? "شو صار؟" : ""} /></label>
      <div className="sheet-actions">
        <button className="btn-primary" style={kind === "damage" ? { background: "var(--urgent)" } : undefined} disabled={busy || qty === "" || (kind !== "count" && !(Number(qty) > 0))} onClick={save}>أكّد</button>
        <button className="btn-secondary" onClick={onClose}>رجوع</button>
      </div>
    </Sheet>
  );
}

function HistorySheet({ item, onClose }) {
  const [rows, setRows] = useState(null);
  useEffect(() => { setRows(null); if (item) api.stItemMoves(item.id).then(setRows).catch(() => setRows([])); }, [item?.id]);
  return (
    <Sheet open={!!item} title={item ? `حركة ${item.name}` : ""} onClose={onClose}>
      {!rows ? <p className="text-secondary">جاري التحميل…</p> : rows.length === 0 ? <p className="text-secondary">ما في حركات لسا</p> : (
        <div className="stn-hist">
          {rows.map((m) => (
            <div key={m.id} className={`stn-hist-row${m.status !== "approved" ? " dim" : ""}`}>
              <span><b>{KIND[m.kind]}</b>{m.status === "pending" ? " (بيستنى)" : m.status === "rejected" ? " (مرفوض)" : ""}<small>{new Date(m.created_at).toLocaleString("ar-JO", { timeZone: "Asia/Amman", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })} · {m.by_name || "—"}{m.note ? ` · ${m.note}` : ""}</small></span>
              <b className={`tabular-num ${m.qty > 0 ? "green" : "red"}`}>{m.qty > 0 ? `+${m.qty}` : m.qty}</b>
            </div>
          ))}
        </div>
      )}
      <button className="btn-secondary" style={{ marginTop: 12 }} onClick={onClose}>رجوع</button>
    </Sheet>
  );
}
