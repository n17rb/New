import { useEffect } from "react";
import { api } from "../api.js";

// تطبيق الكابتن (أندرويد): تتبع السيارة لحظة بلحظة — بيكمل والشاشة مطفية أو التطبيق بالخلفية (مع إشعار ثابت)
// بالمتصفح العادي ما بيعمل إشي (صفحة الرحلة بتبعت الموقع وهي مفتوحة)
export const isCaptainApp = () => !!window.Capacitor?.isNativePlatform?.();

export default function NativeTracker({ enabled }) {
  useEffect(() => {
    if (!enabled) return;
    const BG = isCaptainApp() ? window.Capacitor.Plugins?.BackgroundGeolocation : null;
    if (!BG) return;
    let watcher = null;
    let lastAt = 0;
    BG.addWatcher(
      {
        backgroundTitle: "تتبع السيارة شغّال",
        backgroundMessage: "موقعك بيوصل للمحل وإنت بالطريق",
        requestPermissions: true,
        stale: false,
        distanceFilter: 15,
      },
      (loc, err) => {
        if (err) {
          if (err.code === "NOT_AUTHORIZED" && window.confirm("التطبيق محتاج صلاحية الموقع عشان يتبع السيارة. نفتح الإعدادات؟ اختار «السماح طوال الوقت»")) BG.openSettings();
          return;
        }
        if (!loc || Date.now() - lastAt < 15000) return;
        lastAt = Date.now();
        api.pingLocation(loc.latitude, loc.longitude).catch(() => {});
      }
    ).then((id) => { watcher = id; }).catch(() => {});
    return () => { if (watcher) BG.removeWatcher({ id: watcher }).catch(() => {}); };
  }, [enabled]);
  return null;
}
