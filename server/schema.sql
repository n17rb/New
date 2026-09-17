-- ============================================================
-- نظام إدارة محل مياه وتوزيع — Database Schema
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
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('super_admin', 'admin', 'driver', 'data_entry'));

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
