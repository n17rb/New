import { Router } from "express";
import { pool, query, logActivity } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { can, canAny } from "../permissions.js";

// ============================================================
// عهدة القوارير (رأس مال القوارير):
// المحل بيموّل الزبون بقوارير (عهدة)، وبنعرف دايمًا كم قارورة عنده،
// ولما يقطع التعامل منعرف مين لازم نسترجع منه وكم.
// ============================================================
const router = Router();
router.use(requireAuth);

const canView = (u) => canAny(u, [["customers", "view"], ["jard", "view"]]);
const canEdit = (u) => can(u, "customers", "edit");

router.use((req, res, next) => (canView(req.user) ? next() : res.status(403).json({ error: "ما عندك صلاحية." })));

async function bottleValue() {
  const r = await query("SELECT value FROM app_settings WHERE key = 'bottle_value'");
  const v = Number(r.rows[0]?.value);
  return Number.isFinite(v) && v > 0 ? v : null;
}

// كل الزباين اللي عندهم قوارير للمحل + المجموع + اللي لازم نسترجع منهم
router.get("/", async (req, res) => {
  const inactiveDays = Math.min(365, Math.max(7, Number(req.query.inactive_days) || 30));
  const r = await query(
    `SELECT c.id, c.name, c.phone_display, c.phone_normalized, c.bottles_out, c.bottles_agreed, c.status,
            reg.name AS region_name,
            last_o.created_at AS last_order_at,
            EXTRACT(DAY FROM now() - COALESCE(last_o.created_at, c.created_at))::int AS days_since_order
     FROM customers c
     LEFT JOIN LATERAL (SELECT region_id FROM customer_locations WHERE customer_id = c.id ORDER BY id LIMIT 1) l ON true
     LEFT JOIN regions reg ON reg.id = l.region_id
     LEFT JOIN LATERAL (SELECT created_at FROM orders WHERE customer_id = c.id AND status <> 'CANCELLED' ORDER BY created_at DESC LIMIT 1) last_o ON true
     WHERE c.bottles_out > 0 OR c.bottles_agreed > 0
     ORDER BY c.bottles_out DESC, c.name`
  );
  const value = await bottleValue();
  const rows = r.rows.map((x) => ({
    ...x,
    to_collect: x.status !== "active" || x.days_since_order >= inactiveDays,
  }));
  const total = rows.reduce((s, x) => s + x.bottles_out, 0);
  const toCollect = rows.filter((x) => x.to_collect && x.bottles_out > 0);
  res.json({
    total_out: total,
    total_agreed: rows.reduce((s, x) => s + x.bottles_agreed, 0),
    customers_count: rows.filter((x) => x.bottles_out > 0).length,
    bottle_value: value,
    total_value: value ? Math.round(total * value * 100) / 100 : null,
    to_collect_count: toCollect.length,
    to_collect_bottles: toCollect.reduce((s, x) => s + x.bottles_out, 0),
    inactive_days: inactiveDays,
    customers: rows,
  });
});

router.get("/customer/:id", async (req, res) => {
  const c = await query("SELECT id, name, bottles_out, bottles_agreed FROM customers WHERE id = $1", [req.params.id]);
  if (!c.rows[0]) return res.status(404).json({ error: "الزبون غير موجود." });
  const l = await query(
    `SELECT b.id, b.change, b.reason, b.balance_after, b.note, b.created_at, u.full_name AS by_name
     FROM bottle_ledger b LEFT JOIN users u ON u.id = b.created_by
     WHERE b.customer_id = $1 ORDER BY b.id DESC LIMIT 40`,
    [req.params.id]
  );
  res.json({ ...c.rows[0], bottle_value: await bottleValue(), history: l.rows });
});

// lend = سلّمناه قوارير عهدة، return = استرجعنا منه، adjust = جرد: عنده فعليًا كذا
router.post("/customer/:id", async (req, res) => {
  if (!canEdit(req.user)) return res.status(403).json({ error: "تعديل العهدة بده صلاحية تعديل العملاء." });
  const kind = req.body?.kind;
  const count = Math.floor(Number(req.body?.count));
  const note = String(req.body?.note || "").trim().slice(0, 300) || null;
  if (!["lend", "return", "adjust"].includes(kind)) return res.status(400).json({ error: "نوع الحركة غير صحيح." });
  if (!Number.isInteger(count) || count < 0 || count > 10000 || (kind !== "adjust" && count === 0)) {
    return res.status(400).json({ error: "العدد غير صحيح." });
  }
  if (kind === "adjust" && !note) return res.status(400).json({ error: "اكتب سبب التعديل (مثلاً: جرد عند الزبون)." });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const cur = await client.query("SELECT bottles_out, bottles_agreed FROM customers WHERE id = $1 FOR UPDATE", [req.params.id]);
    if (!cur.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "الزبون غير موجود." });
    }
    const { bottles_out: out, bottles_agreed: agreed } = cur.rows[0];
    let change;
    let newAgreed = agreed;
    if (kind === "lend") {
      change = count;
      newAgreed = agreed + count;
    } else if (kind === "return") {
      if (count > out) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: `عنده ${out} قارورة بس.` });
      }
      change = -count;
      newAgreed = Math.max(0, agreed - count);
    } else {
      change = count - out;
    }
    const newOut = out + change;
    await client.query("UPDATE customers SET bottles_out = $1, bottles_agreed = $2 WHERE id = $3", [newOut, newAgreed, req.params.id]);
    await client.query(
      `INSERT INTO bottle_ledger (customer_id, change, reason, balance_after, note, created_by) VALUES ($1, $2, $3, $4, $5, $6)`,
      [req.params.id, change, kind, newOut, note, req.user.id]
    );
    await client.query("COMMIT");
    await logActivity({ userId: req.user.id, action: `BOTTLES_${kind.toUpperCase()}`, recordType: "customer", recordId: Number(req.params.id), newValue: { count, change, new_out: newOut, note } });
    res.json({ bottles_out: newOut, bottles_agreed: newAgreed });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
});

// قيمة القارورة (لحساب رأس المال اللي برا)
router.put("/settings", async (req, res) => {
  if (!can(req.user, "settings", "edit") && req.user.role !== "super_admin") return res.status(403).json({ error: "ما عندك صلاحية." });
  const v = Number(req.body?.bottle_value);
  if (!Number.isFinite(v) || v < 0 || v > 1000) return res.status(400).json({ error: "القيمة غير صحيحة." });
  await query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ('bottle_value', $1, now())
     ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = now()`,
    [String(v)]
  );
  res.json({ bottle_value: v });
});

export default router;
