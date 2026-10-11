import { Router } from "express";
import { query, logActivity } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { can, canAny } from "../permissions.js";
import { sendPushToUser } from "../utils/push.js";
import {
  computeForecasts, groupForecasts, invalidateForecastCache, getForecastSettings,
  jordanDate, jordanHour, addDaysToDate, qtyWord,
} from "../utils/forecast.js";

const router = Router();
router.use(requireAuth);

// المشاهدة: اللي بيشوف الطلبات أو العملاء
function canView(user) {
  return canAny(user, [["orders", "view"], ["customers", "view"]]);
}
// التأجيل وإيقاف التوقع لزبون: اللي بيعدّل الطلبات أو العملاء
function canAct(user) {
  return canAny(user, [["orders", "edit"], ["customers", "edit"]]);
}
// التصفير والإعدادات: إعدادات المحل
function canConfigure(user) {
  return can(user, "settings", "edit");
}

router.use((req, res, next) => (canView(req.user) ? next() : res.status(403).json({ error: "ما عندك صلاحية لتوقعات الطلبات." })));

router.get("/", async (req, res) => {
  checkForecastThrottled();
  const data = await computeForecasts();
  res.json(groupForecasts(data));
});

router.get("/customer/:id", async (req, res) => {
  const data = await computeForecasts({ customerId: Number(req.params.id) });
  const f = data.customers[0];
  if (!f) return res.status(404).json({ error: "العميل غير موجود." });
  res.json({ ...f, settings: data.settings, today: data.today });
});

// «مش اليوم»: بيخفي الزبون من التوقعات لعدد أيام
router.post("/customer/:id/snooze", async (req, res) => {
  if (!canAct(req.user)) return res.status(403).json({ error: "صلاحيتك مشاهدة فقط." });
  const days = Math.min(60, Math.max(1, Math.floor(Number(req.body?.days) || 1)));
  const until = addDaysToDate(jordanDate(), days - 1);
  const r = await query("UPDATE customers SET forecast_snooze_until = $1 WHERE id = $2 RETURNING id", [until, req.params.id]);
  if (!r.rows[0]) return res.status(404).json({ error: "العميل غير موجود." });
  invalidateForecastCache();
  await logActivity({ userId: req.user.id, action: "FORECAST_SNOOZE", recordType: "customer", recordId: Number(req.params.id), newValue: { until } });
  res.json({ snooze_until: until });
});

router.delete("/customer/:id/snooze", async (req, res) => {
  if (!canAct(req.user)) return res.status(403).json({ error: "صلاحيتك مشاهدة فقط." });
  await query("UPDATE customers SET forecast_snooze_until = NULL WHERE id = $1", [req.params.id]);
  invalidateForecastCache();
  res.json({ ok: true });
});

// إيقاف/تشغيل التوقع لزبون (مثلاً زبون موسمي أو بيطلب بس وقت ما بده)
router.put("/customer/:id/tracking", async (req, res) => {
  if (!canAct(req.user)) return res.status(403).json({ error: "صلاحيتك مشاهدة فقط." });
  const disabled = req.body?.disabled === true;
  const r = await query("UPDATE customers SET forecast_disabled = $1 WHERE id = $2 RETURNING id", [disabled, req.params.id]);
  if (!r.rows[0]) return res.status(404).json({ error: "العميل غير موجود." });
  invalidateForecastCache();
  await logActivity({ userId: req.user.id, action: disabled ? "FORECAST_DISABLE" : "FORECAST_ENABLE", recordType: "customer", recordId: Number(req.params.id) });
  res.json({ disabled });
});

// تصفير المتأخرين: كل اللي كانوا متأخرين لهلّق بيروحوا لقائمة «قدام»،
// ومن هون وطالع أي زبون بيتأخر بيطلع بالقائمة وبيوصل عنه إشعار.
router.post("/reset", async (req, res) => {
  if (!canConfigure(req.user)) return res.status(403).json({ error: "التصفير بده صلاحية تعديل إعدادات المحل." });
  const before = groupForecasts(await computeForecasts({ fresh: true }));
  const at = new Date().toISOString();
  await query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ('forecast_reset_at', $1, now())
     ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = now()`,
    [at]
  );
  invalidateForecastCache();
  await logActivity({
    userId: req.user.id, action: "FORECAST_RESET", recordType: "settings", recordId: null,
    newValue: { reset_at: at, cleared_late: before.late.length, cleared_lost: before.lost.length },
  });
  res.json({ reset_at: at, cleared: before.late.length + before.lost.length });
});

router.delete("/reset", async (req, res) => {
  if (!canConfigure(req.user)) return res.status(403).json({ error: "ما عندك صلاحية." });
  await query("DELETE FROM app_settings WHERE key = 'forecast_reset_at'");
  invalidateForecastCache();
  await logActivity({ userId: req.user.id, action: "FORECAST_RESET_UNDO", recordType: "settings", recordId: null });
  res.json({ ok: true });
});

router.put("/settings", async (req, res) => {
  if (!canConfigure(req.user)) return res.status(403).json({ error: "ما عندك صلاحية تعديل الإعدادات." });
  const minOrders = Math.floor(Number(req.body?.min_orders));
  if (!Number.isInteger(minOrders) || minOrders < 2 || minOrders > 10) {
    return res.status(400).json({ error: "عدد الطلبات لازم يكون بين ٢ و١٠." });
  }
  await query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ('forecast_min_orders', $1, now())
     ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = now()`,
    [String(minOrders)]
  );
  invalidateForecastCache();
  res.json(await getForecastSettings());
});

