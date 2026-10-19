"use client";
/**
 * Floor Station (amends AM-14, AM-19; layout 2026-10-15): the one page on the shared workshop iPad, laid out
 * like the TV: every employee one under another, each with the conveyor timeline (now line flush left, the day
 * sliding in). Only the task bars can be tapped. A leaderboard button opens the production departments' boards.
 * Top: live clock, the shift banner (lunch / end-of-shift countdowns) and the day bar with lunch and now.
 * Then tap-to-filter counts (working, over time, waiting for QC, waiting for an admin, free), a name search and
 * department chips. Each person: their current task with a live progress bar that counts down every second and
 * turns red once past its allocated time, a strip of their day, and what is next. Tap a task → Request time
 * extension or Request QC → optional note → Send; then a reminder to message Mr. Diaa on WhatsApp (text only).
 */
import { ThemeButton } from "@/components/theme/theme-button";
import type { ThemeChoice } from "@/lib/theme";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { sendRequest } from "@/app/station/actions";
import { Lockup } from "@/components/ui/logo";
import { banner, conveyorAxis, countdown, liveTone, type LiveTone } from "@/domain/conveyor";
import type { BannerSettings, ConveyorSettings } from "@/domain/settings";

export interface StationTask {
  id: string;
  title: string;
  link: string | null;
  status: "todo" | "doing" | "blocked" | "done";
  active: boolean;
  waitingQc: boolean;
  overrun: boolean;
  window: string;
  allocated: string;
  pending: ("extension" | "qc")[];
  current: boolean;
  start: string | null;
  end: string | null;
  plannedEnd: string | null;
  /** allocated working minutes, and minutes worked when the page loaded (current task only) */
  allocMin: number;
  workedMin: number;
  /** today's part of the task, shop-local [start, end] */
  today: [string, string][];
}
export interface StationPerson {
  id: string; name: string; initials: string; department: string; departmentId: string; colour: string; photoUrl: string | null; tasks: StationTask[];
  /** AM-29: marked absent today, e.g. "Annual leave · back 20 Oct" */
  away?: string | null;
}
interface Day { start: string; end: string; breakStart: string; breakMins: number }
/** One production department's live leaderboard (AM-19 pop-up). */
export interface StationBoard {
  id: string; name: string; emoji: string; colour: string;
  entries: { personId: string; name: string; initials: string; photoUrl: string | null; rank: number | null; score: number | null; badges: string; line: string | null }[];
}

