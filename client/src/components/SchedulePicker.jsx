import { useMemo, useState } from "react";
import { FiClock, FiCalendar } from "react-icons/fi";
import { ammanToday, addDays, ammanParts, dayLabel, hourLabel, toIso, ar } from "../schedule.js";

const HOURS = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22];

// اختيار موعد الطلب: اليوم / بكرة / بعد بكرة / تاريخ ثاني — وبعدين الساعة بالعربي
// value = { scheduled_date: "YYYY-MM-DD" | null, requested_time: ISO | null }
export default function SchedulePicker({ value, onChange }) {
  const today = ammanToday();
  const initial = useMemo(() => {
    if (value?.requested_time) {
      const p = ammanParts(value.requested_time);
      return { date: p.date, hour: p.hour, minute: p.minute };
    }
    if (value?.scheduled_date) return { date: value.scheduled_date, hour: null, minute: 0 };
    return { date: null, hour: null, minute: 0 };
  }, []);
  const [date, setDate] = useState(initial.date);
  const [hour, setHour] = useState(initial.hour);
  const [half, setHalf] = useState(initial.minute === 30);
  const [customDate, setCustomDate] = useState(false);

  function emit(d, h, isHalf) {
    if (!d) return onChange({ scheduled_date: null, requested_time: null });
    if (h == null) return onChange({ scheduled_date: d, requested_time: null });
    return onChange({ scheduled_date: d, requested_time: toIso(d, h, isHalf ? 30 : 0) });
  }

  function pickDay(d) {
    setDate(d);
    setCustomDate(false);
    // اليوم: الساعات اللي راحت ما بتنفع
    let h = hour;
    if (d === today && h != null && h <= ammanParts(new Date()).hour) h = null;
    setHour(h);
    emit(d, h, half);
  }

  function pickHour(h) {
    const next = hour === h ? null : h;
    setHour(next);
    emit(date, next, half);
  }

  function toggleHalf() {
    setHalf(!half);
    emit(date, hour, !half);
  }

  const nowHour = ammanParts(new Date()).hour;
  const days = [
    { key: null, label: "الآن" },
    { key: today, label: "اليوم" },
    { key: addDays(today, 1), label: "بكرة" },
    { key: addDays(today, 2), label: "بعد بكرة" },
  ];
  const isCustom = date && !days.some((d) => d.key === date);

  return (
    <div className="sched">
      <div className="sched-days" role="radiogroup" aria-label="يوم التسليم">
        {days.map((d) => (
          <button
            key={d.label}
            type="button"
            role="radio"
            aria-checked={date === d.key && !customDate}
            className={date === d.key && !customDate ? "on" : ""}
            onClick={() => pickDay(d.key)}
          >
            {d.label}
          </button>
        ))}
        <button type="button" className={isCustom || customDate ? "on" : ""} onClick={() => setCustomDate(true)} aria-label="تاريخ ثاني">
          <FiCalendar aria-hidden="true" />
        </button>
      </div>

      {customDate && (
        <input
          type="date"
          min={today}
          value={date || ""}
          onChange={(e) => e.target.value && pickDay(e.target.value)}
          className="sched-date-input"
          aria-label="اختار التاريخ"
        />
      )}

      {date && (
        <>
          <div className="sched-label">
            <FiClock aria-hidden="true" /> الساعة <span className="text-secondary">(اختياري — إذا ما اخترت بيكون بأي وقت)</span>
          </div>
          <div className="sched-hours">
            {HOURS.map((h) => {
              const past = date === today && h <= nowHour;
              return (
                <button key={h} type="button" disabled={past} className={hour === h ? "on" : ""} onClick={() => pickHour(h)}>
                  {hourLabel(h, 0)}
                </button>
              );
            })}
          </div>
          {hour != null && (
            <button type="button" className={`chip${half ? " on" : ""}`} style={{ marginTop: 8 }} onClick={toggleHalf}>
              {ar(hour % 12 || 12)} ونص
            </button>
          )}
          <div className="sched-summary">
            📅 {dayLabel(date, today)}{hour != null ? ` ${hourLabel(hour, half ? 30 : 0)}` : " · بأي وقت"}
          </div>
        </>
      )}
    </div>
  );
}
