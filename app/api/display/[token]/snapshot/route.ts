import { NextResponse } from "next/server";
import { displaySnapshot } from "@/lib/display/snapshot";

export const dynamic = "force-dynamic";

/** Read-only, no login: the secret token in the URL is the credential. Unknown or revoked → 404. */
export async function GET(_: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const snap = await displaySnapshot(token);
  if (!snap) return NextResponse.json({ error: "This display link isn't active." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  return NextResponse.json(snap, { headers: { "Cache-Control": "no-store" } });
}
