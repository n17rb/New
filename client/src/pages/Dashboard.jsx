import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { FiSearch, FiBox, FiUsers, FiBarChart2 } from "react-icons/fi";

const ROLE_LABELS = {
  super_admin: "مدير",
  admin: "مساعد مدير",
  driver: "سائق توصيل",
  data_entry: "موظف الإدخال",
};

export default function Dashboard({ user }) {
  const navigate = useNavigate();
  const isPrivileged = user.role === "super_admin" || user.role === "admin";
  const isDriver = user.role === "driver";
  const [myBalance, setMyBalance] = useState(null);

  useEffect(() => {
    if (isDriver) {
      api.getDriverBalance(user.id).then((d) => setMyBalance(d.balance)).catch(() => {});
    }
  }, [isDriver, user.id]);

  return (
    <div className="page">
      <h1 className="title-lg">جوهرة الرابية</h1>
      <p className="text-secondary" style={{ marginBottom: 20 }}>
        أهلًا {user.full_name} — {ROLE_LABELS[user.role] || user.role}
      </p>

      {isDriver && myBalance !== null && (
        <div className="card">
          <div className="text-secondary">رصيدك الحالي المستحق للمحل</div>
          <div className="tabular-num" style={{ fontSize: "1.6rem", fontWeight: 700, color: myBalance > 0 ? "var(--urgent)" : "var(--success)" }}>
            {myBalance.toFixed(2)} JD
          </div>
        </div>
      )}

      <button className="btn-primary icon-row" style={{ justifyContent: "center", marginBottom: 12 }} onClick={() => navigate("/customers")}>
        <FiSearch /> بحث عن عميل
      </button>

      {isPrivileged && (
        <button className="btn-secondary icon-row" style={{ justifyContent: "center", marginBottom: 12 }} onClick={() => navigate("/products")}>
          <FiBox /> إدارة المنتجات والأسعار
        </button>
      )}

      {isPrivileged && (
        <button className="btn-secondary icon-row" style={{ justifyContent: "center", marginBottom: 12 }} onClick={() => navigate("/driver-balances")}>
          <FiUsers /> أرصدة السائقين
        </button>
      )}

      {isPrivileged && (
        <button className="btn-secondary icon-row" style={{ justifyContent: "center" }} onClick={() => navigate("/reports")}>
          <FiBarChart2 /> التقارير
        </button>
      )}
    </div>
  );
}
