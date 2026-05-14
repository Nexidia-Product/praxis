# Praxis

Lightweight platform for tracking, managing, and prioritizing innovation
projects and tasks. See `IIM_Application_Design_Requirements.docx` for the
full design document.

## Stack

- **Framework:** Next.js 15 (App Router) with TypeScript
- **Styling:** Tailwind + a Polaris-style design token layer in `app/polaris.css`
- **Database:** Supabase (Postgres) via `@supabase/supabase-js`
- **Auth:** Supabase Auth with cookie sessions (server-side via `@supabase/ssr`)
- **Email (auth):** Supabase Auth's built-in templates (invite, recovery, signup)
- **Email (notifications, optional):** Resend; no-ops cleanly when unset
- **Hosting:** Vercel — daily notification sweep runs via Vercel Cron
- **PPTX export:** `pptxgenjs` + `html2canvas` over a swappable template in `public/branding/`

No ORM. All database access goes through repositories in `lib/db/*` — the same
abstraction that let us swap JSON files for Supabase with no UI churn.

## Folder structure

```
/app                          Pages and API routes (App Router)
/components                   Client components organized by feature area
/lib
  /auth                       Session helpers (Supabase-backed permissions)
  /db                         Repositories — one file per entity
  /supabase                   Three Supabase clients: server / request / browser
  /audit                      Audit-log service
  /notifications              Notification service + daily sweep
  /projects, /tasks, /ideas   Service-layer validators + helpers
  /export                     PPTX builder, branding resolver
  /velocity, /health, ...     Feature-specific math
/public                       Static assets (incl. PPTX branding templates)
/scripts                      Admin / migration utilities (run with tsx)
/supabase/migrations          SQL schema migrations
middleware.ts                 Session refresh + public-path allow-list
vercel.json                   Daily cron entry
```

## Initial setup

You need:

- Node.js 20.6+ (uses `--env-file` flag natively)
- A Supabase project (free tier is fine for now)

1. **Install dependencies**
   ```
   npm install
   ```

2. **Configure environment**
   ```
   cp .env.example .env.local
   ```
   Fill in:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `NEXT_PUBLIC_SITE_URL` (e.g. `http://localhost:3000` for dev)

3. **Apply the schema migrations** — Supabase Dashboard → SQL Editor.
   Paste each file from `supabase/migrations/` in order (`0001_*.sql`,
   `0002_*.sql`) and run.

4. **Configure Supabase Auth**
   - Authentication → Providers → Email: enable, recommend "Confirm email"
   - Authentication → URL Configuration: Site URL = your site,
     Redirect URLs add `http://localhost:3000/api/auth/callback`
     (and the Vercel URL once deployed)
   - Authentication → Email Templates: update "Reset Password" and "Invite user"
     to point at our callback. Templates:

     **Reset Password:**
     ```html
     <h2>Reset Password</h2>
     <p><a href="{{ .SiteURL }}/api/auth/callback?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password">Reset Password</a></p>
     ```
     **Invite user:**
     ```html
     <h2>You're invited to Praxis</h2>
     <p><a href="{{ .SiteURL }}/api/auth/callback?token_hash={{ .TokenHash }}&type=invite&next=/reset-password">Accept invite</a></p>
     ```

5. **Verify connectivity**
   ```
   npm run smoke:supabase
   ```
   Should print "All 9 application tables exist."

6. **Seed sample data**
   ```
   npm run seed                            # writes JSON snapshots under data/
   npm run migrate:supabase -- --confirm   # imports them into Supabase
   ```

