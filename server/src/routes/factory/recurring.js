import { Router } from "express";
import { query, pool, logActivity } from "../../db.js";
import { needAny, bad, round2, jordanDate, itemsText, pushManagers, pushTo, factoryPoint } from "./lib.js";
import { buildItems, loadOrders, recomputeEta } from "./orders.js";
import { sortNearest } from "../../utils/factoryGeo.js";

// ============================================================
// طلبات ثابتة: «بقالة الرمثا بتاخذ ٣٠٠ شرنك كل ١٠ أيام»
// النظام بيسجّل الطلب لحاله بيومه، وإذا في رحلة لسيارة خط الزبون بنفس اليوم بيحطه عليها
// ============================================================
const router = Router();
const view = needAny(["f_orders"], ["f_dispatch"], ["f_customers"], ["f_home"]);
const edit = needAny(["f_orders", "edit"], ["f_dispatch", "edit"], ["f_customers", "edit"]);
const everyLabel = (n) => (n === 7 ? "كل أسبوع" : n === 14 ? "كل أسبوعين" : n === 30 ? "كل شهر" : `كل ${n} أيام`);
const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || "");
const addDays = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

async function itemsLabel(items) {
  const ids = items.map((i) => i.product_id);
  const p = (await query("SELECT id, name FROM f_products WHERE id = ANY($1::int[])", [ids])).rows;
  return items.map((i) => ({ ...i, name: p.find((x) => x.id === i.product_id)?.name || "منتج" }));
}

router.get("/recurring", view, async (req, res) => {
  const params = [];
  let where = "true";
  if (req.query.customer) { params.push(Number(req.query.customer)); where = `r.customer_id = $1`; }
  const rows = (await query(
    `SELECT r.*, to_char(r.next_date, 'YYYY-MM-DD') AS next_date, c.name AS customer_name, c.city, c.seq_no
     FROM f_recurring r JOIN f_customers c ON c.id = r.customer_id WHERE ${where} ORDER BY r.active DESC, r.next_date, r.id`,
    params
  )).rows;
  for (const r of rows) r.items = await itemsLabel(r.items);
  res.json(rows);
});

function clean(b) {
  const every = Math.round(Number(b.every_days));
  if (!(every >= 1 && every <= 365)) throw new Error("اختار كل كم يوم (من ١ لـ ٣٦٥).");
  const items = (Array.isArray(b.items) ? b.items : [])
    .map((i) => ({ product_id: Number(i.product_id), qty: Math.round(Number(i.qty)) }))
    .filter((i) => i.product_id && i.qty > 0);
  const next = isDate(b.next_date) ? b.next_date : jordanDate();
  return { every, items, next, notes: b.notes ? String(b.notes).slice(0, 300) : null };
}

router.post("/recurring", edit, async (req, res) => {
  let r; try { r = clean(req.body || {}); } catch (e) { return bad(res, e.message); }
  const c = (await query("SELECT id, name FROM f_customers WHERE id = $1 AND active", [req.body?.customer_id])).rows[0];
  if (!c) return bad(res, "اختار الزبون.");
  const row = (await query(
    "INSERT INTO f_recurring (customer_id, every_days, items, next_date, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
    [c.id, r.every, JSON.stringify(r.items), r.next, r.notes, req.user.id]
  )).rows[0];
  await logActivity({ userId: req.user.id, action: "F_CREATE_RECURRING", recordType: "f_recurring", recordId: row.id, newValue: r });
  const made = await runRecurring(row.id); // إذا أول موعد اليوم، بينضاف هلأ
  res.status(201).json({ id: row.id, created_order: made[0] || null, skipped: made.skipped[0] || null });
});

router.put("/recurring/:id", edit, async (req, res) => {
  const b = req.body || {};
  if (b.active !== undefined && Object.keys(b).length === 1) {
    await query("UPDATE f_recurring SET active = $1 WHERE id = $2", [!!b.active, req.params.id]);
    return res.json({ ok: true });
  }
  let r; try { r = clean(b); } catch (e) { return bad(res, e.message); }
  const u = await query(
    "UPDATE f_recurring SET every_days = $1, items = $2, next_date = $3, notes = $4, active = COALESCE($5, active) WHERE id = $6 RETURNING id",
    [r.every, JSON.stringify(r.items), r.next, r.notes, b.active === undefined ? null : !!b.active, req.params.id]
  );
  if (!u.rows[0]) return bad(res, "الموعد غير موجود.", 404);
  const made = await runRecurring(Number(req.params.id));
  res.json({ ok: true, created_order: made[0] || null, skipped: made.skipped[0] || null });
});

