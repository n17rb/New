import { Router } from "express";
import { query } from "../../db.js";
import { can } from "../../permissions.js";
import { need, needAny, bad, jordanDate, alert, pushTo, once } from "./lib.js";
import { loadOrders } from "./orders.js";

// ============================================================
// التأجيل: الزبون حكى للسائق «تعال بعد ٤ أيام»
// السائق ما بيأجّل لحاله — بيبعت طلب، ومدخل الطلبات بيثبّت موعد التسليم
// ============================================================
const router = Router();
const drive = need("f_drive", "edit");
const viewOrders = needAny(["f_orders"], ["f_dispatch"], ["f_home"]);
const editOrders = needAny(["f_orders", "edit"], ["f_dispatch", "edit"]);
const addDays = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

router.post("/driver/orders/:id/postpone", drive, once(async (req, res) => {
  const o = (await loadOrders("o.id = $1", [req.params.id]))[0];
  if (!o) return bad(res, "الطلب غير موجود.", 404);
  const t = o.trip_id ? (await query("SELECT id, driver_id FROM f_trips WHERE id = $1", [o.trip_id])).rows[0] : null;
  if (!t || (t.driver_id !== req.user.id && !can(req.user, "f_dispatch", "edit"))) return bad(res, "الطلب مش على رحلتك.", 403);
  if (!["assigned", "onway", "new", "delayed"].includes(o.status)) return bad(res, "الطلب مسكّر.");
  const days = Math.round(Number(req.body?.days));
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.body?.date || "") ? req.body.date : days > 0 && days < 120 ? addDays(jordanDate(), days) : null;
  if (!date || date <= jordanDate()) return bad(res, "اختار بعد كم يوم.");
  const note = String(req.body?.note || "").trim().slice(0, 300) || null;
  const reason = `الزبون طلب تأجيل لـ${date}${note ? ` — ${note}` : ""}`;
  // الطلب بيطلع من الرحلة (البضاعة بترجع مع السائق) وبيستنى تثبيت مدخل الطلبات
  await query(
    `UPDATE f_orders SET status = 'failed', fail_reason = $1, delivered_lat = $2, delivered_lng = $3,
       postpone_to = $4, postpone_note = $5, postpone_by = $6, postpone_at = now(), postpone_state = 'pending', updated_at = now() WHERE id = $7`,
    [reason, Number(req.body?.lat) || null, Number(req.body?.lng) || null, date, note, req.user.id, o.id]
  );
  await alert({ level: "info", kind: "postpone", ref: o.id, title: `🗓️ ${o.customer_name} بده الطلب #${o.id} بعدين`, body: `${req.user.full_name} بيطلب تأجيل لـ${date}${note ? ` — ${note}` : ""}. ثبّت الموعد من الطلبات.` });
  // إشعار لمدخلين الطلبات
  const staff = await query("SELECT id, role, permissions FROM users WHERE status = 'active'");
  for (const u of staff.rows) {
    if (u.id !== req.user.id && u.role !== "super_admin" && (can(u, "f_orders", "edit") || can(u, "f_dispatch", "edit"))) {
      pushTo(u.id, { title: `🗓️ طلب تأجيل — ${o.customer_name}`, body: `بده إياه بـ${date}. اكبس لتثبّت الموعد.`, url: "/f/orders", tag: `pp-${o.id}` }).catch(() => {});
    }
  }
  res.json({ ok: true, date });
}));

router.get("/orders/postpones", viewOrders, async (req, res) => {
  const r = await query(
    `SELECT o.id, o.customer_id, c.name AS customer_name, c.phone, c.city, o.postpone_to::text AS postpone_to, o.postpone_note, o.postpone_at,
            u.full_name AS driver_name, (SELECT SUM(i.qty + i.bonus_qty)::int FROM f_order_items i WHERE i.order_id = o.id) AS cartons
     FROM f_orders o JOIN f_customers c ON c.id = o.customer_id LEFT JOIN users u ON u.id = o.postpone_by
     WHERE o.postpone_state = 'pending' ORDER BY o.postpone_to, o.id`
  );
  res.json(r.rows);
});

// تثبيت الموعد: الطلب بيرجع «جديد» بتاريخ التسليم الجديد
router.post("/orders/:id/postpone/confirm", editOrders, async (req, res) => {
  const due = /^\d{4}-\d{2}-\d{2}$/.test(req.body?.due_date || "") ? req.body.due_date : null;
  if (!due) return bad(res, "اختار تاريخ التسليم.");
  const r = await query(
    `UPDATE f_orders SET status = 'new', trip_id = NULL, stop_seq = NULL, eta_at = NULL, due_date = $1, postpone_state = 'done', postpone_to = $1,
       notes = CONCAT_WS(' · ', NULLIF(notes, ''), $3::text), updated_at = now()
     WHERE id = $2 AND postpone_state = 'pending' RETURNING id`,
    [due, req.params.id, `مؤجّل بطلب الزبون لـ${due}`]
  );
  if (!r.rows[0]) return bad(res, "انثبّت من قبل.");
  await query("UPDATE f_alerts SET closed_at = now(), closed_by = $1 WHERE kind = 'postpone' AND ref_id = $2 AND closed_at IS NULL", [req.user.id, req.params.id]);
  res.json({ ok: true, due_date: due });
});

// ما بدنا نأجّل — الطلب بيضل «ما تم» (وبينلغى أو بيرجع من شاشة الطلبات)
router.post("/orders/:id/postpone/reject", editOrders, async (req, res) => {
  await query("UPDATE f_orders SET postpone_state = 'rejected', updated_at = now() WHERE id = $1 AND postpone_state = 'pending'", [req.params.id]);
  await query("UPDATE f_alerts SET closed_at = now(), closed_by = $1 WHERE kind = 'postpone' AND ref_id = $2 AND closed_at IS NULL", [req.user.id, req.params.id]);
  res.json({ ok: true });
});

export default router;
