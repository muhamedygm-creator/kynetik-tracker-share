import Link from "next/link";
import { stationColour } from "@/components/build/strip";
import { Gantt, type GBuild, type GPersonRow, type GStationRow } from "@/components/timeline/gantt";
import { PageHead } from "@/components/ui/primitives";
import { mondayOf } from "@/domain/plan";
import { addDays } from "@/domain/time";
import { byPosition, layoutQueue, type QueueTask } from "@/domain/queue";
import { boardSort, projectPct, stageAgg } from "@/domain/schedule";
import { masterCounts, masterFilter, masterSort, timelineRange, type MasterFilter, type Zoom } from "@/domain/timeline";
import { requireViewer } from "@/lib/auth";
import { linkLabels } from "@/lib/data/links";
import { loadWorld } from "@/lib/data/world";
import { createClient } from "@/lib/supabase/server";

const ZOOMS: { key: Zoom; label: string }[] = [{ key: "hours", label: "Hours" }, { key: "day", label: "Day" }, { key: "week", label: "Week" }, { key: "month", label: "Month" }];
const VIEWS = [
  { key: "stages", label: "By build" },
  { key: "tasks", label: "With tasks" },
  { key: "people", label: "By person" },
  { key: "stations", label: "By workstation" },
] as const;
type View = (typeof VIEWS)[number]["key"];
const FILTERS: MasterFilter[] = ["all", "active", "hold", "blocked", "late", "planned"];

