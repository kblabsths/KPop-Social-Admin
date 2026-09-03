# STACK — kspace Admin, campaign `admin-window`

**Brownfield: this file documents what IS.** The stack is fixed by
`contracts/admin-observability.md` §3 ("what persists is infrastructure: the
Next.js app on Railway deploying from `main`, NextAuth sign-in gated by
`admin_allowed_emails`, every read and write server-side through the service
role. Changing any of these is a design change, not a build choice"). Nothing
below was chosen by the factory except the **test runner** (§4) — the repo had
none. Every line names the file that proves it.

Read 2026-09-01: `contracts/admin-build.md` (ground rules), `AGENTS.md`,
`package.json`, `package-lock.json` (lockfileVersion 3),
`node_modules/next/dist/docs/01-app/**` (Next 16 differs from training data —
read the bundled docs, not memory).

---

## 1. Runtimes and language

| thing | version | where it is declared / observed | why |
| --- | --- | --- | --- |
| Node.js | `>=20.0.0` declared; **26.7.0** observed on this machine 2026-09-01 | `package.json` `engines.node`; `node -v` | what the app already runs on; Railway/nixpacks resolves from `engines` |
| npm | 12.0.2 observed; lockfile v3 | `npm -v`, `package-lock.json` | the only package manager here — no pnpm/yarn/bun lockfile exists |
| TypeScript | `^5` (`strict: true`, `noEmit`) | `package.json`, `tsconfig.json` | already the language of every file in `src/` |
| React | 19.2.4 (exact-pinned) | `package.json` | Next 16's runtime |
| Next.js | 16.2.2 (exact-pinned), **App Router** | `package.json`, `src/app/**` | the deployed app |
| Tailwind CSS | v4 (`@tailwindcss/postcss`) | `postcss.config.mjs`, `src/app/globals.css` (`@import "tailwindcss"`) | already the styling layer; v4 is CSS-first (`@theme`), not `tailwind.config.js` |
| ESLint | v9 flat config, `eslint-config-next` 16.2.2 | `eslint.config.mjs` | `npm run lint` is acceptance test 1 |

**Do not upgrade any of these in M1.** A version move is a DEP ticket
(`agenticflow/docs/ALLOWED_DEPS.md`, "a grandfathered entry never lowers the
bar for its own upgrade"), and the deploy is out of this campaign's scope.

## 2. Storage — none of it is ours

The app owns **zero** schema. Storage is the shared Supabase (Postgres)
project, reached over PostgREST by `@supabase/supabase-js` ^2.101.1
(`src/lib/supabase.ts`), **server-side only, with the service-role key**.

- **Schema truth is the sibling repo**: `/Users/ben-m4/Desktop/Coding/KPOP/kspace Scraper/supabase/migrations/`.
  This repo's `supabase/migrations/` holds exactly **two** app-owned files
  (`20260406_admin_allowed_emails.sql`, `20260407_add_kblabs_admin_email.sql`)
  and **never grows** in M1 (M1 exit criterion: zero schema).
- **No ORM, no query builder, no migration tool in this repo.** PostgREST
  through supabase-js is the entire data access story
  (`ALLOWED_DEPS.md`, "Product shape, for the record").
- Consequence a builder must plan around: **PostgREST cannot run arbitrary
  SQL.** No `percentile_cont`, no ad-hoc join, no aggregate beyond `count`.
  Gauges fetch bounded row sets and aggregate in TypeScript — see
  `ARCHITECTURE.md` §6. This is not a workaround to be "fixed" with an RPC:
  the acceptance doc forbids building a SQL-executing route.

## 3. The auth gate and the service-role client (carried over untouched)

- `src/middleware.ts` — `export { auth as middleware } from "@/lib/auth"` with
  a matcher that protects **everything** except `api/auth`, `api/health`,
  `_next/static`, `_next/image`, `favicon.ico`, `login`. Adding a page adds
  protection automatically; adding a public path is a design change.
- `src/lib/auth.ts` — NextAuth v5 (`next-auth` ^5.0.0-beta.30), Google
  provider, JWT sessions, `pages.signIn = "/login"`. The `signIn` callback
  looks the email up in **`admin_allowed_emails`** (case-insensitive `ilike`)
  and **fails closed** on error or miss.
- `src/lib/admin.ts` — `requireAdmin()`: the same allowlist check for route
  handlers, returning 401/403 `Response`s.
- `src/lib/supabase.ts` — `getSupabaseAdmin()`, a lazily-created
  `createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false}})`
  singleton. **Server-side only**; the key must never reach a client bundle
  (acceptance test 12).
- `src/app/api/health/route.ts` — unauthenticated `{ok:true}`; Railway's
  healthcheck target. Leave it alone.

These four files plus `src/app/login/page.tsx` are the only pre-campaign
`src/` files that survive the rebuild (`ARCHITECTURE.md` §2).

## 4. Test runner — the one thing this campaign chooses

**Vitest** (`vitest`, latest 3.x at DEP time), with `vite-tsconfig-paths` so
tests resolve the repo's `@/*` alias. Filed as **DEP-0001**; nothing may be
installed before the toolsmith lands it in `ALLOWED_DEPS.md`.

Why Vitest and not something else:

- It is one of the four runners **Next.js documents itself**
  (`node_modules/next/dist/docs/01-app/02-guides/testing/vitest.md`, read
  2026-09-01) — the boring, well-trodden option for a TS/ESM Next app, and
  the one the QA Adversary and Verifier will already know.
- Jest needs `next/jest`, babel/SWC transform config and CJS/ESM mediation for
  the same result; `node:test` would need a separate TS loader story. Vitest
  reads `tsconfig` paths, runs TS natively, and needs one config file.
- **No jsdom, no Testing Library, no Playwright dependency in this campaign.**
  Next's own guide says Vitest does not support `async` Server Components;
  our answer is architectural rather than another dependency: a route's
  page function is the **only** async component and every child is a pure
  sync component (`ARCHITECTURE.md` §5), so a test does
  `renderToStaticMarkup(await Page(props))` with `react-dom/server` — already
  a dependency — and asserts on the markup. Screenshots and browser walks are
  the walk agent's Playwright (kit-owned, `agenticflow/.venv-tools`), not a
  product dependency.

### The offline / live split (acceptance tests 1 and 13)

Two directories, two scripts, no ambiguity — the directory **is** the live
marker:

```
tests/offline/**/*.test.ts     npm test          # default; NEVER touches a network
tests/live/**/*.live.test.ts   npm run test:live # staging; refuses if names unset
tests/http/**/*.http.test.ts   npm run test:http # builds + starts the app, no DB needed
```

- `npm test` passes with **no** `STAGING_SUPABASE_*` names in the environment.
  That is the bar of acceptance test 1, and it is structural: the offline
  project's glob cannot reach `tests/live/`.
- `npm run test:live` **refuses loudly** (non-zero, no fallback) when
  `STAGING_SUPABASE_URL` or `STAGING_SUPABASE_SERVICE_ROLE_KEY` is unset. An
  unset name is never a fallback to `SUPABASE_*` (acceptance doc ground rule).
- Every live test sweeps every row it wrote (acceptance test 13).
- Vitest does not read `.env`; the live setup file loads it explicitly with
  `dotenv` (already a devDependency, grandfathered).

## 5. The exact incantations

Run every one of these from the repo root
`/Users/ben-m4/Desktop/Coding/KPOP/kspace Admin` (the directory name contains a
space — quote it).

| purpose | command | port |
| --- | --- | --- |
| dev server (default) | `npm run dev` | **3000** |
| **walk / sandbox instance** | `npm run dev -- --port 8771` | **8771** |
| production-like walk | `npm run build && npm run start -- --port 8771` | **8771** |
| type check | `./node_modules/.bin/tsc --noEmit` | — |
| lint | `npm run lint` | — |
| offline suite | `npm test` | — |
| live suite (staging) | `npm run test:live` | — |
| http suite | `npm run test:http` | 8772 (its own server) |

- **8770 is the factory's attention UI** (`run.yaml` `ui_port`). Never bind it.
- A walk instance takes its database credentials from **its own process
  environment** under the names `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`,
  mapped there from the `STAGING_*` names by the launching shell — the app
  itself never reads a `STAGING_*` name. `.env` no longer carries
  `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` at all; it carries the
  `STAGING_*` pair, which the launch line loads (recipe below, step 1) —
  production values live only in Railway's production environment (Ben's
  ruling, 2026-09-03, recorded in `agenticflow/docs/DECISIONS.md`). Nothing in
  code falls back to another name, and no value is ever printed. **Both
  walk rows in the table above take the same step-1 prefix** — the
  production-like row (`npm run build && npm run start`) exactly as much as
  `npm run dev`.
- `npm run lint` and `npm run build` both complete in seconds here (measured
  2026-09-01: lint 2.8s once `agenticflow/**` is ignored, build 6.2s, tsc
  1.1s) — cheap enough to sit in every ticket's checks.

### The walk instance: launch it, get past the gate, drive it

Everything below is verbatim and runnable from the repo root. It is the whole
recipe for the M1 endgame walkers (designer walk, user-sims, verifier), settled
by Ben's two rulings of 2026-09-03 and proved by
`tests/http/walk-cookie.http.test.ts`.

**1. Launch the instance.** The two names the app reads (`SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`) are mapped from the staging names on the launching
shell's command line, so they exist for that process and nowhere else. The
staging names themselves live in exactly one place — the **repo-root `.env`**
(gitignored; its names, and only its names, are listed in `.env.example`) — and
a fresh shell does not have them, so loading `.env` is part of the launch line.
Run the whole thing inside a subshell `( … )`, so the loaded values die with
that process:

```sh
( set -a && source .env && set +a && \
  SUPABASE_URL="$STAGING_SUPABASE_URL" SUPABASE_SERVICE_ROLE_KEY="$STAGING_SUPABASE_SERVICE_ROLE_KEY" \
  AUTH_URL="http://localhost:8771" npm run dev -- --port 8771 )
```

That is verbatim how the walk instance running on 8771 was launched, and it
works in both bash and zsh. Two things about it are not optional:

- **The `set -a` prefix.** Drop it and the failure is silent rather than loud:
  an unset shell variable expands to the empty string, so the app starts with
  `SUPABASE_URL=""` — and `.env` cannot repair that, because Next's env loader
  skips any name already present in the process environment, empty string
  included (`node_modules/@next/env/dist/index.js`). Nothing complains until
  the first server-side read, which dies in `getSupabaseAdmin()` with
  `supabaseUrl is required` (`src/lib/supabase.ts`); a walker who does not know
  this reports app-wide breakage that does not exist. Measured 2026-09-03
  (admin-window/BUG-0039).
- **The surrounding `( … )`.** `set -a` exports *every* name in `.env` for the
  length of that subshell — OAuth secrets included — and the closing paren is
  what keeps them out of your interactive shell and out of every later command
  in the session.

**Never print a value to check your work.** No `echo "$STAGING_SUPABASE_URL"`,
no `printenv`, no `cat .env`, no `env | grep` — a secret value that reaches a
transcript is burned and Ben has to rotate it. Test *presence* instead, which
prints one word:

```sh
[ -n "${STAGING_SUPABASE_URL:-}" ] && echo SET || echo UNSET
```

`AUTH_URL` is not optional. next-auth resolves the app's own origin from it
(`node_modules/next-auth/lib/env.js`); without it every redirect the walk
follows is rewritten to `:3000` and the walk chases a server that is not there.
It also decides the **cookie name**: `@auth/core`'s `defaultCookies()` prefixes
`__Secure-` only for an `https:` URL
(`node_modules/next-auth/node_modules/@auth/core/lib/utils/cookie.js`), so an
`http://` walk instance uses the unprefixed `authjs.session-token` the mint
below produces.

The instance also needs `AUTH_SECRET` in that same environment — the mint and
the server must agree on it, and neither has a default. The `source .env` above
is what supplies it to the server; the mint helper below reaches the same value
on its own (its process environment first, then the repo-root `.env`), so the
two agree without either printing it.

**2. Mint a session cookie.** Sign-in is Google-only, so a walker gets past the
gate with a minted cookie rather than a sign-in flow. The minting helper lives
outside `src/` on purpose (`tests/walk/session-cookie.mts`); the app gains no
provider, no dev flag and no second sign-in path:

```sh
node tests/walk/session-cookie.mts
```

stdout is **exactly one line**: the cookie as JSON. Diagnostics and refusals go
to stderr, and `AUTH_SECRET`'s value never appears on either stream. Flags:
`--domain <host>` (default `localhost`), `--max-age <seconds>` (default 7200),
`--email <address>` (default the walker identity). With `AUTH_SECRET` unset,
empty or whitespace-only, the CLI exits non-zero naming that one name and mints
nothing — there is no fallback to invent.

**3. Drive it.** Add the descriptor to the browser context before the first
navigation (Playwright, Python):

```python
import json, subprocess
cookie = json.loads(
    subprocess.run(
        ["node", "tests/walk/session-cookie.mts"],
        capture_output=True, text=True, check=True, cwd=REPO_ROOT,
    ).stdout
)
context.add_cookies([cookie])
page.goto("http://localhost:8771/")
```

**Two caveats a walker must know before it reports a bug.**

- **The sign-in flow itself is never walked.** That blind spot is accepted, not
  overlooked: a minted cookie starts the walk already past the gate, so nothing
  the walk sees says anything about Google sign-in.
- **A walker's saves LAND on staging — the walk writes real rows.** Ben added
  the labelled row `walker@admin-window.local` to staging's
  `admin_allowed_emails` on 2026-09-03 (beside `kb.labs.ths@gmail.com`), which
  is the table `requireAdmin()` (`src/lib/admin.ts`) consults on **every**
  request from `src/app/api/admin/records/[table]/[id]/route.ts`. Measured the
  same day (admin-window/BUG-0038): a PATCH carrying the minted cookie answers
  **200** and the column really changes. The middleware gate is the looser one —
  it asks only `!!session?.user` (`src/lib/auth.ts`) — so reads were never the
  question. **What this obliges a walker to do**, until the walk sandbox lands
  (`ARCHITECTURE.md` §9.1, admin-window/TASK-0035/0036): a save-path walk edits
  **one field of one existing `groups` / `idols` row**, notes the original value
  first, restores it before the walk ends, and sweeps for residue afterwards.
  Never a resolver-owned table (`events`, `venues`), never an insert, never a
  delete. A save that fails is a finding worth reporting; a save that succeeds
  and is left behind is catalog damage in a shared database.

## 6. Deploy (untouched by this campaign)

`railway.toml`: nixpacks builder, `buildCommand = npm run build`,
`startCommand = npm run start`, healthcheck `/api/health`. Railway deploys
from `main`. **Every push to `main` must leave the app deployable against
whatever project the deployed service targets** — which is why a missing
ecosystem table renders a not-provisioned state instead of throwing
(acceptance test 9). The campaign never repoints the service and never edits
`railway.toml`.

## 7. Repo hygiene

`.gitignore` already covers `/node_modules`, `/.next`, `/out`, `/build`,
`/coverage`, `*.tsbuildinfo`, `.env*`, and the factory's volatile paths. No
seeding needed. One correction lands in TASK-0001: **`eslint.config.mjs` must
ignore `agenticflow/**`** — the kit's Python venv ships Playwright's bundled
JS, and ESLint currently walks into it and reports 2,064 errors that have
nothing to do with the product (measured 2026-09-01; with the ignore, `npm run
lint` exits 0). Acceptance test 1 is unreachable without it.

## Trust boundary

`public-surface: the NextAuth + admin_allowed_emails sign-in gate, and the
service-role privilege behind it` — every route under `src/app/**`, including
the edit surface's PATCH route.

This is an internet-reachable Railway service that holds a service-role key
able to write the shared catalog. Security-adversarial QA is in scope and
aimed at that boundary: unauthenticated reach (acceptance test 12), forged
edit requests naming a column outside the config map (acceptance test 7), and
service-role material leaking into a client bundle. Probing the staging
database's own grants beyond what those tests need is not this campaign's
budget — and production is never a target, ever.
