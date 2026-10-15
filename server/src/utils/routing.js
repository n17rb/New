import { query } from "../db.js";

// ============================================================
// محرك ترتيب مسار التوزيع
// - بيبدأ من موقع السائق (أو من المحل)
// - بيمر على كل الطلبات بأقصر طريق ممكن
// - وبيخلص دايمًا بالرجوع للمحل (لو موقع المحل محفوظ)
// ============================================================

export function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function fetchJsonWithTimeout(url, ms) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// مسافات وأوقات السواقة الحقيقية بين كل النقاط (متر وثانية).
// لو خدمة الخرائط ما ردّت: مسافة مباشرة × ١.٣ (لف الشوارع) وسرعة ٢٨ كم/س.
const FALLBACK_ROAD_FACTOR = 1.3;
const FALLBACK_SPEED_MS = 28 / 3.6;

export async function buildMatrix(points) {
  const n = points.length;
  let distances = null;
  let durations = null;
  if (n >= 2 && n <= 90) {
    const coords = points.map((p) => `${p.lon},${p.lat}`).join(";");
    const data = await fetchJsonWithTimeout(
      `https://router.project-osrm.org/table/v1/driving/${coords}?annotations=distance,duration`,
      8000
    );
    if (data && data.code === "Ok" && data.distances && data.durations) {
      const ok = data.distances.every((row) => row.every((v) => v != null)) && data.durations.every((row) => row.every((v) => v != null));
      if (ok) {
        distances = data.distances;
        durations = data.durations;
      }
    }
  }
  const road = !!distances;
  const dist = (i, j) => {
    if (i === j) return 0;
    if (distances) return distances[i][j];
    return distanceKm(points[i].lat, points[i].lon, points[j].lat, points[j].lon) * 1000 * FALLBACK_ROAD_FACTOR;
  };
  const dur = (i, j) => {
    if (i === j) return 0;
    if (durations) return durations[i][j];
    return dist(i, j) / FALLBACK_SPEED_MS;
  };
  return { dist, dur, road };
}

export async function getRouteGeometry(orderedPoints) {
  if (orderedPoints.length < 2 || orderedPoints.length > 80) return null;
  const coords = orderedPoints.map((p) => `${p.lon},${p.lat}`).join(";");
  const data = await fetchJsonWithTimeout(
    `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`,
    7000
  );
  if (!data || data.code !== "Ok" || !data.routes?.[0]?.geometry) return null;
  return data.routes[0].geometry.coordinates;
}

// ------------------------------------------------------------
// حل المسار (الأذكى):
// - الكلفة = وقت السواقة الحقيقي (+ شوية للمسافة) — مش بس الكيلومترات
// - الطلبات اللي إلها ساعة محددة: بتنحط بالمكان اللي بيوصل فيه الكابتن قريب من موعدها
// - حل دقيق ١٠٠٪ للرحلات الصغيرة، وبحث محلي متقدم (2-opt + or-opt + قفزات عشوائية) للكبيرة
// ------------------------------------------------------------
export const SERVICE_SECONDS = 4 * 60;
const EARLY_SLACK = 15 * 60; // مقبول نوصل قبل الموعد بربع ساعة
const LATE_SLACK = 30 * 60; // ومقبول نتأخر نص ساعة
const LATE_PENALTY = 6; // كل ثانية تأخير بعد هيك بتنحسب ٦ ثواني
const WAIT_PENALTY = 0.4; // الانتظار أرخص من السواقة بس مش مجاني
const METER_WEIGHT = 0.04; // ١ كم = ٤٠ ثانية — بيفضّل الطريق الأقصر لما الوقت متقارب

