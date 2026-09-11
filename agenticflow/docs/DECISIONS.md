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

## 2026-09-02 — the app reads `SUPABASE_*`, the live suite reads `STAGING_*`, and parity stays two PostgREST paths

Ben's answer to the env ASK (admin-window/TASK-0021): `.env` now carries the
four `STAGING_SUPABASE_*` names; the deployed Railway service keeps reading
`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`, so `src/lib/db/client.ts` is
unchanged and no `STAGING_` name appears under `src/`. `SERVICES.md` declares
the staging project ref, and the live guard passes against it.

The half left to the architect was `STAGING_SUPABASE_DB_URL`: it exists as a
name, so acceptance test 2's "direct SQL on staging" is now buildable — does
it get a pg-driver DEP? **No. Parity stays two PostgREST paths.** What §10
requires is two *independently written* paths to one number, not two
*transports*: `tests/live/parity.ts` already hands each test its own client
(`independentClient()`) and refuses to let it ask `lib/db` for the expected
value, so the page's path and the test's path share nothing but the database.
A pg driver would buy a second credential shape in the live suite — a DSN with
an embedded password, the exact shape `lib/db/result.ts`'s redactor had to be
taught to scrub — plus a supply-gate DEP, a connection-pooling question, and a
transport with different timeout and role semantics from the one the app
actually uses. Parity proven over a transport the app never speaks proves less,
not more. The doors this closes: **no `pg` / `postgres.js` dependency in this
repo**, no direct-Postgres connection from product code or tests, and
`STAGING_SUPABASE_DB_URL` stays a name nothing in `src/` or `tests/` reads.
What direct SQL would genuinely buy — `EXPLAIN ANALYZE`, and aggregates
PostgREST cannot express — is the scraper repo's to run: it owns the schema, it
pushes the migrations, and it already has a SQL prompt. So the need is real and
it lives on the far side of the handoff, which is exactly where the
`pending_claims` diagnosis went.

## 2026-09-02 — live tests may write `groups` / `idols` and nothing else; and M1's decision-queue parity is vacuous

Ben's answer to the fixtures ASK (admin-window/TASK-0022), with QA's staging
census beside it. The resolver migrations ARE applied to staging and the tables
are populated (`observations` 2567, `field_provenance` 1705, `resolution_runs`
28, `sources` 4, `groups` 1759, `idols` 7234), so parity is not comparing 0 to
0 across the board. **Live tests may write and sweep `groups`/`idols`** — the
pre-cutover tables Admin already edits directly: one field of an existing row,
prior value restored in a `finally`, residue scanned after. **Resolver-owned
tables are never written by an Admin test** (`events`, `venues`,
`review_items`, `observations`, `field_provenance`); a fixture population that
would need one is reported as a gap, never inserted. The door this closes: this
campaign builds no fixture-seeding harness for the resolver domain, and no
"just for the test" row ever enters the ledger Admin exists to observe.

Recorded with it, because it changes what a green live run MEANS: staging holds
exactly **one** `review_item` — an `entity_link` signal — so `data_conflict` is
0 and **every decision-side live assertion in M1 compares 0 to 0**. That is a
fact of the run, not a defect in Admin: a decision item appears when the
resolver escalates a real conflict, which is the scraper campaign's work. So
M1's live parity for decision items is **vacuous and is to be described that
way** on FEAT-0004, TASK-0010 and TASK-0011 rather than counted as coverage;
the decision-side behavior is proven offline, against fixtures, and stays
proven there until staging grows a conflict. A ticket may not close a gap by
pointing at a 0-to-0 comparison.

## 2026-09-02 — a live oracle names the page's state kind before it compares a number, and `error` is always a failure

The first staging parity run graded three pages wrong in two directions:
`/queues` and `/sources` FAILED on an honest empty page (their oracles read
"no rows rendered" as "the table is not provisioned"), and `/claims` PASSED
four of six assertions on a page in its **error** state, because the fallback
branch only asked that the markup contain the string `pending_claims` — which
the red error line satisfies exactly as well as the gray not-provisioned card.
Four of six passes were therefore vacuous while the page was broken. The rule
is now ARCHITECTURE §10: a live test derives the kind it expects from its own
independent count, asserts the rendered kind (`ok` / `empty` /
`not_provisioned` / `error`) structurally, compares numbers in `ok`, treats
`empty` as a pass **with a stated 0**, accepts `not_provisioned` only when its
own read of that object returns the absence code, and treats `error` as a
FAIL naming the read.

The doors this closes. **No two-way live oracle** — "rows or not-provisioned"
is banned; four kinds, four branches. **The kind is read structurally, never
from prose**: `Empty` and `NotProvisioned` render the same container and differ
only in their words today, so the four `ui` state primitives carry a
`data-state` attribute and the oracle reads that — which also keeps live tests
out of the string-pinning business the campaign forbids elsewhere. **A parity
helper never reports a failure it could not parse**: a `head: true` count
carries no body, so supabase-js hands back `code=undefined, msg=""` on a real
57014 — the helper issues a GET-shaped count or says it could not tell. Cost
accepted: three live test files and one primitive set change; in exchange a
live suite can no longer be green while the page it grades is broken.

## 2026-09-02 — a counted zero is a real figure: an empty queue keeps its open count

`/queues` with an empty decision queue rendered the Empty card and **no open
figure at all**, while the Dashboard in the same state rendered a real `0`.
Ruling: the Dashboard is right and Queues is the defect. LOOK_AND_FEEL bar 1
says Queues shows "the open count of each queue" above the fold, and the
repeat-use bar says "counts sit in fixed positions" — a figure that disappears
when it reaches zero is a figure that moves, and an operator scanning for the
number cannot tell a quiet morning from a broken page. The Feel's emptiness
rule is not in tension with this: "an empty bucket, a table with no rows, and
an unprovisioned table are three different states and never share a rendering"
is about the ROWS region, where the Empty card is exactly right and stays. So
both render — the labelled figure reads `0`, the rows region explains what
fills it. The door this closes: **a counted zero is data and is always shown**;
only `not_provisioned` may render no number, because there the zero would be a
lie about a table that is not there. Anywhere the two could be confused, the
gray card and the absent figure are what distinguish them.

## 2026-09-02 — `pending_claims` is unreadable on staging: the fix is the scraper repo's, and Admin writes no workaround

Measured by the architect against staging, read-only, eight shapes (evidence
`agenticflow/tracker/evidence/architect/claims-probe*.tsv`): every read of the
view except an unordered, unfiltered `limit 1` hits the 8s statement timeout
with `57014` — including `limit 2`, `limit 1` with an `order`, a narrowed
select, an `.in("observation_id", …)` over ten known ids, a `head:true` exact
count, and a per-bucket count. So the cost is the view's, not the read shape's,
and **there is no honest Admin-side mitigation to build**: no narrower select,
no per-bucket count, no id-restricted read completes. `/claims` and the Sources
awaiting-row gauge render their error state, which is the correct rendering of
a database that will not answer, and they stay that way until the scraper repo
ships an index or a view rewrite (a handoff — a campaign is running there).

The doors this closes. **No workaround code**, per spec §10 and the campaign's
freeze: not a cache, not a swallowed timeout, not a surface quietly hidden
because it is red. **Admin never re-computes the classification** from
`observations` + `field_provenance` + `review_items`: that would put a second
copy of the resolver's precedence rules in this repo, and the bucket of a claim
is the ledger's answer or it is nothing. **Raising the statement timeout is not
the fix either** — an honest read that takes 30 seconds is still a broken page,
and the timeout is the only thing currently telling us the view is quadratic.

## 2026-09-02 — three taste rulings from Ben: the M1 dial line, the pre-cutover provenance line, and the shape of the window

Three small answers, recorded because each closes a door. (1) **The per-source
stuck-pattern threshold line stays absent in M1**, with the reason stated on
screen; the dial lives only in scraper registry YAML and hand-copying it is
forbidden (spec §10). Ben's principle, which is an ecosystem design-queue item
and not campaign work: a dial-able value must not live in a YAML file — dials
belong in rows. So Admin does not read that YAML, now or later; when the dial
becomes a row, the gauge reads the row. (2) **The provenance slot on a
pre-cutover table reads "no provenance recorded (pre-cutover table)"** — the
landed rendering is confirmed, not an empty slot: absence with its reason
beats a blank. (3) **The window is desktop-only and keeps both light and dark
modes.** No phone bar, no mobile breakpoint work, and no single-theme
simplification — for the designer's endgame doc pass, not a ticket. The door
this closes: no responsive/phone layout work is in scope for this campaign, and
neither theme may be dropped to make a screen easier.

## 2026-09-02 — the adapter-runs half of Cycles shows nine of the `runs` table's 22 columns, and honours `?source=`

Ben's ruling on the campaign's open runs question (TASK-0023, the last contract
silence about a table this window renders). `/cycles`' adapter-runs half shows
exactly: `source`, `started_at`, `ended_at` (a row with none is legible as
still running), `outcome`, the error line (`error_summary`, inline and
verbatim), `records_parsed`, `claims_emitted`, `records_unlinked`,
`failure_class`. Nothing else of the 22 in M1. That half also honours
`?source=<name>` — the Sources page's seam, which the Cycles page silently
ignored because `resolution_runs` carries no source at all; the facet narrows
the runs half only, matched **by name**, because `runs.source` is text with no
foreign key (deliberately — ARCHITECTURE §6 trap 6).

Why this set. `source`/when/`outcome` answer "did anything happen last night";
`failure_class` (`transient | structural | config`) is the one column that says
whose problem a failure is; parsed-vs-emitted is the yield; `records_unlinked`
is the number that feeds the entity-link queue this app exists to render. The
first five are exactly the shape the Dashboard already reads and renders on `/`
(`DashboardRunRow` in `src/lib/db/dashboard.ts`) — `/cycles` reuses that read's
shape and adds the four counts plus `failure_class` rather than inventing a
second row type.

