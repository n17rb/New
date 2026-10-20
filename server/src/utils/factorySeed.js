import { query } from "../db.js";
import { FACTORY_TEMPLATES } from "../permissions.js";
import { cityPoint } from "./factoryGeo.js";

// ============================================================
// باقة المصانع: تجهيز مصنع جديد.
// بدون داتا تجريبية: المصنع بيبلش فاضي ومعالج البداية بيمشّيه خطوة بخطوة.
// مع داتا تجريبية: منتجات وسيارات وسائقين وزباين وطلبات جاهزة للتجربة فورًا.
// ============================================================

export async function seedFactoryBasics({ sample = false, ownerUsername, passwordHash, tenantName = "" }) {
  await query(
    "INSERT INTO app_settings (key, value) VALUES ('ss_employee_rate', '7.5') ON CONFLICT (key) DO NOTHING"
  );
  // شعار مصنع المهدي جاهز بالتطبيق
  if (/المهدي/.test(tenantName)) {
    await query("INSERT INTO app_settings (key, value) VALUES ('brand_logo', '/brands/al-mahdi.png'), ('brand_tagline', 'للمياه الصحية') ON CONFLICT (key) DO NOTHING");
  }
  if (!sample) return [];

  await query(
    `INSERT INTO app_settings (key, value) VALUES ('shop_latitude', '31.8722'), ('shop_longitude', '36.0047'), ('factory_city', 'سحاب')
     ON CONFLICT (key) DO NOTHING`
  );

  // المنتجات
  const P = {};
  for (const [key, name, per, price, min, sort] of [
    ["p250", "شرنك 250 مل", 24, 1.2, 300, 1],
    ["p600", "شرنك 600 مل", 20, 1.5, 400, 2],
    ["p1500", "شرنك 1500 مل", 6, 1.8, 200, 3],
    ["k1", "كاس رقم 1", 48, 1.1, 300, 4],
    ["k2", "كاس رقم 2", 48, 1.3, 300, 5],
  ]) {
    P[key] = (await query("INSERT INTO f_products (name, per_carton, price, min_stock, sort_order) VALUES ($1,$2,$3,$4,$5) RETURNING id", [name, per, price, min, sort])).rows[0].id;
  }

  for (const n of ["ماكنة الكاسات", "ماكنة الشرنك 600", "ماكنة الشرنك 250 و1500"]) {
    await query("INSERT INTO f_machines (name) VALUES ($1)", [n]);
  }

  // الموظفين التجريبيين (نفس كلمة سر المدير)
  const users = [];
  const mkUser = async (suffix, name, role, tpl) => {
    const username = `${ownerUsername}_${suffix}`.slice(0, 40);
    const r = await query(
      "INSERT INTO users (username, password_hash, full_name, role, status, permissions) VALUES ($1,$2,$3,$4,'active',$5) RETURNING id",
      [username, passwordHash, name, role, JSON.stringify({ sections: FACTORY_TEMPLATES[tpl].sections, actions: FACTORY_TEMPLATES[tpl].actions })]
    );
    users.push({ username, name, job: FACTORY_TEMPLATES[tpl].label });
    return r.rows[0].id;
  };
  const ahmad = await mkUser("ahmad", "أحمد", "driver", "driver");
  const khaled = await mkUser("khaled", "خالد", "driver", "driver");
  const yazan = await mkUser("yazan", "يزن", "driver", "driver");
  const fadi = await mkUser("fadi", "فادي", "driver", "driver");
  const move = await mkUser("move", "زياد (الحركة)", "staff", "dispatcher");
  const store = await mkUser("store", "منير (المستودع)", "staff", "warehouse");
  const acc = await mkUser("acc", "هبة (المحاسبة)", "staff", "accountant");

  // السيارات والخطوط
  const V = {};
  for (const [key, name, gov, cap, drv] of [
    ["c1", "سيارة 1", "عمّان", 700, null],
    ["c2", "سيارة 2", "الزرقاء", 500, null],
    ["c3", "سيارة 3", "الكرك", 500, khaled],
    ["c4", "سيارة 4", "الكرك", 700, yazan],
    ["c5", "سيارة 5", "المفرق", 700, fadi],
    ["c6", "سيارة 6", "إربد", 700, ahmad],
  ]) {
    V[key] = (await query("INSERT INTO f_vehicles (name, capacity, governorate, driver_id) VALUES ($1,$2,$3,$4) RETURNING id", [name, cap, gov, drv])).rows[0].id;
  }
  const L = {};
  for (const [key, name, gov, v, days] of [
    ["irbid", "إربد والرمثا", "إربد", "c6", "0,2,4"],
    ["karak", "الكرك – المركز", "الكرك", "c3", "0,1,2,3,4,6"],
    ["karak2", "الكرك – الجنوب", "الكرك", "c4", "1,3"],
    ["mafraq", "المفرق", "المفرق", "c5", "0,2,4"],
    ["amman", "عمّان والزرقاء", "عمّان", "c1", "0,1,2,3,4,6"],
  ]) {
    L[key] = (await query("INSERT INTO f_lines (name, governorate, vehicle_id, days) VALUES ($1,$2,$3,$4) RETURNING id", [name, gov, V[v], days])).rows[0].id;
  }

  // الزباين
  const C = {};
  const customers = [
    ["ramtha", "بقالة الرمثا الكبرى", "الرمثا", "irbid", "credit", 2000, 900],
    ["turra", "سوبرماركت الطرّة", "الطرّة", "irbid", "credit", 1500, 600],
    ["nour", "مؤسسة النور التجارية", "إربد", "irbid", "credit", 3000, 1240],
    ["mafraq", "أسواق المفرق الحديثة", "المفرق", "mafraq", "credit", 1500, 410],
    ["zarqa", "مطعم الزرقاء الشعبي", "الزرقاء", "amman", "cash", 0, 0],
    ["karak", "بقالة الكرك المركزية", "الكرك", "karak", "credit", 2000, 1530],
    ["madaba", "سوبرماركت مادبا", "مادبا", "amman", "credit", 1000, 275],
    ["amman", "أسواق السلام – عمّان", "عمّان", "amman", "credit", 2500, 0],
  ];
  let k = 0;
  for (const [key, name, city, line, terms, limit, bal] of customers) {
    const pt = cityPoint(city);
    k++;
    C[key] = (await query(
      `INSERT INTO f_customers (name, phone, city, line_id, lat, lng, pay_terms, credit_limit, is_sample, kind, seq_no)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,'سوبرماركت',$9) RETURNING id`,
      [name, `079${String(1000000 + k * 7919).slice(0, 7)}`, city, L[line], pt[0] + 0.004 * k / 3, pt[1] - 0.003 * k / 3, terms, limit, k]
    )).rows[0].id;
    if (bal) {
      await query("UPDATE f_customers SET balance = $1 WHERE id = $2", [bal, C[key]]);
      await query("INSERT INTO f_ledger (customer_id, kind, amount, balance_after, note) VALUES ($1,'opening',$2,$2,'رصيد افتتاحي (تجريبي)')", [C[key], bal]);
    }
  }

  // رصيد المستودع الأول
  for (const [p, q] of [["p250", 900], ["p600", 1600], ["p1500", 700], ["k1", 1100], ["k2", 340]]) {
    await query("INSERT INTO f_stock_moves (product_id, kind, qty, reason, created_at) VALUES ($1,'adjust',$2,'رصيد افتتاحي (تجريبي)', now() - interval '1 day')", [P[p], q]);
  }

  // طلبات جديدة جاهزة للتوزيع
  const order = async (cust, p, q, urgent = false) => {
    const price = (await query("SELECT price FROM f_products WHERE id = $1", [P[p]])).rows[0].price;
    const id = (await query("INSERT INTO f_orders (customer_id, total, urgent) VALUES ($1,$2,$3) RETURNING id", [C[cust], Number(price) * q, urgent])).rows[0].id;
    await query("INSERT INTO f_order_items (order_id, product_id, qty, price) VALUES ($1,$2,$3,$4)", [id, P[p], q, price]);
  };
  await order("ramtha", "p600", 300);
  await order("turra", "p600", 300);
  await order("nour", "k1", 120);
  await order("zarqa", "k2", 80, true);
  await order("karak", "p250", 150);
  await order("mafraq", "p1500", 200);

  // الموظفين والرواتب (مع الضمان)
  for (const [name, job, type, amount, uid, ss] of [
    ["أحمد", "سائق", "monthly", 420, ahmad, true],
    ["خالد", "سائق", "monthly", 420, khaled, true],
    ["يزن", "سائق", "monthly", 400, yazan, true],
    ["فادي", "سائق", "monthly", 400, fadi, true],
    ["زياد", "مسؤول الحركة", "monthly", 480, move, true],
    ["منير", "أمين مستودع", "monthly", 480, store, true],
    ["هبة", "محاسبة", "monthly", 500, acc, true],
    ["أبو سليم", "عامل إنتاج", "daily", 15, null, false],
    ["سعيد", "عامل إنتاج", "daily", 14, null, false],
  ]) {
    await query(
      "INSERT INTO employees (name, job_title, pay_type, pay_amount, user_id, start_date, is_sample, ss_enrolled) VALUES ($1,$2,$3,$4,$5, CURRENT_DATE - 20, true, $6)",
      [name, job, type, amount, uid, ss]
    );
  }

  await query("INSERT INTO f_alerts (level, kind, title, body) VALUES ('info','welcome','أهلاً بنسخة التجربة', 'كل الأسماء والأرقام هون تجريبية. جرّب براحتك.')");
  return users;
}
