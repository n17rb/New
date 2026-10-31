import { Router } from "express";
import crypto from "crypto";
import { query, setRequestTenant } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { canAny } from "../permissions.js";
import { getTenant } from "../utils/tenants.js";

// ============================================================
// فواتير الطلبات: رابط عام بيفتحه الزبون من واتساب (بدون تسجيل دخول)
// شكل التوكن: <رقم المحل>-<رمز عشوائي> — عشان نعرف أي محل
// ============================================================
const router = Router();
router.use(requireAuth);

// رابط فاتورة الطلب (بينعمل مرة وحدة وبيضل نفسه)
export async function ensureInvoiceToken(orderId, tenantId) {
  const r = await query("SELECT id, invoice_token FROM orders WHERE id = $1", [orderId]);
  const order = r.rows[0];
  if (!order) return null;
  if (order.invoice_token) return order.invoice_token;
  const token = `${tenantId}-${crypto.randomBytes(9).toString("base64url")}`;
  await query("UPDATE orders SET invoice_token = $1 WHERE id = $2 AND invoice_token IS NULL", [token, order.id]);
  return (await query("SELECT invoice_token FROM orders WHERE id = $1", [order.id])).rows[0].invoice_token;
}

// رابط رصيد كوبونات الزبون (بينعمل مرة وحدة وبيضل نفسه)
export async function ensureWalletToken(customerId, tenantId) {
  const r = await query("SELECT id, wallet_token FROM customers WHERE id = $1", [customerId]);
  const c = r.rows[0];
  if (!c) return null;
  if (c.wallet_token) return c.wallet_token;
  const token = `${tenantId}-${crypto.randomBytes(9).toString("base64url")}`;
  await query("UPDATE customers SET wallet_token = $1 WHERE id = $2 AND wallet_token IS NULL", [token, c.id]);
  return (await query("SELECT wallet_token FROM customers WHERE id = $1", [c.id])).rows[0].wallet_token;
}

router.post("/wallet/:customerId", async (req, res) => {
  if (!canAny(req.user, [["customers", "view"], ["delivery", "edit"], ["coupons", "view"]])) {
    return res.status(403).json({ error: "ما عندك صلاحية." });
  }
  if (req.user.inspecting) return res.status(403).json({ error: "وضع المعاينة." });
  const token = await ensureWalletToken(req.params.customerId, req.tenant.id);
  if (!token) return res.status(404).json({ error: "الزبون غير موجود." });
  res.json({ token, path: `/w/${token}` });
});

router.post("/order/:id", async (req, res) => {
  if (!canAny(req.user, [["orders", "view"], ["delivery", "edit"], ["customers", "view"]])) {
    return res.status(403).json({ error: "ما عندك صلاحية." });
  }
  const r = await query("SELECT id, invoice_token FROM orders WHERE id = $1", [req.params.id]);
  const order = r.rows[0];
  if (!order) return res.status(404).json({ error: "الطلب غير موجود." });
  let token = order.invoice_token;
  if (!token) {
    if (req.user.inspecting) return res.status(403).json({ error: "وضع المعاينة." });
    token = `${req.tenant.id}-${crypto.randomBytes(9).toString("base64url")}`;
    await query("UPDATE orders SET invoice_token = $1 WHERE id = $2 AND invoice_token IS NULL", [token, order.id]);
    token = (await query("SELECT invoice_token FROM orders WHERE id = $1", [order.id])).rows[0].invoice_token;
  }
  res.json({ token, path: `/i/${token}` });
});

export default router;

// ---------- العام (بدون دخول) ----------
export const publicInvoiceRouter = Router();