The doors this closes. **The other thirteen columns are out of scope for M1** —
`checkpoint_before/after`, `payloads_fetched`, `payloads_archived`,
`records_rejected`, `claims_dropped_empty`, `claims_collapsed`, `claims_ai`,
`records_linked`, `records_escalated`, `batches_written`,
`observations_returned` are adapter-internal and belong to a run-detail view
that has no consumer; a ticket wanting one of them re-opens this decision, it
does not just add a column. **The runs read stays a WINDOW read** (§4.3): every
number rendered is a column of the row it sits in, never a count over the set,
so a bounded newest-first window is honest — and no total ("how many runs
failed last night") may be computed from `rows.length`. **`runs.source` is never
resolved to a `sources` row by key**: no FK exists, so the facet and any
source-linked navigation match on the name string, and a name with no matching
source row is still a run that renders.

## 2026-09-02 — Structural guards over the source tree parse with `typescript`, never with a hand-rolled tokenizer

The offline suites hold several rules that read `src/` as TEXT and assert
something structural about it: the credential scanner
(`tests/offline/db/layering.test.ts`), the M2-close guard
(`tests/offline/review/one-place.test.ts`), and the `admin_locked` write guard
(`tests/offline/edit/config.test.ts`). Line-wise, comment-stripped reading —
`codeLines` / `filesWhereCodeMatches` — is fine for a rule whose question is
"does this NAME appear on a code line". BUG-0030 established, over three QA
bounces, that it is not fine for a rule whose question needs a BOUNDARY: "where
does this call's argument end", "is this backtick a template or text", "is this
`/` division or a regex". Each of the three fixes to the bespoke tokenizer
closed one grammar fact and opened the next, and the third one — a backtick
inside a regex literal after `=>`, read as division — silently erased a real
forbidden write between two backticks. That failure direction is the one the
guard exists to exclude.

The ruling: **a guard that needs a syntactic boundary uses TypeScript's own
parser** — `ts.createSourceFile` plus an AST walk — and a guard that only needs
a name may keep the cheap line-wise read. `typescript` ^5 is already a
devDependency here (`tsc --noEmit` is the CI check), so this adds nothing to the
supply chain; the parser resolves from `tests/`, handles strings, comments,
templates, interpolations and regex literals by construction, and reduces the
guard to ~45 lines of API calls with no bespoke lexing left in it.

The doors this closes. **No new hand-rolled lexer, tokenizer or
"string-aware regex" may be written into a test guard in this repo** — a rule
that cannot be expressed against `codeLines` is a rule that parses. **A parse
error is a REPORT, not a skip**: a file a structural guard cannot see into is a
file it may not stay silent about, so the guard over-reports it; the permitted
failure direction of every such guard is over-reporting, never a miss.
**Anything the AST walk cannot decompose falls back to the node's source text**,
which is the same over-report direction, rather than to a cleverer heuristic.
And **the pre-decided escape hatch is deletion, not a fourth patch**: if the
parser route is ever found wrong in the same class, the guard is dropped down to
its cheap line-wise pin and the gap recorded as a residual — a structural guard
is worth at most one re-tooling.

## 2026-09-02 — A ticket's bar is what its own repo can decide; an external handoff gets its own gate

TASK-0032 built the live-oracle rule (a page's state kind is read structurally
and an ERROR page may never pass). It met every criterion but one: criterion 6
asked the `queues` **and** `sources` live tests to pass against staging, and
`/sources` reads `public.pending_claims` for its awaiting-row trend
(`src/lib/gauges/pending-claims.ts`) — a view that times out on staging in every
shape but an unordered `limit 1` (`57014`, eight shapes measured; TASK-0031).
Rule 6 therefore fails that surface, correctly. The ticket forbids weakening the
oracle, TASK-0031 forbids any Admin-side mitigation, and the fix is a migration
in the sibling scraper repo that only Ben can apply. So the gate was red and no
agent in this repo was permitted to clear it.

The ruling: **criterion 6 is narrowed to the seven live oracle surfaces whose
reads do not touch `pending_claims`** (queues, dashboard, cycles, runs, browse,
review-item, harness — measured 38/38 green), and Claims/Sources parity moves
onto TASK-0031's own close bar, where the blocking fact already lives. The red
itself becomes a *requirement*: `claims.live.test.ts` and `sources.live.test.ts`
stay red, unskipped, un-todo-ed, citing TASK-0031, pinned by two mechanical
checks — so weakening the oracle to buy green is now a red receipt rather than a
prose ban.

The doors this closes. **A ticket's acceptance criteria may only assert facts
the campaign is allowed to change.** A criterion whose green depends on a human
applying an artifact in another repo is not that ticket's bar; it belongs to the
handoff ticket that carries the artifact. Filing it on both makes the first
ticket unclosable and teaches every later agent that a standing red is normal —
the precise numbness the live suite exists to prevent. **The unmet claim is
never dropped, it is relocated**: here to TASK-0031 (which carries the SQL, the
apply command and the re-measure) and to FEAT-0005's acceptance test 2, which
stays unmet, so M1 cannot claim Claims/Sources parity. **And a correct red is
pinned, not tolerated** — when a failing test is the deliverable, a check must
make its removal fail.

## 2026-09-03 — The claims-cost handoff is confirmed by re-measurement, and "no Admin-side mitigation" is now a permanent rule rather than a temporary posture

TASK-0031 held that `pending_claims` could not be read on staging in any shape
but an unordered `limit 1`, that the fix was a scraper-repo artifact, and that
**no Admin-side mitigation existed or might be built**. The scraper repo applied
`20260903000001_the_creation_bar_is_read_once_and_the_incumbent_is_one_seek.sql`
(Ben-licensed in session): the index this campaign specified —
`field_provenance_current_per_fact` on `field_provenance (entity_type,
entity_id, field, applied_at desc, provenance_id desc)` — plus one word,
`materialized`, on the view's `required_column` CTE. Re-measured read-only
through the live guard, same shapes as before (evidence
`agenticflow/tracker/evidence/architect/claims-probe3.tsv` beside
`claims-probe.tsv` and `claims-probe2.tsv`): all thirteen shapes return, and the
Claims page's own shape returns all 859 rows in 281–312 ms against 8.1 s and
`57014` before. Not one line of `src/` changed.

The door this closes is not "the view is fast now" — that is a fact, not a
decision, and it can regress. It is this: **the two rules trap 12 carried are
kept, decoupled from the cost that motivated them.** No workaround code (no
cache, no narrowed read substituting for a complete one, no swallowed timeout,
no surface hidden because it is red), and **Admin never re-computes the
classification** from `observations` + `field_provenance` + `review_items`. Both
were written while the view was unreadable and both would now be easy to read as
expired. They are not. If the view slows again — and a classification view over
a growing catalog is exactly the thing that will — the answer is another handoff
with another measurement, never a second copy of the resolver's precedence rules
living in this repo. The bucket of a claim is the ledger's answer or it is
nothing.

Two things recorded because the next reader should weight them. **My diagnosis
was half right and the scraper campaign's EXPLAIN corrected it.** I named
`field_provenance`'s missing index (right, and applied verbatim) and then
proposed `not materialized` on the five-times-referenced `live_pending_claim`;
the actual dominant cost was the opposite shape — `required_column` was
referenced ONCE, so the planner inlined it into a per-record lateral and re-ran
a `pg_catalog` join per uncreated record, ~10 s of an 11.5 s read. Inference
from SQL text located the right table and the wrong hot spot; a plan beats a
reading, and the step-0 EXPLAIN on the handoff ticket earned its place.
**And the confirmation found one red that is not the page**: the parked-bucket
live assertion grades the standing tab against the whole-view count
(admin-window/BUG-0037, ARCHITECTURE Common violations row 7) — a test-arithmetic
defect that the page's former error state had been hiding. It is fixed in the
test, never in `src/`.

## 2026-09-03 — how an endgame walker reaches a screen: staging credentials on the launch line, a minted session cookie for the gate

Ben ruled on the two things standing between the M1 endgame (designer walk,
user-sims, verifier) and a first rendered screen. Both are recorded here because
both close doors, and one of them closes a door on a whole category of
convenience.

**1. The walk instance's database credentials live in its own process
environment, never in a file.** `.env` no longer carries `SUPABASE_URL` or
`SUPABASE_SERVICE_ROLE_KEY`; production values exist only in Railway's
production environment, and `.env.example` now says so. A walk instance is
launched with the two names mapped from the staging names on the launching
shell's command line —
`SUPABASE_URL="$STAGING_SUPABASE_URL" SUPABASE_SERVICE_ROLE_KEY="$STAGING_SUPABASE_SERVICE_ROLE_KEY" AUTH_URL="http://localhost:8771" npm run dev -- --port 8771`
— and nothing in code falls back to another name, nothing prints a value, and
`.env` is not edited to make a walk easier. **The door this closes:** the
tempting fix for "the walk cannot read anything" is a line of product code that
reads a `STAGING_` name, or a second env file, or a fallback chain. None of
those may be written. The app reads exactly `SUPABASE_URL` /
`SUPABASE_SERVICE_ROLE_KEY` in exactly one seam (`src/lib/db/client.ts`,
ARCHITECTURE §4 rule 3), and *pointing* those at staging is the launcher's job —
which is the same division `tests/live/setup.ts` has always had. The `AUTH_URL`
on that line is mine, not Ben's, and it is env-only: next-auth rewrites the
request origin to `AUTH_URL` (`node_modules/next-auth/lib/env.js`), so a walk
instance launched without it sends its redirects to `:3000` while the walker is
on `:8771`.

**2. Walkers get past the Google-only NextAuth gate with a minted session
cookie, not with a second way in.** next-auth v5 already ships the JWT `encode`
its own sign-in uses; a helper *outside* `src/` — `tests/walk/session-cookie.mts`,
filed as admin-window/TASK-0033 — reads `AUTH_SECRET` from the environment,
encodes a session JWT for a fixed, clearly-labelled identity
(`walker@admin-window.local`, "Endgame Walker" — never a real person's address),
and prints a cookie descriptor a Playwright script hands to `context.add_cookies`.
The cookie name is `authjs.session-token`: `@auth/core` prefixes `__Secure-` only
when the resolved URL is `https:`, and it uses that same name as the JWT salt, so
a cookie minted under any other name is refused. **The doors this closes, and
they are the point:** no dev-only auth provider, no `SKIP_AUTH` flag, no bypass
branch in `src/middleware.ts` or `src/lib/auth.ts`, no new dependency, and no
credential read anywhere under `src/` (it holds zero mentions of `AUTH_SECRET`
and a ticket check keeps it that way). The gate the walkers walk through is the
same gate production has; the only thing the factory owns is a cookie the gate
would have issued anyway. The helper sits in the test tree for the same reason
`tests/live/setup.ts` does: that is where a credential name may be read outside
the app's one seam, and the layering guard scans `src/` alone.

**The blind spot, accepted with eyes open.** The sign-in flow itself — the
Google round trip and the `admin_allowed_emails` check inside the `signIn`
callback — is never exercised by a walk. Ben accepts that; it is Google's
surface plus one allowlist query, and buying it would cost a second auth path
in production code, which is a far worse trade.

**One consequence Ben has not yet ruled on, and no agent may decide.** The
allowlist is consulted at sign-in, so a minted cookie opens every page — but
`src/app/api/admin/records/[table]/[id]/route.ts` calls `requireAdmin()`
(`src/lib/admin.ts`), which re-checks `admin_allowed_emails` **per request**.
Staging's allowlist holds exactly one row (`kb.labs.ths@gmail.com`, added by Ben
today), so a walker minted as `walker@admin-window.local` gets a correct **403
on save** from the edit surface. Reads are fully walkable; the save path is not,
until either a labelled walker row exists in staging's allowlist or a walk is
run with `--email` naming an address that allowlist already holds. Recorded as a
caveat in the walk recipe (STACK §5) rather than resolved by a guess: adding a
row to a live table and choosing whose identity a walker wears are both Ben's.

## 2026-09-03 — the walk sandbox: one staging-only table, created by hand, reset through PostgREST, and no pg driver anywhere

Ben granted the exception (inbox note, 2026-09-03: "we should just create a
table that always exists which walkers can interact with. After a walk it should
be reset for the next walk", staging only, never production); the mechanism is
the architect's ruling on admin-window/TASK-0034 and is written out in
`ARCHITECTURE.md` §9.1. In one paragraph: `public.walk_sandbox` — `sandbox_id`
text pk, `label` text not null, `note` text, `tally` integer not null,
`is_flagged` boolean not null, `observed_on` date, `created_at` timestamptz
outside the map — is **created once by hand** in the staging SQL editor from the
paste in `agenticflow/tracker/for-human/TASK-0034.md`, RLS enabled with no
policy and grants to `service_role` alone. `tests/walk/reset-sandbox.mts`
DELETEs and re-INSERTs a checked-in fixture through PostgREST with the service
key, taking `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` from its own process
environment (mapped from the staging names on the command line, the launch
recipe's own idiom), loading no `.env`, and refusing non-zero through the one
existing guard (`resolveStagingTarget`, `SERVICES.md`'s declared target) against
any other host. It runs **before every walk**, mandatory — Ben asked for "reset
for the next walk", and a before-reset is the only one a crashed or abandoned
walk cannot skip. Its `EDIT_CONFIG` entry carries `regime: "pre_cutover"`
because `Regime` decides the WRITE PATH and the sandbox's is identical to
`groups`/`idols`'; a third member would change `decideEdit` and would leave
`regimeNote`'s two-way ternary rendering "resolver-owned and read-only" beside
an editable cell.

**The doors this closes.** No `pg` / `postgres.js` dependency, still — the
create-it-itself candidates (B and C on the ticket) are rejected, so
`STAGING_SUPABASE_DB_URL` remains a name nothing under `src/` or `tests/` reads
and the 2026-09-02 pin stands unamended. No second reader of the `STAGING_`
names: `tests/live/setup.ts` keeps that job alone. No second host check: one
guard, reused. No migration in this repo and no DDL from any code path — the
only DDL that exists is a human's paste into a staging SQL editor. No new
surface in the app: one entry in the one map, reachable only at
`/records/walk_sandbox/walk-1`, which renders the ordinary `not_provisioned`
card in production forever. **The costs accepted, named so nobody re-opens them
as bugs**: a manual step Ben owns (a fresh staging project has no sandbox until
he pastes it, and the surface says so honestly); `pre_cutover`'s name reading as
a historical claim the sandbox cannot make, and its regime note saying a value
goes "to the catalog"; the not-provisioned card's generic "arrives with the
scraper repo's migrations" line being wrong for this one table on a surface
nothing links to; and `tsconfig.json` gaining `allowImportingTsExtensions: true`
so a node-run `.mts` tool may import `../live/staging-target.ts` by its real
extension rather than carry a second copy of the guard (measured on this tree:
tsc 0, lint 0, `npm run build` green, and Next does not rewrite the flag).

## 2026-09-03 — the walker identity is on staging's allowlist, so a walk's saves land

Ben added `walker@admin-window.local` to staging's `admin_allowed_emails` on
2026-09-03, answering the question TASK-0033's ruling left open (recorded there
as "Ben's call; no agent adds the row"). QA measured the consequence the same
day (admin-window/BUG-0038): a PATCH with the minted cookie answers 200 and the
column really changes. STACK §5's caveat, which said the opposite, is rewritten
— the walk recipe now states that saves LAND and that a save-path walk confines
itself to one field of one existing `groups`/`idols` row, notes the original,
restores it, and sweeps. That exception is the walk-write rule until the sandbox
of §9.1 lands, and the sandbox retires it.

## 2026-09-03 — a ticket that touches a page carries that page's live suite; the offline suite is not the bar

The M1 root-cause pass over 60 bugs found one class that no ticket could have
caught as ticket checks were being written: `ci_command` is
`rm -rf .next/types && npm run lint && tsc --noEmit && npm test`, and `npm test`
is `vitest --project=offline && vitest --project=isolated`. **`tests/live/**` and
`tests/http/**` run in no gate at all** — not in CI, not in a receipt, unless a
ticket names them. Five M1 bugs are exactly that hole: BUG-0024 (the app read a
column the schema owner had dropped, invisible to a stub that still had it),
BUG-0056 and BUG-0057 (a page change left the page's live parity oracle red;
found by a walker after the ticket closed green), BUG-0058 (a live sweep with a
type error that had never been executed), BUG-0037 (an oracle counting a
different set than the surface renders). DEBT-0002 holds five more files of the
same shape.

The door this closes: from now on a ticket whose `touch_scope` includes a page
under `src/app/**`, or a shared render primitive under `src/components/ui/**`,
**carries `npm run test:live -- tests/live/<page>.live.test.ts` in its
`## Checks`** (ARCHITECTURE §13.1). The alternative — making `ci_command` run
the live tier — was rejected: it would put a staging database and ~30 s per file
in the path of every landing, including the many that cannot touch a page, and
`run.yaml` is the dispatcher's anyway. Measured before ruling it: a live check
runs green inside `receipt.py`'s private worktree (BUG-0037's receipt records
that command at exit 0, six live tests, in
`agenticflow/.worktrees/_receipt-32069`), and when the staging names are absent
the guard refuses non-zero naming the missing name — so the failure mode of this
rule is a loud false RED, never a silent green. That asymmetry is what makes it
safe to require.

## 2026-09-04 — the walk sandbox is uuid-keyed: one id grammar for the whole map

TASK-0035 filed the sandbox's `EDIT_CONFIG` entry against §9.1's `text` keys
(`walk-1`, `walk-2`, `walk-3`) and its builder measured what those keys actually
render: at `/records/walk_sandbox/walk-1` the page issues **no query at all** and
draws the "that is not an id" empty state. `isRecordId`
(`src/lib/db/records.ts`, BUG-0065) gates every record page before any read, on
the premise its own docstring states — every table in the map is keyed by a uuid
— and a text-keyed table made that premise false. Both of the states §9.1
requires were therefore unreachable at the sandbox's own keys: absent, the wrong
card; present, never read.

The invariant that decided it: **the gate never refuses an id the table could
hold.** *Rejected*: a per-table key shape in the edit config (`idShape:
"uuid" | "text"`, consumed by the gate). It is a second allowlist about the same
columns, it widens `TableEditConfig` and changes `isRecordId`'s signature at
every call site, and for a text-keyed table it degenerates to "accept anything"
— a config field bought for no refusal it could ever make. *Chosen*: the sandbox
is keyed by `uuid`, seeded as `00000000-0000-4000-8000-00000000000{1,2,3}`. Ben
had not pasted the DDL, so the cost was one word in a paste-ready note and two
strings in TASK-0036's fixture; the whole sandbox chain still changes nothing in
`src/` beyond the one map entry, which was §9.1's point.

The door this closes: a table may enter `EDIT_CONFIG` only if its real ids
satisfy `isRecordId`. The door left open is that function's own — if a catalog
table keyed by something else ever arrives, `isRecordId` learns it there, by
grammar if the shapes are distinguishable and by config only if they are not.
What must never happen again is a map entry and an id gate disagreeing about
what an id is, because the failure is silent: a page that renders a plausible
empty state having asked the database nothing.

## 2026-09-04 — a window line states a read that happened; an empty window keeps its line

Two suites pinned two readings of the same rule.
`tests/offline/absence/pages.test.ts` says the rule is "a page that could not
read its table publishes no window hook for it; an EMPTY window is still a
window the page looked in, and keeps its line" — and grades the second half on
`/cycles` alone. `/claims` renders the `Empty` card and returns before its
window line, with a comment stating the opposite reading as fact. Measured
2026-09-04: of the seven `data-window` hooks three routes publish against a
populated database, six survive an empty read and one (`/claims`) does not.

Ruled: **the line follows the read, not the rows.** A surface publishes its
window line when the read returned, `ok` with rows or `ok` with none, and drops
it whole when the read was refused, absent or never made. The alternative —
drop the line whenever nothing is shown — was rejected because it makes an
honest empty read and a failed read identical on screen, which is the exact
confusion BUG-0016, BUG-0063 and BUG-0067 each fixed one surface at a time, and
because it takes the `0` away from the live oracles that grade a page by
`data-window-held`. The `Empty` card and the line say different things and both
are true at once: the card says what would fill the surface, the line says where
the app looked.

The door this closes: no surface may decide this for itself again. The rule is
§4.3 of `ARCHITECTURE.md`, and it is graded for every surface at once in
`tests/offline/absence/pages.test.ts` — BUG-0070 both fixes `/claims` and
generalises that test's second leg from one route to every surface that
publishes a window, so the fourth windowed surface inherits the rule instead of
a docstring about it.

## 2026-09-04 — the M1-close cuts: no unprovenanced-row count, no phone work, no second Browse view, and no groups door without Ben

Four scope decisions taken at the M1/M2 boundary, recorded because each closes a
door that a later ticket would otherwise reopen as a good idea.

**(1) A count of unprovenanced catalog rows on Browse is CUT.** A user-sim named
it as a return condition ("a way to see how many catalog rows carry no provenance
at all"), and the designer routed it to the retro as scope rather than a bar. It
has no honest vision trace: VISION's "who keeps being wrong" is about sources
disagreeing, not about coverage of the catalog. Cut, and it does not come back
inside this campaign.

**(2) Phone and responsive layout are CUT for the campaign's life.** Ben already
ruled the window desktop-only on 2026-09-02 (both themes kept); this restates it
as a campaign-lifetime cut so no M2 ticket reopens it under cover of a fix.
BUG-0050 fixed the 390px sidebar collapse; nothing further is in scope. Phone is
a later nice-to-have, after this campaign closes.

**(3) A second Browse view, whole-table browsing and a SQL runner stay out.**
SPEC F7 and spec §1/§4's Rationale ship exactly one curated view. This is
unchanged; it is written here because M2 builds a picker (FEAT-0012) that
searches a table, and a picker is not a view.

**(4) The groups/idols door is NOT a campaign judgment call.** M1 shipped
`/records/groups/<uuid>` complete, keyboard-navigable and the most-praised
surface of either user-sim walk — and unreachable: nothing lists it, links it, or
searches for it, and a stranger spent fifteen minutes before opening a SQL
client. Every cheap door (a listing, a name lookup, a search box) is a second
curated view, which SPEC F7 forbids by contract, so no `vision_trace:` line can
be written for one honestly. **Ruled: not built in M2; put to Ben as a fork
question** in `tracker/for-human/M2-roadmap.md`, with the designer's three costed
options. If Ben says no, the asymmetry is the campaign's deliberate answer and
BUG-0052's corrected copy is the whole remedy. The door this closes: no agent
builds a groups listing, a search input, or a "browse groups" affordance inside
this campaign without Ben's written answer — including under cover of FEAT-0012,
whose criteria pin exactly that.

**Two consequences that are NOT cuts, and are carried openly instead:** the
idol↔group islands are answered by FEAT-0012's display half (a reference renders
as a link — the rendering `events.venue_id` already ships), which does not create
a door and must not be sold as one; and the "human edit leaves no fingerprint"
tension between VISION ("every change is attributed") and SPEC F8 ("legal and
unprovenanced") SURVIVES M2, because spec §7's `action` CHECK admits no verdict
row for a pre-cutover edit and the only honest alternative is a trigger, which is
schema this repo may never carry. It is SPEC named gap 8 and it is already Ben's
in `tracker/for-human/M1-contract-gaps.md`.

## 2026-09-04 — M2 is the campaign's last milestone, and the verdict log is a tab rather than a seventh page

Two shape decisions for M2, taken at the boundary.

**No M3.** VISION states its own satisfaction condition — "The campaign is
satisfied when the verdict UI is built and both handoffs are complete and
reviewed" — and M2 is exactly that scope. When M2 closes the run stops and Ben
verifies; his sign-off merges the run branch and closes the campaign. `run.yaml`
allows six milestones, which is a runaway guard and not a target. The door this
closes: no milestone may be planned after M2 to keep the loop moving. A genuine
reason to continue is a recommendation to Ben in ROADMAP.md, never a milestone
this campaign files for itself.

**The verdict log is a tab on Queues, not a seventh page.** Ben's ruling names
"the verdicts table UI" as part of the satisfied condition, and VISION names
exactly six pages. Both hold at once only if the log renders as a URL facet of an
existing surface. Chosen: a tab on Queues — the surface whose items it settles —
using the standing-disagreements tab on Claims as the shipped rendering
precedent, plus each settled item's verdict inline on its own detail. *Rejected*:
a seventh nav item (contradicts VISION's enumeration); a Dashboard card (the log
is a history, not a breakfast figure); no UI at all (contradicts Ben's ruling).
The door this closes: the sidebar holds exactly six links at the M2 close, and
FEAT-0013's criteria grade that.

## 2026-09-08 — direct catalog editing is struck: the three regimes, and the door that must stay shut

Ben struck the sentence *"groups/idols edit directly within it"* from the frozen
VISION on 2026-09-08 (`vision.py amend --strike`, human-only; the inbox note
carries his words): **"admin edits catalog tables only through the observation
pipeline; do not re-implement direct edits. groups/idols stay as test tables
until they are removed."** The strike removes; it licenses nothing new.

What it closes, and how the closure is kept:

- **`pre_cutover` ceases to exist**, as a concept and as an identifier. Two
  regimes remain: `resolver_owned` (`events`, `venues` — the override path
  through the gate, ARCHITECTURE §9.2) and `sandbox` (`walk_sandbox` alone,
  a staging-only fixture table in nobody's domain, which is why the strike does
  not reach its direct PATCH). After M2 the ONE way a catalog value changes from
  Admin is the override path.
- **`groups` and `idols` leave `EDIT_CONFIG` outright** (TASK-0040): no record
  page, no PATCH branch, no regime of their own. *First drafted this day as a
  third `read_only` regime that kept their record pages as reads* — SPEC F12's
  display half names the idol↔group islands, and Ben's note says the tables
  "stay as test tables" — *and re-ruled against it the same day, on the
  builder's question.* Three reasons: with no door (Ben, 2026-09-08: no listing,
  no search) and no write, a record page reachable only by a pasted uuid is a
  surface no operator can reach; the reference-as-link mechanism is fully
  carried by `events.venue_id`, which is what acceptance test 8 grades, so F12
  loses nothing it is measured on; and "stay as test tables" is satisfied by the
  DATABASE — `lib/db/tables.ts` keeps both names and the schema description
  still describes both tables. [**Corrected 2026-09-08**: this sentence read
  "and the residue sweep still reads all their columns", which stopped being
  true in the same ticket it was written for — TASK-0040 narrowed the sweep to
  the MAPPED tables (`tests/live/residue.live.test.ts` iterates
  `EDITABLE_TABLES`), so no column of `groups` or `idols` is swept any more.
  The ruling is unchanged: what satisfies "test tables" is the table registry,
  not the sweep.] Ben expects to drop both tables soon, and every line
  kept for them is a line to delete then. Restoring an entry is two objects in
  one file if he ever wants the page back. **F12's display half is cut, not
  deferred** — no flag, no scaffold, no link to either table anywhere in `src`.
- **The teeth are structural, and they are NOT the type.** A `Regime` member
  does not stop the struck path returning: a catalog table re-added under
  `sandbox` would be exactly it. The pin lives in
  `tests/offline/edit/config.test.ts` — **the only table whose write path is
  `direct` is `walk_sandbox`** — proved on two fixtures, the way every guard in
  this repo must be (LESSONS 3). ARCHITECTURE §13.8 puts the sentence in every
  edit-surface brief, and Common violations row 12 carries the class, promoted
  at count 1 because a human ruling closed it rather than a second instance.
- **Consequences accepted today, not discovered later.** `tests/live/edit.live.test.ts`
  writes one field of a `groups`/`idols` row and restores it — that path is gone,
  so the suite inverts to prove the refusal (TASK-0040) and its write half moves
  to `walk_sandbox`, which Ben pasted into staging on 2026-09-08 and which
  builder-118 measured present with rows on 2026-09-09. The interim walk-write
  exception dies with the path it depended on, ahead of TASK-0037's schedule.
- **What is NOT decided here**: whether `events`/`venues` may be edited at all is
  Ben's (`EDIT_ALLOWLIST_EVENTS_VENUES`), and this ruling does not pre-answer it.

Door closed: no direct write to a catalog table from Admin, under any regime
name, in this campaign or after it. Door left open, deliberately: `walk_sandbox`'s
direct PATCH, because a staging-only fixture table in nobody's domain is not a
catalog table — the day it becomes one, or the day a second table joins the
`sandbox` regime, this paragraph is the one to revisit.

## 2026-09-08 — the walk sandbox's regime is `sandbox`, and the record page's note becomes honest

`walk_sandbox` kept its direct PATCH and lost the name it shared. ARCHITECTURE
§9.1 item 5 had reused `pre_cutover` on the explicit grounds that `Regime`
answers one question — which write path — and that the sandbox's answer was
identical to `groups`/`idols`'; it named the trigger to revisit ("if any code
starts reading `pre_cutover` to mean 'a catalog table'"). The strike fired that
trigger: the sandbox's answer is now shared with nothing.

*Rejected*: leaving the identifier alone. It would name a regime whose only
member is a table that was never pre anything, and it would leave the
groups/idols write path one word away from being restored by a map edit.
*Rejected*: dropping the sandbox's write path so the app has two regimes. That
deletes the only surface a walker may write while `settle_review_item` is
absent, which is the whole of M2 — Ben granted the table for exactly this.
*Chosen*: `sandbox`, one word in `config.ts`, one arm in `writePathFor`, and a
three-way `regimeNote` on the record page. The rename also pays off the one
inaccuracy §9.1 accepted on purpose: the sandbox's note said a value written
there goes "to the catalog", which for a staging fixture it never did.

## 2026-09-08 — the two §9 handoff artifacts live in `tracker/for-human/`, as fenced SQL, and nowhere else

The `verdicts` and `settle_review_item` migrations are authored complete in this
repo. They are NOT `.sql` files. Each is a single fenced `sql` block inside
`agenticflow/tracker/for-human/M2-handoff-verdicts.md` and
`…/M2-handoff-settle-review-item.md`, beside its target path in
`kspace Scraper/supabase/migrations/`, the apply command Ben runs there, and a
citation table naming, per identifier, the sibling migration that defines it.

*Rejected*: `agenticflow/handoffs/*.sql` or `contracts/handoffs/*.sql`. A file
with a `.sql` extension in this repo is a migration-shaped object: a glob, a
`supabase db push` run from the wrong directory, or an agent looking for
"the migrations" can apply it, and M2 EC10 exists to make that impossible.
`contracts/` is additionally the human's, which no agent edits.
*Chosen*: markdown, because (1) `supabase/migrations/` stays at exactly the two
app-owned files and no `.sql` exists anywhere else in the tree — one check, one
grep, permanently; (2) it is the shipped precedent Ben already consumes
(TASK-0031's index and TASK-0034's sandbox DDL were pasted from exactly this
place); (3) the digest routes `for-human/` notes to him without anyone
remembering to.

**How they are graded without a database.** No `psql`, no dry-run, no SQL parser
(a DEP for one file is not proportionate, and SPEC F9 says the bar is a REVIEW
bar). Three honest instruments instead, and none of them claims the artifact
"parses": (1) an offline vitest test extracts the one fenced block and asserts
its structure — the seven columns with their types, nullability, defaults and
FKs; `enable row level security` present and zero `create policy`; zero
`json`/`jsonb` columns; the revoke/grant pair; no `commit`, no `dblink`, no
autonomous-transaction construct; balanced `$$` and `begin`/`end`; and — the
one that matters most — the `action` CHECK's value set equals `VERDICT_ACTIONS`
imported from `src/lib/verdict/decision.ts`, which closes SPEC gap 6 by
construction rather than by two builders remembering. It ships one block it must
flag and one it must not (LESSONS 3). (2) A stored check resolves each cited
identifier in the sibling's migrations **by absolute path** — a receipt runs in
`agenticflow/.worktrees/<name>`, where `../kspace Scraper` resolves inside this
repo and a relative sibling check is a false RED. (3) Ben's review, which is the
actual bar (VISION: "complete and reviewed").

## 2026-09-08 — a surface reads the `verdicts` TABLE to know whether it may offer an action

PostgREST cannot introspect a function without calling it, and calling
`settle_review_item` to find out whether it exists is a write attempt dressed as
a probe. So every M2 surface that offers a settlement or an override asks one
question instead — is the `verdicts` table there? — through the single helper
`readSettlementReadiness` in `src/lib/db/verdict.ts` (one owner; four pages
hand-copying `StateOf` is common violation 9 and this is the same shape).

It is honest because the two migrations install together and the function's own
artifact writes the table it depends on: "table present, function absent" is a
state the handoff cannot produce. If it arrives anyway — Ben applies one file and
not the other — the attempted call answers `PGRST202`, the data layer classifies
it `not_provisioned` naming `settle_review_item` (the classifier learns
`PGRST202` and `42883` in the same change), and the surface draws the same card
after the click that it would have drawn before it. Both paths are graded and
neither throws.

Door closed: no `.rpc()` call made for the purpose of discovery, and no
"pending overrides" queue, retry buffer, or flag-guarded direct write standing in
for the absent function — spec §10's one forbidden move, which this campaign
treats as its brightest line.

## 2026-09-08 — the walk sandbox is real: the reset round trip is measured on staging, and the sandbox is the only write surface a walk has

Ben pasted the DDL into the staging SQL editor, so `public.walk_sandbox` and its
three seed rows exist on `ubfjjqlvnpnoborczbdb.supabase.co`. What had never been
measured before — the offline suite says so in its own docstring — is the
present-case round trip against a real PostgREST; it has been now
(admin-window/TASK-0037), and the recipe in STACK.md §5 step 3 carries the
numbers.

**What was measured.** The launch block in step 3, pasted into a fresh shell,
exits 0: `deleted 3, seeded 3, read back and verified`. On a production build of
this tree, `/records/walk_sandbox/00000000-0000-4000-8000-000000000001` renders
the OK state — six field lines, an edit control on each of the five mapped
editable columns and none on `sandbox_id` — not the not-provisioned card and not
the not-an-id empty state. `note` was rewritten through the cell, survived a
reload, and a second reset put all three rows back byte-identical to
`tests/walk/sandbox-fixture.ts` over `SANDBOX_COLUMNS`. Both refusals still exit
1 having touched nothing: the two names unset, and a host `SERVICES.md` does not
declare. The deliberate `23502` path works too — clearing `label` shows the
database's own refusal, reverts the cell, and leaves the stored value intact.

**The cadence is unchanged and is now cheap to keep.** Reset immediately before
every walk, mandatory; again after a walk that wrote, optional. Nothing about
that turns on a date: step 3's own exit code is still the test.

**What this decides.** The sandbox is the **only** write surface a walk has, and
a save-path walk that cannot reach it is a narrowed walk that says so in its
report — never a write somewhere else. The round trip is pinned by the
walk-sandbox block of `tests/live/edit.live.test.ts`, which is the live suite's
only remaining proof that a mapped column can be written at all, and its undo is
`resetSandbox` in a `finally` rather than `withSweep`: the sandbox's undo
restores every row, not the one column that was touched. The residue sweep now
scans the table (`5 of 5 mapped table(s)`) instead of skipping it, and was
observed on both fixtures — a marker written into `walk_sandbox.note` failed it
naming `walk_sandbox.note: 1 row(s)`, and the reset made it pass again.

**The door this closes.** No walker needs to establish which walk-write rule it
is under by reading a doc's age, and no future ticket may re-derive a
catalog-row write path from the sandbox being unreachable: an unreachable
sandbox narrows the walk, it does not widen the target.

## 2026-09-08 — the admin voice is a registered sources row named `admin`, and the artifact registers it

Ben answered `ADMIN_SOURCE_IDENTITY` (admin-window/TASK-0043): **the admin voice
is a `sources` row named `admin`, tier `admin`, lifecycle `active`, kind
`registered`.** Staging holds no such row today — read-only census 2026-09-08:
`ticketmaster` plus two test-harness sources, nothing else — and he took the
second of the two shapes the ASK offered: **the `settle_review_item` handoff
artifact carries an idempotent insert for the row**, so he installs the
registration and the function in one paste rather than typing SQL from two
notes.

**Why the row could not be chosen here.** The gate refuses an unregistered
source (`ingest_observation`, KS007), the `sources` row is a registry fact owned
by the scraper repo, and inventing a name is the one move SPEC F9 forbids. The
insert is legal against what is INSTALLED, read 2026-09-08 from
`kspace Scraper/supabase/migrations/20260818000000_the_schema_arrives_as_one_snapshot.sql`:
`sources_source_key UNIQUE (source)` is what `on conflict (source) do nothing`
needs; `source_kind` carries `registered`, `source_lifecycle` carries `active`,
`source_tier` carries `admin`; and the `sources_source_shape` CHECK
`^[a-z0-9_]+$` admits the name. `on conflict … do nothing` is the sibling's own
idiom (`20260901000005`, `20260901000006`), and `do nothing` rather than
`do update` is deliberate: applying the paste twice, or applying it after Ben
has inserted the row himself, must never rewrite a registry row's lifecycle or
tier from Admin's copy of it.

**The name is spelled once**: `ADMIN_SOURCE = "admin"` in the pure leaf
`src/lib/verdict/decision.ts`, which both a surface and the artifact's offline
test may import (§4 rule 7). The artifact's test asserts the SQL's source
literal against that constant, exactly as it asserts the `action` CHECK against
`VERDICT_ACTIONS`. The same test now also pins the SQL's PARAMETER name to
`SETTLE_ARGUMENT` in `src/lib/db/verdict.ts` — QA measured on 2026-09-08 that a
sabotaged spelling (`p_decisions`) left the entire offline suite green while
PostgREST would have answered `PGRST202`, rendering an installed function
permanently and silently absent.

**The doors this closes.** No agent may invent, rename or "temporarily" pick an
admin source name: the string lives in one constant and one SQL literal, coupled
by a test. Nothing in Admin ever WRITES the `sources` row — the registration
travels as SQL in a handoff Ben applies, and the sibling repo stays untouched.
And the decision envelope still carries no source name: this is a name the
FUNCTION uses in its own branches, not a field Admin sends (§9.2).


## 2026-09-08 — the editable columns of `events` and `venues`, and the one-edit rule for widening them

Ben answered `EDIT_ALLOWLIST_EVENTS_VENUES` (admin-window/TASK-0044), SPEC named
gap 7: **events — `title`, `description`, `poster_url`, `starts_at`; venues —
`name`, `city`, `country`, `address`.** These are the columns he ruled VISIBLE on
2026-09-02, now writable through the override path and through nothing else.
`event_type`, `status` and `time_precision` stay OUT: all three are
CHECK-constrained, so a free-text cell can produce a refusal the operator cannot
predict, and the fixed choice list that would fix that is a widget this campaign
has not costed. He noted the list can be updated later.

**"Later" is one edit, and this paragraph is what keeps it one.** The two
`EDIT_CONFIG` entries are the whole mechanism; adding a column is adding a string
to one of them. No second allowlist, no per-column flag, no "future columns"
scaffold, and no widening to a link or a non-scalar (performers and venues are
`event_performers` / `venues` ROWS, not fields of `events` — AGENTS.md).
`venue_id` remains the map's `reference`, the F12 picker's field, and never a
cell.

**A column MOVES from `display` into `editable`; it never stands in both.**
`display` is the read-only half of the ONE map and `decideEdit` reads `editable`
alone, so a column named in both would be writable while the map called it
read-only. So `events.display` becomes `["venue_id"]` (the reference alone) and
`venues.display` becomes empty. Because `mappedColumns` orders pk → editable →
display, the record pages draw the same lines in the same order they draw today:
the move is invisible except for the controls appearing.

**The doors this closes.** A builder never picks an editable column: the answer
is a closed list, and a column outside it is refused server-side by the one code
path (hiding a widget is not a refusal). A CHECK-constrained column does not
enter the map by the back door of "it is registry-declared" — registry
declaration was the CANDIDATE bar; Ben's ruling is the editable bar. And the
override path is still the only way a catalog value changes from Admin: this
ruling widens what may be overridden, never how (2026-09-08, the strike).

## 2026-09-09 — a chip may never sit inside an anchor, and the guard is a rendered whole-window sweep

BUG-0115 is the second instance of a chip-filled span inside a link (the first,
BUG-0113, was the `/claims` bucket anchors), so Common-violations row 13 was
promoted exactly as its count-1 note said it would be: the rule is now
ARCHITECTURE.md §7, and the assertion lands in `tests/offline/ui/link-spelling.test.ts`
with BUG-0115's own fix.

**The door this closes for the layout.** A badge that classifies a *card-shaped*
link — a `StatCard` with an `href`, whose anchor is the whole card — must sit
inside the card's shell and outside its anchor. Wrapping a card in an anchor does
not make the card's classifications part of a label. For the Dashboard's
attention cards the ruled fix is the designer's BUG-0113 precedent applied: the
chip goes, the severity word stays, in the severity's ink and with no fill of its
own — a word with no box cannot dissolve into the box behind it. Restructuring
`StatCard` so the card stops being one anchor stays OUT of that fix: it is a
designer's ruling about the card's affordance (the bar-10 shape BUG-0054/BUG-0099
removed everywhere else), not a builder's pick made while fixing a chip.

**The door this closes for the guards.** The rule is asserted over the RENDERED
window, not over source text and not per page: every route `pageRoutes()` finds,
rendered against `populatedScript`, asserted with `chipsInsideLinks`, whose chip
classes are derived by rendering `<Badge>`. Three consequences we accept
deliberately. A page added later inherits the rule instead of a comment about it.
No class literal is pinned anywhere, so restyling the chip moves the guard with
it. And the guard sees only the states the populated script renders — it is a
floor under the milestone walk, never a replacement for it. It was dry-run before
it was written into criteria (2 hits on `/`, 0 on the other seven routes), because
a repo-wide guard authored against an instance nobody measured is how row 4's
false-red absence pins were born.

## 2026-09-09 — `/queues` narrows by `source_id`; the dropped-parameter rule gets one owner (BUG-0141)

The Sources page's `review items` anchor sent `/queues?source_id=<id>` into a
page whose vocabulary was kind / queue / shape / status, and an unrecognised
parameter there narrows nothing — so a source's own link presented another
source's item as that source's (verifier walk, 2026-09-09). The ticket left the
choice open: add the facet, or add the honest "this page did not apply that
parameter" line `/claims` already renders. **Ruled: add the facet.** Spec F5 is
"a source links to its review items and its runs"; a link that lands on every
source's items with an apology beside it does not link to its review items, and
shipping (b) would have converted a wrong-data bug into an unmet spec clause
with the same verifier verdict at the end of it. `review_items.source_id` is a
real, populated column, PostgREST can narrow on it, and the campaign already
carries this shape on three surfaces — the marginal cost over the line-only fix
was small enough that "M2 endgame" argued for the facet rather than against it.

The door this closes: `source_id` is now part of `/queues`' URL contract and a
future facet on that route follows this seam — filter field on
`ReviewItemFilter`, compared by the app's one predicate, narrowed at the query
where a column exists, canonicalised once at the page edge by
`canonicalRecordId` handed INTO the leaf (a pure domain leaf may not import
`lib/db/**`, and a second uuid grammar was already closed by BUG-0139/0140).
Two things it deliberately does NOT do: no chip row for the source (its
vocabulary is unbounded data and `/queues` reads no registry — the narrowing is
stated by a scope element that spells the canonicalised id and links back
without it), and no narrowing of the queue-health gauge or the verdict log,
which stay honest whole-object reads.

The second half is a consolidation, not a new sentence: the dropped-parameter
rule and its rendering move to `src/lib/url/dropped-params.ts` and
`src/components/ui/dropped-params.tsx`, with `lib/claims/filters.ts`
re-exporting so `/claims` does not move. `/queues` needs the line anyway — for
`?source_id=not-a-uuid`, which it cannot apply — and a copy would have been born
without the four fixes that landed on that one sentence
(BUG-0123/0127/0136/0137). That is common violation 9's promoted rule applied to
a bug fix rather than to a decomposition.

## 2026-09-09 — one derivation per URL value class, and a value a browser would re-spell is REFUSED rather than boxed (BUG-0155)

Seven bugs have now landed on one shape — a URL value inside a sentence this
app wrote (BUG-0137, 0143, 0145, 0146, 0147, 0153, 0155) — and each of the
first six closed one PROPERTY of the value: no markup, no bidi, some ink,
bounded length, a canonical uuid spelling, padding stripped by ink. The
property none of them stated is that what is SHOWN is what was USED, and no
"may I spell it" predicate can answer it, because a facet value is used twice:
it is sent to PostgREST and it is spelled in the app's own prose. The door
closed: from here a free-text URL facet value has exactly ONE derivation,
`canonicalUrlText` (`src/lib/url/text.ts`), the way a uuid has had exactly one
since BUG-0143 (`canonicalRecordId`), and the derived value is the only string
that reaches the query, the facet's own box and every sentence naming it — or
the facet is not applied and the shared dropped-parameter line says so. The
ends-only ink-padding strip that both derivations need gets one declaration
(`trimInkPadding`), called by both; `sourceNarrowing` — four lines in
`src/lib/db/runs.ts` that returned the value verbatim, and the free-text class's
whole "derivation" — is retired, which also closes ARCHITECTURE.md common
violations row 17's second instance and row 18's last half.

The door this deliberately closes the other way: the interior case
(`?source=tic%20%20ketmaster`) is REFUSED and reported dropped, NOT preserved
in an `Identifier` box carrying `white-space: pre`. The box arm would put a
non-wrapping foreign run inside six authored sentences of one page — the runs
window line's four clauses, the facet paragraph, the empty card — to preserve a
spelling no registered source uses, and it cannot pass QA's own strict pin,
which collapses the rendered text the way a browser does before comparing it to
the queried value (measured before ruling). Refusal reuses the arm BUG-0153
already built and renders nothing new. The consequence accepted with it: a
source name a browser would re-spell is unqueryable from a URL, and a
`/sources` link built from such a registry name lands on a page that says it
did not apply the facet — honest, and a `/sources` question (BUG-0154's class)
rather than a `/cycles` one.

Not closed: a value that reaches PROSE ONLY and asserts nothing about a queried
set stays under the allowlist alone. `?cycle=`'s unmatched-paste arm spells a
paste in full and queries nothing, so "not among the 200 newest cycles" is true
of every spelling of it (BUG-0147), and forcing it through a derivation would
buy nothing and cost the page its answer to a half-typed URL.

## 2026-09-10 — `/claims` gets its order from the database: `observed_at` is carried through `pending_claims`, and two rendered figures are dropped rather than faked (Ben's ruling, Answer A + A2 on BUG-0138)

`/claims` read the whole claim population on every request — a complete read of
`pending_claims`, then a nine-chunk second leg fetching each claim's instant back
out of `observations`, then the registry, then the gauge: ~14 sequential round
trips, 2.9-3.8 s warm on Ben's own walk. The fix Ben ruled on 2026-09-09 (no
population read; counts from head requests; the list one DB-ordered window of the
50 longest-waiting) turned out to be **inexpressible from this repo**: measured
read-only against staging 2026-09-09, PostgREST exposes no relationship between
`pending_claims` and `observations` (PGRST200 on all three embed shapes) and
refuses aggregates on this deployment (PGRST123), and the view carries no age. So
no Admin-side read can order claims by wait time, group them, or count distinct
sources per bucket.

**Ben's ruling of 2026-09-10 is Answer A + A2.** (A) The scraper repo carries
`observations.observed_at` through the `pending_claims` view — one existing
`NOT NULL` column of a table the view's first CTE already selects from, appended
to the view's column list, no new join, no new scan, no bucket condition touched.
The artifact is a **handoff for Ben**
(`agenticflow/tracker/for-human/M2-handoff-pending-claims-observed-at.md`), never
an edit from this repo, per AGENTS.md. (A2) The two figures the column does not
rescue are **dropped, not approximated**: the bucket table's distinct-`sources`
column goes (it was a builder's addition; spec §4 asks for "buckets with counts,
age"), and the domain CHIP ROW goes while `?domain=` stays a real server-side
`.eq()` narrowing on every count and on the window, named in the window line.
Source chips come from the registry read the page already makes — every
registered source, real zeros — which is the same chip row `/sources` renders.

**The doors this closes.** (1) Admin will not compute in TypeScript what the
database can answer: no client-side distinct-count, no client-side wait order, no
re-sort of a set larger than the window, and specifically no derivation of a
bucket from `observations` + `field_provenance` + `review_items` (§6 trap 12b
stands). (2) Where a bounded read is impossible and only an unbounded one would
render a figure, **the figure is dropped and the page says less** — it is never
rendered from a truncated population and never labelled as a total. That is the
generalisation of §4.3's complete-or-refuse rule to the case where neither arm is
available. (3) `held` on this page is now the view's true count and may exceed
`ROW_CAP`; the page no longer refuses a view larger than the cap, which is the
point of the fix rather than a regression.

**Precedent and cost.** This is the same move as admin-window/TASK-0031, where
five Admin-side mitigations were measured, all five failed, the artifact was
handed off, and one scraper migration took this page from 8.1 s and `57014` to
~300 ms with no Admin code change (§6 trap 12). The cost accepted: the ticket's
live checks cannot pass until Ben applies the migration to **staging**, and they
are required to REFUSE loudly rather than fall back — an unapplied migration
shows up as a red line on a receipt, not as silence. Production is not this
factory's business and is never a check's target.

## 2026-09-10 — M3 exists: paging is bought, search is not, and the blank-source-name class is closed

Four rulings taken at the M2 close, recorded together because they are one
scoping decision with four edges. Full reasoning: `tracker/milestones/M2.md`
retro and `docs/vision/ROADMAP.md`.

**(1) There is an M3, and Ben bought it.** Through the M2 close both ROADMAP and
the verifier's EC14 paragraph said "there is no M3." Ben overruled that on
2026-09-10: *"not being able to load all claims if I want to is a huge
oversight"*, paging past the window on **Claims and Browse**, through on-demand
client-side fetching against a route handler, is a next-milestone item; and the
milestone's shape is *"as long as everything is complete is good."* M3 is three
features — paging (SPEC F14), windowed-figure honesty (F15), and the concurrent
second leg of a two-step join (F16, the unbuilt half of BUG-0138's Answer B).
**The door this closes:** M3 opens no new front. No new page, no new nav item,
no schema in either repo, no second Browse view, no door onto `groups`/`idols`,
no dial, no responsive work. Paging is added to Claims and Browse and to nothing
else on the team's initiative, and it does not reopen whole-table browsing.

**(2) Paging is now legal, and only the architect may make it so.**
ARCHITECTURE §4.3 reads *"Paging is not the answer to a cap and none is built:
nothing in the spec asks for it."* The spec now asks for it, so §4.3, §4 rule 1
("components never fetch") and §5 (one async boundary per route) are amended by
the **architect at the start of M3, before any page diff lands** — M3.md EC3
grades that ordering by requiring the amendment's commit to be an ancestor of
every page commit. A builder that finds a contract in its way files a blocked
question; it never interprets one. The door this closes: the amendment is not a
licence to fetch from components generally. It names paging's boundary and
nothing wider.

**(3) Search stays out, and the evidence for it stays visible.** Ben ruled
2026-09-10 that search is a **vision addition**, not a residual: out of scope
unless he runs `/ship revise`. Two independent user-sim strangers named a search
box, unprompted, as their first condition for returning
(`tracker/for-human/M2-usersim-judgment.md`), and M1's stranger walk ended in a
SQL client for the same reason. That evidence is carried in ROADMAP addressed to
Ben; **no ticket exists and none is filed**, and paging is not argued as a
substitute for it — they remove two different exits from the app.

**(4) The blank-source-name class is paid for, and this is its last ticket.**
BUG-0152 / 0154 / 0156 / 0158 / 0159 were five P3 tickets on one state — a
`sources.source` that exists but carries no ink — filed one site at a time,
each fixed with a local `??` instead of a call to the helper that already owns
the question (`lib/sources/names.ts`). Staging's own
`CHECK (source ~ '^[a-z0-9_]+$')` forbids the state. Two residual sites
(`components/sources/registry-table.tsx`, `components/sources/trends.tsx`) are
closed by **one** ticket (TASK-0060) that routes both through the shared helper.
**The door this closes:** no sixth per-site bug is filed in this class, in M3 or
after. The condition on the ruling is the shared helper — a local fallback added
to either file satisfies nothing. Related and ruled the same way:
`DrawnWindow.scope`'s comma-joined string (a facet value containing `", "` could
forge a segment, unreachable today) gets **no ticket**; it is a constraint on
FEAT-0016, fixed structurally if and only if that work touches the window line's
scope contract.

## 2026-09-10 — Paging's boundary, decided at the contract rather than in a page: an offset the server validates, a client that decides only when to ask

The architect's M3 opening amendment (ARCHITECTURE §4.3 read kind 3, §4 rule 1's
one framed fetch exception, §5's client-state and byte-identity rules), recorded
here because it closes doors a later ticket would otherwise reopen.

**The mechanism, ruled and not left to a builder.** Paging is an **offset into
the first screen's own total order** — same `.order()` chain ending in the
primary key, plus `.range(offset, offset + size - 1)` — carried to the app's own
route handler under `src/app/api/admin/**`. The size is the surface's own window
and is decided on the SERVER; the client sends only how many rows it already
holds. A bound that is not a non-negative multiple of that window, or that
exceeds `MAX_PAGE_OFFSET`, is refused with the reason named — never clamped in
silence. Past the end is `ok` with zero rows and "exhausted", which is an answer
and not a refusal. **The alternative considered and rejected: a keyset cursor.**
It survives concurrent inserts, which offset paging does not, but it puts a
composable ordering key in the client's hands, needs a second null-ordering arm
on `/claims`' `observed_at nulls last`, and has no natural "out of range" to
refuse — and the app makes no snapshot promise across presses in either design.
The honest position is written into the contract instead: a page is a bounded
read at the instant it was issued, and no concatenation is ever presented as a
total.

**The three doors this closes.** (1) The fetch exception is one named control on
two named surfaces — `/claims` and `/browse` — and never "components may fetch";
the decision logic lives in a directiveless `src/lib/paging/**` driver the
offline suite drives with a recording stub, because this repo has no DOM in its
test tier and a click handler owning its own logic would be untestable here.
(2) The FIRST server-rendered screen is byte-identical to what shipped in M2:
no offset in `searchParams`, so a shared link never depends on how far somebody
else paged. (3) Paging buys no width — no third surface, no "load everything"
control, no second Browse view, no raised `ROW_CAP`, and it is not argued as a
substitute for search, which stays out by Ben's ruling of the same day.

## 2026-09-10 — a page-level latency bar belongs to the page's critical path, not to one function

TASK-0062 made `readRowsByIds` a bounded fan-out and carried M3 EC9's whole
page bar (`/claims` warm at or under 1.4 s) on a diff confined to
`src/lib/db/result.ts`. It missed honestly: 2.280 -> 1.714 s median. The
ruling is that the bar was mis-homed at authoring, not that the bar is wrong.
It moves to TASK-0074 and M3 still owes 1.4 s. **The door this closes:** on a
page that composes its reads in one `Promise.all` — which `/claims` does, at
depth 1 — round-trip COUNT is not the latency lever; the 13 single-trip
siblings cost `max`, not `sum`, and only DEPTH is on the clock. So collapsing
the five per-bucket counts and five per-bucket seeks into grouped reads is
ruled OUT as a latency remedy for as long as that composition holds (it would
buy database load, not wall clock, and would put a rendered-figure rewrite
inside a timing ticket). The one deep chain left on `/claims` is the
pending-claims gauge's two-step join — `readPendingObservations` awaited, then
877 ids through the fan-out, four sequential waits — and that is the only
thing TASK-0074 is allowed to attack. A future latency ticket on any surface
states the page's DEPTH before it proposes a fix; a round-trip census alone
does not justify one.

## 2026-09-10 — a paged answer is full-or-exhausted, and the client REFUSES anything else rather than reinterpreting it

QA found on TASK-0064 (BUG-0168) that an `ok` page of 30 rows for a 50-row
window carrying `exhausted: false` leaves `held` at 80 — off the grid
`pageBound` enforces — so `PageMore` draws its `limit` arm ("this view shows no
further rows") one line under an answer that said the set continues, and the
rest of the set needs a page reload. Two endings were honest and the pin
accepted either: the driver calls a short page the end of the set (what its own
`ok`-arm comment already claimed), or the route's contract is full-or-exhausted
and a short continuing page is refused out loud. **Ruled: the contract, not the
reinterpretation.** `/api/admin/*/rows` answers exactly the window's rows with
the set continuing, or at most the window's rows with `exhausted` true —
`exhausted === rows.length < size`, derived from the read it just made — and
`requestPage` treats any other combination (short-and-continuing, or longer
than the window) as what it is, foreign data on a wire: a refusal that appends
no rows, leaves `held` unmoved and keeps the control for a retry, the same arm
a body that is not a page answer takes. **The door this closes:** the client
never *infers* the end of a set. Deriving exhaustion client-side is the cheaper
fix and it converts a truncated, proxied or stale-deploy answer into "you have
seen everything" — a false totality claim on the one surface whose whole reason
to exist is Ben's "not being able to load all claims if I want to is a huge
oversight", and the failure mode §4.3 exists to make impossible. What the
contract buys in exchange is an invariant every paging surface may rely on and
every future consumer inherits for free: **after any press, either the next
bound is one this app may serve, or the state is `exhausted`** — so `held`
leaves the bound grid only on the final page, and no second consumer of the
driver can re-open BUG-0168 by wiring the widget slightly differently. The
window itself stops being supplied twice with nothing reconciling the two
copies (`PageDeps.size` was never read by the driver, QA residual 4): the
driver now reads it — it is the number the invariant is checked against — and
the hook hands the same value back out for the widget's `size` prop.

## 2026-09-10 — a live proof is graded against a population that cannot move under it: bound the window or hold it still, never a tolerance

`tests/live/claims.live.test.ts`'s set-equality proof (TASK-0074: the windowed
claims read and the id-list join select the same claims) reddened 3 of 5
consecutive runs for one builder — 877 ids from the first read, 879 from the
second, the two extra carrying a uuidv7 prefix hours newer than the rest — and
was green twice for the next lane an hour later. Staging is written by the
scraper continuously; the test's two legs each carry a lower edge
(`.gte("observed_at", since)`) and an implicit upper edge of *now at the
instant that leg was issued*, so the population is different for each. **Ruled,
for every live test in this repo:**
1. **Where the test writes every query** (an identity or set-equality proof
   between two shapes), capture ONE instant at the top and give every leg the
   same explicit UPPER edge, ending strictly before now with a settle margin.
   Deterministic, no retry, and it sharpens the proof: what is compared is the
   two shapes, not the two clocks.
2. **Where one leg is the app's own read** and cannot take an upper edge (a
   rendered page against a test query), use `whileStill` in
   `tests/live/parity.ts` — already the ruled device for this class since the
   2026-09-02 `/cycles` 38-vs-39 finding — which reads before and after, hands
   the pair back only when the database did not move, and throws rather than
   passing when staging will not hold still.
3. **Never a numeric tolerance.** "±2 claims" cannot tell an insert from a
   drop, and it is exactly the slack that would have hidden BUG-0167, where the
   two legs of the same gauge diverged by a single claim out of 877. A live
   proof about the SHAPE of a read grades by identity or it proves nothing.
**The door this closes:** flakiness in this tier is never bought with a retry
loop around the assertion, a `--retry` flag, a skip, or a widened comparison.
It is bought by making the two reads address the same rows — which is a
statement the test can make in its own query — and a staging table that will
not hold still remains a fact the suite states out loud.

## 2026-09-10 — corollary to the live-proof ruling: what `whileStill` holds still is ONE read, and a snapshot never bounds a page render

The ruling above survived contact and was found incomplete on its second leg.
TASK-0075 put both `/claims` bucket-count cases on `whileStill` as rule 2
directs; QA then ran that file **13 times across two independent checkouts and
got 3 reds**, every one on a case the ticket had changed — two of them
`the database changed under this comparison on all 3 attempts (117 then 117
bytes)`. The device did not fail; the shape handed to it did. `whileStill`
reads, makes, reads again, and needs the two reads to agree, so **its
protection decays with the duration of the held read**: `bucketCounts()` is six
sequential count round trips, which holds a ~4 s comparison window open and
holds it open three times over, and a scraper cycle writes through every one of
them. `cycles.live` and `dashboard.live` hold one small read, which is the only
reason the same device works there. **Ruled, as a corollary and not a
replacement:** (1) the shape a `whileStill` holds still is **one round trip** —
one `select`, projected or tallied in TypeScript; the count that decides a
surface's kind is that read's own length, never a second count query, and no
held shape issues two queries. (2) A `whileStill` read is **bounded and refuses
above its bound** rather than truncating silently (PostgREST stops at 1,000
rows; the `/claims` view is at 877 today), the way the identity proof's cap
guards already do. (3) `attempts` may be raised to at most 5 at a call site
that has already done (1) — legal where a `--retry` flag is not, because
`whileStill` retries the PRECONDITION (did the database hold still) and never
an assertion outcome — but raising it is never the fix on its own. **The door
this closes:** the snapshot of rule 1 may NOT be extended to a page comparison
to make it deterministic. A page takes no upper-edge parameter, giving it one
would be product code written to suit a test, and bounding only the test's leg
is worse than useless — it freezes the detector while the page keeps racing,
converting an intermittent disagreement into a deterministic red that looks
like a product defect. Test-writes-every-query proofs take the snapshot; page
comparisons take one small unbounded read held still.

## 2026-09-10 — a state card belongs to the BLOCK that rendered it: a gauge surface's state is the state of its figures

`/cycles`' two gauges render an `Empty` card at a counted zero while the live
oracle grades them `emptyAtZero: false`, so `cycles.live` is deterministically
red on the run branch the day staging's resolver window empties (BUG-0169).
Both sides were deliberate and anchored — LESSONS 7 ("an empty set still
renders its labelled figure as a real 0") against LESSONS 3 / §4.3 ("an empty
surface is explained from two facts") — but only one of them can move. **Ruled:
the ORACLE moves, at the grain.** The component cannot: the card at zero is not
a choice `cycle-health.tsx` or `latency.tsx` makes, it is `Distribution`'s and
`TrendTable`'s own contract (§7, TASK-0030 — `rows: []` with no stated reason
is unwritable, and a header row over an empty body is unreachable by
construction), so "the component moves" means unwriting a shared primitive six
gauges obey in order to render the one thing §7 made impossible. And LESSONS 7
is not violated here in the first place: the labelled figures still render as
real `0`s beside the empty card — `tests/offline/cycles/page.test.ts` has
asserted exactly that since DEBT-0004 ("says the window held nothing when the
resolver has applied nothing": `readNumber(markup, "Applies in this window")`
is `0` over an empty `field_provenance`). What was false was the ORACLE's
claim about the SURFACE: `emptyAtZero: false` says "this surface never draws an
empty card", which no surface containing a distribution can honour. **The rule,
for every live oracle in this repo:** a surface's state is the state of the
read behind its FIGURES; a state card rendered by a block INSIDE it —
`Distribution`, `TrendTable`, `GaugeCard`, all three through `GaugeStateCard` —
belongs to that block and is excluded from the surface's kind (`stateOf`'s
`excluding`, the device `/queues` already uses for `[data-gauge-queue]`). The
marker is `data-gauge-block`, emitted by `GaugeStateCard` and by nothing else,
so a surface-level refusal (`StateOf`, which does not use it) can never be
silenced — the BUG-0036 failure mode, which is why the marker is on exactly one
component. **The door this closes:** the alternative fix — flipping
`emptyAtZero` to `true` — would have greened the file and left the class alive,
because it grades the surface `empty` at a counted zero and returns before
comparing anything, and it says nothing at all about the same card appearing
over a non-empty window (a distribution with no rows beside figures that count
rows). Under this ruling the surface stays `ok` at a counted zero and the
parity assertions RUN there, which is strictly more grading in the state that
reddened.

## 2026-09-10 — A page's leg notes reach the state or the press is refused; the client's own fetch refuses in the app's words

Two rulings in the paging plumbing, both decided below every surface so no
surface re-decides them. **First, the legs.** Browse is read by four queries —
one window for the rows, two legs that fill columns over that window's ids —
and its paging route already carries each leg's own report on the `ok` arm of
the answer. The driver did not: `PageState` had four fields and none of them
held a note, so the legs were dropped at the wire and `/browse`'s next ticket
was told to render something no state carried. `PageState` gains a `notes`
record; `isPageNotes` asks of that field exactly what `isPageAnswer` asks of
the body, and a `notes` this app cannot read **refuses the press naming the
route** rather than reaching a renderer; readable notes MERGE per leg across
presses. The alternatives, and why not: *appending the rows and dropping the
notes* is the silently-empty-column defect itself; *rendering whatever
arrived* puts foreign text inside a sentence this app wrote (common violations
row 15); *replacing rather than merging* loses the note while the half-filled
rows it explains are still on screen. The door this closes: a paged surface
never invents its own leg-report channel, never narrows or rewords a note, and
never shows a column emptied by a read that refused without saying which read
it was. **Second, the fetch.** `fetchJson` asked `response.json()` of whatever
answered, so an expired session — whose redirect is FOLLOWED to an HTML login
page at **status 200** — reached the operator as the JSON parser's own
`SyntaxError` vocabulary in the app's refusal slot. The discriminator is the
**declared content type**, not `response.ok`: the route answers a refused page
as JSON with a 400 to match and that body is the operator's own refusal, which
a status check would throw away, and the measured defect carries a 200 a status
check cannot see. A response that does not declare JSON, and a declared-JSON
body that does not parse, each reject with one app-authored sentence that
quotes nothing — not the type, not the status, not a byte of the body — and
`requestPage` names this app's own route as the object. The door this closes:
the client never derives a second account out of foreign text, and the one
place a reduction of a foreign document happens stays `errorMessage` in
`lib/db/result.ts` (BUG-0170) — a path this fetch never touches.

## 2026-09-11 — a paged surface's window line is a client statement, and its truncation verdict is the paging state's (architect, admin-window/BUG-0172)

QA measured both paged surfaces publishing two answers to one question after a
walk: `/browse` at `[data-paging="exhausted"]` with 120 rows drawn, under a
server-rendered line still saying earlier arrivals are not shown; `/claims` at
616 rows under "the 50 longest-waiting are below — the rest are not shown". The
cause is structural, not a builder's slip: §5's byte-identity amendment made the
first server screen immovable and the window line sits ABOVE the client wrapper,
so a press changes the rows underneath a sentence nothing can reach. **Ruled:
the line of a paged surface is ONE element rendered inside client-land** — a
zero-markup provider (`PagingProvider`, `src/components/ui/paging.tsx`)
publishes the press's state and a client line (`PagedWindowLine`) renders the
same shared `WindowLine` primitive with the facts the page composes, so the
first server render stays byte-identical while the sentence stops lying after a
press. `truncated` is `status !== "exhausted"` and nothing else, shared with the
control below it; `held` keeps each surface's own meaning (rows on screen on
`/browse`, the matching count on `/claims`, which a live oracle grades the paged
walk against); no `data-window-*` attribute is added, because an added attribute
is itself a first-screen change. **Two alternatives were rejected on the
record.** A second, client-rendered continuation line below the rows leaves the
false sentence where the operator reads it first and gives the page two
`[data-window]` elements, which `stateOf` and the absence sweep both grade as a
defect. Rewording the truncated clause ("the first screen shows…") does not
touch the hooks, where the contradiction is actually published — copy never
fixes a machine-readable verdict (LESSONS 11). The door this closes: no surface
in this app states a fact about a read in markup that the read's own later
answers cannot reach.

## 2026-09-11 — a live oracle is sized by its assertion, and `whileStill` is fixed by shrinking the make (architect, admin-window/TASK-0077, from QA's TASK-0075 residuals)

Staging holds 877 pending claims against PostgREST's 1,000-row ceiling and was
measured touching 887 in a burst; three helpers in `claims.live.test.ts` read
the whole view to tally it, so the file's every case refuses permanently the day
the view crosses the ceiling — a stored check of five tickets going red on a day
the product is fine. **Ruled:** an oracle's "whole" figure comes from the
database's own exact count taken on the SAME request as the rows (a count has no
ceiling; a second read is a second race), a row set is bounded by what the
assertion compares, and a per-group census counts instead of tallying rows; the
identity proof takes a day window measured to sit at half the cap and refuses,
with an instruction, at 80% of it. **On the paged walk:** no new device — a
smaller shape. `whileStill` decays with the DURATION of the make, and a 7–20 s
make (render + ~14-request walk + enumeration) cannot hold still against a
scraper that churns in bursts; more attempts buy more long windows. The walk
therefore runs a narrowing chosen at RUN TIME — the smallest matching set still
larger than one window — with the unnarrowed page keeping a first-screen +
one-press assertion. TASK-0075's "one round trip" rule is amended in one line:
what it protects is the still window's duration, so concurrent bounded counts in
one `Promise.all` are one wait and are permitted where a single read would have
to carry the whole table; sequential reads inside a held shape stay banned. No
tolerance, no `--retry`, no skip — 2026-09-10 rule 3 is untouched — but
exhaustion gains its own voice: `whileStill`'s message opens with a marker
naming the database as what moved, because an honest refusal and a product
defect otherwise arrive identically in a downstream lane's stored check.
**Accepted, and recorded so it is not copied:** `claims.live`'s `source_id` chip
case compares page labels to the sources registry outside `whileStill`; the
registry is 3 static rows, both sides are keyed on ids the page itself rendered,
and a new source arrives with a deploy rather than a scraper cycle. It carries a
comment stating exactly that, and refuses if that read ever comes back larger
than the small bound the comment names.

