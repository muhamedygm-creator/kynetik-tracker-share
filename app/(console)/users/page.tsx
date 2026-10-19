import { startPreview } from "../preview/actions";
import { requireViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { InviteForm, InvitationRow, UserRow } from "./users-client";

export default async function UsersPage() {
  const me = await requireViewer(["owner"]);
  const supabase = await createClient();
  const [{ data: profiles }, { data: invitations }, { data: people }] = await Promise.all([
    supabase.from("profiles").select("user_id, email, name, role, active, version, person_id").order("email"),
    supabase.from("invitations").select("id, email, role, created_at").is("accepted_at", null).order("created_at"),
    supabase.from("people").select("id, name").eq("active", true).order("name"),
  ]);
  return (
    <section className="space-y-6">
      <div>
        <h1 className="display text-2xl">Users &amp; roles</h1>
        <p className="text-grey">
          Owner sees and changes everything, costs included. Supervisor changes everything except costs, which it never receives.
          Viewer is read-only. Modelling &amp; 3D Printing sees only My models and 3D Printing: the model data on their own Modelling steps and the print jobs (link the login to its crew member). Floor Station is the shared workshop iPad: it sees only the employees&apos; tasks and can send time-extension and QC requests.
        </p>
      </div>
      <form action={startPreview} className="flex flex-wrap items-end gap-3 rounded-[10px] border border-line bg-panel p-4">
        <div className="grid min-w-56 flex-1 gap-1">
          <h2 className="eyebrow">Preview as Modelling &amp; 3D Printing</h2>
          <p className="text-sm text-grey">See My models and 3D Printing exactly as that role does, as one crew member, without a second login. Submit for QC from the preview goes to QC and Requests like a real one.</p>
        </div>
        <label className="grid gap-1">
          <span className="label">As crew member</span>
          <select name="personId" required className="min-h-11 rounded-md border border-line2 bg-panel2 px-3 text-ink">
            {(people ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <button className="min-h-11 rounded-md bg-gold px-4 font-mono text-xs uppercase tracking-widest text-on-accent">Start preview</button>
      </form>
      <div className="rounded-[10px] border border-line bg-panel p-4">
        <h2 className="eyebrow mb-3">Invite someone</h2>
        <InviteForm />
      </div>
      <div className="overflow-x-auto rounded-[10px] border border-line bg-panel">
        <table className="w-full text-sm">
          <thead>
            <tr className="label border-b border-line text-left">
              <th className="p-3">Email</th><th className="p-3">Name</th><th className="p-3">Role</th><th className="p-3">Crew member</th><th className="p-3">Access</th>
            </tr>
          </thead>
          <tbody>
            {(profiles ?? []).map((p) => <UserRow key={p.user_id} user={p} isMe={p.user_id === me.userId} people={people ?? []} />)}
            {(invitations ?? []).map((i) => <InvitationRow key={i.id} invitation={i} />)}
          </tbody>
        </table>
      </div>
    </section>
  );
}
