import { renderMessage } from "../messages.js";
import { useEffect, useState } from "react";
import { FiPlus, FiMinus, FiClock, FiCheck, FiX, FiPackage, FiFileText } from "react-icons/fi";
import { FaWhatsapp } from "react-icons/fa";
import { couponsWord, couponsAddedText } from "./Receipt.jsx";
import BottleCustody from "./BottleCustody.jsx";
import { api } from "../api.js";
import { usePerms } from "../auth.jsx";

const COUPON_REASONS = {
  recharge: "تعبئة مع طلب",
  order_payment: "دفع طلب",
  manual_adjustment: "تعديل يدوي",
  package_purchase: "شراء باقة",
  delivery_undo: "تراجع عن تسليم",
};

const DEBT_REASONS = {
  order_credit: "طلب بالدين",
  payment: "دفعة",
  manual: "تعديل يدوي",
  coupon_package: "باقي ثمن باقة",
  delivery_undo: "تراجع عن تسليم",
};

function shortDate(d) {
  return new Date(d).toLocaleDateString("ar-JO", { timeZone: "Asia/Amman", day: "numeric", month: "short" });
}

const money = (n) => `${Number(n || 0).toFixed(2)} JD`;

// ---------------- محفظة الكوبونات ----------------

function CouponWallet({ customer, onChanged }) {
  const { canEdit, canAction } = usePerms();
  const [history, setHistory] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const [selling, setSelling] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [error, setError] = useState("");
  const [sold, setSold] = useState(null); // بعد بيع باقة: رسالة تأكيد للزبون

  const balance = customer.coupon_balance || 0;
  const low = balance <= 2;

  async function toggleHistory() {
    if (!showHistory && !history) {
      try {
        setHistory(await api.getCouponHistory(customer.id));
      } catch (err) {
        setError(err.message);
        return;
      }
    }
    setShowHistory(!showHistory);
  }

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div className="coupon-wallet">
        <div>
          <div className="coupon-wallet-label">رصيد الكوبونات</div>
          <div className="coupon-wallet-num tabular-num">{balance}</div>
          <div className="coupon-wallet-sub">
            {balance === 0 ? "ما عنده كوبونات" : low ? "قربت تخلص" : "كوبون = قارورة تعبئة"}
          </div>
        </div>
        <svg className="coupon-wallet-mark" viewBox="0 0 48 48" aria-hidden="true">
          <path d="M24 4.5C24 4.5 9.5 19.5 9.5 30.2a14.5 14.5 0 0 0 29 0C38.5 19.5 24 4.5 24 4.5Z" fill="none" stroke="currentColor" strokeWidth="2.5" />
          <path d="M8 32c4-3.4 8-3.4 12 0s8 3.4 12 0 8-3.4 12 0" fill="none" stroke="currentColor" strokeWidth="2.5" />
        </svg>
      </div>

      <div style={{ padding: 14 }}>
        {error && <div className="error-box">{error}</div>}

        {!selling && !adjusting && (
          <div style={{ display: "flex", gap: 8 }}>
            {canEdit("coupons") && (
              <button className="btn-primary icon-row" style={{ justifyContent: "center", flex: 1 }} onClick={() => setSelling(true)}>
                <FiPackage aria-hidden="true" /> بيع باقة
              </button>
            )}
            <button className="btn-secondary icon-row" style={{ justifyContent: "center", flex: 1 }} onClick={toggleHistory}>
              <FiClock aria-hidden="true" /> {showHistory ? "إخفاء السجل" : "السجل"}
            </button>
          </div>
        )}

        {selling && (
          <SellPackage
            customer={customer}
            onCancel={() => setSelling(false)}
            onDone={(info) => { setSelling(false); setHistory(null); setShowHistory(false); setSold({ ...info, newBalance: balance + info.added }); onChanged(); }}
          />
        )}

        {sold && !selling && (
          <div className="success-box" style={{ marginBottom: 10 }}>
            <div style={{ fontWeight: 700 }}>انضاف {sold.added} كوبون ✓</div>
            {sold.waQueued && <div style={{ fontSize: "0.82rem", marginTop: 4 }}>📱 رسالة التأكيد رح تنبعت لحالها من موبايل المحل</div>}
            {!sold.waQueued && <a
              className="icon-row"
              style={{ color: "var(--whatsapp)", fontWeight: 700, marginTop: 6, textDecoration: "none" }}
              href={`https://wa.me/${customer.phone_normalized}?text=${encodeURIComponent(
                couponsAddedText({ name: customer.name, added: sold.added, balance: sold.newBalance, packageName: sold.packageName, unpaid: sold.unpaid, walletToken: sold.walletToken })
              )}`}
              target="_blank"
              rel="noreferrer"
              onClick={() => setSold(null)}
            >
              <FaWhatsapp aria-hidden="true" /> ابعتله تأكيد على واتساب
            </a>}
          </div>
        )}

        {adjusting && (
          <AdjustCoupons
            customer={customer}
            onCancel={() => setAdjusting(false)}
            onDone={() => { setAdjusting(false); setHistory(null); setShowHistory(false); onChanged(); }}
          />
        )}

        {showHistory && history && !selling && (
          <div className="mini-ledger">
            {history.length === 0 && <p className="text-secondary" style={{ margin: "10px 0 0" }}>ما في حركات لسا.</p>}
            {history.map((h) => (
              <div key={h.id} className="mini-ledger-row">
                <span>
                  {COUPON_REASONS[h.reason] || h.reason}
                  {h.notes && <span className="text-secondary"> · {h.notes}</span>}
                  <div className="text-secondary" style={{ fontSize: "0.75rem" }}>{shortDate(h.created_at)}</div>
                </span>
                <span className="tabular-num" style={{ fontWeight: 700, color: h.change_amount >= 0 ? "var(--success)" : "var(--urgent)" }}>
                  {h.change_amount > 0 ? "+" : ""}{h.change_amount}
                  <div className="text-secondary" style={{ fontSize: "0.72rem", fontWeight: 400 }}>صار {h.balance_after}</div>
                </span>
              </div>
            ))}
          </div>
        )}

        {canAction("adjust_coupons") && !selling && !adjusting && (
          <button className="btn-secondary icon-row" style={{ justifyContent: "center", marginTop: 8 }} onClick={() => setAdjusting(true)}>
            ✏️ تعديل الرصيد
          </button>
        )}
      </div>
    </div>
  );
}

