import { Router } from "express";
import { query, pool } from "../../db.js";
import { can } from "../../permissions.js";
import { needAny, bad, round2, alert, jordanDate } from "./lib.js";

// ============================================================
// مستودع المواد وقطع الغيار
// - المواد الأولية (رول بلاستيك، كرتون، أغطية…) والإنتاج بيسحب منها لخطه (كاسات، مطرات…)
// - قطع غيار المكنات لكل مصنع: رقم/حرف، صورة، سعر، مخزون — وفني الصيانة بيسحب منها
// - المحاسب/الإدارة بيدخلوا الأصناف والبضاعة الجديدة بسعرها، والجرد الكامل بقيمته
// ============================================================
const router = Router();
const view = needAny(["f_store"], ["f_production"], ["f_machines"], ["f_home"]);
const editStore = needAny(["f_store", "edit"]);
const setup = needAny(["f_store", "edit"], ["f_fleet", "edit"]);
const str = (v, n) => (v == null ? "" : String(v).trim().slice(0, n));
const numOrNull = (v) => (v === "" || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
const UNITS = ["حبة", "كغم", "طن", "رول", "كرتونة", "كيس", "لتر", "متر", "علبة", "طقم"];

// الرقم/الحرف بشكل موحّد للبحث: «١ X» = «1x» = «1-X»
export function normCode(s) {
  return String(s || "")
    .replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d))
    .replace(/[\s\-_/.#]/g, "")
    .toLowerCase();
}

function canTake(user, kind) {
  if (can(user, "f_store", "edit")) return true;
  return kind === "part" ? can(user, "f_machines", "edit") : can(user, "f_production", "edit");
}

router.get("/store", view, async (req, res) => {
  const [items, sites, lines, lineUsers, machines, month] = await Promise.all([
    query(
      `SELECT m.*, s.name AS site_name, mc.name AS machine_name, pl.name AS line_name,
              (SELECT MAX(created_at) FROM f_material_moves x WHERE x.material_id = m.id) AS last_move_at
       FROM f_materials m LEFT JOIN f_sites s ON s.id = m.site_id LEFT JOIN f_machines mc ON mc.id = m.machine_id LEFT JOIN f_plines pl ON pl.id = m.line_id
       ORDER BY m.active DESC, m.kind, m.category NULLS LAST, m.name`
    ),
    query("SELECT * FROM f_sites ORDER BY id"),
    query("SELECT l.*, s.name AS site_name FROM f_plines l LEFT JOIN f_sites s ON s.id = l.site_id ORDER BY l.id"),
    query("SELECT lu.line_id, u.id, u.full_name FROM f_pline_users lu JOIN users u ON u.id = lu.user_id"),
    query("SELECT m.id, m.name, m.site_id, m.line_id, m.active FROM f_machines m ORDER BY m.id"),
    // سحب هالشهر لكل خط
    query(
      `SELECT x.line_id, SUM(x.qty * COALESCE(x.unit_cost, 0)) AS cost, COUNT(*)::int AS n
       FROM f_material_moves x WHERE x.kind = 'use' AND x.created_at >= date_trunc('month', now() AT TIME ZONE 'Asia/Amman') AT TIME ZONE 'Asia/Amman'
       GROUP BY x.line_id`
    ),
  ]);
  const list = items.rows.map((m) => {
    const balance = Number(m.balance), price = Number(m.price), min = Number(m.min_level);
    return { ...m, balance, price, min_level: min, value: round2(balance * price), low: m.active && min > 0 && balance <= min, code_n: normCode(m.code) };
  });
  const active = list.filter((m) => m.active);
  const ls = lines.rows.map((l) => ({
    ...l,
    users: lineUsers.rows.filter((u) => u.line_id === l.id).map(({ id, full_name }) => ({ id, full_name })),
    month_cost: round2(month.rows.find((x) => x.line_id === l.id)?.cost || 0),
  }));
  const mine = ls.filter((l) => l.users.some((u) => u.id === req.user.id)).map((l) => l.id);
  res.json({
    items: list,
    sites: sites.rows,
    lines: ls,
    my_lines: mine,
    machines: machines.rows,
    units: UNITS,
    starters: Object.fromEntries(Object.entries(STARTERS).map(([k, v]) => [k, { label: v.label, n: v.items.length }])),
    totals: {
      material_value: round2(active.filter((m) => m.kind === "material").reduce((a, m) => a + m.value, 0)),
      part_value: round2(active.filter((m) => m.kind === "part").reduce((a, m) => a + m.value, 0)),
      low: active.filter((m) => m.low).length,
    },
    can: {
      store: can(req.user, "f_store", "edit"),
      take_material: canTake(req.user, "material"),
      take_part: canTake(req.user, "part"),
      setup: can(req.user, "f_store", "edit") || can(req.user, "f_fleet", "edit"),
    },
  });
});

// ---------- الأصناف ----------
function itemFields(b) {
  const kind = b.kind === "part" ? "part" : "material";
  return {
    kind,
    name: str(b.name, 80),
    code: str(b.code, 40) || null,
    category: str(b.category, 60) || null,
    unit: str(b.unit, 20) || (kind === "part" ? "حبة" : "كغم"),
    price: Math.max(0, Number(b.price) || 0),
    min_level: Math.max(0, Number(b.min_level) || 0),
    supplier: str(b.supplier, 100) || null,
    specs: str(b.specs, 2000) || null,
    photo_url: b.photo_url || null,
    site_id: numOrNull(b.site_id),
    machine_id: numOrNull(b.machine_id),
    shelf: str(b.shelf, 40) || null,
    line_id: numOrNull(b.line_id),
  };
}

async function codeTaken(code, siteId, exceptId = 0) {
  if (!code) return null;
  const r = await query("SELECT id, name, code, site_id FROM f_materials WHERE active AND id <> $1", [exceptId]);
  return r.rows.find((x) => normCode(x.code) === normCode(code) && (x.site_id || null) === (siteId || null)) || null;
}

router.post("/store/items", editStore, async (req, res) => {
  const f = itemFields(req.body || {});
  if (!f.name) return bad(res, "اكتب اسم الصنف.");
  const dup = await codeTaken(f.code, f.site_id);
  if (dup) return bad(res, `الرقم ${f.code} مستعمل لـ«${dup.name}».`);
  const opening = Math.max(0, Number(req.body?.opening) || 0);
  const r = await query(
    `INSERT INTO f_materials (kind, name, code, category, unit, price, min_level, supplier, specs, photo_url, site_id, machine_id, shelf, balance, line_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
    [f.kind, f.name, f.code, f.category, f.unit, f.price, f.min_level, f.supplier, f.specs, f.photo_url, f.site_id, f.machine_id, f.shelf, opening, f.line_id]
  );
  if (opening > 0) {
    await query(
      "INSERT INTO f_material_moves (material_id, kind, qty, unit_cost, cost, note, created_by) VALUES ($1,'receive',$2,$3,$4,'رصيد أول المدة',$5)",
      [r.rows[0].id, opening, f.price, round2(opening * f.price), req.user.id]
    );
  }
  res.status(201).json(r.rows[0]);
});

router.put("/store/items/:id", editStore, async (req, res) => {
  const f = itemFields(req.body || {});
  if (!f.name) return bad(res, "اكتب اسم الصنف.");
  const dup = await codeTaken(f.code, f.site_id, Number(req.params.id));
  if (dup) return bad(res, `الرقم ${f.code} مستعمل لـ«${dup.name}».`);
  const r = await query(
    `UPDATE f_materials SET kind=$1, name=$2, code=$3, category=$4, unit=$5, price=$6, min_level=$7, supplier=$8, specs=$9, photo_url=$10,
            site_id=$11, machine_id=$12, shelf=$13, active=$14, line_id=$16 WHERE id=$15 RETURNING *`,
    [f.kind, f.name, f.code, f.category, f.unit, f.price, f.min_level, f.supplier, f.specs, f.photo_url, f.site_id, f.machine_id, f.shelf, req.body?.active !== false, req.params.id, f.line_id]
  );
  if (!r.rows[0]) return bad(res, "الصنف غير موجود.", 404);
  res.json(r.rows[0]);
});

// ---------- دخل بضاعة للمستودع (فاتورة مورد) ----------
router.post("/store/receive", editStore, async (req, res) => {
  const lines = Array.isArray(req.body?.items) ? req.body.items : [];
  const supplier = str(req.body?.supplier, 100) || null;
  const invoice = str(req.body?.invoice_no, 40) || null;
  const note = str(req.body?.note, 300) || null;
  const clean = [];
  for (const l of lines) {
    const qty = Number(l.qty);
    if (!l.material_id || !(qty > 0)) continue;
    clean.push({ id: Number(l.material_id), qty, cost: numOrNull(l.unit_cost) });
  }
  if (!clean.length) return bad(res, "اختار صنف واكتب الكمية.");
  const client = await pool.connect();
  let total = 0;
  try {
    await client.query("BEGIN");
    for (const l of clean) {
      const m = (await client.query("SELECT id, balance, price FROM f_materials WHERE id = $1 FOR UPDATE", [l.id])).rows[0];
      if (!m) throw new Error("صنف غير موجود.");
      const bal = Math.max(0, Number(m.balance)), old = Number(m.price);
      const cost = l.cost != null && l.cost >= 0 ? l.cost : old;
      // السعر = متوسط مرجّح بين الموجود والجديد
      const avg = bal + l.qty > 0 ? (bal * old + l.qty * cost) / (bal + l.qty) : cost;
      await client.query("UPDATE f_materials SET balance = balance + $1, price = $2, supplier = COALESCE($3, supplier) WHERE id = $4", [l.qty, Math.round(avg * 1000) / 1000, supplier, l.id]);
      await client.query(
        "INSERT INTO f_material_moves (material_id, kind, qty, unit_cost, cost, supplier, invoice_no, note, created_by) VALUES ($1,'receive',$2,$3,$4,$5,$6,$7,$8)",
        [l.id, l.qty, cost, round2(l.qty * cost), supplier, invoice, note, req.user.id]
      );
      total += l.qty * cost;
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    return bad(res, e.message);
  } finally {
    client.release();
  }
  await query("UPDATE f_alerts SET closed_at = now() WHERE kind = 'material_low' AND ref_id = ANY($1::int[]) AND closed_at IS NULL", [clean.map((l) => l.id)]);
  // من شركة مسجّلة؟ الفاتورة بتنضاف على حسابها (صار علينا إلها)
  let partner = null;
  const pid = numOrNull(req.body?.partner_id);
  if (pid && total > 0) {
    const names = (await query("SELECT id, name, unit FROM f_materials WHERE id = ANY($1::int[])", [clean.map((l) => l.id)])).rows;
    const { addEntry } = await import("./books.js");
    const r = await addEntry(pid, {
      kind: "purchase", amount: round2(total), ref_no: invoice, note: note || "بضاعة دخلت المستودع", file_url: req.body?.file_url || null,
      items: clean.map((l) => { const m = names.find((x) => x.id === l.id); return { name: m?.name || "", qty: l.qty, unit: m?.unit || "", price: l.cost ?? 0 }; }),
    }, req.user);
    await query("UPDATE f_material_moves SET partner_id = $1 WHERE kind = 'receive' AND created_by = $2 AND created_at > now() - interval '1 minute' AND partner_id IS NULL", [pid, req.user.id]);
    partner = { id: pid, balance: Number(r.partner.balance), name: r.partner.name, phone: r.partner.phone };
  }
  res.json({ ok: true, total: round2(total), partner });
});

// ---------- سحب من المستودع: الإنتاج لخطه، أو فني الصيانة لماكنة ----------
router.post("/store/take", view, async (req, res) => {
  const lines = Array.isArray(req.body?.items) ? req.body.items : [];
  const lineId = numOrNull(req.body?.line_id);
  const machineId = numOrNull(req.body?.machine_id);
  const downtimeId = numOrNull(req.body?.downtime_id);
  const note = str(req.body?.note, 300) || null;
  const takenBy = numOrNull(req.body?.taken_by) || req.user.id;
  if (!lines.length) return bad(res, "اختار شو بدك تسحب.");
  const myLines = (await query("SELECT line_id FROM f_pline_users WHERE user_id = $1", [req.user.id])).rows.map((r) => r.line_id);
  const client = await pool.connect();
  const done = [];
  try {
    await client.query("BEGIN");
    for (const l of lines) {
      const qty = Number(l.qty);
      if (!l.material_id || !(qty > 0)) continue;
      const m = (await client.query("SELECT * FROM f_materials WHERE id = $1 FOR UPDATE", [l.material_id])).rows[0];
      if (!m || !m.active) throw new Error("صنف غير موجود.");
      if (!canTake(req.user, m.kind)) throw new Error(`ما عندك صلاحية تسحب «${m.name}».`);
      if (Number(m.balance) < qty) throw new Error(`«${m.name}»: الموجود ${Number(m.balance)} ${m.unit} بس.`);
      if (m.kind === "material" && !lineId && !can(req.user, "f_store", "edit")) throw new Error("اختار الخط اللي سحبت إله.");
      if (m.kind === "material" && lineId && myLines.length && !myLines.includes(lineId) && !can(req.user, "f_store", "edit")) throw new Error("بتسحب لخطك بس.");
      await client.query("UPDATE f_materials SET balance = balance - $1 WHERE id = $2", [qty, m.id]);
      await client.query(
        `INSERT INTO f_material_moves (material_id, kind, qty, unit_cost, cost, line_id, machine_id, downtime_id, note, taken_by, created_by)
         VALUES ($1,'use',$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [m.id, qty, m.price, round2(qty * Number(m.price)), m.kind === "material" ? lineId : null, machineId || m.machine_id || null, downtimeId, note, takenBy, req.user.id]
      );
      done.push({ ...m, qty, after: Number(m.balance) - qty });
    }
    if (!done.length) throw new Error("اكتب الكمية.");
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    return bad(res, e.message);
  } finally {
    client.release();
  }
  // كلفة القطع بتنضاف على العطل
  if (downtimeId) {
    const c = round2(done.reduce((a, m) => a + m.qty * Number(m.price), 0));
    await query("UPDATE f_downtime SET repair_cost = repair_cost + $1 WHERE id = $2", [c, downtimeId]);
  }
  for (const m of done) {
    if (Number(m.min_level) > 0 && m.after <= Number(m.min_level)) {
      await alert({ level: "warn", kind: "material_low", ref: m.id, dedupe: true, title: `${m.kind === "part" ? "قطعة" : "مادة"} قرّبت تخلص: ${m.name}${m.code ? ` (${m.code})` : ""}`, body: `ضل ${m.after} ${m.unit} — الحد ${Number(m.min_level)}.` });
    }
  }
  res.json({ ok: true, items: done.map((m) => ({ id: m.id, name: m.name, qty: m.qty, left: m.after })) });
});