/** Timeline (v2 master view): what is running, paused and blocked on top; every open build (or person) on one clock; live. */
export default async function TimelinePage({ searchParams }: { searchParams: Promise<{ zoom?: string; rows?: string; show?: string }> }) {
  const sp = await searchParams;
  const viewer = await requireViewer();
  const w = await loadWorld(viewer);
  const t = w.settings.timeline;
  // Overview first: builds with their stages; the person view opens on the hour scale.
  const rows = (VIEWS.some((r) => r.key === sp.rows) ? sp.rows : "stages") as View;
  const zoom = (ZOOMS.some((z) => z.key === sp.zoom) ? sp.zoom : rows === "people" ? "hours" : t.defaultZoom) as Zoom;
  const show = (FILTERS.includes(sp.show as MasterFilter) ? sp.show : "all") as MasterFilter;

  const crew = w.people.filter((p) => p.active && p.costClass === "production");
  const counts = masterCounts({
    builds: w.builds.map((b) => ({ project: b.project, health: b.health })),
    queue: w.queue, crewIds: crew.map((p) => p.id), monday: mondayOf(w.today),
  });

  const sorted = boardSort(w.builds.filter((b) => b.project.status !== "done").map((b) => ({ ...b, serial: b.project.serial })), w.settings.health.boardOrder)
    .map((b) => ({ ...b, blocked: b.project.work.filter((x) => x.status === "blocked").length, status: b.project.status }));
  const open = masterSort(sorted).filter((b) => masterFilter(show, b));

  const builds: GBuild[] = open.map((b) => {
    const p = b.project;
    return {
      id: p.id, serial: p.serial, name: p.name, start: w.cal.atShiftStart(p.startDate), end: b.planEnd, fcEnd: b.forecast.finish,
      committed: p.deliveryDate ? w.cal.atShiftEnd(p.deliveryDate) : null, health: b.health,
      status: p.status, blocked: b.blocked, pct: projectPct(p),
      stages: p.stages.map((s) => {
        const a = stageAgg(p, s);
        return {
          id: s.id, name: s.name, colour: stationColour(w, s.stationType), start: a.start, end: a.end, pct: a.pct,
          station: w.stations.find((x) => x.id === s.stationId)?.name ?? null,
          tasks: a.tasks.filter((x) => x.start && x.end).map((x) => ({
            id: x.id, version: w.versions[x.id], projectId: p.id, name: x.name, start: x.start!, end: x.end!, status: x.status, pct: x.pct,
            baseStart: p.baseline[x.id]?.start ?? null, baseEnd: p.baseline[x.id]?.end ?? null, fcEnd: b.forecast.tasks[x.id]?.end ?? null, pinned: !!x.pinnedStart,
          })),
        };
      }),
    };
  });
  const stations: GStationRow[] = w.stations.map((st) => ({
    id: st.id, name: st.name, colour: stationColour(w, st.type),
    bars: open.flatMap((b) => b.project.stages.filter((s) => s.stationId === st.id).map((s) => {
      const a = stageAgg(b.project, s);
      return a.start && a.end && !a.done ? { key: s.id, label: `${b.project.serial} · ${s.name}`, start: a.start, end: a.end, pct: a.pct, colour: stationColour(w, s.stationType) } : null;
    }).filter(Boolean) as GStationRow["bars"]),
  }));

  // By person: each production person's queue on the clock; in-progress work items count as "working now".
  const labels = linkLabels(w);
  const qcWaiting = new Set(w.builds.flatMap((b) => b.project.work.filter((x) => x.qcSince).map((x) => x.id)));
  const qcAsked = new Set(rows === "people"
    ? ((await (await createClient()).from("requests").select("queue_task_id").eq("kind", "qc").eq("status", "pending")).data ?? []).map((r) => r.queue_task_id as string)
    : []);
  const people: GPersonRow[] = crew.map((p) => {
    const mine = w.queue.filter((q) => q.personId === p.id).sort(byPosition);
    const placed = layoutQueue(mine as QueueTask[], w.calFor(p.id), w.now);
    const serialOf = (pid: string | null) => (pid ? w.builds.find((b) => b.project.id === pid)?.project.serial : undefined);
    const busy = mine.some((q) => q.status === "doing") || w.builds.some((b) => b.project.status !== "done" && b.project.work.some((x) => x.tech === p.id && x.status === "doing"));
    return {
      id: p.id, name: p.name, dept: w.departments.find((d) => d.id === p.departmentId)?.name ?? null, busy,
      bars: placed.filter((x) => !x.blocked || x.start).flatMap((x) => {
        const q = mine.find((m) => m.id === x.task.id)!;
        const tag = serialOf(q.projectId) ?? (q.workItemId ? labels.get(q.workItemId) : undefined);
        const label = `${q.title}${tag ? ` · ${tag}` : ""}`;
        const qc = q.status !== "done" && ((!!q.workItemId && qcWaiting.has(q.workItemId)) || qcAsked.has(q.id));
        if (x.blocked && x.start) return [{ key: q.id, label, start: x.start, end: w.cal.addWH(x.start, 0.5), status: "blocked" as const, current: false, qc, plannedEnd: null }];
        return x.segments.map((sg, i) => ({ key: `${q.id}:${i}`, label, start: sg.start, end: sg.end, status: q.status, current: x.current, qc, plannedEnd: x.plannedEnd }));
      }),
    };
  });

  // People are read by the hour: a wider scale, yesterday to a week ahead.
  const range = rows === "people"
    ? { from: addDays(w.today, -1), to: addDays(w.today, 6) }
    : timelineRange(builds.flatMap((b) => [b.start, b.end, b.fcEnd, b.committed]), w.now);
  const px = rows === "people" ? { ...t.pxPerDay, hours: 960, day: 240, week: 96 } : t.pxPerDay;
  const href = (q: Record<string, string>) => `/timeline?${new URLSearchParams({ zoom, rows, show, ...q })}`;
  const pick = "grid min-h-9 place-items-center rounded-md border px-3 font-mono text-xs";

  const chips: { key: MasterFilter; label: string; n: number | string; tone: string }[] = [
    { key: "all", label: "Open builds", n: sorted.length, tone: "var(--ink)" },
    { key: "active", label: "Active", n: counts.active, tone: "var(--gold)" },
    { key: "hold", label: "Paused", n: counts.hold, tone: "var(--grey)" },
    { key: "blocked", label: "Blocked", n: counts.blockedSteps ? `${counts.blockedSteps} in ${counts.blockedBuilds}` : 0, tone: "var(--bad)" },
    { key: "late", label: "Late", n: counts.late, tone: "var(--bad)" },
    { key: "planned", label: "Planned", n: counts.planned, tone: "var(--cool)" },
  ];

  return (
    <div className="grid min-w-0 gap-4">
      <PageHead eyebrow="Master view" title="Timeline">
        <span className="flex items-center gap-2 font-mono text-xs text-ok"><span className="h-2 w-2 rounded-full bg-ok shadow-[0_0_6px_var(--ok)]" />Live · {w.now.slice(11, 16)}</span>
      </PageHead>

      <div className="flex flex-wrap gap-2" aria-label="Show builds">
        {chips.map((c) => {
          const on = show === c.key;
          return (
            <Link key={c.key} href={href({ show: c.key })} aria-current={on ? "true" : undefined}
              className={`flex min-h-11 items-center gap-2.5 rounded-xl border px-3.5 text-sm ${on ? "border-gold bg-panel2" : "border-line bg-panel hover:border-line2"}`}>
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: c.tone }} />
              <span className="text-grey">{c.label}</span>
              <b className="font-mono text-base font-medium">{c.n}</b>
            </Link>
          );
        })}
        <span className="flex min-h-11 items-center gap-2.5 rounded-xl border border-line bg-panel px-3.5 text-sm">
          <span className="text-grey">Done this week</span><b className="font-mono text-base font-medium">{counts.doneThisWeek}</b>
          {counts.deliveredThisWeek > 0 && <span className="text-xs text-ok">+{counts.deliveredThisWeek} delivered</span>}
        </span>
        <Link href={`/timeline?${new URLSearchParams({ rows: "people", show })}`} className="flex min-h-11 items-center gap-2.5 rounded-xl border border-line bg-panel px-3.5 text-sm hover:border-line2">
          <span className="text-grey">At work now</span><b className="font-mono text-base font-medium">{counts.atWork} / {counts.crew}</b>
        </Link>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1" aria-label="View">
          {VIEWS.map((r) => <Link key={r.key} href={`/timeline?${new URLSearchParams({ rows: r.key, show, ...(sp.zoom ? { zoom } : {}) })}`} className={`${pick} ${r.key === rows ? "border-gold text-gold" : "border-line2 text-grey hover:text-ink"}`}>{r.label}</Link>)}
        </div>
        <div className="flex flex-wrap gap-1" aria-label="Zoom">
          {ZOOMS.map((z) => <Link key={z.key} href={href({ zoom: z.key })} className={`${pick} ${z.key === zoom ? "border-gold text-gold" : "border-line2 text-grey hover:text-ink"}`}>{z.label}</Link>)}
        </div>
      </div>

      {rows !== "people" && builds.length === 0 ? (
        <p className="rounded-xl border border-line bg-panel p-6 text-center text-sm text-grey">No open builds match this filter. <Link href={href({ show: "all" })} className="text-gold hover:underline">Show all</Link></p>
      ) : (
        <Gantt zoom={zoom} rows={rows} from={range.from} to={range.to} px={px} calendar={w.settings.calendar} holidays={w.settings.holidays}
          now={w.now} conveyor={t.conveyor} builds={builds} stations={stations} people={people} canWrite={viewer.canWrite}
          statusColour={Object.fromEntries(Object.entries(w.settings.labels.itemStatus).map(([k, v]) => [k, v.colour])) as Record<"todo" | "doing" | "blocked" | "done", string>} />
      )}
    </div>
  );
}
