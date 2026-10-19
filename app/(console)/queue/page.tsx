import { redirect } from "next/navigation";

/** The task queue is planned on the week plan now (docs/ROADMAP.md v1.4). */
export default function QueuePage() {
  redirect("/plan");
}
