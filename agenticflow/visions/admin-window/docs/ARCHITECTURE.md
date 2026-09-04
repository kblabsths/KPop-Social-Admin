# ARCHITECTURE — kspace Admin, campaign `admin-window`

Sole writer: the architect. **The human reviews this file instead of reading
code**, so every amendment carries its why in the History section at the
bottom.

Derived 2026-09-01 from the human's frozen snapshots in `contracts/` — read in
full that day: `admin-observability.md` (**the spec**, §N below),
`admin-build.md` (**the acceptance doc**, ground rules + tests N),
`resolver.md`, `data-model.md`, `entity-linking.md` — plus schema truth read
from `/Users/ben-m4/Desktop/Coding/KPOP/kspace Scraper/supabase/migrations/`
and a code walk of `src/`. Runtime facts live in `STACK.md`.

**Where this file and a contract differ, the contract is right.** A silence
this file appears to fill without a citation is a bug in this file: report it,
do not follow it.

---

## 1. The repo boundary (read this before anything else)

Three sibling git repos share one Supabase project (root `CLAUDE.md`). This
campaign runs in **`kspace Admin`** and touches nothing else.

| repo | absolute path | owns | this campaign's policy |
| --- | --- | --- | --- |
| **kspace Admin** | `/Users/ben-m4/Desktop/Coding/KPOP/kspace Admin` | this app; `admin_allowed_emails` + `user_roles` migrations | the campaign's whole write surface |
| **kspace Scraper** | `/Users/ben-m4/Desktop/Coding/KPOP/kspace Scraper` | **the database schema** (`supabase/migrations/`), the registries, the resolver, the adapters | `run.yaml` `sibling_dirs` says `write_by_size` — **but see the freeze below** |
| kspace (mobile) | `/Users/ben-m4/Desktop/Coding/KPOP/kspace` | the Expo app | not touched, not read, not referenced |

### 1.1 The scraper repo is FROZEN for this campaign

`/Users/ben-m4/Desktop/Coding/KPOP/kspace Scraper/agenticflow/tracker/RUNNING`
**exists** (checked 2026-09-01; its most recent commits are the same day). The
kit's policy and spec §10 both say: *"everything, whatever its size, while a
campaign is running in the scraper repo, is a handoff."* So for the whole of
M1, treat the declared `write_by_size` as **`read_only`**:

- **Read it freely** — migrations are the schema truth every page depends on.
- **Write nothing.** Any needed change there — a migration, a registry value, a
  grant, a typo — is a **blocked handoff ticket** carrying the complete
  artifact: exact file content, target path, apply command, so Ben installs it
  in one move.
- **No ticket's `touch_scope` may name a scraper path.** The milestone-close
  cross-directory report checks exactly that (M1 EC14).
- Before any handoff is written, re-check the `RUNNING` file: if it is gone,
  the policy relaxes back to `write_by_size` for genuinely minor + necessary +
  reversible edits, and only the architect may make that call, in writing, on
  the ticket.
- **Admin-side workaround code written to dodge a scraper-side edit is
  forbidden** (spec §10). Blocked and honest beats built and wrong.

Expected handoffs in this campaign: **the two §9 migrations (`verdicts`,
`settle_review_item`) in M2** — and nothing else in M1, which carries zero
schema.

### 1.2 No relative parent paths. Ever.

**`../` must not appear in any import, path literal, config value, fixture
path, or test helper in product code or tests.** Builds run in worktrees under
`agenticflow/.worktrees/<branch>/`, where `../` resolves *inside this repo*,
not beside it — silently, with no error, reading the wrong thing or nothing.

