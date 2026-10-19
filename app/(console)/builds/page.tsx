import Link from "next/link";
import { BuildsTable, type BuildRow } from "@/components/build/builds-table";
import { btn } from "@/components/ui/buttons";
import { Card, PageHead } from "@/components/ui/primitives";
import { fmtDate } from "@/domain/format";
import { projectPct, stageAgg } from "@/domain/schedule";
import { requireViewer } from "@/lib/auth";
import { boardAlerts } from "@/lib/data/derived";
import { loadWorld } from "@/lib/data/world";

const LONG_DATE = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

/** Builds home (docs/ROADMAP.md v1.2): today at a glance, what needs attention, every build grouped by status. */
export default async function BuildsPage() {
  const viewer = await requireViewer();
  const w = await loadWorld(viewer);
  const open = w.builds.filter((b) => b.project.status !== "done");
  const late = open.filter((b) => b.health === "late");
  const items = open.flatMap((b) => b.project.work);
  const doing = items.filter((x) => x.status === "doing").length;
  const blocked = items.filter((x) => x.status === "blocked").length;
  const next = open
    .filter((b) => b.project.deliveryDate && b.project.deliveryDate >= w.today)
    .sort((a, b) => a.project.deliveryDate!.localeCompare(b.project.deliveryDate!))[0];
  const { alerts, doubleBookings } = boardAlerts(w);
  const deptColour = (pid: string) => w.departments.find((d) => d.id === w.people.find((p) => p.id === pid)?.departmentId)?.colour ?? "#c9c9c9";

  // Attention: everything except per-pair double-bookings, which are grouped per person below.
  const attention = alerts.filter((a) => a.type !== "techDoubleBooked").slice(0, 5);
  const overlaps = new Map<string, number>();
  for (const c of doubleBookings) overlaps.set(c.tech, (overlaps.get(c.tech) ?? 0) + 1);
  const nameOf = (id: string) => w.people.find((p) => p.id === id)?.name ?? "Someone";

  const rows: BuildRow[] = w.builds.map((b) => {
    const p = b.project;
    const live = p.stages.filter((s) => {
      const a = stageAgg(p, s);
      return (a.pct > 0 && a.pct < 1) || p.work.some((x) => x.stageId === s.id && x.status === "doing");
    });
    const crewIds = [...new Set(p.work.filter((x) => x.tech && x.status !== "done").map((x) => x.tech!))];
    return {
      id: p.id, version: w.versions[p.id], serial: p.serial, name: p.name, client: b.client, status: p.status,
      stageNow: p.status === "done" ? (p.deliveredOn ? `Delivered ${fmtDate(p.deliveredOn)}` : "Delivered") : live.length ? live.map((s) => s.name).join(" · ") : p.status === "planned" ? `Starts ${fmtDate(p.startDate)}` : "—",
      health: (p.status === "done" ? "done" : b.health) as BuildRow["health"],
      pct: Math.round(projectPct(p) * 100), partsDone: p.work.filter((x) => x.status === "done").length, partsTotal: p.work.length,
      forecast: b.forecast.finish ? fmtDate(b.forecast.finish) : null, promised: p.deliveryDate ? fmtDate(p.deliveryDate) : null,
      crew: crewIds.map((id) => ({ name: nameOf(id), initial: nameOf(id)[0], colour: deptColour(id) })),
    };
  });
  const glance = [
    { n: late.length, label: late.length === 1 ? "build late against its promise" : "builds late against their promise", tone: late.length ? "var(--bad)" : "var(--ok)" },
    { n: doing, label: doing === 1 ? "part being worked on" : "parts being worked on", tone: "var(--gold)" },
    { n: blocked, label: blocked === 1 ? "part blocked" : "parts blocked", tone: blocked ? "var(--bad)" : "var(--grey2)" },
    { n: next ? fmtDate(next.project.deliveryDate!) : "—", label: next ? `next handover · ${next.project.serial}` : "no promised dates yet", tone: "var(--cool)" },
  ];

  return (
    <div className="grid gap-6">
      <PageHead eyebrow={LONG_DATE.format(new Date(w.today))} title="Projects">
        <span className="text-sm text-grey">{late.length ? `${late.length} need${late.length === 1 ? "s" : ""} attention` : "Everything on track"}</span>
        {viewer.canWrite && <Link href="/builds/new" className={btn.primary}>New project</Link>}
      </PageHead>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Today at a glance">
        {glance.map((g) => (
          <div key={g.label} className="flex items-center gap-3 rounded-xl border border-line bg-panel px-4 py-3.5">
            <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: g.tone }} />
            <div className="min-w-0">
              <div className="font-mono text-2xl leading-tight">{g.n}</div>
              <div className="truncate text-sm text-grey">{g.label}</div>
            </div>
          </div>
        ))}
      </div>

      {(attention.length > 0 || overlaps.size > 0) && (
        <Card className="p-4">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="eyebrow">Needs attention</h2>
            {doubleBookings.length > 0 && <Link href="/builds/health" className="text-sm text-gold hover:underline">Data health · {doubleBookings.length} overlap{doubleBookings.length === 1 ? "" : "s"} →</Link>}
          </div>
          <ul className="grid gap-1.5">
            {attention.map((a, i) => (
              <li key={i} className="flex gap-3 text-sm">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: a.severity === "bad" ? "var(--bad)" : "var(--warn)" }} />
                {a.projectId ? <Link className="hover:text-gold" href={`/builds/${a.projectId}`}>{a.message}</Link> : <span>{a.message}</span>}
              </li>
            ))}
            {[...overlaps].map(([tech, n]) => (
              <li key={tech} className="flex gap-3 text-sm">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: "var(--bad)" }} />
                <Link href="/builds/health" className="hover:text-gold">{nameOf(tech)} is booked on two part steps at the same time ({n} overlap{n === 1 ? "" : "s"})</Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {rows.length ? <BuildsTable rows={rows} canWrite={viewer.canWrite} /> : (
        <Card className="p-8 text-center">
          <p className="text-lg">No builds yet.</p>
          <p className="mt-1 text-sm text-grey">A build is one car or programme: pick a template and its stages, tasks and parts are set up for you.</p>
        </Card>
      )}
    </div>
  );
}
