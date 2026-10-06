import { Router } from "express";
import { query, logActivity } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { can, canAction, requirePerm } from "../permissions.js";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  const includeArchived = req.query.all === "true" && can(req.user, "products", "edit");
  const result = await query(
    `SELECT * FROM products
     WHERE ($1 = true OR status != 'archived')
     ORDER BY sort_order ASC, id ASC`,
    [includeArchived]
  );
  res.json(result.rows);
});

router.post("/", requirePerm("products", "edit"), async (req, res) => {
  const { name, type, unit_price, sort_order, coupon_eligible, grants_coupons } = req.body;
  if (!name || unit_price == null) {
    return res.status(400).json({ error: "اسم المنتج والسعر مطلوبان." });
  }

  const result = await query(
    `INSERT INTO products (name, type, unit_price, sort_order, coupon_eligible, grants_coupons, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [name.trim(), type || "standard", unit_price, sort_order || 0, coupon_eligible || false, grants_coupons || null, req.user.id]
  );

  await logActivity({
    userId: req.user.id,
    action: "CREATE_PRODUCT",
    recordType: "product",
    recordId: result.rows[0].id,
    newValue: result.rows[0],
  });

  res.status(201).json(result.rows[0]);
});

router.put("/:id", async (req, res) => {
  if (!can(req.user, "products", "edit") && !canAction(req.user, "edit_prices")) {
    return res.status(403).json({ error: "ليست لديك صلاحية تعديل المنتجات أو الأسعار." });
  }

  const before = await query("SELECT * FROM products WHERE id = $1", [req.params.id]);
  if (!before.rows[0]) return res.status(404).json({ error: "المنتج غير موجود." });

  const { name, unit_price, status, sort_order, coupon_eligible, grants_coupons } = req.body;
  const updated = await query(
    `UPDATE products SET
       name = COALESCE($1, name),
       unit_price = COALESCE($2, unit_price),
       status = COALESCE($3, status),
       sort_order = COALESCE($4, sort_order),
       coupon_eligible = COALESCE($5, coupon_eligible),
       grants_coupons = COALESCE($6, grants_coupons),
       updated_by = $7,
       updated_at = now()
     WHERE id = $8 RETURNING *`,
    [name, unit_price, status, sort_order, coupon_eligible, grants_coupons, req.user.id, req.params.id]
  );

  await logActivity({
    userId: req.user.id,
    action: "UPDATE_PRODUCT",
    recordType: "product",
    recordId: req.params.id,
    oldValue: before.rows[0],
    newValue: updated.rows[0],
  });

  res.json(updated.rows[0]);
});

router.delete("/:id", requirePerm("products", "edit"), async (req, res) => {
  const result = await query(
    "UPDATE products SET status = 'archived', updated_at = now() WHERE id = $1 RETURNING *",
    [req.params.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: "المنتج غير موجود." });

  await logActivity({
    userId: req.user.id,
    action: "ARCHIVE_PRODUCT",
    recordType: "product",
    recordId: req.params.id,
  });

  res.json({ message: "تمت أرشفة المنتج." });
});

export default router;
