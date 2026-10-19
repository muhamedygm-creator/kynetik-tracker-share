"use client";
import { startTransition, useActionState, useEffect, type FormEvent, type ReactNode } from "react";
import { useCloseDialog } from "./dialog";

export const input = "w-full rounded-md border border-line2 bg-panel2 px-3 py-2 text-ink outline-none focus:border-gold disabled:opacity-60";
export const mono = "font-mono tabular-nums";

export type Result = { ok?: string; error?: string };

/** A form bound to a server action; closes its dialog on success. */
export function ActionForm({ action, children, submit = "Save", className = "", keepOpen }: {
  action: (prev: Result, f: FormData) => Promise<Result>; children: ReactNode; submit?: string; className?: string; keepOpen?: boolean;
}) {
  const [state, run, pending] = useActionState(action, {});
  const close = useCloseDialog();
  useEffect(() => { if (state.ok && !state.error && !keepOpen) close(); }, [state, close, keepOpen]);
  // Submit through onSubmit so a refused save keeps what the user typed (a form `action` resets the fields).
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(() => run(data));
  };
  return (
    <form onSubmit={onSubmit} className={`grid gap-3 ${className}`}>
      {children}
      {state.error && <p role="alert" className="text-sm text-bad">{state.error}</p>}
      {state.ok && keepOpen && <p className="text-sm text-ok">{state.ok}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <button disabled={pending} className="display rounded-md bg-gold px-4 py-2 text-[0.65rem] tracking-[0.16em] text-on-accent disabled:opacity-50">
          {pending ? "Saving…" : submit}
        </button>
      </div>
    </form>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="grid gap-1">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="text-xs text-grey">{hint}</span>}
    </label>
  );
}
