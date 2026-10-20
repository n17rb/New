import { Router } from "express";
import { pool, query, logActivity } from "../../db.js";
import { requireOwner } from "../../permissions.js";
import { bad } from "./lib.js";

// ============================================================
// المصنع: حذف الداتا التجريبية والبداية من جديد بزباين حقيقيين
// بينحذف: الزباين التجريبيين وكل طلباتهم وحساباتهم، الرحلات اللي صارت فاضية، الأرصدة الافتتاحية الوهمية،
// الموظفين التجريبيين (وحساباتهم بتنطفي)، والتنبيهات.
// بيضل: المنتجات وصورها، السيارات، الخطوط، المكنات، المواد الخام، البونص، الشعار، وأي زبون حقيقي ضفته إنت.
// ============================================================
const router = Router();

router.get("/sample", requireOwner, async (req, res) => {
  const r = await query(
    `SELECT (SELECT COUNT(*)::int FROM f_customers WHERE is_sample) AS customers,
            (SELECT COUNT(*)::int FROM f_orders o JOIN f_customers c ON c.id = o.customer_id WHERE c.is_sample) AS orders,
            (SELECT COUNT(*)::int FROM employees WHERE is_sample) AS employees,
            (SELECT COUNT(*)::int FROM f_customers WHERE NOT is_sample AND active) AS real_customers`
  );
  res.json({ ...r.rows[0], is_demo: !!req.tenant?.is_demo });
});

router.post("/sample/remove", requireOwner, async (req, res) => {
  if (req.tenant?.is_demo) return bad(res, "هاي نسخة عرض وبترجع لأولها كل يوم. اطلب من موج يحوّلها لحساب حقيقي أول.");
  if (String(req.body?.confirm || "").trim() !== "امسح") return bad(res, "اكتب «امسح» للتأكيد.");
  const client = await pool.connect();
  const out = {};
  try {
    await client.query("BEGIN");
    const q = (t, p) => client.query(t, p);
    const cust = (await q("SELECT id FROM f_customers WHERE is_sample")).rows.map((r) => r.id);
    const orders = cust.length ? (await q("SELECT id FROM f_orders WHERE customer_id = ANY($1::int[])", [cust])).rows.map((r) => r.id) : [];
    const trips = orders.length ? (await q("SELECT DISTINCT trip_id FROM f_orders WHERE id = ANY($1::int[]) AND trip_id IS NOT NULL", [orders])).rows.map((r) => r.trip_id) : [];
    if (cust.length) {
      await q("DELETE FROM f_messages WHERE customer_id = ANY($1::int[])", [cust]);
      await q("DELETE FROM f_ledger WHERE customer_id = ANY($1::int[])", [cust]);
      await q("DELETE FROM f_bonus_rules WHERE customer_id = ANY($1::int[])", [cust]);
      await q("DELETE FROM f_orders WHERE id = ANY($1::int[])", [orders]);
      await q("DELETE FROM f_customer_prices WHERE customer_id = ANY($1::int[])", [cust]);
      await q("DELETE FROM f_customers WHERE id = ANY($1::int[])", [cust]);
    }
    // رحلات صارت فاضية (كانت كلها لزباين تجريبيين)
    let emptyTrips = [];
    if (trips.length) {
      emptyTrips = (await q("SELECT t.id FROM f_trips t WHERE t.id = ANY($1::int[]) AND NOT EXISTS (SELECT 1 FROM f_orders o WHERE o.trip_id = t.id)", [trips])).rows.map((r) => r.id);
      if (emptyTrips.length) {
        await q("DELETE FROM f_stock_moves WHERE trip_id = ANY($1::int[])", [emptyTrips]);
        await q("DELETE FROM f_expenses WHERE trip_id = ANY($1::int[])", [emptyTrips]);
        await q("DELETE FROM f_driver_ledger WHERE trip_id = ANY($1::int[])", [emptyTrips]);
        await q("DELETE FROM f_positions WHERE trip_id = ANY($1::int[])", [emptyTrips]);
        await q("DELETE FROM f_trips WHERE id = ANY($1::int[])", [emptyTrips]);
      }
    }
    // الأرصدة الافتتاحية الوهمية، والمواد الخام الوهمية بترجع صفر
    await q("DELETE FROM f_stock_moves WHERE reason LIKE '%(تجريبي)%'");
    const hadSample = cust.length > 0;
    if (hadSample) {
      await q("UPDATE f_materials SET balance = 0");
      await q("DELETE FROM f_material_moves");
    }
    // الموظفين التجريبيين: بينحذفوا وحساباتهم بتنطفي، وبتنفك عن السيارات
    const empRows = (await q("DELETE FROM employees WHERE is_sample RETURNING user_id")).rows;
    const emps = empRows.map((r) => r.user_id).filter(Boolean);
    if (emps.length) {
      await q("UPDATE f_vehicles SET driver_id = NULL WHERE driver_id = ANY($1::int[])", [emps]);
      await q("UPDATE f_trips SET driver_id = NULL WHERE driver_id = ANY($1::int[]) AND status IN ('planned')", [emps]);
      await q("UPDATE users SET status = 'disabled' WHERE id = ANY($1::int[]) AND role <> 'super_admin'", [emps]);
    }
    await q("DELETE FROM f_alerts");
    await q("DELETE FROM f_downtime");
    await q("DELETE FROM app_settings WHERE key = 'f_setup_done'");
    await q("COMMIT");
    Object.assign(out, { customers: cust.length, orders: orders.length, trips: emptyTrips.length, employees: empRows.length });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  await logActivity({ userId: req.user.id, action: "F_CLEAR_SAMPLE", recordType: "settings", recordId: null, newValue: out });
  res.json({ ok: true, ...out });
});

export default router;
