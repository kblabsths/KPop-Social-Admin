# DECISIONS — architectural choices that close a door

Append-only. One dated paragraph per decision, newest at the bottom.

## 2026-09-01 — Vitest is the test runner, and there is no browser dependency

The repo had no test framework. Vitest, with `vite-tsconfig-paths`, is one of
the four runners Next.js documents itself and needs one config file for a
TS/ESM App Router app; Jest would need `next/jest` plus transform and ESM
mediation for the same result. The door this closes: we do **not** adopt jsdom,
Testing Library, Cypress or Playwright as product dependencies. Page behavior
is proven by rendering the page function to markup with `react-dom/server`
(already a dependency) and, where only a real server can prove it, by starting
the built app and issuing HTTP requests. Browser screenshots stay the walk
agent's kit-owned Playwright. Cost accepted: no component-level DOM testing,
and no user-event simulation — interaction quality is judged at the walk.

## 2026-09-01 — Every data-layer read returns `DbResult`, and absence is a code, not an exception

`lib/db/**` functions return `{kind:"ok"|"not_provisioned"|"error"}` and never
throw. Acceptance test 9 ("against a database lacking the resolver tables,
every page renders its not-provisioned state; nothing throws") is then
structural rather than a per-page discipline, and the ground rule "every push
to main must leave the app deployable against whatever project the service
targets" holds by construction. Not-provisioned is decided by PostgREST /
Postgres error code (`PGRST205`, `PGRST204`, `42P01`, `42703`) in one helper.
The door this closes: no try/catch-per-page, no exception-based control flow
across the data boundary, and no page that renders a zero where a table is
missing.

## 2026-09-01 — One async boundary per route: the page function

A route's page function is the only `async` component; every component below it
is synchronous and takes plain props. This is what lets a test render a real
page with `renderToStaticMarkup(await Page(props))` — Next's own docs say
Vitest cannot render async server components, so a nested async component would
have forced a browser dependency on the campaign. The door this closes: no
async child components, no per-component data fetching, no streaming/Suspense
data waterfalls inside a page. Cost accepted: a page that needs six reads does
them in its own function.

## 2026-09-01 — Gauges aggregate in TypeScript, never in SQL

Spec §5 requires six gauges as "server-side read-only queries in this app,
never tables and never database views", and the acceptance doc forbids building
a SQL-executing route. PostgREST cannot aggregate beyond `count`, so each gauge
fetches a bounded, time-windowed row set and aggregates in a pure TypeScript
function. The door this closes: no RPC, no database view, no direct Postgres
connection, and therefore no percentile computed by the database. Cost
accepted: an explicit `limit` on every gauge query, and a re-think (one
function each) if the catalog outgrows the fetch.

## 2026-09-01 — The scraper repo is treated as read-only for this campaign

`run.yaml` declares `sibling_dirs` `write_by_size`, but the scraper repo's
`agenticflow/tracker/RUNNING` exists — a campaign is running there — and both
the kit's policy and spec §10 say everything is a handoff while that is true.
For M1 the scraper repo is read-only: no ticket's touch scope may name a
scraper path, and any change needed there is a blocked handoff ticket carrying
the complete artifact. The door this closes: no "small" grant or registry edit
lands there autonomously during this campaign, and no Admin-side workaround
code is written to dodge one.

## 2026-09-02 — Offline tests stay `.ts` with `createElement`; the glob does not change

TASK-0004's builder asked whether `tests/suite-globs.ts` should admit `.tsx` so
UI tests can use JSX. Ruling: **no** — the glob stays
`tests/offline/**/*.test.ts` and component tests build elements with
`createElement`. Three reasons. (1) The pattern is already landed and proven by
two test files, with a shared helper — `tests/offline/ui/markup.ts` exports
`h` (aliased `createElement`), `render` (`renderToStaticMarkup`), plus
`classesOf`, `tagsOf`, `textOf`. Every later UI ticket imports that helper
rather than rolling its own; a render helper copied per test directory is the
scope sprawl the shared-helper rule exists to prevent. (2) These tests assert
*emitted markup* — token classes, tag order — not a JSX tree, so JSX buys
readability on the setup lines only. (3) `tests/suite-globs.ts` is a
consolidation-shaped destination: it is imported by `vitest.config.mts` and
asserted by `tests/offline/toolchain.test.ts`, and it is pinned by TASK-0001's
checks. Changing it mid-M1 would leave two competing idioms in one suite for
the rest of the milestone. The door this closes: no JSX in the offline suite,
no jsdom, no testing-library dependency. Cost accepted: nested component setup
is wordier; `h` keeps it to one character of noise per node. Revisit at M2 only
if a ticket needs a genuinely deep tree.

## 2026-09-02 — A ticket that deletes a route must clear `.next` before `tsc`

`tsconfig.json` includes `.next/types/**/*.ts` and `.next/dev/types/**/*.ts`
(Next 16 generates one route-type module per page). Those files are build
output, not source: when a ticket deletes or renames a route, a `.next` left
over from an earlier build in the same worktree still contains a type module
importing the deleted page, and `tsc --noEmit` fails on code that no longer
exists. That is the whole of BUG-0008 (CI red today) — environmental, not a
defect in the landed tree. Rule for every ticket whose diff removes or renames
a file under `src/app/`: run `rm -rf .next` (or a full `npm run build`, which
regenerates the types) **before** `tsc --noEmit` in its landing path; a check
block that lists `tsc` above `npm run build` is ordered wrong for such a
ticket. **Recommendation to the dispatcher (run.yaml is not mine to edit):**
`ci_command` should become
`bash -c 'rm -rf .next && npm run lint && ./node_modules/.bin/tsc --noEmit && npm test'`.
`rm -rf .next` is preferred over inserting `npm run build` — it costs
milliseconds instead of a full compile, it is deterministic (the glob then
matches nothing), and `.next` is gitignored build output that `npm run build`
and `npm run test:http` regenerate on demand. The door this closes: CI never
again reds on stale generated route types, and no one "fixes" it by dropping
`.next/types` from `tsconfig.json`, which is what gives pages their typed
route params.

## 2026-09-02 — Pure domain leaves sit below `lib/db`, and never import it back

QA found on TASK-0006 that `src/lib/db/review-items.ts` imports
`src/lib/review/shapes.ts` — the reverse of ARCHITECTURE §4's arrow. The code
was right and the diagram was wrong: `shapes.ts` has zero imports, no cycle is
constructible, and TASK-0006's own two-module contract (a pure domain module
plus its reads) required exactly that split. §4 now seats the pure domain
leaves — `lib/review/**`, `lib/format.ts`, `lib/edit/config.ts`, and
`lib/browse/**` when it lands — at the bottom of the app, below `lib/db/**`. A
leaf imports nothing that can reach a database. The door this closes: a leaf
may never import `lib/db/**` *back*, **not even with `import type`**. A
type-only edge erases at runtime, so it cannot deadlock anything today — but it
writes a directory-level cycle into the contract the human reviews instead of
reading code, and the day someone widens it to a value import there is nothing
to catch it. A row type both sides need is declared in the leaf, which is what
`ReviewItemRow` already does. Cost accepted: `lib/db` cannot hand a domain
module one of its own internal types; if it wants to, the type was domain
vocabulary all along and belongs in the leaf. `lib/gauges/**` is deliberately
NOT a leaf — a gauge fetches its own bounded window through `lib/db/**`, which
is the arrow as drawn and what TASK-0007 landed.

