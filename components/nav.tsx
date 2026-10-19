"use client";
/**
 * Left menu (v1 app shell, docs/ROADMAP.md v1.1). Full width on laptops, icons only on an iPad in
 * portrait, a scrolling top bar on phones. Every item is a 44 px target.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import type { Role } from "@/lib/auth";

const I = {
  board: <><rect x="2.5" y="2.5" width="6.5" height="7" rx="1.2" /><rect x="11" y="2.5" width="6.5" height="4.5" rx="1.2" /><rect x="2.5" y="11.5" width="6.5" height="6" rx="1.2" /><rect x="11" y="9" width="6.5" height="8.5" rx="1.2" /></>,
  dash: <><path d="M3 17h14" /><rect x="4" y="10" width="2.6" height="5" rx=".6" /><rect x="8.7" y="6" width="2.6" height="9" rx=".6" /><rect x="13.4" y="3" width="2.6" height="12" rx=".6" /></>,
  builds: <><rect x="3" y="3.5" width="14" height="3.5" rx="1" /><rect x="3" y="9" width="14" height="3.5" rx="1" /><rect x="3" y="14.5" width="9" height="2" rx="1" /></>,
  plan: <><rect x="2.5" y="3.5" width="15" height="13.5" rx="1.5" /><path d="M2.5 8h15M7 2v3M13 2v3M5.5 11h4M5.5 14h7" /></>,
  crew: <><circle cx="7" cy="7" r="3" /><circle cx="14" cy="8" r="2.4" /><path d="M2 17c.6-3 2.6-4.5 5-4.5s4.4 1.5 5 4.5M12 16.5c.4-2 1.6-3 3.2-3s2.6 1 2.9 3" /></>,
  floor: <><path d="M3 17V7l7-4 7 4v10" /><path d="M7 17v-5h6v5" /></>,
  timeline: <path d="M3 5h8M6 10h11M3 15h7" />,
  tv: <><rect x="2.5" y="4" width="15" height="10" rx="1.5" /><path d="M7 17h6" /></>,
  users: <><circle cx="10" cy="7" r="3.2" /><path d="M3.5 17c.8-3.4 3.4-5 6.5-5s5.7 1.6 6.5 5" /></>,
  settings: <><circle cx="10" cy="10" r="2.6" /><path d="M10 2.5v2.2M10 15.3v2.2M2.5 10h2.2M15.3 10h2.2M4.7 4.7l1.6 1.6M13.7 13.7l1.6 1.6M4.7 15.3l1.6-1.6M13.7 6.3l1.6-1.6" /></>,
  audit: <><path d="M5 2.5h7l3 3V17.5H5z" /><path d="M8 9h5M8 12h5M8 15h3" /></>,
  models: <><path d="M10 2.5l7 4v7l-7 4-7-4v-7z" /><path d="M3 6.5l7 4 7-4M10 10.5v7" /></>,
  printing: <><path d="M5 8V3h10v5" /><rect x="2.5" y="8" width="15" height="6.5" rx="1" /><path d="M5.5 12.5h9V17h-9z" /></>,
  requests: <><path d="M3.5 4.5h13v9h-7l-4 3v-3h-2z" /><path d="M7 8h6M7 10.8h4" /></>,
  qc: <><path d="M10 2.5l6 2.5v4.5c0 4-2.6 6.6-6 8-3.4-1.4-6-4-6-8V5z" /><path d="M7.3 10l2 2 3.6-4" /></>,
  reports: <><path d="M5 2.5h7l3 3V17.5H5z" /><path d="M7.5 14.5v-3M10 14.5V9M12.5 14.5v-5" /></>,
} satisfies Record<string, ReactNode>;

type Item = { href: string; label: string; icon: keyof typeof I; roles?: Role[]; also?: string[] };
const MAIN: Item[] = [
  { href: "/board", label: "Overview", icon: "board", also: ["/dashboard"] },
  { href: "/timeline", label: "Timeline", icon: "timeline" },
  { href: "/plan", label: "Task queue", icon: "plan", also: ["/queue"] },
  { href: "/builds", label: "Projects", icon: "builds" },
  { href: "/qc", label: "QC", icon: "qc" },
  { href: "/requests", label: "Requests", icon: "requests", roles: ["owner", "supervisor", "viewer"] },
  { href: "/models", label: "My models", icon: "models", roles: ["owner", "supervisor", "modeller"] },
  { href: "/printing", label: "3D Printing", icon: "printing", roles: ["owner", "supervisor", "modeller"] },
  { href: "/setup/crew", label: "Crew", icon: "crew", also: ["/setup", "/technicians"] },
  { href: "/floor", label: "Floor log", icon: "floor" },
  { href: "/reports", label: "Reports", icon: "reports", roles: ["owner", "supervisor"] },
];
const ADMIN: Item[] = [
  { href: "/displays", label: "TV displays", icon: "tv", roles: ["owner"] },
  { href: "/users", label: "Users", icon: "users", roles: ["owner"] },
  { href: "/settings", label: "Settings", icon: "settings", roles: ["owner", "supervisor"] },
  { href: "/audit", label: "Audit log", icon: "audit" },
];

function NavLink({ item, path, badge }: { item: Item; path: string; badge?: number }) {
  const active = [item.href, ...(item.also ?? [])].some((h) => path === h || path.startsWith(h + "/"));
  return (
    <Link href={item.href} title={item.label} aria-current={active ? "page" : undefined}
      className={`flex min-h-11 shrink-0 items-center gap-3 rounded-lg px-3 text-[0.95rem] transition-colors md:max-lg:justify-center lg:justify-start ${
        active ? "bg-panel2 text-ink shadow-[inset_3px_0_0_var(--gold)]" : "text-grey hover:bg-panel hover:text-ink"
      }`}>
      <svg className="h-5 w-5 shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{I[item.icon]}</svg>
      <span className="whitespace-nowrap md:max-lg:sr-only">{item.label}</span>
      {!!badge && (
        <span className="ml-auto rounded-full bg-warn px-2 font-mono text-xs font-bold text-on-accent md:max-lg:absolute md:max-lg:ml-6 md:max-lg:-mt-6" aria-label={`${badge} waiting`}>{badge}</span>
      )}
    </Link>
  );
}

export function Nav({ role, badges = {} }: { role: Role; badges?: Record<string, number> }) {
  const path = usePathname();
  // Modelling & 3D Printing sees only the items that name it (My models, 3D Printing).
  const allowed = (i: Item) => (role === "modeller" ? !!i.roles?.includes(role) : !i.roles || i.roles.includes(role));
  return (
    <nav aria-label="Main menu" className="flex gap-1 overflow-x-auto px-2 py-2 md:flex-col md:overflow-visible md:px-3 md:py-3">
      {MAIN.filter(allowed).map((i) => <NavLink key={i.href} item={i} path={path} badge={badges[i.href]} />)}
      {ADMIN.some(allowed) && <>
        <span className="label hidden px-3 pb-1 pt-4 lg:block">Admin</span>
        <span aria-hidden className="mx-2 hidden h-px bg-line md:max-lg:block md:my-2" />
      </>}
      {ADMIN.filter(allowed).map((i) => <NavLink key={i.href} item={i} path={path} />)}
    </nav>
  );
}
