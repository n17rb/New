import { useEffect, useState } from "react";
import { api } from "../api.js";
import { readShop } from "../shop.js";

// إضافة/تعديل موظف: الاسم، يومية أو راتب شهري، وربطه بحساب بالتطبيق (اختياري)
export default function EmployeeForm({ initial, onCancel, onSaved }) {
  const [f, setF] = useState({
    name: initial?.name || "",
    phone: initial?.phone || "",
    job_title: initial?.job_title || "",
    pay_type: initial?.pay_type || "daily",
    pay_amount: initial?.pay_amount != null ? String(initial.pay_amount) : "",
    deduct_absence: initial?.deduct_absence !== false,
    start_date: initial?.start_date || new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Amman" }),
    user_id: initial?.user_id || "",
    status: initial?.status || "active",
    notes: initial?.notes || "",
    ss_enrolled: !!initial?.ss_enrolled,
    ss_number: initial?.ss_number || "",
  });
  const factory = readShop()?.plan === "factory";
  const [users, setUsers] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.payrollUsers().then(setUsers).catch(() => {});
  }, []);

  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });

  async function save() {
    setSaving(true);
    setError("");
    try {
      const body = { ...f, pay_amount: Number(f.pay_amount), user_id: f.user_id ? Number(f.user_id) : null };
      const r = initial ? await api.payrollUpdateEmployee(initial.id, body) : await api.payrollCreateEmployee(body);
      onSaved(r);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <h2 className="title-md" style={{ marginTop: 0 }}>{initial ? "تعديل الموظف" : "موظف جديد"}</h2>
      {error && <div className="error-box">{error}</div>}
      <div className="field"><label htmlFor="em-name">الاسم</label><input id="em-name" value={f.name} onChange={set("name")} /></div>
      <div className="field-row">
        <div className="field"><label htmlFor="em-job">الشغلة</label><input id="em-job" value={f.job_title} onChange={set("job_title")} placeholder="كابتن، تعبئة..." /></div>
        <div className="field"><label htmlFor="em-phone">التلفون</label><input id="em-phone" value={f.phone} onChange={set("phone")} inputMode="tel" dir="ltr" /></div>
      </div>
      <div className="field">
        <label>طريقة الحساب</label>
        <div className="seg">
          <button type="button" className={f.pay_type === "daily" ? "on" : ""} onClick={() => setF({ ...f, pay_type: "daily" })}>يومية</button>
          <button type="button" className={f.pay_type === "monthly" ? "on" : ""} onClick={() => setF({ ...f, pay_type: "monthly" })}>راتب شهري</button>
        </div>
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor="em-pay">{f.pay_type === "daily" ? "اليومية (JD)" : "الراتب الشهري (JD)"}</label>
          <input id="em-pay" type="number" inputMode="decimal" min="0" step="0.5" value={f.pay_amount} onChange={set("pay_amount")} />
        </div>
        <div className="field">
          <label htmlFor="em-start">بلّش من</label>
          <input id="em-start" type="date" value={f.start_date} onChange={set("start_date")} />
        </div>
      </div>
      {f.pay_type === "monthly" && (
        <label className="icon-row" style={{ gap: 10, marginBottom: 12, cursor: "pointer" }}>
          <input type="checkbox" checked={f.deduct_absence} onChange={set("deduct_absence")} style={{ width: 20, height: 20 }} />
          <span>اخصم يوم الغياب من الراتب (الراتب ÷ ٣٠ لكل يوم)</span>
        </label>
      )}
      <div className="field">
        <label htmlFor="em-user">حسابه بالتطبيق (اختياري)</label>
        <select id="em-user" value={f.user_id} onChange={set("user_id")}>
          <option value="">— بدون —</option>
          {users.filter((u) => !u.employee_id || u.employee_id === initial?.id).map((u) => (
            <option key={u.id} value={u.id}>{u.full_name} ({u.username})</option>
          ))}
        </select>
        <div className="text-secondary" style={{ fontSize: "0.75rem", marginTop: 4 }}>
          لما تربطه: بيقدر يسجّل حضوره ويشوف حسابه، والكابتن اللي بيسلّم طلبات بينقترح حضوره تلقائيًا.
        </div>
      </div>
      {factory && (
        <div className="field">
          <label className="icon-row" style={{ gap: 10, cursor: "pointer" }}>
            <input type="checkbox" checked={f.ss_enrolled} onChange={set("ss_enrolled")} style={{ width: 20, height: 20 }} />
            <span>مشترك بالضمان الاجتماعي</span>
          </label>
          {f.ss_enrolled && <input style={{ marginTop: 8 }} value={f.ss_number} onChange={set("ss_number")} placeholder="رقم الضمان (اختياري)" dir="ltr" />}
        </div>
      )}
      {initial && (
        <div className="field">
          <label>الحالة</label>
          <div className="seg">
            <button type="button" className={f.status === "active" ? "on" : ""} onClick={() => setF({ ...f, status: "active" })}>على رأس عمله</button>
            <button type="button" className={f.status === "left" ? "on" : ""} onClick={() => setF({ ...f, status: "left" })}>ترك الشغل</button>
          </div>
        </div>
      )}
      <button className="btn-primary" style={{ marginBottom: 8 }} disabled={saving || !f.name || f.pay_amount === ""} onClick={save}>
        {saving ? "جاري الحفظ..." : initial ? "حفظ" : "إضافة"}
      </button>
      <button className="btn-secondary" onClick={onCancel}>إلغاء</button>
    </div>
  );
}
