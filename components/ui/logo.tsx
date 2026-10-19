/* eslint-disable @next/next/no-img-element -- static SVGs from /public/brand; next/image adds nothing here */
/**
 * Kynetik logo system (brand guidelines §02):
 *   primary lockup — monogram + wordmark, the default (min 96 px wide on screen)
 *   stacked        — narrow/square formats only
 *   monogram       — where the name is already established (min 16 px)
 * Gold monogram + Foster White wordmark on Black; the Light theme (2026-10-17) uses the brand's black wordmark
 * artwork instead (both files are the designer's, nothing is recoloured). Never stretch, rotate, recolour or add effects.
 * A custom logo uploaded in Settings → Brand (phase 5) replaces the monogram.
 */
const MONOGRAM = "/brand/kynetik-monogram.svg";
const WORDMARK = "/brand/kynetik-wordmark-white.svg";
const WORDMARK_DARK_INK = "/brand/kynetik-wordmark-black.svg";
// Wordmark artwork is 2700 × 390.
const WM_RATIO = 2700 / 390;

export function Monogram({ size = 32, src }: { size?: number; src?: string | null }) {
  return <img src={src ?? MONOGRAM} alt="Kynetik" width={size} height={size} className="shrink-0 select-none" draggable={false} />;
}

export function Lockup({ height = 32, src }: { height?: number; src?: string | null }) {
  const wm = Math.round(height * 0.42);
  return (
    <span className="inline-flex items-center" style={{ gap: height * 0.45 }}>
      <Monogram size={height} src={src} />
      <Wordmark h={wm} />
    </span>
  );
}

/** White wordmark in the Dark theme, black in the Light theme (CSS picks one: `.wm-on-dark` / `.wm-on-light`). */
function Wordmark({ h }: { h: number }) {
  return (
    <>
      <img src={WORDMARK} alt="KYNETIK" height={h} width={Math.round(h * WM_RATIO)} className="wm-on-dark select-none" draggable={false} />
      <img src={WORDMARK_DARK_INK} alt="" aria-hidden height={h} width={Math.round(h * WM_RATIO)} className="wm-on-light select-none" draggable={false} />
    </>
  );
}

export function Stacked({ size = 64, src }: { size?: number; src?: string | null }) {
  const wm = Math.round(size * 0.3);
  return (
    <span className="inline-flex flex-col items-center" style={{ gap: size * 0.3 }}>
      <Monogram size={size} src={src} />
      <Wordmark h={wm} />
    </span>
  );
}
