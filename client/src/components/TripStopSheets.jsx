import { useEffect, useState } from "react";
import { api } from "../api.js";
import Sheet from "./Sheet.jsx";
import { FaWhatsapp } from "react-icons/fa";
import { couponsAddedText } from "./Receipt.jsx";

// ============================================================
// تعديل الطلب من جوّا الرحلة (مثلًا أخذ قارورتين بدل ٣)
// ============================================================
export function EditItemsSheet({ open, stop, onClose, onSaved }) {
  const [products, setProducts] = useState([]);
  const [qty, setQty] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setError("");
    const initial = {};
    (stop.items || []).forEach((it) => { initial[it.product_id] = (initial[it.product_id] || 0) + Number(it.quantity); });
    setQty(initial);
    api.getProducts()
      .then((list) => setProducts(list.filter((p) => p.status === "active" || initial[p.id])))
      .catch((e) => setError(e.message));
  }, [open, stop?.id]);

  const change = (id, d) => setQty((q) => ({ ...q, [id]: Math.max(0, (q[id] || 0) + d) }));
  const total = products.reduce((s, p) => s + (qty[p.id] || 0) * Number(p.unit_price), 0);
  const hasAny = Object.values(qty).some((v) => v > 0);

  async function save() {
    setSaving(true);
    setError("");
    try {
      const items = Object.entries(qty).filter(([, v]) => v > 0).map(([product_id, quantity]) => ({ product_id: Number(product_id), quantity }));
      await api.updateStopItems(stop.id, items);
      onSaved?.("✅ انعدّل الطلب");
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} title="تعديل الطلب" onClose={onClose}>
      <div className="sheet-who">
        <span className="sheet-who-n">✎</span>
        <span><b>{stop.customer_name}</b><small className="tabular-num">#{stop.order_number}</small></span>
      </div>
      {error && <div className="error-box">{error}</div>}
      <div className="ei-list">
        {products.map((p) => (
          <div key={p.id} className={`ei-row${qty[p.id] ? " on" : ""}`}>
            <div className="ei-name">
              <b>{p.name}</b>
              <small className="tabular-num">{Number(p.unit_price).toFixed(2)} JD</small>
            </div>
            <div className="ei-step">
              <button type="button" className="step-btn" onClick={() => change(p.id, -1)} aria-label="أقل">−</button>
              <span className="tabular-num">{qty[p.id] || 0}</span>
              <button type="button" className="step-btn plus" onClick={() => change(p.id, 1)} aria-label="أكثر">+</button>
            </div>
          </div>
        ))}
      </div>
      <div className="ei-total">
        <span>المجموع الجديد</span>
        <b className="tabular-num">{total.toFixed(2)} JD</b>
      </div>
      <div className="sheet-actions">
        <button className="btn-primary" disabled={!hasAny || saving} onClick={save}>{saving ? "جاري الحفظ…" : "حفظ التعديل"}</button>
        <button className="btn-secondary" disabled={saving} onClick={onClose}>رجوع</button>
      </div>
    </Sheet>
  );
}

