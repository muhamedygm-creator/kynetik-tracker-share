import type { Metadata } from "next";
import { Lockup } from "@/components/ui/logo";

export const metadata: Metadata = { title: "Sign in · Kynetik", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * Target of the sign-in and invitation emails. It shows a button instead of signing in on open, so an
 * email scanner that pre-opens the link can't use up the one-time token. The button posts to /auth/verify.
 */
export default async function ConfirmPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const hasToken = !!(sp.token_hash && sp.type) || !!sp.code;
  return (
    <main className="grid min-h-dvh place-items-center bg-carbon px-4">
      <div className="grid w-full max-w-sm gap-6 rounded-xl border border-line bg-panel p-6">
        <Lockup />
        {hasToken ? (
          <form method="post" action="/auth/verify" className="grid gap-4">
            <input type="hidden" name="token_hash" value={sp.token_hash ?? ""} />
            <input type="hidden" name="type" value={sp.type ?? ""} />
            <input type="hidden" name="code" value={sp.code ?? ""} />
            <input type="hidden" name="next" value={sp.next ?? "/board"} />
            <p className="text-sm text-grey">{sp.type === "invite" ? "The invitation is ready. Continue to set up access to the Build Tracker." : "The sign-in link is ready."}</p>
            <button className="display min-h-12 rounded-md bg-gold px-4 text-[0.75rem] tracking-[0.18em] text-on-accent">Continue to the Build Tracker</button>
          </form>
        ) : (
          <div className="grid gap-3">
            <p className="text-sm text-grey">This sign-in link is incomplete. Ask for a new one on the sign-in page.</p>
            <a href="/login" className="text-sm text-gold hover:underline">Go to sign in</a>
          </div>
        )}
      </div>
    </main>
  );
}
