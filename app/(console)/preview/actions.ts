"use server";
/**
 * Preview as Modelling & 3D Printing (Owner, 2026-10-15): the Owner sees My models and 3D Printing exactly as a
 * crew member with that role would, to test the flow without a second login. The database still sees the
 * Owner, so every change is recorded against the Owner's login; a Submit for QC from the preview also goes to
 * Requests (preview_qc_request), like a real one.
 */
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { PREVIEW_COOKIE, getSession } from "@/lib/auth";

export async function startPreview(form: FormData) {
  const s = await getSession();
  if (s.status !== "ok" || s.viewer.role !== "owner") redirect("/no-access?reason=role");
  const personId = String(form.get("personId") ?? "");
  if (!/^[0-9a-f-]{36}$/.test(personId)) redirect("/users");
  (await cookies()).set(PREVIEW_COOKIE, personId, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 4 * 3600 });
  redirect("/models");
}

export async function stopPreview() {
  (await cookies()).delete(PREVIEW_COOKIE);
  redirect("/users");
}
