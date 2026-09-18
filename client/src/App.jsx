import { useEffect, useRef, useState } from "react";
import { Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { api } from "./api.js";
import { FiBell, FiMoon, FiSun, FiEdit3 } from "react-icons/fi";

import Setup from "./pages/Setup.jsx";
import Login from "./pages/Login.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Customers from "./pages/Customers.jsx";
import CustomerDetail from "./pages/CustomerDetail.jsx";
import Orders from "./pages/Orders.jsx";
import Trip from "./pages/Trip.jsx";
import Products from "./pages/Products.jsx";
import DriverBalances from "./pages/DriverBalances.jsx";
import MyBalance from "./pages/MyBalance.jsx";
import Reports from "./pages/Reports.jsx";
import Cash from "./pages/Cash.jsx";
import OverdueCustomers from "./pages/OverdueCustomers.jsx";
import DriverPerformance from "./pages/DriverPerformance.jsx";
import CustomersMap from "./pages/CustomersMap.jsx";
import ActivityLog from "./pages/ActivityLog.jsx";
import Backup from "./pages/Backup.jsx";
import Notifications from "./pages/Notifications.jsx";
import TripArchive from "./pages/TripArchive.jsx";
import CustomerGrowth from "./pages/CustomerGrowth.jsx";
import Notes from "./pages/Notes.jsx";
import Users from "./pages/Users.jsx";
import BottomNav from "./components/BottomNav.jsx";

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

export default function App() {
  const [loadingSetup, setLoadingSetup] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [connectionError, setConnectionError] = useState("");
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem("user");
    return raw ? JSON.parse(raw) : null;
  });

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
    checkSetup();
  }, []);

  useEffect(() => {
    const isPrivileged = user && (user.role === "super_admin" || user.role === "admin");
    if (!isPrivileged) return;

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
          newOnes.forEach((n) => seenIdsRef.current.add(n.id));
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

  function handleLogout() {
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
        {isPrivileged && <Route path="/notifications" element={<Notifications />} />}
        {isPrivileged && <Route path="/trip-archive" element={<TripArchive />} />}
        {isPrivileged && <Route path="/customer-growth" element={<CustomerGrowth />} />}
        {isSuperAdmin && <Route path="/activity-log" element={<ActivityLog />} />}
        {isSuperAdmin && <Route path="/backup" element={<Backup />} />}
        {isDriver && <Route path="/my-balance" element={<MyBalance user={user} />} />}
        {isSuperAdmin && <Route path="/users" element={<Users />} />}
        <Route path="*" element={<Navigate to={isDriver ? "/customers" : "/"} replace />} />
      </Routes>

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
        {isPrivileged && (
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
