"use client";
/**
 * New request from the Floor Station or a modeller (amends AM-15): when the pending count goes up, play a short chime and
 * show a note for a few seconds. The count arrives with each page refresh (realtime ping, or every 20 s).
 * Browsers only allow sound after someone has touched the page once, so the chime is armed on first tap.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

let ctx: AudioContext | null = null;
function chime() {
  if (!ctx) return;
  const now = ctx.currentTime;
  for (const [i, f] of [880, 1320].entries()) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "sine"; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, now + i * 0.18);
    g.gain.exponentialRampToValueAtTime(0.25, now + i * 0.18 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.18 + 0.35);
    o.connect(g).connect(ctx.destination);
    o.start(now + i * 0.18); o.stop(now + i * 0.18 + 0.4);
  }
}

export function RequestAlert({ pending }: { pending: number }) {
  const router = useRouter();
  const last = useRef(pending);
  const [note, setNote] = useState<number | null>(null);
  useEffect(() => {
    const arm = () => { ctx ??= new AudioContext(); void ctx.resume(); };
    window.addEventListener("pointerdown", arm, { once: false });
    const poll = setInterval(() => router.refresh(), 20_000);
    return () => { window.removeEventListener("pointerdown", arm); clearInterval(poll); };
  }, [router]);
  useEffect(() => {
    if (pending > last.current) { chime(); setNote(pending - last.current); }
    last.current = pending;
  }, [pending]);
  useEffect(() => { if (note === null) return; const t = setTimeout(() => setNote(null), 8000); return () => clearTimeout(t); }, [note]);
  if (note === null) return null;
  return (
    <Link href="/requests" role="status" className="fixed right-5 top-5 z-[70] rounded-lg border border-warn bg-panel3 px-4 py-3 text-sm shadow-2xl">
      <span className="font-semibold text-warn">{note === 1 ? "New request" : `${note} new requests`}</span> · open Requests
    </Link>
  );
}
