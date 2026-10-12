import { useEffect, useState } from "react";
import { FiPrinter } from "react-icons/fi";
import { api } from "../api.js";
import { LogoMark } from "../components/Logo.jsx";

const money = (n) => `${Number(n || 0).toFixed(2)} د.أ`;
const STATUS = { DELIVERED: "تم التوصيل", NEW: "جديد", IN_ROUTE: "بالطريق", READY: "جاهز", CANCELLED: "ملغي", FAILED: "تعذّر", POSTPONED: "مؤجل" };

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

  if (error) return <div className="invoice-page"><div className="invoice"><p style={{ textAlign: "center" }}>{error}</p></div></div>;
  if (!d) return <div className="invoice-page"><div className="invoice"><p className="text-secondary" style={{ textAlign: "center" }}>جاري التحميل...</p></div></div>;

  const o = d.order;
  const date = new Date(o.delivered_at || o.created_at).toLocaleString("ar-JO", { timeZone: "Asia/Amman", dateStyle: "long", timeStyle: "short" });

  return (
    <div className="invoice-page">
      <div className="invoice">
        <div className="invoice-head">
          <div>
            <div className="invoice-shop">{d.shop.name}</div>
            {d.shop.phone && <div className="text-secondary tabular-num" dir="ltr" style={{ textAlign: "right" }}>{d.shop.phone}</div>}
          </div>
          <div style={{ textAlign: "left" }}>
            <div className="invoice-title">فاتورة</div>
            <div className="text-secondary tabular-num">#{o.number}</div>
          </div>
        </div>

        <div className="invoice-meta">
          <div><span>الزبون</span><strong>{d.customer.name}</strong></div>
          <div><span>التاريخ</span><strong>{date}</strong></div>
          <div><span>الحالة</span><strong>{STATUS[o.status] || o.status}</strong></div>
        </div>

        <table className="invoice-table">
          <thead>
            <tr><th>الصنف</th><th>الكمية</th><th>السعر</th><th>المجموع</th></tr>
          </thead>
          <tbody>
            {d.items.map((it, i) => (
              <tr key={i}>
                <td>{it.name}{it.coupon_quantity > 0 && <div className="text-secondary" style={{ fontSize: "0.75rem" }}>🎫 {it.coupon_quantity} بكوبون</div>}</td>
                <td className="tabular-num">{it.quantity}</td>
                <td className="tabular-num">{Number(it.unit_price).toFixed(2)}</td>
                <td className="tabular-num">{Number(it.line_total).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="invoice-totals">
          {o.discount > 0 && <div><span>خصم</span><span className="tabular-num">−{money(o.discount)}</span></div>}
          <div className="grand"><span>الإجمالي</span><span className="tabular-num">{money(o.total)}</span></div>
          {o.coupons_used > 0 && <div><span>انخصم كوبونات</span><span className="tabular-num">{o.coupons_used}</span></div>}
          {o.cash_paid != null && <div><span>المدفوع</span><span className="tabular-num">{money(o.cash_paid)}</span></div>}
          {o.debt_added > 0 && <div><span>انضاف على الحساب</span><span className="tabular-num">{money(o.debt_added)}</span></div>}
        </div>

        <div className="invoice-account">
          <div><span>رصيد الكوبونات</span><strong className="tabular-num">{d.customer.coupon_balance}</strong></div>
          <div><span>الرصيد المستحق</span><strong className="tabular-num" style={{ color: d.customer.debt_balance > 0 ? "#D64545" : undefined }}>{money(d.customer.debt_balance)}</strong></div>
        </div>

        <p className="invoice-thanks">شكرًا لثقتك فينا 💧</p>

        <button className="btn-secondary icon-row no-print" style={{ justifyContent: "center" }} onClick={() => window.print()}>
          <FiPrinter aria-hidden="true" /> طباعة / حفظ PDF
        </button>

        <div className="invoice-footer">
          <LogoMark size={18} color="#0A66F5" strokeWidth={4} /> صادرة من نظام موج
        </div>
      </div>
    </div>
  );
}
