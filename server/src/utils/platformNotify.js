import { query, runInTenant, platformQuery } from "../db.js";
import { sendPushToUser } from "./push.js";
import { getTenant, listTenants, tenantAccess } from "./tenants.js";
import { can } from "../permissions.js";

// مدراء المحل (المدير العام + اللي عنده تعديل إعدادات المحل)
async function managerIds() {
  const r = await query(
    `SELECT id, role, permissions, can_discount, can_delete_customer, can_edit_product_price, can_cancel_order
     FROM users WHERE status = 'active'`
  );
  return r.rows.filter((u) => u.role === "super_admin" || can(u, "settings", "edit")).map((u) => u.id);
}

// إشعار لمدراء محل معيّن (بالتطبيق + على الجهاز)
export async function notifyTenantManagers(tenant, { type = "SUBSCRIPTION", message, title = "موج", url = "/subscription" }) {
  if (!tenant) return;
  await runInTenant(tenant, async () => {
    const ids = await managerIds();
    for (const id of ids) {
      await query(
        "INSERT INTO notifications (type, message, target_user_id) VALUES ($1, $2, $3)",
        [type, message, id]
      ).catch(() => {});
      sendPushToUser(id, { title, body: message, url, tag: `${type}-${tenant.id}` }).catch(() => {});
    }
  });
}

// إشعار لإدارة موج (المدير العام للمحل الأساسي)
export async function notifyPlatformAdmins({ message, url = "/platform", title = "إدارة موج" }) {
  const home = await getTenant(1);
  if (!home) return;
  await runInTenant(home, async () => {
    const r = await query("SELECT id FROM users WHERE role = 'super_admin' AND status = 'active'");
    for (const u of r.rows) {
      await query(
        "INSERT INTO notifications (type, message, target_user_id) VALUES ('PLATFORM', $1, $2)",
        [message, u.id]
      ).catch(() => {});
      sendPushToUser(u.id, { title, body: message, url, tag: `platform-${Date.now()}` }).catch(() => {});
    }
  });
}

function jordanDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Amman", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function dateStr(d) {
  if (!d) return null;
  if (d instanceof Date) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  return String(d).slice(0, 10);
}

// تنبيه قبل انتهاء الاشتراك بأسبوع — مرة باليوم لكل محل
export async function checkSubscriptionWarnings() {
  const today = jordanDate();
  const tenants = await listTenants({ includeSuspended: false });
  for (const t of tenants) {
    if (t.is_home || t.is_demo) continue;
    const a = tenantAccess(t);
    if (a.state !== "expiring" && a.state !== "expired") continue;
    if (dateStr(t.warned_on) === today) continue;
    // للمنتهي: منبعت تذكير أول ٣ أيام بس
    if (a.state === "expired") {
      const daysAgo = (Date.now() - new Date(t.subscription_ends_at).getTime()) / 86400000;
      if (daysAgo > 3) continue;
    }
    await platformQuery("UPDATE platform.tenants SET warned_on = $1 WHERE id = $2", [today, t.id]);
    const message = a.state === "expired"
      ? "⛔ انتهى اشتراك موج للمحل. جدّد بتحويل كليك وارفق صورة الإيصال عشان يرجع البرنامج يشتغل."
      : a.days_left <= 1
        ? "⏰ اشتراك موج بيخلص بكرة! جدّد هلّق عشان ما يوقف الشغل."
        : `⏰ اشتراك موج بيخلص بعد ${a.days_left} أيام. جدّد بكبسة من «الاشتراك».`;
    await notifyTenantManagers(t, { message, title: "اشتراك موج" }).catch(() => {});
  }
}
