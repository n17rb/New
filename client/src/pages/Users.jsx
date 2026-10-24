import { useEffect, useMemo, useState } from "react";
import { FiUserPlus, FiChevronLeft, FiArrowRight, FiTrash2, FiMessageCircle, FiCheckCircle, FiEye } from "react-icons/fi";
import { startViewAs } from "../viewAs.js";
import { api } from "../api.js";
import { usePerms } from "../auth.jsx";
import { ROLE_LABELS as SHOP_ROLE_LABELS } from "./More.jsx";
import { readShop, whatsappNumber } from "../shop.js";

// المصانع: «سائق» بدل «كابتن توصيل»
const ROLE_LABELS = readShop()?.plan === "factory" ? { ...SHOP_ROLE_LABELS, driver: "سائق" } : SHOP_ROLE_LABELS;

const LEVEL_LABELS = { none: "مخفي", view: "متفرج", edit: "تعديل" };

export default function Users() {
  const [users, setUsers] = useState(null);
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null); // null | "new" | user

  async function load() {
    setError("");
    try {
      const [list, m] = await Promise.all([api.getUsers(), meta ? Promise.resolve(meta) : api.getPermissionsMeta()]);
      setUsers(list);
      setMeta(m);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => { load(); }, []);

  if (editing) {
    return (
      <div className="page">
        <UserEditor
          meta={meta}
          user={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      </div>
    );
  }

  return (
    <div className="page">
      <h1 className="title-lg">الموظفين والصلاحيات</h1>
      <p className="text-secondary" style={{ marginTop: -8, marginBottom: 16 }}>
        لكل موظف بتحدد كل قسم: مخفي، متفرج (بشوف بس)، أو تعديل.
      </p>
      {error && <div className="error-box">{error}</div>}

      <button className="btn-primary icon-row" style={{ justifyContent: "center", marginBottom: 16 }} disabled={!meta} onClick={() => setEditing("new")}>
        <FiUserPlus aria-hidden="true" /> إضافة موظف
      </button>

      {!users && !error && <p className="text-secondary">جاري التحميل...</p>}

      {users && (
        <div className="list-group">
          {users.map((u) => (
            <button key={u.id} className="list-row" onClick={() => setEditing(u)} disabled={!meta}>
              <span className="avatar">{(u.full_name || "?").trim().charAt(0)}</span>
              <span className="list-text">
                <span className="list-title">{u.full_name}</span>
                <div className="list-sub">
                  <span dir="ltr">@{u.username}</span> · {u.role === "super_admin" ? ROLE_LABELS.super_admin || "مدير عام" : meta?.templates?.[u.effective_permissions?.template]?.label || ROLE_LABELS[u.role] || "موظف"}
                </div>
              </span>
              {u.status !== "active" && <span className="badge" style={{ color: "var(--urgent)", background: "var(--urgent-soft)" }}>موقوف</span>}
              <FiChevronLeft className="list-chevron" aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function samePermissions(a, b) {
  return JSON.stringify(a.sections) === JSON.stringify(b.sections) && JSON.stringify(a.actions) === JSON.stringify(b.actions);
}

function normalize(meta, input) {
  const sections = {};
  for (const s of meta.sections) {
    let lvl = input?.sections?.[s.key] || "none";
    if (s.viewOnly && lvl === "edit") lvl = "view";
    sections[s.key] = lvl;
  }
  const actions = {};
  for (const a of meta.actions) actions[a.key] = input?.actions?.[a.key] === true;
  return { sections, actions };
}

// الأدوار القديمة اللي إلها معنى بالسيرفر — غيرها بينحفظ «موظف» ونوعه بينحفظ مع صلاحياته
const KNOWN_ROLES = ["admin", "driver", "data_entry", "viewer"];

function UserEditor({ meta, user, onClose, onSaved }) {
  const { user: me } = usePerms();
  const isNew = !user;
  const isSelf = user && user.id === me.id;

  const [fullName, setFullName] = useState(user?.full_name || "");
  const [username, setUsername] = useState(user?.username || "");
  const [password, setPassword] = useState("");
  const [active, setActive] = useState(user ? user.status === "active" : true);
  const [isOwnerRole, setIsOwnerRole] = useState(user?.role === "super_admin");
  const [perms, setPerms] = useState(() =>
    normalize(meta, user ? user.effective_permissions : meta.templates.driver)
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(null);

  // القالب اللي بيطابق الصلاحيات الحالية (لو في)
  const matchingTemplate = useMemo(() => {
    for (const [key, t] of Object.entries(meta.templates)) {
      if (samePermissions(normalize(meta, t), perms)) return key;
    }
    return null;
  }, [perms, meta]);

  // نوع الحساب: بيضل زي ما اخترته (مثلًا «سائق») حتى لو عدّلت صلاحياته بإيدك
  const [kind, setKind] = useState(() => {
    const saved = user?.effective_permissions?.template;
    if (saved && meta.templates[saved]) return saved;
    if (!user) return meta.templates.driver ? "driver" : Object.keys(meta.templates)[0];
    for (const [key, t] of Object.entries(meta.templates)) if (samePermissions(normalize(meta, t), normalize(meta, user.effective_permissions))) return key;
    if (meta.templates[user.role]) return user.role;
    // حسابات قديمة انعدّلت صلاحياتها قبل: إذا معه «تطبيق السائق» فهو سائق
    if (meta.templates.driver && user.effective_permissions?.sections?.f_drive === "edit") return "driver";
    return null;
  });
  const customized = !!kind && matchingTemplate !== kind;

  function applyTemplate(key) {
    setIsOwnerRole(false);
    if (key === kind && customized && !confirm("ترجّع صلاحياته للأصل تبع هالنوع؟ التعديلات الخاصة فيه بتروح.")) return;
    setKind(key);
    setPerms(normalize(meta, meta.templates[key]));
  }

  function setLevel(section, level) {
    setPerms((p) => ({ ...p, sections: { ...p.sections, [section]: level } }));
  }

  function setAll(level) {
    setPerms((p) => ({
      ...p,
      sections: Object.fromEntries(meta.sections.map((s) => [s.key, s.viewOnly && level === "edit" ? "view" : level])),
    }));
  }

  function setAction(action, value) {
    setPerms((p) => ({ ...p, actions: { ...p.actions, [action]: value } }));
  }

  async function handleSave() {
    setError("");
    if (!fullName.trim() || !username.trim()) {
      setError("اكتب الاسم واسم المستخدم.");
      return;
    }
    if (isNew && password.length < 6) {
      setError("كلمة المرور لازم تكون ٦ أحرف على الأقل.");
      return;
    }
    if (isOwnerRole && !isNew && user.role !== "super_admin" &&
        !confirm(`«${fullName}» رح يصير مدير عام: بيشوف وبيعدّل كل شي، وبيقدر يغيّر صلاحيات الموظفين. متأكد؟`)) {
      return;
    }

    const role = isOwnerRole ? "super_admin" : KNOWN_ROLES.includes(kind) ? kind : "staff";
    const body = {
      full_name: fullName.trim(),
      username: username.trim(),
      role,
      permissions: isOwnerRole ? undefined : { ...perms, template: kind || undefined },
    };
    if (password) body.password = password;
    if (!isNew) body.status = active ? "active" : "disabled";

    setSaving(true);
    try {
      if (isNew) await api.createUser(body);
      else await api.updateUser(user.id, body);
      // انعمل حساب أو تغيّرت كلمة السر: منعرض زر يبعتله الدخول على واتساب
      if (password) { setSaving(false); setDone({ name: fullName.trim(), username: username.trim(), password, isNew }); }
      else onSaved();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`متأكد إنك بدك تحذف حساب «${user.full_name}»؟`)) return;
    setSaving(true);
    try {
      const result = await api.deleteUser(user.id);
      alert(result.message);
      onSaved();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  if (done) return <SendLogin done={done} onFinish={onSaved} />;

  async function viewAs() {
    setError("");
    try { await startViewAs(user.id); } catch (err) { setError(err.message); }
  }

  return (
    <>
      <button className="btn-danger-text icon-row" style={{ color: "var(--text-secondary)", marginBottom: 6 }} onClick={onClose}>
        <FiArrowRight aria-hidden="true" /> رجوع
      </button>
      <h1 className="title-lg">{isNew ? "موظف جديد" : user.full_name}</h1>
      {!isNew && !isSelf && user.role !== "super_admin" && !me.inspecting && (
        <button type="button" className="btn-secondary icon-row" style={{ justifyContent: "center", marginBottom: 12 }} onClick={viewAs}>
          <FiEye aria-hidden="true" /> عاين حسابه — شوف التطبيق زي ما بيشوفه
        </button>
      )}
      {error && <div className="error-box">{error}</div>}

      <div className="card">
        <div className="field">
          <label htmlFor="u-name">الاسم</label>
          <input id="u-name" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="مثلاً: أبو أحمد" />
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="u-user">اسم المستخدم</label>
            <input id="u-user" value={username} onChange={(e) => setUsername(e.target.value)} dir="ltr" autoComplete="off" placeholder="مثلاً رقم تلفونه 07XXXXXXXX" />
          </div>
          <div className="field">
            <label htmlFor="u-pass">{isNew ? "كلمة المرور" : "كلمة مرور جديدة"}</label>
            <input id="u-pass" type="text" value={password} onChange={(e) => setPassword(e.target.value)} dir="ltr" autoComplete="off" placeholder={isNew ? "" : "اتركها فاضية"} />
          </div>
        </div>
        {!isNew && !isSelf && (
          <div className="toggle-row" style={{ padding: "4px 0 0", border: "none" }}>
            <span>الحساب فعّال</span>
            <label className="switch">
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
              <span />
            </label>
          </div>
        )}
      </div>

      <div className="section-title">نوع الحساب</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 6 }}>
        {Object.entries(meta.templates).map(([key, t]) => (
          <button
            key={key}
            type="button"
            className={!isOwnerRole && kind === key ? "btn-primary" : "btn-secondary"}
            style={{ width: "auto", padding: "9px 14px", fontSize: "0.85rem" }}
            onClick={() => applyTemplate(key)}
          >
            {t.label}
          </button>
        ))}
        <button
          type="button"
          className={isOwnerRole ? "btn-primary" : "btn-secondary"}
          style={{ width: "auto", padding: "9px 14px", fontSize: "0.85rem" }}
          onClick={() => setIsOwnerRole(true)}
          disabled={isSelf}
        >
          مدير عام
        </button>
      </div>
      <p className="text-secondary" style={{ margin: "0 4px 4px", fontSize: "0.8rem" }}>
        {isOwnerRole
          ? "المدير العام بيشوف وبيعدّل كل شي، وبيدير الموظفين."
          : !kind
            ? "اختار نوع الحساب، وبعدين عدّل أي قسم تحت."
            : customized
              ? <>✎ {meta.templates[kind]?.label} بصلاحيات خاصة فيه — بيضل {meta.templates[kind]?.label}. <button type="button" onClick={() => applyTemplate(kind)} style={{ background: "none", border: "none", color: "var(--primary)", cursor: "pointer", fontSize: "0.8rem", padding: 0 }}>رجّع الأصل</button></>
              : "عدّل أي قسم تحت براحتك — نوع الحساب بيضل زي ما هو."}
      </p>

      {!isOwnerRole && (
        <>
          <div className="section-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>الأقسام</span>
            <span style={{ display: "flex", gap: 12, fontWeight: 600 }}>
              <button type="button" onClick={() => setAll("view")} style={{ background: "none", border: "none", color: "var(--primary)", cursor: "pointer", fontSize: "0.8rem" }}>الكل متفرج</button>
              <button type="button" onClick={() => setAll("none")} style={{ background: "none", border: "none", color: "var(--primary)", cursor: "pointer", fontSize: "0.8rem" }}>إخفاء الكل</button>
            </span>
          </div>
          <div className="list-group">
            {meta.sections.map((s) => {
              const levels = s.viewOnly ? ["none", "view"] : ["none", "view", "edit"];
              return (
                <div key={s.key} className="perm-row">
                  <div className="perm-head">
                    <span className="perm-label">{s.label}</span>
                    <span className="perm-hint">{s.hint}</span>
                  </div>
                  <div className="seg" role="radiogroup" aria-label={s.label}>
                    {levels.map((lvl) => {
                      const on = perms.sections[s.key] === lvl;
                      return (
                        <button
                          key={lvl}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          className={on ? `on lvl-${lvl}` : ""}
                          onClick={() => setLevel(s.key, lvl)}
                        >
                          {s.viewOnly && lvl === "view" ? "يشوف" : LEVEL_LABELS[lvl]}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="section-title">صلاحيات خاصة</div>
          <div className="list-group">
            {meta.actions.map((a) => (
              <label key={a.key} className="toggle-row" style={{ cursor: "pointer" }}>
                <span>{a.label}</span>
                <span className="switch">
                  <input type="checkbox" checked={perms.actions[a.key]} onChange={(e) => setAction(a.key, e.target.checked)} />
                  <span />
                </span>
              </label>
            ))}
          </div>
        </>
      )}

      <button className="btn-primary" style={{ marginTop: 8, marginBottom: 10 }} disabled={saving} onClick={handleSave}>
        {saving ? "جاري الحفظ..." : isNew ? "إضافة الموظف" : "حفظ التغييرات"}
      </button>
      {!isNew && !isSelf && (
        <button className="btn-danger-text icon-row" style={{ justifyContent: "center", width: "100%", marginBottom: 12 }} disabled={saving} onClick={handleDelete}>
          <FiTrash2 aria-hidden="true" /> حذف الحساب
        </button>
      )}
    </>
  );
}

// بعد ما ينعمل الحساب: رسالة واتساب للموظف فيها رابط الدخول واسم المستخدم وكلمة السر
function SendLogin({ done, onFinish }) {
  const shop = readShop();
  // نفس ترتيب السيرفر: «+962 79…» بتصير «079…»
  const digits = done.username.replace(/[٠-٩]/g, (x) => String("٠١٢٣٤٥٦٧٨٩".indexOf(x))).replace(/\D/g, "").replace(/^00962/, "0").replace(/^962/, "0").replace(/^7(?=\d{8}$)/, "07");
  const looksPhone = /^07\d{8}$/.test(digits) && !/[a-z]/i.test(done.username);
  const loginName = looksPhone ? digits : done.username.toLowerCase();
  const [phone, setPhone] = useState(looksPhone ? digits : "");
  const link = shop?.plan === "factory" && shop?.id ? `${window.location.origin}/m/${shop.id}` : window.location.origin;
  const appName = shop?.brand?.name || shop?.name || "موج";
  const text = [
    `أهلاً ${done.name} 👋`,
    done.isNew ? `انعملّك حساب على تطبيق ${appName}.` : `تغيّرت كلمة السر لحسابك على تطبيق ${appName}.`,
    ``,
    `رابط الدخول: ${link}`,
    `اسم المستخدم: ${loginName}`,
    `كلمة السر: ${done.password}`,
    ``,
    `افتح الرابط من تلفونك، ومن قائمة المتصفح اختار «إضافة للشاشة الرئيسية» عشان يصير عندك التطبيق.`,
  ].join("\n");
  const wa = phone.replace(/\D/g, "").length >= 9 ? `https://wa.me/${whatsappNumber(phone.replace(/\D/g, "").replace(/^7/, "07"))}?text=${encodeURIComponent(text)}` : null;
  return (
    <>
      <div className="card" style={{ textAlign: "center" }}>
        <FiCheckCircle style={{ width: 44, height: 44, color: "var(--success)" }} aria-hidden="true" />
        <h1 className="title-lg" style={{ margin: "8px 0 4px" }}>{done.isNew ? "انعمل الحساب" : "تغيّرت كلمة السر"}</h1>
        <p className="text-secondary" style={{ margin: 0 }}>ابعت للموظف معلومات الدخول على واتساب.</p>
      </div>
      <div className="card">
        <div className="field">
          <label htmlFor="u-wa">رقم تلفون الموظف (واتساب)</label>
          <input id="u-wa" value={phone} onChange={(e) => setPhone(e.target.value)} dir="ltr" inputMode="tel" placeholder="07XXXXXXXX" />
        </div>
        <pre className="text-secondary" style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: "0.85rem", background: "var(--bg)", padding: 10, borderRadius: 10, margin: "0 0 12px" }}>{text}</pre>
        <a className="btn-primary icon-row" style={{ justifyContent: "center", textDecoration: "none", background: "var(--whatsapp)", opacity: wa ? 1 : 0.5, pointerEvents: wa ? "auto" : "none" }} href={wa || undefined} target="_blank" rel="noreferrer">
          <FiMessageCircle aria-hidden="true" /> ابعتله على واتساب
        </a>
      </div>
      <button className="btn-secondary" style={{ marginBottom: 12 }} onClick={onFinish}>تم</button>
    </>
  );
}
