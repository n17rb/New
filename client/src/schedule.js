// مواعيد الطلبات بالعربي: «بكرة ٦ مساءً»، «اليوم ٨ ونص صباحًا»
// الأردن على توقيت +03:00 طول السنة

const AR = "٠١٢٣٤٥٦٧٨٩";
export const ar = (s) => String(s).replace(/\d/g, (d) => AR[d]);

export function ammanToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Amman", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function addDays(date, n) {
  return new Date(Date.parse(`${date}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
}

export function ammanParts(d) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Amman", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(d));
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")), minute: Number(get("minute")) };
}

export function hourLabel(hour, minute = 0) {
  const period = hour < 5 ? "بالليل" : hour < 12 ? "صباحًا" : hour < 15 ? "ظهرًا" : "مساءً";
  let h = hour % 12;
  if (h === 0) h = 12;
  let base = ar(h);
  if (minute === 30) base += " ونص";
  else if (minute === 15) base += " وربع";
  else if (minute) base = `${ar(h)}:${ar(String(minute).padStart(2, "0"))}`;
  return `${base} ${period}`;
}

export function dayLabel(date, today = ammanToday()) {
  const diff = Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86400000);
  if (diff === 0) return "اليوم";
  if (diff === 1) return "بكرة";
  if (diff === 2) return "بعد بكرة";
  if (diff === -1) return "مبارح";
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("ar-JO", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
}

// {scheduled_date, requested_time} → «بكرة ٦ مساءً» أو null
export function scheduleLabel(o) {
  if (!o) return null;
  if (o.requested_time) {
    const p = ammanParts(o.requested_time);
    return `${dayLabel(p.date)} ${hourLabel(p.hour, p.minute)}`;
  }
  if (o.scheduled_date) return `${dayLabel(String(o.scheduled_date).slice(0, 10))} · بأي وقت`;
  return null;
}

// هل الطلب لموعد ببعدين (يوم جاي أو بعد أكثر من ساعتين)
export function isFutureScheduled(o) {
  if (o.scheduled_date && String(o.scheduled_date).slice(0, 10) > ammanToday()) return true;
  if (o.requested_time && new Date(o.requested_time).getTime() > Date.now() + 2 * 3600 * 1000) return true;
  return false;
}

// تاريخ + ساعة (توقيت الأردن) → ISO
export function toIso(date, hour, minute = 0) {
  return `${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+03:00`;
}
