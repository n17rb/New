// ============================================================
// البحث الذكي عن العملاء
// بيفهم جمل مثل: «عمارة 5 طابق ثاني»، «ع5 ط2 ش7»، «شارع الكندي»،
// «أبو أحمد الرابية»، «0791»، ويحوّلها لشروط بحث.
// ============================================================

// توحيد الكتابة العربية: أ/إ/آ ← ا، ة ← ه، ى ← ي، بدون تشكيل ولا تطويل، والأرقام الهندية ← إنجليزية
export function normalizeArabic(text) {
  return String(text || "")
    .replace(/[ً-ْٰـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// نفس التوحيد بس داخل SQL (عشان نقارن العمود والكلمة بنفس الطريقة)
export function sqlNormalize(column) {
  return `translate(lower(coalesce(${column}, '')), 'أإآٱةىؤئ٠١٢٣٤٥٦٧٨٩ـًٌٍَُِّْ', 'ااااهيوي0123456789')`;
}

// أرقام الطوابق بالكلام
const ORDINALS = {
  0: ["ارضي", "الارضي", "ارضيه", "تسويه", "g"],
  1: ["اول", "الاول", "اولى", "الاولى"],
  2: ["ثاني", "الثاني", "تاني", "التاني", "ثانيه"],
  3: ["ثالث", "الثالث", "تالت", "التالت", "ثالثه"],
  4: ["رابع", "الرابع", "رابعه"],
  5: ["خامس", "الخامس", "خامسه"],
  6: ["سادس", "السادس", "سادسه"],
  7: ["سابع", "السابع", "سابعه"],
  8: ["ثامن", "الثامن", "تامن"],
  9: ["تاسع", "التاسع"],
  10: ["عاشر", "العاشر"],
};
const ORDINAL_TO_NUM = {};
for (const [n, words] of Object.entries(ORDINALS)) for (const w of words) ORDINAL_TO_NUM[w] = Number(n);

const KEYWORDS = {
  building: ["عماره", "عمارة", "العماره", "بنايه", "البنايه", "مبنى", "المبنى", "مبني", "بيت", "رقم العماره", "ع", "بناء"],
  floor: ["طابق", "الطابق", "ط", "دور", "الدور", "طابقه"],
  apartment: ["شقه", "الشقه", "شقة", "ش", "شق"],
  street: ["شارع", "الشارع", "ش.", "طريق"],
  phone: ["تلفون", "هاتف", "موبايل", "رقم"],
};
const KEY_LOOKUP = {};
for (const [field, words] of Object.entries(KEYWORDS)) {
  for (const w of words) KEY_LOOKUP[normalizeArabic(w)] = field;
}

const FILLERS = new Set(["رقم", "نمره", "نمرة", "نمر", "#"]);

// كلمات ما إلها معنى بالبحث
const STOP_WORDS = new Set(["انا", "عند", "في", "من", "على", "عن", "اللي", "الي", "يلي", "هو", "هي", "رقم", "بال", "و", "يا", "زبون", "عميل", "ساكن", "ساكنه"]);

function parseNumberToken(token) {
  if (/^\d+$/.test(token)) return Number(token);
  const t = token.replace(/^ال/, "");
  if (ORDINAL_TO_NUM[token] != null) return ORDINAL_TO_NUM[token];
  if (ORDINAL_TO_NUM[t] != null) return ORDINAL_TO_NUM[t];
  return null;
}

// رقم عمارة/شقة مع حرف: «9ج»، «ج9»، «9 ج»، «9-ج»
const LETTER = "[a-zء-ي]";
function readCode(tokens, idx) {
  const tok = tokens[idx];
  if (tok == null) return null;
  let m = tok.match(new RegExp(`^(\\d+)(${LETTER})$`)) || null;
  if (m) return { num: Number(m[1]), letter: m[2], used: 1 };
  m = tok.match(new RegExp(`^(${LETTER})(\\d+)$`));
  if (m && !KEY_LOOKUP[m[1]]) return { num: Number(m[2]), letter: m[1], used: 1 };
  if (/^\d+$/.test(tok)) {
    const next = tokens[idx + 1];
    // «9 ج» — حرف لحاله بعد الرقم (مش كلمة مفتاحية مثل ط أو ش)
    if (next && new RegExp(`^${LETTER}$`).test(next) && !KEY_LOOKUP[next]) {
      return { num: Number(tok), letter: next, used: 2 };
    }
  }
  return null;
}

// يفصل «ع5» و«ط2» و«عماره5» لكلمة + رقم
function splitGlued(tokens) {
  const out = [];
  for (const tok of tokens) {
    const m = tok.match(/^([^\d]+?)(\d+[a-zء-ي]?)$/);
    if (m && KEY_LOOKUP[m[1]]) {
      out.push(m[1], m[2]);
    } else {
      out.push(tok);
    }
  }
  return out;
}

/**
 * يحلل نص البحث.
 * يرجّع { building, floor, apartment, street[], phoneDigits, sequential, regionWords[], terms[], understood[] }
 */
export function parseSearch(raw, regionNames = []) {
  const text = normalizeArabic(raw).replace(/[،,؛;:()\-_/\\|]+/g, " ");
  const result = {
    building: null,
    floor: null,
    apartment: null,
    street: [],
    phoneDigits: null,
    regions: [],
    terms: [],
    codes: [],
    buildingLetter: null,
    apartmentLetter: null,
    understood: [],
  };
  if (!text) return result;

  // أرقام تلفون مكتوبة بفراغات: «079 123 4567»
  const digitsOnly = text.replace(/\s+/g, "");
  if (/^\+?\d{4,}$/.test(digitsOnly)) {
    result.phoneDigits = digitsOnly.replace(/^\+/, "");
    result.understood.push({ label: "تلفون أو رقم تسلسلي", value: result.phoneDigits });
    return result;
  }

  const normalizedRegions = regionNames
    .map((name) => ({ name, norm: normalizeArabic(name) }))
    .filter((r) => r.norm)
    .sort((a, b) => b.norm.length - a.norm.length);

  // المناطق (حتى لو اسمها كلمتين مثل «أم السماق»)
  let rest = ` ${text} `;
  for (const r of normalizedRegions) {
    const variants = [r.norm, r.norm.replace(/^ال/, "")];
    for (const v of variants) {
      if (v.length < 2) continue;
      const pattern = ` ${v} `;
      const withAl = ` ال${v} `;
      if (rest.includes(pattern) || rest.includes(withAl)) {
        result.regions.push(r.name);
        rest = rest.replace(pattern, " ").replace(withAl, " ");
        result.understood.push({ label: "المنطقة", value: r.name });
        break;
      }
    }
  }

  const tokens = splitGlued(rest.trim().split(" ").filter(Boolean));

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const field = KEY_LOOKUP[tok];

    if (field === "street") {
      // كل اللي بعد «شارع» لحد أول كلمة مفتاحية ثانية = اسم الشارع
      const words = [];
      while (i + 1 < tokens.length && !KEY_LOOKUP[tokens[i + 1]] && !/^\d+$/.test(tokens[i + 1])) {
        words.push(tokens[++i]);
      }
      if (words.length) {
        result.street.push(words.join(" "));
        result.understood.push({ label: "الشارع", value: words.join(" ") });
      }
      continue;
    }

    if (field === "building" || field === "floor" || field === "apartment") {
      // «عمارة رقم 5» / «طابق نمرة 2» — نتخطى الكلمة اللي بالنص
      while (i + 1 < tokens.length && FILLERS.has(tokens[i + 1])) i++;
      if (field === "building" || field === "apartment") {
        const code = readCode(tokens, i + 1);
        if (code) {
          i += code.used;
          result[field] = code.num;
          result[`${field}Letter`] = code.letter;
          result.understood.push({ label: field === "building" ? "عمارة" : "شقة", value: `${code.num}${code.letter}` });
          continue;
        }
      }
      const next = tokens[i + 1];
      const num = next != null ? parseNumberToken(next) : null;
      // «ش» لحالها ممكن تكون شارع أو شقة: إذا بعدها رقم = شقة، إذا بعدها كلمة = شارع
      if (num == null && (tok === "ش" || tok === "ش.") && next && !KEY_LOOKUP[next]) {
        const words = [];
        while (i + 1 < tokens.length && !KEY_LOOKUP[tokens[i + 1]] && !/^\d+$/.test(tokens[i + 1])) words.push(tokens[++i]);
        result.street.push(words.join(" "));
        result.understood.push({ label: "الشارع", value: words.join(" ") });
        continue;
      }
      if (num != null) {
        i++;
        result[field] = num;
        const labels = { building: "عمارة", floor: "طابق", apartment: "شقة" };
        const shown = field === "floor" && num === 0 ? "أرضي" : String(num);
        result.understood.push({ label: labels[field], value: shown });
        continue;
      }
      // كلمة مفتاحية بدون رقم — نتجاهلها
      continue;
    }

    if (field === "phone") continue;

    // «طابق ثاني» مكتوبة كـ «الثاني» لحالها بعد رقم عمارة؟ ما بنخمّن — بتصير كلمة بحث عادية
    if (STOP_WORDS.has(tok)) continue;

    // «9ج» لحالها بدون كلمة قبلها = عمارة أو شقة
    const freeCode = readCode(tokens, i);
    if (freeCode) {
      i += freeCode.used - 1;
      result.codes.push(`${freeCode.num}${freeCode.letter}`);
      result.understood.push({ label: "عمارة أو شقة", value: `${freeCode.num}${freeCode.letter}` });
      continue;
    }

    // رقم لحاله بدون كلمة قبله
    if (/^\d+$/.test(tok)) {
      if (tok.length >= 4) {
        result.phoneDigits = tok;
        result.understood.push({ label: "تلفون أو رقم تسلسلي", value: tok });
      } else {
        result.terms.push(tok);
        result.understood.push({ label: "رقم", value: tok });
      }
      continue;
    }

    if (tok.length >= 1) {
      result.terms.push(tok);
    }
  }

  const words = result.terms.filter((t) => !/^\d+$/.test(t));
  if (words.length) result.understood.push({ label: "كلمات", value: words.join(" ") });

  return result;
}

// قيم الطابق المكتوبة بالكلام اللي بتعني نفس الرقم
export function floorWords(num) {
  return ORDINALS[num] || [];
}

/**
 * يحوّل نتيجة التحليل لشروط SQL.
 * columns: أسماء الأعمدة (مع الاسم المستعار للجدول)
 * startIndex: رقم أول باراميتر
 */
export function buildSearchSql(parsed, startIndex = 1) {
  const conds = [];
  const params = [];
  const p = (v) => {
    params.push(v);
    return `$${startIndex + params.length - 1}`;
  };
  const digitsOf = (col) => `regexp_replace(${sqlNormalize(col)}, '[^0-9]', '', 'g')`;

  // الرقم مع الحرف بشكل مضغوط: «عمارة 9 - ج» ← «9ج»
  const compactOf = (col) =>
    `regexp_replace(regexp_replace(${sqlNormalize(col)}, '(عماره|بنايه|مبني|شقه|رقم)', '', 'g'), '[^0-9a-zء-ي]', '', 'g')`;
  const codeMatch = (col, num, letter) => {
    const a = p(`${num}${letter}`);
    const b = p(`${letter}${num}`);
    return `(${compactOf(col)} = ${a} OR ${compactOf(col)} = ${b})`;
  };

  if (parsed.building != null) {
    if (parsed.buildingLetter) {
      conds.push(`(${codeMatch("l.building_number", parsed.building, parsed.buildingLetter)} OR ${codeMatch("l.building_name", parsed.building, parsed.buildingLetter)})`);
    } else {
      // «عمارة 9» بتجيب 9 و 9أ و 9ج كمان
      const ph = p(String(parsed.building));
      conds.push(`(${digitsOf("l.building_number")} = ${ph} OR ${sqlNormalize("l.building_name")} ~ ('(^|[^0-9])' || ${ph} || '([^0-9]|$)'))`);
    }
  }

  if (parsed.floor != null) {
    const num = parsed.floor;
    const words = floorWords(num);
    const numPh = p(String(num));
    const wordsPh = p(words);
    conds.push(`(
      ${digitsOf("l.floor")} = ${numPh}
      OR EXISTS (SELECT 1 FROM unnest(${wordsPh}::text[]) w WHERE ${sqlNormalize("l.floor")} LIKE '%' || w || '%')
    )`);
  }

  if (parsed.apartment != null) {
    if (parsed.apartmentLetter) {
      conds.push(codeMatch("l.apartment", parsed.apartment, parsed.apartmentLetter));
    } else {
      const ph = p(String(parsed.apartment));
      conds.push(`${digitsOf("l.apartment")} = ${ph}`);
    }
  }

  for (const code of parsed.codes) {
    const num = code.match(/\d+/)[0];
    const letter = code.replace(/\d+/, "");
    conds.push(`(${codeMatch("l.building_number", num, letter)} OR ${codeMatch("l.building_name", num, letter)} OR ${codeMatch("l.apartment", num, letter)})`);
  }

  for (const s of parsed.street) {
    const ph = p(s);
    conds.push(`${sqlNormalize("l.street")} LIKE '%' || ${ph} || '%'`);
  }

  if (parsed.regions.length) {
    const ph = p(parsed.regions);
    conds.push(`r.name = ANY(${ph}::text[])`);
  }

  if (parsed.phoneDigits) {
    const d = parsed.phoneDigits;
    // «79123» بدون الصفر بالأول = «079123»
    const local = d.startsWith("962") ? "0" + d.slice(3) : d.startsWith("7") ? "0" + d : d;
    const intl = d.startsWith("0") ? "962" + d.slice(1) : d.startsWith("7") ? "962" + d : d;
    const localPh = p(local);
    const intlPh = p(intl);
    const seqPh = p(d.replace(/^0+/, "") || "0");
    conds.push(`(
      regexp_replace(coalesce(c.phone_display, ''), '[^0-9]', '', 'g') LIKE ${localPh} || '%'
      OR c.phone_normalized LIKE ${intlPh} || '%'
      OR regexp_replace(coalesce(c.phone_alt, ''), '[^0-9]', '', 'g') LIKE ${localPh} || '%'
      OR ltrim(c.sequential_number, '0') = ${seqPh}
    )`);
  }

  // كل كلمة لازم تنلاقى بمكان ما: الاسم، الشارع، اسم العمارة، الملاحظات، الجهة...
  for (const term of parsed.terms) {
    const ph = p(term);
    if (/^\d+$/.test(term)) {
      conds.push(`(
        ltrim(c.sequential_number, '0') = ltrim(${ph}, '0')
        OR ${digitsOf("l.building_number")} = ${ph}
        OR ${digitsOf("l.apartment")} = ${ph}
        ${term.length >= 3 ? `OR regexp_replace(coalesce(c.phone_display, ''), '[^0-9]', '', 'g') LIKE '%' || ${ph} || '%'` : ""}
      )`);
      continue;
    }
    conds.push(`(
      ${sqlNormalize("c.name")} LIKE '%' || ${ph} || '%'
      OR ${sqlNormalize("l.street")} LIKE '%' || ${ph} || '%'
      OR ${sqlNormalize("l.building_name")} LIKE '%' || ${ph} || '%'
      OR ${sqlNormalize("l.side")} LIKE '%' || ${ph} || '%'
      OR ${sqlNormalize("l.access_notes")} LIKE '%' || ${ph} || '%'
      OR ${sqlNormalize("l.preferred_delivery_note")} LIKE '%' || ${ph} || '%'
      OR ${sqlNormalize("c.notes")} LIKE '%' || ${ph} || '%'
      OR ${sqlNormalize("r.name")} LIKE '%' || ${ph} || '%'
    )`);
  }

  // ترتيب: الاسم اللي بيبدأ بالكلمة أول
  let rankSql = null;
  if (parsed.terms.length) {
    const firstWord = parsed.terms.find((t) => !/^\d+$/.test(t));
    if (firstWord) {
      const ph = p(firstWord);
      rankSql = `CASE WHEN ${sqlNormalize("c.name")} LIKE ${ph} || '%' THEN 0 WHEN ${sqlNormalize("c.name")} LIKE '%' || ${ph} || '%' THEN 1 ELSE 2 END`;
    }
  }

  return { conds, params, rankSql };
}
