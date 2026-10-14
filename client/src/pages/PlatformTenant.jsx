import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { FiArrowRight, FiEye, FiPhone, FiMessageCircle, FiPause, FiPlay, FiEdit2, FiKey } from "react-icons/fi";
import { FaWhatsapp } from "react-icons/fa";
import { api } from "../api.js";
import { readShop, saveShop, whatsappNumber } from "../shop.js";
import { ACCESS_BADGE, accessText } from "./Platform.jsx";

const LOG_LABELS = {
  create: "إنشاء الحساب", reset: "ترجيع الداتا", extend: "تمديد", reduce: "تقليل المدة", payment: "دفعة كليك", suspend: "إيقاف", resume: "تشغيل", password_reset: "تغيير كلمة سر",
};

function longDate(d) {
  return new Date(d).toLocaleDateString("ar-JO", { timeZone: "Asia/Amman", day: "numeric", month: "long", year: "numeric" });
}

export default function PlatformTenant() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [t, setT] = useState(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [customDays, setCustomDays] = useState("");
  const [paid, setPaid] = useState(false);

  function load() {
    api.platformTenant(id).then(setT).catch((err) => setError(err.message));
  }
  useEffect(load, [id]);

  async function run(fn, okMsg) {
    setBusy(true);
    setError("");
    setMsg("");
    try {
      await fn();
      if (okMsg) setMsg(okMsg);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function inspect() {
    setBusy(true);
    try {
      const r = await api.platformInspectTenant(t.id);
      localStorage.setItem("inspect_backup", JSON.stringify({
        token: localStorage.getItem("token"),
        user: JSON.parse(localStorage.getItem("user") || "null"),
        shop: readShop(),
      }));
      localStorage.setItem("token", r.token);
      const me = await api.getMe();
      const { shop, ...u } = me;
      localStorage.setItem("user", JSON.stringify(u));
      saveShop(shop);
      window.location.href = "/";
    } catch (err) {
      const backup = JSON.parse(localStorage.getItem("inspect_backup") || "null");
      if (backup) {
        localStorage.setItem("token", backup.token);
        localStorage.removeItem("inspect_backup");
      }
      setError(err.message);
      setBusy(false);
    }
  }

  if (!t) return <div className="page">{error ? <div className="error-box">{error}</div> : <p className="text-secondary">جاري التحميل...</p>}</div>;

  const badge = t.is_home ? null
    : t.is_demo ? { label: "نسخة عرض", bg: "var(--primary-soft)", color: "var(--navy)" }
    : t.access.trial && t.access.state !== "expired" ? { label: "تجربة مجانية", bg: "var(--primary-soft)", color: "var(--blue)" }
    : ACCESS_BADGE[t.access.state];
  const s = t.stats || {};

  return (
    <div className="page">
      <button className="back-link" onClick={() => navigate("/platform")}><FiArrowRight aria-hidden="true" /> لوحة موج</button>

      <div className="card customer-hero">
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <span className="avatar" style={{ width: 52, height: 52, fontSize: "1.3rem", borderRadius: 16 }}>{t.name.trim().charAt(0)}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 className="customer-hero-name">{t.name}</h1>
            <div className="text-secondary" style={{ fontSize: "0.85rem" }}>{[t.owner_name, t.city].filter(Boolean).join(" · ")}</div>
            <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
              {badge && <span className="badge" style={{ background: badge.bg, color: badge.color }}>{badge.label}</span>}
              <span className="badge">{accessText(t)}</span>
            </div>
          </div>
          {!t.is_home && <button className="icon-btn" onClick={() => setEditing(!editing)} aria-label="تعديل"><FiEdit2 size={16} /></button>}
        </div>
        <div className="quick-actions">
          {t.phone && <a className="quick-action" href={`tel:${t.phone}`}><FiPhone aria-hidden="true" /><span>اتصال</span></a>}
          {t.phone && <a className="quick-action whatsapp" href={`https://wa.me/${whatsappNumber(t.phone)}`} target="_blank" rel="noreferrer"><FaWhatsapp aria-hidden="true" /><span>واتساب</span></a>}
          {!t.is_home && <button className="quick-action" onClick={() => navigate(`/platform/support/${t.id}`)}><FiMessageCircle aria-hidden="true" /><span>الدعم</span></button>}
          {!t.is_home && <button className="quick-action primary" disabled={busy} onClick={inspect}><FiEye aria-hidden="true" /><span>عاين المحل</span></button>}
        </div>
      </div>

      {error && <div className="error-box">{error}</div>}
      {msg && <div className="success-box">{msg}</div>}

      {editing && <EditTenant t={t} onDone={() => { setEditing(false); load(); }} />}

      <div className="stat-grid">
        <div className="stat-card"><div className="stat-num tabular-num">{s.customers ?? "–"}</div><div className="stat-label">زبون</div></div>
        <div className="stat-card"><div className="stat-num tabular-num">{s.orders_30d ?? "–"}</div><div className="stat-label">طلب آخر ٣٠ يوم</div></div>
        <div className="stat-card"><div className="stat-num tabular-num">{s.orders_today ?? "–"}</div><div className="stat-label">طلب آخر ٢٤ ساعة</div></div>
        <div className="stat-card"><div className="stat-num tabular-num">{s.delivered_30d ?? "–"}</div><div className="stat-label">تسليم آخر ٣٠ يوم</div></div>
        <div className="stat-card"><div className="stat-num tabular-num">{s.users ?? "–"}</div><div className="stat-label">موظف</div></div>
        <div className="stat-card"><div className="stat-num" style={{ fontSize: "0.85rem" }}>{s.last_order_at ? longDate(s.last_order_at) : "—"}</div><div className="stat-label">آخر طلب</div></div>
      </div>

      {!t.is_home && (
        <div className="card">
          <h2 className="title-md" style={{ marginTop: 0 }}>الاشتراك</h2>
          <p className="text-secondary" style={{ marginTop: 0 }}>
            {t.subscription_ends_at ? `لحد ${longDate(t.subscription_ends_at)}` : "ما إله تاريخ"} · {Number(t.monthly_price).toFixed(2)} JD بالشهر
          </p>
          <div className="chips" style={{ marginBottom: 10 }}>
            {[{ d: 7, l: "+ أسبوع" }, { d: 30, l: "+ شهر" }, { d: 90, l: "+ ٣ شهور" }, { d: 365, l: "+ سنة" }].map((x) => (
              <button key={x.d} className="chip" disabled={busy} onClick={() => run(() => api.platformExtendTenant(t.id, { days: x.d, note: paid ? "دفع كاش/يدوي" : "تمديد يدوي", paid, amount: paid ? Math.round((Number(t.monthly_price) * x.d) / 30 * 100) / 100 : null }), `تمدد ${x.l.replace("+ ", "")} ✓`)}>{x.l}</button>
            ))}
          </div>
          {!t.is_demo && (
            <label className="icon-row" style={{ gap: 8, marginBottom: 10, fontSize: "0.85rem", cursor: "pointer" }}>
              <input type="checkbox" checked={paid} onChange={(ev) => setPaid(ev.target.checked)} style={{ width: 18, height: 18 }} />
              قبضت منه المبلغ (بيطلع من التجربة لاشتراك مدفوع)
            </label>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <input type="number" inputMode="numeric" placeholder="عدد أيام (ممكن سالب)" value={customDays} onChange={(e) => setCustomDays(e.target.value)} style={{ flex: 1, padding: "10px 12px", borderRadius: 12, border: "1.5px solid var(--border)", background: "var(--surface)" }} aria-label="عدد أيام" />
            <button className="fc-btn primary" style={{ flex: "0 0 auto" }} disabled={busy || !Number(customDays)} onClick={() => run(() => api.platformExtendTenant(t.id, { days: Number(customDays) }), "تم ✓").then(() => setCustomDays(""))}>تطبيق</button>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button
              className="btn-secondary"
              style={{ fontSize: "0.82rem" }}
              disabled={busy}
              onClick={() => {
                if (!confirm(`ترجيع داتا «${t.name}» لأولها؟ كل اللي انضاف بينمسح وبترجع الداتا التجريبية.`)) return;
                run(() => api.platformResetTenant(t.id, true), "رجعت الداتا التجريبية ✓");
              }}
            >
              رجّع الداتا التجريبية
            </button>
            <button
              className="btn-secondary"
              style={{ fontSize: "0.82rem", color: "var(--urgent)" }}
              disabled={busy}
              onClick={() => {
                const typed = prompt(`هاد بيمسح كل داتا «${t.name}» (الزباين، الطلبات، الموظفين...) وبيضل حساب المدير بس.\nاكتب «امسح» للتأكيد:`);
                if (typed?.trim() !== "امسح") return;
                run(() => api.platformResetTenant(t.id, false), "انمسحت الداتا — المحل صار نظيف ✓");
              }}
            >
              امسح كل الداتا
            </button>
          </div>
          <button
            className="btn-secondary icon-row"
            style={{ justifyContent: "center", marginTop: 8, color: t.status === "active" ? "var(--urgent)" : "var(--success)" }}
            disabled={busy}
            onClick={() => {
              if (t.status === "active" && !confirm(`إيقاف «${t.name}»؟ البرنامج بيوقف عندهم فورًا (الداتا بتضل محفوظة).`)) return;
              run(() => api.platformUpdateTenant(t.id, { status: t.status === "active" ? "suspended" : "active" }), t.status === "active" ? "انوقف المحل" : "رجع المحل يشتغل");
            }}
          >
            {t.status === "active" ? <><FiPause aria-hidden="true" /> إيقاف المحل</> : <><FiPlay aria-hidden="true" /> رجّع المحل يشتغل</>}
          </button>
        </div>
      )}

      {t.users?.length > 0 && (
        <>
          <div className="section-title">الحسابات</div>
          <div className="list-group">
            {t.users.map((u) => (
              <div key={u.id} className="list-row" style={{ cursor: "default" }}>
                <span className="list-text">
                  <span className="list-title">{u.full_name}</span>
                  <div className="list-sub" dir="ltr" style={{ textAlign: "right" }}>{u.username}{u.status !== "active" ? " (موقوف)" : ""}</div>
                </span>
                {u.role === "super_admin" && <span className="badge">المدير</span>}
                {!t.is_home && (
                  <button
                    className="icon-btn"
                    aria-label={`كلمة سر جديدة لـ${u.full_name}`}
                    onClick={() => {
                      const p = prompt(`كلمة سر جديدة لـ${u.full_name} (٦ أحرف على الأقل):`);
                      if (p) run(() => api.platformResetPassword(t.id, { user_id: u.id, password: p }), `تغيّرت كلمة سر ${u.username} ✓`);
                    }}
                  >
                    <FiKey size={15} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {t.log?.length > 0 && (
        <>
          <div className="section-title">سجل الاشتراك</div>
          <div className="card mini-ledger" style={{ marginTop: 0 }}>
            {t.log.map((l) => (
              <div key={l.id} className="mini-ledger-row">
                <span>
                  {LOG_LABELS[l.action] || l.action}{l.days ? ` ${l.days > 0 ? "+" : ""}${l.days} يوم` : ""}
                  {l.note && <div className="text-secondary" style={{ fontSize: "0.75rem" }}>{l.note}</div>}
                </span>
                <span className="text-secondary" style={{ fontSize: "0.75rem" }}>{longDate(l.created_at)}{l.amount ? ` · ${Number(l.amount).toFixed(2)} JD` : ""}</span>
              </div>
            ))}
          </div>
        </>
      )}
      {t.notes && <p className="text-secondary" style={{ fontSize: "0.85rem" }}>📝 {t.notes}</p>}
    </div>
  );
}

function EditTenant({ t, onDone }) {
  const [f, setF] = useState({ name: t.name, owner_name: t.owner_name || "", phone: t.phone || "", city: t.city || "", monthly_price: String(t.monthly_price ?? ""), notes: t.notes || "", is_demo: t.is_demo });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });

  async function save() {
    setSaving(true);
    try {
      await api.platformUpdateTenant(t.id, { ...f, monthly_price: Number(f.monthly_price) || 0 });
      onDone();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div className="card">
      {error && <div className="error-box">{error}</div>}
      <div className="field"><label>اسم المحل</label><input value={f.name} onChange={set("name")} /></div>
      <div className="field-row">
        <div className="field"><label>صاحب المحل</label><input value={f.owner_name} onChange={set("owner_name")} /></div>
        <div className="field"><label>التلفون</label><input value={f.phone} onChange={set("phone")} dir="ltr" /></div>
      </div>
      <div className="field-row">
        <div className="field"><label>المدينة</label><input value={f.city} onChange={set("city")} /></div>
        <div className="field"><label>السعر الشهري</label><input type="number" value={f.monthly_price} onChange={set("monthly_price")} /></div>
      </div>
      <div className="field"><label>ملاحظات</label><input value={f.notes} onChange={set("notes")} /></div>
      <label className="icon-row" style={{ gap: 10, marginBottom: 12 }}>
        <input type="checkbox" checked={f.is_demo} onChange={set("is_demo")} style={{ width: 20, height: 20 }} /> نسخة عرض (بترجع لأولها كل يوم)
      </label>
      <button className="btn-primary" disabled={saving} onClick={save}>{saving ? "..." : "حفظ"}</button>
    </div>
  );
}