const KIND = { extension: "Request time extension", qc: "Request QC" } as const;
const minOf = (hm: string) => +hm.slice(0, 2) * 60 + +hm.slice(3, 5);
const minOfDT = (dt: string) => minOf(dt.slice(11, 16));
const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(Math.floor(m % 60)).padStart(2, "0")}`;
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const weekday = (date: string) => WEEKDAY[new Date(`${date}T00:00Z`).getUTCDay()];
/** "1h 05m" / "12m" */
const hm = (min: number) => {
  const m = Math.max(0, Math.round(min)), h = Math.floor(m / 60);
  return h ? `${h}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`;
};

type State = "over" | "active" | "qc" | "blocked" | "next" | "free" | "away";
const STATE: Record<State, { label: string; ring: string; pill: string }> = {
  over: { label: "Over time", ring: "var(--bad)", pill: "bg-bad text-on-accent" },
  active: { label: "Working", ring: "var(--ok)", pill: "bg-ok text-on-accent" },
  qc: { label: "Waiting for QC", ring: "var(--cool)", pill: "bg-cool text-on-accent" },
  blocked: { label: "Blocked", ring: "var(--bad)", pill: "border border-bad text-bad" },
  next: { label: "Not started", ring: "var(--line2)", pill: "border border-line2 text-grey" },
  free: { label: "Free", ring: "var(--line2)", pill: "border border-line2 text-grey" },
  away: { label: "On leave", ring: "var(--line2)", pill: "border border-line2 text-grey" },
};
const ORDER: State[] = ["over", "active", "qc", "blocked", "next", "free", "away"];
type Filter = "all" | "working" | "over" | "qc" | "admin" | "free";

export function Station({ people, departments, today, now, workDay, day, banner: bannerCfg, conveyor, boards, period, theme }: {
  people: StationPerson[]; departments: { id: string; name: string }[]; today: string; now: string; workDay: boolean; day: Day; banner: BannerSettings;
  conveyor: ConveyorSettings; boards: StationBoard[]; period: string;
  /** The login's theme (2026-10-17). */
  theme: ThemeChoice;
}) {
  const router = useRouter();
  const [dept, setDept] = useState("all");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<{ person: StationPerson; task: StationTask } | null>(null);
  const [board, setBoard] = useState(false);

  // Shop time = the server's shop-local "now" plus the time passed on this iPad since the page loaded.
  const loadMs = useMemo(() => Date.parse(`${now}:00Z`), [now]);
  const [offset] = useState(() => loadMs - Date.now());
  const [ms, setMs] = useState(loadMs);
  useEffect(() => {
    const tick = setInterval(() => setMs(Date.now() + offset), 1000);
    // Fresh data every 30 s, so new tasks and decisions show without touching the iPad.
    const refresh = setInterval(() => router.refresh(), 30_000);
    return () => { clearInterval(tick); clearInterval(refresh); };
  }, [offset, router]);

  const clock = new Date(ms);
  const isToday = clock.toISOString().slice(0, 10) === today && workDay;
  const nowMin = clock.getUTCHours() * 60 + clock.getUTCMinutes() + clock.getUTCSeconds() / 60;
  const loadMin = minOfDT(now);
  const S = minOf(day.start), E = minOf(day.end), L = minOf(day.breakStart), LE = L + day.breakMins;
  /** Working minutes between two times today (lunch and time outside the shift don't count). */
  const workBetween = (a: number, b: number) =>
    Math.max(0, Math.min(b, E) - Math.max(a, S)) - Math.max(0, Math.min(b, LE, E) - Math.max(a, L, S));
  const sinceLoad = isToday ? workBetween(loadMin, nowMin) : 0;

  const live = (t: StationTask) => {
    const worked = t.current ? t.workedMin + sinceLoad : 0;
    return { worked, left: t.allocMin - worked, share: t.allocMin ? worked / t.allocMin : 0 };
  };
  const stateOf = (p: StationPerson): State => {
    if (p.away) return "away"; // AM-29: on leave today, not free
    const cur = p.tasks.find((t) => t.current && t.status === "doing");
    if (cur) return cur.waitingQc ? "qc" : live(cur).left < 0 ? "over" : "active";
    if (p.tasks.some((t) => t.status === "blocked")) return "blocked";
    return p.tasks.length ? "next" : "free";
  };

  const states = new Map(people.map((p) => [p.id, stateOf(p)]));
  const waitingAdmin = (p: StationPerson) => p.tasks.some((t) => t.pending.length > 0);
  const counts: Record<Filter, number> = {
    all: people.length,
    working: people.filter((p) => ["active", "over", "qc"].includes(states.get(p.id)!)).length,
    over: people.filter((p) => states.get(p.id) === "over").length,
    qc: people.filter((p) => states.get(p.id) === "qc").length,
    admin: people.filter(waitingAdmin).length,
    free: people.filter((p) => states.get(p.id) === "free").length,
  };
  const pass = (p: StationPerson) => {
    const st = states.get(p.id)!;
    return filter === "all" || (filter === "working" && ["active", "over", "qc"].includes(st)) || (filter === "over" && st === "over")
      || (filter === "qc" && st === "qc") || (filter === "admin" && waitingAdmin(p)) || (filter === "free" && st === "free");
  };
  const shown = people
    .filter((p) => (dept === "all" || p.departmentId === dept) && p.name.toLowerCase().includes(q.trim().toLowerCase()) && pass(p))
    .sort((a, b) => ORDER.indexOf(states.get(a.id)!) - ORDER.indexOf(states.get(b.id)!) || a.name.localeCompare(b.name));
  const busy = shown.filter((p) => states.get(p.id) !== "free");
  const free = shown.filter((p) => states.get(p.id) === "free");

  const main = banner(nowMin, { start: S, end: E, breaks: [[L, LE]], isToday }, bannerCfg);
  const bannerView = {
    lunchSoon: main.kind === "lunchSoon" ? { text: "Lunch break", count: `in ${countdown(main.at - nowMin)}`, tone: "border-gold/40 bg-gold/[0.08]", ink: "text-gold" } : null,
    lunch: main.kind === "lunch" ? { text: `Lunch time · back at ${hhmm(LE)}`, count: countdown(main.until - nowMin), tone: "border-warn bg-warn text-on-accent", ink: "" } : null,
    backToIt: main.kind === "backToIt" ? { text: "Lunch time is up, back to it!", count: "", tone: "border-warn/70 bg-warn/15", ink: "" } : null,
    wrapUp: main.kind === "wrapUp" ? { text: `Shift ends at ${day.end}`, count: `in ${countdown(main.at - nowMin)}`, tone: "border-warn/70 bg-warn/15", ink: "text-warn" } : null,
    shiftEnds: main.kind === "shiftEnds" ? { text: `Shift ends at ${day.end}`, count: `in ${countdown(main.at - nowMin)}`, tone: "border-gold/40 bg-gold/[0.08]", ink: "text-gold" } : null,
    idle: null,
  }[main.kind];

  const chips: { key: Filter; label: string; dot: string }[] = [
    { key: "all", label: "Everyone", dot: "bg-ink" },
    { key: "working", label: "Working now", dot: "bg-ok" },
    { key: "over", label: "Over time", dot: "bg-bad" },
    { key: "qc", label: "Waiting for QC", dot: "bg-cool" },
    { key: "admin", label: "Waiting for an admin", dot: "bg-warn" },
    { key: "free", label: "Free", dot: "bg-line2" },
  ];

  return (
    <div className="min-h-dvh bg-carbon pb-10">
      <header className="sticky top-0 z-20 border-b border-line bg-carbon/95 px-4 pb-3 pt-4 backdrop-blur md:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <Lockup height={28} />
            <span className="eyebrow hidden sm:inline">Floor Station</span>
          </div>
          {bannerView && (
            <div className={`order-3 flex min-h-12 w-full items-center justify-between gap-3 rounded-full border px-5 md:order-none md:w-auto md:min-w-[22rem] ${bannerView.tone}`}>
              <span className="text-base font-semibold">{bannerView.text}</span>
              {bannerView.count && <span className={`font-mono text-xl font-semibold tabular-nums ${bannerView.ink}`}>{bannerView.count}</span>}
            </div>
          )}
          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="font-mono text-4xl font-medium leading-none tabular-nums">
                {hhmm(nowMin)}<span className="text-xl text-grey">:{String(clock.getUTCSeconds()).padStart(2, "0")}</span>
              </div>
              <div className="mt-1 font-mono text-xs uppercase tracking-wider text-grey">{weekday(today)} · {+today.slice(8, 10)} {MONTH[+today.slice(5, 7) - 1]}</div>
            </div>
            <button onClick={() => setBoard(true)} aria-label="Leaderboard" title="Leaderboard"
              className="grid h-12 w-12 place-items-center rounded-xl border border-gold/50 bg-gold/10 text-gold">
              <svg viewBox="0 0 20 20" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden><path d="M6 3h8v4a4 4 0 0 1-8 0zM6 5H3v1a3 3 0 0 0 3 3M14 5h3v1a3 3 0 0 1-3 3M10 11v3M7 17h6M8 14h4v3H8z" /></svg>
            </button>
            <ThemeButton saved={theme} compact down />
            <form action="/auth/signout" method="post"><button className="min-h-11 px-2 font-mono text-xs uppercase tracking-widest text-grey">Sign out</button></form>
          </div>
        </div>
        {workDay && <DayBar S={S} E={E} L={L} LE={LE} nowMin={nowMin} isToday={isToday} />}
      </header>

      <div className="grid gap-3 px-4 pt-4 md:px-6">
        <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Show">
          {chips.map((c) => (
            <button key={c.key} onClick={() => setFilter(c.key)} aria-pressed={filter === c.key}
              className={`flex min-h-12 shrink-0 items-center gap-2.5 rounded-xl border px-4 text-left ${filter === c.key ? "border-gold bg-gold/10" : "border-line2 bg-panel"}`}>
              <i className={`h-2.5 w-2.5 rounded-full ${c.dot}`} />
              <b className="font-mono text-xl tabular-nums">{counts[c.key]}</b>
              <span className="text-sm text-grey">{c.label}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name" aria-label="Search by name"
            className="min-h-12 min-w-[14rem] flex-1 rounded-xl border border-line2 bg-panel2 px-4 text-lg text-ink outline-none focus:border-gold" />
          <div className="flex gap-2 overflow-x-auto" role="group" aria-label="Department">
            {[{ id: "all", name: "All departments" }, ...departments].map((d) => (
              <button key={d.id} onClick={() => setDept(d.id)} aria-pressed={dept === d.id}
                className={`min-h-12 shrink-0 rounded-xl border px-4 text-base ${dept === d.id ? "border-gold bg-gold/10 text-ink" : "border-line2 text-grey"}`}>{d.name}</button>
            ))}
          </div>
        </div>
      </div>

      <Conveyor people={[...busy, ...free]} states={states} live={live} conveyor={conveyor} today={today} isToday={isToday}
        day={{ S, E, L, LE }} nowMin={nowMin} onTask={(person, task) => setOpen({ person, task })} />
      {!shown.length && <p className="p-8 text-center text-grey">Nobody matches.</p>}

      {board && <BoardPopup boards={boards} period={period} onClose={() => setBoard(false)} />}
      {open && <RequestSheet key={open.task.id} person={open.person} task={open.task} live={live(open.task)}
        onClose={() => { setOpen(null); router.refresh(); }} />}
    </div>
  );
}

/** The shift as a bar: worked part filled, lunch in orange, hour ticks, the now marker. */
function DayBar({ S, E, L, LE, nowMin, isToday }: { S: number; E: number; L: number; LE: number; nowMin: number; isToday: boolean }) {
  const pct = (m: number) => `${(Math.min(Math.max(m, S), E) - S) / (E - S) * 100}%`;
  const hours: number[] = [];
  for (let m = Math.ceil(S / 60) * 60; m <= E; m += 60) hours.push(m);
  return (
    <div className="mt-3" aria-hidden>
      <div className="relative h-3 overflow-hidden rounded-full bg-panel2">
        {isToday && <div className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-[#b8913c] to-gold transition-[width] duration-1000 ease-linear" style={{ width: pct(nowMin) }} />}
        <div className="absolute inset-y-0 bg-warn/60" style={{ left: pct(L), width: `calc(${pct(LE)} - ${pct(L)})` }} />
      </div>
      <div className="relative mt-1 h-4 font-mono text-[0.7rem] text-grey">
        {hours.map((m, i) => (
          <span key={m} className={`absolute ${i === 0 ? "" : i === hours.length - 1 ? "-translate-x-full" : "-translate-x-1/2"}`} style={{ left: pct(m) }}>{hhmm(m)}</span>
        ))}
        <span className="absolute -translate-x-1/2 text-warn" style={{ left: `calc((${pct(L)} + ${pct(LE)}) / 2)` }}>lunch</span>
      </div>
    </div>
  );
}

function Face({ p, size, ring }: { p: StationPerson; size: number; ring: string }) {
  return (
    <span className="grid shrink-0 place-items-center rounded-full p-[3px]" style={{ width: size, height: size, background: ring }}>
      {p.photoUrl
        // eslint-disable-next-line @next/next/no-img-element -- signed Storage URL, short-lived
        ? <img src={p.photoUrl} alt="" className="h-full w-full rounded-full object-cover" />
        : <span className="grid h-full w-full place-items-center rounded-full font-bold text-on-colour" style={{ background: p.colour, fontSize: size * 0.38 }}>{p.initials}</span>}
    </span>
  );
}

/** "14:04", or "Wed 11:04" when not today. */
function when(dt: string | null, today: string) {
  if (!dt) return "";
  return dt.slice(0, 10) === today ? dt.slice(11, 16) : `${weekday(dt.slice(0, 10))} ${dt.slice(11, 16)}`;
}

function RequestSheet({ person, task, live, onClose }: { person: StationPerson; task: StationTask; live: { worked: number; left: number }; onClose: () => void }) {
  const [kind, setKind] = useState<"extension" | "qc" | null>(null);
  const [notes, setNotes] = useState("");
  const [result, setResult] = useState<{ ok?: string; error?: string } | null>(null);
  const [pending, start] = useTransition();
  const big = "min-h-16 w-full rounded-xl border px-5 text-left text-lg";
  return (
    <div role="dialog" aria-modal="true" aria-label={`${task.title} · ${person.name}`} className="fixed inset-0 z-50 grid place-items-end bg-black/70 md:place-items-center" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="grid w-full max-w-xl gap-4 rounded-t-2xl border border-line2 bg-panel3 p-5 md:rounded-2xl">
        <header className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Face p={person} size={48} ring="var(--line2)" />
            <div className="min-w-0">
              <div className="text-sm text-grey">{person.name}</div>
              <div className="text-xl font-semibold leading-snug">{task.title}</div>
              {task.link && <div className="truncate text-sm text-grey">{task.link}</div>}
              <div className="mt-1 font-mono text-sm text-grey">
                {task.allocated} allocated{task.current ? ` · ${live.left < 0 ? `${hm(-live.left)} over` : `${hm(live.left)} left`}` : ""}
              </div>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="grid h-12 w-12 shrink-0 place-items-center rounded-lg text-2xl text-grey">✕</button>
        </header>

        {result?.ok ? (
          <div className="grid gap-4">
            <p className="rounded-xl border border-ok bg-ok/10 p-4 text-lg">{result.ok} An admin will see it on the Requests page.</p>
            <p className="rounded-xl border border-warn bg-warn/10 p-4 text-lg">Don&apos;t forget to also send Mr. Diaa a message on WhatsApp.</p>
            <button className={`${big} border-gold bg-gold text-center font-semibold text-on-accent`} onClick={onClose}>Done</button>
          </div>
        ) : !kind ? (
          <div className="grid gap-3">
            {(["extension", "qc"] as const).map((k) => (
              <button key={k} className={`${big} flex items-center gap-4 border-line2 bg-panel2 disabled:opacity-50`} disabled={task.pending.includes(k)} onClick={() => setKind(k)}>
                <span aria-hidden className={`grid h-10 w-10 shrink-0 place-items-center rounded-full font-mono text-lg font-bold text-on-accent ${k === "qc" ? "bg-cool" : "bg-warn"}`}>{k === "qc" ? "✓" : "+"}</span>
                <span>
                  {KIND[k]}
                  <span className="block text-sm text-grey">{k === "qc" ? "The work is finished and ready to be checked." : "The task needs more time than it was given."}</span>
                  {task.pending.includes(k) && <span className="block text-sm text-warn">Already sent, waiting for an admin</span>}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="grid gap-3">
            <div className="font-semibold">{KIND[kind]}</div>
            <label className="grid gap-1">
              <span className="text-sm text-grey">Notes (optional)</span>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} maxLength={1000}
                className="w-full rounded-xl border border-line2 bg-panel2 p-3 text-lg text-ink outline-none focus:border-gold" />
            </label>
            {result?.error && <p role="alert" className="text-bad">{result.error}</p>}
            <div className="grid grid-cols-2 gap-3">
              <button className={`${big} border-line2 text-center`} onClick={() => { setKind(null); setResult(null); }}>Back</button>
              <button className={`${big} border-gold bg-gold text-center font-semibold text-on-accent disabled:opacity-60`} disabled={pending}
                onClick={() => start(async () => setResult(await sendRequest(task.id, kind, notes)))}>{pending ? "Sending…" : "Send"}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const BAR: Record<LiveTone, string> = {
  ok: "bg-ok border-[#7cc28e] text-on-accent",
  over: "bg-bad border-[#f29a8f] text-on-accent",
  todo: "bg-[var(--task-todo)] border-[var(--task-todo-line)] text-ink",
  qc: "bg-cool border-[#a6c5de] text-on-accent",
  done: "bg-[var(--task-done)] border-[var(--task-done-line)] text-[var(--task-done-ink)] opacity-60",
  blocked: "bg-[var(--task-blocked)] border-bad text-ink",
};

/** Every person as a TV-style row (AM-19): the conveyor with the now line flush left; only task bars respond. */
function Conveyor({ people, states, live, conveyor, today, isToday, day, nowMin, onTask }: {
  people: StationPerson[]; states: Map<string, State>; live: (t: StationTask) => { worked: number; left: number; share: number };
  conveyor: ConveyorSettings; today: string; isToday: boolean; day: { S: number; E: number; L: number; LE: number }; nowMin: number;
  onTask: (p: StationPerson, t: StationTask) => void;
}) {
  const { S, E, L, LE } = day;
  const ax = conveyorAxis(isToday ? nowMin : S, conveyor);
  const pct = (m: number) => `${ax.at(m) * 100}%`;
  const span = ax.to - ax.from;
  const slide = "left 1s linear, width 1s linear";
  if (!people.length) return null;
  return (
    <section className="mx-4 mt-4 grid gap-2 md:mx-6" aria-label="Employees">
      <div className="grid grid-cols-[13rem_minmax(0,1fr)] gap-3 px-3 md:grid-cols-[16rem_minmax(0,1fr)]">
        <span />
        <div className="relative h-5 overflow-hidden font-mono text-xs text-grey" aria-hidden>
          {isToday && <span className="absolute left-0 font-semibold text-gold">now</span>}
          {ax.hours.filter((m) => ax.at(m) > 0.05 && ax.at(m) < 0.97).map((m) => (
            <span key={m} className="absolute -translate-x-1/2" style={{ left: pct(m), transition: "left 1s linear" }}>{hhmm(m)}</span>
          ))}
        </div>
      </div>
      {people.map((p) => {
        const st = states.get(p.id)!;
        const cur = p.tasks.find((t) => t.current && t.status === "doing");
        const next = p.tasks.find((t) => !t.current && t.status !== "done" && t.status !== "blocked");
        const status = cur
          ? cur.waitingQc ? <span className="text-cool">Waiting for QC · {cur.title}</span>
            : live(cur).left < 0 ? <span className="text-bad">Over {hm(-live(cur).left)} · {cur.title}</span>
            : <span className="text-ok">{hm(live(cur).left)} left · {cur.title}</span>
          : st === "blocked" ? <span className="text-bad">Blocked</span>
          : next ? <span>Next: {when(next.start, today)}</span> : <span>Free</span>;
        // Bars: today's part of each task; the running task reaches at least now (a tab on the line when over).
        const bars = p.tasks.flatMap((t) => t.today.map(([a0, b0], i) => {
          const a = minOfDT(a0), b = t === cur && isToday ? Math.max(minOfDT(b0), nowMin) : minOfDT(b0);
          const tone = liveTone({ status: t.status, qc: t.waitingQc }, nowMin, t === cur ? (live(t).left < 0 ? nowMin - 1 : nowMin + live(t).left) : null);
          return { t, a, b, tone, k: `${t.id}:${i}` };
        })).filter((x) => (x.b > ax.from || (x.t === cur && x.b >= ax.from - 1)) && x.a < ax.to);
        return (
          <div key={p.id} className={`grid grid-cols-[13rem_minmax(0,1fr)] items-stretch gap-3 rounded-xl border bg-panel px-3 py-2 md:grid-cols-[16rem_minmax(0,1fr)] ${st === "over" ? "border-bad/60" : "border-line"} ${p.away ? "opacity-50 grayscale" : ""}`}>
            <div className="flex min-w-0 items-center gap-3">
              <Face p={p} size={46} ring={STATE[st].ring} />
              <div className="min-w-0">
                <div className="truncate text-lg font-semibold leading-tight">{p.name}</div>
                <div className="truncate text-xs text-grey">{p.department}</div>
                <div className="truncate font-mono text-xs text-grey">{p.away ?? status}</div>
              </div>
            </div>
            <div className="relative min-h-[4.25rem] overflow-hidden rounded-lg bg-[var(--track)]">
              {ax.hours.map((m) => <i key={m} aria-hidden className="absolute inset-y-0 w-px bg-[var(--track-line)]" style={{ left: pct(m), transition: slide }} />)}
              {E < ax.to && <div aria-hidden className="absolute inset-y-0 right-0 bg-[var(--after-shift)]" style={{ left: pct(E), transition: slide }} />}
              {LE > ax.from && L < ax.to && (
                <div aria-hidden className="absolute inset-y-0 border-x border-warn/60 bg-warn/20" style={{ left: pct(L), width: `calc(${pct(LE)} - ${pct(L)})`, transition: slide }} />
              )}
              {bars.map(({ t, a, b, tone, k }, _i, all) => {
                const stub = b - Math.max(a, ax.from) < span * 0.01;
                // A bar starting at the now line moves over to make room for an over-time tab there.
                const shift = !stub && a <= ax.from + 1 && all.some((x) => x.b - Math.max(x.a, ax.from) < span * 0.01) ? "1.3rem" : "0px";
                const roomy = Math.min(b, ax.to) - Math.max(a, ax.from) >= span * 0.12;
                return (
                  <button key={k} onClick={() => onTask(p, t)} aria-label={`${t.title}, ${p.name}. Request more time or QC.`}
                    className={`absolute inset-y-1.5 overflow-hidden rounded-md border px-2 text-left active:brightness-110 ${stub ? "z-[2]" : ""} ${BAR[tone]}`}
                    style={stub ? { left: 0, width: "1.1rem" } : { left: `calc(${pct(a)} + 2px + ${shift})`, width: `max(1.2rem, calc(${pct(b)} - ${pct(a)} - 4px - ${shift}))`, transition: `${slide}, background-color .7s` }}>
                    {roomy && !stub && <>
                      <span className="block truncate text-sm font-semibold leading-tight">{t.title}</span>
                      <span className="block truncate font-mono text-[0.7rem] opacity-80">{t === cur ? (t.waitingQc ? "waiting for QC" : live(t).left < 0 ? `over ${hm(-live(t).left)}` : `${hm(live(t).left)} left`) : `${t.start ? when(t.start, today) : ""} · ${t.allocated}`}</span>
                    </>}
                  </button>
                );
              })}
              {!bars.length && <span className="absolute inset-0 grid place-items-center text-sm text-grey">{st === "away" ? p.away : st === "free" ? "No tasks left today" : "Nothing on the clock in this window"}</span>}
              {isToday && <i aria-hidden className="absolute inset-y-0 left-0 z-[3] w-[3px] rounded bg-gold shadow-[0_0_10px_rgba(233,190,95,.8)]" />}
            </div>
          </div>
        );
      })}
    </section>
  );
}

/** The live leaderboard of every production department, grouped by department (AM-19). */
function BoardPopup({ boards, period, onClose }: { boards: StationBoard[]; period: string; onClose: () => void }) {
  const MEDAL = ["🥇", "🥈", "🥉"];
  return (
    <div role="dialog" aria-modal="true" aria-label="Leaderboard" className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="grid max-h-[90dvh] w-full max-w-4xl grid-rows-[auto_minmax(0,1fr)_auto] gap-4 rounded-2xl border border-line2 bg-panel3 p-5">
        <header className="flex items-center justify-between gap-3">
          <div>
            <div className="display text-xl tracking-[0.12em] text-gold">Leaderboard</div>
            <div className="font-mono text-xs text-grey">Production departments · {period}</div>
          </div>
          <button onClick={onClose} aria-label="Close" className="grid h-12 w-12 place-items-center rounded-lg text-2xl text-grey">✕</button>
        </header>
        <div className="grid gap-4 overflow-y-auto md:grid-cols-2">
          {boards.map((d) => (
            <section key={d.id} className="grid content-start gap-2 rounded-xl border border-line bg-panel p-3">
              <h3 className="flex items-center gap-2 font-semibold"><span className="h-3 w-1.5 rounded-full" style={{ background: d.colour }} />{d.emoji} {d.name}</h3>
              {!d.entries.length && <p className="text-sm text-grey">No finished work yet.</p>}
              {d.entries.map((e) => (
                <div key={e.personId} className="grid grid-cols-[2.2rem_minmax(0,1fr)_auto] items-center gap-2 rounded-lg bg-panel2 px-2 py-1.5">
                  <span className="text-center text-xl">{e.rank !== null ? MEDAL[e.rank - 1] ?? <span className="font-mono text-sm text-grey">{e.rank}</span> : "🐢"}</span>
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{e.name} <span className="font-normal">{e.badges}</span></span>
                    {e.line && <span className="block truncate text-xs text-grey">{e.line}</span>}
                  </span>
                  <span className="font-mono text-lg font-semibold text-gold">{e.score ?? ""}</span>
                </div>
              ))}
            </section>
          ))}
          {!boards.length && <p className="text-grey">No production departments yet.</p>}
        </div>
        <button onClick={onClose} className="min-h-14 rounded-xl border border-gold bg-gold text-lg font-semibold text-on-accent">Close</button>
      </div>
    </div>
  );
}
