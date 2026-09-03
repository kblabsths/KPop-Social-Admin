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
