import { useEffect, useState } from "react";
import { api } from "../api.js";
import { LogoMark } from "../components/Logo.jsx";

const REASONS = {
  package_purchase: "شحن باقة",
  recharge: "شحن كوبونات",
  order_payment: "توصيل طلب",
  delivery_undo: "تصحيح",
  manual_adjustment: "تعديل من المحل",
};

function Ticket({ used }) {
  return (
    <svg viewBox="0 0 28 18" className={`inv-tk${used ? " used" : ""}`} aria-hidden="true">
      <path d="M2 2h24v4a3 3 0 0 0 0 6v4H2v-4a3 3 0 0 0 0-6z" />
    </svg>
  );
}

// صفحة رصيد كوبونات الزبون — بيفتحها من رابط الواتساب بدون تسجيل دخول
export default function PublicWallet({ token }) {
  const [d, setD] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", "light");
    api.getPublicWallet(token).then((r) => {
      setD(r);
      document.title = `رصيد كوبوناتك — ${r.shop.name}`;
    }).catch((err) => setError(err.message));
  }, [token]);

  if (error) return <div className="inv-page"><div className="inv"><p style={{ textAlign: "center", padding: 30 }}>{error}</p></div></div>;
  if (!d) return <div className="inv-page"><div className="inv"><p className="text-secondary" style={{ textAlign: "center", padding: 30 }}>جاري التحميل...</p></div></div>;

  const balance = Number(d.customer.coupon_balance || 0);
  const total = Math.max(balance, d.last_package?.coupons || 0);
  const showTickets = total > 0 && total <= 30;
  const pct = total > 0 ? Math.round((balance / total) * 100) : 0;
  const low = balance > 0 && balance <= 2;
  const first = (d.customer.name || "").trim().split(/\s+/).slice(0, ["أبو", "ابو", "أم", "ام"].includes((d.customer.name || "").trim().split(/\s+/)[0]) ? 2 : 1).join(" ");
  const fmt = (iso) => new Date(iso).toLocaleDateString("ar-JO", { timeZone: "Asia/Amman", day: "numeric", month: "long" });

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
            <div className="inv-no"><span>رصيد</span><b>كوبوناتك</b></div>
          </div>
          <div className="inv-hero-meta"><span>أهلًا {first} 👋</span></div>
        </div>

        <div className="inv-body">
          <div className={`inv-wallet${balance === 0 ? " empty" : low ? " low" : ""}`} style={{ marginTop: 0 }}>
            <div className="inv-wallet-glow" aria-hidden="true" />
            <div className="inv-wallet-top">
              <span className="inv-wallet-label">رصيدك هلّق</span>
              {d.last_package && <span className="inv-wallet-pkg">آخر باقة: {d.last_package.name}</span>}
            </div>
            <div className="inv-wallet-num">
              <b className="tabular-num">{balance}</b>
              <span>{balance === 0 ? "خلصت الكوبونات" : `كوبون باقي · يعني ${balance} قارورة`}</span>
            </div>
            {total > 0 && (showTickets ? (
              <div className="inv-tickets">
                {Array.from({ length: total }, (_, i) => <Ticket key={i} used={i >= balance} />)}
              </div>
            ) : (
              <div className="inv-wallet-bar"><span style={{ width: `${pct}%` }} /></div>
            ))}
            {d.last_package && total > 0 && (
              <div className="inv-wallet-foot tabular-num"><span>باقي {balance} من {total}</span><span>شحنت {fmt(d.last_package.at)}</span></div>
            )}
            {balance === 0 && <div className="inv-wallet-hint">حابب نجددلك الباقة؟ احكي مع الكابتن أو ابعتلنا رسالة 🙏</div>}
            {low && <div className="inv-wallet-hint">رصيدك قرب يخلص — جدّد باقتك قبل ما تخلص 🙏</div>}
          </div>

          {d.history.length > 0 && (
            <div className="wl-hist">
              <div className="inv-sec-t">آخر الحركات</div>
              {d.history.map((h, i) => (
                <div key={i} className="wl-row">
                  <span className={`wl-dot ${h.change > 0 ? "in" : "out"}`} aria-hidden="true">{h.change > 0 ? "+" : "−"}</span>
                  <span className="wl-t">
                    <b>{REASONS[h.reason] || (h.change > 0 ? "إضافة" : "خصم")}</b>
                    <small>{fmt(h.at)}</small>
                  </span>
                  <span className={`wl-n tabular-num ${h.change > 0 ? "in" : "out"}`}>{h.change > 0 ? `+${h.change}` : h.change}</span>
                </div>
              ))}
            </div>
          )}

          <p className="inv-thanks">كل كوبون = قارورة، وبينخصم لحاله وقت التوصيل 💧</p>
          <div className="inv-footer"><LogoMark size={16} color="#0A66F5" strokeWidth={4} /> صادرة من نظام موج</div>
        </div>
      </div>
    </div>
  );
}

