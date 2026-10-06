import { NavLink } from "react-router-dom";
import { FiHome, FiUsers, FiPackage, FiTruck, FiGrid } from "react-icons/fi";
import { usePerms } from "../auth.jsx";

function Item({ to, icon: Icon, label, end }) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) => "nav-item" + (isActive ? " active" : "")}>
      <Icon className="nav-icon" aria-hidden="true" />
      {label}
    </NavLink>
  );
}

export default function BottomNav() {
  const { can } = usePerms();
  const canCustomers = can("customers") || can("orders") || can("delivery", "edit");
  const canTrip = can("delivery", "edit") || can("trips");

  return (
    <nav className="bottom-nav" aria-label="التنقل الرئيسي">
      {can("dashboard") && <Item to="/" end icon={FiHome} label="الرئيسية" />}
      {canCustomers && <Item to="/customers" icon={FiUsers} label="العملاء" />}
      {can("orders") && <Item to="/orders" icon={FiPackage} label="الطلبات" />}
      {canTrip && <Item to="/trip" icon={FiTruck} label="الرحلة" />}
      <Item to="/more" icon={FiGrid} label="المزيد" />
    </nav>
  );
}
