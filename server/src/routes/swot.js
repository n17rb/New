import { Router } from "express";
import { query, logActivity } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { canAny, can } from "../permissions.js";
import { computeCashInsights } from "./cash.js";
import { computeForecasts, groupForecasts } from "../utils/forecast.js";

// ============================================================
// تحليل SWOT: نقاط القوة والضعف والفرص والمخاطر — محسوبة من أرقام المحل الحقيقية
// كل نقطة فيها الرقم اللي طلعت منه، وشو تعمل بخصوصها
// ============================================================
const router = Router();
router.use(requireAuth);
router.use((req, res, next) => (canAny(req.user, [["reports", "view"], ["cash", "view"]]) ? next() : res.status(403).json({ error: "ما عندك صلاحية." })));

const r1 = (n) => Math.round(n * 10) / 10;
// العدد مع «زبون» بالعربي الصح: زبون واحد، زبونين، ٣ زباين، ١١ زبون
const zb = (n) => (n === 1 ? "زبون واحد" : n === 2 ? "زبونين" : n >= 3 && n <= 10 ? `${n} زباين` : `${n} زبون`);
const jd = (n) => `${Number(n || 0).toFixed(Number(n) >= 100 ? 0 : 2)} دينار`;

async function safe(fn, fallback) {
  try { return await fn(); } catch (e) { console.error("swot:", e.message); return fallback; }
}

async function gather() {
  const cash = await safe(() => computeCashInsights(), null);
  const fc = await safe(async () => groupForecasts(await computeForecasts()), null);

  const cust = (await query(
    `SELECT COUNT(*) FILTER (WHERE status = 'active')::int AS active,
            COUNT(*) FILTER (WHERE status = 'active' AND created_at >= now() - interval '30 days')::int AS new30,
            COUNT(*) FILTER (WHERE status = 'active' AND created_at >= now() - interval '60 days' AND created_at < now() - interval '30 days')::int AS new_prev30,
            COUNT(*) FILTER (WHERE status = 'active' AND coupon_balance > 0)::int AS with_coupons,
            COUNT(*) FILTER (WHERE status = 'active' AND debt_balance > 0)::int AS debtors,
            COALESCE(SUM(debt_balance) FILTER (WHERE status = 'active' AND debt_balance > 0), 0)::float AS debt_total
     FROM customers`
  )).rows[0];

  const ordersStats = (await query(
    `SELECT COUNT(*) FILTER (WHERE o.status = 'DELIVERED' AND o.created_at >= now() - interval '30 days')::int AS delivered30,
            COUNT(*) FILTER (WHERE o.status = 'DELIVERED' AND o.created_at >= now() - interval '60 days' AND o.created_at < now() - interval '30 days')::int AS delivered_prev30,
            COUNT(*) FILTER (WHERE o.status IN ('FAILED','CANCELLED') AND o.created_at >= now() - interval '30 days')::int AS failed30,
            COUNT(DISTINCT o.customer_id) FILTER (WHERE o.status = 'DELIVERED' AND o.created_at >= now() - interval '30 days')::int AS buyers30
     FROM orders o`
  )).rows[0];

  // زباين بيطلبوا كثير وما معهم كوبونات = فرصة بيع باقات
  const frequentNoCoupons = (await query(
    `SELECT COUNT(*)::int AS n FROM (
       SELECT c.id FROM customers c JOIN orders o ON o.customer_id = c.id
       WHERE c.status = 'active' AND c.coupon_balance = 0 AND o.status = 'DELIVERED' AND o.created_at >= now() - interval '60 days'
       GROUP BY c.id HAVING COUNT(*) >= 4) x`
  )).rows[0].n;

  // ديون قديمة: عليه دين وما طلب من ٣٠ يوم
  const oldDebts = (await query(
    `SELECT COUNT(*)::int AS n, COALESCE(SUM(c.debt_balance), 0)::float AS total
     FROM customers c
     WHERE c.status = 'active' AND c.debt_balance > 0
       AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id AND o.created_at >= now() - interval '30 days')`
  )).rows[0];

  const regions = (await query(
    `SELECT COALESCE(r.name, 'بدون منطقة') AS name, COUNT(*)::int AS n
     FROM customers c
     LEFT JOIN LATERAL (SELECT region_id FROM customer_locations WHERE customer_id = c.id ORDER BY id LIMIT 1) l ON true
     LEFT JOIN regions r ON r.id = l.region_id
     WHERE c.status = 'active' GROUP BY 1 ORDER BY 2 DESC`
  )).rows;

  const drivers = (await query(
    `SELECT u.full_name AS name, COUNT(*)::int AS n
     FROM trip_stops ts JOIN trips t ON t.id = ts.trip_id JOIN users u ON u.id = t.driver_id
     WHERE ts.delivered_at >= now() - interval '30 days'
     GROUP BY u.full_name ORDER BY 2 DESC`
  )).rows;

  const bottlesOut = (await query(
    `SELECT COUNT(*)::int AS n, COALESCE(SUM(c.bottles_out), 0)::int AS bottles
     FROM customers c
     WHERE c.bottles_out > 0 AND (c.status <> 'active' OR NOT EXISTS (
       SELECT 1 FROM orders o WHERE o.customer_id = c.id AND o.status <> 'CANCELLED' AND o.created_at >= now() - interval '30 days'))`
  )).rows[0];

  const reminders = (await query(
    `SELECT COUNT(*)::int AS n FROM customer_reminders cr JOIN customers c ON c.id = cr.customer_id WHERE c.status = 'active'`
  )).rows[0].n;

  const onTime = (await query(
    `SELECT COUNT(*) FILTER (WHERE ts.delivered_at <= o.requested_time + interval '20 minutes')::int AS ok, COUNT(*)::int AS total
     FROM trip_stops ts JOIN orders o ON o.id = ts.order_id
     WHERE o.requested_time IS NOT NULL AND ts.delivered_at IS NOT NULL AND ts.delivered_at >= now() - interval '60 days'`
  )).rows[0];

  return { cash, fc, cust, ordersStats, frequentNoCoupons, oldDebts, regions, drivers, bottlesOut, reminders, onTime };
}

