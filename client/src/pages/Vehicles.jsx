import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { FiPlus, FiTruck, FiChevronLeft, FiArrowRight, FiCornerDownLeft, FiAlertTriangle } from "react-icons/fi";
import { api } from "../api.js";
import { useFeature } from "../auth.jsx";
import Sheet from "../components/Sheet.jsx";

const money = (n) => Number(n || 0).toFixed(2);
const time = (d) => new Date(d).toLocaleTimeString("ar-JO", { timeZone: "Asia/Amman", hour: "numeric", minute: "2-digit" });
const day = (d) => new Date(d).toLocaleDateString("ar-JO", { timeZone: "Asia/Amman", weekday: "short", day: "numeric", month: "short" });

// كميات بستيبر (+ / −)
function QtyList({ products, qty, setQty, hint }) {
  const change = (id, d) => setQty((q) => ({ ...q, [id]: Math.max(0, (Number(q[id]) || 0) + d) }));
  return (
    <div className="ei-list">
      {products.map((p) => (
        <div key={p.id} className={`ei-row${qty[p.id] ? " on" : ""}`}>
          <div className="ei-name">
            <b>{p.name}</b>
            {hint?.(p) && <small>{hint(p)}</small>}
          </div>
          <div className="ei-step">
            <button type="button" className="step-btn" onClick={() => change(p.id, -1)} aria-label="أقل">−</button>
            <input className="vh-qty tabular-num" inputMode="numeric" value={qty[p.id] ?? 0}
              onChange={(e) => setQty((q) => ({ ...q, [p.id]: Math.max(0, parseInt(e.target.value.replace(/\D/g, ""), 10) || 0) }))} aria-label={`كمية ${p.name}`} />
            <button type="button" className="step-btn plus" onClick={() => change(p.id, 1)} aria-label="أكثر">+</button>
          </div>
        </div>
      ))}
    </div>
  );
}

// شو بالسيارة هلّق (شرائح صغيرة)
function Contents({ lines }) {
  const shown = (lines || []).filter((l) => l.loaded > 0);
  if (!shown.length) return <span className="vh-empty">فاضية</span>;
  return (
    <div className="vh-chips">
      {shown.map((l) => (
        <span key={l.product_id} className={`vh-chip${l.remaining <= 0 ? " out" : ""}`}>
          <b className="tabular-num">{l.remaining}</b> {l.name}
        </span>
      ))}
    </div>
  );
}

