import { useEffect, useState } from "react";
import { FiX } from "react-icons/fi";

// ============================================================
// زر مسح ✕ جوّا أي خانة كتابة: بيطلع لما تكتب، وبيختفي لما تفضى
// (واحد للتطبيق كله — بيلحق الخانة اللي إنت فيها)
// ============================================================
const OK_TYPES = new Set(["text", "search", "tel", "number", "email", "url", ""]);
const eligible = (el) => el && el.tagName === "INPUT" && OK_TYPES.has(el.type) && !el.readOnly && !el.disabled
  && !el.closest(".fx-date, .fx-stepper, .fx-qty, [data-noclear]") && el.offsetWidth >= 90;

export default function InputClear() {
  const [el, setEl] = useState(null);
  const [box, setBox] = useState(null);
  useEffect(() => {
    let cur = null;
    const place = () => {
      if (!cur || !cur.value || document.activeElement !== cur) { setBox(null); cur?.classList.remove("fx-has-x"); return; }
      const r = cur.getBoundingClientRect();
      const rtl = getComputedStyle(cur).direction !== "ltr";
      cur.classList.add("fx-has-x");
      setBox({ top: r.top + r.height / 2, left: rtl ? r.left + 6 : r.right - 34 });
    };
    const onFocus = (e) => { if (eligible(e.target)) { cur?.classList.remove("fx-has-x"); cur = e.target; setEl(cur); place(); } };
    const onBlur = (e) => { if (e.target === cur) setTimeout(() => { if (document.activeElement !== cur) { cur?.classList.remove("fx-has-x"); setBox(null); } }, 150); };
    const onInput = (e) => { if (e.target === cur) place(); };
    document.addEventListener("focusin", onFocus);
    document.addEventListener("focusout", onBlur);
    document.addEventListener("input", onInput, true);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("focusout", onBlur);
      document.removeEventListener("input", onInput, true);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, []);
  if (!box || !el) return null;
  return (
    <button
      type="button"
      className="fx-clear-x"
      style={{ top: box.top, left: box.left }}
      aria-label="امسح"
      onPointerDown={(e) => e.preventDefault()} // ما نخسر التركيز من الخانة
      onClick={() => {
        // نفضّي الخانة بطريقة React بتحسّ فيها
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        set.call(el, "");
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.focus();
        setBox(null);
        el.classList.remove("fx-has-x");
      }}
    >
      <FiX />
    </button>
  );
}
