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

const pad = (n) => String(n).padStart(2, "0");
function todayParts() {
  const d = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Amman" }));
  return { y: String(d.getFullYear()), m: String(d.getMonth() + 1), d: String(d.getDate()) };
}
const toIso = (v) => {
  const y = Number(v.y), m = Number(v.m), d = Number(v.d);
  if (!(y >= 2020 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
};
const arDate = (iso) => { const [y, m, d] = iso.split("-").map(Number); return `${d}/${m}/${y}`; };

// تاريخ بالأرقام: سنة ← شهر ← يوم
function DayFields({ label, v, onChange }) {
  const box = { width: "100%", textAlign: "center", padding: "10px 4px", borderRadius: 12, border: "1px solid var(--border)", background: "var(--surface-2)", color: "var(--text)", font: "inherit", fontSize: 16 };
  const f = (k, ph, max) => (
    <label style={{ flex: k === "y" ? 1.4 : 1 }}>
      <small className="text-secondary" style={{ display: "block", textAlign: "center", marginBottom: 2 }}>{ph}</small>
      <input type="number" inputMode="numeric" dir="ltr" style={box} value={v[k]} min={1} max={max} onChange={(e) => onChange({ ...v, [k]: e.target.value.slice(0, k === "y" ? 4 : 2) })} />
    </label>
  );
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontWeight: 700, fontSize: "0.88rem", marginBottom: 4 }}>{label}</div>
      <div style={{ display: "flex", gap: 8 }}>{f("y", "سنة", 2100)}{f("m", "شهر", 12)}{f("d", "يوم", 31)}</div>
    </div>
  );
}

export default function DataReset() {
  const [sum, setSum] = useState(null);
  const [error, setError] = useState("");
  const [sel, setSel] = useState(() => Object.fromEntries(PARTS.map((p) => [p.key, p.on])));
  const [asking, setAsking] = useState(false);
  const [word, setWord] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");
  const [allDays, setAllDays] = useState(true);
  const [from, setFrom] = useState(todayParts);
  const [to, setTo] = useState(todayParts);

  const load = () => api.resetSummary().then(setSum).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const chosen = PARTS.filter((p) => sel[p.key]);
  const ok = ["صفّر", "صفر"].includes(word.trim());
  const fromIso = allDays ? null : toIso(from);
  const toIsoV = allDays ? null : toIso(to);
  const rangeBad = !allDays && (!fromIso || !toIsoV || fromIso > toIsoV);
  const rangeText = allDays ? "كل الأيام" : fromIso && toIsoV ? (fromIso === toIsoV ? `يوم ${arDate(fromIso)}` : `من ${arDate(fromIso)} لـ ${arDate(toIsoV)}`) : "";

  async function go() {
    setBusy(true);
    setError("");
    try {
      await api.resetData({ parts: chosen.map((p) => p.key), confirm: word, from: fromIso, to: toIsoV });
      setDone(`✅ تصفّر (${rangeText}): ${chosen.map((p) => p.title).join("، ")}`);
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

      <div className="section-title">أي أيام؟</div>
      <div className="card">
        <div style={{ display: "flex", gap: 8, marginBottom: allDays ? 0 : 12 }}>
          <button type="button" className={allDays ? "btn-primary" : "btn-secondary"} style={{ flex: 1 }} onClick={() => setAllDays(true)}>كل الأيام</button>
          <button type="button" className={!allDays ? "btn-primary" : "btn-secondary"} style={{ flex: 1 }} onClick={() => setAllDays(false)}>يوم أو فترة</button>
        </div>
        {!allDays && (
          <>
            <DayFields label="من" v={from} onChange={setFrom} />
            <DayFields label="لـ" v={to} onChange={setTo} />
            {rangeBad ? (
              <div className="pay-note warn">التاريخ مش مزبوط{fromIso && toIsoV ? " — «من» لازم يكون قبل «لـ»" : ""}</div>
            ) : (
              <div className="text-secondary" style={{ fontSize: "0.84rem", textAlign: "center" }}>رح يتصفّر: <b>{rangeText}</b> — لليوم الواحد خلي «من» و«لـ» نفس التاريخ</div>
            )}
          </>
        )}
      </div>

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

      <button className="btn-primary" style={{ marginTop: 14, background: "var(--urgent)" }} disabled={!chosen.length || rangeBad} onClick={() => { setAsking(true); setWord(""); setError(""); }}>
        صفّر ({chosen.length})
      </button>

      {sum?.last_reset_at && (
        <p className="text-secondary" style={{ fontSize: "0.78rem", textAlign: "center" }}>
          آخر تصفير: {new Date(sum.last_reset_at).toLocaleString("ar-JO", { day: "numeric", month: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}
        </p>
      )}

      <Sheet open={asking} title="متأكد؟" onClose={() => !busy && setAsking(false)}>
        {error && <div className="error-box">{error}</div>}
        <p style={{ margin: "0 0 6px" }}>رح يتصفّر (<b>{rangeText}</b>):</p>
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
