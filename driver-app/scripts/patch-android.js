// بعد «cap add android»: صلاحيات الموقع بالخلفية، أيقونة التطبيق، ورقم الإصدار
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..", "android");
const manifestPath = path.join(root, "app", "src", "main", "AndroidManifest.xml");
let m = fs.readFileSync(manifestPath, "utf8");
const perms = [
  "android.permission.ACCESS_COARSE_LOCATION",
  "android.permission.ACCESS_FINE_LOCATION",
  "android.permission.FOREGROUND_SERVICE",
  "android.permission.FOREGROUND_SERVICE_LOCATION",
  "android.permission.POST_NOTIFICATIONS",
  "android.permission.WAKE_LOCK",
  "android.permission.CAMERA",
];
const add = perms.filter((p) => !m.includes(`"${p}"`)).map((p) => `    <uses-permission android:name="${p}" />`).join("\n");
if (add) m = m.replace(/<\/manifest>\s*$/, `${add}\n    <uses-feature android:name="android.hardware.location.gps" android:required="false" />\n</manifest>\n`);
fs.writeFileSync(manifestPath, m);

// الأيقونة: نفس أيقونة التطبيق
const icon = path.join(__dirname, "..", "..", "client", "public", "icon-512.png");
const res = path.join(root, "app", "src", "main", "res");
if (fs.existsSync(icon)) {
  for (const dir of fs.readdirSync(res).filter((d) => d.startsWith("mipmap-"))) {
    const full = path.join(res, dir);
    if (dir.includes("anydpi")) { fs.rmSync(full, { recursive: true, force: true }); continue; }
    for (const f of ["ic_launcher.png", "ic_launcher_round.png", "ic_launcher_foreground.png"]) {
      if (fs.existsSync(path.join(full, f))) fs.copyFileSync(icon, path.join(full, f));
    }
  }
}

// رقم الإصدار من رقم البناء (عشان التحديث ينزل فوق القديم)
const gradlePath = path.join(root, "app", "build.gradle");
let g = fs.readFileSync(gradlePath, "utf8");
const code = Number(process.env.BUILD_NUMBER || 1);
g = g.replace(/versionCode \d+/, `versionCode ${code}`).replace(/versionName "[^"]*"/, `versionName "1.0.${code}"`);
fs.writeFileSync(gradlePath, g);
// إشعارات Firebase: ملف google-services.json (من GitHub Secret أو من المجلد) — وإذا موجود بنعلّم التطبيق إنه جاهز
const gsSrc = [path.join(__dirname, "..", "google-services.json")].find((f) => fs.existsSync(f));
const gsJson = process.env.GOOGLE_SERVICES_JSON || (gsSrc ? fs.readFileSync(gsSrc, "utf8") : "");
const cfgPath = path.join(__dirname, "..", "capacitor.config.json");
const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
cfg.android = cfg.android || {};
if (gsJson.trim()) {
  fs.writeFileSync(path.join(root, "app", "google-services.json"), gsJson);
  cfg.android.appendUserAgent = "MawjDriver/1 fcm";
} else {
  cfg.android.appendUserAgent = "MawjDriver/1";
}
fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
console.log("android patched", { code, fcm: !!gsJson.trim() });
