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
