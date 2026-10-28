import { useEffect, useState } from "react";
import { FiPrinter, FiCheck } from "react-icons/fi";
import { api } from "../api.js";
import { LogoMark } from "../components/Logo.jsx";

const money = (n) => Number(n || 0).toFixed(2);
const STATUS = { DELIVERED: "تم التوصيل", NEW: "جديد", IN_ROUTE: "بالطريق", READY: "جاهز", CANCELLED: "ملغي", FAILED: "تعذّر", POSTPONED: "مؤجل" };

function couponsWord(n) {
  if (n === 1) return "كوبون واحد";
  if (n === 2) return "كوبونين";
  if (n >= 3 && n <= 10) return `${n} كوبونات`;
  return `${n} كوبون`;
}

// رسمة كوبون صغير
function Ticket({ used }) {
  return (
    <svg viewBox="0 0 28 18" className={`inv-tk${used ? " used" : ""}`} aria-hidden="true">
      <path d="M2 2h24v4a3 3 0 0 0 0 6v4H2v-4a3 3 0 0 0 0-6z" />
    </svg>
  );
}

// كرت رصيد الكوبونات تحت الفاتورة
function CouponWallet({ balance, usedNow, lastPackage }) {
  const total = Math.max(balance, lastPackage?.coupons || 0, balance + usedNow);
  const pct = total > 0 ? Math.round((balance / total) * 100) : 0;
  const showTickets = total > 0 && total <= 30;
  const low = balance > 0 && balance <= 2;

  return (
    <div className={`inv-wallet${balance === 0 ? " empty" : low ? " low" : ""}`}>
      <div className="inv-wallet-glow" aria-hidden="true" />
      <div className="inv-wallet-top">
        <span className="inv-wallet-label">رصيد كوبوناتك</span>
        {lastPackage && <span className="inv-wallet-pkg">{lastPackage.name}</span>}
      </div>
      <div className="inv-wallet-num">
        <b className="tabular-num">{balance}</b>
        <span>{balance === 0 ? "خلصت الكوبونات" : balance === 1 ? "كوبون باقي" : balance === 2 ? "كوبونين باقيين" : "كوبون باقي"}</span>
      </div>
      {total > 0 && (
        <>
          {showTickets ? (
            <div className="inv-tickets">
              {Array.from({ length: total }, (_, i) => <Ticket key={i} used={i >= balance} />)}
            </div>
          ) : (
            <div className="inv-wallet-bar"><span style={{ width: `${pct}%` }} /></div>
          )}
          <div className="inv-wallet-foot tabular-num">
            {usedNow > 0 && <span>انخصم بهالطلب: {couponsWord(usedNow)}</span>}
            {lastPackage && <span>باقي {balance} من {total}</span>}
          </div>
        </>
      )}
      {balance === 0 && <div className="inv-wallet-hint">حابب نجددلك الباقة؟ احكي مع الكابتن أو ابعتلنا رسالة 🙏</div>}
      {low && <div className="inv-wallet-hint">رصيدك قرب يخلص — جدّد باقتك قبل ما تخلص 🙏</div>}
    </div>
  );
}

