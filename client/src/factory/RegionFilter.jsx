import { useMemo, useState } from "react";
import { FiMapPin, FiX, FiChevronLeft, FiArrowRight } from "react-icons/fi";
import { Sheet, num } from "./ui.jsx";

// ============================================================
// فلترة حسب المنطقة: المحافظة ← اللواء ← المنطقة، وجنب كل وحدة كم طلب/زبون فيها
// ============================================================
const NONE = "غير محدد";
const gov = (x) => x.governorate || NONE;
const dist = (x) => x.district || NONE;
const area = (x) => (x.city || "").trim() || NONE;

export function matchRegion(x, f) {
  if (!f) return true;
  if (f.gov && gov(x) !== f.gov) return false;
  if (f.dist && dist(x) !== f.dist) return false;
  if (f.area && area(x) !== f.area) return false;
  return true;
}

function countBy(items, key) {
  const m = new Map();
  for (const x of items) m.set(key(x), (m.get(key(x)) || 0) + 1);
  return [...m.entries()].sort((a, b) => (a[0] === NONE) - (b[0] === NONE) || b[1] - a[1]);
}

const short = (d) => d.replace(/^قصبة /, "");

export default function RegionFilter({ items, value, onChange, noun = "طلب" }) {
  const [open, setOpen] = useState(false);
  const [lvl, setLvl] = useState({ gov: null, dist: null });
  const label = value ? [value.gov, value.dist && short(value.dist), value.area].filter(Boolean).join(" › ") : "كل المناطق";

  const govs = useMemo(() => countBy(items, gov), [items]);
  const inGov = useMemo(() => (lvl.gov ? items.filter((x) => gov(x) === lvl.gov) : []), [items, lvl.gov]);
  const dists = useMemo(() => countBy(inGov, dist), [inGov]);
  const inDist = useMemo(() => (lvl.dist ? inGov.filter((x) => dist(x) === lvl.dist) : []), [inGov, lvl.dist]);
  const areas = useMemo(() => countBy(inDist, area), [inDist]);

  const pick = (f) => { onChange(f); setOpen(false); };
  const start = () => { setLvl({ gov: value?.gov || null, dist: value?.dist || null }); setOpen(true); };

  return (
    <>
      <div className="fx-region">
        <button className={`fx-region-btn ${value ? "on" : ""}`} onClick={start}>
          <FiMapPin aria-hidden="true" /> {label}
        </button>
        {value && <button className="fx-region-x" onClick={() => onChange(null)} aria-label="كل المناطق"><FiX /></button>}
      </div>

      {open && (
        <Sheet title={lvl.dist ? short(lvl.dist) : lvl.gov || "اختار المنطقة"} onClose={() => setOpen(false)}>
          <div className="fx-stack" style={{ gap: 8 }}>
            {lvl.gov && (
              <button className="fx-link" style={{ justifySelf: "start" }} onClick={() => setLvl(lvl.dist ? { gov: lvl.gov, dist: null } : { gov: null, dist: null })}>
                <FiArrowRight aria-hidden="true" /> رجوع
              </button>
            )}

            {!lvl.gov && (
              <>
                <RegionRow label="كل المناطق" n={items.length} noun={noun} strong onClick={() => pick(null)} />
                {govs.map(([g, n]) => <RegionRow key={g} label={g} n={n} noun={noun} more={g !== NONE} onClick={() => (g === NONE ? pick({ gov: g }) : setLvl({ gov: g, dist: null }))} />)}
              </>
            )}

            {lvl.gov && !lvl.dist && (
              <>
                <RegionRow label={`كل ${lvl.gov}`} n={inGov.length} noun={noun} strong onClick={() => pick({ gov: lvl.gov })} />
                {dists.map(([d, n]) => <RegionRow key={d} label={d === NONE ? d : `لواء ${short(d)}`} n={n} noun={noun} more={d !== NONE} onClick={() => (d === NONE ? pick({ gov: lvl.gov, dist: d }) : setLvl({ gov: lvl.gov, dist: d }))} />)}
              </>
            )}

            {lvl.dist && (
              <>
                <RegionRow label={`كل لواء ${short(lvl.dist)}`} n={inDist.length} noun={noun} strong onClick={() => pick({ gov: lvl.gov, dist: lvl.dist })} />
                {areas.map(([a, n]) => <RegionRow key={a} label={a} n={n} noun={noun} onClick={() => pick({ gov: lvl.gov, dist: lvl.dist, area: a })} />)}
              </>
            )}
          </div>
        </Sheet>
      )}
    </>
  );
}

