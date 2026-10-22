import { Router } from "express";
import { query, pool, logActivity } from "../../db.js";
import { needAny, bad, round2, postLedger, alert } from "./lib.js";
import { loadOrders } from "./orders.js";

// ============================================================
// تصحيح فاتورة بعد التسليم (كمية غلط، الزبون رجّع بضاعة، الكاش انكتب غلط)
// كل إشي بيتعدّل مع بعض: حساب الزبون، الجرد، المستودع (إذا المرتجع انستلم)، وعهدة السائق (إذا الكاش انستلم)
// وكل تصحيح بيضل محفوظ: مين، إمتى، ليش، وشو كانت وشو صارت
// ============================================================
const router = Router();
const canFix = needAny(["f_money", "edit"], ["f_orders", "edit"]);

router.get("/orders/:id/detail", canFix, async (req, res) => {
  const o = (await loadOrders("o.id = $1", [req.params.id]))[0];
  if (!o) return bad(res, "الطلب غير موجود.", 404);
  const edits = (await query(
    "SELECT e.*, u.full_name AS user_name FROM f_order_edits e LEFT JOIN users u ON u.id = e.user_id WHERE e.order_id = $1 ORDER BY e.id DESC",
    [o.id]
  )).rows;
  res.json({ ...o, edits });
});

router.post("/orders/:id/correct", canFix, async (req, res) => {
  const b = req.body || {};
  const reason = String(b.reason || "").trim().slice(0, 300);
  if (!reason) return bad(res, "اكتب سبب التصحيح.");
  const o = (await loadOrders("o.id = $1", [req.params.id]))[0];
  if (!o) return bad(res, "الطلب غير موجود.", 404);
  if (o.status !== "delivered") return bad(res, "بنصحّح بس فواتير انسلّمت.");
  const t = o.trip_id ? (await query("SELECT * FROM f_trips WHERE id = $1", [o.trip_id])).rows[0] : null;

  const want = new Map((b.items || []).map((x) => [Number(x.item_id), x]));
  const lines = [];
  for (const it of o.items) {
    const x = want.get(it.id) || {};
    const oq = it.delivered_qty ?? it.qty;
    const ob = it.delivered_bonus ?? it.bonus_qty ?? 0;
    const nq = x.delivered_qty == null ? oq : Math.round(Number(x.delivered_qty));
    const nb = x.delivered_bonus == null ? ob : Math.round(Number(x.delivered_bonus));
    if (!(nq >= 0) || !(nb >= 0) || nq > 100000 || nb > 100000) return bad(res, `كمية ${it.name} غير صحيحة.`);
    lines.push({ it, oq, ob, nq, nb });
  }
  const oldTotal = round2(o.delivered_total);
  const newTotal = round2(lines.reduce((a, l) => a + l.nq * l.it.price, 0));
  const oldCash = round2(o.cash_paid);
  const newCash = b.cash === undefined || b.cash === null || b.cash === "" ? oldCash : round2(b.cash);
  if (!(newCash >= 0)) return bad(res, "المبلغ غير صحيح.");
  const dTotal = round2(newTotal - oldTotal);
  const dCash = round2(newCash - oldCash);
  const changed = lines.some((l) => l.nq !== l.oq || l.nb !== l.ob) || dCash !== 0;
  if (!changed) return bad(res, "ما في إشي تغيّر.");

  const before = { total: oldTotal, cash: oldCash, items: lines.map((l) => ({ name: l.it.name, qty: l.oq, bonus: l.ob })) };
  const after = { total: newTotal, cash: newCash, items: lines.map((l) => ({ name: l.it.name, qty: l.nq, bonus: l.nb })) };

  const client = await pool.connect();
  let balance;
  try {
    await client.query("BEGIN");
    const cur = (await client.query("SELECT status FROM f_orders WHERE id = $1 FOR UPDATE", [o.id])).rows[0];
    if (cur?.status !== "delivered") { await client.query("ROLLBACK"); return bad(res, "الطلب تغيّر — حدّث الصفحة."); }
    for (const l of lines) {
      if (l.nq !== l.oq || l.nb !== l.ob) await client.query("UPDATE f_order_items SET delivered_qty = $1, delivered_bonus = $2 WHERE id = $3", [l.nq, l.nb, l.it.id]);
      // المرتجع انستلم والسيارة تسكّرت؟ الفرق بيتعدّل على المستودع مباشرة
      const dOut = (l.nq + l.nb) - (l.oq + l.ob);
      if (dOut !== 0 && t?.returns_received_at) {
        await client.query(
          "INSERT INTO f_stock_moves (product_id, kind, qty, trip_id, vehicle_id, reason, created_by) VALUES ($1,'adjust',$2,$3,$4,$5,$6)",
          [l.it.product_id, -dOut, t.id, t.vehicle_id, `تصحيح فاتورة #${o.id}: ${reason}`, req.user.id]
        );
      }
    }
    await client.query("UPDATE f_orders SET delivered_total = $1, cash_paid = $2, edited_by = $3, edited_at = now(), updated_at = now() WHERE id = $4", [newTotal, newCash, req.user.id, o.id]);
    if (dTotal !== 0) balance = await postLedger(client, { customerId: o.customer_id, kind: "adjust", amount: dTotal, orderId: o.id, tripId: o.trip_id, note: `تصحيح فاتورة #${o.id}: ${reason}`, userId: req.user.id });
    if (dCash !== 0) balance = await postLedger(client, { customerId: o.customer_id, kind: "payment", amount: -dCash, orderId: o.id, tripId: o.trip_id, method: "cash", note: `تصحيح كاش فاتورة #${o.id}: ${reason}`, userId: req.user.id });
    // الكاش انستلم من السائق من قبل؟ الفرق بيصير عليه أو إله
    if (dCash !== 0 && t?.settled_at && t.driver_id) {
      await client.query(
        "INSERT INTO f_driver_ledger (driver_id, kind, amount, trip_id, note, created_by) VALUES ($1,$2,$3,$4,$5,$6)",
        [t.driver_id, dCash > 0 ? "shortage" : "surplus", dCash, t.id, `تصحيح كاش فاتورة #${o.id}: ${reason}`, req.user.id]
      );
    }
    await client.query("INSERT INTO f_order_edits (order_id, user_id, reason, before, after) VALUES ($1,$2,$3,$4,$5)", [o.id, req.user.id, reason, JSON.stringify(before), JSON.stringify(after)]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  if (balance === undefined) balance = Number((await query("SELECT balance FROM f_customers WHERE id = $1", [o.customer_id])).rows[0]?.balance || 0);
  await logActivity({ userId: req.user.id, action: "F_INVOICE_CORRECT", recordType: "f_order", recordId: o.id, oldValue: before, newValue: { ...after, reason } });
  await alert({
    level: "info", kind: "invoice_edit", ref: o.id,
    title: `✏️ ${req.user.full_name} صحّح فاتورة #${o.id} — ${o.customer_name}`,
    body: `${reason}. المجموع ${oldTotal.toFixed(2)} ← ${newTotal.toFixed(2)}${dCash ? ` · الكاش ${oldCash.toFixed(2)} ← ${newCash.toFixed(2)}` : ""}.`,
  });
  res.json({ ok: true, total: newTotal, cash: newCash, balance: round2(balance) });
});

export default router;
