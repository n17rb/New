import { api, clearApiCache } from "./api.js";
import { readShop, saveShop } from "./shop.js";

// ============================================================
// المدير بيعاين حساب موظف: بيشوف التطبيق زي ما بيشوفه الموظف بالزبط (مشاهدة بس)
// حسابه الأصلي بينحفظ على جنب، و«رجوع لحسابي» بيرجّعه
// ============================================================
const KEY = "viewas_backup";

export function isViewingAs() {
  try { return !!localStorage.getItem(KEY); } catch { return false; }
}

export async function startViewAs(userId) {
  const r = await api.viewAsUser(userId);
  localStorage.setItem(KEY, JSON.stringify({
    token: localStorage.getItem("token"),
    user: JSON.parse(localStorage.getItem("user") || "null"),
    shop: readShop(),
    back: window.location.pathname,
  }));
  localStorage.setItem("token", r.token);
  try {
    clearApiCache?.();
    const me = await api.getMe();
    const { shop, ...u } = me;
    localStorage.setItem("user", JSON.stringify(u));
    if (shop) saveShop(shop);
  } catch (e) {
    endViewAs(false);
    throw e;
  }
  window.location.href = "/";
}

export function endViewAs(reload = true) {
  try {
    const b = JSON.parse(localStorage.getItem(KEY) || "null");
    localStorage.removeItem(KEY);
    if (b) {
      localStorage.setItem("token", b.token);
      localStorage.setItem("user", JSON.stringify(b.user));
      saveShop(b.shop);
      try { clearApiCache?.(); } catch { /* تجاهل */ }
      if (reload) window.location.href = b.back && b.back !== "/" ? b.back : "/users";
    }
  } catch { /* تجاهل */ }
}
