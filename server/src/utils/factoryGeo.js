// ============================================================
// باقة المصانع: مواقع المدن الأردنية وحساب المسافات والمواعيد
// إذا الزبون ما إله موقع محفوظ، منستعمل موقع مدينته التقريبي.
// ============================================================

export const CITIES = {
  "عمّان": [31.9539, 35.9106],
  "سحاب": [31.8722, 36.0047],
  "الزرقاء": [32.0728, 36.088],
  "الرصيفة": [32.0178, 36.0464],
  "إربد": [32.5556, 35.85],
  "الرمثا": [32.559, 36.0069],
  "الطرّة": [32.638, 35.989],
  "المفرق": [32.3429, 36.208],
  "جرش": [32.2803, 35.8993],
  "عجلون": [32.3326, 35.7517],
  "السلط": [32.0392, 35.7272],
  "مادبا": [31.716, 35.7939],
  "الكرك": [31.1853, 35.7048],
  "الطفيلة": [30.8375, 35.6042],
  "معان": [30.1962, 35.734],
  "العقبة": [29.5321, 35.0063],
  "الأغوار": [32.1, 35.6],
};

export const GOVERNORATES = ["عمّان", "الزرقاء", "إربد", "المفرق", "جرش", "عجلون", "البلقاء", "مادبا", "الكرك", "الطفيلة", "معان", "العقبة"];

function normCity(name) {
  return String(name || "").trim().replace("عمان", "عمّان").replace("الطرة", "الطرّة");
}

export function cityPoint(name) {
  const n = normCity(name);
  if (CITIES[n]) return CITIES[n];
  const hit = Object.keys(CITIES).find((k) => n.includes(k) || k.includes(n));
  return hit ? CITIES[hit] : null;
}

export function pointOf(c) {
  if (c && c.lat != null && c.lng != null) return [Number(c.lat), Number(c.lng)];
  return cityPoint(c?.city);
}

export function km(a, b) {
  if (!a || !b) return null;
  const R = 6371;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLng = ((b[1] - a[1]) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((a[0] * Math.PI) / 180) * Math.cos((b[0] * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  // الطرق مش خط مستقيم: منزيد ٢٥٪ تقريبًا
  return Math.round(2 * R * Math.asin(Math.sqrt(x)) * 1.25);
}

const SPEED = 55; // كم/ساعة معدل
const STOP_MIN = 25; // دقائق تنزيل عند كل زبون

// بيحسب مسافة كل وقفة وموعد الوصول المتوقع، من المصنع وبالترتيب
export function planStops(factory, stops, { date, departTime = "08:00", startAt = null } = {}) {
  const [h, m] = String(departTime).split(":").map(Number);
  const base = startAt ? new Date(startAt) : new Date(`${date}T${String(h || 8).padStart(2, "0")}:${String(m || 0).padStart(2, "0")}:00+03:00`);
  let t = base.getTime();
  let prev = factory;
  let total = 0;
  return {
    legs: stops.map((s) => {
      const p = pointOf(s);
      const d = prev && p ? km(prev, p) : null;
      if (d != null) {
        total += d;
        t += (d / SPEED) * 3600000;
      } else {
        t += 30 * 60000;
      }
      const eta = new Date(t);
      t += STOP_MIN * 60000;
      if (p) prev = p;
      return { ...s, leg_km: d, eta_at: eta.toISOString() };
    }),
    total_km: total,
  };
}

// ترتيب من الأقرب للأبعد عن المصنع
// سلسلة: من نقطة البداية للأقرب، ومن عنده للأقرب منه… (أحسن من الترتيب حسب البعد عن البداية)
export function chainNearest(start, stops) {
  const left = [...stops];
  const out = [];
  let at = start;
  while (left.length) {
    let bi = 0, bd = Infinity;
    left.forEach((s, i) => { const d = at ? km(at, pointOf(s)) : null; const v = d == null ? 9999 : d; if (v < bd) { bd = v; bi = i; } });
    const [n] = left.splice(bi, 1);
    out.push(n);
    at = pointOf(n) || at;
  }
  return out;
}

export function sortNearest(factory, stops) {
  return [...stops].sort((a, b) => (km(factory, pointOf(a)) ?? 9999) - (km(factory, pointOf(b)) ?? 9999));
}

// ترتيب الوقفات: المستعجل أول، وبعدين كل وقفة لأقرب وحدة إلها (المحلات القريبة من بعض ورا بعض)
export function smartOrder(start, stops) {
  const urgent = chainNearest(start, stops.filter((s) => s.urgent));
  const last = urgent.length ? pointOf(urgent[urgent.length - 1]) || start : start;
  return [...urgent, ...chainNearest(last, stops.filter((s) => !s.urgent))];
}
