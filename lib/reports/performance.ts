import "server-only";
/**
 * Crew performance data (amends AM-26) for the CSV and PDF exports, and for Reports → Employees (AM-27).
 * Reads through the user's own client (RLS), never a cost table.
 */
import { performanceRows, summaries, weekly, type PerfPerson, type PerfQueueTask, type PerfRequest, type PerfReview } from "@/domain/performance";
import { utcToLocal } from "@/domain/time";
import { createClient } from "@/lib/supabase/server";
import type { World } from "@/lib/data/world";

/** Queue task stamps, requests, QC reviews and user names: what the reports add to the world. */
export async function loadExtras(w: World) {
  const supabase = await createClient();
  const tz = w.settings.calendar.timezone;
  const L = (x: string | null) => (x ? utcToLocal(x, tz) : null);
  const [{ data: qmeta }, { data: reqs }, { data: revs }, { data: profiles }] = await Promise.all([
    supabase.from("queue_tasks").select("id, created_at, created_by"),
    supabase.from("requests").select("kind, queue_task_id, work_item_id, sent_at, status, decided_at, reply, extra_h"),
    supabase.from("qc_reviews").select("work_item_id, submitted_at, decided_at, result, reason"),
    supabase.from("profiles").select("user_id, name, email"),
  ]);
  const who = new Map((profiles ?? []).map((p) => [p.user_id as string, (p.name as string) || (p.email as string)]));
  const meta = new Map((qmeta ?? []).map((q) => [q.id as string, q]));
  const queue: PerfQueueTask[] = w.queue.map((t) => {
    const x = meta.get(t.id);
    return { ...t, createdAt: L((x?.created_at as string) ?? null), createdBy: x?.created_by ? who.get(x.created_by as string) ?? "" : "" };
  });
  const requests: PerfRequest[] = (reqs ?? []).map((r) => ({
    kind: r.kind, queueTaskId: r.queue_task_id, workItemId: r.work_item_id, sentAt: L(r.sent_at)!, status: r.status,
    decidedAt: L(r.decided_at), reply: r.reply ?? "", extraH: r.extra_h === null ? null : Number(r.extra_h),
  }));
  const reviews: PerfReview[] = (revs ?? []).map((r) => ({
    workItemId: r.work_item_id, submittedAt: L(r.submitted_at)!, decidedAt: L(r.decided_at), result: r.result, reason: r.reason ?? "",
  }));
  return { who, queue, requests, reviews };
}

export async function loadPerformance(w: World, personIds: string[] | "all", from: string, to: string, notStarted = false) {
  const { queue, requests, reviews } = await loadExtras(w);
  const dept = (id: string | null) => w.departments.find((d) => d.id === id)?.name ?? "No department";
  const people: PerfPerson[] = w.people
    .filter((p) => (personIds === "all" ? p.costClass === "production" && !p.archived : personIds.includes(p.id)))
    .map((p) => ({ id: p.id, name: p.name, department: dept(p.departmentId) }));
  const rows = performanceRows({
    people, projects: w.builds.map((b) => b.project), queue, requests, reviews, calFor: w.scoreCalFor,
    dayHours: w.cal.dayHours, toleranceH: w.settings.scoring.onTimeToleranceH, now: w.now, from, to, notStarted,
  });
  return {
    people, rows, from, to,
    summary: summaries(rows, people, w.absences, w.cal, from, to),
    weeks: weekly(rows, from, to),
    weeksBy: Object.fromEntries(people.map((p) => [p.id, weekly(rows.filter((r) => r.personId === p.id), from, to)])),
  };
}
export type Performance = Awaited<ReturnType<typeof loadPerformance>>;