// تعديل يدوي بسبب (كسر، ضياع، غلط)
router.post("/store/items/:id/adjust", editStore, async (req, res) => {
  const qty = Number(req.body?.qty);
  const note = str(req.body?.note, 300);
  if (!qty) return bad(res, "اكتب الكمية (+ أو −).");
  if (!note) return bad(res, "اكتب السبب.");
  const m = (await query("SELECT * FROM f_materials WHERE id = $1", [req.params.id])).rows[0];
  if (!m) return bad(res, "الصنف غير موجود.", 404);
  if (Number(m.balance) + qty < 0) return bad(res, `الموجود ${Number(m.balance)} بس.`);
  await query("UPDATE f_materials SET balance = balance + $1 WHERE id = $2", [qty, m.id]);
  await query("INSERT INTO f_material_moves (material_id, kind, qty, unit_cost, cost, note, created_by) VALUES ($1,'adjust',$2,$3,$4,$5,$6)", [m.id, qty, m.price, round2(qty * Number(m.price)), note, req.user.id]);
  res.json({ ok: true });
});

// جرد فعلي: اللي عدّيته بإيدك بيصير هو الرصيد
router.post("/store/count", editStore, async (req, res) => {
  const lines = Array.isArray(req.body?.items) ? req.body.items : [];
  let changed = 0, value = 0;
  for (const l of lines) {
    const counted = numOrNull(l.counted);
    if (counted == null || counted < 0) continue;
    const m = (await query("SELECT * FROM f_materials WHERE id = $1", [l.material_id])).rows[0];
    if (!m) continue;
    const diff = Math.round((counted - Number(m.balance)) * 1000) / 1000;
    if (!diff) continue;
    await query("UPDATE f_materials SET balance = $1 WHERE id = $2", [counted, m.id]);
    await query(
      "INSERT INTO f_material_moves (material_id, kind, qty, unit_cost, cost, note, created_by) VALUES ($1,'count',$2,$3,$4,$5,$6)",
      [m.id, diff, m.price, round2(diff * Number(m.price)), `جرد: المحسوب ${Number(m.balance)} والموجود ${counted}`, req.user.id]
    );
    changed++;
    value += diff * Number(m.price);
  }
  res.json({ ok: true, changed, value: round2(value) });
});

