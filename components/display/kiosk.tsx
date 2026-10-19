"use client";
/**
 * Shop-floor TV v2 (docs/ROADMAP.md v1.5, approved sketch). View-only: no buttons, cursor hidden.
 * Header: department · banner (AM-17: countdowns, now and then a quote or notice) · big clock. Body: one card
 * per person with a progress ring and their day on a conveyor (AM-16): the now line stays put after the names
 * and the day slides into it; leaderboard at the side.
 * Sizes are rem on a root that scales with the screen (1080p → 20px), so the layout fits any TV.
 * Updates: realtime "changed" ping → refetch; polling fallback; keeps the last good data while reconnecting.
 */
import confetti from "canvas-confetti";
import { useCallback, useEffect, useRef, useState } from "react";
import { banner, conveyorAxis, countdown, liveTone, nowShare, quoteTurn, type LiveTone } from "@/domain/conveyor";
import type { DisplaySnapshot } from "@/domain/display";
import { createClient } from "@/lib/supabase/browser";

const POLL_MS = 10_000;
const STALE_MS = 120_000;
const ROTATE = { day: 40_000, board: 20_000 };
const PERIOD_LABEL = { today: "today", week: "this week", month: "this month", "7d": "last 7 days" } as const;

const toMin = (dt: string) => Date.parse(`${dt.slice(0, 16)}:00Z`) / 60_000;
const fromMin = (m: number) => new Date(m * 60_000).toISOString().slice(0, 16);
const hhmm = (dt: string) => dt.slice(11, 16);
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const longDate = (dt: string) => {
  const d = new Date(`${dt.slice(0, 10)}T00:00Z`);
  return `${DAYS[d.getUTCDay()]} · ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
};
const dur = (min: number) => {
  const m = Math.max(0, Math.round(min)), h = Math.floor(m / 60), r = m % 60;
  return h ? `${h} h ${String(r).padStart(2, "0")} min` : `${r} min`;
};
const MEDAL = ["🥇", "🥈", "🥉"];

type Row = DisplaySnapshot["rows"][number];

/** Minutes of work between a and b (breaks don't count). */
function workMin(s: DisplaySnapshot, a: number, b: number) {
  let m = Math.max(0, b - a);
  for (const [x, y] of s.day.breaks) m -= Math.max(0, Math.min(b, toMin(y)) - Math.max(a, toMin(x)));
  return m;
}

function Avatar({ name, initials, url, size, ring, colour = "var(--gold)" }: { name: string; initials: string; url: string | null; size: string; ring?: number; colour?: string }) {
  const face = url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="" className="h-full w-full rounded-full object-cover" />
  ) : (
    <span aria-label={name} className="grid h-full w-full place-items-center rounded-full font-bold" style={{ background: ring === undefined ? colour : "#2d2d2d", color: ring === undefined ? "var(--carbon)" : "var(--gold)", fontSize: `calc(${size} * 0.4)` }}>{initials}</span>
  );
  if (ring === undefined) return <span className="block shrink-0" style={{ width: size, height: size }}>{face}</span>;
  return (
    <span className="block shrink-0 rounded-full p-[0.2rem]" style={{ width: size, height: size, background: `conic-gradient(var(--gold) ${Math.round(ring * 100)}%, #3a3a3a 0)` }}>{face}</span>
  );
}

/** TV tones (AM-16): green within time, red over, grey not started, blue waiting for QC, faded done. */
const TV_TONE: Record<LiveTone, string> = {
  ok: "bg-ok border-[#7cc28e] text-on-accent shadow-[0_0.3rem_1.2rem_rgba(92,169,111,.3)]",
  over: "bg-bad border-[#f29a8f] text-on-accent shadow-[0_0.3rem_1.2rem_rgba(232,120,107,.3)]",
  todo: "bg-[#343434] border-[#444] text-ink",
  qc: "bg-cool border-[#a6c5de] text-on-accent",
  done: "bg-[#2a3a2f] border-[#35503d] text-[#a8d8b5] opacity-60",
  blocked: "bg-[#3a2422] border-bad text-ink",
};

