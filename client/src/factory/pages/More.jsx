import { useNavigate } from "react-router-dom";
import { FiUsers, FiTruck, FiBox, FiDollarSign, FiBarChart2, FiBell, FiBriefcase, FiShield, FiSettings, FiCheckSquare, FiCreditCard, FiMessageSquare, FiList, FiZap, FiPlayCircle, FiLogOut, FiChevronLeft, FiUser, FiMap, FiRepeat, FiMapPin, FiFileText, FiClipboard, FiTool, FiLayers, FiActivity, FiBookOpen, FiRefreshCw } from "react-icons/fi";
import { useFx, useLoad } from "../ui.jsx";
import { fapi } from "../fapi.js";
import { lineType, plantName, plantBg, plantIcon } from "../plants.js";
import PushCard from "../PushCard.jsx";

export default function More({ onLogout }) {
  const fx = useFx();
  const nav = useNavigate();
  const seesPlants = fx.can("f_production") || fx.can("f_machines") || fx.can("f_store") || fx.can("f_home");
  const { data: lineData } = useLoad(() => (seesPlants ? fapi.line().catch(() => null) : Promise.resolve(null)), [seesPlants]);
  const lines0 = lineData?.lines || [];
  // المصنعين دايمًا ظاهرين: إذا واحد لسا مش مجهّز، الإدارة بتكبس عليه فبينعمل لحاله
  const canSetup = fx.can("f_store", "edit") || fx.can("f_fleet", "edit");
  const plants = [
    ...lines0,
    // مصانع جاهزة للتجهيز بس إذا لسا ما في ولا مصنع
    ...(lineData && !lines0.length && canSetup ? [{ id: "new-cups", name: "خط الكاسات", _new: true }, { id: "new-bottles", name: "خط المطرات", _new: true }] : []),
  ];
  async function openPlant(l) {
    if (!l._new) return nav(`/f/plant/${l.id}`);
    try { const r = await fapi.addPline({ name: l.name }); nav(`/f/plant/${r.id}`); } catch (e) { fx.toast(e.message); }
  }
  const items = [
    !fx.isOwner && fx.can("f_drive", "edit") && { to: "/f/drive", icon: FiTruck, label: "رحلتي", hint: "رحلة التوزيع أو جولة البيع عالمحلات" },
    (fx.can("f_money") || fx.can("f_home") || fx.can("f_stock") || fx.can("f_dispatch") || fx.can("f_drive", "edit")) && { to: "/f/jard", icon: FiClipboard, label: fx.can("f_money") || fx.can("f_home") ? "الجرد اليومي" : "جردي", hint: "كل سائق: الكاش، المرتجع، الفواتير والمصاريف بشاشة وحدة" },
    (fx.can("f_money") || fx.can("f_customers") || fx.can("f_home")) && { to: "/f/debts", icon: FiDollarSign, label: "الديون", hint: "مين عليه وقديش — اطبع الكشف أو ذكّرهم برسالة لطيفة", tone: "debt" },
    { to: "/f/customers", icon: FiUsers, label: "العملاء", hint: "بياناتهم وطلباتهم وكشف حسابهم" },
    { to: "/f/density", icon: FiMapPin, label: "خريطة العملاء", hint: "وين زباينك متجمّعين" },
    (fx.can("f_orders") || fx.can("f_dispatch") || fx.can("f_home")) && { to: "/f/recurring", icon: FiRepeat, label: "المواعيد الثابتة", hint: "زباين بنوصّلهم كل كم يوم" },
    (fx.can("f_dispatch") || fx.can("f_home")) && { to: "/f/live", icon: FiMap, label: "وين السيارات", hint: "كل السيارات على الخريطة ولوين متجهة" },
    (fx.can("f_dispatch") || fx.can("f_home")) && { to: "/f/trips", icon: FiTruck, label: "الرحلات", hint: "وين كل سيارة وشو ضل عليها" },
    (fx.can("f_stock") || fx.can("f_production") || fx.can("f_home")) && { to: "/f/stock", icon: FiBox, label: "المستودع والإنتاج", hint: "الأرصدة، التحميل، التالف، المكنات" },
    (fx.can("f_production") || fx.can("f_machines") || fx.can("f_store") || fx.can("f_home")) && { to: "/f/line", icon: FiActivity, label: "خطوط الإنتاج والفحوصات", hint: "فحص الجودة، الفلاتر ومواعيدها، التالف، وورقة اليوم PDF" },
    (fx.can("f_store") || fx.can("f_production") || fx.can("f_machines") || fx.can("f_home")) && { to: "/f/store", icon: FiLayers, label: "المواد وقطع الغيار", hint: "المواد الأولية، قطع غيار المكنات، دخل وسحب، والجرد الكامل" },
    (fx.can("f_maint") || fx.can("f_home")) && { to: "/f/maint", icon: FiTool, label: "صيانة السيارات", hint: "غيار زيت، ميكانيك، كوشوك، بطاريات — ومواعيدها الجاية" },
    fx.can("f_machines") && !fx.can("f_stock") && !fx.can("f_production") && { to: "/f/stock?tab=prod", icon: FiBox, label: "المكنات والأعطال", hint: "ماكنة وقفت؟ سجّلها، ولما ترجع سجّل كم خرب" },
    (fx.can("f_orders") || fx.can("f_dispatch") || fx.can("f_money") || fx.can("f_home")) && { to: "/f/invoices", icon: FiFileText, label: "الفواتير", hint: "نسخة من كل فاتورة: مين سلّمها وإمتى" },
    (fx.can("f_money") || fx.can("f_home")) && { to: "/f/books?tab=recycle", icon: FiRefreshCw, label: "إعادة التدوير", hint: "كرتون، بلاستيك، نايلون، قصدير، بريفورم — الوزن، سعر الطن، وكم قبضت", tone: "recycle" },
    (fx.can("f_money") || fx.can("f_home")) && { to: "/f/books", icon: FiBookOpen, label: "الدفاتر", hint: "الشركات ومين إله ومين عليه، الفواتير الرسمية، إعادة التدوير، الصندوق، التسليم، والملخّص" },
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
      {fx.can("f_drive", "edit") && !window.Capacitor?.isNativePlatform?.() && /android/i.test(navigator.userAgent) && (
        <a className="fx-item" href="https://github.com/n17rb/New/releases/download/driver-latest/mawj-driver.apk" style={{ textDecoration: "none", color: "inherit" }}>
          <span className="fx-avatar">📲</span>
          <span className="t"><b>نزّل تطبيق السائق (أندرويد)</b><span>بيتبع السيارة حتى والشاشة مطفية</span></span>
        </a>
      )}
      {plants.length > 0 && (
        <div className="fx-plants" role="list">
          {plants.map((l) => {
            const t = lineType(l.name);
            return (
              <button key={l.id} role="listitem" className={`fx-plant-card ${l._new ? "new" : ""}`} style={l.photo_url ? undefined : { background: plantBg(t) }} onClick={() => openPlant(l)}>
                {l.photo_url ? <img src={l.photo_url} alt="" loading="lazy" /> : <span className="ico">{plantIcon(t)}</span>}
                <span className="shade" />
                <span className="cap"><b>{plantName(l.name)}</b><small>{l._new ? "اكبس لتجهيزه" : "مواد · قطع صيانة · تعقيم"}</small></span>
              </button>
            );
          })}
        </div>
      )}
      <div className="fx-list">
        {items.map((i) => (
          <button key={i.to} className="fx-item" onClick={() => nav(i.to)} style={i.tone === "debt" ? { background: "#fff4e5", boxShadow: "inset -4px 0 0 #e8890c" } : i.tone === "recycle" ? { background: "#eaf7ee", boxShadow: "inset -4px 0 0 #2f9e5b" } : undefined}>
            <span className="fx-avatar" style={i.tone === "debt" ? { background: "#e8890c", color: "#fff" } : i.tone === "recycle" ? { background: "#2f9e5b", color: "#fff" } : undefined}><i.icon /></span>
            <span className="t"><b style={i.tone === "debt" ? { color: "#b35f00" } : i.tone === "recycle" ? { color: "#1f7a44" } : undefined}>{i.label}</b>{i.hint && <span>{i.hint}</span>}</span>
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
