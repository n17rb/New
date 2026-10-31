import { Router } from "express";
import { pool, query, logActivity } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePerm } from "../permissions.js";
import { uploadSingleImage, saveCompressedImage } from "../middleware/upload.js";
import { ensureWalletToken } from "./invoices.js";

const router = Router();
router.use(requireAuth);

const round2 = (n) => Math.round(Number(n) * 100) / 100;

// الباقات المتاحة (للبيع من صفحة الزبون، ولاحقًا لتطبيق الزبون)
router.get("/packages", async (req, res) => {
  const all = req.query.all === "true";
  const result = await query(
    `SELECT * FROM coupon_packages ${all ? "" : "WHERE status = 'active'"} ORDER BY status, sort_order, price`
  );
  res.json(result.rows);
});

export function packageLabel(coupons, bonus = 0) {
  const n = Number(coupons) || 0;
  const w = n === 1 ? "كوبون واحد" : n === 2 ? "كوبونين" : n >= 3 && n <= 10 ? `${n} كوبونات` : `${n} كوبون`;
  return bonus > 0 ? `${w} + ${bonus} هدية` : w;
}

function cleanPackage(body) {
  const coupons = Math.floor(Number(body?.coupons));
  const bonus = Math.max(0, Math.floor(Number(body?.bonus_coupons) || 0));
  const price = round2(body?.price);
  // ما في اسم للباقة — بتنعرف بعدد كوبوناتها («١٠ كوبونات + ٢ هدية»)
  const name = packageLabel(coupons, bonus);
  if (!Number.isInteger(coupons) || coupons <= 0 || coupons > 1000) return { error: "عدد الكوبونات لازم يكون بين 1 و 1000." };
  if (!Number.isFinite(price) || price < 0) return { error: "السعر غير صحيح." };
  return {
    value: {
      name,
      coupons,
      bonus_coupons: bonus,
      price,
      description: String(body?.description || "").trim().slice(0, 300) || null,
      sort_order: Math.floor(Number(body?.sort_order) || 0),
    },
  };
}

