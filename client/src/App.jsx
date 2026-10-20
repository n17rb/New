import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { api, clearApiCache } from "./api.js";
import { isPushSupported, refreshPushIfGranted, disablePushForLogout } from "./push.js";
import { FiBell, FiMessageCircle, FiEye, FiX } from "react-icons/fi";
import { UserContext, ShopContext, canUser, canUserAction } from "./auth.jsx";
import { LogoMark, Wordmark } from "./components/Logo.jsx";
import { readShop, saveShop } from "./shop.js";
import { setTemplates } from "./messages.js";

import Setup from "./pages/Setup.jsx";
import Login from "./pages/Login.jsx";
const Dashboard = lazy(() => import("./pages/Dashboard.jsx"));
const Customers = lazy(() => import("./pages/Customers.jsx"));
const CustomerDetail = lazy(() => import("./pages/CustomerDetail.jsx"));
const Orders = lazy(() => import("./pages/Orders.jsx"));
const Trip = lazy(() => import("./pages/Trip.jsx"));
const Products = lazy(() => import("./pages/Products.jsx"));
const DriverBalances = lazy(() => import("./pages/DriverBalances.jsx"));
const MyBalance = lazy(() => import("./pages/MyBalance.jsx"));
const Reports = lazy(() => import("./pages/Reports.jsx"));
const Cash = lazy(() => import("./pages/Cash.jsx"));
const Forecast = lazy(() => import("./pages/Forecast.jsx"));
const DriverPerformance = lazy(() => import("./pages/DriverPerformance.jsx"));
const CustomersMap = lazy(() => import("./pages/CustomersMap.jsx"));
const ActivityLog = lazy(() => import("./pages/ActivityLog.jsx"));
const Backup = lazy(() => import("./pages/Backup.jsx"));
const Notifications = lazy(() => import("./pages/Notifications.jsx"));
const TripArchive = lazy(() => import("./pages/TripArchive.jsx"));
const CustomerGrowth = lazy(() => import("./pages/CustomerGrowth.jsx"));
const Notes = lazy(() => import("./pages/Notes.jsx"));
const Users = lazy(() => import("./pages/Users.jsx"));
import BottomNav from "./components/BottomNav.jsx";
const More = lazy(() => import("./pages/More.jsx"));
const ShopSettings = lazy(() => import("./pages/ShopSettings.jsx"));
const Debts = lazy(() => import("./pages/Debts.jsx"));
const Coupons = lazy(() => import("./pages/Coupons.jsx"));
const Chat = lazy(() => import("./pages/Chat.jsx"));
const Subscription = lazy(() => import("./pages/Subscription.jsx"));
const Support = lazy(() => import("./pages/Support.jsx"));
const Platform = lazy(() => import("./pages/Platform.jsx"));
const PlatformTenant = lazy(() => import("./pages/PlatformTenant.jsx"));
const PlatformSupportThread = lazy(() => import("./pages/PlatformSupportThread.jsx"));
const Payroll = lazy(() => import("./pages/Payroll.jsx"));
const PayrollEmployee = lazy(() => import("./pages/PayrollEmployee.jsx"));
const MyPay = lazy(() => import("./pages/MyPay.jsx"));
const Jard = lazy(() => import("./pages/Jard.jsx"));
const Bottles = lazy(() => import("./pages/Bottles.jsx"));
const PublicInvoice = lazy(() => import("./pages/PublicInvoice.jsx"));
const MessageTemplates = lazy(() => import("./pages/MessageTemplates.jsx"));
const Swot = lazy(() => import("./pages/Swot.jsx"));
const TripReplay = lazy(() => import("./pages/TripReplay.jsx"));
// موج للمصانع: تطبيق منفصل بالكامل للمشتركين اللي باقتهم «مصنع»
const FactoryApp = lazy(() => import("./factory/FactoryApp.jsx"));
const FactoryTrack = lazy(() => import("./factory/Track.jsx"));
const FactoryLoginGate = lazy(() => import("./factory/LoginGate.jsx"));

