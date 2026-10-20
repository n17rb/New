import { API_ORIGIN } from "../api.js";

// ============================================================
// اسم وأيقونة التطبيق على الشاشة الرئيسية: بيصيروا باسم المصنع وشعاره بدل «موج»
// (آيفون بياخذهم من apple-touch-icon و apple-mobile-web-app-title، وأندرويد من الـ manifest)
// ============================================================
function setMeta(name, content) {
  let el = document.querySelector(`meta[name="${name}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute("name", name);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}
function setLink(rel, href, extra = {}) {
  document.querySelectorAll(`link[rel="${rel}"]`).forEach((l) => l.remove());
  const el = document.createElement("link");
  el.rel = rel;
  el.href = href;
  for (const [k, v] of Object.entries(extra)) el.setAttribute(k, v);
  document.head.appendChild(el);
}

export function applyBrandHead(brand, factoryId) {
  if (!brand || !factoryId) return;
  const short = String(brand.name || "").split(" ").slice(0, 2).join(" ") || "المصنع";
  document.title = brand.name || short;
  setMeta("apple-mobile-web-app-title", short);
  setMeta("application-name", short);
  setMeta("theme-color", "#ffffff");
  const icon = brand.icon || brand.logo;
  if (icon) {
    setLink("apple-touch-icon", icon);
    setLink("icon", icon, { type: "image/png" });
  }
  setLink("manifest", `${API_ORIGIN}/api/public/f/manifest/${factoryId}?o=${encodeURIComponent(window.location.origin)}`);
}
