# Deploy kit — read this before running the deploy prompt

For Claude Code running **on the Owner's computer** with `DEPLOY_PROMPT` (Supabase + Vercel). It records what this repo needs, so the deploy steps can run in order without guessing. Nothing here is a secret.

## 0 · Before anything: two traps

1. **The Supabase project is already linked to GitHub.** PR checks show "Supabase Preview" for project ref `bueqebwohmidfqmncmfp`. If its GitHub integration has *Deploy to production* switched on, **merging to `main` applies `supabase/migrations/` to production automatically.** In that case the tables already exist after the merge, so **don't run `setup.sql`** (it would fail on the existing tables). Run only the seed (see §2). Check first; never run SQL twice.
2. **Don't run the Playwright e2e test against production.** `tests/e2e/queue-display.spec.ts` deletes Nino's queue tasks and creates a test display. Run it only against a local or staging stack.

## 1 · What must be on `main`

- One PR: `claude/fervent-clarke-7jdi1k` → `main` (PR #1). It contains Phases 1–4 and 3.5. Merge it once its checks are green.
- Local checks on `main`: `npm ci && npm run lint && npm run typecheck && npm test && npm run build`. `npm run test:db` also works if a local Postgres superuser is available (`TEST_DATABASE_URL`).

## 2 · SQL, in order

| # | File | What it adds |
|---|---|---|
| 1 | `supabase/migrations/20261001000100_schema.sql` | core tables, cost tables, views |
| 2 | `supabase/migrations/20261001000200_security.sql` | roles, Row Level Security |
| 3 | `supabase/migrations/20261001000300_triggers.sql` | versions, audit log, realtime pings, invite → profile |
| 4 | `supabase/migrations/20261002000100_build_rpcs.sql` | build functions (create build, plan, baseline, rework, parts, stages) |
| 5 | `supabase/migrations/20261003000100_queue.sql` | departments, photos bucket, task queue, department displays, gamification key |
| 6 | `supabase/migrations/20261004000100_floor_log.sql` | floor log save (`commit_day`), rate snapshots, `day_labour` |
| 7 | `supabase/seed.sql` | the v1 data: settings (09:00–18:00), 6 workstations, 12 crew, 3 templates, 6 builds, 4 departments |

`supabase/deploy/setup.sql` is **1–7 in one file**, for an empty project only.

**Which to run.** In the SQL editor or `psql`:

```sql
select to_regclass('public.projects') as tables, (select count(*) from public.projects) as builds;
-- error or tables = null      → empty project: run setup.sql once
-- tables set, builds = 0      → migrations already applied (GitHub integration): run seed.sql once
-- builds = 6                  → already done: run nothing
```

With the CLI instead: `supabase link --project-ref <ref>` then `supabase db push` (applies 1–6), then run `supabase/seed.sql` once with `psql`.

## 3 · Checks after the SQL (deploy steps 3 and 5)

```bash
# .env.local (git-ignored) holds DATABASE_URL (Postgres connection string)
# or SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF (runs through the Management API, no DB password needed)
npm run check:prod
```

This prints ✅ / ❌ for the seed counts, departments, the 09:00–18:00 day, gamification, the queue, display columns, `commit_day`, realtime pings, the photos bucket, and every permission rule:

- anonymous can't read cost, audit, displays or data, and can't write;
- Supervisor reads no cost and no cost audit rows, and can't change salaries;
- Viewer can't write;
- display tokens are Owner-only.

Everything runs in one transaction that is rolled back, including the temporary test users. Add `SITE_URL` and `DISPLAY_TOKEN` (one display's token) to also check the live TV data: no cost fields, one department only.

## 4 · Realtime: nothing to enable per table

The app doesn't use table replication ("Realtime on tables"). Database triggers send a "something changed" broadcast with no row data on the public topic `kynetik-changes` (`realtime.send(..., private => false)`), and pages refetch through their own permissions. `npm run check:prod` confirms the triggers. In **Realtime → Settings**, public channels must be allowed: don't switch on "private channels only". If realtime is ever unavailable, the TVs still refresh every 10 seconds.

## 5 · Storage

Migration 5 creates the private bucket `people-photos` (1 MB, JPEG/PNG/WebP), with read for members and upload for Owner/Supervisor. The console reads photos through signed URLs, and TVs get short-lived signed URLs from the server. Nothing to configure. To test: upload a photo from Setup → Crew, then open a department TV.

## 6 · Vercel environment variables

| Name | Where | Value |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Production, Preview, Development | Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | all | anon / publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | all, **encrypted** | service_role / secret key (server only) |
| `NEXT_PUBLIC_SITE_URL` | Production | the live URL (set after the first deploy, then redeploy) |

The time zone is a setting in the database (`Asia/Dubai`), so there's no env var for it. `OWNER_EMAIL`, `DATABASE_URL`, `TEST_DATABASE_URL` and `E2E_*` are for local scripts only; don't put them on Vercel.

## 7 · Auth (Management API `PATCH /v1/projects/{ref}/config/auth`)

| Field | Value |
|---|---|
| `site_url` | live URL |
| `uri_allow_list` | `https://<live-url>/**,http://localhost:3000/**` |
| `disable_signup` | `true` |
| `mailer_subjects_invite` / `mailer_templates_invite_content` | "You're invited to Kynetik Build Tracker" / `supabase/templates/invite.html` |
| `mailer_subjects_magic_link` / `mailer_templates_magic_link_content` | "Your Build Tracker sign-in link" / `supabase/templates/magic_link.html` |

The magic-link template uses `{{ .RedirectTo }}` (the app passes `/auth/confirm?next=…`), and the invite template uses `{{ .SiteURL }}/auth/confirm`. Both send a `token_hash`, which the app verifies server-side.

## 8 · First Owner

`.env.local` with the production `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SITE_URL` and `OWNER_EMAIL=m.abdelkhalek@kynetikkoncepts.com`, then:

```bash
npm run bootstrap:owner   # adds the owner invitation and sends the invite (safe to re-run)
```

There's no need for a throwaway script. The Owner then opens the email and clicks **Accept the invitation**.

## 9 · TVs

```bash
npm run displays:create   # one link per department; each is printed once (only a hash is stored)
```

To replace a lost link: Console → Displays → Revoke, then run the command again (or create one in the console).

## 10 · Email

Supabase's built-in email only reaches members of the Supabase team, and only a few emails per hour. Set up SMTP before inviting staff (Management API: `smtp_host`, `smtp_port`, `smtp_user`, `smtp_pass`, `smtp_admin_email`, `smtp_sender_name = "Kynetik Build Tracker"`). Never echo `smtp_pass`.
