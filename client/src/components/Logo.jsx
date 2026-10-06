// شعار المحل: قطرة وفيها موجتين
export function LogoMark({ size = 32, color = "currentColor", strokeWidth = 3.4, title = "مياه جوهرة الرابية" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" role="img" aria-label={title} fill="none">
      <defs>
        <clipPath id="logo-drop-clip">
          <path d="M24 4.5C24 4.5 9.5 19.5 9.5 30.2a14.5 14.5 0 0 0 29 0C38.5 19.5 24 4.5 24 4.5Z" />
        </clipPath>
      </defs>
      <path
        d="M24 4.5C24 4.5 9.5 19.5 9.5 30.2a14.5 14.5 0 0 0 29 0C38.5 19.5 24 4.5 24 4.5Z"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
      />
      <g clipPath="url(#logo-drop-clip)" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round">
        <path d="M7 31.5c4.2-3.6 8.4-3.6 12.6 0s8.4 3.6 12.6 0 8.4-3.6 12.6 0" />
        <path d="M7 38c4.2-3.6 8.4-3.6 12.6 0s8.4 3.6 12.6 0 8.4-3.6 12.6 0" />
      </g>
    </svg>
  );
}

// الاسم كامل مثل اليافطة: «جوهرة» صغيرة فوق «مياه الرابية»
export function Wordmark({ light = false, size = "md" }) {
  const big = size === "lg";
  return (
    <div className={`wordmark${light ? " light" : ""}${big ? " lg" : ""}`}>
      <span className="wordmark-small">جوهرة</span>
      <span className="wordmark-name">مياه الرابية</span>
    </div>
  );
}
