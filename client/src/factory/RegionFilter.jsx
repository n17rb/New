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
// اختيار المناطق: المحافظة ← الألوية (بتختار أكثر من لواء)، ولو بدك أدق: مناطق جوّا اللواء
// مثلًا إربد ← لواء بني عبيد + لواء الرمثا — وبتطلع طلباتهم بس
// ============================================================
const dKey = (x) => `d|${gov(x)}|${dist(x)}`;
const aKey = (x) => `a|${gov(x)}|${dist(x)}|${area(x)}`;
export function matchAreas(x, keys) {
  if (!keys?.length) return true;
  return keys.includes(dKey(x)) || keys.includes(aKey(x));
}
const keyLabel = (k) => {
  const p = k.split("|");
  return p[0] === "a" ? p[3] : p[2] === NONE ? `${p[1]} (غير محدد)` : short(p[2]);
};
export function AreasFilter({ items, value = [], onChange, noun = "طلب" }) {
  const valid = value.filter((k) => /^[da]\|/.test(k));
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(valid);
  const [g, setG] = useState(null); // المحافظة المفتوحة
  const [d, setD] = useState(null); // اللواء المفتوح لاختيار مناطقه
  const tree = useMemo(() => {
    const m = new Map();
    for (const x of items) {
      const G = gov(x), D = dist(x), A = area(x);
      if (!m.has(G)) m.set(G, { n: 0, dists: new Map() });
      const gg = m.get(G); gg.n++;
      if (!gg.dists.has(D)) gg.dists.set(D, { n: 0, areas: new Map() });
      const dd = gg.dists.get(D); dd.n++;
      dd.areas.set(A, (dd.areas.get(A) || 0) + 1);
    }
    return m;
  }, [items]);
  const govs = [...tree.entries()].sort((a, b) => (a[0] === NONE) - (b[0] === NONE) || b[1].n - a[1].n);
  const count = items.filter((x) => matchAreas(x, sel)).length;
  const toggle = (k) => setSel((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));
  const labels = valid.map(keyLabel);
  const dk = (G, D) => `d|${G}|${D}`;
  const ak = (G, D, A) => `a|${G}|${D}|${A}`;
  return (
    <>
      <div className="fx-region">
        <button className={`fx-region-btn ${valid.length ? "on" : ""}`} onClick={() => { setSel(valid); setG(null); setD(null); setOpen(true); }}>
          <FiMapPin aria-hidden="true" /> {valid.length ? (labels.length <= 2 ? labels.join(" + ") : `${labels.slice(0, 2).join(" + ")} +${labels.length - 2}`) : "كل المناطق"}
        </button>
        {valid.length > 0 && <button className="fx-region-x" onClick={() => onChange([])} aria-label="كل المناطق"><FiX /></button>}
      </div>
      {open && (
        <Sheet title={d ? `مناطق ${short(d)}` : g ? g : "وين بدك تطلّع السيارة؟"} onClose={() => setOpen(false)}>
          <div className="fx-stack" style={{ gap: 8 }}>
            {(g || d) && (
              <button className="fx-link" style={{ justifySelf: "start" }} onClick={() => (d ? setD(null) : setG(null))}>
                <FiArrowRight aria-hidden="true" /> رجوع
              </button>
            )}

            {/* ١) المحافظات */}
            {!g && govs.map(([G, gg]) => {
              const picked = sel.filter((k) => k.split("|")[1] === G).length;
              return <RegionRow key={G} label={`${G}${picked ? ` · ✓ ${picked}` : ""}`} n={gg.n} noun={noun} more onClick={() => setG(G)} />;
            })}

            {/* ٢) ألوية المحافظة — بتختار أكثر من وحدة */}
            {g && !d && (
              <>
                <small className="fx-muted">اختار لواء أو أكثر — أو اكبس ‹ لتختار مناطق محددة جوّاه.</small>
                {[...tree.get(g).dists.entries()].sort((a, b) => (a[0] === NONE) - (b[0] === NONE) || b[1].n - a[1].n).map(([D, dd]) => {
                  const on = sel.includes(dk(g, D));
                  const partial = !on && sel.some((k) => k.startsWith(`a|${g}|${D}|`));
                  return (
                    <div key={D} className="fx-row" style={{ gap: 8, flexWrap: "nowrap" }}>
                      <button type="button" className={`fx-chip ${on ? "on" : ""}`} style={{ flex: 1, justifyContent: "space-between", display: "flex", padding: "10px 14px", fontSize: 15 }} onClick={() => {
                        setSel((s) => (on ? s.filter((x) => x !== dk(g, D)) : [...s.filter((x) => !x.startsWith(`a|${g}|${D}|`)), dk(g, D)]));
                      }}>
                        <span>{on ? "✓ " : partial ? "◐ " : ""}{D === NONE ? "منطقة غير محددة" : `لواء ${short(D)}`}</span>
                        <small>{num(dd.n)} {noun}</small>
                      </button>
                      {D !== NONE && dd.areas.size > 1 && <button type="button" className="fx-icon-btn" onClick={() => setD(D)} aria-label="المناطق"><FiChevronLeft /></button>}
                    </div>
                  );
                })}
              </>
            )}

            {/* ٣) مناطق اللواء (اختياري) */}
            {g && d && (
              <>
                <small className="fx-muted">اختار المناطق اللي بدك إياها بلواء {short(d)}.</small>
                <div className="fx-chips">
                  {[...tree.get(g).dists.get(d).areas.entries()].sort((a, b) => b[1] - a[1]).map(([A, n]) => {
                    const on = sel.includes(ak(g, d, A)) || sel.includes(dk(g, d));
                    return <button key={A} type="button" className={`fx-chip ${on ? "on" : ""}`} onClick={() => {
                      setSel((s) => {
                        let x = s;
                        // كان اللواء كله مختار؟ بنفكّه لمناطقه
                        if (x.includes(dk(g, d))) x = [...x.filter((k) => k !== dk(g, d)), ...[...tree.get(g).dists.get(d).areas.keys()].map((a2) => ak(g, d, a2))];
                        return x.includes(ak(g, d, A)) ? x.filter((k) => k !== ak(g, d, A)) : [...x, ak(g, d, A)];
                      });
                    }}>{on ? "✓ " : ""}{A} <small>({num(n)})</small></button>;
                  })}
                </div>
              </>
            )}

            {sel.length > 0 && <div className="fx-chips">{sel.map((k) => <button key={k} type="button" className="fx-chip on" onClick={() => toggle(k)}>{keyLabel(k)} ✕</button>)}</div>}
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
