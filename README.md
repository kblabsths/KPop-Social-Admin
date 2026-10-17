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

Names below, never values: `.env.example` carries the names and nothing else, and no value belongs in this
repo, a log or a transcript. **Where a value lives depends on which name it is**, and that split is a
ruling (`agenticflow/docs/DECISIONS.md`, 2026-09-03), not a habit.

**The two the app itself reads**, server-side only, through one seam (`src/lib/db/client.ts`, plus the
carried-over `src/lib/supabase.ts`):

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL` | The Supabase project the app reads (no `NEXT_PUBLIC_` prefix — it never reaches a client bundle) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key — bypasses RLS, never expose to the client |

Neither is in a file. In production the Railway service holds them; locally they exist only in the
process environment of a running instance, mapped there from the staging pair by the launch line in
`agenticflow/docs/STACK.md` §5. Nothing in the code falls back from one name to another, so an unset name
is a failure and never a quieter default.

**The rest are what a developer's machine carries** in a gitignored `.env` at the repo root, whose names —
and only whose names — are `.env.example`'s:

| Variable | Purpose |
| --- | --- |
| `STAGING_SUPABASE_URL` | The staging project: the only live target the test and walk tooling may touch |
| `STAGING_SUPABASE_SERVICE_ROLE_KEY` | Staging service-role key; an unset staging name is a loud refusal, never a fallback to the pair above |
| `AUTH_SECRET` | next-auth secret (`npx auth secret`); read outside `src/` only — see `tests/walk/session-cookie.mts` |
| `AUTH_URL` | The app's own public origin; next-auth resolves every redirect and the session cookie name from it, and a local instance is launched with it set explicitly (STACK.md §5) |
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
| `npm run test:live` | the live tier: a read-only contract smoke, ~10 cases in one file (`tests/live/contract.live.test.ts`), proving the offline stubs' assumptions about how PostgREST answers on **staging**; needs the staging names and refuses loudly if they are unset |
| `npm run test:http` | the HTTP tier (`tests/http/`) — builds the app, starts it, drives it over HTTP; needs no database |
| `npm run test:handoff` | the handoff tier (`tests/handoff/`), opt-in: the guards that READ the sibling repo `../kspace Scraper`, which this repo does not own — so a red there is a fact about the sibling, not about your diff. **Not part of `npm test`**; run it when you prepare or re-check a handoff |

The directory a test lives in *is* its tier (`tests/suite-globs.ts`) — five tiers: offline and
isolated (both under `npm test`), live, http, and the opt-in handoff tier. `npm test` cannot reach
`tests/live/` or `tests/handoff/`, which is why the offline suite is safe to run anywhere. Agent walk tooling lives in
`tests/walk/` and writes only to the staging-only `walk_sandbox` table; no test script can reach it
(none of the scripts above names it).

## Testing

Ben's rules of 2026-09-16 (`agenticflow/tracker/proposals/2026-09-16-testing-rules.md`), binding on
every test in this repo and on every agent that writes one:

1. **No test asserts a value it did not write.** A count, an id, a title or a
   population read from a shared database is not a fixture.
2. **No test writes anywhere shared.** Not production, not staging, not a
   sandbox table on staging. If a proof seems to need a shared write, the
   proof is in the wrong place — redesign it, never grant an exception.
3. **Live tests are expensive.** Few, read-only, each with a one-line reason it
   must be live. Their only job is to prove the offline stubs are honest about
   how the real service answers. (All tests should be clear; live ones must
   also justify their cost.)
4. **A test earns its place** by naming a bug it would catch that no other test
   catches. A pin that restates an existing rule, or grades how a thing happened
   to be written, is deleted.

### Proof versus test — the misunderstanding that produced the writes

"Proven end to end" in an acceptance list means: a person or an agent walks the
real thing ONCE, watches it, and leaves a dated note. It never means "write a
re-runnable test that does it on every run". The M2/M3 acceptance items 6, 7
and 8 were read the second way, became tests/live/settle.live.test.ts and
three tasks that had to write staging (TASK-0084/0085/0086), and produced
BUG-0215's residue. Ben walked them instead on 2026-09-16 (five of eight
actions; the report is in the inbox). Reword acceptance items to "walked and
recorded" wherever "proven" appears, and treat the verifier's close walk as the
mechanism.

A release-time live suite against a **disposable** database (never staging or
production) is the one legitimate re-runnable end-to-end run. Deferred: not
worth building until there is a production release to protect. Record it so it
is not reinvented as a staging test.

The guard over these rules for the live tier is `tests/offline/live-guard.test.ts`: one live file,
no write-shaped call in it, and a `LIVE BECAUSE:` line above every case.

## Deployment

Deployed on Railway from `main` (`railway.toml`: nixpacks, `npm run build`, `npm run start`, healthchecked
at the health endpoint above). Set the variables above on the Railway service, point `AUTH_URL` at the
public Railway domain, and add that domain's next-auth Google callback as an authorized redirect URI on
the Google OAuth client.
