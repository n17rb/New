import { Router } from "express";
import { query, pool, logActivity } from "../../db.js";
import { canAction, can } from "../../permissions.js";
import { bad, round2, postLedger, priceFor, publicToken, ensureTrackToken, queueMessage, pushManagers, alert, once } from "./lib.js";
import { stockBalances } from "./stock.js";

// ============================================================
// بيع على أرض المصنع: زبون إجا عالمصنع واشترى كراتين — الإدارة أو المحاسب أو اللي إله صلاحية «البيع من المصنع»
// الفاتورة بتنعمل وبتتسلّم بنفس اللحظة، الكراتين بتطلع من المستودع مباشرة، والمصاري بتنسجّل بحركة المصاري
// ============================================================
const router = Router();
const canSell = (u) => canAction(u, "factory_sale") || can(u, "f_money", "edit");
const guard = (req, res, next) => (canSell(req.user) ? next() : res.status(403).json({ error: "ما عندك صلاحية «البيع من المصنع»." }));
const WALKIN = "زبون نقدي (بيع بالمصنع)";

router.get("/counter/info", guard, async (req, res) => {
  const bal = await stockBalances();
  const cid = Number(req.query.customer_id) || null;
  const prices = {};
  for (const p of bal) prices[p.id] = cid ? await priceFor(cid, p.id) : Number(p.price);
  res.json({ stock: bal.map((p) => ({ id: p.id, name: p.name, balance: p.balance, price: prices[p.id] })), can_credit: canAction(req.user, "give_credit") });
});

