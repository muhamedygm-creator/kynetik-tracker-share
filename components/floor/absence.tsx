"use client";
/**
 * Mark absent (amends AM-29): leave type, first day and number of working days (the return date follows the shop
 * calendar), an optional note, and for each pending task: reassign it, or keep it for when they are back.
 * The same pop-up edits or cancels an existing absence.
 */
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { cancelAbsence, markAbsent, updateAbsence } from "@/app/(console)/floor/actions";
import { LEAVE_LABEL, LEAVE_TYPES, absenceSpan, excused, type LeaveType } from "@/domain/attendance";
import { makeCalendar } from "@/domain/calendar";
import { fmtDate } from "@/domain/format";
import type { CalendarSettings } from "@/domain/settings";
import { btn } from "@/components/ui/dialog";
import { input } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";

export interface PendingTask { id: string; title: string; duration: string; status: string }
export interface AwayInfo { id: string; version: number; kind: LeaveType; startsOn: string; days: number; note: string; label: string }

export function AbsenceDialog({ open, onClose, person, day, away, pending, crew, calendar, holidays }: {
  open: boolean; onClose: () => void;
  person: { id: string; name: string };
  day: string;
  /** Set when editing an existing absence. */
  away: AwayInfo | null;
  pending: PendingTask[];
  /** Who can take a reassigned task. */
  crew: { id: string; name: string }[];
  calendar: CalendarSettings; holidays: string[];
}) {
  const router = useRouter();
  const cal = useMemo(() => makeCalendar({ calendar, holidays }), [calendar, holidays]);
  const [kind, setKind] = useState<LeaveType>(away?.kind ?? "sick");
  const [from, setFrom] = useState(away?.startsOn ?? day);
  const [days, setDays] = useState(String(away?.days ?? 1));
  const [note, setNote] = useState(away?.note ?? "");
  const [to, setTo] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const n = Number(days);
  const span = Number.isInteger(n) && n >= 1 && n <= 365 && /^\d{4}-\d{2}-\d{2}$/.test(from) ? absenceSpan(cal, from, n) : null;
  const others = crew.filter((x) => x.id !== person.id);

  const done = (r: { ok?: string; error?: string }) => {
    if (r.error) { setMsg(r.error); return; }
    router.refresh();
    onClose();
  };
  const save = () => start(async () => {
    const data = { kind, from, days: n, note };
    done(away
      ? await updateAbsence(away.id, away.version, data)
      : await markAbsent(person.id, data, pendingList.map((t) => ({ taskId: t.id, to: to[t.id] || null }))));
  });
  const pendingList = away ? [] : pending;

  return (
    <Modal open={open} onClose={onClose} title={away ? `Absence · ${person.name}` : `Mark absent · ${person.name}`} wide>
      <div className="grid gap-4">
        <fieldset className="grid gap-2">
          <legend className="label mb-1">Type of leave</legend>
          <div className="flex flex-wrap gap-2">
            {LEAVE_TYPES.map((k) => (
              <button key={k} type="button" onClick={() => setKind(k)} aria-pressed={kind === k}
                className={`min-h-11 rounded-full border px-4 text-sm ${kind === k ? "border-gold bg-gold/10 text-ink" : "border-line2 text-grey hover:text-ink"}`}>
                {LEAVE_LABEL[k]}
              </button>
            ))}
          </div>
          <span className="text-xs text-grey">{excused(kind)
            ? "Doesn't count against their score or task delay."
            : "Counts against them: any delay it causes on their tasks is logged."}</span>
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-[auto_auto_minmax(0,1fr)] sm:items-end">
          <label className="grid gap-1">
            <span className="label">From</span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={`${input} font-mono`} />
          </label>
          <label className="grid gap-1">
            <span className="label">Working days</span>
            <input value={days} onChange={(e) => setDays(e.target.value)} inputMode="numeric" className={`${input} w-28 font-mono`} />
          </label>
          <p className="text-sm text-grey" aria-live="polite">
            {span ? <>Off {fmtDate(span.startsOn)}{span.endsOn !== span.startsOn ? ` to ${fmtDate(span.endsOn)}` : ""} · back <b className="text-ink">{fmtDate(span.backOn)}</b>. Rest days and holidays are skipped.</>
              : "Enter a whole number of working days, 1 or more."}
          </p>
        </div>

        <label className="grid gap-1">
          <span className="label">Note (optional)</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} className={input} placeholder="e.g. medical certificate received" />
        </label>

        {!away && (
          <section className="grid gap-2 rounded-lg border border-line p-3">
            <h3 className="eyebrow">Pending tasks ({pendingList.length})</h3>
            {!pendingList.length && <p className="text-sm text-grey">{person.name} has no pending tasks.</p>}
            {pendingList.map((t) => (
              <div key={t.id} className="grid gap-2 border-b border-line pb-2 last:border-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_16rem] sm:items-center">
                <div className="min-w-0">
                  <div className="truncate">{t.title}</div>
                  <div className="font-mono text-xs text-grey">{t.duration}{t.status === "doing" ? " · in progress" : t.status === "blocked" ? " · blocked" : ""}</div>
                </div>
                <select value={to[t.id] ?? ""} onChange={(e) => setTo({ ...to, [t.id]: e.target.value })} className={input} aria-label={`What happens to ${t.title}`}>
                  <option value="">Keep, after they return</option>
                  {others.map((x) => <option key={x.id} value={x.id}>Reassign to {x.name}</option>)}
                </select>
              </div>
            ))}
            {pendingList.some((t) => !to[t.id]) && span && (
              <p className="text-xs text-grey">Kept tasks stay in order; the first starts at shift start on {fmtDate(span.backOn)}.</p>
            )}
          </section>
        )}

        {msg && <p role="alert" className="text-sm text-bad">{msg}</p>}
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-3">
          {away && (
            <button className={`${btn.danger} mr-auto`} disabled={busy} onClick={() => start(async () => done(await cancelAbsence(away.id, away.version)))}>
              Cancel absence
            </button>
          )}
          <button className={btn.ghost} disabled={busy} onClick={onClose}>Close</button>
          <button className={btn.primary} disabled={busy || !span} onClick={save}>{busy ? "Saving…" : away ? "Save changes" : "Mark absent"}</button>
        </div>
      </div>
    </Modal>
  );
}