## 2026-09-11 — an account carries the DATABASE's words: the one derivation widens from "a document" to "not the database's own words", and BUG-0016's "stack frame included" is reversed (architect, admin-window/BUG-0173, from QA's BUG-0170 residuals)

BUG-0170 put the decision of what a failed read's account may carry in one
place — `errorMessage`'s part assembly in `src/lib/db/result.ts` — and anchored
it on one question: a part whose first non-blank character is `<` is a document
and is replaced by an app-authored, counted clause. QA then measured three ways
past it, all reachable from that same function: a 2xx non-JSON body becomes a
697–802 character `SyntaxError` STACK whose first line quotes `"<!DOCTYPE "`
(so it re-matches the very regex that ticket's pin asserts against) and whose
rest is absolute server paths; a JSON envelope with no `message` field crosses
whole through `messageOf`'s `JSON.stringify`, nested `<html>` and all; and a
transport failure puts `at GetAddrInfoReqWrap.onlookupall (node:dns:121:26)` on
the operator's card. **Ruled:** widen the ONE derivation rather than fix three
sites. The class is stated positively — an account carries the parts the
DATABASE authored — and it is decided by three anchored questions and no fourth:
did WE serialise this part (provenance; no text inspected at all), does it begin
`<`, does it carry V8 frame LINES (`at …` ending in `)` or `:line:col`). The
first two REPLACE the part with a counted clause that quotes nothing; the third
drops the frame lines only. **Doors closed, explicitly:** no scanning of prose
for a document fragment anywhere inside it, no entity decoding, no tag
stripping, no length cap on prose, no codepoint rules, and no matching on a
runtime's vocabulary (`SyntaxError`, `is not valid JSON`, `ENOTFOUND`) — that is
the blocklist-chased-one-family-at-a-time class (LESSONS 4, §7 common violations
row 15), and it is why the `SyntaxError`'s own one-line diagnostic, its
11-character quotation of the body included, is ACCEPTED as what crosses.
**What this reverses:** BUG-0016's residual was pinned as "carries the client's
whole account of a transport failure, untrimmed … stack frame included; trimming
it silently is the defect" (`tests/offline/dashboard/page.test.ts`,
`tests/offline/queues/page.test.ts`). What that ticket was protecting is the
CAUSE, which postgrest-js puts in `details` AFTER the first frame line — so the
cause still crosses whole (frame LINES are dropped, the part is never truncated
at the first frame), and the trim is not silent: the part says how many frames
went. `node:dns:121:26` and `node_modules/@supabase/postgrest-js/dist/index.mjs`
are the runtime's location, not the database's account, and an operator reading
a one-line refusal slot is owed the cause instead.

