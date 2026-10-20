import { Router } from "express";
import { query, logActivity } from "../../db.js";
import { canAction } from "../../permissions.js";
import { need, needAny, bad, round2, alert, closeAlerts, jordanDate } from "./lib.js";
import { loadTrips } from "./orders.js";
import { maybeClose, expectedReturns } from "./stock.js";

// ============================================================
// المصنع: الحسابات — استلام الكاش من السائقين، المصاريف، الديون، عُهد السائقين، الشيكات
// ============================================================
const router = Router();
const viewMoney = needAny(["f_money"], ["f_home"]);
const editMoney = need("f_money", "edit");

// الرحلات اللي بدها تسوية (رجعت أو لسا شغالة) + آخر المسكّرة
router.get("/money/settlements", viewMoney, async (req, res) => {
  const trips = await loadTrips("t.status IN ('active','returned') OR (t.status = 'closed' AND t.settled_at > now() - interval '3 days')");
  res.json(trips.map((t) => ({ ...t, returns_expected: expectedReturns(t) })));
});

// المحاسب استلم الكاش من السائق
router.post("/money/trips/:id/cash", editMoney, async (req, res) => {
  const t = (await loadTrips("t.id = $1", [req.params.id]))[0];
  if (!t) return bad(res, "الرحلة غير موجودة.", 404);
  if (t.status !== "returned") return bad(res, t.status === "active" ? "السائق لسا ما سكّر رحلته من التطبيق." : "الكاش انستلم من قبل.");
  if (t.settled_at) return bad(res, "الكاش انستلم من قبل.");
  const handed = round2(req.body?.handed);
  if (!(handed >= 0)) return bad(res, "اكتب المبلغ اللي استلمته.");
  const required = round2(t.cash_due);
  const diff = round2(required - handed);
  await query(
    "UPDATE f_trips SET required_cash = $1, handed_cash = $2, cash_diff = $3, settled_by = $4, settled_at = now() WHERE id = $5",
    [required, handed, diff, req.user.id, t.id]
  );
  if (diff !== 0 && t.driver_id) {
    await query(
      "INSERT INTO f_driver_ledger (driver_id, kind, amount, trip_id, note, created_by) VALUES ($1,$2,$3,$4,$5,$6)",
      [t.driver_id, diff > 0 ? "shortage" : "surplus", diff, t.id, diff > 0 ? `نقص كاش: المطلوب ${required.toFixed(2)} والمسلّم ${handed.toFixed(2)}` : `زيادة كاش ${(-diff).toFixed(2)}`, req.user.id]
    );
  }
  if (diff > 0) await alert({ level: "crit", kind: "cash_short", ref: t.id, title: `نقص ${diff.toFixed(2)} د.أ بكاش ${t.driver_name || "السائق"}`, body: `المحصّل ${t.collected.toFixed(2)} − مصاريف ${t.expenses_total.toFixed(2)} = ${required.toFixed(2)}، والمسلّم ${handed.toFixed(2)}. انسجّل عهدة.` });
  else await alert({ level: "ok", kind: "cash_ok", ref: t.id, title: `${t.driver_name || "السائق"} سلّم ${handed.toFixed(2)} د.أ`, body: `المحصّل ${t.collected.toFixed(2)} − مصاريف ${t.expenses_total.toFixed(2)}.${diff < 0 ? ` زيادة ${(-diff).toFixed(2)}.` : " مطابق."}` });
  await logActivity({ userId: req.user.id, action: "F_TRIP_CASH", recordType: "f_trip", recordId: t.id, newValue: { required, handed, diff } });
  await maybeClose(t.id);
  res.json({ ok: true, required, handed, diff });
});

// ---------- المصاريف ----------
router.get("/money/expenses", needAny(["f_money"], ["f_home"]), async (req, res) => {
  const status = ["pending", "approved", "rejected"].includes(req.query.status) ? req.query.status : null;
  const r = await query(
    `SELECT e.*, u.full_name AS driver_name, v.name AS vehicle_name FROM f_expenses e
     LEFT JOIN users u ON u.id = e.driver_id LEFT JOIN f_vehicles v ON v.id = e.vehicle_id
     ${status ? "WHERE e.status = $1" : "WHERE e.created_at > now() - interval '30 days'"} ORDER BY e.id DESC LIMIT 150`,
    status ? [status] : []
  );
  res.json(r.rows.map((e) => ({ ...e, amount: Number(e.amount) })));
});

async function reviewExpense(req, res, approve) {
  if (!canAction(req.user, "approve_expense")) return bad(res, "ما عندك صلاحية توافق على المصاريف.", 403);
  const e = (await query("SELECT e.*, t.settled_at FROM f_expenses e LEFT JOIN f_trips t ON t.id = e.trip_id WHERE e.id = $1", [req.params.id])).rows[0];
  if (!e) return bad(res, "المصروف غير موجود.", 404);
  if (e.status !== "pending") return bad(res, "المصروف انراجع من قبل.");
  await query("UPDATE f_expenses SET status = $1, reviewed_by = $2, reviewed_at = now() WHERE id = $3", [approve ? "approved" : "rejected", req.user.id, e.id]);
  // انرفض بعد ما الكاش انحسب: المبلغ برجع عهدة على السائق
  if (!approve && e.settled_at && e.driver_id) {
    await query("INSERT INTO f_driver_ledger (driver_id, kind, amount, trip_id, note, created_by) VALUES ($1,'shortage',$2,$3,$4,$5)", [e.driver_id, Number(e.amount), e.trip_id, `مصروف ${e.kind} مرفوض`, req.user.id]);
  }
  await closeAlerts("expense", e.id, req.user.id);
  res.json({ ok: true });
}
router.post("/money/expenses/:id/approve", (req, res) => reviewExpense(req, res, true));
router.post("/money/expenses/:id/reject", (req, res) => reviewExpense(req, res, false));

