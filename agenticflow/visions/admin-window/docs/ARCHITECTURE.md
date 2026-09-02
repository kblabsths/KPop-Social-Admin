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
    review/
      shapes.ts        shape -> kind (decision | signal), ordering, filter predicates
    gauges/
      cycle-health.ts  resolution-latency.ts  pending-claims.ts
      queue-health.ts  standing-disagreements.ts  settled-values.ts
    edit/
      config.ts        THE ONE hand-written {table -> editable columns} map (§8)
    format.ts          relative ages, absolute UTC timestamps, thousand separators, the null dash
  components/
    ui/                Page, Section, DataTable, StatCard, Badge, Chip, Button,
                       Loading, Empty, NotProvisioned, ErrorLine, EditableCell
    gauges/            the gauge cards (figure, trend table, distribution)
    evidence/          EvidencePair — the app's signature block (LOOK_AND_FEEL)
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
         lib/review/**, lib/format.ts, lib/edit/config.ts
         (and lib/browse/** when TASK-0015 lands)
```

1. **`components/**` never imports from `lib/db/**` and never fetches.** A
   component takes plain props and returns markup. This is what makes every
   surface testable without a database.
2. **Only `lib/db/**` imports `@supabase/supabase-js`.** A page that builds its
   own client is a defect.
3. **Only `lib/db/client.ts` reads `process.env`** for database credentials.
   One seam, one file — the env question (§12.1) changes this file and nothing
   else.
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
export interface TableEditConfig {
  readonly table: string;          // the canonical table
  readonly pk: string;             // its primary-key column (groups.id, events.event_id, ...)
  readonly regime: Regime;         // decides the WRITE PATH — never configured per column
  readonly editable: readonly string[]; // user-facing scalars only: never ids, keys, timestamps
}
export const EDIT_CONFIG: Readonly<Record<string, TableEditConfig>>;
```

- **M1 builds the `pre_cutover` write path only**: `groups` and `idols` edit
  **directly**, within their allowlist — legal and unprovenanced (spec §8,
  AGENTS.md data-ownership rule).
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
- **Every live test sweeps what it wrote** (acceptance test 13), in a `finally`,
  restoring the prior value. M1's only writer is the edit-surface test.
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

1. `OPEN-ENV` — **which Supabase env names the app reads at runtime vs. what
   the campaign's live tests read**, whether live tests get anything beyond URL
   + service key, and the missing `## supabase` declaration in `SERVICES.md`.
   Everything about it is confined to `src/lib/db/client.ts` and
   `tests/live/setup.ts`.
2. `OPEN-RUNS` — **what Cycles & runs shows for adapter `runs`**. `adapters.md`
   is not a contract snapshot and the table carries 22 columns. The
   `resolution_runs` half is fully specified and is built first, alone.
3. `OPEN-FIXTURES` — **whether a live test may write fixture rows into
   resolver-owned tables**, and **what staging actually has installed** — the
   resolver campaign's migrations are authored, but each one says "the staging
   apply is separate and human-gated."
4. `OPEN-DIAL` — **where Admin reads the per-source `resolver.stuck_pattern`
   dial**, which lives only in scraper registry YAML. The pending-claims gauge
   ships without its threshold line until this is answered; hand-copying the
   value is not an answer (spec §10).
5. `OPEN-PROVENANCE` — **provenance display on a pre-cutover table**:
   `groups`/`idols` edits are unprovenanced by construction, so no
   `field_provenance` row exists for them.

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

*(Rows 1–3 recorded by the architect at the 2026-09-02 ruling pass, from QA
findings on TASK-0001/0003/0006; rows 4–5 at the second pass the same day,
from measurement of the open tickets' own checks. The milestone structure walk
owns this table from here.)*

## History

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
