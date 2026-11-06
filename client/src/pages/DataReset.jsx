import { useEffect, useState } from "react";
import { api } from "../api.js";
import Sheet from "../components/Sheet.jsx";

// تصفير الغلطات بعد التدريب — بتبيّن بس إذا إدارة موج فتحت الميزة للمحل
// بتختار اليوم ← النوع ← بتعلّم على الغلطات بس وبتمسحها (الباقي ما بينلمس)
const KINDS = [
  { key: "rounds", title: "تحميل السيارات", hint: "جولة كاملة: التحميل والمرتجع بيرجعوا للمخزون" },
  { key: "cash", title: "الحساب اليومي", hint: "مبيعات وصرفيات يوم" },
  { key: "drivers", title: "ذمم الكباتن", hint: "مستحق رحلة أو قبض" },
  { key: "sales", title: "بيعات الكاشير", hint: "البيعة وحركة مخزونها" },
  { key: "shifts", title: "ورديات المحطة", hint: "الوردية ومصاريفها" },
  { key: "expenses", title: "مصاريف", hint: "مصروف وردية أو جولة" },
  { key: "custody", title: "العهدة", hint: "بترجع للقيمة اللي قبل" },
  { key: "payroll", title: "الرواتب والسحوبات", hint: "سحبة، خصم، مكافأة" },
  { key: "orders", title: "الطلبات", hint: "الديون والكوبونات بيضلّوا" },
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
const when = (at) => {
  if (!at) return "";
  const d = new Date(at);
  const p = new Intl.DateTimeFormat("ar-JO", { timeZone: "Asia/Amman", day: "numeric", month: "numeric", hour: "numeric", minute: "2-digit" }).format(d);
  return p;
};

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
  const [oneDay, setOneDay] = useState(true);
  const [from, setFrom] = useState(todayParts);
  const [to, setTo] = useState(todayParts);
  const [kind, setKind] = useState(null);
  const [rows, setRows] = useState(null);
  const [picked, setPicked] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [asking, setAsking] = useState(false);
  const [word, setWord] = useState("");
  const [busy, setBusy] = useState(false);

  const fromIso = toIso(from);
  const toIsoV = oneDay ? fromIso : toIso(to);
  const rangeBad = !fromIso || !toIsoV || fromIso > toIsoV;
  const rangeText = rangeBad ? "" : fromIso === toIsoV ? `يوم ${arDate(fromIso)}` : `من ${arDate(fromIso)} لـ ${arDate(toIsoV)}`;
  const k = KINDS.find((x) => x.key === kind);

  function load() {
    if (!kind || rangeBad) { setRows(null); return; }
    setLoading(true);
    setError("");
    setPicked({});
    api.resetItems(kind, fromIso, toIsoV)
      .then(setRows)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }
  useEffect(load, [kind, fromIso, toIsoV]); // eslint-disable-line react-hooks/exhaustive-deps

  const ids = Object.keys(picked).filter((id) => picked[id]).map(Number);
  const allOn = rows && rows.length > 0 && ids.length === rows.length;

  async function go() {
    setBusy(true);
    setError("");
    try {
      await api.resetDeleteItems({ kind, ids, confirm: word });
      setDone(`✅ انمسح ${ids.length} من «${k.title}» (${rangeText})`);
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
      <h1 className="title-lg" style={{ margin: "0 0 4px" }}>تصفير الغلطات</h1>
      <p className="text-secondary" style={{ margin: "0 0 14px", fontSize: "0.88rem" }}>
        اختار اليوم، وبعدين شو اللي صار فيه غلط، وعلّم عليه بس. الباقي ما بينلمس. قبل المسح بتنعمل نسخة احتياطية لحالها.
      </p>

      {done && <div className="success-box">{done}</div>}

      <div className="section-title">١. أي يوم؟</div>
      <div className="card">
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <button type="button" className={oneDay ? "btn-primary" : "btn-secondary"} style={{ flex: 1 }} onClick={() => setOneDay(true)}>يوم واحد</button>
          <button type="button" className={!oneDay ? "btn-primary" : "btn-secondary"} style={{ flex: 1 }} onClick={() => setOneDay(false)}>من يوم لـ يوم</button>
        </div>
        <DayFields label={oneDay ? "اليوم" : "من"} v={from} onChange={setFrom} />
        {!oneDay && <DayFields label="لـ" v={to} onChange={setTo} />}
        {rangeBad && <div className="pay-note warn">التاريخ مش مزبوط</div>}
      </div>

      <div className="section-title">٢. شو اللي فيه غلط؟</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {KINDS.map((x) => (
          <button key={x.key} type="button" onClick={() => setKind(x.key)}
            style={{ textAlign: "right", padding: "10px 12px", borderRadius: 14, cursor: "pointer", font: "inherit", color: "var(--text)",
              border: kind === x.key ? "2px solid var(--primary)" : "1px solid var(--border)",
              background: kind === x.key ? "var(--primary-soft)" : "var(--surface)" }}>
            <b style={{ display: "block", fontSize: "0.9rem" }}>{x.title}</b>
            <small className="text-secondary" style={{ fontSize: "0.74rem" }}>{x.hint}</small>
          </button>
        ))}
      </div>

      {k && !rangeBad && (
        <>
          <div className="section-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>٣. علّم على الغلط — {k.title}</span>
            {rows && rows.length > 0 && (
              <button type="button" className="link-btn" onClick={() => setPicked(allOn ? {} : Object.fromEntries(rows.map((r) => [r.id, true])))}>
                {allOn ? "شيل الكل" : "علّم الكل"}
              </button>
            )}
          </div>
          {error && !asking && <div className="error-box">{error}</div>}
          {loading && <p className="text-secondary">جاري التحميل…</p>}
          {rows && !loading && rows.length === 0 && (
            <div className="card text-secondary" style={{ textAlign: "center" }}>ما في إشي بـ{rangeText}</div>
          )}
          {rows && !loading && rows.length > 0 && (
            <div className="list-group">
              {rows.map((r) => (
                <label key={r.id} className="list-row" style={{ cursor: "pointer", background: picked[r.id] ? "var(--urgent-soft)" : undefined }}>
                  <input type="checkbox" checked={!!picked[r.id]} onChange={(e) => setPicked((p) => ({ ...p, [r.id]: e.target.checked }))} style={{ width: 20, height: 20, flexShrink: 0 }} />
                  <span className="list-text">
                    <span className="list-title">{r.title}</span>
                    <div className="list-sub">{[r.sub, when(r.at)].filter(Boolean).join(" · ")}</div>
                  </span>
                  {r.amount != null && <b className="tabular-num" style={{ flexShrink: 0 }}>{Number(r.amount).toFixed(2)}</b>}
                </label>
              ))}
            </div>
          )}
          {ids.length > 0 && (
            <button className="btn-primary" style={{ marginTop: 12, background: "var(--urgent)" }} onClick={() => { setAsking(true); setWord(""); setError(""); }}>
              امسح المعلَّم ({ids.length})
            </button>
          )}
        </>
      )}

      <div className="card" style={{ marginTop: 14, background: "var(--success-soft)", border: "none" }}>
        <div style={{ fontWeight: 800, color: "var(--success)", marginBottom: 4 }}>🔒 هدول ما بينمسحوا أبدًا</div>
        <div style={{ fontSize: "0.85rem", lineHeight: 1.7 }}>
          الزباين وعناوينهم · <b>الديون</b> · <b>رصيد الكوبونات</b> · القوارير اللي عند الزباين · المنتجات والأسعار · الحسابات والصلاحيات
        </div>
      </div>

      <Sheet open={asking} title="متأكد؟" onClose={() => !busy && setAsking(false)}>
        {error && <div className="error-box">{error}</div>}
        <p style={{ margin: "0 0 10px", lineHeight: 1.7 }}>
          رح ينمسح <b>{ids.length}</b> من «{k?.title}» ({rangeText}). الباقي بيضل زي ما هو.
        </p>
        <label className="pr-field">
          <span>للتأكيد اكتب: <b>امسح</b></span>
          <input className="no-search" value={word} onChange={(e) => setWord(e.target.value)} placeholder="امسح" autoFocus />
        </label>
        <div className="sheet-actions">
          <button className="btn-primary" style={{ background: "var(--urgent)" }} disabled={word.trim() !== "امسح" || busy} onClick={go}>{busy ? "جاري المسح…" : "امسح"}</button>
          <button className="btn-secondary" disabled={busy} onClick={() => setAsking(false)}>رجوع</button>
        </div>
      </Sheet>
    </div>
  );
}
