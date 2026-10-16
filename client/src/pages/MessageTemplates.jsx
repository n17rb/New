import { useEffect, useRef, useState } from "react";
import { FaWhatsapp } from "react-icons/fa";
import { FiRotateCcw, FiCheck } from "react-icons/fi";
import { api } from "../api.js";
import { TEMPLATE_DEFS, getTemplate, setTemplates, isCustomized, sampleMessage } from "../messages.js";

function TemplateCard({ def, onSaved }) {
  const [text, setText] = useState(getTemplate(def.key));
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const ref = useRef(null);
  const original = getTemplate(def.key);
  const dirty = text !== original;
  const custom = isCustomized(def.key);

  function insertVar(name) {
    const el = ref.current;
    const token = `{${name}}`;
    if (!el) return setText((t) => t + token);
    const s = el.selectionStart ?? text.length, e = el.selectionEnd ?? text.length;
    const next = text.slice(0, s) + token + text.slice(e);
    setText(next);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(s + token.length, s + token.length); });
  }

  async function save(value) {
    setSaving(true); setErr(""); setMsg("");
    try {
      const r = await api.saveMessageTemplates({ [def.key]: value });
      setTemplates(r.templates);
      setText(getTemplate(def.key));
      setMsg(value == null ? "رجع للنص الأصلي ✓" : "انحفظ ✓ — من هلّأ هيك بتنبعت");
      onSaved();
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  const missingDetails = def.vars["التفاصيل"] && !text.includes("{التفاصيل}");

  return (
    <div className="card tpl-card">
      <div className="tpl-head">
        <div>
          <div className="tpl-title">{def.title} {custom && <span className="badge tpl-badge">معدّل</span>}</div>
          <div className="text-secondary" style={{ fontSize: "0.78rem" }}>{def.desc}</div>
        </div>
      </div>

      <textarea ref={ref} className="tpl-text" rows={Math.min(9, Math.max(4, text.split("\n").length + 1))} value={text} onChange={(e) => { setText(e.target.value); setMsg(""); }} />

      <div className="tpl-vars">
        {Object.entries(def.vars).map(([name, hint]) => (
          <button key={name} type="button" className="tpl-var" title={hint} onClick={() => insertVar(name)}>+ {name}</button>
        ))}
      </div>
      {missingDetails && <div className="note-box" style={{ marginTop: 8 }}>انتبه: شلت {"{التفاصيل}"} — الرسالة ما رح يكون فيها الأصناف والمبالغ.</div>}

      <div className="tpl-preview">
        <div className="tpl-preview-h"><FaWhatsapp /> هيك بتوصل للزبون</div>
        <div className="wa-bubble">{sampleMessage(def.key, text)}</div>
      </div>

      {err && <div className="error-box">{err}</div>}
      {msg && <div className="success-box">{msg}</div>}
      <div className="tpl-actions">
        <button className="btn-primary icon-row" style={{ justifyContent: "center" }} disabled={!dirty || saving || !text.trim()} onClick={() => save(text)}>
          <FiCheck /> {saving ? "جاري الحفظ..." : "حفظ النص"}
        </button>
        {(custom || dirty) && (
          <button className="btn-secondary icon-row" style={{ justifyContent: "center" }} disabled={saving} onClick={() => (custom ? save(null) : setText(original))}>
            <FiRotateCcw /> {custom ? "رجوع للنص الأصلي" : "تراجع"}
          </button>
        )}
      </div>
    </div>
  );
}

export default function MessageTemplates() {
  const [, force] = useState(0);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    api.getMessageTemplates().then((r) => setTemplates(r.templates)).catch(() => {}).finally(() => setReady(true));
  }, []);

  return (
    <div className="page">
      <h1 className="title-lg">نصوص الرسائل</h1>
      <p className="text-secondary" style={{ marginTop: -6, fontSize: "0.85rem", lineHeight: 1.6 }}>
        هون بتكتب كل رسالة بتنبعت للزبون على واتساب بالصيغة اللي بتناسبك، وبتنحفظ لكل الموظفين والكباتن.
        الكلمات اللي بين {"{ }"} بتتعبّى لحالها (اسم الزبون، المبلغ…) — اضغط على أي واحدة لتحطها بالنص.
      </p>
      {!ready ? <div className="card"><div className="skeleton" style={{ height: 200 }} /></div> : TEMPLATE_DEFS.map((d) => <TemplateCard key={d.key} def={d} onSaved={() => force((x) => x + 1)} />)}
    </div>
  );
}
