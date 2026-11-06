import { useEffect, useState } from "react";
import { api } from "../api.js";
import Sheet from "../components/Sheet.jsx";

// تصفير الحسابات بعد التدريب — بتبيّن بس إذا إدارة موج فتحت الميزة للمحل
const PARTS = [
  { key: "cash", title: "الحساب اليومي", hint: "المبيعات والصرفيات والأرشيف", on: true },
  { key: "drivers", title: "ذمم الكباتن", hint: "الكاش والحسابات اللي على الكباتن", on: true },
  { key: "station", title: "الكاشير والمحطة", hint: "الورديات، البيعات، الجولات ومصاريفها", on: true },
  { key: "custody", title: "العهدة", hint: "بترجع صفر للكل", on: true },
  { key: "payroll", title: "الدوام والرواتب", hint: "الحضور والسحوبات", on: false },
  { key: "orders", title: "الطلبات والرحلات", hint: "كل الطلبات القديمة وأرشيف الرحلات", on: false },
];

export default function DataReset() {
  const [sum, setSum] = useState(null);
  const [error, setError] = useState("");
  const [sel, setSel] = useState(() => Object.fromEntries(PARTS.map((p) => [p.key, p.on])));
  const [asking, setAsking] = useState(false);
  const [word, setWord] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");

  const load = () => api.resetSummary().then(setSum).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const chosen = PARTS.filter((p) => sel[p.key]);
  const ok = ["صفّر", "صفر"].includes(word.trim());

  async function go() {
    setBusy(true);
    setError("");
    try {
      await api.resetData({ parts: chosen.map((p) => p.key), confirm: word });
      setDone(`✅ تصفّر: ${chosen.map((p) => p.title).join("، ")}`);
      setAsking(false);
      setWord("");
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <h1 className="title-lg" style={{ margin: "0 0 4px" }}>تصفير الحسابات</h1>
      <p className="text-secondary" style={{ margin: "0 0 14px", fontSize: "0.88rem" }}>
        خلصت تدريب؟ صفّر الحسابات وبلّش شغل حقيقي. قبل التصفير بتنعمل نسخة احتياطية لحالها.
      </p>

      {done && <div className="success-box">{done}</div>}
      {error && !asking && <div className="error-box">{error}</div>}

      <div className="section-title">شو بدك تصفّر؟</div>
      <div className="pr-sws">
        {PARTS.map((p) => (
          <button key={p.key} type="button" className={`pr-sw${sel[p.key] ? " on" : ""}`} onClick={() => setSel((s) => ({ ...s, [p.key]: !s[p.key] }))} aria-pressed={!!sel[p.key]}>
            <span className="pr-sw-t">
              <b>{p.title}</b>
              <small>{p.key === "orders" && sum ? `${p.hint} (${sum.orders} طلب)` : p.hint}</small>
            </span>
            <span className="pr-sw-k" aria-hidden="true"><i /></span>
          </button>
        ))}
      </div>

      <div className="card" style={{ marginTop: 12, background: "var(--success-soft)", border: "none" }}>
        <div style={{ fontWeight: 800, color: "var(--success)", marginBottom: 4 }}>🔒 هدول ما بينمسحوا أبدًا</div>
        <div style={{ fontSize: "0.85rem", lineHeight: 1.7 }}>
          الزباين{sum ? ` (${sum.customers})` : ""} وعناوينهم · <b>الديون</b> · <b>رصيد الكوبونات</b> · القوارير اللي عند الزباين · المنتجات والأسعار · الحسابات والصلاحيات · الإعدادات
        </div>
      </div>

      <button className="btn-primary" style={{ marginTop: 14, background: "var(--urgent)" }} disabled={!chosen.length} onClick={() => { setAsking(true); setWord(""); setError(""); }}>
        صفّر ({chosen.length})
      </button>

      {sum?.last_reset_at && (
        <p className="text-secondary" style={{ fontSize: "0.78rem", textAlign: "center" }}>
          آخر تصفير: {new Date(sum.last_reset_at).toLocaleString("ar-JO", { day: "numeric", month: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}
        </p>
      )}

      <Sheet open={asking} title="متأكد؟" onClose={() => !busy && setAsking(false)}>
        {error && <div className="error-box">{error}</div>}
        <p style={{ margin: "0 0 6px" }}>رح يتصفّر:</p>
        <p style={{ margin: "0 0 10px", fontWeight: 700, lineHeight: 1.7 }}>{chosen.map((p) => p.title).join(" · ")}</p>
        <p className="text-secondary" style={{ margin: "0 0 10px", fontSize: "0.85rem" }}>الزباين والديون والكوبونات بيضلّوا زي ما هم.</p>
        <label className="pr-field">
          <span>للتأكيد اكتب: <b>صفّر</b></span>
          <input className="no-search" value={word} onChange={(e) => setWord(e.target.value)} placeholder="صفّر" autoFocus />
        </label>
        <div className="sheet-actions">
          <button className="btn-primary" style={{ background: "var(--urgent)" }} disabled={!ok || busy} onClick={go}>{busy ? "جاري التصفير…" : "صفّر"}</button>
          <button className="btn-secondary" disabled={busy} onClick={() => setAsking(false)}>رجوع</button>
        </div>
      </Sheet>
    </div>
  );
}
