import { useState } from "react";
import { Link } from "react-router-dom";
import { FiPlus, FiClock, FiCheck, FiPause, FiPlay } from "react-icons/fi";
import { FaWhatsapp } from "react-icons/fa";
import { api } from "../api.js";
import { usePerms } from "../auth.jsx";

export function qtyWord(n) {
  n = Math.round(n);
  if (n === 1) return "قارورة";
  if (n === 2) return "قارورتين";
  if (n >= 3 && n <= 10) return `${n} قوارير`;
  return `${n} قارورة`;
}

// قارورة صغيرة بتمتلي حسب اللي ضايل عند الزبون
export function Bottle({ remaining, full, large = false }) {
  const pct = full > 0 ? Math.max(0, Math.min(100, (remaining / full) * 100)) : 0;
  const cls = remaining <= 0 ? "empty" : pct <= 30 ? "low" : "";
  return (
    <span className={`bottle ${cls}${large ? " lg" : ""}`} role="img" aria-label={`ضايل ${Math.round(pct)}٪`}>
      <span className="bottle-fill" style={{ height: `${pct}%` }} />
    </span>
  );
}

function reminderText(f) {
  return `مرحبا ${f.name} 🌊\nمعك مياه جوهرة الرابية.\nحسب حسابنا المي عندك قربت تخلص 💧\nبدك نجيبلك ${f.qty_label} اليوم؟`;
}

function winBackText(f) {
  return `مرحبا ${f.name} 🌊\nمعك مياه جوهرة الرابية — اشتقنالك! 💙\nإذا حابب نجيبلك مي، ابعتلنا رسالة ومنوصلك بأسرع وقت 💧`;
}

export function waLink(phone, text) {
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}

