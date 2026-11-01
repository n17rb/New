// ============================================================
// تقسيم الزباين لمناطق التوصيل تلقائيًا (إربد والرمثا)
// منعتمد على اسم المنطقة (city) وعلى موقع المحل (lat/lng).
// الزبون اللي انحطّ بمنطقة باليد (line_manual) ما منلمسه.
// ============================================================
import { query } from "../db.js";
import { inferRegion } from "./jordanRegions.js";

export const ZONES = [
  { key: "irbid_sareeh", gov: "إربد", name: "صريح وبشرى وسال والحصن" },
  { key: "irbid_kanana", gov: "إربد", name: "لواء بني كنانة" },
  { key: "irbid_center", gov: "إربد", name: "وسط إربد" },
  { key: "ramtha_villages", gov: "الرمثا", name: "الشجرة والطرة وعمراوة والذنيبة" },
  { key: "ramtha_east", gov: "الرمثا", name: "طرف الرمثا الشرقي" },
  { key: "ramtha_west", gov: "الرمثا", name: "طرف الرمثا الغربي" },
  { key: "ramtha_center", gov: "الرمثا", name: "وسط الرمثا" },
];

const nk = (s) => String(s || "").trim()
  .replace(/[ً-ْـ]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي")
  .replace(/^ال/, "").replace(/\s+/g, " ");
const words = (s) => String(s || "").split(/[\s،,\-–/()]+/).map(nk).filter(Boolean);
const has = (text, list) => { const w = words(text); const full = nk(text); return list.some((x) => full === nk(x) || w.includes(nk(x))); };

function dist(a, b) {
  const R = 6371, rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b[0] - a[0]), dLng = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const near = (p, pts, km) => p && pts.some((q) => dist(p, q) <= km);

const SAREEH = { names: ["صريح", "بشرى", "سال", "الحصن"], pts: [[32.506, 35.897], [32.494, 35.873], [32.551, 35.917], [32.487, 35.880]], km: 2.8 };
const KANANA = { names: ["سحم", "سحم الكفارات", "ملكا", "حرثا", "كفرسوم", "سما الروسان", "يبلا", "ام قيس", "المنصورة", "حريما", "سمر", "خرجا", "الرفيد", "عقربا", "كفر اسد", "زبدة", "بني كنانة"] };
const IRBID_C = [32.5556, 35.85];
const RAMTHA_V = { names: ["الشجرة", "الطرة", "عمراوة", "عمراوه", "الذنيبة"], pts: [[32.644, 35.942], [32.636, 35.989], [32.62, 35.96], [32.60, 35.97]], km: 2.5 };
const RAMTHA_C = [32.559, 36.0069];
const RAMTHA_CENTER_KM = 2.5;

// المنطقة المناسبة لزبون (مفتاح) أو null
export function zoneKeyFor(c) {
  const city = c.city || "", addr = c.address || "";
  const text = `${city} ${addr}`;
  const p = c.lat != null && c.lng != null && Number(c.lat) ? [Number(c.lat), Number(c.lng)] : null;
  let gov = c.governorate, district = c.district;
  if (!gov) { const r = inferRegion(city); gov = r.governorate; district = district || r.district; }
  const inRamtha = nk(district) === nk("الرمثا") || has(city, ["الرمثا", ...RAMTHA_V.names]) || (p && (dist(p, RAMTHA_C) <= 7 || near(p, RAMTHA_V.pts, RAMTHA_V.km)));
  if (gov && nk(gov) !== nk("إربد") && nk(gov) !== nk("الرمثا") && !inRamtha) return null;

  if (inRamtha) {
    if (has(text, RAMTHA_V.names) || near(p, RAMTHA_V.pts, RAMTHA_V.km)) return "ramtha_villages";
    if (!p) return "ramtha_center"; // بدون موقع: منحطه بالوسط لحد ما ينحدد موقعه
    if (dist(p, RAMTHA_C) <= RAMTHA_CENTER_KM) return "ramtha_center";
    return p[1] > RAMTHA_C[1] ? "ramtha_east" : "ramtha_west";
  }
  if (has(text, SAREEH.names) || near(p, SAREEH.pts, SAREEH.km)) return "irbid_sareeh";
  if (String(district || "").includes("كنان") || has(text, KANANA.names)) return "irbid_kanana";
  // بني كنانة تقريبًا: شمال غرب إربد
  if (p && p[0] >= 32.63 && p[0] <= 32.73 && p[1] >= 35.65 && p[1] <= 35.86) return "irbid_kanana";
  if (p && dist(p, IRBID_C) <= 6) return "irbid_center";
  if (!p && (has(city, ["إربد", "اربد"]) || nk(district) === nk("قصبة إربد"))) return "irbid_center";
  return null;
}

// بنعمل المناطق إذا مش موجودة. بترجّع { key: line_id } — المنطقة اللي انحذفت/توقفت ما منستعملها
export async function ensureZones(q = query) {
  const rows = (await q("SELECT id, zone_key, active FROM f_lines WHERE zone_key IS NOT NULL")).rows;
  const map = {};
  for (const z of ZONES) {
    let r = rows.find((x) => x.zone_key === z.key);
    if (!r) {
      // في قائمة بنفس الاسم؟ منربطها بدل ما نكرر
      const same = (await q("SELECT id, active FROM f_lines WHERE name = $1 AND zone_key IS NULL ORDER BY active DESC, id LIMIT 1", [z.name])).rows[0];
      if (same) { await q("UPDATE f_lines SET zone_key = $1, governorate = COALESCE(governorate, $2) WHERE id = $3", [z.key, z.gov, same.id]); r = { id: same.id, active: same.active }; }
      else r = (await q("INSERT INTO f_lines (name, governorate, zone_key) VALUES ($1,$2,$3) RETURNING id, active", [z.name, z.gov, z.key])).rows[0];
    }
    // المناطق ثابتة: لو انحذفت بترجع (وزباينها معها)
    if (!r.active) await q("UPDATE f_lines SET active = true, name = $2, governorate = $3 WHERE id = $1", [r.id, z.name, z.gov]);
    // قائمة ثانية انكتبت باليد بنفس الاسم؟ منجمعها بالمنطقة الثابتة
    const dups = (await q("SELECT id, name FROM f_lines WHERE zone_key IS NULL AND id <> $1", [r.id])).rows.filter((x) => sameZoneName(x.name, z.name));
    for (const d of dups) {
      await q("UPDATE f_customers SET line_id = $1 WHERE line_id = $2", [r.id, d.id]);
      await q("UPDATE f_lines SET active = false WHERE id = $1", [d.id]);
    }
    map[z.key] = r.id;
  }
  return map;
}

// «الشجره الطره مراوه ذنيبه» = «الشجرة والطرة وعمراوة والذنيبة»: كلمتين أو أكثر مشتركات (أو نفس الاسم)
const toks = (n) => String(n || "").split(/[\s،,\-–/]+/).map((w) => nk(w.replace(/^و(?=ال)/, ""))).filter((w) => w.length > 1 && !["منطقه", "لواء", "طرف", "وسط"].includes(w));
function sameZoneName(a, b) {
  if (nk(a) === nk(b)) return true;
  const A = toks(a), B = toks(b);
  const hit = A.filter((w) => B.some((x) => x === w || (w.length > 3 && (x.includes(w) || w.includes(x))))).length;
  return hit >= 2;
}

const ZONE_GOV = Object.fromEntries(ZONES.map((z) => [z.key, z.gov]));

// ---------- الحدود المرسومة على الخريطة ----------
// النقطة جوّا المضلع؟ (ray casting) — النقاط [lat, lng]
export function inPoly(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i], [yj, xj] = poly[j];
    if ((yi > p[0]) !== (yj > p[0]) && p[1] < ((xj - xi) * (p[0] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const polyArea = (poly) => Math.abs(poly.reduce((a, [y, x], i) => { const [y2, x2] = poly[(i + 1) % poly.length]; return a + x * y2 - x2 * y; }, 0)) / 2;
export function cleanPolygon(v) {
  if (v == null) return null;
  if (!Array.isArray(v)) throw new Error("الحدود غير صحيحة.");
  const pts = v.map((x) => [Number(x?.[0]), Number(x?.[1])]).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a) <= 90 && Math.abs(b) <= 180);
  if (pts.length < 3) throw new Error("ارسم ٣ نقاط على الأقل.");
  return pts.slice(0, 300).map(([a, b]) => [Math.round(a * 1e6) / 1e6, Math.round(b * 1e6) / 1e6]);
}

async function context(q) {
  const map = await ensureZones(q);
  const rows = (await q("SELECT id, governorate, zone_key, polygon FROM f_lines WHERE active AND polygon IS NOT NULL")).rows;
  const polys = rows.map((r) => ({ id: r.id, gov: r.governorate, key: r.zone_key, pts: typeof r.polygon === "string" ? JSON.parse(r.polygon) : r.polygon }))
    .filter((r) => Array.isArray(r.pts) && r.pts.length >= 3).map((r) => ({ ...r, area: polyArea(r.pts) })).sort((a, b) => a.area - b.area);
  return { map, polys, autoIds: new Set([...Object.values(map), ...polys.map((x) => x.id)]), drawnKeys: new Set(polys.map((x) => x.key).filter(Boolean)) };
}

// زبون واحد (بعد الحفظ)
export async function autoZoneCustomer(id, q = query) {
  const c = (await q("SELECT id, city, address, governorate, district, lat, lng, line_id, line_manual FROM f_customers WHERE id = $1", [id])).rows[0];
  if (!c || c.line_manual) return null;
  return applyZone(c, await context(q), q);
}

async function applyZone(c, ctx, q) {
  const p = c.lat != null && c.lng != null && Number(c.lat) ? [Number(c.lat), Number(c.lng)] : null;
  // ١) جوّا حدود مرسومة؟ هي اللي بتقرر (أصغر منطقة إذا تداخلوا)
  const hit = p && ctx.polys.find((z) => inPoly(p, z.pts));
  let lineId = null, gov = null;
  if (hit) { lineId = hit.id; gov = hit.gov; }
  else {
    // قائمة يدوية قديمة (مش منطقة تلقائية ولا مرسومة)؟ ما منلمسها
    if (c.line_id && !ctx.autoIds.has(c.line_id)) return null;
    const key = zoneKeyFor(c);
    // المنطقة الثابتة اللي إلها حدود مرسومة: الحدود بس بتقرر
    if (key && !ctx.drawnKeys.has(key)) { lineId = ctx.map[key] || null; gov = ZONE_GOV[key]; }
    if (!lineId) {
      // كان بمنطقة مرسومة وطلع برّاها؟ منشيله منها
      if (c.line_id && ctx.polys.some((z) => z.id === c.line_id)) { await q("UPDATE f_customers SET line_id = NULL WHERE id = $1", [c.id]); return null; }
      return null;
    }
  }
  if (lineId === c.line_id) return lineId;
  const ramtha = String(gov || "").replace(/[أإآ]/g, "ا") === "الرمثا";
  // زبون الرمثا بدون لواء: منحطله «الرمثا» عشان يطلع تحت الرمثا
  const district = ramtha && !c.district ? "الرمثا" : c.district;
  const governorate = c.governorate || (ramtha || !gov ? "إربد" : gov);
  await q("UPDATE f_customers SET line_id = $1, district = $2, governorate = $3 WHERE id = $4", [lineId, district, governorate, c.id]);
  return lineId;
}

// كل الزباين (أول تشغيل وكل شوي): اللي مش يدوي
export async function autoZoneAll(q = query) {
  const ctx = await context(q);
  const rows = (await q("SELECT id, city, address, governorate, district, lat, lng, line_id, line_manual FROM f_customers WHERE active AND NOT line_manual")).rows;
  let n = 0;
  for (const c of rows) {
    const before = c.line_id;
    const after = await applyZone(c, ctx, q);
    if (after && after !== before) n++;
  }
  return n;
}
