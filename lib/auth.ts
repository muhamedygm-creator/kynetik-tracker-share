import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isCompanyEmail } from "@/lib/company";
import { createClient } from "@/lib/supabase/server";
import { isTheme, type ThemeChoice } from "@/lib/theme";

export type Role = "owner" | "supervisor" | "viewer" | "modeller" | "floor_station";

export interface Viewer {
  userId: string;
  email: string;
  name: string;
  role: Role;
  canWrite: boolean;
  /** Only the owner ever receives cost data. RLS enforces it; this flag only drives the UI. */
  seesCost: boolean;
  seesSalary: boolean;
  /** The crew person this login belongs to (Modeller logins: their own Modelling steps). */
  personId: string | null;
  /** Owner previewing the Modelling & 3D Printing role as a crew member (2026-10-15); writes stay the Owner's. */
  preview?: { personId: string; personName: string } | null;
  /** Light / Dark / System, saved on the profile (2026-10-17). */
  theme: ThemeChoice;
}

/** Cookie holding the crew member the Owner previews the Modelling & 3D Printing role as. */
export const PREVIEW_COOKIE = "kk_preview_as";

export type Session =
  | { status: "anon" }
  | { status: "no-access"; email: string } // signed in, but not invited or deactivated
  | { status: "ok"; viewer: Viewer };

/** Cached per request. */
export const getSession = cache(async (): Promise<Session> => {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { status: "anon" };
  type ProfileRow = { role: string; name: string; email: string; active: boolean; person_id: string | null; theme?: string };
  const profileQuery = async (cols: string) =>
    (await supabase.from("profiles").select(cols).eq("user_id", auth.user!.id).maybeSingle()) as unknown as { data: ProfileRow | null; error: unknown };
  // The theme column (2026-10-17) may reach the database a moment after this code goes live: fall back to Dark.
  const first = await profileQuery("role, name, email, active, person_id, theme");
  const profile = first.error ? (await profileQuery("role, name, email, active, person_id")).data : first.data;
  if (!profile?.active || !isCompanyEmail(profile.email)) return { status: "no-access", email: auth.user.email ?? "" };
  const role = profile.role as Role;
  const theme: ThemeChoice = isTheme(profile.theme) ? profile.theme : "dark";
  if (role === "owner") {
    const as = (await cookies()).get(PREVIEW_COOKIE)?.value;
    const { data: person } = as ? await supabase.from("people").select("id, name").eq("id", as).maybeSingle() : { data: null };
    if (person) {
      return {
        status: "ok",
        viewer: {
          userId: auth.user.id, email: profile.email, name: profile.name, role: "modeller",
          canWrite: false, seesCost: false, seesSalary: false, personId: person.id as string,
          preview: { personId: person.id as string, personName: person.name as string }, theme,
        },
      };
    }
  }
  return {
    status: "ok",
    viewer: {
      userId: auth.user.id,
      email: profile.email,
      name: profile.name,
      role,
      // Modellers read like Viewers; their own model data goes through dedicated database functions.
      canWrite: role === "owner" || role === "supervisor",
      seesCost: role === "owner",
      // AM-20: salaries (people_cost) for the Owner and Supervisors; every other cost stays Owner-only.
      seesSalary: role === "owner" || role === "supervisor",
      personId: (profile.person_id as string | null) ?? null,
      theme,
    },
  };
});

/** Use at the top of every console page and server action. */
export async function requireViewer(roles?: Role[]): Promise<Viewer> {
  const s = await getSession();
  if (s.status === "anon") redirect("/login");
  if (s.status === "no-access") redirect("/no-access");
  // The Floor Station (shared workshop iPad, amends AM-14) sees its one page and nothing else.
  if (s.viewer.role === "floor_station" && !roles?.includes("floor_station")) redirect("/station");
  // Modelling & 3D Printing (role key `modeller`, amends AM-24) sees My models and 3D Printing only.
  if (s.viewer.role === "modeller" && !roles?.includes("modeller")) redirect("/models");
  if (roles && !roles.includes(s.viewer.role)) redirect("/no-access?reason=role");
  return s.viewer;
}
