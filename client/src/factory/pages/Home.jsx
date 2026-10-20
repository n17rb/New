import { useNavigate } from "react-router-dom";
import { FiCheckCircle, FiChevronLeft, FiTruck } from "react-icons/fi";
import { fapi } from "../fapi.js";
import { useFx, useLoad, money, num, time, Tip, Err, Loading, Reload, Act } from "../ui.jsx";

const STATE = {
  move: ["بالطريق", "move"], late: ["متأخرة", "late"], lost: ["التتبع مقطوع", "lost"], back: ["رجعت للمصنع", "back"],
  planned: ["جاهزة تطلع", "planned"], idle: ["بالمصنع", ""], shop: ["بالصيانة", ""],
};

export function AlertCard({ a, onClose }) {
  const nav = useNavigate();
  const go = {
    expense: "/f/money?tab=expenses", cash_short: "/f/money", returned: "/f/money", late: "/f/trips", tracking: "/f/trips",
    breakdown: "/f/trips", delay: "/f/trips", fuel_night: "/f/reports", km_mismatch: "/f/reports", carton_short: "/f/money?tab=drivers",
    material_low: "/f/stock?tab=prod",
    license30: "/f/settings?tab=vehicles", license7: "/f/settings?tab=vehicles", license0: "/f/settings?tab=vehicles",
    insurance30: "/f/settings?tab=vehicles", insurance7: "/f/settings?tab=vehicles", insurance0: "/f/settings?tab=vehicles", downtime: "/f/stock?tab=prod", credit: "/f/money?tab=debts", failed: "/f/orders",
  }[a.kind];
  return (
    <article className={`fx-alert ${a.level} ${a.closed_at ? "closed" : ""}`}>
      <div className="h"><b>{a.title}</b><time>{time(a.created_at)}</time></div>
      {a.body && <p>{a.body}</p>}
      {!a.closed_at && (
        <div className="fx-row" style={{ marginTop: 4 }}>
          {go && <button className="fx-btn sm sky" onClick={() => nav(go)}>افتح</button>}
          {onClose && <Act className="fx-btn sm" onClick={() => onClose(a.id)}>تم</Act>}
        </div>
      )}
    </article>
  );
}

