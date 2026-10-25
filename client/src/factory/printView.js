// ============================================================
// عرض الطباعة جوّا التطبيق: الورقة بتفتح فوق الشاشة مع زر «رجوع» و«اطبع / PDF»
// (بدل نافذة جديدة — على التلفون والتطبيق ما كان في رجوع)
// ============================================================
export function openPrint(html) {
  document.getElementById("fx-print-view")?.remove();
  const wrap = document.createElement("div");
  wrap.id = "fx-print-view";
  wrap.setAttribute("dir", "rtl");
  wrap.style.cssText = "position:fixed;inset:0;z-index:9999;background:#eef2f6;display:flex;flex-direction:column;";
  const bar = document.createElement("div");
  bar.style.cssText = "display:flex;gap:8px;align-items:center;justify-content:space-between;padding:10px 12px;padding-top:calc(10px + env(safe-area-inset-top));background:#fff;box-shadow:0 1px 6px rgba(0,0,0,.08);font-family:inherit;";
  const btn = (txt, primary) => {
    const b = document.createElement("button");
    b.textContent = txt;
    b.style.cssText = `border:0;border-radius:12px;padding:10px 16px;font:inherit;font-weight:700;font-size:15px;cursor:pointer;${primary ? "background:#0b5fa8;color:#fff;" : "background:#eef2f6;color:#17324d;"}`;
    return b;
  };
  const back = btn("→ رجوع", false);
  const print = btn("🖨️ اطبع / PDF", true);
  bar.append(back, print);
  const frame = document.createElement("iframe");
  frame.style.cssText = "flex:1;width:100%;border:0;background:#fff;";
  frame.setAttribute("title", "ورقة الطباعة");
  wrap.append(bar, frame);
  document.body.append(wrap);
  // الزر اللي جوّا الورقة (اطبع) ما بنحتاجه هون — شريطنا فيه زر
  frame.srcdoc = html.replace(/<button[^>]*onclick="print\(\)"[^>]*>[\s\S]*?<\/button>/g, "");
  const close = () => { wrap.remove(); window.removeEventListener("popstate", onPop); };
  const onPop = () => close();
  // زر الرجوع بالتلفون كمان بيسكّرها
  try { history.pushState({ fxPrint: 1 }, ""); window.addEventListener("popstate", onPop); } catch { /* */ }
  back.onclick = () => { const pushed = history.state?.fxPrint; close(); if (pushed) history.back(); };
  print.onclick = () => { try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch { /* */ } };
}
