import { useEffect, useMemo, useRef, useState } from "react";
import { api, peek } from "../api.js";
import { usePerms, ViewOnlyNote } from "../auth.jsx";
import { FiChevronRight, FiChevronLeft, FiEdit2, FiTrendingUp, FiTrendingDown, FiMinus, FiSettings, FiArchive, FiChevronDown } from "react-icons/fi";
import SalesChart from "../components/SalesChart.jsx";

function getJordanToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Amman", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function shiftDate(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function formatDayLabel(dateStr) {
  return new Date(`${dateStr}T12:00:00Z`).toLocaleDateString("ar-JO", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}
const shortDay = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString("ar-JO", { weekday: "short", day: "numeric", month: "numeric", timeZone: "UTC" });
const money = (n) => `${Number(n || 0).toFixed(2)} JD`;
const moneyShort = (n) => `${Number(n || 0) >= 1000 ? Math.round(n).toLocaleString("en-US") : Number(n || 0).toFixed(Number(n) % 1 ? 2 : 0)} JD`;
const val = (n, unit) => (unit === "JD" ? moneyShort(n) : `${Math.round(n || 0)} قارورة`);

// شارة التغيير: سهم + نسبة، أخضر للزيادة وأحمر للنقص
export function Delta({ pct, small = false, suffix = "" }) {
  if (pct == null) return <span className={`delta flat${small ? " sm" : ""}`}>— ما في مقارنة</span>;
  const dir = pct >= 3 ? "up" : pct <= -3 ? "down" : "flat";
  const Icon = dir === "up" ? FiTrendingUp : dir === "down" ? FiTrendingDown : FiMinus;
  return (
    <span className={`delta ${dir}${small ? " sm" : ""}`}>
      <Icon aria-hidden="true" />
      <bdi dir="ltr" className="tabular-num">{pct > 0 ? "+" : ""}{pct}%</bdi>{suffix && <span className="delta-sfx">{suffix}</span>}
    </span>
  );
}

const VERDICT = {
  up: { cls: "up", icon: FiTrendingUp, title: "الشغل طالع 👏" },
  down: { cls: "down", icon: FiTrendingDown, title: "الشغل نازل شوي" },
  flat: { cls: "flat", icon: FiMinus, title: "الشغل ثابت" },
};

