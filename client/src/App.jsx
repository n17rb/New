import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { api } from "./api.js";
import { isPushSupported, refreshPushIfGranted, disablePushForLogout } from "./push.js";
import { FiBell } from "react-icons/fi";
import { UserContext, canUser } from "./auth.jsx";
import { LogoMark, Wordmark } from "./components/Logo.jsx";

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
const OverdueCustomers = lazy(() => import("./pages/OverdueCustomers.jsx"));
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
    const options = { body: message, icon: "/icon.svg", badge: "/icon.svg", tag: `n-${Date.now()}`, dir: "rtl", lang: "ar" };
    if (navigator.serviceWorker?.ready) {
      navigator.serviceWorker.ready
        .then((reg) => reg.showNotification("جوهرة الرابية", options))
        .catch(() => new Notification("جوهرة الرابية", options));
    } else {
      new Notification("جوهرة الرابية", options);
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

export default function App() {
  const [user, setUser] = useState(readStoredUser);
  // المستخدم المسجّل دخوله من قبل بيفوت مباشرة بدون ما يستنى فحص السيرفر
  const [loadingSetup, setLoadingSetup] = useState(() => !readStoredUser());
  const [needsSetup, setNeedsSetup] = useState(false);
  const [connectionError, setConnectionError] = useState("");

  const [unreadCount, setUnreadCount] = useState(0);
  const seenIdsRef = useRef(new Set());
  const firstLoadRef = useRef(true);

  const [darkMode, setDarkMode] = useState(() => localStorage.getItem("darkMode") === "true");

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", darkMode ? "dark" : "light");
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
    if (next) localStorage.setItem("user", JSON.stringify(next));
    setUser(next);
  }

  // تحديث الصلاحيات من السيرفر (لو المدير غيّرها) — بالخلفية
  function refreshMe() {
    api.getMe().then(saveUser).catch(() => {});
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
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      setUser(null);
    }
    window.addEventListener("auth:expired", onExpired);
    return () => window.removeEventListener("auth:expired", onExpired);
  }, []);

  // كل ما يرجع المستخدم للتطبيق منحدّث صلاحياته
  useEffect(() => {
    if (!user) return;
    function onVisible() {
      if (document.visibilityState === "visible") refreshMe();
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [user?.id]);

  useEffect(() => {
    if (!user) return;
    refreshPushIfGranted();
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
      } catch {
        // تجاهل صامت — لا نريد إزعاج المستخدم بأخطاء خلفية غير حرجة
      }
    }

    poll();
    const interval = setInterval(poll, 15000);
    return () => clearInterval(interval);
  }, [user?.id]);

  async function handleLogout() {
    await disablePushForLogout();
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setUser(null);
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
    return <Login onLoggedIn={saveUser} />;
  }

  // حساب قديم ما معه صلاحيات محفوظة — منستنى أول تحديث من السيرفر
  if (!user.permissions) {
    return <PermissionsLoader onLoaded={saveUser} />;
  }

  const can = (section, level = "view") => canUser(user, section, level);
  const isOwner = user.role === "super_admin";
  const canCustomers = can("customers") || can("orders") || can("delivery", "edit");
  const canTrip = can("delivery", "edit") || can("trips");
  const home = can("dashboard") ? "/" : canTrip ? "/trip" : canCustomers ? "/customers" : can("orders") ? "/orders" : "/more";

  return (
    <UserContext.Provider value={user}>
      <div className="app-shell">
        <TopBar unreadCount={unreadCount} />

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
            {can("reports") && <Route path="/overdue-customers" element={<OverdueCustomers />} />}
            {can("reports") && <Route path="/driver-performance" element={<DriverPerformance />} />}
            {can("reports") && <Route path="/customers-map" element={<CustomersMap />} />}
            <Route path="/notifications" element={<Notifications />} />
            {can("trips") && <Route path="/trip-archive" element={<TripArchive />} />}
            {can("reports") && <Route path="/customer-growth" element={<CustomerGrowth />} />}
            {can("activity_log") && <Route path="/activity-log" element={<ActivityLog />} />}
            {can("backup") && <Route path="/backup" element={<Backup />} />}
            {can("delivery", "edit") && <Route path="/my-balance" element={<MyBalance user={user} />} />}
            {can("settings") && <Route path="/settings" element={<ShopSettings />} />}
            {isOwner && <Route path="/users" element={<Users />} />}
            <Route path="/more" element={<More darkMode={darkMode} setDarkMode={setDarkMode} onLogout={handleLogout} />} />
            <Route path="*" element={<Navigate to={home} replace />} />
          </Routes>
        </Suspense>

        <BottomNav />
      </div>
    </UserContext.Provider>
  );
}

function SplashScreen() {
  return (
    <div className="login-screen">
      <div className="login-hero" style={{ flex: 1, justifyContent: "center", paddingBottom: 90 }}>
        <LogoMark size={72} color="#fff" strokeWidth={3} />
        <div style={{ marginTop: 16 }}><Wordmark light size="lg" /></div>
      </div>
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

function TopBar({ unreadCount }) {
  const navigate = useNavigate();

  return (
    <header className="top-bar">
      <button className="brand" onClick={() => navigate("/")} style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }} aria-label="الرئيسية">
        <LogoMark size={34} color="#fff" />
        <Wordmark light />
      </button>
      <div className="top-actions">
        <button className="top-icon" onClick={() => navigate("/notifications")} aria-label="الإشعارات والمواعيد">
          <FiBell size={19} />
          {unreadCount > 0 && <span className="top-badge tabular-num">{unreadCount > 99 ? "99+" : unreadCount}</span>}
        </button>
      </div>
    </header>
  );
}
