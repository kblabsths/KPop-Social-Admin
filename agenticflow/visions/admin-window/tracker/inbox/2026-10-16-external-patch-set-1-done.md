# External ticket done — patch set 1: TASK-0083, BUG-0236, BUG-0235, TASK-0082 (2026-10-16)

*From an agent working outside the factory, against
`agenticflow/tracker/for-human/external-ticket-patch-set-1.md`, with the
dispatcher's four state corrections of 2026-10-16 (testing rules bind; the old
live files are gone; the offline suite was pruned; a stored check may name a
case that no longer exists). Branch `external/patch-set-1` off
`run/admin-window`, merged back with `--no-ff`; the checkout is left on
`run/admin-window`. Nothing pushed, `main` untouched, no ticket file edited,
`run.yaml` and `.env.example` untouched, no `.env` value printed, nothing
written to staging.*

**Merge commit on `run/admin-window`:** `585517ebfc89f30f4dbe58a62feb8eb2959368e0`
(this note is the commit after it).

| ticket | commit | files |
| --- | --- | --- |
| TASK-0083 | `91c38eb9` | `README.md` (+4 −2) |
| BUG-0236 | `d3508a6d` | `src/lib/gauges/settled-values.ts`, `tests/offline/gauges/settled-values.test.ts` (+50 −4) |
| BUG-0235 | `ebc7f4a5` | 27 files, comment-only (+128 −122) |
| TASK-0082 | `7fa20c1a` | `src/app/error.tsx`, `tests/offline/shell/error-boundary.test.ts` (new, +211) |

Proof bar, once at the end on the merged tree: `./node_modules/.bin/tsc
--noEmit` green, `npm run lint` exit 0, `npm run build` exit 0, `npm test`
green (offline 82 files / 3213 tests, isolated 1 file / 8 tests), and the
surviving live tier `npm run test:live` green (1 file / 10 tests, read-only).

## TASK-0083 — README names the handoff tier

