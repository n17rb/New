import { useNavigate } from "react-router-dom";
import { lazy, Suspense, useEffect, useState } from "react";
const LiveMap = lazy(() => import("./Live.jsx").then((m) => ({ default: m.LiveMap })));
const CashSheet = lazy(() => import("./Books.jsx").then((m) => ({ default: m.CashSheet })));
const CounterSaleSheet = lazy(() => import("../CounterSale.jsx"));
import { FiCheckCircle, FiChevronLeft, FiChevronDown, FiTruck, FiMaximize2 } from "react-icons/fi";
import { fapi } from "../fapi.js";
import PushCard from "../PushCard.jsx";
import { lineType, plantName, plantBg, plantIcon } from "../plants.js";
import { useFx, useLoad, money, num, time, Err, Loading, Reload, Act } from "../ui.jsx";

const STATE = {
  move: ["بالطريق", "move"], late: ["متأخرة", "late"], lost: ["التتبع مقطوع", "lost"], back: ["رجعت للمصنع", "back"],
  planned: ["جاهزة تطلع", "planned"], idle: ["بالمصنع", ""], shop: ["بالصيانة", ""],
};

export function AlertCard({ a, onClose }) {
  const nav = useNavigate();
  const go = {
    expense: "/f/money?tab=expenses", cash_short: "/f/money", returned: "/f/money", late: "/f/trips", tracking: "/f/trips",
    breakdown: "/f/trips", delay: "/f/trips", fuel_night: "/f/reports", km_mismatch: "/f/reports", carton_short: "/f/money?tab=drivers",
    material_low: "/f/store", postpone: "/f/orders", qcheck: "/f/line", cliq: "/f/debts",
    license30: "/f/settings?tab=vehicles", license7: "/f/settings?tab=vehicles", license0: "/f/settings?tab=vehicles",
    insurance30: "/f/settings?tab=vehicles", insurance7: "/f/settings?tab=vehicles", insurance0: "/f/settings?tab=vehicles", downtime: "/f/stock?tab=prod", credit: "/f/money?tab=debts", failed: "/f/orders",
  }[a.kind] || (a.kind?.startsWith("maint_") ? "/f/maint" : a.kind?.startsWith("filter_") ? "/f/line" : undefined);
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
  const [carsOpen, setCarsOpen] = useState(false);
  const [cash, setCash] = useState(null);
  const b = fx.boot;
  const needsSetup = fx.isOwner && !b.setup_done && (b.counts.products === 0 || b.counts.vehicles === 0 || b.counts.customers === 0);

  return (
    <div className="fx-page">
      <div className="fx-row" style={{ justifyContent: "space-between" }}>
        <div>
          <h1 className="fx-h1">أهلاً {/^(أبو|أم|ابو|ام)$/.test(fx.user.full_name?.split(" ")[0] || "") ? fx.user.full_name : fx.user.full_name?.split(" ")[0]}</h1>
          <p className="fx-muted" style={{ margin: 0 }}>{new Date().toLocaleDateString("ar-JO-u-nu-latn", { weekday: "long", day: "numeric", month: "long" })}</p>
        </div>
        <Reload onClick={reload} />
      </div>

      <PushCard />
      {(fx.canAction("factory_sale") || fx.can("f_money", "edit")) && (
        <button className="hm-sell" onClick={() => setCash("sale")}>🏭 بيع من المصنع <small>زبون إجا اشترى كراتين</small></button>
      )}
      {fx.can("f_home") && (
        <div className="hm-quick">
          <button onClick={() => setCash("out")}><span>−</span> مصروف أو ضيافة</button>
          <button onClick={() => setCash("in")}><span>+</span> دخل للصندوق</button>
        </div>
      )}
      {cash === "sale" && <Suspense fallback={null}><CounterSaleSheet onClose={() => setCash(null)} onDone={() => { setCash(null); reload(); }} /></Suspense>}
      {cash && cash !== "sale" && <Suspense fallback={null}><CashSheet kind={cash} cats={[]} onClose={() => setCash(null)} onDone={() => { setCash(null); fx.toast("انسجّل بالصندوق"); }} /></Suspense>}
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
      <Err msg={error} />
      {!h && !error && <Loading />}

      {h && (
        <>
          {/* اليوم بنظرة: المبيعات كبيرة، والباقي صغار تحتها */}
          <button className="fx-card" style={{ border: 0, textAlign: "start", font: "inherit", cursor: "pointer", padding: 20, background: "linear-gradient(135deg,#0b5fa8,#2a8bd8)", color: "#fff", borderRadius: 22 }} onClick={() => nav("/f/reports")}>
            <small style={{ opacity: 0.85 }}>مبيعات اليوم</small>
            <div style={{ fontSize: 34, fontWeight: 800, lineHeight: 1.2, margin: "4px 0" }} className="fx-num">{money(h.sales.total)} <small style={{ fontSize: 15, opacity: 0.85 }}>د.أ</small></div>
            <small style={{ opacity: 0.9 }}>{num(h.sales.cartons)} كرتونة · {h.sales.orders} طلب</small>
          </button>
          {/* إنتاج اليوم لكل مصنع */}
          {h.production_by_line?.length > 0 && (
            <section className="fx-card fx-stack" style={{ gap: 12 }}>
              <div className="fx-row" style={{ justifyContent: "space-between" }}>
                <b>إنتاج اليوم</b>
                <span className="fx-row" style={{ gap: 10 }}>
                  <span className="fx-num" style={{ fontWeight: 800, color: "var(--fx-navy)" }}>{num(h.production)} <small className="fx-muted" style={{ fontWeight: 500 }}>كرتونة</small></span>
                  <button className="fx-link" onClick={() => nav("/f/stock?tab=plog")}>التفاصيل</button>
                </span>
              </div>
              {h.production_by_line.map((l) => {
                const max = Math.max(1, ...h.production_by_line.map((x) => x.n));
                const t = lineType(l.name);
                return (
                  <button key={l.id} className="fx-plain" style={{ display: "grid", gap: 6, textAlign: "start", width: "100%" }} onClick={() => nav(l.id ? `/f/plant/${l.id}` : "/f/stock")}>
                    <span className="fx-row" style={{ gap: 10, flexWrap: "nowrap" }}>
                      {l.photo_url
                        ? <img src={l.photo_url} alt="" style={{ width: 38, height: 38, borderRadius: 11, objectFit: "cover", flex: "none" }} />
                        : <span style={{ width: 38, height: 38, borderRadius: 11, display: "grid", placeItems: "center", background: l.id ? plantBg(t) : "var(--fx-surface-2)", fontSize: 19, flex: "none" }}>{l.id ? plantIcon(t) : "📦"}</span>}
                      <span className="fx-grow" style={{ minWidth: 0 }}>
                        <b style={{ fontSize: 14.5 }}>{l.id ? plantName(l.name) : l.name}</b>
                        <small className="fx-muted" style={{ display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.products.length ? l.products.map((p) => `${num(p.n)} ${p.name}`).join(" · ") : "ما في إنتاج لسا"}</small>
                      </span>
                      <b className="fx-num" style={{ fontSize: 18, color: l.n ? "var(--fx-navy)" : "var(--fx-muted)" }}>{num(l.n)}</b>
                    </span>
                    <span style={{ height: 6, borderRadius: 6, background: "var(--fx-surface-2)", overflow: "hidden" }}>
                      <span style={{ display: "block", width: `${(l.n / max) * 100}%`, height: "100%", background: l.id ? plantBg(t) : "#9fb3c8", borderRadius: 6 }} />
                    </span>
                  </button>
                );
              })}
            </section>
          )}

          <div className="fx-grid2" style={{ gridTemplateColumns: h.production_by_line?.length ? "1fr 1fr" : "1fr 1fr 1fr" }}>
            {[
              !h.production_by_line?.length && ["إنتاج اليوم", num(h.production), "كرتونة", "/f/stock"],
              ["كاش مع السواقين", money(h.cash_with_drivers), "د.أ", "/f/jard"],
              ["ديون الزباين", money(h.debts.total), `${h.debts.customers} زبون`, "/f/debts"],
            ].filter(Boolean).map(([l, v, sub, to]) => (
              <button key={l} className="fx-card" style={{ border: 0, font: "inherit", cursor: "pointer", textAlign: "center", padding: "14px 6px" }} onClick={() => nav(to)}>
                <small className="fx-muted" style={{ fontSize: 11.5 }}>{l}</small>
                <b className="fx-num" style={{ display: "block", fontSize: 18, margin: "4px 0 2px" }}>{v}</b>
                <small className="fx-muted" style={{ fontSize: 11 }}>{sub}</small>
              </button>
            ))}
          </div>

          {/* بدّه انتباهك — بس إذا في إشي */}
          {(() => {
            const rows = [
              h.open_orders.unassigned > 0 && ["📦", `${h.open_orders.unassigned} طلب بدون سيارة`, "/f/orders"],
              h.pending_expenses > 0 && ["🧾", `${h.pending_expenses} مصروف بستنى موافقتك`, "/f/money?tab=expenses"],
              h.low_stock.length > 0 && ["📉", `رصيد قليل: ${h.low_stock.slice(0, 2).map((p) => p.name).join("، ")}${h.low_stock.length > 2 ? ` +${h.low_stock.length - 2}` : ""}`, "/f/stock"],
              h.damage_month.cartons > 0 && ["⚠️", `توالف الشهر ${num(h.damage_month.cartons)} كرتونة`, "/f/reports"],
            ].filter(Boolean);
            if (!rows.length) return <div className="fx-pill ok" style={{ justifySelf: "start", padding: "6px 12px", fontSize: 13 }}>✓ كل إشي ماشي · {h.open_orders.n} طلب مفتوح</div>;
            return (
              <div className="fx-list">
                {rows.map(([icon, text, to]) => (
                  <button key={text} className="fx-item" onClick={() => nav(to)}>
                    <span className="fx-avatar" style={{ fontSize: 17 }}>{icon}</span>
                    <span className="t"><b style={{ fontWeight: 600 }}>{text}</b></span>
                    <FiChevronLeft style={{ color: "var(--fx-muted)" }} />
                  </button>
                ))}
              </div>
            );
          })()}

          {/* السيارات: الخريطة دايمًا مفتوحة، وتحتها سهم بيفتح قائمة السيارات */}
          <CarsBlock vehicles={h.vehicles} open={carsOpen} setOpen={setCarsOpen} />
        </>
      )}
    </div>
  );
}

// خريطة السيارات على الرئيسية: بتتحدّث كل 30 ثانية
function CarsBlock({ vehicles, open, setOpen }) {
  const nav = useNavigate();
  const [live, setLive] = useState(null);
  const [sel, setSel] = useState(null);
  useEffect(() => {
    let on = true;
    const load = () => fapi.live().then((d) => on && setLive(d)).catch(() => on && setLive((x) => x || false));
    load();
    const t = setInterval(load, 30000);
    return () => { on = false; clearInterval(t); };
  }, []);
  const cnt = (st) => vehicles.filter((v) => v.state === st).length;
  const sum = [cnt("move") && `${cnt("move")} بالطريق`, cnt("late") && `${cnt("late")} متأخرة`, cnt("planned") && `${cnt("planned")} جاهزة`, cnt("back") && `${cnt("back")} رجعت`].filter(Boolean).join(" · ") || `${vehicles.length} سيارة`;
  return (
    <div className="hm-cars">
      <div className="hm-cars-h">
        <span className="t"><b>وين السيارات</b><small style={cnt("late") ? { color: "var(--fx-crit)", fontWeight: 700 } : undefined}>{sum}</small></span>
        <button className="hm-cars-full" onClick={() => nav("/f/live")} aria-label="افتح الخريطة كبيرة"><FiMaximize2 /></button>
      </div>
      {live !== false && (
        <div className="hm-cars-map">
          {live
            ? <Suspense fallback={<div className="hm-cars-wait">الخريطة عم تحمّل...</div>}><LiveMap data={live} selected={sel} onSelect={setSel} height="280px" compact /></Suspense>
            : <div className="hm-cars-wait">الخريطة عم تحمّل...</div>}
        </div>
      )}
      <button className={`hm-cars-arrow ${open ? "on" : ""}`} onClick={() => setOpen(!open)} aria-expanded={open}>
        <span>{open ? "سكّر السيارات" : `السيارات (${vehicles.length})`}</span>
        <FiChevronDown />
      </button>
      {open && (
        <div className="hm-cars-list">
          {vehicles.length === 0 && <div className="fx-muted" style={{ padding: 12, textAlign: "center" }}>ما في سيارات — ضيفها من الإعدادات.</div>}
          {vehicles.map((v) => {
            const [label, dot] = STATE[v.state] || ["", ""];
            return (
              <button key={v.id} className="hm-car" onClick={() => { const lv = live?.vehicles?.find((x) => x.id === v.id); if (lv?.lat != null) { setSel(v.id); window.scrollTo({ top: document.querySelector(".hm-cars-map")?.offsetTop - 80 || 0, behavior: "smooth" }); } else nav("/f/trips"); }}>
                <span className="t">
                  <b>{v.name}{v.driver_name ? ` · ${v.driver_name}` : ""}</b>
                  <small>{v.trip_id ? `${v.done}/${v.stops} وقفات · ${num(v.load)} كرتونة` : v.governorate || "بدون رحلة"}</small>
                </span>
                <span className="st"><i className={`fx-dot ${dot}`} />{label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
