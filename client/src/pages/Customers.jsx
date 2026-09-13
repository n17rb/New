import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { FiUserPlus, FiSearch } from "react-icons/fi";

export default function Customers({ user }) {
  const [query, setQuery] = useState("");
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const navigate = useNavigate();

  const canAdd = ["super_admin", "admin", "data_entry"].includes(user.role);

  async function search(q) {
    setLoading(true);
    setError("");
    try {
      const result = await api.getCustomers(q);
      setCustomers(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    search("");
  }, []);

  function handleSearchChange(e) {
    const q = e.target.value;
    setQuery(q);
    search(q);
  }

  return (
    <div className="page">
      <h1 className="title-lg">العملاء</h1>

      {!showAddForm && (
        <>
          <div className="field icon-row">
            <FiSearch style={{ color: "var(--text-secondary)", flexShrink: 0 }} />
            <input
              placeholder="رقم الهاتف، جزء منه، الاسم، أو الرقم التسلسلي..."
              value={query}
              onChange={handleSearchChange}
              autoFocus
            />
          </div>

          {canAdd && (
            <button className="btn-primary icon-row" style={{ justifyContent: "center", marginBottom: 16 }} onClick={() => setShowAddForm(true)}>
              <FiUserPlus /> زبون جديد
            </button>
          )}

          {error && <div className="error-box">{error}</div>}
          {loading && <p className="text-secondary">جاري البحث...</p>}

          <div className="card" style={{ padding: 0 }}>
            {customers.length === 0 && !loading && (
              <p className="text-secondary" style={{ padding: 14 }}>لا يوجد عملاء مطابقون.</p>
            )}
            {customers.map((c) => (
              <div key={c.id} className="customer-row" onClick={() => navigate(`/customers/${c.id}`)} style={{ cursor: "pointer", padding: "10px 14px" }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{c.name}</div>
                  <div className="text-secondary tabular-num">{c.phone_display} · #{c.sequential_number}</div>
                </div>
                {c.region_name && <span className="badge">{c.region_name}</span>}
              </div>
            ))}
          </div>
        </>
      )}

      {showAddForm && (
        <AddCustomerForm
          onCancel={() => setShowAddForm(false)}
          onSaved={(c) => {
            setShowAddForm(false);
            navigate(`/customers/${c.id}`);
          }}
        />
      )}
    </div>
  );
}

function AddCustomerForm({ onCancel, onSaved }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [sequentialNumber, setSequentialNumber] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setInfo("");
    setLoading(true);
    try {
      const result = await api.createCustomer({
        name,
        phone,
        sequential_number: sequentialNumber || undefined,
      });
      if (result.alreadyExists) {
        setInfo(result.message);
      }
      onSaved(result.customer);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card">
      <h2 className="title-md">إضافة زبون جديد</h2>
      {error && <div className="error-box">{error}</div>}
      {info && <div className="success-box">{info}</div>}
      <form onSubmit={handleSubmit}>
        <div className="field">
          <label>اسم العميل</label>
          <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        </div>
        <div className="field">
          <label>رقم الهاتف</label>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} required inputMode="tel" placeholder="07xxxxxxxx" />
        </div>
        <div className="field">
          <label>الرقم التسلسلي (اختياري — اتركه فارغ ليُولَّد تلقائيًا)</label>
          <input value={sequentialNumber} onChange={(e) => setSequentialNumber(e.target.value)} placeholder="مثال: 5 أو 000005" />
        </div>
        <button className="btn-primary" disabled={loading} style={{ marginBottom: 10 }}>
          {loading ? "جاري الحفظ..." : "حفظ العميل"}
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel}>إلغاء</button>
      </form>
    </div>
  );
}
