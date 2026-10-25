import { Router } from "express";
import { query } from "../../db.js";
import { need, needAny, bad, round2, alert, jordanDate } from "./lib.js";

// ============================================================
// صيانة السيارات: كل سيارة وكم ماشية، شو انعمل إلها، وشو مستحق قريب
// الكيلومترات: آخر قراءة عداد مسجّلة + اللي مشيته السيارة بالتتبع بعدها
// ============================================================
const router = Router();
const view = needAny(["f_maint"], ["f_home"], ["f_fleet"]);
const edit = need("f_maint", "edit");

export const KINDS = {
  oil: { label: "غيار زيت", km: 5000, days: 90 },
  tires: { label: "كوشوك", km: 40000, days: 730 },
  battery: { label: "بطارية", km: null, days: 540 },
  brakes: { label: "فرامل", km: 20000, days: null },
  mechanic: { label: "ميكانيك وقطع", km: null, days: null },
  electric: { label: "كهرباء", km: null, days: null },
  body: { label: "سمكرة ودهان", km: null, days: null },
  other: { label: "صيانة ثانية", km: null, days: null },
};

// تنظيف التفاصيل: نصوص وأرقام وقوائم قصيرة بس
function cleanDetails(d) {
  const out = {};
  if (!d || typeof d !== "object" || Array.isArray(d)) return out;
  for (const [k, v] of Object.entries(d).slice(0, 40)) {
    if (!/^[a-z_]{1,30}$/.test(k)) continue;
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    else if (typeof v === "boolean") out[k] = v;
    else if (typeof v === "string" && v.trim()) out[k] = v.trim().slice(0, 200);
    else if (Array.isArray(v)) out[k] = v.filter((x) => typeof x === "string").map((x) => x.slice(0, 60)).slice(0, 20);
  }
  return out;
}
function cleanParts(ps) {
  return (Array.isArray(ps) ? ps : []).slice(0, 50).map((p) => ({
    name: String(p?.name || "").trim().slice(0, 100),
    code: String(p?.code || "").trim().slice(0, 40) || undefined,
    qty: Math.max(0, Number(p?.qty) || 1),
    price: Math.max(0, Number(p?.price) || 0),
    note: String(p?.note || "").trim().slice(0, 200) || undefined,
    shop: String(p?.shop || "").trim().slice(0, 100) || undefined,
  })).filter((p) => p.name);
}

async function vehiclesWithKm() {
  // المرجع: آخر قراءة عداد — يا مسجّلة بالصيانة، يا من صورة عداد السائق آخر رحلة — وبعدها بنزيد كيلومترات التتبع
  const r = await query(
    `SELECT v.id, v.name, v.plate, v.status, u.full_name AS driver_name,
            CASE WHEN tr.odo IS NOT NULL AND (v.odo_at IS NULL OR tr.at > v.odo_at) THEN tr.odo ELSE v.odo END AS odo,
            CASE WHEN tr.odo IS NOT NULL AND (v.odo_at IS NULL OR tr.at > v.odo_at) THEN tr.at ELSE v.odo_at END AS odo_at
     FROM f_vehicles v LEFT JOIN users u ON u.id = v.driver_id
     LEFT JOIN LATERAL (
       SELECT COALESCE(t.odo_end, t.odo_start) AS odo, CASE WHEN t.odo_end IS NOT NULL THEN COALESCE(t.returned_at, t.started_at) ELSE t.started_at END AS at
       FROM f_trips t WHERE t.vehicle_id = v.id AND (t.odo_end IS NOT NULL OR t.odo_start IS NOT NULL) AND t.started_at IS NOT NULL
       ORDER BY t.started_at DESC LIMIT 1
     ) tr ON true
     WHERE v.status <> 'inactive' ORDER BY v.id`
  );
  const out = [];
  for (const v of r.rows) {
    const since = v.odo_at ? Number((await query(
      "SELECT COALESCE(SUM(gps_km),0) AS k FROM f_trips WHERE vehicle_id = $1 AND started_at >= $2", [v.id, v.odo_at]
    )).rows[0].k) : 0;
    out.push({ ...v, km_since: since, km_now: v.odo != null ? Math.round(v.odo + since) : null });
  }
  return out;
}

