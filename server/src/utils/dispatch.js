import { buildMatrix, solvePath, SERVICE_SECONDS } from "./routing.js";

// ============================================================
// توزيع الطلبات على كذا كابتن:
// كل كابتن بياخذ منطقة متلاصقة (مش طلبات متفرقة بكل البلد)،
// والحمل (عدد القوارير) متوازن بينهم قد ما بنقدر، وكل رحلة مرتبة بأحسن طريق.
// ============================================================

const BALANCE_WEIGHT = 240; // ثانية «كلفة» لكل قارورة فرق عن المعدل

function routeCost(nodes, matrix, shopIdx) {
  if (!nodes.length) return 0;
  // تقدير سريع: الأقرب فالأقرب + الرجوع للمحل
  const left = [...nodes];
  let cur = shopIdx;
  let total = 0;
  while (left.length) {
    let bi = 0;
    let bv = Infinity;
    left.forEach((n, i) => {
      const v = matrix.dur(cur, n);
      if (v < bv) { bv = v; bi = i; }
    });
    total += bv + SERVICE_SECONDS;
    cur = left.splice(bi, 1)[0];
  }
  return total + matrix.dur(cur, shopIdx);
}

export async function planDistribution({ orders, drivers, shop }) {
  const k = drivers.length;
  const located = orders.filter((o) => o.latitude != null && o.longitude != null);
  const unlocated = orders.filter((o) => o.latitude == null || o.longitude == null);
  const center = shop || (located.length
    ? { lat: located.reduce((s, o) => s + Number(o.latitude), 0) / located.length, lon: located.reduce((s, o) => s + Number(o.longitude), 0) / located.length }
    : null);

  const groups = drivers.map((d) => ({ driver_id: d.id, driver_name: d.full_name, nodes: [], extra: [] }));
  if (!located.length || !center) {
    unlocated.forEach((o, i) => groups[i % k].extra.push(o));
    return groups.map((g) => ({ ...summarize(g, null, null, 0), orders: g.extra }));
  }

  const points = [center, ...located.map((o) => ({ lat: Number(o.latitude), lon: Number(o.longitude) }))];
  const matrix = await buildMatrix(points);
  const SHOP = 0;
  const idxs = located.map((_, i) => i + 1);
  const bottles = (idx) => Math.max(1, Number(located[idx - 1].bottles) || 1);
  const totalBottles = idxs.reduce((s, i) => s + bottles(i), 0);
  const avg = totalBottles / k;

  function objective(assign) {
    let cost = 0;
    for (const nodes of assign) {
      cost += routeCost(nodes, matrix, SHOP);
      const b = nodes.reduce((s, i) => s + bottles(i), 0);
      cost += Math.abs(b - avg) * BALANCE_WEIGHT;
    }
    return cost;
  }

  let assign;
  if (k === 1) {
    assign = [idxs];
  } else {
    // ١) تقسيم بالزاوية حوالين المحل (كل كابتن «شريحة» من الخريطة) — منجرّب كل نقاط البداية
    const angle = (i) => Math.atan2(points[i].lat - center.lat, points[i].lon - center.lon);
    const sorted = [...idxs].sort((a, b) => angle(a) - angle(b));
    let bestAssign = null;
    let bestCost = Infinity;
    const tries = Math.min(sorted.length, 60);
    for (let t = 0; t < tries; t++) {
      const off = Math.floor((t * sorted.length) / tries);
      const rotated = [...sorted.slice(off), ...sorted.slice(0, off)];
      const parts = Array.from({ length: k }, () => []);
      let g = 0;
      let acc = 0;
      for (const i of rotated) {
        if (acc >= avg * (g + 1) && g < k - 1) g++;
        parts[g].push(i);
        acc += bottles(i);
      }
      const c = objective(parts);
      if (c < bestCost) { bestCost = c; bestAssign = parts; }
    }
    assign = bestAssign;

    // ٢) تحسين: نقل طلب لكابتن ثاني إذا بيوفّر وقت أو بيوزن الحمل
    for (let round = 0; round < 4; round++) {
      let moved = false;
      for (let g = 0; g < k; g++) {
        for (const node of [...assign[g]]) {
          if (assign[g].length <= 1) continue;
          let best = { cost: objective(assign), to: -1 };
          for (let h = 0; h < k; h++) {
            if (h === g) continue;
            const trial = assign.map((a) => [...a]);
            trial[g] = trial[g].filter((x) => x !== node);
            trial[h].push(node);
            const c = objective(trial);
            if (c < best.cost - 1) best = { cost: c, to: h };
          }
          if (best.to >= 0) {
            assign[g] = assign[g].filter((x) => x !== node);
            assign[best.to].push(node);
            moved = true;
          }
        }
      }
      if (!moved) break;
    }
  }

  // ٣) كل كابتن: ترتيب رحلته بأحسن طريق
  groups.forEach((g, i) => { g.nodes = assign[i] || []; });
  unlocated.forEach((o) => {
    const smallest = groups.reduce((m, g) => (g.nodes.length + g.extra.length < m.nodes.length + m.extra.length ? g : m), groups[0]);
    smallest.extra.push(o);
  });

  const result = [];
  for (const g of groups) {
    const order = g.nodes.length ? solvePath(SHOP, g.nodes, SHOP, matrix, { timeBudgetMs: 300 }) : [];
    let sec = 0;
    let meters = 0;
    let prev = SHOP;
    for (const n of order) { sec += matrix.dur(prev, n) + SERVICE_SECONDS; meters += matrix.dist(prev, n); prev = n; }
    if (order.length) { sec += matrix.dur(prev, SHOP); meters += matrix.dist(prev, SHOP); }
    const ordered = [...order.map((n) => located[n - 1]), ...g.extra];
    result.push({
      driver_id: g.driver_id,
      driver_name: g.driver_name,
      orders: ordered,
      bottles: ordered.reduce((s, o) => s + (Number(o.bottles) || 0), 0),
      km: Math.round((meters / 1000) * 10) / 10,
      minutes: Math.round(sec / 60),
    });
  }
  return result;
}

function summarize(g) {
  return { driver_id: g.driver_id, driver_name: g.driver_name, bottles: 0, km: 0, minutes: 0 };
}
