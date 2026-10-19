/** Small presentational pieces shared by console pages (server-safe). */
import type { ReactNode } from "react";

export type Tone = "gold" | "ok" | "warn" | "bad" | "cool" | "grey";
const TONE: Record<Tone, string> = {
  gold: "var(--gold)", ok: "var(--ok)", warn: "var(--warn)", bad: "var(--bad)", cool: "var(--cool)", grey: "var(--grey2)",
};

/** Tile with a coloured left border (§16). */
export function Tile({ label, value, sub, tone = "grey", hint }: { label: string; value: ReactNode; sub?: ReactNode; tone?: Tone; hint?: string }) {
  return (
    <div className="min-w-0 rounded-[10px] border border-line bg-panel px-4 py-3" style={{ borderLeft: `3px solid ${TONE[tone]}` }} title={hint}>
      <div className="label">{label}</div>
      <div className="mt-1 font-mono text-2xl tabular-nums">{value}</div>
      {sub && <div className="mt-0.5 truncate text-sm text-grey">{sub}</div>}
    </div>
  );
}

export function Pill({ children, colour, tone }: { children: ReactNode; colour?: string; tone?: Tone }) {
  const c = colour ?? TONE[tone ?? "grey"];
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 font-mono text-[0.7rem] uppercase tracking-wider"
      style={{ borderColor: c, color: c }}>
      {children}
    </span>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-[10px] border border-line bg-panel ${className}`}>{children}</section>;
}

export function PageHead({ eyebrow, title, children }: { eyebrow?: ReactNode; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow mb-2">{eyebrow}</p>}
        <h1 className="display text-2xl">{title}</h1>
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

export function Fact({ label, value, tone }: { label: string; value: ReactNode; tone?: Tone }) {
  return (
    <div className="min-w-0">
      <div className="label">{label}</div>
      <div className="font-mono text-sm tabular-nums" style={tone ? { color: TONE[tone] } : undefined}>{value}</div>
    </div>
  );
}

export const healthTone = (h: string): Tone =>
  h === "late" ? "bad" : h === "risk" ? "warn" : h === "ok" ? "ok" : h === "done" ? "cool" : "grey";
