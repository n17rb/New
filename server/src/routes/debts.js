import { Router } from "express";
import { pool, query, logActivity } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePerm } from "../permissions.js";

const router = Router();
router.use(requireAuth);

const round2 = (n) => Math.round(Number(n) * 100) / 100;

// كل العملاء اللي عليهم دين، الأكبر أول
router.get("/", requirePerm("debts", "view"), async (req, res) => {
  const result = await query(
    `SELECT c.id, c.name, c.phone_display, c.phone_normalized, c.sequential_number, c.debt_balance,
            r.name AS region_name,
            (SELECT MAX(created_at) FROM customer_debt_ledger d WHERE d.customer_id = c.id AND d.reason = 'payment') AS last_payment_at,
            (SELECT MIN(created_at) FROM customer_debt_ledger d WHERE d.customer_id = c.id AND d.change_amount > 0
               AND d.created_at > COALESCE((SELECT MAX(created_at) FROM customer_debt_ledger d2
                                            WHERE d2.customer_id = c.id AND d2.balance_after <= 0), 'epoch')) AS debt_since
     FROM customers c
     LEFT JOIN LATERAL (SELECT region_id FROM customer_locations WHERE customer_id = c.id ORDER BY id LIMIT 1) l ON true
     LEFT JOIN regions r ON r.id = l.region_id
     WHERE c.status = 'active' AND c.debt_balance > 0
     ORDER BY c.debt_balance DESC`
  );
  const total = result.rows.reduce((sum, r) => sum + Number(r.debt_balance), 0);
  res.json({ total: round2(total), count: result.rows.length, customers: result.rows });
});

// سجل دين زبون
router.get("/customer/:id", requirePerm("debts", "view"), async (req, res) => {
  const result = await query(
    `SELECT d.*, u.full_name AS created_by_name, o.order_number
     FROM customer_debt_ledger d
     LEFT JOIN users u ON u.id = d.created_by
     LEFT JOIN orders o ON o.id = d.order_id
     WHERE d.customer_id = $1
     ORDER BY d.created_at DESC, d.id DESC LIMIT 200`,
    [req.params.id]
  );
  res.json(result.rows);
});

async function applyDebtChange(req, res, { customerId, change, reason, notes }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const c = (await client.query("SELECT id, name, debt_balance FROM customers WHERE id = $1 FOR UPDATE", [customerId])).rows[0];
    if (!c) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "العميل غير موجود." });
    }
    const current = round2(c.debt_balance);
    if (reason === "payment" && -change > current + 0.001) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: `الدفعة أكبر من الدين. عليه ${current.toFixed(2)} JD بس.` });
    }
    const after = round2(current + change);
    await client.query("UPDATE customers SET debt_balance = $1 WHERE id = $2", [after, customerId]);
    const entry = (await client.query(
      `INSERT INTO customer_debt_ledger (customer_id, change_amount, reason, balance_after, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [customerId, change, reason, after, notes || null, req.user.id]
    )).rows[0];
    await client.query("COMMIT");

    await logActivity({
      userId: req.user.id,
      action: reason === "payment" ? "DEBT_PAYMENT" : "DEBT_ADJUST",
      recordType: "customer",
      recordId: customerId,
      oldValue: { debt_balance: current },
      newValue: { debt_balance: after, change, notes },
    });
    return res.json({ debt_balance: after, entry });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// الزبون دفع من دينه
router.post("/customer/:id/payment", requirePerm("debts", "edit"), async (req, res) => {
  const amount = round2(req.body?.amount);
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: "اكتب مبلغ الدفعة." });
  return applyDebtChange(req, res, { customerId: Number(req.params.id), change: -amount, reason: "payment", notes: req.body?.notes });
});

// تعديل يدوي (إضافة دين قديم مثلًا، أو شطب)
router.post("/customer/:id/adjust", requirePerm("debts", "edit"), async (req, res) => {
  const change = round2(req.body?.amount);
  if (!Number.isFinite(change) || change === 0) return res.status(400).json({ error: "اكتب المبلغ (موجب = دين جديد، سالب = شطب)." });
  if (!String(req.body?.notes || "").trim()) return res.status(400).json({ error: "اكتب سبب التعديل." });
  return applyDebtChange(req, res, { customerId: Number(req.params.id), change, reason: "manual", notes: req.body.notes.trim() });
});

export default router;