- Sibling knowledge is consumed **through the database**, which is where the
  repos actually share it (spec §10: "knowledge the repos share is consumed
  where it is shared — domain value schemas and source state are rows Admin
  already reads; nothing is re-encoded from scraper YAML by hand").
- If a fact lives only in scraper YAML and not in a row, that is **a flagged
  gap and a blocked ticket, not a silent copy** (spec §10). The per-source
  `resolver.stuck_pattern` dial is exactly this case — see ASK-ticket §12.4.
- **What the ban is actually about: leaving your own product tree.** No
  relative path — in an import, a config value, a fixture path or a test
  helper — may resolve outside `src/` (product code) or outside `tests/`
  (tests). That is the failure this rule exists for and it is absolute.
  Relative imports that stay *inside* the tree are fine and are what landed:
  `src/lib/db/review-items.ts` imports `../review/shapes`, and
  `src/lib/gauges/*.ts` import `../db/result`. Neither is a defect and neither
  is to be churned. The `@/*` alias (`tsconfig.json` `paths`) is available and
  is the spelling to use from `src/app/**` and `src/components/**`, which are
  deep enough that counting `../` is where mistakes live. Within-directory
  `./x` is always fine.
  *(Amended 2026-09-02: as first written this bullet banned `../` in every
  import, which two landed modules and six in-flight ones already contradicted
  — see the Common violations ledger. A rule the code disproves gets a builder
  to refactor working code for nothing.)*
- The `contracts/` directory is **in this repo and tracked in git**, so it is
  present in every worktree: cite it as `contracts/<file>.md`.

## 2. What survives the rebuild, and what dies

The acceptance doc's ground rule is absolute: **"the build owns `src/`
wholesale. Every existing surface is deprecated reference — precedent for
nothing."**

**Survives, untouched in behavior** (spec §3 — changing any of these is a
design change, not a build choice):

- `src/middleware.ts`, `src/lib/auth.ts`, `src/lib/admin.ts`,
  `src/lib/supabase.ts`, `src/app/api/auth/[...nextauth]/route.ts`,
  `src/app/api/health/route.ts`, `src/app/login/page.tsx`,
  `railway.toml`, `supabase/migrations/*` (two files, frozen at two).

**Deleted outright** — page, route, and any module whose only consumer was one
of them (M1 EC2):

- `src/app/page.tsx` (Overview) — the path survives as the **Dashboard**, the
  file is rewritten.
- `src/app/analytics/`, `src/app/database/`, `src/app/data-management/**`
  (including `completeness/`), `src/app/api/admin/events/[id]/route.ts`,
  `src/app/api/admin/groups/[id]/route.ts`,
  `src/app/api/admin/idols/[id]/route.ts`,
  `src/app/api/admin/catalog-search/route.ts`,
  `src/app/components/AdminNav.tsx`.
- `src/app/layout.tsx` is rewritten: the global "Events: STALE/FRESH" strip and
  the `events` query inside the root layout **go away** (LOOK_AND_FEEL: "there
  is no global status strip — the Dashboard owns health"; and a data read in
  the root layout would take every page down when a table is absent —
  acceptance test 9).
- `src/app/components/EditableCell.tsx` **re-earns its place** and moves to
  `src/components/EditableCell.tsx` (LOOK_AND_FEEL: "the click-to-edit cell
  survives from the old app and re-earns its place"). It is the only old
  component that does.

**Nothing is kept "just in case."** A deprecated page left as dead code fails
M1 EC2.

## 3. Module map

```
next.config.ts                  the BUILD HOST (§4 rule 8): imports
                                EDITABLE_TABLES from lib/edit/config.ts and
                                rewrites an unmapped /records URL (BUG-0017)
src/
  middleware.ts                 UNCHANGED — the gate over every route
  lib/
    auth.ts  admin.ts  supabase.ts        UNCHANGED — sign-in, allowlist, service-role client
    db/
      client.ts        getDbClient(): the ONE seam that reads env and builds the client
      result.ts        DbResult<T> — the ok / not_provisioned / error union (§4)
      tables.ts        the table + view NAME constants; nothing else spells them
      dashboard.ts     the Dashboard's reads
      review-items.ts  queue lists, filters, counts
      review-item.ts   one item + its evidence, canonical value and provenance
      claims.ts        pending_claims buckets, filters, standing subset
      sources.ts       sources state rows (+ last run, by source NAME)
      cycles.ts        resolution_runs
      runs.ts          the adapter framework's runs
      browse.ts        the recent-events view's query + its provenance join
      records.ts       one canonical record for the edit surface, + the direct update
      gauges.ts        the six gauges' bounded windows (one file, one per read)
    review/            LEAF: shapes.ts (shape -> kind, ordering, predicates), queue-filters.ts
    browse/            LEAF: rows.ts (row shaping), views.ts (the column sets)
    claims/            LEAF: filters.ts (bucket + source narrowing)
    records/           LEAF: provenance.ts, routes.ts (`recordHref` — the ONE record URL)
    gauges/
      gauge.ts         the window/figure shapes every gauge returns
      cycle-health.ts  resolution-latency.ts  pending-claims.ts
      queue-health.ts  standing-disagreements.ts  settled-values.ts
    edit/
      config.ts        THE ONE hand-written {table -> editable columns} map (§9)
    format.ts          relative ages, absolute UTC timestamps, thousand separators, the null dash
    supabase.ts        the SIGN-IN path's service-role client (§2 carry-over):
                       `admin.ts` and `auth.ts` import it. The one ruled
                       exemption to §4 rule 3 — see that rule.
  components/
    ui/                Page, Section, DataTable, StatCard, Badge, Chip, Button,
                       Loading, Empty, NotProvisioned, ErrorLine
    EditableCell.tsx   the one old component that re-earned its place (§2), at
                       the components root and PascalCase for that reason (§11)
    gauges/            the gauge cards (figure, trend table, distribution, state)
    evidence/          EvidencePair — the app's signature block (LOOK_AND_FEEL)
    shell/             the frame: nav items + the sidebar/content shell
    browse/  claims/  queues/  records/  review/
                       one directory per page, holding that page's presentation
                       (§5: the page reads and shapes; components render).
                       `/cycles` and `/sources` have none yet — DEBT-0004.
  app/
    layout.tsx         shell: sidebar of six text labels, sign-out. NO data reads.
    globals.css        Tailwind 4 @theme — the design tokens (§7)
    page.tsx                              /                     Dashboard
    queues/page.tsx                       /queues               the two queues
    queues/[reviewItemId]/page.tsx        /queues/<id>          item detail
    claims/page.tsx                       /claims               buckets + standing tab
    sources/page.tsx                      /sources              source state + per-source trends
    cycles/page.tsx                       /cycles               cycles & runs
    browse/page.tsx                       /browse               recent events
    records/[table]/[id]/page.tsx         /records/groups/<id>  the edit surface
    api/admin/records/[table]/[id]/route.ts   PATCH — the one edit route
    login/  api/auth/  api/health/        UNCHANGED
tests/
  offline/**/*.test.ts        the default suite; no network, ever
  live/**/*.live.test.ts      staging; refuses when the STAGING names are unset
  http/**/*.http.test.ts      builds + starts the app; auth redirects, bundle scan
  fixtures/                   captured PostgREST response shapes (offline stubs)
```

## 4. Dependency direction — one way, no exceptions

```
next.config.ts  ->  lib/edit/config.ts                   (the BUILD HOST)

app/**          ->  components/**        ->  (nothing)
app/**          ->  lib/**
lib/gauges/**   ->  lib/db/**            ->  @supabase/supabase-js

                    everything above     ->  lib/<leaf>/**  ->  (nothing)

<leaf> = the PURE DOMAIN LEAVES, the bottom of the app:
         lib/review/**, lib/browse/**, lib/claims/**, lib/records/**,
         lib/format.ts, lib/edit/config.ts
```

1. **`components/**` never imports from `lib/db/**` and never fetches.** A
   component takes plain props and returns markup. This is what makes every
   surface testable without a database.
2. **Only `lib/db/**` imports `@supabase/supabase-js`.** A page that builds its
   own client is a defect.
3. **Only `lib/db/client.ts` reads `process.env`** for database credentials.
   One seam, one file — the env question (§12.1) changes this file and nothing
   else. **One exemption, by ruling and not by oversight** (recorded here at
   the M1 structure walk, 2026-09-03, because rule 3 as written read as
   absolute while the tree has always held a second reader): `src/lib/supabase.ts`
   is the pre-campaign service-role client that `lib/admin.ts` and `lib/auth.ts`
   — the UNCHANGED sign-in path §2 carries over — import. It reads
   `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` and builds its own client. The
   exemption is named, and only named, in `CARRIED_OVER` in
   `tests/offline/db/layering.test.ts`, which is a ratchet: every entry must
   still exist, and any NEW second reader reddens. Nothing the campaign writes
   may import it — the window's reads go through `lib/db/client.ts`.
4. **Only `lib/db/tables.ts` spells a table or view name.** A page containing
   the literal `"review_items"` is a defect; a typo'd name must be one grep
   away, and the not-provisioned message must name the same string the query
   used.
5. `lib/**` never imports from `app/**` or `components/**`.
6. **No `src/app/components/`.** Components live at `src/components/`.
7. **Pure domain leaves sit below `lib/db/**`, not above it.** A leaf holds
   the vocabulary, the row interfaces it reasons about, and pure functions
   over rows. It imports **nothing that can reach a database** — not
   `lib/db/**`, not `@supabase/supabase-js`, not `process.env`. `lib/db/**`
   imports the leaf; **the leaf never imports `lib/db/**` back, not a value
   and not a type.** A type-only import erases at runtime, but it still writes
   a directory-level cycle into this contract, and the day someone widens it
   to a value import the cycle is real with nothing to catch it. A row type
   both sides need is **declared in the leaf** — which is what
   `ReviewItemRow` in `lib/review/shapes.ts` already does.
   `lib/gauges/**` is not a leaf: a gauge fetches its own bounded window
   through `lib/db/**` (§8), which is the arrow as drawn.
8. **`next.config.ts` is a build host, and it may import the leaf — only the
   leaf.** It imports `EDITABLE_TABLES` from `lib/edit/config.ts` so the
   rewrite that backstops an unmapped `/records/<table>/<id>` URL is derived
   from the ONE map (BUG-0017; the config file carries the measurement).
   Next compiles this file *outside* the app's module graph and outside the
   `@/` alias, so the arrow only holds while the leaf stays a leaf: **no
   import at all** in `lib/edit/config.ts`, which
   `tests/offline/edit/config.test.ts` ("keeps config.ts a pure leaf that
   imports nothing") pins. Nothing else in the build host may reach `src/`:
   an import of `lib/db/**`, a component, or anything touching
   `process.env` from here runs at build time, in plain Node, with no alias
   and no React — and fails the build rather than a test.

### 4.1 The data-layer contract (every query returns this)

```ts
// src/lib/db/result.ts
export type DbResult<T> =
  | { kind: "ok"; data: T }
  | { kind: "not_provisioned"; missing: string }  // the table/view/column name
  | { kind: "error"; reading: string; message: string };
  //                 ^ the object read, as `tables.ts` spells it
  //                                    ^ the database's own words
```

- Every exported function in `lib/db/**` returns `Promise<DbResult<T>>`. It
  **never throws** and never returns a bare array. That is how acceptance
  test 9 is satisfied structurally rather than page by page.
- `not_provisioned` is decided by PostgREST/Postgres error code, in one helper:
  `PGRST205` (table/view not in schema cache), `PGRST204` (column not in
  schema cache), `42P01` (undefined_table), `42703` (undefined_column). Every
  other error is `kind: "error"` carrying the database's own message —
  LOOK_AND_FEEL: "the app shows what the database said."
- `missing` carries the name from `tables.ts`, so the rendered
  not-provisioned card can say which table is absent and what creates it
  (LOOK_AND_FEEL state 3, Voice bar 4).
- **A free, permanent probe:** `verdicts` does not exist until M2's handoff is
  installed, so a live test can assert the `not_provisioned` classification
  against a real absent table without inventing one.

### 4.2 Reads are explicit; joins happen in TypeScript

PostgREST embedding is available only where a foreign key exists
(`observations -> sources`, `field_provenance -> observations`,
`field_provenance -> sources`, `review_items -> sources`) — and **not** from
the `pending_claims` view, and **not** from `runs` to `sources` (`runs.source`
is text with no FK, deliberately; migration `20260829000001`).

**Rule: fetch by id sets and join in TypeScript.** Query A returns rows, take
its ids, query B with `.in("id", ids)`, join in code. It is predictable, it
unit-tests offline against captured fixtures, and it does not break when a
view's inferred relationships change. Do not build a query helper that
"figures out" embeds.

### 4.3 Two kinds of read, and neither may be silently partial

*(Added 2026-09-02, from QA's finding on TASK-0006. Fixed by TASK-0026; every
ticket owning a `lib/db/*.ts` module carries this in its brief.)*

PostgREST caps a response at its `db-max-rows` (Supabase's default is 1000)
and says nothing about it. A `select` with no `.range()`, no `.limit()` and no
`.order()` therefore returns **an arbitrary subset in unspecified order**, and
a count or an "exactly the matching items" claim built on it is *wrong* rather
than *refused* — the one failure mode this data layer exists to make
impossible. Pick a read kind deliberately.

**1. Complete read — `readComplete` in `lib/db/result.ts`.** Use it whenever
the surface presents the result as the whole set: a list rendered in full, a
count, an oldest age, a filter that claims exactness. The query passes
`{ count: "exact" }`, a **total** `.order()` ending in the primary key, and
`.range(0, cap - 1)` with `ROW_CAP` handed in (1000, matching PostgREST's own
default so the app never silently fights the platform cap). When the exact
count exceeds the rows returned — whatever truncated it, our cap or the
server's — the result is `kind: "error"` naming the object, the count and the
cap.

> **An `ok` array from a complete read is the whole matching set.** Every
> figure, count, oldest-age and exactness claim in this app rests on that one
> property, and it is why no caller carries a "was that all of it?" flag: a
> partial answer never becomes an `ok`.

**2. Window read — `readRows`, unchanged.** The caller's own `.order()` +
`.limit()` define a **named** window and the surface says which window it is
showing. This is §8's gauge contract and the landed gauges use it correctly.
A window read's rows must never become a figure presented as a total.

**And no read helper substitutes a number the database did not give.**
`readCount` returned `count ?? 0`, so a query written without
`{ head: true, count: "exact" }` — `error: null`, `count: null` — rendered a
confident `0` for a table holding 47 rows. That is BUG-0007's defect on the
user-visible path; a null count is a refusal, never a zero. The same rule is
why the complete read refuses a null count instead of returning the rows it
happens to hold.

> **A window line states a read that HAPPENED, and an empty window is still a
> window** (promoted 2026-09-04, third instance of the class: BUG-0063 on
> `/claims`, BUG-0067 on `/cycles`, BUG-0070 on `/claims` again). A surface
> publishes its `data-window` hook and the sentence around it when, and only
> when, the read it describes RETURNED — `ok` with rows, or `ok` with none. A
> refused, absent or unmade read publishes no line and no count. That is what
> makes the absence of the line mean one thing on every surface ("this read did
> not happen") and `data-window-held="0"` mean one thing ("it happened and found
> nothing") — and it is what lets a live oracle grade the empty case at all,
> instead of reading an honest empty page as a failure. An `Empty` card and a
> window line stand TOGETHER: the card says what would fill the surface, the
> line says where the app looked. The rule is graded once for every surface at
> once, in `tests/offline/absence/pages.test.ts`, never per page.

Paging is not the answer to a cap and none is built: nothing in the spec asks
for it, and complete-or-refuse means there is never a partial page to
continue. When a table genuinely outgrows `ROW_CAP` the app says so with the
real number, and raising the cap or narrowing the filter is then a deliberate
decision with evidence behind it.

## 5. Rendering: one async boundary per route

**The page function is the only `async` component on a route. Everything below
it is a pure synchronous component that takes plain props.**

- A page does: read (`lib/db/**`) → shape → hand plain props to components →
  return markup. No component below the page awaits anything.
- Why it is a contract and not a preference: it is what lets a test do
  `renderToStaticMarkup(await Page({ searchParams }))` with `react-dom/server`
  and assert on real markup — offline against a stub client for the
  not-provisioned and empty states, live against staging for parity. Next's own
  docs (`node_modules/next/dist/docs/01-app/02-guides/testing/vitest.md`) say
  Vitest cannot render async server components; nesting one under a page would
  cost this campaign a browser dependency it has no other need for.
- Client components (`"use client"`) exist only where interaction demands them:
  the nav's active state, filter chips that push URL state, the column
  selector, `EditableCell`. They receive data as props and never fetch.
- **State lives in the URL** (LOOK_AND_FEEL bar 11): every filter, sort, tab
  and page position is a `searchParams` value. No client-only filter state, no
  `useState` filter that a reload forgets.
- **A dynamic route that calls `notFound()` serves the error shell, not the
  app** (BUG-0017, measured on Next 16.2.2). On this version the 404 status
  and a server-rendered document are inseparable *in render*: `notFound()`'s
  status is set in the same `catch` that emits `<html id="__next_error__">`
  (`node_modules/next/dist/esm/server/app-render/app-render.js:1894-1918`), and
  a `not-found.tsx` beside the page changes nothing. A 404 the ROUTER decides
  renders normally through the root layout, which is why `/analytics` already
  serves the framed surface. So: **a new dynamic segment either resolves every
  URL it matches, or its miss is routed** — an unmatched URL, or its own
  `beforeFiles` rewrite to a path no route matches. The landed rewrite in
  `next.config.ts` is `/records`-specific and covers nothing else; inheriting
  it is not automatic, and a `notFound()` added to a new dynamic page without
  one is the same defect again.
- **The gate is `export { auth as middleware }` and never `auth(handler)`.**
  next-auth's `handleAuth` runs a supplied handler in the branch *before* the
  unauthenticated-redirect branch
  (`node_modules/next-auth/lib/index.js:148-156`: `else if
  (userMiddlewareOrRoute)` precedes `else if (!authorized)`), so wrapping the
  gate to add one line of logic silently removes the sign-in redirect from
  every route. That is a gate bypass, not a refactor.

## 6. The data model, by reference

The schema is the scraper repo's. Nothing here is authoritative; it is a map
of what to read and the traps in it. Columns verified against migrations
`20260818000000`, `20260825000002/4`, `20260829000001/3`,
`20260901000001/2/3/4` on 2026-09-01.

| surface reads | object | key columns |
| --- | --- | --- |
| Dashboard, Queues, item detail | `review_items` | `review_item_id, queue, source_id, domain, entity_id, field, severity(low\|high), status(open\|settled), summary, evidence uuid[], folded_count, opened_at, last_evidence_at` |
| item detail evidence | `observations` | `observation_id, entity_id, field, domain, value jsonb, schema_version, source_id, external_ref, payload_ref, observed_at, last_confirmed_at, status, rejected_at, rejected_by` — **no `entity_type`** (see trap 1) |
| item detail canonical side, Browse | `field_provenance` | `provenance_id, entity_type, entity_id, field, source_id, observation_id, tier_at_apply, applied_at, admin_locked` |
| Claims | **view** `pending_claims` | `observation_id, domain, entity_id, field, source_id, bucket, unmet_requirement` |
| Sources | `sources` | `source_id, source, kind, lifecycle, tier, checkpoint, note, created_at, updated_at` |
| Cycles | `resolution_runs` | `run_id, started_at, ended_at, outcome, facts_examined, applied, held, escalated, entities_created, claims_linked, claims_rerejected, errors, error_summary` |
| Runs | `runs` | `run_id, source(text), started_at, ended_at, outcome, failure_class, checkpoint_before/after, error_summary, + 12 counts` |
| Browse, edit surface | `events` / `event_listings` / `venues` / `groups` / `idols` | `events.event_id`; `groups.id`; `idols.id`; `venues.venue_id` |

**Traps, each of which will bite exactly one builder if it is not written
down:**

1. **`domain` vs `entity_type`.** **`field_provenance` alone** uses
   **`entity_type`** for the canonical table; `observations`, `review_items`
   and `pending_claims` use **`domain`**. They hold the same value
   (`pending_claims` joins provenance on `entity_type = claim.domain`). Read
   each table's own spelling; never assume one.

   Corrected 2026-09-02 (admin-window/BUG-0024). This trap previously said
   `observations` carries **both** — true of the migrations read on 2026-09-01,
   which stopped at `20260901000004` and missed
   `20260819000002_the_domain_is_the_entity_type.sql`: it **drops
   `observations.entity_type`** ("domain becomes the first part of both
   identities"; the three identity indexes are rebuilt on `domain`) and keeps
   `field_provenance`'s ("field_provenance IS NOT TOUCHED. Its entity_type
   column stays … apply_and_record now writes the domain into it"). Selecting
   the dropped column is not a missing field — PostgREST answers 42703 and the
   whole read fails, which is how the review-item detail rendered zero evidence
   rows for every item on staging. The offline suite cannot see this: the stub
   client scripts the answer, not the schema, so each `lib/db` read's column
   list is checked against the fixture that states the table's real columns
   (`tests/offline/review-item/read.test.ts`, "the columns the evidence reads
   name").
2. **There is no separate standing-disagreements view.** It is
   `pending_claims` filtered to `bucket = 'standing_disagreement'`
   (resolver §7: "the standing-disagreements view is this view filtered to
   contradictions"). Do not go looking for a missing object.
3. **`pending_claims` carries no age and no value.** Age comes from joining
   `observations.observed_at` by `observation_id` (§4.2's two-step).
4. **`in_window` is a real bucket string in the view and must never reach the
   UI** — not as a row, not as a filter option, not as a zero (spec §4, M1
   EC5). Filter it out at the data layer, in `lib/db/claims.ts`, once.
5. **A claim has no tier of its own.** The evidence row's tier is
   `sources.tier` (the source's *current* tier); the canonical card's tier is
   `field_provenance.tier_at_apply` (the tier at the moment of the apply).
   `sources.tier` drifts, `tier_at_apply` is frozen — that is deliberate
   (`data-model.md`, `sources.tier` comment). Label them as what they are.
6. **A source has no "last run" column.** It is the newest `runs` row whose
   `runs.source` text equals `sources.source`. There is no FK and no join key
   (migration `20260829000001`); match by name.
7. **The current canonical value of a fact** is the observation named by the
   **latest** `field_provenance` row for `(entity_type, entity_id, field)`
   ordered `applied_at desc, provenance_id desc` — and only if that
   observation is still live (`status in ('pending','applied')`). That is
   byte-for-byte what `pending_claims` does; do not invent a second rule.
8. **`observations.value` is jsonb** — the one json column in the system. A
   reference-class value is an object (or array of objects) carrying a `ref`
   key. Render values as their JSON text in mono; do not assume string.
9. **`groups.id` / `idols.id` but `events.event_id` / `venues.venue_id`.** The
   edit surface's config map carries each table's primary-key column
   explicitly for this reason.
10. **`review_items.evidence` is `uuid[]`** — order is the fold order; render
    it in that order.
11. **`shapeOf` defaults to `data_conflict_fact`, and the trigger to revisit
    it is a migration.** `lib/review/shapes.ts` branches on `queue ===
    "entity_link"` and falls through to `data_conflict_fact` for everything
    else — total by construction, so no caller has an exception path, which is
    right (§11: the kind is derived, never stored). Today it is also
    unreachable-by-anything-else: migration `20260901000002` constrains
    `review_items.queue` to exactly `data_conflict` and `entity_link`. But a
    third queue — a `freshness` queue, say — would arrive through that default
    and render as a **decision**, silently and plausibly. **The migration that
    widens that CHECK constraint is the trigger**: when it lands, `Shape`,
    `SHAPES`, `KIND_BY_SHAPE` and `shapeOf` are extended together (the
    compiler requires the first three; only `shapeOf` can go quietly wrong).
    Recorded, not ticketed — spec §6 calls the shape set "an open set that
    moves with the queues", and inventing a `queue` value the database cannot
    hold in order to test a branch it cannot reach is work with no user
    behind it.
12. **`pending_claims` was unreadable on staging, and no Admin-side read shape
    rescued it — the fix was the scraper repo's, and it landed.** Measured
    2026-09-02 (architect; evidence
    `agenticflow/tracker/evidence/architect/claims-probe*.tsv`): every shape
    timed out at the 8s statement timeout with `57014` — the page's own query,
    a narrowed `select`, `limit 2`, `limit 1` **with an order**, an
    `.in("observation_id", …)` over 10 known ids, a `head:true` exact count,
    and a per-bucket `eq("bucket", …)` count, one per bucket. Exactly one shape
    returned: an unordered, unfiltered `limit 1` (0.85–1.1s). Five candidate
    Admin-side mitigations were measured and all five timed out, so **no
    mitigation was written and none may be invented later** — there was no
    honest fast read to write. The artifact was a handoff
    (admin-window/TASK-0031) and the scraper repo applied it as migration
    `20260903000001_the_creation_bar_is_read_once_and_the_incumbent_is_one_seek.sql`:
    one index, `field_provenance_current_per_fact` on `field_provenance
    (entity_type, entity_id, field, applied_at desc, provenance_id desc)`, plus
    the word `materialized` on the view's `required_column` CTE so the creation
    bar is computed once per read instead of per uncreated record. Re-measured
    2026-09-03 through the same guard (`claims-probe3.tsv`): every one of the
    thirteen shapes returns, and the Claims page's own shape — six columns,
    `neq bucket in_window`, `order bucket, observation_id`, `range(0,999)`,
    `count: "exact"` — returns all 859 rows in **281–312 ms**, against 8.1 s
    and `57014` before. `src/lib/db/claims.ts` and `src/lib/db/gauges.ts` were
    not changed, which was the point. Two things follow and **both remain
    rules, cost or no cost**.
    **(a) No workaround code.** Not a narrower read, not a cache, not a
    swallowed timeout, not a "temporarily hidden" surface — spec §10, and the
    error state is the honest rendering of a database that will not answer.
    **(b) Admin never re-computes the classification.** Deriving buckets in
    TypeScript from `observations` + `field_provenance` + `review_items` would
    put a second copy of the resolver's precedence rules in this repo, which
    the view's own migration forbids in the other direction and §8's "this
    build adds queries and charts" forbids in ours. The bucket of a claim is
    the ledger's answer, or it is nothing.

## 7. Design tokens

LOOK_AND_FEEL's palette, five type steps and spacing scale land **once**, as
Tailwind 4 `@theme` tokens in `src/app/globals.css`, plus a small primitive set
in `src/components/ui/`. Tailwind 4 is CSS-first: there is no
`tailwind.config.js` in this repo and none is added.

- **Builders consume tokens and primitives, never raw values.** A hex code, an
  arbitrary `text-[13px]`, or a `rounded-lg` in a page file is a defect.
- The five type steps (`figure`, `title`, `body`, `data`, `micro`), the radius
  rule (0 for containers, 4px for controls), the 1px-hairline rule and the
  five palette jobs are LOOK_AND_FEEL's, not negotiable per page.
- **Mono carries every value the database produced; sans carries every word the
  app wrote.** That split is enforced by which primitive you use, not by
  remembering.
- The four data-surface states — Loading, Empty, NotProvisioned, Error — are
  four named primitives. Every surface that can render rows renders all four.
  A page that hand-rolls an empty state is a defect.
- **A state names the read it is about, and the type forces it** (BUG-0016,
  and the ruling of 2026-09-02). `ErrorLine`'s `reading` is **required**, as
  is `reading` on the `error` arm of `GaugeState`: a page makes several reads
  (Browse makes four) and a red line saying only "TypeError: fetch failed"
  names none of them. `DbResult`'s error arm already carries the string, so
  the required prop costs a caller nothing and catches the omission at
  compile time rather than at a walk.
- **A state card that REPLACES a labelled surface carries that surface's
  eyebrow.** `Empty` and `NotProvisioned` take an optional `micro` eyebrow;
  the three gauge components always pass their own label, because their state
  card stands in for a card the operator identified by its label — otherwise
  a screen of missing gauges says which tables are absent but not which knobs
  they tune. On a page's own `Empty`/`NotProvisioned` the eyebrow is optional:
  the `Section` heading above it already names the surface.
- **A rows surface never renders headers with no body.** `TrendTable` and
  `Distribution` take a **required** `empty: { holds, filledBy }`: the
  component decides *when* the empty state shows (no rows and no other state),
  the caller supplies *the words*, and a header-only table — the one rendering
  that says nothing at all — is unreachable by construction.

## 8. The gauges

Spec §5: **six gauges, each a server-side read-only query in this app** —
"this build adds queries and charts, never tables" and never a database view.

Where each one lives (spec §5 "the gauges live where their subject lives" +
spec §4 "per-source gauge trends" on Sources):

| gauge | page | reads |
| --- | --- | --- |
| cycle health | `/cycles` | `resolution_runs` |
| resolution latency | `/cycles` | `observations.observed_at` → `field_provenance.applied_at` |
| pending claims | `/claims` | `pending_claims` + `observations.observed_at` |
| queue health | `/queues` | `review_items` |
| standing disagreements | `/claims` (standing tab) | `pending_claims` filtered + `sources` |
| settled values | `/sources` | `observations.rejected_at/rejected_by` per source |
| pending claims, per-source `awaiting_row` trend | `/sources` | `pending_claims` grouped by source |

**Implementation rule.** PostgREST cannot aggregate beyond `count`, and this
campaign may not add an RPC or a view (acceptance doc: "no SQL-executing route
may be built"; spec §9: zero schema in the read slice). So a gauge **fetches a
bounded row set and aggregates in TypeScript** — one pure exported function per
gauge in `lib/gauges/`, taking rows and returning the shape the card renders,
unit-tested offline. Every gauge query carries an explicit `limit` and an
explicit time window; an unbounded fetch is a defect. At this catalog's
pre-launch scale that is the honest engineering, and it is why the gauge
functions are pure: when a row count outgrows it, the fix is one function.

## 9. The edit surface

Spec §8 and the acceptance doc's ground rule: **one hand-written config drives
it**, everything else derives.

```ts
// src/lib/edit/config.ts — the ONLY place a table becomes editable
export type Regime = "pre_cutover" | "resolver_owned";
export interface ReferenceColumn {
  readonly field: string;          // the `display` column holding the linked row's id
  readonly domain: string;         // the table it points at, as the map keys it: /records/<domain>/<id>
}
export interface TableEditConfig {
  readonly table: string;          // the canonical table
  readonly pk: string;             // its primary-key column (groups.id, events.event_id, ...)
  readonly regime: Regime;         // decides the WRITE PATH — never configured per column
  readonly editable: readonly string[]; // user-facing scalars only: never ids, keys, timestamps
  readonly display: readonly string[];  // shown READ-ONLY; never a write target (Ben, 2026-09-02)
  readonly reference: ReferenceColumn | null; // the ONE display column that links (BUG-0034)
}
export const EDIT_CONFIG: Readonly<Record<string, TableEditConfig>>;
```

- **M1 builds the `pre_cutover` write path only**: `groups` and `idols` edit
  **directly**, within their allowlist — legal and unprovenanced (spec §8,
  AGENTS.md data-ownership rule).
- **`display` is the read-only half of the same one map** (Ben's ruling,
  2026-09-02, admin-window/TASK-0029). A `resolver_owned` table has an empty
  `editable` and a non-empty `display`, so its record page shows the columns an
  operator came to see — with per-field provenance beside each — while every
  column of it still refuses through the one code path. `display` is never a
  second allowlist: it names columns to READ and to draw, `decideEdit` still
  answers the write question, and a column in `display` is not editable by
  being there. It is the same file, so adding a column to any surface remains
  one edit in one place.
- **`reference` is a third QUESTION about those columns, not a third list**
  (admin-window/BUG-0034, added to this block 2026-09-03 — it had been in
  `config.ts` and missing here since). It names the one `display` column that
  carries another record's id, and the domain that id belongs to, so the record
  page draws that line as a link to `/records/<domain>/<id>` (`recordHref`)
  with the linked row's name resolved by `readRecordReference` in
  `lib/db/records.ts` — an operator never lands on a bare uuid. The column must
  already stand in `display`; naming it here changes only how the line is
  DRAWN, never whether it may be written, and a table with no such column
  carries `null`. Where the linked table's NAME is read from is deliberately
  not in the map: that is a relation name, and §4 rule 4 leaves
  `lib/db/tables.ts` the only file in `src/` that spells one.
- `events` and `venues` appear with `regime: "resolver_owned"` and render
  **read-only**. **No write path to them exists in M1** — no PATCH branch, no
  helper, no scaffold. Their override path is M2's, through
  `settle_review_item`, and building toward it now is out of scope.
- **A column absent from `editable` is refused server-side**, by the route,
  with the row unchanged — hiding the widget is not the refusal (acceptance
  test 7). The route reads the same `EDIT_CONFIG`; there is no second
  allowlist anywhere.
- Never widen `editable` to a link or a non-scalar: performers and venues are
  `event_performers` / `venues` rows, not fields of `events` (AGENTS.md).
- No row is inserted or deleted from Admin. `scraped_events` and any
  `*_legacy` table are never written. No DDL, no migration, no SQL-executing
  route — those are physically impossible over PostgREST and must also never
  be built.

### 9.1 The walk sandbox — a staging-only table walkers may edit

Ben's exception, granted 2026-09-03 ("we should just create a table that always
exists which walkers can interact with. After a walk it should be reset for the
next walk"), and the mechanism ruled by the architect the same day
(admin-window/TASK-0034). VISION's non-goal — no schema change from Admin code,
no migration in this repo — stays literally true: nothing here enters `src/`,
nothing becomes a migration, nothing reaches production.

**1. Mechanism: the table is created BY HAND, once, on staging.** Ben pastes the
DDL below into the staging SQL editor (`agenticflow/tracker/for-human/TASK-0034.md`
carries it paste-ready). Kit-side tooling then only DELETEs and re-INSERTs rows,
which is pure DML and which `@supabase/supabase-js` does over PostgREST with the
service key. *Rejected*: tooling that creates the table itself over
`STAGING_SUPABASE_DB_URL` with a Postgres driver — it costs a supply-gated DEP,
a second credential SHAPE in this repo (a DSN with an embedded password), and
either a fourth home for walk tooling or an amendment to a standing pin, and it
buys only self-healing on a staging project that would be missing every other
table too (where the surface already says `not_provisioned`, honestly).
**TASK-0021's pin is untouched**: `STAGING_SUPABASE_DB_URL` stays a name nothing
under `src/` or `tests/` reads, and no `pg` / `postgres.js` dependency enters
this repo.

**2. The table.** `public.walk_sandbox`, on the staging project ONLY. One vetted
scalar per edit type the record surface can produce, because the widget is a
single text cell (`components/records/values.ts`) and every type question is
answered by PostgREST on the way in:

```sql
create table if not exists public.walk_sandbox (
  sandbox_id  uuid primary key,               -- uuid, like every mapped table (item 9)
  label       text not null,                  -- text
  note        text,                           -- nullable text: the em-dash absence, then fill it
  tally       integer not null default 0,     -- integer coercion
  is_flagged  boolean not null default false, -- boolean coercion (no catalog table covers one)
  observed_on date,                           -- date coercion, nullable
  created_at  timestamptz not null default now()  -- set at seed, never written, NOT in the map
);
```

Deterministic keys so a recipe deep-links without a lookup, and **uuids**
because the id gate is one grammar for the whole map (item 9):
`00000000-0000-4000-8000-000000000001`, `…0002`, `…0003`, seeded literally, so
the walk URL is `/records/walk_sandbox/00000000-0000-4000-8000-000000000001`.
Zeros to the last digit on purpose — a value nothing generates, so a row of it
in a residue sweep or a database console is unmistakably the fixture.
`created_at` is deliberately outside the map — the read selects `mappedColumns`
explicitly, so a column the map does not name is never read and never drawn, and
it is `created_at` rather than `updated_at` because nothing updates it and a
column that claims otherwise lies to whoever queries the table by hand.

**The three NOT NULL columns are deliberate.** Clearing a cell sends `null`
(`route.ts`: `""` and `null` both mean clear), so clearing `label`, `tally` or
`is_flagged` is refused by the database (23502) and the surface must show that
refusal without claiming the save landed. That is a walkable error path, not a
defect: a walker files a bug only if the cell claims success, blanks the value,
or reports nothing at all.

**3. Exposure and grants.** It lives in `public`, so PostgREST exposes it — it
has to, since Admin's only client speaks PostgREST. **RLS is enabled with no
policy**, `anon` and `authenticated` are revoked, `service_role` granted: the
service role bypasses RLS, so Admin reads and writes it exactly like any other
table, and no browser-side key could ever reach it.

**4. The reset tool, and when it runs.** `tests/walk/reset-sandbox.mts`, run by
`node` exactly as `tests/walk/session-cookie.mts` is (admin-window/TASK-0036).
It DELETEs every row and re-INSERTs a checked-in fixture — PostgREST cannot
`TRUNCATE`, and it does not need to.

- **It reads no `STAGING_` name and loads no `.env`.** It takes `SUPABASE_URL`
  and `SUPABASE_SERVICE_ROLE_KEY` from its own process environment, mapped from
  the staging names on the command line, which is already how a walk instance is
  launched (STACK §5). So `tests/live/setup.ts` remains the ONE place the
  `STAGING_` names are read, and a stale `.env` can never silently supply a
  target.
- **It refuses through the one guard.** `resolveStagingTarget`
  (`tests/live/staging-target.ts`) against `SERVICES.md`'s declared staging
  target: an unset name, an unparseable URL, no declaration, or a host that is
  not the declared one all exit non-zero having written nothing. No second host
  check exists anywhere.
- **Cadence: immediately BEFORE every walk, mandatory**; again after a walk that
  wrote, when convenient. Ben asked for "reset for the next walk", and a
  before-reset is the only one a crashed, abandoned or forgetful walk cannot
  skip — the guarantee a walk starts from the fixture must not depend on the
  previous walk's manners.
- `tsconfig.json` gains **`allowImportingTsExtensions: true`** so the node-run
  `.mts` tool may import `../live/staging-target.ts` by its real extension (Node
  resolves no extensionless TS specifier, and the alternative was a second copy
  of the guard). Measured on this tree 2026-09-03: `tsc --noEmit` 0,
  `npm run lint` 0, `npm run build` green, and Next does not rewrite the flag.

**5. Its `Regime` is `pre_cutover`, reused on purpose.** `Regime` answers one
question — which WRITE PATH — and the sandbox's answer is identical to
`groups`/`idols`': a direct PATCH within the map's `editable` allowlist,
unprovenanced. A third member would be a second answer to a question the type
does not ask, and it would cost a change to `decideEdit` plus `regimeNote`'s
two-way ternary in `src/app/records/[table]/[id]/page.tsx` — which, left
unchanged, would render "resolver-owned and read-only" beside an editable cell
until someone noticed. The inaccuracy accepted instead: `pre_cutover` reads as a
historical claim ("not yet cut over to the resolver") that the sandbox cannot
make, and the regime note on its record page says a value written here goes "to
the catalog", which for a staging fixture it does not. Both are carried in a
docstring rather than paid for in a third code path, and neither is a bug to
file. **The door left open**: if a second non-catalog table ever enters the map,
or if any code starts reading `pre_cutover` to mean "a catalog table", the third
regime is earned then and this paragraph is the one to revisit.

**6. The fixture carries no `admin-window` marker.** The moment the entry lands,
`tests/live/residue.live.test.ts` derives the sandbox into its search space and
fails on any value containing that string, which is coverage worth having — and
which makes a fixture containing it read as campaign residue on every single
run. The fixture is checked in at `tests/walk/sandbox-fixture.ts` (the tool
imports it; an offline test asserts the marker's absence and that every
fixture key is a mapped column), and its rows say "sandbox", never the
campaign name.

**7. Production renders the honest absence, permanently.** The table exists on
staging only, so in production the record read gets `PGRST205` and the page
draws the `not_provisioned` card naming `walk_sandbox` — acceptance test 9's
existing code path, no new branch. The card's generic line ("arrives with the
scraper repo's migrations") is wrong for this one table and is **accepted as
is**: the surface has no nav entry, no Browse row and no link anywhere, so it is
reachable only by an agent typing a URL it already knows, and the load-bearing
half — this table is not here, and here is its name — is true. Do not add a
per-table branch for it. If the sandbox ever becomes reachable from a link, that
line becomes a per-entry field and this is the sentence to revisit.

**9. Its primary key is a `uuid`, because the id gate is ONE grammar for the
whole map** (ruled 2026-09-04, from builder-93's measurement on TASK-0035; this
paragraph replaced the `text` key the first draft of this section carried).
`isRecordId` (`src/lib/db/records.ts`, admin-window/BUG-0065) refuses a segment
that is not a uuid BEFORE any read, on the premise its docstring states —
"every table in the map is keyed by a uuid". Text keys made that premise false
the moment the sandbox entered the map: at `/records/walk_sandbox/walk-1` the
page issued no query at all and rendered the not-an-id empty state, so **neither
state this section requires was reachable at the sandbox's own keys** — the
absent table drew the wrong card, and a seeded table would never have been read.

The invariant that decides it: **the gate never refuses an id the table could
hold.** Two ways to keep it, and the cheap one wins. *Rejected*: a per-table key
shape in the edit config (`idShape: "uuid" | "text"`, consumed by the gate). It
is a second allowlist about the same columns (§9's own rule), it widens
`TableEditConfig` and changes `isRecordId`'s signature at every call site for
one staging fixture, and it degenerates for a text table to "accept anything" —
paying a config field to buy back exactly nothing. *Chosen*: the sandbox is
uuid-keyed, which costs one word in a DDL Ben has not pasted yet and leaves
`src/` untouched by the entire sandbox chain, entry aside. The legibility of
`walk-1` was the only thing given up, and a constant uuid in the recipe is
copied, not remembered.

**The door left open, and it is `isRecordId`'s own**: if a catalog table keyed
by something other than a uuid ever enters the map, that one function learns it
— by grammar if the shapes are distinguishable, by config if they are not. What
must not happen is a table entering the map whose real ids the gate refuses; the
map's entry and the gate's grammar are two halves of one claim, and this is the
sentence to revisit when they stop agreeing.

**8. One consequence for the live suite.** `residue.live.test.ts` reads every
mapped table with `select("*")`; against a staging project where Ben has not yet
pasted the DDL, that read errors and the sweep fails on a table nobody wrote to.
The sweep therefore treats the sandbox's ABSENCE as "nothing to sweep" — the
absence code, read with the existing `codeOf` / `objectIsAbsent` idiom
(`tests/live/parity.ts`), skipped with a stated note — and never as an error.
An absent table is not a residue finding, and it is not a pass it can hide in
either: the scanned-column floor still has to be met by the tables that ARE
there.

## 10. Tests

- `tests/offline/**` — the default suite (`npm test`). Pure functions, page
  functions rendered against **stub clients** built from captured PostgREST
  response shapes in `tests/fixtures/`. **No network.**
- `tests/live/**` (`*.live.test.ts`, `npm run test:live`) — staging only. The
  live setup file is the **one** place `STAGING_SUPABASE_URL` /
  `STAGING_SUPABASE_SERVICE_ROLE_KEY` are read; it **refuses** (non-zero, no
  fallback) when either is unset, and it refuses when the staging host does not
  match the staging target declared in `agenticflow/docs/SERVICES.md`. Product
  code never mentions a `STAGING_` name.
- `tests/walk/**` — **not a test project**: the walk agents' two tools, run by
  `node` and matched by no vitest glob. `session-cookie.mts` mints the session
  cookie (admin-window/TASK-0033); `reset-sandbox.mts` resets the walk sandbox
  (§9.1). Both live outside `src/` because that is where a credential name may
  be read, and neither is importable from the app.
- `tests/http/**` (`npm run test:http`) — builds and starts the app on port
  8772 for the things only a real server proves: unauthenticated redirects to
  `/login` for every route, and the client-bundle scan for service-role
  material. Needs no database.
- **Shared fixture builders live in `tests/fixtures/`** — one place that builds
  a review item in each of its three shapes, a pending claim in each bucket, a
  cycle row, a run row, a source row, an event with provenance. A test that
  hand-rolls its own row shape is scope sprawl; import the builder.
- **Parity (acceptance test 2) is per page**: the page's own live test renders
  the page and asserts its numbers against an **independently written** query
  the test issues itself — not by calling the same `lib/db` function the page
  called. Two paths to one number, or it proves nothing.
- **A live test names the STATE KIND before it compares a number** (added
  2026-09-02 from the first staging parity pass; common violation 6). A page
  renders one of four kinds — `ok`, `empty`, `not_provisioned`, `error` — and
  an oracle written as a two-way branch (`did rows render? …else assume the
  table is absent`) grades the other two wrong: `/queues` and `/sources` failed
  on an honest EMPTY page, and `/claims` PASSED four assertions on an ERROR
  page, because "the markup contains `pending_claims`" is satisfied by the
  error line as well as by the not-provisioned card. The rule, for every live
  test in this suite:
  1. The test decides the kind it EXPECTS from its own independent count, then
     asserts the rendered kind equals it. The kind is read from the markup
     structurally — `data-state` on the four `ui` state primitives — never from
     the prose inside a card.
  2. `ok` compares numbers. `empty` is a **pass with a number**: the
     independent count is exactly 0 and the page's labelled figure reads 0
     (LOOK_AND_FEEL bar 1 — a queue's open count is on screen whether or not
     the queue has rows). Neither is an absence.
  3. `not_provisioned` is a pass only when the test's own read of that same
     object gets the absence code (`PGRST205`/`42P01`). It is never inferred
     from "no rows rendered".
  4. `error` is a **FAIL**, and the failure message names the read and the
     database's code. A live suite that can go green while a page is broken is
     the one thing this suite exists not to be.
  A `head: true` count carries no body, so supabase-js parses no error out of
  it (measured: `code=undefined, msg=""` on a 57014) — the helper that reports
  a failed parity count issues a GET-shaped count, or says it could not tell.
- **An oracle counts the SAME narrowing the surface renders, and names its
  surface by `data-surface`, never by position** (added 2026-09-03 at the M1
  structure walk; common violations 7 and 8). Two failures of one idea — an
  oracle that is not addressed to the thing on screen:
  1. *The count.* A per-tab surface takes a per-tab count; a WINDOWED table
     takes the window's count, not the view's. `claims.live.test.ts` graded the
     standing tab against the whole view's 859 (BUG-0037), and went on
     asserting "every claim of the view is rendered" after BUG-0041 windowed
     the table to 50 (BUG-0057). Write the independent query with the page's
     own filter and limit beside it, and say in the assertion message which
     window is being compared.
  2. *The address.* `section:nth-of-type(1)` names whatever is first today.
     BUG-0040 added a lead section to `/cycles` and four live tests died with
     `matches 2 surfaces` — a red the ticket's own checks could not see,
     because `npm test` does not run this tier. Every surface a live test
     grades carries `data-surface="<name>"`, unique on the page, and the
     oracle selects on that. Five files still address by position: DEBT-0002.

- **Every live test sweeps what it wrote** (acceptance test 13), in a `finally`,
  restoring the prior value. M1's only writer is the edit-surface test, and it
  writes **only `groups` / `idols`** — one field of an existing row, prior value
  restored, residue scanned after (Ben's ruling, 2026-09-02). A live test never
  writes a resolver-owned table (`events`, `venues`, `review_items`,
  `observations`, `field_provenance`); a fixture population that would need one
  is a gap to report, never a row to insert.
- **What staging holds is a fact of the run, not of the code** (census
  2026-09-02): `review_items` = 1 row (an `entity_link` signal), so
  `data_conflict` is 0 and every DECISION-side live assertion compares 0 to 0
  until the resolver escalates a real conflict. That is vacuous coverage, not a
  passing bar: a decision-queue behavior proven only offline says so in its
  ticket rather than claiming live parity.
- **An absence assertion reads CODE LINES and pins a CALL, never a word.**
  Two rules, one reason (common violation 4). (1) Comments are documentation:
  a guard that greps the whole file reddens on a builder explaining why the
  thing is absent — use the `codeLines` scanner in
  `tests/offline/edit/config.test.ts` / `tests/offline/review/one-place.test.ts`,
  or, in a ticket check, the pipeline form
  `! grep -rn <word> <paths> | grep -qvE '^[^:]*:[0-9]+:[[:space:]]*(\*|//|/\*)'`.
  (2) The app's vocabulary is the contract's vocabulary: `settled` is a
  `review_items.status` value, "settled values" is a spec §5 gauge, `verdict`
  is an `observations.rejected_by` reason, `in_window` is a real bucket. A ban
  keyed on such a word forces correct code to be renamed; ban the **write** —
  the RPC name, `.insert(`/`.upsert(`/`.rpc(`, `.update(` outside
  `lib/db/records.ts`, a `"use server"` module, a route path — which is what
  "nothing settles anything in M1" actually means.
- **One owner per structural guard.** The write surface of the whole repo is
  asserted in `tests/offline/edit/config.test.ts`; the M2-close pin is
  `tests/offline/review/one-place.test.ts`; layering is
  `tests/offline/db/layering.test.ts`. A ticket that needs one of those
  guarantees **runs that file** as a check instead of hand-rolling a second
  predicate that will drift from it.

## 11. Naming and conventions

- Files: kebab-case (`review-items.ts`, `not-provisioned.tsx`). React
  components: PascalCase exports. Route folders: lower-case, plural
  (`/queues`, `/claims`, `/sources`, `/cycles`, `/browse`, `/records`).
  **One file is PascalCase and stays that way**: `src/components/EditableCell.tsx`,
  the single old component §2 carries over by name ("re-earns its place"). §3's
  map used to draw it inside `ui/`; the tree has it at the components root,
  which is where §2 put it (structure walk, 2026-09-03 — the map was corrected,
  not the file: a rename costs four test files and buys a letter).
- **Contract vocabulary is the app's vocabulary**, in code as in copy:
  `claim`, `review item`, `decision` / `signal`, `verdict`, `override`,
  `cycle` (resolver) / `run` (adapter), `bucket`, `tier`, `canonical`
  (LOOK_AND_FEEL glossary). A variable named `task`, `alert`, or `job` is a
  defect in a review-item module.
- Machine identifiers (`data_conflict`, `admin_locked`, `wont_fix`,
  `awaiting_row`) render **verbatim in mono**, never prettified.
- **The kind is derived, never stored** (spec §6): `lib/review/shapes.ts` is
  the one place that maps a shape to `decision` or `signal`. The three shapes
  today: `data_conflict` fact item → decision; `entity_link` fact item
  (`source_id` null) → decision; `entity_link` source-pattern item
  (`source_id` set) → signal.
- **Browse's "newest first"** is `events.created_at desc` — arrival order,
  because the view is "everything that came through the pipeline, newest
  first" (spec §4), not the calendar. `starts_at` is a column the view shows,
  never its sort.

## 12. Open questions (blocked ASK tickets — never decided in code)

These are contract silences. Each is a blocked ticket for Ben; **no builder
may resolve one by choosing.** Tickets are scoped so the settled work proceeds
without them.

Each carries a marker. **A question is closed only when its marker leaves this
list** — that is the structural bar its ASK ticket checks, and the architect is
the only one who removes a marker.

**No question is open.** The list is empty as of 2026-09-03, and an empty list
is a state this section is allowed to be in — it is not an invitation to
invent one, and a new silence is a new blocked ASK ticket with its own marker.

**The sixth question — the claims-cost one — was settled 2026-09-03**, and its
marker left this list for that reason (it is not spelled here: the ticket's
structural check is the marker's ABSENCE from this file, so quoting it would
re-open the question on a grep). `pending_claims` could not be read on staging
in any shape but an unordered `limit 1`, the fix was a
scraper-repo artifact and therefore a handoff, and Ben licensed the migration
that carries it — an index on `field_provenance` and one `materialized` hint on
the view's creation-bar CTE. Re-measured through the same live guard, the
Claims page's own shape returns all 859 rows in 281–312 ms with **no change to
Admin**, which is what the handoff was for. See §6 trap 12, whose two standing
rules (no workaround code; Admin never re-computes the classification) survive
the fix untouched, and admin-window/TASK-0031.

**Five questions were settled 2026-09-02** by Ben, and their markers are gone
from this list for that reason — each ruling is a dated paragraph in
`DECISIONS.md` with the door it closes. In one line each: the app keeps reading
`SUPABASE_*` while the live suite reads the staging names in
`tests/live/setup.ts` alone, and parity stays two PostgREST paths with no pg
driver; the resolver tables are applied to staging and populated, and a live
test may write and sweep `groups`/`idols` and nothing else; the stuck-pattern
threshold line stays absent for M1, with dials-as-rows an ecosystem
design-queue item; the provenance slot on a pre-cutover table reads "no
provenance recorded (pre-cutover table)"; and **the adapter-runs half of Cycles
& runs shows nine of the `runs` table's 22 columns** — `source`, `started_at`,
`ended_at` (a null one renders as still running), `outcome`, `error_summary`,
`records_parsed`, `claims_emitted`, `records_unlinked`, `failure_class` — and
that half honours `?source=<name>`, matched by name because `runs.source` is
text with no foreign key (§6 trap 6). Built by admin-window/TASK-0016; the
other thirteen columns are out of scope for M1.

## 13. Decomposition guidance — what a ticket on this tree must carry

*(Written at the M1 root-cause pass, 2026-09-03, from the milestone's 60 bugs.
`agenticflow/docs/LESSONS.md` is the builder-facing half of the same pass — the
six classes; this is the authoring half. Each rule below exists because a class
of bugs would not have survived it.)*

1. **A ticket whose `touch_scope` includes a page under `src/app/**` — or a
   shared render primitive under `src/components/ui/**` — carries that page's
   live suite in its `## Checks`.** `ci_command` is
   `npm run lint && tsc --noEmit && npm test`, and `npm test` is the **offline
   and isolated projects only**: `tests/live/**` and `tests/http/**` run in no
   gate at all. That is the whole mechanism behind BUG-0024 (the app selected a
   column the schema owner had dropped; the offline stub still had it),
   BUG-0056 and BUG-0057 (a page change left its live parity oracle red, both
   caught by a walker rather than by the ticket), and BUG-0058 (a live sweep
   nobody had ever executed). The form is
   `npm run test:live -- tests/live/<page>.live.test.ts`, and it is
   **measured runnable inside `receipt.py`'s private worktree** — BUG-0037's
   receipt (2026-09-03) records that exact command at exit 0 with six live
   tests green in `agenticflow/.worktrees/_receipt-32069`. It costs ~30 s per
   file. When the staging names are absent from the environment the live guard
   refuses non-zero, so the failure mode is a false RED that names the missing
   name — never a silent green.
2. **Offline checks are TARGETED** — the page's own test files, not `npm test`.
   The full suite belongs to `ci_check` and the run-end gate. The exception is
   a ticket whose scope touches a shared surface (`components/ui/**`,
   `lib/db/result.ts`, `lib/format.ts`, the edit config): say so in the ticket.
3. **A user-facing ticket's criteria name the ABSENT case explicitly** — the
   null field, the empty set, the missing table — because eight M1 bugs were a
   value that renders as nothing (LESSONS 1). "Renders X" is half a criterion;
   "renders X, and renders the dash with no qualifier when X is null, and
   renders a labelled 0 when the set is empty" is the whole one.
4. **A ticket that adds or changes a structural guard states BOTH fixtures** in
   its criteria: the input the guard must flag, and the input it must NOT flag.
   Ten M1 bugs were guards that passed vacuously or reddened correct work
   (LESSONS 3, common violations 4 and 5).
5. **A ticket that writes a command into a doc carries that command as a
   check.** Three M1 bugs were recipes in STACK.md that had never been run
   (BUG-0038/0039/0051). A `grep -q` for the doc's own words proves the
   sentence exists, not that it works.
6. **A new page ships with its own `src/components/<page>/` module.** The page
   function reads, shapes and hands plain props down (§5); its presentation
   lives beside every other page's. Promoted from common violation 8.
7. **A helper two pages will need is seeded as its own ticket, first.**
   Builders work in isolated worktrees and cannot see each other's code, so a
   helper nobody seeded becomes N hand-copies that drift (common violation 9:
   `StateOf` stands in four pages byte-for-byte, including its comment).

## Common violations

The milestone structure walk maintains this ledger: violation class, count, one
example. A class that reaches 2 becomes a rule above and is cited in the
decomposition brief of every ticket touching that surface.

| # | class | count | one example | status |
| --- | --- | --- | --- | --- |
| 1 | **A `../` import inside `src/`, which §1.2 as written banned outright** | 8 | `src/lib/db/review-items.ts` imports `../review/shapes` (landed, TASK-0006); the six `src/lib/gauges/*.ts` import `../db/result` (in flight, TASK-0007) | **Rule narrowed 2026-09-02, no code churn.** The contract was over-broad, not the code: §1.2 exists to stop a path *leaving the product tree* (worktrees make `../` resolve inside this repo), and an import that stays inside `src/` cannot do that. §1.2 now says so. Logged here because a class that hits 8 in one milestone is a rule that needed rewriting, and because the next reader must not "fix" the code to match the old wording. |
| 2 | **A read helper substituting a number the database did not give (`count ?? 0`)** | 2 | `countRows` in `tests/live/parity.ts` (BUG-0007, fixed under TASK-0003); `readCount` in `src/lib/db/result.ts` (the user-visible twin, TASK-0026) | **Promoted to a rule 2026-09-02** — §4.3, last paragraph: a null count is a refusal, never a zero. Cited in the brief of every ticket owning a `lib/db/*.ts` module. |
| 3 | **A list read with no `.range()`, no `.limit()` and no `.order()`** | 1 | `src/lib/db/review-items.ts` (TASK-0006), whose `readReviewAttention` count and oldest age would have been wrong rather than refused | **Design-shaped, so fixed as design rather than left to accumulate**: §4.3 (new) plus TASK-0026, seeded before the eight remaining `lib/db` modules are written. Count is 1 and stays there only if the rule holds; the structure walk should re-count at M1 close. |

| 4 | **An absence pin keyed on a WORD rather than on the write it forbids — false RED on correct work** | 4 | `! grep -rq settle_review_item src` (TASK-0010) reddens on the *comment* in `src/lib/edit/config.ts:43`; `! grep -rl verdicts src \| grep -qv tables.ts` (TASK-0010) reddens on the doc comments in `queue-health.ts` and `trend-table.tsx`; `one-place.test.ts`'s declaration-name predicate forced TASK-0007 to rename `…SettledValues` exports and hit BUG-0012's `isVerdictUnset` | **Promoted to a rule 2026-09-02** — §10: an absence assertion reads code lines and pins a call, never a word; and one owner per structural guard. Both TASK-0010 checks amended (measured failing on today's tree), the test predicate narrowed by BUG-0020. |
| 5 | **A ticket check pinning an incidental spelling instead of the landed API** | 2 | `grep -q settled-values src/app/sources/page.tsx` (TASK-0013) — the landed page-facing export is `readRejectionStampGauge`; `grep -q cycle-health …` (TASK-0014) — it is `readCycleHealth` | **Amended 2026-09-02.** Both checks now name the exported function the gauge's own docstring calls "what `/sources` calls". A check that pins a module-path spelling forbids the barrel import the app uses everywhere. |

| 6 | **A live oracle whose fallback branch accepts the ERROR state, so a broken page grades as a pass (or an honest EMPTY page grades as a failure)** | 3 | `tests/live/claims.live.test.ts` — 4 of its 6 assertions passed on a page in its error state, because the not-provisioned branch only asks that the markup contain `pending_claims`; `queues.live.test.ts` and `sources.live.test.ts` — an empty queue takes the same branch and is graded not-provisioned | **Promoted to a rule 2026-09-02** — §10: a live test names the state kind (read structurally from `data-state`) before it compares a number; `empty` is a pass with a 0; `error` is always a FAIL. Filed as the test-hardening TASK of the same date; cited in the brief of every ticket owning a `tests/live/*.live.test.ts`. |

| 7 | **A live oracle counting a DIFFERENT set than the surface it grades** | 2 | `tests/live/claims.live.test.ts`, the parked-bucket test: it grades the STANDING tab's list (`section:nth-of-type(1)`) against `claimCount()` — the whole view, 859 — so the page's honest EMPTY (staging holds 0 standing disagreements) reads as a failure, and three of the four param sets never reach the assertion the test exists for. Its own sibling test four lines above gets this right, counting `eq("bucket","standing_disagreement")`. | **Count 2 at the M1 structure walk — PROMOTED to a rule 2026-09-03** (§10, and cited in the brief of every ticket owning a `tests/live/*.live.test.ts`): an oracle's independent count reads the SAME narrowing the surface renders, and a per-tab or windowed surface takes a per-tab or windowed count. Second instance: BUG-0057 — BUG-0041 windowed the Claims table to 50 rows and `claims.live.test.ts` went on asserting that every claim of the view is rendered, so the oracle now grades a set the page never claimed to show. Original count-1 note follows. Filed as admin-window/BUG-0037 against the test alone — no product code is implicated, and the fix is the count, not the page. If a second instance appears, the rule is: an oracle's `counted` reads the same narrowing the surface renders, and a per-tab surface takes a per-tab count. Recorded 2026-09-03 by the architect, from the TASK-0031 confirmation run. |
| 8 | **A live oracle addressing a surface by POSITION (`section:nth-of-type(n)`)** | 6 | `tests/live/cycles.live.test.ts:61` died the moment BUG-0040 added a section above it (`section:nth-of-type(1) matches 2 surfaces`); the same spelling stands in five more live files, filed as DEBT-0002 | **Promoted to a rule 2026-09-03** — §10: a live oracle names its surface with the `data-surface` attribute the page carries, never with a position. Position makes an oracle a hostage of layout: every page ticket becomes a live-test ticket, and the failure arrives as a walker's bug rather than as the builder's own check. BUG-0056 fixed `/cycles` only; DEBT-0002 owns the other five. |
| 9 | **A page helper hand-copied into every page that needs it** | 4 | `StateOf` stands byte-for-byte, comment included, in `cycles`, `sources`, `claims` and `queues/[reviewItemId]` — and it is what renders the `data-not-provisioned` / `data-read-failed` hooks the live oracles read, so four copies is four chances for the oracle contract to drift. Also `WindowLine` ×3, `RETRY` ×4, `ARRIVES_WITH` ×8 | **Promoted to a rule 2026-09-03** — §13.7 (decomposition): a helper two pages will need is seeded as its own ticket BEFORE them, because builders in isolated worktrees cannot see each other's code. Existing copies: DEBT-0003. |
| 10 | **A page's presentation living in `app/` because it has no component module** | 2 | `src/app/cycles/page.tsx` is 1,291 lines with 8 local components; `src/app/sources/page.tsx` is 793 with 6. Every other page has a `src/components/<page>/` directory and its page is 85–300 code lines | **Promoted to a rule 2026-09-03** — §13.6: a new page ships with its own `src/components/<page>/` module. §5's division (page reads and shapes, components render) was never wrong; nothing said where the components go, so two pages grew them inline. DEBT-0004 extracts the existing two. |
| 11 | **A window line that disagrees with its own read — stated over a read that never happened, or dropped on a read that happened and found nothing** | 3 | BUG-0063 (`/claims` published `data-window-held="0"` over a refused read); BUG-0067 (`/cycles`, the same shape on two hooks); BUG-0070 (`/claims` drops the whole line on an ok-but-empty read, where six other hooks on two routes keep theirs — measured 2026-09-04) | **Promoted to a rule 2026-09-04** — §4.3: a window line states a read that happened, and an empty window is still a window. The first two were fixed one surface at a time and pinned only in their own page suites, which is how the third arrived under a test whose docstring claims to grade the rule; BUG-0070 generalises `tests/offline/absence/pages.test.ts` so the next surface inherits the rule rather than a comment about it. Cited in the brief of every ticket that renders a windowed surface. |

| 3 (re-count) | A list read with no `.range()`, no `.limit()` and no `.order()` | **0 new** | — | **The rule held.** M1 structure walk, 2026-09-03: every `.select(` in `src/lib/db/**` was traced. Fourteen chains a crude scan flagged are all either `.maybeSingle()` by primary key or by-id chunks bounded with `.limit(ids.length)`; every list read goes through `readComplete` / `readRows` with a total order and a bound. Count stays 1 (the original, fixed under TASK-0026). |

*(Rows 1–3 recorded by the architect at the 2026-09-02 ruling pass, from QA
findings on TASK-0001/0003/0006; rows 4–5 at the second pass the same day,
from measurement of the open tickets' own checks; row 6 at the third pass, from
the first live parity run against staging. The milestone structure walk owns
this table from here.)*

## History

- **2026-09-04, key-shape ruling + residual pass (architect).**
  **§9.1 item 9 (new)** — the walk sandbox is uuid-keyed. Text keys made
  `isRecordId`'s stated premise false and left both of the sandbox's required
  states unreachable at its own keys; the invariant kept is that the gate never
  refuses an id the table could hold, and the rejected alternative (a per-table
  `idShape` in the edit config) is written down with its cost. The DDL in
  `agenticflow/tracker/for-human/TASK-0034.md` changed with it, before Ben
  pasted anything.
  **§4.3** — the window-line rule promoted: a window line states a read that
  happened, and an empty window is still a window (violation class 11, third
  instance; BUG-0070 filed to fix `/claims` and to generalise the one test that
  grades the rule).
  Filed the same pass: BUG-0068 (the PATCH route makes the page's own id
  decision), BUG-0069 (focus is never returned when an edit ends), both from QA
  residuals that had no ticket. Doors closed are in
  `agenticflow/docs/DECISIONS.md`, same date.

- **2026-09-03, M1 endgame: root-cause pass + structure walk (architect).**
  Six recurring bug classes written whole into `agenticflow/docs/LESSONS.md`
  (the builder-facing half) and seven authoring rules into the new **§13**
  (the ticket-facing half) — the load-bearing one being §13.1: a ticket
  touching a page under `src/app/**` carries that page's live suite in its
  checks, because `npm test` is the offline and isolated projects only and the
  live and http tiers therefore run in no gate. Amendments from walking the
  tree against the contract: **§3's module map** was stale in five places and
  now documents what is (the six per-page component directories, the four pure
  leaves, `lib/db/gauges.ts`, `lib/gauges/gauge.ts`, and `EditableCell.tsx`
  where §2 actually put it); **§4 rule 3** now records its one ruled exemption
  (`src/lib/supabase.ts`, the sign-in path's carried-over service-role client
  that `admin.ts`/`auth.ts` import — the rule read as absolute while the tree
  never was, and the exemption is a ratchet in `layering.test.ts`); **§9's
  `TableEditConfig` block** gained the `reference` member `config.ts` has
  declared since BUG-0034; **§10** gained the oracle rule promoted from common
  violations 7 and 8; **§11** records that `EditableCell.tsx` is PascalCase by
  §2's carry-over and stays so. Verified clean and recorded as such in
  `tracker/milestones/M1.md`: dependency rules 1, 2, 5, 6, 7 and 8 (zero
  violations), the DbResult contract (no `throw` anywhere in `src/lib/`), the
  one-async-boundary rule, and common violation 3 re-counted at **0 new**.
  Filed: DEBT-0003 (four byte-identical `StateOf` copies, and a `WindowLine`
  that has already drifted on `/claims`), DEBT-0004 (two pages carry their own
  presentation), DEBT-0005 (the unclamped `error_summary` in the `/cycles`
  lead — BUG-0040's residual, ticketed rather than left as a note).

- **2026-09-03, claims-cost confirmation (TASK-0031)** — the handoff landed in
  the scraper repo and I confirmed it read-only rather than taking it on
  report. What landed there:
  `20260903000001_the_creation_bar_is_read_once_and_the_incumbent_is_one_seek.sql`,
  Ben-licensed in session, carrying **candidate A exactly as this campaign
  specified it** (`field_provenance_current_per_fact` on `field_provenance
  (entity_type, entity_id, field, applied_at desc, provenance_id desc)` — that
  table previously held nothing but its primary key) and a **different, better
  candidate B than the one I proposed**: not `not materialized` on the
  five-times-referenced `live_pending_claim`, but `materialized` on
  `required_column`, which was referenced ONCE and therefore inlined into
  `record_bar`'s per-record lateral — 6,586 `pg_attribute` scans, ~10s of the
  11.5s their own EXPLAIN measured. My diagnosis named the right table and the
  right kind of fix and the wrong dominant cost; recording that here because
  the next reader should trust their EXPLAIN over my inference from SQL.
  Amendments: **§6 trap 12 rewritten** from "cannot be read today" to what was
  measured, what fixed it, and the re-measurement (every one of thirteen shapes
  returns; the Claims page's own shape returns all 859 rows in **281–312 ms**
  against 8.1s and `57014` before — evidence `claims-probe3.tsv` beside the
  earlier two). Its two rules — no workaround code, and Admin never re-computes
  the classification — are **unchanged and still binding**: they were never
  contingent on the cost. **§12's claims-cost marker struck**, leaving that list
  empty, which is a legal state and not an invitation. **§4's pure-leaf list
  corrected** to `lib/review/**`, `lib/browse/**`, `lib/claims/**`,
  `lib/records/**`, `lib/format.ts`, `lib/edit/config.ts` — `lib/records/**` is
  the leaf DEBT-0001 landed (`routes.ts`, `provenance.ts`, both importing
  nothing), and the list still carried "`lib/browse/**` when TASK-0015 lands"
  after TASK-0015 was done and never named `lib/claims/**` at all. **No product
  code changed, by anyone, for any of this** — which was the whole point of
  ruling that no Admin-side mitigation existed. One live assertion is still red
  and it is a defect in the test's arithmetic, not in the page: Common
  violations row 7, admin-window/BUG-0037.

- **2026-09-02, fourth ruling pass (one item)** — Ben answered the adapter-runs
  column question (TASK-0023), so **§12's runs marker is struck** and the
  nine-column set plus the `?source=<name>` facet moved into the settled
  paragraph. The marker string itself is deliberately absent from this file now:
  TASK-0023's structural bar is that the marker leaves it. Why recorded here and
  not only on the ticket — §12's own rule is that a question is closed when its
  marker leaves the list, and the human reviews this file instead of the
  tracker. No other section changed: the set is the Dashboard's four (`source`,
  `started_at`, `ended_at`, `outcome`, `error_summary`) widened by
  `records_parsed`, `claims_emitted`, `records_unlinked`, `failure_class`, and
  `src/lib/db/runs.ts` stays a **window** read under §4.3 because no figure on
  the page is computed over the rows. The door is in `DECISIONS.md`, same date.
  Comments in `src/app/page.tsx`, `src/lib/db/dashboard.ts`,
  `src/lib/db/sources.ts` and the Dashboard offline tests still call the runs
  column set an open question; they are outside TASK-0016's scope and are not a
  defect — TASK-0016 corrects the ones in the files it owns.
- **2026-09-02, third ruling pass** — staging became reachable and the first
  live parity run happened, so this pass is written from measurement rather
  than from reading. Amendments:
  **§6 trap 12 (new)** — `pending_claims` cannot be read on staging in ANY
  shape but an unordered `limit 1`; I measured eight shapes myself (evidence
  `agenticflow/tracker/evidence/architect/claims-probe*.tsv`) before ruling,
  because the question the campaign actually had to answer was "is there an
  honest fast read we can write here" and the answer is no. The trap carries
  the two rules that follow: no workaround code, and Admin never re-computes
  the classification the view owns.
  **§9** — `TableEditConfig` gains `display`, the read-only half of the one
  map (Ben's ruling on TASK-0029). It is not a second allowlist: `decideEdit`
  still answers the write question, and a column is not editable by being
  displayed.
  **§10, three rules** — a live test names the STATE KIND before it compares a
  number (`error` is a FAIL, `empty` is a pass with a 0, `not_provisioned`
  needs the absence code from the test's own read); the live suite's write
  permission is `groups`/`idols` only; and what staging holds — one review
  item, zero `data_conflict` — is recorded so no one reads a 0-to-0 comparison
  as coverage.
  **§12** — four markers removed on Ben's rulings, one added: the
  `pending_claims` cost is now an open question with a handoff behind it.
  **Common violations row 6** — the live-oracle class, at 3 in one run.
  **§6 trap 1 was corrected by BUG-0024's builder, not by me** — the
  correction is right, is cited to the migration, and stands. Recording it
  here so the amendment is not invisible: this file has one writer, and the
  reason is that the human reviews it instead of reading code. A builder who
  finds this contract wrong should say so on the ticket; if the fix is as
  clearly right as that one was, it survives the pass.

- **2026-09-02, second ruling pass** (BUG-0016/0017/0018 landed, TASK-0007/
  0008/0015/0017/0018/0026-0028 landed; campaign `admin-window`, M1 in
  flight). Amendments:
  **§3 + §4 diagram + new rule 8** — `next.config.ts` is drawn: it is a BUILD
  HOST that imports `EDITABLE_TABLES` from the pure leaf so BUG-0017's
  `/records` backstop rewrite is derived from the one map. The arrow holds
  only while the leaf imports nothing, which is why that guard is named here.
  **§4.1** — the `DbResult` error arm in the snippet now shows `reading`,
  which the code has carried since BUG-0016; a contract that disagrees with
  the module beside it is worse than none.
  **§5, two rules** — a dynamic route that calls `notFound()` inherits the
  Next 16.2.2 error shell unless its miss is ROUTED (the `/records` rewrite is
  not inherited), and the auth gate is never given a handler (next-auth runs
  it in the branch before the redirect).
  **§7, three rules** — `ErrorLine.reading` required, the state card carries
  the replaced surface's eyebrow, and a rows surface can no longer render
  headers with no body. Filed as TASK-0030.
  **§10, two rules** — an absence assertion reads code lines and pins a call
  rather than a word; one owner per structural guard, and tickets run that
  file instead of copying its predicate.
  **Common violations 4 and 5** — both measured on the open tickets' own
  checks, both promoted on the spot.
- **2026-09-02, ruling pass** (QA findings on TASK-0001, TASK-0003, TASK-0006;
  campaign `admin-window`, M1 in flight). Five amendments, each because the
  contract was wrong or silent where a builder was about to guess:
  **§1.2 narrowed** — the `../` ban is about leaving `src/`/`tests/`, not about
  relative imports as such; as written it contradicted two landed modules and
  six in-flight ones, and would have bought a pointless refactor.
  **§4 diagram + new rule 7** — pure domain leaves (`lib/review/**`,
  `lib/format.ts`, `lib/edit/config.ts`) sit *below* `lib/db/**`, which is
  what TASK-0006 landed and what its two-module contract required; the old
  arrow pointed the wrong way. The leaf may never import `lib/db/**` back,
  not even a type: a type-only edge erases at runtime but still writes a
  directory-level cycle into this file. `lib/gauges/**` is unaffected — it
  fetches, so it sits above `lib/db/**` as drawn.
  **New §4.3** — the read-kind split. An unbounded PostgREST select returns an
  arbitrary subset in unspecified order, so a complete read now refuses rather
  than truncates and an `ok` array is the whole matching set. This is the
  amendment with the widest blast radius: eight unwritten `lib/db` modules
  would otherwise each have invented a bound.
  **§6 trap 11** — `shapeOf`'s fall-through default, and the migration that
  makes it reachable, recorded rather than ticketed.
  **Common violations** — seeded with three classes; two were promoted to
  rules on the spot (classes 1 and 2 are at 2+).
  Doors closed by these are in `agenticflow/docs/DECISIONS.md`, same date.
- **2026-09-01, intake.** Written from the `contracts/` snapshots read that
  day, the scraper repo's migrations, and a code walk of `src/`. Decisions that
  close a door are recorded separately in `agenticflow/docs/DECISIONS.md`:
  the `DbResult` union, the one-async-boundary rule, TypeScript-side gauge
  aggregation, and the scraper-repo freeze.