// ============================================================
// بيع باقة كوبونات للزبون من جوّا الرحلة
// ============================================================
export function SellPackageSheet({ open, stop, onClose, onSaved }) {
  const [packages, setPackages] = useState(null);
  const [pick, setPick] = useState(null);
  const [payMode, setPayMode] = useState("full"); // full | part
  const [paid, setPaid] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(null); // بعد البيع: {added, balance, unpaid, walletToken}

  useEffect(() => {
    if (!open) return;
    setDone(null);
    setPick(null);
    setPayMode("full");
    setPaid("");
    setError("");
    api.getCouponPackages().then(setPackages).catch((e) => { setPackages([]); setError(e.message); });
  }, [open]);

  const pkg = packages?.find((p) => p.id === pick);
  const price = pkg ? Number(pkg.price) : 0;
  const paidNum = payMode === "full" ? price : Number(paid || 0);
  const unpaid = Math.max(0, Math.round((price - paidNum) * 100) / 100);

  async function sell() {
    if (!pkg) return;
    setSaving(true);
    setError("");
    try {
      const r = await api.sellPackageInTrip(stop.id, { package_id: pkg.id, paid_amount: paidNum });
      onSaved?.(`✅ انباعت الباقة — صار معه ${r.coupon_balance} كوبون`);
      setDone({ added: pkg.coupons + (pkg.bonus_coupons || 0), balance: r.coupon_balance, unpaid, packageName: pkg.name, walletToken: r.wallet_token || null });
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (done) {
    const msg = couponsAddedText({ name: stop.customer_name, ...done, balance: done.balance });
    return (
      <Sheet open={open} title="انباعت الباقة" onClose={onClose}>
        <div className="sold-card">
          <div className="sold-ic" aria-hidden="true">✓</div>
          <div className="sold-n tabular-num">+{done.added}</div>
          <div className="sold-t">كوبون انضاف لـ{stop.customer_name}</div>
          <div className="sold-b tabular-num">رصيده صار {done.balance} كوبون</div>
        </div>
        <div className="sheet-actions">
          <a className="btn-primary icon-row" style={{ justifyContent: "center", textDecoration: "none", background: "var(--whatsapp)" }}
            href={`https://wa.me/${stop.phone_normalized}?text=${encodeURIComponent(msg)}`} target="_blank" rel="noreferrer" onClick={onClose}>
            <FaWhatsapp aria-hidden="true" /> ابعتله رسالة برابط رصيده
          </a>
          <button className="btn-secondary" onClick={onClose}>تم</button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet open={open} title="بيع باقة كوبونات" onClose={onClose}>
      <div className="sheet-who">
        <span className="sheet-who-n">🎫</span>
        <span>
          <b>{stop.customer_name}</b>
          <small>{(stop.coupon_balance || 0) > 0 ? `معه هلّق ${stop.coupon_balance} كوبون` : "ما معه كوبونات"}</small>
        </span>
      </div>
      {error && <div className="error-box">{error}</div>}
      {packages === null && <p className="text-secondary">جاري التحميل…</p>}
      {packages && packages.length === 0 && !error && (
        <p className="text-secondary">ما في باقات كوبونات — ضيفها من «المزيد ← الكوبونات».</p>
      )}
      <div className="pk-list">
        {(packages || []).map((p) => (
          <button key={p.id} type="button" className={`pk-card${pick === p.id ? " on" : ""}`} onClick={() => setPick(p.id)}>
            <span className="pk-name tabular-num">{p.coupons} كوبون</span>
            {p.bonus_coupons > 0 && <span className="pk-c tabular-num"><em>+ {p.bonus_coupons} هدية</em></span>}
            <span className="pk-price tabular-num">{Number(p.price).toFixed(2)} <small>JD</small></span>
          </button>
        ))}
      </div>

      {pkg && (
        <>
          <div className="sheet-q" style={{ marginTop: 14 }}>الدفع</div>
          <div className="seg" style={{ marginBottom: 10 }}>
            <button type="button" className={payMode === "full" ? "on" : ""} onClick={() => setPayMode("full")}>دفع كامل كاش</button>
            <button type="button" className={payMode === "part" ? "on" : ""} onClick={() => setPayMode("part")}>دفع جزء (الباقي دين)</button>
          </div>
          {payMode === "part" && (
            <div className="field">
              <input type="number" inputMode="decimal" min="0" max={price} step="0.01" value={paid}
                onChange={(e) => setPaid(e.target.value)} placeholder="كم دفع؟" aria-label="المبلغ المدفوع" />
              {unpaid > 0 && <div className="pay-note warn" style={{ marginTop: 6 }}>رح ينضاف {unpaid.toFixed(2)} JD دين عليه</div>}
            </div>
          )}
        </>
      )}

      <div className="sheet-actions">
        <button className="btn-primary" disabled={!pkg || saving || paidNum < 0 || paidNum > price + 0.001} onClick={sell}>
          {saving ? "جاري البيع…" : pkg ? `بيع · استلمت ${paidNum.toFixed(2)} JD` : "اختار باقة"}
        </button>
        <button className="btn-secondary" disabled={saving} onClick={onClose}>رجوع</button>
      </div>
    </Sheet>
  );
}

// ============================================================
// طلب جديد من جوّا الرحلة: ابحث عن الزبون ← الكميات ← تأكيد
// بينضاف للرحلة وبتترتب من جديد لحالها
// ============================================================
export function NewOrderSheet({ open, tripId, onClose, onSaved }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [cust, setCust] = useState(null);
  const [products, setProducts] = useState([]);
  const [qty, setQty] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setQ(""); setResults([]); setCust(null); setQty({}); setError("");
    api.getProducts().then((list) => setProducts(list.filter((p) => p.status === "active"))).catch((e) => setError(e.message));
  }, [open]);

  useEffect(() => {
    if (!open || cust) return;
    const term = q.trim();
    if (term.length < 2) { setResults([]); return; }
    let alive = true;
    setSearching(true);
    const t = setTimeout(() => {
      api.getCustomers({ q: term })
        .then((r) => alive && setResults(r.slice(0, 12)))
        .catch((e) => alive && setError(e.message))
        .finally(() => alive && setSearching(false));
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [q, open, cust]);

  function choose(c) {
    setCust(c);
    setError("");
    // أول منتج = قارورة وحدة كبداية
    if (products[0]) setQty({ [products[0].id]: 1 });
  }

  const change = (id, d) => setQty((x) => ({ ...x, [id]: Math.max(0, (x[id] || 0) + d) }));
  const total = products.reduce((s, p) => s + (qty[p.id] || 0) * Number(p.unit_price), 0);
  const hasAny = Object.values(qty).some((v) => v > 0);

  async function save() {
    setSaving(true);
    setError("");
    try {
      const items = Object.entries(qty).filter(([, v]) => v > 0).map(([product_id, quantity]) => ({ product_id: Number(product_id), quantity }));
      const r = await api.createOrder({ customer_id: cust.id, items, trip_id: tripId });
      onSaved?.(r.added_to_trip ? `✅ انضاف طلب ${cust.name} للرحلة وترتّبت من جديد` : (r.warning || "✅ انعمل الطلب"));
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  const place = (c) => [c.region_name, c.building_number && `عمارة ${c.building_number}`, c.floor && `ط ${c.floor}`].filter(Boolean).join(" · ");

  return (
    <Sheet open={open} title="طلب جديد للرحلة" onClose={onClose}>
      {error && <div className="error-box">{error}</div>}

      {!cust ? (
        <>
          <input className="no-search" autoFocus value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="اسم الزبون، رقمه، أو المنطقة…" aria-label="ابحث عن زبون" />
          {searching && <p className="text-secondary no-hint">جاري البحث…</p>}
          {!searching && q.trim().length >= 2 && results.length === 0 && <p className="text-secondary no-hint">ما لقيت حدا بهالاسم</p>}
          {q.trim().length < 2 && <p className="text-secondary no-hint">اكتب حرفين على الأقل</p>}
          <div className="no-results">
            {results.map((c) => (
              <button key={c.id} type="button" className="no-row" onClick={() => choose(c)}>
                <span className="no-av" aria-hidden="true">{(c.name || "؟").trim()[0]}</span>
                <span className="no-t">
                  <b>{c.name}</b>
                  <small>{place(c) || "بدون عنوان"}</small>
                </span>
                {c.phone_display && <span className="no-ph tabular-num" dir="ltr">{c.phone_display}</span>}
              </button>
            ))}
          </div>
          <button className="btn-secondary" style={{ marginTop: 12 }} onClick={onClose}>رجوع</button>
        </>
      ) : (
        <>
          <div className="sheet-who">
            <span className="sheet-who-n">{(cust.name || "؟").trim()[0]}</span>
            <span><b>{cust.name}</b><small>{place(cust) || "بدون عنوان"}</small></span>
            <button type="button" className="no-change" onClick={() => { setCust(null); setQty({}); }}>غيّر</button>
          </div>
          {!cust.latitude && <div className="pay-note warn" style={{ marginBottom: 8 }}>ما إله موقع على الخريطة — رح ينحط بآخر الرحلة</div>}
          <div className="ei-list">
            {products.map((p) => (
              <div key={p.id} className={`ei-row${qty[p.id] ? " on" : ""}`}>
                <div className="ei-name">
                  <b>{p.name}</b>
                  <small className="tabular-num">{Number(p.unit_price).toFixed(2)} JD</small>
                </div>
                <div className="ei-step">
                  <button type="button" className="step-btn" onClick={() => change(p.id, -1)} aria-label="أقل">−</button>
                  <span className="tabular-num">{qty[p.id] || 0}</span>
                  <button type="button" className="step-btn plus" onClick={() => change(p.id, 1)} aria-label="أكثر">+</button>
                </div>
              </div>
            ))}
          </div>
          <div className="ei-total">
            <span>المجموع</span>
            <b className="tabular-num">{total.toFixed(2)} JD</b>
          </div>
          <div className="sheet-actions">
            <button className="btn-primary" disabled={!hasAny || saving} onClick={save}>{saving ? "جاري الإضافة…" : "أكّد وضيفه للرحلة"}</button>
            <button className="btn-secondary" disabled={saving} onClick={() => { setCust(null); setQty({}); }}>رجوع</button>
          </div>
        </>
      )}
    </Sheet>
  );
}