router.post("/packages", requirePerm("coupons", "edit"), async (req, res) => {
  const { value, error } = cleanPackage(req.body);
  if (error) return res.status(400).json({ error });
  const result = await query(
    `INSERT INTO coupon_packages (name, coupons, bonus_coupons, price, description, sort_order)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [value.name, value.coupons, value.bonus_coupons, value.price, value.description, value.sort_order]
  );
  await logActivity({ userId: req.user.id, action: "CREATE_COUPON_PACKAGE", recordType: "coupon_package", recordId: result.rows[0].id, newValue: value });
  res.status(201).json(result.rows[0]);
});

router.put("/packages/:id", requirePerm("coupons", "edit"), async (req, res) => {
  const { value, error } = cleanPackage(req.body);
  if (error) return res.status(400).json({ error });
  const status = ["active", "archived"].includes(req.body?.status) ? req.body.status : "active";
  const result = await query(
    `UPDATE coupon_packages SET name=$1, coupons=$2, bonus_coupons=$3, price=$4, description=$5, sort_order=$6, status=$7
     WHERE id=$8 RETURNING *`,
    [value.name, value.coupons, value.bonus_coupons, value.price, value.description, value.sort_order, status, req.params.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: "الباقة غير موجودة." });
  res.json(result.rows[0]);
});

router.post("/packages/:id/image", requirePerm("coupons", "edit"), uploadSingleImage, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "اختار صورة." });
  const url = await saveCompressedImage(req.file.buffer, `coupon-package-${req.params.id}`);
  const result = await query("UPDATE coupon_packages SET image_url = $1 WHERE id = $2 RETURNING *", [url, req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: "الباقة غير موجودة." });
  res.json(result.rows[0]);
});

// بيع باقة لزبون: بتنضاف الكوبونات فورًا، واللي ما دفعه بيصير دين عليه
// بيع باقة كوبونات لزبون (من صفحة الزبون أو من جوّا الرحلة)
// بيرجع {sale, coupon_balance, debt_balance} أو بيرمي خطأ فيه status
export async function sellCouponPackage({ customerId, packageId, paidAmount, userId, tripId = null }) {
  const fail = (status, msg) => Object.assign(new Error(msg), { status });
  const pkg = (await query("SELECT * FROM coupon_packages WHERE id = $1 AND status = 'active'", [packageId])).rows[0];
  if (!pkg) throw fail(404, "الباقة غير موجودة.");

  const price = round2(pkg.price);
  const paid = paidAmount == null || paidAmount === "" ? price : round2(paidAmount);
  if (!Number.isFinite(paid) || paid < 0 || paid > price + 0.001) {
    throw fail(400, `المبلغ المدفوع لازم يكون بين 0 و ${price.toFixed(2)}.`);
  }
  const unpaid = round2(price - paid);
  const totalCoupons = pkg.coupons + pkg.bonus_coupons;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const c = (await client.query("SELECT id, name, coupon_balance, debt_balance FROM customers WHERE id = $1 FOR UPDATE", [customerId])).rows[0];
    if (!c) throw fail(404, "العميل غير موجود.");
    const newCoupons = c.coupon_balance + totalCoupons;
    const newDebt = round2(Number(c.debt_balance) + unpaid);

    const sale = (await client.query(
      `INSERT INTO coupon_sales (customer_id, package_id, package_name_snapshot, coupons, price, paid_amount, sold_by, trip_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [customerId, pkg.id, pkg.name, totalCoupons, price, paid, userId, tripId]
    )).rows[0];
    await client.query(
      `INSERT INTO coupon_ledger (customer_id, change_amount, reason, balance_after, created_by, notes)
       VALUES ($1, $2, 'package_purchase', $3, $4, $5)`,
      [customerId, totalCoupons, newCoupons, userId, pkg.name]
    );
    if (unpaid > 0) {
      await client.query(
        `INSERT INTO customer_debt_ledger (customer_id, change_amount, reason, balance_after, notes, created_by)
         VALUES ($1, $2, 'coupon_package', $3, $4, $5)`,
        [customerId, unpaid, newDebt, `باقي ثمن ${pkg.name}`, userId]
      );
    }
    await client.query("UPDATE customers SET coupon_balance = $1, debt_balance = $2 WHERE id = $3", [newCoupons, newDebt, customerId]);
    await client.query("COMMIT");

    await logActivity({
      userId, action: "SELL_COUPON_PACKAGE", recordType: "customer", recordId: customerId,
      newValue: { package: pkg.name, coupons: totalCoupons, price, paid, unpaid, trip_id: tripId },
    });
    return { sale, coupon_balance: newCoupons, debt_balance: newDebt };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

router.post("/sell", requirePerm("coupons", "edit"), async (req, res) => {
  try {
    const customerId = Number(req.body?.customer_id);
    const r = await sellCouponPackage({ customerId, packageId: Number(req.body?.package_id), paidAmount: req.body?.paid_amount, userId: req.user.id });
    const wallet_token = req.user.inspecting || !req.tenant?.id ? null : await ensureWalletToken(customerId, req.tenant.id).catch(() => null);
    res.json({ ...r, wallet_token });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    throw err;
  }
});


// ملخص مبيعات الباقات + الزباين اللي كوبوناتهم قربت تخلص
router.get("/overview", requirePerm("coupons", "view"), async (req, res) => {
  const [sales, low, totals] = await Promise.all([
    query(
      `SELECT s.*, c.name AS customer_name, u.full_name AS sold_by_name
       FROM coupon_sales s JOIN customers c ON c.id = s.customer_id LEFT JOIN users u ON u.id = s.sold_by
       ORDER BY s.created_at DESC LIMIT 50`
    ),
    query(
      `SELECT c.id, c.name, c.phone_display, c.phone_normalized, c.coupon_balance
       FROM customers c
       WHERE c.status = 'active' AND c.coupon_balance <= 2
         AND EXISTS (SELECT 1 FROM coupon_ledger l WHERE l.customer_id = c.id AND l.change_amount > 0)
       ORDER BY c.coupon_balance ASC, c.name ASC LIMIT 100`
    ),
    query(
      `SELECT
         COALESCE(SUM(price) FILTER (WHERE created_at >= date_trunc('month', now() AT TIME ZONE 'Asia/Amman') AT TIME ZONE 'Asia/Amman'), 0)::float AS month_sales,
         COUNT(*) FILTER (WHERE created_at >= date_trunc('month', now() AT TIME ZONE 'Asia/Amman') AT TIME ZONE 'Asia/Amman')::int AS month_count,
         (SELECT COALESCE(SUM(coupon_balance), 0)::int FROM customers WHERE status = 'active') AS coupons_outstanding
       FROM coupon_sales`
    ),
  ]);
  res.json({ ...totals.rows[0], recent_sales: sales.rows, low_balance: low.rows });
});

export default router;