## 2026-09-11 — the http tier has no database and never will: a criterion may not ask it to prove a handler's own answer (architect, admin-window/BUG-0171 close; ARCHITECTURE §10, §13 rule 10, DEBT-0019)

`tests/http/**` builds and starts the real app with DB sentinels and no
`admin_allowed_emails`, so `requireAdmin()` — the first statement of every route
handler — fails closed on every gated request, signed-in or not, and a bare
`403` carries neither the handler's headers nor its body. BUG-0171's criteria
nonetheless demanded the new `Cache-Control` be asserted "over HTTP … on a
signed-in GET"; the builder discovered mid-lane that the clause is
unsatisfiable, QA reproduced it on its own server and discharged the claim by
hand against staging. **Ruled:** the tier keeps its design — giving it a
database or an allowlist would make it a second live suite with a credential
story, which is exactly what STACK.md §4 refused — and the CRITERIA change
instead. That tier may be asked for the gate's behaviour, for an ungated
surface, and for what Next puts on a page answer; a handler's own answer is
proved offline against a stub, and where the wire matters by a QA measurement on
staging recorded in the ticket's History, never as a stored check (a builder
lane can neither read `.env` nor mint a cookie). One corollary, recorded because
it is the trap: an ABSENCE asserted on that tier passes vacuously on the 403 —
the paging suite's "nothing either route puts on the wire is storable" would
have stayed green through the whole of BUG-0171's defect — so such a case
asserts the status it actually graded, and a harness that ever gains a database
reddens rather than silently grading something else.

