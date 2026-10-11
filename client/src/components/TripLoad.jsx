import { useEffect, useState } from "react";
import { FiTruck, FiEdit2, FiAlertTriangle } from "react-icons/fi";
import { api } from "../api.js";

// خانات الحمولة: لكل منتج رقم، مع زر «حسب الطلبات»
export function LoadInputs({ products, values, onChange, suggestions = {} }) {
  function set(id, v) {
    const n = Math.max(0, Math.floor(Number(v) || 0));
    onChange({ ...values, [id]: n });
  }
  const hasSuggestions = Object.values(suggestions).some((n) => n > 0);

  return (
    <div>
      {products.map((p) => (
        <div key={p.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: "0.92rem" }}>{p.name}</div>
            {suggestions[p.id] > 0 && (
              <div className="text-secondary" style={{ fontSize: "0.75rem" }}>الطلبات بدها {suggestions[p.id]}</div>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button type="button" className="step-btn" onClick={() => set(p.id, (values[p.id] || 0) - 1)} aria-label={`نقّص ${p.name}`}>−</button>
            <input
              type="number"
              inputMode="numeric"
              min="0"
              value={values[p.id] ?? 0}
              onChange={(e) => set(p.id, e.target.value)}
              aria-label={`كمية ${p.name}`}
              style={{ width: 64, textAlign: "center", padding: "8px 4px", border: "1.5px solid var(--border)", borderRadius: 10, background: "var(--surface)", color: "var(--text)" }}
            />
            <button type="button" className="step-btn plus" onClick={() => set(p.id, (values[p.id] || 0) + 1)} aria-label={`زيد ${p.name}`}>+</button>
          </div>
        </div>
      ))}
      {hasSuggestions && (
        <button
          type="button"
          onClick={() => onChange({ ...values, ...suggestions })}
          style={{ background: "none", border: "none", color: "var(--primary)", fontWeight: 700, cursor: "pointer", padding: "10px 0 0", fontSize: "0.85rem" }}
        >
          عبّي حسب الطلبات بالضبط
        </button>
      )}
    </div>
  );
}

// بطاقة الحمولة أثناء الرحلة: كم محمّل، كم نزل، كم باقي، وهل في نقص
export function TripLoadCard({ trip, canOperate, onChanged }) {
  const [editing, setEditing] = useState(false);
  const [products, setProducts] = useState([]);
  const [values, setValues] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = trip.load || [];
  const loaded = load.filter((l) => l.loaded != null);
  const shortages = load.filter((l) => l.short > 0);

  useEffect(() => {
    if (!editing) return;
    api.getProducts().then((list) => setProducts(list.filter((p) => p.status === "active"))).catch((err) => setError(err.message));
    const v = {};
    for (const l of load) if (l.loaded != null) v[l.product_id] = l.loaded;
    setValues(v);
  }, [editing]);

  const suggestions = {};
  for (const l of load) suggestions[l.product_id] = (l.delivered || 0) + (l.needed || 0);

  async function save() {
    setSaving(true);
    setError("");
    try {
      await api.setTripLoad(trip.id, Object.entries(values).map(([product_id, quantity]) => ({ product_id: Number(product_id), quantity })));
      setEditing(false);
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <div className="card">
        <h2 className="title-md icon-row"><FiTruck aria-hidden="true" /> حمولة السيارة</h2>
        {error && <div className="error-box">{error}</div>}
        <LoadInputs products={products} values={values} onChange={setValues} suggestions={suggestions} />
        <button className="btn-primary" style={{ marginTop: 12, marginBottom: 8 }} disabled={saving} onClick={save}>
          {saving ? "جاري الحفظ..." : "حفظ الحمولة"}
        </button>
        <button className="btn-secondary" onClick={() => setEditing(false)}>إلغاء</button>
      </div>
    );
  }

  if (loaded.length === 0) {
    if (!canOperate || trip.status !== "STARTED") return null;
    return (
      <button className="alert-row" style={{ background: "var(--primary-soft)", color: "var(--navy)" }} onClick={() => setEditing(true)}>
        <FiTruck size={20} aria-hidden="true" />
        <span style={{ flex: 1 }}>سجّل كم حمّلت بالسيارة — عشان تعرف شو باقي معك</span>
      </button>
    );
  }

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <h2 className="title-md icon-row" style={{ margin: 0 }}><FiTruck aria-hidden="true" /> بالسيارة</h2>
        {canOperate && trip.status === "STARTED" && (
          <button className="icon-btn" onClick={() => setEditing(true)} aria-label="تعديل الحمولة"><FiEdit2 size={15} /></button>
        )}
      </div>
      {loaded.map((l) => {
        const pct = l.loaded > 0 ? Math.max(0, Math.min(100, (l.remaining / l.loaded) * 100)) : 0;
        const cls = l.short > 0 ? "bad" : l.remaining <= Math.max(2, l.loaded * 0.15) ? "warn" : "";
        return (
          <div key={l.product_id} style={{ padding: "8px 0" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.9rem", marginBottom: 5 }}>
              <span style={{ fontWeight: 600 }}>{l.name}</span>
              <span className="tabular-num">
                باقي <strong>{l.remaining}</strong> <span className="text-secondary">من {l.loaded}</span>
              </span>
            </div>
            <div className={`meter ${cls}`}><span style={{ width: `${pct}%` }} /></div>
          </div>
        );
      })}
      {shortages.length > 0 && (
        <div className="error-box icon-row" style={{ marginTop: 10, marginBottom: 0 }}>
          <FiAlertTriangle aria-hidden="true" style={{ flexShrink: 0 }} />
          <span>
            الطلبات الباقية بدها أكثر من اللي معك: {shortages.map((s) => `${s.name} ناقص ${s.short}`).join("، ")}
          </span>
        </div>
      )}
      {trip.empties_collected_total > 0 && (
        <div className="text-secondary" style={{ fontSize: "0.82rem", marginTop: 8 }}>
          فوارغ جمعتها: <strong className="tabular-num">{trip.empties_collected_total}</strong>
        </div>
      )}
    </div>
  );
}
