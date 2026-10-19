"use client";
import { useActionState } from "react";
import { sendMagicLink, type LoginState } from "./actions";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(sendMagicLink, {});
  if (state.ok) {
    return (
      <p className="text-lg">
        If <span className="text-gold">{state.email}</span> has been invited, a sign-in link is on its way. Open it on this device.
      </p>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="next" value={next} />
      <label className="label" htmlFor="email">Email</label>
      <input
        id="email" name="email" type="email" required autoComplete="email" autoFocus
        className="rounded-md border border-line2 bg-panel2 px-3 py-2 font-mono text-ink outline-none focus:border-gold"
      />
      {state.error && <p className="text-sm text-bad">{state.error}</p>}
      <button
        disabled={pending}
        className="display mt-2 rounded-md bg-gold px-4 py-3 text-xs tracking-[0.16em] text-on-accent disabled:opacity-60"
      >
        {pending ? "Sending…" : "Email me a sign-in link"}
      </button>
    </form>
  );
}
