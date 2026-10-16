-- ============================================================
-- نظام إدارة محل مياه وتوزيع — Database Schema
-- Phase 1: Foundation (Users, Customers, Products, Regions, Log)
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(100) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name VARCHAR(150) NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('super_admin', 'admin', 'driver', 'data_entry')),
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  can_discount BOOLEAN NOT NULL DEFAULT false,
  can_delete_customer BOOLEAN NOT NULL DEFAULT false,
  can_edit_product_price BOOLEAN NOT NULL DEFAULT false,
  can_cancel_order BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('super_admin', 'admin', 'driver', 'data_entry', 'viewer', 'staff'));

UPDATE users SET role = 'super_admin'
WHERE id = (SELECT MIN(id) FROM users)
  AND NOT EXISTS (SELECT 1 FROM users WHERE role = 'super_admin');

CREATE TABLE IF NOT EXISTS regions (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) UNIQUE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS customers (
  id SERIAL PRIMARY KEY,
  sequential_number VARCHAR(20) UNIQUE NOT NULL,
  name VARCHAR(150) NOT NULL,
  phone_normalized VARCHAR(20) UNIQUE NOT NULL,
  phone_display VARCHAR(30) NOT NULL,
  phone_alt VARCHAR(30),
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE customers ALTER COLUMN sequential_number TYPE VARCHAR(20);

CREATE SEQUENCE IF NOT EXISTS customer_seq START 1;

CREATE TABLE IF NOT EXISTS customer_locations (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  maps_url TEXT,
  region_id INTEGER REFERENCES regions(id),
  street VARCHAR(150),
  building_number VARCHAR(30),
  building_name VARCHAR(100),
  floor VARCHAR(30),
  apartment VARCHAR(30),
  side VARCHAR(30),
  access_notes TEXT,
  building_photo_url TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  type VARCHAR(30) NOT NULL DEFAULT 'standard',
  unit_price NUMERIC(10,2) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS activity_log (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  action VARCHAR(100) NOT NULL,
  record_type VARCHAR(50) NOT NULL,
  record_id INTEGER,
  old_value JSONB,
  new_value JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone_normalized);
CREATE INDEX IF NOT EXISTS idx_customers_phone_display_pattern ON customers(phone_display text_pattern_ops);
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name);
CREATE INDEX IF NOT EXISTS idx_customers_seq ON customers(sequential_number);
CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);
CREATE INDEX IF NOT EXISTS idx_activity_log_record ON activity_log(record_type, record_id);

DELETE FROM products a USING products b
WHERE a.id > b.id AND a.name = b.name;

CREATE UNIQUE INDEX IF NOT EXISTS idx_products_name_unique ON products(name);

INSERT INTO products (name, type, unit_price, sort_order) VALUES
  ('قارورة 19 لتر (تعبئة)', 'standard', 1.00, 1),
  ('قارورة 10 لتر (تعبئة)', 'standard', 0.75, 2),
  ('شرنك كبير', 'standard', 1.10, 3),
  ('شرنك وسط', 'standard', 1.35, 4),
  ('شرنك بيبي', 'standard', 1.60, 5),
  ('قارورة 19 لتر جديدة + معبأة', 'standard', 4.00, 6),
  ('قارورة 10 لتر جديدة + معبأة', 'standard', 3.00, 7),
  ('كرتون مياه 250 مل', 'standard', 1.60, 8),
  ('كرتون مياه 200 مل', 'standard', 1.35, 9),
  ('كوبون 10', 'coupon', 10.00, 10),
  ('كوبون 27', 'coupon', 25.00, 11),
  ('كوبون 55', 'coupon', 50.00, 12)
ON CONFLICT (name) DO NOTHING;

CREATE SEQUENCE IF NOT EXISTS order_seq START 1;

CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  order_number VARCHAR(10) UNIQUE NOT NULL,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  status VARCHAR(20) NOT NULL DEFAULT 'NEW'
    CHECK (status IN ('NEW','READY','IN_ROUTE','DELIVERED','CANCELLED','FAILED','POSTPONED')),
  priority VARCHAR(10) NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal','urgent')),
  subtotal NUMERIC(10,2) NOT NULL DEFAULT 0,
  discount_type VARCHAR(10) CHECK (discount_type IN ('amount','percent')),
  discount_value NUMERIC(10,2) DEFAULT 0,
  discount_by INTEGER REFERENCES users(id),
  discount_reason TEXT,
  final_total NUMERIC(10,2) NOT NULL DEFAULT 0,
  notes TEXT,
  cancelled_reason TEXT,
  failed_reason TEXT,
  postponed_to TIMESTAMPTZ,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_items (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id),
  product_name_snapshot VARCHAR(150) NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_snapshot NUMERIC(10,2) NOT NULL,
  line_total NUMERIC(10,2) NOT NULL
);