7. **Create initial users (bypasses Supabase's 2 emails/hr free-tier limit)**
   ```
   cp data/initial-users.example.json data/initial-users.json
   # edit to your real team
   npm run admin:bulk-create -- --confirm
   ```
   Each user gets a recovery URL printed to the terminal. Share each URL
   with its user (Slack DM, password manager, etc.) — they click, set a
   password, and they're in.

8. **Run**
   ```
   npm run dev
   ```

## Environment variables

Reference: `.env.example`.

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Browser-safe anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Server-only secret key |
| `NEXT_PUBLIC_SITE_URL` | yes (prod) | Canonical site URL for invite/reset emails |
| `CRON_SECRET` | yes (prod) | Bearer token Vercel Cron uses for the daily sweep |
| `RESEND_API_KEY` | optional | Per-event notification emails; logs to stdout when unset |
| `RESEND_FROM` | optional | From-address for Resend emails |
| `IIM_ADMIN_EMAIL`, `IIM_ADMIN_NAME` | optional | Override seed defaults |
| `IIM_SEED_SOURCE` | optional | Path to source spreadsheet |
| `PRAXIS_PPTX_TEMPLATE_DIR`, `PRAXIS_PPTX_TEMPLATE_PATH` | optional | Override the bundled PPTX template path |

## Deployment to Vercel

1. **Push the repo to GitHub** (or GitLab / Bitbucket).
2. **Vercel → Add New → Project** → import the repo.
3. **Environment variables** — paste these into the project settings (all environments):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `NEXT_PUBLIC_SITE_URL` = your Vercel URL (e.g. `https://praxis.vercel.app`)
   - `CRON_SECRET` = generate with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
   - `RESEND_API_KEY`, `RESEND_FROM` (optional)
4. **Deploy.** First deploy builds and runs on the next git push.
5. **Update Supabase Auth → URL Configuration** with the Vercel URL:
   - Site URL = `https://your-praxis.vercel.app`
   - Redirect URLs add `https://your-praxis.vercel.app/api/auth/callback`
6. **Smoke-test the live URL.** Sign in, exercise a few flows, click "Run sweep
   now" under `/admin/notifications` to confirm cron-style auth works.

### About the daily cron

`vercel.json` declares a daily cron at 07:00 UTC that POSTs to
`/api/admin/notifications/sweep` with `Authorization: Bearer $CRON_SECRET`.
The route checks the header; admin UI calls fall through to the
session-based permission check.

The sweep is pinned to 10s (Hobby plan limit). The bulk health-score
recalc that used to happen here has been removed — per-write hooks in
the project / task service keep individual project badges current as
data changes. To force a full recalc after a bulk import, run
`tsx --env-file=.env.local -e "import('./lib/health').then(m => m.recalculateAllHealthScores())"`.

## Scripts

### Day-to-day development

| Command | Purpose |
| --- | --- |
| `npm run dev` | Dev server with HMR |
| `npm run build` | Production build |
| `npm run start` | Run the production build |
| `npm run typecheck` | `tsc --noEmit` |

### Admin utilities (no UI, run from terminal)

| Command | Purpose |
| --- | --- |
| `npm run admin:bulk-create -- --confirm` | Create the initial user roster from `data/initial-users.json`, print recovery URLs |
| `npm run admin:recovery-link -- --email <addr>` | Mint a fresh recovery URL for an existing user |
| `npm run admin:update-email -- --to <addr>` | Change an admin's email in both auth.users and public.users |
| `npm run admin:delete-user -- --email <addr>` | Testing aid — fully remove a user from both stores |

### Data migration / seeding

| Command | Purpose |
| --- | --- |
| `npm run seed` | Rebuild `data/*.json` snapshots from the source spreadsheet |
| `npm run migrate:supabase` | Dry-run preview of the JSON → Supabase import |
| `npm run migrate:supabase -- --confirm` | Wipe Supabase tables and re-import the JSON snapshots |
| `npm run migrate:auth-users -- --confirm` | Create Supabase Auth entries for every user in `public.users`, print recovery URLs |
| `npm run prepare:branding` | Render `cover.png` / `content.png` from `public/branding/template.pptx` (requires LibreOffice + poppler) |

### Smoke tests

| Command | Covers |
| --- | --- |
| `npm run smoke:supabase` | Connectivity + schema presence |
| `npm run smoke:db` | Repository CRUD round-trips |
| `npm run smoke:projects` | Project service: validation, sparse patches, custom fields |
| `npm run smoke:tasks` | Task service + template instantiation |
| `npm run smoke:roadmap` | Date math, NNL placement, capacity pivot |
| `npm run smoke:export` | PPTX slide catalog, branding, builders |
| `npm run smoke:decisions` | Decision log + link validation + dependency rollup |
| `npm run smoke:notifications` | Notification hooks, daily sweep, digest, idempotency |
| `npm run smoke:health` | Health scoring, persistence, downstream cascade |
| `npm run smoke:velocity` | All seven Section 5.15 metrics + caching |
| `npm run smoke:ideas` | Submission, transitions, conversion, overlap heuristic |
| `npm run smoke:template` | Template instantiation edge cases |
| `npm run smoke:admin-exclusion` | "Admin" project-type exclusion from velocity |

## Architecture quick reference

### Three Supabase clients, three purposes

- `lib/supabase/server.ts` — service-role, bypasses RLS. Used by every
  repository in `lib/db/*`. App-internal reads/writes.
- `lib/supabase/request.ts` — anon key + request cookies. Resolves
  "who's calling" inside server components / API routes via
  `lib/auth/permissions.ts`.
- `lib/supabase/client.ts` — browser-side cookie-aware client. Used by
  the sign-in/sign-out/forgot/reset flows.

### Auth flow

1. Browser submits `signInWithPassword` to Supabase (anon key).
2. Supabase sets session cookies.
3. Every subsequent request: middleware refreshes the cookie, then
   server-side code calls `getSession()` → joins `auth.users` with
   `public.users` to fetch role + name + active flag.
4. Permissions enforced via `requirePermission("...")` in API routes
   and server components — backed by the live role-permissions map in
   `settings.role_permissions`.

### Storage swap

`lib/db/*` is an abstraction layer. The Supabase implementation lives
there now, but the function signatures are identical to the JSON-era
versions. Every caller — page, API route, service helper — stayed
unchanged through the migration. If the DB ever needs to swap again,
rewrite the function bodies and nothing else.
