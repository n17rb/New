import { useState } from "react";
import { FiZap, FiCheck } from "react-icons/fi";
import { api } from "../api.js";
import { scheduleLabel } from "../schedule.js";

const COLORS = ["#0A66F5", "#1F9D55", "#C77C02", "#8E44AD", "#D64545", "#0E9AA7"];

// توزيع الطلبات على كذا كابتن: كل واحد بياخذ منطقة متلاصقة وحمل متوازن
export default function DistributePlanner({ orders, drivers, onDone }) {
  const [chosen, setChosen] = useState(() => Object.fromEntries(drivers.slice(0, 2).map((d) => [d.id, true])));
  const [plan, setPlan] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [moving, setMoving] = useState(null); // order id
  const [edited, setEdited] = useState(false);
  const [result, setResult] = useState(null);

  const driverIds = Object.entries(chosen).filter(([, v]) => v).map(([id]) => Number(id));

  async function suggest() {
    setBusy(true);
    setError("");
    setEdited(false);
    try {
      const r = await api.planTrips({ order_ids: orders.map((o) => o.id), driver_ids: driverIds });
      setPlan(r.groups);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function moveTo(orderId, driverId) {
    setPlan((prev) => {
      const order = prev.flatMap((g) => g.orders).find((o) => o.id === orderId);
      return prev.map((g) => {
        const without = g.orders.filter((o) => o.id !== orderId);
        const orders2 = g.driver_id === driverId ? [...without, order] : without;
        return { ...g, orders: orders2, bottles: orders2.reduce((s, o) => s + (o.bottles || 0), 0) };
      });
    });
    setMoving(null);
    setEdited(true);
  }

  async function apply() {
    setBusy(true);
    setError("");
    try {
      const r = await api.applyTripPlan(plan.map((g) => ({ driver_id: g.driver_id, order_ids: g.orders.map((o) => o.id) })));
      setResult(r.results);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    const nameOf = (id) => drivers.find((d) => d.id === id)?.full_name || "كابتن";
    return (
      <div>
        {result.map((r) => (
          <div key={r.driver_id} className={r.error ? "error-box" : "success-box"}>
            {r.error ? `${nameOf(r.driver_id)}: ${r.error}` : `✓ ${nameOf(r.driver_id)}: ${r.appended ? `انضاف ${r.added} طلب على رحلته` : `رحلة جديدة فيها ${r.added} طلب`}`}
          </div>
        ))}
        <button className="btn-primary" onClick={onDone}>تمام</button>
      </div>
    );
  }

  return (
    <div>
      {error && <div className="error-box">{error}</div>}
      <div className="field">
        <label>مين الكباتن اللي طالعين؟</label>
        <div className="chips" style={{ marginBottom: 0 }}>
          {drivers.map((d) => (
            <button key={d.id} type="button" className={`chip${chosen[d.id] ? " on" : ""}`} onClick={() => { setChosen({ ...chosen, [d.id]: !chosen[d.id] }); setPlan(null); }}>
              {chosen[d.id] && <FiCheck aria-hidden="true" />} {d.full_name}
            </button>
          ))}
        </div>
      </div>

      {!plan && (
        <button className="btn-primary icon-row" style={{ justifyContent: "center" }} disabled={busy || !driverIds.length || !orders.length} onClick={suggest}>
          <FiZap aria-hidden="true" /> {busy ? "جاري التوزيع..." : `وزّع ${orders.length} طلب على ${driverIds.length} كابتن`}
        </button>
      )}

      {plan && (
        <>
          <p className="text-secondary" style={{ fontSize: "0.82rem", marginTop: 0 }}>
            كل كابتن أخذ منطقة متلاصقة والقوارير متوزعة بالتساوي تقريبًا. بتقدر تنقل أي طلب لكابتن ثاني بكبسة عليه.
          </p>
          {plan.map((g, gi) => (
            <div key={g.driver_id} className="plan-group" style={{ borderColor: COLORS[gi % COLORS.length] }}>
              <div className="plan-head">
                <span className="plan-dot" style={{ background: COLORS[gi % COLORS.length] }} />
                <strong style={{ flex: 1 }}>{g.driver_name}</strong>
                <span className="text-secondary tabular-num" style={{ fontSize: "0.78rem" }}>
                  {g.orders.length} طلب · {g.bottles} قارورة{!edited && g.km ? ` · ${g.km} كم · ${g.minutes} د` : ""}
                </span>
              </div>
              {g.has_active_trip && <div className="text-secondary" style={{ fontSize: "0.75rem", marginBottom: 6 }}>عنده رحلة شغّالة — الطلبات بتنضاف عليها وبتترتب من جديد</div>}
              {g.orders.length === 0 && <div className="text-secondary" style={{ fontSize: "0.82rem" }}>ما إله طلبات</div>}
              <ol className="plan-list">
                {g.orders.map((o) => (
                  <li key={o.id}>
                    <button type="button" className="plan-order" onClick={() => setMoving(moving === o.id ? null : o.id)}>
                      <span>{o.customer_name}{o.region_name ? <span className="text-secondary"> · {o.region_name}</span> : null}</span>
                      <span className="text-secondary tabular-num">
                        {o.priority === "urgent" && "🚨 "}{scheduleLabel(o) && `📅 ${scheduleLabel(o)} · `}{o.bottles}
                        {!o.has_location && " · بدون موقع"}
                      </span>
                    </button>
                    {moving === o.id && (
                      <div className="chips" style={{ margin: "6px 0 4px" }}>
                        {plan.filter((x) => x.driver_id !== g.driver_id).map((x) => (
                          <button key={x.driver_id} type="button" className="chip" onClick={() => moveTo(o.id, x.driver_id)}>انقله لـ{x.driver_name}</button>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          ))}
          {edited && <p className="text-secondary" style={{ fontSize: "0.78rem" }}>بعد النقل، ترتيب كل رحلة بيتحسب من جديد بأحسن طريق لما تعتمد.</p>}
          <button className="btn-primary" style={{ marginBottom: 8 }} disabled={busy} onClick={apply}>
            {busy ? "جاري الإرسال..." : "🚀 اعتمد وابعت الرحلات للكباتن"}
          </button>
          <button className="btn-secondary" disabled={busy} onClick={suggest}>وزّع من جديد</button>
        </>
      )}
    </div>
  );
}
