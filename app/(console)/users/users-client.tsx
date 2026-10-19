"use client";
import { useActionState, useState, useTransition } from "react";
import { isCompanyEmail } from "@/lib/company";
import { cancelInvitation, inviteUser, setActive, setPerson, setRole, type ActionResult } from "./actions";

const ROLES = ["owner", "supervisor", "viewer", "modeller", "floor_station"] as const;
const ROLE_LABEL: Record<string, string> = { owner: "Owner", supervisor: "Supervisor", viewer: "Viewer", modeller: "Modelling & 3D Printing", floor_station: "Floor Station" };
const input = "rounded-md border border-line2 bg-panel2 px-3 py-2 font-mono text-sm text-ink outline-none focus:border-gold";

function Feedback({ r }: { r: ActionResult }) {
  if (r.error) return <span className="text-sm text-bad">{r.error}</span>;
  if (r.ok) return <span className="text-sm text-ok">{r.ok}</span>;
  return null;
}

export function InviteForm() {
  const [state, action, pending] = useActionState<ActionResult, FormData>(inviteUser, {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input name="email" type="email" required placeholder="name@kynetikkoncepts.com" className={`${input} min-w-64 flex-1`} />
      <select name="role" defaultValue="supervisor" className={input}>
        {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
      </select>
      <select name="via" defaultValue="microsoft" className={input} aria-label="How they sign in">
        <option value="microsoft">Signs in with Microsoft (no email)</option>
        <option value="email">Send an email invitation</option>
      </select>
      <button disabled={pending} className="display rounded-md bg-gold px-4 py-2.5 text-xs tracking-[0.16em] text-on-accent disabled:opacity-60">
        {pending ? "Saving…" : "Invite"}
      </button>
      <Feedback r={state} />
    </form>
  );
}

type Profile = { user_id: string; email: string; name: string; role: string; active: boolean; version: number; person_id: string | null };

export function UserRow({ user, isMe, people }: { user: Profile; isMe: boolean; people: { id: string; name: string }[] }) {
  const [result, setResult] = useState<ActionResult>({});
  const [role, setRoleValue] = useState(user.role);
  const [pending, start] = useTransition();
  const changeRole = (next: string) => {
    setRoleValue(next);
    start(async () => {
      const r = await setRole(user.user_id, user.version, next);
      if (r.error) setRoleValue(user.role); // e.g. "There must always be at least one active Owner."
      setResult(r);
    });
  };
  return (
    <tr className="border-b border-line">
      <td className="p-3 font-mono">{user.email}{isMe && <span className="ml-2 text-grey">(you)</span>}
        {!isCompanyEmail(user.email) && <div className="font-sans text-xs text-bad">Not a company address: no access</div>}</td>
      <td className="p-3">{user.name}</td>
      <td className="p-3">
        <select
          disabled={pending}
          value={role}
          onChange={(e) => changeRole(e.target.value)}
          className={input}
        >
          {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
        </select>
      </td>
      <td className="p-3">
        <select disabled={pending} defaultValue={user.person_id ?? ""} aria-label="Crew member"
          onChange={(e) => start(async () => setResult(await setPerson(user.user_id, user.version, e.target.value || null)))} className={input}>
          <option value="">— not linked —</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </td>
      <td className="p-3">
        <button
          disabled={pending}
          onClick={() => start(async () => setResult(await setActive(user.user_id, user.version, !user.active)))}
          className={`font-mono text-xs uppercase tracking-widest ${user.active ? "text-ok" : "text-bad"}`}
        >
          {user.active ? "Active · switch off" : "Off · restore"}
        </button>
        <div><Feedback r={result} /></div>
      </td>
    </tr>
  );
}

export function InvitationRow({ invitation }: { invitation: { id: string; email: string; role: string } }) {
  const [result, setResult] = useState<ActionResult>({});
  const [pending, start] = useTransition();
  return (
    <tr className="border-b border-line text-grey">
      <td className="p-3 font-mono">{invitation.email}</td>
      <td className="p-3 italic">invited, not signed in yet</td>
      <td className="p-3">{ROLE_LABEL[invitation.role] ?? invitation.role}</td>
      <td className="p-3" />
      <td className="p-3">
        <button disabled={pending} onClick={() => start(async () => setResult(await cancelInvitation(invitation.id)))} className="font-mono text-xs uppercase tracking-widest text-bad">
          Cancel invite
        </button>
        <Feedback r={result} />
      </td>
    </tr>
  );
}