function InsightsCard() {
  const [data, setData] = useState(() => peek("/cash/insights") || null);
  const [metric, setMetric] = useState("sales");
  const [view, setView] = useState("daily");
  const [error, setError] = useState("");

  useEffect(() => { api.getCashInsights().then(setData).catch((e) => setError(e.message)); }, []);

  if (error) return <div className="card"><div className="error-box">{error}</div></div>;
  if (!data) return <div className="card insights-card"><div className="skeleton" style={{ height: 220 }} /></div>;

  const m = data[metric];
  const unit = metric === "sales" ? "JD" : "BOT";
  const daily = data.daily.slice(-30).map((d) => ({ date: d.date, value: metric === "sales" ? d.sales : d.bottles }));
  const hasAny = daily.some((d) => d.value != null) || m.months.some((x) => x.total > 0);
  const v = VERDICT[m.verdict] || VERDICT.flat;
  const VIcon = v.icon;
  const lastDay = m.elapsed_days;

  return (
    <div className="card insights-card">
      <div className="seg" style={{ marginBottom: 12 }}>
        <button className={metric === "sales" ? "on" : ""} onClick={() => setMetric("sales")}>💰 المبيعات</button>
        <button className={metric === "bottles" ? "on" : ""} onClick={() => setMetric("bottles")}>🧴 القوارير</button>
      </div>

      {!hasAny ? (
        <p className="text-secondary" style={{ margin: "6px 0" }}>
          {metric === "sales" ? "سجّل كم يوم مبيعات وبيطلعلك هون كيف ماشي الشغل." : "سجّل قراءة العداد أو عدد القوارير يوميًا، وبيطلعلك هون إذا القوارير قاعدة بتزيد ولا بتنقص."}
        </p>
      ) : (
        <>
          <div className={`verdict ${v.cls}`}>
            <span className="verdict-ic"><VIcon /></span>
            <div style={{ minWidth: 0 }}>
              <div className="verdict-t">{v.title}</div>
              <div className="verdict-s">
                {m.pace_pct != null ? (
                  <>من ١ لـ {lastDay} {m.month_label}: <b className="tabular-num">{val(m.month_to_date, unit)}</b> — {m.pace_pct >= 0 ? "أكثر" : "أقل"} بـ <b className="tabular-num">{Math.abs(m.pace_pct)}%</b> من نفس الأيام بـ{m.prev_month_label} ({val(m.prev_same_period, unit)})</>
                ) : m.week_pct != null ? (
                  <>آخر ٧ أيام {m.week_pct >= 0 ? "أكثر" : "أقل"} بـ <b>{Math.abs(m.week_pct)}%</b> من الأسبوع اللي قبله</>
                ) : (
                  <>لسا البيانات قليلة للمقارنة — كمّل تسجيل يومي</>
                )}
              </div>
            </div>
          </div>

          <div className="kpi-grid">
            <div className="kpi">
              <div className="kpi-l">لحد اليوم ({m.month_label})</div>
              <div className="kpi-v tabular-num">{val(m.month_to_date, unit)}</div>
              <Delta pct={m.pace_pct} small suffix=" عن نفس الأيام" />
            </div>
            <div className="kpi">
              <div className="kpi-l">متوقع يسكّر الشهر على</div>
              <div className="kpi-v tabular-num">{val(m.projected_month, unit)}</div>
              <Delta pct={m.projected_vs_prev_pct} small suffix={` عن ${m.prev_month_label}`} />
            </div>
            <div className="kpi">
              <div className="kpi-l">آخر ٧ أيام</div>
              <div className="kpi-v tabular-num">{val(m.week, unit)}</div>
              <Delta pct={m.week_pct} small suffix=" عن اللي قبله" />
            </div>
            <div className="kpi accent">
              <div className="kpi-l">الشهر الجاي (توقع)</div>
              <div className="kpi-v tabular-num">{m.next_month != null ? val(m.next_month, unit) : "—"}</div>
              <div className="kpi-s tabular-num">
                {m.next_month != null ? `بين ${val(m.next_month_low, unit)} و ${val(m.next_month_high, unit)}` : "بده شهر كامل على الأقل"}
              </div>
            </div>
          </div>

          <div className="seg seg-sm" style={{ margin: "14px 0 6px" }}>
            <button className={view === "daily" ? "on" : ""} onClick={() => setView("daily")}>آخر ٣٠ يوم</button>
            <button className={view === "monthly" ? "on" : ""} onClick={() => setView("monthly")}>شهر بشهر</button>
          </div>
          <SalesChart mode={view} daily={daily} months={m.months} unit={unit} />

          <div className="insight-lines">
            <div>📊 معدل اليوم: <b className="tabular-num">{val(m.daily_avg, unit)}</b>{m.recent_daily_avg ? <> · آخر أسبوعين: <b className="tabular-num">{val(m.recent_daily_avg, unit)}</b></> : null}</div>
            {m.best_day && <div>💪 أقوى يوم بالأسبوع: <b>{m.best_day.day}</b> (معدل {val(m.best_day.avg, unit)})</div>}
            {m.worst_day && <div>🐢 أضعف يوم: <b>{m.worst_day.day}</b> (معدل {val(m.worst_day.avg, unit)})</div>}
            {m.next_month != null && (
              <div className="text-secondary" style={{ fontSize: "0.78rem" }}>
                التوقع مبني على نمو الأشهر الماضية ({m.growth_pct > 0 ? "+" : ""}{m.growth_pct}% بالشهر){m.confidence === "low" ? " — دقته بتزيد كل ما زادت الأشهر المسجّلة" : ""}.
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function MeterSettings({ settings, onSaved, onClose }) {
  const [unit, setUnit] = useState(settings.meter_unit);
  const [liters, setLiters] = useState(String(settings.bottle_liters));
  const [err, setErr] = useState("");
  async function save() {
    try {
      onSaved(await api.saveCashSettings({ meter_unit: unit, bottle_liters: Number(liters) }));
    } catch (e) { setErr(e.message); }
  }
  return (
    <div className="sub-card">
      {err && <div className="error-box">{err}</div>}
      <div className="field">
        <label>العداد بيقرأ بـ</label>
        <div className="seg">
          <button type="button" className={unit === "liter" ? "on" : ""} onClick={() => setUnit("liter")}>لتر</button>
          <button type="button" className={unit === "m3" ? "on" : ""} onClick={() => setUnit("m3")}>متر مكعب (م³)</button>
        </div>
      </div>
      <div className="field">
        <label>سعة القارورة (لتر)</label>
        <input type="number" inputMode="decimal" value={liters} onChange={(e) => setLiters(e.target.value)} />
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="fc-btn primary" style={{ flex: 1 }} onClick={save}>حفظ</button>
        <button className="fc-btn" style={{ flex: 1 }} onClick={onClose}>إلغاء</button>
      </div>
    </div>
  );
}

function ArchiveList({ onOpenDay }) {
  const [history, setHistory] = useState(null);
  const [open, setOpen] = useState(null);
  const [days, setDays] = useState({});
  useEffect(() => { api.getCashHistory().then(setHistory).catch(() => setHistory([])); }, []);
  async function toggle(p) {
    if (open === p.id) return setOpen(null);
    setOpen(p.id);
    if (!days[p.id]) {
      const r = await api.getCashHistoryPeriod(p.id).catch(() => null);
      if (r) setDays((x) => ({ ...x, [p.id]: r.entries }));
    }
  }
  if (!history) return <div className="card"><p className="text-secondary">جاري التحميل...</p></div>;
  return (
    <div className="card" style={{ padding: 0 }}>
      {history.length === 0 && <p className="text-secondary" style={{ padding: 14 }}>لا يوجد فترات مؤرشفة بعد.</p>}
      {history.map((p) => (
        <div key={p.id} className="arch-row">
          <button className="arch-head" onClick={() => toggle(p)}>
            <div style={{ minWidth: 0, textAlign: "right" }}>
              <div style={{ fontWeight: 700 }}>
                {p.first_day ? `${shortDay(p.first_day)} ← ${shortDay(p.last_day)}` : new Date(p.ended_at).toLocaleDateString("ar-JO")}
              </div>
              <div className="text-secondary tabular-num" style={{ fontSize: "0.78rem" }}>{p.days_count} يوم · صرفيات {money(p.final_expenses)}</div>
            </div>
            <div style={{ textAlign: "left" }}>
              <div className="tabular-num" style={{ fontWeight: 800, color: "var(--success)" }}>{money(p.final_sales)}</div>
              <div className="tabular-num text-secondary" style={{ fontSize: "0.78rem" }}>كاش {money(p.final_cash)}</div>
            </div>
            <FiChevronDown style={{ transform: open === p.id ? "rotate(180deg)" : "none", transition: "transform .2s", flex: "0 0 auto" }} />
          </button>
          {open === p.id && (
            <div className="arch-days">
              {!days[p.id] && <p className="text-secondary">جاري التحميل...</p>}
              {days[p.id]?.map((e) => (
                <button key={e.id} className="arch-day" onClick={() => onOpenDay(e.entry_date)}>
                  <span className="tabular-num"><FiEdit2 size={12} style={{ opacity: 0.5 }} /> {shortDay(e.entry_date)}</span>
                  <span className="tabular-num" style={{ color: "var(--success)" }}>+{Number(e.sales_amount).toFixed(2)}</span>
                  <span className="tabular-num" style={{ color: "var(--urgent)" }}>-{Number(e.expense_amount).toFixed(2)}</span>
                </button>
              ))}
              <p className="text-secondary" style={{ fontSize: "0.75rem", margin: "6px 0 0" }}>أي تعديل هون بيضل بهالفترة المؤرشفة — ما بينضاف للشهر الحالي.</p>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export default function Cash() {
  const { canEdit } = usePerms();
  const canEditCash = canEdit("cash");
  const today = getJordanToday();

  const [data, setData] = useState(() => peek("/cash/current") || null);
  const [showHistory, setShowHistory] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [insightsKey, setInsightsKey] = useState(0);

  const [selectedDate, setSelectedDate] = useState(today);
  const [day, setDay] = useState(null);
  const [dayLoading, setDayLoading] = useState(false);
  const [sales, setSales] = useState("");
  const [expenses, setExpenses] = useState("");
  const [notes, setNotes] = useState("");
  const [meter, setMeter] = useState("");
  const [bottlesTotal, setBottlesTotal] = useState("");
  const [bottlesDelivery, setBottlesDelivery] = useState("");
  const [showMeterSettings, setShowMeterSettings] = useState(false);

  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const formRef = useRef(null);

  async function load() {
    try { setData(await api.getCashCurrent()); } catch (err) { setError(err.message); }
  }

  async function loadDay(date) {
    setDayLoading(true);
    setError("");
    setSuccess("");
    try {
      const r = await api.getCashEntry(date);
      setDay(r);
      const e = r.entry;
      setSales(e ? String(Number(e.sales_amount) || "") : "");
      setExpenses(e ? String(Number(e.expense_amount) || "") : "");
      setNotes(e?.notes || "");
      setMeter(e?.meter_reading != null ? String(Number(e.meter_reading)) : "");
      setBottlesTotal(e?.bottles_total != null ? String(e.bottles_total) : "");
      setBottlesDelivery(e?.bottles_delivery != null ? String(e.bottles_delivery) : "");
    } catch (err) {
      setError(err.message);
    } finally {
      setDayLoading(false);
    }
  }

  useEffect(() => { load(); }, []);
  useEffect(() => { loadDay(selectedDate); }, [selectedDate]);

  function goToDate(date) {
    if (!date) return;
    setSelectedDate(date > today ? today : date);
  }
  function openDay(date) {
    goToDate(date);
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // حساب العداد مباشرة وإنت بتكتب
  const meterCalc = useMemo(() => {
    if (!day || meter === "" || !day.prev_meter) return null;
    const diff = Number(meter) - Number(day.prev_meter.meter_reading);
    if (!Number.isFinite(diff)) return null;
    if (diff < 0) return { error: "القراءة أقل من آخر قراءة — تأكد من الرقم" };
    const liters = diff * (day.settings.meter_unit === "m3" ? 1000 : 1);
    return { liters: Math.round(liters * 10) / 10, bottles: Math.round(liters / day.settings.bottle_liters) };
  }, [meter, day]);

  const autoTotal = meterCalc?.bottles ?? null;
  const effTotal = bottlesTotal !== "" ? Number(bottlesTotal) : autoTotal;
  const effDelivery = bottlesDelivery !== "" ? Number(bottlesDelivery) : day?.delivery_auto ?? 0;
  const effShop = effTotal != null ? Math.max(0, effTotal - effDelivery) : null;

  async function handleSave() {
    setError("");
    setSuccess("");
    const nums = [sales, expenses].map((x) => (x === "" ? 0 : Number(x)));
    if (nums.some((x) => !Number.isFinite(x) || x < 0)) return setError("تأكد إن الأرقام صحيحة.");
    setSaving(true);
    try {
      const r = await api.saveCashEntry({
        entry_date: selectedDate, sales_amount: sales, expense_amount: expenses, notes: notes.trim(),
        meter_reading: meter, bottles_total: bottlesTotal, bottles_delivery: bottlesDelivery,
      });
      const wasExisting = !!day?.entry;
      await Promise.all([load(), loadDay(selectedDate)]);
      setInsightsKey((k) => k + 1);
      setSuccess(r.in_closed_period ? "انحفظ بالأرشيف ✓ (ما انضاف للشهر الحالي)" : wasExisting ? "تم تعديل اليوم ✓" : "تم حفظ اليوم ✓");
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    if (!data) return;
    const confirmed = confirm(
      `أرشفة الحساب الحالي وبدء فترة جديدة؟\n\nالمبيعات: ${data.total_sales.toFixed(2)} JD\nالصرفيات: ${data.total_expenses.toFixed(2)} JD\nالكاش المتوقع: ${data.expected_cash.toFixed(2)} JD\n\nالأرقام بتنحفظ بالأرشيف، وبتقدر ترجع تعدّلها بأي وقت.`
    );
    if (!confirmed) return;
    setResetting(true);
    setError("");
    try {
      await api.resetCashPeriod();
      setShowHistory(false);
      await load();
      loadDay(selectedDate);
    } catch (err) {
      setError(err.message);
    } finally {
      setResetting(false);
    }
  }

  if (!data) {
    return (
      <div className="page">
        <h1 className="title-lg">الحساب اليومي</h1>
        <div className="card"><div className="skeleton" style={{ height: 160 }} /></div>
      </div>
    );
  }

  const isToday = selectedDate === today;
  const inClosed = !!day?.entry?.in_closed_period;
  const prev = day?.prev_meter;

  return (
    <div className="page">
      <h1 className="title-lg">الحساب اليومي</h1>
      {error && <div className="error-box">{error}</div>}
      <ViewOnlyNote section="cash" />

      <InsightsCard key={insightsKey} />

      <div className="card" ref={formRef}>
        <h2 className="title-md">{isToday ? "إدخال اليوم" : "تعديل يوم سابق"}</h2>

        <div className="date-nav">
          <button className="date-nav-btn" onClick={() => goToDate(shiftDate(selectedDate, -1))} aria-label="اليوم اللي قبل"><FiChevronRight /></button>
          <input type="date" value={selectedDate} max={today} onChange={(e) => goToDate(e.target.value)} />
          <button className="date-nav-btn" disabled={isToday} onClick={() => goToDate(shiftDate(selectedDate, 1))} aria-label="اليوم اللي بعد"><FiChevronLeft /></button>
        </div>
        <div className="text-secondary" style={{ fontSize: "0.85rem", margin: "6px 0 10px", display: "flex", justifyContent: "space-between", gap: 8 }}>
          <span>{formatDayLabel(selectedDate)}</span>
          {!isToday && <button className="link-btn" onClick={() => goToDate(today)}>رجوع لليوم</button>}
        </div>

        {dayLoading || !day ? (
          <div className="skeleton" style={{ height: 180 }} />
        ) : (
          <>
            {inClosed && (
              <div className="note-box"><FiArchive /> هذا اليوم من فترة مؤرشفة — التعديل بيضل بالأرشيف وما بينضاف للشهر الحالي.</div>
            )}
            {!day.entry && canEditCash && <p className="text-secondary" style={{ fontSize: "0.85rem", marginTop: 0 }}>هذا اليوم مش مسجّل — عبّي الأرقام واحفظ.</p>}

            <div className="field-row">
              <div className="field">
                <label>المبيعات (JD)</label>
                <input type="number" inputMode="decimal" step="0.01" min="0" value={sales} onChange={(e) => setSales(e.target.value)} placeholder="0" readOnly={!canEditCash} />
              </div>
              <div className="field">
                <label>الصرفيات (JD)</label>
                <input type="number" inputMode="decimal" step="0.01" min="0" value={expenses} onChange={(e) => setExpenses(e.target.value)} placeholder="0" readOnly={!canEditCash} />
              </div>
            </div>

            <div className="bottles-box">
              <div className="bottles-box-h">
                <span>🧴 القوارير المباعة</span>
                {canEditCash && (
                  <button className="link-btn" onClick={() => setShowMeterSettings((s) => !s)}><FiSettings size={13} /> إعدادات العداد</button>
                )}
              </div>
              {showMeterSettings && (
                <MeterSettings settings={day.settings} onClose={() => setShowMeterSettings(false)} onSaved={() => { setShowMeterSettings(false); loadDay(selectedDate); }} />
              )}

              <div className="field" style={{ marginBottom: 6 }}>
                <label>قراءة عداد المي ({day.settings.meter_unit === "m3" ? "م³" : "لتر"}) — آخر الدوام</label>
                <input type="number" inputMode="decimal" step="any" min="0" value={meter} onChange={(e) => setMeter(e.target.value)} placeholder={prev ? `آخر قراءة: ${prev.meter_reading}` : "مثلاً 12540"} readOnly={!canEditCash} />
              </div>
              <div className="meter-hint">
                {!prev && meter !== "" && "أول قراءة ✓ — من القراءة الجاية بيحسب القوارير لحاله."}
                {!prev && meter === "" && "اكتب رقم العداد كل يوم، والنظام بيحسب كم لتر طلع ويقسمه على سعة القارورة."}
                {prev && meterCalc?.error && <span style={{ color: "var(--urgent)" }}>{meterCalc.error}</span>}
                {prev && meterCalc && !meterCalc.error && (
                  <>من آخر قراءة ({shortDay(prev.date)}): <b className="tabular-num">{meterCalc.liters} لتر</b> ÷ {day.settings.bottle_liters} = <b className="tabular-num">{meterCalc.bottles} قارورة</b></>
                )}
                {prev && meter === "" && <>آخر قراءة: <b className="tabular-num">{prev.meter_reading}</b> ({shortDay(prev.date)})</>}
              </div>

              <div className="field-row" style={{ marginTop: 8 }}>
                <div className="field">
                  <label>المجموع</label>
                  <input type="number" inputMode="numeric" min="0" value={bottlesTotal} onChange={(e) => setBottlesTotal(e.target.value)}
                    placeholder={autoTotal != null ? `${autoTotal} (من العداد)` : "يدوي"} readOnly={!canEditCash} />
                </div>
                <div className="field">
                  <label>منها توصيل</label>
                  <input type="number" inputMode="numeric" min="0" value={bottlesDelivery} onChange={(e) => setBottlesDelivery(e.target.value)}
                    placeholder={`${day.delivery_auto} (من الرحلات)`} readOnly={!canEditCash} />
                </div>
              </div>
              <div className="bottles-split">
                <div><span>بالمحل</span><b className="tabular-num">{effShop != null ? effShop : "—"}</b></div>
                <div><span>توصيل</span><b className="tabular-num">{effDelivery}</b></div>
                <div className="tot"><span>المجموع</span><b className="tabular-num">{effTotal != null ? effTotal : "—"}</b></div>
              </div>
              <p className="text-secondary" style={{ fontSize: "0.75rem", margin: "6px 0 0" }}>
                المجموع بينحسب لحاله من العداد، والتوصيل من الرحلات — إذا بدك رقم ثاني اكتبه بإيدك وبيعتمده.
              </p>
            </div>

            <div className="field">
              <label>ملاحظة (اختياري)</label>
              <textarea rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="مثلاً: صرفنا على تصليح السيارة" readOnly={!canEditCash} />
            </div>

            {success && <div className="success-box" style={{ marginBottom: 8 }}>{success}</div>}

            {canEditCash && (
              <button className="btn-primary" disabled={saving} onClick={handleSave}>
                {saving ? "جاري الحفظ..." : day.entry ? "حفظ التعديل" : "حفظ اليوم"}
              </button>
            )}
          </>
        )}
      </div>

      <div className="card">
        <h2 className="title-md">المجموع منذ آخر أرشفة</h2>
        <div className="sum-row"><span>إجمالي المبيعات</span><span className="tabular-num" style={{ color: "var(--success)" }}>{money(data.total_sales)}</span></div>
        <div className="sum-row"><span>إجمالي الصرفيات</span><span className="tabular-num" style={{ color: "var(--urgent)" }}>{money(data.total_expenses)}</span></div>
        {data.total_bottles > 0 && <div className="sum-row"><span>القوارير المباعة</span><span className="tabular-num">{data.total_bottles} قارورة</span></div>}
        <div className="sum-row total"><span>الكاش المتوقع بالدرج</span><span className="tabular-num">{money(data.expected_cash)}</span></div>
      </div>

      <div className="card">
        <h2 className="title-md">جدول الأيام</h2>
        <p className="text-secondary" style={{ fontSize: "0.8rem", marginTop: 0 }}>اضغط على أي يوم لتعديله.</p>
        {data.entries.length === 0 && <p className="text-secondary">لا يوجد إدخالات بعد بهذه الفترة.</p>}
        {data.entries.length > 0 && (
          <div className="days-table">
            <div className="days-row head"><span>اليوم</span><span>مبيعات</span><span>صرفيات</span><span>قوارير</span></div>
            {[...data.entries].reverse().map((e) => (
              <button key={e.id} className={`days-row${e.entry_date === selectedDate ? " sel" : ""}`} onClick={() => openDay(e.entry_date)}>
                <span className="tabular-num"><FiEdit2 size={11} style={{ opacity: 0.45 }} /> {shortDay(e.entry_date)}</span>
                <span className="tabular-num" style={{ color: "var(--success)" }}>{Number(e.sales_amount).toFixed(2)}</span>
                <span className="tabular-num" style={{ color: "var(--urgent)" }}>{Number(e.expense_amount).toFixed(2)}</span>
                <span className="tabular-num">{e.bottles ?? "—"}</span>
                {e.notes && <small className="days-note">{e.notes}</small>}
              </button>
            ))}
          </div>
        )}
      </div>

      {canEditCash && (
        <button className="btn-danger-text" disabled={resetting} onClick={handleReset}>
          {resetting ? "جاري الأرشفة..." : "🗂️ أرشفة الحساب وبدء فترة جديدة"}
        </button>
      )}

      <button className="btn-secondary" style={{ marginTop: 10 }} onClick={() => setShowHistory((s) => !s)}>
        {showHistory ? "إخفاء الأرشيف" : "📁 أرشيف الفترات السابقة"}
      </button>
      {showHistory && <ArchiveList onOpenDay={openDay} />}
    </div>
  );
}
