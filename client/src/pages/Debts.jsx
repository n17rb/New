import { renderMessage } from "../messages.js";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FiSearch, FiChevronLeft } from "react-icons/fi";
import { FaWhatsapp } from "react-icons/fa";
import { api } from "../api.js";
import { ViewOnlyNote } from "../auth.jsx";

function daysSince(date) {
  if (!date) return null;
  return Math.floor((Date.now() - new Date(date).getTime()) / 86400000);
}

function reminderLink(c) {
  const amount = Number(c.debt_balance).toFixed(2);
  const text = renderMessage("debt_reminder", { "الاسم": c.name, "المبلغ": amount });
  return `https://wa.me/${c.phone_normalized}?text=${encodeURIComponent(text)}`;
}

const SORTS = [
  { key: "amount", label: "الأكبر" },
  { key: "oldest", label: "الأقدم" },
  { key: "name", label: "الاسم" },
];

export default function Debts() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("amount");

  useEffect(() => {
    api.getDebts().then(setData).catch((err) => setError(err.message));
  }, []);

  const list = useMemo(() => {
    if (!data) return [];
    const term = q.trim();
    let rows = data.customers.filter((c) => !term || c.name.includes(term) || (c.phone_display || "").replace(/\D/g, "").includes(term.replace(/\D/g, "") || "x"));
    if (sort === "oldest") rows = [...rows].sort((a, b) => new Date(a.debt_since || 0) - new Date(b.debt_since || 0));
    if (sort === "name") rows = [...rows].sort((a, b) => a.name.localeCompare(b.name, "ar"));
    return rows;
  }, [data, q, sort]);

  return (
    <div className="page">
      <h1 className="title-lg">ديون العملاء</h1>
      <ViewOnlyNote section="debts" />
      {error && <div className="error-box">{error}</div>}

      {data && (
        <div className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div className="text-secondary" style={{ fontSize: "0.8rem" }}>مجموع الديون</div>
            <div className="tabular-num" style={{ fontSize: "1.7rem", fontWeight: 800, color: data.total > 0 ? "var(--urgent)" : "var(--success)" }}>
              {data.total.toFixed(2)} JD
            </div>
          </div>
          <div style={{ textAlign: "left" }}>
            <div className="tabular-num" style={{ fontSize: "1.3rem", fontWeight: 800 }}>{data.count}</div>
            <div className="text-secondary" style={{ fontSize: "0.8rem" }}>زبون عليه دين</div>
          </div>
        </div>
      )}

      {data && data.count > 0 && (
        <>
          <div className="field icon-row" style={{ marginBottom: 10 }}>
            <FiSearch style={{ color: "var(--text-secondary)", flexShrink: 0 }} aria-hidden="true" />
            <input placeholder="دوّر بالاسم أو التلفون" value={q} onChange={(e) => setQ(e.target.value)} aria-label="بحث" />
          </div>
          <div className="chips" role="radiogroup" aria-label="الترتيب">
            {SORTS.map((s) => (
              <button key={s.key} className={`chip${sort === s.key ? " on" : ""}`} role="radio" aria-checked={sort === s.key} onClick={() => setSort(s.key)}>
                {s.label}
              </button>
            ))}
          </div>
        </>
      )}

      {!data && !error && <p className="text-secondary">جاري التحميل...</p>}
      {data && data.count === 0 && (
        <div className="card text-secondary">ما في ولا زبون عليه دين 🎉</div>
      )}

      {list.length > 0 && (
        <div className="list-group">
          {list.map((c) => {
            const days = daysSince(c.debt_since);
            return (
              <div key={c.id} className="list-row" style={{ cursor: "default" }}>
                <button
                  onClick={() => navigate(`/customers/${c.id}`)}
                  style={{ all: "unset", flex: 1, minWidth: 0, cursor: "pointer" }}
                >
                  <div className="list-title">{c.name}</div>
                  <div className="list-sub tabular-num">
                    {c.phone_display}
                    {days != null && days > 0 && ` · من ${days} يوم`}
                    {c.region_name && ` · ${c.region_name}`}
                  </div>
                </button>
                <span className="tabular-num" style={{ fontWeight: 800, color: "var(--urgent)", whiteSpace: "nowrap" }}>
                  {Number(c.debt_balance).toFixed(2)}
                </span>
                <a className="icon-btn whatsapp" href={reminderLink(c)} target="_blank" rel="noreferrer" aria-label={`تذكير ${c.name} على واتساب`}>
                  <FaWhatsapp size={17} />
                </a>
                <FiChevronLeft className="list-chevron" aria-hidden="true" />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
