// نوع الخط من اسمه، واسمه كمصنع («خط الكاسات» ← «مصنع الكاسات»)
export const lineType = (name) => (/قنا|قنين|مطر|bottle/i.test(name || "") ? "bottles" : /كاس|cup/i.test(name || "") ? "cups" : null);
export const plantName = (n) => (n || "").replace(/^خط\s*/, "مصنع ");