## 2026-09-02 — A complete read returns the whole matching set or refuses; it never truncates

PostgREST caps responses at `db-max-rows` (Supabase default 1000) and says
nothing about it, so a select with no `.range()`, `.limit()` or `.order()`
returns an arbitrary subset in unspecified order. QA found exactly that in
`src/lib/db/review-items.ts`: `readReviewAttention`'s open count and oldest age
would have been *wrong* rather than *refused*. ARCHITECTURE §4.3 now splits
reads in two. A **complete read** (`readComplete`) asks for `{ count: "exact" }`
with a total order and an explicit range, and returns `kind: "error"` — naming
the object, the exact count and the cap — whenever the count exceeds the rows
returned; so an `ok` array is the whole matching set, always. A **window read**
(`readRows`, unchanged) is §8's gauge contract: a named, bounded, ordered
window whose card says which window it shows. Same rule, one level down: a
helper never substitutes a number the database did not give — `readCount`'s
`count ?? 0` is BUG-0007 on the user-visible path and becomes a refusal. The
doors this closes: **no paging or infinite scroll is built in this app** (there
is never a partial page to continue, and nothing in the spec asks), no surface
carries a "was that all of it?" flag, no figure is ever derived from a possibly
truncated set, and the cap is a single named constant rather than a number
sprinkled through eight modules. Cost accepted: a table that outgrows
`ROW_CAP` takes its page to an error state instead of showing "the first
1000" — which is the point; raising the cap is then a decision with the real
count in front of it.

