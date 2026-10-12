import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FiCopy, FiCheck, FiImage, FiPhone, FiMessageCircle, FiLogOut, FiClock, FiX } from "react-icons/fi";
import { FaWhatsapp } from "react-icons/fa";
import { api } from "../api.js";
import { whatsappNumber } from "../shop.js";

const STATUS = {
  pending: { label: "قيد المراجعة", color: "var(--warning)", bg: "var(--warning-soft)" },
  approved: { label: "تم الاعتماد", color: "var(--success)", bg: "var(--success-soft)" },
  rejected: { label: "مرفوضة", color: "var(--urgent)", bg: "var(--urgent-soft)" },
};

function longDate(d) {
  return new Date(d).toLocaleDateString("ar-JO", { timeZone: "Asia/Amman", day: "numeric", month: "long", year: "numeric" });
}

// اشتراك المحل بموج: الحالة، التجديد بتحويل كليك وإرفاق الإيصال، والتواصل المباشر
export default function Subscription({ locked = false, onLogout, onRefresh }) {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [months, setMonths] = useState(1);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [copied, setCopied] = useState(false);

  function load() {
    api.getSubscription().then(setData).catch((err) => setError(err.message));
  }
  useEffect(load, []);

  if (!data) {
    return <div className="page">{error ? <div className="error-box">{error}</div> : <p className="text-secondary">جاري التحميل...</p>}</div>;
  }

  const a = data.access;
  const price = data.monthly_price;
  const total = price ? price * months : null;
  const cliq = data.payment?.cliq_number || "0792376983";
  const phone = data.payment?.contact_phone || cliq;
  const hasPending = data.payments.some((p) => p.status === "pending");
  const waText = `مرحبا، أنا ${data.shop.name} على موج. بدي أجدد الاشتراك 🌊`;

  function pick(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
  }

  async function copyCliq() {
    try {
      await navigator.clipboard.writeText(cliq);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // تجاهل
    }
  }

  async function submit() {
    setSending(true);
    setError("");
    try {
      await api.sendSubscriptionPayment({ file, months, amount: total, note });
      setSent(true);
      setFile(null);
      setPreview(null);
      setNote("");
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  const stateCard = {
    expired: { title: "انتهى اشتراك موج", text: "البرنامج واقف لحد ما يتجدد الاشتراك. بياناتك كلها محفوظة وما بيضيع منها إشي.", tone: "urgent" },
    suspended: { title: "حساب المحل موقوف", text: "تواصل مع دعم موج عشان نرجّع الحساب يشتغل.", tone: "urgent" },
    expiring: { title: `الاشتراك بيخلص ${a.days_left <= 1 ? "بكرة" : `بعد ${a.days_left} أيام`}`, text: "جدّد هلّق عشان ما يوقف الشغل.", tone: "warning" },
    active: { title: "الاشتراك فعّال ✓", text: a.ends_at ? `لحد ${longDate(a.ends_at)} (باقي ${a.days_left} يوم)` : "", tone: "success" },
  }[a.state] || { title: "", text: "", tone: "warning" };

  return (
    <div className="page">
      <h1 className="title-lg">اشتراك موج</h1>

      <div className={`sub-state ${stateCard.tone}`}>
        <div className="sub-state-title">{stateCard.title}</div>
        <div className="sub-state-text">{stateCard.text}</div>
        {a.state !== "active" && a.ends_at && a.state !== "expiring" && (
          <div className="sub-state-text">آخر يوم كان: {longDate(a.ends_at)}</div>
        )}
      </div>

      {error && <div className="error-box">{error}</div>}
      {sent && (
        <div className="success-box">
          وصلنا الإيصال 👍 رح نراجعه ونجدد الاشتراك بأسرع وقت، وبيوصلك إشعار أول ما يتفعّل.
        </div>
      )}

      {a.state !== "suspended" && data.can_pay && (
        <div className="card">
          <h2 className="title-md" style={{ marginTop: 0 }}>جدّد بتحويل كليك</h2>

          <div className="field">
            <label>المدة</label>
            <div className="seg">
              {[1, 3, 6, 12].map((m) => (
                <button key={m} className={months === m ? "on" : ""} onClick={() => setMonths(m)}>
                  {m === 1 ? "شهر" : m === 12 ? "سنة" : `${m} شهور`}
                </button>
              ))}
            </div>
          </div>

          <div className="cliq-box">
            <div className="text-secondary" style={{ fontSize: "0.8rem" }}>حوّل {total ? <strong className="tabular-num" style={{ color: "var(--text)" }}>{total.toFixed(2)} دينار</strong> : "قيمة الاشتراك"} على كليك:</div>
            <div className="cliq-number">
              <span className="tabular-num" dir="ltr">{cliq}</span>
              <button className="icon-btn" onClick={copyCliq} aria-label="نسخ الرقم">{copied ? <FiCheck /> : <FiCopy />}</button>
            </div>
            {data.payment?.cliq_name && <div className="text-secondary" style={{ fontSize: "0.8rem" }}>باسم: {data.payment.cliq_name}</div>}
          </div>

          <label className="receipt-picker">
            {preview ? <img src={preview} alt="صورة الإيصال" /> : <span className="icon-row"><FiImage aria-hidden="true" /> ارفق صورة إيصال التحويل</span>}
            <input type="file" accept="image/*" onChange={pick} style={{ display: "none" }} />
          </label>
          {preview && (
            <button className="btn-danger-text icon-row" style={{ marginBottom: 8, fontSize: "0.8rem" }} onClick={() => { setFile(null); setPreview(null); }}>
              <FiX aria-hidden="true" /> شيل الصورة
            </button>
          )}

          <div className="field">
            <label htmlFor="pay-note">ملاحظة (اختياري)</label>
            <input id="pay-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="مثلاً: حوّلت من حساب أخوي" />
          </div>
          <button className="btn-primary" disabled={!file || sending || hasPending} onClick={submit}>
            {sending ? "جاري الإرسال..." : hasPending ? "عندك إيصال قيد المراجعة" : "ابعت الإيصال"}
          </button>
        </div>
      )}

      <div className="section-title">أو تواصل معنا مباشرة</div>
      <div className="quick-actions" style={{ marginTop: 0 }}>
        <a className="quick-action whatsapp" href={`https://wa.me/${whatsappNumber(phone)}?text=${encodeURIComponent(waText)}`} target="_blank" rel="noreferrer">
          <FaWhatsapp aria-hidden="true" /><span>واتساب</span>
        </a>
        <a className="quick-action" href={`tel:${phone}`}>
          <FiPhone aria-hidden="true" /><span>اتصال</span>
        </a>
        <button className="quick-action primary" onClick={() => navigate("/support")}>
          <FiMessageCircle aria-hidden="true" /><span>الدعم الفني</span>
        </button>
      </div>

      {data.payments.length > 0 && (
        <>
          <div className="section-title">الدفعات</div>
          <div className="list-group">
            {data.payments.map((p) => {
              const s = STATUS[p.status];
              return (
                <div key={p.id} className="list-row" style={{ cursor: "default" }}>
                  <span className="list-icon"><FiClock aria-hidden="true" /></span>
                  <span className="list-text">
                    <span className="list-title">{p.months === 1 ? "شهر" : `${p.months} شهور`}{p.amount ? ` · ${Number(p.amount).toFixed(2)} دينار` : ""}</span>
                    <div className="list-sub">
                      {longDate(p.created_at)}
                      {p.review_note && p.status === "rejected" && ` · ${p.review_note}`}
                    </div>
                  </span>
                  <span className="badge" style={{ background: s.bg, color: s.color }}>{s.label}</span>
                </div>
              );
            })}
          </div>
        </>
      )}

      {locked && (
        <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
          <button className="btn-secondary" onClick={onRefresh}>تحقق من التفعيل</button>
          <button className="btn-secondary icon-row" style={{ justifyContent: "center" }} onClick={onLogout}>
            <FiLogOut aria-hidden="true" /> خروج
          </button>
        </div>
      )}
    </div>
  );
}
