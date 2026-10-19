import { redirect } from "next/navigation";

/** Setup lives in the left menu now (Crew); workstations and templates come later (docs/ROADMAP.md v2). */
export default function SetupPage() {
  redirect("/setup/crew");
}
