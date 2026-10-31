import { useEffect, useState } from "react";
import { api } from "../api.js";
import { usePerms, ViewOnlyNote } from "../auth.jsx";
import { FiPlus, FiChevronLeft, FiArchive, FiRotateCcw } from "react-icons/fi";
import Sheet, { ConfirmSheet } from "../components/Sheet.jsx";

// صفحة المنتجات: قائمة بسيطة، وكل منتج بينفتح بلوحة من تحت للتعديل
export default function Products() {
  const perms = usePerms();
  const canFull = perms.canEdit("products");
  const canPrice = canFull || perms.canAction("edit_prices");

  const [products, setProducts] = useState(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null); // منتج مفتوح للتعديل، أو {} لمنتج جديد
  const [showArchived, setShowArchived] = useState(false);

  async function load() {
    try {
      setProducts(await api.getProducts(true));
    } catch (err) {
      setError(err.message);
    }
  }
  useEffect(() => { load(); }, []);

  const list = products || [];
  const live = list.filter((p) => p.status !== "archived");
  const archived = list.filter((p) => p.status === "archived");

  return (
    <div className="page pr-page">
      <div className="pr-head">
        <div>
          <h1 className="title-lg" style={{ margin: 0 }}>المنتجات</h1>
          <div className="pr-sub">{products ? `${live.length} منتج` : "جاري التحميل…"}</div>
        </div>
        {canFull && (
          <button type="button" className="pr-add" onClick={() => setEditing({})}>
            <FiPlus aria-hidden="true" /> منتج جديد
          </button>
        )}
      </div>

      {error && <div className="error-box">{error}</div>}
      <ViewOnlyNote section="products" />

      {products && live.length === 0 && (
        <div className="pr-empty">ما في منتجات لسا — ضيف أول منتج (مثلًا «قارورة ١٩ لتر»)</div>
      )}

      <div className="pr-list">
        {live.map((p) => (
          <ProductRow key={p.id} p={p} onOpen={canPrice ? () => setEditing(p) : null} />
        ))}
      </div>

      {archived.length > 0 && (
        <>
          <button type="button" className="pr-arch-toggle" onClick={() => setShowArchived((v) => !v)}>
            <FiArchive aria-hidden="true" /> المؤرشفة ({archived.length}) {showArchived ? "▴" : "▾"}
          </button>
          {showArchived && (
            <div className="pr-list">
              {archived.map((p) => (
                <ProductRow key={p.id} p={p} onOpen={canFull ? () => setEditing(p) : null} />
              ))}
            </div>
          )}
        </>
      )}

      {products && live.length > 0 && (
        <p className="pr-note">🎫 الكوبون بينقبل بس على المنتج المعلّم «يقبل كوبون». باقي المنتجات (شرنكات، كراتين…) بتنحاسب كاش.</p>
      )}

      <ProductSheet
        open={!!editing}
        product={editing}
        canFull={canFull}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); load(); }}
      />
    </div>
  );
}

function ProductRow({ p, onOpen }) {
  const paused = p.status === "paused";
  const arch = p.status === "archived";
  return (
    <button type="button" className={`pr-row${paused || arch ? " dim" : ""}`} onClick={onOpen || undefined} disabled={!onOpen}>
      <span className={`pr-ic${p.coupon_eligible ? " cp" : ""}`} aria-hidden="true">{(p.name || "؟").trim().charAt(0)}</span>
      <span className="pr-t">
        <b>{p.name}</b>
        <span className="pr-tags">
          {p.coupon_eligible && <span className="pr-tag cp">🎫 يقبل كوبون</span>}
          {p.grants_coupons > 0 && <span className="pr-tag">بيشحن {p.grants_coupons} كوبون</span>}
          {paused && <span className="pr-tag off">موقوف</span>}
          {arch && <span className="pr-tag off">مؤرشف</span>}
        </span>
      </span>
      <span className="pr-price tabular-num">{Number(p.unit_price).toFixed(2)}<small>JD</small></span>
      {onOpen && <FiChevronLeft className="pr-chev" aria-hidden="true" />}
    </button>
  );
}

function Switch({ on, onChange, title, hint, disabled }) {
  return (
    <button type="button" className={`pr-sw${on ? " on" : ""}`} onClick={() => onChange(!on)} disabled={disabled} aria-pressed={on}>
      <span className="pr-sw-t">
        <b>{title}</b>
        {hint && <small>{hint}</small>}
      </span>
      <span className="pr-sw-k" aria-hidden="true"><i /></span>
    </button>
  );
}

