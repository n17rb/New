import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { api } from "./api.js";
import { isPushSupported, refreshPushIfGranted, disablePushForLogout } from "./push.js";
import { FiBell, FiMoon, FiSun, FiEdit3 } from "react-icons/fi";

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

  useEffect(() => {
    if (user) {
      // نصحّي السيرفر بالخلفية بدون ما نوقف الشاشة
      api.setupStatus().catch(() => {});
      prefetchCommonPages();
    } else {
      checkSetup();
    }
  }, []);

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
  }, [user]);

  async function handleLogout() {
    await disablePushForLogout();
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setUser(null);
  }

  if (loadingSetup) {
    return <div className="centered-screen">جاري التحميل...</div>;
  }

  if (connectionError) {
    return (
      <div className="centered-screen">
        <div style={{ width: "100%", maxWidth: 380 }}>
          <div className="error-box">
            تعذّر الاتصال بالسيرفر: {connectionError}
            <br /><br />
            تأكد أن رابط الـ API بملف <code>src/api.js</code> صحيح ويشير لخدمة الـ Backend الصحيحة على Render، وأن السيرفر شغّال (Live).
          </div>
          <button className="btn-primary" onClick={checkSetup}>إعادة المحاولة</button>
        </div>
      </div>
    );
  }

  if (needsSetup) {
    return <Setup onDone={(u) => { setUser(u); setNeedsSetup(false); }} />;
  }

  if (!user) {
    return <Login onLoggedIn={setUser} />;
  }

  const isPrivileged = user.role === "super_admin" || user.role === "admin";
  const isSuperAdmin = user.role === "super_admin";
  const isDriver = user.role === "driver";
  const canSeeProducts = isPrivileged || user.role === "data_entry";

  return (
    <div className="app-shell">
      <TopBar user={user} isPrivileged={isPrivileged} unreadCount={unreadCount} darkMode={darkMode} setDarkMode={setDarkMode} onLogout={handleLogout} />

      <Suspense fallback={<PageLoading />}>
      <Routes>
        <Route path="/" element={isDriver ? <Navigate to="/customers" replace /> : <Dashboard user={user} />} />
        <Route path="/customers" element={<Customers user={user} />} />
        <Route path="/customers/:id" element={<CustomerDetail user={user} />} />
        <Route path="/orders" element={<Orders user={user} />} />
        <Route path="/trip" element={<Trip user={user} />} />
        <Route path="/notes" element={<Notes />} />
        {canSeeProducts && <Route path="/products" element={<Products user={user} />} />}
        {isPrivileged && <Route path="/driver-balances" element={<DriverBalances />} />}
        {isPrivileged && <Route path="/reports" element={<Reports />} />}
        {isPrivileged && <Route path="/cash" element={<Cash />} />}
        {isPrivileged && <Route path="/overdue-customers" element={<OverdueCustomers />} />}
        {isPrivileged && <Route path="/driver-performance" element={<DriverPerformance />} />}
        {isPrivileged && <Route path="/customers-map" element={<CustomersMap />} />}
        <Route path="/notifications" element={<Notifications />} />
        {isPrivileged && <Route path="/trip-archive" element={<TripArchive />} />}
        {isPrivileged && <Route path="/customer-growth" element={<CustomerGrowth />} />}
        {isSuperAdmin && <Route path="/activity-log" element={<ActivityLog />} />}
        {isSuperAdmin && <Route path="/backup" element={<Backup />} />}
        {isDriver && <Route path="/my-balance" element={<MyBalance user={user} />} />}
        {isSuperAdmin && <Route path="/users" element={<Users />} />}
        <Route path="*" element={<Navigate to={isDriver ? "/customers" : "/"} replace />} />
      </Routes>
      </Suspense>

      <BottomNav role={user.role} />
    </div>
  );
}

function TopBar({ isPrivileged, unreadCount, darkMode, setDarkMode, onLogout }) {
  const navigate = useNavigate();

  return (
    <div className="top-bar">
      <strong>جوهرة الرابية</strong>
      <div className="icon-row">
        <button className="icon-btn" onClick={() => navigate("/notes")} title="ملاحظاتي">
          <FiEdit3 size={16} />
        </button>
        <button className="icon-btn" onClick={() => setDarkMode(!darkMode)} title="الوضع الليلي">
          {darkMode ? <FiSun size={16} /> : <FiMoon size={16} />}
        </button>
        {(
          <button className="icon-btn" style={{ position: "relative" }} onClick={() => navigate("/notifications")} title="الإشعارات">
            <FiBell size={16} />
            {unreadCount > 0 && (
              <span style={{
                position: "absolute", top: -4, left: -4, background: "var(--urgent)", color: "#fff",
                borderRadius: "50%", width: 16, height: 16, fontSize: "0.65rem",
                display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700,
              }}>
                {unreadCount}
              </span>
            )}
          </button>
        )}
        <button className="btn-danger-text" onClick={onLogout}>خروج</button>
      </div>
    </div>
  );
}
