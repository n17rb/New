import { createContext, useContext } from "react";

// المستخدم الحالي وصلاحياته — متاحة لكل الشاشات
export const UserContext = createContext(null);

const RANK = { none: 0, view: 1, edit: 2 };

export function canUser(user, section, level = "view") {
  if (!user) return false;
  if (user.role === "super_admin") return true;
  const current = user.permissions?.sections?.[section] || "none";
  return RANK[current] >= RANK[level];
}

export function canUserAction(user, action) {
  if (!user) return false;
  if (user.role === "super_admin") return true;
  return user.permissions?.actions?.[action] === true;
}

export function usePerms() {
  const user = useContext(UserContext);
  return {
    user,
    isOwner: user?.role === "super_admin",
    can: (section, level = "view") => canUser(user, section, level),
    canEdit: (section) => canUser(user, section, "edit"),
    canAction: (action) => canUserAction(user, action),
  };
}

// شريط صغير بأعلى الصفحة لما الصلاحية «متفرج»
export function ViewOnlyNote({ section }) {
  const { can, canEdit } = usePerms();
  if (!can(section) || canEdit(section)) return null;
  return (
    <div className="view-only-note" role="status">
      وضع المشاهدة — ما بتقدر تغيّر شي هون
    </div>
  );
}
