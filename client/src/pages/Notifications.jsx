import { useEffect, useState } from "react";
import { api } from "../api.js";
import { FiBell } from "react-icons/fi";

function getPermission() {
  if (!("Notification" in window)) return "unsupported";
  return Notification.permission;
}

export default function Notifications() {
  const [notifications, setNotifications] = useState(null);
  const [error, setError] = useState("");
  const [permission, setPermission] = useState(getPermission());

  useEffect(() => {
    api.getNotifications()
      .then((list) => {
        setNotifications(list);
        return api.markNotificationsRead();
      })
      .catch((err) => setError(err.message));
  }, []);

  async function enableDeviceNotifications() {
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result === "granted") {
        const reg = await navigator.serviceWorker?.ready;
        const options = { body: "تمام — رح توصلك الإشعارات على هذا الجهاز.", icon: "/icon.svg", dir: "rtl", lang: "ar" };
        if (reg) reg.showNotification("جوهرة الرابية", options);
        else new Notification("جوهرة الرابية", options);
      }
    } catch {
      setPermission(getPermission());
    }
  }

  return (
    <div className="page">
      <h1 className="title-lg">الإشعارات</h1>
      <p className="text-secondary" style={{ marginBottom: 14 }}>تُحفظ الإشعارات هنا لمدة ٤٨ ساعة ثم تُحذف تلقائيًا.</p>
      {error && <div className="error-box">{error}</div>}

      {permission === "default" && (
        <div className="card">
          <p style={{ marginTop: 0 }}>فعّل إشعارات الجهاز عشان يطلعلك تنبيه على الشاشة لما ينضاف طلب على رحلة.</p>
          <button className="btn-primary" onClick={enableDeviceNotifications} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
            <FiBell /> تفعيل إشعارات الجهاز
          </button>
        </div>
      )}
      {permission === "denied" && (
        <div className="card text-secondary" style={{ fontSize: "0.85rem" }}>
          إشعارات الجهاز مقفولة لهذا الموقع. لتفعيلها افتح إعدادات المتصفح ← إعدادات الموقع ← الإشعارات، واسمح لها.
        </div>
      )}

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
