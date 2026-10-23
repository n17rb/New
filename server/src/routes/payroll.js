import { Router } from "express";
import { query, logActivity } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { can, canAction } from "../permissions.js";
import { jordanDate } from "../utils/forecast.js";

// ============================================================
// الموظفين والرواتب: مين داوم، كم إله (راتب شهري أو يومية)، السحوبات، المكافآت، الخصومات، والصرف
// ============================================================
const router = Router();
router.use(requireAuth);

const DAY = 86400000;
const KINDS = { advance: "سحب/سلفة", bonus: "مكافأة", deduction: "خصم", payment: "صرف راتب" };
const STATUSES = ["present", "half", "absent", "off"];
const isDate = (d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);
const round2 = (n) => Math.round(n * 100) / 100;

function canView(user) { return can(user, "payroll", "view"); }
function canEdit(user) { return can(user, "payroll", "edit"); }

function requireView(req, res, next) {
  return canView(req.user) ? next() : res.status(403).json({ error: "ما عندك صلاحية لقسم الموظفين والرواتب." });
}
function requireEdit(req, res, next) {
  if (canEdit(req.user)) return next();
  return res.status(403).json({ error: canView(req.user) ? "صلاحيتك على الرواتب مشاهدة فقط." : "ما عندك صلاحية لقسم الموظفين والرواتب." });
}

