import Link from "next/link";
import { WeekPlanner, type PlanPerson, type PlanTask, type WorkGroup } from "@/components/plan/week-planner";
import { QueueBoard, type QueueCard, type QueueColumn } from "@/components/queue/board";
import { LiveDay, type LivePerson } from "@/components/plan/live-day";
import { PageHead } from "@/components/ui/primitives";
import { fmtDT, fmtDate } from "@/domain/format";
import { mondayOf, plannedH, weekDays } from "@/domain/plan";
import { dayRow, durationLabel, layoutQueue, queueOnTime, type QueueTask } from "@/domain/queue";
import { partLabel } from "@/domain/parts";
import { startBlocker, stepName } from "@/domain/qc";
import { standardH } from "@/domain/work";
import { addDays } from "@/domain/time";
import { requireViewer } from "@/lib/auth";
import { linkLabels, linkOptions } from "@/lib/data/links";
import { loadWorld } from "@/lib/data/world";
import { initials, photoUrls } from "@/lib/photos";
import { createClient } from "@/lib/supabase/server";

/** Fixed, readable tones for builds on the plan (status colours stay separate). */
const BUILD_TONES = ["#e9be5f", "#b9c77a", "#8fb3d1", "#d6a06f", "#b8a3d6", "#7fbfb0", "#d9b38c", "#9cc4a0"];
const WORKSHOP = "#aab4bd";

/**
 * Task queue (v2; was "Week plan"). Timeline view: each person's week as a row; drag work in, move it,
 * stretch it. List view: each person's queue as a column, top = do first (the original queue board).
 */
