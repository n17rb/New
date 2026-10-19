import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api.js";
import SampleDataBanner from "../components/SampleDataBanner.jsx";
import { usePerms, ViewOnlyNote } from "../auth.jsx";
import { FiUserPlus, FiSearch, FiUpload, FiTool, FiMapPin, FiHash } from "react-icons/fi";
import { BottleTypePicker, BottleTypeBadge } from "../components/BottleType.jsx";

// سطر العنوان المختصر: الشارع · عمارة · طابق · شقة
function withLabel(label, value, alreadyLabeled) {
  const v = String(value).trim();
  return alreadyLabeled.test(v) ? v : `${label} ${v}`;
}

function addressLine(c) {
  const parts = [];
  if (c.street) parts.push(c.street);
  const building = [c.building_number, c.building_name].filter(Boolean).join(" ");
  if (building) parts.push(withLabel("عمارة", building, /^(عمار|بناي|مبن|ع\s*\d)/));
  if (c.floor) parts.push(withLabel("طابق", c.floor, /^(طابق|الطابق|ط\s*\d|ط\.)/));
  if (c.apartment) parts.push(withLabel("شقة", c.apartment, /^(شق|ش\s*\d)/));
  return parts.join(" · ");
}

export default function Customers({ user }) {
  const [query, setQuery] = useState("");
  const [regionId, setRegionId] = useState("");
  const [regions, setRegions] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [totalCount, setTotalCount] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [showImportForm, setShowImportForm] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [fixResult, setFixResult] = useState("");
  const [renumbering, setRenumbering] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const [understood, setUnderstood] = useState([]);
  const navigate = useNavigate();

  const perms = usePerms();
  const canAdd = perms.canEdit("customers");

  async function handleRenumber() {
    if (!confirm("هذا الإجراء يعيد ترقيم كل العملاء من ٠٠٠٠٠١ بالتتابع حسب تاريخ الإضافة. متأكد؟")) return;
    setRenumbering(true);
    setError("");
    try {
      const result = await api.renumberCustomers();
      alert(result.message);
      search(query, regionId);
    } catch (err) {
      setError(err.message);
    } finally {
      setRenumbering(false);
    }
  }

  // كل بحث إله رقم — بنعرض نتيجة آخر بحث بس، حتى لو رد قديم وصل متأخر
  const searchSeq = useRef(0);
  const debounceRef = useRef(null);

  async function search(q, region) {
    const seq = ++searchSeq.current;
    setLoading(true);
    setError("");
    try {
      const params = {};
      if (region) params.region_id = region;
      let list;
      if (q.trim()) {
        params.q = q.trim();
        const result = await api.searchCustomers(params);
        if (seq !== searchSeq.current) return;
        setUnderstood(result.understood || []);
        list = result.results;
      } else {
        list = await api.getCustomers(params);
        if (seq !== searchSeq.current) return;
        setUnderstood([]);
      }
      setCustomers(list);
    } catch (err) {
      if (seq === searchSeq.current) setError(err.message);
    } finally {
      if (seq === searchSeq.current) setLoading(false);
    }
  }

  useEffect(() => {
    search("", "");
    api.getRegions().then(setRegions).catch(() => {});
    api.getCustomerCount().then((r) => setTotalCount(r.count)).catch(() => {});
  }, []);

  function handleSearchChange(e) {
    const q = e.target.value;
    setQuery(q);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(q, regionId), 250);
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
      {totalCount !== null && (
        <p className="text-secondary" style={{ marginTop: -8, marginBottom: 12 }}>
          إجمالي العملاء: <strong className="tabular-num">{totalCount}</strong>
        </p>
      )}
      {user?.role === "super_admin" && <SampleDataBanner onCleared={() => { search(query, regionId); api.getCustomerCount?.().then((r) => setTotalCount(r.count)).catch(() => {}); }} />}

      {!showAddForm && !showImportForm && (
        <>
          <div className="field icon-row">
            <FiSearch style={{ color: "var(--text-secondary)", flexShrink: 0 }} />
            <input
              placeholder="اسم، تلفون، أو مثلاً: عمارة 5 طابق ثاني"
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
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <button className="btn-primary icon-row" style={{ justifyContent: "center", flex: 1 }} onClick={() => setShowAddForm(true)}>
                <FiUserPlus aria-hidden="true" /> زبون جديد
              </button>
              <button
                className="btn-secondary icon-row"
                style={{ width: "auto", padding: "0 16px", justifyContent: "center" }}
                aria-expanded={showTools}
                onClick={() => setShowTools(!showTools)}
              >
                <FiTool aria-hidden="true" /> أدوات
              </button>
            </div>
          )}

          {canAdd && showTools && (
            <div className="list-group">
              <button className="list-row" onClick={() => setShowImportForm(true)}>
                <span className="list-icon"><FiUpload aria-hidden="true" /></span>
                <span className="list-text"><span className="list-title">استيراد عملاء دفعة وحدة</span></span>
              </button>
              <button className="list-row" disabled={fixing} onClick={handleFixLocations}>
                <span className="list-icon"><FiMapPin aria-hidden="true" /></span>
                <span className="list-text"><span className="list-title">{fixing ? "جاري الإصلاح..." : "إصلاح مواقع العملاء القدامى"}</span></span>
              </button>
              {perms.isOwner && (
                <button className="list-row" disabled={renumbering} onClick={handleRenumber}>
                  <span className="list-icon"><FiHash aria-hidden="true" /></span>
                  <span className="list-text"><span className="list-title">{renumbering ? "جاري إعادة الترقيم..." : "إعادة ترقيم كل العملاء بالتتابع"}</span></span>
                </button>
              )}
            </div>
          )}
          {fixResult && <div className="success-box">{fixResult}</div>}

          {error && <div className="error-box">{error}</div>}
          {query.trim() && understood.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", margin: "-4px 0 12px" }} aria-live="polite">
              <span className="text-secondary" style={{ fontSize: "0.8rem" }}>عم دوّر على:</span>
              {understood.map((u, i) => (
                <span key={i} className="badge" style={{ background: "var(--primary-soft)", color: "var(--navy)" }}>
                  {u.label} {u.value}
                </span>
              ))}
              {!loading && <span className="text-secondary" style={{ fontSize: "0.8rem" }}>· {customers.length} نتيجة</span>}
            </div>
          )}
          {loading && !customers.length && <p className="text-secondary">جاري البحث...</p>}

          <div className="card" style={{ padding: 0 }}>
            {customers.length === 0 && !loading && (
              <p className="text-secondary" style={{ padding: 14 }}>لا يوجد عملاء مطابقون.</p>
            )}
            {customers.map((c) => {
              const hasNoLink = !c.maps_url;
              const hasBrokenLink = c.maps_url && !c.latitude;
              return (
                <div key={c.id} className="customer-row" onClick={() => navigate(`/customers/${c.id}`)} style={{ cursor: "pointer", padding: "10px 14px" }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>
                      {c.name}
                      {c.is_sample && <span className="badge sample-badge">تجريبي</span>}
                      {hasNoLink && (
                        <span style={{ color: "var(--warning)", fontSize: "0.75rem", marginRight: 6 }}> ⚠️ بدون موقع أصلًا</span>
                      )}
                      {hasBrokenLink && (
                        <span style={{ color: "var(--urgent)", fontSize: "0.75rem", marginRight: 6 }}> ❌ رابط محفوظ بس مكسور</span>
                      )}
                    </div>
                    <div className="text-secondary tabular-num" style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <span>{c.phone_display} · #{c.sequential_number}</span>
                      <BottleTypeBadge type={c.bottle_type} />
                      {c.fc_due_label && (c.fc_status === "today" || c.fc_status === "late" || c.fc_status === "tomorrow") && (
                        <span className="badge" style={{
                          background: c.fc_status === "late" ? "var(--urgent-soft)" : c.fc_status === "today" ? "var(--warning-soft)" : "var(--primary-soft)",
                          color: c.fc_status === "late" ? "var(--urgent)" : c.fc_status === "today" ? "var(--warning)" : "var(--navy)",
                        }}>
                          💧 {c.fc_status === "late" ? c.fc_due_label : `بيطلب ${c.fc_due_label}`}
                        </span>
                      )}
                    </div>
                    {addressLine(c) && (
                      <div className="text-secondary" style={{ fontSize: "0.8rem", marginTop: 2 }}>{addressLine(c)}</div>
                    )}
                  </div>
                  {c.region_name && <span className="badge">{c.region_name}</span>}
                </div>
              );
            })}
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
  const [seqTouched, setSeqTouched] = useState(false);
  const [seqInName, setSeqInName] = useState(() => localStorage.getItem("seq_in_name") !== "false");
  const [bottleType, setBottleType] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);

  // الرقم الجاي بيتعبّى لحاله
  useEffect(() => {
    api.getNextCustomerSeq().then((r) => { if (!seqTouched) setSequentialNumber(r.next); }).catch(() => {});
  }, []);

  function toggleSeqInName(v) {
    setSeqInName(v);
    localStorage.setItem("seq_in_name", v ? "true" : "false");
  }

  const cleanName = name.trim().replace(/\s+/g, " ");
  const seq = sequentialNumber.trim();
  const previewName = seqInName && seq && cleanName && !cleanName.split(" ").includes(seq) ? `${cleanName} ${seq}` : cleanName;

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setInfo("");
    if (!bottleType) {
      setError("اختار نوع القوارير للزبون: جديدة أو مستعملة.");
      return;
    }
    setLoading(true);
    try {
      const result = await api.createCustomer({
        name,
        phone,
        sequential_number: seq || undefined,
        seq_in_name: seqInName,
        bottle_type: bottleType,
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
        <div className="field-row" style={{ alignItems: "flex-end" }}>
          <div className="field" style={{ flex: 2.2 }}>
            <label>اسم العميل</label>
            <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus placeholder="مثلاً: محمد" />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>الرقم التسلسلي</label>
            <input className="tabular-num" value={sequentialNumber} inputMode="numeric"
              onChange={(e) => { setSeqTouched(true); setSequentialNumber(e.target.value); }} placeholder="تلقائي" style={{ textAlign: "center", fontWeight: 700 }} />
          </div>
        </div>
        <label className="check-row">
          <input type="checkbox" checked={seqInName} onChange={(e) => toggleSeqInName(e.target.checked)} />
          <span>اكتب الرقم جنب الاسم تلقائيًا</span>
        </label>
        {cleanName && (
          <div className="seq-preview">
            رح ينحفظ باسم: <b>{previewName}</b>{seq && <> · رقم <b className="tabular-num"><bdi dir="ltr">#{seq}</bdi></b></>}
          </div>
        )}
        <div className="field">
          <label>رقم الهاتف</label>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} required inputMode="tel" placeholder="07xxxxxxxx" />
        </div>
        <BottleTypePicker value={bottleType} onChange={setBottleType} required />
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
