import { useEffect, useState } from "react";
import { FiChevronRight, FiChevronLeft, FiTruck, FiArrowDownLeft, FiArrowUpRight } from "react-icons/fi";
import { FaWhatsapp } from "react-icons/fa";
import { api } from "../api.js";
import { shopName } from "../shop.js";

const money = (n) => `${Number(n || 0).toFixed(2)}`;
const time = (d) => new Date(d).toLocaleTimeString("ar-JO", { timeZone: "Asia/Amman", hour: "numeric", minute: "2-digit" });

function addDays(date, n) {
  return new Date(Date.parse(`${date}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
}
function dayTitle(date, isToday) {
  if (isToday) return "اليوم";
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("ar-JO", { weekday: "long", day: "numeric", month: "long" });
}

function Row({ label, value, strong, color, sub }) {
  return (
    <div className="mini-ledger-row">
      <span>{label}{sub && <div className="text-secondary" style={{ fontSize: "0.75rem" }}>{sub}</div>}</span>
      <span className="tabular-num" style={{ fontWeight: strong ? 800 : 700, color }}>{value}</span>
    </div>
  );
}

// الجرد اليومي: كم دخل، كم طلع، كل كابتن كم معه، ومين سدّد دين ومين قبضه
export default function Jard() {
  const [date, setDate] = useState(null);
  const [today, setToday] = useState(null);
  const [d, setD] = useState(null);
  const [error, setError] = useState("");

  function load(x) {
    setD(null);
    api.getJard(x).then((r) => {
      setD(r);
      setDate(r.date);
      if (r.is_today) setToday(r.date);
    }).catch((err) => setError(err.message));
  }
  useEffect(() => load(null), []);

  function go(n) {
    const x = addDays(date, n);
    if (today && x > today) return;
    load(x);
  }

  const s = d?.summary;
  const shareText = d ? [
    `📊 جرد ${shopName()} — ${dayTitle(d.date, d.is_today)} (${d.date})`,
    "",
    `🚚 تسليم: ${s.delivered} طلب · قيمتها ${money(s.sales_value)} JD`,
    `💵 كاش من الرحلات: ${money(s.trip_cash)} JD`,
    s.shop_debt_payments ? `💳 تسديد ديون بالمحل: ${money(s.shop_debt_payments)} JD` : null,
    s.coupon_sales_cash ? `🎫 بيع باقات: ${money(s.coupon_sales_cash)} JD` : null,
    `⬇️ المجموع داخل: ${money(s.money_in)} JD`,
    s.expenses ? `🧾 صرفيات: ${money(s.expenses)} JD` : null,
    s.payroll_out ? `👷 رواتب وسحوبات: ${money(s.payroll_out)} JD` : null,
    `⬆️ المجموع طالع: ${money(s.money_out)} JD`,
    `✅ الصافي: ${money(s.net_cash)} JD`,
    "",
    s.debt_added ? `📝 ديون جديدة: ${money(s.debt_added)} JD` : null,
    s.debt_collected ? `✔️ ديون انسدّت: ${money(s.debt_collected)} JD` : null,
    s.coupons_used ? `🎫 كوبونات انخصمت: ${s.coupons_used} (إلكتروني ${s.coupons_electronic}${s.coupons_paper ? ` · ورقي ${s.coupons_paper}` : ""})` : null,
    s.packages_sold ? `🎟️ باقات انباعت: ${s.packages_sold} (${s.coupons_sold} كوبون) · قبضنا ${money(s.coupon_sales_cash)} من ${money(s.coupon_sales_value)} JD` : null,
    "",
    ...d.drivers.map((x) => `• ${x.driver_name}: ${x.delivered ? `${x.delivered} طلب` : "بالمحل"}${x.pkg_count ? ` + ${x.pkg_count} باقة` : ""}${x.debt_cash ? ` + سداد ديون ${money(x.debt_cash)}` : ""}، معه ${money(x.total_cash)} JD`),
  ].filter((x) => x !== null).join("\n") : "";

  return (
    <div className="page">
      <h1 className="title-lg">الجرد اليومي</h1>
      {error && <div className="error-box">{error}</div>}

      <div className="date-nav">
        <button className="icon-btn" onClick={() => go(-1)} disabled={!date} aria-label="اليوم اللي قبل"><FiChevronRight /></button>
        <div style={{ flex: 1, textAlign: "center", fontWeight: 700 }}>{date ? dayTitle(date, d?.is_today) : "..."}</div>
        <button className="icon-btn" onClick={() => go(1)} disabled={!date || date >= today} aria-label="اليوم اللي بعد"><FiChevronLeft /></button>
      </div>

      {!d && !error && <p className="text-secondary">جاري الحساب...</p>}

      {d && (
        <>
          <div className="jard-hero">
            <div className="jard-net">
              <div className="text-secondary" style={{ fontSize: "0.8rem" }}>الصافي (داخل − طالع)</div>
              <div className="tabular-num" style={{ fontSize: "2rem", fontWeight: 800, color: s.net_cash >= 0 ? "var(--navy)" : "var(--urgent)" }}>{money(s.net_cash)} <small style={{ fontSize: "0.9rem" }}>JD</small></div>
            </div>
            <div className="jard-io">
              <div><FiArrowDownLeft aria-hidden="true" style={{ color: "var(--success)" }} /> داخل <strong className="tabular-num">{money(s.money_in)}</strong></div>
              <div><FiArrowUpRight aria-hidden="true" style={{ color: "var(--urgent)" }} /> طالع <strong className="tabular-num">{money(s.money_out)}</strong></div>
            </div>
          </div>

          <div className="card">
            <h2 className="title-md" style={{ marginTop: 0 }}>الدخل</h2>
            <div className="mini-ledger" style={{ marginTop: 0 }}>
              <Row label="كاش من التوصيل" value={money(s.trip_cash)} sub={`${s.delivered} طلب متسلّم · قيمتها ${money(s.sales_value)}`} />
              {s.shop_debt_payments > 0 && <Row label="تسديد ديون بالمحل" value={money(s.shop_debt_payments)} />}
              {s.coupon_sales_cash > 0 && <Row label="بيع باقات كوبونات" value={money(s.coupon_sales_cash)} />}
              <Row label="المجموع" value={money(s.money_in)} strong color="var(--success)" />
            </div>
            <h2 className="title-md">المصاريف</h2>
            <div className="mini-ledger" style={{ marginTop: 0 }}>
              <Row label="صرفيات المحل" value={money(s.expenses)} sub={d.expenses_notes || null} />
              <Row label="رواتب وسحوبات" value={money(s.payroll_out)} />
              <Row label="المجموع" value={money(s.money_out)} strong color="var(--urgent)" />
            </div>
          </div>

          {(s.coupons_used > 0 || s.packages_sold > 0) && (
            <div className="card">
              <h2 className="title-md" style={{ marginTop: 0 }}>الكوبونات</h2>
              <div className="jd-cp">
                <div className="jd-cp-box out">
                  <span>انخصم</span>
                  <b className="tabular-num">{s.coupons_used}</b>
                  <small>{s.coupons_used ? `إلكتروني ${s.coupons_electronic}${s.coupons_paper ? ` · ورقي ${s.coupons_paper}` : ""}` : "ولا كوبون"}</small>
                </div>
                <div className="jd-cp-box in">
                  <span>انباع</span>
                  <b className="tabular-num">{s.coupons_sold}</b>
                  <small>{s.packages_sold ? `${s.packages_sold} باقة · ${money(s.coupon_sales_value)} JD` : "ولا باقة"}</small>
                </div>
              </div>
              {s.packages_sold > 0 && s.coupon_sales_value > s.coupon_sales_cash && (
                <div className="jd-cp-note tabular-num">قبضنا {money(s.coupon_sales_cash)} JD، والباقي {money(s.coupon_sales_value - s.coupon_sales_cash)} JD صار دين</div>
              )}
            </div>
          )}

          {d.drivers.length > 0 && (
            <>
              <div className="section-title">الكباتن والموظفين — كل واحد كم معه</div>
              <div className="list-group">
                {d.drivers.map((x) => (
                  <div key={x.driver_id || 0} className="fc-row">
                    <div className="fc-head">
                      <span className="list-icon"><FiTruck aria-hidden="true" /></span>
                      <div style={{ flex: 1 }}>
                        <div className="fc-name">{x.driver_name}</div>
                        <div className="fc-sub">
                          {x.delivered ? `سلّم ${x.delivered} طلب` : "ما سلّم طلبات"}{x.coupons ? ` · خصم ${x.coupons} كوبون${x.paper_coupons ? ` (${x.paper_coupons} ورقي)` : ""}` : ""}{x.empties ? ` · ${x.empties} فارغ` : ""}
                          {x.debt_added ? ` · دين ${money(x.debt_added)}` : ""}{x.debt_paid ? ` · قبض ديون ${money(x.debt_paid)}` : ""}
                        </div>
                        {x.debt_cash > 0 && (
                          <div className="fc-sub" style={{ color: "var(--success)", fontWeight: 700 }}>
                            💳 قبض سداد ديون {money(x.debt_cash)} ({x.debt_cash_count} زبون)
                          </div>
                        )}
                        {x.pkg_count > 0 && (
                          <div className="fc-sub" style={{ color: "var(--primary)", fontWeight: 700 }}>
                            🎫 باع {x.pkg_count} باقة ({x.pkg_coupons} كوبون) · قبض {money(x.pkg_cash)}
                          </div>
                        )}
                      </div>
                      <div style={{ textAlign: "left" }}>
                        <div className="tabular-num" style={{ fontWeight: 800 }}>{money(x.total_cash)}</div>
                        <div className="fc-sub">معه كاش</div>
                        {[x.cash, x.pkg_cash, x.debt_cash].filter((v) => v > 0).length > 1 && (
                          <div className="fc-sub tabular-num" style={{ fontSize: "0.68rem" }}>
                            {[x.cash > 0 && `${money(x.cash)} توصيل`, x.pkg_cash > 0 && `${money(x.pkg_cash)} باقات`, x.debt_cash > 0 && `${money(x.debt_cash)} ديون`].filter(Boolean).join(" + ")}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {d.debt_payments.length > 0 && (
            <>
              <div className="section-title">مين سدّد دين — ومين قبض</div>
              <div className="list-group">
                {d.debt_payments.map((p) => (
                  <div key={p.id} className="list-row" style={{ cursor: "default" }}>
                    <span className="list-text">
                      <span className="list-title">{p.customer_name}</span>
                      <div className="list-sub">
                        قبضها {p.collected_by || "—"} · {p.trip_id ? "مع التوصيل" : "بالمحل"} · {time(p.created_at)}
                        {p.balance_after > 0 ? ` · باقي عليه ${money(p.balance_after)}` : " · خلّص دينه ✓"}
                      </div>
                    </span>
                    <strong className="tabular-num" style={{ color: "var(--success)" }}>{money(p.amount)}</strong>
                  </div>
                ))}
              </div>
            </>
          )}

          {d.new_debts.length > 0 && (
            <>
              <div className="section-title">ديون جديدة</div>
              <div className="list-group">
                {d.new_debts.map((p) => (
                  <div key={p.id} className="list-row" style={{ cursor: "default" }}>
                    <span className="list-text">
                      <span className="list-title">{p.customer_name}</span>
                      <div className="list-sub">{p.by_name || "—"} · {time(p.created_at)}{p.notes ? ` · ${p.notes}` : ""}</div>
                    </span>
                    <strong className="tabular-num" style={{ color: "var(--urgent)" }}>{money(p.amount)}</strong>
                  </div>
                ))}
              </div>
            </>
          )}

          {d.coupon_sales.length > 0 && (
            <>
              <div className="section-title">باقات انباعت</div>
              <div className="list-group">
                {d.coupon_sales.map((x) => (
                  <div key={x.id} className="list-row" style={{ cursor: "default" }}>
                    <span className="list-text">
                      <span className="list-title">{x.customer_name}</span>
                      <div className="list-sub">{x.package_name_snapshot} · باعها {x.sold_by_name || "—"} · {x.trip_id ? "من الرحلة" : "بالمحل"} · {time(x.created_at)}</div>
                    </span>
                    <strong className="tabular-num">{money(x.paid)}{x.paid < x.price ? <div style={{ fontSize: "0.7rem", color: "var(--urgent)" }}>من {money(x.price)}</div> : null}</strong>
                  </div>
                ))}
              </div>
            </>
          )}

          {d.payroll.length > 0 && (
            <>
              <div className="section-title">رواتب وسحوبات الموظفين</div>
              <div className="list-group">
                {d.payroll.map((x) => (
                  <div key={x.id} className="list-row" style={{ cursor: "default" }}>
                    <span className="list-text">
                      <span className="list-title">{x.employee_name}</span>
                      <div className="list-sub">{x.kind === "advance" ? "سحب" : "صرف راتب"}{x.note ? ` · ${x.note}` : ""}{x.by_name ? ` · ${x.by_name}` : ""}</div>
                    </span>
                    <strong className="tabular-num">{money(x.amount)}</strong>
                  </div>
                ))}
              </div>
            </>
          )}

          {d.products.length > 0 && (
            <>
              <div className="section-title">اللي نزل من السيارات</div>
              <div className="card mini-ledger" style={{ marginTop: 0 }}>
                {d.products.map((p) => (
                  <Row key={p.name} label={p.name} value={`${p.qty}${p.by_coupon ? ` (${p.by_coupon} بكوبون)` : ""}`} />
                ))}
                {s.empties > 0 && <Row label="فوارغ رجعت" value={s.empties} />}
              </div>
            </>
          )}

          <a className="btn-primary icon-row" style={{ justifyContent: "center", textDecoration: "none", background: "var(--whatsapp)", marginTop: 6 }} href={`https://wa.me/?text=${encodeURIComponent(shareText)}`} target="_blank" rel="noreferrer">
            <FaWhatsapp aria-hidden="true" /> ابعت الجرد على واتساب
          </a>
        </>
      )}
    </div>
  );
}
