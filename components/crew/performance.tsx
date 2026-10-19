import Link from "next/link";
import { Card, Tile } from "@/components/ui/primitives";
import { fmtDT, fmtH } from "@/domain/format";
import { inPeriod, leaderboard, scoreBand } from "@/domain/scoring";
import { actualH, standardH } from "@/domain/work";
import type { Viewer } from "@/lib/auth";
import type { World } from "@/lib/data/world";
import { ExportPanel } from "@/components/reports/export-panel";

const BAND = { green: "var(--ok)", yellow: "#D8C45A", amber: "var(--warn)", red: "var(--bad)" } as const;
const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x)}%`);
const periodLabel = (d: number) => (d === 0 ? "All time" : `${d} days`);

/** Crew → Performance (was Technicians, spec §11): period, tiles, ranked table, score explanation, drill-down. */
export function Performance({ viewer, w, sp }: { viewer: Viewer; w: World; sp: { period?: string; person?: string; board?: string } }) {
  const s = w.settings.scoring;
  const period = s.periodOptions.includes(Number(sp.period)) ? Number(sp.period) : s.defaultPeriodDays;
  const projects = w.builds.map((b) => b.project);
  // Amends AM-11, AM-24: Modelling & 3D Printing has its own leaderboard (its people, its two stages);
  // production keeps the rest.
  const modelling = w.departments.find((d) => d.key === "modelling");
  const board = sp.board === "modelling" && modelling ? "modelling" : "production";
  const own = (st: { stationType: string; step?: string | null }) => st.stationType === "modelling" || st.step === "modelling" || st.step === "printing";
  const keep = (st: { stationType: string; step?: string | null }) => (board === "modelling" ? own(st) : !own(st));
  const inBoard = (p: { departmentId: string | null }) => (board === "modelling" ? p.departmentId === modelling?.id : !modelling || p.departmentId !== modelling.id);
  const rows = leaderboard(w.people.filter(inBoard), projects, w.cal, w.now, period, s, keep, w.scoreCalFor);

  // Shop-wide tiles over every production part-step finished in the period.
  const crewIds = new Set(rows.map((r) => r.personId));
  let done = 0, onTime = 0, ftr = 0, std = 0, act = 0, inWork = 0;
  for (const p of projects) for (const it of p.work) {
    if (!it.tech || !crewIds.has(it.tech)) continue;
    if (it.status === "doing") inWork++;
    if (it.status !== "done" || !it.end || !inPeriod(it.end, w.now, period)) continue;
    const st = p.stages.find((x) => x.id === it.stageId)!;
    if (!keep(st)) continue;
    const a = actualH(it, w.cal, w.now), sd = standardH(it, st);
    done++; std += sd; act += a;
    if (a <= sd + s.onTimeToleranceH) onTime++;
    if (it.rework === 0) ftr++;
  }
  const share = (n: number) => (done ? (n / done) * 100 : null);
  const pace = done ? (act > 0 ? (std / act) * 100 : s.paceWhenNoActual) : null;
  const person = rows.find((r) => r.personId === sp.person);
  const href = (q: Record<string, string>) => `/setup/crew?${new URLSearchParams({ tab: "performance", period: String(period), board, ...q })}`;

  // Export (AM-26): Owner and Supervisors; every active production employee can be picked.
  const exportPeople = w.people.filter((p) => p.costClass === "production" && !p.archived)
    .map((p) => ({ id: p.id, name: p.name, department: w.departments.find((d) => d.id === p.departmentId)?.name ?? "No department" }));

  return (
    <div className="grid gap-4">
      {viewer.canWrite && <ExportPanel people={exportPeople} today={w.today} userId={viewer.userId} departments={w.departments.map((d) => d.name)}
        projects={w.builds.map((b) => ({ id: b.project.id, label: `${b.project.serial} ${b.project.name}`.trim() }))}
        stages={[...new Set(w.builds.flatMap((b) => b.project.stages.map((x) => x.name)))].sort()} />}
      {modelling && (
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Leaderboard">
          <span className="label mr-2">Leaderboard</span>
          {([["production", "Production"], ["modelling", "Modelling & 3D Printing"]] as const).map(([k, label]) => (
            <Link key={k} href={href({ board: k, person: "" })} aria-current={board === k ? "true" : undefined}
              className={`rounded-md border px-3 py-1.5 text-xs ${board === k ? "border-gold text-gold" : "border-line2 text-grey hover:text-ink"}`}>{label}</Link>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1">
        <span className="label mr-2">Period</span>
          {s.periodOptions.map((d) => (
            <Link key={d} href={href({ period: String(d) })}
              className={`rounded-md border px-3 py-1.5 font-mono text-xs ${d === period ? "border-gold text-gold" : "border-line2 text-grey hover:text-ink"}`}>{periodLabel(d)}</Link>
          ))}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Tile label="Completed" value={done} sub="part-steps" tone="gold" />
        <Tile label="On time" value={pct(share(onTime))} tone="ok" />
        <Tile label="First time right" value={pct(share(ftr))} tone="cool" />
        <Tile label="Pace" value={pct(pace)} sub="standard ÷ actual" tone="grey" />
        <Tile label="In work now" value={inWork} tone="grey" />
      </div>

      <p className="rounded-md border border-line bg-panel3 p-3 text-sm text-grey">
        Score = {s.weights.onTime}% on time + {s.weights.ftr}% first time right + {s.weights.pace}% pace (pace capped at {s.paceCap}%).
        It shows once someone has at least {s.minDone} completed part-steps in the period. On time means within the standard hours (+{s.onTimeToleranceH}h).
      </p>

      <Card className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="label border-b border-line text-left">
              <th className="p-3">#</th><th className="p-3">Technician</th><th className="p-3 text-right">Done</th><th className="p-3 text-right">On time</th>
              <th className="p-3 text-right">FTR</th><th className="p-3 text-right">Pace</th><th className="p-3 text-right">Avg h/part</th><th className="p-3 text-right">Logged h/part</th>
              {viewer.seesCost && <th className="p-3 text-right">Cost/part {w.currency}</th>}
              <th className="p-3 text-right">In work</th><th className="p-3 text-right">Score</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.personId} className={`border-b border-line last:border-0 hover:bg-panel2 ${r.personId === person?.personId ? "bg-panel2" : ""}`}>
                <td className="p-3 font-mono text-grey">{r.score === null ? "—" : i + 1}</td>
                <td className="p-3"><Link href={href({ person: r.personId })} className="hover:text-gold">{r.name}</Link></td>
                <td className="p-3 text-right font-mono">{r.done}</td>
                <td className="p-3 text-right font-mono">{pct(r.onTimePct)}</td>
                <td className="p-3 text-right font-mono">{pct(r.ftrPct)}</td>
                <td className="p-3 text-right font-mono">{pct(r.pacePct)}</td>
                <td className="p-3 text-right font-mono">{r.avgActualH === null ? "—" : fmtH(r.avgActualH)}</td>
                <td className="p-3 text-right font-mono">{r.loggedHPerPart === null ? "—" : fmtH(r.loggedHPerPart)}</td>
                {viewer.seesCost && <td className="p-3 text-right font-mono">{r.costPerPart === null ? "—" : Math.round(r.costPerPart).toLocaleString("en-US")}</td>}
                <td className="p-3 text-right font-mono">{r.inWork}</td>
                <td className="p-3 text-right font-mono text-base" style={{ color: r.score === null ? undefined : BAND[scoreBand(r.score, s)] }}>{r.score ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {person && (() => {
        const mine = projects.flatMap((p) => p.work.filter((it) => it.tech === person.personId).map((it) => ({ p, it, st: p.stages.find((x) => x.id === it.stageId)! })));
        const label = (x: (typeof mine)[number]) => `${x.p.serial} · ${x.st.name} · ${x.p.parts.find((y) => y.id === x.it.partId)?.name}`;
        const open = mine.filter((x) => x.it.status !== "done");
        const completed = mine.filter((x) => x.it.status === "done" && x.it.end && inPeriod(x.it.end, w.now, period));
        const reworks = mine.flatMap((x) => x.it.reworkLog.map((r) => ({ ...r, what: label(x) })));
        return (
          <Card className="grid gap-4 p-4">
            <div className="flex items-center justify-between">
              <h2 className="display text-lg">{person.name}</h2>
              <Link href={href({})} className="font-mono text-xs text-grey hover:text-gold">close ✕</Link>
            </div>
            <div className="grid gap-4 lg:grid-cols-3">
              <section>
                <h3 className="eyebrow mb-2">Open work · {open.length}</h3>
                <ul className="grid gap-1 text-sm">
                  {open.map((x) => <li key={x.it.id}>{label(x)} <span className="text-grey">· {w.settings.labels.itemStatus[x.it.status].label}</span></li>)}
                  {!open.length && <li className="text-grey">Nothing open.</li>}
                </ul>
              </section>
              <section>
                <h3 className="eyebrow mb-2">Completed · {periodLabel(period)} · {completed.length}</h3>
                <ul className="grid gap-1 font-mono text-xs">
                  {completed.map((x) => {
                    const a = actualH(x.it, w.cal, w.now), sd = standardH(x.it, x.st);
                    return <li key={x.it.id}>{label(x)} · {fmtH(a)} of {fmtH(sd)}{x.it.rework ? ` · ↺${x.it.rework}` : ""} · {fmtDT(x.it.end!)}</li>;
                  })}
                  {!completed.length && <li className="text-grey">None in this period.</li>}
                </ul>
              </section>
              <section>
                <h3 className="eyebrow mb-2">Rework history · {reworks.length}</h3>
                <ul className="grid gap-1 text-sm">
                  {reworks.map((r, k) => <li key={k}><span className="font-mono text-xs text-grey">{fmtDT(r.at)}</span> {r.what}: {r.why}</li>)}
                  {!reworks.length && <li className="text-grey">No rework.</li>}
                </ul>
              </section>
            </div>
          </Card>
        );
      })()}
    </div>
  );
}
