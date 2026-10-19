# Kynetik Build Tracker v2

Production and project management for **Kynetik Koncepts Car Garage LLC** (Dubai · AED · Asia/Dubai).

There are two front ends, and they share one backend:

- **Admin Console**, for the Owner, Supervisors and Viewers (login required). It runs the shop and holds every setting.
- **Shop Floor Display**, for workshop TVs and tablets. It is view-only, needs no login, opens from a secret link, and never shows costs.

Spec: [`docs/KYNETIK_BUILD_TRACKER.md`](docs/KYNETIK_BUILD_TRACKER.md) · Plan and decisions: [`docs/PLAN.md`](docs/PLAN.md) · Conventions: [`CLAUDE.md`](CLAUDE.md)

## Status

| Phase | Scope | State |
|---|---|---|
| 1 | Scaffold, schema, auth/roles, seed | ✅ done |
| 2 | Domain core + tests | ✅ done |
| 3 | Console: Board, Builds, Parts × Stages, Tasks | ✅ done |
| 3.5 | Employee Day View, Task Queue & Leaderboard | ✅ done |
| 4 | Console: Timeline, Floor log, Technicians | ✅ done, in review |
| 5 | Settings, audit log, import/export | |
| 6 | Shop Floor Display | |
| 7 | Hardening, e2e, deploy guide | |

## Stack

Next.js 15 (App Router) · TypeScript · Tailwind v4 (Kynetik brand guidelines Rev 03: palette, Broche/Michroma, Helvetica, IBM Plex Mono) · Supabase (Postgres, Auth, Realtime, RLS, Storage) · Zod · Vitest · Playwright (phase 7).

## Run locally

Prerequisites: Node 22+, Docker (for the local Supabase stack).

```bash
npm install
echo "OWNER_EMAIL=you@example.com" > .env.local   # who becomes the first Owner
npm run dev:all
```

`dev:all` runs these steps:

1. Starts local Supabase (`supabase start`).
2. Applies the migrations and the v1 seed data (`supabase db reset`).
3. Writes `.env.local` with the local keys.
4. Invites `OWNER_EMAIL` as the Owner.
5. Starts Next.js on http://localhost:3000.

Local emails don't go out. Open the invite and sign-in links from the Mailpit inbox at http://127.0.0.1:54324.

On later runs, `npm run dev` is enough. Run `npm run db:reset` to go back to the seed data.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev:all` | Full local stack in one command (see above) |
| `npm run dev` | Next.js only (Supabase already running) |
| `npm run build` / `start` | Production build / serve |
| `npm run lint` · `typecheck` | ESLint · `tsc --noEmit` |
| `npm test` | Domain unit tests (Vitest) |
| `npm run test:e2e` | Playwright end-to-end tests against a running app (see CLAUDE.md → E2E) |
| `npm run test:db` | Applies the migrations and seed to a throwaway Postgres DB and tests RLS as anon / uninvited / viewer / supervisor / owner. Needs `TEST_DATABASE_URL` (a Postgres superuser). Docker isn't required. |
| `npm run seed:generate` | Regenerates `supabase/seed.sql` from `supabase/seed/data.ts` |
| `npm run deploy:sql` | Regenerates `supabase/deploy/setup.sql` (all migrations + seed, for a new hosted project) |
| `npm run bootstrap:owner` | Makes `OWNER_EMAIL` the Owner (safe to re-run) |
| `npm run check:prod` | Go-live check against `DATABASE_URL`: seed, structure, realtime, storage and every permission rule, in a rolled-back transaction |
| `npm run demo:add` · `demo:remove` | Adds (or refreshes) a sample day for the Modification TV from the real crew (Francis, Toto, Norlen) and real task names, or removes it |
| `npm run displays:create` | Creates one TV display link per department (each link is printed once) |

## Deploy (Supabase + Vercel)

Step-by-step guide, no command line needed: **[docs/DEPLOY.md](docs/DEPLOY.md)**. In short, you paste `supabase/deploy/setup.sql` into the Supabase SQL Editor, import the repo into Vercel with the variables from `.env.example`, connect the auth URLs and email templates, then invite yourself as Owner.

Deploying with Claude Code on your own computer: start from **[docs/DEPLOY_KIT.md](docs/DEPLOY_KIT.md)** (SQL order, checks, env vars, auth settings). The production runbook is **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**.

## Roles

| Role | Sees | Changes |
|---|---|---|
| Owner | everything, including salaries, rates and labour cost | everything; invites users and sets roles |
| Supervisor | everything **except** cost (blocked in the database, not only in the UI) | everything except cost |
| Viewer | non-cost views | nothing |
| Display (TV) | an allow-listed, cost-free snapshot via its secret token | nothing |
