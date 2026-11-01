import { Router } from "express";
import { query, pool, logActivity } from "../../db.js";
import { needAny, bad, postLedger, alert, jordanDate } from "./lib.js";

// ============================================================
// الشيكات: كل شيك استلمناه (من السائق، بالمكتب، أو بالبيع بالمصنع) — مين، كم، رقمه، بنكه، إمتى بيتصرف، وصورته
// الحالة: بالانتظار ← انصرف، أو رجع (وبيرجع المبلغ دين على الزبون)
// ============================================================
const router = Router();
const view = needAny(["f_money"], ["f_home"]);
const edit = needAny(["f_money", "edit"], ["f_home"]);

router.get("/cheques", view, async (req, res) => {
  const st = ["pending", "cashed", "bounced"].includes(req.query.status) ? req.query.status : null;
  const r = await query(
    `SELECT g.id, -g.amount AS amount, g.cheque_no, to_char(g.cheque_date, 'YYYY-MM-DD') AS cheque_date, g.cheque_bank, g.cheque_status, g.cheque_status_at,
            g.cheque_in_hand_at, g.photo_url, g.created_at, g.trip_id, g.order_id, g.note, c.id AS customer_id, c.name AS customer_name, c.phone,
            u.full_name AS by_name, (SELECT full_name FROM users WHERE id = g.cheque_status_by) AS status_by_name
     FROM f_ledger g JOIN f_customers c ON c.id = g.customer_id LEFT JOIN users u ON u.id = g.created_by
     WHERE g.method = 'cheque' AND g.kind = 'payment' ${st ? "AND g.cheque_status = $1" : ""}
     ORDER BY (g.cheque_status = 'pending') DESC, g.cheque_date ASC NULLS LAST, g.id DESC LIMIT 500`,
    st ? [st] : []
  );
  const rows = r.rows.map((x) => ({ ...x, amount: Number(x.amount) }));
  const today = jordanDate();
  const pend = rows.filter((x) => x.cheque_status === "pending");
  const sum = (a) => Math.round(a.reduce((s, x) => s + x.amount, 0) * 100) / 100;
  const week = new Date(Date.parse(`${today}T12:00:00Z`) + 7 * 86400000).toISOString().slice(0, 10);
  res.json({
    today, rows,
    totals: {
      pending: sum(pend), pending_n: pend.length,
      due_now: sum(pend.filter((x) => x.cheque_date && x.cheque_date <= today)), due_now_n: pend.filter((x) => x.cheque_date && x.cheque_date <= today).length,
      week: sum(pend.filter((x) => x.cheque_date > today && x.cheque_date <= week)),
      with_drivers: pend.filter((x) => !x.cheque_in_hand_at).length,
    },
  });
});

// استلمنا الشيك الورقي من السائق
router.post("/cheques/:id/in-hand", edit, async (req, res) => {
  const r = await query("UPDATE f_ledger SET cheque_in_hand_at = now() WHERE id = $1 AND method = 'cheque' AND cheque_in_hand_at IS NULL RETURNING id", [req.params.id]);
  if (!r.rows.length) return bad(res, "انسجّل من قبل.");
  res.json({ ok: true });
});

// انصرف أو رجع
router.post("/cheques/:id/status", edit, async (req, res) => {
  const status = req.body?.status;
  if (!["cashed", "bounced"].includes(status)) return bad(res, "اختار انصرف أو رجع.");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const g = (await client.query("SELECT g.*, c.name AS customer_name FROM f_ledger g JOIN f_customers c ON c.id = g.customer_id WHERE g.id = $1 AND g.method = 'cheque' FOR UPDATE", [req.params.id])).rows[0];
    if (!g) { await client.query("ROLLBACK"); return bad(res, "الشيك غير موجود.", 404); }
    if (g.cheque_status !== "pending") { await client.query("ROLLBACK"); return bad(res, "الشيك تسكّر من قبل."); }
    await client.query("UPDATE f_ledger SET cheque_status = $1, cheque_status_at = now(), cheque_status_by = $2, cheque_in_hand_at = COALESCE(cheque_in_hand_at, now()) WHERE id = $3", [status, req.user.id, g.id]);
    // شيك راجع: المبلغ بيرجع دين على الزبون
    if (status === "bounced") {
      await postLedger(client, { customerId: g.customer_id, kind: "adjust", amount: -Number(g.amount), orderId: g.order_id, note: `شيك راجع رقم ${g.cheque_no || ""}${req.body?.note ? ` — ${String(req.body.note).slice(0, 200)}` : ""}`, userId: req.user.id });
    }
    await client.query("COMMIT");
    if (status === "bounced") await alert({ level: "crit", kind: "cheque_bounced", ref: g.customer_id, title: `شيك راجع — ${g.customer_name}`, body: `${(-Number(g.amount)).toFixed(2)} د.أ رقم ${g.cheque_no || ""}. رجع دين على حسابه.` });
    await logActivity({ userId: req.user.id, action: `F_CHEQUE_${status.toUpperCase()}`, recordType: "f_ledger", recordId: g.id });
    res.json({ ok: true });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally { client.release(); }
});

// تذكير: شيكات بتتصرف اليوم (بيشتغل مع مراقبة المصنع)
export async function checkCheques() {
  const today = jordanDate();
  const r = (await query(
    `SELECT g.id, -g.amount AS amount, g.cheque_no, c.name FROM f_ledger g JOIN f_customers c ON c.id = g.customer_id
     WHERE g.method = 'cheque' AND g.cheque_status = 'pending' AND g.cheque_date <= $1`, [today]
  )).rows;
  for (const g of r) await alert({ level: "warn", kind: "cheque_due", ref: g.id, title: `شيك بيتصرف: ${g.name}`, body: `${Number(g.amount).toFixed(2)} د.أ رقم ${g.cheque_no || ""} — موعده اليوم أو فات. أودعه وعلّمه «انصرف».`, dedupe: true });
}

export default router;
