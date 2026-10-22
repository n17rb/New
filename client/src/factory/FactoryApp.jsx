import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Routes, Route, Navigate, NavLink, useNavigate, useLocation } from "react-router-dom";
import { FiHome, FiPackage, FiTruck, FiNavigation, FiBox, FiDollarSign, FiGrid, FiBell, FiHelpCircle, FiZap, FiUsers, FiClipboard } from "react-icons/fi";
import { canUser, canUserAction } from "../auth.jsx";
import { fapi } from "./fapi.js";
import { FxContext } from "./ui.jsx";
import { HelpSheet, Tour } from "./help.jsx";
import { saveFactoryLogin } from "./FactoryLogin.jsx";
import { applyBrandHead } from "./brandHead.js";
import "./factory.css";

import Home from "./pages/Home.jsx";
const Orders = lazy(() => import("./pages/Orders.jsx"));
const Trips = lazy(() => import("./pages/Trips.jsx"));
const Live = lazy(() => import("./pages/Live.jsx"));
const Recurring = lazy(() => import("./pages/Recurring.jsx"));
const Density = lazy(() => import("./pages/Density.jsx"));
const Invoices = lazy(() => import("./pages/Invoices.jsx"));
const Jard = lazy(() => import("./pages/Jard.jsx"));
const Debts = lazy(() => import("./pages/Debts.jsx"));
const Drive = lazy(() => import("./pages/Drive.jsx"));
const Customers = lazy(() => import("./pages/Customers.jsx"));
const Stock = lazy(() => import("./pages/Stock.jsx"));
const Money = lazy(() => import("./pages/Money.jsx"));
const Reports = lazy(() => import("./pages/Reports.jsx"));
const Alerts = lazy(() => import("./pages/Alerts.jsx"));
const Settings = lazy(() => import("./pages/Settings.jsx"));
const More = lazy(() => import("./pages/More.jsx"));
const Setup = lazy(() => import("./pages/Setup.jsx"));
const Payroll = lazy(() => import("../pages/Payroll.jsx"));
const PayrollEmployee = lazy(() => import("../pages/PayrollEmployee.jsx"));
const MyPay = lazy(() => import("../pages/MyPay.jsx"));
const Users = lazy(() => import("../pages/Users.jsx"));
const Subscription = lazy(() => import("../pages/Subscription.jsx"));
const Support = lazy(() => import("../pages/Support.jsx"));
const ActivityLog = lazy(() => import("../pages/ActivityLog.jsx"));