## 2026-09-11 — one surface, one answer to "did the read establish completeness"

`/claims` reads its count and its rows SEPARATELY, so the two can disagree, and
BUG-0174 taught the window line to say so instead of asserting a relationship
no single read established. The sentence that REPLACES the paging control kept
asserting it: `PageMore`'s exhausted arm says "All claims in this view are
shown" byte-identically whether 130 of a count of 130 are drawn or 50 of a
count of 877 (BUG-0180). **Ruled:** the control's terminal sentences state what
the READ established and nothing more, and the fact that lets them do so is
derived ONCE — `readsAgree(info: DrawnWindow)`, lifted out of the window line's
`matched` arm and applied over the single `DrawnWindow` a page composes for its
line (`heldFrom` decides whose number `held` is; `truncated` is the driver's
status and nothing else). The verdict is handed to `PageMore` already decided.
The door this closes: the control may not ask the question itself. A count
plumbed into the widget so it can compare would give one surface two answers to
one question in the hooks — the shape of BUG-0172 and of LESSONS 11 — and the
size heuristic BUG-0174 deleted (`held <= limit ? drawn : held`) is exactly
what a second derivation grows back into. A surface with no second read
(`/browse`, `heldFrom: "this window"`) answers `true` by construction, which is
why its markup cannot move.

