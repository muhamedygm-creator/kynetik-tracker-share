/**
 * Builds a throwaway Postgres database from the shim + migrations + seed, and lets tests run
 * queries as a given Supabase role / user. Needs a Postgres superuser URL in TEST_DATABASE_URL
 * (default postgres://postgres:postgres@localhost:5432/postgres).
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

const ROOT = join(__dirname, "..", "..");
const ADMIN_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/postgres";

export async function createTestDb(name = `kynetik_test_${process.pid}`): Promise<{ url: string; drop: () => Promise<void> }> {
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${name}`);
  await admin.query(`create database ${name}`);
  await admin.end();

  const url = ADMIN_URL.replace(/\/[^/]*$/, `/${name}`);
  const db = new Client({ connectionString: url });
  await db.connect();
  await db.query(readFileSync(join(ROOT, "supabase/tests/shim.sql"), "utf8"));
  const migDir = join(ROOT, "supabase/migrations");
  for (const f of readdirSync(migDir).filter((f) => f.endsWith(".sql")).sort()) {
    try {
      await db.query(readFileSync(join(migDir, f), "utf8"));
    } catch (e) {
      throw new Error(`Migration ${f} failed: ${(e as Error).message}`);
    }
  }
  await db.query(readFileSync(join(ROOT, "supabase/seed.sql"), "utf8"));
  await db.end();

  return {
    url,
    drop: async () => {
      const a = new Client({ connectionString: ADMIN_URL });
      await a.connect();
      await a.query(`drop database if exists ${name} with (force)`);
      await a.end();
    },
  };
}

export type Who = { role: "anon" } | { role: "authenticated"; userId: string } | { role: "service_role" } | { role: "postgres" };

/** Run `fn` inside a transaction as `who`; always rolled back unless commit = true. */
export async function as<T>(url: string, who: Who, fn: (c: Client) => Promise<T>, commit = false): Promise<T> {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    await c.query("begin");
    if (who.role !== "postgres") {
      await c.query(`set local role ${who.role}`);
      if (who.role === "authenticated") {
        await c.query(`select set_config('request.jwt.claim.sub', $1, true)`, [who.userId]);
      }
    }
    const r = await fn(c);
    await c.query(commit ? "commit" : "rollback");
    return r;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    await c.end();
  }
}

/** Create an auth user (as superuser), optionally pre-invited with a role. Returns the user id. */
export async function makeUser(url: string, email: string, role?: "owner" | "supervisor" | "viewer" | "modeller" | "floor_station"): Promise<string> {
  return as(url, { role: "postgres" }, async (c) => {
    if (role) await c.query(`insert into public.invitations (email, role) values ($1, $2)`, [email, role]);
    const r = await c.query(`insert into auth.users (email) values ($1) returning id`, [email]);
    return r.rows[0].id as string;
  }, true);
}
