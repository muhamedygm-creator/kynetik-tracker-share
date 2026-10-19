import { Departments } from "@/components/settings/departments";
import { GamificationEditor } from "@/components/settings/gamification";
import { NoticesEditor } from "@/components/settings/notices";
import { createClient } from "@/lib/supabase/server";
import { Card, PageHead } from "@/components/ui/primitives";
import { requireViewer } from "@/lib/auth";
import { calendarSummary } from "@/lib/data/derived";
import { loadWorld } from "@/lib/data/world";

/** Settings: working day, TV notices, departments and gamification. */
export default async function SettingsPage() {
  const viewer = await requireViewer(["owner", "supervisor"]);
  const w = await loadWorld(viewer);
  const c = w.settings.calendar;
  const { data: notices } = await (await createClient()).from("notices").select("*").order("sort").order("created_at");
  return (
    <div className="grid gap-5">
      <PageHead eyebrow="Control panel" title="Settings" />
      <Card className="p-4">
        <h2 className="eyebrow mb-1">Working day (employee view)</h2>
        <p className="font-mono text-sm">{c.shiftStart}–{c.shiftEnd} · break {c.breakStart} for {c.breakMins} min · {calendarSummary(w)}</p>
        <p className="mt-1 text-sm text-grey">One calendar for builds, forecasts, costs, the task queue and the TVs. To change the working hours, rest days or holidays, ask the developer for now; editing them here is planned.</p>
      </Card>
      <Card className="grid gap-3 p-4">
        <h2 id="notices" className="eyebrow scroll-mt-6">TV notices</h2>
        <NoticesEditor canWrite={viewer.canWrite} depts={w.departments.map((d) => ({ id: d.id, name: d.name, emoji: d.emoji }))}
          rows={(notices ?? []).map((n) => ({
            id: n.id, version: n.version, departmentId: n.department_id, icon: n.icon, title: n.title, detail: n.detail,
            dailyAt: n.daily_at, startsOn: n.starts_on, endsOn: n.ends_on, active: n.active,
          }))} />
      </Card>
      <Card className="grid gap-3 p-4">
        <h2 className="eyebrow">Departments</h2>
        <Departments canWrite={viewer.canWrite} rows={w.departments.map((d) => ({
          ...d, version: w.versions[d.id], members: w.people.filter((p) => p.departmentId === d.id && p.active).length,
        }))} />
      </Card>
      <Card className="grid gap-3 p-4">
        <h2 className="eyebrow">Gamification</h2>
        <GamificationEditor value={w.settings.gamification} canWrite={viewer.canWrite} />
      </Card>
    </div>
  );
}
