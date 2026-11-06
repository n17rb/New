import { useEffect, useState } from "react";
import { api } from "../api.js";
import Sheet from "../components/Sheet.jsx";

// تصفير بيانات التدريب — بتبيّن بس إذا إدارة موج فتحت الميزة للمحل
export default function DataReset() {
  const [sum, setSum] = useState(null);
  const [error, setError] = useState("");
  const [scope, setScope] = useState(null); // "moves" | "all"
  const [word, setWord] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");

  const load = () => api.resetSummary().then(setSum).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  async function go() {
    setBusy(true);
    setError("");
    try {
      await api.resetData({ scope, confirm: word });
      setDone(scope === "all" ? "✅ انمسح كل شي — النظام صار جديد ونظيف" : "✅ انمسحت كل الحركات — الزباين والمنتجات ضلّوا");
      setScope(null);
      setWord("");
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const ok = ["صفّر", "صفر"].includes(word.trim());

  return (
    <div className="page">
      <h1 className="title-lg" style={{ margin: "0 0 4px" }}>تصفير البيانات</h1>
      <p className="text-secondary" style={{ margin: "0 0 14px", fontSize: "0.88rem" }}>
        لما تخلص تدريب وبدك تبلّش شغل حقيقي: امسح البيانات التجريبية والغلطات. قبل المسح بتنعمل نسخة احتياطية لحالها.
      </p>

      {done && <div className="success-box">{done}</div>}
      {error && !scope && <div className="error-box">{error}</div>}

      {sum && (
        <div className="card" style={{ display: "flex", justifyContent: "space-around", textAlign: "center", padding: "14px 8px" }}>
          <div><b className="tabular-num" style={{ fontSize: "1.2rem" }}>{sum.orders}</b><div className="text-secondary" style={{ fontSize: "0.78rem" }}>طلب</div></div>
          <div><b className="tabular-num" style={{ fontSize: "1.2rem" }}>{sum.trips}</b><div className="text-secondary" style={{ fontSize: "0.78rem" }}>رحلة</div></div>
          <div><b className="tabular-num" style={{ fontSize: "1.2rem" }}>{sum.customers}</b><div className="text-secondary" style={{ fontSize: "0.78rem" }}>زبون</div></div>
        </div>
      )}

      <button type="button" className="card" style={{ width: "100%", textAlign: "right", cursor: "pointer", border: "1px solid var(--border)" }} onClick={() => { setScope("moves"); setWord(""); setError(""); }}>
        <div style={{ fontWeight: 800, marginBottom: 4 }}>🧹 امسح الحركات بس</div>
        <div className="text-secondary" style={{ fontSize: "0.84rem", lineHeight: 1.6 }}>
          الطلبات، الرحلات، الحساب اليومي، الجرد، الديون، الكوبونات، المخزون والإشعارات.
          <br />بيضلّوا: <b>الزباين</b>، المنتجات والأسعار، الحسابات والصلاحيات، الإعدادات.
        </div>
      </button>

      <button type="button" className="card" style={{ width: "100%", textAlign: "right", cursor: "pointer", border: "1px solid var(--urgent)" }} onClick={() => { setScope("all"); setWord(""); setError(""); }}>
        <div style={{ fontWeight: 800, marginBottom: 4, color: "var(--urgent)" }}>🗑️ امسح كل شي مع الزباين</div>
        <div className="text-secondary" style={{ fontSize: "0.84rem", lineHeight: 1.6 }}>
          نفس اللي فوق + كل الزباين وعناوينهم.
          <br />بيضلّوا: المنتجات والأسعار، الحسابات والصلاحيات، الإعدادات.
        </div>
      </button>

      {sum?.last_reset_at && (
        <p className="text-secondary" style={{ fontSize: "0.78rem", textAlign: "center" }}>
          آخر تصفير: {new Date(sum.last_reset_at).toLocaleString("ar-JO", { day: "numeric", month: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}
        </p>
      )}

      <Sheet open={!!scope} title={scope === "all" ? "مسح كل شي مع الزباين؟" : "مسح كل الحركات؟"} onClose={() => !busy && setScope(null)}>
        {error && <div className="error-box">{error}</div>}
        <p style={{ margin: "0 0 10px", lineHeight: 1.7 }}>
          {scope === "all" ? "رح ينمسح كل شي حتى الزباين. " : "رح تنمسح كل الطلبات والرحلات والحسابات. "}
          <b>ما في رجعة</b> من هون (إلا من النسخة الاحتياطية).
        </p>
        <label className="pr-field">
          <span>للتأكيد اكتب: <b>صفّر</b></span>
          <input className="no-search" value={word} onChange={(e) => setWord(e.target.value)} placeholder="صفّر" autoFocus />
        </label>
        <div className="sheet-actions">
          <button className="btn-primary" style={{ background: "var(--urgent)" }} disabled={!ok || busy} onClick={go}>{busy ? "جاري المسح…" : "امسح"}</button>
          <button className="btn-secondary" disabled={busy} onClick={() => setScope(null)}>رجوع</button>
        </div>
      </Sheet>
    </div>
  );
}
