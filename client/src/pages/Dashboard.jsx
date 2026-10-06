import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { FiSearch, FiCalendar, FiTruck, FiCreditCard, FiChevronLeft, FiAlertCircle } from "react-icons/fi";
import { api } from "../api.js";
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
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [myBalance, setMyBalance] = useState(null);

  useEffect(() => {
    api.getDashboard().then(setData).catch((err) => setError(err.message));
    if (can("delivery", "edit")) {
      api.getDriverBalance(user.id).then((d) => setMyBalance(d.balance)).catch(() => {});
    }
  }, [user.id]);

  const firstName = (user.full_name || "").split(" ")[0];

  return (
    <div className="page">
      <div className="greeting">
        <h1>{greetingWord()} {firstName}</h1>
        <p>{todayLabel()}</p>
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

      <div className="today-strip" aria-busy={!data}>
        <button className="today-cell" onClick={() => navigate("/orders")}>
          <div className="today-num tabular-num">{data ? data.new_orders : "–"}</div>
          <div className="today-label">طلبات جديدة</div>
        </button>
        <button className="today-cell" onClick={() => navigate("/trip")}>
          <div className="today-num tabular-num">{data ? data.in_route : "–"}</div>
          <div className="today-label">بالطريق</div>
        </button>
        <button className="today-cell" onClick={() => navigate(can("reports") ? "/reports" : "/orders")}>
          <div className="today-num tabular-num">{data ? data.delivered_today : "–"}</div>
          <div className="today-label">تسلّمت اليوم</div>
        </button>
      </div>

      {data?.delivered_value_today != null && (
        <p className="text-secondary" style={{ margin: "-2px 4px 14px" }}>
          قيمة اللي تسلّم اليوم: <strong className="tabular-num" style={{ color: "var(--text)" }}>{Number(data.delivered_value_today).toFixed(2)} JD</strong>
        </p>
      )}

      <div className="list-group">
        <Link to="/customers" className="list-row">
          <span className="list-icon"><FiSearch aria-hidden="true" /></span>
          <span className="list-text"><span className="list-title">دوّر على عميل</span><div className="list-sub">بالاسم أو أول أرقام التلفون أو الرقم التسلسلي</div></span>
          <FiChevronLeft className="list-chevron" aria-hidden="true" />
        </Link>
        <Link to="/notifications?tab=schedule" className="list-row">
          <span className="list-icon"><FiCalendar aria-hidden="true" /></span>
          <span className="list-text">
            <span className="list-title">مواعيد اليوم</span>
            <div className="list-sub">{data ? (data.appointments_today ? `${data.appointments_today} زبون موعده اليوم` : "ما في مواعيد اليوم") : " "}</div>
          </span>
          <FiChevronLeft className="list-chevron" aria-hidden="true" />
        </Link>
        {(can("trips") || can("delivery", "edit")) && (
          <Link to="/trip" className="list-row">
            <span className="list-icon"><FiTruck aria-hidden="true" /></span>
            <span className="list-text">
              <span className="list-title">الرحلات</span>
              <div className="list-sub">{data ? (data.active_trips ? `${data.active_trips} رحلة شغّالة هلّق` : "ما في رحلات شغّالة") : " "}</div>
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
    </div>
  );
}
