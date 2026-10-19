import { redirect } from "next/navigation";

/** Technicians is part of Crew now (v2): Crew → Performance. */
export default async function TechniciansPage({ searchParams }: { searchParams: Promise<{ period?: string; person?: string }> }) {
  const sp = await searchParams;
  redirect(`/setup/crew?${new URLSearchParams({ tab: "performance", ...(sp.period ? { period: sp.period } : {}), ...(sp.person ? { person: sp.person } : {}) })}`);
}
