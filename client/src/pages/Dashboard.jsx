import { useNavigate } from "react-router-dom";
import { FiSearch, FiBox } from "react-icons/fi";

const ROLE_LABELS = {
  super_admin: "مدير",
  admin: "مساعد مدير",
  driver: "سائق توصيل",
  data_entry: "موظف الإدخال",
};

export default function Dashboard({ user }) {
  const navigate = useNavigate();
  const isPrivileged = user.role === "super_admin" || user.role === "admin";

  return (
    <div className="page">
      <h1 className="title-lg">جوهرة الرابية</h1>
      <p className="text-secondary" style={{ marginBottom: 20 }}>
        أهلًا {user.full_name} — {ROLE_LABELS[user.role] || user.role}
      </p>

      <button className="btn-primary icon-row" style={{ justifyContent: "center", marginBottom: 12 }} onClick={() => navigate("/customers")}>
        <FiSearch /> بحث عن عميل
      </button>

      {isPrivileged && (
        <button className="btn-secondary icon-row" style={{ justifyContent: "center" }} onClick={() => navigate("/products")}>
          <FiBox /> إدارة المنتجات والأسعار
        </button>
      )}
    </div>
  );
}
