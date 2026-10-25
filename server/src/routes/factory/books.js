import { Router } from "express";
import { query, pool, logActivity } from "../../db.js";
import { can } from "../../permissions.js";
import { need, needAny, bad, round2, jordanDate, pushTo, brand } from "./lib.js";

// ============================================================
// الدفاتر: الشركات (موردين ومشترين كبار) — مين بدّه منّا ومين علينا، بفواتير رسمية وملفاتها
// إعادة التدوير (كرتون، بلاستيك، نايلون)، الصندوق (دخل وصرف عام)، التسليم بين المحاسب والإدارة بتوقيع،
// والملخّص: يومي، أسبوعي، شهري، سنوي
// ============================================================
const router = Router();
const view = needAny(["f_money"], ["f_home"]);
const edit = need("f_money", "edit");
const str = (v, n) => (v == null ? "" : String(v).trim().slice(0, n));
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "");
const money = (n) => Number(n || 0).toFixed(2);
// إشارة كل حركة على رصيد الشركة (من جهتنا: موجب = علينا إلهم)
const SIGN = { purchase: 1, received: 1, sale: -1, paid: -1, adjust: 1 };
const LABEL = { purchase: "فاتورة شراء", sale: "فاتورة بيع", paid: "دفعنا", received: "قبضنا", adjust: "تسوية" };

function balWord(b) {
  return b > 0.005 ? `إلكم عنّا ${money(b)} د.أ` : b < -0.005 ? `عليكم إلنا ${money(-b)} د.أ` : "الحساب مسكّر ✓";
}
async function partnerMsg(p, e, bal) {
  const b = await brand();
  const what = {
    purchase: `استلمنا فاتورتكم${e.ref_no ? ` رقم ${e.ref_no}` : ""} بقيمة ${money(e.amount)} د.أ بتاريخ ${e.doc_date}.`,
    sale: `أصدرنا لكم فاتورة${e.official_no ? ` رقم ${e.official_no}` : ""} بقيمة ${money(e.amount)} د.أ بتاريخ ${e.doc_date}.`,
    paid: `دفعنا لكم ${money(e.amount)} د.أ${e.method ? ` (${e.method})` : ""} بتاريخ ${e.doc_date}.`,
    received: `استلمنا منكم ${money(e.amount)} د.أ${e.method ? ` (${e.method})` : ""} بتاريخ ${e.doc_date}. شكرًا لكم.`,
    adjust: `تسوية على الحساب بقيمة ${money(Math.abs(e.amount))} د.أ.${e.note ? ` (${e.note})` : ""}`,
  }[e.kind];
  return `السادة ${p.name} المحترمين،\n${what}\nالرصيد بعدها: ${balWord(bal)}.\n— ${b.name || "المصنع"}`;
}

// ---------- الشركات ----------
router.get("/books/partners", view, async (req, res) => {
  const r = await query("SELECT p.*, (SELECT MAX(created_at) FROM f_partner_ledger l WHERE l.partner_id = p.id) AS last_at FROM f_partners p ORDER BY p.active DESC, ABS(p.balance) DESC, p.name");
  const rows = r.rows.map((p) => ({ ...p, balance: Number(p.balance) }));
  res.json({
    partners: rows,
    we_owe: round2(rows.filter((p) => p.balance > 0).reduce((a, p) => a + p.balance, 0)),
    they_owe: round2(rows.filter((p) => p.balance < 0).reduce((a, p) => a - p.balance, 0)),
  });
});
function partnerFields(b) {
  return {
    name: str(b.name, 120), kind: ["supplier", "buyer", "both"].includes(b.kind) ? b.kind : "supplier",
    phone: str(b.phone, 30) || null, contact: str(b.contact, 80) || null, tax_no: str(b.tax_no, 40) || null,
    address: str(b.address, 200) || null, notes: str(b.notes, 500) || null,
  };
}
router.post("/books/partners", edit, async (req, res) => {
  const f = partnerFields(req.body || {});
  if (!f.name) return bad(res, "اكتب اسم الشركة.");
  const r = await query("INSERT INTO f_partners (name, kind, phone, contact, tax_no, address, notes) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *", [f.name, f.kind, f.phone, f.contact, f.tax_no, f.address, f.notes]);
  const open = round2(req.body?.opening);
  if (open) await addEntry(r.rows[0].id, { kind: "adjust", amount: open, note: open > 0 ? "رصيد سابق علينا" : "رصيد سابق إلنا" }, req.user);
  res.status(201).json(r.rows[0]);
});
router.put("/books/partners/:id", edit, async (req, res) => {
  const f = partnerFields(req.body || {});
  if (!f.name) return bad(res, "اكتب اسم الشركة.");
  const r = await query("UPDATE f_partners SET name=$1, kind=$2, phone=$3, contact=$4, tax_no=$5, address=$6, notes=$7, active=$8 WHERE id=$9 RETURNING *", [f.name, f.kind, f.phone, f.contact, f.tax_no, f.address, f.notes, req.body?.active !== false, req.params.id]);
  res.json(r.rows[0] || {});
});

