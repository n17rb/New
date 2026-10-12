import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { FiPlus, FiSearch, FiChevronLeft, FiCheck, FiX, FiCamera, FiCopy, FiRefreshCw } from "react-icons/fi";
import { FaWhatsapp } from "react-icons/fa";
import { api } from "../api.js";
import { whatsappNumber } from "../shop.js";
import { SupportAvatar } from "../components/ChatView.jsx";

const TABS = [
  { key: "shops", label: "المحلات" },
  { key: "payments", label: "الدفعات" },
  { key: "support", label: "الدعم" },
  { key: "settings", label: "الإعدادات" },
];

export const ACCESS_BADGE = {
  active: { label: "فعّال", bg: "var(--success-soft)", color: "var(--success)" },
  expiring: { label: "قرّب يخلص", bg: "var(--warning-soft)", color: "var(--warning)" },
  expired: { label: "خالص", bg: "var(--urgent-soft)", color: "var(--urgent)" },
  suspended: { label: "موقوف", bg: "var(--surface-2)", color: "var(--text-secondary)" },
};

export function accessText(t) {
  if (t.is_home) return "المحل الأساسي";
  const a = t.access;
  if (a.state === "suspended") return "موقوف";
  if (a.state === "expired") return "الاشتراك خالص";
  return `باقي ${a.days_left} يوم`;
}

function ago(d) {
  if (!d) return "ما فات لسا";
  const mins = Math.round((Date.now() - new Date(d).getTime()) / 60000);
  if (mins < 60) return "نشط هلّق";
  const h = Math.round(mins / 60);
  if (h < 24) return `آخر نشاط قبل ${h} ساعة`;
  return `آخر نشاط قبل ${Math.round(h / 24)} يوم`;
}

function randomPassword() {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

export function welcomeText(t, username, password) {
  return `أهلًا ${t.owner_name || ""} 🌊\nحساب «${t.name}» على موج صار جاهز.\n\nالرابط: ${window.location.origin}\nاسم المستخدم: ${username}\nكلمة السر: ${password}\n\nبتقدر تضيف موظفينك من «المزيد ← الموظفين والصلاحيات». لأي سؤال احكينا من «الدعم الفني» جوّا التطبيق.`;
}

export default function Platform() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.key === params.get("tab")) ? params.get("tab") : "shops";
  const [overview, setOverview] = useState(null);

  useEffect(() => {
    api.platformOverview().then(setOverview).catch(() => {});
  }, [tab]);

  return (
    <div className="page">
      <h1 className="title-lg" style={{ marginBottom: 4 }}>لوحة إدارة موج</h1>
      <p className="text-secondary" style={{ marginTop: 0, fontSize: "0.85rem" }}>المحلات المشتركة، الاشتراكات، والدعم الفني</p>

      {overview && (
        <div className="stat-grid">
          <div className="stat-card"><div className="stat-num tabular-num">{overview.counts.active + (overview.counts.expiring || 0)}</div><div className="stat-label">محل شغّال</div></div>
          <div className="stat-card"><div className="stat-num tabular-num" style={{ color: overview.counts.expiring ? "var(--warning)" : undefined }}>{overview.counts.expiring || 0}</div><div className="stat-label">قرّب يخلص</div></div>
          <div className="stat-card"><div className="stat-num tabular-num" style={{ color: overview.counts.expired ? "var(--urgent)" : undefined }}>{overview.counts.expired || 0}</div><div className="stat-label">خالص</div></div>
          <div className="stat-card"><div className="stat-num tabular-num">{Math.round(overview.monthly_recurring)}</div><div className="stat-label">دخل شهري متوقع JD</div></div>
          <div className="stat-card"><div className="stat-num tabular-num">{Math.round(overview.revenue_this_month)}</div><div className="stat-label">انقبض هالشهر JD</div></div>
          <div className="stat-card"><div className="stat-num tabular-num">{overview.counts.demo}</div><div className="stat-label">حساب تجريبي</div></div>
        </div>
      )}

      <div className="seg" role="tablist" style={{ margin: "12px 0" }}>
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} className={tab === t.key ? "on" : ""} onClick={() => setParams({ tab: t.key })}>
            {t.label}
            {t.key === "payments" && overview?.pending_payments > 0 && <span className="seg-dot">{overview.pending_payments}</span>}
            {t.key === "support" && overview?.unread_support > 0 && <span className="seg-dot">{overview.unread_support}</span>}
          </button>
        ))}
      </div>

      {tab === "shops" && <ShopsTab />}
      {tab === "payments" && <PaymentsTab onChanged={() => api.platformOverview().then(setOverview).catch(() => {})} />}
      {tab === "support" && <SupportTab />}
      {tab === "settings" && <SettingsTab />}
    </div>
  );
}

