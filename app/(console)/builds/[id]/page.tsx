import Link from "next/link";
import { notFound } from "next/navigation";
import { AddStage, BuildActions, StageActions } from "@/components/build/build-actions";
import { MiniTimeline, slipText, stationColour } from "@/components/build/strip";
import { TaskTable, type TaskView } from "@/components/build/tasks";
import { Matrix, PartsTable, type ItemView } from "@/components/build/workspace";
import { StageBoard } from "@/components/build/stage-board";
import { PartsTree, type TreePart } from "@/components/parts/parts-tree";
import { HealthPill, type HealthKey } from "@/components/build/builds-table";
import { Card, Pill, Tile } from "@/components/ui/primitives";
import { allItems, busyLabel, techDoubleBookings } from "@/domain/conflicts";
import { fmtDT, fmtDate, fmtH } from "@/domain/format";
import { stageAgg } from "@/domain/schedule";
import { modelSummary } from "@/domain/model";
import { partLabel, partProgress, partTree } from "@/domain/parts";
import { componentLabel, needsMoldCount, reworkH, startBlocker } from "@/domain/qc";
import type { Project } from "@/domain/types";
import { actualH, standardH } from "@/domain/work";
import { requireViewer } from "@/lib/auth";
import { findBuild, loadWorld } from "@/lib/data/world";
import { renderUrls } from "@/lib/photos";
import { createClient } from "@/lib/supabase/server";

const TABS = [
  { key: "board", label: "Board" },
  { key: "parts", label: "Parts" },
  { key: "stages", label: "Parts table" },
  { key: "matrix", label: "Parts matrix" },
  { key: "tasks", label: "Tasks" },
] as const;