function RegionRow({ label, n, noun, more, strong, onClick }) {
  return (
    <button className={`fx-region-row ${strong ? "strong" : ""}`} onClick={onClick}>
      <span className="nm">{label}</span>
      <span className="n">{num(n)} {noun}</span>
      {more && <FiChevronLeft aria-hidden="true" />}
    </button>
  );
}

// ============================================================
// اختيار أكثر من منطقة بحرية (مثلًا الشجرة + الرمثا) — وبتطلع طلبات المناطق اللي اخترتها بس
// ============================================================
const areaKey = (x) => `${gov(x)}|${area(x)}`;
export function matchAreas(x, keys) {
  return !keys?.length || keys.includes(areaKey(x));
}
export function AreasFilter({ items, value = [], onChange, noun = "طلب" }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(value);
  const groups = useMemo(() => {
    const m = new Map();
    for (const x of items) {
      const g = gov(x), k = areaKey(x);
      if (!m.has(g)) m.set(g, new Map());
      const a = m.get(g);
      a.set(k, { key: k, name: area(x), n: (a.get(k)?.n || 0) + 1 });
    }
    return [...m.entries()].map(([g, a]) => [g, [...a.values()].sort((x, y) => y.n - x.n)]).sort((a, b) => (a[0] === NONE) - (b[0] === NONE) || b[1].reduce((s, x) => s + x.n, 0) - a[1].reduce((s, x) => s + x.n, 0));
  }, [items]);
  const qn = q.trim();
  const shown = qn ? groups.map(([g, as]) => [g, as.filter((a) => a.name.includes(qn) || g.includes(qn))]).filter(([, as]) => as.length) : groups;
  const count = items.filter((x) => matchAreas(x, sel)).length;
  const names = value.map((k) => k.split("|")[1]);
  const toggle = (k) => setSel((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));
  return (
    <>
      <div className="fx-region">
        <button className={`fx-region-btn ${value.length ? "on" : ""}`} onClick={() => { setSel(value); setQ(""); setOpen(true); }}>
          <FiMapPin aria-hidden="true" /> {value.length ? (names.length <= 2 ? names.join(" + ") : `${names.slice(0, 2).join(" + ")} +${names.length - 2}`) : "كل المناطق"}
        </button>
        {value.length > 0 && <button className="fx-region-x" onClick={() => onChange([])} aria-label="كل المناطق"><FiX /></button>}
      </div>
      {open && (
        <Sheet title="اختار المناطق" onClose={() => setOpen(false)}>
          <div className="fx-stack" style={{ gap: 10 }}>
            <input className="fx-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="دوّر على منطقة" />
            {shown.map(([g, as]) => (
              <div key={g} className="fx-stack" style={{ gap: 6 }}>
                <b style={{ fontSize: 13.5 }}>{g}</b>
                <div className="fx-chips">
                  {as.map((a) => <button key={a.key} type="button" className={`fx-chip ${sel.includes(a.key) ? "on" : ""}`} onClick={() => toggle(a.key)}>{sel.includes(a.key) ? "✓ " : ""}{a.name} <small>({num(a.n)})</small></button>)}
                </div>
              </div>
            ))}
            {!shown.length && <div className="fx-muted">ما في منطقة بهالاسم.</div>}
            <div className="fx-grid2" style={{ position: "sticky", bottom: 0, background: "var(--fx-surface, #fff)", paddingTop: 8 }}>
              <button className="fx-btn" onClick={() => setSel([])}>امسح</button>
              <button className="fx-btn pri" onClick={() => { onChange(sel); setOpen(false); }}>اعرض {num(count)} {noun}</button>
            </div>
          </div>
        </Sheet>
      )}
    </>
  );
}
