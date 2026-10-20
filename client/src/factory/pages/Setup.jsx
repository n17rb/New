import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { FiCheck } from "react-icons/fi";
import { fapi } from "../fapi.js";
import { useFx, Act } from "../ui.jsx";
import { Brand, Products, Vehicles, Lines } from "./Settings.jsx";

// ============================================================
// معالج البداية: المالك بيجهّز مصنعه لحاله خطوة بخطوة
// ============================================================
export default function Setup() {
  const fx = useFx();
  const nav = useNavigate();
  const c = fx.boot.counts;
  const steps = [
    { key: "brand", title: "هوية المصنع", hint: "الاسم والشعار والرقم — بيطلعوا على الفواتير ورسائل الزباين.", done: !!fx.boot.brand.logo, body: <Brand compact /> },
    { key: "products", title: "المنتجات", hint: "شو بتنتجوا: كل منتج وسعر الكرتونة.", done: c.products > 0, body: <Products /> },
    { key: "staff", title: "حسابات الموظفين", hint: "السائقين، مسؤول الحركة، أمين المستودع، المحاسب. كل واحد بيدخل بحسابه وبيشوف شغله بس.", done: c.staff > 0, body: <Staff /> },
    { key: "vehicles", title: "السيارات", hint: "كل سيارة وحمولتها وسائقها ومحافظتها.", done: c.vehicles > 0, body: <Vehicles /> },
    { key: "lines", title: "الخطوط", hint: "قسّم المحافظات لخطوط، وكل خط لسيارة. (بتقدر تتخطاها هلأ)", done: c.lines > 0, body: <Lines /> },
    { key: "customers", title: "الزباين", hint: "ضيفهم واحد واحد، أو الصق قائمتهم من إكسل مرة وحدة.", done: c.customers > 0, body: <Import /> },
  ];
  const firstOpen = steps.findIndex((s) => !s.done);
  const [i, setI] = useState(firstOpen === -1 ? steps.length - 1 : firstOpen);
  const doneCount = steps.filter((s) => s.done).length;
  const s = steps[i];
  return (
    <div className="fx-page">
      <h1 className="fx-h1">تجهيز المصنع</h1>
      <p className="fx-sub">{doneCount} من {steps.length} خطوات خلصت. كل خطوة دقيقتين.</p>
      <div className="fx-bar navy"><i style={{ width: `${(doneCount / steps.length) * 100}%` }} /></div>
      <div className="fx-hscroll">
        {steps.map((x, j) => (
          <button key={x.key} className={`fx-pick ${j === i ? "on" : ""}`} onClick={() => setI(j)} style={{ minWidth: 0 }}>
            <b>{x.done ? <FiCheck style={{ color: "var(--fx-ok)", verticalAlign: "middle" }} /> : `${j + 1}.`} {x.title}</b>
          </button>
        ))}
      </div>
      <div className="fx-card soft"><b>{i + 1}. {s.title}</b><br /><span>{s.hint}</span></div>
      {s.body}
      <div className="fx-row" style={{ justifyContent: "space-between" }}>
        <button className="fx-btn" disabled={i === 0} onClick={() => setI(i - 1)}>السابق</button>
        {i < steps.length - 1 ? (
          <button className="fx-btn pri" onClick={() => setI(i + 1)}>التالي</button>
        ) : (
          <Act className="fx-btn pri" onClick={async () => { await fapi.saveSettings({ setup_done: true }); await fx.reloadBoot(); fx.toast("المصنع جاهز! بلّشوا شغل."); nav("/"); }}>خلصت</Act>
        )}
      </div>
    </div>
  );
}

function Staff() {
  const nav = useNavigate();
  const fx = useFx();
  return (
    <div className="fx-stack">
      <div className="fx-card">
        <div className="fx-kv"><span>سائق</span><b>رحلته، التسليم، المصاريف</b></div>
        <div className="fx-kv"><span>مسؤول الحركة</span><b>الطلبات وتوزيعها والرسائل</b></div>
        <div className="fx-kv"><span>أمين مستودع</span><b>التحميل والمرتجع والجرد</b></div>
        <div className="fx-kv"><span>مشرف إنتاج</span><b>الإنتاج والمكنات</b></div>
        <div className="fx-kv"><span>محاسب</span><b>الكاش والديون والرواتب</b></div>
      </div>
      <p className="fx-muted" style={{ margin: 0 }}>إلك هلأ {fx.boot.counts.staff} حساب موظف. بعد ما تعمل الحساب، ابعت للموظف اسم المستخدم وكلمة السر على واتساب.</p>
      <button className="fx-btn pri" onClick={() => nav("/users")}>افتح حسابات الموظفين</button>
    </div>
  );
}

// لصق قائمة زباين من إكسل: كل سطر «الاسم، التلفون، المدينة»
function Import() {
  const fx = useFx();
  const nav = useNavigate();
  const [text, setText] = useState("");
  const rows = text.split("\n").map((l) => l.split(/\t|,|،/).map((x) => x.trim())).filter((r) => r[0]);
  return (
    <div className="fx-stack">
      <button className="fx-btn" onClick={() => nav("/f/customers")}>ضيف زبون واحد</button>
      <label className="fx-field">أو الصق القائمة هون (كل سطر: الاسم، التلفون، المدينة)
        <textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder={"بقالة الأمل، 0791234567، إربد\nسوبرماركت النور، 0787654321، الرمثا"} />
      </label>
      {rows.length > 0 && <p className="fx-muted" style={{ margin: 0 }}>رح ينضاف {rows.length} زبون.</p>}
      <Act className="fx-btn pri" disabled={!rows.length} onClick={async () => {
        let ok = 0;
        for (const [name, phone, city] of rows) {
          try { await fapi.saveCustomer({ name, phone, city, pay_terms: "credit" }); ok++; } catch { /* نكمل */ }
        }
        setText("");
        await fx.reloadBoot();
        fx.toast(`انضاف ${ok} زبون`);
      }}>ضيف الزباين</Act>
    </div>
  );
}
