import { useEffect, useState } from "react";
import { FaWhatsapp } from "react-icons/fa";
import { api, API_ORIGIN } from "../api.js";

const HOURS = [5, 6, 7, 8, 9, 10];
const hourLabel = (h) => `${h}:00 الصبح`;
export const WA_TEMPLATE_TEXT = "مرحبا {{1}} 🌊\nمعك {{2}}.\nحسب حسابنا المي عندك قربت تخلص 💧\nبدك نجيبلك {{3}} اليوم؟";

// واتساب التلقائي: تذكير الزباين اللي مفروض يطلبوا اليوم — كل يوم الصبح
export default function WhatsAppAuto() {
  const [d, setD] = useState(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ provider: "d360", phone_id: "", token: "", template: "", lang: "ar" });
  const [showSetup, setShowSetup] = useState(false);
  const [testPhone, setTestPhone] = useState("");

  const load = () => api.waGet().then((r) => {
    setD(r);
    setF({ provider: r.settings.provider || "meta", phone_id: r.settings.phone_id, token: "", template: r.settings.template, lang: r.settings.lang });
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

      <AndroidCard forecastAuto={!!d.forecast_auto} onForecastAuto={(v) => run(() => api.waSave({ forecast_auto: v }), v ? "✅ تذكير التوقعات صار يتبعت كل يوم الصبح من موبايل المحل" : "تذكير التوقعات انطفى — ما بينبعت للزباين")} couponsAuto={!!d.coupons_auto} onCouponsAuto={(v) => run(() => api.waSave({ coupons_auto: v }), v ? "✅ رسايل الكوبونات صارت تلقائية من موبايل المحل" : "رسايل الكوبونات رجعت يدوي (زر واتساب)")} token={d.queue_token} users={d.users || []} deviceUser={d.device_user} onDevice={(id) => run(() => api.waSave({ device_user: id }), id ? "✅ انحفظ حساب الموبايل" : "انشال")} outbox={d.outbox || []} pending={pending.length} busy={busy} onNew={() => run(() => api.waNewQueueToken(), "✅ انعمل رابط جديد — حدّثه بالموبايل")} />

      <button type="button" className="wa-setup-toggle" onClick={() => setShowSetup((v) => !v)}>
        {d.configured ? "✓ واتساب مربوط" : "⚠️ واتساب مش مربوط لسا"} — {showSetup ? "إخفاء الإعدادات" : "الإعدادات"}
      </button>
      {showSetup && (
        <div className="card">
          <div className="sheet-q" style={{ marginTop: 0 }}>كيف بدك تربط؟</div>
          <div className="seg" style={{ marginBottom: 12 }}>
            <button type="button" className={f.provider === "d360" ? "on" : ""} onClick={() => setF({ ...f, provider: "d360" })}>رقم المحل نفسه (360dialog)</button>
            <button type="button" className={f.provider === "meta" ? "on" : ""} onClick={() => setF({ ...f, provider: "meta" })}>مع Meta مباشرة</button>
          </div>
          <details className="wa-help">
            <summary>كيف أربط؟ (مرة وحدة بس)</summary>
            {f.provider === "d360" ? (
              <ol>
                <li>هاي الطريقة لرقمك اللي عليه <b>واتساب أعمال</b>: بتضل تستعمل التطبيق عادي على موبايلك، والنظام بيبعت من نفس الرقم.</li>
                <li>تأكد إنه تطبيق واتساب أعمال <b>محدّث لآخر نسخة</b>، وإنه عندك حساب <b>Meta Business</b> (business.facebook.com) باسم المحل ومعلوماته.</li>
                <li>اعمل حساب على <b>360dialog.com</b> وابدأ الربط (Embedded Signup)، واختار إنه الرقم <b>موصول بتطبيق WhatsApp Business</b> — بيطلعلك QR بتمسحه من التطبيق.</li>
                <li>من لوحة 360dialog اعمل قالب (Template) نوعه <b>Utility</b> ولغته <b>Arabic</b> بهالنص بالزبط:
                  <pre className="wa-pre">{WA_TEMPLATE_TEXT}</pre>
                  واستنى لحد ما ينقبل.</li>
                <li>طلّع <b>API Key</b> من 360dialog وحطه هون مع اسم القالب، وابعت رسالة تجربة لرقمك.</li>
              </ol>
            ) : (
              <ol>
                <li>هاي الطريقة لرقم <b>جديد ما عليه واتساب</b> (إذا ربطت رقم عليه واتساب أعمال بهالطريقة، التطبيق بيوقف على هالرقم).</li>
                <li>من <b>business.facebook.com</b> ضيف الرقم، ومن <b>WhatsApp Manager ← Message templates</b> اعمل قالب Utility عربي بهالنص:
                  <pre className="wa-pre">{WA_TEMPLATE_TEXT}</pre></li>
                <li>من <b>API Setup</b> انسخ <b>Phone number ID</b>، ومن <b>System users</b> طلّع <b>Access token</b> دائم.</li>
                <li>حطهم هون وابعت رسالة تجربة.</li>
              </ol>
            )}
            <p className="text-secondary" style={{ fontSize: "0.78rem" }}>الرسايل اللي بتبعتها من التطبيق بإيدك بتضل ببلاش. رسايل النظام التلقائية عليها مبلغ صغير لكل رسالة حسب أسعار Meta{f.provider === "d360" ? " + اشتراك 360dialog الشهري" : ""}.</p>
          </details>
          {f.provider === "meta" && <label className="pr-field"><span>Phone number ID</span><input value={f.phone_id} onChange={(e) => setF({ ...f, phone_id: e.target.value })} dir="ltr" inputMode="numeric" placeholder="123456789012345" /></label>}
          <label className="pr-field"><span>{f.provider === "d360" ? "API Key (من 360dialog)" : "Access token"} {s.has_token && <small>(محفوظ {s.token_masked} — اكتب جديد بس إذا بدك تغيّره)</small>}</span>
            <input value={f.token} onChange={(e) => setF({ ...f, token: e.target.value })} dir="ltr" placeholder={s.has_token ? s.token_masked : f.provider === "d360" ? "API key" : "EAAG…"} autoComplete="off" />
          </label>
          <div className="loc-two">
            <label className="pr-field"><span>اسم القالب</span><input value={f.template} onChange={(e) => setF({ ...f, template: e.target.value })} dir="ltr" placeholder="water_reminder" /></label>
            <label className="pr-field"><span>اللغة</span><input value={f.lang} onChange={(e) => setF({ ...f, lang: e.target.value })} dir="ltr" placeholder="ar" /></label>
          </div>
          <button className="btn-primary" disabled={busy} onClick={() => run(() => api.waSave({ provider: f.provider, phone_id: f.phone_id, template: f.template, lang: f.lang, ...(f.token ? { token: f.token } : {}) }), "✅ انحفظت الإعدادات")}>حفظ</button>

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

// موبايل أندرويد بيبعت من تطبيق واتساب أعمال نفسه (برنامج MacroDroid)
function AndroidCard({ forecastAuto, onForecastAuto, couponsAuto, onCouponsAuto, token, users, deviceUser, onDevice, outbox, pending, busy, onNew }) {
  const [copied, setCopied] = useState("");
  const base = `${API_ORIGIN}/api/public/wa-queue/${token}`;
  const copy = (txt, key) => {
    navigator.clipboard?.writeText(txt).then(() => { setCopied(key); setTimeout(() => setCopied(""), 2000); }).catch(() => {});
  };
  return (
    <div className="card wa-android">
      <div className="wa-android-h">📱 من موبايل أندرويد — رقمك الأساسي</div>
      <p className="text-secondary" style={{ marginTop: 4, fontSize: "0.82rem" }}>
        موبايل أندرويد عليه واتساب أعمال (برقم المحل) بيشيّك كل كم دقيقة وبيبعت لحاله من التطبيق:
        رسايل «انضافلك كوبونات» أول ما تنباع باقة (أي ساعة، حتى بالليل)، وتذكير التوقعات الصبح. {pending > 0 ? `اليوم في ${pending} تذكير بالدور.` : ""}
      </p>
      <button type="button" className={`pr-sw${couponsAuto ? " on" : ""}`} style={{ margin: "8px 0 12px" }} disabled={busy} onClick={() => onCouponsAuto(!couponsAuto)}>
        <span className="pr-sw-t">
          <b>رسايل الكوبونات تلقائي</b>
          <small>{couponsAuto ? "«انضافلك كوبونات» و«انخصم كوبون» بتنبعت لحالها من موبايل المحل" : "مطفي — الكابتن بيبعتها بإيده من زر الواتساب زي قبل"}</small>
        </span>
        <span className="pr-sw-k" aria-hidden="true"><i /></span>
      </button>
      <button type="button" className={`pr-sw${forecastAuto ? " on" : ""}`} style={{ margin: "0 0 12px" }} disabled={busy} onClick={() => onForecastAuto(!forecastAuto)}>
        <span className="pr-sw-t">
          <b>تذكير التوقعات تلقائي</b>
          <small>{forecastAuto ? "كل يوم الصبح بينبعت للزباين اللي التوقعات بتقول مفروض يطلبوا" : "مطفي — ما بينبعت تذكير توقعات لحدا"}</small>
        </span>
        <span className="pr-sw-k" aria-hidden="true"><i /></span>
      </button>
      <div className="sheet-q">الحساب المسجّل على موبايل الأندرويد (تطبيق موج)</div>
      <select className="stn-select" value={deviceUser || ""} disabled={busy} onChange={(e) => onDevice(Number(e.target.value) || null)}>
        <option value="">— اختار —</option>
        {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
      </select>
      <p className="text-secondary" style={{ fontSize: "0.76rem", margin: "6px 2px 10px" }}>أول ما ينحط كوبون أو ينخصم، بيوصل إشعار لهالحساب على الموبايل، وMacroDroid بيبعت فورًا. الأحسن تعمل حساب خاص اسمه «موبايل المحل».</p>
      <div className="sheet-q">رابط «الرسالة الجاية»</div>
      <div className="wa-link" dir="ltr">{base}/link</div>
      <div className="vh-acts2" style={{ marginTop: 8 }}>
        <button type="button" className="btn-secondary" onClick={() => copy(`${base}/link`, "next")}>{copied === "next" ? "✓ انتسخ" : "انسخ الرابط"}</button>
        <button type="button" className="btn-secondary" disabled={busy} onClick={onNew}>رابط جديد</button>
      </div>
      {outbox.length > 0 && (
        <div className="wa-outbox">
          <div className="sheet-q">آخر رسايل الكوبونات</div>
          {outbox.slice(0, 8).map((o) => (
            <div key={o.id} className="wa-ob-row">
              <span>{o.name || "زبون"}</span>
              <small className={o.status === "sent" ? "green" : o.status === "expired" ? "red" : ""}>{o.status === "sent" ? "✓ انبعتت" : o.status === "expired" ? "ما انبعتت" : "بتستنى الموبايل"}</small>
            </div>
          ))}
        </div>
      )}
      <details className="wa-help" style={{ marginTop: 12 }}>
        <summary>كيف أجهّز الموبايل؟</summary>
        <ol>
          <li>على موبايل الأندرويد افتح تطبيق <b>موج</b> بالمتصفح وسجّل دخول بالحساب اللي اخترته فوق، واسمح بالإشعارات.</li>
          <li>نزّل <b>WhatsApp Business</b> وافتحه برقم المحل. إذا رقم المحل على موبايل ثاني، اربط الأندرويد كجهاز مرافق (Link as companion) من نفس التطبيق.</li>
          <li>نزّل <b>MacroDroid</b> من Google Play، واعطيه صلاحية <b>إمكانية الوصول (Accessibility)</b> لما يطلبها.</li>
          <li>اعمل ماكرو جديد:
            <ul>
              <li><b>المُشغّل ١ (فوري):</b> Notification Received — من تطبيق المتصفح/موج، والنص فيه «رسالة واتساب جديدة».</li>
              <li><b>المُشغّل ٢ (احتياطي وللتذكير الصبح):</b> كل دقيقة (Regular interval) — بدون قيد وقت، النظام هو اللي بيحدد إمتى.</li>
              <li><b>الأفعال:</b>
                <br />١) <b>طلب HTTP (GET)</b> على الرابط فوق، وخزّن الرد بمتغيّر نصي اسمه <code>link</code>.
                <br />٢) إذا <code>link</code> فيه <code>wa.me</code>: <b>فتح رابط موقع</b> = <code>{"{lv=link}"}</code> ← استنى ٥ ثواني ← <b>تفاعل مع واجهة المستخدم: نقر</b> على زر الإرسال ← رجوع للرئيسية ← استنى ٦٠ ثانية ← <b>نفّذ الماكرو من جديد</b>.
                <br />٣) إذا فيه <code>NONE</code>: ما في إشي، خلص.</li>
            </ul>
          </li>
          <li>جرّبه أول مرة وإنت ماسك الموبايل. إذا علقت بأي خطوة ابعتلي صورة.</li>
        </ol>
        <p className="text-secondary" style={{ fontSize: "0.78rem" }}>
          ⚠️ هاي أتمتة على تطبيق واتساب نفسه، مش من Meta رسميًا. عشان تضل آمنة: بتنبعت بس لزباينك اللي طلبوا قبل، مرة وحدة باليوم، ومع فاصل بين الرسايل. وأي زبون ما بده، اكبس «لا تبعتله». الرابط سري — إذا انتشر اعمل «رابط جديد».
        </p>
      </details>
    </div>
  );
}
