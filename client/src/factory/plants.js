// نوع الخط من اسمه، واسمه كمصنع («خط الكاسات» ← «مصنع الكاسات»)
export const lineType = (name) => (/قنا|قنين|مطر|bottle/i.test(name || "") ? "bottles" : /كاس|cup/i.test(name || "") ? "cups" : null);
export const plantName = (n) => (n || "").replace(/^خط\s*/, "مصنع ");
// لون هادي لكل نوع مصنع (لما ما في صورة)
export const plantBg = (type) => (type === "cups" ? "linear-gradient(135deg,#4aa8e8,#0b5fa8)" : type === "bottles" ? "linear-gradient(135deg,#3cc4b4,#0b7d78)" : "linear-gradient(135deg,#8aa0b8,#4b6079)");
export const plantIcon = (type) => (type === "cups" ? "🥤" : type === "bottles" ? "🍶" : "🏭");
