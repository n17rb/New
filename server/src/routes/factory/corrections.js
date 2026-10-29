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

// ============================================================
// تصحيح سعر منتج على فواتير قديمة (مثلًا: انحسب 1.50 والسعر الصح 1.70)
// الفواتير المسلّمة: بيتعدّل السعر والمجموع، والفرق بينضاف على حساب الزبون (أو بينزل منه)، وكل فاتورة بتنعلّم «معدّلة»
// الطلبات اللي لسا ما انسلّمت: بيتعدّل سعرها بس
// ============================================================
const OPEN = ["new", "assigned", "onway", "delayed"];
async function priceLines({ product_id, wrong, from, to, skip_special }) {
  const r = await query(
    `SELECT i.id AS item_id, i.order_id, i.qty, i.delivered_qty, i.price, o.status, o.customer_id, o.trip_id,
            c.name AS customer_name, COALESCE(o.delivered_at, o.created_at) AS at,
            EXISTS (SELECT 1 FROM f_customer_prices cp WHERE cp.customer_id = o.customer_id AND cp.product_id = i.product_id) AS special
     FROM f_order_items i JOIN f_orders o ON o.id = i.order_id JOIN f_customers c ON c.id = o.customer_id
     WHERE i.product_id = $1 AND i.price = $2 AND o.status NOT IN ('cancelled','failed')
       AND (COALESCE(o.delivered_at, o.created_at) AT TIME ZONE 'Asia/Amman')::date BETWEEN $3 AND $4
     ORDER BY COALESCE(o.delivered_at, o.created_at) DESC`,
    [product_id, wrong, from, to]
  );
  return r.rows.filter((x) => !(skip_special && x.special)).map((x) => ({ ...x, price: Number(x.price) }));
}
function priceArgs(src) {
  const isD = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || "");
  const a = {
    product_id: Number(src.product_id), wrong: round2(src.wrong), right: round2(src.right),
    from: isD(src.from) ? src.from : "2000-01-01", to: isD(src.to) ? src.to : "2100-01-01",
    skip_special: !(src.skip_special === false || src.skip_special === "0" || src.skip_special === "false"),
  };
  if (!a.product_id) throw new Error("اختار المنتج.");
  if (!(a.wrong >= 0) || !(a.right >= 0)) throw new Error("اكتب السعر الغلط والسعر الصح.");
  if (a.wrong === a.right) throw new Error("السعرين نفس الإشي.");
  return a;
}
function summarize(lines, right) {
  const byOrder = new Map();
  for (const l of lines) {
    const done = l.status === "delivered";
    const q = done ? (l.delivered_qty ?? l.qty) : l.qty;
    const d = round2(q * (right - l.price));
    const o = byOrder.get(l.order_id) || { order_id: l.order_id, customer_id: l.customer_id, customer_name: l.customer_name, at: l.at, delivered: done, qty: 0, diff: 0, trip_id: l.trip_id, items: [] };
    o.qty += q; o.diff = round2(o.diff + d); o.items.push(l);
    byOrder.set(l.order_id, o);
  }
  const orders = [...byOrder.values()];
  const del = orders.filter((o) => o.delivered);
  return {
    orders,
    delivered_count: del.length,
    open_count: orders.length - del.length,
    customers: new Set(del.map((o) => o.customer_id)).size,
    total_diff: round2(del.reduce((a, o) => a + o.diff, 0)),
  };
}

router.get("/prices/fix-preview", canFix, async (req, res) => {
  let a; try { a = priceArgs(req.query); } catch (e) { return bad(res, e.message); }
  const lines = await priceLines(a);
  const special = a.skip_special ? (await priceLines({ ...a, skip_special: false })).filter((x) => x.special) : [];
  const s = summarize(lines, a.right);
  res.json({ ...s, orders: s.orders.slice(0, 300).map(({ items, ...o }) => o), special_customers: [...new Set(special.map((x) => x.customer_name))].slice(0, 30) });
});

router.post("/prices/fix", canFix, async (req, res) => {
  let a; try { a = priceArgs(req.body || {}); } catch (e) { return bad(res, e.message); }
  const reason = String(req.body?.reason || "").trim().slice(0, 200) || `تصحيح السعر من ${a.wrong} إلى ${a.right}`;
  const p = (await query("SELECT name FROM f_products WHERE id = $1", [a.product_id])).rows[0];
  if (!p) return bad(res, "المنتج غير موجود.", 404);
  const s = summarize(await priceLines(a), a.right);
  if (!s.orders.length) return bad(res, "ما في فواتير بهالسعر.");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const o of s.orders) {
      const before = (await client.query("SELECT total, delivered_total FROM f_orders WHERE id = $1 FOR UPDATE", [o.order_id])).rows[0];
      await client.query("UPDATE f_order_items SET price = $1 WHERE id = ANY($2::int[])", [a.right, o.items.map((x) => x.item_id)]);
      const t = (await client.query(
        "SELECT COALESCE(SUM(qty * price),0) AS total, COALESCE(SUM(COALESCE(delivered_qty, qty) * price),0) AS dtotal FROM f_order_items WHERE order_id = $1",
        [o.order_id]
      )).rows[0];
      if (o.delivered) {
        const newD = round2(t.dtotal);
        const oldD = round2(before.delivered_total ?? 0);
        await client.query("UPDATE f_orders SET total = $1, delivered_total = $2, edited_by = $3, edited_at = now(), updated_at = now() WHERE id = $4", [round2(t.total), newD, req.user.id, o.order_id]);
        const dTotal = round2(newD - oldD);
        if (dTotal !== 0) await postLedger(client, { customerId: o.customer_id, kind: "adjust", amount: dTotal, orderId: o.order_id, tripId: o.trip_id, note: `تصحيح سعر ${p.name} (${a.wrong} ← ${a.right}) فاتورة #${o.order_id}`, userId: req.user.id });
        await client.query("INSERT INTO f_order_edits (order_id, user_id, reason, before, after) VALUES ($1,$2,$3,$4,$5)", [
          o.order_id, req.user.id, `${reason} — ${p.name}`, JSON.stringify({ total: oldD, price: a.wrong }), JSON.stringify({ total: newD, price: a.right }),
        ]);
      } else {
        await client.query("UPDATE f_orders SET total = $1, updated_at = now() WHERE id = $2", [round2(t.total), o.order_id]);
      }
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  await logActivity({ userId: req.user.id, action: "F_PRICE_FIX", recordType: "f_product", recordId: a.product_id, newValue: { ...a, orders: s.orders.length, total_diff: s.total_diff } });
  await alert({
    level: "info", kind: "invoice_edit", ref: a.product_id,
    title: `✏️ ${req.user.full_name} صحّح سعر ${p.name} على ${s.delivered_count} فاتورة`,
    body: `${a.wrong} ← ${a.right}. الفرق على حسابات الزباين: ${s.total_diff.toFixed(2)} د.أ${s.open_count ? ` · و${s.open_count} طلب لسا ما انسلّم` : ""}.`,
  });
  res.json({ ok: true, delivered_count: s.delivered_count, open_count: s.open_count, customers: s.customers, total_diff: s.total_diff });
});

export default router;