export default function Home() {
  const fx = useFx();
  const nav = useNavigate();
  const { data: h, error, reload } = useLoad(() => fapi.home(), []);
  const b = fx.boot;
  const needsSetup = fx.isOwner && !b.setup_done && (b.counts.products === 0 || b.counts.vehicles === 0 || b.counts.customers === 0);

  async function close(id) {
    await fapi.closeAlert(id);
    reload();
  }

  return (
    <div className="fx-page">
      <div className="fx-row" style={{ justifyContent: "space-between" }}>
        <div>
          <h1 className="fx-h1">أهلاً {/^(أبو|أم|ابو|ام)$/.test(fx.user.full_name?.split(" ")[0] || "") ? fx.user.full_name : fx.user.full_name?.split(" ")[0]}</h1>
          <p className="fx-muted" style={{ margin: 0 }}>{new Date().toLocaleDateString("ar-JO-u-nu-latn", { weekday: "long", day: "numeric", month: "long" })}</p>
        </div>
        <Reload onClick={reload} />
      </div>

      {needsSetup && (
        <button className="fx-card soft fx-row" style={{ textAlign: "start", font: "inherit", cursor: "pointer", border: 0 }} onClick={() => nav("/f/setup")}>
          <FiCheckCircle style={{ width: 26, height: 26, color: "var(--fx-navy)" }} />
          <span className="fx-grow"><b>كمّل تجهيز المصنع</b><br /><span className="fx-muted">خطوات قصيرة: المنتجات، السيارات، الموظفين، الزباين.</span></span>
          <FiChevronLeft />
        </button>
      )}

      {fx.isOwner && b.counts.sample_customers > 0 && !fx.shop?.is_demo && (
        <button className="fx-card fx-row" style={{ textAlign: "start", font: "inherit", cursor: "pointer", background: "var(--fx-warn-soft)", border: 0 }} onClick={() => fx.show("/f/settings", "sample-card")}>
          <span className="fx-grow"><b>هاي داتا تجريبية</b><br /><span className="fx-muted">لما تجهز تبلش بزباينك الحقيقيين، امسحها بكبسة.</span></span>
          <FiChevronLeft />
        </button>
      )}
      <Tip id="home">هاي شاشتك الصبح: حالة المصنع كله بنظرة وحدة. التنبيه الأحمر بدّه تصرّف.</Tip>
      <Err msg={error} />
      {!h && !error && <Loading />}

      {h && (
        <>
          <div className="fx-kpis">
            <button className="fx-kpi" onClick={() => nav("/f/stock")}><span className="l">إنتاج اليوم</span><span className="v">{num(h.production)}</span><span className="s">كرتونة</span></button>
            <button className="fx-kpi" onClick={() => nav("/f/reports")}><span className="l">مبيعات اليوم</span><span className="v">{money(h.sales.total)}</span><span className="s">{num(h.sales.cartons)} كرتونة · {h.sales.orders} طلب</span></button>
            <button className="fx-kpi" onClick={() => nav("/f/money")}><span className="l">كاش مع السائقين</span><span className="v">{money(h.cash_with_drivers)}</span><span className="s">لسا ما تسلّم</span></button>
            <button className="fx-kpi" onClick={() => nav("/f/money?tab=debts")}><span className="l">ديون على الزباين</span><span className="v">{money(h.debts.total)}</span><span className="s">{h.debts.customers} زبون</span></button>
          </div>

          <div className="fx-row">
            <span className="fx-pill sky">{h.open_orders.n} طلب مفتوح</span>
            {h.open_orders.unassigned > 0 && <button className="fx-pill warn" style={{ border: 0, cursor: "pointer" }} onClick={() => nav("/f/orders")}>{h.open_orders.unassigned} بدون سيارة</button>}
            {h.pending_expenses > 0 && <button className="fx-pill warn" style={{ border: 0, cursor: "pointer" }} onClick={() => nav("/f/money?tab=expenses")}>{h.pending_expenses} مصروف بستنى موافقتك</button>}
            {h.damage_month.cartons > 0 && <button className="fx-pill crit" style={{ border: 0, cursor: "pointer" }} onClick={() => nav("/f/reports")}>توالف الشهر {num(h.damage_month.cartons)} كرتونة</button>}
          </div>

          {h.low_stock.length > 0 && (
            <div className="fx-note warn">رصيد قليل: {h.low_stock.map((p) => `${p.name} (${num(p.balance)})`).join("، ")}</div>
          )}

          <div className="fx-sec"><h2>تنبيهات مفتوحة</h2><button className="fx-link" onClick={() => nav("/f/alerts")}>الكل</button></div>
          <div className="fx-stack">
            {h.alerts.length === 0 && <p className="fx-muted" style={{ margin: 0 }}>ما في تنبيهات. كل إشي ماشي.</p>}
            {h.alerts.slice(0, 4).map((a) => <AlertCard key={a.id} a={a} onClose={close} />)}
          </div>

          <div className="fx-sec"><h2>السيارات هلأ</h2><button className="fx-link" onClick={() => nav("/f/trips")}>الرحلات</button></div>
          <div className="fx-list">
            {h.vehicles.length === 0 && <div className="fx-item"><span className="fx-muted">ما في سيارات — ضيفها من الإعدادات.</span></div>}
            {h.vehicles.map((v) => {
              const [label, dot] = STATE[v.state] || ["", ""];
              return (
                <button key={v.id} className="fx-item" onClick={() => nav("/f/trips")}>
                  <span className="fx-avatar"><FiTruck /></span>
                  <span className="t">
                    <b>{v.name}{v.driver_name ? ` · ${v.driver_name}` : ""}</b>
                    <span>{v.governorate || ""}{v.trip_id ? ` · ${v.done}/${v.stops} وقفات · ${num(v.load)} من ${num(v.capacity)}` : ""}</span>
                  </span>
                  <span className="end"><span className="fx-row" style={{ gap: 6 }}><i className={`fx-dot ${dot}`} />{label}</span></span>
                </button>
              );
            })}
          </div>
          <p className="fx-muted" style={{ margin: 0 }}>ملخص اليوم بيضل محدّث هون. التنبيهات المهمة بتوصلك إشعار على التلفون.</p>
        </>
      )}
    </div>
  );
}