## 2026-09-11 — the em dash, and the difference between blank and absent

The app has one definition of blank (`hasVisibleContent`, `lib/verdict/
decision.ts`) and one definition of absent (`isAbsent`, `lib/format.ts`), and
they are NOT the same question: a lone em dash is ink to the first and nothing
to the second, which is the whole reason `orDash`/`nullDash` exist. Until now
the second lived in a module that imports React, so the pure leaves — the
bottom of the app, where `requestPage` decides whether a refusal carries words
— could ask only the first, and BUG-0184 is what that costs: a wire answering
`{kind:"refused", reason:"—"}` reached the operator as a red `role="alert"`
reading `—` plus "Press it again", the shape BUG-0176 criterion 14 was written
to remove, one input short. **Ruled:** `EM_DASH` and a new `isAbsentText` move
into the pure leaf `lib/verdict/decision.ts` beside `visibleContent`, and
`lib/format.ts` re-exports the constant and delegates `isAbsent`'s string arm,
so the leaf and the renderer agree by construction rather than by vigilance.
The doors this closes, both of them: **nobody re-types the character** — it is
spelled once in `src/`, guarded over the comment-stripped source, so the
second hand-spelling (`const DASH` in `components/edit-refusal.ts`) goes and a
third cannot arrive; and **nobody merges the two questions** — widening
`hasVisibleContent` to swallow the dash would have been the cheap fix, and it
would silently change which close notes the verdict form refuses and make a
source the registry NAMES `—` render as no name at all (`lib/sources/
names.ts`). Two questions, two predicates, one character, one home.