function PersonCard({ s, r, nowMin, height }: { s: DisplaySnapshot; r: Row; nowMin: number; height: string }) {
  const t0 = toMin(s.day.start), t1 = toMin(s.day.end);
  // Conveyor: the window starts a little before now; on a day that isn't today it starts at the shift start.
  const anchor = s.day.isToday ? nowMin : t0;
  const ax = conveyorAxis(anchor, s.conveyor);
  const pct = (m: number) => `${ax.at(m) * 100}%`;
  const span = ax.to - ax.from;
  const total = r.items.reduce((acc, it) => acc + workMin(s, toMin(it.start), toMin(it.end)), 0);
  const done = r.items.reduce((acc, it) => acc + (it.status === "done" ? workMin(s, toMin(it.start), toMin(it.end)) : it.status === "doing" ? workMin(s, toMin(it.start), Math.min(nowMin, toMin(it.end))) : 0), 0);
  const cur = r.items.find((it) => it.current);
  const next = r.items.find((it) => it.status !== "done" && !it.current && toMin(it.start) >= nowMin);
  const slide = "left 1s linear, width 1s linear";
  /** How far into a box (in %) the now line sits, so its text starts after the line. */
  const idleInset = (until: string, start = t0) => {
    const a = Math.max(start, ax.from), b = toMin(until);
    return s.day.isToday && nowMin > a ? ((ax.at(Math.min(nowMin, b)) - ax.at(a)) / Math.max(0.0001, ax.at(b) - ax.at(a))) * 100 : 0;
  };
  return (
    <div className={`grid grid-cols-[14rem_minmax(0,1fr)] items-center gap-[1rem] rounded-[1.1rem] border border-line bg-panel px-[1rem] py-[0.8rem] shadow-[0_2px_0_rgba(0,0,0,.25)] ${r.away ? "opacity-50 grayscale" : ""}`} style={{ height }}>
      <div className="flex min-w-0 items-center gap-[0.9rem]">
        <Avatar name={r.name} initials={r.initials} url={r.photoUrl} size="3.8rem" ring={total ? done / total : 0} />
        <div className="min-w-0">
          <div className="truncate text-[1.5rem] font-semibold leading-tight">{r.name}</div>
          {r.away ? <div className="truncate font-mono text-[0.85rem] text-grey">{r.away}</div>
            : r.blocked.length > 0
            ? <div className="line-clamp-2 font-mono text-[0.85rem] leading-snug text-bad">⛔ {r.blocked.map((b) => b.title).join(", ")}</div>
            : <div className="truncate font-mono text-[0.85rem] text-grey">{cur ? <>{cur.overrunFrom && !cur.qc ? <span className="text-bad">Over {dur(nowMin - toMin(cur.overrunFrom))} · </span> : cur.qc ? <span className="text-cool">Waiting for QC · </span> : null}On {cur.title}</> : next ? `Next: ${hhmm(next.start)}` : r.items.some((i) => i.status !== "done") ? "Next: later" : "Free"}</div>}
        </div>
      </div>
      <div className="relative h-full min-h-[3.5rem] overflow-hidden rounded-[0.7rem] bg-[#1f1f1f]">
        {ax.hours.map((m) => <i key={m} className="absolute inset-y-0 w-px bg-[#2a2a2a]" style={{ left: pct(m), transition: slide }} />)}
        {t1 < ax.to && (
          <div className="absolute inset-y-0 right-0 flex items-center bg-black/40 pl-[1rem] font-mono text-[0.85rem] text-[#6c6c6c]" style={{ left: pct(t1), transition: slide }}>
            {ax.to - t1 > span * 0.2 ? `shift ends ${hhmm(s.day.end)}` : ""}
          </div>
        )}
        {s.day.breaks.filter(([a, b]) => toMin(b) > ax.from && toMin(a) < ax.to).map(([a, b]) => (
          <div key={a} className={`absolute inset-y-0 z-[1] flex items-start ${idleInset(b, toMin(a)) > 0 ? "justify-start" : "justify-center"} overflow-hidden border-x border-warn/60 bg-warn/25 pt-[0.2rem] font-mono text-[0.75rem] uppercase tracking-[0.15em] text-warn`}
            style={{ left: pct(toMin(a)), width: `calc(${pct(toMin(b))} - ${pct(toMin(a))})`, transition: slide }}>
            <span style={idleInset(b, toMin(a)) > 0 ? { paddingLeft: `calc(${idleInset(b, toMin(a))}% + 0.6rem)` } : undefined}>Lunch</span>
          </div>
        ))}
        {r.items.map((it) => {
          const a = toMin(it.start), b = it.current ? Math.max(toMin(it.end), nowMin) : toMin(it.end);
          // A task still running past its time ends at now: keep it visible as a tab on the now line.
          if (it.current && b <= ax.from + 1 && a < ax.to) {
            const tone = liveTone({ status: it.status, qc: it.qc }, nowMin, it.overrunFrom ? toMin(it.overrunFrom) : toMin(it.end));
            return <div key={`${it.id}-${it.start}`} className={`absolute inset-y-[0.5rem] left-0 z-[2] w-[0.9rem] rounded-r-[0.5rem] border ${TV_TONE[tone]}`} />;
          }
          if (b <= ax.from || a >= ax.to) return null;
          const tone = liveTone({ status: it.status, qc: it.qc }, nowMin, it.current ? (it.overrunFrom ? toMin(it.overrunFrom) : toMin(it.end)) : null);
          // Text starts at the now line (nothing hides under it) and only where there is room (ME-02: a sliver
          // of a bar shows no text rather than a squashed letter).
          const from = s.day.isToday ? Math.max(a, nowMin) : Math.max(a, ax.from);
          const roomy = Math.min(b, ax.to) - from >= span * 0.13;
          const inset = ((ax.at(from) - ax.at(a)) / Math.max(0.0001, ax.at(b) - ax.at(a))) * 100;
          return (
            <div key={`${it.id}-${it.start}`} className={`absolute inset-y-[0.5rem] overflow-hidden rounded-[0.6rem] border px-[0.8rem] py-[0.5rem] ${TV_TONE[tone]}`}
              style={{ left: `calc(${pct(a)} + 0.15rem)`, width: `calc(${pct(b)} - ${pct(a)} - 0.3rem)`, boxShadow: it.urgent ? "inset 0 0.25rem 0 var(--bad)" : undefined, transition: `${slide}, background-color .7s` }}>
              {roomy && <div className="relative" style={{ marginLeft: inset ? `calc(${inset}% + 0.4rem)` : undefined }}>
                <div className="relative truncate text-[1.2rem] font-semibold leading-tight">{tone === "done" ? "✓ " : ""}{it.urgent ? "! " : ""}{it.title}{it.continues ? " →" : ""}</div>
                {tone === "qc" ? (
                  <span className="relative mt-[0.3rem] inline-block max-w-full truncate whitespace-nowrap rounded-full bg-black/15 px-[0.5rem] py-[0.1rem] font-mono text-[0.8rem] font-semibold align-top">waiting for QC</span>
                ) : it.current ? (
                  <span className="relative mt-[0.3rem] inline-block max-w-full truncate whitespace-nowrap rounded-full bg-black/15 px-[0.5rem] py-[0.1rem] font-mono text-[0.8rem] font-semibold align-top">
                    {tone === "over" ? `over by ${dur(nowMin - (it.overrunFrom ? toMin(it.overrunFrom) : toMin(it.end)))}` : `${dur(workMin(s, nowMin, b))} left`}
                  </span>
                ) : (
                  <div className={`relative truncate font-mono text-[0.8rem] ${tone === "done" ? "" : "text-grey"}`}>
                    {[it.link?.split(" · ").slice(0, 2).join(" · "), it.duration, it.dayLabel, it.lateStart ? "late start" : null].filter(Boolean).join(" · ")}
                  </div>
                )}
              </div>}
            </div>
          );
        })}
        {r.more > 0 && (
          <span className="absolute right-[0.4rem] top-[0.4rem] z-[4] rounded-full border border-gold/60 bg-carbon/85 px-[0.5rem] font-mono text-[0.8rem] text-gold">+{r.more} later</span>
        )}
        {s.day.isToday && <div className={`absolute inset-y-0 z-[3] w-[0.2rem] rounded bg-gold shadow-[0_0_0.8rem_rgba(233,190,95,.7)] ${nowShare(s.conveyor) > 0 ? "-translate-x-1/2" : ""}`} style={{ left: `${nowShare(s.conveyor) * 100}%` }} />}
      </div>
    </div>
  );
}

