import express from "express";
import "express-async-errors";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { pool } from "./db.js";

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

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" }));

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

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "حدث خطأ غير متوقع في السيرفر." });
});

async function initDbIfNeeded() {
  try {
    const schemaPath = path.join(__dirname, "..", "schema.sql");
    const sql = fs.readFileSync(schemaPath, "utf-8");
    await pool.query(sql);
    console.log("✅ تم التأكد من وجود الجداول والبيانات الابتدائية.");
  } catch (err) {
    console.error("❌ خطأ أثناء تهيئة قاعدة البيانات:", err.message);
  }
}

const PORT = process.env.PORT || 4000;

initDbIfNeeded().then(() => {
  app.listen(PORT, () => {
    console.log(`✅ السيرفر شغال على المنفذ ${PORT}`);
  });

  createScheduledSnapshot().catch((err) => console.error("❌ فشل النسخة الاحتياطية الأولية:", err.message));
  setInterval(() => {
    createScheduledSnapshot().catch((err) => console.error("❌ فشل النسخة الاحتياطية المجدولة:", err.message));
  }, 24 * 60 * 60 * 1000);
});
