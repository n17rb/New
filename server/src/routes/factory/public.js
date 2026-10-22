import { Router } from "express";
import { query, setRequestTenant } from "../../db.js";
import { getTenant } from "../../utils/tenants.js";
import { brand, round2 } from "./lib.js";

// ============================================================
// صفحات الزبون بدون تسجيل دخول: متابعة الطلبات وكشف الحساب، والفاتورة
// الرابط: <رقم المصنع>-<رمز عشوائي>
// ============================================================
const router = Router();

async function enter(token, res) {
  const m = String(token || "").match(/^(\d+)-[A-Za-z0-9_-]{8,30}$/);
  if (!m) { res.status(404).json({ error: "الرابط غير صحيح." }); return false; }
  const t = await getTenant(Number(m[1]));
  if (!t || t.status !== "active" || t.plan !== "factory") { res.status(404).json({ error: "الرابط غير صحيح." }); return false; }
  setRequestTenant(t);
  return true;
}

// شاشة دخول المصنع: الاسم والشعار بس (بدون أي بيانات ثانية)
router.get("/f/brand/:id", async (req, res) => {
  const t = await getTenant(Number(req.params.id));
  if (!t || t.status !== "active" || t.plan !== "factory") return res.status(404).json({ error: "غير موجود." });
  setRequestTenant(t);
  const b = await brand();
  res.json({ id: t.id, name: b.name, logo: b.logo, icon: b.icon, tagline: b.tagline, phone: b.phone });
});

// ملف التطبيق (manifest): لما الموظف يضيف المصنع للشاشة الرئيسية بيطلع باسم المصنع وأيقونته
router.get("/f/manifest/:id", async (req, res) => {
  const t = await getTenant(Number(req.params.id));
  if (!t || t.status !== "active" || t.plan !== "factory") return res.status(404).json({ error: "غير موجود." });
  setRequestTenant(t);
  const b = await brand();
  const o = /^https?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(String(req.query.o || "")) ? req.query.o : process.env.APP_URL || "https://new-1-tb2d.onrender.com";
  const abs = (u) => (!u ? null : /^https?:/.test(u) ? u : `${o}${u}`);
  const short = b.name.split(" ").slice(0, 2).join(" ");
  const icon = abs(b.icon) || `${o}/icon-512.png`;
  res.setHeader("Content-Type", "application/manifest+json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.end(JSON.stringify({
    id: `${o}/m/${t.id}`,
    name: b.name,
    short_name: short,
    start_url: `${o}/m/${t.id}`,
    scope: `${o}/`,
    display: "standalone",
    orientation: "portrait",
    dir: "rtl",
    lang: "ar",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      { src: icon, sizes: "512x512", type: "image/png", purpose: "any" },
      { src: icon, sizes: "192x192", type: "image/png", purpose: "any" },
    ],
  }));
});

router.get("/f/track/:token", async (req, res) => {
  if (!(await enter(req.params.token, res))) return;
  const c = (await query("SELECT id, name, city, balance FROM f_customers WHERE track_token = $1 AND active", [req.params.token])).rows[0];
  if (!c) return res.status(404).json({ error: "الرابط غير صحيح." });
  const [orders, ledger] = await Promise.all([
    query(
      `SELECT o.id, o.status, o.total, o.delivered_total, o.cash_paid, o.eta_at, o.delivered_at, o.created_at, o.delay_reason, o.invoice_token,
              to_char(o.due_date,'YYYY-MM-DD') AS due_date, t.status AS trip_status, u.full_name AS driver_name, v.name AS vehicle_name,
              (SELECT COUNT(*)::int FROM f_orders o2 WHERE o2.trip_id = o.trip_id AND o2.status = 'onway' AND o2.stop_seq < o.stop_seq) AS stops_before,
              (SELECT string_agg(i.qty || ' كرتونة ' || p.name || CASE WHEN i.bonus_qty > 0 THEN ' + ' || i.bonus_qty || ' بونص' ELSE '' END, '، ') FROM f_order_items i JOIN f_products p ON p.id = i.product_id WHERE i.order_id = o.id) AS items
       FROM f_orders o LEFT JOIN f_trips t ON t.id = o.trip_id LEFT JOIN f_vehicles v ON v.id = t.vehicle_id LEFT JOIN users u ON u.id = t.driver_id
       WHERE o.customer_id = $1 AND (o.status IN ('new','assigned','onway','delayed') OR o.updated_at > now() - interval '45 days')
       ORDER BY o.id DESC LIMIT 25`,
      [c.id]
    ),
    query("SELECT kind, amount, balance_after, method, note, created_at FROM f_ledger WHERE customer_id = $1 ORDER BY id DESC LIMIT 30", [c.id]),
  ]);
  res.json({
    brand: await brand(),
    customer: { name: c.name, city: c.city, balance: round2(c.balance) },
    orders: orders.rows.map((o) => ({ ...o, total: Number(o.total), delivered_total: o.delivered_total == null ? null : Number(o.delivered_total), cash_paid: Number(o.cash_paid) })),
    ledger: ledger.rows.map((g) => ({ ...g, amount: Number(g.amount), balance_after: Number(g.balance_after) })),
  });
});

router.get("/f/invoice/:token", async (req, res) => {
  if (!(await enter(req.params.token, res))) return;
  const o = (await query(
    `SELECT o.id, o.delivered_total, o.cash_paid, o.delivered_at, o.signature, c.name AS customer_name, c.city, c.phone, c.track_token,
            u.full_name AS driver_name, v.name AS vehicle_name,
            (SELECT balance_after FROM f_ledger g WHERE g.order_id = o.id ORDER BY g.id DESC LIMIT 1) AS balance_after
     FROM f_orders o JOIN f_customers c ON c.id = o.customer_id LEFT JOIN f_trips t ON t.id = o.trip_id
     LEFT JOIN f_vehicles v ON v.id = t.vehicle_id LEFT JOIN users u ON u.id = t.driver_id
     WHERE o.invoice_token = $1 AND o.status = 'delivered'`,
    [req.params.token]
  )).rows[0];
  if (!o) return res.status(404).json({ error: "الفاتورة غير موجودة." });
  const items = await query(
    "SELECT p.name, i.qty, i.delivered_qty, i.damaged_qty, i.price, i.bonus_qty, i.delivered_bonus FROM f_order_items i JOIN f_products p ON p.id = i.product_id WHERE i.order_id = (SELECT id FROM f_orders WHERE invoice_token = $1)",
    [req.params.token]
  );
  const exchanges = (await query(
    "SELECT p.name, SUM(x.qty)::int AS qty FROM f_order_exchanges x JOIN f_products p ON p.id = x.product_id WHERE x.order_id = $1 GROUP BY p.name",
    [o.id]
  )).rows;
  res.json({
    brand: await brand(),
    exchanges,
    invoice: { ...o, total: Number(o.delivered_total), paid: Number(o.cash_paid), balance_after: o.balance_after == null ? null : Number(o.balance_after) },
    items: items.rows.map((i) => ({ ...i, price: Number(i.price), line: round2((i.delivered_qty ?? i.qty) * Number(i.price)) })),
  });
});

export default router;