publicInvoiceRouter.get("/invoice/:token", async (req, res) => {
  const token = String(req.params.token || "");
  const m = token.match(/^(\d+)-[A-Za-z0-9_-]{8,30}$/);
  if (!m) return res.status(404).json({ error: "الفاتورة غير موجودة." });
  const tenant = await getTenant(Number(m[1]));
  if (!tenant || tenant.status !== "active") return res.status(404).json({ error: "الفاتورة غير موجودة." });
  setRequestTenant(tenant);

  const r = await query(
    `SELECT o.id, o.customer_id, o.order_number, o.status, o.subtotal, o.final_total, o.discount_type, o.discount_value, o.created_at, o.updated_at,
            c.name AS customer_name, c.phone_display, c.coupon_balance, c.debt_balance,
            ts.cash_collected, ts.coupons_collected, ts.debt_added, ts.debt_paid, ts.delivered_at
     FROM orders o JOIN customers c ON c.id = o.customer_id
     LEFT JOIN LATERAL (SELECT * FROM trip_stops WHERE order_id = o.id AND delivered_at IS NOT NULL ORDER BY id DESC LIMIT 1) ts ON true
     WHERE o.invoice_token = $1`,
    [token]
  );
  const o = r.rows[0];
  if (!o) return res.status(404).json({ error: "الفاتورة غير موجودة." });
  const items = await query(
    "SELECT product_name_snapshot AS name, quantity, unit_price_snapshot AS unit_price, line_total, coupon_quantity FROM order_items WHERE order_id = $1 ORDER BY id",
    [o.id]
  );
  // آخر باقة اشتراها (عشان نرسم «باقي ٦ من ١٢»)
  const lastPkg = (await query(
    "SELECT package_name_snapshot AS name, coupons, created_at FROM coupon_sales WHERE customer_id = $1 ORDER BY id DESC LIMIT 1",
    [o.customer_id]
  )).rows[0] || null;
  const shopName = tenant.name;
  res.set("Cache-Control", "no-store");
  res.json({
    shop: { name: shopName, phone: tenant.phone && !tenant.is_home ? tenant.phone : null },
    order: {
      number: o.order_number, status: o.status, created_at: o.created_at, delivered_at: o.delivered_at,
      subtotal: Number(o.subtotal), total: Number(o.final_total),
      discount: Math.max(0, Number(o.subtotal) - Number(o.final_total)),
      cash_paid: o.cash_collected != null ? Number(o.cash_collected) : null,
      coupons_used: o.coupons_collected || 0,
      debt_added: Number(o.debt_added || 0),
      debt_paid: Number(o.debt_paid || 0),
    },
    customer: {
      name: o.customer_name, coupon_balance: o.coupon_balance, debt_balance: Number(o.debt_balance || 0),
      last_package: lastPkg ? { name: lastPkg.name, coupons: lastPkg.coupons } : null,
    },
    items: items.rows.map((i) => ({ ...i, unit_price: Number(i.unit_price), line_total: Number(i.line_total) })),
  });
});

// رصيد كوبونات الزبون — صفحة عامة بيفتحها من رسالة الواتساب
publicInvoiceRouter.get("/wallet/:token", async (req, res) => {
  const token = String(req.params.token || "");
  const m = token.match(/^(\d+)-[A-Za-z0-9_-]{8,30}$/);
  if (!m) return res.status(404).json({ error: "الرابط غير صحيح." });
  const tenant = await getTenant(Number(m[1]));
  if (!tenant || tenant.status !== "active") return res.status(404).json({ error: "الرابط غير صحيح." });
  setRequestTenant(tenant);
  const c = (await query("SELECT id, name, coupon_balance FROM customers WHERE wallet_token = $1", [token])).rows[0];
  if (!c) return res.status(404).json({ error: "الرابط غير صحيح." });
  const lastPkg = (await query(
    "SELECT package_name_snapshot AS name, coupons, created_at FROM coupon_sales WHERE customer_id = $1 ORDER BY id DESC LIMIT 1",
    [c.id]
  )).rows[0] || null;
  const history = (await query(
    `SELECT change_amount, reason, balance_after, created_at FROM coupon_ledger
     WHERE customer_id = $1 ORDER BY id DESC LIMIT 10`,
    [c.id]
  )).rows;
  res.set("Cache-Control", "no-store");
  res.json({
    shop: { name: tenant.name, phone: tenant.phone && !tenant.is_home ? tenant.phone : null },
    customer: { name: c.name, coupon_balance: c.coupon_balance },
    last_package: lastPkg ? { name: lastPkg.name, coupons: lastPkg.coupons, at: lastPkg.created_at } : null,
    history: history.map((h) => ({ change: h.change_amount, reason: h.reason, balance: h.balance_after, at: h.created_at })),
  });
});
