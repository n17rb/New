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
  const [sampleCount, setSampleCount] = useState(0);
  useEffect(() => { api.getSampleCount().then((r) => setSampleCount(r.customers)).catch(() => {}); }, []);

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
  if (a.trial && (a.state === "active" || a.state === "expiring")) {
    stateCard.title = `🎁 تجربة مجانية — باقي ${a.days_left <= 1 ? "يوم" : `${a.days_left} أيام`}`;
    stateCard.text = "اشترك قبل ما تخلص التجربة وبتكمل بنفس داتاك — ما بيضيع إشي.";
    stateCard.tone = "success";
  }
  if (a.trial && a.state === "expired") {
    stateCard.title = "خلصت التجربة المجانية";
    stateCard.text = "اشترك عشان ترجع تشتغل — كل داتاك محفوظة زي ما هي.";
  }

  async function clearSample() {
    if (!window.confirm("رح تنحذف الزباين والموظفين التجريبيين بس مع طلباتهم.\nالزباين والطلبات اللي ضفتهم إنت ما رح ينلمسوا.\n\nمتأكد؟")) return;
    try {
      const r = await api.clearSampleData();
      alert(`انحذف ${r.customers} زبون تجريبي ✓`);
      window.location.href = "/";
    } catch (err) {
      setError(err.message);
    }
  }

  const pending = data.payments.find((p) => p.status === "pending");
  const icon = { urgent: "⏸", warning: "⏳", success: a.trial ? "🎁" : "✓" }[stateCard.tone] || "•";
  const daysPct = a.days_left != null ? Math.max(4, Math.min(100, Math.round((a.days_left / 30) * 100))) : null;

  return (
    <div className="page sb-page">
      <div className={`sb-hero ${stateCard.tone}`}>
        <div className="sb-hero-glow" aria-hidden="true" />
        <div className="sb-hero-ic" aria-hidden="true">{icon}</div>
        <div className="sb-hero-t">{stateCard.title.replace(" ✓", "").replace("🎁 ", "")}</div>
        <div className="sb-hero-s">{stateCard.text}</div>
        {a.state !== "active" && a.ends_at && a.state !== "expiring" && (
          <div className="sb-hero-s" style={{ opacity: 0.8 }}>آخر يوم كان: {longDate(a.ends_at)}</div>
        )}
        {(a.state === "active" || a.state === "expiring") && daysPct != null && (
          <div className="sb-days">
            <div className="sb-days-bar"><span style={{ width: `${daysPct}%` }} /></div>
            <div className="sb-days-t tabular-num">باقي {a.days_left} يوم</div>
          </div>
        )}
      </div>

      {error && <div className="error-box">{error}</div>}

      {(sent || pending) && (
        <div className="sb-pending">
          <div className="sb-pending-ic" aria-hidden="true">⏳</div>
          <div>
            <b>وصلنا إيصالك — قيد المراجعة</b>
            <small>بنجدد الاشتراك بأسرع وقت، وبيوصلك إشعار أول ما يتفعّل.{pending ? ` (انبعت ${longDate(pending.created_at)})` : ""}</small>
          </div>
        </div>
      )}

      {a.state !== "suspended" && data.can_pay && !hasPending && (
        <div className="sb-card">
          <div className="sb-card-h">
            <span>جدّد اشتراكك</span>
            <small>شهري · كل تحويل بيجدّد شهر</small>
          </div>

          <div className="sb-step">
            <span className="sb-num">١</span>
            <div className="sb-step-b">
              <div className="sb-step-t">حوّل على كليك</div>
              {total != null && <div className="sb-price tabular-num">{total.toFixed(2)} <small>دينار</small></div>}
              <button type="button" className={`sb-cliq${copied ? " ok" : ""}`} onClick={copyCliq}>
                <span className="sb-cliq-n tabular-num" dir="ltr">{cliq}</span>
                <span className="sb-cliq-c">{copied ? <><FiCheck aria-hidden="true" /> انتسخ</> : <><FiCopy aria-hidden="true" /> نسخ</>}</span>
              </button>
              {data.payment?.cliq_name && <div className="sb-step-s">باسم: <b>{data.payment.cliq_name}</b></div>}
            </div>
          </div>

          <div className="sb-step">
            <span className="sb-num">٢</span>
            <div className="sb-step-b">
              <div className="sb-step-t">صوّر إيصال التحويل</div>
              <label className={`sb-upload${preview ? " has" : ""}`}>
                {preview ? (
                  <img src={preview} alt="صورة الإيصال" />
                ) : (
                  <span className="sb-upload-e"><FiImage aria-hidden="true" /><b>اختار صورة الإيصال</b><small>سكرين شوت من تطبيق البنك</small></span>
                )}
                <input type="file" accept="image/*" onChange={pick} style={{ display: "none" }} />
              </label>
              {preview && (
                <button type="button" className="sb-link" onClick={() => { setFile(null); setPreview(null); }}><FiX aria-hidden="true" /> غيّر الصورة</button>
              )}
              <input className="sb-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="ملاحظة (اختياري) — مثلًا حوّلت من حساب أخوي" />
            </div>
          </div>

          <div className="sb-step last">
            <span className="sb-num">٣</span>
            <div className="sb-step-b">
              <button className="btn-primary sb-send" disabled={!file || sending} onClick={submit}>
                {sending ? "جاري الإرسال…" : "ابعت الإيصال"}
              </button>
              {!file && <div className="sb-step-s" style={{ textAlign: "center" }}>ارفق صورة الإيصال أول</div>}
            </div>
          </div>
        </div>
      )}

      <div className="sb-contact">
        <div className="sb-contact-t">محتاج مساعدة؟ احكي معنا</div>
        <div className="sb-contact-row">
          <a className="sb-c wa" href={`https://wa.me/${whatsappNumber(phone)}?text=${encodeURIComponent(waText)}`} target="_blank" rel="noreferrer">
            <FaWhatsapp aria-hidden="true" /><span>واتساب</span>
          </a>
          <a className="sb-c" href={`tel:${phone}`}>
            <FiPhone aria-hidden="true" /><span>اتصال</span>
          </a>
          <button type="button" className="sb-c" onClick={() => navigate("/support")}>
            <FiMessageCircle aria-hidden="true" /><span>الدعم</span>
          </button>
        </div>
      </div>

      {data.payments.length > 0 && (
        <>
          <div className="section-title">دفعاتك</div>
          <div className="sb-pays">
            {data.payments.map((p) => {
              const st = STATUS[p.status];
              return (
                <div key={p.id} className="sb-pay">
                  <span className="sb-pay-ic" aria-hidden="true"><FiClock /></span>
                  <span className="sb-pay-t">
                    <b className="tabular-num">{p.amount ? `${Number(p.amount).toFixed(2)} دينار` : "تحويل"}</b>
                    <small>{longDate(p.created_at)}{p.review_note && p.status === "rejected" ? ` · ${p.review_note}` : ""}</small>
                  </span>
                  <span className="sb-pay-s" style={{ background: st.bg, color: st.color }}>{st.label}</span>
                </div>
              );
            })}
          </div>
        </>
      )}

      {!locked && !data.shop.is_demo && data.can_pay && sampleCount > 0 && (
        <button className="btn-danger-text" style={{ marginTop: 16, fontSize: "0.85rem" }} onClick={clearSample}>
          احذف الزباين التجريبيين ({sampleCount}) — زباينك الحقيقيين بيضلوا
        </button>
      )}

      {locked && (
        <div className="sb-locked">
          <button className="btn-primary" onClick={onRefresh}>حوّلت؟ تحقق من التفعيل</button>
          <button className="btn-secondary icon-row" style={{ justifyContent: "center" }} onClick={onLogout}>
            <FiLogOut aria-hidden="true" /> خروج
          </button>
        </div>
      )}
    </div>
  );
}
