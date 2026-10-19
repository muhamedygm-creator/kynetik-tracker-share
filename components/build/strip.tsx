/** Board strip for one build (§14): head, mini timeline, facts. Server component. */
import Link from "next/link";
import { fmtDT, fmtDate, fmtH } from "@/domain/format";
import { projectPct, stageAgg } from "@/domain/schedule";
import { toMin } from "@/domain/time";
import type { World, BuildView } from "@/lib/data/world";
import { Fact, Pill, healthTone } from "@/components/ui/primitives";

export function stationColour(world: World, type: string) {
  return world.stationTypes.find((s) => s.key === type)?.colour ?? world.settings.labels.otherColour;
}

export function FloatPill({ floatH, health }: { floatH: number | null; health: string }) {
  if (floatH === null) return <Pill tone="grey">no date</Pill>;
  return <Pill tone={healthTone(health)}>{floatH < 0 ? `${fmtH(-floatH)} late` : `${fmtH(floatH)} float`}</Pill>;
}

export function slipText(slipH: number | null) {
  if (slipH === null) return "—";
  if (Math.abs(slipH) < 0.05) return "on plan";
  return slipH > 0 ? `+${fmtH(slipH)} later` : `${fmtH(-slipH)} earlier`;
}

/** Proportional bar: baseline lines, stage segments filled by %, hatched forecast overrun, now line, committed diamond. */
export function MiniTimeline({ view, world }: { view: BuildView; world: World }) {
  const { project: p, forecast: f } = view;
  const cal = world.cal;
  const start = cal.atShiftStart(p.startDate);
  const ends = [f.finish, view.planEnd, p.deliveryDate ? cal.atShiftEnd(p.deliveryDate) : null, ...Object.values(p.baseline).map((b) => b.end)]
    .filter(Boolean) as string[];
  const starts = [start, ...Object.values(p.baseline).map((b) => b.start), ...p.tasks.map((t) => t.start).filter(Boolean) as string[]];
  const t0 = Math.min(...starts.map((x) => toMin(x)));
  const t1 = Math.max(t0 + 1440, ...ends.map((x) => toMin(x)));
  const x = (t: string) => `${Math.min(100, Math.max(0, ((toMin(t) - t0) / (t1 - t0)) * 100))}%`;
  const w = (a: string, b: string) => `${Math.max(0.3, ((toMin(b) - toMin(a)) / (t1 - t0)) * 100)}%`;
  const late = f.finish && view.planEnd && f.finish > view.planEnd;
  const committed = p.deliveryDate ? cal.atShiftEnd(p.deliveryDate) : null;

  return (
    <div className="relative h-9 w-full" aria-hidden>
      {/* baseline */}
      {p.stages.map((s) => {
        const bs = p.tasks.filter((t) => t.stageId === s.id).map((t) => p.baseline[t.id]).filter(Boolean);
        if (!bs.length) return null;
        const a = bs.map((b) => b.start).sort()[0], b = bs.map((b) => b.end).sort().at(-1)!;
        return <div key={`b-${s.id}`} className="absolute bottom-0 h-px bg-grey2" style={{ left: x(a), width: w(a, b) }} />;
      })}
      {/* stages */}
      {p.stages.map((s) => {
        const agg = stageAgg(p, s);
        if (!agg.start || !agg.end) return null;
        const c = stationColour(world, s.stationType);
        return (
          <div key={s.id} className="absolute top-1 h-5 overflow-hidden rounded-sm" style={{ left: x(agg.start), width: w(agg.start, agg.end), background: `${c}33`, borderLeft: "1px solid var(--carbon)" }}
            title={`${s.name} · ${Math.round(agg.pct * 100)}%`}>
            <div className="h-full" style={{ width: `${agg.pct * 100}%`, background: c }} />
          </div>
        );
      })}
      {late && <div className="hatch-overrun absolute top-1 h-5 rounded-sm" style={{ left: x(view.planEnd!), width: w(view.planEnd!, f.finish!) }} />}
      <div className="absolute -top-0.5 bottom-0 w-px bg-gold" style={{ left: x(world.now) }} />
      {committed && (
        <div className="absolute top-2.5 h-2.5 w-2.5 -translate-x-1/2 rotate-45"
          style={{ left: x(committed), background: f.finish && f.finish > committed ? "var(--bad)" : "var(--ink)" }} />
      )}
    </div>
  );
}

export function BuildStrip({ view, world, compact }: { view: BuildView; world: World; compact?: boolean }) {
  const { project: p, forecast: f } = view;
  const labels = world.settings.labels;
  const steps = p.work.length;
  const done = p.work.filter((w) => w.status === "done").length;
  const live = p.stages.filter((s) => {
    const a = stageAgg(p, s);
    return (a.pct > 0 && a.pct < 1) || p.work.some((w) => w.stageId === s.id && w.status === "doing");
  });

  return (
    <Link href={`/builds/${p.id}`} className="block rounded-[10px] border border-line bg-panel p-4 transition-colors hover:border-gold/60">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-3">
            <span className="font-mono text-lg text-gold">{p.serial}</span>
            <span className="text-lg">{p.name}</span>
            {view.client && <span className="text-sm text-grey">{view.client}</span>}
          </div>
          {!compact && <div className="text-sm text-grey">{live.length ? live.map((s) => s.name).join(" · ") : "No stage in work"}</div>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Pill colour={p.status === "active" ? "var(--gold)" : undefined}>{labels.projectStatus[p.status].label}</Pill>
          {p.status !== "done" && <FloatPill floatH={f.floatH} health={view.health} />}
        </div>
      </div>
      {!compact && (
        <>
          <div className="mt-3"><MiniTimeline view={view} world={world} /></div>
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4 lg:grid-cols-7">
            <Fact label="Elapsed" value={`${fmtH(f.elapsedH)} of ${fmtH(f.totalH)}`} />
            <Fact label="Part-steps" value={`${done} / ${steps}`} />
            <Fact label="Progress" value={`${Math.round(projectPct(p) * 100)}%`} />
            <Fact label="Planned finish" value={view.planEnd ? fmtDT(view.planEnd) : "—"} />
            <Fact label="Forecast" value={f.finish ? fmtDT(f.finish) : "—"} tone={healthTone(view.health)} />
            <Fact label="Committed" value={p.deliveryDate ? fmtDate(p.deliveryDate) : "—"} />
            <Fact label="Vs baseline" value={slipText(f.slipH)} tone={f.slipH && f.slipH > 0.05 ? "warn" : undefined} />
          </div>
        </>
      )}
      {compact && p.deliveredOn && <div className="mt-1 font-mono text-sm text-grey">Delivered {fmtDate(p.deliveredOn)}</div>}
    </Link>
  );
}
