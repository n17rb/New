import { Router } from "express";
import { query, pool } from "../../db.js";
import { can } from "../../permissions.js";
import { needAny, bad, round2, alert, pushTo, jordanDate } from "./lib.js";

// ============================================================
// خط الإنتاج على تلفون الموظف:
// - فحوصات الجودة (أوزون، TDS، pH، سوفتنر قبل/بعد، كلور) — بتضل بالسجل وبتنطبع ورقة يومية
// - تذكير كل كم ساعة (الإدارة بتحدد) — بس للموظف اللي بدوامه هلأ
// - الفلاتر: كل فلتر وموعد غياره، والغيار بيسحب من المستودع باسم الموظف
// - تالف الخط: «شغلت الماكنة ساعتين وخرب معي ٨ كراتين»
// ============================================================
const router = Router();
const view = needAny(["f_production"], ["f_machines"], ["f_store"], ["f_home"]);
const setup = needAny(["f_fleet", "edit"], ["f_store", "edit"]);
const isSetup = (u) => can(u, "f_fleet", "edit") || can(u, "f_store", "edit");
const numOrNull = (v) => (v === "" || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
const COLORS_SOFT = ["أزرق", "أحمر"];
const COLORS_CL = ["أبيض", "أصفر"];

// الوقت بعمّان: «HH:MM» ورقم يوم الأسبوع (0 = الأحد)
function ammanNow() {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Amman", hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
  return { hm: `${p.hour === "24" ? "00" : p.hour}:${p.minute}`, wd };
}
export function onShift(h, now = ammanNow()) {
  if (!h) return true; // بدون ساعات مسجّلة = منعتبره بدوامه
  if (!String(h.days || "0123456").includes(String(now.wd))) return false;
  return h.start_time <= h.end_time ? now.hm >= h.start_time && now.hm < h.end_time : now.hm >= h.start_time || now.hm < h.end_time; // دوام ليلي
}

// شو الغلط بالفحص حسب حدود الخط
function issuesOf(c, limits = {}) {
  const out = [];
  const L = limits || {};
  const n = (k) => (c[k] == null ? null : Number(c[k]));
  if (n("tds") != null && L.tds_max != null && n("tds") > Number(L.tds_max)) out.push(`TDS عالي (${n("tds")})`);
  if (n("tds") != null && L.tds_min != null && n("tds") < Number(L.tds_min)) out.push(`TDS واطي (${n("tds")})`);
  if (n("ph") != null && L.ph_min != null && n("ph") < Number(L.ph_min)) out.push(`pH واطي (${n("ph")})`);
  if (n("ph") != null && L.ph_max != null && n("ph") > Number(L.ph_max)) out.push(`pH عالي (${n("ph")})`);
  if (n("ozone") != null && L.ozone_min != null && n("ozone") < Number(L.ozone_min)) out.push(`الأوزون واطي (${n("ozone")})`);
  if (n("ozone") != null && L.ozone_max != null && n("ozone") > Number(L.ozone_max)) out.push(`الأوزون عالي (${n("ozone")})`);
  if (c.soft_after && c.soft_after === (L.soft_bad || "أحمر")) out.push(`السوفتنر بعد الجهاز ${c.soft_after}`);
  if (c.chlorine && c.chlorine === (L.cl_bad || "أصفر")) out.push(`الكلور بعد الكربون ${c.chlorine}`);
  return out;
}

async function myLineIds(user) {
  return (await query("SELECT line_id FROM f_pline_users WHERE user_id = $1", [user.id])).rows.map((r) => r.line_id);
}
async function canUseLine(user, lineId) {
  if (isSetup(user)) return true;
  const mine = await myLineIds(user);
  if (mine.length) return mine.includes(Number(lineId));
  return can(user, "f_production", "edit") || can(user, "f_machines", "edit");
}

function filterState(f, today = jordanDate()) {
  if (!f.last_changed) return { due_on: null, days_left: null, state: "due" };
  const due = new Date(Date.parse(`${f.last_changed}T12:00:00Z`) + f.every_days * 86400000).toISOString().slice(0, 10);
  const left = Math.round((Date.parse(`${due}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86400000);
  return { due_on: due, days_left: left, state: left <= 0 ? "due" : left <= 2 ? "soon" : "ok" };
}

router.get("/line", view, async (req, res) => {
  const setupOk = isSetup(req.user);
  const mine = await myLineIds(req.user);
  const [lines, members, hours, lastChecks, today, filters] = await Promise.all([
    query("SELECT l.*, s.name AS site_name FROM f_plines l LEFT JOIN f_sites s ON s.id = l.site_id WHERE l.active ORDER BY l.id"),
    query("SELECT lu.line_id, u.id, u.full_name FROM f_pline_users lu JOIN users u ON u.id = lu.user_id WHERE u.status = 'active'"),
    query("SELECT * FROM f_work_hours"),
    query("SELECT DISTINCT ON (line_id) line_id, checked_at FROM f_qchecks ORDER BY line_id, checked_at DESC"),
    query(
      `SELECT q.*, u.full_name AS by_name FROM f_qchecks q LEFT JOIN users u ON u.id = q.user_id
       WHERE (q.checked_at AT TIME ZONE 'Asia/Amman')::date = $1 ORDER BY q.checked_at DESC`,
      [jordanDate()]
    ),
    query(
      `SELECT f.*, f.last_changed::text AS last_changed, m.name AS material_name, m.balance AS material_balance, m.unit AS material_unit
       FROM f_filters f LEFT JOIN f_materials m ON m.id = f.material_id WHERE f.active ORDER BY f.line_id NULLS LAST, f.id`
    ),
  ]);
  const visible = lines.rows.filter((l) => setupOk || can(req.user, "f_home") || !mine.length || mine.includes(l.id));
  const out = visible.map((l) => {
    const last = lastChecks.rows.find((x) => x.line_id === l.id)?.checked_at || null;
    const next = last ? new Date(new Date(last).getTime() + l.check_every_min * 60000).toISOString() : null;
    return {
      ...l,
      mine: mine.includes(l.id),
      members: members.rows.filter((m) => m.line_id === l.id).map((m) => ({ id: m.id, full_name: m.full_name, hours: hours.rows.find((h) => h.user_id === m.id) || null })),
      last_check_at: last,
      next_check_at: next,
      checks_today: today.rows.filter((q) => q.line_id === l.id).map((q) => ({ ...q, issues: q.issues ? q.issues.split(" | ") : [] })),
      filters: filters.rows.filter((f) => f.line_id === l.id || (!f.line_id && (!l.site_id || f.site_id === l.site_id || !f.site_id))).map((f) => ({ ...f, material_balance: f.material_balance == null ? null : Number(f.material_balance), qty_per_change: Number(f.qty_per_change), ...filterState(f) })),
    };
  });
  res.json({ lines: out, can: { setup: setupOk, record: can(req.user, "f_production", "edit") || can(req.user, "f_machines", "edit") || setupOk }, colors: { soft: COLORS_SOFT, cl: COLORS_CL } });
});

// فحص جودة
router.post("/line/:id/check", view, async (req, res) => {
  const l = (await query("SELECT * FROM f_plines WHERE id = $1 AND active", [req.params.id])).rows[0];
  if (!l) return bad(res, "الخط غير موجود.", 404);
  if (!(await canUseLine(req.user, l.id))) return bad(res, "هاد مش خطك.", 403);
  const b = req.body || {};
  const c = {
    ozone: numOrNull(b.ozone), tds: numOrNull(b.tds), ph: numOrNull(b.ph),
    soft_before: COLORS_SOFT.includes(b.soft_before) ? b.soft_before : null,
    soft_after: COLORS_SOFT.includes(b.soft_after) ? b.soft_after : null,
    chlorine: COLORS_CL.includes(b.chlorine) ? b.chlorine : null,
    chlorine_before: COLORS_CL.includes(b.chlorine_before) ? b.chlorine_before : null,
    note: String(b.note || "").trim().slice(0, 300) || null,
  };
  if (c.ph != null && !(c.ph >= 0 && c.ph <= 14)) return bad(res, "pH لازم بين 0 و 14.");
  if ([c.ozone, c.tds, c.ph, c.soft_before, c.soft_after, c.chlorine, c.chlorine_before].every((x) => x == null)) return bad(res, "عبّي الفحص.");
  const issues = issuesOf(c, l.limits);
  const r = await query(
    `INSERT INTO f_qchecks (line_id, user_id, ozone, tds, ph, soft_before, soft_after, chlorine, note, issues, chlorine_before)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [l.id, req.user.id, c.ozone, c.tds, c.ph, c.soft_before, c.soft_after, c.chlorine, c.note, issues.join(" | ") || null, c.chlorine_before]
  );
  if (issues.length) {
    await alert({ level: "crit", kind: "qcheck", ref: r.rows[0].id, title: `🧪 فحص ${l.name}: ${issues[0]}`, body: `${issues.join("، ")} — سجّله ${req.user.full_name}.` });
  }
  res.status(201).json({ ...r.rows[0], issues });
});

// ورقة الفحوصات اليومية (للطباعة/PDF) — بتضل بالسجل لأي يوم
router.get("/line/:id/sheet", view, async (req, res) => {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || "") ? req.query.date : jordanDate();
  const l = (await query("SELECT l.*, s.name AS site_name FROM f_plines l LEFT JOIN f_sites s ON s.id = l.site_id WHERE l.id = $1", [req.params.id])).rows[0];
  if (!l) return bad(res, "الخط غير موجود.", 404);
  const [checks, changes, waste, used] = await Promise.all([
    query(
      `SELECT q.*, u.full_name AS by_name FROM f_qchecks q LEFT JOIN users u ON u.id = q.user_id
       WHERE q.line_id = $1 AND (q.checked_at AT TIME ZONE 'Asia/Amman')::date = $2 ORDER BY q.checked_at`,
      [l.id, day]
    ),
    query(
      `SELECT c.*, f.name AS filter_name, u.full_name AS by_name FROM f_filter_changes c JOIN f_filters f ON f.id = c.filter_id LEFT JOIN users u ON u.id = c.user_id
       WHERE (f.line_id = $1 OR f.line_id IS NULL) AND (c.changed_at AT TIME ZONE 'Asia/Amman')::date = $2 ORDER BY c.changed_at`,
      [l.id, day]
    ),
    query(
      `SELECT x.*, m.name, m.unit, mc.name AS machine_name, u.full_name AS by_name FROM f_material_moves x JOIN f_materials m ON m.id = x.material_id
       LEFT JOIN f_machines mc ON mc.id = x.machine_id LEFT JOIN users u ON u.id = COALESCE(x.taken_by, x.created_by)
       WHERE x.kind = 'waste' AND x.line_id = $1 AND (x.created_at AT TIME ZONE 'Asia/Amman')::date = $2 ORDER BY x.created_at`,
      [l.id, day]
    ),
    query(
      `SELECT x.*, m.name, m.unit, u.full_name AS by_name FROM f_material_moves x JOIN f_materials m ON m.id = x.material_id
       LEFT JOIN users u ON u.id = COALESCE(x.taken_by, x.created_by)
       WHERE x.kind = 'use' AND x.line_id = $1 AND (x.created_at AT TIME ZONE 'Asia/Amman')::date = $2 ORDER BY x.created_at`,
      [l.id, day]
    ),
  ]);
  const fix = (rows) => rows.map((x) => ({ ...x, qty: Number(x.qty), cost: Number(x.cost || 0) }));
  res.json({
    date: day, line: l,
    checks: checks.rows.map((q) => ({ ...q, issues: q.issues ? q.issues.split(" | ") : [] })),
    filter_changes: changes.rows.map((c) => ({ ...c, qty: Number(c.qty) })),
    waste: fix(waste.rows), used: fix(used.rows),
  });
});

// ---------- الفلاتر ----------
function filterFields(b) {
  return {
    name: String(b.name || "").trim().slice(0, 80),
    line_id: numOrNull(b.line_id), site_id: numOrNull(b.site_id),
    every_days: Math.max(1, Math.min(365, Math.round(Number(b.every_days) || 14))),
    material_id: numOrNull(b.material_id),
    qty_per_change: Math.max(0, Number(b.qty_per_change) || 1),
    last_changed: /^\d{4}-\d{2}-\d{2}$/.test(b.last_changed || "") ? b.last_changed : null,
  };
}
router.post("/line/filters", setup, async (req, res) => {
  const f = filterFields(req.body || {});
  if (!f.name) return bad(res, "اكتب اسم الفلتر.");
  const r = await query(
    "INSERT INTO f_filters (name, line_id, site_id, every_days, material_id, qty_per_change, last_changed) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *",
    [f.name, f.line_id, f.site_id, f.every_days, f.material_id, f.qty_per_change, f.last_changed]
  );
  res.status(201).json(r.rows[0]);
});
router.put("/line/filters/:id", setup, async (req, res) => {
  const f = filterFields(req.body || {});
  if (!f.name) return bad(res, "اكتب اسم الفلتر.");
  const r = await query(
    "UPDATE f_filters SET name=$1, line_id=$2, site_id=$3, every_days=$4, material_id=$5, qty_per_change=$6, last_changed=COALESCE($7, last_changed), active=$8 WHERE id=$9 RETURNING *",
    [f.name, f.line_id, f.site_id, f.every_days, f.material_id, f.qty_per_change, f.last_changed, req.body?.active !== false, req.params.id]
  );
  if (!r.rows[0]) return bad(res, "الفلتر غير موجود.", 404);
  res.json(r.rows[0]);
});

// غيّرت فلتر: بينسحب من المستودع (إذا مربوط بصنف) باسم الموظف، وبيبدأ العد من جديد
router.post("/line/filters/:id/change", view, async (req, res) => {
  const f = (await query("SELECT * FROM f_filters WHERE id = $1 AND active", [req.params.id])).rows[0];
  if (!f) return bad(res, "الفلتر غير موجود.", 404);
  if (f.line_id && !(await canUseLine(req.user, f.line_id))) return bad(res, "هاد مش خطك.", 403);
  if (!isSetup(req.user) && !can(req.user, "f_production", "edit") && !can(req.user, "f_machines", "edit")) return bad(res, "ما عندك صلاحية.", 403);
  const qty = req.body?.qty === "" || req.body?.qty == null ? Number(f.qty_per_change) : Math.max(0, Number(req.body.qty) || 0);
  const note = String(req.body?.note || "").trim().slice(0, 300) || null;
  const client = await pool.connect();
  let left = null, mat = null;
  try {
    await client.query("BEGIN");
    if (f.material_id && qty > 0) {
      mat = (await client.query("SELECT * FROM f_materials WHERE id = $1 FOR UPDATE", [f.material_id])).rows[0];
      if (mat) {
        if (Number(mat.balance) < qty) throw new Error(`بالمستودع ${Number(mat.balance)} ${mat.unit} بس من «${mat.name}».`);
        await client.query("UPDATE f_materials SET balance = balance - $1 WHERE id = $2", [qty, mat.id]);
        await client.query(
          "INSERT INTO f_material_moves (material_id, kind, qty, unit_cost, cost, line_id, note, taken_by, created_by) VALUES ($1,'use',$2,$3,$4,$5,$6,$7,$7)",
          [mat.id, qty, mat.price, round2(qty * Number(mat.price)), f.line_id, `غيار ${f.name}`, req.user.id]
        );
        left = Number(mat.balance) - qty;
      }
    }
    await client.query("INSERT INTO f_filter_changes (filter_id, user_id, qty, note) VALUES ($1,$2,$3,$4)", [f.id, req.user.id, qty, note]);
    await client.query("UPDATE f_filters SET last_changed = $1, reminded_on = NULL WHERE id = $2", [jordanDate(), f.id]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    return bad(res, e.message);
  } finally {
    client.release();
  }
  await query("UPDATE f_alerts SET closed_at = now(), closed_by = $1 WHERE kind = $2 AND closed_at IS NULL", [req.user.id, `filter_${f.id}`]);
  if (mat && Number(mat.min_level) > 0 && left <= Number(mat.min_level)) {
    await alert({ level: "warn", kind: "material_low", ref: mat.id, dedupe: true, title: `قرّب يخلص: ${mat.name}`, body: `ضل ${left} ${mat.unit} — الحد ${Number(mat.min_level)}.` });
  }
  res.json({ ok: true, qty, left, material: mat?.name || null, unit: mat?.unit || null });
});

// ---------- تالف الخط ----------
router.post("/line/waste", view, async (req, res) => {
  const b = req.body || {};
  const lineId = numOrNull(b.line_id);
  if (!lineId) return bad(res, "اختار الخط.");
  if (!(await canUseLine(req.user, lineId))) return bad(res, "هاد مش خطك.", 403);
  const items = (Array.isArray(b.items) ? b.items : []).filter((x) => x.material_id && Number(x.qty) > 0);
  if (!items.length) return bad(res, "اختار شو تلف واكتب الكمية.");
  const hours = numOrNull(b.run_hours);
  const note = String(b.note || "").trim().slice(0, 300) || null;
  let total = 0;
  for (const x of items) {
    const m = (await query("SELECT * FROM f_materials WHERE id = $1", [x.material_id])).rows[0];
    if (!m) continue;
    const qty = Number(x.qty);
    total += qty * Number(m.price);
    await query(
      "INSERT INTO f_material_moves (material_id, kind, qty, unit_cost, cost, line_id, machine_id, run_hours, note, taken_by, created_by) VALUES ($1,'waste',$2,$3,$4,$5,$6,$7,$8,$9,$9)",
      [m.id, qty, m.price, round2(qty * Number(m.price)), lineId, numOrNull(b.machine_id), hours, note, req.user.id]
    );
  }
  res.json({ ok: true, cost: round2(total) });
});

// ---------- إعدادات الخط وساعات الدوام ----------
router.put("/line/:id/settings", setup, async (req, res) => {
  const every = Math.max(15, Math.min(24 * 60, Math.round(Number(req.body?.check_every_min) || 120)));
  const L = req.body?.limits || {};
  const limits = {};
  for (const k of ["tds_min", "tds_max", "ph_min", "ph_max", "ozone_min", "ozone_max"]) if (numOrNull(L[k]) != null) limits[k] = Number(L[k]);
  if (COLORS_SOFT.includes(L.soft_bad)) limits.soft_bad = L.soft_bad;
  if (COLORS_CL.includes(L.cl_bad)) limits.cl_bad = L.cl_bad;
  const r = await query("UPDATE f_plines SET check_every_min = $1, limits = $2 WHERE id = $3 RETURNING *", [every, JSON.stringify(limits), req.params.id]);
  res.json(r.rows[0] || {});
});
router.put("/line/hours/:userId", setup, async (req, res) => {
  const ok = (t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t || "");
  const s = req.body?.start_time, e = req.body?.end_time;
  if (!ok(s) || !ok(e)) return bad(res, "اكتب الساعة مثل 07:00.");
  const days = String(req.body?.days || "0123456").replace(/[^0-6]/g, "").slice(0, 7) || "0123456";
  await query(
    `INSERT INTO f_work_hours (user_id, start_time, end_time, days) VALUES ($1,$2,$3,$4)
     ON CONFLICT (user_id) DO UPDATE SET start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time, days = EXCLUDED.days`,
    [req.params.userId, s, e, days]
  );
  res.json({ ok: true });
});

// ---------- التذكيرات (من المراقبة كل ١٠ دقايق) ----------
export async function checkLines() {
  const now = ammanNow();
  const lines = (await query("SELECT * FROM f_plines WHERE active")).rows;
  const members = (await query("SELECT lu.line_id, lu.user_id, h.start_time, h.end_time, h.days FROM f_pline_users lu JOIN users u ON u.id = lu.user_id AND u.status = 'active' LEFT JOIN f_work_hours h ON h.user_id = lu.user_id")).rows;
  for (const l of lines) {
    const onNow = members.filter((m) => m.line_id === l.id && onShift(m.start_time ? m : null, now));
    if (!onNow.length) continue;
    const last = (await query("SELECT MAX(checked_at) AS t FROM f_qchecks WHERE line_id = $1", [l.id])).rows[0].t;
    const every = l.check_every_min * 60000;
    const dueAt = last ? new Date(last).getTime() + every : 0;
    const remindedAt = l.check_reminded_at ? new Date(l.check_reminded_at).getTime() : 0;
    // مستحق، وما ذكّرنا من آخر نص ساعة
    if (Date.now() >= dueAt && Date.now() - remindedAt >= Math.min(30 * 60000, every)) {
      for (const m of onNow) pushTo(m.user_id, { title: `🧪 وقت فحص ${l.name}`, body: "أوزون، TDS، pH، السوفتنر والكلور — اكبس وسجّل.", url: "/f/line", tag: `qc-${l.id}` }).catch(() => {});
      await query("UPDATE f_plines SET check_reminded_at = now() WHERE id = $1", [l.id]);
    }
  }
  // الفلاتر: تذكير مرة باليوم لما يستحق الغيار
  const today = jordanDate();
  const fs = (await query("SELECT f.*, f.last_changed::text AS last_changed, f.reminded_on::text AS reminded_on, l.name AS line_name FROM f_filters f LEFT JOIN f_plines l ON l.id = f.line_id WHERE f.active")).rows;
  for (const f of fs) {
    const st = filterState(f, today);
    if (st.state !== "due" || f.reminded_on === today) continue;
    await alert({ level: "warn", kind: `filter_${f.id}`.slice(0, 20), ref: f.id, dedupe: true, title: `🔁 غيار ${f.name}${f.line_name ? ` — ${f.line_name}` : ""}`, body: st.due_on ? `موعده ${st.due_on} (كل ${f.every_days} يوم).` : "ما في غيار مسجّل لهالفلتر." });
    const to = members.filter((m) => !f.line_id || m.line_id === f.line_id);
    for (const uid of [...new Set(to.map((m) => m.user_id))]) pushTo(uid, { title: `🔁 لازم تغيّر ${f.name}`, body: "صار موعد غياره. بعد ما تغيّره اكبس «غيّرت» بالتطبيق.", url: "/f/line", tag: `flt-${f.id}` }).catch(() => {});
    await query("UPDATE f_filters SET reminded_on = $1 WHERE id = $2", [today, f.id]);
  }
}

export default router;
