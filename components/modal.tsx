"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** A modal built on the native <dialog>: the browser keeps focus inside it,
 * makes the page behind it inert, closes it on Escape and returns focus to
 * whatever opened it. */
export function Modal({ open, onClose, labelledBy, describedBy, className = "", children }: {
  open: boolean; onClose: () => void; labelledBy: string; describedBy?: string; className?: string; children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal(); else dialog.setAttribute("open", "");
    } else if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog ref={ref} className={`modal ${className}`} aria-labelledby={labelledBy} aria-describedby={describedBy}
      onClose={() => { if (open) onClose(); }}
      // A click on the backdrop lands on the dialog element itself.
      onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      {open && children}
    </dialog>
  );
}
