import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FiChevronLeft } from "react-icons/fi";
import { FaWhatsapp } from "react-icons/fa";
import { api } from "../api.js";
import { usePerms } from "../auth.jsx";
import { shopName } from "../shop.js";

function collectText(c) {
  return `مرحبا ${c.name} 🌊\nمعك ${shopName()}.\nحسب سجلاتنا في عندك ${c.bottles_out} قارورة للمحل (عهدة).\nإذا ما عدت محتاجها، بنمرّ نستلمها بالوقت اللي بيناسبك 🙏`;
}

// عهدة القوارير: كم قارورة للمحل برا، عند مين، وقيمتها — ومين لازم نسترجع منه
export default function Bottles() {
  const navigate = useNavigate();
  const { canEdit, isOwner } = usePerms();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("all");
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  function load() {
    api.getBottles().then((d) => { setData(d); setValue(d.bottle_value ? String(d.bottle_value) : ""); }).catch((err) => setError(err.message));
  }
  useEffect(load, []);

  async function saveValue() {
    setSaving(true);
    try {
      await api.setBottleValue(Number(value) || 0);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const list = data ? (tab === "collect" ? data.customers.filter((c) => c.to_collect && c.bottles_out > 0) : data.customers.filter((c) => c.bottles_out > 0 || c.bottles_agreed > 0)) : [];

  return (
    <div className="page">
      <h1 className="title-lg">عهدة القوارير</h1>
      <p className="text-secondary" style={{ marginTop: -6, fontSize: "0.85rem" }}>قوارير المحل اللي عند الزباين — رأس مالك اللي برا.</p>
      {error && <div className="error-box">{error}</div>}

      {data && (
        <div className="today-strip">
          <div className="today-cell" style={{ cursor: "default" }}>
            <div className="today-num tabular-num">{data.total_out}</div>
            <div className="today-label">قارورة برا</div>
          </div>
          <div className="today-cell" style={{ cursor: "default" }}>
            <div className="today-num tabular-num" style={{ fontSize: "1.2rem" }}>{data.total_value != null ? Math.round(data.total_value) : "—"}</div>
            <div className="today-label">{data.total_value != null ? "قيمتها JD" : "حدد قيمة القارورة"}</div>
          </div>
          <button className="today-cell" onClick={() => setTab("collect")}>
            <div className="today-num tabular-num" style={{ color: data.to_collect_bottles ? "var(--urgent)" : undefined }}>{data.to_collect_bottles}</div>
            <div className="today-label">لازم نسترجعها</div>
          </button>
        </div>
      )}

      <div className="seg" style={{ marginBottom: 12 }}>
        <button className={tab === "all" ? "on" : ""} onClick={() => setTab("all")}>كل الزباين ({data ? data.customers_count : "…"})</button>
        <button className={tab === "collect" ? "on" : ""} onClick={() => setTab("collect")}>لازم نسترجع ({data ? data.to_collect_count : "…"})</button>
      </div>

      {tab === "collect" && data && (
        <p className="text-secondary" style={{ fontSize: "0.8rem", marginTop: 0 }}>
          زباين عندهم قوارير وما طلبوا من {data.inactive_days} يوم أو أكثر (أو انحذفوا).
        </p>
      )}

      {!data && !error && <p className="text-secondary">جاري التحميل...</p>}
      {data && list.length === 0 && <div className="card text-secondary">{tab === "collect" ? "ما في حدا لازم نسترجع منه 👌" : "ما في قوارير مسجلة عند الزباين لسا. من صفحة الزبون ← الحساب ← «سلّمته عهدة»."}</div>}

      {list.length > 0 && (
        <div className="list-group">
          {list.map((c) => (
            <div key={c.id} className="list-row" style={{ cursor: "default" }}>
              <button onClick={() => navigate(`/customers/${c.id}`)} style={{ all: "unset", flex: 1, minWidth: 0, cursor: "pointer" }}>
                <div className="list-title">{c.name}{c.status !== "active" && <span className="text-secondary"> (محذوف)</span>}</div>
                <div className="list-sub">
                  {[c.region_name, c.bottles_agreed ? `عهدة ${c.bottles_agreed}` : null, c.last_order_at ? `آخر طلب قبل ${c.days_since_order} يوم` : "ما طلب"].filter(Boolean).join(" · ")}
                </div>
              </button>
              <span className="tabular-num" style={{ fontWeight: 800, fontSize: "1.1rem", color: c.to_collect ? "var(--urgent)" : "var(--navy)" }}>{c.bottles_out}</span>
              {c.to_collect && c.phone_normalized && (
                <a className="icon-btn whatsapp" href={`https://wa.me/${c.phone_normalized}?text=${encodeURIComponent(collectText(c))}`} target="_blank" rel="noreferrer" aria-label={`راسل ${c.name} عن القوارير`}>
                  <FaWhatsapp size={17} />
                </a>
              )}
              <FiChevronLeft className="list-chevron" aria-hidden="true" />
            </div>
          ))}
        </div>
      )}

      {(isOwner || canEdit("settings")) && data && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="field" style={{ marginBottom: 8 }}>
            <label htmlFor="bv">قيمة القارورة الفاضية (JD) — لحساب رأس المال اللي برا</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input id="bv" type="number" inputMode="decimal" min="0" step="0.25" value={value} onChange={(e) => setValue(e.target.value)} style={{ flex: 1 }} />
              <button className="fc-btn primary" style={{ flex: "0 0 auto" }} disabled={saving} onClick={saveValue}>حفظ</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
