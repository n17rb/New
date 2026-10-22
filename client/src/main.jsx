import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import "./styles.css";

// الآيفون: بعد ما يتسكّر الكيبورد أحيانًا الصفحة بتضل مزاحة لفوق والشريط السفلي بيطلع بنص الشاشة — منرجّعها
if (window.visualViewport) {
  let last = window.visualViewport.height;
  window.visualViewport.addEventListener("resize", () => {
    const h = window.visualViewport.height;
    if (h > last + 80) setTimeout(() => window.scrollTo(0, 0), 50);
    last = h;
  });
}
document.addEventListener("focusout", (e) => {
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || "")) setTimeout(() => { if (!/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "")) window.scrollTo(0, 0); }, 120);
});

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);

// ============================================================
// تحديث تلقائي: لما ينزل إصدار جديد من التطبيق، بيطلع شريط «في تحديث جديد» وبيتحدّث بكبسة
// (وإذا التطبيق كان بالخلفية ورجعت عليه، بيتحدّث لحاله) — هيك ما حدا بيضل على نسخة قديمة
// ============================================================
(function autoUpdate() {
  const mine = () => [...document.querySelectorAll('script[type="module"][src]')].map((s) => s.getAttribute("src")).find((s) => /\/assets\/.+\.js$/.test(s));
  const current = mine();
  if (!current) return; // وقت التطوير
  let shown = false;
  async function check(silentReload) {
    try {
      const html = await (await fetch(`/?v=${Date.now()}`, { cache: "no-store" })).text();
      const latest = html.match(/src="(\/assets\/[^"]+\.js)"/)?.[1];
      if (!latest || latest === current) return;
      if (silentReload) return window.location.reload();
      if (shown) return;
      shown = true;
      const bar = document.createElement("button");
      bar.textContent = "✨ في تحديث جديد للتطبيق — اكبس هون";
      bar.setAttribute("style", "position:fixed;top:calc(10px + env(safe-area-inset-top));left:50%;transform:translateX(-50%);z-index:9999;border:0;border-radius:999px;padding:12px 20px;background:#0456a2;color:#fff;font:700 15px system-ui;box-shadow:0 8px 24px rgba(0,0,0,.25);cursor:pointer;max-width:calc(100% - 32px)");
      bar.onclick = () => window.location.reload();
      document.body.appendChild(bar);
    } catch { /* ما في شبكة */ }
  }
  let hiddenAt = 0;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { hiddenAt = Date.now(); return; }
    // رجع على التطبيق بعد دقيقة أو أكثر: إذا في نسخة جديدة منحدّث لحاله (ما في إشي مفتوح بيضيع)
    check(Date.now() - hiddenAt > 60000 && !document.querySelector(".fx-sheet, .sheet, input:focus, textarea:focus"));
  });
  setInterval(() => check(false), 5 * 60000);
  setTimeout(() => check(false), 15000);
})();