// حركة صنف واحد
router.get("/store/items/:id/moves", view, async (req, res) => {
  const r = await query(
    `SELECT x.*, l.name AS line_name, mc.name AS machine_name, u.full_name AS by_name, t.full_name AS taken_by_name
     FROM f_material_moves x LEFT JOIN f_plines l ON l.id = x.line_id LEFT JOIN f_machines mc ON mc.id = x.machine_id
     LEFT JOIN users u ON u.id = x.created_by LEFT JOIN users t ON t.id = x.taken_by
     WHERE x.material_id = $1 ORDER BY x.id DESC LIMIT 200`,
    [req.params.id]
  );
  res.json(r.rows.map((x) => ({ ...x, qty: Number(x.qty), unit_cost: x.unit_cost == null ? null : Number(x.unit_cost), cost: x.cost == null ? null : Number(x.cost) })));
});

// آخر الحركات (دخل وسحب) — لكل المستودع
router.get("/store/moves", view, async (req, res) => {
  const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || "") ? req.query.from : jordanDate().slice(0, 8) + "01";
  const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || "") ? req.query.to : jordanDate();
  const r = await query(
    `SELECT x.*, m.name, m.code, m.unit, m.kind AS item_kind, l.name AS line_name, mc.name AS machine_name, u.full_name AS by_name, t.full_name AS taken_by_name
     FROM f_material_moves x JOIN f_materials m ON m.id = x.material_id LEFT JOIN f_plines l ON l.id = x.line_id
     LEFT JOIN f_machines mc ON mc.id = x.machine_id LEFT JOIN users u ON u.id = x.created_by LEFT JOIN users t ON t.id = x.taken_by
     WHERE (x.created_at AT TIME ZONE 'Asia/Amman')::date BETWEEN $1 AND $2 ORDER BY x.id DESC LIMIT 500`,
    [from, to]
  );
  const rows = r.rows.map((x) => ({ ...x, qty: Number(x.qty), cost: Number(x.cost || 0) }));
  const sum = (f) => round2(rows.filter(f).reduce((a, x) => a + x.cost, 0));
  // الصرف لكل خط ولكل ماكنة
  const per = (key, name) => {
    const m = new Map();
    for (const x of rows.filter((x) => x.kind === "use" && x[key])) {
      const e = m.get(x[key]) || { id: x[key], name: x[name], cost: 0, n: 0 };
      e.cost = round2(e.cost + x.cost); e.n++;
      m.set(x[key], e);
    }
    return [...m.values()].sort((a, b) => b.cost - a.cost);
  };
  res.json({
    from, to, moves: rows,
    received: sum((x) => x.kind === "receive"),
    used: sum((x) => x.kind === "use"),
    by_line: per("line_id", "line_name"),
    by_machine: per("machine_id", "machine_name"),
  });
});