export default async function PlanPage({ searchParams }: { searchParams: Promise<{ dept?: string; week?: string; view?: string }> }) {
  const sp = await searchParams;
  const view = sp.view === "list" ? "list" : sp.view === "live" ? "live" : "timeline";
  const viewer = await requireViewer();
  const w = await loadWorld(viewer);
  const cal = w.cal;

  const crewAll = w.people.filter((p) => p.active && p.costClass === "production");
  const deptsWithPeople = w.departments.filter((d) => crewAll.some((p) => p.departmentId === d.id));
  const dept = sp.dept === "all" ? null : w.departments.find((d) => d.key === sp.dept) ?? deptsWithPeople[0] ?? null;
  // Everyone: grouped by department (in department order), people without one last.
  const deptRank = (id: string | null) => { const i = w.departments.findIndex((d) => d.id === id); return i < 0 ? w.departments.length : i; };
  const crew = (dept ? crewAll.filter((p) => p.departmentId === dept.id) : crewAll)
    .sort((a, b) => deptRank(a.departmentId) - deptRank(b.departmentId) || a.name.localeCompare(b.name));
  const deptLabel = (id: string | null) => { const d = w.departments.find((x) => x.id === id); return d ? `${d.emoji} ${d.name}`.trim() : "No department"; };

  const monday = /^\d{4}-\d{2}-\d{2}$/.test(sp.week ?? "") ? mondayOf(sp.week!) : mondayOf(w.today);
  const days = weekDays(cal, monday);
  const from = `${monday}T00:00`, to = `${addDays(monday, 7)}T00:00`;

  const openBuilds = w.builds.filter((b) => b.project.status !== "done");
  const toneOf = new Map(w.builds.map((b, i) => [b.project.id, BUILD_TONES[i % BUILD_TONES.length]]));
  const labels = linkLabels(w);
  const linkOf = (t: (typeof w.queue)[number]) => t.workItemId ?? (t.stageId ? `s:${t.stageId}` : t.projectId ? `p:${t.projectId}` : "");

  const people: PlanPerson[] = crew.map((p) => {
    const mine = w.queue.filter((t) => t.personId === p.id);
    const placed = layoutQueue(mine as QueueTask[], w.calFor(p.id), w.now);
    const tasks: PlanTask[] = placed.map((x) => {
      const t = mine.find((q) => q.id === x.task.id)!;
      return {
        id: t.id, version: w.versions[t.id], title: t.title, status: t.status, priority: t.priority, notes: t.notes,
        hours: x.hours, duration: durationLabel(t, cal.dayHours), durValue: t.durValue, durUnit: t.durUnit, position: t.position, fixedStart: t.fixedStart,
        start: x.start, end: x.end, plannedEnd: x.plannedEnd, current: x.current, overrun: x.overrun, lateStart: x.lateStart, blocked: x.blocked,
        segments: x.segments.map((s) => ({ date: s.date, start: s.start, end: s.end, day: s.day, days: s.days })),
        link: labels.get(linkOf(t)) ?? null, projectId: t.projectId, linked: !!t.workItemId,
        tone: t.projectId ? toneOf.get(t.projectId) ?? WORKSHOP : WORKSHOP,
      };
    });
    const later = placed.filter((x) => !x.blocked && x.task.status !== "done" && x.end && x.end > to).reduce((s, x) => s + cal.wh(x.start! > to ? x.start! : to, x.end!), 0);
    return {
      id: p.id, name: p.name, initials: initials(p.name), colour: w.departments.find((d) => d.id === p.departmentId)?.colour ?? "#c9c9c9", dept: deptLabel(p.departmentId),
      tasks, plannedH: plannedH(cal, placed, from, to), laterH: later,
    };
  });

  // Work to do: each part's current stage (first not finished), not already on a plan, for this department's stage type.
  const onPlan = new Set(w.queue.map((q) => q.workItemId).filter(Boolean));
  const rank = { late: 0, risk: 1, ok: 2, unset: 3, hold: 4, done: 5 } as const;
  const groups: WorkGroup[] = [...openBuilds].sort((a, b) => rank[a.health] - rank[b.health] || (a.forecast.finish ?? "").localeCompare(b.forecast.finish ?? "")).map((b) => {
    const p = b.project;
    const items = p.parts.flatMap((part) => {
      // Mold production can hold several steps per part (AM-06); a gated step waits for its earlier stages (AM-07).
      const own = p.stages.flatMap((s) => p.work.filter((x) => x.stageId === s.id && x.partId === part.id));
      const first = own.find((x) => x.status !== "done");
      if (!first) return [];
      const st = p.stages.find((s) => s.id === first.stageId)!;
      if (dept && st.stationType !== dept.key) return [];
      return own.filter((x) => x.stageId === first.stageId && x.status !== "done" && !onPlan.has(x.id) && !startBlocker(p, x))
        .map((cur) => ({ workItemId: cur.id, part: stepName(p.gated ? partLabel(part) : part.name, cur), stage: st.name, hours: Math.max(0.5, standardH(cur, st)), status: cur.status,
          tech: cur.tech ? w.people.find((x) => x.id === cur.tech)?.name ?? null : null }));
    });
    return { projectId: p.id, serial: p.serial, name: p.name, tone: toneOf.get(p.id)!, late: b.health === "late",
      note: b.health === "late" && b.forecast.finish && p.deliveryDate ? `late · promised ${fmtDate(p.deliveryDate)}` : b.forecast.finish ? `forecast ${fmtDate(b.forecast.finish)}` : "", items };
  }).filter((g) => g.items.length);

  const q = (o: Record<string, string>) => `/plan?${new URLSearchParams({ ...(dept ? { dept: dept.key } : { dept: "all" }), week: monday, view, ...o })}`;

  // List view: the queue board, one column per person in this department.
  const urls = view === "list" ? await photoUrls(await createClient(), crew.map((p) => p.photoPath)) : {};
  const columns: QueueColumn[] = view === "list" ? crew.map((p) => {
    const d = w.departments.find((x) => x.id === p.departmentId);
    const mine = w.queue.filter((t) => t.personId === p.id);
    const placed = layoutQueue(mine as QueueTask[], w.calFor(p.id), w.now);
    const cards: QueueCard[] = placed.map((x) => {
      const t = mine.find((m) => m.id === x.task.id)!;
      return {
        id: t.id, version: w.versions[t.id], title: t.title, durValue: t.durValue, durUnit: t.durUnit, duration: durationLabel(t, w.cal.dayHours),
        status: t.status, notes: t.notes, colour: t.colour, fixedStart: t.fixedStart, link: linkOf(t), linkLabel: labels.get(linkOf(t)) ?? null,
        when: x.blocked ? "blocked — takes no time" : x.start && x.end ? `${fmtDT(x.start)} → ${fmtDT(x.end)}` : "",
        overrun: x.overrun, lateStart: x.lateStart,
      };
    });
    return { personId: p.id, name: p.name, initials: initials(p.name), photoUrl: p.photoPath ? urls[p.photoPath] ?? null : null,
      departmentId: d?.id ?? null, colour: d?.colour ?? w.settings.labels.otherColour, cards };
  }) : [];
  // Live view: today on the wall clock, per person; the browser colours tasks on time / late as the clock runs.
  const tol = w.settings.scoring.onTimeToleranceH;
  const qcWaiting = new Set(w.builds.flatMap((b) => b.project.work.filter((x) => x.qcSince).map((x) => x.id)));
  const qcAsked = new Set(view === "live"
    ? ((await (await createClient()).from("requests").select("queue_task_id").eq("kind", "qc").eq("status", "pending")).data ?? []).map((r) => r.queue_task_id as string)
    : []);
  const liveRows: LivePerson[] = view === "live" ? crew.map((p) => {
    const mine = w.queue.filter((t) => t.personId === p.id);
    const placed = layoutQueue(mine as QueueTask[], w.calFor(p.id), w.now);
    const row = dayRow(placed, w.today);
    return {
      id: p.id, name: p.name, initials: initials(p.name), colour: w.departments.find((d) => d.id === p.departmentId)?.colour ?? "#c9c9c9", dept: deptLabel(p.departmentId),
      blocked: row.blocked.map((x) => x.task.title),
      tasks: row.items.map(({ placed: x, seg }) => {
        const t = mine.find((m) => m.id === x.task.id)!;
        return {
          id: t.id, title: t.title, tag: labels.get(linkOf(t))?.split(" · ")[0] ?? null, status: t.status, priority: t.priority,
          start: seg.start, end: seg.end, lastToday: seg.day === seg.days || !seg.continues, plannedEnd: x.plannedEnd, fixedStart: t.fixedStart,
          onTime: t.status === "done" ? queueOnTime(t as QueueTask, w.scoreCalFor(p.id), tol) : null, hours: x.hours,
          qc: t.status !== "done" && ((!!t.workItemId && qcWaiting.has(t.workItemId)) || qcAsked.has(t.id)),
        };
      }),
    };
  }) : [];

  const seg = (on: boolean) => `grid min-h-10 place-items-center px-4 text-sm ${on ? "bg-panel2 font-semibold text-ink shadow-[inset_0_-2px_0_var(--gold)]" : "text-grey hover:text-ink"}`;
  const tabs = [...deptsWithPeople.map((d) => ({ key: d.key, label: `${d.emoji} ${d.name}`.trim() })), { key: "all", label: "Everyone" }];

  return (
    <div className="grid gap-4">
      <PageHead eyebrow={view === "list" ? "Per person · top = do first" : view === "live" ? "Today, live" : `Week of ${fmtDate(monday)} · working hours only`} title="Task queue">
        <div className="flex overflow-hidden rounded-md border border-line2" role="group" aria-label="View">
          <Link href={q({ view: "timeline" })} aria-current={view === "timeline" ? "true" : undefined} className={seg(view === "timeline")}>Timeline</Link>
          <Link href={q({ view: "list" })} aria-current={view === "list" ? "true" : undefined} className={seg(view === "list")}>List</Link>
          <Link href={q({ view: "live" })} aria-current={view === "live" ? "true" : undefined} className={seg(view === "live")}>
            <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-ok shadow-[0_0_6px_var(--ok)]" />Live</span>
          </Link>
        </div>
        {view === "timeline" && <>
        <Link href={q({ week: addDays(monday, -7) })} className="grid min-h-10 place-items-center rounded-md border border-line2 px-3 text-sm hover:border-gold">← Previous</Link>
        <Link href={q({ week: mondayOf(w.today) })} className="grid min-h-10 place-items-center rounded-md border border-line2 px-3 text-sm hover:border-gold">This week</Link>
        <Link href={q({ week: addDays(monday, 7) })} className="grid min-h-10 place-items-center rounded-md border border-line2 px-3 text-sm hover:border-gold">Next →</Link>
        </>}
      </PageHead>
      <nav aria-label="Department" className="flex gap-1 overflow-x-auto border-b border-line">
        {tabs.map((t) => {
          const on = t.key === (dept?.key ?? "all");
          return <Link key={t.key} href={q({ dept: t.key })} className={`min-h-11 whitespace-nowrap border-b-2 px-4 pt-2.5 text-sm ${on ? "border-gold text-ink" : "border-transparent text-grey hover:text-ink"}`}>{t.label}</Link>;
        })}
      </nav>
      {view === "live" ? (
        <LiveDay key={dept?.key ?? "all"} now={w.now} today={w.today} workDay={cal.isWorkDay(w.today)} calendar={w.settings.calendar}
          conveyor={w.settings.timeline.conveyor} rows={liveRows} grouped={!dept} />
      ) : view === "list" ? (
        <QueueBoard canWrite={viewer.canWrite} dayHours={w.cal.dayHours} columns={columns} links={linkOptions(w)} statusLabels={w.settings.labels.itemStatus}
          departments={[...(dept ? [dept] : w.departments).map((d) => ({ id: d.id as string | null, name: d.name, emoji: d.emoji, colour: d.colour })),
            ...(dept ? [] : [{ id: null, name: "Unassigned", emoji: "", colour: w.settings.labels.otherColour }])]} />
      ) : (
      <WeekPlanner key={`${dept?.key ?? "all"}:${monday}`} canWrite={viewer.canWrite} calendar={w.settings.calendar} holidays={w.settings.holidays}
        now={w.now} today={w.today} days={days} people={people} groups={groups} grouped={!dept} />
      )}
    </div>
  );
}
