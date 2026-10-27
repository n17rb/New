import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { FiSearch, FiChevronLeft } from "react-icons/fi";
import { api, peek } from "../api.js";
import { usePerms } from "../auth.jsx";

function greetingWord() {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Amman", hour: "numeric", hourCycle: "h23" }).format(new Date()));
  if (hour < 12) return "صباح الخير";
  if (hour < 18) return "مساء الخير";
  return "مساء النور";
}

function todayLabel() {
  return new Date().toLocaleDateString("ar-JO", { timeZone: "Asia/Amman", weekday: "long", day: "numeric", month: "long" });
}

export default function Dashboard({ user }) {
  const navigate = useNavigate();
  const { can } = usePerms();
  const [data, setData] = useState(() => peek("/dashboard") || null);
  const [error, setError] = useState("");
  const [myBalance, setMyBalance] = useState(null);

  useEffect(() => {
    api.getDashboard().then((d) => { setData(d); setError(""); }).catch((err) => { if (!peek("/dashboard")) setError(err.message); });
    if (can("delivery", "edit")) {
      api.getDriverBalance(user.id).then((d) => setMyBalance(d.balance)).catch(() => {});
    }
  }, [user.id]);

  // «أبو محمد» و«أم علي» بينادوا بالكنية كاملة
  const parts = (user.full_name || "").trim().split(/\s+/);
  const firstName = ["أبو", "ابو", "أم", "ام"].includes(parts[0]) && parts[1] ? `${parts[0]} ${parts[1]}` : parts[0];
  const canTrips = can("trips") || can("delivery", "edit");
  const n = (v) => (data ? v ?? 0 : "–");

  return (
    <div className="page">
      <div className="home-hello">
        <div className="home-greet">{greetingWord()} {firstName}</div>
        <div className="home-date">{todayLabel()}</div>
      </div>

      <div className="home-today" aria-busy={!data}>
        <div className="home-today-glow" aria-hidden="true" />
        <div className="home-stats">
          <button className="home-stat s-blue" onClick={() => navigate("/orders")}>
            <b className="tabular-num">{n(data?.new_orders)}</b>
            <span>طلبات جديدة</span>
          </button>
          <button className="home-stat s-amber" onClick={() => navigate("/trip")}>
            <b className="tabular-num">{n(data?.in_route)}</b>
            <span>بالطريق</span>
          </button>
          <button className="home-stat s-green" onClick={() => navigate(can("reports") ? "/reports" : "/orders")}>
            <b className="tabular-num">{n(data?.delivered_today)}</b>
            <span>تسلّمت اليوم</span>
          </button>
        </div>
        {data?.delivered_value_today != null && (
          <div className="home-value">
            <span>مبيعات اليوم</span>
            <b className="tabular-num">{Number(data.delivered_value_today).toFixed(2)} <small>JD</small></b>
          </div>
        )}
      </div>

      {error && <div className="error-box">{error}</div>}

      <Link to="/customers" className="home-search">
        <FiSearch aria-hidden="true" />
        <span>دوّر على زبون…</span>
      </Link>

      {data?.needs_quantity > 0 && (
        <Link to="/orders" className="home-alert">
          <span className="home-alert-dot" aria-hidden="true" />
          <span style={{ flex: 1 }}>
            {data.needs_quantity === 1 ? "طلب تلقائي واحد" : `${data.needs_quantity} طلبات تلقائية`} لسا ما انحددت كميتها
          </span>
          <FiChevronLeft aria-hidden="true" />
        </Link>
      )}

      {/* قائمة بسيطة بدون أيقونات — بس الإشي اللي بيهمك اليوم */}
      <div className="home-list">
        <Link to="/notifications?tab=schedule" className="home-row">
          <span className="home-row-t">مواعيد اليوم</span>
          <span className="home-row-v">{data ? (data.appointments_today ? `${data.appointments_today} زبون` : "ما في") : "–"}</span>
          <FiChevronLeft className="home-row-c" aria-hidden="true" />
        </Link>
        {data && data.forecast_today != null && (
          <Link to={data.forecast_today === 0 && data.forecast_late > 0 ? "/forecast?tab=late" : "/forecast"} className="home-row">
            <span className="home-row-t">مفروض يطلبوا اليوم</span>
            <span className="home-row-v">
              {data.forecast_today > 0 ? `${data.forecast_today} زبون` : "ما في"}
              {data.forecast_late > 0 && <em> · {data.forecast_late} متأخر</em>}
            </span>
            <FiChevronLeft className="home-row-c" aria-hidden="true" />
          </Link>
        )}
        {canTrips && (
          <Link to="/trip" className="home-row">
            <span className="home-row-t">الرحلات</span>
            <span className="home-row-v">{data ? (data.active_trips ? `${data.active_trips} شغّالة` : "ما في رحلة") : "–"}</span>
            <FiChevronLeft className="home-row-c" aria-hidden="true" />
          </Link>
        )}
        {data?.debts_total > 0 && (
          <Link to="/debts" className="home-row">
            <span className="home-row-t">ديون الزباين</span>
            <span className="home-row-v red tabular-num">{Number(data.debts_total).toFixed(2)} JD</span>
            <FiChevronLeft className="home-row-c" aria-hidden="true" />
          </Link>
        )}
        {myBalance !== null && myBalance !== 0 && (
          <Link to="/my-balance" className="home-row">
            <span className="home-row-t">رصيدي للمحل</span>
            <span className="home-row-v tabular-num">{myBalance.toFixed(2)} JD</span>
            <FiChevronLeft className="home-row-c" aria-hidden="true" />
          </Link>
        )}
      </div>
    </div>
  );
}
