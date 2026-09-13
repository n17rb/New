import { NavLink } from "react-router-dom";
import { FiHome, FiUsers, FiPackage, FiBox, FiShield } from "react-icons/fi";

export default function BottomNav({ role }) {
  const isSuperAdmin = role === "super_admin";
  const isPrivileged = role === "super_admin" || role === "admin";
  const canSeeOrders = role !== "data_entry";

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
      {canSeeOrders && (
        <NavLink to="/orders" className={({ isActive }) => "nav-item" + (isActive ? " active" : "")}>
          <FiPackage className="nav-icon" />
          الطلبات
        </NavLink>
      )}
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