function SellPackage({ customer, onCancel, onDone }) {
  const { canAction } = usePerms();
  const [packages, setPackages] = useState(null);
  const [selected, setSelected] = useState(null);
  const [paid, setPaid] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.getCouponPackages().then((list) => {
      setPackages(list);
      if (list.length === 1) choose(list[0]);
    }).catch((err) => setError(err.message));
  }, []);

  function choose(pkg) {
    setSelected(pkg);
    setPaid(String(Number(pkg.price)));
  }

  const price = selected ? Number(selected.price) : 0;
  const paidNum = paid === "" ? 0 : Number(paid);
  const unpaid = Math.max(0, Math.round((price - paidNum) * 100) / 100);

  async function handleSell() {
    setSaving(true);
    setError("");
    try {
      const r = await api.sellCouponPackage({ customer_id: customer.id, package_id: selected.id, paid_amount: paidNum });
      onDone({ added: selected.coupons + (selected.bonus_coupons || 0), unpaid, packageName: selected.name, walletToken: r?.wallet_token || null, waQueued: !!r?.wa_queued });
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  if (!packages) return <p className="text-secondary">جاري التحميل...</p>;

  if (packages.length === 0) {
    return (
      <div>
        <p className="text-secondary" style={{ marginTop: 0 }}>ما في باقات كوبونات لسا. ضيفها من «المزيد» ← «الكوبونات والباقات».</p>
        <button className="btn-secondary" onClick={onCancel}>رجوع</button>
      </div>
    );
  }

  return (
    <div>
      {error && <div className="error-box">{error}</div>}
      <div className="package-grid">
        {packages.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`package-tile${selected?.id === p.id ? " on" : ""}`}
            onClick={() => choose(p)}
            aria-pressed={selected?.id === p.id}
          >
            {p.image_url && <img src={p.image_url} alt="" />}
            <span className="package-name">{p.name}</span>
            <span className="package-count tabular-num">
              {p.coupons}{p.bonus_coupons > 0 && <small> + {p.bonus_coupons} هدية</small>}
            </span>
            <span className="package-price tabular-num">{money(p.price)}</span>
          </button>
        ))}
      </div>

      {selected && (
        <>
          <div className="field" style={{ marginTop: 12 }}>
            <label htmlFor="pkg-paid">المبلغ اللي دفعه</label>
            <input id="pkg-paid" type="number" inputMode="decimal" min="0" step="0.01" value={paid} onChange={(e) => setPaid(e.target.value)} />
          </div>
          {unpaid > 0 && (
            <p style={{ margin: "-6px 0 12px", color: canAction("give_credit") ? "var(--warning)" : "var(--urgent)", fontSize: "0.85rem", fontWeight: 600 }}>
              {canAction("give_credit")
                ? `${money(unpaid)} رح تنضاف دين على الزبون`
                : "ما عندك صلاحية البيع بالدين — لازم يدفع المبلغ كامل"}
            </p>
          )}
          <button
            className="btn-primary icon-row"
            style={{ justifyContent: "center", marginBottom: 8 }}
            disabled={saving || paidNum < 0 || paidNum > price || (unpaid > 0 && !canAction("give_credit"))}
            onClick={handleSell}
          >
            <FiCheck aria-hidden="true" /> {saving ? "جاري الحفظ..." : `أضف ${selected.coupons + selected.bonus_coupons} كوبون`}
          </button>
        </>
      )}
      <button className="btn-secondary" onClick={onCancel}>إلغاء</button>
    </div>
  );
}

