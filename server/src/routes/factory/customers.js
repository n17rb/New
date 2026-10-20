import { Router } from "express";
import { query, pool, logActivity } from "../../db.js";
import { can } from "../../permissions.js";
import { need, needAny, bad, postLedger, round2, queueMessage, ensureTrackToken, trackLink, brand } from "./lib.js";

// ============================================================
// المصنع: الزباين، أسعارهم الخاصة، كشف الحساب، الدفعات، والرسائل
// ============================================================
const router = Router();
const view = needAny(["f_customers"], ["f_orders"], ["f_dispatch"], ["f_money"], ["f_drive", "edit"]);
const edit = needAny(["f_customers", "edit"], ["f_orders", "edit"], ["f_drive", "edit"]);
const str = (v, n = 150) => (v == null || v === "" ? null : String(v).trim().slice(0, n));

function phoneClean(p) {
  const d = String(p || "").replace(/[^\d]/g, "");
  if (!d) return null;
  if (d.startsWith("962")) return `0${d.slice(3)}`;
  return d.startsWith("0") ? d : `0${d}`;
}

router.get("/customers", view, async (req, res) => {
  const q = String(req.query.q || "").trim();
  const params = [];
  let where = "c.active";
  if (q) {
    params.push(`%${q}%`);
    where += ` AND (c.name ILIKE $1 OR c.phone ILIKE $1 OR c.city ILIKE $1 OR c.contact_name ILIKE $1)`;
  }
  if (req.query.line) {
    params.push(Number(req.query.line));
    where += ` AND c.line_id = $${params.length}`;
  }
  const r = await query(
    `SELECT c.id, c.name, c.contact_name, c.phone, c.city, c.line_id, c.lat, c.lng, c.kind, c.pay_terms, c.credit_limit, c.balance, c.is_sample,
            l.name AS line_name, l.vehicle_id,
            (SELECT COUNT(*)::int FROM f_orders o WHERE o.customer_id = c.id AND o.status IN ('new','assigned','onway','delayed')) AS open_orders,
            (SELECT MAX(created_at) FROM f_orders o WHERE o.customer_id = c.id) AS last_order_at,
            (SELECT MIN(created_at) FROM f_ledger g WHERE g.customer_id = c.id AND g.kind = 'invoice' AND g.created_at > COALESCE((SELECT MAX(created_at) FROM f_ledger p WHERE p.customer_id = c.id AND p.kind = 'payment'), 'epoch')) AS oldest_unpaid_at
     FROM f_customers c LEFT JOIN f_lines l ON l.id = c.line_id
     WHERE ${where} ORDER BY c.name LIMIT 500`,
    params
  );
  const showMoney = can(req.user, "f_money") || can(req.user, "f_customers") || can(req.user, "f_home");
  res.json(r.rows.map((c) => ({ ...c, balance: showMoney ? Number(c.balance) : undefined, credit_limit: Number(c.credit_limit) })));
});

router.get("/customers/:id", view, async (req, res) => {
  const c = (await query(
    `SELECT c.*, l.name AS line_name FROM f_customers c LEFT JOIN f_lines l ON l.id = c.line_id WHERE c.id = $1`,
    [req.params.id]
  )).rows[0];
  if (!c) return bad(res, "الزبون غير موجود.", 404);
  const [prices, orders, ledger, messages] = await Promise.all([
    query("SELECT cp.product_id, cp.price FROM f_customer_prices cp WHERE cp.customer_id = $1", [c.id]),
    query(
      `SELECT o.id, o.status, o.total, o.delivered_total, o.cash_paid, o.created_at, o.delivered_at, o.eta_at, o.invoice_token,
              (SELECT string_agg(i.qty || ' ' || p.name || CASE WHEN i.bonus_qty > 0 THEN ' +' || i.bonus_qty || ' بونص' ELSE '' END, '، ') FROM f_order_items i JOIN f_products p ON p.id = i.product_id WHERE i.order_id = o.id) AS items
       FROM f_orders o WHERE o.customer_id = $1 ORDER BY o.id DESC LIMIT 30`,
      [c.id]
    ),
    query(
      `SELECT g.*, u.full_name AS by_name FROM f_ledger g LEFT JOIN users u ON u.id = g.created_by
       WHERE g.customer_id = $1 ORDER BY g.id DESC LIMIT 100`,
      [c.id]
    ),
    query("SELECT * FROM f_messages WHERE customer_id = $1 ORDER BY id DESC LIMIT 30", [c.id]),
  ]);
  res.json({
    ...c,
    balance: Number(c.balance),
    credit_limit: Number(c.credit_limit),
    prices: prices.rows.map((p) => ({ product_id: p.product_id, price: Number(p.price) })),
    orders: orders.rows,
    ledger: ledger.rows.map((g) => ({ ...g, amount: Number(g.amount), balance_after: Number(g.balance_after) })),
    messages: messages.rows,
    track_link: c.track_token ? trackLink(c.track_token) : null,
  });
});