export function solvePath(startIdx, nodes, endIdx, matrix, { windows = null, timeBudgetMs = 700 } = {}) {
  if (nodes.length <= 1) return [...nodes];
  const { dist, dur } = matrix;
  const END_FREE = endIdx == null;
  const edge = (a, b) => dur(a, b) + METER_WEIGHT * dist(a, b);

  function cost(order) {
    let total = 0;
    let t = 0;
    let prev = startIdx;
    for (const n of order) {
      const e = edge(prev, n);
      total += e;
      t += dur(prev, n);
      const target = windows && windows.get(n);
      if (target != null) {
        const early = target - EARLY_SLACK;
        if (t < early) {
          total += (early - t) * WAIT_PENALTY;
          t = early;
        }
        const late = t - (target + LATE_SLACK);
        if (late > 0) total += late * LATE_PENALTY;
      }
      t += SERVICE_SECONDS;
      prev = n;
    }
    if (!END_FREE) total += edge(prev, endIdx);
    return total;
  }

  // رحلة صغيرة (٨ طلبات أو أقل): منجرّب كل الاحتمالات ومنختار الأحسن
  if (nodes.length <= 8) {
    let best = null;
    let bestCost = Infinity;
    const arr = [...nodes];
    const used = new Array(arr.length).fill(false);
    const cur = [];
    (function permute() {
      if (cur.length === arr.length) {
        const c = cost(cur);
        if (c < bestCost) { bestCost = c; best = [...cur]; }
        return;
      }
      for (let i = 0; i < arr.length; i++) {
        if (used[i]) continue;
        used[i] = true;
        cur.push(arr[i]);
        permute();
        cur.pop();
        used[i] = false;
      }
    })();
    return best;
  }

  function nearestNeighbor() {
    const left = [...nodes];
    const order = [];
    let current = startIdx;
    while (left.length) {
      let bestPos = 0;
      let best = Infinity;
      left.forEach((n, pos) => {
        const v = edge(current, n);
        if (v < best) { best = v; bestPos = pos; }
      });
      current = left.splice(bestPos, 1)[0];
      order.push(current);
    }
    return order;
  }

  function cheapestInsertion() {
    const left = [...nodes];
    let farPos = 0;
    let far = -1;
    left.forEach((n, pos) => {
      const v = edge(startIdx, n);
      if (v > far) { far = v; farPos = pos; }
    });
    const order = [left.splice(farPos, 1)[0]];
    while (left.length) {
      let bestNodePos = 0;
      let bestInsertAt = 0;
      let bestDelta = Infinity;
      left.forEach((n, pos) => {
        for (let k = 0; k <= order.length; k++) {
          const prev = k === 0 ? startIdx : order[k - 1];
          const next = k === order.length ? (END_FREE ? null : endIdx) : order[k];
          const delta = edge(prev, n) + (next == null ? 0 : edge(n, next) - edge(prev, next));
          if (delta < bestDelta) { bestDelta = delta; bestNodePos = pos; bestInsertAt = k; }
        }
      });
      const node = left.splice(bestNodePos, 1)[0];
      order.splice(bestInsertAt, 0, node);
    }
    return order;
  }

  // الطلبات اللي إلها موعد مرتبة حسب الموعد كبداية ثالثة
  function byWindows() {
    if (!windows || windows.size === 0) return null;
    const timed = nodes.filter((n) => windows.has(n)).sort((a, b) => windows.get(a) - windows.get(b));
    const free = nodes.filter((n) => !windows.has(n));
    const order = [...timed];
    for (const n of free) {
      let bestAt = 0;
      let bestC = Infinity;
      for (let k = 0; k <= order.length; k++) {
        const cand = [...order.slice(0, k), n, ...order.slice(k)];
        const c = cost(cand);
        if (c < bestC) { bestC = c; bestAt = k; }
      }
      order.splice(bestAt, 0, n);
    }
    return order;
  }

  const deadline = Date.now() + timeBudgetMs;

  // limited=false: تحسين كامل لحد ما يوقف التحسن (للبدايات) — limited=true: ضمن الوقت (للقفزات)
  function improve(orderIn, limited = false) {
    let order = [...orderIn];
    let bestCost = cost(order);
    let improved = true;
    let rounds = 0;
    while (improved && rounds < 30 && (!limited || Date.now() < deadline)) {
      improved = false;
      rounds++;
      for (let i = 0; i < order.length - 1; i++) {
        for (let j = i + 1; j < order.length; j++) {
          const candidate = [...order.slice(0, i), ...order.slice(i, j + 1).reverse(), ...order.slice(j + 1)];
          const c = cost(candidate);
          if (c < bestCost - 1e-6) { order = candidate; bestCost = c; improved = true; }
        }
      }
      for (let segLen = 1; segLen <= 3; segLen++) {
        for (let i = 0; i + segLen <= order.length; i++) {
          const segment = order.slice(i, i + segLen);
          const rest = [...order.slice(0, i), ...order.slice(i + segLen)];
          for (let k = 0; k <= rest.length; k++) {
            if (k === i) continue;
            for (const seg of segLen > 1 ? [segment, [...segment].reverse()] : [segment]) {
              const candidate = [...rest.slice(0, k), ...seg, ...rest.slice(k)];
              const c = cost(candidate);
              if (c < bestCost - 1e-6) { order = candidate; bestCost = c; improved = true; }
            }
          }
        }
      }
    }
    return { order, cost: bestCost };
  }

  // «القفزة»: بنكسر المسار لأربع قطع ومنرتبهم من جديد — بيطلعنا من الحلول المحلية
  let seed = 12345;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  function doubleBridge(order) {
    const n = order.length;
    if (n < 8) return [...order].reverse();
    const cuts = [1 + Math.floor(rnd() * (n / 4)), 0, 0];
    cuts[1] = cuts[0] + 1 + Math.floor(rnd() * (n / 4));
    cuts[2] = cuts[1] + 1 + Math.floor(rnd() * (n / 4));
    const [a, b, c] = cuts.map((x) => Math.min(x, n - 1));
    return [...order.slice(0, a), ...order.slice(b, c), ...order.slice(a, b), ...order.slice(c)];
  }

  const starts = [nearestNeighbor(), cheapestInsertion(), byWindows()].filter(Boolean);
  let best = null;
  for (const s of starts) {
    const r = improve(s);
    if (!best || r.cost < best.cost) best = r;
  }
  let current = best;
  let iterations = 0;
  while (Date.now() < deadline && iterations < 200) {
    iterations++;
    const r = improve(doubleBridge(current.order), true);
    if (r.cost < current.cost - 1e-6) current = r;
    if (current.cost < best.cost) best = current;
  }

  // الحلقة (من المحل وللمحل) ممكن تنمشى بالاتجاهين — منختار الأقصر، ولو متقاربين بنبدأ بالأقرب
  if (!END_FREE && endIdx === startIdx && (!windows || windows.size === 0)) {
    const reversed = [...best.order].reverse();
    const reversedCost = cost(reversed);
    const nearlyEqual = Math.abs(reversedCost - best.cost) <= best.cost * 0.03;
    if (reversedCost < best.cost - 1e-6 && !nearlyEqual) best = { order: reversed, cost: reversedCost };
    else if (nearlyEqual && edge(startIdx, reversed[0]) < edge(startIdx, best.order[0])) best = { order: reversed, cost: reversedCost };
  }
  return best.order;
}