Already there when I arrived (today's live-tier merge): the `test:live` row
and the "Testing" section. Missing: the `test:handoff` row and any tier count.
Added only those two things — one row, and the tier paragraph now reads "five
tiers: offline and isolated (both under `npm test`), live, http, and the
opt-in handoff tier" and says `npm test` reaches neither `tests/live/` nor
`tests/handoff/`. No heading, no reordering, no path the front-door guard
cannot resolve (`tests/handoff/` is on disk; `../kspace Scraper` has a space
and is not path-shaped, so the guard does not read it).

Checks:

| check | result |
| --- | --- |
| `grep -q "test:handoff" README.md` | PASS |
| `grep -q "tests/handoff" README.md` | PASS |
| `./node_modules/.bin/vitest run --project=offline tests/offline/shell/shell.test.ts` | PASS — 32 tests |
| `npm run test:handoff` | PASS — 1 file, 12 tests, 0.34 s |

## BUG-0236 — one reading of "unnamed source"

`aggregateRejectionStamps` now builds `sourceNamesOf(input.sources)` and asks
`isSourceNamed(names, sourceId)`; `bySource[].source` is
`named ? sourceLabel(names, sourceId) : null`, exactly the twin gauge's
spelling. The two field docs that spelled the old reading ("row did not come
back") now say the fact asked and the owner. `unattributed`, `byReason`,
`bySource` ordering untouched.

One behaviour change, and only on the fixture the ticket names: a `sources`
row present with a blank name now yields `source: null` (it was the
whitespace string) and is counted in `unnamedSources`. Every fixture with no
blank name aggregates identically — the 147-case `/claims` page suite and the
`/sources` suites (135 tests) are unchanged and green.

Test: ONE case, `counts a registry row with no ink in its name as unnamed,
and a named row as named`, on both fixtures. Teeth proven: with the gauge
change stashed the file is 15 tests / 1 failed (that case), with it 15 / 0.

Checks:

| check | result |
| --- | --- |
| `grep -q "isSourceNamed" src/lib/gauges/settled-values.ts` | PASS |
| `./node_modules/.bin/vitest run --project=offline tests/offline/gauges/settled-values.test.ts tests/offline/gauges/standing-disagreements.test.ts tests/offline/claims/page.test.ts` | PASS — 3 files, 179 tests (15 + 17 + 147) |
| `./node_modules/.bin/tsc --noEmit` | PASS |
| `npm run lint` | PASS |

## BUG-0235 — comments name the world a fixture uses, never an install state

**Half A.** Re-grepped rather than trusting the ticket's list. The ticket's
scan found 10 files on today's tree (its 14 minus the four deleted live
files); the same claim survived under other spellings in 17 more — "the
normal case for the whole of M2", "what `main` deploys against", "staging
today", "is on neither staging nor production", "does not exist until M2's
handoff", "the graded normal case of this whole milestone". All 27 are
reworded to the world the code or fixture USES ("the absent world", "against
a database without `verdicts`") and point at ARCHITECTURE.md §9.2. Files:

- src: `app/api/admin/records/[table]/[id]/route.ts`,
  `app/api/admin/review-items/[reviewItemId]/settle/route.ts`,
  `app/queues/[reviewItemId]/page.tsx`, `app/queues/page.tsx`,
  `components/edit-refusal.ts`, `components/gauges/trend-table.tsx`,
  `components/records/entity-picker.tsx`, `components/records/fields.ts`,
  `components/review/close/{conflict-actions,link-actions,signal-actions,slot}.tsx`,
  `lib/db/{result,tables,verdict}.ts`, `lib/edit/config.ts`,
  `lib/gauges/queue-health.ts`
- tests: `fixtures/rows.ts`, `offline/absence/pages.test.ts`,
  `offline/gauges/queue-health.test.ts`, `offline/queues/verdict-log.test.ts`,
  `offline/review-item/{close-slot,page,verdict-inline}.test.ts`,
  `offline/review/one-place.test.ts`, `offline/ui/editable-cell.test.ts`,
  `offline/verdict/seam.test.ts`

Left alone, on purpose:

- `src/components/review/close/form.tsx:31` and `src/lib/db/verdict.ts:49`
  quote §9.2's own forbidden move (`no second path "until Ben installs it"`)
  — a design rule, not an install state; neither matches the ticket's scans.
- `tests/offline/verdict/seam.test.ts:346` and
  `tests/offline/records/page.test.ts:2213`, `world: "both installed — staging
  today"` — these are `it.each` row TITLES, not comments; renaming a test is
  what criterion 5 forbids. They happen to be true today, and the architect
  may want them to drop the "staging today" tail in a lane that is allowed
  to rename.
- `tests/offline/edit/config.test.ts:1078` states where `apply_resolution`
  is — a different object, outside this class.
- Two of the ticket's 16 (`tests/offline/review-item/link-actions.test.ts`,
  `signal-actions.test.ts`, and `conflict-actions.test.ts`'s lines 51/57)
  carry no install-state sentence any more; what is there now is a data-state
  sentence ("no `data_conflict` item exists on staging") that a prior lane
  already narrowed. Not touched.

**Half B** is already true on this tree: the three sites
(`harness.live.test.ts:49-54`, `claims.live.test.ts:1459`,
`result.test.ts:3299`) are gone — the two live files were deleted by today's
live-tier merge (`2e49afea`) and the `result.test.ts` case was removed by the
prune (`62ca9037`). The ticket's check 4 scan is `[]`. Every surviving
`head: true` in `src/**`/`tests/**` is the shape the app does NOT issue and
why (`lib/db/verdict.ts:251-256`, `lib/db/result.ts:1517-1523`,
`review-items.ts:207`, `claims.ts:354`, `stub-client.ts`, `seam.test.ts:85-88`,
`live-guard`, and `contract.live.test.ts:139`, whose case is precisely "a HEAD
of an absent relation carries no body").

**Void:** "one call changes too" (`harness.live.test.ts`'s case must issue
`countRead`) — the file does not exist. Criterion 4 and the two checks that
name the file cannot be met and are reported red below.

**Comment-only proof:** every changed file transpiled with TypeScript
`removeComments: true` at HEAD and in the worktree, outputs compared byte for
byte — 27 files compared, 0 with code changes (script in the session
scratchpad, not committed; `git diff -U0` agrees once the five bare lines
inside one JSX `{/* … */}` block are read as the comment they are). No test
renamed, no assertion or fixture touched.

Checks:

| check | result |
| --- | --- |
| `python3 -c "…re.search(r'on staging[^.]{0,80}(in production\|until Ben)'…"` | PASS — `[]` |
| `python3 -c "…re.search(r'(not\|never) be until Ben\|will not be until Ben'…"` | PASS — `[]` |
| `grep -q "countRead" tests/live/harness.live.test.ts` | **RED / void** — `No such file or directory`; the file was deleted 2026-10-16 (live-tier merge) |
| `python3 -c "…pat=r'(select written\|counts with\|reads of the WHOLE narrowing)[^.]{0,60}head: true\|head: true[^.]{0,40}(reads of the WHOLE\|and this case exists)'…"` | PASS — `[]` |
| `./node_modules/.bin/vitest run --project=offline tests/offline/review-item tests/offline/verdict tests/offline/review tests/offline/absence tests/offline/db/result.test.ts tests/offline/claims/page.test.ts` | PASS — 17 files, 950 tests (also run with every other touched suite: 38 files, 1795 tests) |
| `./node_modules/.bin/tsc --noEmit` | PASS |
| `npm run lint` | PASS |
| `npm run test:live -- tests/live/harness.live.test.ts` | **RED / void** — no such file; the surviving tier `npm run test:live` was run instead: 1 file, 10 tests, green, read-only |

## TASK-0082 — route-level error boundary

`src/app/error.tsx`, a `"use client"` module (read
`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md`
and `01-getting-started/10-error-handling.md` first). It renders `Page` with
the title `{ identifier: route, words: "could not be drawn" }` (route in the
mono step, words in `type-title`) and one `ErrorLine` — `reading` = the route,
the account = Next's `digest` as the machine's run (mono) when it has ink, or
the app's clause "no digest came with it" (sans) when it does not, `retry` =
the fix sentence "Reload to draw it again. If it repeats, the answer this
database gave is one this app cannot render." The route comes from
`usePathname`; nothing else is taken from the client runtime, nothing is
fetched. `error.message` is never rendered (a redaction from a server render
in production, a stack-shaped sentence from a client one). Tokens only,
through the primitives; `data-render-failed="<route>"` wraps the line as the
oracle hook, beside `ErrorLine`'s own `data-state="error"` / `role="alert"`.

Deliberately not added: a retry `Button` (`unstable_retry`) — the ticket
fixes the surface at three things and the fix sentence already says reload;
a `useEffect` console log — Next logs the digest server-side already;
`global-error.tsx` — the root layout is synchronous, reads no data and
renders `Shell` from a path and a static nav list; I can name no path on
which it throws, so there is nothing for a boundary that replaces the layout
to catch (criterion 5: said here, since ticket history is not mine to edit).

**It never replaces a refusal.** `lib/db/**` is untouched; `git diff` of the
merge adds no `throw` anywhere (the only new file under `src/` is the
boundary). The pin that a `not_provisioned` answer still renders its own card
already exists and was not restated (state correction 3):
`tests/offline/absence/pages.test.ts` renders every surface against each
absent object and against a database lacking every object, card asserted —
a render that threw there would fail those cases outright. The six pages'
offline suites are unchanged by this diff.

**Driven once for real.** `npm run build` with a scratch route
`src/app/scratch-throw/page.tsx` (`export const dynamic = "force-dynamic"`,
default export throws; a static scratch page is prerendered at build and
fails the build instead — measured, then made dynamic); `npm run start --
--port 8773` inside the STACK §5 step-1 subshell (8773 bind-probed free;
8770/8771/8772/8790 never touched); the walk cookie minted with
`node tests/walk/session-cookie.mts` into the scratchpad (value never
printed); headless Google Chrome driven over CDP (no Playwright on this
machine). Observed at `http://localhost:8773/scratch-throw`:

- raw HTTP answer: **500**, Next's `__next_error__` shell (no boundary markup
  in the stream — Next client-renders the nearest `error.tsx` after
  hydration; with JavaScript off an operator sees nothing of ours. Recorded
  as the framework's limit, not fixed);
- after hydration: sidebar present with all six labels; h1
  `/scratch-throw could not be drawn`; mono run `/scratch-throw — 3659441155`
  — the same digest the server log recorded for the throw; sans run = the
  fix sentence; `data-render-failed="/scratch-throw"`; `error.message` absent.

Then the scratch directory removed, `grep -rni scratch src tests` shows only
pre-existing unrelated uses, `git status` clean apart from the two untracked
files that are not mine, server and Chrome killed and `lsof` confirms 8773
and 9333 released, `npm run build` re-run without the route (the generated
`.next/types/validator.ts` had briefly referenced it; the rebuild cleared it
and `tsc` is green again).

Test: `tests/offline/shell/error-boundary.test.ts` — one `it.each` over
{digest, no digest, blank digest} (route in mono and never inside
`type-title`; token in mono and not in sans; fix sentence in sans and not in
mono; message/stack absent; `text-broken`, `role="alert"`,
`data-state="error"`), plus one tokens case (no hex, no arbitrary value, no
`style=`, only the five type steps). No "is a client module" pin: `next
build` already refuses a boundary without the directive, so it would restate
the build.

Checks:

| check | result |
| --- | --- |
| `test -f src/app/error.tsx` | PASS |
| `./node_modules/.bin/vitest run --project=offline tests/offline/shell/error-boundary.test.ts` | PASS — 4 tests |
| `./node_modules/.bin/vitest run --project=offline tests/offline/shell` | PASS — 3 files, 60 tests |
| `./node_modules/.bin/tsc --noEmit` | PASS |
| `npm run lint` | PASS |
| `npm run build` | PASS — exit 0, `/_not-found` static, everything else dynamic |
| `npm run test:live -- tests/live/claims.live.test.ts` | **RED / void** — no such file (deleted 2026-10-16); the surviving tier `npm run test:live` run instead: 10/10 green |

## Void items and what the factory may want to know

- The brief's "residue.live is RED" note: void, the file is gone.
- BUG-0235's "one call changes too" and its two file-named checks; TASK-0082's
  `claims.live` check — all void with the deleted files, reported red above,
  the surviving contract tier run in their place.
- ARCHITECTURE.md §9.2 is now the one place 27 comments point at for "what is
  installed where", but on this tree §9.2 does not actually carry an explicit
  install-state sentence (it narrates the 2026-09-11 install window and the
  admin `sources` row). The architect may want one line there. Not mine to
  edit from outside the factory.
- Not run: `npm run test:http` (not in any of the four tickets' checks; the
  build it starts with is green).
- The live-tier hand-back's note stands: ~20 doc comments under `src/` still
  point at deleted `tests/live/*.live.test.ts` files or `parity.ts`. Not in
  these tickets; untouched.
