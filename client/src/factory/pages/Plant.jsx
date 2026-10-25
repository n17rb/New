import { useNavigate, useParams } from "react-router-dom";
import { FiChevronLeft } from "react-icons/fi";
import { fapi } from "../fapi.js";
import { useFx, useLoad, Err, Loading, Empty, Reload, time } from "../ui.jsx";
import { lineType, plantName } from "../plants.js";

// ============================================================
// صفحة المصنع (مصنع الكاسات / مصنع المطرات): ٣ أفرع بس —
// المواد الأولية، قطع الصيانة، والتعقيم (الفحوصات والفلاتر)
// ============================================================
const ICON = { bottles: "🍶", cups: "🥤" };

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
  const Tile = ({ icon, title, sub, warn, to }) => (
    <button className="fx-item" style={{ padding: 18 }} onClick={() => nav(to)}>
      <span className="fx-avatar" style={{ fontSize: 26, width: 52, height: 52 }}>{icon}</span>
      <span className="t"><b style={{ fontSize: 17 }}>{title}</b><span style={warn ? { color: "var(--fx-crit)", fontWeight: 700 } : undefined}>{sub}</span></span>
      <FiChevronLeft style={{ color: "var(--fx-muted)" }} />
    </button>
  );
  return (
    <div className="fx-page">
      <div className="fx-row" style={{ justifyContent: "space-between" }}>
        <h1 className="fx-h1" style={{ margin: 0 }}>{l ? `${ICON[lineType(l.name)] || "🏭"} ${plantName(l.name)}` : "المصنع"}</h1>
        <Reload onClick={reload} />
      </div>
      <Err msg={error} />
      {!data && !error && <Loading />}
      {data && !l && <Empty title="المصنع مش موجود" />}
      {l && (
        <div className="fx-list">
          <Tile icon="📦" title="المواد الأولية" to={`/f/store?line=${lid}&tab=material`}
            sub={`${mats.length} مادة${mats.some((m) => m.low) ? ` · ${mats.filter((m) => m.low).length} قرّبت تخلص` : ""}`} warn={mats.some((m) => m.low)} />
          <Tile icon="🔩" title="قطع الصيانة" to={`/f/store?line=${lid}&tab=part`}
            sub={`${parts.length} قطعة${parts.some((m) => m.low) ? ` · ${parts.filter((m) => m.low).length} قرّبت تخلص` : ""}`} warn={parts.some((m) => m.low)} />
          <Tile icon="🧪" title="التعقيم والفلاتر" to={`/f/line?line=${lid}`}
            sub={[due == null ? "ما في فحص اليوم" : due <= 0 ? "الفحص مستحق هلأ" : `الفحص الجاي بعد ${due < 60 ? `${due} دقيقة` : `${Math.round(due / 60)} ساعة`}`, l.last_check_at && `آخر فحص ${time(l.last_check_at)}`, fDue ? `${fDue} فلتر بدّه غيار` : null].filter(Boolean).join(" · ")}
            warn={(due != null && due <= 0) || due == null || fDue > 0} />
        </div>
      )}
      {fx.can("f_store", "edit") && l && <small className="fx-muted">الخط وموظفينه بتعدّلهم من «المواد وقطع الغيار» ← «المصانع والخطوط».</small>}
    </div>
  );
}
