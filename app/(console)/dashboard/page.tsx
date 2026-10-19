import { redirect } from "next/navigation";

/** Dashboard moved into Overview (amends AM-12: Board and Dashboard on one page). */
export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ weeks?: string }> }) {
  const sp = await searchParams;
  redirect(`/board?tab=dashboard${sp.weeks ? `&weeks=${encodeURIComponent(sp.weeks)}` : ""}`);
}
