import { useEffect, useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { api } from "./api.js";

import Setup from "./pages/Setup.jsx";
import Login from "./pages/Login.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Customers from "./pages/Customers.jsx";
import CustomerDetail from "./pages/CustomerDetail.jsx";
import Products from "./pages/Products.jsx";
import Users from "./pages/Users.jsx";
import BottomNav from "./components/BottomNav.jsx";

export default function App() {
  const [loadingSetup, setLoadingSetup] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [connectionError, setConnectionError] = useState("");
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem("user");
    return raw ? JSON.parse(raw) : null;
  });

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

  return (
    <div className="app-shell">
      <div className="top-bar">
        <strong>جوهرة الرابية</strong>
        <button className="btn-danger-text" onClick={handleLogout}>خروج</button>
      </div>

      <Routes>
        <Route path="/" element={<Dashboard user={user} />} />
        <Route path="/customers" element={<Customers user={user} />} />
        <Route path="/customers/:id" element={<CustomerDetail user={user} />} />
        {isPrivileged && <Route path="/products" element={<Products />} />}
        {isSuperAdmin && <Route path="/users" element={<Users />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      <BottomNav role={user.role} />
    </div>
  );
}
