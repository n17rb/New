import { Router } from "express";
import { query, logActivity } from "../../db.js";
import { uploadSingleImage, saveCompressedImage } from "../../middleware/upload.js";
import { can } from "../../permissions.js";
import { CITIES, GOVERNORATES } from "../../utils/factoryGeo.js";
import { need, bad, brand, settings, factoryPoint, round2, checkVehicleDocs } from "./lib.js";

// ============================================================
// المصنع: الإعدادات الأساسية — المنتجات، السيارات، الخطوط، المكنات، المواد الخام، هوية المصنع
// ============================================================
const router = Router();
const edit = need("f_fleet", "edit");
const str = (v, n = 100) => (v == null || v === "" ? null : String(v).trim().slice(0, n));
const int = (v, d = 0) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : d);

// كل اللي بيحتاجه التطبيق عند الفتح
router.get("/bootstrap", async (req, res) => {
  const [products, vehicles, lines, machines, materials, drivers, counts, s] = await Promise.all([
    query("SELECT * FROM f_products ORDER BY active DESC, sort_order, id"),
    query(
      `SELECT v.*, u.full_name AS driver_name, to_char(v.license_expires, 'YYYY-MM-DD') AS license_expires,
              to_char(v.insurance_expires, 'YYYY-MM-DD') AS insurance_expires
       FROM f_vehicles v LEFT JOIN users u ON u.id = v.driver_id
       ORDER BY v.status = 'inactive', v.id`
    ),
    query("SELECT l.*, v.name AS vehicle_name FROM f_lines l LEFT JOIN f_vehicles v ON v.id = l.vehicle_id WHERE l.active ORDER BY l.governorate, l.name"),
    query("SELECT * FROM f_machines WHERE active ORDER BY id"),
    query("SELECT * FROM f_materials WHERE active ORDER BY id"),
    query("SELECT id, full_name, username, role, permissions FROM users WHERE status = 'active' ORDER BY full_name"),
    query(
      `SELECT (SELECT COUNT(*)::int FROM f_products WHERE active) AS products,
              (SELECT COUNT(*)::int FROM f_vehicles WHERE status <> 'inactive') AS vehicles,
              (SELECT COUNT(*)::int FROM f_customers WHERE active) AS customers,
              (SELECT COUNT(*)::int FROM f_lines WHERE active) AS lines,
              (SELECT COUNT(*)::int FROM f_orders) AS orders,
              (SELECT COUNT(*)::int FROM f_trips) AS trips,
              (SELECT COUNT(*)::int FROM users WHERE status = 'active' AND role <> 'super_admin') AS staff,
              (SELECT COUNT(*)::int FROM f_customers WHERE is_sample) AS sample_customers`
    ),
    settings(["shop_latitude", "shop_longitude", "factory_city", "ss_employee_rate", "f_setup_done"]),
  ]);
  const recipes = await query("SELECT * FROM f_recipes");
  const bonusRules = await query(
    `SELECT b.*, p.name AS product_name, c.name AS customer_name FROM f_bonus_rules b
     LEFT JOIN f_products p ON p.id = b.product_id LEFT JOIN f_customers c ON c.id = b.customer_id ORDER BY b.active DESC, b.id`
  );
  const driverList = drivers.rows.filter((u) => u.role !== "super_admin" && can(u, "f_drive", "edit")).map(({ permissions, ...u }) => u);
  res.json({
    brand: await brand(),
    products: products.rows.map((p) => ({ ...p, price: Number(p.price), recipe: recipes.rows.filter((r) => r.product_id === p.id).map((r) => ({ material_id: r.material_id, qty: Number(r.qty_per_carton) })) })),
    vehicles: vehicles.rows,
    lines: lines.rows,
    machines: machines.rows,
    materials: materials.rows.map((m) => ({ ...m, balance: Number(m.balance), min_level: Number(m.min_level) })),
    drivers: driverList,
    staff: drivers.rows.map(({ permissions, ...u }) => u),
    bonus_rules: bonusRules.rows,
    cities: Object.keys(CITIES),
    governorates: GOVERNORATES,
    factory: { point: await factoryPoint(), city: s.factory_city || null, has_location: !!(s.shop_latitude && s.shop_longitude) },
    ss_rate: Number(s.ss_employee_rate) || 7.5,
    counts: counts.rows[0],
    setup_done: s.f_setup_done === "1",
  });
});

