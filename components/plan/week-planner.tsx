"use client";
/**
 * Week planner (docs/ROADMAP.md v1.4). People are rows, working days are columns, working hours only.
 * Drag a task to move it (time, day or person), drag its right edge to change hours, tap it for details,
 * drag from "Work to do" to plan a part. Pointer events, so mouse, pen and finger all work.
 */
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { setQueueStatus } from "@/app/(console)/queue/actions";
import { moveOnPlan, planWorkItem, removeFromPlan, resizeOnPlan, restorePlanTask, savePlanDetails } from "@/app/(console)/plan/actions";
import { AddTaskDrawer } from "@/components/plan/add-task";
import { Drawer } from "@/components/ui/drawer";
import { DurationField } from "@/components/ui/duration-field";
import { btn } from "@/components/ui/dialog";
import { makeCalendar } from "@/domain/calendar";
import { fmtDT, fmtHM } from "@/domain/format";
import { atOffset, offsetH } from "@/domain/plan";
import type { CalendarSettings } from "@/domain/settings";

type Status = "todo" | "doing" | "blocked" | "done";
export interface PlanTask {
  id: string; version: number; title: string; status: Status; priority: "normal" | "urgent"; notes: string;
  hours: number; duration: string; durValue: number; durUnit: "hours" | "days"; position: string; fixedStart: string | null;
  start: string | null; end: string | null; plannedEnd: string | null; current: boolean; overrun: boolean; lateStart: boolean; blocked: boolean;
  segments: { date: string; start: string; end: string; day: number; days: number }[];
  link: string | null; projectId: string | null; linked: boolean; tone: string;
}
export interface PlanPerson { id: string; name: string; initials: string; colour: string; dept: string; tasks: PlanTask[]; plannedH: number; laterH: number }
export interface WorkGroup {
  projectId: string; serial: string; name: string; tone: string; late: boolean; note: string;
  items: { workItemId: string; part: string; stage: string; hours: number; status: Status; tech: string | null }[];
}
interface Props {
  canWrite: boolean; calendar: CalendarSettings; holidays: string[]; now: string; today: string; days: string[];
  people: PlanPerson[]; groups: WorkGroup[];
  /** Everyone tab: show a department heading above each group of people */
  grouped?: boolean;
}

const NAME_W = 156;
/** Edge handle: a 16 px hit area with a visible bar; brighter on hover. */
const GRIP = (side: string) =>
  `absolute inset-y-0 ${side} z-[2] w-4 cursor-ew-resize bg-black/10 opacity-70 transition-opacity group-hover:opacity-100 hover:bg-black/25 ` +
  "after:pointer-events-none after:absolute after:left-1/2 after:top-1/2 after:h-6 after:w-1.5 after:-translate-x-1/2 after:-translate-y-1/2 after:rounded-full after:border-x-2 after:border-black/50";
const t_inProgress = (t: { status: string }) =>
  t.status === "done" ? "This task is done, so it stays where it happened." : "This task is in progress, so it runs from when it started. Finish or block it to move it.";
const STATUS_LABEL: Record<Status, string> = { todo: "Not started", doing: "In progress", blocked: "Blocked", done: "Done" };
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Mon 5 Oct": fixed format so the server and the browser render the same text. */
const DAY = { format: (d: Date) => `${WD[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}` };

type Drag =
  | { kind: "move"; task: PlanTask; person: string; el: HTMLElement; x0: number; y0: number; left: number; moved: boolean }
  | { kind: "resize"; task: PlanTask; el: HTMLElement; x0: number; width: number; moved: boolean; hours?: number }
  | { kind: "new"; item: WorkGroup["items"][number]; x0: number; y0: number; moved: boolean; ghost?: HTMLElement }
  | { kind: "tap"; task: PlanTask; x0: number; y0: number; moved: boolean }
  | { kind: "start"; task: PlanTask; person: string; el: HTMLElement; x0: number; left: number; width: number; moved: boolean; at?: string; hours?: number }
  | { kind: "slot"; person: string; lane: HTMLElement; x0: number; y0: number; moved: boolean };

