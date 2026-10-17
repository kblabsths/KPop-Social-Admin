# External ticket done — the live tier is a read-only contract smoke (2026-10-16)

*From an agent working outside the factory, against
`agenticflow/tracker/for-human/external-ticket-live-tier-read-only.md` and
Part A of `agenticflow/tracker/proposals/2026-09-16-testing-rules.md` §3.
Branch `external/live-tier` off `run/admin-window`, merged back with
`--no-ff`; the checkout is left on `run/admin-window`. Nothing pushed,
`main` untouched.*

**Merge commit on `run/admin-window`:** `2e49afea20fcd9b6b9a73243a141e9763e6af03c` (the note itself is the commit after it, on `run/admin-window`)

## Before / after

| | files under `tests/live/` | live test files | cases | wall time (`npm run test:live`) |
| --- | --- | --- | --- | --- |
| before (2026-09-16, measured by the ticket) | 15 (11 oracles + `parity.ts`, `sweep.ts`, `setup.ts`, `staging-target.ts`) | 11 | 117 | **not re-run here** — the before suite carried writers (`edit.live`'s sandbox PATCHes and `resetSandbox`, `harness.live`'s two `.rpc()` doors) and the standing rule is that nothing I run writes staging. The last recorded whole-suite figure is the M3 verifier's (`for-human/M3-verifier.md`, EC1): the suite **exits 1** on two of two full runs because one `edit.live` case times out at **60 s** under eleven-file parallelism (45.6 s solo); per-file receipts in `tracker/receipts/` run 3–65 s each. |
| after, run 1 | 3 (`contract.live.test.ts`, `setup.ts`, `staging-target.ts`) | 1 | 10 | 3.34 s vitest / 3.95 s wall |
| after, run 2 (immediately after) | 3 | 1 | 10 | 2.10 s / 2.65 s wall |
| after, run 3 (immediately after) | 3 | 1 | 10 | 1.99 s / 2.54 s wall |

Three consecutive green runs, no state dependence: every case asserts a
SHAPE of the service's answer, and the one set a case reasons about is one it
invented (a random address no allowlist row holds).

Offline after: 81 files / 4052 cases green (`npm test`, 13.2 s), isolated
1 / 8 green (38.0 s). http: 6 files / 37 cases green (`npm run test:http`, 14.8 s). `tsc --noEmit` clean, `npm run lint`
clean. `grep -rlE "\.(insert|upsert|update|delete)\(" tests/live` → nothing.

## The ten cases of `tests/live/contract.live.test.ts`

Each opens with `// LIVE BECAUSE:`; all through the app's own
`getDbClient()` and its authenticated fetch, pointed at the declared target
by `setup.ts`:

1. `{ count: "exact" }` over `limit 0` → a total, `[]`, no error, 200/206;
   over a matching set of ZERO → 200 with 0; on the wire the total rides
   `Content-Range`.
2. an absent relation → 404 carrying `PGRST205` naming it; `classify` →
   `not_provisioned`.
3. a HEAD of an absent relation → 404 with NO body; the same question
   head-shaped through the client → `204, error null, count null` (the
   blindness `countRead` exists to avoid).
4. `.maybeSingle()` over no rows → `data null, error null, status 200`.
5. a select naming an absent column → `42703`/`PGRST204`; `classify` →
   `not_provisioned` naming the table.
6. an `ilike` over a timestamp column → `42883`, which a TABLE read
   classifies as `error`, never a function absence (the stub's
   `missingOperator` collision, kept real).
7. the OpenAPI description at the REST root lists `/rpc/settle_review_item`
   and `/verdicts`; `readFunctionInstalled` agrees.
8. `requireAdmin()`'s allowlist read answers a row set shaped `{ id }`.
9. the two population filters `/queues` spells (`eq(queue)` + `is null` /
   `not is null`) parse on the host and answer totals.
