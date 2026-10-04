import { api } from "./api.js";

export function isPushSupported() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export function isStandalone() {
  return window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

async function getRegistration() {
  const existing = await navigator.serviceWorker.getRegistration();
  if (!existing) await navigator.serviceWorker.register("/sw.js");
  return navigator.serviceWorker.ready;
}

// يشترك الجهاز بإشعارات السيرفر ويربطه بالحساب الحالي
async function subscribeCurrentDevice() {
  const reg = await getRegistration();
  const { publicKey } = await api.getPushPublicKey();
  const appKey = urlBase64ToUint8Array(publicKey);

  let sub = await reg.pushManager.getSubscription();
  if (sub) {
    // لو المفتاح تغيّر، نعمل اشتراك جديد
    const currentKey = sub.options?.applicationServerKey;
    if (currentKey && new Uint8Array(currentKey).toString() !== appKey.toString()) {
      await sub.unsubscribe();
      sub = null;
    }
  }
  if (!sub) {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appKey });
  }
  await api.subscribePush(sub.toJSON());
  return sub;
}

// يطلب الإذن (لازم يكون من ضغطة زر) ويفعّل الإشعارات
export async function enablePush() {
  if (!isPushSupported()) throw new Error("هذا المتصفح ما بيدعم إشعارات الجهاز.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("ما تم السماح بالإشعارات.");
  await subscribeCurrentDevice();
}

// بعد تسجيل الدخول: لو الإذن معطى من قبل، نتأكد إن الجهاز مربوط بالحساب الحالي
export async function refreshPushIfGranted() {
  if (!isPushSupported() || Notification.permission !== "granted") return;
  try {
    await subscribeCurrentDevice();
  } catch {
    // تجاهل — المستخدم بيقدر يفعّلها يدويًا من صفحة الإشعارات
  }
}

// عند تسجيل الخروج: نفصل الجهاز عن الحساب عشان ما توصله إشعارات حساب ثاني
export async function disablePushForLogout() {
  if (!isPushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) await api.unsubscribePush(sub.endpoint);
  } catch {
    // تجاهل
  }
}

export async function isCurrentDeviceSubscribed() {
  if (!isPushSupported() || Notification.permission !== "granted") return false;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    return !!(await reg?.pushManager.getSubscription());
  } catch {
    return false;
  }
}
