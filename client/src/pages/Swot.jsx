import { useEffect, useState } from "react";
import { FiPlus, FiX, FiRefreshCw, FiArrowLeft } from "react-icons/fi";
import { api } from "../api.js";
import { usePerms } from "../auth.jsx";

const QUADS = [
  { k: "S", title: "نقاط القوة", en: "Strengths", hint: "شو اللي ماشي منيح عندك", cls: "q-s" },
  { k: "W", title: "نقاط الضعف", en: "Weaknesses", hint: "شو لازم يتحسّن جوّا المحل", cls: "q-w" },
  { k: "O", title: "الفرص", en: "Opportunities", hint: "وين ممكن تكبر", cls: "q-o" },
  { k: "T", title: "المخاطر", en: "Threats", hint: "شو ممكن يأثر عليك", cls: "q-t" },
];

function Quadrant({ q, items, notes, editable, onNotes }) {
  const [draft, setDraft] = useState("");
  function add() {
    const v = draft.trim();
    if (!v) return;
    onNotes([...notes, v]);
    setDraft("");
  }
  return (
    <div className={`swot-q ${q.cls}`}>
      <div className="swot-q-h">
        <span className="swot-letter">{q.k}</span>
        <div>
          <div className="swot-q-t">{q.title} <span className="swot-en">{q.en}</span></div>
          <div className="swot-q-s">{q.hint}</div>
        </div>
      </div>
      {items.length === 0 && notes.length === 0 && <div className="swot-empty">ما طلع إشي هون لسا — كل ما زادت أرقامك المسجّلة بيصير التحليل أدق.</div>}
      {items.map((it, i) => (
        <div key={i} className="swot-item">
          <span className="swot-ic">{it.icon}</span>
          <div style={{ minWidth: 0 }}>
            <div className="swot-it-t">{it.title}</div>
            <div className="swot-it-d">{it.detail}</div>
            {it.action && <div className="swot-it-a"><FiArrowLeft /> {it.action}</div>}
          </div>
        </div>
      ))}
      {notes.map((n, i) => (
        <div key={`n${i}`} className="swot-item note">
          <span className="swot-ic">✍️</span>
          <div className="swot-it-t" style={{ flex: 1 }}>{n}</div>
          {editable && <button className="swot-x" aria-label="حذف" onClick={() => onNotes(notes.filter((_, j) => j !== i))}><FiX /></button>}
        </div>
      ))}
      {editable && (
        <div className="swot-add">
          <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} placeholder="أضف نقطة من عندك…" maxLength={200} />
          <button onClick={add} aria-label="إضافة"><FiPlus /></button>
        </div>
      )}
    </div>
  );
}

export default function Swot() {
  const { isOwner, canEdit } = usePerms();
  const editable = isOwner || canEdit("reports") || canEdit("settings");
  const [data, setData] = useState(null);
  const [notes, setNotes] = useState({ S: [], W: [], O: [], T: [] });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  function load() {
    setLoading(true);
    api.getSwot().then((d) => { setData(d); setNotes(d.notes); }).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function saveNotes(next) {
    setNotes(next);
    setSaving(true);
    try { setNotes(await api.saveSwotNotes(next)); } catch (e) { setError(e.message); } finally { setSaving(false); }
  }

  return (
    <div className="page">
      <h1 className="title-lg">تحليل SWOT</h1>
      <p className="text-secondary" style={{ marginTop: -6, fontSize: "0.85rem", lineHeight: 1.6 }}>
        موج بيحلّل أرقام محلك (المبيعات، الزباين، التوصيل، الديون، المناطق) وبيطلعلك وين قوتك ووين لازم تنتبه — ومعها شو تعمل.
      </p>
      {error && <div className="error-box">{error}</div>}
      {!data && !error && <div className="skeleton" style={{ height: 320 }} />}

      {data && (
        <>
          {data.plan.length > 0 && (
            <div className="card swot-plan">
              <div className="swot-plan-h">🎯 خطتك لهالأسبوع</div>
              {data.plan.map((p, i) => (
                <div key={i} className="swot-plan-row">
                  <span className="swot-plan-n">{i + 1}</span>
                  <div><div style={{ fontWeight: 700 }}>{p.action}</div><div className="text-secondary" style={{ fontSize: "0.78rem" }}>{p.icon} {p.title}</div></div>
                </div>
              ))}
            </div>
          )}

          <div className="swot-grid">
            {QUADS.map((q) => (
              <Quadrant key={q.k} q={q} items={data.auto[q.k]} notes={notes[q.k] || []} editable={editable}
                onNotes={(arr) => saveNotes({ ...notes, [q.k]: arr })} />
            ))}
          </div>

          <div className="text-secondary" style={{ fontSize: "0.75rem", display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
            <span>{saving ? "جاري حفظ ملاحظاتك…" : `آخر تحديث: ${new Date(data.generated_at).toLocaleTimeString("ar-JO", { hour: "numeric", minute: "2-digit" })}`}</span>
            <button className="link-btn" disabled={loading} onClick={load}><FiRefreshCw /> حدّث التحليل</button>
          </div>
        </>
      )}
    </div>
  );
}