export async function addEntry(partnerId, e, user, client = null) {
  const q = client ? (t, p) => client.query(t, p) : query;
  const amount = round2(e.amount);
  const signed = e.kind === "adjust" ? amount : SIGN[e.kind] * Math.abs(amount);
  const r = await q("UPDATE f_partners SET balance = balance + $1 WHERE id = $2 RETURNING *", [signed, partnerId]);
  const p = r.rows[0];
  if (!p) throw new Error("الشركة غير موجودة.");
  const official = e.kind === "sale" || e.official ? Number((await q("SELECT nextval('f_official_no_seq') AS n")).rows[0].n) : null;
  const ins = await q(
    `INSERT INTO f_partner_ledger (partner_id, kind, amount, balance_after, doc_date, ref_no, official_no, items, method, note, file_url, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [partnerId, e.kind, e.kind === "adjust" ? amount : Math.abs(amount), p.balance, isDate(e.doc_date) ? e.doc_date : jordanDate(), str(e.ref_no, 40) || null, official,
      JSON.stringify(Array.isArray(e.items) ? e.items.slice(0, 100) : []), str(e.method, 15) || null, str(e.note, 500) || null, e.file_url || null, user?.id || null]
  );
  return { entry: ins.rows[0], partner: p };
}

router.get("/books/partners/:id", view, async (req, res) => {
  const p = (await query("SELECT * FROM f_partners WHERE id = $1", [req.params.id])).rows[0];
  if (!p) return bad(res, "غير موجودة.", 404);
  const l = await query(
    `SELECT l.*, l.doc_date::text AS doc_date, u.full_name AS by_name FROM f_partner_ledger l LEFT JOIN users u ON u.id = l.created_by
     WHERE l.partner_id = $1 ORDER BY l.doc_date DESC, l.id DESC LIMIT 500`,
    [p.id]
  );
  res.json({ partner: { ...p, balance: Number(p.balance) }, entries: l.rows.map((x) => ({ ...x, amount: Number(x.amount), balance_after: Number(x.balance_after) })) });
});

router.post("/books/partners/:id/entries", edit, async (req, res) => {
  const b = req.body || {};
  if (!SIGN[b.kind]) return bad(res, "اختار نوع الحركة.");
  let amount = round2(b.amount);
  const items = (Array.isArray(b.items) ? b.items : []).map((i) => ({ name: str(i.name, 120), qty: Number(i.qty) || 0, unit: str(i.unit, 20), price: Number(i.price) || 0 })).filter((i) => i.name);
  if (!amount && items.length) amount = round2(items.reduce((a, i) => a + i.qty * i.price, 0));
  if (!amount) return bad(res, "اكتب المبلغ.");
  if (b.kind !== "adjust" && amount < 0) return bad(res, "المبلغ غير صحيح.");
  if (b.kind === "adjust" && !str(b.note, 10)) return bad(res, "اكتب سبب التسوية.");
  const { entry, partner } = await addEntry(req.params.id, { ...b, amount, items }, req.user);
  await logActivity({ userId: req.user.id, action: "F_PARTNER_ENTRY", recordType: "f_partner", recordId: partner.id, newValue: { kind: b.kind, amount } }).catch(() => {});
  res.status(201).json({ entry: { ...entry, amount: Number(entry.amount) }, balance: Number(partner.balance), message: await partnerMsg(partner, { ...entry, doc_date: isDate(b.doc_date) ? b.doc_date : jordanDate(), amount: Number(entry.amount) }, Number(partner.balance)), phone: partner.phone });
});

// إرفاق الفاتورة المختومة (صورة/PDF) بعد الطباعة والختم
router.post("/books/entries/:id/file", edit, async (req, res) => {
  const r = await query("UPDATE f_partner_ledger SET file_url = $1 WHERE id = $2 RETURNING id", [req.body?.file_url || null, req.params.id]);
  if (!r.rows[0]) return bad(res, "غير موجودة.", 404);
  res.json({ ok: true });
});

// رسالة الكشف للشركة (واتساب)
router.get("/books/partners/:id/message", view, async (req, res) => {
  const p = (await query("SELECT * FROM f_partners WHERE id = $1", [req.params.id])).rows[0];
  if (!p) return bad(res, "غير موجودة.", 404);
  const b = await brand();
  res.json({ phone: p.phone, text: `السادة ${p.name} المحترمين،\nرصيد حسابكم عنّا بتاريخ ${jordanDate()}: ${balWord(Number(p.balance))}.\n— ${b.name || "المصنع"}` });
});

// ---------- إعادة التدوير ----------
router.get("/books/recycle", view, async (req, res) => {
  const r = await query("SELECT x.*, x.doc_date::text AS doc_date, p.name AS partner_name, u.full_name AS by_name FROM f_recycle x LEFT JOIN f_partners p ON p.id = x.partner_id LEFT JOIN users u ON u.id = x.created_by ORDER BY x.doc_date DESC, x.id DESC LIMIT 300");
  const rows = r.rows.map((x) => ({ ...x, kg: Number(x.kg), amount: Number(x.amount), received: Number(x.received), price_ton: x.price_ton == null ? null : Number(x.price_ton) }));
  const mats = {};
  for (const x of rows) {
    const m = (mats[x.material] ||= { material: x.material, in_kg: 0, sold_kg: 0, amount: 0, received: 0 });
    if (x.kind === "in") m.in_kg += x.kg; else { m.sold_kg += x.kg; m.amount += x.amount; m.received += x.received; }
  }
  res.json({ rows, materials: Object.values(mats).map((m) => ({ ...m, left_kg: round2(m.in_kg - m.sold_kg), amount: round2(m.amount), received: round2(m.received), due: round2(m.amount - m.received) })) });
});
router.post("/books/recycle", edit, async (req, res) => {
  const b = req.body || {};
  const material = str(b.material, 30);
  const kind = b.kind === "sale" ? "sale" : "in";
  const kg = round2(b.kg);
  if (!material || !(kg > 0)) return bad(res, "اختار المادة واكتب الوزن.");
  const priceTon = b.price_ton === "" || b.price_ton == null ? null : round2(b.price_ton);
  const amount = kind === "sale" ? round2(b.amount || (priceTon ? (kg / 1000) * priceTon : 0)) : 0;
  const received = kind === "sale" ? Math.min(amount || Infinity, round2(b.received) || 0) : 0;
  const r = await query(
    "INSERT INTO f_recycle (material, kind, kg, price_ton, amount, received, partner_id, note, photo_url, doc_date, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *",
    [material, kind, kg, priceTon, amount, received, Number(b.partner_id) || null, str(b.note, 300) || null, b.photo_url || null, isDate(b.doc_date) ? b.doc_date : jordanDate(), req.user.id]
  );
  // البيع لشركة: بينسجّل على حسابها (فاتورة بيع + اللي قبضناه)
  if (kind === "sale" && b.partner_id && amount > 0) {
    await addEntry(b.partner_id, { kind: "sale", amount, note: `${kg} كغ ${material} (إعادة تدوير)`, items: [{ name: `${material} — إعادة تدوير`, qty: kg, unit: "كغ", price: priceTon ? priceTon / 1000 : round2(amount / kg) }] }, req.user);
    if (received > 0) await addEntry(b.partner_id, { kind: "received", amount: received, method: "كاش", note: `ثمن ${material}` }, req.user);
  }
  res.status(201).json(r.rows[0]);
});
router.post("/books/recycle/:id/receive", edit, async (req, res) => {
  const x = (await query("SELECT * FROM f_recycle WHERE id = $1 AND kind = 'sale'", [req.params.id])).rows[0];
  if (!x) return bad(res, "غير موجود.", 404);
  const amt = round2(req.body?.amount);
  if (!(amt > 0) || amt > Number(x.amount) - Number(x.received) + 0.005) return bad(res, `الباقي ${money(Number(x.amount) - Number(x.received))} بس.`);
  await query("UPDATE f_recycle SET received = received + $1 WHERE id = $2", [amt, x.id]);
  if (x.partner_id) await addEntry(x.partner_id, { kind: "received", amount: amt, method: "كاش", note: `ثمن ${x.material}` }, req.user);
  res.json({ ok: true });
});

// ---------- الصندوق: دخل وصرف عام (مبيعات، بيع أرض، إيجار، رواتب…) ----------
router.get("/books/cash", view, async (req, res) => {
  const from = isDate(req.query.from) ? req.query.from : jordanDate().slice(0, 8) + "01";
  const to = isDate(req.query.to) ? req.query.to : jordanDate();
  const r = await query(
    "SELECT c.*, c.doc_date::text AS doc_date, u.full_name AS by_name FROM f_cashbook c LEFT JOIN users u ON u.id = c.created_by WHERE c.doc_date BETWEEN $1 AND $2 ORDER BY c.doc_date DESC, c.id DESC",
    [from, to]
  );
  const rows = r.rows.map((x) => ({ ...x, amount: Number(x.amount) }));
  const cats = (await query("SELECT kind, category, COUNT(*)::int AS n FROM f_cashbook GROUP BY kind, category ORDER BY n DESC LIMIT 40")).rows;
  res.json({ from, to, rows, in: round2(rows.filter((x) => x.kind === "in").reduce((a, x) => a + x.amount, 0)), out: round2(rows.filter((x) => x.kind === "out").reduce((a, x) => a + x.amount, 0)), categories: cats });
});
router.post("/books/cash", edit, async (req, res) => {
  const b = req.body || {};
  const kind = b.kind === "in" ? "in" : "out";
  const category = str(b.category, 60);
  const amount = round2(b.amount);
  if (!category || !(amount > 0)) return bad(res, "اختار البند واكتب المبلغ.");
  const r = await query(
    "INSERT INTO f_cashbook (kind, category, amount, doc_date, note, file_url, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *",
    [kind, category, amount, isDate(b.doc_date) ? b.doc_date : jordanDate(), str(b.note, 500) || null, b.file_url || null, req.user.id]
  );
  res.status(201).json(r.rows[0]);
});
router.delete("/books/cash/:id", edit, async (req, res) => {
  await query("DELETE FROM f_cashbook WHERE id = $1 AND created_at > now() - interval '1 day'", [req.params.id]);
  res.json({ ok: true });
});

// ---------- التسليم بين المحاسب والإدارة (بتوقيع المستلم على التلفون) ----------
router.get("/books/handover", needAny(["f_money"], ["f_home"]), async (req, res) => {
  const r = await query(
    `SELECT h.*, f.full_name AS from_name, t.full_name AS to_name FROM f_handover h LEFT JOIN users f ON f.id = h.from_user LEFT JOIN users t ON t.id = h.to_user
     ORDER BY (h.status = 'pending') DESC, h.id DESC LIMIT 100`
  );
  const people = (await query("SELECT id, full_name, role, permissions FROM users WHERE status = 'active'")).rows
    .filter((u) => u.role === "super_admin" || can(u, "f_money", "edit") || can(u, "f_home")).map((u) => ({ id: u.id, full_name: u.full_name }));
  res.json({ rows: r.rows.map((h) => ({ ...h, amount: Number(h.amount), mine_to_sign: h.status === "pending" && h.to_user === req.user.id })), people: people.filter((p) => p.id !== req.user.id) });
});
router.post("/books/handover", needAny(["f_money", "edit"], ["f_home"]), async (req, res) => {
  const amount = round2(req.body?.amount);
  const to = Number(req.body?.to_user);
  if (!(amount > 0) || !to) return bad(res, "اختار مين استلم واكتب المبلغ.");
  if (to === req.user.id) return bad(res, "اختار شخص ثاني.");
  const r = await query("INSERT INTO f_handover (from_user, to_user, amount, note) VALUES ($1,$2,$3,$4) RETURNING *", [req.user.id, to, amount, str(req.body?.note, 300) || null]);
  pushTo(to, { title: `✍️ ${req.user.full_name} سلّمك ${money(amount)} د.أ`, body: "اكبس ووقّع إنك استلمت.", url: "/f/books?tab=handover", tag: `ho-${r.rows[0].id}` }).catch(() => {});
  res.status(201).json(r.rows[0]);
});
router.post("/books/handover/:id/confirm", needAny(["f_money"], ["f_home"]), async (req, res) => {
  const sig = String(req.body?.signature || "");
  if (!/^data:image\//.test(sig)) return bad(res, "وقّع بإصبعك.");
  const r = await query("UPDATE f_handover SET status = 'confirmed', signature = $1, confirmed_at = now() WHERE id = $2 AND to_user = $3 AND status = 'pending' RETURNING *", [sig.slice(0, 200000), req.params.id, req.user.id]);
  if (!r.rows[0]) return bad(res, "مش إلك أو انوقّعت من قبل.");
  pushTo(r.rows[0].from_user, { title: `✅ ${req.user.full_name} وقّع الاستلام`, body: `${money(r.rows[0].amount)} د.أ`, url: "/f/books?tab=handover" }).catch(() => {});
  res.json({ ok: true });
});
router.post("/books/handover/:id/reject", needAny(["f_money"], ["f_home"]), async (req, res) => {
  await query("UPDATE f_handover SET status = 'rejected', confirmed_at = now() WHERE id = $1 AND to_user = $2 AND status = 'pending'", [req.params.id, req.user.id]);
  res.json({ ok: true });
});

// ---------- الكهربا والمي والمولدات ----------
router.get("/books/meters", view, async (req, res) => {
  const ms = (await query("SELECT m.*, s.name AS site_name, l.name AS line_name FROM f_meters m LEFT JOIN f_sites s ON s.id = m.site_id LEFT JOIN f_plines l ON l.id = m.line_id ORDER BY m.active DESC, m.kind, m.id")).rows;
  const lines = (await query("SELECT id, name FROM f_plines WHERE active ORDER BY id")).rows;
  const es = (await query(
    `SELECT e.*, e.doc_date::text AS doc_date, u.full_name AS by_name FROM f_meter_entries e LEFT JOIN users u ON u.id = e.created_by
     ORDER BY e.doc_date DESC, e.id DESC LIMIT 1000`
  )).rows.map((e) => ({ ...e, reading: e.reading == null ? null : Number(e.reading), prev_reading: e.prev_reading == null ? null : Number(e.prev_reading), consumption: e.consumption == null ? null : Number(e.consumption), unit_price: e.unit_price == null ? null : Number(e.unit_price), amount: Number(e.amount), liters: e.liters == null ? null : Number(e.liters) }));
  const month = jordanDate().slice(0, 7), year = jordanDate().slice(0, 4);
  res.json({
    meters: ms.map((m) => {
      const mine = es.filter((e) => e.meter_id === m.id);
      return {
        ...m, entries: mine.slice(0, 60),
        last_reading: mine.find((e) => e.reading != null)?.reading ?? null,
        unpaid: round2(mine.filter((e) => !e.paid).reduce((a, e) => a + e.amount, 0)),
        month: round2(mine.filter((e) => e.doc_date.startsWith(month)).reduce((a, e) => a + e.amount, 0)),
        year: round2(mine.filter((e) => e.doc_date.startsWith(year)).reduce((a, e) => a + e.amount, 0)),
        last_price: mine.find((e) => e.unit_price != null)?.unit_price ?? null,
      };
    }),
    lines,
    month_total: round2(es.filter((e) => e.doc_date.startsWith(month)).reduce((a, e) => a + e.amount, 0)),
    unpaid_total: round2(es.filter((e) => !e.paid).reduce((a, e) => a + e.amount, 0)),
  });
});
router.post("/books/meters", edit, async (req, res) => {
  const b = req.body || {};
  const kind = ["elec", "water", "gen", "trans"].includes(b.kind) ? b.kind : "elec";
  const name = str(b.name, 80) || { elec: "عداد كهربا", water: "عداد مي", gen: "مولّد", trans: "محوّل كهربا" }[kind];
  const r = await query("INSERT INTO f_meters (kind, name, number, site_id, notes, line_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *", [kind, name, str(b.number, 40) || null, Number(b.site_id) || null, str(b.notes, 300) || null, Number(b.line_id) || null]);
  res.status(201).json(r.rows[0]);
});
router.put("/books/meters/:id", edit, async (req, res) => {
  const b = req.body || {};
  const r = await query("UPDATE f_meters SET name = $1, number = $2, site_id = $3, notes = $4, active = $5, line_id = $7 WHERE id = $6 RETURNING *", [str(b.name, 80) || "عداد", str(b.number, 40) || null, Number(b.site_id) || null, str(b.notes, 300) || null, b.active !== false, req.params.id, Number(b.line_id) || null]);
  res.json(r.rows[0] || {});
});
router.post("/books/meters/:id/entries", edit, async (req, res) => {
  const m = (await query("SELECT * FROM f_meters WHERE id = $1", [req.params.id])).rows[0];
  if (!m) return bad(res, "العداد غير موجود.", 404);
  const b = req.body || {};
  const num = (v) => (v === "" || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
  const reading = num(b.reading);
  const last = (await query("SELECT reading FROM f_meter_entries WHERE meter_id = $1 AND reading IS NOT NULL ORDER BY doc_date DESC, id DESC LIMIT 1", [m.id])).rows[0];
  const prev = num(b.prev_reading) ?? (last ? Number(last.reading) : null);
  if (reading != null && prev != null && reading < prev) return bad(res, `القراءة أقل من اللي قبلها (${prev}).`);
  const consumption = num(b.consumption) ?? (reading != null && prev != null ? round2(reading - prev) : null);
  const unitPrice = num(b.unit_price);
  let amount = num(b.amount);
  if (amount == null && consumption != null && unitPrice != null) amount = round2(consumption * unitPrice);
  if (amount == null) amount = 0;
  if (!(amount >= 0)) return bad(res, "المبلغ غير صحيح.");
  if (!amount && reading == null) return bad(res, "اكتب القراءة أو قيمة الفاتورة.");
  const r = await query(
    `INSERT INTO f_meter_entries (meter_id, doc_date, reading, prev_reading, consumption, unit_price, amount, liters, bill_no, paid, paid_at, photo_url, note, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,CASE WHEN $10 THEN now() END,$11,$12,$13) RETURNING *`,
    [m.id, isDate(b.doc_date) ? b.doc_date : jordanDate(), reading, prev, consumption, unitPrice, amount, num(b.liters), str(b.bill_no, 40) || null, !!b.paid, b.photo_url || null, str(b.note, 300) || null, req.user.id]
  );
  res.status(201).json({ ...r.rows[0], amount, consumption });
});
router.post("/books/meter-entries/:id/paid", edit, async (req, res) => {
  await query("UPDATE f_meter_entries SET paid = true, paid_at = now() WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});

// ---------- الملخّص: يومي / أسبوعي / شهري / سنوي ----------
function range(period, day) {
  const d = new Date(`${day}T12:00:00Z`);
  const iso = (x) => x.toISOString().slice(0, 10);
  if (period === "week") { const s = new Date(d); s.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 1) % 7)); const e = new Date(s); e.setUTCDate(s.getUTCDate() + 6); return [iso(s), iso(e)]; } // من السبت
  if (period === "month") return [`${day.slice(0, 7)}-01`, iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)))];
  if (period === "year") return [`${day.slice(0, 4)}-01-01`, `${day.slice(0, 4)}-12-31`];
  return [day, day];
}
router.get("/books/summary", view, async (req, res) => {
  const period = ["day", "week", "month", "year"].includes(req.query.period) ? req.query.period : "month";
  const day = isDate(req.query.date) ? req.query.date : jordanDate();
  const [from, to] = range(period, day);
  const D = (col) => `(${col} AT TIME ZONE 'Asia/Amman')::date BETWEEN $1 AND $2`;
  const one = async (sql) => (await query(sql, [from, to])).rows[0] || {};
  const [sales, coll, drvExp, cash, purch, paid, recyc, prod, used, waste, maint, util] = await Promise.all([
    one(`SELECT COALESCE(SUM(delivered_total),0) AS total, COUNT(*)::int AS n FROM f_orders WHERE status = 'delivered' AND ${D("delivered_at")}`),
    one(`SELECT COALESCE(SUM(CASE WHEN method = 'cash' THEN -amount END),0) AS cash, COALESCE(SUM(CASE WHEN method = 'cliq' THEN -amount END),0) AS cliq, COALESCE(SUM(CASE WHEN method NOT IN ('cash','cliq') THEN -amount END),0) AS other FROM f_ledger WHERE kind = 'payment' AND ${D("created_at")}`),
    one(`SELECT COALESCE(SUM(amount),0) AS total FROM f_expenses WHERE status = 'approved' AND ${D("created_at")}`).catch(() => ({ total: 0 })),
    one(`SELECT COALESCE(SUM(CASE WHEN kind = 'in' THEN amount END),0) AS inn, COALESCE(SUM(CASE WHEN kind = 'out' THEN amount END),0) AS out FROM f_cashbook WHERE doc_date BETWEEN $1 AND $2`),
    one(`SELECT COALESCE(SUM(CASE WHEN kind = 'purchase' THEN amount END),0) AS purchases, COALESCE(SUM(CASE WHEN kind = 'sale' THEN amount END),0) AS sales FROM f_partner_ledger WHERE doc_date BETWEEN $1 AND $2`),
    one(`SELECT COALESCE(SUM(CASE WHEN kind = 'paid' THEN amount END),0) AS paid, COALESCE(SUM(CASE WHEN kind = 'received' THEN amount END),0) AS received FROM f_partner_ledger WHERE doc_date BETWEEN $1 AND $2`),
    one(`SELECT COALESCE(SUM(amount),0) AS amount, COALESCE(SUM(received),0) AS received, COALESCE(SUM(CASE WHEN partner_id IS NULL THEN received END),0) AS received_direct, COALESCE(SUM(kg),0) AS kg FROM f_recycle WHERE kind = 'sale' AND doc_date BETWEEN $1 AND $2`),
    one(`SELECT COALESCE(SUM(qty),0)::int AS cartons FROM f_stock_moves WHERE kind = 'production' AND ${D("created_at")}`),
    one(`SELECT COALESCE(SUM(cost),0) AS cost FROM f_material_moves WHERE kind = 'use' AND ${D("created_at")}`),
    one(`SELECT COALESCE(SUM(cost),0) AS cost FROM f_material_moves WHERE kind = 'waste' AND ${D("created_at")}`),
    one(`SELECT COALESCE(SUM(cost),0) AS cost FROM f_maint WHERE done_on BETWEEN $1 AND $2`),
    one(`SELECT COALESCE(SUM(e.amount),0) AS total, COALESCE(SUM(CASE WHEN m.kind IN ('elec','trans') THEN e.amount END),0) AS elec, COALESCE(SUM(CASE WHEN m.kind = 'water' THEN e.amount END),0) AS water, COALESCE(SUM(CASE WHEN m.kind = 'gen' THEN e.amount END),0) AS gen FROM f_meter_entries e JOIN f_meters m ON m.id = e.meter_id WHERE e.doc_date BETWEEN $1 AND $2`),
  ]);
  const N = (x) => round2(Number(x || 0));
  const store = (await query("SELECT COALESCE(SUM(balance * price),0) AS v FROM f_materials WHERE active AND balance > 0")).rows[0].v;
  const owe = (await query("SELECT COALESCE(SUM(CASE WHEN balance > 0 THEN balance END),0) AS we, COALESCE(SUM(CASE WHEN balance < 0 THEN -balance END),0) AS they FROM f_partners")).rows[0];
  const debts = (await query("SELECT COALESCE(SUM(balance),0) AS v FROM f_customers WHERE balance > 0")).rows[0].v;
  const income = N(coll.cash) + N(coll.cliq) + N(coll.other) + N(cash.inn) + N(paid.received) + N(recyc.received_direct); // قبض إعادة التدوير من شركة محسوب بقبض الشركات
  const spend = N(drvExp.total) + N(cash.out) + N(paid.paid) + N(maint.cost) + N(util.total);
  res.json({
    period, from, to,
    sales: { invoices: N(sales.total), count: sales.n || 0, partner_sales: N(purch.sales), recycle: N(recyc.amount), recycle_kg: N(recyc.kg) },
    collected: { cash: N(coll.cash), cliq: N(coll.cliq), other: N(coll.other), partners: N(paid.received), recycle: N(recyc.received), other_income: N(cash.inn) },
    spent: { driver_expenses: N(drvExp.total), cashbook: N(cash.out), suppliers: N(paid.paid), maintenance: N(maint.cost), electricity: N(util.elec), water: N(util.water), generators: N(util.gen) },
    purchases: N(purch.purchases),
    production: { cartons: prod.cartons || 0, materials_used: N(used.cost), waste: N(waste.cost) },
    totals: { income: round2(income), spend: round2(spend), net: round2(income - spend) },
    now: { store_value: N(store), we_owe: N(owe.we), they_owe: N(owe.they), customer_debts: N(debts) },
  });
});

export default router;
