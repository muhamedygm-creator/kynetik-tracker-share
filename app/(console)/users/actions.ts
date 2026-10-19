"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireViewer } from "@/lib/auth";
import { COMPANY_DOMAIN, isCompanyEmail } from "@/lib/company";
import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok?: string; error?: string };
const Role = z.enum(["owner", "supervisor", "viewer", "modeller", "floor_station"]);

export async function inviteUser(_: ActionResult, form: FormData): Promise<ActionResult> {
  await requireViewer(["owner"]);
  const parsed = z.object({ email: z.email(), role: Role, via: z.enum(["microsoft", "email"]) }).safeParse({
    email: String(form.get("email") ?? "").trim().toLowerCase(),
    role: form.get("role"),
    via: form.get("via") ?? "email",
  });
  if (!parsed.success) return { error: "Enter a valid email and pick a role." };
  const { email, role, via } = parsed.data;
  if (!isCompanyEmail(email)) return { error: `Only @${COMPANY_DOMAIN} addresses can be invited.` };

  // Insert as the owner (RLS: owner-only). The DB trigger applies the role at once if the person already has an account.
  const supabase = await createClient();
  const { data: existing } = await supabase.from("invitations").select("id").ilike("email", email).maybeSingle();
  const res = existing
    ? await supabase.from("invitations").update({ role }).eq("id", existing.id)
    : await supabase.from("invitations").insert({ email, role });
  if (res.error) return { error: res.error.message };

  // Microsoft sign-in: the invitation row is all it takes; no email is sent.
  if (via === "microsoft") {
    revalidatePath("/users");
    return { ok: `${email} is invited as ${role}. Ask them to open the app and tap Sign in with Microsoft.` };
  }

  const { error } = await createAdminClient().auth.admin.inviteUserByEmail(email, {
    redirectTo: `${env.siteUrl()}/auth/confirm?next=/board`,
  });
  if (error && !/already been registered|already registered/i.test(error.message)) {
    return { error: `Invitation saved, but the email failed: ${error.message}` };
  }
  revalidatePath("/users");
  return { ok: error ? `${email} already has an account and can now sign in as ${role}.` : `Invitation sent to ${email}.` };
}

export async function setRole(userId: string, version: number, role: string): Promise<ActionResult> {
  await requireViewer(["owner"]);
  const r = Role.safeParse(role);
  if (!r.success) return { error: "Unknown role." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("profiles").update({ role: r.data }).eq("user_id", userId).eq("version", version).select("email");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "Someone else changed this user — reload and try again." };
  // Keep the invitation in step so a later re-invite doesn't revert the role.
  await supabase.from("invitations").update({ role: r.data }).ilike("email", data[0].email);
  revalidatePath("/users");
  return { ok: "Role updated." };
}

/** Link a login to its crew member (Modeller logins: which Modelling steps are theirs). */
export async function setPerson(userId: string, version: number, personId: string | null): Promise<ActionResult> {
  await requireViewer(["owner"]);
  const supabase = await createClient();
  const { data, error } = await supabase.from("profiles").update({ person_id: personId }).eq("user_id", userId).eq("version", version).select("user_id");
  if (error) return { error: /profiles_person_id_key/.test(error.message) ? "That crew member is already linked to another login." : error.message };
  if (!data?.length) return { error: "Someone else changed this user — reload and try again." };
  revalidatePath("/users");
  return { ok: personId ? "Linked." : "Unlinked." };
}

export async function setActive(userId: string, version: number, active: boolean): Promise<ActionResult> {
  await requireViewer(["owner"]);
  const supabase = await createClient();
  const { data, error } = await supabase.from("profiles").update({ active }).eq("user_id", userId).eq("version", version).select("user_id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "Someone else changed this user — reload and try again." };
  revalidatePath("/users");
  return { ok: active ? "Access restored." : "Access switched off." };
}

export async function cancelInvitation(id: string): Promise<ActionResult> {
  await requireViewer(["owner"]);
  const supabase = await createClient();
  const { error } = await supabase.from("invitations").delete().eq("id", id).is("accepted_at", null);
  if (error) return { error: error.message };
  revalidatePath("/users");
  return { ok: "Invitation cancelled." };
}
