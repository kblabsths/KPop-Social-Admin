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
      verdict.ts       the settle path's reads and the verdict log
    review/            LEAF: shapes.ts (shape -> kind, ordering, predicates), queue-filters.ts
    browse/            LEAF: rows.ts (row shaping), views.ts (the column sets)
    claims/            LEAF: filters.ts (bucket + source narrowing)
    cycles/            LEAF: state.ts (a cycle's state, from its own row)
    records/           LEAF: provenance.ts, routes.ts (`recordHref` — the ONE record URL)
    sources/           LEAF: names.ts (a source's display name); routes.ts — the
                       `/sources`, `/queues?source_id=` and
                       `/cycles?source=` URLs, spelled once (BUG-0141)
    url/               LEAF: what a REQUEST VALUE means, for every route.
                       dropped-params.ts — the ONE "parameters this page did
                       not apply" rule; `/claims` and `/queues` both render it
                       from here, never from a copy (BUG-0141, common violation 9).
                       narrowing.ts — the two-fact rule (DEBT-0008).
                       spellable.ts — the ONE allowlist for a URL value inside
                       a sentence this app wrote (BUG-0153).
                       text.ts — the ONE derivation of a free-text facet value
                       (`canonicalUrlText`) and the ONE ends-only ink-padding
                       strip (`trimInkPadding`, which `canonicalRecordId` also
                       calls). IN FLIGHT under BUG-0155 — the only forward
                       entry in this map; everything else here is what the
                       tree holds
    verdict/           LEAF: decision.ts — the decision envelope (§9.2), the app's
                       ONE definition of visible content, and `ADMIN_SOURCE`.
                       Imports nothing; `lib/format.ts`, `lib/claims/filters.ts`
                       and `lib/db/verdict.ts` all consume it (§4 rule 7)
    gauges/
      gauge.ts         the window/figure shapes every gauge returns
      cycle-health.ts  resolution-latency.ts  pending-claims.ts
      queue-health.ts  standing-disagreements.ts  settled-values.ts
      index.ts         the barrel the pages import the six through
    edit/
      config.ts        THE ONE hand-written {table -> editable columns} map (§9)
    format.ts          relative ages, absolute UTC timestamps, thousand separators, the null dash
    supabase.ts        the SIGN-IN path's service-role client (§2 carry-over):
                       `admin.ts` and `auth.ts` import it. The one ruled
                       exemption to §4 rule 3 — see that rule.
  components/
    ui/                Page, Section, DataTable, StatCard, Badge, Chip, Button,
                       Loading, Empty, NotProvisioned, ErrorLine, StateOf,
                       WindowLine, MicroLabel/Eyebrow, cx, DroppedParamsLine.
                       **No identifier primitive** — §11's mono-identifier rule
                       is hand-spelled 44 times across 24 files instead
                       (DEBT-0011; structure walk, M2)
    EditableCell.tsx   the one old component that re-earned its place (§2), at
                       the components root and PascalCase for that reason (§11)
    edit-cell-layout.ts  the inline edit's placement rule (BUG-0101/0104/0105)
    edit-refusal.ts      the refusal's two halves — the database's words and the
                       app's (BUG-0098/0103). Both import nothing; they sit at
                       the components root because the edit surface's two
                       widgets (`EditableCell`, `records/entity-picker`) share
                       them and neither owns the other (structure walk, M2)
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
         lib/review/**, lib/browse/**, lib/claims/**, lib/cycles/**,
         lib/records/**, lib/sources/**, lib/url/**, lib/verdict/**,
         lib/order/**, lib/paging/**, lib/format.ts, lib/edit/config.ts
         (a leaf may import a leaf — rule 7, second paragraph)
         (the EXECUTABLE list is `LEAF_MODULES` in
          tests/offline/db/layering.test.ts — same set, one is the
          documentation of the other; amended 2026-09-10, see History)
```

1. **`components/**` never imports from `lib/db/**` and never fetches.** A
   component takes plain props and returns markup. This is what makes every
   surface testable without a database.

   **One exception, added 2026-09-10 (architect, M3), and it is a door with a
   frame around it:** a `"use client"` component **named as a paging control**
   may issue `fetch` — to **this app's own paging route handler under
   `src/app/api/admin/**`, by a relative path, and to nothing else**. It may
   not import `lib/db/**`, may not import `@supabase/supabase-js`, may not read
   `process.env`, and may not reach any other origin: the service-role client
   stays server-side, which is what `tests/http/**`'s bundle scan already
   grades. The fetch is a **two-line binding** to a pure driver in
   `src/lib/paging/**` — the decision of whether to issue a request, what bound
   it carries, and what happens to the answer lives in a directiveless module
   the offline suite drives directly with a recording stub (there is no DOM in
   this suite; a click handler that owns its own logic cannot be tested here at
   all, and that is why the logic is not in it). Every other component in this
   repo still takes plain props and fetches nothing, and no component of any
   kind reaches a database.
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

   **A leaf may import a leaf, and the leaf layer is a DAG** (ruled at the M2
   structure walk, 2026-09-09 — the diagram's `lib/<leaf>/** -> (nothing)`
   read as absolute while the tree has held leaf-to-leaf edges since M2, and
   they are the shape this contract wants, not a violation). The one rule
   that matters is the one already written above — a leaf reaches nothing
   that can reach a database — and an edge between two leaves cannot break
   it. What the edge buys is the opposite of drift: `visibleContent` /
   `hasVisibleContent` in `lib/verdict/decision.ts` is the app's ONE
   definition of "is there anything here", and `lib/format.ts` (the null
   dash) and `lib/claims/filters.ts` (the dropped-parameter line) both
   import it rather than each answering the question again. Four M2 bugs —
   BUG-0089, BUG-0095, BUG-0127, BUG-0136 — are that question answered
   twice, and BUG-0137's ruling is what happens when one shared predicate
   answers two DIFFERENT questions. So: **no cycles**, at any depth,
   including type-only imports (the reason rule 7's first paragraph bans the
   `lib/db/**` back-edge applies unchanged between leaves); and a leaf that
   another leaf imports states in its docstring which question it owns, so
   the next reader widens it for that question or not at all.
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

**3. Paged window read — the same window, at an explicit offset. AMENDED
2026-09-10** (architect, M3; SPEC F14, DECISIONS 2026-09-10, Ben's ruling
*"not being able to load all claims if I want to is a huge oversight"*).

> **Superseded, in place.** Until 2026-09-10 this paragraph read: *"Paging is
> not the answer to a cap and none is built: nothing in the spec asks for it,
> and complete-or-refuse means there is never a partial page to continue. When
> a table genuinely outgrows `ROW_CAP` the app says so with the real number,
> and raising the cap or narrowing the filter is then a deliberate decision
> with evidence behind it."* The spec now asks for it. The half of that
> sentence that still holds is kept below: a page is never partial, and
> nothing paging does may turn a window's rows into a total.

A paged window read is read kind 2 with one thing added — an **offset into the
same total order** — and it is the ONLY form of paging this app has. What it
may do:

- **Two surfaces, named here and nowhere else: `/claims` and `/browse`.** No
  third surface gains paging on the team's initiative, and neither surface
  gains a "load everything" control. This list is amended by a ruling, never by
  a ticket.
- **One order, and it is the first screen's.** A paged read repeats the first
  window's `.order()` chain — total, ending in the primary key — and adds
  `.range(offset, offset + size - 1)`. Nothing re-sorts, re-filters or
  re-shapes on the way back: the same narrowing function, the same row shaping,
  the same components. A page that changed any of them would be a different
  read wearing the first screen's clothes.
- **The bound is explicit, and it is the OFFSET.** Every request names how many
  rows of that order the caller already holds. It is not a page number, not a
  cursor the client may compose, and not a caller-chosen size — the size is the
  surface's own window, decided on the server. A bound that is not a
  non-negative integer multiple of that window, or that exceeds
  `MAX_PAGE_OFFSET`, is **refused with the reason named — never clamped in
  silence** (LESSONS 8: the guard that counts is on the server).
- **Exhaustion is an answer, not a refusal.** A page past the end is `ok` with
  zero rows and says the set is exhausted; the surface then says so and draws
  no affordance. A refusal is a refusal: `not_provisioned` naming its object,
  or `error` carrying the database's own words, exactly as every other read
  here refuses.
- **Complete-or-refuse holds INSIDE a page.** A page is `ok` with the rows that
  bound asked for, or it is a refusal — never a half-filled `ok`, and **a
  refused page never extends the list**: the rendered row count after a refusal
  equals the row count before it, and the refusal names the object beside the
  rows it did not add.
- **Full-or-exhausted, on BOTH sides of the wire** (amended 2026-09-10,
  architect, from BUG-0168 — the driver half of the bullet above). A page
  answer is `ok` with **exactly the window's rows** and the set continues, or
  it is `ok` with **at most the window's rows** and `exhausted` is true. The
  route derives that flag from its own read (`exhausted === rows.length <
  size`) and never emits any other combination. The client's driver holds the
  same contract as an invariant it CHECKS, because what comes over a wire is
  foreign data: a short page that says the set continues, and a page longer
  than the window, are **refused out loud** — no rows appended, the bound
  unmoved, the control retained for a retry — exactly as a body that is not a
  page answer at all is. The property this buys, and the one a paging surface
  may rely on: **after any press, either the bound the next press would carry
  is one this app may serve, or the state is `exhausted`.** The rejected
  alternative was to let the driver *reinterpret* a short page as the end of
  the set; it silently converts a truncated or mangled answer into "you have
  seen everything", which is the false-totality claim this whole section
  exists to make impossible.
- **A concatenation is still not a total.** No sentence on either surface may
  claim that what the operator has paged through is the whole set. The only
  totality claim on these pages remains what it is today: their own exact
  `head: true` count, read once, labelled as the count it is (§4.3 kind 1,
  SPEC F15). The app promises no snapshot across presses either — each page is
  a bounded read at the instant it was issued, and neither surface says
  otherwise.

What paging may **not** do, stated so it is not inferred: it does not raise
`ROW_CAP`; it does not turn a window read into a complete read; it does not
reopen whole-table browsing (Browse keeps its one curated view — a second view,
a table picker, a SQL runner and a search box all remain out); it is not a
substitute for search, which stays out of the product by Ben's ruling of the
same day. When a COMPLETE read genuinely outgrows `ROW_CAP` the old paragraph
still governs: the app says so with the real number, and raising the cap or
narrowing the filter is a deliberate decision with evidence behind it.

**An empty surface is explained from TWO facts, never one** (promoted at the
M2 structure walk, 2026-09-09, from Common violations row 14 — six bugs:
BUG-0110, BUG-0125, BUG-0129, BUG-0131, BUG-0133, BUG-0135). "A table with no
rows" and "a filter that matched nothing" never share a rendering
(LOOK_AND_FEEL, the four states), and the URL alone cannot tell them apart. A
surface deciding which arm it renders needs both:

1. **Structural** — can a facet of this URL remove a row of THIS surface's
   kind at all, whatever the table holds? Derived from the facet vocabulary,
   never from the row count. `?kind=decision` on the decision queue is not a
   narrowing (BUG-0129, BUG-0131).
2. **Population** — how many rows does this surface hold with no URL facet at
   all? If that is zero, no facet removed anything, and a surface that blamed
   a filter would be telling the operator to widen a filter that hides
   nothing (BUG-0133).

`isBlockNarrowed` in `src/lib/review/queue-filters.ts` is the reference
implementation and its docstring is the longest statement of the rule.
**Fact 2 is a read the page almost always already has** — an unnarrowed
count, or the unnarrowed rows themselves — so this costs a comparison, not a
query; where it does cost a query, that query is a bounded `head: true`
count, never a row read (BUG-0135). Every surface with an empty state owes
both facts: `/queues` has them, `/claims` and `/sources` decide from fact 1
alone today and DEBT-0008 is open against that.

The same two facts answer the figure beside the surface: a zero stated with
no denominator is fact 2 missing. "0 ran longer than the 15m cadence" beside
four cycles that never finished (BUG-0110) and the Dashboard's attention
zeros that never said what fills the queue (BUG-0125) are this rule, in the
gauge rather than in the empty card.

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
  selector, `EditableCell`, and — **added 2026-09-10 (architect, M3)** — the
  paging control of `/claims` and `/browse`. They receive data as props and
  fetch nothing, with the single framed exception §4 rule 1 now names: a paging
  control calls this app's own paging route handler, and nothing else.
- **State lives in the URL** (LOOK_AND_FEEL bar 11): every filter, sort, tab
  and page position is a `searchParams` value. No client-only filter state, no
  `useState` filter that a reload forgets.

  **Amended 2026-09-10 (architect, M3): rows the operator has PAGED IN are the
  one piece of state that is not in the URL, and that is a decision, not a
  lapse.** The URL still decides the first screen completely — every filter,
  sort and tab — and **the first screen is byte-identical to what it renders
  today** (SPEC F14): a URL that is shared, reloaded or opened cold renders the
  same server-rendered window, the same window line, the same figures and the
  same rows as before paging existed. What paging adds lives after that screen
  and dies with it: appended rows are client state, a reload discards them, and
  no `searchParams` value carries an offset. Why this way and not URL state:
  putting the offset in the URL makes every "more" a full server round trip and
  a new document — Ben named on-demand client fetching as the mechanism — and
  it would make the FIRST screen of a shared link depend on how far somebody
  else had scrolled, which is exactly the byte-identity this amendment
  protects. The async boundary above is untouched: a paging control is a
  synchronous client component, it is not `async`, the page function remains
  the only `async` component on the route, and
  `renderToStaticMarkup(await Page({ searchParams }))` still renders the whole
  first screen offline.
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
| Claims | **view** `pending_claims` | `observation_id, domain, entity_id, field, source_id, bucket, unmet_requirement` + `observed_at` — **pending Ben's install on staging** (BUG-0138 Answer A, ruled 2026-09-10; handoff `agenticflow/tracker/for-human/M2-handoff-pending-claims-observed-at.md`). Until it is installed the column is not there and a read naming it fails `42703` |
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
3. **`pending_claims` carries no value, and carries age only once the 2026-09-10
   handoff is installed.** It never carries the claim's `value` — that is
   `observations.value`, and §6 trap 8 governs it.

   **Age**: until Ben applies
   `agenticflow/tracker/for-human/M2-handoff-pending-claims-observed-at.md` to
   staging, the view has no age column and age comes from joining
   `observations.observed_at` by `observation_id` (§4.2's two-step) — the
   nine-chunk second leg BUG-0138 exists to delete. **After it is applied**, the
   view carries `observed_at` itself (`timestamp with time zone`, appended last,
   `NOT NULL` upstream), the two-step is gone from `/claims`, and the claim list
   is ordered in the DATABASE (`observed_at asc, observation_id asc, limit 50`).
   Do not add a second age derivation: one column, one order, one place.

   Two things that stay true either way, both measured read-only against staging
   2026-09-09 and neither fixed by the column: PostgREST exposes **no
   relationship** between this view and `observations` (`PGRST200` on all three
   embed shapes — no `observations!inner(...)`, in either direction), and it
   **refuses aggregates** on this deployment (`PGRST123` on `select=bucket,count()`).
   So there is no grouped read and no distinct-count here, ever: bucket figures
   are one `readCount` head request per bucket, and a figure that would need an
   aggregate is dropped rather than computed over a truncated population
   (DECISIONS.md, 2026-09-10).
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
- **A badge never sits inside a link, and a link never wears one**
  (LOOK_AND_FEEL, *Chips and badges*; earned by BUG-0113, promoted at the
  second instance, BUG-0115). A chip is an inline-block box with a fill of its
  own, so inside an anchor it takes CSS priority over the inherited ink and
  paints over the ancestor's underline — and where the anchor carries a hover
  fill of the same token, the chip's own box dissolves into the card under the
  pointer. The rule is structural, not decorative: **no anchor in any page's
  delivered markup contains a chip-filled span.**
  - On a **text link** the words themselves carry `IN_PAGE_LINK`; a badge that
    classifies them sits beside the anchor, never around or inside it.
  - On a **card-shaped link** — `StatCard` with an `href`, whose anchor is the
    whole card — a badge that classifies the card sits inside the card's shell
    and OUTSIDE its anchor. Wrapping a card in an anchor does not make its
    classifications part of a label.
  - Enforced repo-wide and over the **rendered window**, not per page:
    `tests/offline/ui/link-spelling.test.ts` — the one owner of link spelling —
    sweeps every route the filesystem offers (`loadSurfaces()` / `pageRoutes()`
    from `tests/offline/absence/surfaces.ts`, the shared harness three files
    already drive) against a populated database and asserts `chipsInsideLinks`
    is empty on each. The chip's classes are derived by RENDERING `<Badge>`
    (`tests/fixtures/link-spelling.ts`), so restyling the chip moves the guard
    with it and no class literal is pinned. A page added later inherits the
    rule rather than a comment about it.
  - What the sweep does **not** cover, and the walk still owns: a chip inside a
    link on a state the populated script never renders. The guard is a floor
    under the walk, not a replacement for it.
- **Text this app did not author never sits inside a sentence this app wrote**
  (earned by BUG-0123 -> BUG-0127 -> BUG-0136 -> BUG-0137: four bugs on ONE
  sentence, three of them widenings of one blocklist). Foreign text — a URL's
  key, a database free-text value — reaches prose one of exactly two ways:
  - **Through an allowlist**, when the app can say in advance what a legal one
    looks like. `/claims`' dropped-parameter line spells a key only if it
    matches `^[A-Za-z0-9_.-]{1,64}$` — the class every facet name satisfies —
    and every other key is COUNTED without being spelled, through the
    `withheld` arm that already exists for the parked word
    (`droppedParams`, `src/lib/claims/filters.ts`).
  - **In its own box**, when it cannot — a mono value in a table cell, a row, a
    `<bdi>` — where a bidi control can only reorder that box's own contents.
    Every DB value this app renders today is in a cell and satisfies this by
    construction; inlining a database string into an authored sentence does
    not, and is the shape to refuse. (No survey of that has been done; if one
    turns up it takes this arm, not a scrub.)

  Why not a wider blocklist. Two questions the line was answering by codepoint
  class are undecidable that way. "Does this render ink" is font- and
  layout-dependent, and each patch closes one family: whitespace (BUG-0127),
  then `Cf`/`Cc`/Hangul fillers (BUG-0136), then `Mn` + U+2800 + the bidi
  controls (BUG-0137). "Does this READ as the word bar 3 bans" is worse — an
  ink-less mark inside `in_window`, a Cyrillic homoglyph, a ligature — an open
  visual-similarity question with no computable boundary. An allowlist
  collapses both to an exact ASCII compare, which is total and stays true.
  **The app's one definition of blank (`hasVisibleContent`,
  `src/lib/verdict/decision.ts`, §4/BUG-0089) is not the tool for this and is
  never widened for a rendering question**: it answers "did the operator type
  anything?" for the edit surface, where U+FE0F and U+2800 are CONTENT and a
  draft of them commits. Two questions, two answers, one owner each.

- **What is SHOWN is what was USED: one derivation per URL value class**
  (earned by seven bugs on one family — BUG-0137, 0143, 0145, 0146, 0147,
  0153, 0155; common violations row 20). The allowlist above answers *may I
  spell this*. It cannot answer *is this the value I used*, and a facet value
  is used twice: it is SENT to PostgREST and it is SPELLED in the app's own
  sentences. Six of those seven bugs each closed ONE property of the value —
  no markup, no bidi, some ink, bounded length, a canonical spelling, padding
  stripped by ink — and the property none of them stated is this one. Both
  questions are answered where the value is DERIVED from the request, **once
  per value class**, and the derived value is the only string that reaches the
  query, the facet's own box, and every sentence that names it — or there is
  no facet at all and the shared dropped-parameter line says so.
  - **A uuid** → `canonicalRecordId` (`src/lib/records/id.ts`).
  - **A free-text name** — `?source=` today, and the next facet of its kind →
    `canonicalUrlText` (`src/lib/url/text.ts`). It strips the padding a paste
    carries, by INK and at the ENDS only — the same one strip
    `canonicalRecordId` uses (`trimInkPadding`, one declaration, called by
    both: a rule in prose is retyped, LESSONS 5) — refuses what the allowlist
    refuses, and refuses what a browser would RE-SPELL, which inside
    printable ASCII is exactly a run of two or more spaces. What it returns is
    the string that is both sent and spelled; what it refuses is spelled
    nowhere and is reported as a parameter the page did not apply.
  - **A value that reaches PROSE ONLY and asserts nothing about a queried set
    is not in this rule.** `?cycle=`'s unmatched-paste arm spells a paste in
    full through the allowlist and queries nothing, so "not among the 200
    newest cycles" is true of every spelling of it; that arm is deliberate and
    unchanged (BUG-0147).
  - **A seam that re-asks the question asks the DERIVATION, not the
    allowlist**: a component handed a facet value renders it only when the
    value is already its own canonical form (`canonicalUrlText(v) === v`), so
    a second caller cannot reintroduce the defect by handing it a raw
    parameter. That is the same reason the allowlist is re-asked at the seam
    today, one question later.

  Why the interior case is REFUSED and not boxed in `white-space: pre`. The
  box would put a non-wrapping foreign run inside six authored sentences of
  one page (the runs window line's four clauses, the facet paragraph, the
  empty card) to preserve a spelling no registered source uses, while the
  family's answer for "cannot be spelled faithfully" — counted, not spelled,
  on the dropped line — already exists and renders nothing new. Measured
  before ruling: QA's own strict pin collapses the rendered text the way a
  browser does *before* comparing it to the queried value
  (`tests/offline/cycles/page.test.ts`, the BUG-0155 pin), so the `pre` box
  cannot pass it and refusal is the only arm that can.

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
export type Regime = "sandbox" | "resolver_owned";
export type WritePath = "direct" | "override";
// The regime DECIDES the write path. Total over Regime: a table Admin may not
// write is not in the map at all, so there is no "no path" arm to fall into.
export function writePathFor(regime: Regime): WritePath;
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

- **TWO REGIMES, and no map entry for a table Admin may not write** (Ben's
  ruling, 2026-09-08, recorded in DECISIONS.md; it struck VISION's
  "groups/idols edit directly within it" with the instruction *"admin edits
  catalog tables only through the observation pipeline; do not re-implement
  direct edits"*, and ruled the same day that groups/idols get **no door** —
  no listing, no search, no entry point — and that he expects to drop both
  tables soon). `pre_cutover` is **gone as a concept and as an identifier**:
  - **`resolver_owned`** — `events`, `venues`. `writePathFor` → `"override"`:
    the edit lands as an admin-tier observation through the gate, applied
    through `apply_resolution`, stamped `admin_locked`, logged in `verdicts` as
    `action = 'override'` with a null `review_item_id` (§9.2). **This is the
    only path by which a catalog value changes from Admin, ever.**
  - **`sandbox`** — `walk_sandbox` alone. `writePathFor` → `"direct"`: a direct
    PATCH within the allowlist, on a staging-only fixture table that is **not a
    catalog table and belongs to no ecosystem domain**, which is why the strike
    does not reach it (§9.1 item 5). It is the app's only direct write, and the
    only writable surface at all until Ben installs `settle_review_item`.
  - **`groups` and `idols` are not in the map at all.** `editConfigFor` returns
    null for them, `/records/groups/<uuid>` is a routed 404, and a PATCH is
    refused `unknown_table`. *Considered and rejected 2026-09-08*: a third
    `read_only` regime keeping their record pages as reads, on the grounds that
    SPEC F12's display half names the idol↔group islands and Ben's note says
    they "stay as test tables". It loses on three counts — with no door and no
    write, a record page reachable only by a pasted uuid is a surface no
    operator can reach; the reference-as-link mechanism is fully carried by
    `events.venue_id`, which is what acceptance test 8 grades; and "stay as test
    tables" is satisfied by the DATABASE, since `lib/db/tables.ts` keeps both
    names and the residue sweep still reads them. Restoring an entry is two
    objects in one file if Ben ever wants the page back.
  **Where the teeth are, now that the type no longer carries them**: a `Regime`
  member is not what stops the struck path returning — a catalog table re-added
  under `sandbox` would be exactly it. The pin is structural and lives in
  `tests/offline/edit/config.test.ts`: **the only table whose write path is
  `direct` is `walk_sandbox`**, proved on two fixtures (a probe entry it must
  flag, the shipped map it must not). A ticket that re-adds a catalog table with
  a direct path is re-implementing what was struck; refuse it and cite this line.
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
- `events` and `venues` carry `regime: "resolver_owned"`. In **M1** they
  rendered read-only with an empty `editable` and no write path of any kind. In
  **M2** they gain an `editable` set — **Ben's answer of 2026-09-08, never a
  builder's pick** (SPEC named gap 7; DECISIONS 2026-09-08) — written through
  §9.2's override path and through nothing else:
  - events: `title`, `description`, `poster_url`, `starts_at`
  - venues: `name`, `city`, `country`, `address`

  `event_type`, `status` and `time_precision` are ruled OUT and stay out: all
  three are CHECK-constrained, so a free-text cell can produce a refusal the
  operator cannot predict, and the fixed choice list that would fix that is a
  widget this campaign has not costed. `ends_at`, `ticket_url` and every
  unlisted `venues` column are out for want of a ruling, not for want of a
  candidate — both lists are registry-declared, so the gate would accept them
  and taste did not.
  **A column MOVES from `display` into `editable`; it never stands in both.**
  `display` is the read-only half of the one map and `decideEdit` reads
  `editable` alone, so a column in both would be writable while the map called
  it read-only. After the move `events.display` is `["venue_id"]` — the
  reference alone — and `venues.display` is empty; because `mappedColumns`
  orders pk → editable → display, both record pages draw the same lines in the
  same order they draw today.
  **Widening the list later is ONE edit to those two entries** (Ben, 2026-09-08:
  the list can be updated later) — never a second list, never a per-column
  flag, never a "future columns" scaffold. Every column of them still refuses
  through the one code path when it is absent from the map, and no `.update()`
  on either table exists anywhere in `src/`.
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

**5. Its `Regime` is `sandbox` — re-ruled 2026-09-08, and the door this
paragraph left open is the one that opened.** The original ruling (kept below,
because its reasoning is why the new name is a rename and not a third code
path) reused `pre_cutover` on the grounds that `Regime` answers one question —
which WRITE PATH — and the sandbox's answer was identical to `groups`/`idols`'.
Ben's strike of 2026-09-08 ends that: `groups`/`idols` leave the map entirely,
so the sandbox's answer is shared with nothing, and the identifier
`pre_cutover` would name a regime whose only member is a table that was never
pre anything. The trigger this paragraph named — *"if a second non-catalog
table ever enters the map, or if any code starts reading `pre_cutover` to mean
'a catalog table', the third regime is earned then"* — is exactly what fired.
The rename costs one word in `config.ts`, one arm in `writePathFor`, and the
`regimeNote` ternary on the record page, which is now **three-way and honest**:
the sandbox's note says a value written here goes to a staging fixture, not "to
the catalog" — the one inaccuracy this section had been carrying on purpose is
paid off by the same edit. The direct PATCH itself is unchanged, and it is
UNTOUCHED by the strike because a fixture table in nobody's domain is not a
catalog table. The original ruling, for its reasoning:

**5a. (superseded 2026-09-08) Its `Regime` was `pre_cutover`, reused on purpose.** `Regime` answers one
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

### 9.2 The override path — how a catalog value changes from Admin after M2

*(Written 2026-09-08 at the M2 decomposition, from spec §7/§8,
`contracts/resolver.md`, and the sibling's INSTALLED migrations read the same
day. Every ticket that writes a catalog value carries this subsection.)*

**One entry point, and the app holds exactly one call to it.**
`settle_review_item(p_decision jsonb)` — a jsonb ARGUMENT, following the two
shipped idioms in the sibling (`apply_resolution(p_decisions jsonb)`,
`ingest_observations(p_batch jsonb)`, whose own migration comment records that
"the ban is on jsonb COLUMNS, and a batch argument is not a column"). The app's
one call site is `settleReviewItem` in `src/lib/db/verdict.ts`; a second `.rpc(`
anywhere in `src/` is a defect, pinned by
`tests/offline/edit/config.test.ts` and `tests/offline/review/one-place.test.ts`.

**The parameter name is part of that contract, and it is coupled by a test.**
PostgREST resolves an RPC by name AND by argument names, and answers `PGRST202`
for a wrong one — the same code it answers for a function that is not installed
at all — so a spelling drift renders a provisioned function permanently and
silently absent. Measured 2026-09-08 (QA on admin-window/TASK-0048): with the
constant sabotaged to `p_decisions`, the whole offline suite stayed green. It is
spelled once, `SETTLE_ARGUMENT` in `src/lib/db/verdict.ts`, and **the handoff
artifact's offline test asserts the artifact's parameter name against that
constant**, the way it already asserts the `action` CHECK against
`VERDICT_ACTIONS` — on both fixtures (§13.4): red on a sabotaged spelling, green
on the shipped artifact.

**The decision envelope is a pure leaf**, `src/lib/verdict/decision.ts`
(ARCHITECTURE §4 rule 7: it imports nothing). It is the SAME shape the §9
handoff artifact's SQL reads, and the handoff's own offline test imports
`VERDICT_ACTIONS` from it and asserts the artifact's `action` CHECK equals it —
so SPEC named gap 6 ("the shape F9 authors is the shape F10 calls") is closed
by a test rather than by two builders remembering.

The eight action names, ruled here because no contract spells them and two
builders may not each invent one — snake_case, rendered verbatim in mono (§11):
`choose_claimed_value`, `supply_value`, `keep_current` (the `data_conflict`
three), `link_entity`, `settle` (the `entity_link` fact two), `fixed`,
`wont_fix` (the signal dispositions), `override` (item-less, from the record
surface). A disagreement Ben finds at install is a patch, never a silent
Admin-side adaptation (SPEC F9).

**What the envelope may NOT carry, because the database already knows it:**

- **No `schema_version`.** The gate validates a claim against
  `domain_schema(domain, version)`, whose content is the scraper's registry
  compiled into SQL. A version number in Admin is scraper registry knowledge
  re-encoded by hand — spec §10's "flagged gap, not a silent copy". The
  FUNCTION resolves the domain's current version; Admin never names one.
- **No source name, no tier, no `rejected_by`.** All three belong to the
  function's own branches.
- **No canonical column name.** The registry's field names ARE the canonical
  column names (the sibling's own words: "`column` defaults to `field`, because
  the registry gives a domain's fields the canonical columns' own names"), with
  exactly one exception: `events.venue` is the registry field, `events.venue_id`
  the column it produces — which is what makes it a **reference** and F12's
  picker rather than a cell.

**Two facts of the installed schema that decide the shape of the override**
(read 2026-09-08 from `kspace Scraper/supabase/migrations/`, and any change
here is a re-read, not a guess):

1. **The gate refuses an unregistered source** (`ingest_observation`, KS007:
   "source \"%\" is not registered"), so an admin-tier observation needs a
   registered `sources` row. **Ben's answer, 2026-09-08** (DECISIONS
   2026-09-08): the admin voice is the row `source = 'admin'`, `tier = 'admin'`,
   `lifecycle = 'active'`, `kind = 'registered'`. Staging holds no such row
   today — read-only census 2026-09-08: `ticketmaster` and two test-harness
   sources, nothing else — so **the `settle_review_item` artifact carries an
   idempotent `insert … on conflict (source) do nothing` for it inside its own
   fenced block**, and Ben installs the row and the function in one paste
   (admin-window/TASK-0046 carries the exact shape, checked against the
   installed `sources`: `sources_source_key UNIQUE (source)`, the
   `source_kind` / `source_lifecycle` / `source_tier` enums, and the
   `sources_source_shape` CHECK `^[a-z0-9_]+$`). **The name is spelled once**,
   `ADMIN_SOURCE = "admin"` in the pure leaf `src/lib/verdict/decision.ts`: the
   artifact's own offline test asserts the SQL's source literal against that
   constant, and any surface naming the admin voice imports the same one. It is
   a NAME, not an envelope field — `VerdictDecision` still carries no source
   name and Admin still sends none.
2. **A reference is observed as a ref, not as an id.** Events v3 declares
   `venue` as `{"ref": "<the source's own id for the venue>"}`, and the link
   stage resolves `(source, 'venues', external_ref)` through
   `confirmed_matches` into `venue_id`. `confirmed_matches.matched_by` already
   admits `'verdict'`. So a picker's choice lands as **the observation plus its
   confirmed match** — which is exactly what spec §8 says, and it is authorable
   against what is installed.

**How a surface knows the path is open.** PostgREST cannot introspect a
function without calling it, so nothing may probe `settle_review_item` by
calling it. **Ruled: a surface reads the presence of the `verdicts` TABLE**
(`readSettlementReadiness` in `lib/db/verdict.ts`, one owner, one helper — never
hand-copied per page, common violation 9). Absent, it renders
`data-state="not_provisioned"` naming `verdicts` and offers no control. The two
migrations install together and the function's own artifact writes the table it
depends on, so "table present, function absent" is a state the handoff cannot
produce — and if it arrives anyway, the attempted call returns
`not_provisioned` naming `settle_review_item` and the same card is drawn after
the click instead of before it. Both paths are graded; neither throws.

**`not_provisioned` learns the absent FUNCTION** (§4.1's classifier): PostgREST
answers a missing function with `PGRST202`, and Postgres with `42883`. Both
join `PGRST205` / `PGRST204` / `42P01` / `42703` in the one helper, and `missing`
carries the function's name.

**What must never be built** (spec §10's one forbidden move, and it is the
sentence the whole milestone hangs on): **no Admin-side workaround for the
absent function.** Not a queued write, not a "pending overrides" table, not a
direct `.update()` behind a flag, not a second write path "until Ben installs
it". The surface degrades to read-only with the reason named, which is what M1
already ships.

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
  `tests/offline/review/one-place.test.ts`; layering — the leaf set, the
  credential seam, the table-name seam — is `tests/offline/db/layering.test.ts`;
  the **twice-exported-name** guard is the `OWNER` map in
  `tests/offline/url/narrowing.test.ts`, NOT layering (recorded 2026-09-10:
  DEBT-0016's criteria named the wrong file and the builder had to rule around
  it — a criterion that needs this guarantee names the OWNER map). A ticket
  that needs one of those
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
  **Through the shared primitive, not through the class pair** (structure
  walk, M2, 2026-09-09): the rule is currently hand-spelled as
  `type-data text-ink` 44 times across 24 files, with two byte-identical
  file-local components (`TableName` in the record page, `ReviewItems` in the
  queues item page) that cannot see each other — which is how three M2 bugs
  arrived one route at a time (BUG-0112, then BUG-0120 "the face BUG-0112
  fixed one paragraph above", then BUG-0121 "the face BUG-0120 fixed one
  route over"). DEBT-0011 builds the primitive; until it lands, a ticket
  rendering an identifier states in its criteria which face it uses, and
  after it lands a new hand-spelling is a defect. A rule spelled as two
  Tailwind classes at every call site also has nowhere to hold the bidi
  isolation the row-15 ruling requires of foreign text.
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

**No question is open.** The two filed at the M2 decomposition on 2026-09-08
were answered by Ben the same day and their markers left this list for that
reason — they are not spelled here, because each ASK ticket's structural check
is its marker's ABSENCE from this file and quoting one would re-open the
question on a grep. In one line each, with the door each closes in its dated
`DECISIONS.md` paragraph:

- **The admin voice is a registered source row of its own** — `source = 'admin'`,
  `tier = 'admin'`, `lifecycle = 'active'`, `kind = 'registered'`. Staging holds
  no such row, so the `settle_review_item` handoff artifact carries an idempotent
  insert for it and Ben installs the row and the function in one paste; the name
  is spelled once as `ADMIN_SOURCE` in `lib/verdict/decision.ts` (§9.2;
  admin-window/TASK-0043 → TASK-0046).
- **The editable columns are** events `title`, `description`, `poster_url`,
  `starts_at`, and venues `name`, `city`, `country`, `address` — the columns Ben
  ruled visible on 2026-09-02, now writable through the override path.
  `event_type`, `status` and `time_precision` stay out as CHECK-constrained, and
  the list may be widened later by ONE edit to the two map entries, never by a
  second list (§9; admin-window/TASK-0044 → TASK-0054).

An empty list is the state this section is now in, and it is a state it is
allowed to be in — it is not an invitation to invent a third question: a new
silence is a new blocked ASK ticket with its own marker, never a choice made in
code.

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
8. **A ticket that touches the edit surface carries the no-direct-catalog-write
   line, verbatim** (Ben's ruling, 2026-09-08; §9's three-regime bullet;
   DECISIONS 2026-09-08): *after M2 the only path by which a catalog value
   changes from Admin is the override path through the gate; the struck direct
   path is never re-implemented, under any name.* A ticket whose work would
   re-add a catalog table to `EDIT_CONFIG` under the `sandbox` regime, give a
   `resolver_owned` table a direct write, or route a catalog write around
   `settle_review_item` is wrong on its face, and the builder says so instead of
   building it. The one pin that catches it: the only table whose write path is
   `direct` is `walk_sandbox`.
9. **Consolidation-shaped M2 work is chained at its DESTINATION, not at its
   source.** `src/lib/edit/config.ts`, `tests/offline/edit/config.test.ts`,
   `src/app/queues/[reviewItemId]/page.tsx` and `src/lib/db/verdict.ts` are each
   written by several M2 features; every ticket that lands in one of them
   depends on the previous one that does, because worktrees isolate builds and
   not landings.

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

| 12 | **A direct catalog write path from Admin** — the shape Ben struck from VISION on 2026-09-08 | 1 | The M1 `pre_cutover` regime: `groups`/`idols` PATCHed their own rows through `updateRecordField`. It was legal when it shipped (spec §8, AGENTS.md) and it is not legal now | **Standing rule from the day it was filed, not from a second instance** — the class is closed by a human ruling rather than by a count, so it is promoted at 1: §9's three-regime bullet and §13.8. Cited in the decomposition brief of every ticket touching `src/lib/edit/config.ts`, the PATCH route, or `src/components/records/**`. The teeth are structural and live in `tests/offline/edit/config.test.ts`: the only table whose write path is `direct` is `walk_sandbox`, so a catalog table re-added with a direct path reddens on two fixtures |

| 13 | **A chip-filled span inside an anchor — a `<Badge>` standing as the whole body of a text link, or a badge classifying a card whose whole body is a link** | 2 | `src/components/claims/bucket-table.tsx`: BUG-0108 gave the five bucket anchors `IN_PAGE_LINK`, but the anchor's body was a `<Badge>` whose own `text-ink` and `bg-chrome` won over the inherited accent and painted over the underline — QA measured the anchor's crop byte-identical to the same crop with `text-decoration-line` forced to `none`, both themes, all five buckets (BUG-0113). Second instance: `src/app/page.tsx:193` (`AttentionDetail`) renders the severity `<Badge>` inside the Dashboard attention card, whose whole body is an anchor (`src/components/ui/stat-card.tsx:82`); card and chip share the `bg-chrome` token, so the chip's box measures 0 card-fill pixels in its own crop under the pointer, both themes (BUG-0115) | **PROMOTED at count 2, 2026-09-09** (architect, this ruling), exactly as the count-1 note said it would be: a rule in **§7** — no anchor in any page's delivered markup contains a chip-filled span, with the card-shaped-link case named — and **the assertion in the repo-wide link guard**, `tests/offline/ui/link-spelling.test.ts`, which is already the one owner of link spelling. The guard is a rendered whole-window sweep over `loadSurfaces()`, not a source-text heuristic: measured 2026-09-09 on the tree at run/admin-window, it returns 2 hits on `/` and 0 on the other seven routes, so it is red today for exactly the open defect and non-vacuous. It lands with BUG-0115's fix (criteria amended the same day), not as a ticket of its own — a guard authored apart from the defect it must flag is how row 4 was born. The count-1 reasoning stands as recorded and is why nothing was built at count 1: the designer had put the rule in LOOK_AND_FEEL, *Chips and badges* ("a badge never sits inside a link, and a link never wears one", walkable form "no anchor inside `main` contains a chip-filled span"), and a repo-wide structural guard authored against a single instance is how absence pins keyed on the wrong thing get born. BUG-0113's own narrow pin (`expectLinkSpellingReachesTheGlyphs`, `tests/fixtures/link-spelling.ts`) is unchanged and still grades the five bucket anchors

| 14 | **A composed read's HELPER leg refusing the WHOLE read — rows the URL's own complete read returned, deleted by a leg that renders no row** | 1 | `readReviewQueues` in `src/lib/db/review-items.ts`, on the code BUG-0133 landed: the population leg is an unconditional `listReviewItems({})` — the whole table, which no URL facet narrows — and its refusal is returned as the whole read's refusal. Past `ROW_CAP` every faceted `/queues` URL renders the error state with zero rows, including the `?queue=`/`?status=` URLs PostgREST narrowed by a real column and answered in FULL, and the error line then tells the operator to narrow the filter they just narrowed. Measured offline 2026-09-09 (BUG-0135): leg 1 `{2 rows, count 2}`, leg 2 `{10 rows, count 1500}` → `kind:"error"`, the two rows gone; both blocks `data-state="error"` on `/queues?queue=data_conflict` | **Count 1, note only — NOT promoted.** The rule this violates already exists in three places: §4.1 ("a page composing several reads must be able to say WHICH read refused"), §4.3's window-line rule, and the landed practice on `/claims` (`src/app/claims/page.tsx` ~723-728 — the source registry refuses, every claim still renders, the refusal is reported on its own naming its own object) and on this very page in prose (`src/app/queues/page.tsx` ~565-567). What was missing is not a rule but its application to a leg that decides WORDS rather than rows — the shape a builder does not recognise as a composed read at all. Fixed at the instance by the BUG-0135 ruling (architect, 2026-09-09), both ways: the leg becomes a per-shape COUNT read (`head: true`) so a table of any size can no longer refuse it, AND its refusal is carried per kind as its own `DbResult`, reported as its own sub-surface beside the rows, with the scope decision falling back to BUG-0131's structural rule. **If a second composed read is found refusing whole for a leg it does not render, promote to §4.3:** a leg that renders no row of its own may not decide the surface's state, and its refusal is reported beside the rows or not at all. |

| 15 | **A blocklist chased one codepoint class at a time — foreign text inlined into an app-authored sentence, then "made safe" by removing the family that last broke it** | 3 | One sentence, `/claims`' dropped-parameter line, patched three times: BUG-0127 (`trim()`, so `?=x` and `?%20%20=1` stopped naming nothing), BUG-0136 (`trim()` replaced by the app's one definition of blank, closing `Cf`/`Cc`/the Hangul fillers), BUG-0137 (the same 0px hole through `\p{Mn}`, the parked word `in_win<U+034F>dow` rendered legibly past bar 3, and an unterminated U+202E in a key reversing the rest of the app's own sentence in the copied-out text) | **PROMOTED at 3, 2026-09-09** (architect, this ruling): §7 gains the rule — foreign text reaches prose through an allowlist or inside its own bidi-isolated box, and never by scrubbing. BUG-0137's criteria were amended to the allowlist shape (`^[A-Za-z0-9_.-]{1,64}$`, counted-not-spelled otherwise) and its touch scope narrowed to drop `src/lib/verdict/decision.ts`, because the third patch's tempting move — widening `INK_LESS` to `\p{Mn}` — would have changed what the EDIT surface commits as a draft (`tests/offline/ui/editable-cell.test.ts` pins U+FE0F and U+2800 as content). That is the class's real cost: a shared predicate answering two different questions gets widened by whichever question broke last. Cited in the decomposition brief of every ticket that renders text the app did not author. The measurement the ruling was made on — the allowlist replayed against every fixture BUG-0123/0127/0136 pinned — is `agenticflow/tracker/evidence/BUG-0137/rule-dryrun.mjs`; it is what showed that QA's two strict pins were jointly satisfiable only by a fourth blocklist, so criterion 5 widens one of them by one field rather than leaving the builder to discover it. |

| 14 (re-count) | **A surface deciding "nothing here yet" vs "nothing matched" from the URL ALONE** — the two-fact rule with one owner | **3** (1 → 3) | Two more surfaces found at the M2 structure walk, 2026-09-09, both measured on run/admin-window: `src/app/claims/page.tsx:647` (`isNarrowed(filter) ? NOTHING_MATCHED : …`, and again at :232 and :681 for the bucket caption) and `src/app/sources/page.tsx:200` (`data-empty={filter.source_id === undefined ? "registry" : "narrowing"}`). Both read fact 1 and nothing else, so a facet over an EMPTY set renders "nothing matched" and tells the operator to widen a filter that removed nothing. The ledger records staging holds 0 standing disagreements, so `/claims?tab=standing` with any facet is in that state today | **PROMOTED at 3, 2026-09-09** (architect, M2 structure walk) — §4.3 gains "An empty surface is explained from TWO facts, never one", with the population fact and the note that it is a read the page already has. Row 14's count-1 note said "if a second composed read is found refusing whole for a leg it does not render, promote"; what the walk found is the *other* half of the same class — not a leg refusing, but a surface with only one fact — so the rule promoted is the one BUG-0133's own docstring already states, generalised off `/queues`. `isBlockNarrowed` in `src/lib/review/queue-filters.ts` is named as the reference implementation. DEBT-0008 carries the two surfaces, chained behind BUG-0141, and criterion 4 makes `tests/offline/absence/pages.test.ts` grade all three at once, on two population fixtures each — the file that already generalises absence rules across surfaces, so a fourth surface inherits the rule instead of a comment about it |
| 16 | **The mono identifier face hand-spelled at the call site, with no primitive to import** | 3 | `grep -rno 'type-data text-ink' src` = **44 occurrences in 24 files** (measured 2026-09-09). `src/components/ui/` holds fifteen primitives and none of them is the identifier, so two pages grew private ones with byte-identical bodies: `TableName` (`src/app/records/[table]/[id]/page.tsx:277`) and `ReviewItems` (`src/app/queues/[reviewItemId]/page.tsx:174`). The three bugs are BUG-0112, BUG-0120 ("the face BUG-0112 fixed one paragraph above") and BUG-0121 ("the face BUG-0120 fixed one route over") | **PROMOTED at 3, 2026-09-09** (architect, M2 structure walk) — §11's machine-identifier bullet now requires the shared primitive, not the class pair, and §3's `ui/` entry records the gap. This is Common violation 9 (a page helper hand-copied) in the form 9's own promotion did not cover: not a copied *component* but a copied *rule*, which no `wc -l` on declarations catches. DEBT-0011 builds it (milestone `patch`, behind BUG-0141 and DEBT-0008 — it rewrites 24 files, several of which they are writing), and its criterion 4 hangs the row-15 bidi isolation off the primitive, which is the second thing 44 call sites have nowhere to hold |
| 17 | **A pure function parked in `lib/db/**` because that is where its first caller was** | 2 | `isRecordId` / `canonicalRecordId` (`src/lib/db/records.ts:167`) — the app's ONE uuid grammar, no client, no env, no table name, and §4 rule 7 therefore forbids every pure domain leaf from importing it. It cost a workaround written into a ruling (the BUG-0141 History entry has to specify that `source_id` is canonicalised at the page and "handed INTO the leaf as an argument, because a pure domain leaf may not import `lib/db/**`"), and it cost the grammar's reach: five call sites import it and `/claims` is not one, so BUG-0140's defect — a registered id in an uppercased or hyphen-less spelling reading as "nothing matched" — still ships on `/claims?record_id=`, one route over from where it was fixed. Second instance: `narrowedTo` in `src/lib/db/runs.ts:198`, a pure `(string\|undefined) => string\|null` facet canonicaliser in a db module, which is also half of row 18 | **PROMOTED at 2, 2026-09-09** (architect, M2 structure walk) — the rule is §4 rule 7 read forwards instead of backwards: **a function that touches no client, no env and no table name belongs in the leaf layer, wherever its first caller happened to live.** A leaf that cannot import what it needs is the defect, not the leaf. Cited in the decomposition brief of every ticket adding an exported function to `src/lib/db/**`: if it takes no `SupabaseClient` and returns no `DbResult`, it is a leaf. DEBT-0009 moves the uuid grammar to `src/lib/records/id.ts` and takes `/claims` with it |
| 18 | **One exported identifier, two meanings — the narrowing vocabulary with no owner** | 3 | `narrowedTo` is exported twice with unrelated types: `src/components/ui/window-line.tsx:279` joins narrowing PHRASES into a scope sentence (and is re-exported from the `@/components/ui` barrel), `src/lib/db/runs.ts:198` canonicalises the `?source=` FACET for a query. Adjacent pages import different ones — `src/app/cycles/page.tsx:38` the db one, `src/app/claims/page.tsx:28` the ui one. `isNarrowed` is exported twice with two different definitions (`src/lib/claims/filters.ts:132`, `src/lib/review/queue-filters.ts:302`), and the second means two things by arity: with `within` it is "narrowed relative to this block's own scope" (BUG-0129/0131's question), with its default `within = {}` it collapses to the claims meaning — **and no production call site uses the default**; its only one-argument callers are `tests/offline/queues/filters.test.ts:85,102,143`, grading a meaning the app never asks | **PROMOTED at 3, 2026-09-09** (architect, M2 structure walk) — §11's "contract vocabulary is the app's vocabulary, in code as in copy" gets teeth: **no identifier is exported twice from `src/` with two meanings, and a predicate has one signature per question.** The narrowing vocabulary is the most-touched idea of M2 (nine bugs: 0109/0114/0118/0123/0124/0128/0129/0131/0133) and it is where a reader most needs one word to mean one thing. A default parameter kept alive by its tests is the mechanism row 15's ruling named — a shared predicate widened by whichever question broke last — one step earlier. DEBT-0010 carries it as a rename with a byte-for-byte criterion; no behaviour changes |
| 19 | **A read answering questions the URL did not ask** | 3 | BUG-0138 (`/claims` reads the whole claim population every request: ~14 sequential round trips, 2.9-3.8s warm); BUG-0139 (`/sources` reads runs once per registered source then waits for both gauges: ~9 round trips, 2.0-2.3s warm); `readPopulation` in `src/lib/db/review-items.ts:203-231` maps over all three `SHAPES` unconditionally, so `/queues?kind=signal` issues two counts for shapes it will not render (found at the M2 structure walk; bounded `head: true` counts in parallel, so 2 extra round trips, no wrong number — DEBT-0012, P3). **The third instance is RESOLVED, 2026-09-09** (DEBT-0012, landed `b7da394`): `readPopulation` now counts only the kinds `kindsNarrowedBy(filter)` names, and every other kind answers a third state `not_asked` — neither a refusal nor a zero. Measured `review_items` reads per URL: bare `/queues` 1; `?kind=decision` 4→2; `?kind=signal` / `?queue=entity_link` / `?shape=entity_link_source_pattern` 4→3; `?status=` / `?source_id=` / `?queue=data_conflict` / `?shape=data_conflict_fact` 4 (unchanged — both blocks have a zero to explain). BUG-0138 and BUG-0139 are the two that remain open, so the count stays 3 | **Count 3, note only — NOT promoted, deliberately.** The rule this would become ("read what the URL asked for") is one Ben has open decisions in front of: paging past the window on Claims and Browse through on-demand client fetching against a route handler, search, retention on `runs`, the `runs` row-cap horizon on `/sources`, and BUG-0138's own A/B (`observations.observed_at` through the `pending_claims` view). Writing a read-shape rule into the contract before those land would pin a shape the answers may not want; §4.3's complete-or-refuse contract is what governs until then. Recorded here so the count is not lost and so the next architect promotes it *after* the rulings, not before. **One caveat the resolved instance bought, for whoever writes that rule** (architect, 2026-09-09, amending DEBT-0012 criteria 1 and 5 after the builder measured them): “read what the URL asked for” is NOT “read only what the URL NAMES”. On `/queues` both blocks always render, so the load-bearing population is the EXCLUDED kind’s — its rows are all gone from the filtered read, which is the fact BUG-0133 rests on — while the NAMED kind’s count can never change a word (`isSurfaceNarrowed` ANDs fact 1 with fact 2, and fact 1 is false for a kind the URL narrows no further than it narrows itself: BUG-0129/0131). DEBT-0012’s criterion 1 was authored the other way round and its literal reading reddens 21 offline tests including BUG-0133’s own pin (`data-empty` `queue`→`narrowing`), independently re-measured on this tree by negating `kindsNarrowedBy`. The question a read must be scoped by is which surfaces CONSULT its answer, never which values the URL happens to spell |

| 20 | **A URL facet value whose rendered spelling is not the value the read used — one property of "a URL value inside a sentence this app wrote", per bug, seven bugs deep** | 7 | One family, one property each: BUG-0137 (no bidi in a key), BUG-0143 (a uuid in any spelling Postgres matches → `canonicalRecordId`), BUG-0145 (the padding a paste brought, by whitespace), BUG-0146 (the same padding by INK), BUG-0147 (`?cycle=` spelled through the allowlist), BUG-0153 (`?source=` the same), BUG-0155 (`?source=%20ticketmaster` narrows by `" ticketmaster"` and says, in the app's own words, "found no runs from ticketmaster at all" — over a source the same page draws five runs for one invisible character away, with nothing on the dropped-parameter line). Six of the seven are one value class getting one property; the seventh is the property no predicate can answer | **PROMOTED at 7, 2026-09-09** (architect, BUG-0155 ruling) — §7 gains "What is SHOWN is what was USED: one derivation per URL value class". Row 15 is the same family's OTHER half and stays as recorded: 15 is *may I spell it* (answered by an allowlist, once), 20 is *is this what I used* (answered by a derivation, once per value class). The class survived six fixes because the two questions were answered in different places and only one of them had a single home: `canonicalRecordId` was the uuid class's derivation from BUG-0143 on, and the free-text class never got one — its "derivation" was `sourceNarrowing`, four lines in `src/lib/db/runs.ts` that returned the value VERBATIM with a comment explaining why trimming would be wrong. BUG-0155 lands `canonicalUrlText` (`src/lib/url/text.ts`) as that home and retires `sourceNarrowing`, which also closes row 17's second instance (a pure function parked in `lib/db/**`) and the last half of row 18. Cited in the decomposition brief of every ticket that derives a value from a URL |
| 3 (re-count) | A list read with no `.range()`, no `.limit()` and no `.order()` | **0 new** | — | **The rule held.** M1 structure walk, 2026-09-03: every `.select(` in `src/lib/db/**` was traced. Fourteen chains a crude scan flagged are all either `.maybeSingle()` by primary key or by-id chunks bounded with `.limit(ids.length)`; every list read goes through `readComplete` / `readRows` with a total order and a bound. Count stays 1 (the original, fixed under TASK-0026). |

*(Rows 1–3 recorded by the architect at the 2026-09-02 ruling pass, from QA
findings on TASK-0001/0003/0006; rows 4–5 at the second pass the same day,
from measurement of the open tickets' own checks; row 6 at the third pass, from
the first live parity run against staging. The milestone structure walk owns
this table from here.)*

## History

- **2026-09-10, M3 ruling pass — the paging contract gets its client half, and
  two leaf directories join the list (architect).** **§4.3 kind 3** gains
  *full-or-exhausted, on both sides of the wire*: the route emits only
  full-and-continuing or short-and-exhausted, and the driver REFUSES anything
  else instead of reinterpreting it, so `held` leaves the bound grid only on
  the last page and the surface can never silently claim a set is complete
  (BUG-0168, found by QA on TASK-0064; the ruling and the door it closes are in
  DECISIONS.md, same date). **§4's leaf list** was two directories behind the
  executable rule it documents — `lib/order/**` (DEBT-0016) and `lib/paging/**`
  (TASK-0063) were in `LEAF_MODULES` and not here; `lib/cycles/**` already
  covered `lib/cycles/state.ts`. The doc now points at `LEAF_MODULES` as the
  executable copy, so the next reader amends both. **§10's one-owner bullet**
  now names the owner of the twice-exported-name guard (the `OWNER` map in
  `tests/offline/url/narrowing.test.ts`), which DEBT-0016's criteria got wrong
  and its builder had to rule around at the bench.

- **2026-09-10, M3 opening amendment — paging is legal, inside a frame
  (architect).** Three contracts amended before any M3 page diff, which is what
  M3.md EC3 grades: **§4.3** gains read kind 3, the paged window read, and
  supersedes *"Paging is not the answer to a cap and none is built"* in place
  (the superseded sentence is quoted where it stood, so the next reader sees
  what changed and when); **§4 rule 1** gains one framed exception — a named
  paging control may `fetch` this app's own route handler under
  `src/app/api/admin/**` and nothing else, as a two-line binding to a pure
  driver in `src/lib/paging/**`; **§5** records that paged-in rows are client
  state on purpose and that the first server-rendered screen is byte-identical
  to today's. Why now: SPEC F14 was added 2026-09-10 on Ben's ruling
  (DECISIONS, same date), and the contract as written forbade the feature the
  spec asks for. **What the amendment deliberately does NOT license:** fetching
  from components generally (the exception is one control on two named
  surfaces), a second Browse view, whole-table browsing, search, a raised
  `ROW_CAP`, or a page presented as a total. The boundary is: **the server
  decides the size, validates the bound and refuses out loud; the client
  decides only WHEN to ask.** Decomposed the same day into TASK-0062 (the concurrent second leg), TASK-0063…TASK-0069 (paging) and TASK-0070…TASK-0073 (windowed-figure honesty), chained by destination;
  a builder that finds any of this in its way files a blocked question and
  never re-interprets it.

- **2026-09-09, BUG-0155 ruling (architect).** **§7 gains a rule** — "What is
  SHOWN is what was USED: one derivation per URL value class" — and **Common
  violations gains row 20**, promoted at seven bugs (BUG-0137, 0143, 0145,
  0146, 0147, 0153, 0155). Why now: six fixes on this family each closed one
  property of a URL value inside an app-authored sentence, and the seventh
  defect is the property a *spelling* predicate cannot answer at all. The
  uuid class has had a single derivation since BUG-0143 (`canonicalRecordId`,
  which is why a padded `?cycle=` changes no page); the free-text class never
  had one, so `?source=%20ticketmaster` reached `.eq("source", " ticketmaster")`
  while every sentence naming it rendered `ticketmaster`. The rule names the
  home — `canonicalUrlText` in `src/lib/url/text.ts`, beside the allowlist it
  calls — and the invariant: the derived value is the only string that reaches
  the query, the facet box and the prose, or the facet is not applied and the
  shared dropped-parameter line says so. **Two decisions inside it, both
  made rather than left to the builder.** (1) The interior case
  (`?source=tic%20%20ketmaster`) is REFUSED, not boxed in `white-space: pre`:
  measured, QA's own pin collapses the rendered text before comparing it, so
  the box arm cannot pass, and the box would put a non-wrapping foreign run
  inside six authored sentences to preserve a spelling no registered source
  uses. (2) The ends-only ink-padding strip gets ONE declaration
  (`trimInkPadding`), called by `canonicalRecordId` and `canonicalUrlText`
  both — without that, the second derivation is a hand-copy of the first, which
  is row 9's class and how this family grew. `sourceNarrowing` is retired in
  the same move: it is row 17's named second instance (a pure function parked
  in `lib/db/**`) and the last half of row 18, and once its body is one call to
  the derivation it is a second name for one question. **§3's module map** now
  records what `lib/url/` holds (`narrowing.ts`, `spellable.ts`, and `text.ts`
  as the map's one forward entry) instead of `dropped-params.ts` alone. No
  other section changed; §4's leaf list already carries `lib/url/**`.
  BUG-0155 criteria amended and its milestone set to `patch` (P3, the same
  price and family as BUG-0152 and BUG-0154, both already `patch`; M2's tag is
  the verdict slice, and the bidi harm on this sentence is closed).
  DEBT-0014 set to `patch` and BUG-0155 chained behind it — both write the
  OWNER map in `tests/offline/url/narrowing.test.ts`, and consolidation-shaped
  work is serial at its destination.

- **2026-09-09, M2 structure walk (architect).** The `src/` tree walked
  against §3 and §4 on run/admin-window. **Amendments, each with its why:**
  §3's module map now records the five modules the tree holds and the map did
  not (`lib/verdict/decision.ts`, `lib/cycles/state.ts`,
  `lib/sources/names.ts`, `lib/db/verdict.ts`, `lib/gauges/index.ts`) plus the
  two non-component modules at the components root (`edit-cell-layout.ts`,
  `edit-refusal.ts`, shared by the edit surface's two widgets), marks
  `lib/url/` as the map's one forward entry (in flight under BUG-0141), and
  records that `ui/` has no identifier primitive. §4's leaf list gains
  `lib/cycles/**` and `lib/verdict/**`. **§4 rule 7 is widened by ruling, with
  no code churn**: a leaf may import a leaf and the leaf layer is a DAG. The
  diagram's `lib/<leaf>/** -> (nothing)` read as absolute while the tree has
  held `lib/format.ts -> lib/verdict/decision` and
  `lib/claims/filters.ts -> lib/verdict/decision` since M2 — and those edges
  are what this contract wants: `visibleContent` is the app's ONE definition
  of "is there anything here", and four M2 bugs (0089, 0095, 0127, 0136) are
  that question answered twice. Same precedent as row 1: the rule was
  over-broad, not the code, and the next reader must not "fix" the code to
  match the old wording. The invariant that matters — a leaf reaches nothing
  that can reach a database — is unchanged, no cycles at any depth including
  type-only imports, and a leaf another leaf imports states which question it
  owns. **§4.3 gains "An empty surface is explained from TWO facts, never
  one"** (row 14 promoted at 3) and **§11's machine-identifier bullet now
  requires the shared primitive** (row 16 promoted at 3). Ledger rows 17
  (a pure function parked in `lib/db/**`) and 18 (one identifier, two
  meanings) promoted at 2 and 3; row 19 (a read answering questions the URL
  did not ask) recorded at 3 and deliberately NOT promoted, because five of
  Ben's read-shape rulings are still open and a contract rule written now
  would pin a shape those answers may not want. Filed: DEBT-0008 through
  DEBT-0013. **One walk observation that is NOT a violation and got no
  ticket:** the evidence tables carry up to 7 columns (`recordColumn` …
  `payloadColumn`, `src/components/review/shape-views.tsx:525-532`) inside
  `DataTable`'s `overflow-x-auto`, so `observed` and `payload` fall off-screen
  with no affordance saying columns exist there. LOOK_AND_FEEL explicitly
  sanctions that scroll ("Tables that exceed their width scroll horizontally
  *inside their own border*; the page does not") and no bar requires a hint,
  so inventing one here would be the architect writing design. Routed to the
  designer's walk jurisdiction and recorded in the M2 milestone notes.

- **2026-09-09, BUG-0141 ruling (architect).** `/queues` **gains the
  `source_id` facet**; the dropped-parameter line alone was the cheaper answer
  and the wrong one — spec F5 says "a source links to its review items", and an
  anchor labelled `review items` that lands on every source's items with an
  apology beside it does not satisfy it. `review_items.source_id` is a real,
  populated column, so the narrowing is the shape three surfaces already carry:
  the field joins `ReviewItemFilter` and the app's one predicate, the query
  narrows with `.eq` like `queue`/`status` (so a table past `ROW_CAP` still
  answers completely), and the value is canonicalised ONCE at the page with
  `canonicalRecordId` — handed INTO the leaf as an argument, because a pure
  domain leaf may not import `lib/db/**` (§4 rule 7) and a second uuid grammar
  is what BUG-0139/0140 closed. Two facts the ruling pins so a lane cannot get
  them wrong: `narrowingOfKind` never carries a source (no kind implies one, so
  a source facet always counts as narrowing), and the POPULATION counts stay
  unnarrowed (that is what makes a source with no items read "nothing matched"
  rather than "this queue is empty" — BUG-0133). `source_id` gets no chip row:
  its vocabulary is unbounded data and `/queues` reads no registry, so the
  narrowing is stated instead by a scope element (`data-scope="source_id"`,
  spelling the CANONICALISED id, with a link back that drops it) — a narrowing
  visible only in the URL is a page claiming a population its read did not
  cover. **The dropped-parameter line comes too, and with one owner**: it is
  required anyway for `?source_id=not-a-uuid`, and copying it would be common
  violation 9 with four blocklist fixes (BUG-0123/0127/0136/0137) left behind,
  so the rule moves to the leaf `src/lib/url/dropped-params.ts` and the
  rendering to `src/components/ui/dropped-params.tsx`, with `lib/claims/filters.ts`
  re-exporting so `/claims`' markup, callers and tests do not move. Module map
  and the leaf set above amended in the same pass (they were also missing
  `lib/sources/**`). Ticket criteria and checks amended; the inherited checks
  were a defective gate — `npm test -- <offline path>` can never exit 0, because
  the script is two vitest project runs and the isolated one then finds no files
  (measured on the unmodified tree).

- **2026-09-09, BUG-0137 ruling (architect).** The Claims dropped-parameter line
  is fixed by a RULE, not by a fourth blocklist. **§7 gains it** and **Common
  violations gains row 15, promoted at 3**: text this app did not author never
  sits inside a sentence this app wrote — it comes through an allowlist, or it
  renders in its own box. The line now spells a key only from
  `^[A-Za-z0-9_.-]{1,64}$` (the class every facet name satisfies) and counts
  every other key through the `withheld` arm that already exists for the parked
  word, so the U+FE0F/U+034F/U+0301 0px name, the `in_win<U+034F>dow` bar-3 leak
  and the U+202E sentence reversal close together instead of one family per
  bug. The alternative — widening `INK_LESS` in `src/lib/verdict/decision.ts` to
  `\p{Mn}` — was rejected and the file removed from BUG-0137's touch scope: it
  is the app's one definition of blank for the EDIT surface ("did the operator
  type anything?"), where U+FE0F and U+2800 are content and a draft of them
  commits. One predicate, two questions, is how a shared definition gets widened
  by whichever question broke last. Ruled and measured against every fixture the
  three predecessor bugs pinned
  (`agenticflow/tracker/evidence/BUG-0137/rule-dryrun.mjs`, 2026-09-09): 42
  cases, every BUG-0123/0127 pin unchanged, three BUG-0136 assertions moving
  from named to counted (`記録`, U+2800, `record_id<U+200B>` — all now
  counted-not-spelled, with `.`/`-`/`_`/`0`/`record_id`/`bucket`/`in_windows`
  still named verbatim so the test keeps its non-vacuity), and QA's strict pin A
  widening by one field, because A (`{named: [], withheld: 0}` for a lone mark)
  and B (`{named: [], withheld: 1}` for the parked word plus a mark) are jointly
  satisfiable ONLY by a predicate that calls U+FE0F blank and U+2800 not — the
  fourth blocklist. Also ruled: **BUG-0139 dispatches before BUG-0137** (set to
  P1) — BUG-0138 is blocked on 0139 and inherits its read shape, so the perf
  chain idles behind anything dispatched ahead of it, while BUG-0137 blocks
  nothing. No `depends_on` edge between them: they share no file and a false
  edge outlives the cap of 1 that made the order matter.

- **2026-09-09, BUG-0135 ruling (architect).** No section of the contract changed; **Common violations gains row 14** — a composed read's helper leg refusing the whole read — at count 1, note only, because the rule it violates is already written three times over (§4.1, §4.3, and the landed `/claims` practice) and a fourth spelling would not have caught it. The ruling on `readReviewQueues` is a combination and both halves are required: **the surface takes shape B** (the population leg's refusal is reported as its own per-kind sub-surface inside the block, below the rows, on its own `data-surface`, exactly as `/claims` reports a source registry that would not read) and **the scope decision takes shape A** (population carried per kind as a `DbResult<number>`; on a refusal the block falls back to BUG-0131's structural `isNarrowed` and the sub-surface is what says so — a silent fallback would be a state derived from a read that did not happen, the class §4.3 exists to forbid). **And the leg becomes a COUNT read** (`readCount`, `head: true, count: "exact"`, one per shape, summed over `shapesOfKind`), so `ROW_CAP` cannot reach it at all: a figure no row depends on is never bought with a thousand rows, and the fallback above becomes the rare path rather than the permanent state of the page the day `review_items` outgrows the cap. The kind mapping keeps its ONE owner — the column conditions each `Shape` is defined by are declared in the pure `src/lib/review/shapes.ts` beside `shapeOf` and the `lib/db` module builds its queries FROM that declaration, because a queue value or a null-check spelled in `lib/db` would be a second definition of kindhood (§6, "no column carries it"). BUG-0133's rule is kept verbatim wherever the population IS readable, and its sibling pin — a truncated FILTERED leg still refuses whole — stays green. BUG-0135 set to M2.

- **2026-09-09, chip-inside-a-link promoted to a rule (architect, rulings batch 2).** BUG-0115 is the second instance of Common-violations row 13, so both halves the count-1 note promised landed together: **§7 gains the rule** (no anchor in any page's delivered markup contains a chip-filled span, with the card-shaped-link case spelled out — a badge classifying a `StatCard` with an `href` sits inside the shell and outside the anchor), and **the assertion goes into `tests/offline/ui/link-spelling.test.ts`**, the one owner of link spelling, as a rendered whole-window sweep over the shared `loadSurfaces()` harness rather than a source-text heuristic. Dry-run before it was written into criteria: the sweep returns 2 hits on `/` and 0 on the other seven routes today, so BUG-0115's fix is its red-to-green target and the guard cannot pass vacuously. Row 13 now reads count 2 with both examples. No other section changed.

- **2026-09-09, BUG-0110 reopen ruling (architect, rulings batch 2).** The Cycles-in-window sub-line names its excluded set by the property TRUE of every row in it — no end recorded — and never by an outcome verdict, because the excluded set (`duration.unmeasurable`) is a strict superset of the dead and the page pins one word per cycle state in `src/lib/cycles/state.ts` (`STATE_WORD`; BUG-0055, BUG-0074). The alternative shape — splitting running from died from unrecorded on the card — was rejected: it puts a second state vocabulary on a card the Look allows exactly one sub-line, duplicating the outcome panel three cards down. BUG-0110 criterion 4 was the defect QA bounced on (it demanded the excluded count EQUAL the `died` row, which is unsatisfiable with criterion 1 on any mixed window); it now binds the count to the duration note's, from the one field, and forbids the line from implying a verdict. BUG-0116 is closed as the duplicate it is; its strict pin is BUG-0110's red-to-green target. No section of this contract changed.

- **2026-09-09, BUG-0113 criteria ruling (architect).** No section of the contract changed; two things did. (1) **Common violations gains row 13** — a badge standing as the whole body of an anchor — recorded at count 1 and NOT promoted: the designer's ruling already put the rule in LOOK_AND_FEEL, and the row exists so the second instance reads as a class. (2) **BUG-0113 criterion 3 amended** (`ticket.py amend-criteria`): as inherited from BUG-0108 criterion 6 it forbade the fix it was attached to — dropping the chip removes its `inline-block` box and the buckets rows lose about 4px. It now binds the table's own density (cell padding 8/6, column set, order, alignment, no other cell moves) and explicitly permits the row box to shrink by the removed chip's vertical padding. Criteria 1, 2 and 4 and all three checks are unchanged; the red-to-green target stays the `expectLinkSpellingReachesTheGlyphs` pin.

- **2026-09-08, M2 contract answers (architect).** Ben answered both open
  questions and §12 is empty again. (1) **The admin voice** is the registered
  `sources` row `admin` (tier `admin`, lifecycle `active`, kind `registered`);
  staging has none, so the `settle_review_item` artifact carries the idempotent
  insert and Ben applies row and function in one paste — §9.2 fact 1 rewritten
  from a question into the answer, with the name spelled ONCE as `ADMIN_SOURCE`
  in the pure leaf and asserted from there by the artifact's own test. (2) **The
  editable columns** are events `title`/`description`/`poster_url`/`starts_at`
  and venues `name`/`city`/`country`/`address`; the CHECK-constrained three stay
  out; §9 gains the move-from-`display` rule (a column never stands in both
  halves of the one map) and the one-edit widening rule. (3) §9.2 gains the
  **parameter-name coupling** QA measured on TASK-0048: the artifact's test
  pins the SQL's argument name to `SETTLE_ARGUMENT`, because a drift makes an
  installed function read as permanently absent. Both marker strings are gone
  from this file, History included — that absence is what closes an ASK.

- **2026-09-08, M2 decomposition (architect).** Three amendments, all traceable
  to one human ruling and one read of the sibling's installed schema.
  (1) **§9's regimes are now `sandbox` / `resolver_owned`**, and `pre_cutover`
  is gone as an identifier and as a concept — Ben struck VISION's "groups/idols
  edit directly within it" on 2026-09-08 with the instruction not to
  re-implement it. `groups`/`idols` leave the map outright (first drafted this
  day as a third `read_only` regime; re-ruled the same day against it — with no
  door and no write, a uuid-only record page is a surface nobody can reach, and
  the reference-as-link mechanism stands on `events.venue_id`), so the teeth
  move from the type to a structural pin: the only table whose write path is
  `direct` is `walk_sandbox`;
  `walk_sandbox` becomes `sandbox`, which is the door §9.1 item 5 explicitly
  left open and which also pays off the "goes to the catalog" inaccuracy that
  section was carrying. (2) **§9.2 is new**: the override path, the eight action
  names (ruled here because no contract spells them and two builders may not
  each invent one), the decision envelope as a pure leaf, what the envelope may
  NOT carry because the database already knows it, the two installed-schema
  facts that decide the override's shape (the gate's KS007 source refusal; a
  reference is observed as a `ref` and resolved through `confirmed_matches`),
  and the ruling that a surface reads the presence of the `verdicts` TABLE
  rather than probing a function PostgREST cannot introspect. (3) **§12 is no
  longer empty**: the edit-allowlist question and the admin-source question,
  both blocked for Ben, the first now framed as a closed candidate list read
  from the registry rather than an open invitation. (Their two marker strings
  were removed from this History line on 2026-09-08 when the questions closed:
  each ASK's structural check is its marker's absence from this FILE, so a
  mention here would have held the question open.) Common violations gains row
  12, promoted at count 1 because a human ruling closed the class, and §13 gains
  rules 8 and 9.
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
