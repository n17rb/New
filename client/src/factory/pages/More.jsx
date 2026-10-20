import { useNavigate } from "react-router-dom";
import { FiUsers, FiTruck, FiBox, FiDollarSign, FiBarChart2, FiBell, FiBriefcase, FiShield, FiSettings, FiCheckSquare, FiCreditCard, FiMessageSquare, FiList, FiZap, FiPlayCircle, FiLogOut, FiChevronLeft, FiUser, FiMap } from "react-icons/fi";
import { useFx } from "../ui.jsx";
import PushCard from "../PushCard.jsx";

export default function More({ onLogout }) {
  const fx = useFx();
  const nav = useNavigate();
  const items = [
    { to: "/f/customers", icon: FiUsers, label: "العملاء", hint: "بياناتهم وطلباتهم وكشف حسابهم" },
    (fx.can("f_dispatch") || fx.can("f_home")) && { to: "/f/live", icon: FiMap, label: "وين السيارات", hint: "كل السيارات على الخريطة ولوين متجهة" },
    (fx.can("f_dispatch") || fx.can("f_home")) && { to: "/f/trips", icon: FiTruck, label: "الرحلات", hint: "وين كل سيارة وشو ضل عليها" },
    (fx.can("f_stock") || fx.can("f_production") || fx.can("f_home")) && { to: "/f/stock", icon: FiBox, label: "المستودع والإنتاج", hint: "الأرصدة، التحميل، التالف، المكنات" },
    (fx.can("f_money") || fx.can("f_home")) && { to: "/f/money", icon: FiDollarSign, label: "الحسابات", hint: "كاش السائقين، المصاريف، الديون" },
    (fx.can("f_reports") || fx.can("f_home")) && { to: "/f/reports", icon: FiBarChart2, label: "التقارير", hint: "المبيعات، التوالف، الديزل، السائقين" },
    (fx.can("f_home") || fx.can("f_money") || fx.can("f_dispatch")) && { to: "/f/alerts", icon: FiBell, label: "التنبيهات" },
    fx.can("payroll") && { to: "/payroll", icon: FiBriefcase, label: "الموظفين والرواتب", hint: "الدوام، اليوميات، السلف، الضمان" },
    { to: "/my-pay", icon: FiUser, label: "راتبي ودوامي" },
    fx.isOwner && { to: "/users", icon: FiShield, label: "حسابات الموظفين والصلاحيات", hint: "مين بيدخل وشو بيشوف" },
    fx.can("f_fleet") && { to: "/f/settings", icon: FiSettings, label: "الإعدادات", hint: "الشعار، المنتجات، السيارات، الخطوط، المكنات" },
    fx.isOwner && { to: "/f/setup", icon: FiCheckSquare, label: "تجهيز المصنع خطوة بخطوة" },
    fx.can("activity_log") && { to: "/activity-log", icon: FiList, label: "سجل النشاط" },
    fx.isOwner && !fx.shop?.is_home && { to: "/subscription", icon: FiCreditCard, label: "الاشتراك" },
    fx.isOwner && !fx.shop?.is_home && { to: "/support", icon: FiMessageSquare, label: "الدعم الفني" },
  ].filter(Boolean);
  return (
    <div className="fx-page">
      <h1 className="fx-h1">المزيد</h1>
      <PushCard always who={fx.can("f_home") ? "admin" : "driver"} />
      <div className="fx-list">
        {items.map((i) => (
          <button key={i.to} className="fx-item" onClick={() => nav(i.to)}>
            <span className="fx-avatar"><i.icon /></span>
            <span className="t"><b>{i.label}</b>{i.hint && <span>{i.hint}</span>}</span>
            <FiChevronLeft style={{ color: "var(--fx-muted)" }} />
          </button>
        ))}
      </div>
      <div className="fx-list">
        <button className="fx-item" onClick={fx.openHelp}><span className="fx-avatar"><FiZap /></span><span className="t"><b>المساعد</b><span>اسأل كيف تعمل أي إشي</span></span></button>
        <button className="fx-item" onClick={() => { try { localStorage.removeItem(`fx-tour-${fx.shop?.id}-${fx.user.id}`); Object.keys(localStorage).filter((k) => k.startsWith("fx-tip-")).forEach((k) => localStorage.removeItem(k)); } catch { /* تجاهل */ } window.location.reload(); }}>
          <span className="fx-avatar"><FiPlayCircle /></span><span className="t"><b>اعرض الشرح من أول</b><span>الجولة التعريفية والتلميحات</span></span>
        </button>
        <button className="fx-item" onClick={onLogout}><span className="fx-avatar" style={{ color: "var(--fx-crit)", background: "var(--fx-crit-soft)" }}><FiLogOut /></span><span className="t"><b>تسجيل خروج</b><span>{fx.user.full_name} · @{fx.user.username}</span></span></button>
      </div>
      <p className="fx-muted" style={{ textAlign: "center", margin: 0 }}>موج للمصانع</p>
    </div>
  );
}
