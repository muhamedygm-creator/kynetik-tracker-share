import Link from "next/link";
import { getSession } from "@/lib/auth";
import { COMPANY_DOMAIN, isCompanyEmail } from "@/lib/company";

export default async function NoAccess({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  const { reason } = await searchParams;
  const s = await getSession();
  const email = s.status === "no-access" ? s.email : s.status === "ok" ? s.viewer.email : "";
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div className="max-w-md rounded-[10px] border border-line bg-panel p-6">
        <h1 className="display mb-3 text-2xl">No access</h1>
        <p className="text-grey">
          {reason === "role"
            ? "Your role doesn't include this page. Ask the Owner if you need it."
            : email && !isCompanyEmail(email)
              ? <><span className="text-ink">{email}</span> is not a company account. Only @{COMPANY_DOMAIN} accounts can use the Build Tracker. Sign out, then sign in with your company Microsoft account.</>
              : <>{email ? <span className="text-ink">{email}</span> : "This account"} hasn&apos;t been invited, or its access was switched off. Ask the Owner for an invitation.</>}
        </p>
        <div className="mt-6 flex gap-4">
          {reason === "role" && <Link href="/board" className="text-gold underline">Back to the Board</Link>}
          <form action="/auth/signout" method="post"><button className="text-grey underline">Sign out</button></form>
        </div>
      </div>
    </main>
  );
}
