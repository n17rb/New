-- ============================================================
-- موج: جداول المنصة (المحلات المشتركة، الاشتراكات، الدفعات، الدعم الفني)
-- بتنشغل مرة عند كل تشغيل للسيرفر — آمنة للتكرار
-- ============================================================
CREATE SCHEMA IF NOT EXISTS platform;

CREATE TABLE IF NOT EXISTS platform.tenants (
  id SERIAL PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  schema_name VARCHAR(63) UNIQUE NOT NULL,
  owner_name VARCHAR(150),
  phone VARCHAR(30),
  city VARCHAR(100),
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  is_demo BOOLEAN NOT NULL DEFAULT false,
  is_home BOOLEAN NOT NULL DEFAULT false,
  monthly_price NUMERIC(10,2) NOT NULL DEFAULT 0,
  subscription_ends_at TIMESTAMPTZ,
  notes TEXT,
  warned_on DATE,
  last_active_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- اسم المستخدم ما بيتكرر بين المحلات — منه منعرف الموظف تبع أي محل
CREATE TABLE IF NOT EXISTS platform.user_directory (
  username VARCHAR(100) PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE
);

-- دفعات الاشتراك (تحويل كليك مع صورة الإيصال)
CREATE TABLE IF NOT EXISTS platform.payments (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  amount NUMERIC(10,2),
  months INTEGER NOT NULL DEFAULT 1 CHECK (months BETWEEN 1 AND 36),
  method VARCHAR(20) NOT NULL DEFAULT 'cliq',
  receipt_url TEXT,
  note TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  submitted_by_name VARCHAR(150),
  review_note TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_platform_payments_status ON platform.payments(status, created_at DESC);

-- سجل التمديدات (مين مدّد وقديش) — للجرد
CREATE TABLE IF NOT EXISTS platform.subscription_log (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  action VARCHAR(30) NOT NULL,
  days INTEGER,
  ends_before TIMESTAMPTZ,
  ends_after TIMESTAMPTZ,
  amount NUMERIC(10,2),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- الدعم الفني: محادثة وحدة لكل محل مع إدارة موج
CREATE TABLE IF NOT EXISTS platform.support_messages (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  from_support BOOLEAN NOT NULL,
  sender_name VARCHAR(150),
  sender_user_id INTEGER,
  body TEXT,
  image_url TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (body IS NOT NULL OR image_url IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_support_tenant ON platform.support_messages(tenant_id, id DESC);

CREATE TABLE IF NOT EXISTS platform.settings (
  key VARCHAR(100) PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO platform.settings (key, value) VALUES
  ('support_name', 'دعم موج'),
  ('cliq_number', '0792376983'),
  ('cliq_name', 'يوسف ابورعيه'),
  ('contact_phone', '0792376983'),
  ('default_monthly_price', '15'),
  ('trial_days', '14')
ON CONFLICT (key) DO NOTHING;

-- المحل الأساسي: مياه جوهرة الرابية — داتا public، اشتراكه ما بيخلص
INSERT INTO platform.tenants (id, name, schema_name, owner_name, phone, is_home, subscription_ends_at)
VALUES (1, 'مياه جوهرة الرابية', 'public', 'يوسف ابورعيه', '0792376983', true, NULL)
ON CONFLICT (id) DO NOTHING;
SELECT setval('platform.tenants_id_seq', GREATEST((SELECT MAX(id) FROM platform.tenants), 1));

-- موظفين المحل الأساسي بدليل أسماء المستخدمين
INSERT INTO platform.user_directory (username, tenant_id)
SELECT lower(username), 1 FROM public.users
ON CONFLICT (username) DO NOTHING;