// ---------- الديون ----------
router.get("/money/debts", needAny(["f_money"], ["f_customers"], ["f_home"]), async (req, res) => {
  const r = await query(
    `SELECT c.id, c.name, c.phone, c.city, c.balance, c.credit_limit, l.name AS line_name,
            (SELECT MAX(created_at) FROM f_ledger p WHERE p.customer_id = c.id AND p.kind = 'payment') AS last_payment_at,
            (SELECT MIN(g.created_at) FROM f_ledger g WHERE g.customer_id = c.id AND g.kind IN ('invoice','opening')
               AND g.created_at > COALESCE((SELECT MAX(p.created_at) FROM f_ledger p WHERE p.customer_id = c.id AND p.kind = 'payment' AND p.balance_after <= 0), 'epoch')) AS since
     FROM f_customers c LEFT JOIN f_lines l ON l.id = c.line_id
     WHERE c.active AND c.balance > 0.009 ORDER BY c.balance DESC`
  );
  const now = Date.now();
  const list = r.rows.map((c) => {
    const days = c.since ? Math.floor((now - new Date(c.since).getTime()) / 86400000) : 0;
    return { ...c, balance: Number(c.balance), credit_limit: Number(c.credit_limit), days, bucket: days > 90 ? "90+" : days > 60 ? "61-90" : days > 30 ? "31-60" : "0-30", over_limit: Number(c.credit_limit) > 0 && Number(c.balance) > Number(c.credit_limit) };
  });
  const buckets = { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
  for (const c of list) buckets[c.bucket] = round2(buckets[c.bucket] + c.balance);
  const cheques = await query(
    `SELECT g.*, c.name AS customer_name FROM f_ledger g JOIN f_customers c ON c.id = g.customer_id
     WHERE g.method = 'cheque' AND g.cheque_date >= CURRENT_DATE - 7 ORDER BY g.cheque_date LIMIT 50`
  );
  res.json({ total: round2(list.reduce((s, c) => s + c.balance, 0)), buckets, customers: list, cheques: cheques.rows.map((x) => ({ ...x, amount: Number(x.amount) })) });
});

// ---------- السائقين: الكاش اللي معهم هلأ والعُهد ----------
router.get("/money/drivers", viewMoney, async (req, res) => {
  const drivers = (await query(
    `SELECT u.id, u.full_name, (SELECT name FROM f_vehicles v WHERE v.driver_id = u.id ORDER BY id LIMIT 1) AS vehicle_name,
            COALESCE((SELECT SUM(amount) FROM f_driver_ledger l WHERE l.driver_id = u.id), 0) AS custody
     FROM users u WHERE u.status = 'active' AND (EXISTS (SELECT 1 FROM f_vehicles v WHERE v.driver_id = u.id) OR EXISTS (SELECT 1 FROM f_driver_ledger l WHERE l.driver_id = u.id))
     ORDER BY u.full_name`
  )).rows;
  const open = await loadTrips("t.status IN ('active','returned') AND t.settled_at IS NULL");
  res.json(drivers.map((d) => {
    const mine = open.filter((t) => t.driver_id === d.id);
    return { ...d, custody: round2(d.custody), cash_now: round2(mine.reduce((s, t) => s + t.cash_due, 0)), open_trips: mine.map((t) => t.id) };
  }));
});

router.get("/money/drivers/:id", viewMoney, async (req, res) => {
  const r = await query(
    "SELECT l.*, u.full_name AS by_name FROM f_driver_ledger l LEFT JOIN users u ON u.id = l.created_by WHERE l.driver_id = $1 ORDER BY l.id DESC LIMIT 100",
    [req.params.id]
  );
  res.json(r.rows.map((x) => ({ ...x, amount: Number(x.amount) })));
});

// السائق سدّد عهدة، أو انخصمت من راتبه، أو تعديل
router.post("/money/drivers/:id/ledger", editMoney, async (req, res) => {
  const kind = ["payment", "deduction", "adjust"].includes(req.body?.kind) ? req.body.kind : null;
  const amount = round2(req.body?.amount);
  if (!kind || !amount) return bad(res, "اختار النوع واكتب المبلغ.");
  const note = String(req.body?.note || "").trim();
  if (kind === "adjust" && !note) return bad(res, "اكتب السبب.");
  const signed = kind === "adjust" ? amount : -Math.abs(amount);
  await query("INSERT INTO f_driver_ledger (driver_id, kind, amount, note, created_by) VALUES ($1,$2,$3,$4,$5)", [req.params.id, kind, signed, note || null, req.user.id]);
  // الخصم من الراتب بينزل كمان بكشف راتبه
  if (kind === "deduction") {
    const emp = (await query("SELECT id FROM employees WHERE user_id = $1", [req.params.id])).rows[0];
    if (emp) await query("INSERT INTO employee_transactions (employee_id, kind, amount, entry_date, note, created_by) VALUES ($1,'deduction',$2,$3,$4,$5)", [emp.id, Math.abs(amount), jordanDate(), `عهدة: ${note || "نقص"}`, req.user.id]);
  }
  res.json({ ok: true });
});

export default router;
