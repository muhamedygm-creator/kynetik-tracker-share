/**
 * One shop-floor TV link per department (deploy step 12).
 *   npm run displays:create                      # every department
 *   npm run displays:create -- --only modification  # one department (by key)
 * Needs NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SITE_URL (from .env.local).
 * Each link is printed once: only its SHA-256 is stored, so a lost link is replaced, not recovered
 * (Console → Displays → Revoke, then create a new one).
 */
import { createHash, randomBytes } from "node:crypto";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });
config();

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY, site = process.env.NEXT_PUBLIC_SITE_URL;
  if (!url || !key || !site) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SITE_URL in .env.local.");
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : null;
  let query = db.from("departments").select("id, key, name, emoji").order("sort");
  if (only) query = query.eq("key", only);
  const { data: depts, error } = await query;
  if (error) throw error;
  const { data: existing } = await db.from("displays").select("name").is("revoked_at", null);
  const taken = new Set((existing ?? []).map((d) => d.name));
  for (const d of depts ?? []) {
    const name = `${d.name} TV`;
    if (taken.has(name)) { console.log(`• ${name}: already exists — revoke it in Console → Displays to make a new link.`); continue; }
    const token = randomBytes(24).toString("base64url");
    const { error: e } = await db.from("displays").insert({
      name, department_id: d.id, token_hash: createHash("sha256").update(token).digest("hex"), leaderboard_mode: "side", confetti: true,
      screens: [{ type: "employeeDay", seconds: 40, enabled: true }, { type: "leaderboard", seconds: 20, enabled: true }],
    });
    if (e) throw e;
    console.log(`${d.emoji} ${name}: ${site.replace(/\/$/, "")}/display/${token}`);
  }
  console.log("\nOpen each link on its TV. Treat them like keys: anyone with a link can watch that screen.");
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