// ---------------- المحلات ----------------
const FILTERS = [
  { key: "all", label: "الكل" },
  { key: "active", label: "فعّال" },
  { key: "expiring", label: "قرّب يخلص" },
  { key: "expired", label: "خالص" },
  { key: "demo", label: "تجريبي" },
  { key: "suspended", label: "موقوف" },
];

function ShopsTab() {
  const navigate = useNavigate();
  const [list, setList] = useState(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState(null);

  function load() {
    api.platformTenants().then(setList).catch((err) => setError(err.message));
  }
  useEffect(load, []);

  const shown = useMemo(() => {
    if (!list) return [];
    return list.filter((t) => {
      if (q && !`${t.name} ${t.owner_name || ""} ${t.phone || ""} ${t.city || ""}`.includes(q.trim())) return false;
      if (filter === "all") return true;
      if (filter === "demo") return t.is_demo;
      return !t.is_demo && t.access.state === filter;
    });
  }, [list, q, filter]);

  if (creating) {
    return <CreateShop onCancel={() => setCreating(false)} onCreated={(t, creds) => { setCreating(false); setCreated({ t, ...creds }); load(); }} />;
  }

  return (
    <>
      {error && <div className="error-box">{error}</div>}
      {created && <CreatedCard data={created} onClose={() => setCreated(null)} />}

      <button className="btn-primary icon-row" style={{ justifyContent: "center", marginBottom: 12 }} onClick={() => setCreating(true)}>
        <FiPlus aria-hidden="true" /> اشتراك محل جديد
      </button>

      <div className="field icon-row" style={{ marginBottom: 10 }}>
        <FiSearch style={{ color: "var(--text-secondary)", flexShrink: 0 }} aria-hidden="true" />
        <input placeholder="دوّر باسم المحل أو صاحبه أو المدينة" value={q} onChange={(e) => setQ(e.target.value)} aria-label="بحث" />
      </div>
      <div className="chips" role="radiogroup" aria-label="فلترة">
        {FILTERS.map((f) => (
          <button key={f.key} className={`chip${filter === f.key ? " on" : ""}`} role="radio" aria-checked={filter === f.key} onClick={() => setFilter(f.key)}>{f.label}</button>
        ))}
      </div>

      {!list && !error && <p className="text-secondary">جاري التحميل...</p>}
      {list && shown.length === 0 && <div className="card text-secondary">ما في محلات هون.</div>}

      {shown.length > 0 && (
        <div className="list-group">
          {shown.map((t) => {
            const b = t.is_home ? { label: "الأساسي", bg: "var(--primary-soft)", color: "var(--navy)" } : t.is_demo ? { label: "تجريبي", bg: "var(--primary-soft)", color: "var(--navy)" } : ACCESS_BADGE[t.access.state];
            return (
              <button key={t.id} className="list-row" onClick={() => navigate(`/platform/tenants/${t.id}`)}>
                <span className="avatar" style={{ width: 40, height: 40 }}>{t.name.trim().charAt(0)}</span>
                <span className="list-text">
                  <span className="list-title">
                    {t.name}
                    {t.unread_support > 0 && <span className="seg-dot" style={{ marginRight: 6 }}>{t.unread_support}</span>}
                  </span>
                  <div className="list-sub">
                    {[t.owner_name, t.city].filter(Boolean).join(" · ")}
                    {t.stats && ` · ${t.stats.customers} زبون · ${t.stats.orders_30d} طلب/شهر`}
                  </div>
                  <div className="list-sub">{accessText(t)} · {ago(t.last_active_at)}</div>
                </span>
                <span className="badge" style={{ background: b.bg, color: b.color }}>{b.label}</span>
                <FiChevronLeft className="list-chevron" aria-hidden="true" />
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

function CreatedCard({ data, onClose }) {
  const { t, username, password } = data;
  const text = welcomeText(t, username, password);
  const [copied, setCopied] = useState(false);
  return (
    <div className="card receipt-banner">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontWeight: 800 }}>✓ انعمل حساب «{t.name}»</div>
        <button className="icon-btn" style={{ width: 32, height: 32 }} onClick={onClose} aria-label="إغلاق"><FiX size={15} /></button>
      </div>
      <div className="creds">
        <div><span className="text-secondary">اسم المستخدم</span><strong dir="ltr">{username}</strong></div>
        <div><span className="text-secondary">كلمة السر</span><strong dir="ltr">{password}</strong></div>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        {t.phone && (
          <a className="btn-primary icon-row" style={{ justifyContent: "center", textDecoration: "none", background: "var(--whatsapp)", flex: 1 }} href={`https://wa.me/${whatsappNumber(t.phone)}?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">
            <FaWhatsapp aria-hidden="true" /> ابعتله الحساب
          </a>
        )}
        <button className="btn-secondary icon-row" style={{ justifyContent: "center", flex: 1 }} onClick={() => navigator.clipboard?.writeText(text).then(() => setCopied(true))}>
          {copied ? <FiCheck aria-hidden="true" /> : <FiCopy aria-hidden="true" />} نسخ
        </button>
      </div>
    </div>
  );
}

function CreateShop({ onCancel, onCreated }) {
  const [settings, setSettings] = useState(null);
  const [f, setF] = useState({ name: "", owner_name: "", phone: "", city: "", username: "", password: randomPassword(), monthly_price: "", days: "", is_demo: false, notes: "" });
  const [available, setAvailable] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.platformSettings().then((s) => {
      setSettings(s);
      setF((x) => ({ ...x, monthly_price: x.monthly_price || s.default_monthly_price || "", days: x.days || s.trial_days || "14" }));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const u = f.username.trim().toLowerCase();
    if (u.length < 3) { setAvailable(null); return; }
    const t = setTimeout(() => api.platformUsernameAvailable(u).then((r) => setAvailable(r.available)).catch(() => {}), 350);
    return () => clearTimeout(t);
  }, [f.username]);

  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });

  async function save() {
    setSaving(true);
    setError("");
    try {
      const t = await api.platformCreateTenant({ ...f, username: f.username.trim().toLowerCase(), monthly_price: Number(f.monthly_price) || 0, days: Number(f.days) || 14 });
      onCreated(t, { username: f.username.trim().toLowerCase(), password: f.password });
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <h2 className="title-md" style={{ marginTop: 0 }}>اشتراك محل جديد</h2>
      {error && <div className="error-box">{error}</div>}
      <div className="field"><label htmlFor="ns-name">اسم محل المياه</label><input id="ns-name" value={f.name} onChange={set("name")} placeholder="مثلاً: مياه النبع" /></div>
      <div className="field-row">
        <div className="field"><label htmlFor="ns-owner">اسم صاحب المحل</label><input id="ns-owner" value={f.owner_name} onChange={set("owner_name")} /></div>
        <div className="field"><label htmlFor="ns-phone">رقم التلفون</label><input id="ns-phone" value={f.phone} onChange={set("phone")} inputMode="tel" dir="ltr" /></div>
      </div>
      <div className="field"><label htmlFor="ns-city">المدينة / المنطقة</label><input id="ns-city" value={f.city} onChange={set("city")} /></div>

      <div className="section-title" style={{ marginTop: 6 }}>حساب المدير</div>
      <div className="field">
        <label htmlFor="ns-user">اسم المستخدم (إنجليزي)</label>
        <input id="ns-user" value={f.username} onChange={set("username")} dir="ltr" autoCapitalize="none" autoComplete="off" placeholder="nabaa" />
        {available === false && <div style={{ color: "var(--urgent)", fontSize: "0.8rem", marginTop: 4 }}>هذا الاسم محجوز</div>}
        {available === true && <div style={{ color: "var(--success)", fontSize: "0.8rem", marginTop: 4 }}>الاسم متاح ✓</div>}
      </div>
      <div className="field">
        <label htmlFor="ns-pass">كلمة السر</label>
        <div style={{ display: "flex", gap: 8 }}>
          <input id="ns-pass" value={f.password} onChange={set("password")} dir="ltr" style={{ flex: 1 }} />
          <button type="button" className="icon-btn" onClick={() => setF({ ...f, password: randomPassword() })} aria-label="كلمة سر جديدة"><FiRefreshCw /></button>
        </div>
      </div>

      <div className="section-title" style={{ marginTop: 6 }}>الاشتراك</div>
      <label className="icon-row" style={{ gap: 10, marginBottom: 12, cursor: "pointer" }}>
        <input type="checkbox" checked={f.is_demo} onChange={set("is_demo")} style={{ width: 20, height: 20 }} />
        <span>حساب تجريبي (ديمو) — فيه داتا تجريبية وما بيقدر يعدّل إشي</span>
      </label>
      <div className="field-row">
        <div className="field"><label htmlFor="ns-price">السعر الشهري (JD)</label><input id="ns-price" type="number" inputMode="decimal" value={f.monthly_price} onChange={set("monthly_price")} /></div>
        <div className="field"><label htmlFor="ns-days">{f.is_demo ? "مدة التجربة (يوم)" : "فعّال لمدة (يوم)"}</label><input id="ns-days" type="number" inputMode="numeric" value={f.days} onChange={set("days")} /></div>
      </div>
      <div className="field"><label htmlFor="ns-notes">ملاحظات (لإلك بس)</label><input id="ns-notes" value={f.notes} onChange={set("notes")} /></div>

      <button className="btn-primary" style={{ marginBottom: 8 }} disabled={saving || !f.name || !f.username || available === false || f.password.length < 6} onClick={save}>
        {saving ? "جاري تجهيز المحل..." : "أنشئ الحساب"}
      </button>
      <button className="btn-secondary" onClick={onCancel}>إلغاء</button>
      {!settings && null}
    </div>
  );
}

// ---------------- الدفعات ----------------
function PaymentsTab({ onChanged }) {
  const [list, setList] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(null);
  const [monthsById, setMonthsById] = useState({});

  function load() {
    api.platformPayments().then(setList).catch((err) => setError(err.message));
  }
  useEffect(load, []);

  async function approve(p) {
    setBusy(p.id);
    setError("");
    try {
      await api.platformApprovePayment(p.id, { months: monthsById[p.id] || p.months });
      load();
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  async function reject(p) {
    const note = prompt("سبب الرفض (بيوصل للمحل):", "المبلغ ما وصل لحد الآن");
    if (!note) return;
    setBusy(p.id);
    try {
      await api.platformRejectPayment(p.id, note);
      load();
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  if (!list) return error ? <div className="error-box">{error}</div> : <p className="text-secondary">جاري التحميل...</p>;
  if (list.length === 0) return <div className="card text-secondary">ما في دفعات لسا. لما محل يبعت إيصال كليك بيطلع هون وبيوصلك إشعار.</div>;

  return (
    <>
      {error && <div className="error-box">{error}</div>}
      {list.map((p) => (
        <div key={p.id} className="card pay-card">
          <div style={{ display: "flex", gap: 12 }}>
            {p.receipt_url ? (
              <a href={p.receipt_url} target="_blank" rel="noreferrer"><img src={p.receipt_url} alt="إيصال" className="pay-thumb" /></a>
            ) : <span className="pay-thumb" />}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 800 }}>{p.tenant_name}</div>
              <div className="text-secondary" style={{ fontSize: "0.82rem" }}>
                {p.months === 1 ? "شهر" : `${p.months} شهور`}{p.amount ? ` · ${Number(p.amount).toFixed(2)} JD` : ""}
                {p.submitted_by_name && ` · ${p.submitted_by_name}`}
              </div>
              <div className="text-secondary" style={{ fontSize: "0.75rem" }}>{new Date(p.created_at).toLocaleString("ar-JO", { timeZone: "Asia/Amman", dateStyle: "medium", timeStyle: "short" })}</div>
              {p.note && <div style={{ fontSize: "0.82rem", marginTop: 4 }}>📝 {p.note}</div>}
              {p.status !== "pending" && (
                <span className="badge" style={{ marginTop: 6, background: p.status === "approved" ? "var(--success-soft)" : "var(--urgent-soft)", color: p.status === "approved" ? "var(--success)" : "var(--urgent)" }}>
                  {p.status === "approved" ? "معتمدة" : `مرفوضة${p.review_note ? ` — ${p.review_note}` : ""}`}
                </span>
              )}
            </div>
          </div>
          {p.status === "pending" && (
            <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
              <select value={monthsById[p.id] || p.months} onChange={(e) => setMonthsById({ ...monthsById, [p.id]: Number(e.target.value) })} aria-label="عدد الشهور" style={{ width: 96, padding: "9px 8px", borderRadius: 10, border: "1.5px solid var(--border)", background: "var(--surface)" }}>
                {[1, 2, 3, 6, 12].map((m) => <option key={m} value={m}>{m === 1 ? "شهر" : `${m} شهور`}</option>)}
              </select>
              <button className="fc-btn primary" disabled={busy === p.id} onClick={() => approve(p)}><FiCheck aria-hidden="true" /> اعتمد</button>
              <button className="fc-btn" disabled={busy === p.id} onClick={() => reject(p)} style={{ color: "var(--urgent)" }}><FiX aria-hidden="true" /> ارفض</button>
            </div>
          )}
        </div>
      ))}
    </>
  );
}

// ---------------- الدعم ----------------
function SupportTab() {
  const [list, setList] = useState(null);
  useEffect(() => {
    api.platformSupportThreads().then(setList).catch(() => setList([]));
  }, []);
  if (!list) return <p className="text-secondary">جاري التحميل...</p>;
  if (list.length === 0) return <div className="card text-secondary">ما في رسائل دعم لسا. مدراء المحلات بيقدروا يراسلوك من «الدعم الفني».</div>;
  return (
    <div className="list-group">
      {list.map((t) => (
        <Link key={t.tenant_id} to={`/platform/support/${t.tenant_id}`} className="list-row">
          <span className="avatar" style={{ width: 40, height: 40 }}>{t.tenant_name.trim().charAt(0)}</span>
          <span className="list-text">
            <span className="list-title">{t.tenant_name}</span>
            <div className="list-sub" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {t.last_from_support ? "إنت: " : ""}{t.last_body || (t.last_image ? "📷 صورة" : "")}
            </div>
          </span>
          {t.unread > 0 && <span className="seg-dot">{t.unread}</span>}
          <FiChevronLeft className="list-chevron" aria-hidden="true" />
        </Link>
      ))}
    </div>
  );
}

// ---------------- الإعدادات ----------------
function SettingsTab() {
  const [s, setS] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api.platformSettings().then(setS).catch((err) => setError(err.message));
  }, []);
  if (!s) return error ? <div className="error-box">{error}</div> : <p className="text-secondary">جاري التحميل...</p>;

  const set = (k) => (e) => setS({ ...s, [k]: e.target.value });

  async function save() {
    setSaving(true);
    setMsg("");
    setError("");
    try {
      setS(await api.platformSaveSettings(s));
      setMsg("انحفظت الإعدادات ✓");
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function photo(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const r = await api.platformSupportPhoto(file);
      setS({ ...s, support_photo_url: r.support_photo_url });
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="card">
      {error && <div className="error-box">{error}</div>}
      {msg && <div className="success-box">{msg}</div>}
      <div className="section-title" style={{ marginTop: 0 }}>الدعم الفني (هيك بيشوفوه المحلات)</div>
      <div className="icon-row" style={{ gap: 14, marginBottom: 14 }}>
        <SupportAvatar photo={s.support_photo_url} size={64} />
        <label className="btn-secondary icon-row" style={{ width: "auto", padding: "0 14px", cursor: "pointer" }}>
          <FiCamera aria-hidden="true" /> غيّر الصورة
          <input type="file" accept="image/*" onChange={photo} style={{ display: "none" }} />
        </label>
      </div>
      <div className="field"><label htmlFor="ps-sn">اسم الدعم الفني</label><input id="ps-sn" value={s.support_name || ""} onChange={set("support_name")} /></div>

      <div className="section-title">الدفع (كليك)</div>
      <div className="field-row">
        <div className="field"><label htmlFor="ps-cliq">رقم/اسم كليك</label><input id="ps-cliq" value={s.cliq_number || ""} onChange={set("cliq_number")} dir="ltr" /></div>
        <div className="field"><label htmlFor="ps-cn">باسم</label><input id="ps-cn" value={s.cliq_name || ""} onChange={set("cliq_name")} /></div>
      </div>
      <div className="field"><label htmlFor="ps-ph">رقم التواصل (اتصال وواتساب)</label><input id="ps-ph" value={s.contact_phone || ""} onChange={set("contact_phone")} dir="ltr" /></div>

      <div className="section-title">افتراضيات المحلات الجديدة</div>
      <div className="field-row">
        <div className="field"><label htmlFor="ps-price">السعر الشهري (JD)</label><input id="ps-price" type="number" value={s.default_monthly_price || ""} onChange={set("default_monthly_price")} /></div>
        <div className="field"><label htmlFor="ps-trial">أيام التجربة</label><input id="ps-trial" type="number" value={s.trial_days || ""} onChange={set("trial_days")} /></div>
      </div>
      <button className="btn-primary" disabled={saving} onClick={save}>{saving ? "جاري الحفظ..." : "حفظ"}</button>
    </div>
  );
}