function AdjustCoupons({ customer, onCancel, onDone }) {
  const current = Number(customer.coupon_balance || 0);
  const [target, setTarget] = useState(String(current));
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(null); // الرصيد الجديد بعد الحفظ
  const [sent, setSent] = useState("");

  const t = parseInt(target, 10);
  const valid = Number.isInteger(t) && t >= 0;
  const diff = valid ? t - current : 0;

  async function save() {
    if (!valid || diff === 0) return;
    setSaving(true);
    setError("");
    try {
      const r = await api.adjustCouponBalance(customer.id, { change_amount: diff, reason: reason.trim() || null });
      setSaved(r.balance);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function send() {
    setSaving(true);
    setError("");
    try {
      const r = await api.sendCouponBalance(customer.id);
      if (r.queued) {
        setSent("📱 الرسالة بتنبعت لحالها من موبايل المحل خلال ثواني");
      } else {
        window.open(`https://wa.me/${r.phone}?text=${encodeURIComponent(r.text)}`, "_blank", "noopener");
        setSent("✓ انفتح واتساب — اكبس إرسال");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (saved != null) {
    return (
      <div>
        {error && <div className="error-box">{error}</div>}
        <div className="success-box" style={{ marginBottom: 10 }}>
          <div style={{ fontWeight: 700 }}>✅ رصيده صار {couponsWord(saved)}</div>
          {sent && <div style={{ fontSize: "0.85rem", marginTop: 4 }}>{sent}</div>}
        </div>
        {!sent && customer.phone_normalized && (
          <button className="btn-primary icon-row" style={{ justifyContent: "center", marginBottom: 8, background: "var(--whatsapp)" }} disabled={saving} onClick={send}>
            <FaWhatsapp aria-hidden="true" /> ابعتله رصيده الجديد
          </button>
        )}
        <button className="btn-secondary" onClick={onDone}>تم</button>
      </div>
    );
  }

  return (
    <div>
      {error && <div className="error-box">{error}</div>}
      <div className="sheet-q" style={{ marginTop: 0 }}>كم لازم يكون رصيده الصح؟</div>
      <div className="ei-row on" style={{ marginBottom: 6 }}>
        <div className="ei-name"><b>الرصيد</b><small>هلّق {current}</small></div>
        <div className="ei-step">
          <button type="button" className="step-btn" onClick={() => setTarget(String(Math.max(0, (valid ? t : current) - 1)))} aria-label="أقل">−</button>
          <input className="vh-qty tabular-num" inputMode="numeric" value={target} onChange={(e) => setTarget(e.target.value.replace(/\D/g, ""))} aria-label="الرصيد الصح" />
          <button type="button" className="step-btn plus" onClick={() => setTarget(String((valid ? t : current) + 1))} aria-label="أكثر">+</button>
        </div>
      </div>
      {valid && diff !== 0 && (
        <div className={`pay-note${diff < 0 ? " warn" : ""}`} style={{ marginBottom: 8 }}>
          {diff > 0 ? `رح نرجّعله ${couponsWord(diff)}` : `رح ننخصم منه ${couponsWord(-diff)}`} — رصيده بيصير {t}
        </div>
      )}
      <input className="no-search" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="السبب (اختياري) — مثلًا انخصم كوبونين بالغلط" style={{ marginBottom: 10 }} />
      <button className="btn-primary" style={{ marginBottom: 8 }} disabled={saving || !valid || diff === 0} onClick={save}>
        {saving ? "لحظة…" : "احفظ الرصيد"}
      </button>
      <button className="btn-secondary" onClick={onCancel}>إلغاء</button>
    </div>
  );
}

// ---------------- الدين ----------------

function DebtCard({ customer, onChanged }) {
  const { can, canEdit } = usePerms();
  const [history, setHistory] = useState(null);
  const [mode, setMode] = useState(null); // null | "pay" | "adjust"
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const debt = Number(customer.debt_balance || 0);
  const canSeeHistory = can("debts");

  useEffect(() => {
    if (canSeeHistory) api.getCustomerDebt(customer.id).then(setHistory).catch(() => {});
  }, [customer.id, customer.debt_balance]);

  async function save() {
    const n = Number(amount);
    if (!n) return;
    setSaving(true);
    setError("");
    try {
      if (mode === "pay") await api.recordDebtPayment(customer.id, { amount: n, notes });
      else await api.adjustDebt(customer.id, { amount: n, notes });
      setMode(null);
      setAmount("");
      setNotes("");
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div className="text-secondary" style={{ fontSize: "0.8rem" }}>الدين على الزبون</div>
          <div className="tabular-num" style={{ fontSize: "1.6rem", fontWeight: 800, color: debt > 0 ? "var(--urgent)" : "var(--success)" }}>
            {money(debt)}
          </div>
        </div>
        {debt <= 0 && <span className="badge" style={{ background: "var(--success-soft)", color: "var(--success)" }}>ما عليه شي</span>}
      </div>

      {error && <div className="error-box" style={{ marginTop: 10 }}>{error}</div>}

      {canEdit("debts") && !mode && (
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          {debt > 0 && (
            <button className="btn-primary icon-row" style={{ justifyContent: "center", flex: 1 }} onClick={() => { setMode("pay"); setAmount(String(debt)); }}>
              <FiCheck aria-hidden="true" /> سجّل دفعة
            </button>
          )}
          <button className="btn-secondary" style={{ flex: debt > 0 ? "0 0 auto" : 1, width: "auto", padding: "0 14px" }} onClick={() => setMode("adjust")}>
            تعديل
          </button>
        </div>
      )}

      {mode && (
        <div style={{ marginTop: 12 }}>
          <div className="field">
            <label htmlFor="debt-amount">{mode === "pay" ? "المبلغ اللي دفعه" : "المبلغ (موجب = دين جديد، سالب = شطب)"}</label>
            <input id="debt-amount" type="number" inputMode="decimal" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="debt-notes">{mode === "pay" ? "ملاحظة (اختياري)" : "السبب"}</label>
            <input id="debt-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={mode === "pay" ? "مثلاً: دفع بالمحل" : "مثلاً: دين قديم من الدفتر"} />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn-primary" style={{ flex: 1 }} disabled={saving || !amount} onClick={save}>
              {saving ? "جاري الحفظ..." : "حفظ"}
            </button>
            <button className="btn-secondary icon-row" style={{ width: "auto", padding: "0 14px" }} onClick={() => { setMode(null); setError(""); }} aria-label="إلغاء">
              <FiX aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      {canSeeHistory && history && history.length > 0 && (
        <div className="mini-ledger">
          {history.slice(0, 15).map((h) => (
            <div key={h.id} className="mini-ledger-row">
              <span>
                {DEBT_REASONS[h.reason] || h.reason}
                {h.order_number && <span className="text-secondary tabular-num"> · #{h.order_number}</span>}
                {h.notes && <div className="text-secondary" style={{ fontSize: "0.75rem" }}>{h.notes}</div>}
                <div className="text-secondary" style={{ fontSize: "0.75rem" }}>{shortDate(h.created_at)}{h.created_by_name ? ` · ${h.created_by_name}` : ""}</div>
              </span>
              <span className="tabular-num" style={{ fontWeight: 700, color: Number(h.change_amount) > 0 ? "var(--urgent)" : "var(--success)" }}>
                {Number(h.change_amount) > 0 ? "+" : ""}{Number(h.change_amount).toFixed(2)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------- كشف حساب على واتساب ----------------

function buildStatement(customer, orders) {
  const debt = Number(customer.debt_balance || 0);
  const lines = [];
  lines.push(`🎫 رصيد الكوبونات: ${customer.coupon_balance > 0 ? couponsWord(customer.coupon_balance) : "ما في"}`);
  lines.push(debt > 0 ? `💳 المستحق عليك: ${debt.toFixed(2)} دينار` : "✔️ ما عليك أي مبلغ");
  if (customer.bottles_out > 0) lines.push(`🧴 قوارير المحل عندك: ${customer.bottles_out}`);
  const delivered = orders.filter((o) => o.status === "DELIVERED").slice(0, 5);
  if (delivered.length) {
    lines.push("", "آخر الطلبات:");
    for (const o of delivered) {
      const items = (o.items || []).map((i) => `${i.quantity} × ${i.product_name_snapshot}`).join("، ");
      lines.push(`• ${shortDate(o.created_at)} — ${items} — ${Number(o.final_total).toFixed(2)} دينار`);
    }
  }
  return renderMessage("statement", { "الاسم": customer.name, "التفاصيل": lines.join("\n").trim() });
}

function StatementCard({ customer }) {
  const [orders, setOrders] = useState(null);
  useEffect(() => {
    api.getCustomerHistory(customer.id).then((h) => setOrders(h.orders || [])).catch(() => setOrders([]));
  }, [customer.id]);
  const link = orders ? `https://wa.me/${customer.phone_normalized}?text=${encodeURIComponent(buildStatement(customer, orders))}` : null;
  return (
    <a
      className="card icon-row"
      style={{ textDecoration: "none", color: "var(--text)", justifyContent: "space-between", opacity: link ? 1 : 0.6, pointerEvents: link ? "auto" : "none" }}
      href={link || undefined}
      target="_blank"
      rel="noreferrer"
    >
      <span className="icon-row"><FiFileText aria-hidden="true" /> ابعتله كشف حساب</span>
      <FaWhatsapp style={{ color: "var(--whatsapp)" }} size={20} aria-hidden="true" />
    </a>
  );
}

export default function CustomerAccount({ customer, onChanged }) {
  return (
    <>
      <CouponWallet customer={customer} onChanged={onChanged} />
      <DebtCard customer={customer} onChanged={onChanged} />
<BottleCustody customer={customer} onChanged={onChanged} />
      <StatementCard customer={customer} />
    </>
  );
}
