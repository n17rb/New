import { useEffect, useState } from "react";
import { FaWhatsapp } from "react-icons/fa";
import { api } from "../api.js";

const HOURS = [5, 6, 7, 8, 9, 10];
const hourLabel = (h) => `${h}:00 الصبح`;
export const WA_TEMPLATE_TEXT = "مرحبا {{1}} 🌊\nمعك {{2}}.\nحسب حسابنا المي عندك قربت تخلص 💧\nبدك نجيبلك {{3}} اليوم؟";

// واتساب التلقائي: تذكير الزباين اللي مفروض يطلبوا اليوم — كل يوم الصبح
export default function WhatsAppAuto() {
  const [d, setD] = useState(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ phone_id: "", token: "", template: "", lang: "ar" });
  const [showSetup, setShowSetup] = useState(false);
  const [testPhone, setTestPhone] = useState("");

  const load = () => api.waGet().then((r) => {
    setD(r);
    setF({ phone_id: r.settings.phone_id, token: "", template: r.settings.template, lang: r.settings.lang });
    if (!r.configured) setShowSetup(true);
  }).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  async function run(fn, ok) {
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const r = await fn();
      setMsg(typeof ok === "function" ? ok(r) : ok);
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!d) return <div className="page">{error ? <div className="error-box">{error}</div> : <p className="text-secondary">جاري التحميل…</p>}</div>;
  const s = d.settings;
  const preview = WA_TEMPLATE_TEXT.replace("{{1}}", "أبو أحمد").replace("{{2}}", d.shop_name || "محلك").replace("{{3}}", "قارورتين");
  const pending = d.recipients.filter((r) => !r.off && !r.sent_today);

  return (
    <div className="page">
      <h1 className="title-lg">واتساب تلقائي</h1>
      <p className="text-secondary" style={{ marginTop: -6 }}>كل يوم الصبح بتنبعت رسالة لحالها للزباين اللي التوقعات بتقول مفروض يطلبوا اليوم — بس يصحى بيوصّي.</p>
      {msg && <div className="success-box">{msg}</div>}
      {error && <div className="error-box">{error}</div>}

      <div className={`wa-card${s.enabled && d.configured ? " on" : ""}`}>
        <button type="button" className={`pr-sw${s.enabled ? " on" : ""}`} disabled={busy || (!d.configured && !s.enabled)}
          onClick={() => run(() => api.waSave({ enabled: !s.enabled }), s.enabled ? "انطفى الإرسال التلقائي" : "✅ صار الإرسال تلقائي كل يوم")}>
          <span className="pr-sw-t">
            <b><FaWhatsapp aria-hidden="true" style={{ color: "var(--whatsapp)", verticalAlign: "-2px" }} /> الإرسال التلقائي كل يوم</b>
            <small>{!d.configured ? "اربط واتساب تحت أول" : s.enabled ? `شغّال — الساعة ${hourLabel(s.hour)}` : "مطفي"}</small>
          </span>
          <span className="pr-sw-k" aria-hidden="true"><i /></span>
        </button>
        <div className="sheet-q" style={{ marginTop: 12 }}>الساعة كم؟</div>
        <div className="of-want-pk" style={{ padding: 0 }}>
          {HOURS.map((h) => (
            <button key={h} type="button" className={s.hour === h ? "on" : ""} disabled={busy} onClick={() => run(() => api.waSave({ hour: h }), `✅ صار الساعة ${hourLabel(h)}`)}>{hourLabel(h)}</button>
          ))}
        </div>
        <div className="wa-bubble">{preview}</div>
      </div>

      <div className="section-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>زباين اليوم ({d.recipients.length})</span>
        {d.configured && s.enabled && pending.length > 0 && (
          <button type="button" className="debt-pay-btn" disabled={busy} onClick={() => run(() => api.waRunNow(), (r) => `📤 انبعت لـ${r.sent} زبون${r.failed ? ` · ما وصل لـ${r.failed}` : ""}`)}>ابعت هلّق ({pending.length})</button>
        )}
      </div>
      {d.recipients.length === 0 ? (
        <div className="pr-empty">ما في حدا مفروض يطلب اليوم حسب التوقعات</div>
      ) : (
        <div className="list-group">
          {d.recipients.map((r) => (
            <div key={r.customer_id} className="list-row" style={{ cursor: "default", opacity: r.off ? 0.55 : 1 }}>
              <span className="list-text">
                <span className="list-title">{r.name}</span>
                <div className="list-sub">{r.qty_label}{r.sent_today ? " · ✓ انبعتله اليوم" : r.off ? " · ما بنبعتله" : ""}</div>
              </span>
              <button type="button" className="debt-pay-btn" style={r.off ? undefined : { color: "var(--text-secondary)", background: "var(--surface-2)" }} disabled={busy}
                onClick={() => run(() => api.waSetCustomer(r.customer_id, !r.off), r.off ? `رجع ${r.name} ينبعتله` : `${r.name} ما رح ينبعتله`)}>
                {r.off ? "رجّعه" : "لا تبعتله"}
              </button>
            </div>
          ))}
        </div>
      )}

      <button type="button" className="wa-setup-toggle" onClick={() => setShowSetup((v) => !v)}>
        {d.configured ? "✓ واتساب مربوط" : "⚠️ واتساب مش مربوط لسا"} — {showSetup ? "إخفاء الإعدادات" : "الإعدادات"}
      </button>
      {showSetup && (
        <div className="card">
          <details className="wa-help">
            <summary>كيف أربط؟ (مرة وحدة بس)</summary>
            <ol>
              <li>ادخل على <b>business.facebook.com</b> واعمل حساب أعمال، وضيف رقم واتساب للمحل (رقم مش مركّب عليه واتساب عادي).</li>
              <li>من <b>WhatsApp Manager ← Message templates</b> اعمل قالب جديد: النوع <b>Utility</b>، اللغة <b>Arabic</b>، والنص بالزبط:
                <pre className="wa-pre">{WA_TEMPLATE_TEXT}</pre>
                واستنى لحد ما ينقبل (عادةً دقايق لساعات).</li>
              <li>من <b>WhatsApp ← API Setup</b> انسخ <b>Phone number ID</b>.</li>
              <li>من <b>Business settings ← System users</b> اعمل مستخدم وطلّع <b>Access token</b> دائم بصلاحية whatsapp_business_messaging.</li>
              <li>حط الثلاث أشياء هون، واعمل رسالة تجربة لرقمك.</li>
            </ol>
            <p className="text-secondary" style={{ fontSize: "0.78rem" }}>Meta بتاخذ مبلغ صغير على كل رسالة (حسب الأسعار عندهم)، وأول كم رسالة بالشهر عادةً ببلاش.</p>
          </details>
          <label className="pr-field"><span>Phone number ID</span><input value={f.phone_id} onChange={(e) => setF({ ...f, phone_id: e.target.value })} dir="ltr" inputMode="numeric" placeholder="123456789012345" /></label>
          <label className="pr-field"><span>Access token {s.has_token && <small>(محفوظ {s.token_masked} — اكتب جديد بس إذا بدك تغيّره)</small>}</span>
            <input value={f.token} onChange={(e) => setF({ ...f, token: e.target.value })} dir="ltr" placeholder={s.has_token ? s.token_masked : "EAAG…"} autoComplete="off" />
          </label>
          <div className="loc-two">
            <label className="pr-field"><span>اسم القالب</span><input value={f.template} onChange={(e) => setF({ ...f, template: e.target.value })} dir="ltr" placeholder="water_reminder" /></label>
            <label className="pr-field"><span>اللغة</span><input value={f.lang} onChange={(e) => setF({ ...f, lang: e.target.value })} dir="ltr" placeholder="ar" /></label>
          </div>
          <button className="btn-primary" disabled={busy} onClick={() => run(() => api.waSave({ phone_id: f.phone_id, template: f.template, lang: f.lang, ...(f.token ? { token: f.token } : {}) }), "✅ انحفظت الإعدادات")}>حفظ</button>

          <div className="sheet-q" style={{ marginTop: 16 }}>رسالة تجربة</div>
          <div className="ec-add" style={{ marginTop: 0 }}>
            <input value={testPhone} onChange={(e) => setTestPhone(e.target.value)} placeholder="رقمك مثلًا 0791234567" dir="ltr" inputMode="tel" />
            <button type="button" className="btn-primary" disabled={busy || !d.configured || testPhone.replace(/\D/g, "").length < 9} onClick={() => run(() => api.waTest(testPhone), "✅ انبعتت — شيّك واتساب")}>ابعت</button>
          </div>
        </div>
      )}

      {d.log.length > 0 && (
        <>
          <div className="section-title">آخر الرسايل</div>
          <div className="list-group">
            {d.log.map((l) => (
              <div key={l.id} className="list-row" style={{ cursor: "default" }}>
                <span className="list-text">
                  <span className="list-title">{l.name || (l.kind === "test" ? "رسالة تجربة" : l.phone)}</span>
                  <div className="list-sub">{new Date(l.created_at).toLocaleString("ar-JO", { timeZone: "Asia/Amman", weekday: "short", hour: "numeric", minute: "2-digit" })}{l.error ? ` · ${l.error}` : ""}</div>
                </span>
                <span className={`badge ${l.status === "failed" ? "red" : ""}`} style={{ color: l.status === "failed" ? "var(--urgent)" : "var(--success)" }}>{l.status === "failed" ? "ما وصلت" : "✓ انبعتت"}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
