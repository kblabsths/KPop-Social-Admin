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
- A walk needs `SUPABASE_URL` **and** `SUPABASE_SERVICE_ROLE_KEY` in `.env`;
  as of 2026-09-01 `.env` carries `SUPABASE_URL` and `SUPABASE_ANON_KEY` and
  **no service-role key**, so a local walk cannot read anything yet. That is
  one of the open questions in the env-names ASK ticket — do not improvise a
  fallback, and never print a value.
- `npm run lint` and `npm run build` both complete in seconds here (measured
  2026-09-01: lint 2.8s once `agenticflow/**` is ignored, build 6.2s, tsc
  1.1s) — cheap enough to sit in every ticket's checks.

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
