// هوية موج: ثلاث موجات + الاسم «موج»

const waveRow = (y) =>
  `M8 ${y} C10.6 ${y + 2.3}, 14.2 ${y + 2.6}, 17.6 ${y + 0.5} S24.6 ${y - 4.1}, 28.2 ${y - 2.2} S33.8 ${y + 2.4}, 37 ${y + 1.1} S39.8 ${y - 0.4}, 40.6 ${y - 1}`;

export function LogoMark({ size = 32, color = "currentColor", strokeWidth = 3.6, title = "موج" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" role="img" aria-label={title} fill="none">
      <g stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
        <path d={waveRow(15.5)} />
        <path d={waveRow(24.5)} />
        <path d={waveRow(33.5)} />
      </g>
    </svg>
  );
}

// الاسم: «موج» كبير، وتحته اسم المحل (اختياري)
export function Wordmark({ light = false, size = "md", subtitle = null }) {
  const big = size === "lg";
  return (
    <div className={`wordmark${light ? " light" : ""}${big ? " lg" : ""}`}>
      <span className="wordmark-name">موج</span>
      {subtitle && <span className="wordmark-sub">{subtitle}</span>}
    </div>
  );
}

// أيقونة التطبيق بمربع مدوّر (للشاشات والبطاقات)
export function AppIcon({ size = 56 }) {
  return (
    <span className="app-icon" style={{ width: size, height: size, borderRadius: size * 0.26 }}>
      <LogoMark size={size * 0.78} color="#0A66F5" strokeWidth={3.8} />
    </span>
  );
}