// ---------- المنتجات ----------
function cleanProduct(b) {
  const name = str(b.name, 100);
  if (!name) throw new Error("اكتب اسم المنتج.");
  const price = Number(b.price);
  if (!Number.isFinite(price) || price < 0) throw new Error("السعر غير صحيح.");
  return { name, per_carton: Math.max(0, int(b.per_carton)), price, min_stock: Math.max(0, int(b.min_stock)), active: b.active !== false, sort_order: int(b.sort_order) };
}
router.post("/products", edit, async (req, res) => {
  let p; try { p = cleanProduct(req.body || {}); } catch (e) { return bad(res, e.message); }
  const r = await query("INSERT INTO f_products (name, per_carton, price, min_stock, active, sort_order) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *", [p.name, p.per_carton, p.price, p.min_stock, p.active, p.sort_order]);
  await logActivity({ userId: req.user.id, action: "F_CREATE_PRODUCT", recordType: "f_product", recordId: r.rows[0].id, newValue: p });
  res.status(201).json(r.rows[0]);
});
router.put("/products/:id", edit, async (req, res) => {
  let p; try { p = cleanProduct(req.body || {}); } catch (e) { return bad(res, e.message); }
  const prev = (await query("SELECT price FROM f_products WHERE id = $1", [req.params.id])).rows[0];
  const r = await query("UPDATE f_products SET name=$1, per_carton=$2, price=$3, min_stock=$4, active=$5, sort_order=$6 WHERE id=$7 RETURNING *", [p.name, p.per_carton, p.price, p.min_stock, p.active, p.sort_order, req.params.id]);
  if (!r.rows[0]) return bad(res, "المنتج غير موجود.", 404);
  // السعر تغيّر؟ الطلبات اللي لسا ما انسلّمت بتاخذ السعر الجديد (إلا الزبون اللي إله سعر خاص)
  let repriced = 0;
  if (prev && Number(prev.price) !== Number(p.price)) {
    const u = await query(
      `UPDATE f_order_items i SET price = $1 FROM f_orders o
       WHERE o.id = i.order_id AND i.product_id = $2 AND o.status IN ('new','assigned','onway','delayed')
         AND NOT EXISTS (SELECT 1 FROM f_customer_prices cp WHERE cp.customer_id = o.customer_id AND cp.product_id = i.product_id)
       RETURNING i.order_id`,
      [p.price, req.params.id]
    );
    const ids = [...new Set(u.rows.map((x) => x.order_id))];
    if (ids.length) await query("UPDATE f_orders o SET total = (SELECT COALESCE(SUM(qty * price),0) FROM f_order_items WHERE order_id = o.id), updated_at = now() WHERE o.id = ANY($1::int[])", [ids]);
    repriced = ids.length;
  }
  await logActivity({ userId: req.user.id, action: "F_UPDATE_PRODUCT", recordType: "f_product", recordId: r.rows[0].id, newValue: p });
  res.json({ ...r.rows[0], repriced, old_price: prev ? Number(prev.price) : null });
});
// صورة المنتج
router.post("/products/:id/image", edit, uploadSingleImage, async (req, res) => {
  if (!req.file) return bad(res, "اختار صورة.");
  const url = await saveCompressedImage(req.file.buffer, "product");
  const r = await query("UPDATE f_products SET image_url = $1 WHERE id = $2 RETURNING *", [url, req.params.id]);
  if (!r.rows[0]) return bad(res, "المنتج غير موجود.", 404);
  res.json(r.rows[0]);
});
router.delete("/products/:id/image", edit, async (req, res) => {
  await query("UPDATE f_products SET image_url = NULL WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});

// المواد الخام اللي بتصرفها الكرتونة
router.put("/products/:id/recipe", edit, async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  await query("DELETE FROM f_recipes WHERE product_id = $1", [req.params.id]);
  for (const it of items) {
    const q = Number(it.qty);
    if (it.material_id && q > 0) await query("INSERT INTO f_recipes (product_id, material_id, qty_per_carton) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [req.params.id, it.material_id, q]);
  }
  res.json({ ok: true });
});

// ---------- قواعد البونص ----------
function cleanBonus(b) {
  const every = Math.round(Number(b.every_qty)), bonus = Math.round(Number(b.bonus_qty));
  if (!(every > 0) || !(bonus > 0)) throw new Error("اكتب «كل كم كرتونة» و«كم بونص».");
  return { name: str(b.name, 100), product_id: b.product_id ? Number(b.product_id) : null, customer_id: b.customer_id ? Number(b.customer_id) : null, every_qty: every, bonus_qty: bonus, active: b.active !== false };
}
router.post("/bonus-rules", edit, async (req, res) => {
  let x; try { x = cleanBonus(req.body || {}); } catch (e) { return bad(res, e.message); }
  const r = await query("INSERT INTO f_bonus_rules (name, product_id, customer_id, every_qty, bonus_qty, active) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *", [x.name, x.product_id, x.customer_id, x.every_qty, x.bonus_qty, x.active]);
  await logActivity({ userId: req.user.id, action: "F_BONUS_RULE", recordType: "f_bonus", recordId: r.rows[0].id, newValue: x });
  res.status(201).json(r.rows[0]);
});
router.put("/bonus-rules/:id", edit, async (req, res) => {
  let x; try { x = cleanBonus(req.body || {}); } catch (e) { return bad(res, e.message); }
  const r = await query("UPDATE f_bonus_rules SET name=$1, product_id=$2, customer_id=$3, every_qty=$4, bonus_qty=$5, active=$6 WHERE id=$7 RETURNING *", [x.name, x.product_id, x.customer_id, x.every_qty, x.bonus_qty, x.active, req.params.id]);
  res.json(r.rows[0]);
});
router.delete("/bonus-rules/:id", edit, async (req, res) => {
  await query("DELETE FROM f_bonus_rules WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});

// ---------- السيارات ----------
function cleanVehicle(b) {
  const name = str(b.name, 60);
  if (!name) throw new Error("اكتب اسم أو رقم السيارة.");
  const capacity = int(b.capacity, 700);
  if (capacity <= 0) throw new Error("الحمولة لازم تكون أكبر من صفر.");
  const status = ["active", "workshop", "inactive"].includes(b.status) ? b.status : "active";
  const d = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || "") ? v : null);
  return { name, plate: str(b.plate, 30), capacity, driver_id: b.driver_id ? Number(b.driver_id) : null, governorate: str(b.governorate, 60), status, license_expires: d(b.license_expires), insurance_expires: d(b.insurance_expires) };
}
router.post("/vehicles", edit, async (req, res) => {
  let v; try { v = cleanVehicle(req.body || {}); } catch (e) { return bad(res, e.message); }
  const r = await query(
    "INSERT INTO f_vehicles (name, plate, capacity, driver_id, governorate, status, license_expires, insurance_expires) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
    [v.name, v.plate, v.capacity, v.driver_id, v.governorate, v.status, v.license_expires, v.insurance_expires]
  );
  await checkVehicleDocs();
  res.status(201).json(r.rows[0]);
});
router.put("/vehicles/:id", edit, async (req, res) => {
  let v; try { v = cleanVehicle(req.body || {}); } catch (e) { return bad(res, e.message); }
  const before = (await query("SELECT to_char(license_expires, 'YYYY-MM-DD') AS license_expires, to_char(insurance_expires, 'YYYY-MM-DD') AS insurance_expires FROM f_vehicles WHERE id = $1", [req.params.id])).rows[0];
  const r = await query(
    "UPDATE f_vehicles SET name=$1, plate=$2, capacity=$3, driver_id=$4, governorate=$5, status=$6, license_expires=$7, insurance_expires=$8 WHERE id=$9 RETURNING *",
    [v.name, v.plate, v.capacity, v.driver_id, v.governorate, v.status, v.license_expires, v.insurance_expires, req.params.id]
  );
  if (!r.rows[0]) return bad(res, "السيارة غير موجودة.", 404);
  // تجدد الترخيص أو التأمين: التنبيهات القديمة بتتسكّر
  const ds = (x) => x || null;
  if (ds(before?.license_expires) !== v.license_expires) await query("UPDATE f_alerts SET closed_at = now(), closed_by = $2 WHERE kind LIKE 'license%' AND ref_id = $1 AND closed_at IS NULL", [r.rows[0].id, req.user.id]);
  if (ds(before?.insurance_expires) !== v.insurance_expires) await query("UPDATE f_alerts SET closed_at = now(), closed_by = $2 WHERE kind LIKE 'insurance%' AND ref_id = $1 AND closed_at IS NULL", [r.rows[0].id, req.user.id]);
  await checkVehicleDocs();
  res.json(r.rows[0]);
});

// ---------- الخطوط ----------
function cleanLine(b) {
  const name = str(b.name, 100);
  if (!name) throw new Error("اكتب اسم الخط.");
  const days = Array.isArray(b.days) ? b.days.filter((d) => d >= 0 && d <= 6).join(",") : str(b.days, 20);
  return { name, governorate: str(b.governorate, 60), vehicle_id: b.vehicle_id ? Number(b.vehicle_id) : null, days: days || null };
}
router.post("/lines", edit, async (req, res) => {
  let l; try { l = cleanLine(req.body || {}); } catch (e) { return bad(res, e.message); }
  const r = await query("INSERT INTO f_lines (name, governorate, vehicle_id, days) VALUES ($1,$2,$3,$4) RETURNING *", [l.name, l.governorate, l.vehicle_id, l.days]);
  res.status(201).json(r.rows[0]);
});
router.put("/lines/:id", edit, async (req, res) => {
  let l; try { l = cleanLine(req.body || {}); } catch (e) { return bad(res, e.message); }
  const r = await query("UPDATE f_lines SET name=$1, governorate=$2, vehicle_id=$3, days=$4 WHERE id=$5 RETURNING *", [l.name, l.governorate, l.vehicle_id, l.days, req.params.id]);
  if (!r.rows[0]) return bad(res, "الخط غير موجود.", 404);
  res.json(r.rows[0]);
});
router.delete("/lines/:id", edit, async (req, res) => {
  await query("UPDATE f_lines SET active = false WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});

// ---------- المكنات والمواد الخام ----------
router.post("/machines", edit, async (req, res) => {
  const name = str(req.body?.name, 80);
  if (!name) return bad(res, "اكتب اسم الماكنة.");
  const r = await query("INSERT INTO f_machines (name) VALUES ($1) RETURNING *", [name]);
  res.status(201).json(r.rows[0]);
});
router.put("/machines/:id", edit, async (req, res) => {
  const name = str(req.body?.name, 80);
  if (!name) return bad(res, "اكتب اسم الماكنة.");
  const r = await query("UPDATE f_machines SET name = $1, active = $2 WHERE id = $3 RETURNING *", [name, req.body?.active !== false, req.params.id]);
  res.json(r.rows[0]);
});
router.post("/materials", edit, async (req, res) => {
  const name = str(req.body?.name, 80);
  if (!name) return bad(res, "اكتب اسم المادة.");
  const r = await query("INSERT INTO f_materials (name, unit, min_level) VALUES ($1,$2,$3) RETURNING *", [name, str(req.body?.unit, 20) || "حبة", Number(req.body?.min_level) || 0]);
  res.status(201).json(r.rows[0]);
});
router.put("/materials/:id", edit, async (req, res) => {
  const name = str(req.body?.name, 80);
  if (!name) return bad(res, "اكتب اسم المادة.");
  const r = await query("UPDATE f_materials SET name=$1, unit=$2, min_level=$3, active=$4 WHERE id=$5 RETURNING *", [name, str(req.body?.unit, 20) || "حبة", Number(req.body?.min_level) || 0, req.body?.active !== false, req.params.id]);
  res.json(r.rows[0]);
});

// ---------- هوية المصنع وموقعه ----------
router.put("/settings", edit, async (req, res) => {
  const b = req.body || {};
  const set = async (k, v) => {
    if (v === undefined) return;
    if (v === null || v === "") await query("DELETE FROM app_settings WHERE key = $1", [k]);
    else await query("INSERT INTO app_settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = $2", [k, String(v)]);
  };
  await set("brand_name", b.brand_name !== undefined ? str(b.brand_name, 150) : undefined);
  await set("brand_phone", b.brand_phone !== undefined ? str(b.brand_phone, 30) : undefined);
  await set("brand_tagline", b.brand_tagline !== undefined ? str(b.brand_tagline, 150) : undefined);
  await set("factory_city", b.factory_city !== undefined ? str(b.factory_city, 60) : undefined);
  if (b.lat === "" || b.lat === null) {
    await set("shop_latitude", null);
    await set("shop_longitude", null);
  } else if (b.lat !== undefined && b.lng !== undefined) {
    const lat = Number(b.lat), lng = Number(b.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return bad(res, "الموقع غير صحيح.");
    await set("shop_latitude", lat);
    await set("shop_longitude", lng);
  }
  if (b.ss_employee_rate !== undefined) {
    const r = Number(b.ss_employee_rate);
    if (!Number.isFinite(r) || r <= 0 || r >= 50) return bad(res, "نسبة الضمان غير صحيحة.");
    await set("ss_employee_rate", round2(r));
  }
  if (b.setup_done !== undefined) await set("f_setup_done", b.setup_done ? "1" : null);
  await logActivity({ userId: req.user.id, action: "F_UPDATE_SETTINGS", recordType: "settings", recordId: null, newValue: b });
  res.json({ ok: true, brand: await brand() });
});

router.post("/settings/logo", edit, uploadSingleImage, async (req, res) => {
  if (!req.file) return bad(res, "اختار صورة الشعار.");
  const url = await saveCompressedImage(req.file.buffer, "logo");
  await query("INSERT INTO app_settings (key, value) VALUES ('brand_logo', $1) ON CONFLICT (key) DO UPDATE SET value = $1", [url]);
  res.json({ ok: true, brand: await brand() });
});

// أيقونة التطبيق (مربعة) للشاشة الرئيسية
router.post("/settings/icon", edit, uploadSingleImage, async (req, res) => {
  if (!req.file) return bad(res, "اختار صورة الأيقونة.");
  const url = await saveCompressedImage(req.file.buffer, "icon");
  await query("INSERT INTO app_settings (key, value) VALUES ('brand_icon', $1) ON CONFLICT (key) DO UPDATE SET value = $1", [url]);
  res.json({ ok: true, brand: await brand() });
});

// رفع صورة (عداد، ديزل، فاتورة، تالف...) — أي موظف بالمصنع
router.post("/upload", uploadSingleImage, async (req, res) => {
  if (!req.file) return bad(res, "ما وصلت الصورة.");
  const url = await saveCompressedImage(req.file.buffer, String(req.query.kind || "f").replace(/[^a-z_]/g, "").slice(0, 20) || "f");
  res.json({ url });
});

export default router;
