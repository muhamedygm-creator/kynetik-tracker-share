import Link from "next/link";
import { Card, PageHead } from "@/components/ui/primitives";
import { fmtDT } from "@/domain/format";
import { utcToLocal } from "@/domain/time";
import { requireViewer } from "@/lib/auth";
import { loadWorld } from "@/lib/data/world";
import { createClient } from "@/lib/supabase/server";

/** Audit log: who changed what, newest first. Cost entries are owner-only (RLS hides them from everyone else). */
const ENTITY: Record<string, string> = {
  projects: "Build", stages: "Stage", parts: "Part", tasks: "Task", work_items: "Part step", queue_tasks: "Plan task", people: "Crew",
  people_cost: "Salary", settings: "Settings", settings_cost: "Cost settings", departments: "Department", displays: "TV display",
  holidays: "Holiday", attendance: "Attendance", hour_logs: "Hours", invitations: "Invitation", profiles: "User", notices: "TV notice",
};
const ACTION: Record<string, string> = { insert: "added", update: "changed", delete: "removed" };
const SKIP = new Set(["version", "updated_at", "created_at", "id"]);

function changed(before: Record<string, unknown> | null, after: Record<string, unknown> | null) {
  if (!before || !after) return [];
  return Object.keys(after).filter((k) => !SKIP.has(k) && JSON.stringify(before[k]) !== JSON.stringify(after[k])).map((k) => k.replace(/_/g, " "));
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ build?: string }> }) {
  const sp = await searchParams;
  const viewer = await requireViewer();
  const w = await loadWorld(viewer);
  const supabase = await createClient();
  let q = supabase.from("audit_log").select("*").order("at", { ascending: false }).limit(200);
  if (sp.build) q = q.eq("project_id", sp.build);
  const [{ data: rows }, { data: people }] = await Promise.all([q, supabase.from("profiles").select("user_id, email, name")]);
  const who = new Map((people ?? []).map((p) => [p.user_id as string, (p.name as string) || (p.email as string)]));
  const build = (id: string | null) => w.builds.find((b) => b.project.id === id)?.project;
  const tz = w.settings.calendar.timezone;

  return (
    <div className="grid gap-5">
      <PageHead eyebrow="Who changed what" title="Audit log">
        <form className="flex items-center gap-2">
          <select name="build" defaultValue={sp.build ?? ""} className="min-h-11 rounded-md border border-line2 bg-panel2 px-3 text-sm">
            <option value="">All builds and settings</option>
            {w.builds.map((b) => <option key={b.project.id} value={b.project.id}>{b.project.serial} {b.project.name}</option>)}
          </select>
          <button className="min-h-11 rounded-md border border-line2 px-4 text-sm hover:border-gold">Show</button>
        </form>
      </PageHead>
      <Card>
        {!rows?.length ? (
          <p className="p-6 text-grey">Nothing recorded yet. Every change to builds, plans, crew and settings appears here with who made it.</p>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((r) => {
              const p = build(r.project_id as string | null);
              const fields = r.action === "update" ? changed(r.before, r.after) : [];
              return (
                <li key={r.id} className="grid gap-1 px-4 py-3 sm:grid-cols-[170px_minmax(0,1fr)] sm:gap-4">
                  <div className="font-mono text-sm text-grey">{fmtDT(utcToLocal(r.at as string, tz))}</div>
                  <div className="min-w-0 text-sm">
                    <span className="font-semibold">{(r.actor_id && who.get(r.actor_id as string)) || (r.actor_role ? `A ${r.actor_role}` : "The system")}</span>{" "}
                    {ACTION[r.action as string] ?? (r.action as string)}{" "}
                    <span className="text-grey">{ENTITY[r.entity as string] ?? r.entity}</span>
                    {r.label ? <> · {r.label as string}</> : null}
                    {p && <> · <Link href={`/builds/${p.id}`} className="font-mono text-gold hover:underline">{p.serial}</Link></>}
                    {fields.length > 0 && <div className="mt-0.5 truncate text-xs text-grey">Changed: {fields.slice(0, 6).join(", ")}{fields.length > 6 ? "…" : ""}</div>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <p className="text-xs text-grey">Latest 200 entries.{viewer.seesCost ? "" : " Salary and cost changes are visible to the Owner only."}</p>
    </div>
  );
}
