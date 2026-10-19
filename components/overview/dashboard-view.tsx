import Link from "next/link";
import { Card, PageHead } from "@/components/ui/primitives";
import { dashboardTips, headline, hoursByType, stageHours, weeklyOnTime } from "@/domain/dashboard";
import { fmtDate, fmtHM } from "@/domain/format";
import { mondayOf } from "@/domain/plan";
import { addDays } from "@/domain/time";
import type { World } from "@/lib/data/world";

const RANGES = [4, 8, 12] as const;
const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x)}%`);

/** Overview → Dashboard (v2; amends AM-12 puts it beside the Board): how the shop is performing, from finished work only. */
export function DashboardView({ w, sp, tabs }: { w: World; sp: { weeks?: string }; tabs: React.ReactNode }) {
  const s = w.settings.scoring;
  const weeks = (RANGES as readonly number[]).includes(Number(sp.weeks)) ? Number(sp.weeks) : 8;
  const monday = mondayOf(w.today);
  const from = addDays(monday, -7 * (weeks - 1));
  const projects = w.builds.map((b) => b.project);

  const h = headline(projects, w.cal, w.now, from, s);
  const trend = weeklyOnTime(projects, w.cal, w.now, monday, weeks, s);
  const byType = hoursByType(projects, w.cal, w.now, from);
  const stages = stageHours(projects, w.cal, w.now, from);
  const tips = dashboardTips(stages, s);
  const typeName = (k: string) => w.departments.find((d) => d.key === k)?.name ?? w.stationTypes.find((t) => t.key === k)?.label ?? k;
  const open = w.builds.filter((b) => b.project.status !== "done");
  const late = open.filter((b) => b.health === "late").length;

  const tiles = [
    { label: "Steps finished", value: String(h.done), sub: `since ${fmtDate(from)}` },
    { label: "On time", value: pct(h.onTimePct), sub: "within the planned hours" },
    { label: "First time right", value: pct(h.ftrPct), sub: "no rework" },
    { label: "Pace", value: pct(h.pacePct), sub: `${fmtHM(h.standardH)} planned, ${fmtHM(h.actualH)} taken` },
  ];

  return (
    <div className="grid gap-5">
      <PageHead eyebrow={`Last ${weeks} weeks · finished work only`} title="Overview">
        <div className="flex overflow-hidden rounded-md border border-line2" role="group" aria-label="Range">
          {RANGES.map((n) => (
            <Link key={n} href={`/board?tab=dashboard&weeks=${n}`} aria-current={n === weeks ? "true" : undefined}
              className={`grid min-h-10 place-items-center px-4 font-mono text-xs ${n === weeks ? "bg-panel2 text-ink shadow-[inset_0_-2px_0_var(--gold)]" : "text-grey hover:text-ink"}`}>{n} weeks</Link>
          ))}
        </div>
      </PageHead>
      {tabs}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="grid gap-1 rounded-xl border border-line bg-panel px-4 py-3.5">
            <span className="text-sm text-grey">{t.label}</span>
            <span className="font-mono text-3xl leading-tight">{t.value}</span>
            <span className="text-xs text-grey">{t.sub}</span>
          </div>
        ))}
      </div>

      {h.done === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-lg">No finished part steps in the last {weeks} weeks yet.</p>
          <p className="mt-1 text-sm text-grey">The charts fill in as work is marked done on the builds and the task queue.</p>
        </Card>
      ) : (
        <>
          <div className="grid gap-5 xl:grid-cols-2">
            <Card className="p-4">
              <h2 className="eyebrow mb-1">On time, week by week</h2>
              <p className="mb-3 text-sm text-grey">Share of finished part steps that stayed within their planned hours.</p>
              <OnTimeChart data={trend} />
            </Card>
            <Card className="p-4">
              <h2 className="eyebrow mb-1">Hours by department</h2>
              <p className="mb-3 text-sm text-grey">Working hours that finished part steps took, {fmtHM(h.actualH)} in total.</p>
              <ShareBars rows={byType.map((r) => ({ label: typeName(r.type), value: r.hours }))} total={h.actualH} />
            </Card>
          </div>

          <Card className="p-4">
            <h2 className="eyebrow mb-1">Planned and actual hours per stage</h2>
            <p className="mb-3 text-sm text-grey">Average per finished part step. Stages that run over come first.</p>
            <StageBars rows={stages} />
          </Card>
        </>
      )}

      <Card className="p-4">
        <h2 className="eyebrow mb-3">What the data suggests</h2>
        <ul className="grid gap-2 text-sm">
          {late > 0 && <li className="flex gap-3"><Dot c="var(--bad)" /><span>{late} of {open.length} open build{open.length === 1 ? " is" : "s are"} late against the promised date. <Link href="/timeline?show=late" className="text-gold hover:underline">See them on the Timeline →</Link></span></li>}
          {tips.map((t, i) => <li key={i} className="flex gap-3"><Dot c="var(--warn)" /><span>{t}</span></li>)}
          {h.ftrPct !== null && h.ftrPct < 100 && <li className="flex gap-3"><Dot c="var(--cool)" /><span>{Math.round(100 - h.ftrPct)}% of finished steps needed rework. The reasons are on each build&apos;s parts table and in the Crew performance drill-down.</span></li>}
          {!late && !tips.length && (h.ftrPct === null || h.ftrPct === 100) && <li className="text-grey">Nothing stands out. Stages are running to plan.</li>}
        </ul>
      </Card>
    </div>
  );
}

function Dot({ c }: { c: string }) {
  return <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: c }} />;
}

/** Single series line: on-time % per week (0–100). A week with nothing finished leaves a gap. */
function OnTimeChart({ data }: { data: { monday: string; done: number; onTimePct: number | null }[] }) {
  const W = 520, H = 230, L = 44, R = 20, T = 22, B = 46;
  const x = (i: number) => L + (data.length === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (data.length - 1));
  const y = (v: number) => T + ((100 - v) * (H - T - B)) / 100;
  const segs: { i: number; v: number }[][] = [];
  data.forEach((d, i) => {
    if (d.onTimePct === null) { segs.push([]); return; }
    if (!segs.length || !segs[segs.length - 1].length || data[i - 1]?.onTimePct === null) segs.push([]);
    segs[segs.length - 1].push({ i, v: d.onTimePct });
  });
  const last = [...data].reverse().find((d) => d.onTimePct !== null);
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[420px]" role="img" aria-label={`On-time share per week; latest ${last ? Math.round(last.onTimePct!) : 0}%`}>
        {[0, 50, 100].map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeWidth={1} />
            <text x={L - 8} y={y(v) + 4} textAnchor="end" fontSize={12} fill="var(--grey)" fontFamily="var(--font-mono)">{v}%</text>
          </g>
        ))}
        {segs.filter((sg) => sg.length).map((sg, k) => (
          <g key={k}>
            {sg.length > 1 && <polyline points={sg.map((p) => `${x(p.i)},${y(p.v)}`).join(" ")} fill="none" stroke="var(--gold)" strokeWidth={2} strokeLinejoin="round" />}
          </g>
        ))}
        {data.map((d, i) => (
          <g key={d.monday}>
            {d.onTimePct !== null && (
              <circle cx={x(i)} cy={y(d.onTimePct)} r={d === last ? 5 : 4} fill="var(--gold)" stroke="var(--panel)" strokeWidth={2}>
                <title>{`Week of ${fmtDate(d.monday)}: ${Math.round(d.onTimePct)}% on time, ${d.done} step${d.done === 1 ? "" : "s"}`}</title>
              </circle>
            )}
            <text x={x(i)} y={H - 24} textAnchor="middle" fontSize={12} fill="var(--grey)" fontFamily="var(--font-mono)">{fmtDate(d.monday)}</text>
            <text x={x(i)} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--grey)" fontFamily="var(--font-mono)">{d.done ? `${d.done} done` : "—"}</text>
          </g>
        ))}
        {last && <text x={x(data.indexOf(last))} y={y(last.onTimePct!) - 12} textAnchor="middle" fontSize={14} fill="var(--ink)" fontFamily="var(--font-mono)">{Math.round(last.onTimePct!)}%</text>}
      </svg>
    </div>
  );
}

/** Ranked horizontal bars, one hue, value and share printed beside each bar. */
function ShareBars({ rows, total }: { rows: { label: string; value: number }[]; total: number }) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <ul className="grid gap-3">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)_auto] items-center gap-3 text-sm sm:grid-cols-[8rem_minmax(0,1fr)_6.5rem]" title={`${r.label}: ${fmtHM(r.value)}`}>
          <span className="truncate">{r.label}</span>
          <span className="h-3 rounded-r-[4px] bg-gold" style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} />
          <span className="text-right font-mono text-xs"><span className="text-ink">{total ? Math.round((r.value / total) * 100) : 0}%</span> <span className="text-grey">{fmtHM(r.value)}</span></span>
        </li>
      ))}
    </ul>
  );
}

/** Two thin bars per stage on one scale: planned (grey) above actual (gold). */
function StageBars({ rows }: { rows: { stage: string; n: number; planned: number; actual: number }[] }) {
  const max = Math.max(...rows.flatMap((r) => [r.planned, r.actual]), 1);
  return (
    <div className="grid gap-3">
      <div className="flex gap-4 text-xs text-grey">
        <span className="flex items-center gap-1.5"><i className="h-2 w-4 rounded-sm bg-[var(--planned-bar)]" />Planned</span>
        <span className="flex items-center gap-1.5"><i className="h-2 w-4 rounded-sm bg-gold" />Actual</span>
      </div>
      <ul className="grid gap-3">
        {rows.map((r) => {
          const over = r.actual - r.planned;
          return (
            <li key={r.stage} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 text-sm sm:grid-cols-[minmax(7rem,12rem)_minmax(0,1fr)_auto]" title={`${r.stage}: ${fmtHM(r.actual)} actual vs ${fmtHM(r.planned)} planned (${r.n} steps)`}>
              <span className="truncate">{r.stage} <span className="font-mono text-xs text-grey">· {r.n}</span></span>
              <span className="order-last col-span-2 grid gap-[2px] sm:order-none sm:col-span-1">
                <span className="h-2 rounded-r-[4px] bg-[var(--planned-bar)]" style={{ width: `${Math.max(1, (r.planned / max) * 100)}%` }} />
                <span className="h-2 rounded-r-[4px] bg-gold" style={{ width: `${Math.max(1, (r.actual / max) * 100)}%` }} />
              </span>
              <span className="whitespace-nowrap text-right font-mono text-xs">
                <span className="text-ink">{fmtHM(r.actual)}</span> <span className="text-grey">/ {fmtHM(r.planned)}</span>
                {Math.abs(over) >= 1 / 60 && <span className={`ml-1.5 rounded px-1 ${over > 0 ? "bg-bad text-on-accent" : "bg-ok text-on-accent"}`}>{over > 0 ? "+" : "−"}{fmtHM(Math.abs(over))}</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