## 2026-09-02 — The http suite ENFORCES "no database" with sentinel credentials, because deleting names does not work

`tests/http/server-harness.ts` deleted every `*SUPABASE*` name from the child
env and claimed that "dropping the names is what proves it rather than asserts
it". Measured on this tree: `next start` then calls `@next/env`'s
`loadEnvConfig` on the repo root and restores `SUPABASE_URL` and
`SUPABASE_ANON_KEY` straight out of `.env`. It has been harmless only because
one developer's untracked `.env` happens to carry no service-role key — and
TASK-0017 is about to add an http test that PATCHes a write route, which on a
machine with that key would exercise production with RLS bypassed. Also
measured: `@next/env` fills absent names but does not override present ones.
So the harness sets **sentinels** — a URL on a closed local port and a
self-describing non-credential literal — for the two names `lib/db/client.ts`
reads, and an offline test proves they survive the reload in a child process.
The door this closes: the http suite may never acquire a database, not by
configuration and not by accident, and "no database" stops being a claim in a
docstring. Consequence accepted and wanted: a DB-reading route under the http
suite now renders its **error** state (the connection is refused) rather than
never being asked — the suite proves the app survives without a database
instead of assuming it never looked.

## 2026-09-02 — `tsconfig.json` excludes `agenticflow/`: factory artefacts are not product source

`include` is `**/*.ts` / `**/*.tsx` and `exclude` was only
`node_modules`/`scripts`. TypeScript's wildcards skip dot-directories, so
`agenticflow/.worktrees/**` and `agenticflow/.venv-tools/**` were already out —
but `agenticflow/tracker/evidence/**` was not, and that is precisely where the
kit tells every role to write anything a ticket or receipt cites. Measured: one
ill-typed `.ts` file there takes `tsc --noEmit` to exit 2, in somebody else's
receipt, on a file their ticket does not name. Adding `"agenticflow"` to
`exclude` fixes it with no loss — `tsc --listFilesOnly` compiles the identical
65 files under `src/` and `tests/` either way. The door this closes: the
alternative fixes are refused. `include` keeps `**/*.ts`, and nobody narrows it
to `src`/`tests`, because it also carries `.next/types/**/*.ts` and
`.next/dev/types/**/*.ts` (typed route params — DECISIONS 2026-09-02 above),
`next-env.d.ts`, `**/*.mts` and the root config files; and no agent-hygiene
rule is written telling roles not to put TypeScript in their evidence
directory, because the repo's type gate reacting to the factory's own
scratch space is the defect, not the scratch space.

## 2026-09-02 — `shapeOf` stays total, defaulting to `data_conflict_fact`; the trigger to revisit is a migration

`lib/review/shapes.ts` branches on `queue === "entity_link"` and falls through
to `data_conflict_fact`, so an unrecognised queue value would render as a
decision. Today the branch is unreachable: migration `20260901000002`
constrains `review_items.queue` to exactly those two values. The decision is to
leave it total and record the trigger (ARCHITECTURE §6 trap 11) rather than
ticket it. The doors this closes: `shapeOf` does not grow a throw, does not
return `null`, and does not acquire an `unknown` shape — every one of those
would put an exception path into every caller for a case the database cannot
produce, and spec §6 explicitly calls the shape set "an open set that moves
with the queues". The obligation this creates instead: the migration that
widens that CHECK constraint extends `Shape`, `SHAPES`, `KIND_BY_SHAPE` and
`shapeOf` together — the compiler forces the first three, and `shapeOf` is the
only one that can go quietly wrong.

## 2026-09-02 — an error result carries `reading`, and its message is the client's whole account, not its `message` field

`DbResult`'s error arm is `{ kind: "error"; reading: string; message: string }`.
`reading` is the object the query asked for, from `tables.ts` — the same string
`not_provisioned` carries in `missing` — because a page can make several reads
(Browse makes four, reported separately on purpose) and a line that says only
what failed names none of them. The `kind` values are unchanged; the field is
additive, and `readComplete`/`readCount` stopped spelling the object into their
own refusal prose now that every error arm carries it in one place.

The message is composed from `message`, `details`, `hint`, `cause` and then
`code`, in that fixed order, with any part another part already contains
dropped. Measured against the http harness's sentinel URL on 2026-09-02:
supabase-js returns `message: "TypeError: fetch failed"`, `hint: ""`,
`code: ""`, and the only account of what actually happened — "Caused by: Error:
bad port" — in `details`. Reading `message` alone shipped the generic wrapper
that the Feel's error principle forbids.