## 2026-09-11 — the account's foreign-text rule stops taking anchors and takes a bar

Seven tickets on one derivation (`errorMessage` in `lib/db/result.ts`:
BUG-0170 → 0173 → 0179 → 0181 → 0185 → 0182 → 0187), each one a different QA
lane measuring the shape the previous ruling's anchored question did not
reach, and each repair colliding with the twin the previous ruling had pinned.
BUG-0182 grouped a run of consecutive document lines into one clause; BUG-0187
then measured a WAF interstitial served with its TEXT on its own lines, where
the run ends at every text line — part 402 characters → account 664, growth
linear in the page's text nodes (64 nodes → 6,881 characters), with "Sorry,
you have been blocked", a Ray ID and an IP crossing verbatim into the operator
card and the PATCH route's JSON body. The obvious repair (a non-document line
between two document runs belongs to the document) is the exact inverse of
BUG-0182's over-grouping twin, and one predicate cannot tell the two apart.
**Ruled:** stop anchoring and state the bar. **The PART is the unit: a part
that carries a document ANYWHERE is not the database's words, and is replaced
whole by ONE clause counted at the length of the part as the client delivered
it** — no line of it crosses, no frames clause, no second clause. Question 2
is asked once per part; the per-line and per-run document question, the
`PartLine` offsets and the run bookkeeping are deleted, so the derivation ends
this chain smaller than it started and the two granularities that have
disagreed since BUG-0179 become one code path.

