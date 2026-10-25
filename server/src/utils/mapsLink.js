// ============================================================
// قراءة الموقع من أي اشي ملصوق: رابط خرائط جوجل (قصير أو طويل)، رسالة مشاركة كاملة
// (اسم المحل + العنوان + الرابط)، رابط واتساب، أو إحداثيات «31.95, 35.91»
// ============================================================

const UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36";
const GOOGLE_HOST = /^https?:\/\/([a-z0-9-]+\.)*(goo\.gl|google\.[a-z.]+|g\.co|googleusercontent\.com)(\/|$)/i;

function valid(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
}
function decodeAll(s) {
  let out = String(s || "");
  for (let i = 0; i < 3; i++) {
    try { const d = decodeURIComponent(out); if (d === out) break; out = d; } catch { break; }
  }
  return out.replace(/\\u003d/g, "=").replace(/\\u0026/g, "&").replace(/\\\//g, "/");
}

// إحداثيات مكتوبة جوّا نص أو رابط
export function coordsIn(text, { loose = true } = {}) {
  if (!text) return null;
  const s = decodeAll(text);
  const pats = [
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,                         // مكان محدد (الأدق)
    /[?&](?:q|query|ll|sll|destination|daddr|center|loc)=(?:loc:)?(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/,
    /\/maps\/(?:search|dir|place)\/[^/]*?(-?\d{1,2}\.\d{3,})\s*,\s*\+?(-?\d{1,3}\.\d{3,})/,
    /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,
  ];
  if (loose) pats.push(/^\s*(-?\d{1,2}(?:\.\d+)?)\s*[,،]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/, /(-?\d{1,2}\.\d{3,})\s*[,،]\s*(-?\d{1,3}\.\d{3,})/);
  for (const re of pats) {
    const m = s.match(re);
    if (m) {
      const lat = Number(m[1]), lng = Number(m[2]);
      if (valid(lat, lng)) return { lat, lng };
    }
  }
  return null;
}

// من صفحة جوجل نفسها (لما الرابط ما فيه أرقام، بس اسم المحل)
function coordsInHtml(html) {
  if (!html) return null;
  const s = decodeAll(html);
  // صورة الخريطة الصغيرة بالصفحة: center=lat,lng أو markers=lat,lng
  let m = s.match(/staticmap\?[^"'\s]*?(?:center|markers)=(-?\d+\.\d+)(?:,|%2C)(-?\d+\.\d+)/i);
  if (m && valid(+m[1], +m[2])) return { lat: +m[1], lng: +m[2] };
  m = s.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if (m && valid(+m[1], +m[2])) return { lat: +m[1], lng: +m[2] };
  m = s.match(/https:\/\/www\.google\.[a-z.]+\/maps\/[^"'\s<>]*@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (m && valid(+m[1], +m[2])) return { lat: +m[1], lng: +m[2] };
  return null;
}
// مركز الخريطة اللي جوجل فتحها عليه (بنقبله بس إذا داخل الأردن والمنطقة، عشان ما ناخذ مركز عشوائي)
function appCenter(html) {
  const m = String(html || "").match(/APP_INITIALIZATION_STATE=\[\[\[\s*[\d.]+\s*,\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*\]/);
  if (!m) return null;
  const lng = +m[1], lat = +m[2];
  return valid(lat, lng) && lat > 29 && lat < 33.6 && lng > 34.8 && lng < 39.4 ? { lat, lng } : null;
}

// اسم المكان من الرابط (?q=سوبرماركت النور، عمّان) — للبحث عنه إذا ما لقينا أرقام
function placeQuery(url) {
  try {
    const u = new URL(url);
    const q = u.searchParams.get("q") || u.searchParams.get("query") || u.searchParams.get("daddr") || "";
    if (q && !coordsIn(q)) return q;
    const p = decodeAll(u.pathname).match(/\/maps\/(?:place|search)\/([^/@]+)/);
    if (p) return p[1].replace(/\+/g, " ");
  } catch { /* رابط مش مفهوم */ }
  return null;
}

// بحث عن الاسم بجوجل (بيشتغل إذا «Geocoding API» مفعّلة على نفس مفتاح GOOGLE_MAPS_KEY — اختياري)
async function geocodeText(text) {
  const key = process.env.GOOGLE_MAPS_KEY;
  if (!key || !text) return null;
  try {
    const r = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(text)}&region=jo&language=ar&key=${encodeURIComponent(key)}`);
    const j = await r.json();
    const loc = j?.results?.[0]?.geometry?.location;
    return loc && valid(loc.lat, loc.lng) ? { lat: loc.lat, lng: loc.lng } : null;
  } catch { return null; }
}

// الدالة الرئيسية: بترجّع { lat, lng } أو null
export async function resolveMapsLink(input) {
  const text = String(input || "").trim();
  if (!text) return null;
  const direct = coordsIn(text);
  if (direct) return direct;

  const url = text.match(/https?:\/\/[^\s"'<>]+/)?.[0]?.replace(/[)\].,،]+$/, "");
  if (!url || !GOOGLE_HOST.test(url)) return null;

  let cur = url;
  let query = placeQuery(url);
  let html = "";
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 12000);
  try {
    // بنمشي ورا التحويلات وحدة وحدة، وبنفحص كل رابط بالطريق (أحيانا الأرقام بتكون بالنص)
    for (let i = 0; i < 8; i++) {
      const c = coordsIn(cur, { loose: false });
      if (c) return c;
      query = placeQuery(cur) || query;
      const host = (() => { try { return new URL(cur).hostname; } catch { return ""; } })();
      if (host.startsWith("consent.")) {
        // صفحة الموافقة على الكوكيز (سيرفرات أوروبا) — الرابط الحقيقي جوّا continue
        const cont = new URL(cur).searchParams.get("continue");
        if (cont) { cur = cont; continue; }
      }
      const r = await fetch(cur, {
        redirect: "manual",
        signal: ctl.signal,
        headers: {
          "User-Agent": UA,
          "Accept-Language": "ar,en;q=0.8",
          Cookie: "CONSENT=YES+cb.20240101-00-p0.ar+FX+000; SOCS=CAISHAgBEhJnd3NfMjAyNDAxMDEtMF9SQzIaAmFyIAEaBgiA_LyaBg",
        },
      });
      const loc = r.headers.get("location");
      if (r.status >= 300 && r.status < 400 && loc) { cur = new URL(loc, cur).href; continue; }
      html = (await r.text()).slice(0, 800000);
      break;
    }
  } catch { /* انقطع — منكمل باللي معنا */ } finally { clearTimeout(timer); }

  return coordsIn(cur, { loose: false })
    || coordsInHtml(html)
    || (query ? await geocodeText(query) : null)
    || appCenter(html);
}