export default async function BuildPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; stage?: string }>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const viewer = await requireViewer();
  const w = await loadWorld(viewer);
  const view = findBuild(w, id);
  if (!view) notFound();
  const { project: p, forecast: f } = view;
  // New workflow projects have a Parts tree and no stage tasks; old ones keep their tabs as they were.
  const tabs = TABS.filter((t) => (p.gated ? t.key !== "tasks" : t.key !== "parts"));
  const tab = tabs.some((t) => t.key === sp.tab) ? sp.tab! : "board";
  const stage = p.stages.find((s) => s.id === sp.stage) ?? p.stages[0];
  const labels = w.settings.labels;
  const world = allItems(w.builds.map((b) => b.project));
  const nameOf = (pid: string | null) => (pid ? w.people.find((x) => x.id === pid)?.name ?? "" : "");
  const production = w.people.filter((x) => x.active && x.costClass === "production");
  const peopleOptions = production.map((x) => ({ id: x.id, label: busyLabel(x, world) }));

  // New workflow: parts go by serial too (two units of one part share a name).
  const partName = (id: string) => { const x = p.parts.find((y) => y.id === id); return x ? (p.gated ? partLabel(x) : x.name) : "?"; };
  const namedParts = p.parts.map((x) => ({ id: x.id, name: partName(x.id) }));
  const items: ItemView[] = p.work.map((it) => {
    const st = p.stages.find((s) => s.id === it.stageId)!;
    return {
      id: it.id, version: w.versions[it.id], stageId: it.stageId, stageName: st.name, partId: it.partId,
      partName: partName(it.partId), status: it.status, tech: it.tech, techName: nameOf(it.tech),
      start: it.start, end: it.end, startLabel: it.start ? fmtDT(it.start) : "—", endLabel: it.end ? fmtDT(it.end) : "—",
      std: standardH(it, st), planH: it.planH, actual: actualH(it, w.cal, w.now), rework: it.rework, reworkLog: it.reworkLog,
      hours: it.hours, notes: it.notes,
      qcSince: it.qcSince ? fmtDT(it.qcSince) : null, component: componentLabel(it), attempt: it.attempt ?? 1,
      blocker: it.status === "todo" ? startBlocker(p, it) : null, reworkH: reworkH(it, w.cal, w.now),
    };
  });
  const partOrder = new Map(p.parts.map((x, i) => [x.id, i]));
  const compNo = new Map(p.work.map((x) => [x.id, x.componentNo ?? 0]));
  items.sort((a, b) => (partOrder.get(a.partId) ?? 0) - (partOrder.get(b.partId) ?? 0) || (compNo.get(a.id) ?? 0) - (compNo.get(b.id) ?? 0));

  const tasks: TaskView[] = [...p.tasks].sort((a, b) => a.num - b.num).map((t) => {
    const base = p.baseline[t.id];
    const fc = f.tasks[t.id];
    const v = base && fc ? w.cal.wh(base.end, fc.end) : null;
    return {
      id: t.id, version: w.versions[t.id], num: t.num, stageId: t.stageId, stageName: p.stages.find((s) => s.id === t.stageId)?.name ?? "",
      name: t.name, assignee: t.assignee, assigneeName: nameOf(t.assignee), status: t.status, durH: t.durH, pct: t.pct,
      start: t.start, end: t.end, startLabel: t.start ? fmtDT(t.start) : "—", endLabel: t.end ? fmtDT(t.end) : "—",
      forecastLabel: fc ? fmtDT(fc.end) : "—",
      varLabel: v === null ? "—" : Math.abs(v) < 0.05 ? "on plan" : `${v > 0 ? "+" : "−"}${fmtH(Math.abs(v))}`,
      varTone: v === null ? "" : v > 0.05 ? "bad" : v < -0.05 ? "ok" : "", pinned: !!t.pinnedStart, notes: t.notes,
    };
  });

  const renders = tab === "parts" && p.gated ? await renderUrls(await createClient(), p.parts.map((x) => x.model?.renderPath ?? null)) : {};
  const common = { projectId: p.id, canWrite: viewer.canWrite, gated: !!p.gated, statusLabels: labels.itemStatus, people: peopleOptions };
  const doneSteps = p.work.filter((x) => x.status === "done").length;
  const myClashes = techDoubleBookings(world, w.settings.booking.techMode, w.now).filter((c) => c.a.project.id === p.id || c.b.project.id === p.id);
  const href = (q: Record<string, string>) => `/builds/${p.id}?${new URLSearchParams({ tab, ...(stage ? { stage: stage.id } : {}), ...q })}`;

  return (
    <div className="grid gap-5">
      <div>
        <Link href="/builds" className="label hover:text-gold">← Projects</Link>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="eyebrow mb-1">{view.templateLabel || "Build"}{view.client ? ` · ${view.client}` : ""}</p>
            <h1 className="display text-2xl"><span className="font-mono normal-case tracking-normal text-gold">{p.serial}</span> {p.name}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Pill colour={p.status === "active" ? "var(--gold)" : undefined}>{labels.projectStatus[p.status].label}</Pill>
            {p.status !== "done" && <HealthPill health={view.health as HealthKey} />}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <BuildActions canWrite={viewer.canWrite} gated={!!p.gated} b={{
            id: p.id, version: w.versions[p.id], serial: p.serial, name: p.name, client: view.client, notes: view.notes,
            status: p.status, startDate: p.startDate, deliveryDate: p.deliveryDate, parts: p.parts.map((x) => x.name),
          }} />
        </div>
        {view.notes && <p className="mt-3 max-w-[62ch] text-sm text-grey">{view.notes}</p>}
      </div>

      {myClashes.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-bad/60 bg-panel px-4 py-2.5 text-sm">
          <span><span className="font-semibold text-bad">Overlaps:</span> {[...new Set(myClashes.map((c) => nameOf(c.tech)))].join(", ")} {myClashes.length === 1 ? "is" : "are"} booked on two part steps at once ({myClashes.length}).</span>
          <Link href="/builds/health" className="text-gold hover:underline">See Data health →</Link>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Forecast finish" value={f.finish ? fmtDate(f.finish) : "—"}
          sub={p.gated && view.unplanned ? `${view.unplanned} ${view.unplanned === 1 ? "step" : "steps"} not planned yet` : f.finish ? `at ${f.finish.slice(11, 16)}` : "no plan yet"} tone={view.health === "late" ? "bad" : view.health === "risk" ? "warn" : "ok"} />
        <Tile label="Promised" value={p.deliveryDate ? fmtDate(p.deliveryDate) : "not set"} sub={p.deliveryDate ? (view.health === "late" ? "forecast is later" : view.health === "risk" ? "little time to spare" : "forecast is in time") : "set it with Edit"} tone={view.health === "late" ? "bad" : view.health === "risk" ? "warn" : "grey"} />
        <Tile label="Part steps done" value={`${doneSteps} / ${p.work.length}`} sub={`vs baseline ${slipText(f.slipH)}`} tone="cool" />
        {viewer.seesCost
          ? <Tile label={`Labour cost ${w.currency}`} value={Math.round(view.labour ?? 0).toLocaleString("en-US")} sub="from floor log" tone="gold" />
          : p.gated
            ? <Tile label="Parts complete" value={`${treeParts(p, w.versions).reduce((n, x) => n + (x.folder ? x.children : [x]).filter((c) => c.total && c.done === c.total).length, 0)} / ${p.parts.length}`} tone="grey" />
            : <Tile label="Tasks done" value={`${p.tasks.filter((t) => t.status === "done").length} / ${p.tasks.length}`} tone="grey" />}
      </div>

      <Card className="p-4"><MiniTimeline view={view} world={w} /></Card>

      <nav className="flex gap-1 border-b border-line">
        {tabs.map((t) => (
          <Link key={t.key} href={href({ tab: t.key })}
            className={`display border-b-2 px-3 py-2.5 text-[0.62rem] tracking-[0.16em] ${tab === t.key ? "border-gold text-gold" : "border-transparent text-grey hover:text-ink"}`}>
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "parts" && (
        <PartsTree projectId={p.id} projectSerial={p.serial} parts={treeParts(p, w.versions, renders)} history={splitHistory(p, w.settings.calendar.timezone)} canWrite={viewer.canWrite}
          materials={labels.materials} sheens={labels.sheens} />
      )}

      {tab === "board" && (
        <StageBoard c={common} parts={namedParts} items={items}
          moldCounts={needsMoldCount(p).map((m) => { const part = p.parts.find((x) => x.id === m.partId)!; return { partId: m.partId, label: part.serial ?? part.name }; })}
          stages={p.stages.map((s) => ({ id: s.id, name: s.name, stdH: s.partHours, colour: stationColour(w, s.stationType), station: w.stations.find((x) => x.id === s.stationId)?.name ?? null }))}
          techColour={Object.fromEntries(w.people.map((x) => [x.id, w.departments.find((d) => d.id === x.departmentId)?.colour ?? "#c9c9c9"]))} />
      )}

      {tab === "stages" && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {p.stages.map((s) => {
              const a = stageAgg(p, s);
              const c = stationColour(w, s.stationType);
              const active = s.id === stage?.id;
              return (
                <Link key={s.id} href={href({ stage: s.id })}
                  className={`min-w-36 rounded-md border px-3 py-2 ${active ? "border-gold bg-panel2" : "border-line bg-panel hover:border-line2"}`}>
                  <div className="truncate text-sm">{s.name}</div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full" style={{ background: `${c}33` }}>
                    <div className="h-full" style={{ width: `${a.pct * 100}%`, background: c }} />
                  </div>
                  <div className="mt-1 font-mono text-xs text-grey">{Math.round(a.pct * 100)}%</div>
                </Link>
              );
            })}
            {viewer.canWrite && <AddStage projectId={p.id} stationTypes={w.stationTypes} stations={w.stations} />}
          </div>

          {stage && (() => {
            const a = stageAgg(p, stage);
            const st = items.filter((x) => x.stageId === stage.id);
            const count = (s: string) => st.filter((x) => x.status === s).length;
            const station = w.stations.find((x) => x.id === stage.stationId);
            return (
              <Card>
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line p-4">
                  <div>
                    <h2 className="display text-lg">{stage.name}</h2>
                    <p className="mt-1 font-mono text-sm text-grey">
                      {station?.name ?? "No workstation"} · std {fmtH(stage.partHours)}/part · {a.start ? `${fmtDT(a.start)} → ${fmtDT(a.end!)}` : "not scheduled"}
                    </p>
                  </div>
                  <StageActions projectId={p.id} canWrite={viewer.canWrite} stations={w.stations} people={peopleOptions}
                    s={{ id: stage.id, version: w.versions[stage.id], name: stage.name, stationType: stage.stationType, stationId: stage.stationId, partHours: stage.partHours }} />
                </div>
                <div className="grid grid-cols-2 gap-3 border-b border-line p-4 sm:grid-cols-5">
                  <Tile label="Parts" value={st.length} />
                  <Tile label={labels.itemStatus.todo.label} value={count("todo")} />
                  <Tile label={labels.itemStatus.doing.label} value={count("doing")} tone="gold" />
                  <Tile label={labels.itemStatus.blocked.label} value={count("blocked")} tone={count("blocked") ? "bad" : "grey"} />
                  <Tile label={labels.itemStatus.done.label} value={count("done")} tone="ok" />
                </div>
                <PartsTable items={st} c={common} />
                <div className="border-t border-line">
                  <h3 className="eyebrow px-4 pt-4">Stage tasks</h3>
                  <TaskTable projectId={p.id} canWrite={viewer.canWrite} tasks={tasks} stageFilter={stage.id}
                    stages={p.stages.map((s) => ({ id: s.id, name: s.name }))} people={production} statusLabels={labels.itemStatus} />
                </div>
              </Card>
            );
          })()}
        </>
      )}

      {tab === "matrix" && (
        <Card className="p-3">
          <Matrix parts={namedParts} stages={p.stages.map((s) => ({ id: s.id, name: s.name }))} items={items} c={common} />
        </Card>
      )}

      {tab === "tasks" && (
        <Card>
          <TaskTable projectId={p.id} canWrite={viewer.canWrite} tasks={tasks}
            stages={p.stages.map((s) => ({ id: s.id, name: s.name }))} people={production} statusLabels={labels.itemStatus} />
        </Card>
      )}
    </div>
  );
}

/** The Parts tab rows: each part with where it is now, folders with their sub-parts (amends AM-04). */
function treeParts(p: Project, versions: Record<string, number>, renders: Record<string, string> = {}): TreePart[] {
  const order = new Map(p.stages.map((s, i) => [s.id, i]));
  const one = (x: Project["parts"][number], folder: boolean, children: TreePart[]): TreePart => {
    const pr = partProgress(p, x.id);
    const mine = p.work.filter((w) => w.partId === x.id).sort((a, b) => (order.get(a.stageId) ?? 0) - (order.get(b.stageId) ?? 0));
    const next = mine.find((w) => w.status !== "done");
    const at = folder
      ? `${children.filter((c) => c.total && c.done === c.total).length} of ${children.length} sub-parts complete`
      : pr.complete ? "Complete" : next ? p.stages.find((s) => s.id === next.stageId)?.name ?? "" : "";
    return {
      id: x.id, version: versions[x.id], serial: x.serial ?? null, name: x.name, description: x.description ?? "",
      material: x.material ?? null, finishColour: x.finishColour ?? null, finishSheen: x.finishSheen ?? null, unitNo: x.unitNo ?? null,
      folder, started: folder ? children.some((c) => c.started) : mine.some((w) => w.status !== "todo"),
      at, done: pr.done, total: pr.total, children,
      model: modelSummary(x.model), renderUrl: x.model?.renderPath ? renders[x.model.renderPath] ?? null : null,
    };
  };
  // A part split in My Models (AM-18, AM-23) leaves the list: its sub-parts take its place (history below the table).
  return partTree(p).flatMap((n) => (n.folder && n.part.splitAt ? n.children.map((c) => one(c, false, []))
    : [one(n.part, n.folder, n.children.map((c) => one(c, false, [])))]));
}

/** Parts split after modelling: the original, its model data and the sub-parts it became (history). */
function splitHistory(p: Project, tz: string) {
  return (p.folders ?? []).filter((f) => f.splitAt).map((f) => ({
    serial: f.serial ?? "", name: f.name, model: modelSummary(f.model),
    into: p.parts.filter((c) => c.parentId === f.id).map((c) => c.serial ?? "").sort(),
    at: new Date(f.splitAt!).toLocaleDateString("en-GB", { timeZone: tz, day: "numeric", month: "short", year: "numeric" }),
  }));
}
