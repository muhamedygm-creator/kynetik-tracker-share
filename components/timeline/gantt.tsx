"use client";
/** Timeline / Gantt (spec §14): build, stage and task rows on the calendar; drag a task bar to move it. */
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { moveTask } from "@/app/(console)/builds/actions";
import { makeCalendar } from "@/domain/calendar";
import { fmtDT, fmtDate } from "@/domain/format";
import { liveTone, nowShare, type LiveTone } from "@/domain/conveyor";
import type { CalendarSettings, ConveyorSettings, TimelineSettings } from "@/domain/settings";
import { addDays, dayOfDate, toMin, weekdayOfDay } from "@/domain/time";
import { snapMove, type Zoom } from "@/domain/timeline";

export interface GTask {
  id: string; version: number; projectId: string; name: string; start: string; end: string; status: "todo" | "doing" | "blocked" | "done";
  pct: number; baseStart: string | null; baseEnd: string | null; fcEnd: string | null; pinned: boolean;
}
export interface GStage { id: string; name: string; colour: string; start: string | null; end: string | null; pct: number; station: string | null; tasks: GTask[] }
export interface GBuild {
  id: string; serial: string; name: string; start: string; end: string | null; fcEnd: string | null; committed: string | null; health: string; stages: GStage[];
  status: "planned" | "active" | "hold" | "done"; blocked: number; pct: number;
}
/**
 * By person: one row per crew member, their queue laid on the clock (one bar per working-day segment).
 * Conveyor (AM-16): the view follows the clock with the now line held just after the names, so the day
 * slides right to left into it; bars use the live colours and lunch shows as an orange band.
 */
export interface GPersonRow {
  id: string; name: string; dept: string | null; busy: boolean;
  bars: { key: string; label: string; start: string; end: string; status: GTask["status"]; current: boolean; qc: boolean; plannedEnd: string | null }[];
}
export interface GStationRow { id: string; name: string; colour: string; bars: { key: string; label: string; start: string; end: string; pct: number; colour: string }[] }

interface Props {
  zoom: Zoom;
  rows: TimelineSettings["defaultRows"] | "people";
  from: string;
  to: string;
  px: TimelineSettings["pxPerDay"];
  calendar: CalendarSettings;
  holidays: string[];
  now: string;
  conveyor: ConveyorSettings;
  builds: GBuild[];
  stations: GStationRow[];
  people: GPersonRow[];
  statusColour: Record<GTask["status"], string>;
  canWrite: boolean;
}

