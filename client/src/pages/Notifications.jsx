import { useEffect, useState } from "react";
import { api } from "../api.js";
import { FiBell, FiCheckCircle, FiSend } from "react-icons/fi";
import { enablePush, isPushSupported, isIOS, isStandalone, isCurrentDeviceSubscribed } from "../push.js";

function getPermission() {
  if (!("Notification" in window)) return "unsupported";
  return Notification.permission;
}

function DevicePushCard() {
  const [permission, setPermission] = useState(getPermission());
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    isCurrentDeviceSubscribed().then(setSubscribed);
  }, []);

  async function handleEnable() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await enablePush();
      setSubscribed(true);
      setMessage("تم التفعيل ✓ — رح توصلك الإشعارات حتى لو التطبيق مسكّر.");
    } catch (err) {
      setError(err.message);
    } finally {
      setPermission(getPermission());
      setBusy(false);
    }
  }

  async function handleTest() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api.testPush();
      setMessage("انبعث إشعار تجربة — سكّر التطبيق وشوف إذا وصل.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  // آيفون: الإشعارات بتشتغل بس لما التطبيق يكون مضاف للشاشة الرئيسية
  if (isIOS() && !isStandalone()) {
    return (
      <div className="card">
        <h2 className="title-md" style={{ marginTop: 0 }}>إشعارات الجهاز (آيفون)</h2>
        <p style={{ marginTop: 0, fontSize: "0.9rem" }}>
          عشان توصلك الإشعارات على الآيفون لازم تضيف التطبيق للشاشة الرئيسية أول:
        </p>
        <ol style={{ paddingInlineStart: 20, fontSize: "0.9rem", lineHeight: 1.8, margin: 0 }}>
          <li>افتح الموقع من متصفح Safari</li>
          <li>اكبس زر المشاركة (المربع اللي فيه سهم لفوق)</li>
          <li>اختار «إضافة إلى الشاشة الرئيسية»</li>
          <li>افتح التطبيق من الأيقونة الجديدة وارجع لهاي الصفحة</li>
        </ol>
      </div>
    );
  }

  if (!isPushSupported()) {
    return (
      <div className="card text-secondary" style={{ fontSize: "0.85rem" }}>
        هذا المتصفح ما بيدعم إشعارات الجهاز. جرّب تفتح التطبيق من Chrome على أندرويد أو من الشاشة الرئيسية على الآيفون.
      </div>
    );
  }

  if (permission === "denied") {
    return (
      <div className="card text-secondary" style={{ fontSize: "0.85rem" }}>
        إشعارات الجهاز مقفولة لهذا التطبيق. افتح إعدادات المتصفح ← إعدادات المواقع ← الإشعارات، واسمح لها، وبعدين ارجع لهاي الصفحة.
      </div>
    );
  }

  return (
    <div className="card">
      {subscribed ? (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--success)", fontWeight: 700, marginBottom: 10 }}>
            <FiCheckCircle /> إشعارات الجهاز مفعّلة على هذا الموبايل
          </div>
          <button className="btn-secondary" disabled={busy} onClick={handleTest} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
            <FiSend /> ابعث إشعار تجربة
          </button>
        </>
      ) : (
        <>
          <p style={{ marginTop: 0 }}>فعّل إشعارات الجهاز عشان يطلعلك تنبيه زي الواتساب لما ينضاف طلب على رحلة — حتى لو التطبيق مسكّر.</p>
          <button className="btn-primary" disabled={busy} onClick={handleEnable} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
            <FiBell /> {busy ? "جاري التفعيل..." : "تفعيل إشعارات الجهاز"}
          </button>
        </>
      )}
      {message && <div style={{ color: "var(--success)", marginTop: 10, fontSize: "0.9rem" }}>{message}</div>}
      {error && <div className="error-box" style={{ marginTop: 10, marginBottom: 0 }}>{error}</div>}
    </div>
  );
}

export default function Notifications() {
  const [notifications, setNotifications] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.getNotifications()
      .then((list) => {
        setNotifications(list);
        return api.markNotificationsRead();
      })
      .catch((err) => setError(err.message));
  }, []);

  return (
    <div className="page">
      <h1 className="title-lg">الإشعارات</h1>
      <p className="text-secondary" style={{ marginBottom: 14 }}>تُحفظ الإشعارات هنا لمدة ٤٨ ساعة ثم تُحذف تلقائيًا.</p>
      {error && <div className="error-box">{error}</div>}

      <DevicePushCard />

      <div className="card" style={{ padding: 0 }}>
        {!notifications && <p className="text-secondary" style={{ padding: 14 }}>جاري التحميل...</p>}
        {notifications && notifications.length === 0 && (
          <p className="text-secondary" style={{ padding: 14 }}>لا يوجد إشعارات خلال آخر ٤٨ ساعة.</p>
        )}
        {notifications && notifications.map((n) => (
          <div key={n.id} style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)", fontWeight: n.is_read ? 400 : 700 }}>
            <div>{n.message}</div>
            <div className="text-secondary tabular-num" style={{ fontSize: "0.75rem", marginTop: 4, fontWeight: 400 }}>
              {new Date(n.created_at).toLocaleString("ar-JO", { timeZone: "Asia/Amman", dateStyle: "short", timeStyle: "short" })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
