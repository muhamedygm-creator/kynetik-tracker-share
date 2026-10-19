import { Lockup, Monogram } from "@/components/ui/logo";
import { Nav } from "@/components/nav";
import { ThemeButton } from "@/components/theme/theme-button";
import { QuickAddTask } from "@/components/plan/add-task";
import { NextStageHost } from "@/components/qc/next-stage";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { RequestAlert } from "@/components/requests/alert";
import { stopPreview } from "./preview/actions";
import { requireViewer } from "@/lib/auth";
import { loadSettings } from "@/lib/settings";
import { createClient } from "@/lib/supabase/server";

const ROLE_BADGE = {
  owner: "Owner · sees costs",
  supervisor: "Supervisor",
  viewer: "Viewer · read-only",
  modeller: "Modelling & 3D Printing",
  floor_station: "Floor Station",
} as const;

/** Console shell: left menu (laptop), icon rail (iPad portrait), top bar (phone). */
export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  // Every console role may load the shell; each page decides its own access (a Modelling & 3D Printing user
  // is sent to My models by the pages it can't open, which would loop if the shell sent it too).
  const viewer = await requireViewer(["owner", "supervisor", "viewer", "modeller"]);
  const supabase = await createClient();
  const [{ brand }, qc, requests] = await Promise.all([
    loadSettings(supabase),
    // Steps waiting for admin QC (amends AM-07), shown on the QC menu item.
    supabase.from("work_items").select("id", { count: "exact", head: true }).not("qc_since", "is", null),
    // Requests from the Floor Station waiting for a decision (amends AM-15).
    supabase.from("requests").select("id", { count: "exact", head: true }).eq("status", "pending"),
  ]);
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[76px_minmax(0,1fr)] lg:grid-cols-[236px_minmax(0,1fr)]">
      <aside className="sticky top-0 z-30 border-b border-line bg-panel3 md:h-dvh md:border-b-0 md:border-r md:flex md:flex-col">
        <div className="flex h-[60px] shrink-0 items-center justify-between gap-3 border-b border-gold/30 px-4 md:justify-center lg:justify-start">
          <span className="hidden lg:inline-flex"><Lockup height={28} src={brand.logoUrl} /></span>
          <span className="lg:hidden"><Monogram size={32} src={brand.logoUrl} /></span>
          <div className="flex items-center gap-1 md:hidden">
            <ThemeButton saved={viewer.theme} compact down />
            <form action="/auth/signout" method="post">
              <button className="font-mono text-xs uppercase tracking-widest text-grey hover:text-ink" title={viewer.email}>Sign out</button>
            </form>
          </div>
        </div>
        <div className="min-h-0 md:flex-1 md:overflow-y-auto"><Nav role={viewer.role} badges={{ "/qc": qc.count ?? 0, "/requests": requests.count ?? 0 }} /></div>
        <div className="hidden shrink-0 border-t border-line p-3 md:block">
          <div className="hidden truncate text-sm lg:block" title={viewer.email}>{viewer.email}</div>
          <div className={`hidden font-mono text-xs lg:block ${viewer.seesCost ? "text-gold" : "text-grey"}`}>{ROLE_BADGE[viewer.role]}</div>
          {/* Theme (2026-10-17): beside the user menu; icon only on the iPad rail. */}
          <div className="mt-2 hidden lg:block"><ThemeButton saved={viewer.theme} /></div>
          <div className="flex justify-center lg:hidden"><ThemeButton saved={viewer.theme} compact /></div>
          <form action="/auth/signout" method="post" className="lg:mt-2">
            <button className="flex min-h-11 w-full items-center justify-center rounded-lg font-mono text-xs uppercase tracking-widest text-grey hover:bg-panel hover:text-ink lg:justify-start lg:px-0 lg:hover:bg-transparent" title={`Sign out ${viewer.email}`}>
              Sign out
            </button>
          </form>
        </div>
      </aside>
      <div className="min-w-0">
        {viewer.role === "viewer" && (
          <div className="border-b border-line bg-panel3 px-5 py-2 text-sm text-warn">
            Read-only access. Ask the Owner for Supervisor access to make changes.
          </div>
        )}
        {viewer.preview && (
          <form action={stopPreview} className="flex flex-wrap items-center gap-3 border-b border-gold/60 bg-panel2 px-5 py-2 text-sm">
            <span>Preview: the app as <b>Modelling &amp; 3D Printing</b> ({viewer.preview.personName}). Changes are saved for real, under your Owner login.</span>
            <button className="ml-auto rounded-md border border-gold px-3 py-1 font-mono text-xs uppercase tracking-widest text-gold hover:bg-gold hover:text-on-accent">Stop preview</button>
          </form>
        )}
        {viewer.role === "modeller" && !viewer.preview && (
          <div className="border-b border-line bg-panel3 px-5 py-2 text-sm text-grey">
            Modelling &amp; 3D Printing login: your work is under <a href="/models" className="text-gold hover:underline">My models</a> and <a href="/printing" className="text-gold hover:underline">3D Printing</a>.
          </div>
        )}
        <main className={`mx-auto max-w-[1440px] px-4 py-6 md:px-6 lg:px-8 ${viewer.canWrite ? "pb-28" : ""}`}>{children}</main>
      </div>
      <RealtimeRefresh />
      {viewer.canWrite && <QuickAddTask />}
      {viewer.canWrite && <NextStageHost />}
      {viewer.canWrite && <RequestAlert pending={requests.count ?? 0} />}
    </div>
  );
}