const LEFT = 240;
const HEALTH: Record<string, { label: string; colour: string }> = {
  late: { label: "Late", colour: "var(--bad)" }, risk: { label: "At risk", colour: "var(--warn)" }, ok: { label: "On track", colour: "var(--ok)" },
  unset: { label: "No date", colour: "var(--grey)" }, hold: { label: "On hold", colour: "var(--grey)" }, done: { label: "Delivered", colour: "var(--ok)" },
};
const STATUS: Record<GBuild["status"], string> = { planned: "Planned", active: "Active", hold: "Paused", done: "Done" };
const LIVE: Record<LiveTone, { bg: string; ink: string; style?: React.CSSProperties }> = {
  ok: { bg: "var(--ok)", ink: "text-on-accent" },
  over: { bg: "var(--bad)", ink: "text-on-accent" },
  todo: { bg: "var(--line2)", ink: "text-ink" },
  qc: { bg: "var(--cool)", ink: "text-on-accent" },
  done: { bg: "var(--ok)", ink: "text-on-accent", style: { opacity: 0.4 } },
  blocked: { bg: "transparent", ink: "text-bad", style: { outline: "1.5px solid var(--bad)" } },
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function TaskBar({ t, x, w, p, setError }: { t: GTask; x: (dt: string) => number; w: (a: string, b: string) => number; p: Props; setError: (m: string | null) => void }) {
  const cal = useMemo(() => makeCalendar({ calendar: p.calendar, holidays: p.holidays }), [p.calendar, p.holidays]);
  const [dx, setDx] = useState(0);
  const [pending, start] = useTransition();
  const drag = useRef<{ x0: number; moved: boolean } | null>(null);
  const target = dx ? snapMove(t.start, dx, p.zoom, p.px, cal) : null;
  const can = p.canWrite && !pending;

  return (
    <div className="absolute inset-y-1" style={{ left: x(t.start), width: w(t.start, t.end), transform: `translateX(${dx}px)` }}>
      {t.baseStart && t.baseEnd && (
        <div className="pointer-events-none absolute -bottom-0.5 h-0.5 bg-grey2" style={{ left: x(t.baseStart) - x(t.start), width: w(t.baseStart, t.baseEnd) }} />
      )}
      <div
        role={can ? "slider" : undefined}
        aria-label={`${t.name}, ${fmtDT(t.start)} to ${fmtDT(t.end)}${can ? ". Drag to move." : ""}`}
        aria-valuetext={fmtDT(target ?? t.start)}
        tabIndex={can ? 0 : -1}
        title={`${t.name}\n${fmtDT(t.start)} → ${fmtDT(t.end)}${t.fcEnd ? `\nforecast ${fmtDT(t.fcEnd)}` : ""}${t.pinned ? "\npinned start" : ""}`}
        className={`relative h-full overflow-hidden rounded-sm ${can ? "cursor-grab active:cursor-grabbing" : ""} ${pending ? "opacity-60" : ""}`}
        style={{ background: t.status === "todo" ? "var(--line2)" : `${p.statusColour[t.status]}55`, outline: dx ? "1px solid var(--gold)" : undefined, touchAction: "none" }}
        onPointerDown={(e) => {
          if (!can) return;
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          drag.current = { x0: e.clientX, moved: false };
          setError(null);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const d = e.clientX - drag.current.x0;
          if (Math.abs(d) > 3) drag.current.moved = true;
          setDx(d);
        }}
        onPointerUp={() => {
          const d = drag.current;
          drag.current = null;
          if (!d?.moved || !target || target === t.start) { setDx(0); return; }
          start(async () => {
            const r = await moveTask(t.id, t.version, t.projectId, target);
            if (r.error) setError(r.error);
            setDx(0);
          });
        }}
        onPointerCancel={() => { drag.current = null; setDx(0); }}
      >
        <div className="h-full" style={{ width: `${t.status === "done" ? 100 : t.pct}%`, background: p.statusColour[t.status] }} />
        <span className="pointer-events-none absolute inset-0 truncate px-1 text-[0.7rem] leading-[1.25rem] text-ink mix-blend-normal">{t.name}</span>
      </div>
      {t.fcEnd && t.fcEnd > t.end && (
        <div className="hatch-overrun pointer-events-none absolute inset-y-0 rounded-r-sm" style={{ left: w(t.start, t.end), width: w(t.end, t.fcEnd) }} />
      )}
      {target && <span className="pointer-events-none absolute -top-5 left-0 whitespace-nowrap rounded bg-gold px-1 font-mono text-[0.65rem] text-on-accent">{fmtDT(target)}</span>}
    </div>
  );
}

function Row({ label, sub, children, strong, width }: { label: React.ReactNode; sub?: React.ReactNode; children: React.ReactNode; strong?: boolean; width: number }) {
  return (
    <div className={`flex border-b border-line/70 ${strong ? "bg-panel2/60" : ""}`}>
      <div className="sticky left-0 z-10 flex shrink-0 flex-col justify-center border-r border-line bg-panel px-3 py-1" style={{ width: LEFT }}>
        <div className={`truncate ${strong ? "" : "text-sm"}`}>{label}</div>
        {sub && <div className="truncate font-mono text-[0.65rem] text-grey">{sub}</div>}
      </div>
      <div className="relative" style={{ width, height: strong ? 40 : 26 }}>{children}</div>
    </div>
  );
}

export function Gantt(p: Props) {
  const [error, setError] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const days: string[] = [];
  for (let d = p.from; d <= p.to; d = addDays(d, 1)) days.push(d);
  const ppd = p.px[p.zoom];
  const width = days.length * ppd;
  const t0 = toMin(p.from);
  const x = (dt: string) => ((toMin(dt) - t0) / 1440) * ppd;
  const w = (a: string, b: string) => Math.max(2, x(b) - x(a));
  const rest = new Set(p.calendar.restDays);
  const hol = new Set(p.holidays);
  const off = days.filter((d) => rest.has(weekdayOfDay(dayOfDate(d))) || hol.has(d));
  const months = days.filter((d, i) => i === 0 || d.endsWith("-01"));
  // Shop time: the server's "now" plus the time passed in this browser (By person keeps it ticking).
  const live = p.rows === "people";
  const [offset] = useState(() => Date.parse(`${p.now}:00Z`) - Date.now());
  const [nowMs, setNowMs] = useState(() => Date.parse(`${p.now}:00Z`));
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setNowMs(Date.now() + offset), 5_000);
    return () => clearInterval(t);
  }, [live, offset]);
  const now = live ? new Date(nowMs).toISOString().slice(0, 16) : p.now;
  const nowX = live ? ((nowMs / 60_000 - t0) / 1440) * ppd : x(p.now);
  // Open with "now" in view (a third from the left). By person follows the clock: now stays just after the
  // names until the user scrolls away; "Back to now" resumes.
  const [follow, setFollow] = useState(true);
  const target = useRef<number | null>(null);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (live && !follow) return;
    el.scrollLeft = target.current = Math.max(0, live ? nowX - nowShare(p.conveyor) * (el.clientWidth - LEFT) : nowX + LEFT - el.clientWidth / 3);
  }, [nowX, p.zoom, p.rows, live, follow, p.conveyor]);
  const ticks = p.zoom === "month" ? [] : p.zoom === "week" ? days.filter((d) => weekdayOfDay(dayOfDate(d)) === 1) : days;

  return (
    <div className="grid gap-2">
      {error && <p role="alert" className="rounded-md border border-bad bg-panel p-3 text-sm text-bad">{error}</p>}
      {live && !follow && (
        <button className="justify-self-start rounded-md border border-gold px-3 py-1.5 text-sm text-gold" onClick={() => setFollow(true)}>Back to now</button>
      )}
      <div ref={scroller} className="relative overflow-x-auto rounded-[10px] border border-line bg-panel"
        onScroll={(e) => { if (live && target.current !== null && Math.abs(e.currentTarget.scrollLeft - target.current) > 4) setFollow(false); }}>
        <div className="relative" style={{ width: width + LEFT }}>
          {/* header */}
          <div className="sticky top-0 z-20 flex border-b border-line bg-panel">
            <div className="sticky left-0 z-10 shrink-0 border-r border-line bg-panel" style={{ width: LEFT }} />
            <div className="relative h-10" style={{ width }}>
              {ppd < 480 && months.map((d) => (
                <span key={d} className="label absolute top-1 border-l border-line2 pl-1" style={{ left: x(d) }}>{MONTHS[+d.slice(5, 7) - 1]} {d.slice(0, 4)}</span>
              ))}
              {ppd >= 480 && days.flatMap((d) => [9, 11, 13, 15, 17].map((h) => (
                <span key={`${d}h${h}`} className="absolute top-1 -translate-x-1/2 font-mono text-[0.6rem] text-grey" style={{ left: x(`${d}T${String(h).padStart(2, "0")}:00`) }}>{h}:00</span>
              )))}
              {ticks.map((d) => (
                <span key={d} className={`absolute bottom-1 -translate-x-1/2 font-mono text-[0.6rem] ${off.includes(d) ? "text-bad" : "text-grey"}`}
                  style={{ left: x(d) + (p.zoom === "week" ? 0 : ppd / 2) }}>
                  {p.zoom === "week" || ppd >= 480 ? fmtDate(d) : +d.slice(8, 10)}
                </span>
              ))}
            </div>
          </div>

          {/* rest days + now line behind the rows */}
          <div className="pointer-events-none absolute bottom-0 top-10" style={{ left: LEFT, width }}>
            {p.zoom !== "month" && off.map((d) => <div key={d} className="absolute inset-y-0 bg-bad/[0.07]" style={{ left: x(d), width: ppd }} />)}
            {live && ppd >= 96 && days.filter((d) => !off.includes(d)).map((d) => {
              const a = `${d}T${p.calendar.breakStart}`;
              return <div key={`l${d}`} title="Lunch" className="absolute inset-y-0 z-[1] border-x border-warn/50 bg-warn/20" style={{ left: x(a), width: (p.calendar.breakMins / 1440) * ppd }} />;
            })}
            <div className={`absolute inset-y-0 z-[5] bg-gold ${live ? "w-0.5 shadow-[0_0_8px_rgba(233,190,95,.7)]" : "w-px"}`} style={{ left: nowX }} />
          </div>

          {p.rows === "people" && (p.people.length ? p.people.map((r) => (
            <Row key={r.id} strong width={width}
              label={<span className="flex items-center gap-2"><span className={`h-2 w-2 shrink-0 rounded-full ${r.busy ? "bg-ok shadow-[0_0_6px_var(--ok)]" : "bg-grey2"}`} />{r.name}</span>}
              sub={`${r.dept ?? "No department"}${r.busy ? " · working now" : ""}`}>
              {r.bars.map((b) => {
                const end = b.current && b.status === "doing" && now > b.end ? now : b.end;
                const tone = liveTone({ status: b.status, qc: b.qc }, toMin(now), b.current ? toMin(b.plannedEnd ?? b.end) : null);
                const look = LIVE[tone];
                return (
                  <div key={b.key} title={`${b.label}\n${fmtDT(b.start)} → ${fmtDT(end)}${tone === "qc" ? "\nwaiting for QC" : tone === "over" ? "\nover its allocated time" : ""}`}
                    className="absolute inset-y-1.5 z-[2] overflow-hidden rounded-sm transition-colors duration-700"
                    style={{ left: x(b.start), width: w(b.start, end), background: look.bg, ...look.style }}>
                    {w(b.start, end) >= 28 && <span className={`absolute inset-0 truncate px-1 text-[0.7rem] leading-[1.4rem] ${look.ink}`}>{b.label}</span>}
                  </div>
                );
              })}
            </Row>
          )) : <p className="p-4 text-sm text-grey">No production crew yet. Add people under Crew.</p>)}

          {p.rows === "people" ? null : p.rows === "stations"
            ? p.stations.map((s) => (
                <Row key={s.id} label={s.name} strong width={width}>
                  {s.bars.map((b) => (
                    <div key={b.key} title={`${b.label}\n${fmtDT(b.start)} → ${fmtDT(b.end)}`} className="absolute inset-y-1.5 overflow-hidden rounded-sm"
                      style={{ left: x(b.start), width: w(b.start, b.end), background: `${b.colour}44` }}>
                      <div className="h-full" style={{ width: `${b.pct * 100}%`, background: b.colour }} />
                      <span className="absolute inset-0 truncate px-1 text-[0.7rem] leading-[1.4rem]">{b.label}</span>
                    </div>
                  ))}
                </Row>
              ))
            : p.builds.map((b) => (
                <div key={b.id}>
                  <Row strong width={width}
                    label={<a href={`/builds/${b.id}`} className="flex min-w-0 items-center gap-2 hover:text-gold">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: HEALTH[b.health]?.colour ?? "var(--grey)" }} title={HEALTH[b.health]?.label} />
                      <span className="font-mono text-gold">{b.serial}</span><span className="truncate">{b.name}</span></a>}
                    sub={[STATUS[b.status], HEALTH[b.health]?.label, `${Math.round(b.pct * 100)}%`, b.fcEnd ? `fc ${fmtDate(b.fcEnd)}` : null,
                      b.committed ? `promised ${fmtDate(b.committed)}` : null, b.blocked ? `${b.blocked} blocked` : null].filter(Boolean).join(" · ")}>
                    {b.end && <div className="absolute inset-y-3 rounded-sm bg-line2" style={{ left: x(b.start), width: w(b.start, b.end) }} />}
                    {b.end && b.fcEnd && b.fcEnd > b.end && <div className="hatch-overrun absolute inset-y-3 rounded-sm" style={{ left: x(b.end), width: w(b.end, b.fcEnd) }} />}
                    {b.committed && (
                      <div title={`committed ${fmtDate(b.committed)}`} className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rotate-45"
                        style={{ left: x(b.committed), background: b.fcEnd && b.fcEnd > b.committed ? "var(--bad)" : "var(--ink)" }} />
                    )}
                  </Row>
                  {b.stages.map((s) => (
                    <div key={s.id}>
                      <Row label={s.name} sub={s.station ?? undefined} width={width}>
                        {s.start && s.end && (
                          <div className="absolute inset-y-1.5 overflow-hidden rounded-sm" style={{ left: x(s.start), width: w(s.start, s.end), background: `${s.colour}33` }}>
                            <div className="h-full" style={{ width: `${s.pct * 100}%`, background: s.colour }} />
                          </div>
                        )}
                      </Row>
                      {p.rows === "tasks" && s.tasks.map((t) => (
                        <Row key={t.id} width={width} label={<span className="pl-3 text-grey">{t.name}</span>}>
                          <TaskBar t={t} x={x} w={w} p={p} setError={setError} />
                        </Row>
                      ))}
                    </div>
                  ))}
                </div>
              ))}
        </div>
      </div>
      <p className="text-xs text-grey">
        {p.canWrite && p.rows === "tasks" ? "Drag a task bar to move it: it snaps to days (to hours in the Hours zoom), gets a pinned start, and the tasks after it re-flow. " : ""}
        {p.rows === "people"
          ? "Each row is a person's task queue on the clock. The gold line is now: the view follows the clock and the day slides into it. Green = in progress within its time, red = over its time, blue = waiting for QC, grey = not started, faded = done, red outline = blocked, orange = lunch. The dot shows who is working now."
          : "Grey line under a task = baseline · hatched = forecast past plan · ◆ promised date (red when the forecast misses it) · gold line = now."}
      </p>
    </div>
  );
}
