import Link from "next/link";
import { CrewTable, type CrewRow } from "@/components/crew/crew-table";
import { Performance } from "@/components/crew/performance";
import { PageHead } from "@/components/ui/primitives";
import { rates } from "@/domain/cost";
import { leaderboard } from "@/domain/scoring";
import { requireViewer } from "@/lib/auth";
import { linkOptions } from "@/lib/data/links";
import { loadWorld } from "@/lib/data/world";
import { initials, photoUrls } from "@/lib/photos";
import { createClient } from "@/lib/supabase/server";

/** Crew (v2): Crew and Technicians in one place. People: profiles, photos, tags, contracts. Performance: the scores. */
export default async function CrewPage({ searchParams }: { searchParams: Promise<{ tab?: string; period?: string; person?: string; board?: string }> }) {
  const sp = await searchParams;
  const tab = sp.tab === "performance" ? "performance" : "people";
  const viewer = await requireViewer();
  const w = await loadWorld(viewer);

  const tabs = (
    <nav aria-label="Crew" className="flex gap-1 border-b border-line">
      {([["people", "People"], ["performance", "Performance"]] as const).map(([k, label]) => (
        <Link key={k} href={k === "people" ? "/setup/crew" : "/setup/crew?tab=performance"} aria-current={tab === k ? "page" : undefined}
          className={`min-h-11 border-b-2 px-4 pt-2.5 text-sm ${tab === k ? "border-gold text-ink" : "border-transparent text-grey hover:text-ink"}`}>{label}</Link>
      ))}
    </nav>
  );

  if (tab === "performance") {
    return (
      <div className="grid gap-4">
        <PageHead eyebrow="Crew" title="Performance" />
        {tabs}
        <Performance viewer={viewer} w={w} sp={sp} />
      </div>
    );
  }

  const supabase = await createClient();
  const urls = await photoUrls(supabase, w.people.map((p) => p.photoPath));
  // Salaries come back for the Owner and Supervisors (RLS, AM-20); the cost settings and rates for the Owner only.
  const [{ data: costs }, { data: costSettings }] = await Promise.all([
    viewer.seesSalary ? supabase.from("people_cost").select("*") : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    viewer.seesCost ? supabase.from("settings_cost").select("*").maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const cs = { defaultLoadingPct: Number(costSettings?.default_loading_pct ?? 25), workingDaysPerMonth: Number(costSettings?.working_days_per_month ?? 26) };
  const s = w.settings.scoring;
  const board = leaderboard(w.people.map((p) => ({ ...p, active: true })), w.builds.map((b) => b.project), w.cal, w.now, s.defaultPeriodDays, s, undefined, w.scoreCalFor);

  const rows: CrewRow[] = [...w.people].filter((p) => !p.archived).sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name)).map((p) => {
    const d = w.departments.find((x) => x.id === p.departmentId);
    const c = costs?.find((x) => x.person_id === p.id);
    const cost = viewer.seesSalary
      ? (() => {
          const pc = { baseSalary: Number(c?.base_salary ?? 0), loadingPct: c?.loading_pct === null || c?.loading_pct === undefined ? null : Number(c.loading_pct), costClass: p.costClass };
          const r = viewer.seesCost ? rates(pc, cs, w.cal.dayHours) : null;
          return { baseSalary: pc.baseSalary, loadingPct: pc.loadingPct, hourRate: r?.hourRate ?? null, dayRate: r?.dayRate ?? null, loadedMonthly: r?.loadedMonthly ?? null };
        })()
      : undefined;
    const st = board.find((x) => x.personId === p.id);
    return {
      id: p.id, version: w.versions[p.id], name: p.name, initials: initials(p.name), photoUrl: p.photoPath ? urls[p.photoPath] ?? null : null,
      departmentId: p.departmentId, departmentName: d ? `${d.emoji} ${d.name}` : null, colour: d?.colour ?? w.settings.labels.otherColour,
      costClass: p.costClass, active: p.enabled, queued: w.queue.filter((q) => q.personId === p.id && q.status !== "done").length, cost,
      openSteps: w.builds.reduce((n, b) => n + b.project.work.filter((x) => x.tech === p.id && x.status !== "done").length, 0),
      employment: p.employment, contractFrom: p.contractFrom, contractTo: p.contractTo, contractEnded: p.contractEnded,
      phone: p.phone, skills: p.skills, notes: p.notes, projectIds: p.projectIds,
      stats: { done: st?.done ?? 0, onTimePct: st?.onTimePct ?? null, ftrPct: st?.ftrPct ?? null, score: st?.score ?? null, inWork: st?.inWork ?? 0 },
    };
  });
  const deleted = w.people.filter((p) => p.archived).map((p) => ({
    id: p.id, name: p.name, initials: initials(p.name), photoUrl: p.photoPath ? urls[p.photoPath] ?? null : null,
    department: w.departments.find((d) => d.id === p.departmentId)?.name ?? "No department",
  }));
  const movable = w.people.filter((p) => p.active).map((p) => ({ id: p.id, name: p.name }));
  const unassigned = rows.filter((r) => r.active && !r.contractEnded && !r.departmentId).length;
  const builds = w.builds.filter((b) => b.project.status !== "done").map((b) => ({ id: b.project.id, serial: b.project.serial, name: b.project.name }));
  return (
    <div className="grid gap-4">
      <PageHead eyebrow={`Crew · numbers over the last ${s.defaultPeriodDays} days`} title="Crew">
        {unassigned > 0 && <span className="text-sm text-warn">{unassigned} not in a department yet, so they don&apos;t appear on any department TV.</span>}
      </PageHead>
      {tabs}
      <CrewTable rows={rows} deleted={deleted} movable={movable} departments={w.departments} builds={builds} seesCost={viewer.seesCost} seesSalary={viewer.seesSalary}
        canWrite={viewer.canWrite} currency={w.currency} links={linkOptions(w)} dayHours={w.cal.dayHours} />
    </div>
  );
}
