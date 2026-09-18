import { useEffect, useState } from "react";
import { api } from "../api.js";

export default function Notes() {
  const [notes, setNotes] = useState(null);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      setNotes(await api.getMyNotes());
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleAdd() {
    if (!text.trim()) return;
    setSaving(true);
    setError("");
    try {
      await api.addMyNote(text.trim());
      setText("");
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id) {
    try {
      await api.deleteMyNote(id);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="page">
      <h1 className="title-lg">ملاحظاتي</h1>
      <p className="text-secondary" style={{ marginBottom: 14 }}>مساحتك الشخصية — اكتب أي شي بدك تتذكره، ما يشوفها غيرك.</p>
      {error && <div className="error-box">{error}</div>}

      <div className="card">
        <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="اكتب ملاحظة..." />
        <button className="btn-primary" style={{ marginTop: 10 }} disabled={saving || !text.trim()} onClick={handleAdd}>
          {saving ? "جاري الحفظ..." : "+ إضافة ملاحظة"}
        </button>
      </div>

      {!notes && <p className="text-secondary">جاري التحميل...</p>}
      {notes && notes.length === 0 && <p className="text-secondary">لا يوجد ملاحظات بعد.</p>}
      {notes && notes.map((n) => (
        <div key={n.id} className="card">
          <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{n.content}</p>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
            <span className="text-secondary tabular-num" style={{ fontSize: "0.75rem" }}>
              {new Date(n.created_at).toLocaleString("ar-JO", { timeZone: "Asia/Amman", dateStyle: "short", timeStyle: "short" })}
            </span>
            <button className="btn-danger-text" style={{ width: "auto", padding: "4px 10px" }} onClick={() => handleDelete(n.id)}>حذف</button>
          </div>
        </div>
      ))}
    </div>
  );
}
