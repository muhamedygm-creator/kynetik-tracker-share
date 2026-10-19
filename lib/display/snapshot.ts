import "server-only";
import { buildDisplaySnapshot, type DisplaySnapshot } from "@/domain/display";
import { buildWorld } from "@/lib/data/world";
import { initials, photoUrls } from "@/lib/photos";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashDisplayToken } from "./token";

/**
 * Shop-floor display data. Service role (no user session), so this function is the permission check:
 * the token must match a live display; the world is built with seesCost = false (no cost table is
 * ever queried); output goes through the strict DisplaySnapshot allow-list.
 */
export async function displaySnapshot(token: string): Promise<DisplaySnapshot | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const admin = createAdminClient();
  const { data: d } = await admin.from("displays").select("*").eq("token_hash", hashDisplayToken(token)).is("revoked_at", null).maybeSingle();
  if (!d) return null;

  const w = await buildWorld(admin, false);
  const dept = w.departments.find((x) => x.id === d.department_id) ?? null;
  const members = dept ? w.people.filter((p) => p.departmentId === dept.id) : [];
  const urls = await photoUrls(admin, members.map((p) => p.photoPath), 3600);

  if (!d.last_seen_at || Date.now() - Date.parse(d.last_seen_at) > 60_000) {
    await admin.from("displays").update({ last_seen_at: new Date().toISOString() }).eq("id", d.id);
  }

  // Today's notices for this department (or for every department). A countdown hides 10 minutes after its time.
  const today = w.now.slice(0, 10);
  const { data: rows } = await admin.from("notices").select("*").eq("active", true).order("sort");
  const notices = (rows ?? [])
    .filter((n) => (!n.department_id || n.department_id === d.department_id) && (!n.starts_on || n.starts_on <= today) && (!n.ends_on || n.ends_on >= today))
    .map((n) => ({ icon: n.icon as string, title: n.title as string, detail: n.detail as string, at: n.daily_at ? `${today}T${String(n.daily_at).slice(0, 5)}` : null }))
    .filter((n) => !n.at || Date.parse(`${n.at}:00Z`) + 10 * 60_000 >= Date.parse(`${w.now}:00Z`));

  const { data: asked } = await admin.from("requests").select("queue_task_id").eq("kind", "qc").eq("status", "pending");

  return buildDisplaySnapshot({
    qcRequested: (asked ?? []).map((r) => r.queue_task_id as string).filter(Boolean),
    conveyor: w.settings.timeline.conveyor,
    notices,
    display: { name: d.name, leaderboardMode: d.leaderboard_mode, confetti: d.confetti && w.settings.gamification.confetti },
    department: dept ? { id: dept.id, name: dept.name, emoji: dept.emoji, colour: dept.colour } : null,
    brand: { appName: w.settings.brand.appName, company: w.settings.brand.company },
    people: members.map((p) => ({
      id: p.id, name: p.name, initials: initials(p.name), photoUrl: p.photoPath ? urls[p.photoPath] ?? null : null,
      departmentId: p.departmentId, active: p.active, costClass: p.costClass, away: p.away?.label ?? null,
    })),
    queue: w.queue,
    projects: w.builds.map((b) => b.project),
    cal: w.cal,
    calFor: w.calFor,
    scoreCalFor: w.scoreCalFor,
    now: w.now,
    labels: w.settings.labels,
    scoring: w.settings.scoring,
    game: w.settings.gamification,
    period: w.settings.gamification.defaultPeriod,
  });
}
