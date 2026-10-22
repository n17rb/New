// ============================================================
// بحث ذكي بالعربي: بيلاقي الزبون حتى لو في أخطاء إملائية
// (أ/إ/ا، ة/ه، ى/ي، بدون «ال»، حرف ناقص أو زايد أو غلط، أرقام عربية، جزء من التلفون أو الرقم)
// نفس الملف موجود بالواجهة: client/src/factory/smartSearch.js — إذا عدّلت واحد عدّل الثاني
// ============================================================
const AR_DIGITS = { "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9", "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4", "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9" };

export function normAr(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[٠-٩۰-۹]/g, (d) => AR_DIGITS[d])
    .replace(/[ً-ٰٟـ]/g, "") // تشكيل وتطويل
    .replace(/[أإآٱ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/ؤ/g, "و").replace(/ئ/g, "ي").replace(/ء/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
// أحرف بتتلخبط بالكتابة/اللفظ
const loose = (w) => w.replace(/ث/g, "س").replace(/ذ/g, "ز").replace(/ظ/g, "ض").replace(/ط/g, "ت").replace(/ص/g, "س").replace(/ق/g, "ك").replace(/ه$/g, "");
const noAl = (w) => (w.length > 4 && w.startsWith("ال") ? w.slice(2) : w);
const words = (s) => normAr(s).split(" ").filter(Boolean).map(noAl);

// مسافة التعديل (مع قلب حرفين جنب بعض = غلطة وحدة: هاشم/هشام)
function lev(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

// قديش كلمة البحث قريبة من كلمة بالاسم (0..1)
function wordScore(q, w) {
  if (!q || !w) return 0;
  if (w === q) return 1;
  if (w.startsWith(q)) return q.length >= 2 ? 0.95 : 0.6;
  if (w.includes(q) && q.length >= 3) return 0.85;
  const lq = loose(q), lw = loose(w);
  if (lw === lq || (lw.startsWith(lq) && lq.length >= 2)) return 0.9;
  // غلطة إملائية: نقارن مع أول جزء من الكلمة بنفس الطول تقريبًا
  const part = lw.slice(0, Math.max(lq.length, Math.min(lw.length, lq.length + 1)));
  const d = Math.min(lev(lq, lw), lev(lq, part));
  const allowed = lq.length <= 3 ? 0 : lq.length <= 5 ? 1 : lq.length <= 8 ? 2 : 3;
  if (d > allowed) return 0;
  return 0.85 - (d / Math.max(lq.length, 1)) * 0.4;
}

// النتيجة: 0 = مش هو، 1 = بالزبط
export function smartScore(query, item, fields = ["name", "contact_name", "city", "address"]) {
  const raw = normAr(query);
  if (!raw) return 1;
  const digits = raw.replace(/\D/g, "");
  const onlyNum = /^#?\d+$/.test(String(query).trim().replace(/[٠-٩]/g, (d) => AR_DIGITS[d]));
  // رقم الزبون أو التلفون
  if (onlyNum) {
    if (String(item.seq_no ?? "") === digits) return 1;
    const ph = String(item.phone || "").replace(/\D/g, "");
    if (digits.length >= 3 && (ph.includes(digits) || ph.includes(digits.replace(/^962/, "0")) || `962${ph.slice(1)}`.includes(digits))) return 0.9;
    return 0;
  }
  const qw = words(query);
  const hay = fields.flatMap((f) => words(item[f]));
  if (!hay.length) return 0;
  // «ابوعلي» = «أبو علي»: بنقارن بدون فراغات كمان
  const qJoined = loose(raw.replace(/ /g, ""));
  if (qJoined.length >= 4 && fields.some((f) => loose(normAr(item[f]).replace(/ /g, "")).includes(qJoined))) return 0.88;
  let sum = 0;
  for (const q of qw) {
    let best = 0;
    for (const w of hay) { const s = wordScore(q, w); if (s > best) best = s; if (best === 1) break; }
    if (best === 0) return 0; // كل كلمة بالبحث لازم تطابق إشي
    sum += best;
  }
  return sum / qw.length;
}

export function smartFilter(list, query, fields) {
  if (!normAr(query)) return list;
  return list
    .map((x) => [x, smartScore(query, x, fields)])
    .filter(([, s]) => s >= 0.5)
    .sort((a, b) => b[1] - a[1])
    .map(([x]) => x);
}
