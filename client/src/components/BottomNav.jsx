import { NavLink } from "react-router-dom";
import { FiHome, FiUsers, FiBox, FiShield } from "react-icons/fi";

export default function BottomNav({ role }) {
  const isSuperAdmin = role === "super_admin";
  const isPrivileged = role === "super_admin" || role === "admin";

  return (
    <nav className="bottom-nav">
      <NavLink to="/" end className={({ isActive }) => "nav-item" + (isActive ? " active" : "")}>
        <FiHome className="nav-icon" />
        الرئيسية
      </NavLink>
      <NavLink to="/customers" className={({ isActive }) => "nav-item" + (isActive ? " active" : "")}>
        <FiUsers className="nav-icon" />
        العملاء
      </NavLink>
      {isPrivileged && (
        <NavLink to="/products" className={({ isActive }) => "nav-item" + (isActive ? " active" : "")}>
          <FiBox className="nav-icon" />
          المنتجات
        </NavLink>
      )}
      {isSuperAdmin && (
        <NavLink to="/users" className={({ isActive }) => "nav-item" + (isActive ? " active" : "")}>
          <FiShield className="nav-icon" />
          المستخدمون
        </NavLink>
      )}
    </nav>
  );
}
