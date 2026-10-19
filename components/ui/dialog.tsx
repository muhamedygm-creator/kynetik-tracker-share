"use client";
/** Modal built on <dialog>: keyboard and focus handling come from the browser. */
import { createContext, useContext, useRef, type ReactNode } from "react";
import { btn } from "./buttons";

const CloseCtx = createContext<() => void>(() => {});
export const useCloseDialog = () => useContext(CloseCtx);

export { btn } from "./buttons";

export function Dialog({ trigger, title, children, wide, triggerClass = btn.ghost, disabled }: {
  trigger: ReactNode; title: string; children: ReactNode; wide?: boolean; triggerClass?: string; disabled?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const close = () => ref.current?.close();
  return (
    <>
      <button type="button" disabled={disabled} className={triggerClass} onClick={() => ref.current?.showModal()}>{trigger}</button>
      <dialog ref={ref} className={`m-auto w-[calc(100%-2rem)] rounded-[10px] border border-line2 bg-panel p-0 text-ink backdrop:bg-black/70 ${wide ? "max-w-3xl" : "max-w-lg"}`}
        onClick={(e) => { if (e.target === ref.current) close(); }}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="display text-sm">{title}</h2>
          <button type="button" onClick={close} aria-label="Close" className="font-mono text-grey hover:text-ink">✕</button>
        </div>
        <div className="max-h-[75dvh] overflow-y-auto px-5 py-4">
          <CloseCtx.Provider value={close}>{children}</CloseCtx.Provider>
        </div>
      </dialog>
    </>
  );
}
