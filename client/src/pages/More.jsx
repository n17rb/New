import { Link } from "react-router-dom";
import {
  FiDollarSign, FiCreditCard, FiBox, FiArchive, FiBarChart2, FiTrendingUp, FiUserPlus, FiClock,
  FiMap, FiShield, FiMapPin, FiList, FiDatabase, FiEdit3, FiMoon, FiLogOut, FiChevronLeft, FiCalendar,
} from "react-icons/fi";
import { usePerms } from "../auth.jsx";

export const ROLE_LABELS = {
  super_admin: "المدير العام",
  admin: "مساعد مدير",
  driver: "كابتن توصيل",
  data_entry: "موظف إدخال",
  viewer: "متفرج",
  staff: "موظف",
};

function Row({ to, icon: Icon, title, sub }) {
  return (
    <Link to={to} className="list-row">
      <span className="list-icon"><Icon aria-hidden="true" /></span>
      <span className="list-text">
        <span className="list-title">{title}</span>
        {sub && <div className="list-sub">{sub}</div>}
      </span>
      <FiChevronLeft className="list-chevron" aria-hidden="true" />
    </Link>
  );
}

function Group({ title, children }) {
  const rows = (Array.isArray(children) ? children : [children]).flat().filter(Boolean);
  if (rows.length === 0) return null;
  return (
    <>
      <div className="section-title">{title}</div>
      <div className="list-group">{rows}</div>
    </>
  );
}

export default function More({ darkMode, setDarkMode, onLogout }) {
  const { user, can, isOwner } = usePerms();
  const initial = (user.full_name || "?").trim().charAt(0);

  return (
    <div className="page">
      <div className="card icon-row" style={{ marginTop: 6 }}>
        <span className="avatar">{initial}</span>
        <div>
          <div style={{ fontWeight: 700 }}>{user.full_name}</div>
          <div className="text-secondary">{ROLE_LABELS[user.role] || "موظف"}</div>
        </div>
      </div>

      <Group title="الشغل اليومي">
        {can("cash") && <Row key="cash" to="/cash" icon={FiDollarSign} title="الحساب اليومي" sub="مبيعات وصرفيات كل يوم" />}
        <Row key="schedule" to="/notifications?tab=schedule" icon={FiCalendar} title="المواعيد" sub="زباين أيام التسليم الثابتة" />
        {can("delivery", "edit") && <Row key="mybal" to="/my-balance" icon={FiCreditCard} title="رصيدي" sub="الكاش والكوبونات اللي معي" />}
        {can("driver_balances") && <Row key="bal" to="/driver-balances" icon={FiCreditCard} title="ذمم الكباتن" />}
        {can("products") && <Row key="prod" to="/products" icon={FiBox} title="المنتجات والأسعار" />}
        {can("trips") && <Row key="arch" to="/trip-archive" icon={FiArchive} title="أرشيف الرحلات" />}
      </Group>

      <Group title="التقارير">
        {can("reports") && <Row key="rep" to="/reports" icon={FiBarChart2} title="التقارير" />}
        {can("reports") && <Row key="perf" to="/driver-performance" icon={FiTrendingUp} title="أداء الكباتن" />}
        {can("reports") && <Row key="growth" to="/customer-growth" icon={FiUserPlus} title="نمو العملاء" />}
        {can("reports") && <Row key="over" to="/overdue-customers" icon={FiClock} title="عملاء متأخرين عن طلبهم" />}
        {can("reports") && <Row key="map" to="/customers-map" icon={FiMap} title="خريطة العملاء" />}
      </Group>

      <Group title="الإدارة">
        {isOwner && <Row key="users" to="/users" icon={FiShield} title="الموظفين والصلاحيات" sub="مين بيشوف شو، ومين بيعدّل" />}
        {can("settings") && <Row key="set" to="/settings" icon={FiMapPin} title="إعدادات المحل" sub="موقع المحل" />}
        {can("activity_log") && <Row key="log" to="/activity-log" icon={FiList} title="سجل النشاط" />}
        {can("backup") && <Row key="backup" to="/backup" icon={FiDatabase} title="النسخ الاحتياطي" />}
      </Group>

      <div className="section-title">حسابي</div>
      <div className="list-group">
        <Row to="/notes" icon={FiEdit3} title="ملاحظاتي" />
        <label className="list-row" style={{ cursor: "pointer" }}>
          <span className="list-icon"><FiMoon aria-hidden="true" /></span>
          <span className="list-text"><span className="list-title">الوضع الليلي</span></span>
          <span className="switch">
            <input type="checkbox" checked={darkMode} onChange={(e) => setDarkMode(e.target.checked)} />
            <span />
          </span>
        </label>
        <button className="list-row" onClick={onLogout} style={{ color: "var(--urgent)" }}>
          <span className="list-icon" style={{ background: "var(--urgent-soft)", color: "var(--urgent)" }}><FiLogOut aria-hidden="true" /></span>
          <span className="list-text"><span className="list-title">تسجيل الخروج</span></span>
        </button>
      </div>
    </div>
  );
}
