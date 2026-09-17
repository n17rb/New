import { useEffect, useState } from "react";
import { api } from "../api.js";

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

      <div className="card" style={{ padding: 0 }}>
        {!notifications && <p className="text-secondary" style={{ padding: 14 }}>جاري التحميل...</p>}
        {notifications && notifications.length === 0 && (
          <p className="text-secondary" style={{ padding: 14 }}>لا يوجد إشعارات خلال آخر ٤٨ ساعة.</p>
        )}
        {notifications && notifications.map((n) => (
          <div key={n.id} style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)" }}>
            <div>{n.message}</div>
            <div className="text-secondary tabular-num" style={{ fontSize: "0.75rem", marginTop: 4 }}>
              {new Date(n.created_at).toLocaleString("ar-JO", { timeZone: "Asia/Amman", dateStyle: "short", timeStyle: "short" })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
