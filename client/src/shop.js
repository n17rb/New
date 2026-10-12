// معلومات المحل الحالي (موج): الاسم، حالة الاشتراك، الديمو، المعاينة
// بتنحفظ مع المستخدم وبتتحدّث من /auth/me

export function readShop() {
  try {
    return JSON.parse(localStorage.getItem("shop") || "null");
  } catch {
    return null;
  }
}

export function saveShop(shop) {
  try {
    if (shop) localStorage.setItem("shop", JSON.stringify(shop));
    else localStorage.removeItem("shop");
  } catch {
    // تجاهل
  }
}

// اسم المحل للرسائل اللي بتنبعت للزباين (واتساب، الإيصالات، الفواتير)
export function shopName() {
  return readShop()?.name || "محل المي";
}

export const APP_NAME = "موج";
export const SUPPORT_PHONE = "0792376983";

export function whatsappNumber(local) {
  const digits = String(local || "").replace(/\D/g, "");
  if (digits.startsWith("962")) return digits;
  if (digits.startsWith("0")) return `962${digits.slice(1)}`;
  return digits;
}
