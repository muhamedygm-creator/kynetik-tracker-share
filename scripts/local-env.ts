/**
 * Writes .env.local from `supabase status` so `npm run dev:all` is one command.
 * Keeps any OWNER_EMAIL already in .env.local.
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const status = execSync("npx supabase status -o env", { encoding: "utf8" });
const vars = Object.fromEntries(
  status.split("\n").map((l) => l.match(/^([A-Z_]+)="?(.*?)"?$/)).filter(Boolean).map((m) => [m![1], m![2]]),
);
const prev = existsSync(".env.local") ? readFileSync(".env.local", "utf8") : "";
const owner = prev.match(/^OWNER_EMAIL=(.*)$/m)?.[1] ?? process.env.OWNER_EMAIL ?? "owner@kynetikkoncepts.com";

const out = [
  "# Written by scripts/local-env.ts from `supabase status`. Local development only.",
  `NEXT_PUBLIC_SUPABASE_URL=${vars.API_URL}`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY=${vars.ANON_KEY ?? vars.PUBLISHABLE_KEY}`,
  `SUPABASE_SERVICE_ROLE_KEY=${vars.SERVICE_ROLE_KEY ?? vars.SECRET_KEY}`,
  `NEXT_PUBLIC_SITE_URL=http://localhost:3000`,
  `OWNER_EMAIL=${owner}`,
  "",
].join("\n");
writeFileSync(".env.local", out);
console.log("Wrote .env.local");