// ============================================================
// موج للمصانع — هيكل التطبيق: الشريط العلوي بشعار المصنع، التنقل حسب الدور، المساعد
// ============================================================
export default function FactoryApp({ user, shop, onLogout, onRefresh }) {
  const can = useCallback((s, l = "view") => canUser(user, s, l), [user]);
  const canAction = useCallback((a) => canUserAction(user, a), [user]);
  const isOwner = user.role === "super_admin";
  const navigate = useNavigate();
  const location = useLocation();
  const [boot, setBoot] = useState(null);
  const [bootError, setBootError] = useState("");
  const [toastMsg, setToastMsg] = useState("");
  const [help, setHelp] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(0);
  const [tour, setTour] = useState(() => {
    try { return localStorage.getItem(`fx-tour-${shop?.id}-${user.id}`) ? null : 0; } catch { return null; }
  });
  const toastTimer = useRef(null);

  // الدخول الجاي على هالتلفون بيفتح على شاشة دخول المصنع
  useEffect(() => {
    if (shop?.id && shop?.brand) applyBrandHead(shop.brand, shop.id);
    if (shop?.id && shop?.brand && !user.inspecting) saveFactoryLogin({ id: shop.id, name: shop.brand.name, logo: shop.brand.logo, icon: shop.brand.icon, tagline: shop.brand.tagline, phone: shop.brand.phone });
  }, [shop?.id, shop?.brand?.logo, shop?.brand?.name, shop?.brand?.icon]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", "light");
    document.title = shop?.brand?.name || "موج للمصانع";
  }, [shop?.brand?.name]);

  const reloadBoot = useCallback(() => fapi.bootstrap().then((b) => { setBoot(b); setBootError(""); return b; }).catch((e) => setBootError(e.message)), []);
  useEffect(() => { reloadBoot(); }, [reloadBoot]);

  const toast = useCallback((m) => {
    setToastMsg(m);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(""), 3200);
  }, []);

  // «ورجيني»: بيروح للشاشة وبيأشر على الزر
  const show = useCallback((path, hl) => {
    setHelp(false);
    navigate(path);
    if (!hl) return;
    let tries = 0;
    const tick = () => {
      const el = document.querySelector(`[data-hl="${hl}"]`);
      if (el) {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
        el.classList.add("fx-hl");
        setTimeout(() => el.classList.remove("fx-hl"), 3800);
      } else if (tries++ < 25) setTimeout(tick, 150);
    };
    setTimeout(tick, 200);
  }, [navigate]);

  // عدد التنبيهات للمدراء
  const manager = can("f_home") || can("f_money") || can("f_dispatch");
  useEffect(() => {
    if (!manager) return;
    const load = () => fapi.alertsCount().then((r) => setAlertsOpen(r.open)).catch(() => {});
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [manager, location.pathname]);

  // السائق: موقعه بيوصل كل دقيقة والتطبيق مفتوح
  const isDriver = can("f_drive", "edit");
  useEffect(() => {
    if (!isDriver) return;
    // تطبيق السائق (APK): تتبع من التلفون نفسه — بيكمل والشاشة مطفية أو التطبيق بالخلفية (مع إشعار ثابت)
    const BG = window.Capacitor?.isNativePlatform?.() ? window.Capacitor.Plugins?.BackgroundGeolocation : null;
    if (BG) {
      let watcher = null, lastAt = 0;
      BG.addWatcher(
        { backgroundTitle: "تتبع السيارة شغال", backgroundMessage: "موقعك بيوصل للمصنع وإنت بالطريق", requestPermissions: true, stale: false, distanceFilter: 30 },
        (loc, err) => {
          if (err) {
            if (err.code === "NOT_AUTHORIZED" && window.confirm("التطبيق محتاج صلاحية الموقع عشان يتبع السيارة. نفتح الإعدادات؟ اختار «السماح دائمًا» أو «أثناء الاستخدام»")) BG.openSettings();
            return;
          }
          if (!loc || Date.now() - lastAt < 30000) return;
          lastAt = Date.now();
          fapi.ping({ lat: loc.latitude, lng: loc.longitude }).catch(() => {});
        }
      ).then((id) => { watcher = id; }).catch(() => {});
      return () => { if (watcher) BG.removeWatcher({ id: watcher }).catch(() => {}); };
    }
    if (!navigator.geolocation) return;
    let last = 0;
    const id = navigator.geolocation.watchPosition(
      (p) => {
        if (Date.now() - last < 55000) return;
        last = Date.now();
        fapi.ping({ lat: p.coords.latitude, lng: p.coords.longitude }).catch(() => {});
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 30000, timeout: 20000 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [isDriver]);

  // التنقل السفلي: أهم ٤ أقسام حسب صلاحيات الموظف + المزيد
  const nav = useMemo(() => {
    const all = [
      can("f_home") && { to: "/", icon: FiHome, label: "الرئيسية", end: true },
      isDriver && !can("f_home") && { to: "/f/drive", icon: FiNavigation, label: "رحلتي" },
      (can("f_money") || can("f_home")) && { to: "/f/jard", icon: FiClipboard, label: "الجرد" },
      isDriver && !can("f_home") && !can("f_money") && { to: "/f/jard", icon: FiClipboard, label: "جردي" },
      (can("f_customers") || can("f_orders") || can("f_home")) && { to: "/f/customers", icon: FiUsers, label: "العملاء" },
      (can("f_orders") || can("f_dispatch")) && { to: "/f/orders", icon: FiPackage, label: "الطلبات" },
      can("f_dispatch") && { to: "/f/trips", icon: FiTruck, label: "الرحلات" },
      (can("f_stock") || can("f_production")) && { to: "/f/stock", icon: FiBox, label: can("f_stock") ? "المستودع" : "الإنتاج" },
      can("f_money") && { to: "/f/money", icon: FiDollarSign, label: "الحسابات" },
      isDriver && can("f_home") && { to: "/f/drive", icon: FiNavigation, label: "رحلتي" },
    ].filter(Boolean);
    return [...all.slice(0, 4), { to: "/f/more", icon: FiGrid, label: "المزيد" }];
  }, [can, isDriver]);
  const home = can("f_home") ? "/" : nav[0]?.to || "/f/more";

  const ctx = { user, shop, boot, reloadBoot, toast, show, can, canAction, isOwner, openHelp: () => setHelp(true), refreshMe: onRefresh };
  const brand = shop?.brand || {};

  return (
    <FxContext.Provider value={ctx}>
      <div className="fx">
        <div className="fx-shell">
          <header className="fx-top">
            <button className="fx-brand" onClick={() => navigate(home)} aria-label="الرئيسية">
              {brand.logo ? <img src={brand.logo} alt={brand.name} /> : <span className="mark">{(brand.name || "م").trim().charAt(0)}</span>}
              {!brand.logo && (
                <span className="txt">
                  <b>{brand.name || shop?.name}</b>
                  <small>موج للمصانع</small>
                </span>
              )}
            </button>
            <button className="fx-icon-btn" onClick={() => setHelp(true)} aria-label="المساعد"><FiHelpCircle /></button>
            {manager && (
              <button className="fx-icon-btn" onClick={() => navigate("/f/alerts")} aria-label="التنبيهات">
                <FiBell />
                {alertsOpen > 0 && <span className="fx-badge">{alertsOpen > 99 ? "99+" : alertsOpen}</span>}
              </button>
            )}
          </header>

          {user.inspecting && <div className="fx-note warn" style={{ margin: 12 }}>وضع المعاينة — مشاهدة بس.</div>}
          {bootError && <div className="fx-page"><div className="fx-err">{bootError}</div><button className="fx-btn" onClick={reloadBoot}>جرّب كمان مرة</button></div>}

          {boot && (
            <Suspense fallback={<div className="fx-page"><p className="fx-muted">جاري التحميل...</p></div>}>
              <Routes>
                <Route path="/" element={can("f_home") ? <Home /> : <Navigate to={home} replace />} />
                {(can("f_orders") || can("f_dispatch")) && <Route path="/f/orders" element={<Orders />} />}
                {(can("f_dispatch") || can("f_home")) && <Route path="/f/trips" element={<Trips />} />}
                {(can("f_dispatch") || can("f_home")) && <Route path="/f/live" element={<Live />} />}
                {(can("f_orders") || can("f_dispatch") || can("f_home")) && <Route path="/f/recurring" element={<Recurring />} />}
                {isDriver && <Route path="/f/drive" element={<Drive />} />}
                <Route path="/f/customers" element={<Customers />} />
                <Route path="/f/density" element={<Density />} />
                {(can("f_orders") || can("f_dispatch") || can("f_money") || can("f_home")) && <Route path="/f/invoices" element={<Invoices />} />}
                {(can("f_stock") || can("f_production") || can("f_home")) && <Route path="/f/stock" element={<Stock />} />}
                {(can("f_money") || can("f_customers") || can("f_home")) && <Route path="/f/debts" element={<Debts />} />}
                {(isDriver || can("f_money") || can("f_home") || can("f_stock") || can("f_dispatch")) && <Route path="/f/jard" element={<Jard />} />}
                {(can("f_money") || can("f_home")) && <Route path="/f/money" element={<Money />} />}
                {(can("f_reports") || can("f_home")) && <Route path="/f/reports" element={<Reports />} />}
                {manager && <Route path="/f/alerts" element={<Alerts />} />}
                {can("f_fleet") && <Route path="/f/settings" element={<Settings />} />}
                {isOwner && <Route path="/f/setup" element={<Setup />} />}
                <Route path="/f/more" element={<More onLogout={onLogout} />} />
                {can("payroll") && <Route path="/payroll" element={<div className="fx-page-legacy"><Payroll /></div>} />}
                {can("payroll") && <Route path="/payroll/:id" element={<PayrollEmployee />} />}
                <Route path="/my-pay" element={<MyPay />} />
                {isOwner && <Route path="/users" element={<Users />} />}
                {can("activity_log") && <Route path="/activity-log" element={<ActivityLog />} />}
                {isOwner && !shop?.is_home && <Route path="/subscription" element={<Subscription onRefresh={onRefresh} />} />}
                {(isOwner || user.inspecting) && !shop?.is_home && <Route path="/support" element={<Support />} />}
                <Route path="*" element={<Navigate to={home} replace />} />
              </Routes>
            </Suspense>
          )}

          <nav className="fx-nav" aria-label="التنقل">
            {nav.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? "active" : "")}>
                <n.icon aria-hidden="true" />
                {n.label}
              </NavLink>
            ))}
          </nav>

          <button className={`fx-fab ${location.pathname === "/f/orders" ? "low" : ""}`} onClick={() => setHelp(true)}>
            <FiZap aria-hidden="true" /> المساعد
          </button>

          {help && <HelpSheet onClose={() => setHelp(false)} />}
          {tour != null && boot && (
            <Tour
              step={tour}
              setStep={setTour}
              onDone={() => {
                try { localStorage.setItem(`fx-tour-${shop?.id}-${user.id}`, "1"); } catch { /* تجاهل */ }
                setTour(null);
                if (isOwner && !boot.setup_done && boot.counts.products === 0) navigate("/f/setup");
              }}
            />
          )}
          {toastMsg && <div className="fx-toast" role="status">{toastMsg}</div>}
        </div>
      </div>
    </FxContext.Provider>
  );
}
