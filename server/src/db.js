import pg from "pg";
import dotenv from "dotenv";
import { AsyncLocalStorage } from "node:async_hooks";

dotenv.config();

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error("❌ خطأ: متغير DATABASE_URL غير موجود.");
  process.exit(1);
}

// ============================================================
// موج: كل محل إله «schema» خاص فيه بقاعدة البيانات — نفس الجداول، داتا منفصلة تمامًا.
// المحل الأساسي (جوهرة الرابية) = public. المحلات الجديدة = shop_<id>.
// كل طلب بيشتغل جوّا «سياق محل» (AsyncLocalStorage)، وكل استعلام بيروح لـ schema المحل.
// ============================================================

export const tenantStore = new AsyncLocalStorage();

// اتصال مباشر (مش pooler): إعداد search_path لكل اتصال لازم يضل ثابت على نفس الاتصال
function directUrl(url) {
  if (process.env.DATABASE_DIRECT_URL) return process.env.DATABASE_DIRECT_URL;
  try {
    const u = new URL(url);
    if (u.hostname.includes("-pooler.")) u.hostname = u.hostname.replace("-pooler.", ".");
    return u.toString();
  } catch {
    return url;
  }
}

const rawPool = new Pool({
  connectionString: directUrl(process.env.DATABASE_URL),
  ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
  max: Number(process.env.DATABASE_POOL_MAX) || 12,
});

// كل التواريخ بتوقيت الأردن (CURRENT_DATE و ::date) — بدونها بين 12 و3 الفجر بيحسب اليوم اللي قبل
rawPool.on("connect", (c) => { c.query("SET TIME ZONE 'Asia/Amman'").catch(() => {}); });

const SCHEMA_RE = /^(public|shop_\d+)$/;

export function quoteSchema(schema) {
  if (!SCHEMA_RE.test(schema)) throw new Error(`اسم schema غير صالح: ${schema}`);
  return `"${schema}"`;
}

export function currentSchema() {
  return tenantStore.getStore()?.schema || "public";
}

export function currentTenant() {
  return tenantStore.getStore()?.tenant || null;
}

// بيشغّل دالة جوّا سياق محل معيّن (للمهام المجدولة وإنشاء المحلات)
export function runInTenant(tenant, fn) {
  return tenantStore.run({ schema: tenant.schema_name, tenant }, fn);
}

// بيعيّن المحل للطلب الحالي (من بعد تسجيل الدخول أو التوكن)
export function setRequestTenant(tenant) {
  const store = tenantStore.getStore();
  if (store) {
    store.schema = tenant.schema_name;
    store.tenant = tenant;
  }
}

async function checkout(schema) {
  const client = await rawPool.connect();
  if (client.__schema !== schema) {
    try {
      await client.query(`SET search_path TO ${quoteSchema(schema)}`);
      client.__schema = schema;
    } catch (err) {
      client.release(err);
      throw err;
    }
  }
  return client;
}

export async function query(text, params) {
  const client = await checkout(currentSchema());
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

// نفس واجهة pg.Pool اللي الكود بيستعملها (connect للمعاملات، query)
export const pool = {
  async connect() {
    const client = await checkout(currentSchema());
    let released = false;
    return {
      query: (text, params) => client.query(text, params),
      release: (err) => {
        if (released) return;
        released = true;
        client.release(err);
      },
    };
  },
  query: (text, params) => query(text, params),
  end: () => rawPool.end(),
};

// استعلام على جداول المنصة (platform.*) — مستقل عن المحل
export async function platformQuery(text, params) {
  const client = await rawPool.connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

// بيشغّل SQL كامل (ملف schema) على schema محدد
export async function runSqlInSchema(schema, sql) {
  const client = await rawPool.connect();
  try {
    await client.query(`SET search_path TO ${quoteSchema(schema)}`);
    client.__schema = schema;
    await client.query(sql);
  } finally {
    client.release();
  }
}

export async function logActivity({ userId, action, recordType, recordId, oldValue, newValue }) {
  await query(
    `INSERT INTO activity_log (user_id, action, record_type, record_id, old_value, new_value)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [userId ?? null, action, recordType, recordId ?? null, oldValue ? JSON.stringify(oldValue) : null, newValue ? JSON.stringify(newValue) : null]
  );
}
