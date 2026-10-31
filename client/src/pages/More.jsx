import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { api } from "../api.js";
import {
  FiDollarSign, FiCreditCard, FiBox, FiArchive, FiBarChart2, FiTrendingUp, FiUserPlus, FiDroplet,
  FiMap, FiShield, FiMapPin, FiList, FiDatabase, FiEdit3, FiMoon, FiLogOut, FiChevronLeft, FiCalendar,
  FiTag, FiAlertCircle, FiMessageCircle, FiClipboard, FiUsers, FiStar, FiHeadphones, FiGrid, FiBriefcase, FiMessageSquare, FiTarget,
  FiTruck, FiPackage, FiShoppingCart, FiBriefcase as FiCustody, FiPlus,
} from "react-icons/fi";
import { usePerms, useShop } from "../auth.jsx";
import { LogoMark } from "../components/Logo.jsx";

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
  const { user, can, canAction, isOwner } = usePerms();
  const shop = useShop();
  const initial = (user.full_name || "?").trim().charAt(0);
  const isManager = isOwner || can("settings", "edit");
  const subscriptionSub = shop?.access?.days_left != null ? `فعّال · باقي ${shop.access.days_left} يوم` : "الحالة والتجديد";

  return (
    <div className="page">
      <div className="card icon-row" style={{ marginTop: 6 }}>
        <span className="avatar">{initial}</span>
        <div>
          <div style={{ fontWeight: 700 }}>{user.full_name}</div>
          <div className="text-secondary">{ROLE_LABELS[user.role] || "موظف"}</div>
        </div>
      </div>

      {shop?.platform_admin && (
        <Link to="/platform" className="platform-entry">
          <LogoMark size={30} color="#fff" strokeWidth={4} />
          <span style={{ flex: 1 }}>
            <strong>لوحة إدارة موج</strong>
            <div style={{ fontSize: "0.78rem", opacity: 0.85 }}>المحلات المشتركة، الاشتراكات، الدفعات والدعم</div>
          </span>
          <FiChevronLeft aria-hidden="true" />
        </Link>
      )}

      <StationBlock can={can} feat={shop?.features || {}} />

      <Group title="الشغل اليومي">
        {(can("orders") || can("customers")) && <Row key="forecast" to="/forecast" icon={FiDroplet} title="توقعات الطلبات" sub="مين مفروض يطلب اليوم، ومين متأخر" />}
        {can("jard") && <Row key="jard" to="/jard" icon={FiClipboard} title="الجرد اليومي" sub="كم دخل وكم طلع، ومين قبض شو" />}
        {(can("customers") || can("jard")) && <Row key="bottles" to="/bottles" icon={FiDatabase} title="عهدة القوارير" sub="كم قارورة للمحل برا، وعند مين" />}
        {can("cash") && <Row key="cash" to="/cash" icon={FiDollarSign} title="الحساب اليومي" sub="مبيعات، صرفيات، قوارير، وكيف ماشي الشغل" />}
        {can("debts") && <Row key="debts" to="/debts" icon={FiAlertCircle} title="ديون العملاء" sub="مين عليه، وتذكير على واتساب" />}
        {can("coupons") && <Row key="coupons" to="/coupons" icon={FiTag} title="الكوبونات والباقات" sub="الباقات، المبيعات، واللي قربت تخلص" />}
        <Row key="schedule" to="/notifications?tab=schedule" icon={FiCalendar} title="المواعيد" sub="زباين أيام التسليم الثابتة" />
        {can("delivery", "edit") && <Row key="mybal" to="/my-balance" icon={FiCreditCard} title="رصيدي" sub="الكاش والكوبونات اللي معي" />}
        {can("driver_balances") && <Row key="bal" to="/driver-balances" icon={FiCreditCard} title="ذمم الكباتن" />}
        {can("products") && <Row key="prod" to="/products" icon={FiBox} title="المنتجات والأسعار" />}
        {can("trips") && <Row key="arch" to="/trip-archive" icon={FiArchive} title="أرشيف الرحلات" sub="كل رحلة على الخريطة: وين راح الكابتن وكيف ترتّبت" />}
      </Group>

      <Group title="التقارير">
        {(can("reports") || can("cash")) && <Row key="swot" to="/swot" icon={FiTarget} title="تحليل SWOT" sub="نقاط القوة والضعف والفرص والمخاطر — من أرقام محلك" />}
        {can("reports") && <Row key="rep" to="/reports" icon={FiBarChart2} title="التقارير" />}
        {can("reports") && <Row key="perf" to="/driver-performance" icon={FiTrendingUp} title="أداء الكباتن" />}
        {can("reports") && <Row key="growth" to="/customer-growth" icon={FiUserPlus} title="نمو العملاء" />}
        {can("reports") && <Row key="map" to="/customers-map" icon={FiMap} title="خريطة العملاء" />}
      </Group>

      <Group title="الإدارة">
        {can("payroll") && <Row key="payroll" to="/payroll" icon={FiBriefcase} title="الدوام والرواتب" sub="مين داوم، الرواتب واليوميات، السحوبات" />}
        {isOwner && <Row key="users" to="/users" icon={FiShield} title="الحسابات والصلاحيات" sub="مين بيشوف شو، ومين بيعدّل" />}
        {can("settings") && <Row key="set" to="/settings" icon={FiMapPin} title="إعدادات المحل" sub="موقع المحل" />}
        {isManager && <Row key="msgs" to="/settings/messages" icon={FiMessageSquare} title="نصوص الرسائل" sub="رسائل الواتساب للزباين: الفاتورة، الدين، «أنا جاي»…" />}
        {can("activity_log") && <Row key="log" to="/activity-log" icon={FiList} title="سجل النشاط" />}
        {can("backup") && <Row key="backup" to="/backup" icon={FiDatabase} title="النسخ الاحتياطي" />}
      </Group>

      {!shop?.is_home && isManager && (
        <Group title="موج">
          <Row key="sub" to="/subscription" icon={FiStar} title="اشتراك موج" sub={subscriptionSub} />
          <Row key="support" to="/support" icon={FiHeadphones} title="الدعم الفني" sub="احكي معنا مباشرة" />
        </Group>
      )}

      <div className="section-title">حسابي</div>
      <div className="list-group">
        {(can("chat") || canAction("chat_with_admin")) && (
          <Row to="/chat" icon={FiMessageCircle} title={can("chat") ? "رسائل الموظفين" : "راسل الإدارة"} />
        )}
        <Row to="/my-pay" icon={FiUsers} title="دوامي وحسابي" sub="سجّل حضورك وشوف مستحقاتك" />
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

// المحطة بأول «المزيد»: السيارات (سيارة ١، سيارة ٢…) + المخزون + الكاشير + العهدة
function StationBlock({ can, feat }) {
  const showVehicles = feat.vehicles && (can("station") || can("delivery", "edit"));
  const [vs, setVs] = useState(null);
  useEffect(() => {
    if (showVehicles) api.stVehicles().then((r) => setVs(r)).catch(() => setVs(null));
  }, [showVehicles]);
  const rows = [
    (feat.station_stock || feat.vehicles || feat.cashier) && can("station") && <Row key="station" to="/station" icon={FiPackage} title="المحطة" sub="مبيعات المحطة والمركبات، المخزون، الربح" />,
    feat.cashier && can("cashier") && <Row key="cashier" to="/cashier" icon={FiShoppingCart} title="الكاشير" sub="سجّل بيع المحل" />,
    feat.custody && <Row key="custody" to="/custody" icon={FiCustody} title="العهدة" sub="المصاري الثابتة مع الموظفين" />,
  ].filter(Boolean);
  if (!showVehicles && !rows.length) return null;
  return (
    <>
      {showVehicles && (
        <>
          <div className="section-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>السيارات</span>
            <Link to="/vehicles" style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--primary)", textDecoration: "none" }}>الكل</Link>
          </div>
          <div className="mv-strip">
            {(vs?.vehicles || []).map((v) => (
              <Link key={v.id} to={`/vehicles/${v.id}`} className={`mv-car${v.round ? " on" : ""}`}>
                <FiTruck aria-hidden="true" />
                <b>{v.name}</b>
                <small>{v.round ? `${v.round.driver_name || ""} · ${v.round.summary.lines.filter((l) => l.loaded).map((l) => `${l.remaining} ${l.name}`).join("، ")}` : "فاضية"}</small>
              </Link>
            ))}
            {vs?.can_edit && (
              <Link to="/vehicles" className="mv-car add"><FiPlus aria-hidden="true" /><b>سيارة</b><small>ضيف سيارة</small></Link>
            )}
            {vs && vs.vehicles.length === 0 && !vs.can_edit && <div className="mv-none">ما في جولة مفتوحة إلك</div>}
          </div>
        </>
      )}
      {rows.length > 0 && <Group title="المحطة">{rows}</Group>}
    </>
  );
}