// شو مستحق لكل سيارة: آخر سجل من كل نوع إله موعد جاي
async function dueList(vs) {
  const last = (await query(
    `SELECT * FROM (
       SELECT DISTINCT ON (vehicle_id, kind, COALESCE(title, '')) id, vehicle_id, kind, title, odo, next_km, next_date::text AS next_date, done_on::text AS done_on
       FROM f_maint ORDER BY vehicle_id, kind, COALESCE(title, ''), done_on DESC, id DESC
     ) x WHERE next_km IS NOT NULL OR next_date IS NOT NULL`
  )).rows;
  const today = Date.parse(`${jordanDate()}T12:00:00Z`);
  return last.map((m) => {
    const v = vs.find((x) => x.id === m.vehicle_id);
    const kmLeft = m.next_km != null && v?.km_now != null ? m.next_km - v.km_now : null;
    const daysLeft = m.next_date ? Math.round((Date.parse(`${m.next_date}T12:00:00Z`) - today) / 86400000) : null;
    const due = (kmLeft != null && kmLeft <= 0) || (daysLeft != null && daysLeft <= 0);
    const soon = !due && ((kmLeft != null && kmLeft <= 500) || (daysLeft != null && daysLeft <= 7));
    return { ...m, label: m.title || KINDS[m.kind]?.label || m.kind, km_left: kmLeft, days_left: daysLeft, state: due ? "due" : soon ? "soon" : "ok" };
  });
}

router.get("/maint", view, async (req, res) => {
  const vs = await vehiclesWithKm();
  const dues = await dueList(vs);
  const hist = (await query(
    `SELECT m.*, m.done_on::text AS done_on, m.next_date::text AS next_date, m.warranty_until::text AS warranty_until, u.full_name AS by_name FROM f_maint m LEFT JOIN users u ON u.id = m.created_by
     ORDER BY m.done_on DESC, m.id DESC LIMIT 1500`
  )).rows.map((m) => ({ ...m, cost: Number(m.cost), labor: Number(m.labor), warranty_until: m.warranty_until || null }));
  const month = jordanDate().slice(0, 7);
  res.json({
    kinds: KINDS,
    vehicles: vs.map((v) => ({
      ...v, km_since: Math.round(Number(v.km_since || 0)),
      dues: dues.filter((d) => d.vehicle_id === v.id).sort((a, b) => ({ due: 0, soon: 1, ok: 2 }[a.state] - { due: 0, soon: 1, ok: 2 }[b.state])),
      history: hist.filter((h) => h.vehicle_id === v.id),
      battery: hist.find((h) => h.vehicle_id === v.id && h.kind === "battery") || null,
      year_cost: round2(hist.filter((h) => h.vehicle_id === v.id && h.done_on.startsWith(month.slice(0, 4))).reduce((a, h) => a + h.cost, 0)),
      month_cost: round2(hist.filter((h) => h.vehicle_id === v.id && h.done_on.startsWith(month)).reduce((a, h) => a + h.cost, 0)),
    })),
    month_cost: round2(hist.filter((h) => h.done_on.startsWith(month)).reduce((a, h) => a + h.cost, 0)),
  });
});

