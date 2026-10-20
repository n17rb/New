import { useState } from "react";
import { fapi } from "../fapi.js";
import { useLoad, Tip, Err, Loading, HBar, money, num, today } from "../ui.jsx";

const SRC = { vehicle: "السيارات", machine: "المكنات", warehouse: "المستودع", customer: "عند الزبون" };

function range(kind) {
  const t = today();
  const d = new Date(`${t}T12:00:00`);
  const iso = (x) => x.toLocaleDateString("en-CA");
  if (kind === "today") return { from: t, to: t };
  if (kind === "week") return { from: iso(new Date(d.getTime() - 6 * 86400000)), to: t };
  if (kind === "last") {
    const first = new Date(d.getFullYear(), d.getMonth() - 1, 1);
    const last = new Date(d.getFullYear(), d.getMonth(), 0);
    return { from: iso(first), to: iso(last) };
  }
  return { from: `${t.slice(0, 7)}-01`, to: t };
}

export default function Reports() {
  const [kind, setKind] = useState("month");
  const [tab, setTab] = useState("sales");
  const r = range(kind);
  const { data, error } = useLoad(() => fapi.reports(r), [r.from, r.to]);
  return (
    <div className="fx-page">
      <h1 className="fx-h1">التقارير</h1>
      <div className="fx-chips">
        {[["today", "اليوم"], ["week", "آخر ٧ أيام"], ["month", "هالشهر"], ["last", "الشهر الماضي"]].map(([k, l]) => <button key={k} className={`fx-chip ${kind === k ? "on" : ""}`} onClick={() => setKind(k)}>{l}</button>)}
      </div>
      <div className="fx-tabs">
        {[["sales", "المبيعات"], ["damage", "التوالف"], ["fuel", "الديزل"], ["drivers", "السائقين"], ["prod", "الإنتاج"]].map(([k, l]) => <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      <Err msg={error} />
      {!data && !error && <Loading />}
      {data && tab === "sales" && <Sales d={data} />}
      {data && tab === "damage" && <Damage d={data} />}
      {data && tab === "fuel" && <Fuel d={data} />}
      {data && tab === "drivers" && <Drivers d={data} />}
      {data && tab === "prod" && <Prod d={data} />}
    </div>
  );
}

function Sales({ d }) {
  const total = d.by_product.reduce((s, x) => s + x.sales, 0);
  const cartons = d.by_product.reduce((s, x) => s + x.cartons, 0);
  const maxV = Math.max(1, ...d.by_vehicle.map((v) => v.sales));
  const maxC = Math.max(1, ...d.by_city.map((v) => v.sales));
  return (
    <>
      <div className="fx-kpis">
        <div className="fx-kpi"><span className="l">المبيعات</span><span className="v">{money(total)}</span><span className="s">{num(cartons)} كرتونة</span></div>
        <div className="fx-kpi"><span className="l">التحصيل</span><span className="v">{money(d.collections.collected)}</span><span className="s">من فواتير {money(d.collections.invoiced)}</span></div>
      </div>
      <div className="fx-sec"><h2>ربح كل سيارة</h2></div>
      <div className="fx-table">
        <table>
          <thead><tr><th>السيارة</th><th>رحلات</th><th>مبيعات</th><th>مصاريف</th><th>الصافي</th></tr></thead>
          <tbody>{d.by_vehicle.map((v) => <tr key={v.id}><td>{v.name}</td><td>{v.trips}</td><td>{money(v.sales)}</td><td>{money(v.expenses)}</td><td><b>{money(v.net)}</b></td></tr>)}</tbody>
        </table>
      </div>
      <p className="fx-muted" style={{ margin: 0 }}>الصافي = المبيعات ناقص مصاريف السيارة (ديزل، تصليح...). الرواتب مش محسوبة هون.</p>
      <div className="fx-sec"><h2>حسب المنتج</h2></div>
      <div className="fx-card fx-stack">{d.by_product.map((p) => <HBar key={p.id} label={`${p.name} · ${num(p.cartons)} كرتونة`} value={Math.round(p.sales)} max={Math.max(1, ...d.by_product.map((x) => x.sales))} tone="navy" />)}</div>
      <div className="fx-sec"><h2>حسب المدينة</h2></div>
      <div className="fx-card fx-stack">{d.by_city.map((c) => <HBar key={c.city} label={`${c.city} · ${c.orders} طلب`} value={Math.round(c.sales)} max={maxC} />)}</div>
      <div className="fx-sec"><h2>أكبر ١٠ زباين</h2></div>
      <div className="fx-list">{d.top_customers.map((c) => <div key={c.id} className="fx-item"><span className="t"><b>{c.name}</b><span>{c.city} · {c.orders} طلب · عليه {money(c.balance)}</span></span><b className="fx-num">{money(c.sales)}</b></div>)}</div>
      {d.by_vehicle.length === 0 && maxV === 1 && <p className="fx-muted">ما في مبيعات بهالفترة.</p>}
    </>
  );
}

function Damage({ d }) {
  const total = d.damage.reduce((s, x) => s + x.cartons, 0);
  const value = d.damage.reduce((s, x) => s + x.value, 0);
  const maxD = Math.max(1, ...d.damage_drivers.map((x) => x.cartons));
  const worst = d.damage_machines.find((m) => m.top_reason_count >= 2);
  return (
    <>
      <Tip id="rep-damage">هون بتعرف قديش خسرت توالف، ومن وين بالزبط: من السيارات (ولأي سائق) أو من المكنات (ولأي سبب).</Tip>
      <div className="fx-card fx-stack">
        <span className="fx-muted">التوالف بهالفترة</span>
        <b className="fx-num" style={{ fontSize: 26, color: "var(--fx-crit)" }}>{num(total)} كرتونة</b>
        <span className="fx-muted">تقريبًا {money(value)} دينار بسعر البيع</span>
        {d.damage.map((x) => <HBar key={x.source} label={SRC[x.source] || x.source} value={x.cartons} max={Math.max(1, total)} tone="over" />)}
      </div>
      {worst && <div className="fx-note warn">«{worst.top_reason}» بـ{worst.name} تكرر {worst.top_reason_count} مرات. صيانة وقائية بتوفر عليك.</div>}
      <div className="fx-sec"><h2>توالف السيارات حسب السائق</h2></div>
      <div className="fx-card fx-stack">{d.damage_drivers.length ? d.damage_drivers.map((x, i) => <HBar key={i} label={`${x.name || "—"} · ${x.vehicle}`} value={x.cartons} max={maxD} tone="over" />) : <span className="fx-muted">ولا إشي.</span>}</div>
      <div className="fx-sec"><h2>المكنات</h2></div>
      <div className="fx-table">
        <table>
          <thead><tr><th>الماكنة</th><th>تالف</th><th>توقفات</th><th>دقائق</th><th>أكثر سبب</th></tr></thead>
          <tbody>{d.damage_machines.map((m) => <tr key={m.name}><td>{m.name}</td><td>{num(m.cartons)}</td><td>{m.stops}</td><td>{num(m.minutes)}</td><td>{m.top_reason || "—"}</td></tr>)}</tbody>
        </table>
      </div>
    </>
  );
}

function Fuel({ d }) {
  return (
    <>
      <Tip id="rep-fuel">الاستهلاك = لترات الديزل ÷ كيلومترات العداد. السيارة اللي بتصرف أكثر من معدل الأسطول بـ٢٠٪ بتطلع بالأحمر. وإذا العداد أكثر بكثير من التتبع، يعني السيارة مشيت والتلفون مسكّر.</Tip>
      {d.fuel_avg && <div className="fx-note sky">معدل الأسطول: {d.fuel_avg} لتر لكل ١٠٠ كم</div>}
      <div className="fx-table">
        <table>
          <thead><tr><th>السيارة</th><th>لتر</th><th>كلفة</th><th>كم (العداد)</th><th>كم (التتبع)</th><th>لتر/١٠٠كم</th></tr></thead>
          <tbody>
            {d.fuel.map((v) => (
              <tr key={v.id} style={v.high ? { background: "var(--fx-crit-soft)" } : undefined}>
                <td>{v.name}</td><td>{num(v.liters)}</td><td>{money(v.cost)}</td><td>{num(v.km)}</td>
                <td style={v.km > v.gps_km * 1.3 + 10 && v.gps_km > 5 ? { color: "var(--fx-crit)", fontWeight: 700 } : undefined}>{num(v.gps_km)}</td>
                <td><b>{v.per100 ?? "—"}</b></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Drivers({ d }) {
  return (
    <>
      <div className="fx-table">
        <table>
          <thead><tr><th>السائق</th><th>رحلات</th><th>سلّم</th><th>ما تسلّم</th><th>متأخر</th><th>نقص</th></tr></thead>
          <tbody>{d.drivers.map((x) => <tr key={x.id}><td>{x.name}</td><td>{x.trips}</td><td>{x.delivered}</td><td>{x.failed}</td><td>{x.late}</td><td style={x.shortage > 0 ? { color: "var(--fx-crit)" } : undefined}>{money(x.shortage)}</td></tr>)}</tbody>
        </table>
      </div>
      <div className="fx-sec"><h2>المصاريف</h2></div>
      <div className="fx-card">{d.expenses.length ? d.expenses.map((e) => <div key={e.kind} className="fx-kv"><span>{e.kind} ({e.n})</span><b>{money(e.total)}</b></div>) : <span className="fx-muted">ما في مصاريف.</span>}</div>
    </>
  );
}

function Prod({ d }) {
  const max = Math.max(1, ...d.production.map((p) => p.cartons));
  return (
    <div className="fx-card fx-stack">
      {d.production.length ? d.production.map((p) => <HBar key={p.day} label={new Date(`${p.day}T12:00:00`).toLocaleDateString("ar-JO-u-nu-latn", { weekday: "short", day: "numeric", month: "numeric" })} value={p.cartons} max={max} tone="navy" />) : <span className="fx-muted">ما في إنتاج مسجّل.</span>}
    </div>
  );
}