// ============================================================
// قائمة السيارات
// ============================================================
export default function Vehicles() {
  const enabled = useFeature("vehicles");
  const [d, setD] = useState(null);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => api.stVehicles().then(setD).catch((e) => setError(e.message));
  useEffect(() => { if (enabled) load(); }, [enabled]);
  if (!enabled) return <div className="page"><div className="card text-secondary">هاي الميزة مش مفعّلة لمحلك.</div></div>;

  async function add() {
    setBusy(true);
    try {
      await api.stAddVehicle({ name: name.trim() });
      setAdding(false);
      setName("");
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <div className="pr-head">
        <div>
          <h1 className="title-lg" style={{ margin: 0 }}>السيارات</h1>
          <div className="pr-sub">شو بكل سيارة هلّق، والجولات</div>
        </div>
        {d?.can_edit && (
          <button type="button" className="pr-add" onClick={() => { setName(`سيارة ${(d.vehicles.length || 0) + 1}`); setAdding(true); }}>
            <FiPlus aria-hidden="true" /> سيارة
          </button>
        )}
      </div>
      {error && <div className="error-box">{error}</div>}
      {!d && !error && <p className="text-secondary">جاري التحميل…</p>}
      {d && d.vehicles.length === 0 && <div className="pr-empty">{d.can_edit ? "ما في سيارات لسا — ضيف «سيارة ١»" : "ما في جولة مفتوحة إلك هلّق"}</div>}

      <div className="vh-list">
        {(d?.vehicles || []).map((v) => (
          <Link key={v.id} to={`/vehicles/${v.id}`} className={`vh-card${v.round ? " on" : ""}`}>
            <div className="vh-top">
              <span className="vh-ic" aria-hidden="true"><FiTruck /></span>
              <span className="vh-t">
                <b>{v.name}</b>
                <small>{v.round ? `جولة ${v.round.round_no} · ${v.round.driver_name || "—"} · من ${time(v.round.opened_at)}` : v.rounds_today ? `فاضية · ${v.rounds_today} جولة اليوم` : "فاضية — بالمحطة"}</small>
              </span>
              <FiChevronLeft className="pr-chev" aria-hidden="true" />
            </div>
            {v.round && (
              <>
                <Contents lines={v.round.summary.lines} />
                <div className="vh-money tabular-num">
                  <span>كاش {money(v.round.summary.total_cash)}</span>
                  {v.round.summary.debt > 0 && <span className="red">دين {money(v.round.summary.debt)}</span>}
                  <span>{v.round.summary.stops} زبون</span>
                </div>
              </>
            )}
          </Link>
        ))}
      </div>

      <Sheet open={adding} title="سيارة جديدة" onClose={() => setAdding(false)}>
        <label className="pr-field">
          <span>اسم السيارة</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="سيارة ١" />
        </label>
        <div className="sheet-actions">
          <button className="btn-primary" disabled={!name.trim() || busy} onClick={add}>إضافة</button>
          <button className="btn-secondary" onClick={() => setAdding(false)}>رجوع</button>
        </div>
      </Sheet>
    </div>
  );
}

// ============================================================
// سيارة وحدة: الجولة الحالية (تحميل، زيادة، تالف، مرتجع) + آخر الجولات
// ============================================================
export function VehicleDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const stock = useFeature("station_stock");
  const [d, setD] = useState(null);
  const [meta, setMeta] = useState(null); // drivers + products
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [sheet, setSheet] = useState(null); // load | add | close | damage
  const [driver, setDriver] = useState(null);
  const [qty, setQty] = useState({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [openRound, setOpenRound] = useState(null);

  const load = () => api.stVehicle(id).then(setD).catch((e) => setError(e.message));
  useEffect(() => {
    load();
    api.stVehicles().then((r) => setMeta({ drivers: r.drivers, products: r.products })).catch(() => {});
  }, [id]);

  if (!d) return <div className="page">{error ? <div className="error-box">{error}</div> : <p className="text-secondary">جاري التحميل…</p>}</div>;
  const cur = d.rounds[0]?.status === "open" ? d.rounds[0] : null;
  const past = d.rounds.filter((r) => r !== cur);
  const products = meta?.products || [];

  function open(kind) {
    setError("");
    setNote("");
    if (kind === "load") {
      const last = d.rounds[0];
      setDriver(last?.driver_id || null);
      setQty({});
    } else if (kind === "close") {
      setQty(Object.fromEntries(cur.summary.lines.map((l) => [l.product_id, Math.max(0, l.remaining)])));
    } else {
      setQty({});
    }
    setSheet(kind);
  }

  async function run(fn, ok) {
    setBusy(true);
    setError("");
    try {
      const r = await fn();
      setSheet(null);
      setMsg(typeof ok === "function" ? ok(r) : ok);
      setTimeout(() => setMsg(""), 7000);
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const items = () => Object.entries(qty).filter(([, v]) => Number(v) > 0).map(([product_id, v]) => ({ product_id: Number(product_id), qty: Number(v) }));
  const curLine = (pid) => cur?.summary.lines.find((l) => l.product_id === pid);

  return (
    <div className="page">
      <button className="link-btn icon-row" style={{ marginBottom: 8 }} onClick={() => navigate("/vehicles")}><FiArrowRight aria-hidden="true" /> كل السيارات</button>
      <h1 className="title-lg" style={{ marginTop: 0 }}>{d.vehicle.name}</h1>
      {msg && <div className="success-box">{msg}</div>}
      {error && !sheet && <div className="error-box">{error}</div>}

      {cur ? (
        <div className="card vh-cur">
          <div className="vh-cur-h">
            <span className="trip-sum-live"><i aria-hidden="true" /> جولة {cur.round_no} شغّالة</span>
            <span className="text-secondary" style={{ fontSize: "0.8rem" }}>{cur.driver_name} · من {time(cur.opened_at)}</span>
          </div>
          <table className="vh-table tabular-num">
            <thead><tr><th>الصنف</th><th>حمّل</th><th>باع</th>{cur.summary.lines.some((l) => l.damaged) && <th>تالف</th>}<th>باقي</th></tr></thead>
            <tbody>
              {cur.summary.lines.map((l) => (
                <tr key={l.product_id}>
                  <td>{l.name}</td><td>{l.loaded}</td><td>{l.sold}</td>{cur.summary.lines.some((x) => x.damaged) && <td>{l.damaged || "—"}</td>}
                  <td><b className={l.remaining < 0 ? "red" : ""}>{l.remaining}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
          <RoundMoney s={cur.summary} />
          {d.can_edit && (
            <div className="vh-acts">
              <button className="btn-primary icon-row" style={{ justifyContent: "center" }} onClick={() => open("close")}><FiCornerDownLeft aria-hidden="true" /> رجعت السيارة — سجّل المرتجع</button>
              <div className="vh-acts2">
                <button className="btn-secondary" onClick={() => open("add")}><FiPlus aria-hidden="true" /> تحميل زيادة</button>
                {stock && <button className="btn-secondary" onClick={() => open("damage")}><FiAlertTriangle aria-hidden="true" /> تالف</button>}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="card vh-idle">
          <div className="vh-idle-t">السيارة فاضية وبالمحطة</div>
          {d.can_edit && <button className="btn-primary icon-row" style={{ justifyContent: "center" }} onClick={() => open("load")}><FiTruck aria-hidden="true" /> حمّل جولة جديدة</button>}
        </div>
      )}

      {past.length > 0 && (
        <>
          <div className="section-title">آخر الجولات</div>
          <div className="vh-past">
            {past.map((r) => (
              <div key={r.id} className="vh-past-row">
                <button type="button" className="vh-past-h" onClick={() => setOpenRound(openRound === r.id ? null : r.id)}>
                  <span><b>جولة {r.round_no}</b> · {day(r.opened_at)} · {r.driver_name || "—"}</span>
                  <span className="tabular-num">{money(r.summary.total_cash)} JD {r.summary.lines.some((l) => l.shortage) ? <em className="red">⚠️</em> : null}</span>
                </button>
                {openRound === r.id && <RoundReport r={r} />}
              </div>
            ))}
          </div>
        </>
      )}

      {/* تحميل جولة جديدة */}
      <Sheet open={sheet === "load"} title={`تحميل ${d.vehicle.name}`} onClose={() => setSheet(null)}>
        {error && <div className="error-box">{error}</div>}
        <div className="sheet-q">مين السائق؟</div>
        <div className="of-want-pk" style={{ padding: 0, marginBottom: 12 }}>
          {(meta?.drivers || []).map((u) => (
            <button key={u.id} type="button" className={driver === u.id ? "on" : ""} onClick={() => setDriver(u.id)}>{u.full_name}</button>
          ))}
        </div>
        <div className="sheet-q">شو حمّلت؟</div>
        <QtyList products={products} qty={qty} setQty={setQty} />
        <div className="sheet-actions">
          <button className="btn-primary" disabled={busy || !driver || !items().length}
            onClick={() => run(() => api.stLoadRound(d.vehicle.id, { driver_id: driver, items: items() }), (r) => `✅ انحمّلت — جولة ${r.round_no}`)}>
            {busy ? "لحظة…" : "أكّد التحميل"}
          </button>
          <button className="btn-secondary" onClick={() => setSheet(null)}>رجوع</button>
        </div>
      </Sheet>

      {/* تحميل زيادة */}
      <Sheet open={sheet === "add"} title="تحميل زيادة على نفس الجولة" onClose={() => setSheet(null)}>
        {error && <div className="error-box">{error}</div>}
        <QtyList products={products} qty={qty} setQty={setQty} />
        <div className="sheet-actions">
          <button className="btn-primary" disabled={busy || !items().length} onClick={() => run(() => api.stAddToRound(cur.id, { items: items() }), "✅ انضاف عالحمولة")}>أكّد</button>
          <button className="btn-secondary" onClick={() => setSheet(null)}>رجوع</button>
        </div>
      </Sheet>

      {/* المرتجع وإغلاق الجولة */}
      {cur && (
        <Sheet open={sheet === "close"} title="رجعت السيارة — المرتجع" onClose={() => setSheet(null)}>
          {error && <div className="error-box">{error}</div>}
          <p className="text-secondary" style={{ marginTop: 0, fontSize: "0.82rem" }}>عدّ اللي رجع بالسيارة. الرقم المكتوب هو اللي مفروض يكون — عدّله إذا في فرق.</p>
          <QtyList
            products={cur.summary.lines.map((l) => ({ id: l.product_id, name: l.name }))}
            qty={qty}
            setQty={setQty}
            hint={(p) => {
              const l = curLine(p.id);
              const diff = l.remaining - (Number(qty[p.id]) || 0);
              return diff === 0 ? `مفروض ${l.remaining} ✓` : diff > 0 ? `مفروض ${l.remaining} — ناقص ${diff}` : `مفروض ${l.remaining} — زايد ${-diff}`;
            }}
          />
          <div className="sheet-actions">
            <button className="btn-primary" disabled={busy}
              onClick={() => run(() => api.stCloseRound(cur.id, { returned: cur.summary.lines.map((l) => ({ product_id: l.product_id, qty: Number(qty[l.product_id]) || 0 })) }), "✅ انسكّرت الجولة والمرتجع رجع للمحطة — السيارة صارت فاضية")}>
              {busy ? "لحظة…" : "أكّد المرتجع وسكّر الجولة"}
            </button>
            <button className="btn-secondary" onClick={() => setSheet(null)}>رجوع</button>
          </div>
        </Sheet>
      )}

      {/* تالف من السيارة */}
      {cur && (
        <Sheet open={sheet === "damage"} title="تالف بالسيارة" onClose={() => setSheet(null)}>
          {error && <div className="error-box">{error}</div>}
          <DamageForm lines={cur.summary.lines} roundId={cur.id} busy={busy} run={run} onCancel={() => setSheet(null)} />
        </Sheet>
      )}
    </div>
  );
}

function DamageForm({ lines, roundId, busy, run, onCancel }) {
  const [items, setItems] = useState(null);
  const [pid, setPid] = useState(lines[0]?.product_id || null);
  const [n, setN] = useState(1);
  const [note, setNote] = useState("");
  useEffect(() => { api.stStock().then((r) => setItems(r.items)).catch(() => setItems([])); }, []);
  const item = (items || []).find((x) => x.product_id === pid);
  return (
    <>
      <div className="of-want-pk" style={{ padding: 0, marginBottom: 12 }}>
        {lines.map((l) => <button key={l.product_id} type="button" className={pid === l.product_id ? "on" : ""} onClick={() => setPid(l.product_id)}>{l.name}</button>)}
      </div>
      <div className="ei-row on" style={{ marginBottom: 10 }}>
        <div className="ei-name"><b>كم تالف؟</b></div>
        <div className="ei-step">
          <button type="button" className="step-btn" onClick={() => setN(Math.max(1, n - 1))}>−</button>
          <span className="tabular-num">{n}</span>
          <button type="button" className="step-btn plus" onClick={() => setN(n + 1)}>+</button>
        </div>
      </div>
      <input className="no-search" value={note} onChange={(e) => setNote(e.target.value)} placeholder="شو صار؟ (اختياري)" />
      {items && !item && <div className="pay-note warn" style={{ marginTop: 8 }}>هذا المنتج مش مربوط بصنف بمخزون المحطة — اربطه من «المحطة»</div>}
      <div className="sheet-actions">
        <button className="btn-primary" style={{ background: "var(--urgent)" }} disabled={busy || !item}
          onClick={() => run(() => api.stMove(item.id, { kind: "damage", qty: n, note, round_id: roundId }), "✅ انسجّل التالف (إذا بده موافقة، وصل للإدارة)")}>
          سجّل التالف
        </button>
        <button className="btn-secondary" onClick={onCancel}>رجوع</button>
      </div>
    </>
  );
}

function RoundMoney({ s }) {
  return (
    <div className="vh-sum">
      <div><span>كاش التوصيل</span><b className="tabular-num">{money(s.cash)}</b></div>
      {s.package_cash > 0 && <div><span>كاش الباقات</span><b className="tabular-num">{money(s.package_cash)}</b></div>}
      <div><span>الدين</span><b className={`tabular-num${s.debt > 0 ? " red" : ""}`}>{money(s.debt)}</b></div>
      {s.coupons_used > 0 && <div><span>كوبونات انخصمت</span><b className="tabular-num">{s.coupons_used}{s.paper_coupons ? ` (${s.paper_coupons} ورقي)` : ""}</b></div>}
      {s.packages.length > 0 && (
        <div className="vh-pk">
          <span>كوبونات انباعت</span>
          <span className="vh-pk-list">
            {s.packages.map((p) => <em key={p.coupons} className="tabular-num">عدد {p.coupons}: {p.count}</em>)}
          </span>
        </div>
      )}
      <div className="vh-sum-total"><span>المجموع مع السائق</span><b className="tabular-num">{money(s.total_cash)} JD</b></div>
    </div>
  );
}

// تقرير جولة مسكّرة
function RoundReport({ r }) {
  const s = r.summary;
  return (
    <div className="vh-rep">
      <table className="vh-table tabular-num">
        <thead><tr><th>الصنف</th><th>حمّل</th><th>باع</th><th>رجع</th><th>الفرق</th></tr></thead>
        <tbody>
          {s.lines.map((l) => (
            <tr key={l.product_id}>
              <td>{l.name}</td><td>{l.loaded}</td><td>{l.sold}{l.damaged ? ` +${l.damaged} تالف` : ""}</td><td>{l.returned ?? "—"}</td>
              <td>{l.shortage ? <b className="red">{l.shortage > 0 ? `ناقص ${l.shortage}` : `زايد ${-l.shortage}`}</b> : "✓"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <RoundMoney s={s} />
      <div className="text-secondary" style={{ fontSize: "0.75rem", marginTop: 6 }}>من {time(r.opened_at)} لـ {r.closed_at ? time(r.closed_at) : "—"}</div>
    </div>
  );
}
