import { Router } from "express";
import { query, pool, logActivity } from "../../db.js";
import { can, canAction } from "../../permissions.js";
import { inferRegion, validRegion, reverseRegion } from "../../utils/jordanRegions.js";
import { smartFilter } from "../../utils/fuzzySearch.js";
import { need, needAny, bad, postLedger, round2, queueMessage, ensureTrackToken, trackLink, brand, pushManagers } from "./lib.js";

// ============================================================
// المصنع: الزباين، أسعارهم الخاصة، كشف الحساب، الدفعات، والرسائل
// ============================================================
const router = Router();
const view = needAny(["f_customers"], ["f_orders"], ["f_dispatch"], ["f_money"], ["f_drive", "edit"]);
const edit = needAny(["f_customers", "edit"], ["f_orders", "edit"], ["f_drive", "edit"]);
const editOrFleet = needAny(["f_customers", "edit"], ["f_orders", "edit"], ["f_drive", "edit"], ["f_fleet", "edit"]);
const str = (v, n = 150) => (v == null || v === "" ? null : String(v).trim().slice(0, n));

// الزباين القدام اللي ما إلهم محافظة/لواء: منطلعهم من اسم المنطقة
export function withRegion(c) {
  if (c.governorate) return c;
  const r = inferRegion(c.city);
  return { ...c, governorate: r.governorate, district: r.district };
}

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
  // البحث صار ذكي (بيتحمّل الأخطاء الإملائية) — منجيب الكل ومنرتّب حسب القرب
  if (req.query.line) {
    params.push(Number(req.query.line));
    where += ` AND c.line_id = $${params.length}`;
  }
  const r = await query(
    `SELECT c.id, c.seq_no, c.photo_url, c.name, c.contact_name, c.phone, c.address, c.governorate, c.district, c.city, c.line_id, c.lat, c.lng, c.kind, c.pay_terms, c.credit_limit, c.balance, c.is_sample,
            l.name AS line_name, l.vehicle_id,
            (SELECT COUNT(*)::int FROM f_orders o WHERE o.customer_id = c.id AND o.status IN ('new','assigned','onway','delayed')) AS open_orders,
            (SELECT MAX(created_at) FROM f_orders o WHERE o.customer_id = c.id) AS last_order_at,
            (SELECT MIN(created_at) FROM f_ledger g WHERE g.customer_id = c.id AND g.kind = 'invoice' AND g.created_at > COALESCE((SELECT MAX(created_at) FROM f_ledger p WHERE p.customer_id = c.id AND p.kind = 'payment'), 'epoch')) AS oldest_unpaid_at
     FROM f_customers c LEFT JOIN f_lines l ON l.id = c.line_id
     WHERE ${where} ORDER BY c.name ${q ? "" : "LIMIT 500"}`,
    params
  );
  if (q) r.rows = smartFilter(r.rows, q).slice(0, 500);
  const showMoney = can(req.user, "f_money") || can(req.user, "f_customers") || can(req.user, "f_home");
  res.json(r.rows.map((c) => ({ ...withRegion(c), balance: showMoney ? Number(c.balance) : undefined, credit_limit: Number(c.credit_limit) })));
});

// ---------- خريطة كثافة الزباين: وين متجمّعين، وكم بيطلبوا ----------
router.get("/density", view, async (req, res) => {
  const r = await query(
    `SELECT c.id, c.name, c.city, c.governorate, c.district, c.lat, c.lng,
            COUNT(o.id)::int AS orders_30, COALESCE(SUM(o.delivered_total), 0) AS sales_30,
            COALESCE(SUM(CASE WHEN o.status = 'delivered' THEN (SELECT SUM(COALESCE(i.delivered_qty, i.qty)) FROM f_order_items i WHERE i.order_id = o.id) END), 0)::int AS cartons_30
     FROM f_customers c
     LEFT JOIN f_orders o ON o.customer_id = c.id AND o.created_at > now() - interval '30 days' AND o.status <> 'cancelled'
     WHERE c.active GROUP BY c.id`
  );
  const showMoney = can(req.user, "f_money") || can(req.user, "f_home");
  res.json(r.rows.map((c) => ({ ...withRegion(c), sales_30: showMoney ? Number(c.sales_30) : undefined })));
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
    ...withRegion(c),
    balance: Number(c.balance),
    credit_limit: Number(c.credit_limit),
    prices: prices.rows.map((p) => ({ product_id: p.product_id, price: Number(p.price) })),
    orders: orders.rows,
    ledger: ledger.rows.map((g) => ({ ...g, amount: Number(g.amount), balance_after: Number(g.balance_after) })),
    messages: messages.rows,
    track_link: c.track_token ? trackLink(c.track_token) : null,
  });
});

