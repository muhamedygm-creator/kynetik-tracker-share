import { redirect } from "next/navigation";
import Link from "next/link";
import { BoardHelper, type HelperData } from "@/components/board/helper";
import { DashboardView } from "@/components/overview/dashboard-view";
import { DataView } from "@/components/overview/data-view";
import { OverviewTabs } from "@/components/overview/tabs";
import { Card, PageHead } from "@/components/ui/primitives";
import { morningBrief, type BriefStep } from "@/domain/brief";
import { fmtDate, fmtHM } from "@/domain/format";
import { requireViewer } from "@/lib/auth";
import { loadWorld } from "@/lib/data/world";
import { initials } from "@/lib/photos";
import { createClient } from "@/lib/supabase/server";

const LONG_DATE = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const DAY = new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: "UTC" });
const hm = (dt: string) => dt.slice(11, 16);
const SHOW = 6;

/** Board (v2): the morning brief the Owner opens first. Where work stopped, how today starts, what to decide. */
export default async function BoardPage({ searchParams }: {
  searchParams: Promise<{ tab?: string; weeks?: string; project?: string; stage?: string; tech?: string; material?: string }>;
}) {
  const sp = await searchParams;
  const viewer = await requireViewer();
  if (viewer.role === "modeller") redirect("/models"); // a Modeller starts on their own steps
  const w = await loadWorld(viewer);
  // Overview (amends AM-12): Today (the morning brief), Dashboard and Data on one page.
  if (sp.tab === "dashboard") return <DashboardView w={w} sp={sp} tabs={<OverviewTabs tab="dashboard" />} />;
  if (sp.tab === "data") return <DataView w={w} f={sp} tabs={<OverviewTabs tab="data" />} />;
  const brief = morningBrief({
    builds: w.builds.map((b) => ({ project: b.project, health: b.health, forecastFinish: b.forecast.finish })),
    people: w.people.map((p) => ({ id: p.id, name: p.name, departmentId: p.departmentId, active: p.active, production: p.costClass === "production" })),
    departments: w.departments,
    queue: w.queue,
    cal: w.cal, calFor: w.calFor,
    now: w.now,
  });

  // Today's notices (all departments), same rules as the TV.
  const { data: noticeRows } = await (await createClient()).from("notices").select("*").eq("active", true).order("sort");
  const notices = (noticeRows ?? [])
    .filter((n) => (!n.starts_on || n.starts_on <= w.today) && (!n.ends_on || n.ends_on >= w.today))
    .map((n) => ({ id: n.id as string, icon: n.icon as string, title: n.title as string, at: n.daily_at ? String(n.daily_at).slice(0, 5) : null,
      dept: w.departments.find((d) => d.id === n.department_id)?.name ?? "All departments" }));

  const idle = brief.people.filter((p) => !p.tasks.length);
  const lastDayName = DAY.format(new Date(brief.lastDay));
  const working = brief.people.filter((p) => p.plannedH > 0).length;
  const tiles = [
    { n: brief.finished.length, label: `part steps finished ${lastDayName}`, tone: "var(--ok)" },
    { n: brief.inProgress.length, label: "in progress, carry on today", tone: "var(--gold)" },
    { n: brief.blocked.length, label: brief.blocked.length === 1 ? "part step blocked" : "part steps blocked", tone: brief.blocked.length ? "var(--bad)" : "var(--grey2)" },
    { n: fmtHM(brief.plannedH), label: `planned today across ${working} ${working === 1 ? "person" : "people"}`, tone: "var(--cool)" },
  ];

  const helper: HelperData = {
    canWrite: viewer.canWrite,
    today: w.today,
    lastDayName,
    people: brief.people.map((p) => ({ ...p, initials: initials(p.name) })),
    departments: w.departments.map((d) => ({ id: d.id, key: d.key, name: d.name })),
    waiting: brief.waiting,
    builds: brief.builds,
    finished: brief.finished,
    blocked: brief.blocked,
    inProgress: brief.inProgress,
  };

  return (
    <div className="grid gap-6">
      <PageHead eyebrow={`Morning brief · ${LONG_DATE.format(new Date(w.today))}`} title="Overview">
        <span className="text-sm text-grey">Updated {hm(w.now)} · the day starts {hm(brief.dayStart)}</span>
      </PageHead>
      <OverviewTabs tab="today" />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="The day at a glance">
        {tiles.map((t) => (
          <div key={t.label} className="flex items-center gap-3 rounded-xl border border-line bg-panel px-4 py-3.5">
            <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: t.tone }} />
            <div className="min-w-0">
              <div className="font-mono text-2xl leading-tight">{t.n}</div>
              <div className="text-sm text-grey">{t.label}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <div className="grid content-start gap-5">
          <Card className="p-4">
            <h2 className="eyebrow mb-3">Recommendations</h2>
            {brief.recommendations.length === 0 ? (
              <p className="text-sm text-grey">Nothing needs a decision. Every build is on track and every waiting step is planned.</p>
            ) : (
              <ul className="grid gap-2">
                {brief.recommendations.slice(0, 8).map((r, i) => (
                  <li key={i} className="flex gap-3 text-sm">
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: r.severity === "bad" ? "var(--bad)" : r.severity === "warn" ? "var(--warn)" : "var(--cool)" }} />
                    {r.href ? <Link href={r.href} className="hover:text-gold">{r.text}</Link> : <span>{r.text}</span>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card className="p-4">
            <h2 className="eyebrow mb-3">Where work stopped · {lastDayName} {fmtDate(brief.lastDay)}</h2>
            {brief.inProgress.length + brief.blocked.length + brief.finished.length === 0 ? (
              <p className="text-sm text-grey">Nothing was finished, started or blocked on the last working day.</p>
            ) : (
              <ul className="grid">
                {brief.blocked.slice(0, SHOW).map((s, i) => <StepRow key={`b${i}`} s={s} pill="Blocked" tone="bad" note="waiting on something" />)}
                {brief.inProgress.slice(0, SHOW).map((s, i) => <StepRow key={`p${i}`} s={s} pill="In progress" tone="gold" note={s.at ? `since ${fmtDate(s.at)} ${hm(s.at)}` : ""} />)}
                {brief.finished.slice(0, SHOW).map((s, i) => <StepRow key={`f${i}`} s={s} pill="Finished" tone="ok" note={s.at ? `${hm(s.at)}` : ""} />)}
              </ul>
            )}
            {(brief.inProgress.length > SHOW || brief.finished.length > SHOW || brief.blocked.length > SHOW) && (
              <Link href="/builds" className="mt-2 inline-block text-sm text-gold hover:underline">All builds →</Link>
            )}
          </Card>

          <Card className="p-4">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="eyebrow">How today starts · {hm(brief.dayStart)}</h2>
              <Link href="/plan" className="text-sm text-gold hover:underline">Open the task queue →</Link>
            </div>
            {brief.people.length === 0 ? (
              <p className="text-sm text-grey">No production crew yet. Add people under Crew.</p>
            ) : (
              <ul className="grid">
                {brief.people.filter((p) => p.tasks.length).map((p) => (
                  <li key={p.id} className="flex items-start gap-3 border-t border-line py-2.5 first:border-t-0">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-line2 bg-panel2 text-xs font-semibold">{initials(p.name)}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="font-semibold">{p.name}</span>
                        <span className="text-xs text-grey">{p.department ?? "No department"}</span>
                      </div>
                      {p.tasks.length ? (
                        <ul className="mt-0.5 grid gap-0.5 text-sm">
                          {p.tasks.slice(0, 3).map((t, i) => (
                            <li key={i} className="flex min-w-0 gap-2">
                              <span className="shrink-0 font-mono text-xs leading-5 text-grey">{hm(t.start)}–{hm(t.end)}</span>
                              <span className="min-w-0 truncate">{t.title}{t.serial ? <span className="text-grey"> · {t.serial}</span> : null}</span>
                            </li>
                          ))}
                          {p.tasks.length > 3 && <li className="text-xs text-grey">and {p.tasks.length - 3} more</li>}
                        </ul>
                      ) : <p className="text-sm text-grey">Nothing planned today.</p>}
                    </div>
                    {p.freeH > 0 && <span className="shrink-0 rounded-md border border-line2 px-2 py-0.5 font-mono text-xs text-grey">{fmtHM(p.freeH)} free</span>}
                  </li>
                ))}
                {idle.length > 0 && (
                  <li className="border-t border-line py-2.5 text-sm first:border-t-0">
                    <span className="text-grey">Nothing planned today: </span>{idle.map((p) => p.name).join(", ")}.
                  </li>
                )}
              </ul>
            )}
          </Card>

        </div>

        <div className="grid content-start gap-5">
          <BoardHelper data={helper} />
          <Card className="p-4">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="eyebrow">Notices today</h2>
              {viewer.canWrite && <Link href="/settings#notices" className="text-sm text-gold hover:underline">Edit</Link>}
            </div>
            {notices.length ? (
              <ul className="grid gap-1.5 text-sm">
                {notices.map((n) => (
                  <li key={n.id} className="flex gap-2">
                    <span aria-hidden>{n.icon}</span>
                    <span className="min-w-0 flex-1">{n.title} <span className="text-grey">· {n.dept}</span></span>
                    {n.at && <span className="font-mono text-xs text-grey">{n.at}</span>}
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-grey">No notices today. The TVs still count down to lunch.</p>}
          </Card>
        </div>
      </div>
    </div>
  );
}

function StepRow({ s, pill, tone, note }: { s: BriefStep; pill: string; tone: "bad" | "gold" | "ok"; note: string }) {
  const bg = { bad: "bg-bad text-on-accent", gold: "bg-gold text-on-accent", ok: "bg-ok text-on-accent" }[tone];
  return (
    <li className="flex items-center gap-3 border-t border-line py-2 first:border-t-0">
      <Link href={`/builds/${s.projectId}`} className="shrink-0 rounded-md border border-gold px-1.5 py-0.5 font-mono text-xs text-gold hover:bg-gold hover:text-on-accent">{s.serial}</Link>
      <div className="min-w-0 flex-1 text-sm">
        <span className="font-semibold">{s.stage}</span> · {s.part}
        <span className="text-grey">{s.person ? ` · ${s.person}` : ""}{note ? ` · ${note}` : ""}</span>
      </div>
      <span className={`shrink-0 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-semibold ${bg}`}>{pill}</span>
    </li>
  );
}
