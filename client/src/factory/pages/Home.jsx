import { useNavigate } from "react-router-dom";
import { FiCheckCircle, FiChevronLeft } from "react-icons/fi";
import { HiOutlineArchiveBox, HiOutlineCircleStack, HiOutlineBanknotes, HiOutlineUsers, HiOutlineDocumentText, HiOutlineTruck, HiOutlineCube, HiOutlineExclamationTriangle, HiOutlineBell, HiOutlineCalendarDays, HiOutlineWrenchScrewdriver } from "react-icons/hi2";
import { fapi } from "../fapi.js";
import { useFx, useLoad, money, num, time, Tip, Err, Loading, Act } from "../ui.jsx";


function alertLink(kind) {
  return {
    expense: "/f/money?tab=expenses", cash_short: "/f/money", returned: "/f/money", late: "/f/trips", tracking: "/f/trips",
    breakdown: "/f/trips", delay: "/f/trips", fuel_night: "/f/reports", km_mismatch: "/f/reports", carton_short: "/f/money?tab=drivers",
    material_low: "/f/stock",
    license30: "/f/settings?tab=vehicles", license7: "/f/settings?tab=vehicles", license0: "/f/settings?tab=vehicles",
    insurance30: "/f/settings?tab=vehicles", insurance7: "/f/settings?tab=vehicles", insurance0: "/f/settings?tab=vehicles", downtime: "/f/stock?tab=prod", credit: "/f/money?tab=debts", failed: "/f/orders",
  }[kind];
}