// الفاتورة اللي بيفتحها الزبون من رابط واتساب — بدون تسجيل دخول
export default function PublicInvoice({ token }) {
  const [d, setD] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", "light");
    api.getPublicInvoice(token).then((r) => {
      setD(r);
      document.title = `فاتورة ${r.order.number} — ${r.shop.name}`;
    }).catch((err) => setError(err.message));
  }, [token]);

  if (error) return <div className="inv-page"><div className="inv"><p style={{ textAlign: "center", padding: 30 }}>{error}</p></div></div>;
  if (!d) return <div className="inv-page"><div className="inv"><p className="text-secondary" style={{ textAlign: "center", padding: 30 }}>جاري التحميل...</p></div></div>;

  const o = d.order;
  const c = d.customer;
  const when = new Date(o.delivered_at || o.created_at);
  const date = when.toLocaleDateString("ar-JO", { timeZone: "Asia/Amman", weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const time = when.toLocaleTimeString("ar-JO", { timeZone: "Asia/Amman", hour: "numeric", minute: "2-digit" });
  const delivered = o.status === "DELIVERED";
  const couponsUsed = Number(o.coupons_used || 0);
  const cash = o.cash_paid != null ? Number(o.cash_paid) : null;
  const hasCouponStory = couponsUsed > 0 || c.coupon_balance > 0 || c.last_package;

  return (
    <div className="inv-page">
      <div className="inv">
        <div className="inv-hero">
          <div className="inv-hero-glow" aria-hidden="true" />
          <div className="inv-hero-row">
            <div>
              <div className="inv-shop">{d.shop.name}</div>
              {d.shop.phone && <div className="inv-shop-phone tabular-num" dir="ltr">{d.shop.phone}</div>}
            </div>
            <div className="inv-no">
              <span>فاتورة</span>
              <b className="tabular-num">#{o.number}</b>
            </div>
          </div>
          <div className="inv-hero-meta">
            <span className={`inv-status${delivered ? " ok" : ""}`}>{delivered && <FiCheck aria-hidden="true" />} {STATUS[o.status] || o.status}</span>
            <span>{date} · {time}</span>
          </div>
        </div>

        <div className="inv-body">
          <div className="inv-to">
            <span>الزبون</span>
            <b>{c.name}</b>
          </div>

          <div className="inv-items">
            {d.items.map((it, i) => (
              <div key={i} className="inv-item">
                <span className="inv-qty tabular-num">{it.quantity}</span>
                <span className="inv-iname">
                  {it.name}
                  <small className="tabular-num">{money(it.unit_price)} × {it.quantity}{it.coupon_quantity > 0 ? ` · ${it.coupon_quantity} بكوبون` : ""}</small>
                </span>
                <span className="inv-iprice tabular-num">{money(it.line_total)}</span>
              </div>
            ))}
          </div>

          <div className="inv-sum">
            {o.discount > 0 && <div><span>خصم</span><span className="tabular-num">−{money(o.discount)}</span></div>}
            <div className="grand"><span>الإجمالي</span><span className="tabular-num">{money(o.total)} <small>د.أ</small></span></div>
          </div>

          {(couponsUsed > 0 || cash != null || o.debt_added > 0) && (
            <div className="inv-paid">
              <div className="inv-sec-t">طريقة الدفع</div>
              <div className="inv-paid-chips">
                {couponsUsed > 0 && <span className="chip-c">🎫 {couponsWord(couponsUsed)}</span>}
                {cash != null && cash > 0 && <span className="chip-m">💵 {money(cash)} د.أ كاش</span>}
                {o.debt_added > 0 && <span className="chip-d">📝 {money(o.debt_added)} د.أ على الحساب</span>}
                {o.debt_paid > 0 && <span className="chip-m">✔️ سدّدت {money(o.debt_paid)} د.أ من الحساب</span>}
              </div>
            </div>
          )}

          {hasCouponStory && <CouponWallet balance={Number(c.coupon_balance || 0)} usedNow={couponsUsed} lastPackage={c.last_package} />}

          {c.debt_balance > 0 && (
            <div className="inv-debt">
              <span>الرصيد المستحق عليك</span>
              <b className="tabular-num">{money(c.debt_balance)} د.أ</b>
            </div>
          )}

          <p className="inv-thanks">شكرًا لثقتك فينا 💧</p>

          <button className="btn-secondary icon-row no-print" style={{ justifyContent: "center" }} onClick={() => window.print()}>
            <FiPrinter aria-hidden="true" /> طباعة / حفظ PDF
          </button>

          <div className="inv-footer">
            <LogoMark size={16} color="#0A66F5" strokeWidth={4} /> صادرة من نظام موج
          </div>
        </div>
      </div>
    </div>
  );
}
