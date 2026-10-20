import { useState } from "react";
import { FiUser, FiLock, FiEye, FiEyeOff } from "react-icons/fi";
import { api } from "../api.js";
import "./factory.css";

// ============================================================
// شاشة دخول المصنع: شعار المصنع، حقلين، زر، وموج تحت
// بتطلع من الرابط /m/<رقم المصنع>، أو لحالها لمّا حدا دخل من قبل على هالتلفون كموظف بالمصنع
// ============================================================
export function readFactoryLogin() {
  try { return JSON.parse(localStorage.getItem("fx_login") || "null"); } catch { return null; }
}
export function saveFactoryLogin(b) {
  try {
    if (b) localStorage.setItem("fx_login", JSON.stringify(b));
    else localStorage.removeItem("fx_login");
  } catch { /* تجاهل */ }
}

export default function FactoryLogin({ brand, onLoggedIn, onSwitch }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const r = await api.login({ username, password });
      if (r.shop?.plan !== "factory" || (brand?.id && r.shop.id !== brand.id)) saveFactoryLogin(null);
      localStorage.setItem("token", r.token);
      localStorage.setItem("user", JSON.stringify(r.user));
      onLoggedIn({ ...r.user, shop: r.shop });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fx">
      <div className="fx-login">
        <form className="fx-login-body" onSubmit={submit}>
          <div className="fx-login-logo">
            {brand?.logo ? <img src={brand.logo} alt={brand.name} /> : <b style={{ fontSize: 26, color: "var(--fx-navy)" }}>{brand?.name}</b>}
          </div>
          <h1>تسجيل الدخول</h1>
          {error && <div className="fx-err" role="alert">{error}</div>}
          <label className="fx-pillfield">
            <FiUser aria-hidden="true" />
            <input id="login-user" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="اسم المستخدم" autoComplete="username" autoCapitalize="none" dir="auto" required aria-label="اسم المستخدم" />
          </label>
          <label className="fx-pillfield">
            <FiLock aria-hidden="true" />
            <input id="login-pass" type={show ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="كلمة المرور" autoComplete="current-password" required aria-label="كلمة المرور" />
            <button type="button" onClick={() => setShow(!show)} aria-label={show ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}>{show ? <FiEyeOff /> : <FiEye />}</button>
          </label>
          <button className="fx-login-btn" disabled={loading}>{loading ? "لحظة..." : "دخول"}</button>
          <p className="fx-muted" style={{ textAlign: "center", margin: "4px 0 0" }}>
            ما عندك حساب؟ الإدارة بتعملك واحد{brand?.phone ? ` — ${brand.phone}` : ""}
          </p>
          {onSwitch && <button type="button" className="fx-link" style={{ justifySelf: "center", fontSize: 12.5, color: "var(--fx-muted)" }} onClick={onSwitch}>دخول لحساب ثاني على موج</button>}
        </form>
        <div className="fx-login-waves" aria-hidden="true">
          <svg viewBox="0 0 400 190" preserveAspectRatio="none">
            <defs>
              <linearGradient id="fxw1" x1="0" x2="1"><stop offset="0" stopColor="#8fd3f6" /><stop offset="1" stopColor="#c9ecfb" /></linearGradient>
              <linearGradient id="fxw2" x1="0" x2="1"><stop offset="0" stopColor="#2aa6ea" /><stop offset="1" stopColor="#67c3f2" /></linearGradient>
              <linearGradient id="fxw3" x1="0" x2="1"><stop offset="0" stopColor="#0456a2" /><stop offset="1" stopColor="#0a73c9" /></linearGradient>
            </defs>
            <path d="M0 70 C80 20 160 40 230 55 C300 70 350 30 400 20 V190 H0Z" fill="url(#fxw1)" />
            <path d="M0 105 C70 70 150 60 220 85 C290 110 340 80 400 60 V190 H0Z" fill="url(#fxw2)" opacity=".9" />
            <path d="M0 140 C90 110 170 115 240 128 C310 141 355 120 400 105 V190 H0Z" fill="url(#fxw3)" />
          </svg>
        </div>
        <div className="fx-login-tag">نقاء ... لصحة أفضل</div>
      </div>
    </div>
  );
}
