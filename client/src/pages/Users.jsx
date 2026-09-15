import { useEffect, useState } from "react";
import { api } from "../api.js";
import { FiUserPlus } from "react-icons/fi";

const ROLE_LABELS = {
  super_admin: "مدير",
  admin: "مساعد مدير",
  driver: "سائق",
  data_entry: "موظف الإدخال",
};

export default function Users() {
  const [users, setUsers] = useState([]);
  const [error, setError] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);

  async function load() {
    try {
      setUsers(await api.getUsers());
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => { load(); }, []);

  if (selectedUser) {
    return (
      <div className="page">
        <EditUserForm
          user={selectedUser}
          onBack={() => { setSelectedUser(null); load(); }}
        />
      </div>
    );
  }

  return (
    <div className="page">
      <h1 className="title-lg">المستخدمون</h1>
      {error && <div className="error-box">{error}</div>}

      <button className="btn-primary icon-row" style={{ justifyContent: "center", marginBottom: 16 }} onClick={() => setShowAdd(!showAdd)}>
        {showAdd ? "إغلاق" : (<><FiUserPlus /> إضافة مستخدم</>)}
      </button>

      {showAdd && <AddUserForm onSaved={() => { setShowAdd(false); load(); }} />}

      <div className="card" style={{ padding: 0 }}>
        {users.map((u) => (
          <div key={u.id} className="customer-row" style={{ padding: "12px 14px", cursor: "pointer" }} onClick={() => setSelectedUser(u)}>
            <div>
              <div style={{ fontWeight: 600 }}>{u.full_name}</div>
              <div className="text-secondary">
                {u.username} · {ROLE_LABELS[u.role] || u.role}
              </div>
            </div>
            <span className="badge">{u.status === "active" ? "فعّال" : "معطّل"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function EditUserForm({ user, onBack }) {
  const [username, setUsername] = useState(user.username);
  const [fullName, setFullName] = useState(user.full_name);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    setError("");
    setInfo("");
    try {
      await api.updateUser(user.id, {
        username: username !== user.username ? username.trim() : undefined,
        full_name: fullName,
        password: password || undefined,
      });
      setInfo("تم حفظ التعديلات بنجاح.");
      setPassword("");
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleStatus() {
    setSaving(true);
    setError("");
    try {
      await api.updateUser(user.id, { status: user.status === "active" ? "disabled" : "active" });
      onBack();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`متأكد إنك بدك تحذف حساب "${user.full_name}"؟ هذا الإجراء لا يمكن التراجع عنه.`)) return;
    setSaving(true);
    setError("");
    try {
      const result = await api.deleteUser(user.id);
      alert(result.message);
      onBack();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <button className="btn-danger-text" style={{ marginBottom: 10 }} onClick={onBack}>← رجوع لقائمة المستخدمين</button>

      <div className="card">
        <h2 className="title-md">{ROLE_LABELS[user.role] || user.role}</h2>
        {error && <div className="error-box">{error}</div>}
        {info && <div className="success-box">{info}</div>}

        <div className="field">
          <label>اسم المستخدم</label>
          <input value={username} onChange={(e) => setUsername(e.target.value)} />
        </div>
        <div className="field">
          <label>الاسم الكامل</label>
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </div>
        <div className="field">
          <label>كلمة مرور جديدة (اتركها فاضية لعدم التغيير)</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} />
        </div>

        <button className="btn-primary" style={{ marginBottom: 10 }} disabled={saving} onClick={handleSave}>
          {saving ? "جاري الحفظ..." : "حفظ التعديلات"}
        </button>
        <button className="btn-secondary" style={{ marginBottom: 10 }} disabled={saving} onClick={toggleStatus}>
          {user.status === "active" ? "تعطيل الحساب" : "تفعيل الحساب"}
        </button>
        <button className="btn-danger-text" disabled={saving} onClick={handleDelete}>
          حذف الحساب نهائيًا
        </button>
      </div>
    </div>
  );
}

function AddUserForm({ onSaved }) {
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("driver");
  const [canDiscount, setCanDiscount] = useState(false);
  const [canDeleteCustomer, setCanDeleteCustomer] = useState(false);
  const [canEditPrice, setCanEditPrice] = useState(false);
  const [canCancelOrder, setCanCancelOrder] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    try {
      await api.createUser({
        full_name: fullName,
        username,
        password,
        role,
        can_discount: canDiscount,
        can_delete_customer: canDeleteCustomer,
        can_edit_product_price: canEditPrice,
        can_cancel_order: canCancelOrder,
      });
      onSaved();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="card">
      {error && <div className="error-box">{error}</div>}
      <form onSubmit={handleSubmit}>
        <div className="field">
          <label>الاسم الكامل</label>
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        </div>
        <div className="field">
          <label>اسم المستخدم</label>
          <input value={username} onChange={(e) => setUsername(e.target.value)} required />
        </div>
        <div className="field">
          <label>كلمة المرور</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
        </div>
        <div className="field">
          <label>الدور</label>
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="driver">سائق (توصيل فقط، بدون تعديل عملاء)</option>
            <option value="data_entry">موظف الإدخال (إضافة/تعديل عملاء فقط)</option>
            <option value="admin">مساعد مدير (كل الصلاحيات، بدون إدارة مستخدمين)</option>
            <option value="super_admin">مدير (كل الصلاحيات)</option>
          </select>
        </div>

        {role === "driver" && (
          <div className="field">
            <label>صلاحيات إضافية للسائق</label>
            <label style={{ display: "flex", gap: 8, marginBottom: 6, fontWeight: 400 }}>
              <input type="checkbox" checked={canDiscount} onChange={(e) => setCanDiscount(e.target.checked)} />
              يستطيع إعطاء خصم
            </label>
            <label style={{ display: "flex", gap: 8, marginBottom: 6, fontWeight: 400 }}>
              <input type="checkbox" checked={canDeleteCustomer} onChange={(e) => setCanDeleteCustomer(e.target.checked)} />
              يستطيع أرشفة عملاء
            </label>
            <label style={{ display: "flex", gap: 8, marginBottom: 6, fontWeight: 400 }}>
              <input type="checkbox" checked={canEditPrice} onChange={(e) => setCanEditPrice(e.target.checked)} />
              يستطيع تعديل أسعار المنتجات
            </label>
            <label style={{ display: "flex", gap: 8, fontWeight: 400 }}>
              <input type="checkbox" checked={canCancelOrder} onChange={(e) => setCanCancelOrder(e.target.checked)} />
              يستطيع إلغاء الطلبات
            </label>
          </div>
        )}

        <button className="btn-primary">إضافة المستخدم</button>
      </form>
    </div>
  );
}