// إحداثيات من رابط خرائط جوجل (الطويل مباشرة، والقصير maps.app.goo.gl بنفتحه ونقرأ وين بيحوّل)
export function coordsFromLink(link) {
  if (!link) return null;
  const s = decodeURIComponent(String(link));
  const m = s.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) || s.match(/[?&](?:q|query|ll|destination)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/) || s.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) || s.match(/(-?\d{1,2}\.\d{3,}),\s*(-?\d{1,3}\.\d{3,})/);
  if (!m) return null;
  const lat = Number(m[1]), lng = Number(m[2]);
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

async function resolveLink(link) {
  const direct = coordsFromLink(link);
  if (direct) return direct;
  if (!/^https?:\/\/([a-z0-9-]+\.)*(goo\.gl|google\.[a-z.]+|g\.co)\//i.test(link)) return null;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    const r = await fetch(link, { redirect: "follow", signal: ctl.signal, headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" } });
    clearTimeout(t);
    return coordsFromLink(r.url) || coordsFromLink((await r.text()).slice(0, 200000).match(/https:\/\/www\.google\.[a-z.]+\/maps[^"'\s]+/)?.[0]);
  } catch {
    return null;
  }
}

export async function nextSeq(client = null) {
  const q = client ? (t, p) => client.query(t, p) : query;
  return Number((await q("SELECT COALESCE(MAX(seq_no), 0) + 1 AS n FROM f_customers")).rows[0].n);
}

router.get("/customers-next-seq", view, async (req, res) => res.json({ next: await nextSeq() }));

// رابط موقع ملصوق: بنرجّع الإحداثيات عشان الشاشة توري «الموقع محفوظ»
router.post("/customers-resolve-link", editOrFleet, async (req, res) => {
  const p = await resolveLink(String(req.body?.url || "").trim());
  if (!p) return bad(res, "ما قدرنا نقرأ الموقع من الرابط. افتح الموقع بخرائط جوجل ← مشاركة ← نسخ الرابط، والصقه هون.");
  res.json(p);
});

export async function cleanCustomer(b) {
  const name = str(b.name);
  if (!name) throw new Error("اكتب اسم المحل أو الزبون.");
  let lat = b.lat === "" || b.lat == null ? null : Number(b.lat);
  let lng = b.lng === "" || b.lng == null ? null : Number(b.lng);
  const maps_url = str(b.maps_url, 600);
  if (maps_url && !/^https?:\/\//i.test(maps_url)) throw new Error("رابط الموقع لازم يبلّش بـ https://");
  if (maps_url && b.from_link) {
    const p = await resolveLink(maps_url);
    if (!p) throw new Error("ما قدرنا نقرأ الموقع من الرابط. افتح الموقع بخرائط جوجل ← مشاركة ← نسخ الرابط، والصقه هون.");
    lat = p.lat; lng = p.lng;
  }
  let seq_no = null;
  if (b.seq_no !== undefined && b.seq_no !== null && String(b.seq_no).trim() !== "") {
    seq_no = Number(String(b.seq_no).replace(/[^\d]/g, ""));
    if (!Number.isInteger(seq_no) || seq_no <= 0 || seq_no > 99999999) throw new Error("الرقم التسلسلي لازم يكون رقم موجب.");
  }
  const photo_url = str(b.photo_url, 500);
  if (photo_url && !/^https:\/\//i.test(photo_url)) throw new Error("الصورة غير صحيحة.");
  let region = validRegion(b.governorate, b.district);
  let city = b.city;
  // ما في محافظة؟ منعرفها لحالها من الموقع، وإلا من اسم المنطقة
  if (!region.governorate && Number.isFinite(lat) && lat) {
    const r = await reverseRegion(lat, lng);
    if (r?.governorate) { region = { governorate: r.governorate, district: r.district }; if (!str(city)) city = r.city; }
  }
  if (!region.governorate) region = inferRegion(city);
  return {
    governorate: region.governorate, district: region.district,
    seq_no, photo_url, maps_url,
    name, contact_name: str(b.contact_name, 100), phone: phoneClean(b.phone), city: str(city, 60), address: str(b.address, 300),
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

// من الموقع ← المحافظة واللواء والمنطقة (لما تختار موقع الزبون)
router.post("/customers-region", async (req, res) => {
  const r = await reverseRegion(req.body?.lat, req.body?.lng);
  if (!r) return bad(res, "الموقع غير صحيح.");
  res.json(r);
});

router.post("/customers", edit, async (req, res) => {
  let c; try { c = await cleanCustomer(req.body || {}); } catch (e) { return bad(res, e.message); }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("LOCK TABLE f_customers IN SHARE ROW EXCLUSIVE MODE");
    if (c.seq_no) {
      const taken = (await client.query("SELECT name FROM f_customers WHERE seq_no = $1", [c.seq_no])).rows[0];
      if (taken) { await client.query("ROLLBACK"); return bad(res, `الرقم ${c.seq_no} مستخدم للزبون «${taken.name}». اختار رقم ثاني أو خلّيه فاضي.`); }
    } else c.seq_no = await nextSeq(client);
    const r = await client.query(
      `INSERT INTO f_customers (name, contact_name, phone, city, address, line_id, lat, lng, kind, pay_terms, credit_limit, notes, created_by, seq_no, photo_url, maps_url, governorate, district)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
      [c.name, c.contact_name, c.phone, c.city, c.address, c.line_id, c.lat, c.lng, c.kind, c.pay_terms, c.credit_limit, c.notes, req.user.id, c.seq_no, c.photo_url, c.maps_url, c.governorate, c.district]
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
  let c; try { c = await cleanCustomer(req.body || {}); } catch (e) { return bad(res, e.message); }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (c.seq_no) {
      const taken = (await client.query("SELECT name FROM f_customers WHERE seq_no = $1 AND id <> $2", [c.seq_no, req.params.id])).rows[0];
      if (taken) { await client.query("ROLLBACK"); return bad(res, `الرقم ${c.seq_no} مستخدم للزبون «${taken.name}». اختار رقم ثاني.`); }
    }
    const r = await client.query(
      `UPDATE f_customers SET name=$1, contact_name=$2, phone=$3, city=$4, address=$5, line_id=$6, lat=$7, lng=$8, kind=$9,
         pay_terms=$10, credit_limit=$11, notes=$12, seq_no=COALESCE($14, seq_no), photo_url=$15, maps_url=$16, governorate=$17, district=$18 WHERE id=$13 RETURNING *`,
      [c.name, c.contact_name, c.phone, c.city, c.address, c.line_id, c.lat, c.lng, c.kind, c.pay_terms, c.credit_limit, c.notes, req.params.id, c.seq_no, c.photo_url, c.maps_url, c.governorate, c.district]
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
  await query("UPDATE f_customers SET lat = $1, lng = $2, maps_url = $4 WHERE id = $3", [lat, lng, req.params.id, `https://www.google.com/maps?q=${lat},${lng}`]);
  res.json({ ok: true });
});

// حذف زبون: للإدارة بس (صلاحية «حذف عميل»). الزبون بينخفى وسجلّاته وفواتيره القديمة بتضل للجرد
router.delete("/customers/:id", need("f_customers", "edit"), async (req, res) => {
  if (!canAction(req.user, "delete_customer")) return bad(res, "حذف الزباين للإدارة بس.", 403);
  const c = (await query("SELECT id, name, balance FROM f_customers WHERE id = $1 AND active", [req.params.id])).rows[0];
  if (!c) return bad(res, "الزبون غير موجود.", 404);
  if (Math.abs(Number(c.balance)) > 0.01) return bad(res, `${c.name} عليه/إله رصيد ${Number(c.balance).toFixed(2)} — سكّر حسابه قبل ما تحذفه.`);
  const open = (await query("SELECT COUNT(*)::int AS n FROM f_orders WHERE customer_id = $1 AND status IN ('new','assigned','onway','delayed')", [c.id])).rows[0].n;
  if (open) return bad(res, `${c.name} عنده ${open} طلب مفتوح — الغيهم أو سلّمهم أول.`);
  await query("UPDATE f_customers SET active = false WHERE id = $1", [c.id]);
  await query("UPDATE f_recurring SET active = false WHERE customer_id = $1", [c.id]).catch(() => {});
  await logActivity({ userId: req.user.id, action: "F_DELETE_CUSTOMER", recordType: "f_customer", recordId: c.id, oldValue: { name: c.name } });
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
  const message_id = await queueMessage({ customerId: c.id, kind: "payment", data: { amount, balance }, userId: req.user.id });
  await logActivity({ userId: req.user.id, action: "F_CUSTOMER_PAYMENT", recordType: "f_customer", recordId: c.id, newValue: { amount, method } });
  await pushManagers({ title: `💵 ${c.name} دفع ${amount.toFixed(2)} د.أ`, body: `${balance > 0.009 ? `باقي عليه ${balance.toFixed(2)}` : "سدّ كل الدين ✓"} · قبضها ${req.user.full_name}.`, url: "/f/debts", tag: `pay-${c.id}`, except: req.user.id });
  res.json({ ok: true, balance, message_id });
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
