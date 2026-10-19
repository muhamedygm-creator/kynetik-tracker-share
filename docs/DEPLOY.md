# Put Kynetik Build Tracker online (Supabase + Vercel)

About 15 minutes, once. You need a GitHub login (you already have one) and a free Supabase and Vercel account.

## 1 · Merge the code into `main`
Open PR #1 on GitHub and click **Merge pull request**. Vercel deploys from `main`.

## 2 · Create the database (Supabase)
1. Go to https://supabase.com, sign in with GitHub, and click **New project**.
   - Name: `kynetik-build-tracker`. Choose a strong database password and keep it safe. Pick the region closest to Dubai.
2. When the project is ready, open **SQL Editor**, then **New query**.
3. Open [`supabase/deploy/setup.sql`](../supabase/deploy/setup.sql) on GitHub, click **Raw**, and copy all of it.
4. Paste it into the editor, click **Run**, and confirm if Supabase warns about destructive operations. It should finish with "Success. No rows returned".
5. In **Project Settings → API** (or **API Keys**), copy three values for step 3:
   - **Project URL**
   - **anon / publishable** key
   - **service_role / secret** key. Keep this one private: it can read everything.

## 3 · Deploy the app (Vercel)
1. Go to https://vercel.com, sign in with GitHub, click **Add New → Project**, and import `kynetik-Managment-tool`.
2. Before clicking Deploy, open **Environment Variables** and add:

   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Project URL from step 2.5 |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon / publishable key |
   | `SUPABASE_SERVICE_ROLE_KEY` | service_role / secret key |
   | `NEXT_PUBLIC_SITE_URL` | leave it out for now (step 5) |

3. Click **Deploy**. When it finishes, copy your app URL, e.g. `https://kynetik-managment-tool.vercel.app`.

## 4 · Connect sign-in (Supabase → Authentication)
1. Go to **URL Configuration**:
   - Site URL: your Vercel URL
   - Redirect URLs: add `https://YOUR-APP.vercel.app/**`
2. Go to **Sign In / Providers → Email** (or "Auth Providers"). Turn **off** "Allow new users to sign up". The app is invite-only.
3. Go to **Email Templates**:
   - **Invite user:** set the subject to `You're invited to Kynetik Build Tracker`. Paste the contents of [`supabase/templates/invite.html`](../supabase/templates/invite.html) as the body.
   - **Magic Link:** set the subject to `Your Build Tracker sign-in link`. Paste [`supabase/templates/magic_link.html`](../supabase/templates/magic_link.html) as the body.

## 5 · Tell the app its own address (Vercel)
In Vercel, open **Project → Settings → Environment Variables**, add `NEXT_PUBLIC_SITE_URL` = your Vercel URL, then **Deployments → ⋯ → Redeploy**.

## 6 · Make yourself the Owner
1. In Supabase **SQL Editor**, run this with your email:
   ```sql
   insert into public.invitations (email, role) values ('you@kynetikkoncepts.com', 'owner');
   ```
2. Go to **Authentication → Users → Add user → Send invitation**, and enter the same email.
3. Open the email and click **Accept the invitation**. You land on the Board as Owner.

From now on, you invite everyone else from the app's **Users** tab.

## Good to know
- **Email:** Supabase's built-in email only sends to members of your Supabase team, and only a few emails per hour. Before inviting staff, add your own mail server under **Project Settings → Authentication → SMTP Settings**, for example the company mail provider, Resend or Postmark.
- **Employee photos:** the setup SQL creates a private Storage bucket `people-photos` (1 MB limit). Nothing to configure.
- **Updates:** every merge to `main` redeploys the app automatically. When a later phase adds database changes, it ships its own SQL file to run once in the SQL Editor, and the release notes will say so.