function cleanCustomer(b) {
  const name = str(b.name);
  if (!name) throw new Error("اكتب اسم المحل أو الزبون.");
  const lat = b.lat === "" || b.lat == null ? null : Number(b.lat);
  const lng = b.lng === "" || b.lng == null ? null : Number(b.lng);
  return {
    name, contact_name: str(b.contact_name, 100), phone: phoneClean(b.phone), city: str(b.city, 60), address: str(b.address, 300),
    line_id: b.line_id ? Number(b.line_id) : null, lat: Number.isFinite(lat) ? lat : null, lng: Number.isFinite(lng) ? lng : null,
    kind: str(b.kind, 30), pay_terms: b.pay_terms === "credit" ? "credit" : "cash",
    credit_limit: Math.max(0, Number(b.credit_limit) || 0), notes: str(b.notes, 500),
  };
}

async function savePrices(client, customerId, prices) {
  if (!Array.isArray(prices)) return;
  await client.query("DELETE FROM f_customer_prices WHERE customer_id = $1", [customerId]);
  for (const p of prices) {
    const v = Number(p.price);
    if (p.product_id && p.price !== "" && p.price != null && Number.isFinite(v) && v >= 0) {
      await client.query("INSERT INTO f_customer_prices (customer_id, product_id, price) VALUES ($1,$2,$3)", [customerId, p.product_id, v]);
    }
  }
}

