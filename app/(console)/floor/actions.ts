"use server";
import { z } from "zod";
import { allItems } from "@/domain/conflicts";
import { checkDayCap } from "@/domain/floor";
import { LEAVE_TYPES, absenceSpan, absentOn, awayLabel } from "@/domain/attendance";
import { fmtDate } from "@/domain/format";
import { byPosition } from "@/domain/queue";
import { UserError, context, run, updateRow, type ActionResult } from "@/lib/actions/common";

const Payload = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  attendance: z.array(z.object({ personId: z.string(), present: z.boolean() })),
  logs: z.array(z.object({ personId: z.string(), workItemId: z.string(), hours: z.number().positive() })),
});

/** Save a day (v1 commitDay): attendance + hour logs, replacing that day's logs; rates snapshot server-side. */
export async function saveDay(json: string): Promise<ActionResult> {
  return run(async () => {
    const c = await context();
    const parsed = Payload.safeParse(JSON.parse(json));
    if (!parsed.success) throw new UserError("Couldn't read the day. Reload and try again.");
    const { day, attendance, logs } = parsed.data;
    const { cal, settings, people } = c.world;
    if (!cal.isWorkDay(day)) throw new UserError("That's a rest day or holiday — no hours to log.");
    const step = settings.floor.logStepH;
    const present = new Map(attendance.map((a) => [a.personId, a.present]));
    const items = new Map(allItems(c.world.builds.map((b) => b.project)).map((r) => [r.item.id, r.item]));
    const total = new Map<string, number>();
    for (const l of logs) {
      const name = people.find((p) => p.id === l.personId)?.name ?? "This person";
      if (present.get(l.personId) === false) throw new UserError(`${name} is marked out on ${day} — mark them in to log hours.`);
      const away = absentOn(c.world.absences, l.personId, day);
      if (away) throw new UserError(`${name} is marked absent on ${fmtDate(day)} (${awayLabel(away)}). Cancel or shorten the absence before logging hours.`);
      const w = items.get(l.workItemId);
      if (!w) throw new UserError("A logged part no longer exists. Reload the page.");
      if (w.status !== "doing" && w.status !== "blocked") throw new UserError("Hours can only be logged on parts In Progress or Blocked.");
      if (Math.abs(l.hours / step - Math.round(l.hours / step)) > 1e-9) throw new UserError(`Log hours in steps of ${step}h.`);
      const already = total.get(l.personId) ?? 0;
      const refusal = checkDayCap(name, already, l.hours, day, cal.dayHours);
      if (refusal) throw new UserError(refusal);
      total.set(l.personId, already + l.hours);
    }
    const { error } = await c.supabase.rpc("commit_day", {
      p_day: day,
      p_attendance: attendance.map((a) => ({ person_id: a.personId, present: a.present })),
      p_logs: logs.map((l) => ({ person_id: l.personId, work_item_id: l.workItemId, hours: l.hours })),
    });
    if (error) throw new UserError(error.message);
    return { ok: `Saved ${day}.` };
  });
}

// ───────────── Attendance: absences (amends AM-29) ─────────────

const AbsenceInput = z.object({
  kind: z.enum(LEAVE_TYPES),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the first day."),
  days: z.number().int().min(1, "At least one working day.").max(365, "At most 365 working days."),
  note: z.string().max(1000, "Keep the note under 1000 characters."),
});

/**
 * Mark someone absent. Each pending task is reassigned or kept; the first kept task (in queue order) is pinned to
 * start at shift start on the day they are back, and the rest of their queue follows it.
 */
export async function markAbsent(personId: string, input: z.infer<typeof AbsenceInput>,
  decisions: { taskId: string; to: string | null }[]): Promise<ActionResult> {
  return run(async () => {
    const c = await context();
    const a = AbsenceInput.safeParse(input);
    if (!a.success) throw new UserError(a.error.issues[0].message);
    const { cal, people, queue } = c.world;
    const who = people.find((p) => p.id === personId);
    if (!who) throw new UserError("That person no longer exists. Reload the page.");
    const span = absenceSpan(cal, a.data.from, a.data.days);
    const open = queue.filter((t) => t.personId === personId && t.status !== "done").sort(byPosition);
    const to = new Map(decisions.map((d) => [d.taskId, d.to]));
    for (const d of decisions) {
      if (d.to && !people.some((p) => p.id === d.to && p.active && p.id !== personId)) throw new UserError("Pick an active crew member to take the task.");
    }
    const kept = open.filter((t) => !to.get(t.id));
    const { error } = await c.supabase.rpc("mark_absent", {
      p_person: personId, p_kind: a.data.kind, p_starts: span.startsOn, p_days: a.data.days, p_ends: span.endsOn, p_back: span.backOn,
      p_note: a.data.note.trim(),
      p_reassign: open.filter((t) => to.get(t.id)).map((t) => ({ task: t.id, to: to.get(t.id) })),
      p_push_task: kept[0]?.id ?? null, p_push_at: kept[0] ? c.U(cal.atShiftStart(span.backOn)) : null,
    });
    if (error) throw new Error(error.message);
    return { ok: `${who.name}: ${awayLabel({ kind: a.data.kind, backOn: span.backOn })}.` };
  });
}

/** Change an absence's type, days or note (e.g. someone comes back early). */
export async function updateAbsence(id: string, version: number, input: z.infer<typeof AbsenceInput>): Promise<ActionResult> {
  return run(async () => {
    const c = await context();
    const a = AbsenceInput.safeParse(input);
    if (!a.success) throw new UserError(a.error.issues[0].message);
    const span = absenceSpan(c.world.cal, a.data.from, a.data.days);
    await updateRow(c.supabase, "absences", id, version, {
      kind: a.data.kind, starts_on: span.startsOn, days: a.data.days, ends_on: span.endsOn, back_on: span.backOn, note: a.data.note.trim(),
    });
    return { ok: `Absence updated: back ${fmtDate(span.backOn)}.` };
  });
}

export async function cancelAbsence(id: string, version: number): Promise<ActionResult> {
  return run(async () => {
    const c = await context();
    await updateRow(c.supabase, "absences", id, version, { cancelled_at: new Date().toISOString() });
    return { ok: "Absence cancelled." };
  });
}