function DayView({ s, nowMin }: { s: DisplaySnapshot; nowMin: number }) {
  const ax = conveyorAxis(s.day.isToday ? nowMin : toMin(s.day.start), s.conveyor);
  if (!s.rows.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-[0.8rem] rounded-[1.1rem] border border-dashed border-line2 text-center">
        <span className="text-[3.5rem]">{s.department?.emoji || "🛠️"}</span>
        <p className="text-[1.6rem]">Nobody is assigned to {s.department?.name ?? "this department"} yet.</p>
        <p className="max-w-[36rem] text-[1.1rem] text-grey">Add people to the department under Crew in the Build Tracker. Their plan for the day appears here.</p>
      </div>
    );
  }
  const n = s.rows.length;
  const height = `min(9.5rem, calc((100% - 2rem - ${(n - 1) * 0.8}rem) / ${n}))`;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-[0.5rem] grid grid-cols-[14rem_minmax(0,1fr)] gap-[1rem] px-[1rem]">
        <div />
        <div className="relative h-[1.2rem] overflow-hidden font-mono text-[0.85rem] text-[#6c6c6c]">
          {ax.hours.filter((m) => ax.at(m) > 0.03 && ax.at(m) < 0.97 && (!s.day.isToday || Math.abs(ax.at(m) - nowShare(s.conveyor)) > 0.06)).map((m) => (
            <span key={m} className="absolute -translate-x-1/2" style={{ left: `${ax.at(m) * 100}%`, transition: "left 1s linear" }}>{fromMin(m).slice(11, 16)}</span>
          ))}
          {s.day.isToday && <span className={`absolute font-semibold text-gold ${nowShare(s.conveyor) > 0 ? "-translate-x-1/2" : ""}`} style={{ left: `${nowShare(s.conveyor) * 100}%` }}>now</span>}
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-[0.8rem]">
        {s.rows.map((r) => <PersonCard key={r.personId} s={s} r={r} nowMin={nowMin} height={height} />)}
      </div>
    </div>
  );
}