function dateToStr(d) {
  if (!d) return null;
  if (typeof d === "string") return d.slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function addDays(date, n) {
  return new Date(Date.parse(`${date}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);
}
function monthRange(month) {
  const [y, m] = month.split("-").map(Number);
  const from = `${y}-${String(m).padStart(2, "0")}-01`;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from, to: `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}` };
}

// المستحق من الدوام بين تاريخين (ضمن تاريخ البداية ولحد اليوم)
function earnedBetween(emp, from, to, att, today) {
  const start = dateToStr(emp.start_date);
  let d = from < start ? start : from;
  const end = to > today ? today : to;
  const pay = Number(emp.pay_amount) || 0;
  let earned = 0;
  const days = { present: 0, half: 0, absent: 0, off: 0, unmarked: 0 };
  while (d <= end) {
    const st = att.get(d);
    if (st) days[st]++;
    else days.unmarked++;
    if (emp.pay_type === "daily") {
      if (st === "present") earned += pay;
      else if (st === "half") earned += pay / 2;
    } else {
      const rate = pay / 30;
      if (emp.deduct_absence && st === "absent") earned += 0;
      else if (emp.deduct_absence && st === "half") earned += rate / 2;
      else earned += rate;
    }
    d = addDays(d, 1);
  }
  return { earned: round2(earned), days };
}

function sumTx(txs, kind, from = null, to = null) {
  return round2(txs.filter((t) => t.kind === kind && (!from || t.date >= from) && (!to || t.date <= to)).reduce((s, t) => s + Number(t.amount), 0));
}

async function loadPayrollData(employeeIds = null) {
  const filter = employeeIds ? "WHERE id = ANY($1::int[])" : "";
  const emps = (await query(
    `SELECT e.*, u.username, u.full_name AS user_full_name FROM employees e LEFT JOIN users u ON u.id = e.user_id ${filter ? filter.replace("id", "e.id") : ""} ORDER BY e.status, e.name`,
    employeeIds ? [employeeIds] : []
  )).rows;
  const ids = emps.map((e) => e.id);
  if (!ids.length) return { emps, att: new Map(), txs: new Map() };
  const [attR, txR] = await Promise.all([
    query("SELECT employee_id, work_date::text AS d, status, check_in_at, note FROM attendance WHERE employee_id = ANY($1::int[])", [ids]),
    query(
      `SELECT t.id, t.employee_id, t.kind, t.amount, t.entry_date::text AS date, t.note, t.created_at, u.full_name AS created_by_name
       FROM employee_transactions t LEFT JOIN users u ON u.id = t.created_by
       WHERE t.employee_id = ANY($1::int[]) ORDER BY t.entry_date DESC, t.id DESC`,
      [ids]
    ),
  ]);
  const att = new Map();
  for (const r of attR.rows) {
    if (!att.has(r.employee_id)) att.set(r.employee_id, new Map());
    att.get(r.employee_id).set(r.d, r.status);
  }
  const txs = new Map();
  for (const r of txR.rows) {
    if (!txs.has(r.employee_id)) txs.set(r.employee_id, []);
    txs.get(r.employee_id).push(r);
  }
  return { emps, att, txs };
}

function employeeSummary(emp, attMap, txList, today, month) {
  const start = dateToStr(emp.start_date);
  const all = earnedBetween(emp, start, today, attMap, today);
  const bonuses = sumTx(txList, "bonus");
  const deductions = sumTx(txList, "deduction");
  const advances = sumTx(txList, "advance");
  const payments = sumTx(txList, "payment");
  const balance = round2(all.earned + bonuses - deductions - advances - payments);

  const { from, to } = monthRange(month);
  const m = earnedBetween(emp, from, to, attMap, today);
  return {
    id: emp.id, name: emp.name, phone: emp.phone, job_title: emp.job_title, user_id: emp.user_id, username: emp.username,
    pay_type: emp.pay_type, pay_amount: Number(emp.pay_amount), deduct_absence: emp.deduct_absence,
    start_date: start, status: emp.status, notes: emp.notes,
    ss_enrolled: !!emp.ss_enrolled, ss_number: emp.ss_number || null,
    today_status: attMap.get(today) || null,
    balance,
    month: {
      month, earned: m.earned, days: m.days,
      bonuses: sumTx(txList, "bonus", from, to),
      deductions: sumTx(txList, "deduction", from, to),
      advances: sumTx(txList, "advance", from, to),
      payments: sumTx(txList, "payment", from, to),
    },
  };
}

// الكباتن اللي سلّموا طلبات اليوم — دوامهم بيتسجّل حاضر تلقائيًا كاقتراح
async function autoPresentUserIds(date) {
  const r = await query(
    `SELECT DISTINCT t.driver_id FROM trip_stops ts JOIN trips t ON t.id = ts.trip_id
     WHERE ts.delivered_at IS NOT NULL AND (ts.delivered_at AT TIME ZONE 'Asia/Amman')::date = $1::date AND t.driver_id IS NOT NULL`,
    [date]
  );
  return new Set(r.rows.map((x) => x.driver_id));
}

// ---------- لوحة اليوم: كل الموظفين، دوامهم، ومستحقاتهم ----------
router.get("/summary", requireView, async (req, res) => {
  const today = jordanDate();
  const date = isDate(req.query.date) && req.query.date <= today ? req.query.date : today;
  const month = date.slice(0, 7);
  const { emps, att, txs } = await loadPayrollData();
  const auto = await autoPresentUserIds(date);
  const list = emps.map((e) => {
    const s = employeeSummary(e, att.get(e.id) || new Map(), txs.get(e.id) || [], today, month);
    s.day_status = (att.get(e.id) || new Map()).get(date) || null;
    s.auto_present = !!(e.user_id && auto.has(e.user_id));
    return s;
  });
  const active = list.filter((e) => e.status === "active");
  res.json({
    date, today, month,
    employees: list,
    totals: {
      due: round2(active.reduce((s, e) => s + Math.max(0, e.balance), 0)),
      owed_by_staff: round2(active.reduce((s, e) => s + Math.min(0, e.balance), 0)),
      present: active.filter((e) => e.day_status === "present" || e.day_status === "half").length,
      unmarked: active.filter((e) => !e.day_status).length,
      active: active.length,
    },
  });
});

router.get("/employees/:id", requireView, async (req, res) => {
  const today = jordanDate();
  const month = /^\d{4}-\d{2}$/.test(req.query.month || "") ? req.query.month : today.slice(0, 7);
  const { emps, att, txs } = await loadPayrollData([Number(req.params.id)]);
  const e = emps[0];
  if (!e) return res.status(404).json({ error: "الموظف غير موجود." });
  const attMap = att.get(e.id) || new Map();
  const txList = txs.get(e.id) || [];
  const { from, to } = monthRange(month);
  const days = [];
  for (let d = from; d <= to && d <= today; d = addDays(d, 1)) days.push({ date: d, status: attMap.get(d) || null });
  res.json({
    ...employeeSummary(e, attMap, txList, today, month),
    days,
    transactions: txList.filter((t) => t.date >= from && t.date <= to),
    recent_transactions: txList.slice(0, 30),
  });
});

function cleanEmployee(b) {
  const pay_type = b.pay_type === "monthly" ? "monthly" : "daily";
  const pay_amount = Number(b.pay_amount);
  if (!b.name || !String(b.name).trim()) throw new Error("اسم الموظف مطلوب.");
  if (!Number.isFinite(pay_amount) || pay_amount < 0 || pay_amount > 100000) throw new Error("الراتب/اليومية غير صحيح.");
  if (b.start_date && !isDate(b.start_date)) throw new Error("تاريخ البداية غير صحيح.");
  return {
    name: String(b.name).trim().slice(0, 150), phone: b.phone ? String(b.phone).slice(0, 30) : null,
    job_title: b.job_title ? String(b.job_title).slice(0, 80) : null, user_id: b.user_id ? Number(b.user_id) : null,
    pay_type, pay_amount, deduct_absence: b.deduct_absence !== false,
    start_date: b.start_date || jordanDate(), notes: b.notes || null,
    ss_enrolled: b.ss_enrolled === true, ss_number: b.ss_number ? String(b.ss_number).slice(0, 40) : null,
  };
}

router.post("/employees", requireEdit, async (req, res) => {
  let e;
  try { e = cleanEmployee(req.body || {}); } catch (err) { return res.status(400).json({ error: err.message }); }
  try {
    const r = await query(
      `INSERT INTO employees (name, phone, job_title, user_id, pay_type, pay_amount, deduct_absence, start_date, notes, ss_enrolled, ss_number)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [e.name, e.phone, e.job_title, e.user_id, e.pay_type, e.pay_amount, e.deduct_absence, e.start_date, e.notes, e.ss_enrolled, e.ss_number]
    );
    await logActivity({ userId: req.user.id, action: "CREATE_EMPLOYEE", recordType: "employee", recordId: r.rows[0].id, newValue: e });
    res.status(201).json(r.rows[0]);
  } catch (err) {
    if (err.code === "23505") return res.status(400).json({ error: "حساب التطبيق هذا مربوط بموظف ثاني." });
    throw err;
  }
});

