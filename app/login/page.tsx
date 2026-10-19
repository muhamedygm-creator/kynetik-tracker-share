import { Stacked } from "@/components/ui/logo";
import { microsoftEnabled, signInWithMicrosoft } from "./actions";
import { LoginForm } from "./login-form";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  const microsoft = await microsoftEnabled();
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-[10px] border border-line bg-panel p-8">
        <div className="mb-8 flex flex-col items-center gap-5">
          <Stacked size={64} />
          <span aria-hidden className="h-px w-16 bg-gold" />
          <span className="eyebrow">Build Tracker</span>
        </div>
        {error === "microsoft" && <p className="mb-4 text-sm text-bad">Microsoft sign-in didn&apos;t finish. Try again, and use your Kynetik Microsoft account.</p>}
        {error && error !== "microsoft" && <p className="mb-4 text-sm text-bad">That sign-in link has expired or was already used. Ask for a new one.</p>}
        {microsoft && (
          <form action={signInWithMicrosoft} className="mb-5 grid gap-4">
            <input type="hidden" name="next" value={next ?? "/board"} />
            <button className="flex min-h-12 items-center justify-center gap-3 rounded-md border border-line2 bg-panel2 px-4 text-sm font-semibold text-ink hover:border-gold">
              <svg aria-hidden width="18" height="18" viewBox="0 0 21 21"><rect width="10" height="10" fill="#f25022" /><rect x="11" width="10" height="10" fill="#7fba00" /><rect y="11" width="10" height="10" fill="#00a4ef" /><rect x="11" y="11" width="10" height="10" fill="#ffb900" /></svg>
              Sign in with Microsoft
            </button>
            <div className="flex items-center gap-3 text-xs text-grey"><span className="h-px flex-1 bg-line" />or get an email link<span className="h-px flex-1 bg-line" /></div>
          </form>
        )}
        <LoginForm next={next ?? "/board"} />
        <p className="mt-6 text-sm text-grey">Access is by invitation from the Owner.</p>
      </div>
    </main>
  );
}