10. the EMPTY decision sent to `settle_review_item` is refused `KS029`;
    `classify(…, "function")` keeps it an error. Confirmed read-only from
    the function body (`kspace Scraper/supabase/migrations/20260908000002_the_verdict_settles_the_item.sql`,
    read 2026-10-16): the envelope checks — `jsonb_typeof`, the key set,
    `action` — are the first statements of the body and each is a `raise`
    with `errcode = 'KS029'` ahead of the first `select … into`; `{}` fails
    the `action` check. The guard allowlists exactly that call shape.

## The guard (`tests/offline/live-guard.test.ts`, "the live tier: one read-only contract smoke")

Rules over `tests/live/`, each proved red on planted TEXT in-suite and then
run over the real directory: no `.insert(`/`.upsert(`/`.update(`/`.delete(`,
no `method: "POST|PATCH|PUT|DELETE"`, no import from `tests/walk/`, no
`.rpc(` other than the allowlisted empty-decision refusal; every `it(` in a
live test file has a `// LIVE BECAUSE: <reason>` in the comment block directly
above it; the directory is exactly `contract.live.test.ts` + `setup.ts` +
`staging-target.ts`; at most ten cases.

**Watched red once on a real plant** (then removed; the file is byte-identical
to its backup): an appended `describe` carrying
`getDbClient().from(ALLOWLIST).insert({ email: "planted@…" })` inside an `it`
with no `LIVE BECAUSE`. `vitest run --project=offline tests/offline/live-guard.test.ts`
→ `Tests 3 failed | 58 passed`:
`× carries no write-shaped call …` (naming
`contract.live.test.ts: write-shaped: await getDbClient().from(ALLOWLIST).insert(…)`),
`× explains every case with a LIVE BECAUSE line` (naming
`contract.live.test.ts:244: it("writes a row with no reason given" …`), and
`× stays within its budget of ten cases` (the plant was an eleventh).

Dropped from the guard with the machinery they graded: the parity/count/
sweep/`whileStill`/`gradeSurface` sections (their subjects are deleted) and
the positional-selector ratchet (no live oracle addresses a surface any
more). Kept: the staging-target declaration and refusal cases, the
`npm run test:live` refusal-in-a-child-process case, and the state
classifier / `surfaceHooks` / `readNumber` cases — those helpers survive.

## Which offline cases absorbed which live assertions

The pure markup readers the page twins import (`readNumber`, `stateOf`,
`surfaceHooks`, `oneEach`, `pageStates`, `assertState`) moved verbatim from
`tests/live/parity.ts` to **`tests/fixtures/surface-state.ts`**; ten offline
files changed one import line each. Everything else in `parity.ts`
(`independentClient`, `exactCount`, `countRows`, `assertParity`,
`gradeSurface`, `whileStill`, `objectIsAbsent`, `functionsOnStaging`,
`renderPage`, `snapshotAsOf`) and all of `sweep.ts` was live machinery with
no consumer left, and is deleted.

Per deleted file (case → the offline case that pins the same page/library
logic against a fixture the test owns; titles are the `it` titles):

**browse.live (7)** — all → `tests/offline/browse/page.test.ts`,
`browse-read.test.ts`, `views.test.ts`, `tests/offline/paging/{browse-route,machine}.test.ts`,
`tests/offline/order/newest-first.test.ts`: surface hook → "gives the events
surface exactly one element, in every state"; newest-first → "renders the
newest arrival first" / "returns the rows newest-first by arrival, not by the
calendar" / "is a TOTAL order…"; window cap → "publishes the read's own facts,
and says the window did not fill" / "says the window filled its cap…"; cell
values → "renders every spot-verification column, sources included", "shows
the venue name from the listings view", "states the scheduled time in UTC…",
"links every row to its own record surface"; sources cell → "shows the source
names the provenance join resolved", "does not name a superseded source…";
paging → "one press issues one request at an explicit bound…", "continues
where the screen ended" (route), "drops a row the screen above already holds,
and draws every id once" (machine); three-walk stability → "walks a population
that moves once mid-walk…", "breaks a tie on the id, so two rows never swap".