router.put("/employees/:id", requireEdit, async (req, res) => {
  let e;
  try { e = cleanEmployee(req.body || {}); } catch (err) { return res.status(400).json({ error: err.message }); }
  const status = req.body?.status === "left" ? "left" : "active";
  try {
    const r = await query(
      `UPDATE employees SET name=$1, phone=$2, job_title=$3, user_id=$4, pay_type=$5, pay_amount=$6, deduct_absence=$7,
         start_date=$8, notes=$9, status=$10, ss_enrolled=$12, ss_number=$13 WHERE id=$11 RETURNING *`,
      [e.name, e.phone, e.job_title, e.user_id, e.pay_type, e.pay_amount, e.deduct_absence, e.start_date, e.notes, status, req.params.id, e.ss_enrolled, e.ss_number]
    );
    if (!r.rows[0]) return res.status(404).json({ error: "الموظف غير موجود." });
    await logActivity({ userId: req.user.id, action: "UPDATE_EMPLOYEE", recordType: "employee", recordId: Number(req.params.id), newValue: { ...e, status } });
    res.json(r.rows[0]);
  } catch (err) {
    if (err.code === "23505") return res.status(400).json({ error: "حساب التطبيق هذا مربوط بموظف ثاني." });
    throw err;
  }
});

// تسجيل الدوام (واحد أو مجموعة)
router.post("/attendance", requireEdit, async (req, res) => {
  const today = jordanDate();
  const date = req.body?.date || today;
  if (!isDate(date) || date > today) return res.status(400).json({ error: "ما بتقدر تسجّل دوام ليوم بالمستقبل." });
  const items = Array.isArray(req.body?.items) ? req.body.items : [{ employee_id: req.body?.employee_id, status: req.body?.status, note: req.body?.note }];
  for (const it of items) {
    if (it.status === null || it.status === "") {
      await query("DELETE FROM attendance WHERE employee_id = $1 AND work_date = $2", [it.employee_id, date]);
      continue;
    }
    if (!STATUSES.includes(it.status)) return res.status(400).json({ error: "حالة الدوام غير صحيحة." });
    await query(
      `INSERT INTO attendance (employee_id, work_date, status, note, recorded_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (employee_id, work_date) DO UPDATE SET status = $3, note = COALESCE($4, attendance.note), recorded_by = $5, updated_at = now()`,
      [it.employee_id, date, it.status, it.note || null, req.user.id]
    );
  }
  res.json({ ok: true });
});

