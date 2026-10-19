import type { Metadata } from "next";
import { Station, type StationBoard, type StationPerson } from "@/components/station/station";
import { departmentBoard, visibleEntries } from "@/domain/gamification";
import { fmtHM } from "@/domain/format";
import { durationH, layoutQueue, type QueueTask } from "@/domain/queue";
import { requireViewer } from "@/lib/auth";
import { linkLabels } from "@/lib/data/links";
import { loadWorld } from "@/lib/data/world";
import { initials, photoUrls } from "@/lib/photos";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Floor Station · Kynetik", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";
const DAY = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" });

/**
 * Floor Station (amends AM-14): the one page the shared workshop iPad sees. Every employee in every
 * department with their tasks; tap a task to ask for a time extension or a QC check. No costs, no edits.
 */
export default async function StationPage() {
  const viewer = await requireViewer(["floor_station", "owner", "supervisor"]);
  const w = await loadWorld(viewer);
  const { data: pending } = await (await createClient()).from("requests").select("queue_task_id, kind").eq("status", "pending");
  const labels = linkLabels(w);
  const qcWaiting = new Set(w.builds.flatMap((b) => b.project.work.filter((x) => x.qcSince).map((x) => x.id)));

  const crew = w.people.filter((p) => p.active && p.costClass === "production");
  const urls = await photoUrls(await createClient(), crew.map((p) => p.photoPath));
  const today = (dt: string | null) => !!dt && dt.slice(0, 10) === w.today;

  const people: StationPerson[] = w.people.filter((p) => p.active && p.costClass === "production").map((p) => {
    const d = w.departments.find((x) => x.id === p.departmentId);
    const mine = w.queue.filter((t) => t.personId === p.id);
    const placed = layoutQueue(mine as QueueTask[], w.calFor(p.id), w.now).filter((x) => x.task.status !== "done");
    return {
      id: p.id, name: p.name, initials: initials(p.name), department: d ? d.name : "No department", departmentId: d?.id ?? "none",
      colour: d?.colour ?? "#c9c9c9", photoUrl: p.photoPath ? urls[p.photoPath] ?? null : null, away: p.away?.label ?? null,
      tasks: placed.map((x) => {
        const t = mine.find((m) => m.id === x.task.id)!;
        return {
          id: t.id, title: t.title, link: t.workItemId ? labels.get(t.workItemId) ?? null : t.projectId ? labels.get(`p:${t.projectId}`) ?? null : null,
          status: t.status, active: t.status === "doing", waitingQc: (!!t.workItemId && qcWaiting.has(t.workItemId)) || (pending ?? []).some((r) => r.queue_task_id === t.id && r.kind === "qc"), overrun: x.overrun,
          window: x.start && x.end
            ? `${x.start.slice(0, 10) === w.today ? "" : `${DAY.format(new Date(x.start.slice(0, 10)))} `}${x.start.slice(11, 16)}–${x.end.slice(0, 10) === x.start.slice(0, 10) ? "" : `${DAY.format(new Date(x.end.slice(0, 10)))} `}${x.end.slice(11, 16)}`
            : "", allocated: fmtHM(durationH(t, w.cal.dayHours)),
          pending: (pending ?? []).filter((r) => r.queue_task_id === t.id).map((r) => r.kind as "extension" | "qc"),
          // Live time (AM-14 v2): allocated and worked minutes at page load; the iPad keeps counting.
          current: x.current, start: x.start, end: x.end, plannedEnd: x.plannedEnd,
          allocMin: Math.round(x.hours * 60),
          workedMin: x.current && x.start ? Math.round(w.cal.wh(x.start, w.now) * 60) : 0,
          // Today's part of the task, for the person's day strip.
          today: x.segments.filter((sg) => today(sg.start)).map((sg) => [sg.start, sg.end] as [string, string]),
        };
      }),
    };
  }).sort((a, b) => a.department.localeCompare(b.department) || a.name.localeCompare(b.name));
  const departments = [...new Map(people.map((p) => [p.departmentId, p.department])).entries()].map(([id, name]) => ({ id, name }));
  // Leaderboard pop-up (AM-19): every production department, grouped; Modelling & 3D Printing has its own.
  const g = w.settings.gamification;
  const boards: StationBoard[] = w.departments.filter((d) => d.key !== "modelling").map((d) => {
    const members = crew.filter((p) => p.departmentId === d.id);
    const entries = visibleEntries(departmentBoard({
      people: members, projects: w.builds.map((b) => b.project), queue: w.queue, cal: w.cal, calFor: w.scoreCalFor, now: w.now,
      period: g.defaultPeriod, scoring: w.settings.scoring, game: g,
    }), g);
    return {
      id: d.id, name: d.name, emoji: d.emoji, colour: d.colour,
      entries: entries.map((e) => {
        const m = members.find((x) => x.id === e.personId);
        return { personId: e.personId, name: e.name, initials: initials(e.name), photoUrl: m?.photoPath ? urls[m.photoPath] ?? null : null,
          rank: e.rank, score: e.score, badges: e.badges.map((x) => x.emoji).join(""), line: e.line };
      }),
    };
  }).filter((b) => crew.some((p) => p.departmentId === b.id));
  const PERIOD = { today: "today", week: "this week", month: "this month", "7d": "last 7 days" } as const;
  const c = w.settings.calendar;
  return <Station people={people} departments={departments} today={w.today} now={w.now} workDay={w.cal.isWorkDay(w.today)}
    day={{ start: c.shiftStart, end: c.shiftEnd, breakStart: c.breakStart, breakMins: c.breakMins }} banner={w.settings.gamification.banner}
    conveyor={w.settings.timeline.conveyor} boards={boards} period={PERIOD[g.defaultPeriod]} theme={viewer.theme} />;
}
