import { useEffect } from "react";
import { createPortal } from "react-dom";

// لوحة ناعمة بتطلع من تحت (بدل نوافذ المتصفح السودا)
export default function Sheet({ open, title, onClose, children }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose?.();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" aria-hidden="true" />
        {title && <h2 className="sheet-title">{title}</h2>}
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