function Leaderboard({ s, wide }: { s: DisplaySnapshot; wide: boolean }) {
  const ranked = s.leaderboard.entries.filter((e) => e.rank !== null);
  const warming = s.leaderboard.entries.filter((e) => e.rank === null);
  return (
    <div className="flex h-full min-h-0 flex-col rounded-[1.1rem] border border-line bg-panel px-[1.2rem] py-[1.1rem]">
      <div className="mb-[0.8rem] flex items-baseline justify-between">
        <span className="display text-[1rem] tracking-[0.2em] text-gold">Leaderboard</span>
        <span className="font-mono text-[0.8rem] text-grey">{PERIOD_LABEL[s.leaderboard.period]}</span>
      </div>
      <div className={`grid min-h-0 gap-[0.6rem] overflow-hidden ${wide ? "grid-cols-2" : ""}`}>
        {ranked.slice(0, wide ? 8 : 4).map((e, i) => (
          <div key={e.personId} className="grid grid-cols-[2.6rem_3.2rem_minmax(0,1fr)_auto] items-center gap-[0.7rem] rounded-[0.8rem] border px-[0.8rem] py-[0.6rem]"
            style={i === 0 ? { background: "linear-gradient(135deg,#3b321c,#2b2b2b 70%)", borderColor: "#6d5a2a" } : { background: "var(--panel2)", borderColor: "var(--line2)" }}>
            <span className="text-center text-[2rem] leading-none">{MEDAL[i] ?? <span className="font-mono text-[1.1rem] text-grey">{e.rank}</span>}</span>
            <Avatar name={e.name} initials={e.initials} url={e.photoUrl} size="3.2rem" />
            <div className="min-w-0">
              <div className="truncate text-[1.35rem] font-semibold leading-tight">{e.name}</div>
              <div className="truncate text-[1.2rem] tracking-[0.1em]" title={e.badges.map((b) => b.name).join(", ")}>{e.badges.map((b) => b.emoji).join("")}</div>
              {e.line && wide && <div className="truncate text-[0.85rem] text-grey">{e.line}</div>}
            </div>
            <span className="font-mono text-[1.8rem] font-semibold text-gold">{e.score}</span>
          </div>
        ))}
      </div>
      {warming.length > 0 && (
        <div className="mt-[0.6rem] grid gap-[0.4rem]">
          {warming.slice(0, ranked.length ? 2 : 4).map((e) => (
            <div key={e.personId} className="rounded-[0.8rem] border border-dashed border-line2 px-[0.8rem] py-[0.5rem]">
              <div className="truncate text-[1.1rem] font-semibold">{e.badges.map((b) => b.emoji).join("") || "🐢"} {e.name}</div>
              {e.line && <div className="truncate text-[0.9rem] text-grey">{e.line}</div>}
            </div>
          ))}
        </div>
      )}
      {!s.leaderboard.entries.length && <p className="text-[1.1rem] text-grey">No finished work yet {PERIOD_LABEL[s.leaderboard.period]}.</p>}
      <div className="mt-[0.8rem] border-t border-line pt-[0.8rem]">
        <div className="display mb-[0.5rem] text-[0.75rem] tracking-[0.2em] text-grey">Finished today ✅</div>
        {s.finishedToday.slice(0, wide ? 6 : 3).map((f, i) => (
          <div key={i} className="flex items-baseline gap-[0.5rem] text-[1rem] leading-relaxed">
            <span className="text-ok">✓</span><b className="font-semibold">{f.name}</b><span className="min-w-0 flex-1 truncate">{f.title}</span><span className="font-mono text-[0.8rem] text-[#6c6c6c]">{hhmm(f.at)}</span>
          </div>
        ))}
        {!s.finishedToday.length && <p className="text-[1rem] text-grey">The first finishes of the day show here.</p>}
      </div>
      <div className="mt-auto grid grid-cols-3 gap-[0.5rem] pt-[0.8rem]">
        {[[String(s.week.finished), "finished this week"], [s.week.onTimePct === null ? "—" : `${s.week.onTimePct}%`, "on time"], [String(s.week.bestStreak), "day streak 🔥"]].map(([v, l]) => (
          <div key={l} className="rounded-[0.7rem] border border-line2 bg-panel2 px-[0.6rem] py-[0.5rem]">
            <div className="font-mono text-[1.5rem] font-semibold leading-tight">{v}</div>
            <div className="text-[0.75rem] text-grey">{l}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Celebrate rank gains and newly finished tasks (compares consecutive snapshots). */
function celebrate(prev: DisplaySnapshot | null, next: DisplaySnapshot) {
  if (!prev || !next.display.confetti) return;
  const prevRank = new Map(prev.leaderboard.entries.map((e) => [e.personId, e.rank]));
  const rose = next.leaderboard.entries.some((e) => e.rank !== null && (prevRank.get(e.personId) ?? Infinity) > e.rank);
  const wasDone = new Set(prev.rows.flatMap((r) => r.items.filter((i) => i.status === "done").map((i) => i.id)));
  const finished = next.rows.some((r) => r.items.some((i) => i.status === "done" && !wasDone.has(i.id)));
  if (rose || finished) {
    confetti({ particleCount: 160, spread: 90, origin: { y: 0.7 }, colors: ["#E9BE5F", "#ECECEC", "#C8A84B"], disableForReducedMotion: true });
  }
}

/** Department notices for the rotating slot of the banner (with their own countdown when they have a time). */
function noticesFor(s: DisplaySnapshot) {
  return s.notices.map((n) => ({ icon: n.icon, title: n.title, detail: n.detail || (n.at ? `at ${hhmm(n.at)}` : ""), at: n.at ? toMin(n.at) : null }));
}

/** The banner (AM-17): the countdown most of the time, a quote or notice now and then, orange during lunch. */
function Banner({ s, nowMin, tick }: { s: DisplaySnapshot; nowMin: number; tick: number }) {
  const day = { start: toMin(s.day.start), end: toMin(s.day.end), breaks: s.day.breaks.map(([a, b]) => [toMin(a), toMin(b)] as [number, number]), isToday: s.day.isToday };
  const main = banner(nowMin, day, s.banner);
  const extras = [...noticesFor(s).map((n) => ({ ...n, quote: false })), ...s.quotes.map((q) => ({ icon: "💬", title: q, detail: "", at: null as number | null, quote: true }))];
  const turn = extras.length ? quoteTurn(Math.floor(tick / 1000), main, s.banner) : null;
  const extra = turn !== null ? extras[turn % extras.length] : null;
  const box = "flex h-[3.8rem] w-[38rem] max-w-[40vw] items-center gap-[0.8rem] overflow-hidden rounded-full border px-[1.3rem] motion-safe:animate-[fadein_.6s_ease]";
  if (extra) {
    return (
      <div key={`x${turn}`} className={`${box} border-line2 bg-white/[0.04]`}>
        <span className="text-[1.6rem]">{extra.icon}</span>
        <div className="min-w-0 flex-1">
          <div className={`line-clamp-2 leading-tight ${extra.quote ? "text-[1.15rem] italic" : "text-[1.3rem] font-semibold"}`}>{extra.quote ? `“${extra.title}”` : extra.title}</div>
          {extra.detail && <div className="truncate font-mono text-[0.8rem] text-grey">{extra.detail}</div>}
        </div>
        {extra.at !== null && <span className="shrink-0 font-mono text-[1.35rem] font-semibold text-gold">{extra.at > nowMin ? `in ${countdown(extra.at - nowMin)}` : "now"}</span>}
      </div>
    );
  }
  const lunch = s.day.breaks.find(([a, b]) => nowMin >= toMin(a) && nowMin < toMin(b));
  const next = s.day.breaks.find(([a]) => toMin(a) > nowMin);
  const view = {
    lunchSoon: { icon: "🍽️", title: "Lunch break", detail: next ? `${hhmm(next[0])}–${hhmm(next[1])}` : "", count: main.kind === "lunchSoon" ? `in ${countdown(main.at - nowMin)}` : "", tone: "border-gold/35 bg-gold/[0.08]" },
    lunch: { icon: "🍽️", title: "Lunch time", detail: lunch ? `Back to work at ${hhmm(lunch[1])}` : "", count: main.kind === "lunch" ? countdown(main.until - nowMin) : "", tone: "border-warn bg-warn text-on-accent" },
    backToIt: { icon: "🔔", title: "Lunch time is up, back to it!", detail: "", count: "", tone: "border-warn/70 bg-warn/15" },
    wrapUp: { icon: "🏁", title: "Shift ends", detail: `at ${hhmm(s.day.end)}`, count: main.kind === "wrapUp" ? `in ${countdown(main.at - nowMin)}` : "", tone: "border-warn/70 bg-warn/15" },
    shiftEnds: { icon: "🕕", title: "Shift ends", detail: `at ${hhmm(s.day.end)}`, count: main.kind === "shiftEnds" ? `in ${countdown(main.at - nowMin)}` : "", tone: "border-gold/35 bg-gold/[0.08]" },
    idle: null,
  }[main.kind];
  if (!view) return <span />;
  return (
    <div key={main.kind} className={`${box} ${view.tone}`}>
      <span className="text-[1.6rem]">{view.icon}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[1.3rem] font-semibold leading-tight">{view.title}</div>
        {view.detail && <div className={`truncate font-mono text-[0.8rem] ${main.kind === "lunch" ? "" : "text-grey"}`}>{view.detail}</div>}
      </div>
      {view.count && <span className={`shrink-0 font-mono text-[1.6rem] font-semibold tabular-nums ${main.kind === "lunch" ? "" : main.kind === "wrapUp" ? "text-warn" : "text-gold"}`}>{view.count}</span>}
    </div>
  );
}

export function Kiosk({ token }: { token: string }) {
  const [snap, setSnap] = useState<DisplaySnapshot | null>(null);
  const [fetchedAt, setFetchedAt] = useState(0);
  const [error, setError] = useState<"gone" | "offline" | null>(null);
  const [tick, setTick] = useState(() => Date.now());
  const [screen, setScreen] = useState<"day" | "board">("day");
  const prev = useRef<DisplaySnapshot | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/display/${token}/snapshot`, { cache: "no-store" });
      if (r.status === 404) { setError("gone"); return; }
      if (!r.ok) throw new Error(String(r.status));
      const next = (await r.json()) as DisplaySnapshot;
      celebrate(prev.current, next);
      prev.current = next;
      setSnap(next);
      setFetchedAt(Date.now());
      setError(null);
    } catch {
      setError("offline"); // keep showing the last good data
    }
  }, [token]);

  useEffect(() => {
    load();
    const poll = setInterval(load, POLL_MS);
    const clock = setInterval(() => setTick(Date.now()), 1000);
    let debounce: ReturnType<typeof setTimeout> | undefined;
    let channel: ReturnType<ReturnType<typeof createClient>["channel"]> | null = null;
    let supabase: ReturnType<typeof createClient> | null = null;
    try {
      supabase = createClient();
      channel = supabase.channel("kynetik-changes", { config: { private: false } })
        .on("broadcast", { event: "changed" }, () => { clearTimeout(debounce); debounce = setTimeout(load, 300); })
        .subscribe();
    } catch { /* polling still runs */ }
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(poll); clearInterval(clock); clearTimeout(debounce);
      document.removeEventListener("visibilitychange", onVisible);
      if (supabase && channel) supabase.removeChannel(channel);
    };
  }, [load]);

  const mode = snap?.display.leaderboardMode ?? "side";
  useEffect(() => {
    if (mode !== "rotate") { setScreen("day"); return; }
    const t = setTimeout(() => setScreen((x) => (x === "day" ? "board" : "day")), screen === "day" ? ROTATE.day : ROTATE.board);
    return () => clearTimeout(t);
  }, [mode, screen]);

  if (error === "gone") {
    return <main className="flex h-dvh cursor-none items-center justify-center bg-carbon text-[1.6rem] text-grey">This display link isn&apos;t active. Ask the Owner for a new one.</main>;
  }
  if (!snap) return <main className="flex h-dvh cursor-none items-center justify-center bg-carbon text-[1.6rem] text-grey">{error === "offline" ? "Can't reach the Build Tracker. Retrying every few seconds…" : "Connecting…"}</main>;

  const nowMin = toMin(snap.now) + (tick - fetchedAt) / 60_000;
  const nowDT = fromMin(Math.floor(nowMin));
  const stale = tick - fetchedAt > STALE_MS;
  const t0 = toMin(snap.day.start), t1 = toMin(snap.day.end);
  const dayShare = snap.day.isToday ? Math.min(1, Math.max(0, workMin(snap, t0, Math.min(nowMin, t1)) / Math.max(1, workMin(snap, t0, t1)))) : 0;

  return (
    <main data-theme="dark" className="flex h-dvh cursor-none select-none flex-col overflow-hidden px-[2.8rem] pb-[1.6rem] pt-[2rem] text-ink"
      style={{ background: "radial-gradient(60rem 30rem at 20% -10%, #2a2619 0%, transparent 60%), linear-gradient(180deg, #1f1f1f, #191919)" }}
      onContextMenu={(e) => e.preventDefault()}>
      <header className="grid grid-cols-[1fr_auto_1fr] items-center gap-[1.5rem]">
        <div className="flex min-w-0 items-center gap-[1.1rem]">
          <span className="grid h-[3.8rem] w-[3.8rem] shrink-0 place-items-center rounded-[1rem] border border-[#4a3f22] bg-gradient-to-br from-[#2f2a1c] to-[#222] text-[2rem]">{snap.department?.emoji || "🛠️"}</span>
          <div className="min-w-0">
            <div className="display text-[0.75rem] tracking-[0.32em] text-gold">Department</div>
            <div className="display truncate text-[1.7rem] tracking-[0.05em]">{snap.department?.name ?? "No department set"}</div>
          </div>
        </div>
        <Banner s={snap} nowMin={nowMin} tick={tick} />
        <div className="justify-self-end text-right">
          <div className="font-mono text-[3.8rem] font-medium leading-none tracking-[-0.02em] tabular-nums">
            {hhmm(nowDT).slice(0, 2)}<span className="text-gold motion-safe:animate-[blink_1s_steps(1)_infinite]">:</span>{hhmm(nowDT).slice(3)}
          </div>
          <div className="mt-[0.4rem] font-mono text-[0.9rem] uppercase tracking-[0.04em] text-grey">{longDate(nowDT)}{!snap.day.isToday && ` · showing ${longDate(snap.day.date)}`}</div>
        </div>
      </header>

      <div className="mt-[1.4rem] flex min-h-0 flex-1 gap-[1.6rem]">
        {(mode !== "rotate" || screen === "day") && <section className="min-h-0 min-w-0 flex-1"><DayView s={snap} nowMin={nowMin} /></section>}
        {mode === "side" && <aside className="min-h-0 w-[25rem] shrink-0"><Leaderboard s={snap} wide={false} /></aside>}
        {mode === "rotate" && screen === "board" && <section className="min-h-0 flex-1"><Leaderboard s={snap} wide /></section>}
      </div>

      <footer className="mt-[1rem] grid grid-cols-[auto_1fr_auto] items-center gap-[1.2rem] font-mono text-[0.8rem] text-grey">
        <span className={error || stale ? "text-warn" : ""}>
          <i className={`mr-[0.5rem] inline-block h-[0.6rem] w-[0.6rem] rounded-full ${error || stale ? "bg-warn" : "bg-ok shadow-[0_0_0.5rem_var(--ok)]"}`} />
          {error ? "reconnecting…" : stale ? "not updated" : "live"} · updated {snap.now.slice(11, 16)}
        </span>
        <div className="h-[0.4rem] overflow-hidden rounded-full bg-[#2e2e2e]"><i className="block h-full bg-gradient-to-r from-[#b8913c] to-gold" style={{ width: `${dayShare * 100}%` }} /></div>
        <span>{Math.round(dayShare * 100)}% of the working day · {hhmm(snap.day.start)}–{hhmm(snap.day.end)}</span>
      </footer>
    </main>
  );
}