router.post("/maint", edit, async (req, res) => {
  const b = req.body || {};
  const v = (await query("SELECT id, name, odo FROM f_vehicles WHERE id = $1", [b.vehicle_id])).rows[0];
  if (!v) return bad(res, "اختار السيارة.");
  const kind = KINDS[b.kind] ? b.kind : "other";
  const odo = b.odo === "" || b.odo == null ? null : Math.round(Number(b.odo));
  if (odo != null && !(odo >= 0 && odo < 5000000)) return bad(res, "رقم العداد غير صحيح.");
  const details = cleanDetails(b.details);
  const parts = cleanParts(b.parts);
  const labor = Math.max(0, round2(b.labor) || 0);
  // الكلفة: إذا انكتبت بنعتمدها، وإلا مجموع القطع + الأجرة
  let cost = b.cost === "" || b.cost == null ? null : round2(b.cost);
  if (cost == null) cost = round2(parts.reduce((a, p) => a + p.qty * p.price, 0) + labor);
  if (!(cost >= 0)) return bad(res, "الكلفة غير صحيحة.");
  const nextKm = b.next_km === "" || b.next_km == null ? null : Math.round(Number(b.next_km));
  const nextDate = /^\d{4}-\d{2}-\d{2}$/.test(b.next_date || "") ? b.next_date : null;
  const doneOn = /^\d{4}-\d{2}-\d{2}$/.test(b.done_on || "") ? b.done_on : jordanDate();
  const warranty = /^\d{4}-\d{2}-\d{2}$/.test(b.warranty_until || "") ? b.warranty_until : null;
  const title = b.title ? String(b.title).slice(0, 150) : null;
  const r = await query(
    `INSERT INTO f_maint (vehicle_id, kind, title, odo, cost, note, photo_url, next_km, next_date, done_on, created_by, details, parts, labor, workshop, warranty_until)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
    [v.id, kind, title, odo, cost, b.note ? String(b.note).slice(0, 500) : null, b.photo_url || null, nextKm, nextDate, doneOn, req.user.id,
      JSON.stringify(details), JSON.stringify(parts), labor, b.workshop ? String(b.workshop).slice(0, 100) : null, warranty]
  );
  // العداد الجديد بيصير المرجع للكيلومترات
  if (odo != null) await query("UPDATE f_vehicles SET odo = $1, odo_at = now() WHERE id = $2 AND (odo IS NULL OR $1 >= odo OR odo_at < $3::date)", [odo, v.id, doneOn]);
  // سكّر تنبيهات «مستحق» القديمة لنفس الشغلة
  const prev = (await query("SELECT id FROM f_maint WHERE vehicle_id = $1 AND kind = $2 AND COALESCE(title,'') = COALESCE($3,'') AND id <> $4", [v.id, kind, title, r.rows[0].id])).rows.map((x) => `maint_${x.id}`);
  await query("UPDATE f_alerts SET closed_at = now(), closed_by = $1 WHERE ref_id = $2 AND closed_at IS NULL AND (kind = ANY($3::text[]) OR kind = $4)", [req.user.id, v.id, prev, `maint_${kind}`.slice(0, 20)]);
  res.status(201).json(r.rows[0]);
});

// تقرير سنوي: كم كلّفت كل سيارة، موزّعة على أنواع الصيانة والشهور
router.get("/maint/report", view, async (req, res) => {
  const year = /^\d{4}$/.test(req.query.year || "") ? req.query.year : jordanDate().slice(0, 4);
  const r = await query(
    `SELECT m.vehicle_id, v.name AS vehicle_name, m.kind, EXTRACT(MONTH FROM m.done_on)::int AS month, SUM(m.cost) AS cost, COUNT(*)::int AS n
     FROM f_maint m JOIN f_vehicles v ON v.id = m.vehicle_id WHERE EXTRACT(YEAR FROM m.done_on) = $1
     GROUP BY m.vehicle_id, v.name, m.kind, month`,
    [Number(year)]
  );
  const per = new Map();
  for (const x of r.rows) {
    const e = per.get(x.vehicle_id) || { vehicle_id: x.vehicle_id, name: x.vehicle_name, total: 0, n: 0, kinds: {}, months: Array(12).fill(0) };
    const c = Number(x.cost);
    e.total = round2(e.total + c); e.n += x.n;
    e.kinds[x.kind] = round2((e.kinds[x.kind] || 0) + c);
    e.months[x.month - 1] = round2(e.months[x.month - 1] + c);
    per.set(x.vehicle_id, e);
  }
  const vehicles = [...per.values()].sort((a, b) => b.total - a.total);
  res.json({ year, vehicles, total: round2(vehicles.reduce((a, v) => a + v.total, 0)) });
});

router.post("/maint/odo", edit, async (req, res) => {
  const odo = Math.round(Number(req.body?.odo));
  if (!(odo >= 0 && odo < 5000000)) return bad(res, "رقم العداد غير صحيح.");
  const r = await query("UPDATE f_vehicles SET odo = $1, odo_at = now() WHERE id = $2 RETURNING id", [odo, req.body?.vehicle_id]);
  if (!r.rows[0]) return bad(res, "السيارة غير موجودة.", 404);
  res.json({ ok: true });
});

router.delete("/maint/:id", edit, async (req, res) => {
  await query("DELETE FROM f_maint WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});

// تنبيه يومي: صيانة مستحقة أو قرّبت
export async function checkMaint() {
  const vs = await vehiclesWithKm();
  for (const d of await dueList(vs)) {
    if (d.state === "ok") continue;
    const v = vs.find((x) => x.id === d.vehicle_id);
    const left = [d.km_left != null ? (d.km_left <= 0 ? `فات بـ${-d.km_left} كم` : `باقي ${d.km_left} كم`) : null, d.days_left != null ? (d.days_left <= 0 ? `فات موعده بـ${-d.days_left} يوم` : `باقي ${d.days_left} يوم`) : null].filter(Boolean).join(" · ");
    await alert({
      level: d.state === "due" ? "crit" : "warn", kind: `maint_${d.id}`.slice(0, 20), ref: d.vehicle_id, dedupe: true,
      title: `🔧 ${d.label} — ${v?.name || "سيارة"}`, body: `${d.state === "due" ? "مستحق" : "قرّب"}: ${left}.`,
    });
  }
}

export default router;
