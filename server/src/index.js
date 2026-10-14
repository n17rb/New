import express from "express";
import "express-async-errors";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { pool, tenantStore, runInTenant, platformQuery } from "./db.js";
import { migrateAllTenants, listTenants, tenantAccess } from "./utils/tenants.js";
import { checkSubscriptionWarnings, resetDemosIfDue } from "./utils/platformNotify.js";

import authRoutes from "./routes/auth.js";
import setupRoutes from "./routes/setup.js";
import customerRoutes from "./routes/customers.js";
import productRoutes from "./routes/products.js";
import regionRoutes from "./routes/regions.js";
import userRoutes from "./routes/users.js";
import orderRoutes from "./routes/orders.js";
import tripRoutes from "./routes/trips.js";
import driverRoutes from "./routes/drivers.js";
import geocodeRoutes from "./routes/geocode.js";
import reportRoutes from "./routes/reports.js";
import cashRoutes from "./routes/cash.js";
import activityRoutes from "./routes/activity.js";
import backupRoutes, { createScheduledSnapshot } from "./routes/backup.js";
import notificationRoutes from "./routes/notifications.js";
import reminderRoutes, { checkAndFireReminders } from "./routes/reminders.js";
import notesRoutes from "./routes/notes.js";
import pushRoutes from "./routes/push.js";
import settingsRoutes from "./routes/settings.js";
import dashboardRoutes from "./routes/dashboard.js";
import debtRoutes from "./routes/debts.js";
import couponRoutes from "./routes/coupons.js";
import chatRoutes from "./routes/chat.js";
import forecastRoutes, { checkForecastAlerts } from "./routes/forecast.js";
import platformRoutes from "./routes/platform.js";
import subscriptionRoutes from "./routes/subscription.js";
import supportRoutes from "./routes/support.js";
import payrollRoutes from "./routes/payroll.js";
import jardRoutes from "./routes/jard.js";
import invoiceRoutes, { publicInvoiceRouter } from "./routes/invoices.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" }));

// موج: كل طلب إله «سياق محل» — بيتعبّى من التوكن (أو من اسم المستخدم وقت الدخول)
app.use((req, res, next) => tenantStore.run({ schema: "public", tenant: null }, next));

app.get("/api/health", (req, res) => res.json({ status: "ok", time: new Date().toISOString() }));

app.use("/api/setup", setupRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/customers", customerRoutes);
app.use("/api/products", productRoutes);
app.use("/api/regions", regionRoutes);
app.use("/api/users", userRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/trips", tripRoutes);
app.use("/api/drivers", driverRoutes);
app.use("/api/geocode", geocodeRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/cash", cashRoutes);
app.use("/api/activity-log", activityRoutes);
app.use("/api/backup", backupRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/reminders", reminderRoutes);
app.use("/api/notes", notesRoutes);
app.use("/api/push", pushRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/debts", debtRoutes);
app.use("/api/coupons", couponRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/forecast", forecastRoutes);
app.use("/api/platform", platformRoutes);
app.use("/api/subscription", subscriptionRoutes);
app.use("/api/support", supportRoutes);
app.use("/api/payroll", payrollRoutes);
app.use("/api/jard", jardRoutes);
app.use("/api/invoices", invoiceRoutes);
app.use("/api/public", publicInvoiceRouter);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "حدث خطأ غير متوقع في السيرفر." });
});

async function initDbIfNeeded() {
  try {
    const sql = fs.readFileSync(path.join(__dirname, "..", "schema.sql"), "utf-8");
    await pool.query(sql); // المحل الأساسي (public)
    await platformQuery(fs.readFileSync(path.join(__dirname, "..", "platform.sql"), "utf-8"));
    await migrateAllTenants(); // كل المحلات المشتركة
    console.log("✅ تم التأكد من جداول موج وكل المحلات.");
  } catch (err) {
    console.error("❌ خطأ أثناء تهيئة قاعدة البيانات:", err.message);
  }
}

// بيشغّل مهمة على كل محل شغّال (مش موقوف ومش خالص اشتراكه)
async function forEachTenant(label, fn) {
  let tenants = [];
  try {
    tenants = await listTenants({ includeSuspended: false });
  } catch (err) {
    console.error("❌ ما قدرت أجيب المحلات:", err.message);
    return;
  }
  for (const t of tenants) {
    const a = tenantAccess(t);
    if (a.state === "expired" || a.state === "suspended") continue;
    try {
      await runInTenant(t, fn);
    } catch (err) {
      console.error(`❌ ${label} (${t.name}):`, err.message);
    }
  }
}

async function hourlyJobs() {
  await forEachTenant("التذكيرات", () => checkAndFireReminders());
  await forEachTenant("التوقعات", () => checkForecastAlerts());
  await forEachTenant("تنظيف الإشعارات", () => pool.query("DELETE FROM notifications WHERE created_at < now() - interval '48 hours'"));
  await checkSubscriptionWarnings().catch((err) => console.error("❌ تنبيهات الاشتراك:", err.message));
  await resetDemosIfDue().catch((err) => console.error("❌ ترجيع الديمو:", err.message));
}

const PORT = process.env.PORT || 4000;

initDbIfNeeded().then(() => {
  app.listen(PORT, () => {
    console.log(`✅ السيرفر شغال على المنفذ ${PORT}`);
  });

  forEachTenant("النسخة الاحتياطية", () => createScheduledSnapshot());
  setInterval(() => forEachTenant("النسخة الاحتياطية", () => createScheduledSnapshot()), 24 * 60 * 60 * 1000);

  hourlyJobs();
  setInterval(hourlyJobs, 60 * 60 * 1000);
});