function analyze(d) {
  const S = [], W = [], O = [], T = [];
  const add = (arr, weight, icon, title, detail, action) => arr.push({ weight, icon, title, detail, action });
  const s = d.cash?.sales, b = d.cash?.bottles, ex = d.cash?.expenses;

  // ---- المبيعات والقوارير ----
  if (s && s.pace_pct != null) {
    if (s.pace_pct >= 3) add(S, 60 + Math.min(30, s.pace_pct), "📈", "المبيعات طالعة", `من أول الشهر بعت ${jd(s.month_to_date)} — أكثر بـ ${s.pace_pct}% من نفس الأيام بـ${s.prev_month_label}.`, "كمّل على نفس الوتيرة، وشوف شو اللي زاد (منطقة؟ باقات؟) وكرّره.");
    else if (s.pace_pct <= -3) add(T, 60 + Math.min(30, -s.pace_pct), "📉", "المبيعات نازلة", `من أول الشهر ${jd(s.month_to_date)} — أقل بـ ${Math.abs(s.pace_pct)}% من نفس الأيام بـ${s.prev_month_label}.`, "شوف قائمة الزباين المتأخرين بالتوقعات وراسلهم اليوم.");
  } else if (d.cash && d.cash.recorded_days_60 < 10) {
    add(W, 45, "📝", "الحساب اليومي مش مسجّل بانتظام", `بس ${d.cash.recorded_days_60} يوم مسجّل آخر شهرين — التحليل بيضل ناقص.`, "سجّل المبيعات والعداد كل يوم آخر الدوام (دقيقة وحدة).");
  }
  if (b && b.pace_pct != null) {
    if (b.pace_pct >= 3) add(S, 50 + Math.min(25, b.pace_pct), "🧴", "القوارير المباعة بتزيد", `${Math.round(b.month_to_date)} قارورة لحد اليوم (+${b.pace_pct}% عن نفس الأيام).`, null);
    else if (b.pace_pct <= -3) add(T, 50 + Math.min(25, -b.pace_pct), "🧴", "القوارير المباعة بتقل", `${Math.round(b.month_to_date)} قارورة لحد اليوم (${b.pace_pct}% عن نفس الأيام).`, "قارن مبيعات المحل بالتوصيل — وين صار النقص؟");
  }
  if (s && s.next_month != null && s.growth_pct >= 2) add(O, 40, "🔮", "توقع الشهر الجاي إيجابي", `متوقع ${jd(s.next_month)} تقريبًا (بين ${jd(s.next_month_low)} و ${jd(s.next_month_high)}).`, "جهّز قوارير وفوارغ زيادة قبل الشهر الجاي.");
  if (s?.worst_day && s?.best_day && s.best_day.avg > 0 && s.worst_day.avg < s.best_day.avg * 0.6) {
    add(O, 35, "🗓️", `يوم ${s.worst_day.day} ضعيف`, `معدله ${jd(s.worst_day.avg)} مقابل ${jd(s.best_day.avg)} يوم ${s.best_day.day}.`, `اعمل عرض خاص يوم ${s.worst_day.day} أو ركّز فيه على تذكير الزباين.`);
  }
  if (ex && s && ex.pace_pct != null && s.pace_pct != null && ex.pace_pct - s.pace_pct >= 10 && ex.month_to_date > 0) {
    add(T, 55, "💸", "الصرفيات بتزيد أسرع من المبيعات", `الصرفيات ${ex.pace_pct > 0 ? "+" : ""}${ex.pace_pct}% والمبيعات ${s.pace_pct > 0 ? "+" : ""}${s.pace_pct}% عن نفس الأيام.`, "راجع الصرفيات بالحساب اليومي — شو البند اللي زاد؟");
  }

  // ---- الزباين ----
  const c = d.cust;
  if (c.new30 > 0) {
    const g = c.new_prev30 > 0 ? r1(((c.new30 - c.new_prev30) / c.new_prev30) * 100) : null;
    const fewer = g != null && g < -20;
    add(fewer ? W : S, 40 + Math.min(20, c.new30), "👥", fewer ? "الزباين الجداد قلّوا" : `${c.new30 === 1 ? "زبون جديد واحد" : c.new30 === 2 ? "زبونين جداد" : c.new30 <= 10 ? `${c.new30} زباين جداد` : `${c.new30} زبون جديد`} آخر ٣٠ يوم`, g != null ? `${c.new30} آخر ٣٠ يوم مقابل ${c.new_prev30} بالشهر اللي قبله (${g > 0 ? "+" : ""}${g}%).` : "بداية حلوة.", fewer ? "اطلب من زباينك الحاليين يجيبولك زباين (خصم للي بيجيب زبون)." : null);
  } else if (c.active > 0) {
    add(W, 50, "👥", "ما في زباين جداد آخر ٣٠ يوم", `عندك ${c.active} زبون فعّال بس ما انضاف ولا واحد جديد.`, "وزّع منشور على العمارات القريبة من أكثر منطقة عندك فيها زباين.");
  }
  const loyal = c.active ? r1((c.with_coupons / c.active) * 100) : 0;
  if (loyal >= 25) add(S, 45, "🎫", "زباين مرتبطين بالكوبونات", `${zb(c.with_coupons)} (${loyal}%) معهم رصيد كوبونات — دفعوا مقدّم وبيرجعولك.`, null);
  if (d.frequentNoCoupons > 0) add(O, 55 + Math.min(20, d.frequentNoCoupons), "💡", d.frequentNoCoupons === 1 ? "زبون واحد بيطلب كثير بدون كوبونات" : `${zb(d.frequentNoCoupons)} بيطلبوا كثير بدون كوبونات`, "طلبوا ٤ مرات أو أكثر آخر شهرين وما عندهم باقة.", "اعرض عليهم باقة كوبونات — بتضمن رجعتهم وبتقبض مقدّم.");

  // ---- التوقعات ----
  if (d.fc) {
    if (d.fc.late.length) add(W, 45 + Math.min(25, d.fc.late.length * 2), "⏰", d.fc.late.length === 1 ? "زبون واحد متأخر عن موعد طلبه" : `${zb(d.fc.late.length)} متأخرين عن موعد طلبهم`, "حسب استهلاكهم كان لازم يطلبوا من كم يوم.", "افتح التوقعات ← متأخرين، وراسلهم بكبسة.");
    if (d.fc.lost.length) add(T, 50 + Math.min(30, d.fc.lost.length * 3), "🚪", d.fc.lost.length === 1 ? "زبون واحد شكله انقطع" : `${zb(d.fc.lost.length)} شكلهم انقطعوا`, "صار إلهم فترة طويلة ما طلبوا — ممكن راحوا لمحل ثاني.", "ابعتلهم رسالة «اشتقنالك» من التوقعات، وجرّب عرض رجعة.");
    if (d.fc.tracked_count >= 10 && d.fc.late.length + d.fc.lost.length <= d.fc.tracked_count * 0.1) add(S, 40, "🔁", "زباينك منتظمين", `من ${d.fc.tracked_count} زبون متابَع، بس ${d.fc.late.length + d.fc.lost.length} متأخرين أو منقطعين.`, null);
  }
  if (d.reminders < Math.max(3, c.active * 0.1) && c.active >= 20) add(O, 30, "📅", "زباين المواعيد الثابتة قليلين", `بس ${d.reminders} زبون إلهم أيام توصيل ثابتة.`, "اسأل زباينك المنتظمين: بتحب نجيك كل سبت وثلاثاء؟ — الطلب بينضاف لحاله الساعة ٧.");

  // ---- الديون ----
  const monthSales = s?.projected_month || 0;
  if (c.debt_total > 0) {
    const ratio = monthSales > 0 ? r1((c.debt_total / monthSales) * 100) : null;
    if (ratio != null && ratio >= 15) add(W, 55 + Math.min(30, ratio / 2), "💳", "الديون عالية", `${jd(c.debt_total)} على ${zb(c.debtors)} — يعني ${ratio}% من مبيعات الشهر.`, "ابعت تذكير ديون على واتساب من صفحة الديون، ووقّف الدين عن اللي ما بيسدّ.");
    else if (ratio != null && ratio < 5) add(S, 30, "✅", "الديون تحت السيطرة", `${jd(c.debt_total)} بس — أقل من ٥% من مبيعات الشهر.`, null);
  }
  if (d.oldDebts.n > 0) add(T, 45 + Math.min(25, d.oldDebts.n * 3), "⚠️", d.oldDebts.n === 1 ? "زبون واحد عليه دين وما طلب من شهر" : `${zb(d.oldDebts.n)} عليهم دين وما طلبوا من شهر`, `مجموعها ${jd(d.oldDebts.total)} — كل ما طوّلت بتصعب تتحصّل.`, "اتصل فيهم هالأسبوع.");

  // ---- التوصيل والفريق ----
  const os = d.ordersStats;
  const totalOut = os.delivered30 + os.failed30;
  if (totalOut >= 20) {
    const failRate = r1((os.failed30 / totalOut) * 100);
    if (failRate <= 3) add(S, 40, "🚚", "التوصيل ممتاز", `${os.delivered30} طلب انسلّم آخر ٣٠ يوم، ونسبة التعذّر ${failRate}% بس.`, null);
    else if (failRate >= 8) add(W, 45 + failRate, "🚚", "طلبات بتتعذّر كثير", `${os.failed30} طلب تعذّر أو انلغى من ${totalOut} (${failRate}%).`, "تأكد من مواقع وعناوين الزباين، وخلي الكابتن يبعت «أنا جاي» قبل ما يوصل.");
  }
  if (d.onTime.total >= 10) {
    const rate = r1((d.onTime.ok / d.onTime.total) * 100);
    if (rate >= 85) add(S, 35, "⏱️", "مواعيد الزباين محترمة", `${rate}% من الطلبات بموعد وصلت بوقتها.`, null);
    else if (rate < 70) add(W, 40, "⏱️", "تأخير بطلبات المواعيد", `بس ${rate}% من الطلبات بموعد وصلت بوقتها.`, "خلي الطلبات بموعد تنحط بالرحلة بكير، والنظام بيرتبها على وقتها.");
  }
  const totalDrv = d.drivers.reduce((a, x) => a + x.n, 0);
  if (d.drivers.length >= 1 && totalDrv >= 30) {
    const top = d.drivers[0];
    const share = r1((top.n / totalDrv) * 100);
    if (share >= 75) add(T, 40 + (share - 75), "🧍", "الشغل كله على كابتن واحد", `${top.name} عامل ${share}% من التسليمات آخر شهر.`, "درّب كابتن ثاني على الرحلات عشان ما يوقف الشغل لو غاب.");
  }

  // ---- المناطق ----
  const totalC = d.regions.reduce((a, x) => a + x.n, 0);
  const named = d.regions.filter((x) => x.name !== "بدون منطقة");
  if (named.length && totalC >= 15) {
    const top = named[0];
    const share = r1((top.n / totalC) * 100);
    add(S, 35, "📍", `${top.name} منطقتك الأقوى`, `${top.n} زبون (${share}% من زباينك).`, null);
    if (share >= 60) add(T, 35, "🎯", "معتمد على منطقة وحدة", `${share}% من زباينك بـ${top.name}.`, "وسّع لمنطقة قريبة عشان ما تتأثر لو فتح منافس هناك.");
    const small = named.filter((x) => x.n > 0 && x.n <= Math.max(2, top.n * 0.15)).slice(0, 3);
    if (small.length) add(O, 40, "🗺️", "مناطق فيها مجال تكبر", `${small.map((x) => `${x.name} (${x.n})`).join("، ")} — زباين قليلين لسا.`, "شوف خريطة الزباين، ووزّع عروض بهالمناطق.");
  }
  const noRegion = d.regions.find((x) => x.name === "بدون منطقة");
  if (noRegion && totalC && noRegion.n / totalC >= 0.3) add(W, 25, "🧭", "زباين كثير بدون منطقة", `${zb(noRegion.n)} ما إلهم منطقة أو موقع.`, "حدّث مواقعهم عشان ترتيب الرحلات يصير أدق.");

  // ---- عهدة القوارير ----
  if (d.bottlesOut.bottles > 0) add(T, 30 + Math.min(30, d.bottlesOut.bottles), "🧴", `${d.bottlesOut.bottles} قارورة للمحل عند زباين واقفين`, `عند ${zb(d.bottlesOut.n)} ما طلبوا من شهر أو أكثر — رأس مال برا.`, "من «عهدة القوارير» ← لازم نسترجع، راسلهم وسترجعها.");

  const sort = (a) => a.sort((x, y) => y.weight - x.weight).slice(0, 6);
  return { S: sort(S), W: sort(W), O: sort(O), T: sort(T) };
}