export function AlertCard({ a, onClose }) {
  const nav = useNavigate();
  const go = alertLink(a.kind);
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

const ALERT_ICON = (kind = "") =>
  /^(license|insurance)/.test(kind) ? HiOutlineCalendarDays
  : /^(late|tracking|breakdown|delay|returned|failed|km_|fuel)/.test(kind) ? HiOutlineTruck
  : /^(expense|cash|credit)/.test(kind) ? HiOutlineBanknotes
  : /^(downtime)/.test(kind) ? HiOutlineWrenchScrewdriver
  : /^(carton|material|stock)/.test(kind) ? HiOutlineCube
  : HiOutlineExclamationTriangle;

function HomeAlert({ a, onClose }) {
  const nav = useNavigate();
  const go = alertLink(a.kind);
  const Icon = ALERT_ICON(a.kind);
  return (
    <article className={`fx-hcard fx-halert ${a.level}`}>
      <button className="fx-plain fx-halert-main" onClick={() => go && nav(go)}>
        <span className="t"><b>{a.title}</b>{a.body && <small>{a.body} · {time(a.created_at)}</small>}</span>
        <span className="ic"><Icon /></span>
        {go && <FiChevronLeft className="chev" aria-hidden="true" />}
      </button>
      <div className="fx-halert-btns">
        {go && <button className="fx-btn pri" onClick={() => nav(go)}>افتح</button>}
        <Act className="fx-btn" onClick={() => onClose(a.id)}>تم</Act>
      </div>
    </article>
  );
}

function Kpi({ label, value, unit, icon: Icon, onClick }) {
  return (
    <button className="fx-hkpi" onClick={onClick}>
      <span className="t"><span className="l">{label}</span><b className="fx-num">{value}</b><span className="u">{unit}</span></span>
      <span className="ic"><Icon /></span>
    </button>
  );
}

export default function Home() {
  const fx = useFx();
  const nav = useNavigate();
  const { data: h, error, reload } = useLoad(() => fapi.home(), []);
  const b = fx.boot;
  const needsSetup = fx.isOwner && !b.setup_done && (b.counts.products === 0 || b.counts.vehicles === 0 || b.counts.customers === 0);
  const first = fx.user.full_name?.split(" ")[0] || "";
  const hello = /^(أبو|أم|ابو|ام)$/.test(first) ? fx.user.full_name : first;

  async function close(id) {
    await fapi.closeAlert(id);
    reload();
  }

  return (
    <div className="fx-page fx-home">
      <div>
        <h1 className="fx-hello">أهلاً {hello}</h1>
        <p className="fx-muted" style={{ margin: 0 }}>{new Date().toLocaleDateString("ar-JO-u-nu-latn", { weekday: "long", day: "numeric", month: "long" })}</p>
      </div>

      {needsSetup && (
        <button className="fx-hcard fx-row fx-plain" onClick={() => nav("/f/setup")}>
          <FiCheckCircle style={{ width: 26, height: 26, color: "#2f6fe4" }} />
          <span className="fx-grow"><b>كمّل تجهيز المصنع</b><br /><span className="fx-muted">خطوات قصيرة: المنتجات، السيارات، الموظفين، الزباين.</span></span>
          <FiChevronLeft />
        </button>
      )}
      {fx.isOwner && b.counts.sample_customers > 0 && !fx.shop?.is_demo && (
        <button className="fx-hcard fx-row fx-plain" style={{ background: "var(--fx-warn-soft)" }} onClick={() => fx.show("/f/settings", "sample-card")}>
          <span className="fx-grow"><b>هاي داتا تجريبية</b><br /><span className="fx-muted">لما تجهز تبلش بزباينك الحقيقيين، امسحها بكبسة.</span></span>
          <FiChevronLeft />
        </button>
      )}
      <Tip id="home2" title="كل شغلك اليوم بلمحة وحدة">تابع الطلبات، الرحلات والمبيعات بسهولة.</Tip>
      <Err msg={error} />
      {!h && !error && <Loading />}

      {h && (
        <>
          <div className="fx-hkpis">
            <Kpi label="إنتاج اليوم" value={num(h.production)} unit="كرتونة" icon={HiOutlineArchiveBox} onClick={() => nav("/f/stock")} />
            <Kpi label="مبيعات اليوم" value={money(h.sales.total)} unit="دينار" icon={HiOutlineCircleStack} onClick={() => nav("/f/reports")} />
            <Kpi label="كاش مع السائقين" value={money(h.cash_with_drivers)} unit="دينار" icon={HiOutlineBanknotes} onClick={() => nav("/f/money")} />
            <Kpi label="ديون على الزباين" value={money(h.debts.total)} unit="دينار" icon={HiOutlineUsers} onClick={() => nav("/f/money?tab=debts")} />
          </div>

          <div className="fx-hpills">
            <button className="sky" onClick={() => nav("/f/orders")}><HiOutlineDocumentText /> {num(h.open_orders.n)} طلب مفتوح</button>
            {h.open_orders.unassigned > 0 && <button className="warn" onClick={() => nav("/f/orders")}><HiOutlineTruck /> {num(h.open_orders.unassigned)} بدون سيارة</button>}
            {h.pending_expenses > 0 && <button className="warn" onClick={() => nav("/f/money?tab=expenses")}><HiOutlineBanknotes /> {h.pending_expenses} مصروف بستنى موافقتك</button>}
          </div>

          {h.low_stock.length > 0 && (
            <section className="fx-hcard">
              <div className="fx-hsec"><HiOutlineCube /><h2>تنبيه المخزون</h2></div>
              <div className="fx-stack" style={{ gap: 8 }}>
                {h.low_stock.map((p) => (
                  <button key={p.id || p.name} className="fx-hstock" onClick={() => nav("/f/stock")}>
                    <HiOutlineExclamationTriangle className="w" />
                    <b>{p.name}: <span className="fx-num">{num(p.balance)}</span></b>
                    <FiChevronLeft className="chev" />
                  </button>
                ))}
              </div>
            </section>
          )}

          <div className="fx-hsec" style={{ marginTop: 4 }}><HiOutlineBell /><h2>تحتاج انتباهك</h2>{h.alerts.length > 3 && <button className="fx-link" onClick={() => nav("/f/alerts")}>الكل ({h.alerts.length})</button>}</div>
          <div className="fx-stack">
            {h.alerts.length === 0 && <div className="fx-hcard fx-muted" style={{ textAlign: "center" }}>ما في إشي بدّه انتباهك. كل إشي ماشي 👌</div>}
            {h.alerts.slice(0, 3).map((a) => <HomeAlert key={a.id} a={a} onClose={close} />)}
          </div>
        </>
      )}
    </div>
  );
}
