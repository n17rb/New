import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { FiSearch, FiCalendar, FiTruck, FiCreditCard, FiChevronLeft, FiAlertCircle, FiDroplet, FiPackage } from "react-icons/fi";
import { qtyWord } from "../components/Forecast.jsx";
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

      {data?.needs_quantity > 0 && (
        <button className="alert-row" onClick={() => navigate("/orders")}>
          <FiAlertCircle size={20} aria-hidden="true" />
          <span style={{ flex: 1 }}>
            {data.needs_quantity === 1 ? "طلب تلقائي واحد" : `${data.needs_quantity} طلبات تلقائية`} لسا ما انحددت كميتها
          </span>
          <FiChevronLeft aria-hidden="true" />
        </button>
      )}

      <div className="home-tiles">
        <Link to="/customers" className="home-tile">
          <span className="home-tile-ic blue"><FiSearch aria-hidden="true" /></span>
          <span className="home-tile-t">دوّر على زبون</span>
          <span className="home-tile-s">بالاسم أو التلفون أو الرقم</span>
        </Link>
        {can("orders") && (
          <Link to="/orders" className="home-tile">
            <span className="home-tile-ic violet"><FiPackage aria-hidden="true" /></span>
            <span className="home-tile-t">الطلبات</span>
            <span className="home-tile-s">{data ? (data.new_orders ? `${data.new_orders} بستنى توزيع` : "كله موزّع") : " "}</span>
          </Link>
        )}
        {canTrips && (
          <Link to="/trip" className="home-tile">
            <span className="home-tile-ic green"><FiTruck aria-hidden="true" /></span>
            <span className="home-tile-t">الرحلات</span>
            <span className="home-tile-s">{data ? (data.active_trips ? `${data.active_trips} شغّالة هلّق` : "ما في رحلة شغّالة") : " "}</span>
          </Link>
        )}
        <Link to="/notifications?tab=schedule" className="home-tile">
          <span className="home-tile-ic amber"><FiCalendar aria-hidden="true" /></span>
          <span className="home-tile-t">مواعيد اليوم</span>
          <span className="home-tile-s">{data ? (data.appointments_today ? `${data.appointments_today} زبون` : "ما في مواعيد") : " "}</span>
        </Link>
      </div>

      {(data?.forecast_today != null || data?.debts_total > 0 || (myBalance !== null && myBalance !== 0)) && (
      <div className="list-group">
        {data && data.forecast_today != null && (
          <Link to={data.forecast_today === 0 && data.forecast_late > 0 ? "/forecast?tab=late" : "/forecast"} className="list-row">
            <span className="list-icon"><FiDroplet aria-hidden="true" /></span>
            <span className="list-text">
              <span className="list-title">توقعات اليوم</span>
              <div className="list-sub">
                {data.forecast_today > 0
                  ? `${data.forecast_today === 1 ? "زبون" : `${data.forecast_today} زباين`} مفروض يطلبوا (حوالي ${qtyWord(data.forecast_bottles)})`
                  : "ما في حدا متوقع اليوم"}
                {data.forecast_late > 0 && <span style={{ color: "var(--urgent)", fontWeight: 600 }}> · {data.forecast_late} متأخر</span>}
              </div>
            </span>
            <FiChevronLeft className="list-chevron" aria-hidden="true" />
          </Link>
        )}
        {data?.debts_total > 0 && (
          <Link to="/debts" className="list-row">
            <span className="list-icon" style={{ background: "var(--urgent-soft)", color: "var(--urgent)" }}><FiAlertCircle aria-hidden="true" /></span>
            <span className="list-text">
              <span className="list-title">ديون الزباين</span>
              <div className="list-sub tabular-num">{Number(data.debts_total).toFixed(2)} JD على {data.debtors_count} زبون</div>
            </span>
            <FiChevronLeft className="list-chevron" aria-hidden="true" />
          </Link>
        )}
        {myBalance !== null && myBalance !== 0 && (
          <Link to="/my-balance" className="list-row">
            <span className="list-icon"><FiCreditCard aria-hidden="true" /></span>
            <span className="list-text">
              <span className="list-title">رصيدي</span>
              <div className="list-sub tabular-num">{myBalance.toFixed(2)} JD مستحق للمحل</div>
            </span>
            <FiChevronLeft className="list-chevron" aria-hidden="true" />
          </Link>
        )}
      </div>
      )}
    </div>
  );
}