// الصفحات الأكثر استخدامًا بتنحمّل بالخلفية بعد ما يفتح التطبيق، عشان التنقل يكون فوري
function prefetchCommonPages() {
  const run = () => {
    import("./pages/Customers.jsx");
    import("./pages/Trip.jsx");
    import("./pages/Orders.jsx");
    import("./pages/CustomerDetail.jsx");
    import("./pages/Notifications.jsx");
  };
  if ("requestIdleCallback" in window) window.requestIdleCallback(run, { timeout: 3000 });
  else setTimeout(run, 1500);
}

function PageLoading() {
  return <div className="page"><p className="text-secondary">جاري التحميل...</p></div>;
}

function playNotificationSound() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    osc.start();
    osc.stop(ctx.currentTime + 0.18);
  } catch {
    // بعض المتصفحات تمنع الصوت قبل أول تفاعل من المستخدم — لا مشكلة، الإشعار بالصفحة يبقى موجود
  }
}

function showDeviceNotification(message) {
  try {
    // لو الجهاز بيدعم إشعارات السيرفر، هي اللي بتطلع التنبيه (حتى والتطبيق مسكّر) — ما نكرره
    if (isPushSupported()) return;
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const options = { body: message, icon: "/icon-192.png", badge: "/icon-192.png", tag: `n-${Date.now()}`, dir: "rtl", lang: "ar" };
    if (navigator.serviceWorker?.ready) {
      navigator.serviceWorker.ready
        .then((reg) => reg.showNotification("موج", options))
        .catch(() => new Notification("موج", options));
    } else {
      new Notification("موج", options);
    }
  } catch {
    // بعض الأجهزة ما بتدعم إشعارات الجهاز — الإشعار بالتطبيق بيضل موجود
  }
}

