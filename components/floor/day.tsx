"use client";
/** Floor log → Day (spec §12): attendance, hour logs against parts in work, fill from assignments, save. */
import { useMemo, useState, useTransition } from "react";
import { saveDay } from "@/app/(console)/floor/actions";
import { btn } from "@/components/ui/dialog";
import { input } from "@/components/ui/form";
import { Tile } from "@/components/ui/primitives";
import type { CalendarSettings } from "@/domain/settings";
import { AbsenceDialog, type AwayInfo, type PendingTask } from "./absence";

export interface DayPerson { id: string; name: string; initials: string; colour: string; present: boolean; away: AwayInfo | null; pending: PendingTask[] }
export interface DayPart { id: string; label: string; group: string; tech: string | null; status: "doing" | "blocked" }
export interface DayLog { key: string; personId: string; workItemId: string; hours: number }

interface Props {
  day: string;
  canWrite: boolean;
  dayHours: number;
  step: number;
  people: DayPerson[];
  parts: DayPart[];
  logs: DayLog[];
  inWorkCount: number;
  /** Owner only: labour today in the shop currency. */
  labour: { value: number; currency: string } | null;
  /** AM-29: for the absence pop-up (return date on the shop calendar, who can take tasks). */
  calendar: CalendarSettings;
  holidays: string[];
  crew: { id: string; name: string }[];
}

let seq = 0;
const key = () => `n${++seq}`;
const fmt = (h: number) => `${Math.round(h * 10) / 10}h`;

