/**
 * Makes OWNER_EMAIL the Owner (D6). Safe to run repeatedly.
 *   npm run bootstrap:owner
 * Needs NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and OWNER_EMAIL (from .env.local or the environment).
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });
config();

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const email = process.env.OWNER_EMAIL?.trim().toLowerCase();
  if (!url || !key || !email) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and OWNER_EMAIL.");
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: inv } = await admin.from("invitations").select("id").ilike("email", email).maybeSingle();
  const res = inv
    ? await admin.from("invitations").update({ role: "owner" }).eq("id", inv.id)
    : await admin.from("invitations").insert({ email, role: "owner" });
  if (res.error) throw res.error;

  const { error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: `${site}/auth/confirm?next=/board` });
  if (error && /already been registered|already registered/i.test(error.message)) {
    // Account exists: make sure its profile is an active owner.
    const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
    const user = list?.users.find((u) => u.email?.toLowerCase() === email);
    if (!user) throw new Error(`Supabase says ${email} exists but it wasn't found.`);
    const up = await admin.from("profiles").upsert({ user_id: user.id, email, name: email.split("@")[0], role: "owner", active: true }, { onConflict: "user_id" });
    if (up.error) throw up.error;
    console.log(`${email} is the Owner. Sign in at ${site}/login`);
  } else if (error) {
    throw error;
  } else {
    console.log(`Owner invitation sent to ${email}. Locally, open the Mailpit inbox at http://127.0.0.1:54324`);
  }
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
