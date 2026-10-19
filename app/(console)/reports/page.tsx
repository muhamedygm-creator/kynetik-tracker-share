import Link from "next/link";
import type { ReactNode } from "react";
import { ExpandTable } from "@/components/reports/expand-table";
import { FilterBar, type Field } from "@/components/reports/filter-bar";
import { Card, PageHead, Tile } from "@/components/ui/primitives";
import { fmtDate } from "@/domain/format";
import { fmtStamp, leaveSummary, type PerfRow } from "@/domain/performance";
import { fmtDur, materialFinish, overNote, type PartRow } from "@/domain/reports";
import { requireViewer } from "@/lib/auth";
import { loadWorld } from "@/lib/data/world";
import { readFilter, type ReportParams } from "@/lib/reports/filters";
import { SECTIONS, SECTION_LABEL, loadActivity, loadEmployees, loadParts, loadProjects, type Section } from "@/lib/reports/reports";

/**
 * Reports (AM-27, redesigned by the Reports fix of 2026-10-17): Employees · Parts · Projects · Activity log.
 * A When zone and a What zone with each tab's own filters; results update at once; CSV and PDF export exactly what
 * is on screen. Owner and Supervisors only; never costs or salaries.
 */
const PAGE = 50;
const ROLE: Record<string, string> = { owner: "Owner", supervisor: "Supervisor", viewer: "Viewer", modeller: "Modelling", floor_station: "Floor station" };

/** "—" with the reason on hover: no blank cells. */
const Dash = ({ why }: { why: string }) => <span className="text-grey" title={why}>—</span>;
/** Date and time; on a narrow screen the time drops under the date. */
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const Stamp = ({ at, why }: { at: string | null; why: string }) => (at
  ? <span className="font-mono" title={fmtStamp(at)}><span className="whitespace-nowrap">{+at.slice(8, 10)} {MON[+at.slice(5, 7) - 1]}</span> {at.slice(11, 16)}</span>
  : <Dash why={why} />);
/** Effective time, red with "+Xh over" when past the allocated time. */
function Eff({ alloc, eff, why = "Not started yet" }: { alloc: number; eff: number; why?: string }) {
  if (!eff) return <Dash why={why} />;
  const over = overNote(alloc, eff);
  return (
    <span className={`whitespace-nowrap font-mono ${over ? "text-bad" : ""}`} title={over ? `Allocated ${fmtDur(alloc)}` : undefined}>
      {fmtDur(eff)}{over && <span className="block text-xs">{over}</span>}
    </span>
  );
}
const Alloc = ({ min }: { min: number }) => (min ? <span className="whitespace-nowrap font-mono">{fmtDur(min)}</span> : <Dash why="No time allocated" />);
const pct = (v: number | null, why: string) => (v === null ? <Dash why={why} /> : <span className="font-mono">{v}%</span>);

