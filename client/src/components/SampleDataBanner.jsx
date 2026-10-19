import { useEffect, useState } from "react";
import { FiTrash2 } from "react-icons/fi";
import { api } from "../api.js";

const zb = (n) => (n === 1 ? "زبون تجريبي واحد" : n === 2 ? "زبونين تجريبيين" : n <= 10 ? `${n} زباين تجريبيين` : `${n} زبون تجريبي`);

// شريط بيظهر لصاحب المحل إذا لسا عنده زباين وهميين من الداتا التجريبية — بيحذفهم هم بس
export default function SampleDataBanner({ onCleared }) {
  const [count, setCount] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");
  const [error, setError] = useState("");

  useEffect(() => { api.getSampleCount().then(setCount).catch(() => {}); }, []);

  if (done) return <div className="success-box">{done}</div>;
  if (!count || (count.customers === 0 && count.employees === 0)) return null;

  async function clear() {
    const ok = window.confirm(
      `رح ينحذف ${zb(count.customers)} مع طلباتهم${count.employees ? `، و${count.employees === 1 ? "موظف تجريبي واحد" : `${count.employees} موظفين تجريبيين`}` : ""}.\n\nالزباين والطلبات اللي ضفتهم إنت ما رح ينلمسوا.\n\nمتأكد؟`
    );
    if (!ok) return;
    setBusy(true);
    setError("");
    try {
      const r = await api.clearSampleData();
      setDone(`انحذف ${zb(r.customers)}${r.orders ? ` و${r.orders} طلب تجريبي` : ""} ✓ — زباينك الحقيقيين زي ما هم.`);
      onCleared?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sample-banner">
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="sample-banner-t">عندك {zb(count.customers)}</div>
        <div className="sample-banner-s">هدول انضافوا للتجربة (مكتوب جنبهم «تجريبي»). احذفهم وبيضلوا زباينك الحقيقيين بس.</div>
        {error && <div style={{ color: "var(--urgent)", fontSize: "0.8rem", marginTop: 4 }}>{error}</div>}
      </div>
      <button className="sample-banner-btn" disabled={busy} onClick={clear}>
        <FiTrash2 /> {busy ? "جاري الحذف…" : "احذف التجريبيين"}
      </button>
    </div>
  );
}
