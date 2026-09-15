import { useEffect, useRef, useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { api } from "./api.js";
import { FiBell } from "react-icons/fi";

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
    // بعض المتصفحات تمنع الصوت قبل أول تفاعل من المستخدم — لا مشكلة، الإشعار النصي يبقى يظهر
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

  const [notifications, setNotifications] = useState([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const deliveredIdsRef = useRef(new Set());
  const firstLoadRef = useRef(true);

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
        const trips = await api.getActiveTripsList();
        if (!trips || trips.length === 0) return;

        const allDeliveredStops = trips.flatMap((trip) =>
          trip.stops
            .filter((s) => s.order_status === "DELIVERED")
            .map((s) => ({ ...s, tripDriverName: trip.driver_name, tripDeliveredCount: trip.delivered_count, tripTotalCount: trip.total_count }))
        );

        if (firstLoadRef.current) {
          allDeliveredStops.forEach((s) => deliveredIdsRef.current.add(s.id));
          firstLoadRef.current = false;
          return;
        }

        const newlyDelivered = allDeliveredStops.filter((s) => !deliveredIdsRef.current.has(s.id));
        if (newlyDelivered.length > 0) {
          const newNotifications = newlyDelivered.map((s) => ({
            id: s.id,
            text: `✅ ${s.tripDriverName || "سائق"} سلّم طلب ${s.customer_name} — ${s.tripDeliveredCount}/${s.tripTotalCount}`,
            time: new Date(),
            read: false,
          }));
          setNotifications((prev) => [...newNotifications, ...prev].slice(0, 30));
          playNotificationSound();
          newlyDelivered.forEach((s) => deliveredIdsRef.current.add(s.id));
        }
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

  const unreadCount = notifications.filter((n) => !n.read).length;

  function toggleNotifications() {
    setShowNotifications((prev) => {
      const next = !prev;
      if (next) {
        setNotifications((list) => list.map((n) => ({ ...n, read: true })));
      }
      return next;
    });
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
      <div className="top-bar">
        <strong>جوهرة الرابية</strong>
        <div className="icon-row">
          {isPrivileged && (
            <div style={{ position: "relative" }}>
              <button
                className="icon-btn"
                onClick={toggleNotifications}
                style={{ position: "relative" }}
                title="الإشعارات"
              >
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

              {showNotifications && (
                <div style={{
                  position: "absolute", top: 44, left: 0, width: 280, maxHeight: 320, overflowY: "auto",
                  background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10,
                  boxShadow: "0 4px 16px rgba(0,0,0,0.15)", zIndex: 50, padding: 8,
                }}>
                  {notifications.length === 0 ? (
                    <p className="text-secondary" style={{ padding: 10, margin: 0, fontSize: "0.85rem" }}>لا يوجد إشعارات بعد.</p>
                  ) : (
                    notifications.map((n) => (
                      <div key={n.id} style={{ padding: "8px 6px", borderBottom: "1px solid var(--border)", fontSize: "0.85rem" }}>
                        <div>{n.text}</div>
                        <div className="text-secondary tabular-num" style={{ fontSize: "0.7rem" }}>
                          {n.time.toLocaleTimeString("ar-JO", { timeZone: "Asia/Amman", hour: "2-digit", minute: "2-digit" })}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          )}
          <button className="btn-danger-text" onClick={handleLogout}>خروج</button>
        </div>
      </div>

      <Routes>
        <Route path="/" element={isDriver ? <Navigate to="/customers" replace /> : <Dashboard user={user} />} />
        <Route path="/customers" element={<Customers user={user} />} />
        <Route path="/customers/:id" element={<CustomerDetail user={user} />} />
        <Route path="/orders" element={<Orders user={user} />} />
        <Route path="/trip" element={<Trip user={user} />} />
        {canSeeProducts && <Route path="/products" element={<Products user={user} />} />}
        {isPrivileged && <Route path="/driver-balances" element={<DriverBalances />} />}
        {isPrivileged && <Route path="/reports" element={<Reports />} />}
        {isDriver && <Route path="/my-balance" element={<MyBalance user={user} />} />}
        {isSuperAdmin && <Route path="/users" element={<Users />} />}
        <Route path="*" element={<Navigate to={isDriver ? "/customers" : "/"} replace />} />
      </Routes>

      <BottomNav role={user.role} />
    </div>
  );
}
