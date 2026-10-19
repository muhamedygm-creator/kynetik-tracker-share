"use client";
/**
 * Builds home table (docs/ROADMAP.md v1.2): one group per status, Monday-style rows.
 * The status pill changes the build's status in place; a row opens the build board.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { setBuildStatus } from "@/app/(console)/builds/actions";

export type BuildStatus = "planned" | "active" | "hold" | "done";
export type HealthKey = "late" | "risk" | "ok" | "unset" | "hold" | "done";

export interface BuildRow {
  id: string;
  version: number;
  serial: string;
  name: string;
  client: string;
  status: BuildStatus;
  stageNow: string;
  health: HealthKey;
  pct: number;
  partsDone: number;
  partsTotal: number;
  forecast: string | null;
  promised: string | null;
  crew: { name: string; initial: string; colour: string }[];
}

const STATUS: Record<BuildStatus, { label: string; bg: string; fg: string }> = {
  active: { label: "In build", bg: "var(--gold)", fg: "var(--on-accent)" },
  planned: { label: "Not started", bg: "var(--cool)", fg: "var(--on-accent)" },
  hold: { label: "On hold", bg: "var(--hold)", fg: "var(--on-accent)" },
  done: { label: "Delivered", bg: "var(--ok)", fg: "var(--on-accent)" },
};
export const HEALTH: Record<HealthKey, { label: string; bg: string; fg: string; hint: string }> = {
  late: { label: "Late", bg: "var(--bad)", fg: "var(--on-accent)", hint: "The forecast finish is after the promised date." },
  risk: { label: "At risk", bg: "var(--warn)", fg: "var(--on-accent)", hint: "Only a little spare time is left before the promised date." },
  ok: { label: "On track", bg: "var(--ok)", fg: "var(--on-accent)", hint: "The forecast finish is before the promised date." },
  unset: { label: "No date set", bg: "var(--chip)", fg: "var(--ink)", hint: "No promised date, so the app can't say if it's late." },
  hold: { label: "On hold", bg: "var(--chip)", fg: "var(--ink)", hint: "Paused: nothing is forecast." },
  done: { label: "Delivered", bg: "var(--chip)", fg: "var(--ink)", hint: "Handed over." },
};
const MOVES: Record<BuildStatus, { action: "start" | "hold" | "resume"; label: string }[]> = {
  planned: [{ action: "start", label: "Start build" }],
  active: [{ action: "hold", label: "Put on hold" }],
  hold: [{ action: "resume", label: "Resume" }],
  done: [],
};
const ORDER: BuildStatus[] = ["active", "planned", "hold", "done"];

function StatusPill({ row, canWrite, onError }: { row: BuildRow; canWrite: boolean; onError: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const ref = useRef<HTMLDivElement>(null);
  const s = STATUS[row.status];
  const moves = canWrite ? MOVES[row.status] : [];
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  return (
    <div ref={ref} className="relative" onClick={(e) => e.stopPropagation()}>
      <button type="button" disabled={!moves.length || pending} onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}
        className="inline-flex h-9 min-w-[7.5rem] items-center justify-center gap-1.5 rounded-md px-3 text-[0.8rem] font-bold disabled:cursor-default"
        style={{ background: s.bg, color: s.fg, opacity: pending ? 0.6 : 1 }}>
        {pending ? "Saving…" : s.label}{moves.length > 0 && !pending && <span aria-hidden>▾</span>}
      </button>
      {open && (
        <div role="menu" className="absolute left-0 top-10 z-20 min-w-44 rounded-lg border border-line2 bg-panel3 p-1 shadow-xl">
          {moves.map((m) => (
            <button key={m.action} role="menuitem" className="flex min-h-11 w-full items-center rounded-md px-3 text-left text-sm hover:bg-panel2"
              onClick={() => { setOpen(false); start(async () => { const r = await setBuildStatus(row.id, row.version, m.action); if (r.error) onError(r.error); }); }}>
              {m.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function HealthPill({ health }: { health: HealthKey }) {
  const h = HEALTH[health];
  return (
    <span title={h.hint} className="inline-flex h-9 min-w-[7.5rem] items-center justify-center rounded-md px-3 text-[0.8rem] font-bold" style={{ background: h.bg, color: h.fg }}>
      {h.label}
    </span>
  );
}

export function BuildsTable({ rows, canWrite }: { rows: BuildRow[]; canWrite: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const groups = ORDER.map((s) => ({ s, rows: rows.filter((r) => r.status === s) })).filter((g) => g.rows.length);
  return (
    <div className="grid gap-6">
      {error && <p role="alert" className="rounded-lg border border-bad bg-panel p-3 text-sm text-bad">{error}</p>}
      {groups.map((g) => (
        <section key={g.s} aria-label={STATUS[g.s].label}>
          <h2 className="mb-2 flex items-center gap-2.5 text-[0.95rem] font-bold">
            <span className="h-5 w-1 rounded-full" style={{ background: STATUS[g.s].bg }} />
            {STATUS[g.s].label}
            <span className="font-mono text-xs font-normal text-grey">{g.rows.length} {g.rows.length === 1 ? "build" : "builds"}</span>
          </h2>
          <div className="overflow-x-auto rounded-xl border border-line bg-panel">
            <table className="w-full min-w-[980px] text-sm tabular-nums">
              <thead>
                <tr className="label border-b border-line bg-panel2 text-left">
                  <th className="px-4 py-2.5 font-normal">Build</th>
                  <th className="px-3 py-2.5 font-normal">Status</th>
                  <th className="px-3 py-2.5 font-normal">Health</th>
                  <th className="px-3 py-2.5 font-normal">Now in</th>
                  <th className="px-3 py-2.5 font-normal">Progress</th>
                  <th className="px-3 py-2.5 font-normal">Forecast</th>
                  <th className="px-3 py-2.5 font-normal">Promised</th>
                  <th className="px-4 py-2.5 font-normal">Crew</th>
                </tr>
              </thead>
              <tbody>
                {g.rows.map((r) => (
                  <tr key={r.id} tabIndex={0} onClick={() => router.push(`/builds/${r.id}`)} onKeyDown={(e) => e.key === "Enter" && router.push(`/builds/${r.id}`)}
                    className="h-16 cursor-pointer border-b border-line last:border-0 hover:bg-panel2 focus-visible:bg-panel2 focus-visible:outline-none">
                    <td className="px-4">
                      <Link href={`/builds/${r.id}`} onClick={(e) => e.stopPropagation()} className="block">
                        <span className="font-mono text-[0.8rem] text-gold">{r.serial}</span>
                        <span className="block max-w-[22rem] truncate font-semibold">{r.name}</span>
                      </Link>
                    </td>
                    <td className="px-3"><StatusPill row={r} canWrite={canWrite} onError={setError} /></td>
                    <td className="px-3">{r.status === "done" ? <span className="text-grey">—</span> : <HealthPill health={r.health} />}</td>
                    <td className="max-w-[12rem] truncate px-3 text-grey">{r.stageNow}</td>
                    <td className="px-3">
                      <div className="flex min-w-36 items-center gap-2.5">
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-line2"><div className="h-full bg-gold" style={{ width: `${r.pct}%` }} /></div>
                        <span className="w-10 text-right font-mono text-xs text-grey">{r.pct}%</span>
                      </div>
                      <div className="mt-0.5 font-mono text-[0.7rem] text-grey">{r.partsTotal ? `${r.partsDone} of ${r.partsTotal} part steps` : "no parts list"}</div>
                    </td>
                    <td className={`whitespace-nowrap px-3 font-mono ${r.health === "late" ? "text-bad" : ""}`}>{r.forecast ?? "—"}</td>
                    <td className="whitespace-nowrap px-3 font-mono">{r.promised ?? <span className="text-grey">not set</span>}</td>
                    <td className="px-4">
                      {r.crew.length ? (
                        <div className="flex">{r.crew.slice(0, 5).map((c, i) => (
                          <span key={c.name} title={c.name} className="-ml-1.5 inline-grid h-8 w-8 place-items-center rounded-full border-2 border-panel text-xs font-bold text-on-colour first:ml-0"
                            style={{ background: c.colour, zIndex: 10 - i }}>{c.initial}</span>
                        ))}{r.crew.length > 5 && <span className="ml-1 self-center font-mono text-xs text-grey">+{r.crew.length - 5}</span>}</div>
                      ) : <span className="text-grey">Nobody yet</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
