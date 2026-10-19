/**
 * Runs a SQL script against the project database and returns the rows of its last result.
 * Uses DATABASE_URL (Postgres) when set, otherwise SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF through the
 * Management API (`POST /v1/projects/{ref}/database/query`), for machines that can't open a Postgres connection.
 * Never prints the connection string or the token.
 */
import { config } from "dotenv";
import { Client } from "pg";

config({ path: ".env.local" });
config();

export type Rows = Record<string, unknown>[];

export const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

export function sqlRunner(): (sql: string) => Promise<Rows> {
  const url = process.env.DATABASE_URL;
  if (url) {
    return async (sql) => {
      const local = /localhost|127\.0\.0\.1/.test(url);
      const db = new Client({ connectionString: url, ssl: local ? false : { rejectUnauthorized: false } });
      await db.connect();
      try {
        const res = await db.query(sql);
        const all = Array.isArray(res) ? res : [res];
        return [...all].reverse().find((r) => r.command === "SELECT")?.rows ?? [];
      } finally { await db.end(); }
    };
  }
  const token = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_PROJECT_REF;
  if (token && ref) {
    return async (sql) => {
      const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ query: sql }),
      });
      const body = await r.json().catch(() => null);
      if (!r.ok) throw new Error(`Management API ${r.status}: ${JSON.stringify(body)?.slice(0, 300)}`);
      return body as Rows;
    };
  }
  throw new Error("Set DATABASE_URL, or SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF, in .env.local (it is git-ignored). Nothing is printed.");
}

export const redact = (m: string) => m.replace(/postgres(ql)?:\/\/[^\s]+/g, "<connection string>").replace(/sbp_[A-Za-z0-9]+/g, "<token>");