// سطر زبون بقائمة التوقعات: الاسم، كم ضايل عنده، كم بيطلب عادةً، وأزرار سريعة
export function ForecastRow({ f, onChanged, variant = "today" }) {
  const { canEdit } = usePerms();
  const canOrder = canEdit("orders");
  const canAct = canEdit("orders") || canEdit("customers");
  const [mode, setMode] = useState(null); // null | "order"
  const [qty, setQty] = useState(f.qty_typical || 1);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");
  const [error, setError] = useState("");

  const late = variant === "late" || variant === "lost" || variant === "stale";

  async function placeOrder() {
    setBusy(true);
    setError("");
    try {
      await api.createOrder({ customer_id: f.customer_id, items: [{ product_id: f.usual_product_id, quantity: qty }], notes: "💧 من التوقعات" });
      setDone(`انعمل طلب ${qtyWord(qty)} ✓`);
      setMode(null);
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function snooze() {
    setBusy(true);
    setError("");
    try {
      await api.snoozeForecast(f.customer_id, 1);
      setDone("انأجّل لبكرة");
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function stopTracking() {
    if (!confirm(`وقف التوقعات لـ${f.name}؟ (بتقدر ترجعها من صفحته)`)) return;
    setBusy(true);
    try {
      await api.setForecastTracking(f.customer_id, true);
      setDone("وقفت التوقعات لهالزبون");
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const sub = [];
  if (f.region_name) sub.push(f.region_name);
  if (variant === "today" || variant === "tomorrow") sub.push(f.remaining > 0 ? `باقي عنده ${f.remaining_label}` : "خلصت عنده تقريبًا");
  if (late) sub.push(`آخر طلب من ${f.days_since_last} يوم`);
  sub.push(f.interval_label);

  return (
    <div className="fc-row">
      <div className="fc-head">
        <Bottle remaining={f.remaining} full={f.last_qty} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <Link to={`/customers/${f.customer_id}`} className="fc-name">{f.name}</Link>
          <div className="fc-sub">{sub.join(" · ")}</div>
        </div>
        <span className={`fc-qty${late ? " late" : ""}`}>
          {late ? f.due_label : f.qty_label}
        </span>
      </div>

      {error && <div className="error-box" style={{ marginTop: 8, marginBottom: 0 }}>{error}</div>}

      {done ? (
        <div className="fc-done icon-row"><FiCheck aria-hidden="true" /> {done}</div>
      ) : mode === "order" ? (
        <div className="fc-actions">
          <button type="button" className="step-btn" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="نقّص">−</button>
          <span className="tabular-num" style={{ fontWeight: 800, minWidth: 74, textAlign: "center" }}>{qtyWord(qty)}</span>
          <button type="button" className="step-btn plus" onClick={() => setQty((q) => Math.min(50, q + 1))} aria-label="زيد">+</button>
          <button className="fc-btn primary" disabled={busy} onClick={placeOrder}>{busy ? "..." : "تأكيد"}</button>
          <button className="fc-btn quiet" onClick={() => setMode(null)}>إلغاء</button>
        </div>
      ) : (
        <div className="fc-actions">
          {canOrder && f.usual_product_id && variant !== "stale" && (
            <button className="fc-btn primary" onClick={() => setMode("order")}>
              <FiPlus aria-hidden="true" /> اطلب {f.qty_label.split(" أو ")[0]}
            </button>
          )}
          <a className="fc-btn whatsapp" href={waLink(f.phone_normalized, variant === "lost" || variant === "stale" ? winBackText(f) : reminderText(f))} target="_blank" rel="noreferrer">
            <FaWhatsapp aria-hidden="true" /> {variant === "lost" || variant === "stale" ? "اشتقنالك" : "اسأله"}
          </a>
          {canAct && (variant === "lost" || variant === "stale") && (
            <button className="fc-btn quiet" disabled={busy} onClick={stopTracking} aria-label="وقف التوقعات لهالزبون">
              <FiPause aria-hidden="true" />
            </button>
          )}
          {canAct && variant !== "lost" && variant !== "stale" && (
            <button className="fc-btn quiet" disabled={busy} onClick={snooze} title="مش اليوم">
              <FiClock aria-hidden="true" /> مش اليوم
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// كم ضايل بشكل مختصر: 1¼ ، ½ ، 2¾
export function compactBottles(x) {
  const q = Math.round(Math.max(0, x) * 4) / 4;
  const whole = Math.floor(q);
  const frac = { 0.25: "¼", 0.5: "½", 0.75: "¾" }[Math.round((q - whole) * 100) / 100] || "";
  if (!whole && !frac) return "0";
  return `${whole || ""}${frac}`;
}

// بطاقة «المي اللي عنده» بصفحة الزبون
export function CustomerForecastCard({ forecast: f, onReload, onOrder }) {
  const { canEdit } = usePerms();
  const canAct = canEdit("orders") || canEdit("customers");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const customerId = f?.customer_id;
  const load = onReload;

  async function toggleTracking() {
    setBusy(true);
    try {
      await api.setForecastTracking(customerId, f.status !== "disabled");
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function clearSnooze() {
    setBusy(true);
    try {
      await api.unsnoozeForecast(customerId);
      load();
    } finally {
      setBusy(false);
    }
  }

  if (error) return null;
  if (!f) return <div className="card text-secondary" style={{ minHeight: 92 }}>جاري حساب الاستهلاك...</div>;

  if (f.status === "disabled") {
    return (
      <div className="card icon-row" style={{ justifyContent: "space-between" }}>
        <span className="text-secondary">توقعات الطلبات موقّفة لهالزبون</span>
        {canAct && (
          <button className="fc-btn" style={{ flex: "0 0 auto" }} disabled={busy} onClick={toggleTracking}>
            <FiPlay aria-hidden="true" /> شغّلها
          </button>
        )}
      </div>
    );
  }

  if (f.base_status === "learning") {
    return (
      <div className="card">
        <div style={{ fontWeight: 700 }}>💧 المي اللي عنده</div>
        <p className="text-secondary" style={{ margin: "6px 0 0", fontSize: "0.85rem" }}>
          النظام لسا بيتعلم عادة هالزبون — بعد {f.needed_orders === 1 ? "طلب واحد مسلّم كمان" : `${f.needed_orders} طلبات مسلّمة كمان`} بيصير يحسبلك كم ضايل عنده ومتى مفروض يطلب.
        </p>
      </div>
    );
  }

  const late = f.late_days >= 1;
  const statusText = f.status === "ordered"
    ? "عنده طلب مفتوح هلّق"
    : f.status === "snoozed"
      ? `مأجّل لـ${f.snooze_until}`
      : `مفروض يطلب ${f.due_label}`;

  return (
    <div className="card">
      <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
        <Bottle remaining={f.remaining} full={f.last_qty} large />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="text-secondary" style={{ fontSize: "0.78rem" }}>ضايل عنده بالبيت تقريبًا</div>
          <div style={{ fontWeight: 800, fontSize: "1.25rem", color: f.remaining <= 0 ? "var(--urgent)" : undefined }}>
            {f.remaining_label}
          </div>
          <div style={{ fontSize: "0.85rem", fontWeight: 700, color: late ? "var(--urgent)" : f.late_days === 0 ? "var(--warning)" : "var(--text-secondary)" }}>
            {statusText}
          </div>
        </div>
        {onOrder && f.status !== "ordered" && (
          <button className="fc-btn primary" style={{ flex: "0 0 auto" }} onClick={onOrder}>
            <FiPlus aria-hidden="true" /> طلب
          </button>
        )}
      </div>

      <div className="fc-facts">
        <div className="fc-fact">
          <div className="fc-fact-label">بيسحب</div>
          <div className="fc-fact-value">{f.rate_label}</div>
        </div>
        <div className="fc-fact">
          <div className="fc-fact-label">عادةً بيطلب</div>
          <div className="fc-fact-value">{f.qty_label}</div>
        </div>
        <div className="fc-fact">
          <div className="fc-fact-label">بيطلب</div>
          <div className="fc-fact-value">{f.interval_label}</div>
        </div>
        <div className="fc-fact">
          <div className="fc-fact-label">دقة التوقع</div>
          <div className="fc-fact-value">{f.confidence === "high" ? "عالية" : f.confidence === "medium" ? "متوسطة" : "تقريبية"}</div>
        </div>
      </div>

      {canAct && (
        <div style={{ display: "flex", gap: 14, marginTop: 10 }}>
          {f.status === "snoozed" && (
            <button className="btn-danger-text" style={{ color: "var(--primary)", padding: 0, fontSize: "0.8rem" }} disabled={busy} onClick={clearSnooze}>
              إلغاء التأجيل
            </button>
          )}
          <button className="btn-danger-text" style={{ color: "var(--text-secondary)", padding: 0, fontSize: "0.8rem" }} disabled={busy} onClick={toggleTracking}>
            وقف التوقعات لهالزبون
          </button>
        </div>
      )}
    </div>
  );
}
