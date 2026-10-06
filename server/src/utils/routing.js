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

// مسافات الطرق الحقيقية بين كل النقاط (بالمتر) — لو فشلت بنرجع للمسافة المباشرة
async function getRoadDistanceMatrix(points) {
  if (points.length < 2 || points.length > 80) return null;
  const coords = points.map((p) => `${p.lon},${p.lat}`).join(";");
  const data = await fetchJsonWithTimeout(
    `https://router.project-osrm.org/table/v1/driving/${coords}?annotations=distance`,
    7000
  );
  if (!data || data.code !== "Ok" || !data.distances) return null;
  // لو في خانة فاضية (نقطة ما إلها طريق) نعتبر الجدول غير صالح
  for (const row of data.distances) {
    for (const v of row) if (v == null) return null;
  }
  return data.distances;
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
// حل مسار: من نقطة بداية، على كل النقاط، لنقطة نهاية ثابتة (أو نهاية حرة)
// dist(i, j) بترجع المسافة بالمتر. الحسابات كلها على كامل المسار
// عشان تشتغل صح حتى مع الشوارع اللي باتجاه واحد.
// ------------------------------------------------------------
function solvePath(startIdx, nodes, endIdx, dist) {
  if (nodes.length <= 1) return [...nodes];

  const d = (a, b) => (b === "END_FREE" || a === "END_FREE" ? 0 : dist(a, b));
  const end = endIdx == null ? "END_FREE" : endIdx;

  function cost(order) {
    let total = 0;
    let prev = startIdx;
    for (const n of order) {
      total += d(prev, n);
      prev = n;
    }
    return total + d(prev, end);
  }

  // بناء أولي ١: الأقرب فالأقرب
  function nearestNeighbor() {
    const left = [...nodes];
    const order = [];
    let current = startIdx;
    while (left.length) {
      let bestPos = 0;
      let best = Infinity;
      left.forEach((n, pos) => {
        const v = d(current, n);
        if (v < best) { best = v; bestPos = pos; }
      });
      current = left.splice(bestPos, 1)[0];
      order.push(current);
    }
    return order;
  }

  // بناء أولي ٢: الإدخال الأرخص (بيعطي حلقات أنظف لما البداية والنهاية نفس المكان)
  function cheapestInsertion() {
    const left = [...nodes];
    // نبدأ بأبعد نقطة عن البداية
    let farPos = 0;
    let far = -1;
    left.forEach((n, pos) => {
      const v = d(startIdx, n);
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
          const next = k === order.length ? end : order[k];
          const delta = d(prev, n) + d(n, next) - d(prev, next);
          if (delta < bestDelta) { bestDelta = delta; bestNodePos = pos; bestInsertAt = k; }
        }
      });
      const node = left.splice(bestNodePos, 1)[0];
      order.splice(bestInsertAt, 0, node);
    }
    return order;
  }

  function improve(orderIn) {
    let order = [...orderIn];
    let bestCost = cost(order);
    let improved = true;
    let rounds = 0;
    while (improved && rounds < 30) {
      improved = false;
      rounds++;

      // 2-opt: قلب مقطع من المسار
      for (let i = 0; i < order.length - 1; i++) {
        for (let j = i + 1; j < order.length; j++) {
          const candidate = [...order.slice(0, i), ...order.slice(i, j + 1).reverse(), ...order.slice(j + 1)];
          const c = cost(candidate);
          if (c < bestCost - 1e-6) { order = candidate; bestCost = c; improved = true; }
        }
      }

      // or-opt: نقل مقطع (١ إلى ٣ نقاط) لمكان أفضل
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

  const a = improve(nearestNeighbor());
  const b = improve(cheapestInsertion());
  let best = a.cost <= b.cost ? a : b;

  // لما الرحلة بتبدأ وبتخلص بالمحل: نفس الحلقة ممكن تنمشى بالاتجاهين.
  // بنختار الاتجاه الأقصر، ولو متقاربين بنبدأ بالأقرب للمحل.
  if (endIdx != null && endIdx === startIdx) {
    const reversed = [...best.order].reverse();
    const reversedCost = cost(reversed);
    const firstLeg = d(startIdx, best.order[0]);
    const reversedFirstLeg = d(startIdx, reversed[0]);
    const nearlyEqual = Math.abs(reversedCost - best.cost) <= best.cost * 0.03;
    if (reversedCost < best.cost - 1e-6 && !nearlyEqual) {
      best = { order: reversed, cost: reversedCost };
    } else if (nearlyEqual && reversedFirstLeg < firstLeg) {
      best = { order: reversed, cost: reversedCost };
    }
  }

  return best.order;
}

// ------------------------------------------------------------
// optimizeRoute
// start: {lat, lon} أو null — end: {lat, lon} أو null (المحل)
// stops: [{ ...anything, latitude, longitude, priority }]
// mode: "nearest" (أقصر طريق) أو "urgent_smart" (المستعجل أولًا)
// ------------------------------------------------------------
export async function optimizeRoute({ start, end, stops, mode = "nearest", withGeometry = true }) {
  const withLocation = stops.filter((s) => s.latitude != null && s.longitude != null);
  const withoutLocation = stops.filter((s) => s.latitude == null || s.longitude == null);

  if (withLocation.length === 0) {
    return {
      ordered: [...stops],
      legDistancesKm: stops.map(() => null),
      returnLegKm: null,
      totalDistanceKm: 0,
      distanceBeforeKm: 0,
      geometry: null,
    };
  }

  // لو ما في نقطة بداية: نبدأ من المحل، ولو ما في محل: من أول طلب
  let startPoint = start && start.lat != null && start.lon != null ? start : null;
  let anchorStop = null;
  let locatedStops = withLocation;
  if (!startPoint && end) startPoint = end;
  if (!startPoint) {
    anchorStop = withLocation[0];
    startPoint = { lat: anchorStop.latitude, lon: anchorStop.longitude };
    locatedStops = withLocation.slice(1);
  }

  // النقاط: 0 = البداية، 1..n = الطلبات، n+1 = المحل (لو موجود)
  const points = [startPoint, ...locatedStops.map((s) => ({ lat: s.latitude, lon: s.longitude }))];
  const endIdx = end ? points.length : null;
  if (end) points.push(end);

  const matrix = await getRoadDistanceMatrix(points);
  const dist = (i, j) => {
    if (i === j) return 0;
    if (matrix) return matrix[i][j];
    return distanceKm(points[i].lat, points[i].lon, points[j].lat, points[j].lon) * 1000;
  };

  const stopIdxs = locatedStops.map((_, i) => i + 1);
  let orderIdxs;

  if (mode === "urgent_smart") {
    const urgent = stopIdxs.filter((i) => locatedStops[i - 1].priority === "urgent");
    const normal = stopIdxs.filter((i) => locatedStops[i - 1].priority !== "urgent");
    if (urgent.length && normal.length) {
      const urgentOrder = solvePath(0, urgent, null, dist);
      const normalOrder = solvePath(urgentOrder[urgentOrder.length - 1], normal, endIdx, dist);
      orderIdxs = [...urgentOrder, ...normalOrder];
    } else {
      orderIdxs = solvePath(0, stopIdxs, endIdx, dist);
    }
  } else {
    orderIdxs = solvePath(0, stopIdxs, endIdx, dist);
  }

  const legDistances = [];
  let prev = 0;
  let total = 0;
  for (const idx of orderIdxs) {
    const leg = dist(prev, idx);
    legDistances.push(leg / 1000);
    total += leg;
    prev = idx;
  }
  let returnLegKm = null;
  if (endIdx != null && orderIdxs.length) {
    const back = dist(prev, endIdx);
    returnLegKm = back / 1000;
    total += back;
  }

  // المسافة لو مشينا بالترتيب الأصلي بدون تحسين (للمقارنة)
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

  return {
    ordered: [...ordered, ...withoutLocation],
    legDistancesKm: [...legs, ...withoutLocation.map(() => null)],
    returnLegKm,
    totalDistanceKm: total / 1000,
    distanceBeforeKm: before / 1000,
    geometry,
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
