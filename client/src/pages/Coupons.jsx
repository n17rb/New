import { renderMessage } from "../messages.js";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FiPlus, FiImage, FiEdit2, FiArchive, FiRotateCcw } from "react-icons/fi";
import { FaWhatsapp } from "react-icons/fa";
import { api } from "../api.js";
import { usePerms, ViewOnlyNote } from "../auth.jsx";

const money = (n) => `${Number(n || 0).toFixed(2)} JD`;

function lowBalanceLink(c) {
  const text = renderMessage("coupons_low", { "الاسم": c.name, "الرصيد": c.coupon_balance });
  return `https://wa.me/${c.phone_normalized}?text=${encodeURIComponent(text)}`;
}

function PackageForm({ initial, onCancel, onSaved }) {
  const [coupons, setCoupons] = useState(initial?.coupons ?? "");
  const [bonus, setBonus] = useState(initial?.bonus_coupons ?? 0);
  const [price, setPrice] = useState(initial?.price != null ? String(Number(initial.price)) : "");
  const [description, setDescription] = useState(initial?.description || "");
  const [image, setImage] = useState(null);
  const [preview, setPreview] = useState(initial?.image_url || null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function pick(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setImage(f);
    setPreview(URL.createObjectURL(f));
  }

  const perCoupon = Number(price) && Number(coupons) ? Number(price) / (Number(coupons) + Number(bonus || 0)) : null;

  async function save() {
    setSaving(true);
    setError("");
    try {
      const body = { coupons: Number(coupons), bonus_coupons: Number(bonus) || 0, price: Number(price), description, status: initial?.status || "active" };
      const saved = initial ? await api.updateCouponPackage(initial.id, body) : await api.createCouponPackage(body);
      if (image) await api.uploadCouponPackageImage(saved.id, image);
      onSaved();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <h2 className="title-md">{initial ? "تعديل الباقة" : "باقة جديدة"}</h2>
      {error && <div className="error-box">{error}</div>}

      <label className="package-image-picker">
        {preview ? <img src={preview} alt="" /> : <span><FiImage aria-hidden="true" /> صورة الباقة (اختياري)</span>}
        <input type="file" accept="image/*" onChange={pick} style={{ display: "none" }} />
      </label>

      <div className="field-row">
        <div className="field">
          <label htmlFor="pk-c">عدد الكوبونات</label>
          <input id="pk-c" type="number" inputMode="numeric" min="1" value={coupons} onChange={(e) => setCoupons(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="pk-b">هدية (اختياري)</label>
          <input id="pk-b" type="number" inputMode="numeric" min="0" value={bonus} onChange={(e) => setBonus(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="pk-p">السعر (JD)</label>
        <input id="pk-p" type="number" inputMode="decimal" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
        {perCoupon != null && (
          <div className="text-secondary" style={{ fontSize: "0.8rem", marginTop: 4 }}>
            يعني الكوبون بـ {perCoupon.toFixed(3)} JD
          </div>
        )}
      </div>
      <div className="field">
        <label htmlFor="pk-d">وصف قصير (اختياري)</label>
        <input id="pk-d" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="مثلاً: الأوفر للعائلات" />
      </div>
      <button className="btn-primary" style={{ marginBottom: 8 }} disabled={saving || !coupons || price === ""} onClick={save}>
        {saving ? "جاري الحفظ..." : initial ? "حفظ التعديل" : "إضافة الباقة"}
      </button>
      <button className="btn-secondary" onClick={onCancel}>إلغاء</button>
    </div>
  );
}

export default function Coupons() {
  const navigate = useNavigate();
  const { canEdit } = usePerms();
  const editable = canEdit("coupons");
  const [packages, setPackages] = useState(null);
  const [overview, setOverview] = useState(null);
  const [editing, setEditing] = useState(null); // null | "new" | package
  const [error, setError] = useState("");

  async function load() {
    setError("");
    try {
      const [p, o] = await Promise.all([api.getCouponPackages(true), api.getCouponsOverview()]);
      setPackages(p);
      setOverview(o);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => { load(); }, []);

  async function toggleArchive(p) {
    try {
      await api.updateCouponPackage(p.id, { ...p, price: Number(p.price), status: p.status === "active" ? "archived" : "active" });
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  if (editing) {
    return (
      <div className="page">
        <PackageForm initial={editing === "new" ? null : editing} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
      </div>
    );
  }

  return (
    <div className="page">
      <h1 className="title-lg">الكوبونات والباقات</h1>
      <ViewOnlyNote section="coupons" />
      {error && <div className="error-box">{error}</div>}

      {overview && (
        <div className="today-strip">
          <div className="today-cell" style={{ cursor: "default" }}>
            <div className="today-num tabular-num" style={{ fontSize: "1.25rem" }}>{Number(overview.month_sales).toFixed(0)}</div>
            <div className="today-label">مبيعات الشهر JD</div>
          </div>
          <div className="today-cell" style={{ cursor: "default" }}>
            <div className="today-num tabular-num">{overview.month_count}</div>
            <div className="today-label">باقات انباعت</div>
          </div>
          <div className="today-cell" onClick={() => document.getElementById("cp-holders")?.scrollIntoView({ behavior: "smooth", block: "start" })}>
            <div className="today-num tabular-num">{overview.coupons_outstanding}</div>
            <div className="today-label">كوبون عند الزباين</div>
          </div>
        </div>
      )}

      <div className="section-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>الباقات</span>
        {editable && (
          <button onClick={() => setEditing("new")} style={{ background: "none", border: "none", color: "var(--primary)", fontWeight: 700, cursor: "pointer", display: "inline-flex", gap: 4, alignItems: "center" }}>
            <FiPlus aria-hidden="true" /> باقة جديدة
          </button>
        )}
      </div>

      {packages && packages.length === 0 && (
        <div className="card text-secondary">
          ما في باقات لسا. {editable && "ضيف أول باقة — مثلاً «١٠ كوبونات + ١ هدية بـ ١٥ دينار»."}
        </div>
      )}

      {packages && packages.length > 0 && (
        <div className="list-group">
          {packages.map((p) => (
            <div key={p.id} className="list-row" style={{ cursor: "default", opacity: p.status === "active" ? 1 : 0.55 }}>
              {p.image_url ? (
                <img src={p.image_url} alt="" style={{ width: 52, height: 52, borderRadius: 12, objectFit: "cover", flexShrink: 0 }} />
              ) : (
                <span className="list-icon" style={{ width: 52, height: 52, borderRadius: 12, fontWeight: 800 }}>{p.coupons}</span>
              )}
              <span className="list-text">
                <span className="list-title">{p.name}{p.status !== "active" && " (مخفية)"}</span>
                <div className="list-sub tabular-num">
                  {p.coupons} كوبون{p.bonus_coupons > 0 && ` + ${p.bonus_coupons} هدية`} · {money(p.price)}
                </div>
              </span>
              {editable && (
                <>
                  <button className="icon-btn" onClick={() => setEditing(p)} aria-label={`تعديل ${p.name}`}><FiEdit2 size={15} /></button>
                  <button className="icon-btn" onClick={() => toggleArchive(p)} aria-label={p.status === "active" ? "إخفاء الباقة" : "إرجاع الباقة"}>
                    {p.status === "active" ? <FiArchive size={15} /> : <FiRotateCcw size={15} />}
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      <CouponHolders />

      {overview && overview.recent_sales.length > 0 && (
        <>
          <div className="section-title">آخر المبيعات</div>
          <div className="list-group">
            {overview.recent_sales.slice(0, 15).map((s) => (
              <div key={s.id} className="list-row" style={{ cursor: "default" }}>
                <span className="list-text">
                  <span className="list-title">{s.customer_name}</span>
                  <div className="list-sub">
                    {s.package_name_snapshot} · {new Date(s.created_at).toLocaleDateString("ar-JO", { timeZone: "Asia/Amman", day: "numeric", month: "short" })}
                    {s.sold_by_name && ` · ${s.sold_by_name}`}
                  </div>
                </span>
                <span className="tabular-num" style={{ textAlign: "left", fontWeight: 700 }}>
                  {money(s.price)}
                  {Number(s.paid_amount) < Number(s.price) && (
                    <div style={{ fontSize: "0.72rem", color: "var(--urgent)", fontWeight: 600 }}>دين {money(Number(s.price) - Number(s.paid_amount))}</div>
                  )}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// مع مين الكوبونات: كل زبون معه رصيد، كم ضله، وآخر باقة أخذها
function CouponHolders() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all"); // all | low | out
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    api.getCouponHolders().then(setData).catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="error-box">{error}</div>;
  if (!data) return null;
  if (data.holders.length === 0) return null;

  const term = q.trim();
  const counts = {
    all: data.holders.filter((h) => h.coupon_balance > 0).length,
    low: data.holders.filter((h) => h.coupon_balance > 0 && h.coupon_balance <= 2).length,
    out: data.holders.filter((h) => h.coupon_balance <= 0).length,
  };
  const list = data.holders.filter((h) => {
    if (filter === "all" && h.coupon_balance <= 0) return false;
    if (filter === "low" && !(h.coupon_balance > 0 && h.coupon_balance <= 2)) return false;
    if (filter === "out" && h.coupon_balance > 0) return false;
    if (term && !(h.name || "").includes(term) && !(h.phone_display || "").replace(/\s/g, "").includes(term.replace(/\s/g, ""))) return false;
    return true;
  });
  const shown = showAll || term ? list : list.slice(0, 30);
  const fmt = (iso) => new Date(iso).toLocaleDateString("ar-JO", { timeZone: "Asia/Amman", day: "numeric", month: "short" });

  return (
    <div id="cp-holders" className="ch">
      <div className="ch-head">
        <div>
          <div className="ch-title">مع مين الكوبونات</div>
          <div className="ch-sum tabular-num">{data.customers_with} زبون معهم <b>{data.total_balance}</b> كوبون</div>
        </div>
      </div>

      <input className="ch-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="دوّر باسم أو رقم…" aria-label="دوّر على زبون" />

      <div className="ch-seg">
        <button type="button" className={filter === "all" ? "on" : ""} onClick={() => setFilter("all")}>معهم كوبونات <span className="tabular-num">{counts.all}</span></button>
        <button type="button" className={filter === "low" ? "on" : ""} onClick={() => setFilter("low")}>قربت تخلص <span className="tabular-num">{counts.low}</span></button>
        <button type="button" className={filter === "out" ? "on" : ""} onClick={() => setFilter("out")}>خلصت <span className="tabular-num">{counts.out}</span></button>
      </div>

      {list.length === 0 && <div className="ch-empty">ما في حدا هون</div>}

      <div className="ch-list">
        {shown.map((h) => {
          const bal = Math.max(0, h.coupon_balance);
          const total = Math.max(bal, h.last_package_coupons || 0);
          const pct = total > 0 ? Math.round((bal / total) * 100) : 0;
          const tone = bal === 0 ? "out" : bal <= 2 ? "low" : "ok";
          return (
            <div key={h.id} className={`ch-row ${tone}`}>
              <button type="button" className="ch-main" onClick={() => navigate(`/customers/${h.id}`)}>
                <span className="ch-t">
                  <b>{h.name}</b>
                  <small>
                    {h.last_package ? `آخر باقة: ${h.last_package} · ${fmt(h.last_package_at)}` : h.region_name || h.phone_display}
                  </small>
                </span>
                <span className="ch-n tabular-num">
                  <b>{bal}</b>
                  <small>{bal === 0 ? "خلصت" : total > bal ? `من ${total}` : "كوبون"}</small>
                </span>
              </button>
              {total > 0 && <div className="ch-bar" aria-hidden="true"><span style={{ width: `${pct}%` }} /></div>}
              <div className="ch-foot tabular-num">
                <span>استعمل {h.total_used} من أصل {h.total_in}{h.last_use_at ? ` · آخر استعمال ${fmt(h.last_use_at)}` : ""}</span>
                {tone !== "ok" && h.phone_normalized && (
                  <a className="ch-wa" href={lowBalanceLink(h)} target="_blank" rel="noreferrer" aria-label={`ذكّر ${h.name}`}>
                    <FaWhatsapp aria-hidden="true" /> ذكّره
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {!showAll && !term && list.length > shown.length && (
        <button type="button" className="ch-more" onClick={() => setShowAll(true)}>عرض الكل ({list.length})</button>
      )}
    </div>
  );
}
