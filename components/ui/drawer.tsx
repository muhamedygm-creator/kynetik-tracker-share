"use client";
/** Right-side details panel (design system §5): Esc, the backdrop or Done closes it. Built on <dialog> for focus handling. */
import { useEffect, useRef, type ReactNode } from "react";

export function Drawer({ open, onClose, title, eyebrow, children, footer }: {
  open: boolean; onClose: () => void; title: ReactNode; eyebrow?: ReactNode; children: ReactNode; footer?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} onClick={(e) => e.target === ref.current && onClose()}
      className="fixed inset-y-0 left-auto right-0 m-0 h-dvh max-h-dvh w-full max-w-[420px] border-0 border-l border-line2 bg-panel3 p-0 text-ink shadow-[-12px_0_30px_rgba(0,0,0,.45)] backdrop:bg-black/50">
      <div className="flex h-full flex-col">
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            {eyebrow && <div className="font-mono text-xs text-gold">{eyebrow}</div>}
            <h2 className="mt-0.5 text-lg font-semibold">{title}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-11 w-11 shrink-0 place-items-center rounded-md text-grey hover:bg-panel2 hover:text-ink">✕</button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{open && children}</div>
        {footer && <div className="border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </dialog>
  );
}
