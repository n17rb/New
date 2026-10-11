import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { FiRotateCcw, FiInfo } from "react-icons/fi";
import { api } from "../api.js";
import { usePerms } from "../auth.jsx";
import { ForecastRow, qtyWord } from "../components/Forecast.jsx";

const TABS = [
  { key: "today", label: "اليوم" },
  { key: "tomorrow", label: "بكرة" },
  { key: "late", label: "متأخرين" },
  { key: "lost", label: "منقطعين" },
];

const EMPTY = {
  today: "ما في حدا مفروض يطلب اليوم 👌",
  tomorrow: "ما في حدا متوقع بكرة",
  late: "ما في ولا زبون متأخر عن موعده 🎉",
  lost: "ما في زباين منقطعين",
};

function shortDate(iso) {
  return new Date(iso).toLocaleDateString("ar-JO", { timeZone: "Asia/Amman", day: "numeric", month: "long" });
}

export default function Forecast() {
  const { canEdit } = usePerms();
  const canConfigure = canEdit("settings");
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.key === params.get("tab")) ? params.get("tab") : "today";
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [showSnoozed, setShowSnoozed] = useState(false);

  function load() {
    api.getForecast().then(setData).catch((err) => setError(err.message));
  }
  useEffect(load, []);

  async function reset() {
    const n = (data?.late.length || 0) + (data?.lost.length || 0);
    if (!confirm(`تصفير المتأخرين؟\n${n ? `${n} زبون رح ينشالوا من قائمة المتأخرين والمنقطعين.` : ""}\nمن هون وطالع أي زبون بيتأخر عن موعده بيطلع بالقائمة وبيوصلك إشعار فيه.`)) return;
    setBusy(true);
    setError("");
    try {
      const r = await api.resetForecast();
      setMessage(r.cleared ? `تم التصفير — انشال ${r.cleared} زبون من القائمة. من هلّق وطالع بس الجديد بيطلع.` : "تم التصفير.");
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function undoReset() {
    setBusy(true);
    try {
      await api.undoForecastReset();
      setMessage("رجعت القائمة الكاملة.");
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function setMinOrders(n) {
    try {
      await api.setForecastSettings({ min_orders: n });
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  const list = data ? (tab === "lost" ? [...data.lost, ...data.stale.map((f) => ({ ...f, _stale: true }))] : data[tab]) : [];

  return (
    <div className="page">
      <h1 className="title-lg">توقعات الطلبات</h1>
      <p className="text-secondary" style={{ marginTop: -6, marginBottom: 14, fontSize: "0.85rem" }}>
        النظام بيتعلم من طلبات كل زبون: كم بيسحب، كم ضايل عنده، ومتى مفروض يطلب.
      </p>

      {error && <div className="error-box">{error}</div>}
      {message && <div className="success-box">{message}</div>}

      <div className="today-strip" aria-busy={!data}>
        <button className="today-cell" onClick={() => setParams({ tab: "today" })}>
          <div className="today-num tabular-num">{data ? data.today.length : "–"}</div>
          <div className="today-label">{data && data.expected_bottles_today ? `اليوم · ${qtyWord(data.expected_bottles_today)}` : "اليوم"}</div>
        </button>
        <button className="today-cell" onClick={() => setParams({ tab: "tomorrow" })}>
          <div className="today-num tabular-num">{data ? data.tomorrow.length : "–"}</div>
          <div className="today-label">بكرة</div>
        </button>
        <button className="today-cell" onClick={() => setParams({ tab: "late" })}>
          <div className="today-num tabular-num" style={{ color: data?.late.length ? "var(--urgent)" : undefined }}>{data ? data.late.length : "–"}</div>
          <div className="today-label">متأخرين</div>
        </button>
      </div>

      <div className="seg" role="tablist" style={{ marginBottom: 12 }}>
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} className={tab === t.key ? "on" : ""} onClick={() => setParams({ tab: t.key })}>
            {t.label}
            {data && t.key === "late" && data.late.length > 0 && ` (${data.late.length})`}
          </button>
        ))}
      </div>

      {!data && !error && <p className="text-secondary">جاري الحساب...</p>}

      {data && list.length === 0 && <div className="card text-secondary">{EMPTY[tab]}</div>}

      {data && tab === "lost" && data.stale.length > 0 && (
        <p className="text-secondary icon-row" style={{ fontSize: "0.78rem", margin: "0 4px 8px" }}>
          <FiInfo aria-hidden="true" style={{ flexShrink: 0 }} />
          اللي كانوا متأخرين قبل التصفير ({shortDate(data.settings.reset_at)}) بيضلّوا هون وما بيوصل عنهم إشعار — لحد ما يطلبوا من جديد.
        </p>
      )}

      {data && list.length > 0 && (
        <div className="list-group">
          {list.map((f) => (
            <ForecastRow key={f.customer_id} f={f} variant={f._stale ? "stale" : tab} onChanged={load} />
          ))}
        </div>
      )}

      {data && tab === "today" && data.snoozed.length > 0 && (
        <>
          <button className="btn-danger-text" style={{ color: "var(--text-secondary)", fontSize: "0.82rem", padding: "4px" }} onClick={() => setShowSnoozed((v) => !v)}>
            {showSnoozed ? "إخفاء" : "عرض"} المؤجلين ({data.snoozed.length})
          </button>
          {showSnoozed && (
            <div className="list-group" style={{ opacity: 0.75 }}>
              {data.snoozed.map((f) => <ForecastRow key={f.customer_id} f={f} variant="today" onChanged={load} />)}
            </div>
          )}
        </>
      )}

      {data && (
        <div className="card" style={{ marginTop: 18 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>كيف بيشتغل؟</div>
          <p className="text-secondary" style={{ margin: 0, fontSize: "0.82rem", lineHeight: 1.7 }}>
            بعد ما الزبون ياخذ {data.settings.min_orders} طلبات مسلّمة، النظام بيحسب كم قارورة بيخلّص باليوم، وبيتوقع متى رح تخلص عنده.
            كل يوم الصبح بيوصلك إشعار بمين مفروض يطلب اليوم، ومين تأخر عن موعده.
            {data.learning_count > 0 && ` لسا في ${data.learning_count} زبون النظام بيتعلم عادتهم.`}
          </p>

          {canConfigure && (
            <>
              <div className="field" style={{ marginTop: 14, marginBottom: 12 }}>
                <label>يبدأ يتوقع بعد كم طلب؟</label>
                <div className="seg">
                  {[2, 3, 4, 5].map((n) => (
                    <button key={n} className={data.settings.min_orders === n ? "on" : ""} onClick={() => setMinOrders(n)}>
                      {n} طلبات
                    </button>
                  ))}
                </div>
              </div>
              <button className="btn-secondary icon-row" style={{ justifyContent: "center" }} disabled={busy} onClick={reset}>
                <FiRotateCcw aria-hidden="true" /> صفّر المتأخرين وابدأ من جديد
              </button>
              {data.settings.reset_at && (
                <div className="text-secondary" style={{ fontSize: "0.75rem", marginTop: 8, textAlign: "center" }}>
                  آخر تصفير: {shortDate(data.settings.reset_at)} ·{" "}
                  <button className="btn-danger-text" style={{ display: "inline", padding: 0, fontSize: "0.75rem", color: "var(--primary)", width: "auto" }} disabled={busy} onClick={undoReset}>
                    رجّع القائمة الكاملة
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
