import { useState } from "react";
import { api } from "../api.js";
import { LogoMark, Wordmark } from "../components/Logo.jsx";

export default function Login({ onLoggedIn }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const result = await api.login({ username, password });
      localStorage.setItem("token", result.token);
      localStorage.setItem("user", JSON.stringify(result.user));
      onLoggedIn(result.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-screen">
      <div className="login-hero">
        <LogoMark size={76} color="#fff" strokeWidth={3} />
        <div style={{ marginTop: 18 }}>
          <Wordmark light size="lg" />
        </div>
        <div className="login-tagline">نقاء تثق به</div>
      </div>

      <form className="login-form" onSubmit={handleSubmit}>
        <h1 className="title-md" style={{ fontSize: "1.15rem", marginBottom: 18 }}>تسجيل الدخول</h1>

        {error && <div className="error-box">{error}</div>}

        <div className="field">
          <label htmlFor="login-user">اسم المستخدم</label>
          <input id="login-user" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus autoComplete="username" dir="auto" />
        </div>
        <div className="field" style={{ marginBottom: 22 }}>
          <label htmlFor="login-pass">كلمة المرور</label>
          <input id="login-pass" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
        </div>
        <button className="btn-primary" disabled={loading}>
          {loading ? "جاري الدخول..." : "دخول"}
        </button>
      </form>
    </div>
  );
}
