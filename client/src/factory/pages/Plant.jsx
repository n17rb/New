import { useNavigate, useParams } from "react-router-dom";
import { FiChevronLeft } from "react-icons/fi";
import { fapi } from "../fapi.js";
import { useFx, useLoad, Err, Loading, Empty, Reload, Sheet, Act, time } from "../ui.jsx";
import { lineType, plantName, plantBg, plantIcon } from "../plants.js";
import { useRef, useState } from "react";

// ============================================================
// صفحة المصنع (مصنع الكاسات / مصنع المطرات): ٣ أفرع بس —
// المواد الأولية، قطع الصيانة، والتعقيم (الفحوصات والفلاتر)
// ============================================================

export default function Plant() {
  const fx = useFx();
  const nav = useNavigate();
  const { id } = useParams();
  const lid = Number(id);
  const { data, error, reload } = useLoad(() => Promise.all([fapi.line(), fapi.store().catch(() => null)]), [lid]);
  const [L, S] = data || [];
  const l = L?.lines.find((x) => x.id === lid);
  const ml = new Map((S?.machines || []).map((m) => [m.id, m.line_id]));
  const items = (S?.items || []).filter((m) => m.active && (m.line_id === lid || (!m.line_id && ml.get(m.machine_id) === lid)));
  const mats = items.filter((m) => m.kind === "material"), parts = items.filter((m) => m.kind === "part");
  const due = l ? (l.next_check_at ? Math.round((new Date(l.next_check_at).getTime() - Date.now()) / 60000) : null) : null;
  const fDue = l ? l.filters.filter((f) => f.state === "due").length : 0;
  const canPhoto = fx.can("f_store", "edit") || fx.can("f_fleet", "edit");
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState(false);
  const Tile = ({ icon, title, sub, warn, to }) => (
    <button className="fx-item" style={{ padding: 18 }} onClick={() => nav(to)}>
      <span className="fx-avatar" style={{ fontSize: 26, width: 52, height: 52 }}>{icon}</span>
      <span className="t"><b style={{ fontSize: 17 }}>{title}</b><span style={warn ? { color: "var(--fx-crit)", fontWeight: 700 } : undefined}>{sub}</span></span>
      <FiChevronLeft style={{ color: "var(--fx-muted)" }} />
    </button>
  );
  return (
    <div className="fx-page">
      {l ? (
        <div className="fx-plant-hero" style={l.photo_url ? undefined : { background: plantBg(lineType(l.name)) }}>
          {l.photo_url ? <img src={l.photo_url} alt="" /> : <span className="ico">{plantIcon(lineType(l.name))}</span>}
          <span className="shade" />
          <span className="cap">{plantName(l.name)}</span>
          {canPhoto && <button className="chg" disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? "عم بنرفع..." : l.photo_url ? "📷 غيّر الصورة" : "📷 حط صورة"}</button>}
          {canPhoto && <button className="chg" style={{ top: 50 }} onClick={() => setEdit(true)}>✎ الاسم أو الحذف</button>}
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={async (e) => {
            const f = e.target.files?.[0]; e.target.value = "";
            if (!f) return;
            setBusy(true);
            try { const r = await fapi.upload(f, "plant"); await fapi.linePhoto(l.id, r.url); fx.toast("انحفظت الصورة ✓"); reload(); } catch (err) { fx.toast(err.message); } finally { setBusy(false); }
          }} />
        </div>
      ) : (
        <div className="fx-row" style={{ justifyContent: "space-between" }}>
          <h1 className="fx-h1" style={{ margin: 0 }}>المصنع</h1>
          <Reload onClick={reload} />
        </div>
      )}
      <Err msg={error} />
      {!data && !error && <Loading />}
      {data && !l && <Empty title="المصنع مش موجود" />}
      {l && (
        <div className="fx-list">
          <Tile icon="📦" title="المواد الأولية" to={`/f/store?line=${lid}&tab=material`}
            sub={`${mats.length} مادة${mats.some((m) => m.low) ? ` · ${mats.filter((m) => m.low).length} قرّبت تخلص` : ""}`} warn={mats.some((m) => m.low)} />
          {(fx.can("f_machines") || fx.can("f_store") || fx.can("f_home")) && <Tile icon="🔩" title="قطع الصيانة" to={`/f/store?line=${lid}&tab=part`}
            sub={`${parts.length} قطعة${parts.some((m) => m.low) ? ` · ${parts.filter((m) => m.low).length} قرّبت تخلص` : ""}`} warn={parts.some((m) => m.low)} />}
          <Tile icon="🧪" title="التعقيم والفلاتر" to={`/f/line?line=${lid}`}
            sub={[due == null ? "ما في فحص اليوم" : due <= 0 ? "الفحص مستحق هلأ" : `الفحص الجاي بعد ${due < 60 ? `${due} دقيقة` : `${Math.round(due / 60)} ساعة`}`, l.last_check_at && `آخر فحص ${time(l.last_check_at)}`, fDue ? `${fDue} فلتر بدّه غيار` : null].filter(Boolean).join(" · ")}
            warn={(due != null && due <= 0) || due == null || fDue > 0} />
        </div>
      )}
      {edit && l && <PlantEdit l={l} onClose={() => setEdit(false)} onDone={(stopped) => { setEdit(false); if (stopped) nav("/f/more"); else reload(); }} />}
      {fx.can("f_store", "edit") && l && <small className="fx-muted">الخط وموظفينه بتعدّلهم من «المواد وقطع الغيار» ← «المصانع والخطوط».</small>}
    </div>
  );
}

// تعديل اسم المصنع، أو إيقافه (بيختفي من كل مكان وتاريخه بيضل)
function PlantEdit({ l, onClose, onDone }) {
  const fx = useFx();
  const [name, setName] = useState(l.name);
  const [err, setErr] = useState("");
  const userIds = (l.members || []).map((m) => m.id);
  return (
    <Sheet title="المصنع" onClose={onClose}>
      <div className="fx-stack">
        <label className="fx-field">الاسم<input className="fx-input" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <small className="fx-muted">خلّي بالاسم «كاسات» أو «مطرات» عشان يطلع بأيقونته ولونه.</small>
        <Err msg={err} />
        <Act className="fx-btn pri block" disabled={!name.trim()} onClick={async () => {
          setErr("");
          try { await fapi.editPline(l.id, { name: name.trim(), site_id: l.site_id, user_ids: userIds, active: true }); fx.toast("انحفظ"); onDone(false); } catch (e) { setErr(e.message); }
        }}>حفظ</Act>
        <Act className="fx-btn danger block" onClick={async () => {
          if (!confirm(`تحذف «${l.name}»؟ بيختفي من المزيد والرئيسية. إذا إله إنتاج أو فحوصات قديمة بتضل محفوظة بالتقارير.`)) return;
          try { const r = await fapi.deletePline(l.id); fx.toast(r.mode === "deleted" ? "انحذف" : "انحذف من القوائم — تاريخه محفوظ بالتقارير"); onDone(true); } catch (e) { setErr(e.message); }
        }}>🗑 احذف المصنع</Act>
      </div>
    </Sheet>
  );
}