// ------------------------------------------------------------
// optimizeRoute
// start: {lat, lon} أو null — end: {lat, lon} أو null (المحل)
// stops: [{ ...anything, latitude, longitude, priority, requested_time? }]
// mode: "nearest" (أقصر وقت) أو "urgent_smart" (المستعجل أولًا)
// ------------------------------------------------------------
export async function optimizeRoute({ start, end, stops, mode = "nearest", withGeometry = true, startTime = new Date() }) {
  const withLocation = stops.filter((s) => s.latitude != null && s.longitude != null);
  const withoutLocation = stops.filter((s) => s.latitude == null || s.longitude == null);

  if (withLocation.length === 0) {
    return {
      ordered: [...stops],
      legDistancesKm: stops.map(() => null),
      legMinutes: stops.map(() => null),
      returnLegKm: null,
      returnLegMinutes: null,
      totalDistanceKm: 0,
      totalMinutes: 0,
      distanceBeforeKm: 0,
      geometry: null,
      roadData: false,
    };
  }

  let startPoint = start && start.lat != null && start.lon != null ? start : null;
  let anchorStop = null;
  let locatedStops = withLocation;
  if (!startPoint && end) startPoint = end;
  if (!startPoint) {
    anchorStop = withLocation[0];
    startPoint = { lat: anchorStop.latitude, lon: anchorStop.longitude };
    locatedStops = withLocation.slice(1);
  }

  const points = [startPoint, ...locatedStops.map((s) => ({ lat: s.latitude, lon: s.longitude }))];
  const endIdx = end ? points.length : null;
  if (end) points.push(end);

  const matrix = await buildMatrix(points);
  const { dist, dur } = matrix;

  // نوافذ الوقت: الطلبات اللي إلها ساعة خلال الـ١٢ ساعة الجاية
  const t0 = new Date(startTime).getTime();
  const windows = new Map();
  locatedStops.forEach((s, i) => {
    if (!s.requested_time) return;
    const target = (new Date(s.requested_time).getTime() - t0) / 1000;
    if (target < 12 * 3600) windows.set(i + 1, target);
  });

  const stopIdxs = locatedStops.map((_, i) => i + 1);
  const budget = stopIdxs.length > 40 ? 500 : 800;
  let orderIdxs;

  if (mode === "urgent_smart") {
    const urgent = stopIdxs.filter((i) => locatedStops[i - 1].priority === "urgent");
    const normal = stopIdxs.filter((i) => locatedStops[i - 1].priority !== "urgent");
    if (urgent.length && normal.length) {
      const urgentOrder = solvePath(0, urgent, null, matrix, { windows, timeBudgetMs: budget / 2 });
      const normalOrder = solvePath(urgentOrder[urgentOrder.length - 1], normal, endIdx, matrix, { windows: null, timeBudgetMs: budget / 2 });
      orderIdxs = [...urgentOrder, ...normalOrder];
    } else {
      orderIdxs = solvePath(0, stopIdxs, endIdx, matrix, { windows, timeBudgetMs: budget });
    }
  } else {
    orderIdxs = solvePath(0, stopIdxs, endIdx, matrix, { windows, timeBudgetMs: budget });
  }

  const legDistances = [];
  const legMinutes = [];
  let prev = 0;
  let total = 0;
  let totalSec = 0;
  for (const idx of orderIdxs) {
    const leg = dist(prev, idx);
    legDistances.push(leg / 1000);
    legMinutes.push(dur(prev, idx) / 60);
    total += leg;
    totalSec += dur(prev, idx);
    prev = idx;
  }
  let returnLegKm = null;
  let returnLegMinutes = null;
  if (endIdx != null && orderIdxs.length) {
    returnLegKm = dist(prev, endIdx) / 1000;
    returnLegMinutes = dur(prev, endIdx) / 60;
    total += dist(prev, endIdx);
    totalSec += dur(prev, endIdx);
  }

  let before = 0;
  let p = 0;
  for (const idx of stopIdxs) { before += dist(p, idx); p = idx; }
  if (endIdx != null && stopIdxs.length) before += dist(p, endIdx);

  const orderedLocated = orderIdxs.map((idx) => locatedStops[idx - 1]);

  let geometry = null;
  if (withGeometry) {
    const geoPoints = [startPoint, ...orderedLocated.map((s) => ({ lat: s.latitude, lon: s.longitude }))];
    if (end) geoPoints.push(end);
    geometry = await getRouteGeometry(geoPoints);
  }

  const ordered = anchorStop ? [anchorStop, ...orderedLocated] : orderedLocated;
  const legs = anchorStop ? [0, ...legDistances] : legDistances;
  const legMins = anchorStop ? [0, ...legMinutes] : legMinutes;

  return {
    ordered: [...ordered, ...withoutLocation],
    legDistancesKm: [...legs, ...withoutLocation.map(() => null)],
    legMinutes: [...legMins, ...withoutLocation.map(() => null)],
    returnLegKm,
    returnLegMinutes,
    totalDistanceKm: total / 1000,
    totalMinutes: totalSec / 60,
    distanceBeforeKm: before / 1000,
    geometry,
    roadData: matrix.road,
  };
}

