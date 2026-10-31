import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// لوحة ناعمة بتطلع من تحت (بدل نوافذ المتصفح السودا)
// بتتسكّر بسحبها لتحت من الخط الرمادي أو العنوان، أو بالكبس برّاها، أو بزر Esc
export default function Sheet({ open, title, onClose, children }) {
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef(null); // {y, t}
  const sheetRef = useRef(null);
  const moved = useRef(0); // عشان السحبة ما تنحسب كبسة

  useEffect(() => {
    if (!open) return;
    setDragY(0);
    const onKey = (e) => e.key === "Escape" && onClose?.();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  function onStart(e) {
    const y = e.touches ? e.touches[0].clientY : e.clientY;
    start.current = { y, t: Date.now() };
    moved.current = 0;
    setDragging(true);
  }
  function onMove(e) {
    if (!start.current) return;
    const y = e.touches ? e.touches[0].clientY : e.clientY;
    const d = Math.max(0, y - start.current.y);
    moved.current = Math.max(moved.current, Math.abs(y - start.current.y));
    setDragY(d);
  }
  function onEnd() {
    if (!start.current) return;
    const dt = Math.max(1, Date.now() - start.current.t);
    const fast = dragY / dt > 0.6; // سحبة سريعة
    const h = sheetRef.current?.offsetHeight || 400;
    start.current = null;
    setDragging(false);
    if (dragY > Math.min(140, h * 0.25) || (fast && dragY > 30)) {
      setDragY(h);
      setTimeout(() => { setDragY(0); onClose?.(); }, 160);
    } else {
      setDragY(0);
    }
  }

  if (!open) return null;
  const dragProps = {
    onTouchStart: onStart,
    onTouchMove: onMove,
    onTouchEnd: onEnd,
    onTouchCancel: onEnd,
    onMouseDown: onStart,
  };
  return createPortal(
    <div
      className="sheet-backdrop"
      onClick={onClose}
      onMouseMove={dragging ? onMove : undefined}
      onMouseUp={dragging ? onEnd : undefined}
      style={dragY ? { background: `rgba(10, 22, 40, ${Math.max(0, 0.38 - dragY / 1200)})` } : undefined}
    >
      <div
        ref={sheetRef}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        style={{ transform: dragY ? `translateY(${dragY}px)` : undefined, transition: dragging ? "none" : "transform 0.18s ease-out" }}
      >
        <div className="sheet-grab" {...dragProps}>
          <button type="button" className="sheet-handle-btn" onClick={() => { if (moved.current < 6) onClose?.(); }} aria-label="إغلاق (اسحب لتحت)">
            <span className="sheet-handle" aria-hidden="true" />
          </button>
          {title && <h2 className="sheet-title">{title}</h2>}
        </div>
        {children}
      </div>
    </div>,
    document.body
  );
}

// تأكيد بسيط: «متأكد؟» مع زرين
export function ConfirmSheet({ open, title, text, confirmLabel = "تأكيد", cancelLabel = "لا، رجوع", danger, busy, onConfirm, onClose }) {
  return (
    <Sheet open={open} title={title} onClose={onClose}>
      {text && <p className="sheet-text">{text}</p>}
      <div className="sheet-actions">
        <button className={danger ? "btn-danger-solid" : "btn-primary"} disabled={busy} onClick={onConfirm}>
          {busy ? "لحظة..." : confirmLabel}
        </button>
        <button className="btn-secondary" disabled={busy} onClick={onClose}>{cancelLabel}</button>
      </div>
    </Sheet>
  );
}