router.post("/customers", edit, async (req, res) => {
  let c; try { c = cleanCustomer(req.body || {}); } catch (e) { return bad(res, e.message); }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query(
      `INSERT INTO f_customers (name, contact_name, phone, city, address, line_id, lat, lng, kind, pay_terms, credit_limit, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [c.name, c.contact_name, c.phone, c.city, c.address, c.line_id, c.lat, c.lng, c.kind, c.pay_terms, c.credit_limit, c.notes, req.user.id]
    );
    const id = r.rows[0].id;
    if (can(req.user, "f_customers", "edit")) await savePrices(client, id, req.body?.prices);
    const opening = round2(req.body?.opening_balance);
    if (opening && can(req.user, "f_money", "edit")) {
      await postLedger(client, { customerId: id, kind: "opening", amount: opening, note: "رصيد افتتاحي", userId: req.user.id });
    }
    await client.query("COMMIT");
    await logActivity({ userId: req.user.id, action: "F_CREATE_CUSTOMER", recordType: "f_customer", recordId: id, newValue: c });
    res.status(201).json(r.rows[0]);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
});

router.put("/customers/:id", need("f_customers", "edit"), async (req, res) => {
  let c; try { c = cleanCustomer(req.body || {}); } catch (e) { return bad(res, e.message); }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query(
      `UPDATE f_customers SET name=$1, contact_name=$2, phone=$3, city=$4, address=$5, line_id=$6, lat=$7, lng=$8, kind=$9,
         pay_terms=$10, credit_limit=$11, notes=$12 WHERE id=$13 RETURNING *`,
      [c.name, c.contact_name, c.phone, c.city, c.address, c.line_id, c.lat, c.lng, c.kind, c.pay_terms, c.credit_limit, c.notes, req.params.id]
    );
    if (!r.rows[0]) { await client.query("ROLLBACK"); return bad(res, "الزبون غير موجود.", 404); }
    await savePrices(client, r.rows[0].id, req.body?.prices);
    await client.query("COMMIT");
    await logActivity({ userId: req.user.id, action: "F_UPDATE_CUSTOMER", recordType: "f_customer", recordId: r.rows[0].id, newValue: c });
    res.json(r.rows[0]);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
});

// السائق بيحفظ موقع الزبون وهو واقف عنده
router.post("/customers/:id/location", edit, async (req, res) => {
  const lat = Number(req.body?.lat), lng = Number(req.body?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return bad(res, "الموقع غير صحيح.");
  await query("UPDATE f_customers SET lat = $1, lng = $2 WHERE id = $3", [lat, lng, req.params.id]);
  res.json({ ok: true });
});

router.delete("/customers/:id", need("f_customers", "edit"), async (req, res) => {
  const c = (await query("SELECT balance FROM f_customers WHERE id = $1", [req.params.id])).rows[0];
  if (!c) return bad(res, "الزبون غير موجود.", 404);
  if (Math.abs(Number(c.balance)) > 0.01) return bad(res, "الزبون عليه رصيد — سكّر حسابه قبل ما تحذفه.");
  await query("UPDATE f_customers SET active = false WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});

// ---------- دفعة من الزبون (كاش، شيك، تحويل) ----------
router.post("/customers/:id/payments", needAny(["f_money", "edit"], ["f_customers", "edit"]), async (req, res) => {
  const amount = round2(req.body?.amount);
  if (!(amount > 0)) return bad(res, "اكتب المبلغ.");
  const method = ["cash", "cheque", "transfer"].includes(req.body?.method) ? req.body.method : "cash";
  if (method === "cheque" && !req.body?.cheque_no) return bad(res, "اكتب رقم الشيك.");
  const c = (await query("SELECT id, name FROM f_customers WHERE id = $1", [req.params.id])).rows[0];
  if (!c) return bad(res, "الزبون غير موجود.", 404);
  const balance = await postLedger(null, {
    customerId: c.id, kind: "payment", amount: -amount, method, chequeNo: req.body?.cheque_no || null,
    chequeDate: req.body?.cheque_date || null, note: str(req.body?.note, 300), userId: req.user.id,
  });
  await queueMessage({ customerId: c.id, kind: "payment", data: { amount, balance }, userId: req.user.id });
  await logActivity({ userId: req.user.id, action: "F_CUSTOMER_PAYMENT", recordType: "f_customer", recordId: c.id, newValue: { amount, method } });
  res.json({ ok: true, balance });
});

// تعديل رصيد يدوي (بسبب) — للحسابات
router.post("/customers/:id/adjust", need("f_money", "edit"), async (req, res) => {
  const amount = round2(req.body?.amount);
  const note = str(req.body?.note, 300);
  if (!amount) return bad(res, "اكتب المبلغ (موجب يزيد الدين، سالب ينزّله).");
  if (!note) return bad(res, "اكتب سبب التعديل.");
  const balance = await postLedger(null, { customerId: Number(req.params.id), kind: "adjust", amount, note, userId: req.user.id });
  await logActivity({ userId: req.user.id, action: "F_CUSTOMER_ADJUST", recordType: "f_customer", recordId: Number(req.params.id), newValue: { amount, note } });
  res.json({ ok: true, balance });
});

// ---------- رابط المتابعة للزبون ----------
router.post("/customers/:id/track-link", view, async (req, res) => {
  const c = (await query("SELECT id, name FROM f_customers WHERE id = $1", [req.params.id])).rows[0];
  if (!c) return bad(res, "الزبون غير موجود.", 404);
  const tok = await ensureTrackToken(c.id);
  const b = await brand();
  res.json({ link: trackLink(tok), text: `أهلاً ${c.name}. من هالرابط بتشوف طلباتك وموعد وصولها وكشف حسابك أول بأول:\n${trackLink(tok)}\n— ${b.name}` });
});

// ---------- الرسائل ----------
router.get("/messages", needAny(["f_dispatch"], ["f_orders"], ["f_customers"], ["f_money"], ["f_drive", "edit"]), async (req, res) => {
  const params = [];
  let where = "1=1";
  if (req.query.pending) where += " AND m.sent_at IS NULL AND m.created_at > now() - interval '3 days'";
  if (req.query.customer) { params.push(Number(req.query.customer)); where += ` AND m.customer_id = $${params.length}`; }
  if (req.query.ids) { params.push(String(req.query.ids).split(",").map(Number).filter(Boolean)); where += ` AND m.id = ANY($${params.length}::int[])`; }
  const r = await query(
    `SELECT m.*, c.name AS customer_name, c.phone FROM f_messages m JOIN f_customers c ON c.id = m.customer_id
     WHERE ${where} ORDER BY m.id ${req.query.ids ? "ASC" : "DESC"} LIMIT 200`,
    params
  );
  res.json(r.rows);
});

router.post("/messages/:id/sent", async (req, res) => {
  await query("UPDATE f_messages SET sent_at = COALESCE(sent_at, now()) WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});

// رسالة خاصة من الإدارة: لزبون، أو لكل زباين خط، أو مدينة، أو الكل
router.post("/messages", needAny(["f_dispatch", "edit"], ["f_customers", "edit"], ["f_home"]), async (req, res) => {
  const body = str(req.body?.body, 1000);
  if (!body) return bad(res, "اكتب الرسالة.");
  let ids = [];
  if (Array.isArray(req.body?.customer_ids)) ids = req.body.customer_ids.map(Number).filter(Boolean);
  else if (req.body?.line_id) ids = (await query("SELECT id FROM f_customers WHERE active AND line_id = $1", [req.body.line_id])).rows.map((r) => r.id);
  else if (req.body?.city) ids = (await query("SELECT id FROM f_customers WHERE active AND city = $1", [req.body.city])).rows.map((r) => r.id);
  else if (req.body?.all) ids = (await query("SELECT id FROM f_customers WHERE active")).rows.map((r) => r.id);
  if (!ids.length) return bad(res, "اختار لمين بدك تبعت.");
  const out = [];
  for (const id of ids.slice(0, 300)) out.push(await queueMessage({ customerId: id, kind: "custom", data: { body }, userId: req.user.id }));
  res.json({ ok: true, ids: out });
});

export default router;