router.delete("/recurring/:id", edit, async (req, res) => {
  await query("DELETE FROM f_recurring WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});

// بيضيف الطلبات اللي إجا موعدها (من المراقبة كل ١٠ دقايق، أو لحظة الحفظ)
export async function runRecurring(onlyId = null) {
  const today = jordanDate();
  const tomorrow = addDays(today, 1);
  const due = (await query(
    `SELECT r.*, to_char(r.next_date, 'YYYY-MM-DD') AS next_date, c.name AS customer_name, c.line_id, c.active AS customer_active
     FROM f_recurring r JOIN f_customers c ON c.id = r.customer_id
     WHERE r.active AND r.next_date <= $1 ${onlyId ? "AND r.id = $2" : ""}`,
    onlyId ? [tomorrow, onlyId] : [tomorrow]
  )).rows;
  const made = [];
  made.skipped = [];
  for (const r of due) {
    // بننزّل الطلب قبل موعده بيوم، عشان يبيّن وانت بتجهّز رحلات بكرا
    const dueDate = r.next_date < today ? today : r.next_date;
    let next = r.next_date;
    while (next <= dueDate) next = addDays(next, r.every_days);
    await query("UPDATE f_recurring SET next_date = $1 WHERE id = $2", [next, r.id]);
    if (!r.customer_active) continue;

    // عنده طلب مفتوح؟ ما منكرر
    const open = (await query("SELECT id FROM f_orders WHERE customer_id = $1 AND status IN ('new','assigned','onway','delayed') LIMIT 1", [r.customer_id])).rows[0];
    if (open) {
      made.skipped.push({ open_order: open.id, next });
      await pushManagers({ title: `🔁 ${r.customer_name}: إجا موعد طلبه الثابت`, body: `ما ضفناه لأنه عنده طلب مفتوح (#${open.id}). الموعد الجاي ${next}.`, url: "/f/orders", tag: `rc-${r.id}` });
      continue;
    }
    // بدون منتجات محددة: منكرر آخر طلب للزبون (والسائق بيعدّل وقت التسليم حسب اللي أخذه)
    let src = r.items;
    if (!src?.length) {
      const last = (await query(
        `SELECT i.product_id, CASE WHEN o.status = 'delivered' THEN COALESCE(i.delivered_qty, i.qty) ELSE i.qty END AS qty
         FROM f_order_items i JOIN f_orders o ON o.id = i.order_id
         WHERE o.id = (SELECT id FROM f_orders WHERE customer_id = $1 AND status <> 'cancelled' ORDER BY id DESC LIMIT 1)`,
        [r.customer_id]
      )).rows.filter((x) => x.qty > 0);
      if (!last.length) {
        await pushManagers({ title: `⏰ تذكير: ${r.customer_name}`, body: `إجا موعده (${everyLabel(r.every_days)}). ما إله طلب سابق نكرره — اتصل فيه وسجّل طلبه.`, url: "/f/customers", tag: `rc-${r.id}` });
        continue;
      }
      src = last;
    }
    let items;
    try { items = await buildItems(r.customer_id, src, null); } catch { continue; }
    const total = round2(items.reduce((s, i) => s + i.qty * i.price, 0));
    const client = await pool.connect();
    let id;
    try {
      await client.query("BEGIN");
      id = (await client.query(
        "INSERT INTO f_orders (customer_id, due_date, notes, total, created_by, recurring_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
        [r.customer_id, dueDate, r.notes ? `🔁 ${r.notes}` : "🔁 طلب ثابت", total, r.created_by, r.id]
      )).rows[0].id;
      for (const i of items) await client.query("INSERT INTO f_order_items (order_id, product_id, qty, price, bonus_qty, bonus_manual) VALUES ($1,$2,$3,$4,$5,false)", [id, i.product_id, i.qty, i.price, i.bonus]);
      await client.query("UPDATE f_recurring SET last_order_id = $1 WHERE id = $2", [id, r.id]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("recurring order:", err.message);
      continue;
    } finally {
      client.release();
    }
    made.push(id);

    const onTrip = await attachToLineTrip(id);
    await pushManagers({
      title: `🔁 انضاف طلب ثابت: ${r.customer_name}`,
      body: `${itemsText(items)}${onTrip ? ` · انحط على ${onTrip}` : " · بستنى تحطه على سيارة"}. الموعد الجاي ${next}.`,
      url: "/f/orders", tag: `rc-${r.id}`,
    });
  }
  await attachPending();
  return made;
}

// طلب ثابت لسا بدون سيارة: إذا انعملت رحلة لسيارة خط الزبون بيومه وما تحمّلت، بنحطه عليها
export async function attachPending() {
  const rows = (await query(
    "SELECT id FROM f_orders WHERE recurring_id IS NOT NULL AND trip_id IS NULL AND status = 'new' AND due_date <= $1",
    [addDays(jordanDate(), 1)]
  )).rows;
  for (const o of rows) await attachToLineTrip(o.id);
}

async function attachToLineTrip(orderId) {
  const o = (await query(
    `SELECT o.id, to_char(o.due_date, 'YYYY-MM-DD') AS due, c.name, l.vehicle_id FROM f_orders o JOIN f_customers c ON c.id = o.customer_id
     LEFT JOIN f_lines l ON l.id = c.line_id WHERE o.id = $1`,
    [orderId]
  )).rows[0];
  if (!o?.vehicle_id) return null;
  const t = (await query(
    `SELECT t.id, t.driver_id, v.name FROM f_trips t JOIN f_vehicles v ON v.id = t.vehicle_id
     WHERE t.vehicle_id = $1 AND t.trip_date = $2 AND t.status = 'planned' AND t.load_confirmed_at IS NULL ORDER BY t.id LIMIT 1`,
    [o.vehicle_id, o.due]
  )).rows[0];
  if (!t) return null;
  await query("UPDATE f_orders SET trip_id = $1, status = 'assigned', updated_at = now() WHERE id = $2 AND trip_id IS NULL", [t.id, o.id]);
  const stops = await loadOrders("o.trip_id = $1 AND o.status IN ('assigned','onway','delayed')", [t.id]);
  let seq = 0;
  for (const s of sortNearest(await factoryPoint(), stops)) await query("UPDATE f_orders SET stop_seq = $1 WHERE id = $2", [++seq, s.id]);
  await recomputeEta(t.id);
  const items = (await loadOrders("o.id = $1", [o.id]))[0]?.items || [];
  await pushTo(t.driver_id, { title: `انضافلك طلب: ${o.name} 🔁`, body: `${itemsText(items.map((i) => ({ qty: i.qty, name: i.name, bonus: i.bonus_qty })))}. افتح «رحلتي».`, url: "/f/drive", tag: `ft-${t.id}` });
  return t.name;
}

export default router;