function readStoredUser() {
  try {
    const raw = localStorage.getItem("user");
    return raw && localStorage.getItem("token") ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

const isLockedState = (shop) => !!shop && !shop.is_home && !shop.inspecting && ["expired", "suspended"].includes(shop.access?.state);

export default function App() {
  // فاتورة عامة: بتفتح للزبون بدون تسجيل دخول
  if (window.location.pathname.startsWith("/i/")) {
    return (
      <Suspense fallback={<SplashScreen />}>
        <PublicInvoice token={decodeURIComponent(window.location.pathname.slice(3))} />
      </Suspense>
    );
  }
  // صفحة متابعة الطلبات والفاتورة لزبون المصنع (بدون تسجيل دخول)
  if (window.location.pathname.startsWith("/t/")) {
    return (
      <Suspense fallback={<SplashScreen />}>
        <FactoryTrack path={window.location.pathname.slice(3)} />
      </Suspense>
    );
  }
  return <MainApp />;
}

function MainApp() {
  const [user, setUser] = useState(readStoredUser);
  const [shop, setShop] = useState(readShop);
  // المستخدم المسجّل دخوله من قبل بيفوت مباشرة بدون ما يستنى فحص السيرفر
  const [loadingSetup, setLoadingSetup] = useState(() => !readStoredUser());
  const [needsSetup, setNeedsSetup] = useState(false);
  const [connectionError, setConnectionError] = useState("");

  const [unreadCount, setUnreadCount] = useState(0);
  const [chatUnread, setChatUnread] = useState(0);
  const seenIdsRef = useRef(new Set());
  const firstLoadRef = useRef(true);

  const [darkMode, setDarkMode] = useState(() => localStorage.getItem("darkMode") === "true");

  useEffect(() => {
    // المصانع دايمًا فاتح
    document.documentElement.setAttribute("data-theme", darkMode && readShop()?.plan !== "factory" ? "dark" : "light");
    localStorage.setItem("darkMode", darkMode ? "true" : "false");
  }, [darkMode]);

  function checkSetup() {
    setLoadingSetup(true);
    setConnectionError("");
    api.setupStatus()
      .then((r) => setNeedsSetup(r.needsSetup))
      .catch((err) => setConnectionError(err.message || "تعذّر الاتصال بالسيرفر."))
      .finally(() => setLoadingSetup(false));
  }

  function saveUser(next) {
    if (next) {
      const { shop: nextShop, ...rest } = next;
      localStorage.setItem("user", JSON.stringify(rest));
      setUser(rest);
      if (nextShop) {
        saveShop(nextShop);
        setShop(nextShop);
      }
    } else {
      setUser(null);
    }
  }

  // تحديث الصلاحيات وحالة الاشتراك من السيرفر — بالخلفية
  function refreshMe() {
    api.getMe().then(saveUser).catch(() => {});
    api.getMessageTemplates().then((r) => setTemplates(r.templates)).catch(() => {});
  }

  useEffect(() => {
    if (user) {
      refreshMe();
      prefetchCommonPages();
    } else {
      checkSetup();
    }
  }, []);

  // أي طلب رجع «الجلسة انتهت» بيرجّعنا لشاشة الدخول
  useEffect(() => {
    function onExpired() {
      // لو كنا بنعاين محل وخلصت مدة المعاينة: منرجع لحساب إدارة موج
      if (localStorage.getItem("inspect_backup")) {
        endInspection();
        return;
      }
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      saveShop(null);
      setUser(null);
    }
    function onLocked() {
      refreshMe();
    }
    window.addEventListener("auth:expired", onExpired);
    window.addEventListener("shop:locked", onLocked);
    return () => {
      window.removeEventListener("auth:expired", onExpired);
      window.removeEventListener("shop:locked", onLocked);
    };
  }, []);

  // كل ما يرجع المستخدم للتطبيق منحدّث صلاحياته واشتراكه
  useEffect(() => {
    if (!user) return;
    function onVisible() {
      if (document.visibilityState === "visible") refreshMe();
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [user?.id]);

  const locked = isLockedState(shop);

  useEffect(() => {
    if (!user || locked || user.inspecting) return;
    refreshPushIfGranted();
    const hasChat = canUser(user, "chat") || canUserAction(user, "chat_with_admin");
    if (hasChat) api.getChatUnread().then((r) => setChatUnread(r.count)).catch(() => {});
    firstLoadRef.current = true;
    seenIdsRef.current = new Set();

    async function poll() {
      try {
        const list = await api.getNotifications();

        if (firstLoadRef.current) {
          list.forEach((n) => seenIdsRef.current.add(n.id));
          setUnreadCount(list.filter((n) => !n.is_read).length);
          firstLoadRef.current = false;
          return;
        }

        const newOnes = list.filter((n) => !seenIdsRef.current.has(n.id));
        if (newOnes.length > 0) {
          playNotificationSound();
          newOnes.forEach((n) => {
            seenIdsRef.current.add(n.id);
            showDeviceNotification(n.message);
          });
        }
        setUnreadCount(list.filter((n) => !n.is_read).length);
        if (hasChat) api.getChatUnread().then((r) => setChatUnread(r.count)).catch(() => {});
      } catch {
        // تجاهل صامت — لا نريد إزعاج المستخدم بأخطاء خلفية غير حرجة
      }
    }

    poll();
    const interval = setInterval(poll, 15000);
    return () => clearInterval(interval);
  }, [user?.id, locked]);

  async function handleLogout() {
    await disablePushForLogout();
    clearApiCache();
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    localStorage.removeItem("inspect_backup");
    saveShop(null);
    setShop(null);
    setUser(null);
  }

  // إدارة موج: بيرجع من معاينة محل لحسابه الأصلي
  function endInspection() {
    try {
      const backup = JSON.parse(localStorage.getItem("inspect_backup") || "null");
      localStorage.removeItem("inspect_backup");
      if (backup) {
        localStorage.setItem("token", backup.token);
        localStorage.setItem("user", JSON.stringify(backup.user));
        saveShop(backup.shop);
      }
    } catch {
      // تجاهل
    }
    window.location.href = "/platform";
  }

  if (loadingSetup) {
    return <SplashScreen />;
  }

  if (connectionError) {
    return (
      <div className="centered-screen">
        <div style={{ width: "100%", maxWidth: 380 }}>
          <div className="error-box">
            ما قدرنا نوصل للسيرفر: {connectionError}
            <br />
            ممكن السيرفر نايم — جرّب كمان مرة بعد نص دقيقة.
          </div>
          <button className="btn-primary" onClick={checkSetup}>جرّب مرة ثانية</button>
        </div>
      </div>
    );
  }

  if (needsSetup) {
    return <Setup onDone={(u) => { saveUser(u); setNeedsSetup(false); }} />;
  }

  if (!user) {
    // موظفين المصنع: شاشة دخول بشعار المصنع (من الرابط /m/<رقم المصنع> أو من آخر دخول على هالتلفون)
    if (/^\/m\/\d+/.test(window.location.pathname) || localStorage.getItem("fx_login")) {
      return (
        <Suspense fallback={<SplashScreen />}>
          <FactoryLoginGate onLoggedIn={saveUser} fallback={<Login onLoggedIn={saveUser} />} />
        </Suspense>
      );
    }
    return <Login onLoggedIn={saveUser} />;
  }

  // حساب قديم ما معه صلاحيات محفوظة — منستنى أول تحديث من السيرفر
  if (!user.permissions) {
    return <PermissionsLoader onLoaded={saveUser} />;
  }

  // الاشتراك خالص أو المحل موقوف: بس صفحة التجديد والدعم الفني
  if (locked) {
    return (
      <ShopContext.Provider value={shop}>
        <UserContext.Provider value={user}>
          <div className="app-shell">
            <TopBar shopName={shop?.name} minimal />
            <Suspense fallback={<PageLoading />}>
              <Routes>
                <Route path="/support" element={<Support />} />
                <Route path="*" element={<Subscription locked onLogout={handleLogout} onRefresh={refreshMe} />} />
              </Routes>
            </Suspense>
          </div>
        </UserContext.Provider>
      </ShopContext.Provider>
    );
  }

  // باقة المصانع: واجهة خاصة بالمصنع (فاتحة وبشعار المصنع) — المحلات ما بتشوف منها إشي
  if (shop?.plan === "factory") {
    return (
      <ShopContext.Provider value={shop}>
        <UserContext.Provider value={user}>
          <Suspense fallback={<SplashScreen />}>
            <FactoryApp user={user} shop={shop} onLogout={handleLogout} onRefresh={refreshMe} />
          </Suspense>
        </UserContext.Provider>
      </ShopContext.Provider>
    );
  }

  const can = (section, level = "view") => canUser(user, section, level);
  const isOwner = user.role === "super_admin";
  const canCustomers = can("customers") || can("orders") || can("delivery", "edit");
  const canTrip = can("delivery", "edit") || can("trips");
  const canChat = can("chat") || canUserAction(user, "chat_with_admin");
  const isManager = isOwner || can("settings", "edit");
  const platformAdmin = !!shop?.platform_admin;
  const home = can("dashboard") ? "/" : canTrip ? "/trip" : canCustomers ? "/customers" : can("orders") ? "/orders" : "/more";

  return (
    <ShopContext.Provider value={shop}>
      <UserContext.Provider value={user}>
        <div className="app-shell">
          <TopBar unreadCount={unreadCount} chatUnread={chatUnread} showChat={canChat && !user.inspecting} shopName={shop?.is_home ? null : shop?.name} />
          {user.inspecting && (
            <div className="shop-banner inspect" role="status">
              <FiEye aria-hidden="true" />
              <span style={{ flex: 1 }}>بتعاين «{shop?.name}» — مشاهدة بس</span>
              <button onClick={endInspection}>رجوع للوحة موج</button>
            </div>
          )}
          {!user.inspecting && shop?.is_demo && (
            <div className="shop-banner demo" role="status">🧪 نسخة تجريبية — جرّب كل إشي براحتك، والداتا بترجع لأولها كل يوم</div>
          )}
          {!user.inspecting && !shop?.is_demo && shop?.access?.trial && isManager && (
            <TrialBanner days={shop.access.days_left} />
          )}
          {!user.inspecting && !shop?.is_demo && !shop?.access?.trial && shop?.access?.state === "expiring" && isManager && (
            <ExpiringBanner days={shop.access.days_left} />
          )}

          <Suspense fallback={<PageLoading />}>
            <Routes>
              <Route path="/" element={can("dashboard") ? <Dashboard user={user} /> : <Navigate to={home} replace />} />
              {canCustomers && <Route path="/customers" element={<Customers user={user} />} />}
              {canCustomers && <Route path="/customers/:id" element={<CustomerDetail user={user} />} />}
              {can("orders") && <Route path="/orders" element={<Orders user={user} />} />}
              {canTrip && <Route path="/trip" element={<Trip user={user} />} />}
              <Route path="/notes" element={<Notes />} />
              {can("products") && <Route path="/products" element={<Products user={user} />} />}
              {can("driver_balances") && <Route path="/driver-balances" element={<DriverBalances />} />}
              {can("reports") && <Route path="/reports" element={<Reports />} />}
              {can("cash") && <Route path="/cash" element={<Cash />} />}
              {(can("orders") || can("customers")) && <Route path="/forecast" element={<Forecast />} />}
              <Route path="/overdue-customers" element={<Navigate to="/forecast?tab=late" replace />} />
              {can("reports") && <Route path="/driver-performance" element={<DriverPerformance />} />}
              {can("reports") && <Route path="/customers-map" element={<CustomersMap />} />}
              <Route path="/notifications" element={<Notifications />} />
              {can("trips") && <Route path="/trip-archive" element={<TripArchive />} />}
              {can("trips") && <Route path="/trip-archive/:id" element={<TripReplay />} />}
              {can("reports") && <Route path="/customer-growth" element={<CustomerGrowth />} />}
              {can("activity_log") && <Route path="/activity-log" element={<ActivityLog />} />}
              {can("backup") && <Route path="/backup" element={<Backup />} />}
              {can("delivery", "edit") && <Route path="/my-balance" element={<MyBalance user={user} />} />}
              {can("settings") && <Route path="/settings" element={<ShopSettings />} />}
              {(isOwner || can("settings", "edit")) && <Route path="/settings/messages" element={<MessageTemplates />} />}
              {(can("reports") || can("cash")) && <Route path="/swot" element={<Swot />} />}
              {isOwner && <Route path="/users" element={<Users />} />}
              {can("debts") && <Route path="/debts" element={<Debts />} />}
              {can("coupons") && <Route path="/coupons" element={<Coupons />} />}
              {canChat && <Route path="/chat" element={<Chat />} />}
              {canChat && <Route path="/chat/:userId" element={<Chat />} />}
              {can("payroll") && <Route path="/payroll" element={<Payroll />} />}
              {can("payroll") && <Route path="/payroll/:id" element={<PayrollEmployee />} />}
              <Route path="/my-pay" element={<MyPay />} />
              {can("jard") && <Route path="/jard" element={<Jard />} />}
              {(can("customers") || can("jard")) && <Route path="/bottles" element={<Bottles />} />}
              {isManager && !shop?.is_home && <Route path="/subscription" element={<Subscription onRefresh={refreshMe} />} />}
              {(isManager || user.inspecting) && !shop?.is_home && <Route path="/support" element={<Support />} />}
              {platformAdmin && <Route path="/platform" element={<Platform />} />}
              {platformAdmin && <Route path="/platform/tenants/:id" element={<PlatformTenant />} />}
              {platformAdmin && <Route path="/platform/support/:tenantId" element={<PlatformSupportThread />} />}
              <Route path="/more" element={<More darkMode={darkMode} setDarkMode={setDarkMode} onLogout={handleLogout} />} />
              <Route path="*" element={<Navigate to={home} replace />} />
            </Routes>
          </Suspense>

          <BottomNav />
        </div>
      </UserContext.Provider>
    </ShopContext.Provider>
  );
}

function TrialBanner({ days }) {
  const navigate = useNavigate();
  return (
    <div className="shop-banner trial" role="status">
      <span style={{ flex: 1 }}>🎁 تجربة مجانية — باقي {days <= 1 ? "يوم" : `${days} أيام`}</span>
      <button onClick={() => navigate("/subscription")}>اشترك</button>
    </div>
  );
}

function ExpiringBanner({ days }) {
  const navigate = useNavigate();
  const [hidden, setHidden] = useState(() => sessionStorage.getItem("hide_expiring") === "1");
  if (hidden) return null;
  return (
    <div className="shop-banner expiring" role="status">
      <span style={{ flex: 1 }}>
        ⏰ اشتراك موج بيخلص {days <= 1 ? "بكرة" : `بعد ${days} أيام`}
      </span>
      <button onClick={() => navigate("/subscription")}>جدّد</button>
      <button className="icon" aria-label="إخفاء" onClick={() => { sessionStorage.setItem("hide_expiring", "1"); setHidden(true); }}>
        <FiX />
      </button>
    </div>
  );
}

export function SplashScreen() {
  return (
    <div className="splash">
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: "-14vh", position: "relative", zIndex: 1 }}>
        <LogoMark size={108} color="#0A66F5" strokeWidth={3.4} />
        <div className="splash-name">موج</div>
        <div className="splash-tagline">إدارة أسهل .. تدفق أكبر</div>
      </div>
      <div className="splash-waves" aria-hidden="true" />
    </div>
  );
}

function PermissionsLoader({ onLoaded }) {
  const [error, setError] = useState("");
  useEffect(() => {
    api.getMe().then(onLoaded).catch((err) => setError(err.message));
  }, []);
  if (error) {
    return (
      <div className="centered-screen">
        <div style={{ width: "100%", maxWidth: 380 }}>
          <div className="error-box">{error}</div>
          <button className="btn-primary" onClick={() => window.location.reload()}>جرّب مرة ثانية</button>
        </div>
      </div>
    );
  }
  return <SplashScreen />;
}

function TopBar({ unreadCount = 0, chatUnread = 0, showChat = false, shopName = null, minimal = false }) {
  const navigate = useNavigate();

  return (
    <header className="top-bar">
      <button className="brand" onClick={() => !minimal && navigate("/")} style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }} aria-label="الرئيسية">
        <LogoMark size={34} color="#fff" strokeWidth={3.8} />
        <Wordmark light subtitle={shopName} />
      </button>
      {!minimal && (
        <div className="top-actions">
          {showChat && (
            <button className="top-icon" onClick={() => navigate("/chat")} aria-label="الرسائل">
              <FiMessageCircle size={19} />
              {chatUnread > 0 && <span className="top-badge tabular-num">{chatUnread > 99 ? "99+" : chatUnread}</span>}
            </button>
          )}
          <button className="top-icon" onClick={() => navigate("/notifications")} aria-label="الإشعارات والمواعيد">
            <FiBell size={19} />
            {unreadCount > 0 && <span className="top-badge tabular-num">{unreadCount > 99 ? "99+" : unreadCount}</span>}
          </button>
        </div>
      )}
    </header>
  );
}
