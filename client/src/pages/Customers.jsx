import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { FiUserPlus, FiSearch, FiUpload } from "react-icons/fi";

export default function Customers({ user }) {
  const [query, setQuery] = useState("");
  const [regionId, setRegionId] = useState("");
  const [regions, setRegions] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [showImportForm, setShowImportForm] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [fixResult, setFixResult] = useState("");
  const navigate = useNavigate();

  const canAdd = ["super_admin", "admin", "data_entry", "driver"].includes(user.role);

  async function search(q, region) {
    setLoading(true);
    setError("");
    try {
      const params = {};
      if (q) params.q = q;
      if (region) params.region_id = region;
      const result = await api.getCustomers(params);
      setCustomers(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    search("", "");
    api.getRegions().then(setRegions).catch(() => {});
  }, []);

  function handleSearchChange(e) {
    const q = e.target.value;
    setQuery(q);
    search(q, regionId);
  }

  function handleRegionChange(e) {
    const r = e.target.value;
    setRegionId(r);
    search(query, r);
  }

  async function handleFixLocations() {
    setFixing(true);
    setFixResult("");
    try {
      const result = await api.fixCustomerLocations();
      setFixResult(result.message);
    } catch (err) {
      setFixResult("خطأ: " + err.message);
    } finally {
      setFixing(false);
    }
  }

  return (
    <div className="page">
      <h1 className="title-lg">العملاء</h1>

      {!showAddForm && !showImportForm && (
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

          {regions.length > 0 && (
            <div className="field">
              <select value={regionId} onChange={handleRegionChange}>
                <option value="">كل المناطق</option>
                {regions.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </div>
          )}

          {canAdd && (
            <button className="btn-primary icon-row" style={{ justifyContent: "center", marginBottom: 12 }} onClick={() => setShowAddForm(true)}>
              <FiUserPlus /> زبون جديد
            </button>
          )}

          {canAdd && (
            <button className="btn-secondary icon-row" style={{ justifyContent: "center", marginBottom: 12 }} onClick={() => setShowImportForm(true)}>
              <FiUpload /> استيراد عملاء دفعة وحدة
            </button>
          )}

          {canAdd && (
            <button className="btn-secondary" style={{ marginBottom: 16, fontSize: "0.85rem" }} disabled={fixing} onClick={handleFixLocations}>
              {fixing ? "جاري الإصلاح..." : "🔧 إصلاح مواقع العملاء القدامى الناقصة"}
            </button>
          )}
          {fixResult && <div className="success-box">{fixResult}</div>}

          {error && <div className="error-box">{error}</div>}
          {loading && <p className="text-secondary">جاري البحث...</p>}

          <div className="card" style={{ padding: 0 }}>
            {customers.length === 0 && !loading && (
              <p className="text-secondary" style={{ padding: 14 }}>لا يوجد عملاء مطابقون.</p>
            )}
            {customers.map((c) => (
              <div key={c.id} className="customer-row" onClick={() => navigate(`/customers/${c.id}`)} style={{ cursor: "pointer", padding: "10px 14px" }}>
                <div>
                  <div style={{ fontWeight: 600 }}>
                    {c.name}
                    {!c.latitude && (
                      <span style={{ color: "var(--urgent)", fontSize: "0.75rem", marginRight: 6 }}> ⚠️ الموقع غير محفوظ</span>
                    )}
                  </div>
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

      {showImportForm && (
        <BulkImportForm onCancel={() => setShowImportForm(false)} onDone={() => { setShowImportForm(false); search(query, regionId); }} />
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

function BulkImportForm({ onCancel, onDone }) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  async function handleImport() {
    setError("");
    setResult(null);

    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    const rows = lines.map((line) => {
      const parts = line.split(",").map((p) => p.trim());
      return { name: parts[0], phone: parts[1] };
    }).filter((r) => r.name && r.phone);

    if (rows.length === 0) {
      setError("لم يتم التعرف على أي عميل بالصيغة الصحيحة.");
      return;
    }

    setLoading(true);
    try {
      const res = await api.bulkImportCustomers(rows);
      setResult(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card">
      <h2 className="title-md">استيراد عملاء دفعة وحدة</h2>
      <p className="text-secondary" style={{ marginBottom: 10 }}>
        الصق قائمة العملاء، سطر لكل عميل، بالصيغة: <strong>الاسم, رقم الهاتف</strong>
        <br />مثال: <span className="tabular-num">أحمد علي, 0791234567</span>
      </p>
      {error && <div className="error-box">{error}</div>}
      {result && (
        <div className="success-box">
          تم استيراد {result.imported} عميل بنجاح. تم تجاوز {result.skipped} (مكرر أو غير صالح).
        </div>
      )}

      <div className="field">
        <textarea
          rows={10}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"أحمد علي, 0791234567\nسارة محمد, 0777654321"}
          style={{ fontFamily: "monospace" }}
        />
      </div>

      {!result ? (
        <>
          <button className="btn-primary" style={{ marginBottom: 10 }} disabled={loading} onClick={handleImport}>
            {loading ? "جاري الاستيراد..." : "استيراد الآن"}
          </button>
          <button type="button" className="btn-secondary" onClick={onCancel}>إلغاء</button>
        </>
      ) : (
        <button className="btn-primary" onClick={onDone}>تم</button>
      )}
    </div>
  );
}