// ============================================================
// إشعارات التوقعات: كل ساعة (من ٨ الصبح لـ٩ بالليل)
// كل زبون بينبعت عنه تنبيه «اليوم» مرة، وتنبيه «متأخر» مرة — لكل موعد متوقع.
// ============================================================
const ALERT_START_HOUR = 8;
const ALERT_END_HOUR = 21;

function listNames(names, max = 4) {
  if (names.length <= max) return names.join("، ");
  return `${names.slice(0, max).join("، ")} و${names.length - max} غيرهم`;
}

function daysText(n) {
  if (n === 1) return "يوم";
  if (n === 2) return "يومين";
  if (n <= 10) return `${n} أيام`;
  return `${n} يوم`;
}

export async function checkForecastAlerts({ force = false } = {}) {
  const hour = jordanHour();
  if (!force && (hour < ALERT_START_HOUR || hour >= ALERT_END_HOUR)) return { sent: 0 };

  const groups = groupForecasts(await computeForecasts({ fresh: true }));
  const candidates = [
    ...groups.today.map((f) => ({ f, kind: "today" })),
    ...groups.late.map((f) => ({ f, kind: "late" })),
  ];
  if (candidates.length === 0) return { sent: 0 };

  const fresh = [];
  for (const c of candidates) {
    const inserted = await query(
      `INSERT INTO forecast_alerts (customer_id, due_date, kind) VALUES ($1, $2, $3)
       ON CONFLICT (customer_id, due_date, kind) DO NOTHING RETURNING id`,
      [c.f.customer_id, c.f.due_date, c.kind]
    );
    if (inserted.rows[0]) fresh.push(c);
  }
  if (fresh.length === 0) return { sent: 0 };

  const usersResult = await query(
    `SELECT id, role, permissions, can_discount, can_delete_customer, can_edit_product_price, can_cancel_order
     FROM users WHERE status = 'active'`
  );
  const recipients = usersResult.rows.filter((u) => can(u, "orders", "view"));

  const messages = fresh.map(({ f, kind }) => {
    if (kind === "today") {
      const left = f.remaining > 0 ? ` — باقي عنده تقريبًا ${f.remaining_label}` : " — خلصت عنده تقريبًا";
      return { customerId: f.customer_id, text: `💧 اليوم مفروض نوصل لـ${f.name} ${f.qty_label}${left}` };
    }
    return { customerId: f.customer_id, text: `⏰ ${f.name} متأخر ${daysText(f.late_days)} عن موعده — عادةً بيطلب ${f.qty_label}` };
  });

  for (const u of recipients) {
    for (const m of messages) {
      await query(
        `INSERT INTO notifications (type, message, related_customer_id, target_user_id) VALUES ('FORECAST', $1, $2, $3)`,
        [m.text, m.customerId, u.id]
      );
    }
  }

  // إشعار جهاز واحد لكل شخص بيلخّص الجديد
  const todays = fresh.filter((x) => x.kind === "today").map((x) => x.f);
  const lates = fresh.filter((x) => x.kind === "late").map((x) => x.f);
  const parts = [];
  if (todays.length === 1) parts.push(`اليوم مفروض نوصل لـ${todays[0].name} ${todays[0].qty_label}`);
  else if (todays.length > 1) {
    const bottles = todays.reduce((s, f) => s + f.qty_typical, 0);
    parts.push(`متوقع ${todays.length} زباين يطلبوا اليوم (حوالي ${qtyWord(bottles)}): ${listNames(todays.map((f) => f.name))}`);
  }
  if (lates.length === 1) parts.push(`${lates[0].name} متأخر عن موعده`);
  else if (lates.length > 1) parts.push(`${lates.length} زباين متأخرين: ${listNames(lates.map((f) => f.name), 3)}`);
  const body = parts.join(" · ");
  const today = jordanDate();
  for (const u of recipients) {
    sendPushToUser(u.id, { title: "💧 توقعات الطلبات", body, url: "/forecast", tag: `forecast-${today}` })
      .catch((e) => console.error("push error:", e.message));
  }
  return { sent: fresh.length };
}

let lastCheckAt = 0;
export function checkForecastThrottled() {
  const now = Date.now();
  if (now - lastCheckAt < 15 * 60 * 1000) return;
  lastCheckAt = now;
  checkForecastAlerts().catch((err) => console.error("forecast check error:", err.message));
}

export default router;