**claims.live (19)** — → `tests/offline/claims/{page,read,filters}.test.ts`,
`tests/offline/gauges/{pending-claims,bounded}.test.ts`,
`tests/offline/paging/{claims-route,machine}.test.ts`,
`tests/offline/sources/names.test.ts`, `tests/offline/absence/in-window.test.ts`:
two-shape identity → "produces the same aggregate, figure for figure…", "PIN
admin-window/BUG-0167: at the cap, a tie on the boundary instant…"; count ↔
scan window → "counts the population the scan beside it draws, over one bounds
object", "counts [since, until)…"; hooks → "gives each surface its own one
element, on both tabs and in every state"; bucket counts (bare, per source,
per spelling) → "counts each bucket exactly as the view holds it" (+ "…per
source filter", "…per domain filter"), `it.each(SPELLINGS)` "renders the same
claims as the canonical spelling, for %o"; window → "draws at most the
window's rows…", "draws the LONGEST-WAITING claims…", "states the cap and the
number of claims it holds back"; standing tab → "windows the standing tab's
list the same way", "renders exactly the standing_disagreement claims";
figure labels → "prints each bucket's two figures under a label saying which
kind it is"; parked bucket → "appears nowhere in the markup, under any filter
or tab", "is answered by every page without ever echoing it"; source names →
"says the registry's name in the SOURCE cell, and still narrows by the id",
"names the chips exactly as the same facet on /sources does"; paging → "continues
where the screen ended: no row repeated, none skipped", "pages the SAME order:
two windows meet exactly…", "answers a page past the end with zero rows…".
**Dropped under rule 1, not absorbed** (they were facts about staging's data,
not about the app): "pending_claims carries observed_at" (the view's column is
the scraper's contract; the app's select of it is pinned by "is ONE request
that asks the database for the order and the bound"), "holds no row in the
view either" (the parked bucket's staging population), "pending_claims holds
exactly one row per observation_id" (the view's key shape; the page's
tolerance of a duplicate is "drops a row a PAGE carries twice, whatever the
route answers").

**cycles.live (7)** — → `tests/offline/cycles/{page,read}.test.ts`,
`tests/offline/gauges/{cycle-health,resolution-latency}.test.ts`: hooks →
"gives each surface exactly one element, in every state and under a facet";
newest-first → "renders every cycle, newest first by started_at"; counts and
error lines → "renders all eight counts, thousand-separated, as their own
columns", "renders error_summary inline and verbatim"; cycle states → "makes a
running, a skipped and a completed cycle each legible as itself", "shows a
cycle that died as dead…"; `?cycle=` mark → "marks the cycle a Dashboard link
asked for, and says so when it is not here"; cycle-health → "renders its
window, its counts and its outcome spread", "reports an empty window as zeros
for counts and NULLS for figures"; latency split → "counts the applies, and
never the raw window it read", "splits every row read into exactly one
population, per domain and overall".

**dashboard.live (10)** — → `tests/offline/dashboard/{page,read}.test.ts`:
hooks → "gives each surface exactly one element, in every state"; open
decision/signal counts → "renders decision and signal counts as two separate
figures", "counts the open items per kind through the complete read"; open
only → "counts open items alone — a settled item is browsable, never
attention"; oldest open → "shows the oldest open item's age, with the absolute
instant in the title"; cycles panel order/counts/window → "renders the cycles
the read returned, in the order it returned them", "renders each cycle's own
counts…", "never renders more lines than the window it asked for"; last
applied → "states the age of the cycle that applied, not of the newest cycle",
"says plainly that nothing was applied, and still shows the cycles", "asks the
database for the newest cycle that applied something, one row"; runs panel →
"renders the runs the read returned, in the order it returned them", "shows a
run's source, when, outcome and error — and no other run column".

**runs.live (10)** — → `tests/offline/runs/{page,read}.test.ts`,
`tests/offline/cycles/page.test.ts`: order → "renders every run, newest first
by started_at"; nine columns → "renders exactly the nine ruled columns, in the
ruled order", "shows no tenth column…"; cells → "renders all three counts as
their own figures, thousand-separated", "renders failure_class verbatim, and
the dash where the run named none"; in flight → "makes a run still in flight
legible as one…"; `?source=` → "narrows the runs half to that source name",
"matches by name rather than by key", "renders the empty state with a stated 0
when the name matches nothing", "says the facet applies to the runs half, and
narrows none of the cycles"; `?run=` → "marks the run the link named, and
links its id to that very row", "says a run id no row in the window holds is
not here, and marks nothing", "names a ?run= that is not a run id as a
parameter it did not apply".

**queues.live (13 → 14 at run time)** — → `tests/offline/queues/{page,filters,verdict-log}.test.ts`,
`tests/offline/gauges/queue-health.test.ts`, `tests/offline/review/shapes.test.ts`:
open counts → "shows each queue's open count under its own figure"; split →
"splits the population by kind, with nothing in both and nothing dropped";
order → "renders each queue open first, then severity, then age"; facets →
the generated "renders exactly the items matching queue=…/status=…/shape=…"
cases, "combines facets with AND"; queue-health → "renders one slice per
queue with the open count that queue holds", "reads review_items with an
explicit window and an explicit cap"; verdict log → "draws the card naming
verdicts and states no window (PGRST205)", "renders every verdict of the
window, newest first"; tabs → "offers both tabs on both tabs, exactly one of
them current"; population → "treats a count the database never gave as a
refusal, never as a zero", "reports the refusal on its own sub-surface…" —
and the one thing no stub can grade, whether the host PARSES the population
filters, is contract-smoke case 9; `?source_id=` → "renders exactly the items
of the source the URL names, in both blocks", "renders the honest empty for a
registered source no item carries…", "names a source_id it could not use,
narrows nothing by it, and never errors".

**sources.live (8)** — → `tests/offline/sources/{page,read}.test.ts`,
`tests/offline/gauges/{pending-claims,bounded}.test.ts`,
`tests/offline/absence/pages.test.ts`: hooks → "gives each surface exactly one
element, in every state and under a narrowing"; registry rows → "renders every
source the registry holds, in the read's order", "renders each source's
lifecycle, tier, kind and checkpoint verbatim"; last run by name → "matches
each source's last run by NAME", "renders a source that has never run as the
dash…"; narrowing → "narrows this page to one source, and back out again";
awaiting-row trend → "counts each source's awaiting-row claims, and nothing
else's"; re-rejects → "counts each source's re-rejects and adjudications
separately"; window lines → "names the narrowing each scan carried, and names
it in no line whose read did not"; no threshold → "draws no threshold line
while the dial is unreadable".

**review-item.live (12)** — → `tests/offline/review-item/{page,read,close-slot,signal-actions,verdict-inline}.test.ts`,
`tests/offline/review/{shapes,one-place}.test.ts`, `tests/offline/ui/evidence-pair.test.ts`:
hooks → "gives each surface exactly one element, in every shape and every
state", "renders no surface at all for the two whole-page refusals"; evidence
→ "renders them in the item's stored fold order", "names an id that resolves
to no claim instead of dropping it"; per-shape view → "renders three distinct
views over the same anatomy"; canonical card → "takes the LATEST decision, by
applied_at then provenance_id"; header, no control → "carries the summary,
the severity, the age and the fold count", "renders no control at all, on any
shape"; close → "renders the not-provisioned state naming the object, and no
control at all", "renders the note field and this shape's controls, in the
list's order"; signal item → "leaves the signal item's own anatomy exactly as
M1 shipped it", "are exactly two of the eight action names, in spec §7's
order"; render settles nothing → "makes no rpc call to find out, on either
world", "settles through exactly one call site, and it is the seam"; source
name → "names the source in both header links, in the evidence table's own
words"; verdict block → "renders no verdict block at all, in either
database", "carries the action, the actor, the note, when, and the
observation's link".

**edit.live (18 → 26 at run time; the writer)** — the envelope and every
refusal RENDERING are pinned in `tests/offline/edit/{route,config,records}.test.ts`,
`tests/offline/records/{page,submit,provenance}.test.ts`,
`tests/offline/ui/editable-cell.test.ts`, `tests/offline/verdict/{seam,decision}.test.ts`,
`tests/offline/walk/reset-sandbox.test.ts`: struck tables → "refuses both
tables Ben struck, 404, naming the table, on every column their allowlists
carried"; unmapped column → "refuses a column of a resolver-owned table the
map does not carry, 403, naming the field"; override arm → "makes exactly one
settlement call, and no direct write", "answers 503 naming what is absent,
which is the normal case", "refuses a clear rather than sending an override
that says nothing", "carries the override envelope exactly, and nothing
else"; readiness states → "renders a resolver-owned table read-only when the
override path is absent", "never calls the settlement function to find out
whether it is there"; mapped columns/values → "draws a line per mapped
column, with the value the read returned"; provenance → "names the source and
the age of the value beside the field", "leaves a field the log says nothing
about as the absence"; venue reference → "names each reference the fact the
decision log spells, not the column"; sandbox write path → "reaches the
writer with the map's own config", "answers 200 with the record it wrote",
"issues one update on the right table, keyed by the primary key", "probes,
clears every row, seeds the fixture, and reads it back"; types → "carries a
number and a boolean as themselves, not as text", "reports the value the
database actually kept, not the one typed"; clears → "still clears a column
on an explicit null or an emptied input", "carries an explicit null when the
field is cleared, never an absent key"; not-null / type refusals → "names the
column a not-null refusal is about, out of the refusal's own words", "says
what to type when the database refused the value's TYPE", "derives a
different fix for each of the three refusals, none of them the fallback";
invisible pastes → "refuses an invisible-only value as the clear it is, not as
an override", "commits a draft with anything visible in it, byte-identical
but for its ends"; absence branch → "refuses an absent table having written
nothing, whichever code says so". **Not absorbed, by rule 2:** the real
Postgres coercion of typed text and the real `23502`/`22P02` sentences need a
write; the stub's typed copies of those sentences are what the fix derivation
is graded against. The `recordVerdict` oracle device was the live file's own.

**harness.live (7)** — repointing/reachability → the contract smoke IS the
reachability proof (every case reaches the declared host) plus
`tests/offline/live-guard.test.ts` "resolves the host and the ref when the
declaration matches"; GET vs HEAD count → contract cases 1 and 3,
`tests/offline/db/result.test.ts` "reads a count, and refuses a null count
instead of reporting zero"; function absent by the database's own account →
contract case 7, `tests/offline/db/schema.test.ts` "answers ok when the
description lists it, and not_provisioned naming it when it does not"; the
`.rpc()` DOOR to an absent function → **deleted, not replaced** (a procedure
call; its `PGRST202`/`42883` classification is pinned on fixtures by
`tests/offline/db/result.test.ts` "returns not_provisioned when the FUNCTION
is not in the schema cache" and `tests/offline/verdict/seam.test.ts` "answers
not_provisioned naming settle_review_item on PGRST202"); readiness seam →
`seam.test.ts` "probes the function by READING the schema description, never
by calling"; `42883` on a table read → contract case 6 and `result.test.ts`
"never calls a PROVISIONED table absent because a TABLE read raised 42883".

**residue.live (6)** — carried no writer (its "sweep" was `ilike` counts), but
exists only because tests once wrote; moot under rule 2 and deleted whole. Its
two pure guards (`assertSomethingToSweep`, `assertSweptSomethingWritable`)
guarded the sweep and go with it; its `42883`-on-timestamptz observation is
contract case 6; "names a target the sweep could actually have written to" →
`live-guard.test.ts` "never leaks the key into a refusal".

## Deleted files

`tests/live/browse.live.test.ts`, `claims.live.test.ts`, `cycles.live.test.ts`,
`dashboard.live.test.ts`, `edit.live.test.ts`, `harness.live.test.ts`,
`queues.live.test.ts`, `residue.live.test.ts`, `review-item.live.test.ts`,
`runs.live.test.ts`, `sources.live.test.ts`, `tests/live/parity.ts`,
`tests/live/sweep.ts`. Kept: `tests/live/setup.ts`, `tests/live/staging-target.ts`
(the guard; `tests/walk/reset-sandbox.mts` still imports the latter).
`tests/walk/**` is untouched and reachable from no `npm run test:*` script
(`tests/suite-globs.ts` matches none of it).

## Tracker checks that name deleted files (nothing edited; for the factory)

`grep -rlE "test:live|tests/live|\.live\.test\.ts|live/(parity|sweep)\.ts"`
under `agenticflow/visions/admin-window/tracker/tickets` and `…/archive`:
**228 files**, 207 of which name a deleted file by name. In the OPEN
`tickets/` directory (20): BUG-0164 (`queues.live`), BUG-0212, BUG-0213,
BUG-0214 (`parity.ts`), BUG-0216 (`claims.live`), BUG-0217, BUG-0220,
BUG-0221 (`browse.live`, `claims.live`), BUG-0222 (same), BUG-0223
(`edit.live`, `parity.ts`), BUG-0226 (`browse.live`, `claims.live`), BUG-0228
(`harness.live`), BUG-0234 (`claims.live`), BUG-0235 (`claims.live`,
`harness.live`, `queues.live`, `review-item.live`), TASK-0060
(`sources.live`), TASK-0061, TASK-0082 (`claims.live`), TASK-0084
(`sweep.ts`, `residue.live`), TASK-0085 (`edit.live`, `sweep.ts`,
`residue.live`), TASK-0086 (`edit.live`, `sweep.ts`, `residue.live`,
`review-item.live`). The archive carries the other 208 (every closed M1–M3
ticket whose Checks block ran a `tests/live/<page>.live.test.ts`). A stored
check of the form `npm run test:live -- tests/live/<name>.live.test.ts` now
exits non-zero with "No test files found"; `npm run test:live` bare is green.

## Part A — files edited

- `README.md`: the `npm run test:live` row, a "Testing" section under the
  script table with the four rules and the proof-vs-test distinction verbatim
  from the proposal's §1–§2. One formatting deviation, deliberate: the dead
  path `tests/live/settle.live.test.ts` in §2 is unbackticked, because
  `tests/offline/shell/shell.test.ts` ("names only paths that are in the repo")
  reddens on a backticked path that does not exist — the sentence is
  verbatim, the token is prose.
- `agenticflow/docs/vision/ARCHITECTURE.md` §10 (real path
  `agenticflow/visions/admin-window/docs/ARCHITECTURE.md`): the four rules as
  contract at the top of the section, "the live tier is
  `tests/live/contract.live.test.ts` alone", and a sentence marking the
  earlier live-oracle bullets as history. The bullets themselves are left in
  place (not rewritten).
- `agenticflow/docs/DECISIONS.md`: dated entry 2026-10-16 (Ben's ruling of
  2026-09-16): the four rules, proof vs test, the one-file live tier, the
  deferral of a release-time live suite on a disposable database.
- `agenticflow/docs/STACK.md` §5 (real path
  `agenticflow/visions/admin-window/docs/STACK.md`, architect-owned): the
  **two live rows only** — the live-suite row reworded, the residue-sweep row
  deleted. §4's "Every live test sweeps every row it wrote (acceptance test
  13)" bullet is now stale and was NOT edited (outside the two rows).

## For Ben (not touched by this ticket)

1. `.claude/agents/qa-adversary.md` and `.claude/agents/verifier.md` — the two
   brief lines from the proposal's §3 (Ben installs).
2. `agenticflow/docs/vision/VISION.md` (frozen, campaign closed) and
   `../builds/admin-build.md` — "proven" → "walked and recorded" in the
   acceptance list.
3. Anything under `../` (Ben's root docs).

Also noted, not done: ~20 doc comments under `src/` still point at
`tests/live/parity.ts` or a deleted `<page>.live.test.ts` (e.g.
`src/lib/db/schema.ts:23`, `src/lib/db/result.ts:1544`,
`src/components/ui/section.tsx:15`); comment-only, product code untouched.