// ------------------------------------------------------------
// موقع المحل
// ------------------------------------------------------------
export async function getShopLocation() {
  const result = await query(
    "SELECT key, value FROM app_settings WHERE key IN ('shop_latitude','shop_longitude')"
  );
  const map = Object.fromEntries(result.rows.map((r) => [r.key, r.value]));
  const lat = Number(map.shop_latitude);
  const lon = Number(map.shop_longitude);
  if (!map.shop_latitude || !map.shop_longitude || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

export async function setShopLocation(lat, lon) {
  await query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ('shop_latitude', $1, now()), ('shop_longitude', $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [String(lat), String(lon)]
  );
}

export function isValidLatLon(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);
}

// يطلع الإحداثيات من نص رابط خرائط جوجل أو من "lat, lng"
export function parseCoordsFromText(text, strict = false) {
  if (!text) return null;
  let decoded = String(text);
  try { decoded = decodeURIComponent(decoded); } catch { /* نص فيه % مش مرمّز — منكمل عليه زي ما هو */ }
  const patterns = [
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,
    /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,
    /[?&](?:q|query|ll|destination|center)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
  ];
  if (!strict) {
    patterns.push(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
    patterns.push(/(-?\d{1,2}\.\d{3,})\s*,\s*(-?\d{1,3}\.\d{3,})/);
  }
  for (const re of patterns) {
    const m = decoded.match(re);
    if (m) {
      const lat = Number(m[1]);
      const lon = Number(m[2]);
      if (isValidLatLon(lat, lon)) return { lat, lon };
    }
  }
  return null;
}

// يفتح الروابط المختصرة (maps.app.goo.gl) ويطلع منها الإحداثيات
export async function resolveCoordsFromMapsLink(link) {
  const direct = parseCoordsFromText(link);
  if (direct) return direct;
  if (!/^https?:\/\//i.test(String(link || "").trim())) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(String(link).trim(), {
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36" },
    });
    const fromUrl = parseCoordsFromText(res.url);
    if (fromUrl) return fromUrl;
    const html = await res.text();
    return parseCoordsFromText(html.slice(0, 200000), true);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
