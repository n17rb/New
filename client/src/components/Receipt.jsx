import { useEffect, useState } from "react";
import { FiX, FiCheckCircle } from "react-icons/fi";
import { FaWhatsapp } from "react-icons/fa";
import { api } from "../api.js";
import { renderMessage } from "../messages.js";

export function invoiceUrl(token) {
  return `${window.location.origin}/i/${token}`;
}

// رابط رصيد كوبونات الزبون
export function walletUrl(token) {
  return `${window.location.origin}/w/${token}`;
}

// رسالة «انضافلك كوبونات» — قصيرة ومرتبة مع رابط الرصيد
export function couponsAddedText({ name, added, balance, packageName = "", unpaid = 0, walletToken = null }) {
  return renderMessage("coupons_added", {
    "الاسم": name,
    "الكوبونات": couponsWord(added),
    "الباقة": packageName,
    "الرصيد": couponsWord(balance),
    "الباقي": unpaid > 0 ? `باقي من ثمن الباقة: ${Number(unpaid).toFixed(2)} دينار` : "",
    "الرابط": walletToken ? walletUrl(walletToken) : "",
  }).replace(/\n{3,}/g, "\n\n").trim();
}

export function couponsWord(n) {
  if (n === 0) return "ما ضل عندك كوبونات";
  if (n === 1) return "كوبون واحد";
  if (n === 2) return "كوبونين";
  if (n >= 3 && n <= 10) return `${n} كوبونات`;
  return `${n} كوبون`;
}

const money = (n) => `${Number(n || 0).toFixed(2)} دينار`;

// نص إيصال التسليم اللي بينبعت للزبون على واتساب
export function buildReceiptText({ name, items = [], couponsUsed = 0, couponBalance = 0, cashPaid = 0, debtAdded = 0, debtPaid = 0, debtBalance = 0, invoiceToken = null }) {
  const lines = [];
  for (const it of items) lines.push(`🧾 ${it.quantity} × ${it.product_name_snapshot}`);
  if (couponsUsed > 0) {
    lines.push(`🎫 تم دفع ${couponsUsed === 1 ? "كوبون" : couponsWord(couponsUsed)} — ${couponBalance > 0 ? `تبقى لديك ${couponsWord(couponBalance)}` : "خلص رصيد كوبوناتك"}`);
  } else if (couponBalance > 0) {
    lines.push(`🎫 رصيد كوبوناتك: ${couponsWord(couponBalance)}`);
  }
  if (cashPaid > 0) lines.push(`💵 المدفوع: ${money(cashPaid)}${debtPaid > 0 ? ` (منها ${money(debtPaid)} من الحساب القديم)` : ""}`);
  if (debtAdded > 0) lines.push(`📝 انضاف على حسابك: ${money(debtAdded)}`);
  if (debtBalance > 0) lines.push(`💳 الرصيد المستحق عليك: ${money(debtBalance)}`);
  else if (debtPaid > 0) lines.push("✔️ حسابك صار صفر — شكرًا إلك");
  if (couponsUsed > 0 && couponBalance <= 2) {
    lines.push("", couponBalance === 0 ? "حابب نجددلك باقة الكوبونات؟ 🙏" : "رصيد كوبوناتك قرب يخلص — حابب نجددلك الباقة؟ 🙏");
  }
  if (invoiceToken) lines.push("", `🧾 الفاتورة: ${invoiceUrl(invoiceToken)}`);
  return renderMessage("receipt", { "الاسم": name, "التفاصيل": lines.join("\n").trim() });
}

export function receiptLink(phone, data) {
  return `https://wa.me/${phone}?text=${encodeURIComponent(buildReceiptText(data))}`;
}

// إيصال من بيانات توقف متسلّم (من تفاصيل الرحلة)
export function receiptFromStop(stop) {
  return {
    name: stop.customer_name,
    items: stop.items || [],
    couponsUsed: Number(stop.coupons_collected || 0),
    couponBalance: Number(stop.coupon_balance || 0),
    cashPaid: Number(stop.cash_collected || 0),
    debtAdded: Number(stop.debt_added || 0),
    debtPaid: Number(stop.debt_paid || 0),
    debtBalance: Number(stop.debt_balance || 0),
  };
}

// بطاقة بعد التسليم مباشرة: ملخص سريع + زر يبعت الإيصال للزبون
export function ReceiptBanner({ receipt, onClose }) {
  const { stop, result } = receipt;
  const [invoiceToken, setInvoiceToken] = useState(result.invoice_token || null);
  useEffect(() => {
    if (result.invoice_token) return;
    api.getInvoiceLink(stop.order_id).then((r) => setInvoiceToken(r.token)).catch(() => {});
  }, [stop.order_id, result.invoice_token]);
  const data = {
    invoiceToken,
    name: stop.customer_name,
    items: stop.items || [],
    couponsUsed: result.coupons_used || 0,
    couponBalance: result.coupon_balance ?? stop.coupon_balance ?? 0,
    cashPaid: result.cash_collected || 0,
    debtAdded: result.debt_added || 0,
    debtPaid: result.debt_paid || 0,
    debtBalance: result.debt_balance || 0,
  };
  const chips = [];
  if (data.couponsUsed > 0) chips.push(`🎫 انخصم ${data.couponsUsed} · باقي ${data.couponBalance}`);
  if (data.cashPaid > 0) chips.push(`💵 ${Number(data.cashPaid).toFixed(2)} JD`);
  if (data.debtAdded > 0) chips.push(`📝 دين ${Number(data.debtAdded).toFixed(2)}`);
  if (data.debtPaid > 0) chips.push(`✔️ سدّد ${Number(data.debtPaid).toFixed(2)}`);
  const emphasize = data.couponsUsed > 0 || data.debtAdded > 0;

  return (
    <div className="card receipt-banner">
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <FiCheckCircle style={{ color: "var(--success)", flexShrink: 0 }} size={20} aria-hidden="true" />
        <div style={{ flex: 1, fontWeight: 700 }}>تسلّم {stop.customer_name}</div>
        <button className="icon-btn" style={{ width: 32, height: 32 }} onClick={onClose} aria-label="إغلاق"><FiX size={15} /></button>
      </div>
      {chips.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "8px 0 0" }}>
          {chips.map((c) => <span key={c} className="badge">{c}</span>)}
        </div>
      )}
      <a
        className={emphasize ? "btn-primary icon-row" : "btn-secondary icon-row"}
        style={{ justifyContent: "center", textDecoration: "none", marginTop: 10, ...(emphasize ? { background: "var(--whatsapp)" } : {}) }}
        href={receiptLink(stop.phone_normalized, data)}
        target="_blank"
        rel="noreferrer"
        onClick={async (e) => {
          // الرابط لسا ما وصل؟ بنجيبه أول عشان الرسالة يكون فيها رابط الفاتورة
          if (!invoiceToken) {
            e.preventDefault();
            const w = window.open("", "_blank");
            let token = null;
            try { token = (await api.getInvoiceLink(stop.order_id)).token; } catch { /* بدون رابط */ }
            const url = receiptLink(stop.phone_normalized, { ...data, invoiceToken: token });
            if (w) w.location.href = url; else window.location.href = url;
          }
          onClose();
        }}
      >
        <FaWhatsapp aria-hidden="true" /> ابعتله إيصال على واتساب
      </a>
    </div>
  );
}
