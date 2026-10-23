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
  mechanic: { label: "ميكانيك", km: null, days: null },
  tires: { label: "كوشوك", km: 40000, days: 730 },
  battery: { label: "بطارية", km: null, days: 540 },
  brakes: { label: "فرامل", km: 20000, days: null },
  other: { label: "صيانة ثانية", km: null, days: null },
};

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
    `SELECT DISTINCT ON (vehicle_id, kind) id, vehicle_id, kind, title, odo, next_km, next_date::text AS next_date, done_on::text AS done_on
     FROM f_maint WHERE next_km IS NOT NULL OR next_date IS NOT NULL ORDER BY vehicle_id, kind, id DESC`
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
    `SELECT m.*, m.done_on::text AS done_on, m.next_date::text AS next_date, u.full_name AS by_name FROM f_maint m LEFT JOIN users u ON u.id = m.created_by
     ORDER BY m.done_on DESC, m.id DESC LIMIT 300`
  )).rows.map((m) => ({ ...m, cost: Number(m.cost) }));
  const month = jordanDate().slice(0, 7);
  res.json({
    kinds: KINDS,
    vehicles: vs.map((v) => ({
      ...v, km_since: Math.round(Number(v.km_since || 0)),
      dues: dues.filter((d) => d.vehicle_id === v.id).sort((a, b) => ({ due: 0, soon: 1, ok: 2 }[a.state] - { due: 0, soon: 1, ok: 2 }[b.state])),
      history: hist.filter((h) => h.vehicle_id === v.id).slice(0, 30),
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
  const cost = round2(b.cost) || 0;
  if (cost < 0) return bad(res, "الكلفة غير صحيحة.");
  const nextKm = b.next_km === "" || b.next_km == null ? null : Math.round(Number(b.next_km));
  const nextDate = /^\d{4}-\d{2}-\d{2}$/.test(b.next_date || "") ? b.next_date : null;
  const doneOn = /^\d{4}-\d{2}-\d{2}$/.test(b.done_on || "") ? b.done_on : jordanDate();
  const r = await query(
    `INSERT INTO f_maint (vehicle_id, kind, title, odo, cost, note, photo_url, next_km, next_date, done_on, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [v.id, kind, b.title ? String(b.title).slice(0, 150) : null, odo, cost, b.note ? String(b.note).slice(0, 500) : null, b.photo_url || null, nextKm, nextDate, doneOn, req.user.id]
  );
  // العداد الجديد بيصير المرجع للكيلومترات
  if (odo != null) await query("UPDATE f_vehicles SET odo = $1, odo_at = now() WHERE id = $2", [odo, v.id]);
  // سكّر تنبيه «مستحق» لنفس النوع
  await query("UPDATE f_alerts SET closed_at = now(), closed_by = $1 WHERE kind = $2 AND ref_id = $3 AND closed_at IS NULL", [req.user.id, `maint_${kind}`.slice(0, 20), v.id]);
  res.status(201).json(r.rows[0]);
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
      level: d.state === "due" ? "crit" : "warn", kind: `maint_${d.kind}`.slice(0, 20), ref: d.vehicle_id, dedupe: true,
      title: `🔧 ${d.label} — ${v?.name || "سيارة"}`, body: `${d.state === "due" ? "مستحق" : "قرّب"}: ${left}.`,
    });
  }
}

export default router;
