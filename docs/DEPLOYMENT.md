# Deployment — Kynetik Build Tracker

> Runbook for production. **No secrets in this file**: keys and passwords live only in Vercel's encrypted environment variables and in the Owner's password manager. Fill in the `‹…›` fields after the first deploy (see `docs/DEPLOY_KIT.md`).

## What is running

| Item | Value |
|---|---|
| App | Vercel project ‹name›, production URL ‹https://…› (deploys from `main`) |
| Database / auth / storage | Supabase project `kynetik-build-tracker`, ref ‹ref›, region ‹region› |
| Env vars on Vercel | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SITE_URL` |
| Auth | invite-only (`disable_signup`), magic link + invite templates from `supabase/templates/`, redirect allow-list ‹live URL›/** and localhost |
| Email | SMTP via ‹provider›, sender "Kynetik Build Tracker" |
| Storage | private bucket `people-photos` (1 MB, JPEG/PNG/WebP) |
| Realtime | broadcast topic `kynetik-changes` (public channel; no row data), sent by database triggers |
| TVs | one display link per department (Console → Displays); links are not stored, only their hashes |

## Shipping a change

1. Open a PR. CI runs lint, types, unit tests, the database/RLS tests and the build.
2. Merge to `main`. Vercel builds and deploys automatically.
3. If the PR adds a file in `supabase/migrations/`:
   - With the Supabase GitHub integration set to deploy to production, it is applied on merge. Check under Supabase → Branches / Migrations.
   - Otherwise apply it yourself, before or right after the merge: `supabase db push` (linked project), or paste the new file into the SQL editor.
   - Never edit a migration that has already run. Add a new one.
4. Run `npm run check:prod` (needs `DATABASE_URL` in `.env.local`). It must be all ✅.

## Adding a TV

Console → Displays → New display: a name ("Paint bay TV"), the department, the leaderboard mode (side panel, rotating, or off), and confetti on or off. Copy the link straight away, because it is shown only once. Open it on the TV in full-screen (kiosk) mode. To stop a TV, press **Revoke**: it stops updating within seconds. `npm run displays:create` makes one link per department in one go.

## People

- **Invite:** Console → Users → Invite (role Owner, Supervisor or Viewer). The person gets an email link. Uninvited emails can't sign in.
- **Crew:** Setup → Crew holds departments, photos and task queues. Salaries are Owner only.

## Rolling back a bad deploy

- **App:** Vercel → Deployments → pick the last good one → **Promote to Production** (instant; no rebuild).
- **Database:** migrations are forward-only. Write a new migration that undoes the change, and test it with `npm run test:db` first. For data mistakes, Supabase → Database → Backups (daily backups on paid plans; point-in-time recovery if enabled).
- The audit log (Console → Audit) shows who changed what, with before → after values.

## Checks

- `npm run check:prod`: seed and structure, realtime, storage, and every permission rule (rolled back; changes nothing).
- `SITE_URL=… DISPLAY_TOKEN=… npm run check:prod`: also checks a live TV feed (no cost fields, one department only).
- Don't run the Playwright e2e suite against production: it changes Nino's queue and creates a test display.
