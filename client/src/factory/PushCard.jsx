import { useEffect, useState } from "react";
import { FiBell, FiCheck, FiShare } from "react-icons/fi";
import { enablePush, isPushSupported, isIOS, isStandalone, isCurrentDeviceSubscribed } from "../push.js";
import { request } from "../api.js";

// ============================================================
// «شغّل الإشعارات»: بيطلع لحد ما التلفون يصير يستقبل إشعارات (زي إنستا)
// always = بيضل ظاهر حتى بعد التشغيل (بشاشة المزيد) مع زر «جرّب إشعار»
// ============================================================
export default function PushCard({ always = false, who = "admin" }) {
  const [state, setState] = useState("loading");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function check() {
    if (isIOS() && !isStandalone()) return setState("ios");
    if (!isPushSupported()) return setState("unsupported");
    if (Notification.permission === "denied") return setState("denied");
    setState((await isCurrentDeviceSubscribed()) ? "on" : "off");
  }
  useEffect(() => { check(); }, []);

  async function turnOn() {
    setBusy(true); setMsg("");
    try {
      await enablePush();
      setState("on");
      await test();
    } catch (e) {
      setMsg(e.message);
      check();
    } finally { setBusy(false); }
  }
  async function test() {
    try {
      const r = await request("/factory/push-test", { method: "POST" });
      setMsg(r.available === false ? "السيرفر لسا ما بيبعت إشعارات — حكي الدعم." : "بعتنالك إشعار تجربة. إذا ما وصل خلال ثواني، تأكد إن الإشعارات مسموحة للتطبيق بإعدادات التلفون.");
    } catch (e) { setMsg(e.message); }
  }

  if (state === "loading" || state === "unsupported") return null;
  if (state === "on" && !always) return null;

  const what = who === "driver" ? "الطلبات الجديدة وتغيير الوقفات" : "الطلبات، التسليم، التأخير، وكل تنبيه";
  return (
    <div className={`fx-push ${state}`}>
      <span className="ic">{state === "on" ? <FiCheck /> : <FiBell />}</span>
      <div className="t">
        {state === "on" && <><b>الإشعارات شغالة</b><small>بيوصلك {what} حتى والتطبيق مسكّر.</small></>}
        {state === "off" && <><b>شغّل الإشعارات</b><small>عشان يوصلك {what} على التلفون، حتى والتطبيق مسكّر.</small></>}
        {state === "denied" && <><b>الإشعارات مسكّرة</b><small>افتح إعدادات التلفون ← التطبيقات/المتصفح ← الإشعارات، واسمحلها، وبعدين ارجع هون.</small></>}
        {state === "ios" && <><b>عشان توصلك الإشعارات على الآيفون</b><small>اكبس زر المشاركة <FiShare style={{ verticalAlign: -2 }} /> تحت ← «إضافة إلى الشاشة الرئيسية»، وافتح التطبيق من الأيقونة اللي على الشاشة.</small></>}
        {msg && <small className="m">{msg}</small>}
      </div>
      {state === "off" && <button className="fx-btn pri sm" disabled={busy} onClick={turnOn}>{busy ? "..." : "شغّل"}</button>}
      {state === "on" && always && <button className="fx-btn sm" onClick={test}>جرّب إشعار</button>}
    </div>
  );
}
