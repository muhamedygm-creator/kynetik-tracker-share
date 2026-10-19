import type { Metadata, Viewport } from "next";
import { Arimo, IBM_Plex_Mono, Michroma } from "next/font/google";
import { cookies } from "next/headers";
import { THEME_COOKIE, THEME_SCRIPT } from "@/lib/theme";
import "./globals.css";

// Brand guidelines (Rev 03, Sep 2026), three tiers:
//   primary   Broche  → headlines, uppercase. Michroma is the stand-in the guidelines PDF itself renders with.
//   secondary Helvetica → body, labels, tables. Arimo is the metric-compatible fallback where Helvetica isn't installed.
//   technical IBM Plex Mono → specs, part/build numbers.
const display = Michroma({ variable: "--font-michroma", subsets: ["latin"], weight: "400" });
const body = Arimo({ variable: "--font-body", subsets: ["latin"], weight: ["400", "500", "600", "700"] });
const mono = IBM_Plex_Mono({ variable: "--font-plex-mono", subsets: ["latin"], weight: ["300", "400", "500"] });

export const metadata: Metadata = {
  title: "Build Tracker · Kynetik Koncepts",
  description: "Production and project management for Kynetik Koncepts.",
};

export const viewport: Viewport = { themeColor: "#202020", width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Theme (2026-10-17): Light / Dark from the cookie straight away; System is resolved by the script before paint.
  const saved = (await cookies()).get(THEME_COOKIE)?.value;
  return (
    // Font variables on <html> so :root-level tokens (--font-sans) can resolve them.
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`} data-theme={saved === "light" ? "light" : "dark"} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} /></head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
