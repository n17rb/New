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
