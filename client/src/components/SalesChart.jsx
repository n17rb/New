import { useMemo, useRef, useState } from "react";

// رسم المبيعات/القوارير: أعمدة يومية + خط متوسط ٧ أيام، أو أعمدة شهرية مع توقع الشهر الحالي
const W = 340;
const H = 190;
const PAD = { l: 34, r: 8, t: 14, b: 26 };

function niceMax(v) {
  if (v <= 0) return 10;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  const m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return m * p;
}
const fmt = (v, unit) => (unit === "JD" ? `${Number(v).toFixed(v >= 100 ? 0 : 2)} JD` : `${Math.round(v)} قارورة`);
const short = (v) => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : Math.round(v).toString());
const dayLabel = (d) => `${Number(d.slice(8, 10))}/${Number(d.slice(5, 7))}`;
const dayLong = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString("ar-JO", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

export default function SalesChart({ mode = "daily", daily = [], months = [], unit = "JD" }) {
  const [hover, setHover] = useState(null);
  const wrapRef = useRef(null);

  const model = useMemo(() => {
    if (mode === "monthly") {
      const items = months.map((m) => ({ key: m.month, label: m.label, value: m.total, projected: m.projected, current: m.current }));
      const max = niceMax(Math.max(...items.map((i) => Math.max(i.value, i.projected || 0)), 0));
      return { items, max };
    }
    const items = daily.map((d) => ({ key: d.date, label: dayLabel(d.date), value: d.value }));
    // متوسط ٧ أيام (بس الأيام المسجّلة)
    items.forEach((it, i) => {
      const win = items.slice(Math.max(0, i - 6), i + 1).filter((x) => x.value != null);
      it.avg = win.length >= 3 ? win.reduce((s, x) => s + x.value, 0) / win.length : null;
    });
    const max = niceMax(Math.max(...items.map((i) => Math.max(i.value || 0, i.avg || 0)), 0));
    return { items, max };
  }, [mode, daily, months]);

  const { items, max } = model;
  const n = items.length || 1;
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;
  const slot = innerW / n;
  const barW = Math.max(3, Math.min(mode === "monthly" ? 26 : 9, slot - 2));
  const x = (i) => PAD.l + slot * i + slot / 2;
  const y = (v) => PAD.t + innerH - (v / max) * innerH;
  const ticks = [0, max / 2, max];

  let avgPath = "";
  if (mode === "daily") {
    let started = false;
    items.forEach((it, i) => {
      if (it.avg == null) { started = false; return; }
      avgPath += `${started ? "L" : "M"}${x(i).toFixed(1)} ${y(it.avg).toFixed(1)}`;
      started = true;
    });
  }

  function onMove(e) {
    const svg = e.currentTarget;
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.min(n - 1, Math.max(0, Math.floor((px - PAD.l) / slot)));
    setHover(i);
  }

  const labelEvery = mode === "monthly" ? 1 : Math.ceil(n / 6);
  const h = hover != null ? items[hover] : null;

  return (
    <div className="chart" ref={wrapRef}>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)} role="img"
        aria-label={mode === "monthly" ? "المجموع الشهري" : "المبيعات اليومية آخر ٣٠ يوم"}>
        <defs>
          <pattern id="proj-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" className="chart-proj-bg" />
            <line x1="0" y1="0" x2="0" y2="6" className="chart-proj-line" strokeWidth="2" />
          </pattern>
        </defs>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} className="chart-grid" />
            <text x={PAD.l - 5} y={y(t) + 3.5} className="chart-axis" textAnchor="end">{short(t)}</text>
          </g>
        ))}
        {items.map((it, i) => {
          const active = hover === i;
          return (
            <g key={it.key}>
              {mode === "monthly" && it.current && it.projected > it.value && (
                <rect x={x(i) - barW / 2} y={y(it.projected)} width={barW} height={Math.max(0, y(it.value) - y(it.projected))} rx="4" fill="url(#proj-hatch)" />
              )}
              {it.value != null && it.value > 0 ? (
                <rect x={x(i) - barW / 2} y={y(it.value)} width={barW} height={Math.max(1, PAD.t + innerH - y(it.value))} rx={Math.min(4, barW / 2)}
                  className={`chart-bar${active ? " on" : ""}${it.current ? " cur" : ""}`} />
              ) : (
                mode === "daily" && <circle cx={x(i)} cy={PAD.t + innerH - 2} r="1.6" className="chart-missing" />
              )}
              {i % labelEvery === 0 && (
                <text x={x(i)} y={H - 8} className="chart-axis" textAnchor="middle">{mode === "monthly" ? it.label.split(" ")[0] : it.label}</text>
              )}
            </g>
          );
        })}
        {avgPath && <path d={avgPath} className="chart-line" fill="none" />}
        {h && <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={PAD.t + innerH} className="chart-cross" />}
      </svg>
      {h && (
        <div className="chart-tip" style={{ left: `${(x(hover) / W) * 100}%` }}>
          <div className="chart-tip-t">{mode === "monthly" ? h.label : dayLong(h.key)}</div>
          <div className="tabular-num chart-tip-v">{h.value != null ? fmt(h.value, unit) : "ما انسجل"}</div>
          {mode === "daily" && h.avg != null && <div className="chart-tip-s tabular-num">متوسط ٧ أيام: {fmt(h.avg, unit)}</div>}
          {mode === "monthly" && h.current && h.projected != null && <div className="chart-tip-s tabular-num">متوقع يسكّر على: {fmt(h.projected, unit)}</div>}
        </div>
      )}
      <div className="chart-legend">
        <span><i className="lg-bar" /> {mode === "monthly" ? "مجموع الشهر" : "كل يوم"}</span>
        {mode === "daily" ? <span><i className="lg-line" /> متوسط ٧ أيام</span> : <span><i className="lg-proj" /> باقي المتوقع لهالشهر</span>}
      </div>
    </div>
  );
}
