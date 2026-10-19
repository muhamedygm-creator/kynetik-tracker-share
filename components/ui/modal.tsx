"use client";
import { useEffect, useRef, type ReactNode } from "react";

/** Controlled modal on <dialog>: open/close driven by state; Esc and backdrop click close it. */
export function Modal({ open, onClose, title, children, wide, xl }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean; xl?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} onClick={(e) => e.target === ref.current && onClose()}
      className={`m-auto w-[calc(100%-2rem)] rounded-[10px] border border-line2 bg-panel p-0 text-ink backdrop:bg-black/70 ${xl ? "max-w-6xl" : wide ? "max-w-2xl" : "max-w-lg"}`}>
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <h2 className="display text-sm">{title}</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="font-mono text-grey hover:text-ink">✕</button>
      </div>
      <div className="max-h-[75dvh] overflow-y-auto px-5 py-4">{open && children}</div>
    </dialog>
  );
}
