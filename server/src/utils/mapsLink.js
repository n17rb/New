// ============================================================
// قراءة الموقع من أي اشي ملصوق: رابط خرائط جوجل (قصير أو طويل)، رسالة مشاركة كاملة
// (اسم المحل + العنوان + الرابط)، رابط واتساب، أو إحداثيات «31.95, 35.91»
// ============================================================

const UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36";
const BOT_UA = "curl/8.5.0";
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
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
  const s = decodeAll(unescapeHtml(html));
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
// منطقة الشغل (الأردن وحواليه): أي موقع جاي من صفحة جوجل وطالع برّاها بيكون غلط
// (جوجل لما ما تعرف المكان بتفتح على موقع السيرفر نفسه بأمريكا)
const BOX = (process.env.SERVICE_BBOX || "29,34.8,33.6,39.4").split(",").map(Number);
function inArea(p) {
  return p && p.lat > BOX[0] && p.lat < BOX[2] && p.lng > BOX[1] && p.lng < BOX[3] ? p : null;
}
function appCenter(html) {
  const m = String(html || "").match(/APP_INITIALIZATION_STATE=\[\[\[\s*[\d.]+\s*,\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*\]/);
  if (!m) return null;
  const lng = +m[1], lat = +m[2];
  return valid(lat, lng) && inArea({ lat, lng }) ? { lat, lng } : null;
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
    const r = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(text)}&region=jo&components=country:JO&language=ar&key=${encodeURIComponent(key)}`);
    const j = await r.json();
    const loc = j?.results?.[0]?.geometry?.location;
    return loc && valid(loc.lat, loc.lng) ? inArea({ lat: loc.lat, lng: loc.lng }) : null;
  } catch { return null; }
}

// الدالة الرئيسية: بترجّع { lat, lng } أو null
export async function resolveMapsLink(input, opts = {}) {
  const text = String(input || "").trim();
  if (!text) return null;
  const direct = coordsIn(text);
  if (direct) return direct;

  const url = text.match(/https?:\/\/[^\s"'<>]+/)?.[0]?.replace(/[)\].,،]+$/, "");
  if (!url || !GOOGLE_HOST.test(url)) return null;

  let query = placeQuery(url);
  const trail = opts.trail || [];
  // بنجرّب بأكثر من «هوية»: جوجل أحيانا بتعطي تحويل مباشر لبرنامج بسيط، وصفحة كاملة للمتصفح
  for (const ua of [BOT_UA, UA, IPHONE_UA]) {
    const got = await follow(url, ua, trail);
    query = got.query || query;
    const c = inArea(coordsIn(got.cur, { loose: false })) || inArea(coordsInHtml(got.html));
    if (c) return c;
    const ac = appCenter(got.html);
    if (ac && !query) return ac;
    if (got.html && ac) { const g = query ? await geocodeText(query) : null; return g || ac; }
  }
  const g = query ? await geocodeText(query) : null;
  if (g) return g;
  console.error("maps link failed:", url, "|", trail.join(" -> ").slice(0, 1500));
  return null;
}

// يمشي ورا التحويلات (العادية + اللي جوّا الصفحة) وبيرجّع آخر رابط وصفحة
async function follow(start, ua, trail) {
  let cur = start, html = "", query = null;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 9000);
  try {
    for (let i = 0; i < 8; i++) {
      if (coordsIn(cur, { loose: false })) break;
      query = placeQuery(cur) || query;
      const host = (() => { try { return new URL(cur).hostname; } catch { return ""; } })();
      if (host.startsWith("consent.")) {
        // صفحة الموافقة على الكوكيز (سيرفرات أوروبا) — الرابط الحقيقي جوّا continue
        const cont = new URL(cur).searchParams.get("continue");
        if (cont) { cur = cont; trail.push("consent"); continue; }
      }
      if (/(^|\.)google\.[a-z.]+$/i.test(host) && /\/maps/.test(cur) && !/[?&]gl=/.test(cur)) cur += (cur.includes("?") ? "&" : "?") + "hl=ar&gl=jo";
      const r = await fetch(cur, {
        redirect: "manual",
        signal: ctl.signal,
        headers: {
          "User-Agent": ua,
          Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
          "Accept-Language": "ar,en;q=0.8",
          Cookie: "CONSENT=YES+cb.20240101-00-p0.ar+FX+000; SOCS=CAISHAgBEhJnd3NfMjAyNDAxMDEtMF9SQzIaAmFyIAEaBgiA_LyaBg",
        },
      });
      const loc = r.headers.get("location");
      trail.push(`${r.status}${loc ? " " + loc.slice(0, 160) : ""}`);
      if (r.status >= 300 && r.status < 400 && loc) { cur = new URL(loc, cur).href; continue; }
      html = (await r.text()).slice(0, 800000);
      // تحويل جوّا الصفحة (meta refresh أو JavaScript) — منكمل وراه
      const next = /(^|\.)google\.[a-z.]+$/i.test(host) && !host.startsWith("consent.") ? null : innerRedirect(html, cur);
      if (next && next !== cur && !coordsInHtml(html)) { trail.push("html->" + next.slice(0, 120)); cur = next; html = ""; continue; }
      if (r.status >= 400) trail.push("body:" + html.replace(/\s+/g, " ").slice(0, 120));
      break;
    }
  } catch (e) { trail.push("err:" + (e?.name || e)); } finally { clearTimeout(timer); }
  return { cur, html, query };
}

function unescapeHtml(s) {
  return String(s || "")
    .replace(/&amp;/g, "&").replace(/&#39;|&#x27;/g, "'").replace(/&quot;/g, '"')
    .replace(/\\x([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\\//g, "/");
}
function innerRedirect(html, base) {
  if (!html) return null;
  const s = unescapeHtml(html);
  const m = s.match(/http-equiv=["']?refresh["']?[^>]*content=["'][^"']*url=([^"'>\s]+)/i)
    || s.match(/(?:location\.(?:href|replace)\s*(?:=|\()\s*["'])(https?:\/\/[^"']+)/i)
    || s.match(/["'](https:\/\/(?:www\.|maps\.)?google\.[a-z.]+\/maps[^"'\s<>]*)["']/i);
  if (!m) return null;
  try { return new URL(m[1], base).href; } catch { return null; }
}
