# kspace Admin

The data ecosystem's **window**: the one place its operator sees what the pipeline did overnight, what
needs a human, and which sources keep being wrong — and settles the questions only a human can settle.
Rendered surfaces, never a SQL prompt.

Built with Next.js (App Router), Tailwind CSS v4, and next-auth v5. Every read and write goes through
the Supabase **service-role** client (`src/lib/supabase.ts`) in server components and route handlers —
there is no client-side Supabase usage and the key never reaches a browser bundle.

This app **owns no schema**. The catalog and ecosystem tables are produced and migrated by the sibling
`kspace Scraper` repo; Admin corrects values on vetted columns and nothing else. `AGENTS.md` states that
boundary in full and is binding.

## The six pages

The sidebar is the window, and it is exactly six entries (`src/components/shell/nav-items.ts`):

| Page | Route | What it answers |
| --- | --- | --- |
| Dashboard | `/` | Did anything happen last night — attention counts (decisions and signals kept apart), the newest resolver cycles and adapter runs, with their errors. Every figure links onward. |
| Queues | `/queues` | What needs me — the decision and signal queues of `review_items`, open first, severity then age. One item opens at its own address: what happened, the evidence (the claims behind it), and the close. |
| Claims | `/claims` | Pending claims as buckets with counts and age, filterable by source, domain and bucket; standing disagreements are their own tab. |
| Sources | `/sources` | Who keeps being wrong — the source registry, the awaiting-row trend and settled values. |
| Cycles & runs | `/cycles` | The resolver's cycles and the adapters' runs over time, with health and latency. |
| Browse | `/browse` | Recent events, newest first, with the spot-verification columns and the sources behind each row. |

A row reached from any of them opens its record page under `/records/`, where the fields listed in one
hand-written map (`src/lib/edit/config.ts`) are editable in place. The PATCH route under
`src/app/api/admin/records/` accepts only what that map allows, and the database's own refusal is what
the field shows when a write is rejected.

Everything else 404s on purpose. The surfaces of the old dashboard were retired with it and nothing
replaced their URLs — `src/app/not-found.tsx` says so rather than leaving a dead link looking alive.
Against a database that lacks the ecosystem tables, every page renders a not-provisioned state instead
of crashing.

## Authentication

Sign-in is Google OAuth via next-auth, gated by an allowlist: an email must exist in the
`admin_allowed_emails` table in Supabase (matched case-insensitively) or sign-in is rejected, and the
check fails closed on error (`src/lib/auth.ts`). Route handlers re-check the same allowlist through
`requireAdmin()` (`src/lib/admin.ts`). There is no self-serve signup — add rows to that table to grant
access. `src/middleware.ts` protects every route except sign-in, the auth endpoints, static assets and
the health endpoint (`src/app/api/health/route.ts`); adding a page protects it automatically.

## Environment variables

`.env.example` carries the **names**, and only the names — values live in a gitignored `.env` locally and
in the Railway service in production, and no value belongs in this repo, a log or a transcript.

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL` | Supabase project URL the app reads (server-side only, no `NEXT_PUBLIC_` prefix) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key — bypasses RLS, never expose to the client |
| `STAGING_SUPABASE_URL` | Staging project, the only live target the test and walk tooling may touch |
| `STAGING_SUPABASE_SERVICE_ROLE_KEY` | Staging service-role key; an unset staging name is a loud refusal, never a fallback to the pair above |
| `AUTH_SECRET` | next-auth secret (`npx auth secret`) |
| `AUTH_URL` | The app's own public origin; next-auth resolves every redirect and the session cookie name from it |
| `AUTH_GOOGLE_ID` | Google OAuth client ID |
| `AUTH_GOOGLE_SECRET` | Google OAuth client secret |

## Running it

`npm install`, then use the commands in **`agenticflow/docs/STACK.md` §5 ("The exact incantations")** —
it is the single source for the dev and production-like launch lines, their ports, and how the staging
names are mapped onto the two names the app reads. They are not restated here so there is only one copy
to keep true.

The scripts themselves are in `package.json`:

| Script | What it runs |
| --- | --- |
| `npm run dev` | dev server |
| `npm run build` / `npm run start` | production build and serve |
| `npm run lint` | ESLint (flat config, `eslint.config.mjs`) — must be clean before pushing |
| `npm run typecheck` | `tsc --noEmit`, strict |
| `npm test` | the offline tiers (`tests/offline/`, `tests/isolated/`) — no network, and green with no staging names in the environment |
| `npm run test:live` | the live tier (`tests/live/`) against **staging**; refuses loudly if the staging names are unset |
| `npm run test:http` | the HTTP tier (`tests/http/`) — builds the app, starts it, drives it over HTTP; needs no database |

The directory a test lives in *is* its tier (`tests/suite-globs.ts`): `npm test` cannot reach
`tests/live/`, which is why the offline suite is safe to run anywhere. Agent walk tooling lives in
`tests/walk/` and writes only to the staging-only `walk_sandbox` table.

## Deployment

Deployed on Railway from `main` (`railway.toml`: nixpacks, `npm run build`, `npm run start`, healthchecked
at the health endpoint above). Set the variables above on the Railway service, point `AUTH_URL` at the
public Railway domain, and add that domain's next-auth Google callback as an authorized redirect URI on
the Google OAuth client.
