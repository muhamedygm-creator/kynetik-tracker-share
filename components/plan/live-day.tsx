"use client";
/**
 * Task queue → Live (v2, docs/ux/DECISIONS.md 2026-10-09; conveyor 2026-10-13, AM-16): the now line stays
 * put after the names and the day slides right to left into it, with lunch as an orange band. Every task is
 * coloured as the clock runs:
 * - in progress: green until its planned end, red once it runs past it ("late");
 * - waiting for QC: blue;
 * - not started: grey (upcoming), red once a set start time has passed ("late start");
 * - done: faded, green when it stayed within its planned hours (+ the scoring tolerance), red when it did not;
 * - blocked: red outline.
 * The page reloads its plan every minute (and on any change) so later tasks move along with the queue.
 */
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { conveyorAxis, nowShare } from "@/domain/conveyor";
import type { CalendarSettings, ConveyorSettings } from "@/domain/settings";

type Status = "todo" | "doing" | "blocked" | "done";
export interface LivePerson {
  id: string; name: string; initials: string; colour: string; dept: string; blocked: string[];
  tasks: {
    id: string; title: string; tag: string | null; status: Status; priority: "normal" | "urgent";
    start: string; end: string; lastToday: boolean; plannedEnd: string | null; fixedStart: string | null; onTime: boolean | null; hours: number; qc: boolean;
  }[];
}

const hhmm = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(Math.floor(min % 60)).padStart(2, "0")}`;
const minOf = (t: string) => +t.slice(0, 2) * 60 + +t.slice(3, 5);
const minOfDT = (dt: string) => minOf(dt.slice(11, 16));
const fmtLeft = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${Math.round(m % 60)}m` : `${Math.max(1, Math.round(m))}m`);

type Tone = "ok" | "late" | "upcoming" | "blocked" | "qc" | "doneOk" | "doneLate";
const TONE: Record<Tone, string> = {
  ok: "bg-ok text-on-accent",
  late: "bg-bad text-on-accent",
  qc: "bg-cool text-on-accent",
  doneOk: "bg-ok/35 text-ink opacity-70",
  doneLate: "bg-bad/35 text-ink opacity-70",
  upcoming: "bg-line2 text-ink",
  blocked: "bg-transparent text-bad outline outline-2 outline-bad",
};

