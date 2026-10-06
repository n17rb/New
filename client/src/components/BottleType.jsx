// نوع القوارير اللي بتنزل للزبون: new = جديدة، used = مستعملة

export const BOTTLE_TYPES = {
  new: { label: "قوارير جديدة", short: "جديدة", icon: "🆕", color: "#0094FF", bg: "rgba(0, 148, 255, 0.12)" },
  used: { label: "قوارير مستعملة", short: "مستعملة", icon: "♻️", color: "#1F9D55", bg: "rgba(31, 157, 85, 0.12)" },
};

// خانتين جنب بعض — الضغط على وحدة بيختارها
export function BottleTypePicker({ value, onChange, required = false }) {
  return (
    <div className="field">
      <label>نوع القوارير اللي بتنزل للزبون{required ? " *" : ""}</label>
      <div style={{ display: "flex", gap: 10 }}>
        {Object.entries(BOTTLE_TYPES).map(([key, t]) => {
          const selected = value === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onChange(key)}
              aria-pressed={selected}
              style={{
                flex: 1,
                padding: "14px 8px",
                borderRadius: 10,
                border: `2px solid ${selected ? t.color : "var(--border)"}`,
                background: selected ? t.bg : "transparent",
                color: "inherit",
                fontWeight: selected ? 700 : 500,
                fontSize: "0.95rem",
                cursor: "pointer",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 4,
              }}
            >
              <span style={{ fontSize: "1.4rem" }}>{t.icon}</span>
              {t.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// شارة صغيرة للقوائم
export function BottleTypeBadge({ type, large = false }) {
  const t = BOTTLE_TYPES[type];
  if (!t) {
    if (!large) return null;
    return (
      <div style={{ padding: "8px 12px", borderRadius: 8, border: "1px dashed var(--border)", marginBottom: 12, fontSize: "0.9rem" }} className="text-secondary">
        نوع القوارير مش محدد لهذا الزبون
      </div>
    );
  }
  if (large) {
    return (
      <div
        style={{
          padding: "12px 14px",
          borderRadius: 10,
          background: t.bg,
          border: `2px solid ${t.color}`,
          color: t.color,
          fontWeight: 700,
          fontSize: "1.1rem",
          marginBottom: 12,
          textAlign: "center",
        }}
      >
        {t.icon} نزّل له {t.label}
      </div>
    );
  }
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 999,
        background: t.bg,
        color: t.color,
        fontSize: "0.72rem",
        fontWeight: 700,
        whiteSpace: "nowrap",
      }}
    >
      {t.icon} {t.short}
    </span>
  );
}

// شارة الطلب التلقائي اللي لسا ما انحددت كميته
export function NeedsQuantityBadge({ order }) {
  if (!order) return null;
  if (order.needs_quantity) {
    return (
      <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 999, background: "rgba(232, 160, 32, 0.15)", color: "#B26B00", fontSize: "0.72rem", fontWeight: 700, whiteSpace: "nowrap" }}>
        ⚠️ حدد الكمية
      </span>
    );
  }
  if (order.auto_from_reminder) {
    return (
      <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 999, background: "var(--bg)", fontSize: "0.72rem", whiteSpace: "nowrap" }} className="text-secondary">
        📅 تلقائي
      </span>
    );
  }
  return null;
}
