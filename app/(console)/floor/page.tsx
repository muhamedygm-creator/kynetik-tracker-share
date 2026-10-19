import Link from "next/link";
import { FloorDay, type DayLog, type DayPart, type DayPerson } from "@/components/floor/day";
import { Card, PageHead, Pill } from "@/components/ui/primitives";
import { absentOn, awayLabel } from "@/domain/attendance";
import { allItems, describeItem } from "@/domain/conflicts";
import { utilisation, whosOnWhat } from "@/domain/floor";
import { fmtDate } from "@/domain/format";
import { byPosition, durationLabel } from "@/domain/queue";
import { addDays } from "@/domain/time";
import { requireViewer } from "@/lib/auth";
import { loadWorld } from "@/lib/data/world";
import { initials } from "@/lib/photos";
import { createClient } from "@/lib/supabase/server";

const TABS = [
  { key: "day", label: "Day" },
  { key: "who", label: "Who's on what" },
  { key: "week", label: "This week" },
] as const;
const LONG = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const h = (x: number) => `${Math.round(x * 10) / 10}h`;

export default async function FloorPage({ searchParams }: { searchParams: Promise<{ tab?: string; date?: string }> }) {
  const sp = await searchParams;
  const viewer = await requireViewer();
  const w = await loadWorld(viewer);
  const supabase = await createClient();
  const tab = TABS.some((t) => t.key === sp.tab) ? sp.tab! : "day";
  const day = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date! : w.cal.isWorkDay(w.today) ? w.today : w.cal.prevWorkDay(w.today);
  const weekFrom = addDays(day, -6);

  const crew = w.people.filter((p) => p.active && p.costClass === "production");
  const colourOf = (id: string) => w.departments.find((d) => d.id === w.people.find((p) => p.id === id)?.departmentId)?.colour ?? w.settings.labels.otherColour;
  const items = allItems(w.builds.map((b) => b.project));
  const [{ data: att }, { data: logs }, { data: labour }] = await Promise.all([
    supabase.from("attendance").select("*").gte("day", weekFrom).lte("day", day),
    supabase.from("hour_logs").select("*").gte("day", weekFrom).lte("day", day),
    viewer.seesCost ? supabase.from("day_labour").select("*").gte("day", weekFrom).lte("day", day) : Promise.resolve({ data: [] as { day: string; person_id: string; cost: number }[] }),
  ]);
  const href = (q: Record<string, string>) => `/floor?${new URLSearchParams({ tab, date: day, ...q })}`;

  // ───── Day ─────
  const people: DayPerson[] = crew.map((p) => {
    const a = absentOn(w.absences, p.id, day);
    return {
      id: p.id, name: p.name, initials: initials(p.name), colour: colourOf(p.id), present: !a,
      away: a ? { id: a.id, version: w.versions[a.id], kind: a.kind, startsOn: a.startsOn, days: a.days, note: a.note, label: awayLabel(a) } : null,
      pending: w.queue.filter((t) => t.personId === p.id && t.status !== "done").sort(byPosition)
        .map((t) => ({ id: t.id, title: t.title, duration: durationLabel(t, w.cal.dayHours), status: t.status })),
    };
  });
  const parts: DayPart[] = items
    .filter((r) => r.item.status === "doing" || r.item.status === "blocked")
    .map((r) => {
      const d = describeItem(r);
      const tech = w.people.find((p) => p.id === r.item.tech)?.name;
      return { id: r.item.id, label: `${d.part}${tech ? ` · ${tech}` : ""}`, group: `${d.serial} · ${d.stage}`, tech: r.item.tech, status: r.item.status as "doing" | "blocked" };
    });
  const dayLogs: DayLog[] = (logs ?? []).filter((l) => l.day === day).map((l) => ({ key: l.id, personId: l.person_id, workItemId: l.work_item_id, hours: Number(l.hours) }));
  const dayLabour = viewer.seesCost ? (labour ?? []).filter((x) => x.day === day).reduce((s, x) => s + Number(x.cost), 0) : null;

  return (
    <div className="grid gap-4">
      <PageHead eyebrow={tab === "day" ? LONG.format(new Date(day)) : `Week to ${fmtDate(day)}`} title="Floor log">
        <Link className="font-mono text-sm text-grey hover:text-gold" href={href({ date: w.cal.prevWorkDay(day) })}>← prev</Link>
        <form action="/floor" className="flex items-center gap-2">
          <input type="hidden" name="tab" value={tab} />
          <input type="date" name="date" defaultValue={day} className="rounded-md border border-line2 bg-panel2 px-2 py-1 font-mono text-sm" aria-label="Date" />
          <button className="font-mono text-sm text-gold">Go</button>
        </form>
        <Link className="font-mono text-sm text-grey hover:text-gold" href={href({ date: w.cal.nextWorkDay(day) })}>next →</Link>
      </PageHead>

      <nav className="flex gap-1 border-b border-line">
        {TABS.map((t) => (
          <Link key={t.key} href={href({ tab: t.key })}
            className={`display border-b-2 px-3 py-2.5 text-[0.62rem] tracking-[0.16em] ${tab === t.key ? "border-gold text-gold" : "border-transparent text-grey hover:text-ink"}`}>{t.label}</Link>
        ))}
      </nav>

      {tab === "day" && (
        w.cal.isWorkDay(day)
          ? <FloorDay key={`${day}:${dayLogs.map((l) => `${l.key}${l.hours}`).join()}:${people.map((p) => +p.present).join("")}`}
              day={day} canWrite={viewer.canWrite} dayHours={w.cal.dayHours} step={w.settings.floor.logStepH}
              people={people} parts={parts} logs={dayLogs} inWorkCount={items.filter((r) => r.item.status === "doing").length}
              labour={dayLabour === null ? null : { value: dayLabour, currency: w.currency ?? "AED" }}
              calendar={w.settings.calendar} holidays={w.settings.holidays} crew={crew.filter((x) => !x.away).map((x) => ({ id: x.id, name: x.name }))} />
          : <Card className="p-6 text-grey">{fmtDate(day)} is a rest day or public holiday.</Card>
      )}

      {tab === "who" && (() => {
        const projects = w.builds.map((b) => b.project);
        // Part-steps with no technician in a live stage (a stage with a part in progress).
        const unassigned = projects.reduce((n, pr) => n + pr.work.filter((x) => !x.tech && x.status !== "done" &&
          pr.work.some((y) => y.stageId === x.stageId && y.status === "doing")).length, 0);
        return (
          <div className="grid gap-3">
            {unassigned > 0 && <p className="rounded-md border border-warn p-3 text-sm text-warn">{unassigned} part-step(s) in live stages have no technician.</p>}
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {crew.map((p) => {
                const x = whosOnWhat(p.id, projects, w.cal, w.now);
                return (
                  <Card key={p.id} className="p-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-lg">{p.name}</span>
                      {x.idle ? <Pill>idle</Pill> : <Pill tone="gold">{x.inWork.length} in work</Pill>}
                    </div>
                    <p className="mt-1 font-mono text-xs text-grey">{x.open} open · {h(x.queuedH)} queued</p>
                    {Object.keys(x.perStage).length > 0 && (
                      <p className="mt-1 text-xs text-grey">{Object.entries(x.perStage).map(([s, n]) => `${s} ${n}`).join(" · ")}</p>
                    )}
                    <ul className="mt-2 grid gap-1 text-sm">
                      {x.inWork.map((i, k) => <li key={k}><span className="font-mono text-gold">{i.serial}</span> {i.stage} · {i.part}</li>)}
                    </ul>
                  </Card>
                );
              })}
            </div>
          </div>
        );
      })()}

      {tab === "week" && (() => {
        const days: string[] = [];
        for (let d = weekFrom; d <= day; d = addDays(d, 1)) if (w.cal.isWorkDay(d)) days.push(d);
        const rows = crew.map((p) => {
          const mine = (logs ?? []).filter((l) => l.person_id === p.id);
          const daysIn = days.filter((d) => !absentOn(w.absences, p.id, d) && (att?.some((a) => a.day === d && a.person_id === p.id && a.present) || mine.some((l) => l.day === d))).length;
          const hours = mine.reduce((s, l) => s + Number(l.hours), 0);
          const u = utilisation(hours, daysIn, w.cal.dayHours, w.settings.scoring);
          const builds = [...new Set(mine.map((l) => w.builds.find((b) => b.project.id === l.project_id)?.project.serial).filter(Boolean))];
          const cost = viewer.seesCost ? (labour ?? []).filter((x) => x.person_id === p.id).reduce((s, x) => s + Number(x.cost), 0) : null;
          return { p, daysIn, hours, u, builds, cost };
        });
        return (
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="label border-b border-line text-left">
                  <th className="p-3">Crew member</th><th className="p-3 text-right">Days in</th><th className="p-3 text-right">Hours</th>
                  <th className="p-3 text-right">Utilisation</th>{viewer.seesCost && <th className="p-3 text-right">Cost {w.currency}</th>}<th className="p-3">Builds</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.p.id} className="border-b border-line last:border-0">
                    <td className="p-3">{r.p.name}</td>
                    <td className="p-3 text-right font-mono">{r.daysIn}</td>
                    <td className="p-3 text-right font-mono">{h(r.hours)}</td>
                    <td className={`p-3 text-right font-mono ${r.u.warn ? "text-warn" : ""}`}>{r.u.pct === null ? "—" : `${Math.round(r.u.pct)}%`}</td>
                    {viewer.seesCost && <td className="p-3 text-right font-mono">{Math.round(r.cost ?? 0).toLocaleString("en-US")}</td>}
                    <td className="p-3 font-mono text-gold">{r.builds.join(" · ") || <span className="text-grey">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="p-3 text-xs text-grey">Working days {fmtDate(days[0] ?? day)} – {fmtDate(day)}. Utilisation = hours ÷ (days in × {w.cal.dayHours}h); amber below {w.settings.scoring.utilisationWarnPct}%.</p>
          </Card>
        );
      })()}

      <Card className="grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] md:items-center">
        <div className="grid gap-1.5">
          <h2 className="eyebrow">Floor camera · next phase</h2>
          <p className="text-sm text-grey">A later phase connects a floor camera here: who is at which station, working and idle time, and a daily report that checks it against this log. It needs its own plan and privacy rules before it is built.</p>
        </div>
        <div className="grid aspect-[16/6] max-w-full place-items-center rounded-xl border border-dashed border-line2 bg-[repeating-linear-gradient(45deg,var(--panel3)_0_10px,var(--panel)_10px_20px)] text-center">
          <span className="display text-[0.7rem] tracking-[0.2em] text-grey">Camera not connected</span>
        </div>
      </Card>
    </div>
  );
}
