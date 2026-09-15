import { NavLink } from "react-router-dom";
import { FiHome, FiUsers, FiPackage, FiTruck, FiBox, FiShield, FiDollarSign } from "react-icons/fi";

export default function BottomNav({ role }) {
  const isSuperAdmin = role === "super_admin";
  const isPrivileged = role === "super_admin" || role === "admin";
  const isDriver = role === "driver";

  return (
    <nav className="bottom-nav">
      {!isDriver && (
        <NavLink to="/" end className={({ isActive }) => "nav-item" + (isActive ? " active" : "")}>
          <FiHome className="nav-icon" />
          الرئيسية
        </NavLink>
      )}
      <NavLink to="/customers" className={({ isActive }) => "nav-item" + (isActive ? " active" : "")}>
        <FiUsers className="nav-icon" />
        العملاء
      </NavLink>
      <NavLink to="/orders" className={({ isActive }) => "nav-item" + (isActive ? " active" : "")}>
        <FiPackage className="nav-icon" />
        الطلبات
      </NavLink>
      <NavLink to="/trip" className={({ isActive }) => "nav-item" + (isActive ? " active" : "")}>
        <FiTruck className="nav-icon" />
        الرحلة
      </NavLink>
      {(isPrivileged || role === "data_entry") && (
        <NavLink to="/products" className={({ isActive }) => "nav-item" + (isActive ? " active" : "")}>
          <FiBox className="nav-icon" />
          المنتجات
        </NavLink>
      )}
      {isDriver && (
        <NavLink to="/my-balance" className={({ isActive }) => "nav-item" + (isActive ? " active" : "")}>
          <FiDollarSign className="nav-icon" />
          رصيدي
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