// ---------- المصانع والخطوط ----------
router.post("/store/sites", setup, async (req, res) => {
  const name = str(req.body?.name, 60);
  if (!name) return bad(res, "اكتب اسم المصنع.");
  res.status(201).json((await query("INSERT INTO f_sites (name) VALUES ($1) RETURNING *", [name])).rows[0]);
});
router.put("/store/sites/:id", setup, async (req, res) => {
  const name = str(req.body?.name, 60);
  if (!name) return bad(res, "اكتب اسم المصنع.");
  res.json((await query("UPDATE f_sites SET name = $1, active = $2 WHERE id = $3 RETURNING *", [name, req.body?.active !== false, req.params.id])).rows[0]);
});
async function saveLineUsers(lineId, ids) {
  if (!Array.isArray(ids)) return;
  await query("DELETE FROM f_pline_users WHERE line_id = $1", [lineId]);
  for (const u of [...new Set(ids.map(Number).filter(Boolean))]) await query("INSERT INTO f_pline_users (line_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [lineId, u]);
}
router.post("/store/lines", setup, async (req, res) => {
  const name = str(req.body?.name, 60);
  if (!name) return bad(res, "اكتب اسم الخط.");
  const r = (await query("INSERT INTO f_plines (name, site_id) VALUES ($1,$2) RETURNING *", [name, numOrNull(req.body?.site_id)])).rows[0];
  await saveLineUsers(r.id, req.body?.user_ids);
  res.status(201).json(r);
});
router.put("/store/lines/:id", setup, async (req, res) => {
  const name = str(req.body?.name, 60);
  if (!name) return bad(res, "اكتب اسم الخط.");
  const r = (await query("UPDATE f_plines SET name = $1, site_id = $2, active = $3 WHERE id = $4 RETURNING *", [name, numOrNull(req.body?.site_id), req.body?.active !== false, req.params.id])).rows[0];
  if (!r) return bad(res, "الخط غير موجود.", 404);
  await saveLineUsers(r.id, req.body?.user_ids);
  res.json(r);
});
router.put("/store/machines/:id", setup, async (req, res) => {
  const r = await query("UPDATE f_machines SET site_id = $1, line_id = $2 WHERE id = $3 RETURNING *", [numOrNull(req.body?.site_id), numOrNull(req.body?.line_id), req.params.id]);
  res.json(r.rows[0] || {});
});
// ---------- المواد الأساسية لكل نوع خط: بنضيفها مرة وحدة (كمية وسعر صفر) والمحاسب بيعبّي ----------
// [الاسم، الوحدة، التصنيف، المواصفات]
export const STARTERS = {
  bottles: {
    label: "خط القناني",
    items: [
      ["بريفورم", "حبة", "بريفورم", "حسب وزن وحجم القنينة وقطر العنق"],
      ["ليبل", "رول", "ليبل", "ليبل مطبوع ملفوف — حسب حجم القنينة"],
      ["غطاء", "حبة", "أغطية", "بنفس قطر العنق واللون"],
      ["شرنك", "كغم", "تغليف", "نايلون شرنك للشدّات"],
      ["جلاتين لفّة طبلية", "رول", "تغليف", "ستريتش للف الطبليات"],
      ["صمغ", "كغم", "ليبل", "غراء ماكنة الليبل"],
      ["قاطع كرتون", "حبة", "أدوات", ""],
    ],
  },
  cups: {
    label: "خط الكاسات",
    items: [
      ["رول بلاستيك", "كغم", "بلاستيك", "حسب السماكة والعرض المناسب لماكنة التشكيل"],
      ["قصدير", "رول", "غطاء", "غطاء الكاسات المطبوع"],
      ["كرتون", "حبة", "تغليف", "حسب عدد الكاسات بالكرتونة"],
      ["لزق شفاف", "رول", "تغليف", ""],
    ],
  },
  chem: {
    label: "تعقيم وكيماويات",
    items: [
      ["فورملين تعقيم", "لتر", "تعقيم", "لتعقيم الخزانات والخطوط — حسب التركيز"],
      ["أسيد (حمض) تنظيف", "لتر", "تعقيم", "لتنظيف الأغشية والترسبات"],
      ["قطرات فحص الكلور", "علبة", "فحوصات", "كواشف فحص الكلور (أبيض/أصفر)"],
      ["قطرات فحص الحموضة (pH)", "علبة", "فحوصات", ""],
      ["قطرات فحص السوفتنر (العسرة)", "علبة", "فحوصات", "أحمر/أزرق — قبل وبعد الجهاز"],
      ["كلور سائل", "لتر", "تعقيم", ""],
      ["محلول معايرة جهاز TDS/pH", "علبة", "فحوصات", ""],
    ],
  },
  water: {
    label: "معالجة المي (للخطين)",
    items: [
      ["فلاتر ميكرون (شمعات)", "حبة", "معالجة مي", "5 ميكرون / 1 ميكرون — حسب الهاوسنج"],
      ["أغشية RO (ممبرين)", "حبة", "معالجة مي", ""],
      ["ملح تنعيم المي", "كيس", "معالجة مي", ""],
      ["مواد تعقيم (كلور/أوزون)", "لتر", "معالجة مي", ""],
      ["مواد غسيل وتعقيم الماكنات", "لتر", "نظافة", ""],
      ["لمبات UV", "حبة", "معالجة مي", ""],
    ],
  },
};

router.post("/store/starter", editStore, async (req, res) => {
  const set = STARTERS[req.body?.preset];
  if (!set) return bad(res, "اختار نوع الخط.");
  const lineId = numOrNull(req.body?.line_id);
  const have = (await query("SELECT name, line_id FROM f_materials WHERE active AND kind = 'material'")).rows;
  let added = 0;
  for (const [name, unit, category, specs] of set.items) {
    if (have.some((h) => h.name === name && (h.line_id || null) === (lineId || null))) continue;
    await query("INSERT INTO f_materials (kind, name, unit, category, specs, line_id) VALUES ('material',$1,$2,$3,$4,$5)", [name, unit, category, specs || null, lineId]);
    added++;
  }
  res.json({ ok: true, added });
});

// الموظفين (لتوزيعهم على الخطوط)
router.get("/store/staff", setup, async (req, res) => {
  const r = await query("SELECT id, full_name FROM users WHERE status = 'active' AND role <> 'super_admin' ORDER BY full_name");
  res.json(r.rows);
});

export default router;
