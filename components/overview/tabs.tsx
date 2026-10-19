import Link from "next/link";

/** Overview (amends AM-12): the morning Board, the Dashboard and the planning Data on one page. */
export function OverviewTabs({ tab }: { tab: "today" | "dashboard" | "data" }) {
  const items = [["today", "Today", "/board"], ["dashboard", "Dashboard", "/board?tab=dashboard"], ["data", "Data", "/board?tab=data"]] as const;
  return (
    <nav aria-label="Overview" className="flex gap-1 border-b border-line">
      {items.map(([k, label, href]) => (
        <Link key={k} href={href} aria-current={tab === k ? "page" : undefined}
          className={`min-h-11 border-b-2 px-4 pt-2.5 text-sm ${tab === k ? "border-gold text-ink" : "border-transparent text-grey hover:text-ink"}`}>{label}</Link>
      ))}
    </nav>
  );
}
