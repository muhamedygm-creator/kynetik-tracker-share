import { DisplayList, NewDisplay } from "@/components/displays/displays";
import { Card, PageHead } from "@/components/ui/primitives";
import { fmtDT } from "@/domain/format";
import { utcToLocal } from "@/domain/time";
import { requireViewer } from "@/lib/auth";
import { loadWorld } from "@/lib/data/world";
import { createClient } from "@/lib/supabase/server";

export default async function DisplaysPage() {
  const viewer = await requireViewer(["owner"]);
  const w = await loadWorld(viewer);
  const { data } = await (await createClient()).from("displays").select("*").order("created_at");
  const depts = w.departments.map((d) => ({ id: d.id, name: d.name, emoji: d.emoji, people: w.people.filter((p) => p.active && p.departmentId === d.id).length }));
  return (
    <div className="grid gap-5">
      <PageHead eyebrow="Shop floor" title="Displays">
        <span className="text-sm text-grey">Each TV shows one department. No login: the link is the key. Make a link, open it in the TV&apos;s browser, and leave it full screen. Revoke it to stop a TV at once.</span>
      </PageHead>
      <Card className="p-4"><h2 className="eyebrow mb-3">New display</h2><NewDisplay departments={depts} /></Card>
      <Card className="grid gap-3 p-4">
        <h2 className="eyebrow">Displays</h2>
        <DisplayList departments={depts} rows={(data ?? []).map((d) => ({
          id: d.id, version: d.version, name: d.name, departmentId: d.department_id,
          departmentName: w.departments.find((x) => x.id === d.department_id)?.name ?? null,
          leaderboardMode: d.leaderboard_mode, confetti: d.confetti, revoked: !!d.revoked_at,
          lastSeen: d.last_seen_at ? fmtDT(utcToLocal(d.last_seen_at, w.settings.calendar.timezone)) : null,
        }))} />
      </Card>
    </div>
  );
}