CREATE TABLE IF NOT EXISTS order_edit_history (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  edited_by INTEGER REFERENCES users(id),
  edited_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  old_snapshot JSONB,
  new_snapshot JSONB,
  diff_summary TEXT
);

CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

CREATE TABLE IF NOT EXISTS trips (
  id SERIAL PRIMARY KEY,
  status VARCHAR(20) NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED','STARTED','COMPLETED')),
  driver_id INTEGER REFERENCES users(id),
  start_latitude DOUBLE PRECISION,
  start_longitude DOUBLE PRECISION,
  total_distance_km NUMERIC(10,2),
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS trip_stops (
  id SERIAL PRIMARY KEY,
  trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  sequence_number INTEGER NOT NULL,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trip_stops_trip ON trip_stops(trip_id, sequence_number);
CREATE INDEX IF NOT EXISTS idx_trips_status ON trips(status);

ALTER TABLE trips ADD COLUMN IF NOT EXISTS current_latitude DOUBLE PRECISION;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS current_longitude DOUBLE PRECISION;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS location_updated_at TIMESTAMPTZ;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS route_geometry JSONB;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS distance_before_km NUMERIC(10,2);

CREATE TABLE IF NOT EXISTS driver_ledger (
  id SERIAL PRIMARY KEY,
  driver_id INTEGER NOT NULL REFERENCES users(id),
  trip_id INTEGER REFERENCES trips(id),
  entry_type VARCHAR(20) NOT NULL CHECK (entry_type IN ('trip_due','settlement')),
  amount NUMERIC(10,2) NOT NULL,
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_driver_ledger_driver ON driver_ledger(driver_id, created_at DESC);

CREATE TABLE IF NOT EXISTS trip_inventory (
  id SERIAL PRIMARY KEY,
  trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id),
  product_name_snapshot VARCHAR(150) NOT NULL,
  loaded_quantity INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_trip_inventory_trip ON trip_inventory(trip_id);

CREATE TABLE IF NOT EXISTS cash_periods (
  id SERIAL PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  closed_by INTEGER REFERENCES users(id),
  final_sales NUMERIC(10,2),
  final_expenses NUMERIC(10,2),
  final_cash NUMERIC(10,2)
);

CREATE TABLE IF NOT EXISTS cash_entries (
  id SERIAL PRIMARY KEY,
  period_id INTEGER NOT NULL REFERENCES cash_periods(id),
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  sales_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  expense_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_entries_period_date ON cash_entries(period_id, entry_date);
CREATE INDEX IF NOT EXISTS idx_cash_periods_open ON cash_periods(ended_at);

ALTER TABLE customer_locations ADD COLUMN IF NOT EXISTS preferred_delivery_note TEXT;

CREATE TABLE IF NOT EXISTS customer_product_prices (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  custom_price NUMERIC(10,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_product_price ON customer_product_prices(customer_id, product_id);

CREATE TABLE IF NOT EXISTS backup_snapshots (
  id SERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  data JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_backup_snapshots_created ON backup_snapshots(created_at DESC);

ALTER TABLE trip_stops ADD COLUMN IF NOT EXISTS leg_distance_km NUMERIC(10,3);

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  type VARCHAR(50) NOT NULL,
  message TEXT NOT NULL,
  related_customer_id INTEGER REFERENCES customers(id),
  related_trip_id INTEGER REFERENCES trips(id),
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC);

CREATE TABLE IF NOT EXISTS customer_reminders (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  days_of_week INTEGER[] NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_customer_reminders_customer ON customer_reminders(customer_id);
CREATE TABLE IF NOT EXISTS reminder_fired_log (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  fired_date DATE NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_reminder_fired_unique ON reminder_fired_log(customer_id, fired_date);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS requested_time TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS personal_notes (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_personal_notes_user ON personal_notes(user_id, created_at DESC);

-- ============================================================
-- Phase 10: نظام الكوبونات الكامل
-- ============================================================
ALTER TABLE products ADD COLUMN IF NOT EXISTS coupon_eligible BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE products ADD COLUMN IF NOT EXISTS grants_coupons INTEGER;

UPDATE products SET coupon_eligible = true WHERE name IN ('قارورة 19 لتر (تعبئة)', 'قارورة 10 لتر (تعبئة)');
UPDATE products SET grants_coupons = 10 WHERE name = 'كوبون 10';
UPDATE products SET grants_coupons = 27 WHERE name = 'كوبون 27';
UPDATE products SET grants_coupons = 55 WHERE name = 'كوبون 55';

ALTER TABLE customers ADD COLUMN IF NOT EXISTS coupon_balance INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS coupon_ledger (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  change_amount INTEGER NOT NULL,
  reason VARCHAR(30) NOT NULL CHECK (reason IN ('recharge','order_payment','manual_adjustment')),
  order_id INTEGER REFERENCES orders(id),
  balance_after INTEGER NOT NULL,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_coupon_ledger_customer ON coupon_ledger(customer_id, created_at DESC);

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS coupon_quantity INTEGER NOT NULL DEFAULT 0;
ALTER TABLE trip_stops ADD COLUMN IF NOT EXISTS cash_collected NUMERIC(10,2);
ALTER TABLE trip_stops ADD COLUMN IF NOT EXISTS coupons_collected INTEGER NOT NULL DEFAULT 0;
ALTER TABLE driver_ledger ADD COLUMN IF NOT EXISTS coupons_redeemed INTEGER NOT NULL DEFAULT 0;

-- إشعارات موجّهة لمستخدم معيّن (مثلاً سائق الرحلة). NULL = إشعار عام للإدارة
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS target_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_notifications_target ON notifications(target_user_id, created_at DESC);

-- اشتراكات إشعارات الجهاز (Web Push) — كل جهاز/متصفح إله اشتراك
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);

-- إعدادات عامة للتطبيق (مثل مفاتيح الإشعارات)
CREATE TABLE IF NOT EXISTS app_settings (
  key VARCHAR(100) PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- نوع القوارير اللي بتنزل للزبون: new = قوارير جديدة، used = قوارير مستعملة
ALTER TABLE customers ADD COLUMN IF NOT EXISTS bottle_type VARCHAR(10);
ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_bottle_type_check;
ALTER TABLE customers ADD CONSTRAINT customers_bottle_type_check CHECK (bottle_type IS NULL OR bottle_type IN ('new','used'));

-- المسار بيخلص بالرجوع للمحل: مسافة آخر طلب ← المحل
ALTER TABLE trips ADD COLUMN IF NOT EXISTS return_leg_km NUMERIC(10,3);
ALTER TABLE trips ADD COLUMN IF NOT EXISTS end_latitude DOUBLE PRECISION;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS end_longitude DOUBLE PRECISION;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS route_mode VARCHAR(20);
-- التوقف اللي أجّله السائق بيضل بآخر الرحلة حتى لو انعاد ترتيب المسار
ALTER TABLE trip_stops ADD COLUMN IF NOT EXISTS postponed_at TIMESTAMPTZ;

-- طلبات بتنضاف لحالها لزباين المواعيد الثابتة — الكمية بيحددها المحل بعدين
ALTER TABLE orders ADD COLUMN IF NOT EXISTS auto_from_reminder BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS needs_quantity BOOLEAN NOT NULL DEFAULT false;

-- صلاحيات مفصّلة لكل مستخدم: {"sections": {"orders": "edit", ...}, "actions": {"discount": true, ...}}
-- NULL = الحساب قديم، صلاحياته منطلعها من الدور
ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions JSONB;

-- ============================================================
-- ديون العملاء (ذمم): الموجب = الزبون مديون للمحل
-- ============================================================
ALTER TABLE customers ADD COLUMN IF NOT EXISTS debt_balance NUMERIC(10,2) NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS customer_debt_ledger (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  change_amount NUMERIC(10,2) NOT NULL,
  reason VARCHAR(30) NOT NULL CHECK (reason IN ('order_credit','payment','manual','coupon_package','delivery_undo')),
  order_id INTEGER REFERENCES orders(id),
  trip_id INTEGER REFERENCES trips(id),
  balance_after NUMERIC(10,2) NOT NULL,
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_debt_ledger_customer ON customer_debt_ledger(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customers_debt ON customers(debt_balance) WHERE debt_balance <> 0;

-- ============================================================
-- باقات الكوبونات (بصورة وسعر) ومبيعاتها
-- ============================================================
ALTER TABLE coupon_ledger DROP CONSTRAINT IF EXISTS coupon_ledger_reason_check;
ALTER TABLE coupon_ledger ADD CONSTRAINT coupon_ledger_reason_check
  CHECK (reason IN ('recharge','order_payment','manual_adjustment','package_purchase','delivery_undo'));
ALTER TABLE coupon_ledger ADD COLUMN IF NOT EXISTS notes TEXT;

CREATE TABLE IF NOT EXISTS coupon_packages (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  coupons INTEGER NOT NULL CHECK (coupons > 0),
  bonus_coupons INTEGER NOT NULL DEFAULT 0 CHECK (bonus_coupons >= 0),
  price NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  image_url TEXT,
  description TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS coupon_sales (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  package_id INTEGER REFERENCES coupon_packages(id),
  package_name_snapshot VARCHAR(100) NOT NULL,
  coupons INTEGER NOT NULL,
  price NUMERIC(10,2) NOT NULL,
  paid_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  sold_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_coupon_sales_created ON coupon_sales(created_at DESC);

-- ============================================================
-- القوارير اللي عند الزبون (قوارير المحل) + الفوارغ
-- ============================================================
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_returnable BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS bottles_out INTEGER NOT NULL DEFAULT 0;

ALTER TABLE trip_stops ADD COLUMN IF NOT EXISTS amount_due NUMERIC(10,2);
ALTER TABLE trip_stops ADD COLUMN IF NOT EXISTS debt_added NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE trip_stops ADD COLUMN IF NOT EXISTS debt_paid NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE trip_stops ADD COLUMN IF NOT EXISTS returnable_delivered INTEGER NOT NULL DEFAULT 0;
ALTER TABLE trip_stops ADD COLUMN IF NOT EXISTS empties_collected INTEGER NOT NULL DEFAULT 0;

-- حمولة السيارة: trip_inventory موجود — منضيف وقت التحميل
ALTER TABLE trip_inventory ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE UNIQUE INDEX IF NOT EXISTS idx_trip_inventory_trip_product ON trip_inventory(trip_id, product_id);

-- ============================================================
-- شات الموظفين مع الإدارة — محادثة وحدة لكل موظف
-- ============================================================
CREATE TABLE IF NOT EXISTS staff_messages (
  id SERIAL PRIMARY KEY,
  thread_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body TEXT,
  image_url TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (body IS NOT NULL OR image_url IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_staff_messages_thread ON staff_messages(thread_user_id, id DESC);

-- أول مرة: منتجات التعبئة (اللي بتقبل كوبون) هي قوارير بترجع فاضية — المدير بيقدر يغيّرها من المنتجات
UPDATE products SET is_returnable = true
WHERE coupon_eligible = true
  AND NOT EXISTS (SELECT 1 FROM app_settings WHERE key = 'returnable_init');
INSERT INTO app_settings (key, value) VALUES ('returnable_init', 'done') ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- توقعات الطلبات: النظام بيتعلم كم بيسحب كل زبون ومتى مفروض يطلب
-- ============================================================
ALTER TABLE customers ADD COLUMN IF NOT EXISTS forecast_disabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS forecast_snooze_until DATE;
-- كل تنبيه (اليوم/متأخر) بينبعت مرة وحدة بس لكل موعد متوقع
CREATE TABLE IF NOT EXISTS forecast_alerts (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  due_date DATE NOT NULL,
  kind VARCHAR(10) NOT NULL CHECK (kind IN ('today','late')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_forecast_alerts_unique ON forecast_alerts(customer_id, due_date, kind);
CREATE INDEX IF NOT EXISTS idx_orders_customer_status_created ON orders(customer_id, status, created_at);
-- أول مرة: منصفّر قائمة المتأخرين القديمة — من هون وطالع بس اللي بيتأخر بيطلع وبيوصل عنه إشعار
INSERT INTO app_settings (key, value)
SELECT 'forecast_reset_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
WHERE NOT EXISTS (SELECT 1 FROM app_settings WHERE key = 'forecast_init')
ON CONFLICT (key) DO NOTHING;
INSERT INTO app_settings (key, value) VALUES ('forecast_init', 'done') ON CONFLICT (key) DO NOTHING;
-- يوسف طلب (١٢ أكتوبر ٢٠٢٦): التوقعات تتعلم من جديد — طلبات التجربة القديمة ما بتنحسب
INSERT INTO app_settings (key, value)
SELECT 'forecast_learn_from', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
WHERE NOT EXISTS (SELECT 1 FROM app_settings WHERE key = 'forecast_learn_init')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
INSERT INTO app_settings (key, value) VALUES ('forecast_learn_init', 'done') ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- الموظفين والرواتب والدوام
-- ============================================================
CREATE TABLE IF NOT EXISTS employees (
  id SERIAL PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  phone VARCHAR(30),
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  job_title VARCHAR(80),
  pay_type VARCHAR(10) NOT NULL DEFAULT 'daily' CHECK (pay_type IN ('daily','monthly')),
  pay_amount NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (pay_amount >= 0),
  deduct_absence BOOLEAN NOT NULL DEFAULT true,
  start_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','left')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_user ON employees(user_id) WHERE user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS attendance (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  work_date DATE NOT NULL,
  status VARCHAR(10) NOT NULL CHECK (status IN ('present','half','absent','off')),
  check_in_at TIMESTAMPTZ,
  note TEXT,
  recorded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_emp_date ON attendance(employee_id, work_date);

-- سحب/سلفة، مكافأة، خصم، صرف راتب
CREATE TABLE IF NOT EXISTS employee_transactions (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  kind VARCHAR(15) NOT NULL CHECK (kind IN ('advance','bonus','deduction','payment')),
  amount NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  note TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_emp_tx ON employee_transactions(employee_id, entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_emp_tx_date ON employee_transactions(entry_date);

-- فواتير الطلبات: رابط عام للزبون (بدون تسجيل دخول)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS invoice_token VARCHAR(40);
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_invoice_token ON orders(invoice_token) WHERE invoice_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_debt_ledger_created ON customer_debt_ledger(created_at);

-- ============================================================
-- الطلبات بموعد: يوم محدد (وساعة اختيارية)
-- ============================================================
ALTER TABLE orders ADD COLUMN IF NOT EXISTS scheduled_date DATE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS schedule_reminded_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS schedule_morning_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_orders_scheduled ON orders(scheduled_date) WHERE scheduled_date IS NOT NULL;
-- الطلبات القديمة اللي إلها ساعة محددة: يومها نفس يوم الساعة
UPDATE orders SET scheduled_date = (requested_time AT TIME ZONE 'Asia/Amman')::date
WHERE requested_time IS NOT NULL AND scheduled_date IS NULL;

-- وقت السواقة الحقيقي لكل مرحلة (من خرائط الطرق) — لحساب وقت الوصول بدقة
ALTER TABLE trip_stops ADD COLUMN IF NOT EXISTS leg_minutes NUMERIC(8,2);
ALTER TABLE trips ADD COLUMN IF NOT EXISTS total_minutes NUMERIC(8,1);

-- ============================================================
-- عهدة القوارير: قوارير المحل اللي عند كل زبون (رأس مال)
-- ============================================================
CREATE TABLE IF NOT EXISTS bottle_ledger (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  change INTEGER NOT NULL,
  reason VARCHAR(20) NOT NULL CHECK (reason IN ('lend','return','delivery','empties','adjust','undo')),
  balance_after INTEGER NOT NULL,
  order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  trip_id INTEGER REFERENCES trips(id) ON DELETE SET NULL,
  note TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bottle_ledger_customer ON bottle_ledger(customer_id, id DESC);
-- عهدة متفق عليها (كم قارورة المحل مموّلهم) — للمقارنة مع اللي عندهم فعلًا
ALTER TABLE customers ADD COLUMN IF NOT EXISTS bottles_agreed INTEGER NOT NULL DEFAULT 0;

-- ============================================================
-- الحساب اليومي: عدد القوارير المباعة (بالمحل + توصيل) وقراءة عداد المي
-- ============================================================
ALTER TABLE cash_entries ADD COLUMN IF NOT EXISTS meter_reading NUMERIC(14,3);
ALTER TABLE cash_entries ADD COLUMN IF NOT EXISTS bottles_total INTEGER;
ALTER TABLE cash_entries ADD COLUMN IF NOT EXISTS bottles_delivery INTEGER;
CREATE INDEX IF NOT EXISTS idx_cash_entries_date ON cash_entries(entry_date);

-- ============================================================
-- أرشيف الرحلات: مسار الكابتن الفعلي (نقطة كل ما يبعت موقعه)
-- ============================================================
CREATE TABLE IF NOT EXISTS trip_track (
  id BIGSERIAL PRIMARY KEY,
  trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_trip_track_trip ON trip_track(trip_id, id);

-- ============================================================
-- الأرقام التسلسلية للزباين: المحل الأصلي بيكمل من ١٨٢، وباقي المحلات من ١
-- ============================================================
DO $$
BEGIN
  IF current_schema() = 'public' THEN
    INSERT INTO app_settings (key, value) VALUES ('seq_start', '182') ON CONFLICT (key) DO NOTHING;
  END IF;
END $$;