// سحب / مكافأة / خصم / صرف راتب
router.post("/employees/:id/transactions", requireEdit, async (req, res) => {
  const kind = req.body?.kind;
  const amount = round2(Number(req.body?.amount));
  const today = jordanDate();
  const date = req.body?.date || today;
  if (!KINDS[kind]) return res.status(400).json({ error: "نوع الحركة غير صحيح." });
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) return res.status(400).json({ error: "المبلغ غير صحيح." });
  if (!isDate(date) || date > today) return res.status(400).json({ error: "التاريخ غير صحيح." });
  if (kind === "deduction" && !String(req.body?.note || "").trim()) return res.status(400).json({ error: "اكتب سبب الخصم." });
  const emp = await query("SELECT id, name FROM employees WHERE id = $1", [req.params.id]);
  if (!emp.rows[0]) return res.status(404).json({ error: "الموظف غير موجود." });
  const r = await query(
    `INSERT INTO employee_transactions (employee_id, kind, amount, entry_date, note, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [req.params.id, kind, amount, date, req.body?.note || null, req.user.id]
  );
  await logActivity({ userId: req.user.id, action: `EMPLOYEE_${kind.toUpperCase()}`, recordType: "employee", recordId: Number(req.params.id), newValue: { amount, date, note: req.body?.note } });
  res.status(201).json(r.rows[0]);
});

// حذف حركة (لو انكتبت غلط) — بنفس اليوم بس
router.delete("/transactions/:id", requireEdit, async (req, res) => {
  const r = await query("SELECT * FROM employee_transactions WHERE id = $1", [req.params.id]);
  const t = r.rows[0];
  if (!t) return res.status(404).json({ error: "الحركة غير موجودة." });
  if (Date.now() - new Date(t.created_at).getTime() > DAY && req.user.role !== "super_admin") {
    return res.status(400).json({ error: "ما بتنحذف حركة مر عليها أكثر من يوم — المدير العام بس." });
  }
  await query("DELETE FROM employee_transactions WHERE id = $1", [t.id]);
  await logActivity({ userId: req.user.id, action: "DELETE_EMPLOYEE_TX", recordType: "employee", recordId: t.employee_id, oldValue: t });
  res.json({ ok: true });
});

// حسابات التطبيق اللي ممكن تنربط بموظف
router.get("/users", requireView, async (req, res) => {
  const r = await query(
    `SELECT u.id, u.full_name, u.username, e.id AS employee_id FROM users u LEFT JOIN employees e ON e.user_id = u.id
     WHERE u.status = 'active' ORDER BY u.full_name`
  );
  res.json(r.rows);
});

// ---------- الضمان الاجتماعي (باقة المصانع) ----------
// بيحسب حصة الموظف من الضمان لكل الموظفين المشتركين، وبيسجلها «خصم» على الشهر (مرة وحدة بالشهر)
const SS_NOTE = "ضمان اجتماعي";
async function ssRate() {
  const r = await query("SELECT value FROM app_settings WHERE key = 'ss_employee_rate'");
  const v = Number(r.rows[0]?.value);
  return Number.isFinite(v) && v > 0 && v < 50 ? v : 7.5;
}

router.get("/social-security", requireView, async (req, res) => {
  const today = jordanDate();
  const month = /^\d{4}-\d{2}$/.test(req.query.month || "") ? req.query.month : today.slice(0, 7);
  const rate = await ssRate();
  const { from, to } = monthRange(month);
  const emps = (await query("SELECT id, name, pay_type, pay_amount, ss_number FROM employees WHERE status = 'active' AND ss_enrolled ORDER BY name")).rows;
  const done = (await query(
    "SELECT employee_id, amount FROM employee_transactions WHERE kind = 'deduction' AND entry_date BETWEEN $1 AND $2 AND note LIKE $3",
    [from, to, `${SS_NOTE} ${month}%`]
  )).rows;
  const doneMap = new Map(done.map((d) => [d.employee_id, Number(d.amount)]));
  const list = emps.map((e) => {
    const base = e.pay_type === "monthly" ? Number(e.pay_amount) : Number(e.pay_amount) * 26;
    return { id: e.id, name: e.name, ss_number: e.ss_number, base: round2(base), amount: round2(base * rate / 100), deducted: doneMap.get(e.id) ?? null };
  });
  res.json({ month, rate, employees: list, total: round2(list.reduce((s, e) => s + e.amount, 0)) });
});

router.post("/social-security", requireEdit, async (req, res) => {
  const today = jordanDate();
  const month = /^\d{4}-\d{2}$/.test(req.body?.month || "") ? req.body.month : today.slice(0, 7);
  const rate = await ssRate();
  const { from, to } = monthRange(month);
  const date = to > today ? today : to;
  const emps = (await query("SELECT id, pay_type, pay_amount FROM employees WHERE status = 'active' AND ss_enrolled")).rows;
  let added = 0;
  for (const e of emps) {
    const exists = await query(
      "SELECT 1 FROM employee_transactions WHERE employee_id = $1 AND kind = 'deduction' AND entry_date BETWEEN $2 AND $3 AND note LIKE $4",
      [e.id, from, to, `${SS_NOTE} ${month}%`]
    );
    if (exists.rows[0]) continue;
    const base = e.pay_type === "monthly" ? Number(e.pay_amount) : Number(e.pay_amount) * 26;
    const amount = round2(base * rate / 100);
    if (amount <= 0) continue;
    await query(
      "INSERT INTO employee_transactions (employee_id, kind, amount, entry_date, note, created_by) VALUES ($1, 'deduction', $2, $3, $4, $5)",
      [e.id, amount, date, `${SS_NOTE} ${month} (${rate}%)`, req.user.id]
    );
    added++;
  }
  res.json({ ok: true, added });
});

// ---------- الموظف نفسه: حسابي وتسجيل الحضور ----------
router.get("/me", async (req, res) => {
  const r = await query("SELECT id FROM employees WHERE user_id = $1 AND status = 'active'", [req.user.id]);
  if (!r.rows[0]) return res.json(null);
  const today = jordanDate();
  const { emps, att, txs } = await loadPayrollData([r.rows[0].id]);
  const e = emps[0];
  res.json({
    ...employeeSummary(e, att.get(e.id) || new Map(), txs.get(e.id) || [], today, today.slice(0, 7)),
    recent_transactions: (txs.get(e.id) || []).slice(0, 15),
    can_check_in: canAction(req.user, "self_attendance"),
  });
});

router.post("/me/check-in", async (req, res) => {
  // تسجيل الحضور بالتلفون بس لمين الإدارة عطته الصلاحية
  if (!canAction(req.user, "self_attendance")) return res.status(403).json({ error: "تسجيل الحضور من عند الإدارة — ما عندك صلاحية تسجّله بنفسك." });
  const r = await query("SELECT id FROM employees WHERE user_id = $1 AND status = 'active'", [req.user.id]);
  if (!r.rows[0]) return res.status(404).json({ error: "حسابك مش مربوط بموظف — راجع الإدارة." });
  const today = jordanDate();
  await query(
    `INSERT INTO attendance (employee_id, work_date, status, check_in_at, recorded_by)
     VALUES ($1, $2, 'present', now(), $3)
     ON CONFLICT (employee_id, work_date) DO UPDATE SET check_in_at = COALESCE(attendance.check_in_at, now()),
       status = CASE WHEN attendance.status IN ('absent','off') THEN 'present' ELSE attendance.status END, updated_at = now()`,
    [r.rows[0].id, today, req.user.id]
  );
  res.json({ ok: true, date: today });
});

export default router;
