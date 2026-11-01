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

// ============================================================
// تصفير كامل: بيمسح كل شغل التجربة (طلبات، رحلات، فواتير، دفعات، شيكات، صندوق، مستودع، جرد،
// صيانة، أعطال، تنبيهات، رواتب وسلف ودوام…) وبيرجّع الأرصدة صفر.
// بيضل: الزباين ومعلوماتهم وأسعارهم ومناطقهم، المنتجات، السيارات، الموظفين وحساباتهم،
// وأسماء المواد والمكنات والشركات، والإعدادات والشعار.
// قبل المسح بتنحفظ نسخة احتياطية من كل اللي انمسح.
// ============================================================
const WIPE = [
  "f_order_items", "f_order_exchanges", "f_order_edits", "f_messages", "f_ledger", "f_driver_ledger", "f_expenses",
  "f_positions", "f_salvage", "f_stock_moves", "f_orders", "f_trips", "f_material_moves", "f_downtime", "f_alerts", "f_idem",
  "f_maint", "f_work_hours", "f_qchecks", "f_filter_changes", "f_partner_ledger", "f_recycle", "f_cashbook", "f_agreements",
  "f_handover", "f_meter_entries", "employee_transactions", "attendance",
];
const NO_BACKUP = new Set(["f_positions", "f_idem"]); // نقاط الـGPS كثيرة وما إلها لزمة بالنسخة

router.get("/reset", requireOwner, async (req, res) => {
  const counts = {};
  for (const t of ["f_orders", "f_trips", "f_ledger", "f_cashbook", "f_stock_moves", "f_material_moves", "f_alerts", "employee_transactions"]) {
    counts[t] = Number((await query(`SELECT COUNT(*)::int AS n FROM ${t}`).catch(() => ({ rows: [{ n: 0 }] }))).rows[0].n);
  }
  res.json(counts);
});

router.post("/reset", requireOwner, async (req, res) => {
  if (req.tenant?.is_demo) return bad(res, "هاي نسخة عرض وبترجع لأولها كل يوم.");
  const c = String(req.body?.confirm || "").trim().replace(/[\u064B-\u0652]/g, "");
  if (c !== "صفر") return bad(res, "اكتب «صفر» للتأكيد.");
  const client = await pool.connect();
  const out = {};
  try {
    await client.query("BEGIN");
    const q = (t, p) => client.query(t, p);
    // النسخة الاحتياطية أول
    const backup = { kind: "factory_reset", generated_at: new Date().toISOString(), by: req.user.full_name, tables: {} };
    for (const t of WIPE) {
      const r = await q(`SELECT COUNT(*)::int AS n FROM ${t}`);
      out[t] = r.rows[0].n;
      if (!NO_BACKUP.has(t) && r.rows[0].n) backup.tables[t] = (await q(`SELECT * FROM ${t}`)).rows;
    }
    backup.tables.f_customers_balance = (await q("SELECT id, name, balance FROM f_customers WHERE balance <> 0")).rows;
    backup.tables.f_materials_balance = (await q("SELECT id, name, balance FROM f_materials WHERE balance <> 0")).rows;
    backup.tables.f_partners_balance = (await q("SELECT id, name, balance FROM f_partners WHERE balance <> 0")).rows;
    await q("INSERT INTO backup_snapshots (data) VALUES ($1)", [JSON.stringify(backup)]);
    // المسح (والترقيم بيرجع من ١: الفواتير والطلبات والرحلات)
    await q(`TRUNCATE ${WIPE.join(", ")} RESTART IDENTITY`);
    await q("UPDATE f_customers SET balance = 0 WHERE balance <> 0");
    await q("UPDATE f_materials SET balance = 0 WHERE balance <> 0");
    await q("UPDATE f_partners SET balance = 0 WHERE balance <> 0");
    await q("UPDATE f_filters SET last_changed = NULL").catch(() => {});
    await q("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  await logActivity({ userId: req.user.id, action: "F_RESET_ALL", recordType: "factory", recordId: null, newValue: out });
  res.json({ ok: true, orders: out.f_orders, trips: out.f_trips, ledger: out.f_ledger });
});

export default router;
