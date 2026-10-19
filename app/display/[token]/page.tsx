import type { Metadata } from "next";
import { Kiosk } from "@/components/display/kiosk";

export const metadata: Metadata = { title: "Shop floor · Kynetik", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * Shop-floor TV. No login: the token is checked by the snapshot route on every fetch, so a revoked
 * link stops within one poll. The layout is drawn for 1920×1080 at a 20px root and scales to fit
 * whichever of width or height is tighter (1080p → 20px, 4K → 40px, a 1366×768 laptop → ~14px).
 */
export default async function DisplayPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <>
      <style>{`html{font-size:clamp(6px,min(1.0417vw,1.852vh),48px)} body{overflow:hidden;cursor:none}`}</style>
      <Kiosk token={token} />
    </>
  );
}
