// كلام عربي لمواعيد الطلبات: «بكرة ٦ مساءً»، «اليوم ٨ ونص صباحًا»، «الخميس ١٦ تشرين الأول»

const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";
export const toArabicDigits = (s) => String(s).replace(/\d/g, (d) => AR_DIGITS[d]);

function ammanParts(date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Amman", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")), minute: Number(get("minute")) };
}

export function hourLabel(hour, minute = 0) {
  const period = hour < 5 ? "بالليل" : hour < 12 ? "صباحًا" : hour < 15 ? "ظهرًا" : "مساءً";
  let h = hour % 12;
  if (h === 0) h = 12;
  let base = toArabicDigits(h);
  if (minute === 30) base += " ونص";
  else if (minute === 15) base += " وربع";
  else if (minute === 45) base = `${toArabicDigits(h === 12 ? 1 : h + 1)} إلا ربع`;
  else if (minute) base = `${toArabicDigits(h)}:${toArabicDigits(String(minute).padStart(2, "0"))}`;
  return `${base} ${period}`;
}

function dayLabel(date, today) {
  const diff = Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86400000);
  if (diff === 0) return "اليوم";
  if (diff === 1) return "بكرة";
  if (diff === 2) return "بعد بكرة";
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("ar-JO", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
}

export function scheduleLabel({ scheduled_date, requested_time }) {
  if (!scheduled_date && !requested_time) return null;
  const today = ammanParts(new Date()).date;
  if (requested_time) {
    const p = ammanParts(new Date(requested_time));
    return `${dayLabel(p.date, today)} ${hourLabel(p.hour, p.minute)}`;
  }
  const d = scheduled_date instanceof Date
    ? `${scheduled_date.getFullYear()}-${String(scheduled_date.getMonth() + 1).padStart(2, "0")}-${String(scheduled_date.getDate()).padStart(2, "0")}`
    : String(scheduled_date).slice(0, 10);
  return `${dayLabel(d, today)} (بأي وقت)`;
}