function Table({ head, rows, minWidth = 860 }: { head: string[]; rows: ReactNode[][]; minWidth?: number }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" style={{ minWidth }}>
        <thead><tr className="label border-b border-line text-left">{head.map((h) => <th key={h} className="p-2 font-normal">{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} className="border-b border-line last:border-0">{r.map((c, k) => <td key={k} className="p-2 align-top">{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

function NoResults({ what }: { what: string }) {
  return (
    <Card>
      <p className="py-6 text-center text-sm text-grey">No {what} in this period. Try &lsquo;Last month&rsquo; or turn on &lsquo;Include not started&rsquo;.</p>
    </Card>
  );
}

/** A part's stage timeline: every stage, with its own technician. */
function StageTimeline({ steps }: { steps: PartRow[] }) {
  return (
    <Table minWidth={680} head={["#", "Stage", "Technician", "Assigned", "Started", "QC", "Finished", "Allocated", "Effective", "Status"]}
      rows={steps.map((s) => [
        <span key="n" className="font-mono text-grey">{s.stageNo}</span>,
        <span key="s">{s.stage}{s.component ? <span className="block text-xs text-grey">{s.component}</span> : null}</span>,
        s.technician || <Dash key="t" why="No one assigned yet" />,
        <Stamp key="a" at={s.assignedOn} why="Not assigned through the task queue" />,
        <Stamp key="b" at={s.started} why="Not started yet" />,
        s.qcResult ? <span key="q">{s.qcResult}{s.qcAttempts ? <span className="block font-mono text-xs text-grey">{s.qcAttempts} {s.qcAttempts === 1 ? "attempt" : "attempts"}</span> : null}</span>
          : <Dash key="q" why={s.started ? "QC not requested yet" : "Not started yet"} />,
        <Stamp key="f" at={s.finished} why={s.started ? "Not finished yet" : "Not started yet"} />,
        <Alloc key="al" min={s.allocatedMin} />, <Eff key="e" alloc={s.allocatedMin} eff={s.effectiveMin} />,
        s.status,
      ])} />
  );
}

/** Employees tab: one row per task, grouped by employee. */
function EmployeeTable({ people, rows, summary }: { people: { id: string; name: string; department: string }[]; rows: PerfRow[]; summary: Awaited<ReturnType<typeof loadEmployees>>["summary"] }) {
  const head = ["Part · project", "Stage / task", "Assigned", "Started", "Finished", "Allocated", "Effective", "Status · QC"];
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead><tr className="label border-b border-line text-left">{head.map((h) => <th key={h} className="p-2 font-normal">{h}</th>)}</tr></thead>
        {people.map((p) => {
          const s = summary.find((x) => x.personId === p.id)!;
          const mine = rows.filter((r) => r.personId === p.id);
          return (
            <tbody key={p.id}>
              <tr className="border-b border-line bg-panel2">
                <td colSpan={head.length} className="p-2">
                  <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
                    <span className="font-semibold">{p.name}</span><span className="text-grey">{p.department}</span>
                    <span><span className="font-mono">{s.finished}</span> <span className="text-grey">{s.finished === 1 ? "task" : "tasks"} finished</span></span>
                    <span><span className="text-grey">On time</span> {pct(s.onTimePct, "Nothing finished in this period")}</span>
                    <span><span className="text-grey">QC first time</span> {pct(s.firstTimeQcPct, "No QC decisions on finished work")}</span>
                    <span><span className="text-grey">Hours</span> <span className="font-mono">{fmtDur(s.effectiveMin)}</span> <span className="text-grey">of</span> <span className="font-mono">{fmtDur(s.allocatedMin)}</span></span>
                    {leaveSummary(s.absence) !== "None" && <span className="text-grey">{leaveSummary(s.absence)}</span>}
                  </div>
                </td>
              </tr>
              {mine.map((r, i) => (
                <tr key={i} className="border-b border-line">
                  <td className="p-2 align-top">
                    {r.partName ? <><span className="font-mono text-gold">{r.partSerial}</span> {r.partName}</> : <Dash why="Not linked to a part" />}
                    <span className="block text-xs text-grey">{r.project || "No project"}</span>
                  </td>
                  <td className="p-2 align-top">{r.stage && r.stage !== r.task ? `${r.stage} · ${r.task}` : r.task}</td>
                  <td className="p-2 align-top"><Stamp at={r.assignedOn} why="Assigned on the board, not through the task queue" /></td>
                  <td className="p-2 align-top"><Stamp at={r.actualStart} why="Not started yet" /></td>
                  <td className="p-2 align-top"><Stamp at={r.finishedAt} why={r.actualStart ? "Not finished yet" : "Not started yet"} /></td>
                  <td className="p-2 align-top"><Alloc min={r.totalAllocatedMin} />{r.extensions ? <span className="block text-xs text-grey">incl. {r.extensions} extension{r.extensions > 1 ? "s" : ""}</span> : null}</td>
                  <td className="p-2 align-top"><Eff alloc={r.totalAllocatedMin} eff={r.effectiveMin} /></td>
                  <td className="p-2 align-top">{r.status}<span className="block text-xs text-grey">{r.qcResult ? `QC: ${r.qcResult}` : <span title="This work has no QC step">No QC step</span>}</span></td>
                </tr>
              ))}
            </tbody>
          );
        })}
      </table>
    </div>
  );
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<ReportParams> }) {
  const sp = await searchParams;
  const viewer = await requireViewer(["owner", "supervisor"]);
  const w = await loadWorld(viewer);
  const section = ((SECTIONS as readonly string[]).includes(sp.section ?? "") ? sp.section : "employees") as Section;
  const f = readFilter(sp, w.today);
  // Each tab opens on its own remembered filters (per person, per tab).
  const tabHref = (k: Section) => `/reports?section=${k}`;

  let body: ReactNode = null;
  let count: number | null = null;
  let noun = "tasks";
  let fields: Field[] = [];
  if (f && section === "employees") {
    const d = await loadEmployees(w, f);
    const fin = d.rows.filter((r) => r.status === "Finished" && r.finishedAt && r.finishedAt.slice(0, 10) >= f.from && r.finishedAt.slice(0, 10) <= f.to);
    const qc = fin.filter((r) => r.qcResult);
    count = d.rows.length;
    fields = [
      // Employee only (pick one, several or all): every task assigned to them in the period; Status under + More.
      { key: "employee", label: "Employees", kind: "multi", options: d.options.employee },
      { key: "status", label: "Status", kind: "select", options: d.options.status, more: true },
    ];
    body = !d.rows.length ? <NoResults what="employee activity" /> : (
      <>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Tile label="Employees" value={d.people.length} tone="gold" hint="People with any task activity in the period" />
          <Tile label="Tasks finished" value={fin.length} tone="cool" hint="Tasks finished inside the period" />
          <Tile label="On-time %" value={fin.length ? `${Math.round((fin.filter((r) => r.onTime).length / fin.length) * 100)}%` : "—"} tone="grey"
            hint="Finished tasks whose effective time stayed within the allocated time plus the scoring tolerance" />
          <Tile label="First-time QC pass %" value={qc.length ? `${Math.round((qc.filter((r) => r.qcResult === "Passed first time").length / qc.length) * 100)}%` : "—"} tone="grey"
            hint="Finished tasks with a QC step that passed QC on the first attempt" />
        </div>
        <Card><EmployeeTable people={d.people} rows={d.rows} summary={d.summary} /></Card>
      </>
    );
  } else if (f && section === "parts") {
    const { rows, options } = await loadParts(w, f);
    count = rows.length; noun = rows.length === 1 ? "part" : "parts";
    fields = [
      { key: "project", label: "Project", kind: "select", options: options.project },
      { key: "part", label: "Part", kind: "search", options: options.part, placeholder: "Part: serial or name" },
      { key: "stage", label: "Stage", kind: "select", options: options.stage },
      { key: "status", label: "Status", kind: "select", options: options.status },
      { key: "material", label: "Material", kind: "select", options: options.material, more: true },
      { key: "finish", label: "Finish", kind: "select", options: options.finish, more: true },
    ];
    const pass = rows.reduce((n, r) => n + r.qcPassed, 0), fail = rows.reduce((n, r) => n + r.qcFailed, 0);
    body = !rows.length ? <NoResults what="part activity" /> : (
      <>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Tile label="Parts" value={rows.length} tone="gold" hint="Parts with any activity in the period (one row each)" />
          <Tile label="Stages completed" value={rows.reduce((n, r) => n + r.stepsFinished, 0)} tone="cool" hint="Stage steps of these parts finished inside the period" />
          <Tile label="Parts finished" value={rows.filter((r) => r.finishedInPeriod).length} tone="grey" hint="Parts whose last stage finished inside the period" />
          <Tile label="QC attempts" value={pass + fail} sub={`${pass} passed · ${fail} failed`} tone="grey" hint="QC decisions on these parts inside the period" />
        </div>
        <Card>
          <ExpandTable minWidth={680} head={["Part", "Project", "Material · finish", "Current stage", "Stages done", "Allocated", "Effective", "Status"]}
            rows={rows.map((r) => ({
              key: r.partId,
              cells: [
                <span key="p"><span className="font-mono text-gold">{r.serial}</span> {r.part}{r.splitFrom ? <span className="block text-xs text-grey">from {r.splitFrom}</span> : null}</span>,
                r.project,
                materialFinish(r) || <Dash key="m" why="No material or finish recorded for this part" />,
                r.currentStage || <Dash key="c" why="All stages finished" />,
                <span key="g" className="whitespace-nowrap font-mono" title={`${r.stagesDone} of ${r.stagesTotal} stages finished`}>{r.stagesDone}/{r.stagesTotal}</span>,
                <Alloc key="a" min={r.allocatedMin} />, <Eff key="e" alloc={r.allocatedMin} eff={r.effectiveMin} />, r.status,
              ],
              detail: <StageTimeline steps={r.steps} />,
            }))} />
        </Card>
      </>
    );
  } else if (f && section === "projects") {
    const { rows, options } = await loadProjects(w, f);
    count = rows.length; noun = rows.length === 1 ? "project" : "projects";
    fields = [
      { key: "project", label: "Projects", kind: "multi", options: options.project },
      { key: "status", label: "Status", kind: "select", options: options.status },
      { key: "department", label: "Department", kind: "select", options: options.department, more: true },
    ];
    const onTrack = rows.filter((r) => ["On track", "At risk", "Finished"].includes(r.health)).length;
    body = !rows.length ? <NoResults what="project activity" /> : (
      <>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Tile label="Projects" value={rows.length} tone="gold" hint="Projects with any activity in the period" />
          <Tile label="On track" value={onTrack} tone="cool" hint="Forecast finish on or before the delivery date (at risk included), or finished" />
          <Tile label="Late" value={rows.filter((r) => r.health === "Late").length} tone="grey" hint="Forecast finish after the delivery date" />
          <Tile label="Average progress" value={`${Math.round(rows.reduce((n, r) => n + r.progressPct, 0) / rows.length)}%`} tone="grey" hint="Share of each project's stage steps that are finished, averaged" />
        </div>
        <Card>
          <ExpandTable minWidth={700} head={["Project", "Status", "Progress", "Parts done", "Planned", "Forecast", "Allocated", "Effective", "Late steps", "QC fails"]}
            rows={rows.map((r) => ({
              key: r.projectId,
              cells: [
                r.project, <span key="h" className={r.health === "Late" ? "text-bad" : ""}>{r.health}</span>,
                <span key="p" className="grid min-w-24 gap-1"><span className="font-mono">{r.progressPct}%</span><span className="h-1.5 rounded bg-line"><span className="block h-1.5 rounded bg-gold" style={{ width: `${r.progressPct}%` }} /></span></span>,
                <span key="d" className="font-mono">{r.partsDone}/{r.partsTotal}</span>,
                r.planned ? <span key="pl" className="font-mono">{fmtDate(r.planned)}</span> : <Dash key="pl" why="No delivery date set" />,
                r.forecast ? <span key="fc" className={`font-mono ${r.planned && r.forecast > r.planned ? "text-bad" : ""}`}>{fmtDate(r.forecast)}</span> : <Dash key="fc" why="No forecast yet" />,
                <Alloc key="a" min={r.allocatedMin} />, <Eff key="e" alloc={r.allocatedMin} eff={r.effectiveMin} />,
                <span key="l" className="font-mono">{r.delays}</span>, <span key="q" className="font-mono">{r.qcFailures}</span>,
              ],
              detail: (
                <div className="grid gap-3">
                  <p className="text-sm text-grey">Hours by department: {r.byDept.map((d) => `${d.department} ${fmtDur(d.effectiveMin)} of ${fmtDur(d.allocatedMin)}`).join(" · ")}
                    {r.absenceDays ? ` · ${r.absenceDays} absence day${r.absenceDays > 1 ? "s" : ""} on this project` : ""}{r.extensions ? ` · ${r.extensions} extension${r.extensions > 1 ? "s" : ""}` : ""}</p>
                  <Table minWidth={760} head={["Stage", "Department", "Steps done", "Allocated", "Effective", "Late steps", "Extensions", "QC fails"]}
                    rows={r.stages.map((s) => [s.stage, s.department, <span key="d" className="font-mono">{s.stepsDone}/{s.steps}</span>, <Alloc key="a" min={s.allocatedMin} />,
                      <Eff key="e" alloc={s.allocatedMin} eff={s.effectiveMin} />, <span key="l" className="font-mono">{s.delays}</span>,
                      <span key="x" className="font-mono">{s.extensions}</span>, <span key="q" className="font-mono">{s.qcFailures}</span>])} />
                </div>
              ),
            }))} />
        </Card>
      </>
    );
  } else if (f) {
    const { rows, options } = await loadActivity(w, f);
    count = rows.length; noun = rows.length === 1 ? "action" : "actions";
    fields = [
      { key: "who", label: "Who", kind: "multi", options: options.who },
      { key: "action", label: "Action type", kind: "select", options: options.action },
      { key: "item", label: "Item", kind: "search", options: [], placeholder: "Item: part, task, person…" },
      { key: "project", label: "Project", kind: "select", options: options.project, more: true },
    ];
    const pages = Math.max(1, Math.ceil(rows.length / PAGE));
    const page = Math.min(pages, Math.max(1, Number(sp.page) || 1));
    const link = (n: number) => `/reports?${new URLSearchParams(Object.fromEntries(Object.entries({ ...sp, section, page: String(n) }).filter(([, v]) => v)) as Record<string, string>)}`;
    body = !rows.length ? <NoResults what="activity" /> : (
      <>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Tile label="Actions" value={rows.length} tone="gold" hint="Logged actions in the period" />
          <Tile label="People" value={new Set(rows.map((r) => r.who)).size} tone="grey" hint="People (or the system) who made them" />
          <Tile label="Most common" value={[...rows.reduce((mp, r) => mp.set(r.type, (mp.get(r.type) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—"} tone="grey" hint="The action type logged most often" />
          <Tile label="Days with activity" value={new Set(rows.map((r) => r.at.slice(0, 10))).size} tone="grey" hint="Calendar days with at least one action" />
        </div>
        <Card>
          <Table minWidth={700} head={["When", "Who", "Type", "Action", "Item", "Before → after", "Notes"]}
            rows={rows.slice((page - 1) * PAGE, page * PAGE).map((r) => [
              <span key="t" className="whitespace-nowrap font-mono">{fmtStamp(r.at)}</span>,
              <span key="w">{r.who}{r.role ? <span className="block text-xs text-grey">{ROLE[r.role] ?? r.role}</span> : null}</span>,
              r.type, r.what, r.item, r.change ? <span key="c" className="text-grey">{r.change}</span> : <Dash key="c" why="No field changes to show" />,
              r.notes || <Dash key="n" why="No note" />,
            ])} />
          {pages > 1 && (
            <nav className="mt-3 flex items-center justify-between gap-2 text-sm" aria-label="Pages">
              <span className="text-grey">Page {page} of {pages} · newest first</span>
              <span className="flex gap-2">
                {page > 1 ? <Link className="rounded-md border border-line2 px-3 py-2 hover:text-gold" href={link(page - 1)} scroll={false}>‹ Newer</Link> : null}
                {page < pages ? <Link className="rounded-md border border-line2 px-3 py-2 hover:text-gold" href={link(page + 1)} scroll={false}>Older ›</Link> : null}
              </span>
            </nav>
          )}
        </Card>
      </>
    );
  }

  return (
    <div className="grid gap-4 pb-24">
      <PageHead eyebrow="No costs or salaries" title="Reports" />

      <nav className="flex gap-1 overflow-x-auto border-b border-line" aria-label="Report">
        {SECTIONS.map((k) => (
          <Link key={k} href={tabHref(k)} aria-current={section === k ? "page" : undefined}
            className={`display shrink-0 border-b-2 px-3 py-2.5 text-[0.62rem] tracking-[0.16em] ${section === k ? "border-gold text-gold" : "border-transparent text-grey hover:text-ink"}`}>{SECTION_LABEL[k]}</Link>
        ))}
      </nav>

      <FilterBar key={section} mode="url" tab={section} endpoint="/api/export/reports" extra={{ section }} today={w.today} userId={viewer.userId}
        value={Object.fromEntries(Object.entries(sp).filter(([k]) => k !== "section" && k !== "page")) as Record<string, string>}
        fields={fields} notStarted={section !== "activity"} count={count} noun={noun} summaryCsv={section === "employees"} />

      {!f ? <p className="text-sm text-bad">The date range isn&apos;t valid: From must be on or before To.</p> : body}
    </div>
  );
}