export function LiveDay({ now, today, workDay, calendar, conveyor, rows, grouped }: {
  now: string; today: string; workDay: boolean; calendar: CalendarSettings; conveyor: ConveyorSettings; rows: LivePerson[]; grouped: boolean;
}) {
  const router = useRouter();
  // Shop time = the server's shop-local "now" plus the time passed in this browser since the page loaded.
  const [offset] = useState(() => Date.parse(`${now}:00Z`) - Date.now());
  const [ms, setMs] = useState(() => Date.parse(`${now}:00Z`));
  useEffect(() => {
    const tick = setInterval(() => setMs(Date.now() + offset), 1000);
    const reload = setInterval(() => router.refresh(), 60_000);
    return () => { clearInterval(tick); clearInterval(reload); };
  }, [offset, router]);

  const clock = new Date(ms);
  const nowDate = clock.toISOString().slice(0, 10);
  const nowMin = clock.getUTCHours() * 60 + clock.getUTCMinutes() + clock.getUTCSeconds() / 60;
  const dayStart = minOf(calendar.shiftStart), dayEnd = minOf(calendar.shiftEnd);
  const lunchFrom = minOf(calendar.breakStart), lunchTo = lunchFrom + calendar.breakMins;
  const isToday = nowDate === today;
  // Conveyor: a fixed window around now; before today's page is today (after midnight), it starts at the shift start.
  const ax = useMemo(() => conveyorAxis(isToday ? nowMin : dayStart, conveyor), [isToday, nowMin, dayStart, conveyor]);
  const span = ax.to - ax.from;
  const pct = (m: number) => `${ax.at(m) * 100}%`;
  const slide = "left 1s linear, width 1s linear";

  /** Tone and label of one task at this moment. */
  const toneOf = (t: LivePerson["tasks"][number]): { tone: Tone; label: string } => {
    if (t.status === "blocked") return { tone: "blocked", label: "blocked" };
    if (t.status === "done") return t.onTime ? { tone: "doneOk", label: "done on time" } : { tone: "doneLate", label: "done late" };
    if (t.qc) return { tone: "qc", label: "waiting for QC" };
    if (t.status === "doing") {
      const due = t.plannedEnd && t.plannedEnd.slice(0, 10) === today ? minOfDT(t.plannedEnd) : Infinity;
      if (isToday && nowMin > due) return { tone: "late", label: `late +${fmtLeft(nowMin - due)}` };
      return { tone: "ok", label: due === Infinity ? "on time" : `on time · ${fmtLeft(due - nowMin)} left` };
    }
    const set = t.fixedStart && t.fixedStart.slice(0, 10) === today ? minOfDT(t.fixedStart) : null;
    if (isToday && set !== null && nowMin > set + 1) return { tone: "late", label: `late start · was ${hhmm(set)}` };
    return { tone: "upcoming", label: `starts ${t.start.slice(11, 16)}` };
  };

  const all = rows.flatMap((r) => r.tasks.map(toneOf));
  const count = (tone: Tone) => all.filter((x) => x.tone === tone).length;

  if (!workDay) {
    return <p className="rounded-xl border border-line bg-panel p-8 text-center text-grey">Today is not a working day. The live view starts again on the next working day at {calendar.shiftStart}.</p>;
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4 rounded-xl border border-line bg-panel px-5 py-4">
        <div>
          <div className="eyebrow">Live · {calendar.shiftStart} to {calendar.shiftEnd}</div>
          <div className="font-mono text-5xl leading-none tabular-nums" aria-live="off">
            {hhmm(nowMin)}<span className="text-2xl text-grey">:{String(clock.getUTCSeconds()).padStart(2, "0")}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          <Chip tone="ok" n={count("ok")} label="on time" />
          <Chip tone="late" n={count("late")} label="late" />
          {count("qc") > 0 && <Chip tone="qc" n={count("qc")} label="waiting for QC" />}
          <Chip tone="upcoming" n={count("upcoming")} label="still to start" />
          {count("blocked") > 0 && <Chip tone="blocked" n={count("blocked")} label="blocked" />}
        </div>
      </div>

      <section aria-label="Today live" className="overflow-x-auto rounded-xl border border-line bg-panel">
        <div className="min-w-[820px]">
          <div className="sticky top-0 z-10 grid grid-cols-[180px_minmax(0,1fr)] border-b border-line bg-panel2">
            <div className="px-3 py-2 font-mono text-[0.7rem] uppercase tracking-wider text-grey">Person</div>
            <div className="relative h-9 overflow-hidden">
              {ax.hours.map((h) => (
                <span key={h} className="absolute top-2 -translate-x-1/2 font-mono text-[0.7rem] text-grey" style={{ left: pct(h), transition: slide }}>{hhmm(h)}</span>
              ))}
              {isToday && <span className={`absolute bottom-0.5 font-mono text-[0.65rem] font-semibold text-gold ${nowShare(conveyor) > 0 ? "-translate-x-1/2" : "pl-1"}`} style={{ left: `${nowShare(conveyor) * 100}%` }}>now</span>}
            </div>
          </div>

          {rows.map((r, i) => {
            const heading = grouped && r.dept !== rows[i - 1]?.dept;
            const tones = r.tasks.map(toneOf);
            const late = tones.filter((x) => x.tone === "late").length;
            return (
              <div key={r.id}>
                {heading && <div className="border-b border-line bg-panel3 px-3 py-1.5 font-mono text-[0.7rem] uppercase tracking-wider text-gold">{r.dept}</div>}
                <div className="grid grid-cols-[180px_minmax(0,1fr)] border-b border-line last:border-0">
                  <div className="flex items-center gap-2.5 border-r border-line px-3 py-2">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-bold text-on-colour" style={{ background: r.colour }}>{r.initials}</span>
                    <div className="min-w-0">
                      <div className="truncate font-semibold">{r.name}</div>
                      <div className={`font-mono text-[0.7rem] ${late ? "text-bad" : "text-grey"}`}>{r.tasks.length ? (late ? `${late} late` : "on track") : "nothing today"}</div>
                      {r.blocked.map((b) => <div key={b} className="truncate text-[0.7rem] text-bad">⛔ {b}</div>)}
                    </div>
                  </div>
                  <div className="relative min-h-[76px] overflow-hidden">
                    {ax.hours.map((h) => <i key={h} aria-hidden className="absolute inset-y-0 w-px bg-line" style={{ left: pct(h), transition: slide }} />)}
                    {dayEnd < ax.to && <div aria-hidden className="absolute inset-y-0 right-0 bg-black/30" style={{ left: pct(dayEnd), transition: slide }} title="After hours" />}
                    {dayStart > ax.from && <div aria-hidden className="absolute inset-y-0 left-0 bg-black/30" style={{ width: pct(dayStart), transition: slide }} />}
                    {lunchTo > ax.from && lunchFrom < ax.to && (
                      <div aria-hidden className="absolute inset-y-0 flex items-center justify-center overflow-hidden border-x border-warn/60 bg-warn/25 font-mono text-[0.65rem] uppercase tracking-widest text-warn"
                        style={{ left: pct(lunchFrom), width: `calc(${pct(lunchTo)} - ${pct(lunchFrom)})`, transition: slide }} title="Lunch">Lunch</div>
                    )}
                    {r.tasks.map((t, k) => {
                      const { tone, label } = tones[k];
                      const s = minOfDT(t.start);
                      const e = t.status === "doing" && t.lastToday && isToday ? Math.max(minOfDT(t.end), nowMin) : minOfDT(t.end);
                      if (e <= ax.from || s >= ax.to) return null;
                      const roomy = Math.min(e, ax.to) - Math.max(s, ax.from) >= span * 0.06;
                      return (
                        <div key={`${t.id}:${k}`} title={`${t.title}${t.tag ? ` · ${t.tag}` : ""}\n${t.start.slice(11, 16)}–${t.end.slice(11, 16)} · ${label}`}
                          className={`absolute top-2 bottom-2 overflow-hidden rounded-lg px-2 py-1 transition-colors duration-700 ${TONE[tone]} ${t.status === "doing" ? "shadow-[0_0_14px_rgba(255,255,255,.12)]" : ""}`}
                          style={{ left: pct(s), width: `max(6px, calc(${pct(e)} - ${pct(s)} - 3px))`, boxShadow: t.priority === "urgent" ? "inset 0 4px 0 var(--bad)" : undefined, transition: slide }}>
                          {roomy && <>
                            <div className="truncate text-[0.8rem] font-bold leading-tight">{t.status === "done" ? "✓ " : ""}{t.title}</div>
                            <div className="truncate font-mono text-[0.65rem] opacity-80">{t.tag ? `${t.tag} · ` : ""}{label}</div>
                          </>}
                        </div>
                      );
                    })}
                    {isToday && (
                      <i aria-hidden className={`absolute inset-y-0 z-[3] w-0.5 bg-gold shadow-[0_0_10px_rgba(233,190,95,.7)] ${nowShare(conveyor) > 0 ? "-translate-x-1/2" : ""}`} style={{ left: `${nowShare(conveyor) * 100}%` }} />
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          {!rows.length && <p className="p-6 text-sm text-grey">Nobody in this department yet. Add people to it in Crew.</p>}
        </div>
      </section>
      <p className="text-xs text-grey">The gold line is now: it stays put and the day slides into it. Green: on time. Red: running past its planned end, or a set start time that has passed. Blue: waiting for QC. Grey: still to start. Faded: done (red if it went over its planned hours). Orange: lunch. Updates by itself.</p>
    </div>
  );
}

function Chip({ tone, n, label }: { tone: Tone; n: number; label: string }) {
  return (
    <span className="flex min-h-10 items-center gap-2 rounded-full border border-line2 px-3.5">
      <i className={`h-2.5 w-2.5 rounded-full ${tone === "ok" ? "bg-ok" : tone === "late" ? "bg-bad" : tone === "qc" ? "bg-cool" : tone === "blocked" ? "outline outline-2 outline-bad" : "bg-line2"}`} />
      <b className="font-mono">{n}</b><span className="text-grey">{label}</span>
    </span>
  );
}