async function readNotes() {
  const r = await query("SELECT value FROM app_settings WHERE key = 'swot_notes'");
  try {
    const o = JSON.parse(r.rows[0]?.value || "{}");
    return { S: o.S || [], W: o.W || [], O: o.O || [], T: o.T || [] };
  } catch {
    return { S: [], W: [], O: [], T: [] };
  }
}

router.get("/", async (req, res) => {
  const data = await gather();
  const auto = analyze(data);
  // خطة العمل: أهم ٣ خطوات من الضعف والمخاطر والفرص
  const plan = [...auto.W, ...auto.T, ...auto.O].filter((x) => x.action).sort((a, b) => b.weight - a.weight).slice(0, 3)
    .map((x) => ({ icon: x.icon, title: x.title, action: x.action }));
  const counts = {
    active_customers: data.cust.active,
    month_to_date: data.cash?.sales?.month_to_date ?? null,
    pace_pct: data.cash?.sales?.pace_pct ?? null,
  };
  res.json({ generated_at: new Date().toISOString(), auto, notes: await readNotes(), plan, counts });
});

router.put("/notes", async (req, res) => {
  if (!can(req.user, "reports", "edit") && !can(req.user, "settings", "edit") && req.user.role !== "super_admin") {
    return res.status(403).json({ error: "تعديل الملاحظات للإدارة بس." });
  }
  const body = req.body || {};
  const clean = {};
  for (const k of ["S", "W", "O", "T"]) {
    const arr = Array.isArray(body[k]) ? body[k] : [];
    clean[k] = arr.map((x) => String(x || "").trim().slice(0, 200)).filter(Boolean).slice(0, 12);
  }
  await query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ('swot_notes', $1, now())
     ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = now()`,
    [JSON.stringify(clean)]
  );
  await logActivity({ userId: req.user.id, action: "UPDATE_SWOT_NOTES", recordType: "settings", recordId: null, newValue: clean });
  res.json(clean);
});

export default router;