export function FloorDay(p: Props) {
  // AM-29: everyone is present unless marked absent; absence is changed in its own pop-up.
  const present = Object.fromEntries(p.people.map((x) => [x.id, !x.away]));
  const [absent, setAbsent] = useState<DayPerson | null>(null);
  const [logs, setLogs] = useState<DayLog[]>(p.logs);
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const [pending, start] = useTransition();
  const dirty = useMemo(() => JSON.stringify(logs) !== JSON.stringify(p.logs) || p.people.some((x) => !x.away !== x.present), [logs, p]);

  const byPerson = (id: string) => logs.filter((l) => l.personId === id).reduce((s, l) => s + (l.hours || 0), 0);
  const onSite = p.people.filter((x) => present[x.id]);
  const logged = logs.reduce((s, l) => s + (l.hours || 0), 0);
  const groups = [...new Set(p.parts.map((x) => x.group))];
  const set = (k: string, patch: Partial<DayLog>) => setLogs((ls) => ls.map((l) => (l.key === k ? { ...l, ...patch } : l)));

  /** v1 "Fill from assignments": each present person's remaining hours split evenly across their In Progress parts. */
  const fill = () => {
    const next = [...logs];
    for (const person of onSite) {
      const mine = p.parts.filter((x) => x.tech === person.id && x.status === "doing");
      const left = Math.floor((p.dayHours - byPerson(person.id)) / p.step) * p.step;
      if (!mine.length || left <= 0) continue;
      const each = Math.floor(left / mine.length / p.step) * p.step;
      mine.forEach((part, i) => {
        const hours = i === mine.length - 1 ? Math.round((left - each * (mine.length - 1)) * 100) / 100 : each;
        if (hours > 0) next.push({ key: key(), personId: person.id, workItemId: part.id, hours });
      });
    }
    setLogs(next);
  };

  const save = () => start(async () => {
    const payload = {
      day: p.day,
      attendance: p.people.map((x) => ({ personId: x.id, present: !!present[x.id] })),
      logs: logs.filter((l) => l.personId && l.workItemId && l.hours > 0).map(({ personId, workItemId, hours }) => ({ personId, workItemId, hours })),
    };
    setMsg(await saveDay(JSON.stringify(payload)));
  });

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="On site" value={`${onSite.length} / ${p.people.length}`} tone="gold" />
        <Tile label="Hours logged" value={fmt(logged)} sub={`of ${fmt(onSite.length * p.dayHours)} available`} tone="cool" />
        <Tile label="Parts in work" value={p.inWorkCount} tone="grey" />
        {p.labour ? <Tile label={`Labour today ${p.labour.currency}`} value={Math.round(p.labour.value).toLocaleString("en-US")} sub="saved logs" tone="gold" />
          : <Tile label="Logs" value={logs.length} tone="grey" />}
      </div>

      <section>
        <h2 className="eyebrow mb-2">Attendance</h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {p.people.map((x) => {
            const on = !x.away;
            return (
              <div key={x.id} className={`flex items-center gap-2 rounded-md border px-3 py-2 ${on ? "border-ok/60 bg-panel" : "border-line bg-panel3"}`}>
                <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-on-colour ${on ? "" : "opacity-50 grayscale"}`} style={{ background: x.colour }}>{x.initials}</span>
                <span className="min-w-0 flex-1">
                  <span className={`block truncate ${on ? "" : "text-grey"}`}>{x.name}</span>
                  <span className={`block truncate font-mono text-xs ${on ? "text-ok" : "text-warn"}`}>{on ? `Present · ${fmt(Math.max(0, p.dayHours - byPerson(x.id)))} left` : x.away!.label}</span>
                </span>
                {p.canWrite && (
                  <button className={`${btn.ghost} !min-h-9 !px-3 !py-1 text-xs`} onClick={() => setAbsent(x)}>{on ? "Absent" : "Edit"}</button>
                )}
              </div>
            );
          })}
        </div>
        {absent && (
          <AbsenceDialog open onClose={() => setAbsent(null)} person={absent} day={p.day} away={absent.away} pending={absent.pending}
            crew={p.crew} calendar={p.calendar} holidays={p.holidays} />
        )}
      </section>

      <section className="rounded-[10px] border border-line bg-panel">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line p-3">
          <h2 className="eyebrow">Hours logged</h2>
          {p.canWrite && (
            <div className="flex gap-2">
              <button className={btn.ghost} onClick={fill} disabled={!p.parts.length}>Fill from assignments</button>
              <button className={btn.ghost} onClick={() => setLogs((ls) => [...ls, { key: key(), personId: onSite[0]?.id ?? "", workItemId: "", hours: p.step * 2 }])}>Add line</button>
            </div>
          )}
        </div>
        {!p.parts.length && <p className="p-4 text-sm text-grey">No parts are In Progress or Blocked, so there is nothing to log hours against.</p>}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <tbody>
              {logs.map((l) => (
                <tr key={l.key} className="border-b border-line last:border-0">
                  <td className="p-2">
                    <select value={l.personId} disabled={!p.canWrite} onChange={(e) => set(l.key, { personId: e.target.value })} className={input} aria-label="Person">
                      <option value="">Who…</option>
                      {onSite.map((x) => <option key={x.id} value={x.id}>{x.name} — {fmt(Math.max(0, p.dayHours - byPerson(x.id) + (x.id === l.personId ? l.hours : 0)))} left</option>)}
                    </select>
                  </td>
                  <td className="p-2">
                    <select value={l.workItemId} disabled={!p.canWrite} onChange={(e) => set(l.key, { workItemId: e.target.value })} className={input} aria-label="Part">
                      <option value="">Part being worked…</option>
                      {groups.map((g) => (
                        <optgroup key={g} label={g}>
                          {p.parts.filter((x) => x.group === g).map((x) => <option key={x.id} value={x.id}>{x.label}{x.status === "blocked" ? " (blocked)" : ""}</option>)}
                        </optgroup>
                      ))}
                    </select>
                  </td>
                  <td className="w-28 p-2">
                    <input type="number" min={p.step} step={p.step} max={p.dayHours} value={l.hours} disabled={!p.canWrite}
                      onChange={(e) => set(l.key, { hours: Number(e.target.value) })} className={`${input} font-mono`} aria-label="Hours" />
                  </td>
                  <td className="w-10 p-2 text-right">
                    {p.canWrite && <button className="text-grey hover:text-bad" aria-label="Remove line" onClick={() => setLogs((ls) => ls.filter((x) => x.key !== l.key))}>✕</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!logs.length && p.parts.length > 0 && <p className="p-4 text-sm text-grey">Nothing logged yet. Use Fill from assignments, or Add line.</p>}
      </section>

      {p.canWrite && (
        <div className="flex flex-wrap items-center gap-3">
          <button className={btn.primary} disabled={pending || !dirty} onClick={save}>{pending ? "Saving…" : "Save day"}</button>
          {dirty && !pending && <span className="text-sm text-warn">Unsaved changes</span>}
          {msg.ok && !dirty && <span className="text-sm text-ok">{msg.ok}</span>}
          {msg.error && <span role="alert" className="text-sm text-bad">{msg.error}</span>}
        </div>
      )}
    </div>
  );
}