The doors this closes. **Classification does not read the composed account**:
`classify` mines the raw `message` field for the column an absence names, so a
`details` payload quoting some other identifier can never become the missing
column and an absent object stays gray. **An empty string is not a code**: the
transport failure's `code: ""` is neither an absence code nor something to
print. **The account is scrubbed of credential shapes before it can reach a
screen** — a JWT, an `sb_secret_*`, a named key in a query string, a `Bearer`
header and a DSN password between the colon and the `@` (the one a
`NAME=value` rule misses). The host of an unreachable database is NOT redacted:
it is the client's own account of what it could not reach, and it is what tells
an operator whether to look at the network or the query.

## 2026-09-02 — a 404 this app means is ROUTED, never thrown from a dynamic segment; and the auth gate is never handed a handler

`/records/<unmapped-table>/<id>` answers with the app's own framed 404 through
a `beforeFiles` rewrite in `next.config.ts` to a path no route matches, not
through `notFound()` in the page. The measurement is in that file: on Next
16.2.2 the 404 status and a server-rendered document are inseparable *in
render* — `notFound()`'s status is set in the same `catch` that emits
`<html id="__next_error__">` (`app-render.js:1894-1918`), and adding a
`not-found.tsx` beside the page changes nothing (still the error shell, len
8820; rendering the not-found component inline instead gives the whole framed
document, len 10933, but status 200). A 404 the router decides is already on
the response before rendering starts, so the not-found tree renders through
the root layout, which is why an unmatched URL like `/analytics` has always
looked right.

The doors this closes. **The rewrite is `/records`-specific and is not
inherited**: a new dynamic route that calls `notFound()` gets the client-only
error shell unless it either resolves every URL its segment matches or gets
its own rewrite — that is now §5 of ARCHITECTURE, and it is the question to
answer *before* writing the page, not after a walk. **`next.config.ts` may
import the pure leaf and nothing else**: it derives the table list from
`EDITABLE_TABLES`, so adding a table to `EDIT_CONFIG` remains the only edit
that surface needs, and in exchange `src/lib/edit/config.ts` must keep
importing nothing at all (Next compiles the config outside the app's module
graph, with no `@/` alias). **The rewrite claims deliberately less than the
page refuses**: a percent-encoded segment is excluded, because Next decodes a
dynamic segment before the page reads it and claiming `%` would 404 a URL that
works. Never breaking a working URL outranks covering an exotic spelling of a
broken one.

And, from the same surface: the gate stays `export { auth as middleware }`.
Passing a handler to `auth()` puts it in `handleAuth`'s
`else if (userMiddlewareOrRoute)` branch, which precedes
`else if (!authorized)` (`node_modules/next-auth/lib/index.js:148-156`) — so
the sign-in redirect never runs and every route is open. Any need for logic at
the gate is a ticket, not an inline wrapper.

## 2026-09-02 — the four data-surface states are a TYPED contract: the read is named, the eyebrow survives, and a rows surface has no headers-only rendering

Three rulings on `components/ui` + `components/gauges`, all in one direction:
what the operator must be told is carried by a required prop, not by a caller
remembering. (1) `ErrorLine`'s `reading` becomes **required**, as does
`reading` on `GaugeState`'s error arm. `DbResult`'s error arm has carried the
string since BUG-0016, so no caller pays anything — but an optional prop is a
rule TypeScript cannot enforce, and BUG-0016 was found in a page that had
already shipped the anonymous line. (2) `Empty` and `NotProvisioned` gain an
optional `micro` eyebrow, and the three gauge components **always** pass their
own label: those two states replace the whole card, so without it a screen of
unprovisioned gauges names the missing tables but not the knobs they tune. It
stays optional on the primitive because a page renders them under a `Section`
heading that already names the surface — and there is no forgettable caller on
the gauge path, where the label is passed from a prop the component already
requires. (3) `TrendTable` and `Distribution` take a **required**
`empty: { holds, filledBy }`, and render it themselves when there are no rows
and no other state: the component owns *when*, the caller owns *the words*.

The doors this close. No `ErrorLine` without a named read, anywhere, ever
again. No gauge state card that cannot be identified. And **no headers-only,
body-less table** — the rendering that told the operator nothing at all is
now unreachable rather than discouraged; `rows: []` with no state cannot be
written. Cost accepted: four page tickets code against the final signatures
(TASK-0030 lands first), and every future trend or distribution must say what
its series holds and what fills it before it may render — which is
LOOK_AND_FEEL Voice bar 4 restated as a type.
