import { useEffect, useState } from "react";
import { api } from "../api.js";

export default function Backup() {
  const [latest, setLatest] = useState(null);
  const [history, setHistory] = useState(null);
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    api.getBackupLatest().then(setLatest).catch(() => {});
    api.getBackupHistory().then(setHistory).catch((err) => setError(err.message));
  }, []);

  async function handleExportNow() {
    setDownloading(true);
    setError("");
    try {
      await api.downloadBackup();
    } catch (err) {
      setError(err.message);
    } finally {
      setDownloading(false);
    }
  }

  async function handleDownloadSnapshot(id) {
    setError("");
    try {
      await api.downloadBackupSnapshot(id);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="page">
      <h1 className="title-lg">النسخ الاحتياطية</h1>
      {error && <div className="error-box">{error}</div>}

      <div className="card">
        <p className="text-secondary">
          السيرفر ياخذ نسخة تلقائية كاملة كل ٢٤ ساعة (يحتفظ بآخر ١٤ نسخة). تقدر كمان تصدّر نسخة فورية دايمًا.
        </p>
        {latest && (
          <p className="text-secondary tabular-num">
            آخر نسخة تلقائية: {new Date(latest.created_at).toLocaleString("ar-JO", { timeZone: "Asia/Amman", dateStyle: "medium", timeStyle: "short" })}
          </p>
        )}
        <button className="btn-primary" disabled={downloading} onClick={handleExportNow}>
          {downloading ? "جاري التصدير..." : "⬇️ تصدير نسخة فورية الآن"}
        </button>
      </div>

      <div className="card">
        <h2 className="title-md">النسخ التلقائية السابقة</h2>
        {!history && <p className="text-secondary">جاري التحميل...</p>}
        {history && history.length === 0 && <p className="text-secondary">لا يوجد نسخ بعد.</p>}
        {history && history.map((h) => (
          <div key={h.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
            <span className="text-secondary tabular-num">
              {new Date(h.created_at).toLocaleString("ar-JO", { timeZone: "Asia/Amman", dateStyle: "medium", timeStyle: "short" })}
            </span>
            <button className="btn-secondary" style={{ width: "auto", padding: "6px 14px" }} onClick={() => handleDownloadSnapshot(h.id)}>
              تنزيل
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