export function WeekPlanner(p: Props) {
  const cal = useMemo(() => makeCalendar({ calendar: p.calendar, holidays: p.holidays }), [p.calendar, p.holidays]);
  const [zoom, setZoom] = useState<"week" | "day">("week");
  const [dayIx, setDayIx] = useState(() => Math.max(0, p.days.indexOf(p.today)));
  const [showWork, setShowWork] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState<{ person: string; at: string | null } | null>(null);
  const [toast, setToast] = useState<{ text: string; bad?: boolean } | null>(null);
  const [undo, setUndo] = useState<{ id: string; before: Parameters<typeof restorePlanTask>[1]; label: string } | null>(null);
  const [pending, start] = useTransition();
  const [width, setWidth] = useState(900);
  const scroller = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const tip = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 4200); return () => clearTimeout(t); }, [toast]);

  const days = zoom === "week" ? p.days : [p.days[dayIx] ?? p.days[0]];
  const H = cal.dayHours;
  const hourPx = Math.max(zoom === "week" ? 13 : 60, (width - NAME_W - 2) / (days.length * H));
  const dayW = H * hourPx;
  const nowDay = days.indexOf(p.now.slice(0, 10));

  const xOf = (date: string, t: string) => days.indexOf(date) * dayW + offsetH(cal, date, t) * hourPx;
  /** Pointer x inside a lane → shop time, snapped to 15 minutes. */
  const timeAt = (laneEl: HTMLElement, clientX: number) => {
    const x = Math.max(0, Math.min(days.length * dayW - 1, clientX - laneEl.getBoundingClientRect().left));
    const di = Math.min(days.length - 1, Math.floor(x / dayW));
    const h = Math.min(H - 0.25, Math.round(((x - di * dayW) / hourPx) * 4) / 4);
    return atOffset(cal, days[di], h);
  };
  const laneAt = (x: number, y: number) => document.elementsFromPoint(x, y).find((e) => (e as HTMLElement).dataset?.lane) as HTMLElement | undefined;
  const say = (r: { ok?: string; error?: string }) => setToast(r.error ? { text: r.error, bad: true } : { text: r.ok ?? "Saved." });
  const showTip = (text: string, x: number, y: number) => { const t = tip.current; if (!t) return; t.textContent = text; t.style.left = `${x + 14}px`; t.style.top = `${y - 34}px`; t.hidden = false; };
  const hideTip = () => { if (tip.current) tip.current.hidden = true; };
  const allTasks = p.people.flatMap((x) => x.tasks.map((t) => ({ t, person: x.id })));
  const task = allTasks.find((x) => x.t.id === open) ?? null;
  const personName = (id: string) => p.people.find((x) => x.id === id)?.name ?? "";

  function onDown(e: React.PointerEvent, d: Drag) {
    if (!p.canWrite || pending) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = d;
  }
  function onMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x0, dy = "y0" in d ? e.clientY - d.y0 : 0;
    if (!d.moved && Math.hypot(dx, dy) < 6) return;
    d.moved = true;
    if (d.kind === "tap" || d.kind === "slot") return;
    if (d.kind === "start") {
      const lane = d.el.parentElement!;
      const newLeft = Math.min(d.left + d.width - hourPx / 4, d.left + dx);
      const at = timeAt(lane, lane.getBoundingClientRect().left + newLeft);
      const hours = Math.max(0.25, Math.round((d.task.hours - cal.wh(d.task.start!, at)) * 4) / 4);
      d.at = at; d.hours = hours;
      const snapped = xOf(at.slice(0, 10), at);
      d.el.style.left = `${snapped}px`;
      d.el.style.width = `${Math.max(10, d.left + d.width - snapped)}px`;
      showTip(`Starts ${fmtDT(at)} · ${fmtHM(hours)}`, e.clientX, e.clientY);
      return;
    }
    document.querySelectorAll("[data-lane].ring-1").forEach((l) => l.classList.remove("ring-1", "ring-gold", "bg-gold/5"));
    if (d.kind === "resize") {
      const hours = Math.max(0.25, Math.round((d.task.hours + dx / hourPx) * 4) / 4);
      d.hours = hours;
      d.el.style.width = `${Math.max(8, d.width + (hours - d.task.hours) * hourPx)}px`;
      showTip(fmtHM(hours), e.clientX, e.clientY);
      return;
    }
    const lane = laneAt(e.clientX, e.clientY);
    lane?.classList.add("ring-1", "ring-gold", "bg-gold/5");
    if (d.kind === "move") {
      d.el.style.transform = `translate(${dx}px, ${dy}px)`;
      d.el.style.zIndex = "30";
      d.el.style.opacity = "0.9";
      if (lane) showTip(`${personName(lane.dataset.lane!)} · ${fmtDT(timeAt(lane, lane.getBoundingClientRect().left + d.left + dx))}`, e.clientX, e.clientY);
    } else {
      if (!d.ghost) {
        d.ghost = Object.assign(document.createElement("div"), { textContent: `${d.item.part} · ${fmtHM(d.item.hours)}` });
        d.ghost.className = "pointer-events-none fixed z-50 rounded-lg bg-gold px-3 py-2 text-sm font-bold text-on-accent shadow-2xl";
        document.body.append(d.ghost);
      }
      d.ghost.style.left = `${e.clientX + 12}px`;
      d.ghost.style.top = `${e.clientY + 12}px`;
      if (lane) showTip(`${personName(lane.dataset.lane!)} · ${fmtDT(timeAt(lane, e.clientX))}`, e.clientX, e.clientY); else hideTip();
    }
  }
  function onUp(e: React.PointerEvent) {
    const d = drag.current;
    drag.current = null;
    hideTip();
    document.querySelectorAll("[data-lane].ring-1").forEach((l) => l.classList.remove("ring-1", "ring-gold", "bg-gold/5"));
    if (!d) return;
    if (d.kind === "new") d.ghost?.remove();
    if (d.kind === "slot") {
      if (!d.moved) setAdding({ person: d.person, at: timeAt(d.lane, d.x0) });
      return;
    }
    if (!d.moved) {
      if (d.kind === "new") setToast({ text: "Drag it onto someone's row at the time it should start." });
      else setOpen(d.task.id);
      return;
    }
    if (d.kind === "start") {
      const restore = () => { d.el.style.left = `${d.left}px`; d.el.style.width = `${d.width}px`; };
      if (!d.at || !d.hours || (d.at === d.task.start && d.hours === d.task.hours)) return restore();
      const before = { personId: d.person, position: d.task.position, fixedStart: d.task.fixedStart, durValue: d.task.durValue, durUnit: d.task.durUnit };
      start(async () => {
        const r = await moveOnPlan(d.task.id, d.task.version, d.person, d.at!, d.hours!);
        say(r); restore();
        if (!r.error) setUndo({ id: d.task.id, before, label: d.task.title });
      });
      return;
    }
    if (d.kind === "tap") {
      setToast({ text: t_inProgress(d.task) });
      return;
    }
    const reset = () => { if (d.kind === "move" || d.kind === "resize") { d.el.style.transform = ""; d.el.style.width = d.kind === "resize" ? `${d.width}px` : d.el.style.width; d.el.style.zIndex = ""; d.el.style.opacity = ""; } };
    const before = d.kind === "new" ? null : { personId: d.kind === "move" ? d.person : allTasks.find((x) => x.t.id === d.task.id)!.person, position: d.task.position, fixedStart: d.task.fixedStart, durValue: d.task.durValue, durUnit: d.task.durUnit };
    if (d.kind === "resize") {
      if (!d.hours || d.hours === d.task.hours) return reset();
      start(async () => {
        const r = await resizeOnPlan(d.task.id, d.task.version, d.hours!);
        say(r); reset();
        if (!r.error && before) setUndo({ id: d.task.id, before, label: `${d.task.title} → ${fmtHM(d.hours!)}` });
      });
      return;
    }
    const lane = laneAt(e.clientX, e.clientY);
    if (!lane) return reset();
    if (d.kind === "move") {
      const laneLeft = lane.getBoundingClientRect().left;
      const at = timeAt(lane, laneLeft + d.left + (e.clientX - d.x0));
      start(async () => {
        const r = await moveOnPlan(d.task.id, d.task.version, lane.dataset.lane!, at);
        say(r); reset();
        if (!r.error && before) setUndo({ id: d.task.id, before, label: d.task.title });
      });
    } else {
      const at = timeAt(lane, e.clientX);
      start(async () => { say(await planWorkItem(d.item.workItemId, lane.dataset.lane!, at)); });
    }
  }

  const statusRing = (t: PlanTask) =>
    t.status === "doing" ? "outline outline-2 outline-gold shadow-[0_0_18px_rgba(233,190,95,.35)]" : t.status === "done" ? "opacity-55 saturate-50" : "";

  return (
    <div className="grid gap-3" onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Zoom" className="inline-flex overflow-hidden rounded-md border border-line2">
            {(["week", "day"] as const).map((z) => (
              <button key={z} aria-pressed={zoom === z} onClick={() => setZoom(z)} className={`min-h-10 px-4 text-sm ${zoom === z ? "bg-panel2 text-ink shadow-[inset_0_-2px_0_var(--gold)]" : "text-grey hover:text-ink"}`}>{z === "week" ? "Week" : "Day"}</button>
            ))}
          </div>
          {zoom === "day" && (
            <div className="flex flex-wrap gap-1">
              {p.days.map((d, i) => (
                <button key={d} aria-pressed={i === dayIx} onClick={() => setDayIx(i)} className={`min-h-10 rounded-md border px-3 text-sm ${i === dayIx ? "border-gold bg-gold/10" : "border-line2 text-grey hover:text-ink"}`}>{DAY.format(new Date(d))}</button>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {p.canWrite && p.people.length > 0 && <button className={btn.primary} onClick={() => setAdding({ person: p.people[0].id, at: null })}>+ Add task</button>}
          {undo && <button className={btn.ghost} disabled={pending} onClick={() => start(async () => { const r = await restorePlanTask(undo.id, undo.before); say(r.error ? r : { ok: `Undone: ${undo.label}` }); setUndo(null); })}>Undo</button>}
          <button className={btn.ghost} onClick={() => setShowWork((s) => !s)} aria-expanded={showWork}>{showWork ? "Hide work to do" : "Show work to do"}</button>
        </div>
      </div>

      <div className={`grid items-start gap-3 ${showWork ? "xl:grid-cols-[250px_minmax(0,1fr)]" : ""}`}>
        {showWork && (
          <aside aria-label="Work to do" className="rounded-xl border border-line bg-panel xl:sticky xl:top-4">
            <div className="flex items-baseline justify-between border-b border-line px-4 py-3">
              <h2 className="eyebrow">Work to do</h2>
              <span className="font-mono text-xs text-grey">{p.groups.reduce((s, g) => s + g.items.length, 0)} parts</span>
            </div>
            <div className="grid max-h-[70vh] gap-1.5 overflow-y-auto p-2.5 max-xl:max-h-56 max-xl:grid-cols-[repeat(auto-fill,minmax(220px,1fr))]">
              {p.groups.map((g) => (
                <div key={g.projectId} className="contents">
                  <div className="col-span-full px-1 pt-2 font-mono text-[0.7rem] uppercase tracking-wider text-grey">
                    <span className="text-gold">{g.serial}</span> {g.name}{g.note && <span className={g.late ? "text-bad" : ""}> · {g.note}</span>}
                  </div>
                  {g.items.map((it) => (
                    <div key={it.workItemId} role="button" tabIndex={0} aria-label={`${it.part}, ${it.stage}, ${fmtHM(it.hours)}. Drag onto a person.`}
                      onPointerDown={(e) => onDown(e, { kind: "new", item: it, x0: e.clientX, y0: e.clientY, moved: false })}
                      className={`grid touch-none select-none grid-cols-[4px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-lg border border-line2 bg-panel2 py-2 pr-3 ${p.canWrite ? "cursor-grab active:cursor-grabbing" : ""}`}>
                      <i className="h-full min-h-9 rounded-r" style={{ background: g.tone }} />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold">{it.part}</div>
                        <div className="truncate font-mono text-[0.7rem] text-grey">{it.stage}{it.tech ? ` · ${it.tech}` : ""}{it.status === "blocked" ? " · blocked" : ""}</div>
                      </div>
                      <span className="font-mono text-xs">{fmtHM(it.hours)}</span>
                    </div>
                  ))}
                </div>
              ))}
              {!p.groups.length && <p className="col-span-full rounded-lg border border-dashed border-line2 p-4 text-center text-sm text-grey">Nothing waiting. Every open part in this department is on someone&apos;s queue.</p>}
            </div>
          </aside>
        )}

        <section aria-label="Plan" className="min-w-0 overflow-hidden rounded-xl border border-line bg-panel">
          <div ref={scroller} className="overflow-x-auto">
            <div style={{ width: NAME_W + days.length * dayW }}>
              <div className="sticky top-0 z-10 flex border-b border-line bg-panel2">
                <div className="shrink-0 px-3 py-2 font-mono text-[0.7rem] uppercase tracking-wider text-grey" style={{ width: NAME_W }}>Person · hours this week</div>
                {days.map((d) => (
                  <div key={d} className="shrink-0 border-l border-line px-2 py-1.5" style={{ width: dayW }}>
                    <div className={`text-sm font-semibold ${d === p.today ? "text-gold" : ""}`}>{DAY.format(new Date(d))}</div>
                    <div className="relative h-4 font-mono text-[0.65rem] text-grey">
                      {(zoom === "week" ? [0, 4] : Array.from({ length: H }, (_, i) => i)).map((h) => (
                        <span key={h} className="absolute" style={{ left: h * hourPx }}>{zoom === "week" ? String(+atOffset(cal, d, h).slice(11, 13)) : atOffset(cal, d, h).slice(11, 16)}</span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {p.people.map((person, pi) => {
                const heading = p.grouped && person.dept !== p.people[pi - 1]?.dept;
                const cap = p.days.length * H;
                const over = person.laterH > 0;
                const blocked = person.tasks.filter((t) => t.blocked);
                return (
                  <div key={person.id} className="contents">
                  {heading && <div className="sticky left-0 border-b border-line bg-panel3 px-3 py-1.5 font-mono text-[0.7rem] uppercase tracking-wider text-gold" style={{ width: NAME_W + days.length * dayW }}>{person.dept}</div>}
                  <div className="flex border-b border-line last:border-0" style={{ minHeight: 84 }}>
                    <div className="sticky left-0 z-[5] flex shrink-0 items-center gap-2.5 border-r border-line bg-panel px-3" style={{ width: NAME_W }}>
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-bold text-on-colour" style={{ background: person.colour }}>{person.initials}</span>
                      <div className="min-w-0">
                        <div className="truncate font-semibold">{person.name}</div>
                        <div className={`font-mono text-[0.7rem] ${over ? "text-bad" : person.plannedH >= cap ? "text-ok" : "text-grey"}`}>
                          {fmtHM(person.plannedH)} of {cap} h{over ? ` · +${fmtHM(person.laterH)} next week` : ""}
                        </div>
                        {blocked.map((t) => (
                          <button key={t.id} onClick={() => setOpen(t.id)} className="block max-w-full truncate text-left text-[0.7rem] text-bad hover:underline">⛔ {t.title}</button>
                        ))}
                      </div>
                    </div>
                    <div data-lane={person.id} title={p.canWrite ? "Click an empty spot to add a task there" : undefined}
                      onPointerDown={(e) => {
                        if (!p.canWrite || pending || e.target !== e.currentTarget) return;
                        drag.current = { kind: "slot", person: person.id, lane: e.currentTarget, x0: e.clientX, y0: e.clientY, moved: false };
                      }}
                      className={`relative shrink-0 transition-colors ${p.canWrite ? "cursor-copy" : ""}`} style={{
                      width: days.length * dayW,
                      backgroundImage: `repeating-linear-gradient(90deg, transparent 0 ${dayW - 1}px, var(--line) ${dayW - 1}px ${dayW}px), repeating-linear-gradient(90deg, transparent 0 ${hourPx - 1}px, rgba(255,255,255,.035) ${hourPx - 1}px ${hourPx}px)`,
                    }}>
                      {days.map((d, i) => (
                        <i key={d} aria-hidden className="absolute inset-y-0 border-l border-dashed border-line2" style={{ left: i * dayW + offsetH(cal, d, `${d}T${p.calendar.breakStart}`) * hourPx }} />
                      ))}
                      {nowDay >= 0 && <i aria-hidden className="absolute inset-y-0 z-[4] w-0.5 bg-gold shadow-[0_0_10px_rgba(233,190,95,.6)]" style={{ left: xOf(p.now.slice(0, 10), p.now) }} />}
                      {person.tasks.flatMap((t) => t.segments.filter((s) => days.includes(s.date)).map((s, k, arr) => {
                        const left = xOf(s.date, s.start), w = Math.max(10, xOf(s.date, s.end) - left - 3);
                        const last = k === arr.length - 1 && s.day === s.days;
                        const movable = p.canWrite && (t.status === "todo" || t.status === "blocked");
                        const stretchable = p.canWrite && t.status !== "done";
                        const first = s.day === 1;
                        const over = t.overrun && t.plannedEnd && t.plannedEnd < s.end ? Math.max(0, xOf(s.date, s.end) - Math.max(left, xOf(s.date, t.plannedEnd < s.start ? s.start : t.plannedEnd))) : 0;
                        return (
                          <div key={`${t.id}:${s.date}`} role="button" tabIndex={0} aria-label={`${t.title}, ${STATUS_LABEL[t.status]}, ${fmtDT(s.start)} to ${fmtDT(s.end)}`}
                            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setOpen(t.id))}
                            onPointerDown={(e) => {
                              const grip = (e.target as HTMLElement).dataset.grip;
                              if (grip === "end") return onDown(e, { kind: "resize", task: t, el: e.currentTarget, x0: e.clientX, width: w, moved: false });
                              if (grip === "start") return onDown(e, { kind: "start", task: t, person: person.id, el: e.currentTarget, x0: e.clientX, left, width: w, moved: false });
                              if (!movable) { e.preventDefault(); drag.current = { kind: "tap", task: t, x0: e.clientX, y0: e.clientY, moved: false }; return; }
                              onDown(e, { kind: "move", task: t, person: person.id, el: e.currentTarget, x0: e.clientX, y0: e.clientY, left, moved: false });
                            }}
                            className={`group absolute top-2 bottom-2 touch-none select-none overflow-hidden rounded-lg border border-black/30 py-1.5 text-on-colour ${movable && first && w > 34 ? "pl-5" : "pl-2"} ${stretchable && last && w > 22 ? "pr-5" : "pr-2"} ${movable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"} ${statusRing(t)} ${pending ? "opacity-70" : ""}`}
                            style={{ left, width: w, background: t.status === "done" ? "#5d8f68" : t.tone, boxShadow: t.priority === "urgent" ? "inset 0 4px 0 var(--bad)" : undefined }}>
                            <div className="truncate text-[0.8rem] font-bold leading-tight">{t.priority === "urgent" ? "! " : ""}{s.day > 1 ? "↳ " : ""}{t.status === "done" ? "✓ " : ""}{t.title}</div>
                            {w > 70 && <div className="truncate font-mono text-[0.65rem] opacity-80">{t.link ? `${t.link.split(" · ")[0]} · ` : ""}{fmtHM(t.hours)}{s.days > 1 ? ` · day ${s.day}/${s.days}` : ""}</div>}
                            {w > 70 && (t.status === "doing" || t.lateStart) && <div className="mt-0.5 inline-block rounded bg-black/25 px-1 font-mono text-[0.6rem] text-white">{t.status === "doing" ? (t.overrun ? "running over" : "in progress") : "late start"}</div>}
                            {over > 0 && <i aria-hidden className="hatch-overrun absolute inset-y-0 right-0" style={{ width: over }} />}
                            {movable && first && w > 34 && <span data-grip="start" title="Drag to change the start" aria-hidden className={GRIP("left-0")} />}
                            {stretchable && last && w > 22 && <span data-grip="end" title="Drag to change the hours" aria-hidden className={GRIP("right-0")} />}
                          </div>
                        );
                      }))}
                    </div>
                  </div>
                  </div>
                );
              })}
              {!p.people.length && <p className="p-6 text-sm text-grey">Nobody in this department yet. Add people to it in Crew.</p>}
            </div>
          </div>
          {p.canWrite && (
            <div className="flex flex-wrap gap-x-5 gap-y-1 border-t border-line px-4 py-2.5 text-xs text-grey">
              <span><b className="text-ink">Drag</b> a task to another time, day or person</span>
              <span><b className="text-ink">Drag an edge</b>: right changes the hours, left changes the start</span>
              <span><b className="text-ink">Click an empty spot</b> to add a task there</span>
              <span><b className="text-ink">Tap</b> a task for details</span>
              <span>Later tasks move along so nothing overlaps.</span>
            </div>
          )}
        </section>
      </div>

      <AddTaskDrawer open={!!adding} preset={adding ? { personId: adding.person, at: adding.at } : null} onClose={() => setAdding(null)} onDone={say} />

      <div ref={tip} hidden className="pointer-events-none fixed z-[60] rounded bg-ink px-2 py-1 font-mono text-xs text-carbon" />
      {toast && (
        <div role="status" className={`fixed bottom-6 left-1/2 z-[70] max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-lg px-4 py-2.5 text-sm font-bold shadow-2xl ${toast.bad ? "bg-bad text-on-accent" : "bg-ink text-carbon"}`}>{toast.text}</div>
      )}

      <Drawer open={!!task} onClose={() => setOpen(null)} eyebrow={task?.t.link ?? "Workshop task"} title={task?.t.title ?? ""}>
        {task && <Details key={`${task.t.id}:${task.t.version}`} t={task.t} person={personName(task.person)} canWrite={p.canWrite} dayHours={H}
          onDone={(r) => { say(r); if (!r.error) setOpen(null); }} />}
      </Drawer>
    </div>
  );
}

function Details({ t, person, canWrite, onDone, dayHours }: { t: PlanTask; person: string; canWrite: boolean; onDone: (r: { ok?: string; error?: string }) => void; dayHours: number }) {
  const [title, setTitle] = useState(t.title);
  const [hours, setHours] = useState(t.hours);
  const [notes, setNotes] = useState(t.notes);
  const [priority, setPriority] = useState(t.priority);
  const [clearPin, setClearPin] = useState(false);
  const [pending, start] = useTransition();
  const chip = (on: boolean) => `min-h-10 rounded-full border px-3.5 text-sm ${on ? "border-gold bg-gold/10 text-ink" : "border-line2 text-grey hover:text-ink"}`;
  return (
    <div className="grid gap-4">
      <div className="rounded-lg bg-panel2 px-3 py-2.5 font-mono text-sm">
        {person}{t.start && t.end && !t.blocked ? ` · ${fmtDT(t.start)} → ${fmtDT(t.end)}` : t.blocked ? " · blocked: takes no time until it's unblocked" : ""}
        {t.lateStart && <div className="mt-1 text-xs text-warn">Late start: the work before it ran over.</div>}
      </div>
      <label className="grid gap-1"><span className="label">Task</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} disabled={!canWrite} className="min-h-11 rounded-md border border-line2 bg-panel2 px-3 text-ink outline-none focus:border-gold" />
      </label>
      <DurationField hours={hours} onChange={setHours} disabled={!canWrite} dayHours={dayHours} />
      <div className="grid gap-1.5"><span className="label">Status</span>
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
            <button key={s} className={chip(t.status === s)} disabled={!canWrite || pending} onClick={() => s !== t.status && start(async () => onDone(await setQueueStatus(t.id, t.version, s)))}>{STATUS_LABEL[s]}</button>
          ))}
        </div>
        <span className="text-xs text-grey">Status saves straight away.{t.linked ? " It also updates the part on its build." : ""}</span>
      </div>
      <div className="grid gap-1.5"><span className="label">Priority</span>
        <div className="flex gap-1.5">
          <button className={chip(priority === "normal")} disabled={!canWrite} onClick={() => setPriority("normal")}>Normal</button>
          <button className={chip(priority === "urgent")} disabled={!canWrite} onClick={() => setPriority("urgent")}>Urgent</button>
        </div>
      </div>
      <label className="grid gap-1"><span className="label">Notes for the technician</span>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} disabled={!canWrite} placeholder="What to watch out for, materials, who to ask."
          className="rounded-md border border-line2 bg-panel2 px-3 py-2 text-ink outline-none focus:border-gold" />
      </label>
      {t.fixedStart && (
        <label className="flex items-start gap-2.5 text-sm">
          <input type="checkbox" checked={clearPin} onChange={(e) => setClearPin(e.target.checked)} disabled={!canWrite} className="mt-1 h-4 w-4" />
          <span>Start right after the previous task<span className="block text-xs text-grey">It&apos;s set to start no earlier than {fmtDT(t.fixedStart)}.</span></span>
        </label>
      )}
      {canWrite && (
        <div className="flex flex-wrap justify-between gap-2 border-t border-line pt-4">
          <button className={btn.danger} disabled={pending || t.status === "doing"} onClick={() => start(async () => onDone(await removeFromPlan(t.id, t.version)))}>
            {t.linked ? "Back to Work to do" : "Remove"}
          </button>
          <button className={btn.primary} disabled={pending} onClick={() => start(async () => onDone(await savePlanDetails(t.id, t.version, { title, hours, notes, priority, clearPin })))}>
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      )}
    </div>
  );
}