function ProductSheet({ open, product, canFull, onClose, onSaved }) {
  const isNew = product && !product.id;
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [coupon, setCoupon] = useState(false);
  const [active, setActive] = useState(true);
  const [grants, setGrants] = useState("");
  const [more, setMore] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [confirmArchive, setConfirmArchive] = useState(false);

  useEffect(() => {
    if (!open || !product) return;
    setName(product.name || "");
    setPrice(product.unit_price != null ? String(Number(product.unit_price)) : "");
    setCoupon(isNew ? false : !!product.coupon_eligible);
    setActive(isNew ? true : product.status !== "paused");
    setGrants(product.grants_coupons > 0 ? String(product.grants_coupons) : "");
    setMore(product.grants_coupons > 0);
    setError("");
    setConfirmArchive(false);
  }, [open, product?.id]);

  if (!product) return null;
  const archived = product.status === "archived";
  const priceNum = parseFloat(price);
  const valid = name.trim() && Number.isFinite(priceNum) && priceNum >= 0;

  async function save() {
    setSaving(true);
    setError("");
    try {
      const body = canFull
        ? { name: name.trim(), unit_price: priceNum, coupon_eligible: coupon, grants_coupons: parseInt(grants, 10) || 0 }
        : { unit_price: priceNum };
      if (isNew) {
        await api.createProduct(body);
      } else {
        if (canFull && !archived) body.status = active ? "active" : "paused";
        await api.updateProduct(product.id, body);
      }
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function doArchive() {
    setSaving(true);
    try {
      await api.archiveProduct(product.id);
      onSaved();
    } catch (err) {
      setError(err.message);
      setConfirmArchive(false);
    } finally {
      setSaving(false);
    }
  }

  async function restore() {
    setSaving(true);
    try {
      await api.updateProduct(product.id, { status: "active" });
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (confirmArchive) {
    return (
      <ConfirmSheet
        open={open}
        title={`أرشفة «${product.name}»؟`}
        text="بيختفي من الطلبات الجديدة، والطلبات القديمة بتضل زي ما هي. بتقدر ترجّعه بعدين من «المؤرشفة»."
        confirmLabel="أرشفة"
        danger
        busy={saving}
        onConfirm={doArchive}
        onClose={() => setConfirmArchive(false)}
      />
    );
  }

  return (
    <Sheet open={open} title={isNew ? "منتج جديد" : canFull ? "تعديل المنتج" : `سعر ${product.name}`} onClose={onClose}>
      {error && <div className="error-box">{error}</div>}

      {canFull && (
        <label className="pr-field">
          <span>اسم المنتج</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="مثلًا: قارورة ١٩ لتر" disabled={archived} />
        </label>
      )}

      <label className="pr-field">
        <span>السعر</span>
        <span className="pr-money">
          <input value={price} onChange={(e) => setPrice(e.target.value)} type="number" inputMode="decimal" step="0.01" min="0" placeholder="0.00" className="tabular-num" dir="ltr" disabled={archived} />
          <em>JD</em>
        </span>
      </label>

      {canFull && !archived && (
        <div className="pr-sws">
          <Switch on={coupon} onChange={setCoupon} title="🎫 يقبل كوبون" hint={coupon ? "الزبون بيقدر يدفع حقه كوبونات" : "بينحاسب كاش بس (مثل الشرنكات والكراتين)"} />
          {!isNew && <Switch on={active} onChange={setActive} title="فعّال" hint={active ? "بيطلع بالطلبات" : "موقوف — ما بيطلع بالطلبات الجديدة"} />}
        </div>
      )}

      {canFull && !archived && (
        more ? (
          <label className="pr-field">
            <span>بيشحن كوبونات للزبون لما يستلمه <small>(اختياري)</small></span>
            <input value={grants} onChange={(e) => setGrants(e.target.value)} type="number" inputMode="numeric" min="0" placeholder="0" className="tabular-num" dir="ltr" />
          </label>
        ) : (
          <button type="button" className="pr-more" onClick={() => setMore(true)}>خيارات زيادة</button>
        )
      )}

      <div className="sheet-actions">
        {archived ? (
          <button className="btn-primary icon-row" style={{ justifyContent: "center" }} disabled={saving} onClick={restore}>
            <FiRotateCcw aria-hidden="true" /> رجّعه للمنتجات
          </button>
        ) : (
          <button className="btn-primary" disabled={!valid || saving} onClick={save}>
            {saving ? "جاري الحفظ…" : isNew ? "إضافة المنتج" : "حفظ"}
          </button>
        )}
        <button className="btn-secondary" disabled={saving} onClick={onClose}>رجوع</button>
      </div>

      {canFull && !isNew && !archived && (
        <button type="button" className="pr-archive" onClick={() => setConfirmArchive(true)}>
          <FiArchive aria-hidden="true" /> أرشفة المنتج
        </button>
      )}
    </Sheet>
  );
}