router.post("/counter/sale", guard, once(async (req, res) => {
  const b = req.body || {};
  // الزبون: مسجّل، أو جديد (اسم وتلفون)، أو زبون نقدي بدون اسم
  let c = null;
  if (b.customer_id) c = (await query("SELECT * FROM f_customers WHERE id = $1 AND active", [b.customer_id])).rows[0];
  else if (String(b.new_name || "").trim()) {
    const name = String(b.new_name).trim().slice(0, 120);
    const phone = String(b.new_phone || "").replace(/[^\d+]/g, "").slice(0, 20) || null;
    c = (phone && (await query("SELECT * FROM f_customers WHERE phone = $1 AND active LIMIT 1", [phone])).rows[0])
      || (await query("INSERT INTO f_customers (name, phone, created_by, pay_terms) VALUES ($1,$2,$3,'cash') RETURNING *", [name, phone, req.user.id])).rows[0];
  } else {
    c = (await query("SELECT * FROM f_customers WHERE name = $1 LIMIT 1", [WALKIN])).rows[0]
      || (await query("INSERT INTO f_customers (name, created_by, pay_terms) VALUES ($1,$2,'cash') RETURNING *", [WALKIN, req.user.id])).rows[0];
  }
  if (!c) return bad(res, "اختار الزبون.");
  const bal = new Map((await stockBalances()).map((p) => [p.id, p]));
  const items = [];
  for (const x of Array.isArray(b.items) ? b.items : []) {
    const pid = Number(x.product_id), qty = Math.max(0, Math.round(Number(x.qty) || 0)), bonus = Math.max(0, Math.round(Number(x.bonus) || 0));
    if (!pid || (!qty && !bonus) || qty > 100000 || bonus > 100000) continue;
    const p = bal.get(pid);
    if (!p) continue;
    if (bonus && !canAction(req.user, "give_bonus") && !can(req.user, "f_money", "edit")) return bad(res, "ما عندك صلاحية تعطي بونص.");
    items.push({ product_id: pid, name: p.name, qty, bonus, price: await priceFor(c.id, pid), have: p.balance });
  }
  if (!items.length) return bad(res, "اختار شو اشترى وكم.");
  const short = items.filter((i) => i.qty + i.bonus > i.have);
  if (short.length && !b.confirm_short) return res.status(409).json({ error: `المستودع ما فيه كفاية: ${short.map((i) => `${i.name} (موجود ${i.have})`).join("، ")}. إذا متأكد كمّل.`, code: "SHORT" });
  const total = round2(items.reduce((a, i) => a + i.qty * i.price, 0));
  const cliq = Math.max(0, round2(b.cliq) || 0);
  const cash = b.cash === undefined || b.cash === "" || b.cash === null ? round2(total - cliq) : round2(b.cash);
  if (!(cash >= 0)) return bad(res, "المبلغ غير صحيح.");
  if (cliq > 0 && !b.cliq_photo) return bad(res, "صوّر وصل الكليك.");
  if (round2(cash + cliq) > round2(total + Math.max(0, Number(c.balance) || 0)) + 0.009) return bad(res, "المبلغ أكثر من الفاتورة ودينه — تأكد من الرقم.");
  const debt = round2(total - cash - cliq);
  if (debt > 0) {
    if (c.name === WALKIN) return bad(res, "الزبون النقدي ما بياخذ دين — اكتب اسمه وتلفونه.");
    if (!canAction(req.user, "give_credit")) return bad(res, "ما عندك صلاحية تبيع بالدين.");
  }
  const token = publicToken();
  const client = await pool.connect();
  let orderId, balance;
  try {
    await client.query("BEGIN");
    orderId = (await client.query(
      `INSERT INTO f_orders (customer_id, status, total, delivered_total, cash_paid, delivered_at, invoice_token, notes, created_by, signature)
       VALUES ($1,'delivered',$2,$2,$3,now(),$4,$5,$6,$7) RETURNING id`,
      [c.id, total, cash, token, `بيع بالمصنع${b.note ? ` — ${String(b.note).slice(0, 300)}` : ""}`, req.user.id, b.signature ? String(b.signature).slice(0, 200000) : null]
    )).rows[0].id;
    for (const i of items) {
      await client.query("INSERT INTO f_order_items (order_id, product_id, qty, price, delivered_qty, bonus_qty, delivered_bonus, bonus_manual) VALUES ($1,$2,$3,$4,$3,$5,$5,true)", [orderId, i.product_id, Math.max(i.qty, 0) || 0, i.price, i.bonus]);
      await client.query("INSERT INTO f_stock_moves (product_id, kind, qty, reason, created_by) VALUES ($1,'sale',$2,$3,$4)", [i.product_id, i.qty + i.bonus, `بيع بالمصنع — ${c.name} #${orderId}`, req.user.id]);
    }
    balance = await postLedger(client, { customerId: c.id, kind: "invoice", amount: total, orderId, note: `فاتورة بيع بالمصنع #${orderId}`, userId: req.user.id });
    if (cash > 0) balance = await postLedger(client, { customerId: c.id, kind: "payment", amount: -cash, orderId, method: "cash", note: `كاش — بيع بالمصنع (${req.user.full_name})`, userId: req.user.id });
    if (cliq > 0) {
      balance = await postLedger(client, { customerId: c.id, kind: "payment", amount: -cliq, orderId, method: "cliq", note: "كليك — بيع بالمصنع", userId: req.user.id, photoUrl: b.cliq_photo });
      await client.query("UPDATE f_orders SET cliq_paid = $1, cliq_photo = $2 WHERE id = $3", [cliq, b.cliq_photo, orderId]);
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally { client.release(); }
  if (short.length) await alert({ level: "warn", kind: "counter_short", ref: orderId, title: "بيع بالمصنع أكثر من رصيد المستودع", body: `${short.map((i) => i.name).join("، ")} — تأكد من الجرد.` });
  const cartons = items.reduce((a, i) => a + i.qty + i.bonus, 0);
  await pushManagers({ title: `🏭 بيع بالمصنع: ${c.name}`, body: `${cartons} كرتونة · ${total.toFixed(2)} د.أ · كاش ${cash.toFixed(2)}${debt > 0 ? ` · دين ${debt.toFixed(2)}` : ""} · ${req.user.full_name}`, url: "/f/books", tag: `ctr-${orderId}`, except: req.user.id });
  let message_id = null;
  if (c.phone) {
    const track = await ensureTrackToken(c.id);
    message_id = await queueMessage({ customerId: c.id, orderId, kind: "delivered", data: { order: orderId, items: items.map((i) => `${i.qty} ${i.name}${i.bonus ? ` + ${i.bonus} بونص` : ""}`).join("، "), total, paid: round2(cash + cliq), balance, invoice: token, track }, userId: req.user.id }).catch(() => null);
  }
  await logActivity({ userId: req.user.id, action: "F_COUNTER_SALE", recordType: "f_order", recordId: orderId, newValue: { total, cash, cliq, debt } });
  res.status(201).json({ ok: true, order_id: orderId, invoice_token: token, total, cash, cliq, debt, balance, customer_name: c.name, phone: c.phone, message_id });
}));

export default router;
