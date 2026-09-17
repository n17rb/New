import { useEffect, useState } from "react";
import { api } from "../api.js";

const ACTION_LABELS = {
  CREATE_ORDER: "إنشاء طلب",
  DELIVER_ORDER: "تسليم طلب",
  UNDO_DELIVER_ORDER: "تراجع عن تسليم",
  CANCEL_ORDER: "إلغاء طلب",
  FAIL_DELIVERY: "تعذر تسليم",
  POSTPONE_ORDER: "تأجيل طلب",
  APPLY_DISCOUNT: "خصم",
  CREATE_CUSTOMER: "إضافة عميل",
  UPDATE_CUSTOMER: "تعديل عميل",
  ARCHIVE_CUSTOMER: "حذف عميل",
  CREATE_TRIP: "إنشاء رحلة",
  CREATE_USER: "إضافة مستخدم",
  UPDATE_USER: "تعديل مستخدم",
  DELETE_USER: "حذف مستخدم",
  UPDATE_PRODUCT: "تعديل منتج",
  SETTLE_DRIVER: "تسوية سائق",
  SET_CUSTOMER_PRICE: "تحديد سعر خاص",
};

export default function ActivityLog() {
  const [logs, setLogs] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.getActivityLog().then(setLogs).catch((err) => setError(err.message));
  }, []);

  return (
    <div className="page">
      <h1 className="title-lg">سجل النشاطات</h1>
      {error && <div className="error-box">{error}</div>}

      <div className="card" style={{ padding: 0 }}>
        {!logs && <p className="text-secondary" style={{ padding: 14 }}>جاري التحميل...</p>}
        {logs && logs.length === 0 && <p className="text-secondary" style={{ padding: 14 }}>لا يوجد سجلات بعد.</p>}
        {logs && logs.map((log) => (
          <div key={log.id} style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)" }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontWeight: 600 }}>{ACTION_LABELS[log.action] || log.action}</span>
              <span className="text-secondary tabular-num" style={{ fontSize: "0.75rem" }}>
                {new Date(log.created_at).toLocaleString("ar-JO", { timeZone: "Asia/Amman", dateStyle: "short", timeStyle: "short" })}
              </span>
            </div>
            <div className="text-secondary" style={{ fontSize: "0.85rem" }}>
              {log.user_name || "النظام"} · {log.record_type} #{log.record_id || "-"}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