The justification is provenance, not shape-chasing: Postgres does not speak
markup, so a part carrying markup was authored by something that does and no
line of it is attributable to the database. The suite's own fixtures are the
evidence — every prose line the landed rule let cross beside a document is the
intermediary's (`reference 8f3c1` is a WAF reference id; `upstream said:`;
`edge-cache-status: refused`), and there is no fixture anywhere of a Postgres
message sharing a part with markup. Six landed assertions that blessed such a
line crossing are inverted by name in BUG-0187's criteria, so no builder has
to judge a QA pin.

**The doors this closes:** the eighth anchor (no tag matching, no entity
decoding, no length cap, no vocabulary ever arrives on this path), and the
per-field exception. **The doors it deliberately leaves open, decided here so
they are not re-litigated:** a MULTI-LINE database message still crosses whole
(Postgres wraps its own DETAIL; counting it would replace a check-constraint
message with a number); a part carrying FRAMES still gives up its non-frame
lines (the transport cause sentence `Caused by: … ENOTFOUND` is what BUG-0016
exists to preserve, and V8's frame format is specified, unlike a family of
adversary text); and markup GLUED AFTER PROSE ON ONE LINE is not caught,
because the only predicate that would — `part.includes("<")` — is refused by
the database's own `operator does not exist: text <-> integer`. The accepted
cost of the bar, stated plainly: a real Postgres message whose wrapped line
happened to begin `<` would be counted instead of quoted, and a part carrying
a document plus a stack is counted at a number that includes the stack. Both
are bounded, both keep the read's name and the account's other parts, and both
err in the direction this campaign chose in BUG-0170. Evidence of a real body
in the glued-mid-line shape re-opens THIS BAR as a ruling — it never adds a
fourth question.

## 2026-09-11 — the queue-health live case is retry-free because `review_items.status` has no writer, and that is a dated fact, not a property

TASK-0070 made `/queues`' queue-health gauge publish BOTH edges of its window
(`[since, until)`) and `tests/live/queues.live.test.ts` count the interval the
page states rather than one it resolves for itself, which is why that case
carries no `whileStill` retry: a row the reviewers file mid-test carries
`opened_at = now()`, at or after `until`, so it is outside both legs and the
two paths meet on one closed interval (`tests/live/parity.ts`, `snapshotAsOf`).
**That argument covers `opened_at` and nothing else.** The per-slice figures
the same case compares are `status = 'open'` counts, and a status that MOVES
between the page's render and the test's count changes one path and not the
other, whatever the `opened_at` bounds do — a shared upper edge on the
insertion time cannot make a mutable column deterministic.

Recorded because QA named the reason the case is safe anyway, and it is a fact
of this build rather than of the design: **nothing writes `review_items.status`
today.** Admin's only direct write is `walk_sandbox` (`src/lib/edit/config.ts`,
regime `sandbox`), `settle_review_item` is not installed on staging (M2's §9
handoff, still awaiting Ben), the verdict path is `override`-shaped and
item-less, and the scraper does not touch the column. The status column is
immutable in practice, so the open counts cannot move under the comparison.

**The trigger, stated so the next reader does not have to re-derive it: the
first writer of `review_items.status` — the installed `settle_review_item`,
any settle/verdict surface built on it, or a reviewer tool in the sibling —
re-opens this.** On that day the per-slice open-count legs of
`tests/live/queues.live.test.ts` (and the equivalent open counts in
`tests/live/review-item.live.test.ts`) need the treatment `snapshotAsOf`
already describes: one explicit upper edge shared by every leg, or `whileStill`
where a leg cannot be given one. The window LENGTH assertion and the
`opened_at` population count are unaffected either way. No retry is added now:
a retry written against a stationary column hides the day it starts moving, and
this entry is the cheaper record.

## 2026-09-11 — a narrowing clause names a facet's EFFECT, never its presence; and the two questions get two words

QA's residual on BUG-0191 measured the same chip getting two opposite verdicts
on `/claims` staging: `?source_id=<ticketmaster>` — a source the whole view
carries — removes zero rows, the bucket caption takes its unnarrowed arm and
says "nothing above narrows these counts" with that chip standing active;
`?source_id=<ticketmaster>&domain=events` draws exactly the counts
`?domain=events` draws alone, and the caption says "under the filters above".
Both sentences are true of their own reading — the first of EFFECT, the second
of PRESENCE — and the page is answering one question two ways because
`bucketsNarrowed` (two facts, `isSurfaceNarrowed`) and `hasChipNarrowing` (a
`!== undefined` over `CHIP_FACETS`) are ANDed as though they were the same
question about the same subject. They are not: the first is about the whole
filter's effect on this surface, the second about whether a control is set.

**Ruled, for every surface: a clause that attributes a narrowing — to a control
("under the filters above", "matching these filters"), or to a named facet — is
a claim about rows THIS read lost, and may be rendered only where that
subject's own effect is established. Presence of a facet is never evidence that
it narrowed anything.** It is the same rule BUG-0129/0131/0133 and DEBT-0008
already settled for the surface as a whole, applied one level down, to the
subject a sentence points at. The converse arm is unaffected and stays exactly
as `isSurfaceNarrowed` leaves it: where a surface's rendered set equals its
population, NO facet in force removed anything — that is free and provable, so
"nothing above narrows these counts" is the true sentence at `?source_id=<a
source the view carries anyway>`, and TASK-0071's `everyBucket` clause remains
the way a standing chip is stated rather than denied.

A clause that merely states WHAT THE READ CARRIED — the control-less phrases
BUG-0160 added, "in the events domain" — is not an attribution and keeps its
presence gate. One clause never does both jobs.

**The effect of a FAMILY of facets is cheap, and that is what the chip clause
needs.** Its subject is the chip bar collectively, not one chip: where the only
facets in force are chips, the surface's own two-fact answer already IS the
chip family's effect (free); where only control-less facets are in force the
clause is not said at all (free); the single ambiguous state is both families
in force, and there one bounded `head: true` count over the same read with the
chip facets dropped settles it (§4.3's own allowance, BUG-0135's shape). On
today's `/claims` that state is `?source_id=…&domain=…` and nothing else.

**Where the ruling lands.** Not in TASK-0072: that ticket is a
declared-zero-rendered-bytes contract change (the scope array, the vocabulary's
one home) and this changes which arm renders at `?source_id=…&domain=…`. Filed
as BUG-0192, chained AFTER TASK-0072 rather than before it — the "truth first"
ordering BUG-0191 took applies where the fold would otherwise re-home a false
sentence's DERIVATION, and here the fold is mechanical and its byte-identity
baseline is the caption BUG-0191 already corrected; going second buys the fix
one home to land in (`src/lib/url/narrowing.ts`) instead of a predicate written
in `lib/claims/filters.ts` and moved again the same week.

**The vocabulary half IS TASK-0072's**, because it is a rename and renders
nothing: `hasChipNarrowing` answers presence and says "Narrowing", which is the
word the effect question owns (`isSurfaceNarrowed`, `claimsNarrowed`). It
becomes `hasChipFacet` — the same shape as `hasNarrowingFacet`, which keeps its
word because fact 1 is a question about the FACET VOCABULARY ("can a facet of
this kind remove a row at all"), not about this read's rows. Two questions, two
words, before a third predicate joins them.

## 2026-09-11 — a section may not narrow rows its read did not; on `/sources` the scope is fixed at the READ

BUG-0194 (QA, out of TASK-0073's close): `/sources`' settled-values section
carries one source's figures under a sentence, and two card labels, byte
identical to the fleet's — `readRejectionStampGauge()` takes no facet and
`RejectionSection` narrows the rows it reports. Two fixes were available and I
am ruling for the read: `readRejectionStamps` gains the facet at the query
(mirroring `readPendingObservations(bounds, filter, db?)`), the page hands one
filter expression to both the read and `scopeOf`, and the line names it by the
one home. The alternative — leaving the fleet scan and scoping the card labels
— was rejected because it repairs the words and leaves the NUMBER: under a
truncated fleet scan, one source's figure is that source's rows *among the
fleet's 1,000 most recent*, an arbitrary subset (§4.3 read kind 2's forbidden
shape) wearing a `floor` earned by other sources' rows (BUG-0114). The third
option, dropping the narrowing so the fleet's figures stand under the fleet's
line, reverses BUG-0022 and reds two green pinned cases; it is off the table.

**The door this closes, and it is the general one:** when a rendering and its
read disagree about scope, the scope is fixed ONCE, at the read, and the
rendering follows — never the other way, and never at whichever end broke last.
This page has now paid for that rule twice in opposite directions (BUG-0022
narrowed the rendering under an unnarrowed read; BUG-0194 narrows the read
under it), which is LESSONS 4's "widened by whichever one broke last" wearing a
scope costume. The cost accepted out loud: a narrowed scan reaches rows the
fleet's capped window had pushed out, so live figures CAN move where the fleet
scan truncated. They move toward truth. Nothing moves today — staging holds 0
rows in the 90-day rejection window and the offline fixtures are far under the
cap, so only the words change. `RejectionSection` keeps re-selecting the rows
it was handed (the `selectPendingClaims` idiom): the query narrows, the section
selects again, and neither is the other's excuse.
