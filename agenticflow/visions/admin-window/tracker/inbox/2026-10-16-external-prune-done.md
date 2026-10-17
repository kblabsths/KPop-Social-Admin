# External ticket done — the offline suite pruned to tests that earn their place (2026-10-16)

*From an agent working outside the factory, against
`agenticflow/tracker/for-human/external-ticket-prune-offline-suite.md` and rule 4 of
`agenticflow/tracker/proposals/2026-09-16-testing-rules.md` (README "Testing",
ARCHITECTURE §10). Branch `external/prune-offline` off `run/admin-window`, merged
back with `--no-ff`; the checkout is left on `run/admin-window`. Nothing pushed,
`main` untouched, nothing under `src/` changed.*

**Merge commit on `run/admin-window`:** `62ca90376014194271da064a93f2a57f1285acaf`
(the pruning commit is `23a21fd5`; this note is the commit after the merge, on
`run/admin-window`).

## Before / after

Measured on this box with the ticket's own instruments, three consecutive
`npm test` runs each (the script is `vitest run --project=offline && vitest run
--project=isolated`; "offline" and "isolated" below are each vitest's own
`Duration`, "wall" is the whole script). The ticket's 3,282 was the static `it`
count of 2026-09-16; the live-tier rewrite of 2026-10-16 moved assertions
offline before this ticket ran, so the real before is the row below.

| run | exit | offline files / cases | offline | isolated files / cases | isolated | wall |
| --- | --- | --- | --- | --- | --- | --- |
| before run 1 | exit 0 | 81 / 4052 | 13.33 s | 1 / 8 | 37.24 s | **51.6 s** |
| before run 2 | exit 0 | 81 / 4052 | 13.04 s | 1 / 8 | 37.00 s | **51.1 s** |
| before run 3 | exit 0 | 81 / 4052 | 13.27 s | 1 / 8 | 36.97 s | **51.2 s** |
| after run 1 | exit 0 | 81 / 3263 | 11.60 s | 1 / 8 | 34.07 s | **46.7 s** |
| after run 2 | exit 0 | 81 / 3263 | 11.98 s | 1 / 8 | 34.15 s | **47.2 s** |
| after run 3 | exit 0 | 81 / 3263 | 11.35 s | 1 / 8 | 33.92 s | **46.3 s** |

- **Cases:** 4,052 → **3,263** runtime (−789, −19.5%); static `it`/`it.each`
  calls 3,296 → **2,440** (−856, −26%); lines 89,316 → **74,249** (−15,067).
  Files: 81 → 81 (no file emptied; none deleted).
- **Wall:** 51.1–51.6 s → **46.3–47.2 s**; the offline project 13.0–13.3 s →
  **11.4–12.0 s**. The isolated project (one file, eight cases, ~34–37 s, a
  child vitest per case) is untouched by design and dominates the wall.
- **Not half.** The ticket's target was "roughly half the cases with no
  behaviour uncovered — but the rule decides, not the number". Ten independent
  passes over the ten file groups each landed between 19% and 38% (per-file
  table below), and every one reported the same reason: what survives is one
  pin per refusal arm, per reducer transition, per distinct fixture shape,
  plus the big `it.each` sweeps (the 216-URL `/queues` sweep, the 108-combination
  filter oracle, the tab × bucket × source × domain cross-product on `/claims`)
  that ARE the table-driven form the ticket asks for and that carry most of the
  runtime count. Deleting further would have meant deleting on caution's
  opposite — cases that fail on a regression nothing else catches. I did not.

Other checks (verbatim results, all on the merged tree):

- `./node_modules/.bin/tsc --noEmit` → exit 0, no output.
- `npm run lint` → exit 0, no findings.
- `npm run test:http` → exit 0: `Test Files 6 passed (6)`, `Tests 37 passed (37)`,
  `Duration 14.75s` (26.0 s wall including `next build`); its server exited,
  nothing left listening.
- `npm run test:live` → **not run** (not needed by this ticket; no `.env` opened).
- `git status -- src` → empty before and after.

### Per-file counts (static `it`/`it.each`/`it.fails` calls, and lines)

Ten files are unchanged and omitted: `db/layering`, `toolchain`, `shell/shell`,
`shell/client-boundary`, `live-guard`, `http-harness`, `review/one-place`,
`absence/pages`, `absence/blank-cells`, `dashboard/read`.

| file | static cases before | after | lines before | after |
| --- | ---: | ---: | ---: | ---: |
| `tests/offline/absence/in-window.test.ts` | 5 | 2 | 242 | 185 |
| `tests/offline/browse/browse-read.test.ts` | 35 | 19 | 794 | 567 |
| `tests/offline/browse/page.test.ts` | 71 | 55 | 2337 | 1965 |
| `tests/offline/browse/views.test.ts` | 59 | 28 | 810 | 462 |
| `tests/offline/claims/filters.test.ts` | 46 | 29 | 1160 | 891 |
| `tests/offline/claims/page.test.ts` | 182 | 115 | 7674 | 5928 |
| `tests/offline/claims/read.test.ts` | 42 | 38 | 995 | 926 |
| `tests/offline/cycles/page.test.ts` | 111 | 85 | 4104 | 3412 |
| `tests/offline/cycles/read.test.ts` | 22 | 17 | 311 | 273 |
| `tests/offline/dashboard/page.test.ts` | 66 | 51 | 2313 | 1975 |
| `tests/offline/db/client.test.ts` | 5 | 4 | 70 | 64 |
| `tests/offline/db/result.test.ts` | 117 | 60 | 4612 | 3276 |
| `tests/offline/db/schema.test.ts` | 11 | 8 | 364 | 308 |
| `tests/offline/edit/config.test.ts` | 76 | 54 | 2116 | 1685 |
| `tests/offline/edit/records.test.ts` | 42 | 36 | 992 | 843 |
| `tests/offline/edit/route.test.ts` | 62 | 45 | 1375 | 1122 |
| `tests/offline/format.test.ts` | 47 | 43 | 465 | 443 |
| `tests/offline/gauges-ui/cards.test.ts` | 32 | 27 | 831 | 779 |
| `tests/offline/gauges/bounded.test.ts` | 20 | 15 | 863 | 800 |
| `tests/offline/gauges/cycle-health.test.ts` | 20 | 17 | 341 | 317 |
| `tests/offline/gauges/gauge.test.ts` | 42 | 37 | 433 | 404 |
| `tests/offline/gauges/pending-claims.test.ts` | 35 | 25 | 897 | 737 |
| `tests/offline/gauges/queue-health.test.ts` | 16 | 15 | 253 | 245 |
| `tests/offline/gauges/resolution-latency.test.ts` | 25 | 18 | 518 | 465 |
| `tests/offline/gauges/settled-values.test.ts` | 17 | 14 | 381 | 347 |
| `tests/offline/gauges/standing-disagreements.test.ts` | 16 | 15 | 392 | 383 |
| `tests/offline/handoff/settle-review-item.test.ts` | 46 | 40 | 1518 | 1329 |
| `tests/offline/handoff/verdicts.test.ts` | 27 | 24 | 593 | 566 |
| `tests/offline/order/newest-first.test.ts` | 11 | 9 | 184 | 163 |
| `tests/offline/paging/answer.test.ts` | 10 | 7 | 213 | 182 |
| `tests/offline/paging/bounds.test.ts` | 11 | 10 | 225 | 214 |
| `tests/offline/paging/browse-route.test.ts` | 28 | 19 | 703 | 560 |
| `tests/offline/paging/claims-route.test.ts` | 28 | 19 | 685 | 579 |
| `tests/offline/paging/machine.test.ts` | 75 | 51 | 1951 | 1658 |
| `tests/offline/queues/filters.test.ts` | 41 | 33 | 653 | 570 |
| `tests/offline/queues/page.test.ts` | 104 | 77 | 2697 | 2254 |
| `tests/offline/queues/verdict-log.test.ts` | 28 | 23 | 1113 | 1021 |
| `tests/offline/records/entity-picker.test.ts` | 74 | 55 | 2276 | 1985 |
| `tests/offline/records/page.test.ts` | 105 | 79 | 2953 | 2574 |
| `tests/offline/records/provenance.test.ts` | 15 | 13 | 257 | 226 |
| `tests/offline/records/routes.test.ts` | 10 | 8 | 141 | 127 |
| `tests/offline/records/submit.test.ts` | 15 | 13 | 208 | 186 |
| `tests/offline/review-item/close-slot.test.ts` | 34 | 17 | 770 | 442 |
| `tests/offline/review-item/conflict-actions.test.ts` | 47 | 20 | 1237 | 728 |
| `tests/offline/review-item/link-actions.test.ts` | 32 | 18 | 934 | 638 |
| `tests/offline/review-item/page.test.ts` | 109 | 75 | 4044 | 3219 |
| `tests/offline/review-item/read.test.ts` | 18 | 13 | 406 | 324 |
| `tests/offline/review-item/signal-actions.test.ts` | 27 | 11 | 689 | 429 |
| `tests/offline/review-item/verdict-inline.test.ts` | 34 | 24 | 912 | 734 |
| `tests/offline/review/review-items.test.ts` | 51 | 35 | 1295 | 957 |
| `tests/offline/review/shapes.test.ts` | 42 | 17 | 673 | 395 |
| `tests/offline/runs/page.test.ts` | 32 | 25 | 883 | 766 |
| `tests/offline/runs/read.test.ts` | 18 | 15 | 461 | 387 |
| `tests/offline/sources/names.test.ts` | 16 | 11 | 373 | 302 |
| `tests/offline/sources/page.test.ts` | 83 | 69 | 2666 | 2336 |
| `tests/offline/sources/read.test.ts` | 26 | 16 | 418 | 293 |
| `tests/offline/ui/contrast.test.ts` | 8 | 6 | 194 | 183 |
| `tests/offline/ui/copy.test.ts` | 15 | 12 | 667 | 542 |
| `tests/offline/ui/editable-cell.test.ts` | 153 | 96 | 3269 | 2572 |
| `tests/offline/ui/evidence-pair.test.ts` | 22 | 16 | 692 | 555 |
| `tests/offline/ui/link-spelling.test.ts` | 25 | 20 | 542 | 493 |
| `tests/offline/ui/paging.test.ts` | 90 | 68 | 2805 | 2411 |
| `tests/offline/ui/primitives.test.ts` | 129 | 113 | 2658 | 2392 |
| `tests/offline/ui/tokens.test.ts` | 9 | 8 | 237 | 231 |
| `tests/offline/url/narrowing.test.ts` | 18 | 16 | 523 | 488 |
| `tests/offline/url/search-params.test.ts` | 12 | 9 | 189 | 92 |
| `tests/offline/verdict/decision.test.ts` | 76 | 53 | 1195 | 991 |
| `tests/offline/verdict/seam.test.ts` | 30 | 19 | 692 | 514 |
| `tests/offline/walk/reset-sandbox.test.ts` | 15 | 13 | 349 | 327 |
| `tests/offline/walk/sandbox-fixture.test.ts` | 10 | 9 | 155 | 144 |
| `tests/offline/walk/session-cookie.test.ts` | 15 | 14 | 277 | 270 |
| **total, 81 files** | **3296** | **2440** | **89316** | **74249** |

## What was kept untouched, and why

- `tests/offline/db/layering.test.ts`, `toolchain.test.ts`, `shell/**`,
  `live-guard.test.ts`, `http-harness.test.ts`; `tests/http/`, `tests/live/`,
  `tests/handoff/`, `tests/walk/`, `tests/isolated/` — per the ticket.
- **The five source-tree walkers** `tests/isolated/probe-race.isolated.test.ts`
  spawns as a child vitest and plants a probe against (`claims/read`,
  `browse/views`, `edit/config`, `review/one-place`, `url/narrowing`): every
  case in them that calls `sourceFiles()`/`codeLines`/`sourceText` is kept
  verbatim and untitled, because the probe must redden exactly those cases.
  That is why `edit/config` lands at 54 rather than ~38 and `review/one-place`
  at 17/17.
- `absence/pages.test.ts` (the whole-window absence matrix) is the survivor for
  most per-page not-provisioned pins and was not cut; its matrix renders each
  route at its bare URL only, so absence pins on `/queues?tab=verdict_log` and
  any per-page case that also asserts a SECOND surface still renders beside
  the absence (`runs/page`, two on `sources/page`, `records/page`) were kept.
- Every refusal arm keeps at least one pin: the PATCH route's 400/403/404/500/503
  arms, every `not_provisioned`/`error` surface state, the walk-sandbox
  reset's credential refusals, the verdict seam's refusals, the "never writes /
  makes no call" guards.

## One correction I made to a group's merge

`tests/offline/paging/machine.test.ts` › the new `it.each(LANDINGS)` "one press
lands %s" (BUG-0222/0226) went red on its first run on the row "a page
carrying one id twice: the repeat dropped" — the merge had typed `overlapped:
false` for that row, but the original pin ("drops a row a PAGE carries twice,
whatever the route answers") never asserted `overlapped` at all, and the
machine reports `true` there (an in-page repeat is, to the dedupe, a row
already drawn). The table's fourth column is now `boolean | null` and the
assertion is skipped where the original pin made none; no behaviour widened,
no product code changed. Green on the next run and on all three measured runs.

## Method (so the next run can re-check the audit)

Ten groups, one agent each, same brief: inventory every `it` by title and
assertions (never by comment) into `<scratch>/prune/<group>-inventory.md`
before deleting; then delete / merge; then one audit line per deleted `it`.
A second pass reconciled every case whose twin lay in another group's file
(the "cross-group candidates" each group was told to keep rather than
delete): I verified each named survivor exists in the tree, then had the
owning group delete or keep with a stated extra assertion. A script then
checked every audit line below: every deleted title exists at the parent
commit and is gone (or reduced by one, where two cases shared a title) in the
merged tree; every "covered by" title exists in the merged tree (the thirteen
that are `it.each` templates — `%s`, `$label`, `${name}` — were matched by
their table labels). 841 audit lines in the list below: 744 "covered by", 67
"pins nothing", 30 "merged" into a table-driven case named under the group's
"Merged chains". Each group's "Kept with a twin outside the group" block is
its first-pass record; where a title there also appears in that group's
second-pass deletion lines, the deletion is what landed.

## Suspected dead code (not touched; a separate finding)

Named by the groups and re-checked read-only against `src/`:

- `src/components/review/close/slot.tsx` ~431: the `actions.length === 0` branch
  of the ready `CloseSlot` ("No verdict action is offered for this item yet.")
  — no shape module answers an empty action list (`data_conflict_fact` falls
  back to `keep_current`, `entity_link_fact` to `settle`, the signal is always
  two); only a deleted close-slot case reached it.
- `src/components/evidence/evidence-pair.tsx` 38/90/254/267: the `action?:
  ReactNode` prop on `EvidenceClaim` and the canonical card — no `src/` caller
  passes it (`shape-views.tsx` passes `claims` and `canonical` only); only a
  deleted evidence-pair case rendered it.
- `src/lib/db/client.ts` exports `DB_URL_ENV_NAME` / `DB_KEY_ENV_NAME`; nothing
  in `src/` outside that module reads them.
- `src/lib/db/review-items.ts` `listReviewItems` has no caller in `src/`
  outside its own module (the Queues page reads through `readReviewQueues`
  since BUG-0133); its refusal arms stay pinned in `review/review-items.test.ts`.
- `tests/fixtures/rows.ts` export `pendingClaimsInEveryBucket` is imported by
  no test any more (fixture, not product; left in place).

## The deletion list — one line per deleted `it`

Format: `` `file` › "deleted title" → covered by `file` › "surviving title" ``
(the survivor is in the merged tree), or `→ pins nothing: <why>`, or `→
merged` (replaced by the group's table-driven case named under "Merged
chains"). An `it.each` is one line with its parameter count. Titles are
verbatim; `[admin-window/BUG-nnnn]` suffixes are part of the title.

### A — claims (`claims/*`, `paging/claims-route`, `sources/names`, `absence/in-window`, `gauges/pending-claims`, `gauges/bounded`)

125 audit lines.

  ### tests/offline/claims/page.test.ts
- `tests/offline/claims/page.test.ts` › "shows every bucket it may show, in the view's own order" → covered by `tests/offline/claims/page.test.ts` › "renders exactly the claims and counts the view holds, on the ${tab} tab, under bucket=${bucket ?? "
- `tests/offline/claims/page.test.ts` › "counts each bucket exactly as the view holds it" → covered by `tests/offline/claims/page.test.ts` › "renders exactly the claims and counts the view holds, on the ${tab} tab, under bucket=${bucket ?? "
- `tests/offline/claims/page.test.ts` › "draws three columns, and no distinct-source figure anywhere" → pins nothing: a column count is layout, and the hook it asserts absent is a removed feature's tombstone
- `tests/offline/claims/page.test.ts` › "counts each bucket exactly as the view holds it, per source filter" → covered by `tests/offline/claims/page.test.ts` › "renders exactly the claims and counts the view holds, on the ${tab} tab, under bucket=${bucket ?? "
- `tests/offline/claims/page.test.ts` › "counts each bucket exactly as the view holds it, per domain filter" → covered by `tests/offline/claims/page.test.ts` › "renders exactly the claims and counts the view holds, on the ${tab} tab, under bucket=${bucket ?? "
- `tests/offline/claims/page.test.ts` › "appears nowhere in the markup, under any filter or tab" → covered by `tests/offline/absence/in-window.test.ts` › "is answered by every page without ever echoing it"
- `tests/offline/claims/page.test.ts` › "appears nowhere in any of the four states either" → covered by `tests/offline/absence/in-window.test.ts` › "%s still emits the bucket nowhere"
- `tests/offline/claims/page.test.ts` › "is not a bucket row, not a chip, and not a claim" → covered by `tests/offline/claims/page.test.ts` › "renders exactly the claims and counts the view holds, on the ${tab} tab, under bucket=${bucket ?? "
- `tests/offline/claims/page.test.ts` › "does not narrow the page when a URL names it" → covered by `tests/offline/claims/page.test.ts` › "renders exactly the claims ?${name} matches"
- `tests/offline/claims/page.test.ts` › "returns exactly the matching claims for every facet value" → covered by `tests/offline/claims/page.test.ts` › "renders exactly the claims and counts the view holds, on the ${tab} tab, under bucket=${bucket ?? "
- `tests/offline/claims/page.test.ts` › "carries no requirement cell for a bucket that has none" → covered by `tests/offline/claims/page.test.ts` › "names what every awaiting_row claim waits for, and nothing else does"
- `tests/offline/claims/page.test.ts` › "links every claim to its source and to its fact's provenance" → covered by `tests/offline/claims/page.test.ts` › "leads from every claim to its source, and to its fact where there is one"
- `tests/offline/claims/page.test.ts` › "settles nothing: every control on the page is a link" → covered by `tests/offline/claims/page.test.ts` › "renders exactly the claims and counts the view holds, on the ${tab} tab, under bucket=${bucket ?? "
- `tests/offline/claims/page.test.ts` › "states the rows that are BELOW it, never its cap, when the row read came back short [admin-window/BUG-0183]" → merged (see Merged chains)
- `tests/offline/claims/page.test.ts` › "names the rows ON SCREEN when the COUNT read came back SMALLER than the rows drawn [admin-window/BUG-0186]" → merged (see Merged chains)
- `tests/offline/claims/page.test.ts` › "draws at most the window's rows however many claims the view holds" → covered by `tests/offline/claims/page.test.ts` › "renders a view far larger than the row cap, and states its real size"
- `tests/offline/claims/page.test.ts` › "draws the LONGEST-WAITING claims, in the page's oldest-first order" → covered by `tests/offline/claims/page.test.ts` › "draws exactly one control when a count established there is more, and leaves the first screen alone"
- `tests/offline/claims/page.test.ts` › "states the cap and the number of claims it holds back" → covered by `tests/offline/claims/page.test.ts` › "draws exactly one control when a count established there is more, and leaves the first screen alone"
- `tests/offline/claims/page.test.ts` › "says which narrowing its window is of, and only when there is one" → covered by `tests/offline/claims/page.test.ts` › "says a chip narrowed the list in exactly the states a chip removed a row" (copy-oracle on "matching these filters")
- `tests/offline/claims/page.test.ts` › "states the count of a FILLED window over the narrowing it actually read (admin-window/BUG-0118)" → covered by `tests/offline/claims/page.test.ts` › "counts the population a FILLED window NAMES, not the view it read from"
- `tests/offline/claims/page.test.ts` › "says a filled window's narrowing once, whichever narrowings it carries" → covered by `tests/offline/claims/page.test.ts` › "is true of both kinds of narrowing when both are set" (copy-oracle)
- `tests/offline/claims/page.test.ts` › "claims a filter over the list only when a chip is set (admin-window/BUG-0123)" → covered by `tests/offline/claims/page.test.ts` › "says a chip narrowed the list in exactly the states a chip removed a row" (copy-oracle)
- `tests/offline/claims/page.test.ts` › "leaves every bucket count the view's own, with the list windowed" → covered by `tests/offline/claims/page.test.ts` › "renders a view far larger than the row cap, and states its real size"
- `tests/offline/claims/page.test.ts` › "windows the standing tab's list the same way" → covered by `tests/offline/claims/page.test.ts` › "counts the population a FILLED window NAMES, not the view it read from"
- `tests/offline/claims/page.test.ts` › "renders exactly the standing_disagreement claims" → covered by `tests/offline/claims/page.test.ts` › "renders exactly the claims and counts the view holds, on the ${tab} tab, under bucket=${bucket ?? "
- `tests/offline/claims/page.test.ts` › "keeps the source narrowing when the operator crosses to it" → covered by `tests/offline/claims/page.test.ts` › "renders exactly the claims and counts the view holds, on the ${tab} tab, under bucket=${bucket ?? "
- `tests/offline/claims/page.test.ts` › "shows the bucket table only where it belongs" → covered by `tests/offline/claims/page.test.ts` › "renders exactly the claims and counts the view holds, on the ${tab} tab, under bucket=${bucket ?? "
- `tests/offline/claims/page.test.ts` › "claims no narrowing for a facet its own read did not carry" → covered by `tests/offline/claims/page.test.ts` › "says the bucket filter does not narrow the gauge [admin-window/BUG-0204]"
- `tests/offline/claims/page.test.ts` › "buys fact 2 with one bounded count, and only where a facet narrows this read" → covered by `tests/offline/claims/page.test.ts` › "buys the attribution fact with one count per surface, and only where both families are in force"
- `tests/offline/claims/page.test.ts` › "claims no count it never took when the list's read fails" → covered by `tests/offline/claims/page.test.ts` › "drops the whole window line, not just its count, on a read it never made"
- `tests/offline/claims/page.test.ts` › "still states the window when only the leg that NAMES the sources refused" → covered by `tests/offline/claims/page.test.ts` › "costs the LABELS and the chip vocabulary, and nothing else, when the registry refuses"
- `tests/offline/claims/page.test.ts` › "renders standing alone, with no props at all" → covered by `tests/offline/claims/page.test.ts` › "renders every claim the view holds, oldest first" (the no-props call itself is `tests/offline/shell/**`'s)
- `tests/offline/claims/page.test.ts` › "says the bucket table answers for every bucket when a bucket facet is set" → covered by `tests/offline/claims/page.test.ts` › "adds the bucket clause and nothing else, whatever else narrowed the table"
- `tests/offline/claims/page.test.ts` › "carries neither arm over a read that came back without a count" → covered by `tests/offline/claims/page.test.ts` › "says nothing about bucket counts a refused read never produced [admin-window/BUG-0144]"
- `tests/offline/claims/page.test.ts` › "blames the facet when the facet is what emptied the list" → covered by `tests/offline/claims/page.test.ts` › "is on the screen when %s emptied the page"
- `tests/offline/claims/page.test.ts` › "blames the facet on the gauge card when the facet emptied the window" → covered by `tests/offline/claims/page.test.ts` › "blames the facet on the gauge card when that same claim is inside the window"
- `tests/offline/claims/page.test.ts` › "still names its scope for a facet that really removed rows" → covered by `tests/offline/claims/page.test.ts` › "blames a source or domain only when it removed a row of this table"
- `tests/offline/claims/page.test.ts` › "claims no filter above when the only narrowing has no chip" → covered by `tests/offline/claims/page.test.ts` › "says a chip narrowed the list in exactly the states a chip removed a row" (copy-oracle on the chip phrases)
- `tests/offline/claims/page.test.ts` › "claims no filter above when the only chip set narrows this table by nothing" → covered by `tests/offline/claims/page.test.ts` › "says what the gauge says about a chip narrowing, in both directions"
- `tests/offline/claims/page.test.ts` › "claims no filter above on the standing tab when the chip set removed no row of it" → covered by `tests/offline/claims/page.test.ts` › "says a chip narrowed the list in exactly the states a chip removed a row"
- `tests/offline/claims/page.test.ts` › "keeps the tab's own bucket when the URL asks for that same bucket" → covered by `tests/offline/claims/page.test.ts` › "says a chip narrowed the list in exactly the states a chip removed a row"
- `tests/offline/claims/page.test.ts` › "names the facet that has no chip row, so the exit says what it clears" → covered by `tests/offline/claims/page.test.ts` › "names the facet and its value in every state the narrowed arm renders"
- `tests/offline/claims/page.test.ts` › "cannot reach past the cap from any state its own chips offer" → covered by `tests/offline/claims/page.test.ts` › "counts held claims per narrowing, not per rendered page"
- `tests/offline/claims/page.test.ts` › "still offers both chip facets when nothing matched, and a way out of the one that emptied it" → covered by `tests/offline/claims/page.test.ts` › "leaves the chip rows doing exactly the job they did"
- `tests/offline/claims/page.test.ts` › "renders the same claims as the canonical spelling, for %o" (3 params) → covered by `tests/offline/claims/page.test.ts` › "renders the page the canonical spelling renders, for %o"
- `tests/offline/claims/page.test.ts` › "spells the narrowing back in ONE form, for %o" (3 params) → covered by `tests/offline/claims/page.test.ts` › "renders the page the canonical spelling renders, for %o"
- `tests/offline/claims/page.test.ts` › "narrows nothing for %s, and says so" (2 params) → covered by `tests/offline/claims/page.test.ts` › "renders exactly the claims ?${name} matches"
- `tests/offline/claims/page.test.ts` › "narrows to nothing for a well-formed id no claim carries" → covered by `tests/offline/claims/page.test.ts` › "narrows to NOTHING when the URL names one of them, and says where it looked"
- `tests/offline/claims/page.test.ts` › "narrows nothing and is reported, for %s" (3 params) → covered by `tests/offline/claims/page.test.ts` › "changes nothing else about the page it reports on"
- `tests/offline/claims/page.test.ts` › "is still reported beside a source_id that DID narrow, in another spelling" → covered by `tests/offline/claims/page.test.ts` › "names every dropped parameter in one line, and only the ones it dropped"
- `tests/offline/claims/page.test.ts` › "names the chips exactly as the same facet on /sources does" → covered by `tests/offline/claims/page.test.ts` › "offers every REGISTERED source, 'all' first, and no domain chips at all"
- `tests/offline/claims/page.test.ts` › "names a standing split the registry names ${JSON.stringify(blank)} by its id" (3 loop params) → covered by `tests/offline/claims/page.test.ts` › "states the number of standing splits it named by id, on a row the registry left blank"
- `tests/offline/claims/page.test.ts` › "leaves a standing split's registry name exactly as the registry wrote it" → covered by `tests/offline/sources/names.test.ts` › "leaves a name with any ink in it exactly as the registry wrote it"
- `tests/offline/claims/page.test.ts` › "reports the registry leg when it refuses, and leaves every source its id" → covered by `tests/offline/claims/page.test.ts` › "costs the LABELS and the chip vocabulary, and nothing else, when the registry refuses"
- `tests/offline/claims/page.test.ts` › "carries every bucket, including the one that must never render" → pins nothing: asserts the fixture's own shape
- `tests/offline/claims/page.test.ts` › "keeps the tab a URL asks for, however it spells the rest" → covered by `tests/offline/claims/page.test.ts` › "renders exactly the claims and counts the view holds, on the ${tab} tab, under bucket=${bucket ?? "
- `tests/offline/claims/page.test.ts` › "names a facet whose value no chip offers, without echoing the value" → covered by `tests/offline/claims/page.test.ts` › "names every dropped parameter in one line, and only the ones it dropped"
- `tests/offline/claims/page.test.ts` › "says what the bucket figures are figures of, and asserts no filter without one" → covered by `tests/offline/claims/page.test.ts` › "blames a source or domain only when it removed a row of this table" (copy-oracle)
- `tests/offline/claims/page.test.ts` › "spells a name, or none, but never a hole where a name goes" → covered by `tests/offline/claims/page.test.ts` › "ignores a key with no visible content the way it ignores an empty value, and moves nothing else"
- `tests/offline/claims/page.test.ts` › "names a parameter an operator can read back, whatever the key's codepoints" → covered by `tests/offline/claims/page.test.ts` › "ignores a key with no visible content the way it ignores an empty value, and moves nothing else"
- `tests/offline/claims/page.test.ts` › "cannot let a URL reverse the sentence its name is written into" → covered by `tests/offline/claims/filters.test.ts` › "names, counts or ignores %o by its key's spelling alone, answering %o"
- `tests/offline/claims/page.test.ts` › "offers no chip built from a parked row, and none for the domain facet at all" → covered by `tests/offline/claims/page.test.ts` › "offers every REGISTERED source, 'all' first, and no domain chips at all"
- `tests/offline/claims/page.test.ts` › "renders a bucket's refusal rather than a zero when the count is absent" → covered by `tests/offline/claims/page.test.ts` › "renders ONE bucket's refusal in its own row, and the others' counts"
- `tests/offline/claims/page.test.ts` › "hands the hook the rows it RENDERED, at this app's own route" → covered by `tests/offline/claims/page.test.ts` › "one press issues one request at an explicit bound; no press issues none"
- `tests/offline/claims/page.test.ts` › "does not claim rows are withheld once the walk has reached the end of the set" → covered by `tests/offline/claims/page.test.ts` › "the window line in every state a press can end in"
- `tests/offline/claims/page.test.ts` › "is one element while a press is in FLIGHT, and says what the rows still say" → covered by `tests/offline/claims/page.test.ts` › "the window line in every state a press can end in"
- `tests/offline/claims/page.test.ts` › "at the bound ceiling it still says claims are not shown" → covered by `tests/offline/claims/page.test.ts` › "the window line in every state a press can end in"
  ### tests/offline/claims/read.test.ts
- `tests/offline/claims/read.test.ts` › "is ONE request that asks the database for the order and the bound" → covered by `tests/offline/claims/read.test.ts` › "asks for range($from, $to) at offset $offset, in the same total order and with the parked bucket excluded"
- `tests/offline/claims/read.test.ts` › "pages the SAME order: two windows meet exactly, with nothing repeated or dropped" → covered by `tests/offline/claims/read.test.ts` › "keeps the parked bucket out of a page at offset 50, over a view that really has one"
- `tests/offline/claims/read.test.ts` › "counts every renderable bucket when no bucket is named" → covered by `tests/offline/claims/read.test.ts` › "is a GET-shaped count carrying the narrowing, and reads no row at all"
- `tests/offline/claims/read.test.ts` › "leaves out a claim dated after until — the figure the old count changed" → covered by `tests/offline/claims/read.test.ts` › "counts [since, until) — a claim AT until is out, a claim AT since is in"
  ### tests/offline/claims/filters.test.ts
- `tests/offline/claims/filters.test.ts` › "leaves a facet whose values are words comparing as words" → covered by `tests/offline/claims/filters.test.ts` › "reads each facet out of the URL"
- `tests/offline/claims/filters.test.ts` › "are spec §4's three, each named for the field it narrows" → pins nothing: a constant that changes with the design, not with behaviour
- `tests/offline/claims/filters.test.ts` › "writes the facets in one fixed order" → covered by `tests/offline/claims/filters.test.ts` › "carries the page's narrowing to the paging route, and nothing else"
- `tests/offline/claims/filters.test.ts` › "round-trips every filter it writes" → covered by `tests/offline/claims/filters.test.ts` › "re-derives the same list narrowing the first screen read under"
- `tests/offline/claims/filters.test.ts` › "keeps the narrowing readable back into the URL it came from" → covered by `tests/offline/claims/filters.test.ts` › "names every facet that narrows with no chip, and no facet that has one"
- `tests/offline/claims/filters.test.ts` › "builds one group per CHIP facet, in facet order" → covered by `tests/offline/claims/filters.test.ts` › "domain narrows every count and the window, with no chip row"
- `tests/offline/claims/filters.test.ts` › "drops the chip facets the URL contributed and keeps the ones with no control" → merged (see Merged chains)
- `tests/offline/claims/filters.test.ts` › "keeps a facet the surface merged in of its own accord" → merged (see Merged chains)
- `tests/offline/claims/filters.test.ts` › "keeps it when the URL happens to ask for the same value" → merged (see Merged chains)
- `tests/offline/claims/filters.test.ts` › "counts a parameter whose own NAME the app may not render, and spells none of it" → merged (see Merged chains)
- `tests/offline/claims/filters.test.ts` › "ignores a key that is empty or blank, exactly as it ignores an empty value" → merged (see Merged chains)
- `tests/offline/claims/filters.test.ts` › "ignores a key with no visible content, whatever its codepoints" → merged (see Merged chains)
- `tests/offline/claims/filters.test.ts` › "names a key that puts any ink on the page, however little" → merged (see Merged chains)
- `tests/offline/claims/filters.test.ts` › "still counts, and still refuses to spell, a name the app may not render" → merged (see Merged chains)
- `tests/offline/claims/filters.test.ts` › "spells a key only from the renderable allowlist, and counts every other" → merged (see Merged chains)
- `tests/offline/claims/filters.test.ts` › "ignores a key that is nothing but marks a reader cannot see" → merged (see Merged chains)
- `tests/offline/claims/filters.test.ts` › "still refuses to spell the parked word when an inkless mark rides along" → merged (see Merged chains)
  ### tests/offline/paging/claims-route.test.ts
- `tests/offline/paging/claims-route.test.ts` › "is the first statement of the handler body" → pins nothing: grades how the handler is written; the order is pinned by "asks the gate before it reads the bound, so a stranger never learns the bound's verdict"
- `tests/offline/paging/claims-route.test.ts` › "does its own arithmetic on the raw parameter nowhere" → pins nothing: grades how it was written; the behaviour is `tests/offline/paging/claims-route.test.ts` › "refuses %s with 400, naming it, and reads nothing"
- `tests/offline/paging/claims-route.test.ts` › "answers a SHORT page as exhausted, with the rows it really read" → covered by `tests/offline/paging/claims-route.test.ts` › "never reports a row count the read did not return, at any offset on the grid"
- `tests/offline/paging/claims-route.test.ts` › "answers a page past the end with zero rows and calls the set exhausted" → covered by `tests/offline/paging/claims-route.test.ts` › "never reports a row count the read did not return, at any offset on the grid"
- `tests/offline/paging/claims-route.test.ts` › "names a registered source and leaves an unregistered one as its id" → covered by `tests/offline/paging/claims-route.test.ts` › "answers a FULL window that continues"
- `tests/offline/paging/claims-route.test.ts` › "reads the standing TAB as the bucket it is" → covered by `tests/offline/paging/claims-route.test.ts` › "reads the standing TAB's subset on both surfaces, bucket facet and all"
- `tests/offline/paging/claims-route.test.ts` › "takes the FIRST value of a repeated facet, as the page does" → covered by `tests/offline/claims/filters.test.ts` › "narrows nothing for an absent, repeated or unrecognised parameter" (the route parses no facet of its own — pinned in this file)
- `tests/offline/paging/claims-route.test.ts` › "spells those directives nowhere but the shared constant" → pins nothing: grades how it was written; the behaviour is "says so itself on all four arms, from the one constant"
- `tests/offline/paging/claims-route.test.ts` › "really does serve different rows for a different narrowing (the control)" → covered by `tests/offline/paging/claims-route.test.ts` › "keeps a control-less facet across the boundary"
  ### tests/offline/sources/names.test.ts
- `tests/offline/sources/names.test.ts` › "names nothing from no rows — the registry leg that read nothing" → pins nothing: an empty Map from no rows is the constructor's own behaviour
- `tests/offline/sources/names.test.ts` › "says the registry's name when the registry holds one" → covered by `tests/offline/sources/names.test.ts` › "leaves a name with any ink in it exactly as the registry wrote it"
- `tests/offline/sources/names.test.ts` › "never answers with a label that has nothing readable in it" → covered by `tests/offline/sources/names.test.ts` › "says the id VERBATIM when the row exists and its name has no ink"
- `tests/offline/sources/names.test.ts` › "flags the retyped fallback and clears the spellings that are not it" → pins nothing: grades the test's own regex
- `tests/offline/sources/names.test.ts` › "exports the three parts of the rule and nothing else" → pins nothing: an export census that changes with the design
  ### tests/offline/absence/in-window.test.ts
- `tests/offline/absence/in-window.test.ts` › "is the one the app itself refuses to render" → covered by `tests/offline/claims/read.test.ts` › "is the view's six, and the UI may render five of them"
- `tests/offline/absence/in-window.test.ts` › "is in the database these renders read" → pins nothing: asserts the fixture's own contents
- `tests/offline/absence/in-window.test.ts` › "follows more than one state on the pages that have them" → pins nothing: a floor on the crawl's own link count
  ### tests/offline/gauges/pending-claims.test.ts
- `tests/offline/gauges/pending-claims.test.ts` › "spells the view's six buckets" → covered by `tests/offline/claims/read.test.ts` › "is the view's six, and the UI may render five of them"
- `tests/offline/gauges/pending-claims.test.ts` › "renders every bucket except the one that is empty by rule" → covered by `tests/offline/claims/read.test.ts` › "is the view's six, and the UI may render five of them"
- `tests/offline/gauges/pending-claims.test.ts` › "reports whichever object is absent, by name" → covered by `tests/offline/gauges/pending-claims.test.ts` › "is never a half-filled gauge and never a zero" (view arm; the observations arm by `tests/offline/gauges/bounded.test.ts` › "reports not_provisioned naming the object, and does not throw — ${gauge}")
- `tests/offline/gauges/pending-claims.test.ts` › "PIN admin-window/BUG-0167: at the cap, a tie on the boundary instant costs claims the id list kept" → covered by `tests/offline/gauges/pending-claims.test.ts` › "scans observations and windows the view over the SAME interval, both bounded" (the observation_id tiebreak on both legs)
- `tests/offline/gauges/pending-claims.test.ts` › "windows the claims read on the bound the scan carries, and on the view's own column" → covered by `tests/offline/gauges/pending-claims.test.ts` › "scans observations and windows the view over the SAME interval, both bounded"
- `tests/offline/gauges/pending-claims.test.ts` › "is the observations one when both legs fail for an arbitrary reason" → covered by `tests/offline/gauges/pending-claims.test.ts` › "is the OBSERVATIONS one when both legs refuse — pinned, not raced"
- `tests/offline/gauges/pending-claims.test.ts` › "counts a claim it cannot place on a day without moving it to one" → pins nothing: `plotted <= claims` holds whether or not the claim is moved to a day
- `tests/offline/gauges/pending-claims.test.ts` › "renders NO threshold line — the dial is not in this repo" → covered by `tests/offline/gauges/pending-claims.test.ts` › "puts no threshold figure anywhere in a rendered trend"
- `tests/offline/gauges/pending-claims.test.ts` › "yields nothing for any source" → covered by `tests/offline/gauges/pending-claims.test.ts` › "puts no threshold figure anywhere in a rendered trend"
- `tests/offline/gauges/pending-claims.test.ts` › "pass a not-provisioned database straight through" → covered by `tests/offline/gauges/pending-claims.test.ts` › "is never a half-filled gauge and never a zero"
  ### tests/offline/gauges/bounded.test.ts
- `tests/offline/gauges/bounded.test.ts` › "is one file per row of spec §5's table of six" → pins nothing: a file census that changes with the design
- `tests/offline/gauges/bounded.test.ts` › "uses no count query, so no gauge can render a fabricated zero" → pins nothing: grades how it was written, and its premise (`readCount` answering `?? 0`) no longer holds — a missing count is a refusal (read.test "treats a count the database did not give as a REFUSAL, never as a zero")
- `tests/offline/gauges/bounded.test.ts` › "has an answer for every object the app can query" → pins nothing: total by construction (`Record<TableName, ObjectKind>`)
- `tests/offline/gauges/bounded.test.ts` › "leaves out a row dated after until — ${scan.read}" (6 loop params) → covered by `tests/offline/gauges/bounded.test.ts` › "reads [since, until) — a row AT until is out, a row AT since is in — ${scan.read}"
- `tests/offline/gauges/bounded.test.ts` › "grades every scan the gauges run under ReadBounds, and each on its own column" → pins nothing: a census of the test's own table
  Cross-group reconciliation (orchestrator, survivors verified by them). Counts after: page.test.ts 115, filters.test.ts 29, total 254.
- `tests/offline/claims/filters.test.ts` › "links to the record where its fact's provenance is shown" → covered by `tests/offline/records/routes.test.ts` › "names one canonical row, whatever its domain" and "encodes BOTH halves, because both are data"
- `tests/offline/claims/filters.test.ts` › "offers no provenance link for a record that does not exist yet" → covered by `tests/offline/records/routes.test.ts` › "answers null when there is no canonical row to lead to"
- `tests/offline/claims/page.test.ts` › "draws the bucket link so the WORDS carry the link's ink, not just the anchor" → covered by `tests/offline/ui/link-spelling.test.ts` › "/claims keeps every link's spelling on the words it draws"
- `tests/offline/claims/page.test.ts` › "writes every inter-element space as an explicit expression, which no transform may drop" → covered by `tests/offline/ui/copy.test.ts` › "leaves no file under src/ leaning on a space a transform may drop"
- `tests/offline/claims/page.test.ts` › "renders the not-provisioned state naming the view, and nothing throws" → covered by `tests/offline/absence/pages.test.ts` › "survives %s being absent" and "%s names every object it asked for and invents no number"
  Orphans removed with them: `recordHref` import (filters.test.ts); `implicitInterElementSpacesIn`, `chipsInsideLinks`, `expectLinkSpellingReachesTheGlyphs` imports (page.test.ts). "draws the standing tab's per-source rows as links at rest" kept as instructed.
**Merged chains:**

- **page.test.ts, the unpaged window line over two disagreeing reads (BUG-0183 → BUG-0186)**: "states the rows that are BELOW it, never its cap, when the row read came back short [admin-window/BUG-0183]" and "names the rows ON SCREEN when the COUNT read came back SMALLER than the rows drawn [admin-window/BUG-0186]" → one `it.each(DISAGREEING_READS)` titled "names the rows ON SCREEN, never its cap, under %s" (2 rows: count larger than the rows drawn with `truncated` true; count smaller with `truncated` false). Asserts exactly what both did: row counts, `held`, `truncated`, no paging element, and the two lines differ. BUG-0197 ("…where the window drew NONE") kept as-is: its assertions (figure list, digit-masked sentence identity) are a different shape.
- **filters.test.ts, the family-subtraction widening (BUG-0192 hazard 1 → BUG-0193)**: "drops the chip facets the URL contributed and keeps the ones with no control", "keeps a facet the surface merged in of its own accord", "keeps it when the URL happens to ask for the same value" → one `it.each(WIDENINGS)` titled "drops the chip facets the URL contributed and keeps the rest, on %s" (3 rows: buckets tab; standing tab; standing tab asked for its own bucket). Asserts the applied bucket, the widened filter, and non-mutation.
- **filters.test.ts, the dropped-key spelling (BUG-0127 → BUG-0136 → BUG-0137)**: "counts a parameter whose own NAME the app may not render, and spells none of it", "ignores a key that is empty or blank, exactly as it ignores an empty value", "ignores a key with no visible content, whatever its codepoints", "names a key that puts any ink on the page, however little", "still counts, and still refuses to spell, a name the app may not render", "spells a key only from the renderable allowlist, and counts every other", "ignores a key that is nothing but marks a reader cannot see", "still refuses to spell the parked word when an inkless mark rides along" → one `it.each(KEY_SPELLINGS)` titled "names, counts or ignores %o by its key's spelling alone, answering %o" (41 rows: every key the eight pins asserted, with the `{named, withheld}` each asserted; plus the empty-value and blank-key-beside-real-key params). Every call passes `[parked]` as the withheld list, the page's own call shape; the rows that were asserted without it have the same answer by the allowlist rule.
- **page.test.ts, the paging-state chain BUG-0216 → BUG-0222 → BUG-0226 — NOT merged, deliberately**: the three pins ("names the claim its first screen ENDS at…", "draws no claim twice when the list moved under the press…", "hands the client provider DATA only…") each assert a different property on a different artefact (the seeded `after`, the rendered run after an overlapping page, the serializability of the provider's props); there is no shared fixture table whose rows would reproduce their assertions, and none duplicates another. The table-driven case that already exists for the press-end states ("the window line in every state a press can end in") absorbed the three per-state pins listed above instead.
**Kept with a twin outside the group (after reconciliation):**

- `tests/offline/claims/page.test.ts` › "states what the COUNT read found and nothing about rows, where the window drew NONE [admin-window/BUG-0197]" ↔ `tests/offline/ui/primitives.test.ts` (WindowLine's own grading of the clause).
- `tests/offline/claims/page.test.ts` › "publishes the window it read, on both tabs, where an oracle can read it" ↔ `tests/offline/ui/primitives.test.ts` › "publishes the window it was handed, attribute by attribute" and `tests/offline/absence/pages.test.ts` (window hooks per surface).
- `tests/offline/claims/page.test.ts` › "draws the standing tab's per-source rows as links at rest" and "draws the bucket link so the WORDS carry the link's ink, not just the anchor" ↔ `tests/offline/ui/link-spelling.test.ts` (tree-wide chip-inside-link / link-at-rest rules).
- `tests/offline/claims/page.test.ts` › "writes every inter-element space as an explicit expression, which no transform may drop" ↔ `tests/offline/ui/copy.test.ts` › "leaves no file under src/ leaning on a space a transform may drop".
- `tests/offline/claims/page.test.ts` › "spells the window ONCE: the control names the number the driver grades against", "draws no control from a state off the grid, and never calls it exhausted", "does not tell the operator every claim is shown while its own count says more are not [admin-window/BUG-0180]" ↔ `tests/offline/ui/paging.test.ts` ("a next bound past the ceiling: no control either…", the two BUG-0180 pins, "the control is withdrawn…").
- `tests/offline/claims/page.test.ts` › "names no factory ticket on the ${tab} tab" ↔ the same loop in `tests/offline/sources/page.test.ts`, `tests/offline/cycles/page.test.ts`, `tests/offline/review-item/conflict-actions.test.ts` (one guard per page; not a twin, listed for the reconciler).
- `tests/offline/claims/filters.test.ts` › "links to the record where its fact's provenance is shown" and "offers no provenance link for a record that does not exist yet" ↔ `tests/offline/records/routes.test.ts` (`recordHref` is that leaf's).
**Suspected dead code (named, not touched):**

None found. Checked: `readPendingClaimRows` (pinned by read.test "excludes the parked bucket too…") is live in `src/app/queues/[reviewItemId]/page.tsx` and `src/lib/db/gauges.ts`; the aggregate's `domains` (pinned by pending-claims "lists the sources and domains present…") is read at `src/app/claims/page.tsx:981`.
**Group notes:**

- The case count landed at 259 of 374 (31% gone), short of "roughly half". Every remaining case either pins a refusal arm no other case pins, is the only pin on a distinct property (most of the gauge-window, two-fact attribution and paging describes), or has its twin in another group's file (listed above). I did not delete for the number.
- Course correction from the other agent honoured: every source-tree walker in `read.test.ts` (`queries pending_claims from src/lib/db/claims.ts alone` and the whole "the claims leaf reaches nothing that can reach a database" describe, including "is a real file with real imports…" and "resolves a BARREL specifier…", which I had first slated for deletion) is untouched.
- Not run (per the brief): vitest, tsc, eslint. Compiles-by-inspection: unused imports/consts/helpers removed in every file (`occurrencesIn`, `OVERFLOW`, `standingScript`, the `URLS`-only "the parked bucket" describe in page.test.ts; `ROUTE_FILE`/`routeSource`/`codeText`/`SOURCE_NAME` in the route file; `hasVisibleContent`/`codeLinesIn` in names.test.ts; `UNRENDERABLE_BUCKET`/`tablesRead`/`RecordedCall`/`ScriptedResponse` in in-window.test.ts; `isRenderableBucket`/`stuckPatternThreshold`/`SINCE` in pending-claims.test.ts; `GAUGE_MODULES`/`TABLE_NAMES`/`AFTER_UNTIL` in bounded.test.ts). Bracket balance per file matches HEAD (the route file's one-paren delta is the regex literal `Number\(` inside a deleted case). No empty describe remains. The merged key table in filters.test.ts spells every codepoint as a `\uXXXX` escape, as the originals did.
- Header prose: deleted only the in-window header paragraph ("Non-vacuity is asserted…") and the bounded header bullet ("six modules, one per row of spec §5") that described removed cases; nothing rewritten.
- `git status` shows many other `tests/offline/**` files modified — other groups' concurrent edits in the shared working tree, not mine.
### B — browse and paging (`browse/*`, `paging/*` bar claims-route, `ui/paging`, `order/newest-first`)

127 audit lines.

  ### tests/offline/order/newest-first.test.ts
- `tests/offline/order/newest-first.test.ts` › "ranks the instant ahead of the key, so the key never outvotes the clock" → covered by `tests/offline/order/newest-first.test.ts` › "puts the latest instant first, whatever order the rows arrived in" (its keys are ordered against the clock, so any key-first comparator reddens it)
- `tests/offline/order/newest-first.test.ts` › "ranks two spellings of two DIFFERENT instants by the clock" → covered by `tests/offline/order/newest-first.test.ts` › "compares INSTANTS, not the strings they arrived as" (a raw-string comparator reddens both; non-vacuity is "puts the latest instant first…")
  ### tests/offline/paging/answer.test.ts
- `tests/offline/paging/answer.test.ts` › "answers a page past the end as exhaustion, never as a refusal" → covered by `tests/offline/paging/browse-route.test.ts` › "never reports a row count the read did not return, at any bound on the grid"
- `tests/offline/paging/answer.test.ts` › "is OPTIONAL on the wire, and its absence is not a foreign body" → covered by `tests/offline/paging/answer.test.ts` › "accepts each of the four arms" (its error arm carries no `authored`)
- `tests/offline/paging/answer.test.ts` › "produces only answers the client's own guard accepts" → covered by `tests/offline/paging/browse-route.test.ts` › "is accepted by the client's own gate on all four arms"
  ### tests/offline/paging/bounds.test.ts
- `tests/offline/paging/bounds.test.ts` › "names no `DbResult`, and hands back the note objects untouched" → pins nothing: a boolean type guard cannot transform what it guards, so the identity holds by construction (the state-level identity is `tests/offline/paging/machine.test.ts` › "(1) appends the rows AND leaves the refused leg's note byte-identical on the state")
  ### tests/offline/paging/browse-route.test.ts
- `tests/offline/paging/browse-route.test.ts` › "is the first statement of the handler body" → covered by `tests/offline/paging/browse-route.test.ts` › "asks the gate before it reads the bound, so a stranger never learns the bound's verdict"
- `tests/offline/paging/browse-route.test.ts` › "serves the one canonical bound in that same table, so the table cannot pass by refusing everything" → covered by `tests/offline/paging/browse-route.test.ts` › "answers a FULL window that continues"
- `tests/offline/paging/browse-route.test.ts` › "refuses on the FIRST value of a repeated offset too" → covered by `tests/offline/paging/browse-route.test.ts` › "takes the FIRST value of a repeated offset, as URLSearchParams.get would"
- `tests/offline/paging/browse-route.test.ts` › "does its own arithmetic on the raw parameter nowhere" → covered by `tests/offline/paging/browse-route.test.ts` › "refuses %s with 400, naming it, and reads nothing" (a coercing route would serve "050", "1e2", " 50")
- `tests/offline/paging/browse-route.test.ts` › "answers a page past the end with zero rows and calls the set exhausted" → covered by `tests/offline/paging/browse-route.test.ts` › "never reports a row count the read did not return, at any bound on the grid"
- `tests/offline/paging/browse-route.test.ts` › "answers a FULL continuing page when every leg returns nothing at all" → covered by `tests/offline/browse/browse-read.test.ts` › "keeps a full window when EVERY leg returns nothing at all"
- `tests/offline/paging/browse-route.test.ts` › "answers a FULL continuing page when every row shares one venue and names no source" → covered by `tests/offline/browse/browse-read.test.ts` › "keeps a full window when rows SHARE a venue or name no source"
- `tests/offline/paging/browse-route.test.ts` › "runs the legs over exactly THIS page's ids" → covered by `tests/offline/browse/browse-read.test.ts` › "runs the three legs over THIS page's ids and no others"
- `tests/offline/paging/browse-route.test.ts` › "spells those directives nowhere but the shared constant" → covered by `tests/offline/paging/browse-route.test.ts` › "says so itself on all four arms, from the one constant"
  ### tests/offline/browse/browse-read.test.ts
- `tests/offline/browse/browse-read.test.ts` › "returns the rows newest-first by arrival, not by the calendar" → covered by `tests/offline/browse/page.test.ts` › "renders the newest arrival first"
- `tests/offline/browse/browse-read.test.ts` › "names the distinct sources behind each row, from the provenance join" → covered by `tests/offline/browse/page.test.ts` › "shows the source names the provenance join resolved"
- `tests/offline/browse/browse-read.test.ts` › "fills the venue name from the listings view" → covered by `tests/offline/browse/page.test.ts` › "shows the venue name from the listings view"
- `tests/offline/browse/browse-read.test.ts` › "reads only the four objects it needs, each named through tables.ts" → covered by `tests/offline/paging/browse-route.test.ts` › "reads the same objects whatever the URL says about views and tables"
- `tests/offline/browse/browse-read.test.ts` › "narrows each leg to the window's own ids" → covered by `tests/offline/browse/browse-read.test.ts` › "runs the three legs over THIS page's ids and no others"
- `tests/offline/browse/browse-read.test.ts` › "skips the sources leg when provenance named no source" → covered by `tests/offline/browse/browse-read.test.ts` › "skips the sources leg when every current decision is a verdict unset"
- `tests/offline/browse/browse-read.test.ts` › "orders the log by the decision stamp, then by its key" → pins nothing: the log is reduced in memory whatever its order and refused when truncated, so the query order carries no behaviour beyond the total order "asks each leg for an exact count, a total order and the row cap" pins
- `tests/offline/browse/browse-read.test.ts` › "names the source of the latest decision, never the superseded one" → covered by `tests/offline/browse/page.test.ts` › "does not name a superseded source, or a decision with no source"
- `tests/offline/browse/browse-read.test.ts` › "refuses a truncated log rather than calling a superseded source current" → covered by `tests/offline/browse/browse-read.test.ts` › "refuses a truncated provenance set instead of understating the sources"
- `tests/offline/browse/browse-read.test.ts` › "names events itself and renders no rows" → covered by `tests/offline/paging/browse-route.test.ts` › "answers a database with no events by NAMING it, not by erroring" (re-pointed after the second pass deleted the page-level survivor it first cited; the route drives the same `readRecentEvents` not_provisioned arm)
- `tests/offline/browse/browse-read.test.ts` › "still returns every event row when field_provenance is absent" → covered by `tests/offline/browse/page.test.ts` › "still renders the event rows with field_provenance absent, and says so"
- `tests/offline/browse/browse-read.test.ts` › "still returns every event row when the listings view is absent" → covered by `tests/offline/browse/page.test.ts` › "still renders the event rows with the listings view absent, and says so"
- `tests/offline/browse/browse-read.test.ts` › "surfaces the database's own words, never a message of ours" → covered by `tests/offline/browse/page.test.ts` › "shows the database's own words when a read fails"
- `tests/offline/browse/browse-read.test.ts` › "defaults to the first screen when no caller names one" → covered by `tests/offline/browse/browse-read.test.ts` › "orders the window on the view's own sort and bounds it with one window's range"
- `tests/offline/browse/browse-read.test.ts` › "still reports each leg's refusal on its own, one window in" → covered by `tests/offline/browse/page.test.ts` › "names which read failed, so the legs are told apart on screen"
- `tests/offline/browse/browse-read.test.ts` › "answers the rows the range returned, however deep the bound" → covered by `tests/offline/paging/browse-route.test.ts` › "never reports a row count the read did not return, at any bound on the grid"
  ### tests/offline/browse/views.test.ts
- `tests/offline/browse/views.test.ts` › "carries its query, the columns it may show, and its default sort" → covered by `tests/offline/browse/views.test.ts` › "sorts on arrival, never on the scheduled date"
- `tests/offline/browse/views.test.ts` › "configures every spot-verification column the spec names" → covered by `tests/offline/browse/page.test.ts` › "renders every spot-verification column, sources included"
- `tests/offline/browse/views.test.ts` › "defaults to a non-empty subset of what it configures" → covered by `tests/offline/browse/page.test.ts` › "draws exactly one control on a FULL first window, and leaves the first screen alone" (a bare URL renders `labelOf` of every configured key, which refuses an unconfigured default)
- `tests/offline/browse/views.test.ts` › "shows exactly the configured columns the URL names" → covered by `tests/offline/browse/views.test.ts` › "collapses duplicates and ignores the order the URL wrote"
- `tests/offline/browse/views.test.ts` › "ignores anything the view does not configure" → covered by `tests/offline/browse/page.test.ts` › "names a cols value that chose no column as a parameter it did not apply"
- `tests/offline/browse/views.test.ts` › "reads a repeated key the same as one comma-joined value" → covered by `tests/offline/browse/page.test.ts` › "reads a repeated cols the same way the columns did"
- `tests/offline/browse/views.test.ts` › "offers exactly the view's configured set — every one, nothing else" → covered by `tests/offline/browse/page.test.ts` › "offers the same set when the URL shows only one column"
- `tests/offline/browse/views.test.ts` › "offers the same set no matter which columns are currently shown" → covered by `tests/offline/browse/page.test.ts` › "offers the same set when the URL shows only one column"
- `tests/offline/browse/views.test.ts` › "marks exactly the shown columns as shown" → covered by `tests/offline/browse/page.test.ts` › "marks the shown columns active and the hidden ones not"
- `tests/offline/browse/views.test.ts` › "toggles a hidden column back on, restoring the set it came from" → covered by `tests/offline/browse/views.test.ts` › "changes exactly the toggled column and nothing else" (membership both ways; the order is re-read from the URL)
- `tests/offline/browse/views.test.ts` › "round-trips a non-default set through the query string" → covered by `tests/offline/browse/views.test.ts` › "round-trips through every href the selector actually renders"
- `tests/offline/browse/views.test.ts` › "round-trips every single-column set the selector can reach" → covered by `tests/offline/browse/views.test.ts` › "round-trips through every href the selector actually renders"
- `tests/offline/browse/views.test.ts` › "percent-encodes the value it puts in the URL" → pins nothing: the round-trip grades what the URL carries, the encoding is a spelling
- `tests/offline/browse/views.test.ts` › "spells the default set as nothing at all" → covered by `tests/offline/browse/page.test.ts` › "carries the COLUMN STATE the page rendered, and writes no offset into any URL"
- `tests/offline/browse/views.test.ts` › "round-trips every non-default set the selector can reach" → covered by `tests/offline/browse/views.test.ts` › "says the same thing the selector's own href says"
- `tests/offline/browse/views.test.ts` › "carries no offset: a bound is the press's, never the screen's" → covered by `tests/offline/browse/page.test.ts` › "carries the COLUMN STATE the page rendered, and writes no offset into any URL"
- `tests/offline/browse/views.test.ts` › "ignores the scheduled date entirely" → covered by `tests/offline/browse/page.test.ts` › "renders the newest arrival first" (its population's calendar order is the reverse of its arrival order)
- `tests/offline/browse/views.test.ts` › "says what the label rule says for a registry row that names nothing readable" → covered by `tests/offline/browse/views.test.ts` › "falls back per source, leaving a named sibling in the same read its name"
- `tests/offline/browse/views.test.ts` › "attributes provenance to the row it belongs to and no other" → covered by `tests/offline/browse/views.test.ts` › "keeps the same fact's decisions apart per entity"
- `tests/offline/browse/views.test.ts` › "still renders every event when no provenance came back at all" → covered by `tests/offline/browse/browse-read.test.ts` › "keeps a full window when EVERY leg returns nothing at all"
- `tests/offline/browse/views.test.ts` › "fills the venue name from the listing and leaves it null without one" → covered by `tests/offline/browse/page.test.ts` › "shows the venue name from the listings view" (null without a listing: `browse-read` › "keeps a full window when EVERY leg returns nothing at all")
- `tests/offline/browse/views.test.ts` › "returns rows in arrival order" → covered by `tests/offline/browse/page.test.ts` › "renders the newest arrival first"
- `tests/offline/browse/views.test.ts` › "names only the source behind the current value, not a superseded one" → covered by `tests/offline/browse/page.test.ts` › "does not name a superseded source, or a decision with no source"
- `tests/offline/browse/views.test.ts` › "contributes no source name for a decision that names no source" → covered by `tests/offline/browse/page.test.ts` › "does not name a superseded source, or a decision with no source"
- `tests/offline/browse/views.test.ts` › "names the source of a decision that came after a verdict unset" → covered by `tests/offline/browse/page.test.ts` › "does not name a superseded source, or a decision with no source" (latest-wins)
- `tests/offline/browse/views.test.ts` › "names the current source of every fact on a row, and none of the superseded ones" → covered by `tests/offline/browse/views.test.ts` › "keeps every distinct fact of the same entity" (and "names the distinct sources behind a row, alphabetically")
- `tests/offline/browse/views.test.ts` › "asks for no name for a decision that names no source" → covered by `tests/offline/browse/browse-read.test.ts` › "looks up names only for the sources still behind a value"
- `tests/offline/browse/views.test.ts` › "changes nothing when applied to its own result" → pins nothing: idempotence follows from latest-per-fact, which "keeps one decision per fact identity, whatever the log's order" pins
- `tests/offline/browse/views.test.ts` › "is empty for an empty log" → covered by `tests/offline/browse/browse-read.test.ts` › "keeps a full window when EVERY leg returns nothing at all"
  ### tests/offline/browse/page.test.ts
- `tests/offline/browse/page.test.ts` › "offers exactly the configured column set — every one, nothing else" → covered by `tests/offline/browse/page.test.ts` › "offers the same set when the URL shows only one column"
- `tests/offline/browse/page.test.ts` › "ignores a column the view does not configure" → covered by `tests/offline/browse/page.test.ts` › "names a cols value that chose no column as a parameter it did not apply" (`title,banana` → `[title]`)
- `tests/offline/browse/page.test.ts` › "shows the default set when the URL says nothing about columns" → covered by `tests/offline/browse/page.test.ts` › "draws exactly one control on a FULL first window, and leaves the first screen alone" (bare URL → every configured label)
- `tests/offline/browse/page.test.ts` › "renders the rows when the database is whole" → covered by `tests/offline/browse/page.test.ts` › "renders the newest arrival first"
- `tests/offline/browse/page.test.ts` › "keeps a refused leg reported after a later page whose legs answered" → covered by `tests/offline/paging/machine.test.ts` › "(5) MERGES per key: a standing note survives a later page whose legs answered" (the wrapper renders whatever the state holds: "renders a PAGED leg's report below the table, in the same hook and words the first screen uses")
- `tests/offline/browse/page.test.ts` › "draws no control from a SHORT first window, and says the set is complete rather than claiming a ceiling" → covered by `tests/offline/ui/paging.test.ts` › "exhausted on a bound that is off the grid — the legitimate FINAL page — still says the set is complete"
- `tests/offline/browse/page.test.ts` › "does not claim rows are withheld once the walk has reached the end of the set" → covered by `tests/offline/browse/page.test.ts` › "states the rows the operator now holds, and drops the withheld claim when the read ends the set"
- `tests/offline/browse/page.test.ts` › "takes continuability from the page's own statement, not from the rows it drew [admin-window/BUG-0183]" → covered by `tests/offline/browse/page.test.ts` › "the window line in every state a press can end in" (exhausted → `truncated="false"` whatever is drawn)
- `tests/offline/browse/page.test.ts` › "says the set is complete when its read ends, because it has no second read to disagree with [admin-window/BUG-0180]" → covered by `tests/offline/ui/paging.test.ts` › "derives the two-reads verdict ONCE, over the one window, for the line and the control alike [admin-window/BUG-0180]"
- `tests/offline/browse/page.test.ts` › "is one element while a press is in FLIGHT, and says what the rows still say" → covered by `tests/offline/browse/page.test.ts` › "the window line in every state a press can end in"
- `tests/offline/browse/page.test.ts` › "a refused press settles nothing: the line is what it was before it" → covered by `tests/offline/browse/page.test.ts` › "the window line in every state a press can end in" (byte-identical pin beside the behavioural one)
- `tests/offline/browse/page.test.ts` › "at the bound ceiling it still says rows are not shown" → covered by `tests/offline/browse/page.test.ts` › "the window line in every state a press can end in" (byte-identical pin beside the behavioural one)
- `tests/offline/browse/page.test.ts` › "spells no leg key and imports no lib/db type" → pins nothing: grades how the wrapper is written; what it renders is "renders a PAGED leg's report below the table, in the same hook and words the first screen uses"
- `tests/offline/browse/page.test.ts` › "moves nothing else on the page" → covered by `tests/offline/browse/page.test.ts` › "names a key this route does not read at all, whatever it is called" (byte-identical page beside the behavioural pin)
  ### tests/offline/paging/machine.test.ts
- `tests/offline/paging/machine.test.ts` › "holds none of the first screen's own rows" → covered by `tests/offline/paging/machine.test.ts` › "starts idle when the first screen says there is more, exhausted when it does not"
- `tests/offline/paging/machine.test.ts` › "drops the pages taken after a bound the first screen no longer ends at" → merged (see Merged chains)
- `tests/offline/paging/machine.test.ts` › "keeps the pages taken in when the first screen still ends where they started" → merged
- `tests/offline/paging/machine.test.ts` › "drops a page that was still in flight when the first screen changed" → merged (the same `continuing` call on the same fixture as the first)
- `tests/offline/paging/machine.test.ts` › "appends every row of an ordinary page — the fixture the guard must NOT flag" → merged
- `tests/offline/paging/machine.test.ts` › "drops a row the screen above already holds, and draws every id once" → merged
- `tests/offline/paging/machine.test.ts` › "a page deduped to ZERO appended rows is not exhaustion, and the bound still moves" → merged
- `tests/offline/paging/machine.test.ts` › "drops a row a PAGE carries twice, whatever the route answers" → merged
- `tests/offline/paging/machine.test.ts` › "appends rows whose id is ABSENT rather than collapsing them into one" → merged
- `tests/offline/paging/machine.test.ts` › "never throws on a row it cannot NAME, and appends it rather than dropping it" → merged (its seven shapes are seven rows)
- `tests/offline/paging/machine.test.ts` › "names a row by the FIELD the surface declared, and only that field" → merged
- `tests/offline/paging/machine.test.ts` › "issues exactly ONE request per press from idle, at the bound it holds" → covered by `tests/offline/paging/machine.test.ts` › "appends an ok answer in the order received and grows the bound by the WINDOW"
- `tests/offline/paging/machine.test.ts` › "takes the answer's own word for exhaustion, and stops pressing on it" → covered by `tests/offline/paging/machine.test.ts` › "a page that SAYS the set ended: appends what it carries, however short, and ends exhausted" (and "issues NO request from loading or from exhausted, and returns that state untouched")
- `tests/offline/paging/machine.test.ts` › "a FULL window that continues: appends in order, grows held by the WINDOW, stays idle" → covered by `tests/offline/paging/machine.test.ts` › "appends an ok answer in the order received and grows the bound by the WINDOW" (clearing: "is cleared by the next press that succeeds")
- `tests/offline/paging/machine.test.ts` › "an EMPTY page behaves exactly as it always has, whatever it says about the end" → covered by `tests/offline/paging/machine.test.ts` › "reads an ok answer with NO rows as exhaustion, not as a refusal"
- `tests/offline/paging/machine.test.ts` › "(2) holds a record of nulls when both legs answered" → covered by `tests/offline/paging/machine.test.ts` › "(5b) a key that is null or absent TAKES a later page's note" (`first.notes` toEqual `{ venues: null }`)
- `tests/offline/paging/machine.test.ts` › "(4b) an unreadable notes field on a page that WOULD have landed — the must-not-flag half" → covered by `tests/offline/paging/machine.test.ts` › "(1) appends the rows AND leaves the refused leg's note byte-identical on the state"
- `tests/offline/paging/machine.test.ts` › "takes the matching bound every honest answer carries — the must-NOT-flag half" → covered by `tests/offline/paging/machine.test.ts` › "appends an ok answer in the order received and grows the bound by the WINDOW"
- `tests/offline/paging/machine.test.ts` › "never extends the list: a body that never parsed" → covered by `tests/offline/paging/machine.test.ts` › "never extends the list: a rejected request"
- `tests/offline/paging/machine.test.ts` › "leaves the press repeatable, at the same bound" → covered by `tests/offline/ui/paging.test.ts` › "never throws out of the press, and a refusal leaves the press repeatable"
- `tests/offline/paging/machine.test.ts` › "hands back the SAME object from loading and from exhausted" → covered by `tests/offline/paging/machine.test.ts` › "pressing carries the notes through, and still hands back the SAME object"
- `tests/offline/paging/machine.test.ts` › "is idempotent, so a third press is as free as the second" → covered by `tests/offline/paging/machine.test.ts` › "pressing carries the notes through, and still hands back the SAME object"
- `tests/offline/paging/machine.test.ts` › "issues ZERO requests when the state has already been pressed" → covered by `tests/offline/paging/machine.test.ts` › "issues NO request from loading or from exhausted, and returns that state untouched"
- `tests/offline/paging/machine.test.ts` › "issues exactly ONE from the pre-press state, so the pin above is not vacuous" → covered by `tests/offline/paging/machine.test.ts` › "appends an ok answer in the order received and grows the bound by the WINDOW"
- `tests/offline/paging/machine.test.ts` › "and never with the words: a sentence no constant in this app spells is still this app's" → covered by `tests/offline/paging/machine.test.ts` › "authorship travels with the THROW: the SAME words are the machine's when this app did not throw them"
- `tests/offline/paging/machine.test.ts` › "a press that succeeds still leaves no refusal to ask the question of" → covered by `tests/offline/paging/machine.test.ts` › "appends an ok answer in the order received and grows the bound by the WINDOW"
  ### tests/offline/ui/paging.test.ts
- `tests/offline/ui/paging.test.ts` › "a bound refusal names no third object, and gets the reason alone rather than a dangling dash" → covered by `tests/offline/ui/paging.test.ts` › "the identifier stays mono on every arm, and dir=ltr isolates exactly the run this app did not write" (arm d)
- `tests/offline/ui/paging.test.ts` › "leaves the row markup handed to the surface untouched, refusal or not" → pins nothing: a sibling component cannot rewrite rows the test itself rendered beside it
- `tests/offline/ui/paging.test.ts` › "says nothing at all on a state no press has changed" → merged (see Merged chains)
- `tests/offline/ui/paging.test.ts` › "says it ONCE when a press met rows the state already held" → merged
- `tests/offline/ui/paging.test.ts` › "stands beside every other arm, because a list that moved has moved" → merged
- `tests/offline/ui/paging.test.ts` › "draws no control at all — absent from the markup, not merely disabled" → covered by `tests/offline/ui/paging.test.ts` › "puts no other sentence in its place: the clause is the whole of the area" (no `[data-paging]` at all; the retryable twin is asserted there too)
- `tests/offline/ui/paging.test.ts` › "is what a PRESS ends in, driven through the real driver, and it moves no row and no bound" → covered by `tests/offline/paging/machine.test.ts` › "the not-provisioned arm carries the object and composes no sentence" (exact state shape the widget cases render)
- `tests/offline/ui/paging.test.ts` › "an alert that names no failure never reaches the operator" → covered by `tests/offline/paging/machine.test.ts` › "a refusal that carried no words still says a press was refused"
- `tests/offline/ui/paging.test.ts` › "the operator's refusal is EXACTLY that sentence, with this app's own route as its object" → covered by `tests/offline/ui/paging.test.ts` › "grades every arm a press can reach: four sentences this app wrote, and one it did not" (arm a, through the driver and the markup)
- `tests/offline/ui/paging.test.ts` › "a PLATFORM rejection still passes its own words through" → covered by `tests/offline/ui/paging.test.ts` › "passes a rejection's own words through when it has some"
- `tests/offline/ui/paging.test.ts` › "renders the first screen's own affordance before any press" → covered by `tests/offline/browse/page.test.ts` › "one press issues one request at an explicit bound; no press issues none" (and the hook pass-through by "draws no control at all when the first screen said there is no more")
- `tests/offline/ui/paging.test.ts` › "presses no further once the answer says the set is exhausted" → covered by `tests/offline/ui/paging.test.ts` › "a press after the answer lands asks for the NEXT bound, never the same one twice"
- `tests/offline/ui/paging.test.ts` › "fires its request from a ref, never from inside a setState updater" → pins nothing: a source-text spelling; the behaviour is "a second press while one is in flight issues NO second request"
- `tests/offline/ui/paging.test.ts` › "reads its state through the first screen it is now drawing, at both points" → pins nothing: a source-text regex on the hook's exact spelling; the rule is driven by `machine.test.ts` › "keeps the pages taken in only while the first screen %s"
- `tests/offline/ui/paging.test.ts` › "renders the line without comparing any number to the cap" → covered by `tests/offline/ui/paging.test.ts` › "whose number held is, is a fact the window states, never a size it compares"
- `tests/offline/ui/paging.test.ts` › "is ONE element in every state a press can end in" → covered by `tests/offline/browse/page.test.ts` › "the window line in every state a press can end in"
- `tests/offline/ui/paging.test.ts` › "a press that answers not_provisioned withdraws the control and leaves the window line to the byte [admin-window/BUG-0211]" → covered by `tests/offline/ui/paging.test.ts` › "puts no other sentence in its place: the clause is the whole of the area" (line truncation: "takes truncation from the paging state's status and from nothing else")
- `tests/offline/ui/paging.test.ts` › "keeps no next step of its own, for any surface, and says whatever it is handed" → covered by `tests/offline/ui/paging.test.ts` › "`/claims` still gets a next step, and it is that surface's own" (appended verbatim; none when handed none: "`/browse` is told what stopped the paging, and nothing its URL cannot do")
- `tests/offline/ui/paging.test.ts` › "still offers a way to the rest of the set, or says the set is complete" → covered by `tests/offline/paging/machine.test.ts` › "SHORT and still continuing: refused OUT LOUD, naming the route, with one request made" (an `it.fails`-turned-`it` whose fix landed)
- `tests/offline/ui/paging.test.ts` › "a full window still pages on, so the case above is about the short page alone" → covered by `tests/offline/paging/machine.test.ts` › "appends an ok answer in the order received and grows the bound by the WINDOW"
- `tests/offline/ui/paging.test.ts` › "a reason this app wrote reads in sans, a reason the answer carried reads in mono" → covered by `tests/offline/ui/paging.test.ts` › "grades every arm a press can reach: four sentences this app wrote, and one it did not"
- `tests/offline/ui/paging.test.ts` › "reads an answer carrying NO authorship exactly as it did before the fact existed" → covered by `tests/offline/ui/paging.test.ts` › "grades every arm a press can reach: four sentences this app wrote, and one it did not" (arm e; isolation by "the identifier stays mono on every arm…")
- `tests/offline/ui/paging.test.ts` › "refuses an answer whose authorship is unreadable, rather than rendering it" → covered by `tests/offline/paging/answer.test.ts` › "is refused whole when it is PRESENT and unreadable"
  Orchestrator's cross-group reconciliation (message from `a2813991cd2306159`); survivors verified by them.
- `tests/offline/browse/views.test.ts` › "points an event row at its own record surface" → covered by `tests/offline/records/routes.test.ts` › "names one canonical row, whatever its domain"
- `tests/offline/browse/views.test.ts` › "encodes an id that would otherwise change the path" → covered by `tests/offline/records/routes.test.ts` › "encodes BOTH halves, because both are data"
- `tests/offline/browse/page.test.ts` › "keeps its line on a read that found nothing, and drops it on one that did not happen" → covered by `tests/offline/absence/pages.test.ts` › "drops every window it publishes on a healthy read when the read never happened" and "keeps every window it publishes on a read that happened and found nothing"
- `tests/offline/browse/page.test.ts` › "names the missing table when events itself is absent" → covered by `tests/offline/absence/pages.test.ts` › "survives %s being absent" (the /browse describe) and "%s names every object it asked for and invents no number" (it asserted only the name, no "0 events" and no table — no second surface beside the absence, so nothing to keep)
  Orphans removed with them: the `describe("the record link")` block and the `recordHref` import in `views.test.ts`. Nothing else in `page.test.ts` was orphaned (`windowLine`, `tableNotInSchemaCache` and `cheerio` all have other callers). Both files parse-checked and import-scanned clean again.
**Merged chains:**

- **BUG-0216 (first screen changes underneath), `tests/offline/paging/machine.test.ts`.** New `it.each(SCREEN_AGAIN)` titled "keeps the pages taken in only while the first screen %s" (2 rows: "no longer ends at the bound the pages started from" / "still ends where the pages started"). Replaces "drops the pages taken after a bound the first screen no longer ends at", "keeps the pages taken in when the first screen still ends where they started", "drops a page that was still in flight when the first screen changed". Asserts exactly what they did: the drawn run after `continuing`, identity (`toBe(held)`) for the unchanged screen, `rows` empty and `held === SIZE` for the moved one.
- **BUG-0222/0226 (one drawn list never holds one id twice), `tests/offline/paging/machine.test.ts`.** New `it.each(LANDINGS)` titled "one press lands %s" (13 rows: ordinary page, screen's-last-row overlap, fully-held page, in-page duplicate, absent ids, the seven unnameable rows, repeat-in-another-field). Replaces "appends every row of an ordinary page — the fixture the guard must NOT flag", "drops a row the screen above already holds, and draws every id once", "a page deduped to ZERO appended rows is not exhaustion, and the bound still moves", "drops a row a PAGE carries twice, whatever the route answers", "appends rows whose id is ABSENT rather than collapsing them into one", "never throws on a row it cannot NAME, and appends it rather than dropping it", "names a row by the FIELD the surface declared, and only that field". Every row asserts: refusal null, status idle, the exact rows appended, `held === SIZE*2`, the `overlapped` flag, and distinct-count-equals-length over the named ids. The multi-press cases ("advances the bound by the ROUTE's row count…", "walks a population…", "states the overlap once it has happened, and not before", "keeps the ids and the overlap across a refused press…", "holds the first screen's ids from the start…") stay as they were.
- **BUG-0222 overlap line, `tests/offline/ui/paging.test.ts`.** New `it.each(OVERLAP_ARMS)` titled "states the overlap once if the list moved and not at all before: %s" (7 rows: idle/exhausted/loading unmoved → 0 lines; idle/exhausted/loading/refused moved → 1 line, no button inside). Replaces "says nothing at all on a state no press has changed", "says it ONCE when a press met rows the state already held", "stands beside every other arm, because a list that moved has moved". The control beside it is still pinned by the surviving "keeps the control and the rows: an overlap is not a refusal and not an end".
- The surface-level pins of the same chain in `browse/page.test.ts` ("names the event its first screen ENDS at…", "hands the client provider DATA only…", "draws no event twice when the list moved under the press, and says so once") grade the page's seeding and composition, not the driver's transition, and were kept.
- Both new tables are declared as `ReadonlyArray<readonly [...]>` constants and consumed as `it.each(NAME)(…)` so the brief's static-count grep matches them (same shape as `browse-route.test.ts`'s `REFUSED`).
**Kept with a twin outside the group (after reconciliation):**

- `tests/offline/order/newest-first.test.ts` › "breaks a tie on the key column, descending" ↔ `tests/offline/cycles/read.test.ts` › "breaks a tie on the primary key, descending"
- `tests/offline/order/newest-first.test.ts` › "sorts an unreadable instant last, in each of its spellings, and keeps the row" ↔ `tests/offline/cycles/read.test.ts` › "sorts a timestamp it cannot read last, and keeps the row"
- `tests/offline/order/newest-first.test.ts` › "does not mutate what it was given" ↔ `tests/offline/cycles/read.test.ts` › "does not mutate what it was given" (identical call on the runs pair)
- ~~`tests/offline/browse/views.test.ts` › "points an event row at its own record surface"~~ — deleted in the second pass on the orchestrator's reconciliation
- ~~`tests/offline/browse/views.test.ts` › "encodes an id that would otherwise change the path"~~ — deleted in the second pass
- `tests/offline/browse/views.test.ts` › "calls a database procedure from the settlement seam alone" ↔ `tests/offline/edit/config.test.ts` › "calls a database procedure from exactly one module" (kept regardless per the course correction: it is a source-tree walker the probe-race test plants against)
- `tests/offline/browse/browse-read.test.ts` › "names the missing COLUMN when the database complains about one" ↔ `tests/offline/db/result.test.ts` (owner of `undefinedQualifiedColumn` classification)
- `tests/offline/browse/page.test.ts` › "links every row to its own record surface" ↔ `tests/offline/records/routes.test.ts` › "browse draws the helper's href verbatim in the row's anchor"
- ~~`tests/offline/browse/page.test.ts` › "keeps its line on a read that found nothing, and drops it on one that did not happen"~~ — deleted in the second pass
- `tests/offline/ui/paging.test.ts` › "moves no other button's width: the width lives at this call site [admin-window/BUG-0177]" ↔ `tests/offline/ui/primitives.test.ts` (Button primitive's own classes; no exact twin found by grep, so this one is a weak candidate)
**Suspected dead code (named, not touched):**

- none. No `src/` path was reachable only through a deleted case; the deleted structural pins (`paged-browse-table.tsx` leg-key spelling, `paging.tsx` `useRef`/`continuing(...)` spellings, the route's `no-store` spelling) describe live code that the surviving behavioural cases still drive.
**Group notes:**

- Did not run vitest/tsc/eslint (forbidden). Each edited file was parse-checked with `typescript.createSourceFile` (syntax only, no type-check) and scanned for unused imports / single-reference declarations with a `node -e` script; all nine are clean by that inspection. Types in the three new tables mirror the existing `REFUSED` table's shape; the one cast in the `LANDINGS` case (`row as { id?: unknown } | null`) narrows a `Row` to a compatible shape and should type-check, but it is the one line I could not prove without `tsc`.
- Target was "roughly half"; the rule, applied case by case, removed 120 of 390 static cases (31%). The remainder are mostly distinct surface/arm pins (`browse/page.test.ts` and the PageMore arm matrix in `ui/paging.test.ts`) that fail on different regressions. I did not stretch the rule to reach the number.
- Course correction from `a2813991cd2306159` honoured: the three source-tree walkers in `views.test.ts` ("has no SQL-executing route…", "calls a database procedure from the settlement seam alone", "defines its views in exactly one file") are untouched and the file survives.
- Header prose: only two phrases describing deleted cases were removed (in `views.test.ts`, the clause "which is what makes the case above non-vacuous per ROW rather than per read" and the whole docstring of the deleted label-rule case). Other header paragraphs that mention a deleted case in passing (e.g. the offset bullets in `browse-read.test.ts`) were left rather than rewritten.
### C1 — cycles, runs, dashboard (`cycles/*`, `runs/*`, `dashboard/*`, `gauges/cycle-health`, `gauges/resolution-latency`)

71 audit lines.

- `tests/offline/cycles/read.test.ts` › "reads a fresh null ended_at as still running" → covered by `tests/offline/cycles/read.test.ts` › "turns over from running to died at one cadence, and not before"
- `tests/offline/cycles/read.test.ts` › "says a cycle that ended with no outcome recorded none, and invents none" → covered by `tests/offline/cycles/read.test.ts` › "treats an outcome of whitespace alone as no outcome recorded at all"
- `tests/offline/runs/read.test.ts` › "leaves the other thirteen columns of the table out of M1" → covered by `tests/offline/runs/read.test.ts` › "is exactly the nine Ben ruled on 2026-09-02, in that order"
- `tests/offline/runs/read.test.ts` › "keeps a run whose source name no registry row carries" → covered by `tests/offline/runs/read.test.ts` › "still narrows by a name this app can spell: %s [admin-window/BUG-0153]"
- `tests/offline/runs/read.test.ts` › "answers a name that matches nothing with an empty window, not a refusal" → covered by `tests/offline/runs/read.test.ts` › "still narrows by a name this app can spell: %s [admin-window/BUG-0153]"
- `tests/offline/runs/read.test.ts` › "narrows by a padded name exactly as by its twin: %s [admin-window/BUG-0155]" (3 params) → covered by `tests/offline/runs/read.test.ts` › "still narrows by a name this app can spell: %s [admin-window/BUG-0153]" (its "blanks around ink" row)
- `tests/offline/gauges/cycle-health.test.ts` › "counts every row exactly once, whatever state it is in" → covered by `tests/offline/gauges/cycle-health.test.ts` › "counts every outcome, with a cycle that has not finished under its own name"
- `tests/offline/gauges/cycle-health.test.ts` › "fetches and aggregates in one call" → covered by `tests/offline/cycles/page.test.ts` › "renders its window, its counts and its outcome spread"
- `tests/offline/gauges/cycle-health.test.ts` › "passes a not-provisioned database straight through" → covered by `tests/offline/cycles/page.test.ts` › "leaves a SURFACE's own refusal outside the exclusion [admin-window/BUG-0036]"
- `tests/offline/gauges/resolution-latency.test.ts` › "runs no second query when the window held no applies" → covered by `tests/offline/gauges/resolution-latency.test.ts` › "runs no second query when the window held nothing but unsets"
- `tests/offline/gauges/resolution-latency.test.ts` › "fetches and aggregates in one call" → covered by `tests/offline/cycles/page.test.ts` › "counts the applies, and never the raw window it read"
- `tests/offline/gauges/resolution-latency.test.ts` › "is not counted as an apply whose observation the join lost" → covered by `tests/offline/gauges/resolution-latency.test.ts` › "reads a null observation_id as the unset, whatever source_id holds"
- `tests/offline/gauges/resolution-latency.test.ts` › "is not counted among the applies, overall or per domain" → covered by `tests/offline/gauges/resolution-latency.test.ts` › "reads a null observation_id as the unset, whatever source_id holds"
- `tests/offline/gauges/resolution-latency.test.ts` › "is not an unmeasurable apply either — it is not one of the measurements" → covered by `tests/offline/gauges/resolution-latency.test.ts` › "reads a null observation_id as the unset, whatever source_id holds"
- `tests/offline/gauges/resolution-latency.test.ts` › "is counted honestly on its own, overall and per domain" → covered by `tests/offline/gauges/resolution-latency.test.ts` › "splits every row read into exactly one population, per domain and overall"
- `tests/offline/gauges/resolution-latency.test.ts` › "keeps a real lost join distinguishable from an unset" → covered by `tests/offline/gauges/resolution-latency.test.ts` › "splits every row read into exactly one population, per domain and overall"
- `tests/offline/runs/page.test.ts` › "shows no tenth column — not the primary key, not one of the other thirteen" → covered by `tests/offline/runs/page.test.ts` › "renders exactly the nine ruled columns, in the ruled order"
- `tests/offline/runs/page.test.ts` › "passes the name to the read, and matches by name rather than by key" → covered by `tests/offline/cycles/page.test.ts` › "%s: the .eq value, the facet hook, the rendered box and the window line are ONE string"
- `tests/offline/runs/page.test.ts` › "makes the unfaceted claim about the table only when the read was unfaceted" → pins nothing: copy-oracle of the unfaceted window sentence (the floor instant it also reads is pinned by "names the oldest run it holds when the window did not fill")
- `tests/offline/runs/page.test.ts` › "says a facet that matched nothing found nothing OF THAT SOURCE" → pins nothing: copy-oracle of the window sentence (the name reaching the page is pinned by "renders the empty state with a stated 0 when the name matches nothing")
- `tests/offline/runs/page.test.ts` › "renders a facet value the URL invented as text, never as markup" → covered by `tests/offline/cycles/page.test.ts` › "renders a facet value the URL invented as text, never as markup"
- `tests/offline/runs/page.test.ts` › "renders the empty state with a stated 0 when no adapter has ever run" → covered by `tests/offline/runs/page.test.ts` › "renders the empty state with a stated 0 when the name matches nothing"
- `tests/offline/dashboard/page.test.ts` › "counts open items alone — a settled item is browsable, never attention" → covered by `tests/offline/dashboard/page.test.ts` › "renders decision and signal counts as two separate figures"
- `tests/offline/dashboard/page.test.ts` › "names what fills that queue, in the words the queue's own empty state uses" → covered by `tests/offline/dashboard/page.test.ts` › "names its own queue's filler and never the other card's"
- `tests/offline/dashboard/page.test.ts` › "surfaces each error_summary verbatim, linked to the row that produced it" → covered by `tests/offline/dashboard/page.test.ts` › "renders the shared absence, not an empty cell, where there is no error"
- `tests/offline/dashboard/page.test.ts` › "does not paint a succeeded cycle green when its own row reports errors [admin-window/BUG-0106]" → covered by `tests/offline/dashboard/page.test.ts` › "gives every cycle the same tone the Cycles & runs page gives it [admin-window/BUG-0106]"
- `tests/offline/dashboard/page.test.ts` › "describes the read it made the same way in both states" → pins nothing: asserts two app sentences share a 20-character tail
- `tests/offline/dashboard/page.test.ts` › "keeps the surfaces independent — one absent table leaves the others rendering" → covered by `tests/offline/dashboard/page.test.ts` › "names the absent object without a zero anywhere in the card that names it"
- `tests/offline/dashboard/page.test.ts` › "never renders more lines than the window it asked for" → pins nothing: hands the page exactly the cap and reads the cap back
- `tests/offline/dashboard/page.test.ts` › "renders the source of every run row it was handed" → covered by `tests/offline/dashboard/page.test.ts` › "shows a run's source, when, outcome and error — and no other run column"
- `tests/offline/dashboard/page.test.ts` › "reads an adapter run still in flight as running, not as a blank" → covered by `tests/offline/dashboard/page.test.ts` › "keeps a failed cycle broken and an adapter run's tone unchanged [admin-window/BUG-0106]"
- `tests/offline/dashboard/page.test.ts` › "reads a cycle younger than one cadence as running" → covered by `tests/offline/dashboard/page.test.ts` › "reads a still-running cycle and a skipped cycle each as such"
- `tests/offline/dashboard/page.test.ts` › "does not read a cycle older than one cadence as running" → covered by `tests/offline/dashboard/page.test.ts` › "tells the two no-outcome states apart on both surfaces"
- `tests/offline/cycles/page.test.ts` › "shows a cycle that died as dead, not as running forever" → covered by `tests/offline/cycles/page.test.ts` › "keeps a failed cycle broken, and a state that is not an outcome unchanged"
- `tests/offline/cycles/page.test.ts` › "states the window it is showing, and never presents it as a count" → covered by `tests/offline/cycles/page.test.ts` › "still states the cycles window on a read that happened, empty or not"
- `tests/offline/cycles/page.test.ts` › "marks nothing for a ?cycle= carrying no id at all [admin-window/BUG-0054]" → covered by `tests/offline/cycles/page.test.ts` › "spells nothing and reports the facet for a ?cycle= it may not print: %s [admin-window/BUG-0147]"
- `tests/offline/cycles/page.test.ts` › "marks nothing for a ?cycle= that is not a run id at all [admin-window/BUG-0054]" → covered by `tests/offline/cycles/page.test.ts` › "still spells a ?cycle= it may print: %s [admin-window/BUG-0147]"
- `tests/offline/cycles/page.test.ts` › "answers a non-canonical spelling with the very page the canonical one gets" → covered by `tests/offline/cycles/page.test.ts` › "marks the cycle a non-canonical spelling of a real id names [admin-window/BUG-0143]"
- `tests/offline/cycles/page.test.ts` › "still finds no cycle when %s sits INSIDE the id [admin-window/BUG-0146]" (2 params) → covered by `tests/offline/cycles/page.test.ts` › "spells nothing and reports the facet for a ?cycle= it may not print: %s [admin-window/BUG-0147]"
- `tests/offline/cycles/page.test.ts` › "never lets a URL's bidi control into the sentence the page wrote [admin-window/BUG-0147]" → covered by `tests/offline/cycles/page.test.ts` › "spells nothing and reports the facet for a ?cycle= it may not print: %s [admin-window/BUG-0147]"
- `tests/offline/cycles/page.test.ts` › "renders the empty state, not a zero, when no cycle has ever run" → covered by `tests/offline/cycles/page.test.ts` › "answers a ?cycle= link off an empty read, which is evidence and not a refusal"
- `tests/offline/cycles/page.test.ts` › "leaves the word itself untouched — only the colour is the app's reading" → covered by `tests/offline/cycles/page.test.ts` › "does not paint a succeeded cycle green when its own row reports errors [admin-window/BUG-0106]"
- `tests/offline/cycles/page.test.ts` › "leaves no row on the page showing errors and a healthy word" → covered by `tests/offline/cycles/page.test.ts` › "does not paint a succeeded cycle green when its own row reports errors [admin-window/BUG-0106]"
- `tests/offline/cycles/page.test.ts` › "counts the cycles it excludes as one number, wherever the page states it" → covered by `tests/offline/cycles/page.test.ts` › "counts its whole excluded set on a mixed window, not the dead within it (admin-window/BUG-0110)"
- `tests/offline/cycles/page.test.ts` › "excludes the cycle that is still in flight, and counts it once" → covered by `tests/offline/cycles/page.test.ts` › "counts its whole excluded set on a mixed window, not the dead within it (admin-window/BUG-0110)"
- `tests/offline/cycles/page.test.ts` › "says the window held nothing when the resolver has applied nothing" → covered by `tests/offline/cycles/page.test.ts` › "renders no latency figure where the window holds no decisions (admin-window/BUG-0206)"
- `tests/offline/cycles/page.test.ts` › "does not claim the cycle is absent when resolution_runs is not provisioned [admin-window/BUG-0023]" → covered by `tests/offline/cycles/page.test.ts` › "names the cycle in the database's spelling when no window was read at all"
- `tests/offline/cycles/page.test.ts` › "does not claim the cycle is absent when the read of resolution_runs was refused [admin-window/BUG-0023]" → covered by `tests/offline/cycles/page.test.ts` › "names the cycle in the database's spelling when no window was read at all"
- `tests/offline/cycles/page.test.ts` › "holds the verdict back for a transport failure too, not only a refusal" → covered by `tests/offline/cycles/page.test.ts` › "names the cycle in the database's spelling when no window was read at all"
- `tests/offline/cycles/page.test.ts` › "still answers the ?cycle= link when the read did return a window" → covered by `tests/offline/cycles/page.test.ts` › "marks the cycle a Dashboard link asked for, and says so when it is not here"
- `tests/offline/cycles/page.test.ts` › "says which half the facet narrows, and narrows none of the cycles itself" → covered by `tests/offline/runs/page.test.ts` › "says the facet applies to the runs half, and narrows none of the cycles"
- `tests/offline/cycles/page.test.ts` › "never lets a ?source= bidi control into the sentences the page wrote [admin-window/BUG-0153]" → covered by `tests/offline/cycles/page.test.ts` › "spells nothing and reports the facet for a ?source= it may not print: %s [admin-window/BUG-0153]"
- `tests/offline/cycles/page.test.ts` › "takes the first value when the URL names the source twice" → covered by `tests/offline/runs/page.test.ts` › "takes the first value when the URL names the source twice"
- `tests/offline/cycles/page.test.ts` › "still spells a ?source= it may print, in both sentences: %s [admin-window/BUG-0153]" (5 params) → covered by `tests/offline/cycles/page.test.ts` › "%s: the .eq value, the facet hook, the rendered box and the window line are ONE string" (its invented-markup row by "renders a facet value the URL invented as text, never as markup")
- `tests/offline/cycles/page.test.ts` › "shows the ?source= name it queried, not one the browser collapsed [admin-window/BUG-0155]" → covered by `tests/offline/cycles/page.test.ts` › "%s: the .eq value, the facet hook, the rendered box and the window line are ONE string" (all four of its values are rows there)
- `tests/offline/cycles/page.test.ts` › "is a second section, and the cycles half is unchanged by it" → pins nothing: h2 headings and table aria-labels asserted verbatim; the fold order is pinned by "leads with the window's newest run, ahead of a cycles window at its cap"
- `tests/offline/cycles/page.test.ts` › "reads the runs table separately from the cycles table" → covered by `tests/offline/runs/page.test.ts` › "keeps a cycles failure to the cycles half"
- `tests/offline/cycles/page.test.ts` › "leaves an error the bound does not reach byte-identical, title and all" → covered by `tests/offline/cycles/page.test.ts` › "shows that run's source, start, outcome and error, verbatim"
- `tests/offline/cycles/page.test.ts` › "leaves the cycles half exactly as it was" → covered by `tests/offline/cycles/page.test.ts` › "keeps each surface's own rows and window line inside its own hook"
  Cross-group reconciliation, on the orchestrator's verified survivor list. Of the
  twelve named, ten were cut; two carry an assertion the named survivor does not and
  were kept (listed at the end of this section).
- `tests/offline/cycles/read.test.ts` › "does not mutate what it was given" → covered by `tests/offline/order/newest-first.test.ts` › "does not mutate what it was given"
- `tests/offline/cycles/read.test.ts` › "breaks a tie on the primary key, descending" → covered by `tests/offline/order/newest-first.test.ts` › "breaks a tie on the key column, descending"
- `tests/offline/cycles/read.test.ts` › "sorts a timestamp it cannot read last, and keeps the row" → covered by `tests/offline/order/newest-first.test.ts` › "sorts an unreadable instant last, in each of its spellings, and keeps the row"
- `tests/offline/runs/page.test.ts` › "claims no window it never read" → covered by `tests/offline/absence/pages.test.ts` › "drops every window it publishes on a healthy read when the read never happened" (and "keeps every window it publishes on a read that happened and found nothing")
- `tests/offline/cycles/page.test.ts` › "claims no cycles window it never read" → covered by `tests/offline/absence/pages.test.ts` › "drops every window it publishes on a healthy read when the read never happened"
- `tests/offline/dashboard/page.test.ts` › "states a window on a read that returned nothing, and none on a read that did not" → covered by `tests/offline/absence/pages.test.ts` › "drops every window it publishes on a healthy read when the read never happened" (and "keeps every window it publishes on a read that happened and found nothing"); it also read `data-window-held="0"` on the empty arm — a hook value with no visible twin, dropped with it
- `tests/offline/dashboard/page.test.ts` › "never draws a chip inside a link, on the card the severity sits in" → covered by `tests/offline/ui/link-spelling.test.ts` › "/ keeps every link's spelling on the words it draws"
- `tests/offline/dashboard/page.test.ts` › "renders, names every missing table, and throws nothing" → covered by `tests/offline/absence/pages.test.ts` › "%s names every object it asked for and invents no number"
- `tests/offline/dashboard/page.test.ts` › "shows no count at all — a missing table is never a zero" → covered by `tests/offline/absence/pages.test.ts` › "%s names every object it asked for and invents no number"
- `tests/offline/cycles/page.test.ts` › "names resolution_runs in its not-provisioned state, and never renders a zero" → covered by `tests/offline/absence/pages.test.ts` › "%s names every object it asked for and invents no number"
  Kept from the orchestrator's list, with the extra assertion named:
- `tests/offline/cycles/page.test.ts` › "still states the cycles window on a read that happened, empty or not" — also asserts `data-window-limit === CYCLE_WINDOW` on the cycles window; after the first pass (which removed "states the window it is showing…" and "leaves the cycles half exactly as it was" citing this case) it is the only pin on that value, and the absence sweep grades presence/absence of window hooks only.
- `tests/offline/dashboard/page.test.ts` › "draws every link in the cycles and runs tables as a link at rest" — also asserts the `[data-outcome]` / `[data-outcome-tone]` cells are NOT drawn as links (`expectNotDrawnAsLink`), which the link-spelling sweep, grading anchors only, does not.
  Orphans removed with the cuts: imports `newestFirst`, `type ResolutionRunRow`,
  `minutesAgo` (cycles/read); `chipsInsideLinks` (dashboard/page); the `absentScript`
  constant and its describe "against a database without the ecosystem tables"
  (dashboard/page, both cases gone). The "Cross-group candidates (kept)" section above
  is now stale for the ten cut here; the two kept items plus the transport-cause
  case remain as listed there.
**Kept with a twin outside the group (after reconciliation):**

- `tests/offline/cycles/read.test.ts` › "does not mutate what it was given" ↔ `tests/offline/order/newest-first.test.ts` › "does not mutate what it was given"
- `tests/offline/cycles/read.test.ts` › "breaks a tie on the primary key, descending" ↔ `tests/offline/order/newest-first.test.ts` › "breaks a tie on the key column, descending"
- `tests/offline/cycles/read.test.ts` › "sorts a timestamp it cannot read last, and keeps the row" ↔ `tests/offline/order/newest-first.test.ts` › "sorts an unreadable instant last, in each of its spellings, and keeps the row"
- `tests/offline/runs/page.test.ts` › "claims no window it never read" ↔ `tests/offline/absence/pages.test.ts` › "drops every window it publishes on a healthy read when the read never happened" / "keeps every window it publishes on a read that happened and found nothing"
- `tests/offline/cycles/page.test.ts` › "claims no cycles window it never read" ↔ same pair in `absence/pages.test.ts`
- `tests/offline/cycles/page.test.ts` › "still states the cycles window on a read that happened, empty or not" ↔ same pair in `absence/pages.test.ts`
- `tests/offline/dashboard/page.test.ts` › "states a window on a read that returned nothing, and none on a read that did not" ↔ same pair in `absence/pages.test.ts`
- `tests/offline/dashboard/page.test.ts` › "never draws a chip inside a link, on the card the severity sits in" ↔ `tests/offline/ui/link-spelling.test.ts` › route sweep "<route> keeps every link's spelling on the words it draws" (chips inside anchors, every route)
- `tests/offline/dashboard/page.test.ts` › "draws every link in the cycles and runs tables as a link at rest" ↔ same sweep in `ui/link-spelling.test.ts`
- `tests/offline/cycles/page.test.ts` › "renders an in-page link as a link at rest, not only on hover [admin-window/BUG-0054]" ↔ same sweep in `ui/link-spelling.test.ts` (note: this one compares rest spellings of anchors against plain values rather than using the shared assertion; partial twin)
- `tests/offline/dashboard/page.test.ts` › "carries the CAUSE of a transport failure, and says how many frames it dropped" ↔ `tests/offline/db/result.test.ts` › "drops the runtime frames of a stack, keeping the cause and saying how many went" (partial: the page case pins that the account reaches the card; the db case pins the account itself)
**Suspected dead code (named, not touched):**

- None found. Every deletion was a duplicate or a copy/byte-identical pin; no code
  path lost its only reachability. (`data-source-facet-half` stays pinned by
  `runs/page` › "says the facet applies to the runs half…"; the `AskedCycle` gate
  stays pinned by "refuses to spell a value the allowlist denies…".)
**Group notes:**

- The prompt said `cycles/page.test.ts` carries one `it.fails`. It carries none — all
  nine `it.fails` mentions are doc comments on pins already flipped to plain `it`.
  Nothing to flip; nothing deleted on that account.
- `dashboard/read.test.ts` lost no case. Its one candidate — "names the column when the
  table has lost one" beside the same column-absent pin in `gauges/cycle-health` — sits
  on a different read helper (`readRows` vs `lib/db/gauges.ts`'s scan), so it is not
  provably one regression; kept under the uncertainty rule.
- Kept, on the same rule, three copy-adjacent cases I was not sure pin nothing:
  `runs/page` › "does not offer its bottom row as the table's floor when a facet
  narrowed the read" (only pin on BUG-0114's scoped-floor arm, which has no hook) and
  "says a facet that filled its cap is a window of THAT source's runs" (truncated ×
  faceted branch), and `cycles/page` › "guards the claim a cycle never ends…" (the
  non-vacuity proof for the BUG-0116 case). Ben may want to rule on these.
- Lint/typecheck not run (brief). Cleanliness by inspection: dropped dead imports
  `cycleState` and `RESOLVER_CADENCE_SECONDS` (dashboard/page), `NO_SUCH_SOURCE`
  (runs/read), `readCycleHealth` (cycle-health); removed test-local helpers `sections`
  (cycles/page), `commonSuffix` and `CYCLE_ERRORED` (dashboard/page). Every describe
  still holds at least one case (checked by script). No header prose rewritten.
### C2 — sources and gauges (`sources/page`, `sources/read`, `gauges/settled-values`, `gauges/standing-disagreements`, `gauges/gauge`, `gauges-ui/cards`)

39 audit lines.

- `tests/offline/sources/read.test.ts` › "takes the newest run of a source that has several" → covered by `tests/offline/sources/read.test.ts` › "gives every source the newest run carrying its name, and null for none"
- `tests/offline/sources/read.test.ts` › "holds no entry at all for a name the set has no row for" → covered by `tests/offline/sources/read.test.ts` › "gives every source the newest run carrying its name, and null for none"
- `tests/offline/sources/read.test.ts` › "keeps everything when nothing is asked for" → covered by `tests/offline/sources/page.test.ts` › "renders every source the registry holds, in the read's order" (the page narrows through `selectSources`, `src/app/sources/page.tsx:249`)
- `tests/offline/sources/read.test.ts` › "keeps exactly the source the filter names" → covered by `tests/offline/sources/page.test.ts` › "narrows this page to one source, and back out again"
- `tests/offline/sources/read.test.ts` › "keeps nothing for a source the registry does not hold" → covered by `tests/offline/sources/page.test.ts` › "narrows to nothing, and says so, when the URL names a well-formed id the registry lacks"
- `tests/offline/sources/read.test.ts` › "makes no round trip at all for an empty id set" → covered by `tests/offline/gauges/gauge.test.ts` › "runs no query at all for an empty id set" (`readSourceNames` is `return readRowsByIds(...)`, `src/lib/db/sources.ts:205`)
- `tests/offline/sources/read.test.ts` › "keeps every request bounded, and joins the chunks it got back" → covered by `tests/offline/gauges/gauge.test.ts` › "splits a large id set into bounded chunks and concatenates the rows"
- `tests/offline/sources/read.test.ts` › "answers an id the registry holds no row for by leaving it out" → covered by `tests/offline/gauges/gauge.test.ts` › "splits a large id set into bounded chunks and concatenates the rows" (250 ids, 3 rows back: nothing is invented per id)
- `tests/offline/sources/read.test.ts` › "refuses as a refusal, naming the registry — never as an empty registry" → covered by `tests/offline/gauges/gauge.test.ts` › "returns the first non-ok result rather than a half-filled set" (and its sibling "carries an arbitrary failure through as the database's own words" for the error arm; same helper, same object `T.sources`)
- `tests/offline/sources/read.test.ts` › "stops at the chunk that refused instead of half-filling the lookup" → covered by `tests/offline/gauges/gauge.test.ts` › "returns the first non-ok result rather than a half-filled set"
- `tests/offline/sources/page.test.ts` › "never shows a run whose source name is in no registry row" → covered by `tests/offline/sources/read.test.ts` › "gives every source the newest run carrying its name, and null for none"
- `tests/offline/sources/page.test.ts` › "names the SELECTED chip by its id when the registry names it nothing" → covered by `tests/offline/sources/page.test.ts` › "names a chip whose registry row names ${JSON.stringify(blank)} by its id" (`SourceChips` labels every chip through one `sourceLabel(names, id)` call, active or not — `src/components/sources/source-chips.tsx:61-63`)
- `tests/offline/sources/page.test.ts` › "narrows nothing when the URL names something that is not an id at all" → covered by `tests/offline/sources/page.test.ts` › "moves nothing else on the page" (byte-identical page under `?source_id=deadbeef`: whole registry, no refusal card, gauges unnarrowed)
- `tests/offline/sources/page.test.ts` › "takes the first value when the URL repeats the facet" → covered by `tests/offline/sources/page.test.ts` › "reads the repeated facet the same way the filter did"
- `tests/offline/sources/page.test.ts` › "names each source by its registry name, linking back to it" → covered by `tests/offline/sources/page.test.ts` › "names a source the registry names ${JSON.stringify(blank)} by its id, in both trends" (its sibling row is asserted to read as the registry name)
- `tests/offline/sources/page.test.ts` › "says a narrowed source has none, rather than showing the fleet's" (the awaiting-row trend's; the settled-values one of the same title is kept) → covered by `tests/offline/sources/page.test.ts` › "renders the absence when a fleet-shaped series holds no row for the narrowed source"
- `tests/offline/sources/page.test.ts` › "reports a narrowed source whose rejections all carry no reason as its own count" → covered by `tests/offline/sources/page.test.ts` › "keeps a stranger's rejection out of a narrowed source's figures" (strangers' unattributed rows leave the sentence unchanged; that the figure moves with a reason is "still reports a narrowed source's OWN unattributed rejection")
- `tests/offline/sources/page.test.ts` › "states the number of rows it named by id, on a row the registry left blank" → covered by `tests/offline/sources/page.test.ts` › "counts a blank-named source and a source with no registry row alike" (its `blankOnly` and `allNamed` fixtures assert exactly this)
- `tests/offline/sources/page.test.ts` › "names the narrowing its own figures carry [BUG-0194]" → covered by `tests/offline/sources/page.test.ts` › "names the narrowing each scan carried, and names it in no line whose read did not"
- `tests/offline/sources/page.test.ts` › "names nothing for a parameter this page DROPPED" → covered by `tests/offline/sources/page.test.ts` › "moves nothing else on the page"
- `tests/offline/sources/page.test.ts` › "leaves the page function the only async component on the route" → pins nothing: it matches the spelling `export default async function SourcesPage`; a rename reddens it with no behaviour change, and async-ness is exercised by every render in the file
- `tests/offline/gauges/settled-values.test.ts` › "bounds the query even when the caller passes nothing" → covered by `tests/offline/gauges/gauge.test.ts` › "runs no query at all for an empty id set" (the no-lookup half; the bounds half is `resolveBounds` with `{}`, "windows and caps a call that asked for nothing", which the fetch applies unconditionally — `src/lib/gauges/settled-values.ts:164`)
- `tests/offline/gauges/settled-values.test.ts` › "hands the narrowing it was given down to the scan — the entry point /sources calls" → covered by `tests/offline/sources/page.test.ts` › "names the narrowing each scan carried, and names it in no line whose read did not" (asserts the `rejected_at` scan's `eq` through this very entry point)
- `tests/offline/gauges/settled-values.test.ts` › "passes a not-provisioned database straight through" → covered by `tests/offline/sources/page.test.ts` › "names the observations table when the stamps cannot be read" (renders through `readRejectionStampGauge`; `mapOk`'s passthrough is also `gauge.test.ts` › "maps an ok payload and passes every other state through untouched")
- `tests/offline/gauges/standing-disagreements.test.ts` › "is the claims view narrowed to one bucket, with the unrenderable one gone" → covered by `tests/offline/gauges/standing-disagreements.test.ts` › "counts only live contradictions, never another bucket"
- `tests/offline/gauges/gauge.test.ts` › "leaves a cap under it alone" → covered by `tests/offline/gauges/gauge.test.ts` › "honours an explicit day count and limit"
- `tests/offline/gauges/gauge.test.ts` › "is not truncated below the cap" → covered by `tests/offline/gauges/gauge.test.ts` › "decides truncation against the platform cap when bounds ask for more" (cap − 1 → false)
- `tests/offline/gauges/gauge.test.ts` › "is truncated at the cap, because more rows may exist unseen" → covered by `tests/offline/gauges/gauge.test.ts` › "decides truncation against the platform cap when bounds ask for more" (cap → true)
- `tests/offline/gauges/gauge.test.ts` › "takes the object, never the word — nothing else about the read moves it" → covered by `tests/offline/gauges/gauge.test.ts` › "reports the kind of the object the scan named, on both kinds" (the only regression it could catch — `over` wrong — is caught there; "nothing else moves" restates the signature)
- `tests/offline/gauges/gauge.test.ts` › "is resolver.md §12's 15 minutes, in seconds" → pins nothing: restates the literal `900`; it changes exactly when the design does, and the constant's behaviour (the over-cadence verdict) is exercised by `gauges/cycle-health.test.ts`
- `tests/offline/gauges-ui/cards.test.ts` › "are real aggregate output, with a measurable side and an unmeasurable one" → pins nothing: fixture sanity; every figure it restates is asserted off the markup by "renders the aggregate's figure thousand-separated, in the card anatomy", "renders an unmeasurable figure as the dash with its reason, never as a zero" and "qualifies a figure the window truncated, and leaves an untruncated one alone" (the aggregates themselves are `gauges/cycle-health` and `gauges/queue-health`'s)
- `tests/offline/gauges-ui/cards.test.ts` › "says why it cannot measure even when the caller's reason is itself blank" → covered by `tests/offline/gauges-ui/cards.test.ts` › "treats every spelling of a stated-nothing reason as the same absence, and leaves a measured figure alone" (same equality to the unstated card over more spellings; the stated-reason arm is "says why it cannot measure, whether or not the caller gave a reason")
- `tests/offline/gauges-ui/cards.test.ts` › "never qualifies or colours a figure it does not have" → merged into `tests/offline/gauges-ui/cards.test.ts` › "never qualifies or colours an absence that arrived as %s"
- `tests/offline/gauges-ui/cards.test.ts` › "never qualifies or colours an absence that arrived as a formatted string" → merged into `tests/offline/gauges-ui/cards.test.ts` › "never qualifies or colours an absence that arrived as %s"
- `tests/offline/gauges-ui/cards.test.ts` › "never qualifies or colours a non-finite figure" → merged into `tests/offline/gauges-ui/cards.test.ts` › "never qualifies or colours an absence that arrived as %s"
- `tests/offline/gauges-ui/cards.test.ts` › "takes its absence from the app's one definition, not a guard of its own" → merged into `tests/offline/gauges-ui/cards.test.ts` › "never qualifies or colours an absence that arrived as %s"
  Cross-group reconciliation, requested by the orchestrator after the first pass; survivors verified to exist.
- `tests/offline/sources/page.test.ts` › "names `sources` when the registry table is not in this database" → covered by `tests/offline/absence/pages.test.ts` › "survives %s being absent" (the /sources describe, over TABLE_NAMES) and "%s names every object it asked for and invents no number"
- `tests/offline/sources/page.test.ts` › "names `runs` when the run table is not in this database" → covered by `tests/offline/absence/pages.test.ts` › "survives %s being absent" (the /sources describe, over TABLE_NAMES) and "%s names every object it asked for and invents no number"
- `tests/offline/sources/page.test.ts` › "writes every inter-element space as an explicit expression, which no transform may drop" → covered by `tests/offline/ui/copy.test.ts` › "leaves no file under src/ leaning on a space a transform may drop" (orphaned imports `implicitInterElementSpaces`, `implicitInterElementSpacesIn` removed)
  Kept from the second-pass list, per its own condition: "names the gauge's own table when the claims view is absent" and "names the observations table when the stamps cannot be read" each also assert `sourceIds(markup)` equals the whole registry beside the absence — one absent object does not blank the page — which the absence matrix does not grade. They stay listed under cross-group candidates.
**Merged chains:**

- **GaugeCard absence spellings (BUG-0018 → BUG-0004)**, `tests/offline/gauges-ui/cards.test.ts`: the four pins above — null-with-a-reason; `duration(null)` (a formatted string); NaN and Infinity; `""`, `"   "` and the em dash — become one `it.each(ABSENCES)("never qualifies or colours an absence that arrived as %s")` over seven rows, each rendered with `floor: true, tone: "broken"`, asserting the dash in the text, `text-ink-disabled`, no `type-body`, no `text-broken`. That is the union of what the four asserted; the card decides every row through the one `isAbsent(value)` branch (`src/components/gauges/gauge-card.tsx:146,161,163`). Two of the four assertions were previously made on a subset of rows (`text-ink-disabled` on the three string spellings; the dash on all but the null row) and are now made on all seven — same branch, same property, no new behaviour pinned.
**Kept with a twin outside the group (after reconciliation):**

- `tests/offline/sources/read.test.ts` › "refuses a read that came back with no count at all" and › "refuses a runs read that came back with no count at all" ↔ `tests/offline/db/result.test.ts` › "refuses a null count instead of fabricating completeness, and returns no array" (both reads are `readComplete`; the truncation arms "refuses rather than returning a partial registry" / "refuses, naming runs and the real number…" are kept as each read's refusal pin)
- `tests/offline/sources/page.test.ts` › "names `sources` when the registry table is not in this database", › "names `runs` when the run table is not in this database", › "names the gauge's own table when the claims view is absent", › "names the observations table when the stamps cannot be read" ↔ `tests/offline/absence/pages.test.ts` › "survives %s being absent" (the per-surface `it.each(TABLE_NAMES)`, which names the object; its `COMPOSED_READS` note cites the `runs` case by title)
- `tests/offline/sources/page.test.ts` › "keeps blaming the registry when a source id is in the URL and it holds nothing" ↔ `tests/offline/absence/pages.test.ts` › "%s blames no facet over a population that holds nothing" (`TWO_FACT` carries `/sources`); mine additionally pins `data-empty="registry"` and the card's text equal to the bare render
- `tests/offline/sources/page.test.ts` › "writes every inter-element space as an explicit expression, which no transform may drop" ↔ `tests/offline/ui/copy.test.ts` › "leaves no file under src/ leaning on a space a transform may drop" (tree-wide sweep that includes `src/app/sources/page.tsx`)
- `tests/offline/gauges/gauge.test.ts` › "clamps an oversized limit the caller passed" ↔ `tests/offline/gauges/bounded.test.ts` › "is not possible for a caller either: an oversized limit is clamped"
- `tests/offline/gauges/gauge.test.ts` › "splits a large id set into bounded chunks and concatenates the rows" ↔ `tests/offline/db/result.test.ts` › "concatenates in chunk-index order, not completion order" / "bounds the fan-out at a number a database can serve"; › "returns the first non-ok result rather than a half-filled set" ↔ `db/result.test.ts` › "returns the LOWEST-INDEX non-ok, not whichever chunk failed first"; › "carries an arbitrary failure through as the database's own words" ↔ `db/result.test.ts` › "classifies a chunk whose request REJECTS instead of rejecting the fan-out" and the authored-runs pins under "and says who wrote each of them". **Note for reconciliation:** these three `gauge.test.ts` cases (with "runs no query at all for an empty id set") are the "covered by" targets of six `read.test.ts` deletions and one `settled-values` deletion above; if the reconciler retires them in favour of `db/result`, those deletions' coverage moves to the `db/result` titles named here.
- `tests/offline/gauges/settled-values.test.ts` › "carries an arbitrary failure through as the database's own words" and `tests/offline/gauges/standing-disagreements.test.ts` › "carries an arbitrary failure through as the database's own words": kept as each fetch's only error-arm pin; their `authored: [...]` sub-assertion is a copy of `db/result.test.ts` › "puts the DATABASE's own words, and its own code, in the machine's runs alone" (BUG-0196), the same copy sitting in `gauges/pending-claims`, `cycle-health`, `queue-health`, `resolution-latency` (other groups)
- `tests/offline/gauges/settled-values.test.ts` › "reports whichever object is absent, by name" (its observations half) ↔ `tests/offline/gauges/bounded.test.ts` › "reports not_provisioned naming the object, and does not throw — settled values"; the `sources`-leg half is unique and is why it is kept. Likewise `standing-disagreements.test.ts` › "reports whichever object is absent, by name" (its `pending_claims` half) ↔ `gauges/pending-claims.test.ts` › "reports whichever object is absent, by name"
- `tests/offline/gauges/settled-values.test.ts` › "scans observations by rejection stamp, windowed and capped, then names the sources" and `standing-disagreements.test.ts` › "reuses the claims read and adds a bounded sources lookup" overlap `gauges/bounded.test.ts` › "is bounded — settled values / standing disagreements" and "asks for no more rows than the ids it filtered on — …" on limit/window; kept for the `order`, the scan column and the exact `in` id set (TASK-0074), which bounded does not assert
**Suspected dead code (named, not touched):**

- none. Every helper a deleted case exercised has a `src/` caller: `selectSources` (`src/app/sources/page.tsx:249`), `lastRunBySource` (inside `listSources`), `readSourceNames` (`src/app/api/admin/claims/rows/route.ts:151`), `selectStanding` (inside `fetchStandingDisagreements`), `RESOLVER_CADENCE_SECONDS` (`cycle-health.ts`, `resolution-latency.ts`, `/cycles`, `/`).
**Group notes:**

- The three blank-name `for (const blank of ["", "   ", "​"]) it(…)` loops in `page.test.ts` (registry cell, chips, both trends) and the one in `standing-disagreements.test.ts` were left intact: each is one static `it` already, each pins a different component's use of `sourceLabel`, and the spelling set is `lib/sources/names.ts`'s own (`tests/offline/sources/names.test.ts`, another group) — collapsing a loop's spellings is not a case deletion and would have put the "covered by" outside my group.
- The BUG-0022 cluster in `page.test.ts` ("keeps a stranger's rejection out…", "keeps an unregistered source's rejection out…", "still reports a narrowed source's OWN unattributed rejection", "reports no unattributed rejection when the narrowed source has no rejection at all", "counts the narrowed source itself once…") was not merged into an `it.each`: the five differ in fixture shape (two vs three renders, a starved lookup script) and in assertion direction, and I was not certain enough that any pair fails on one regression (empty-scope fallback vs scoped count vs boolean clause) to go past the one deletion made. Rated honestly: a central reviewer with the ticket history may reasonably cut two more.
- No `vitest`/`tsc`/`eslint` was run (brief). Compiling and lint-cleanliness were checked by inspection: no identifier in any of the six files is referenced once only, no `describe` is empty, delimiter balance per file equals HEAD's, and the merged table is typed as `[string, Parameters<typeof GaugeCard>[0]][]` so each row is contextually typed against the same props union the deleted calls used (the `number | null` value with `absent` present is the shape the deleted "figure it does not have" case compiled with).
### D — queues and review (`queues/*`, `gauges/queue-health`, `review/*`, `absence/pages`, `absence/blank-cells`)

82 audit lines.

  ### tests/offline/gauges/queue-health.test.ts
- `tests/offline/gauges/queue-health.test.ts` › "passes a not-provisioned database straight through" → covered by `tests/offline/queues/page.test.ts` › "still reports NOT_PROVISIONED through the exclusion" (same refusal from the wrapper; the classification itself stays pinned by "reports the table by name when it is absent, and never throws")
  ### tests/offline/review/shapes.test.ts
- `tests/offline/review/shapes.test.ts` › "classifies every fixture shape and nothing else" → covered by `tests/offline/review/shapes.test.ts` › "reads a data_conflict fact item as a decision" / "reads an entity_link item with no source_id as a fact decision" / "reads an entity_link item with a source_id as a source-pattern signal"
- `tests/offline/review/shapes.test.ts` › "is total — a shape comes back for a row of either queue" → covered by `tests/offline/review/shapes.test.ts` › "classifies every row as the oracle says, including the both-subjects and stray-source_id rows"
- `tests/offline/review/shapes.test.ts` › "is disjoint and exhaustive, which is why per-shape counts sum" → covered by `tests/offline/review/shapes.test.ts` › "selects exactly the rows shapeOf assigns, for all three shapes" (declared == classified per shape implies exactly one shape per row)
- `tests/offline/review/shapes.test.ts` › "constrains only the queue where the queue is the whole rule" → covered by `tests/offline/review/shapes.test.ts` › "selects exactly the rows shapeOf assigns, for all three shapes" (pins the declaration's data shape; its effect is what #8 and review-items "narrows each leg by the columns the shape is DECLARED by" grade)
- `tests/offline/review/shapes.test.ts` › "puts every open item before every settled one" → covered by `tests/offline/review/shapes.test.ts` › "orders the edge population exactly as §4 reads, ties broken stably"
- `tests/offline/review/shapes.test.ts` › "puts high severity before low, within a status" → covered by `tests/offline/review/shapes.test.ts` › "orders the edge population exactly as §4 reads, ties broken stably"
- `tests/offline/review/shapes.test.ts` › "puts the oldest first among items tied on status and severity" → covered by `tests/offline/review/shapes.test.ts` › "orders the edge population exactly as §4 reads, ties broken stably"
- `tests/offline/review/shapes.test.ts` › "orders the whole population exactly" → covered by `tests/offline/review/shapes.test.ts` › "orders the edge population exactly as §4 reads, ties broken stably"
- `tests/offline/review/shapes.test.ts` › "ranks severity above age — a newer high outranks an older low" → covered by `tests/offline/review/shapes.test.ts` › "orders the edge population exactly as §4 reads, ties broken stably"
- `tests/offline/review/shapes.test.ts` › "ranks status above severity — an open low outranks a settled high" → covered by `tests/offline/review/shapes.test.ts` › "orders the edge population exactly as §4 reads, ties broken stably"
- `tests/offline/review/shapes.test.ts` › "compares instants, not strings — an offset spelling sorts with a Z one" → covered by `tests/offline/review/shapes.test.ts` › "orders the edge population exactly as §4 reads, ties broken stably" (its own pair sorts the same lexically and by instant, so it could not fail on a string comparison; the edge tie pair `…00Z` / `…00+00:00` can)
- `tests/offline/review/shapes.test.ts` › "is total and independent of input order" → covered by `tests/offline/review/shapes.test.ts` › "returns the same order from any input permutation, and loses no row"
- `tests/offline/review/shapes.test.ts` › "handles an empty queue" → covered by `tests/offline/review/review-items.test.ts` › "returns an empty ok for an empty table, never a null"
- `tests/offline/review/shapes.test.ts` › "never places a lower-ranked item before a higher-ranked one, pairwise" → covered by `tests/offline/review/shapes.test.ts` › "orders the edge population exactly as §4 reads, ties broken stably" (a relation over the same output the exact order already pins)
- `tests/offline/review/shapes.test.ts` › "returns exactly the items of each queue" → covered by `tests/offline/review/shapes.test.ts` › "returns exactly the oracle's id set for every combination of the four filter fields"
- `tests/offline/review/shapes.test.ts` › "returns exactly the items of each shape" → covered by `tests/offline/review/shapes.test.ts` › "returns exactly the oracle's id set for every combination of the four filter fields"
- `tests/offline/review/shapes.test.ts` › "returns exactly the items of each kind" → covered by `tests/offline/review/shapes.test.ts` › "returns exactly the oracle's id set for every combination of the four filter fields"
- `tests/offline/review/shapes.test.ts` › "returns exactly the items of each status — settled stays browsable" → covered by `tests/offline/review/shapes.test.ts` › "returns exactly the oracle's id set for every combination of the four filter fields"
- `tests/offline/review/shapes.test.ts` › "combines fields with AND" → covered by `tests/offline/review/shapes.test.ts` › "returns exactly the oracle's id set for every combination of the four filter fields"
- `tests/offline/review/shapes.test.ts` › "returns nothing for a contradictory filter, rather than everything" → covered by `tests/offline/review/shapes.test.ts` › "returns exactly the oracle's id set for every combination of the four filter fields"
- `tests/offline/review/shapes.test.ts` › "counts open items per kind and ignores settled ones" → covered by `tests/offline/review/shapes.test.ts` › "summarises the edge population per kind without counting settled rows"
- `tests/offline/review/shapes.test.ts` › "reports max severity as the presence of a high, per kind" → covered by `tests/offline/review/shapes.test.ts` › "does not let a SETTLED high raise a kind's max severity or its oldest age" (the low arm) and "summarises the edge population per kind without counting settled rows" (the high arm)
- `tests/offline/review/shapes.test.ts` › "reports the oldest open opened_at per kind, as a timestamp not an age" → covered by `tests/offline/review/shapes.test.ts` › "summarises the edge population per kind without counting settled rows"
- `tests/offline/review/shapes.test.ts` › "reports both kinds with zeroes and nulls when there is nothing open" → covered by `tests/offline/review/review-items.test.ts` › "reports both kinds at zero against an empty table"
- `tests/offline/review/shapes.test.ts` › "oldestOpenedAt compares instants and is null for an empty set" → covered by `tests/offline/review/review-items.test.ts` › "reports both kinds at zero against an empty table" (the null half; the instant pair sorts the same lexically, so that half pinned nothing)
  ### tests/offline/review/review-items.test.ts
- `tests/offline/review/review-items.test.ts` › "reads review_items and returns the rows in queue order" → covered by `tests/offline/review/review-items.test.ts` › "returns the whole edge population in queue order for an empty filter"
- `tests/offline/review/review-items.test.ts` › "pushes the column filters it can to the database" → covered by `tests/offline/review/review-items.test.ts` › "pushes the source to the database, beside the other column filters"
- `tests/offline/review/review-items.test.ts` › "returns exactly the matching items for every shape filter" → covered by `tests/offline/review/review-items.test.ts` › "returns exactly the matching ids for each shape when the database narrows nothing"
- `tests/offline/review/review-items.test.ts` › "keeps queueOrder as the display authority, applied after the read" → covered by `tests/offline/review/review-items.test.ts` › "returns the whole edge population in queue order for an empty filter" (the edge fixture is not in queue order and the stub returns it as scripted)
- `tests/offline/review/review-items.test.ts` › "summarises the open items per kind" → covered by `tests/offline/review/review-items.test.ts` › "counts only the open items even when the database returns the settled ones too"
- `tests/offline/review/review-items.test.ts` › "propagates not_provisioned rather than reporting zero attention" → covered by `tests/offline/absence/pages.test.ts` › "survives %s being absent" (`/` without `review_items` must name it, which a zero-attention ok could not)
- `tests/offline/review/review-items.test.ts` › "counts a kind the filter emptied as the rows it really holds" → covered by `tests/offline/review/review-items.test.ts` › "returns the filtered rows beside the WHOLE-TABLE count of the kind the URL emptied" (same script, same filter, subset of assertions)
- `tests/offline/review/review-items.test.ts` › "reports a real zero for a kind the TABLE holds none of" → covered by `tests/offline/review/review-items.test.ts` › "answers the kind it did not count as not_asked — never a zero, never a refusal"
- `tests/offline/review/review-items.test.ts` › "refuses whole rather than reporting a population the database never gave" → covered by `tests/offline/review/review-items.test.ts` › "is non-ok exactly when the URL's own read is"
- `tests/offline/review/review-items.test.ts` › "keeps the rows its own complete read returned when only the POPULATION leg is truncated (admin-window/BUG-0135)" → covered by `tests/offline/review/review-items.test.ts` › "answers a faceted URL whatever the table's size — ROW_CAP cannot reach a count" (BUG pin whose fix landed beside the builder's case)
- `tests/offline/review/review-items.test.ts` › "refuses a truncated read rather than counting a population it did not see" → covered by `tests/offline/queues/page.test.ts` › "still renders the block's error state when its OWN read is truncated"
- `tests/offline/review/review-items.test.ts` › "issues exactly the reads each URL shape needs, and no others" → covered by `tests/offline/review/review-items.test.ts` › "counts, over EVERY url the facet vocabulary can spell, only the kinds it narrows" (its nine URLs are among the 216, same two assertions)
- `tests/offline/review/review-items.test.ts` › "reports no attention numbers over an uncounted read" → covered by `tests/offline/review/review-items.test.ts` › "refuses when the response carries no count at all"
- `tests/offline/review/review-items.test.ts` › "returns nothing for a well-formed source the table does not carry" → covered by `tests/offline/review/shapes.test.ts` › "returns exactly the items of one source, and none of a source with no items"
- `tests/offline/review/review-items.test.ts` › "counts each kind's WHOLE-queue population, never the source's share" → covered by `tests/offline/review/review-items.test.ts` › "keeps the whole-table meaning of every count it does issue" (the population numbers were scripted by position and could not move; the one live claim, no `source_id` eq on a count leg, is that case's)
  ### tests/offline/queues/filters.test.ts
- `tests/offline/queues/filters.test.ts` › "covers every field of the filter the data layer takes" (describe "the facet vocabulary") → covered by `tests/offline/queues/filters.test.ts` › "covers every field of the filter the data layer takes" (describe "the source facet") together with "is spelled as the column, and is a narrowing but not a chip"
- `tests/offline/queues/filters.test.ts` › "counts every OTHER facet beside the one the surface applies" → covered by `tests/offline/queues/filters.test.ts` › "discounts a URL facet exactly when the kind implies its value"
- `tests/offline/queues/filters.test.ts` › "takes its second argument from the caller, always" → pins nothing: grades the function's arity (`Function.length`, a `@ts-expect-error`), not a behaviour
- `tests/offline/queues/filters.test.ts` › "never implies a status: that is a row's own state, not its kind's" → covered by `tests/offline/queues/filters.test.ts` › "names the values spec §6 says every row of that kind carries" (exact `toEqual` with no status)
- `tests/offline/queues/filters.test.ts` › "SELECTS exactly the kind's rows — an implied value removes none of them" → covered by `tests/offline/queues/filters.test.ts` › "is derived, not written down — no kind claims a value its rows contradict"
- `tests/offline/queues/filters.test.ts` › "marks 'all' active while that facet narrows nothing" → covered by `tests/offline/queues/page.test.ts` › "marks the chip the URL is on, for every facet"
- `tests/offline/queues/filters.test.ts` › "marks exactly the chosen value active, and links 'all' back out" → covered by `tests/offline/queues/page.test.ts` › "marks the chip the URL is on, for every facet" (active) and `tests/offline/queues/filters.test.ts` › "lands on the state its own chip claims, for every chip of every facet" (the 'all' href)
- `tests/offline/queues/filters.test.ts` › "renders one group per facet" → covered by `tests/offline/queues/filters.test.ts` › "is spelled as the column, and is a narrowing but not a chip" (identical assertion)
  ### tests/offline/queues/verdict-log.test.ts
- `tests/offline/queues/verdict-log.test.ts` › "dashes a null note, with no qualifier beside it" → covered by `tests/offline/queues/verdict-log.test.ts` › "dashes a note that is present but blank [admin-window/BUG-0085]" (its NULL_NOTE row)
- `tests/offline/queues/verdict-log.test.ts` › "leaves no cell of any row blank" → covered by `tests/offline/queues/verdict-log.test.ts` › "dashes the item on an override and the observation on a settle-only verdict" (every null cell of the population is asserted to hold the dash; the blank-cell regex also runs in the BUG-0085 and bidi cases)
- `tests/offline/queues/verdict-log.test.ts` › "dashes an actor that is present but blank" → covered by `tests/offline/queues/verdict-log.test.ts` › "dashes actor and note together without dashing the columns that have values"
- `tests/offline/queues/verdict-log.test.ts` › "renders the id verbatim, unlinked, when the observation has no row" → covered by `tests/offline/queues/verdict-log.test.ts` › "leaves the resolved observation as one bare anchor while the unresolved one is isolated"
- `tests/offline/queues/verdict-log.test.ts` › "renders the log's machine values through the one identifier primitive, like the run table's cells" → covered by `tests/offline/queues/verdict-log.test.ts` › "leaves the resolved observation as one bare anchor while the unresolved one is isolated" (observation `dir`) and "holds a bidi-override action inside its own cell, verbatim, without touching the row's other cells" (action `dir`) — a flipped QA pin beside the cases that grade the same two attributes
  ### tests/offline/queues/page.test.ts
- `tests/offline/queues/page.test.ts` › "renders exactly two, one per kind" → covered by `tests/offline/queues/page.test.ts` › "says one of exactly four states on every block of every state, always" (exactly two blocks) and "renders each queue open first, then severity, then age" (both by name)
- `tests/offline/queues/page.test.ts` › "splits the population by kind, with nothing in both and nothing dropped" → covered by `tests/offline/queues/page.test.ts` › "renders each queue open first, then severity, then age"
- `tests/offline/queues/page.test.ts` › "counts the open items of the view it rendered" → covered by `tests/offline/queues/page.test.ts` › "scopes the zero of a queue that has rows but nothing open, too"
- `tests/offline/queues/page.test.ts` › "keeps settled items browsable, below the open ones" → covered by `tests/offline/queues/page.test.ts` › "renders each queue open first, then severity, then age"
- `tests/offline/queues/page.test.ts` › "breaks a tie on the id, whichever way the instant was spelled" → covered by `tests/offline/queues/page.test.ts` › "renders each queue open first, then severity, then age" (exact order, tie included)
- `tests/offline/queues/page.test.ts` › "combines two facets with AND" → covered by `tests/offline/queues/page.test.ts` › "still reads as filtered when a facet BESIDE the block's own kind narrows it"
- `tests/offline/queues/page.test.ts` › "renders no rows at all for a combination nothing matches" → covered by `tests/offline/queues/page.test.ts` › "renders nothing at all for the two contradictory pairs"
- `tests/offline/queues/page.test.ts` › "shows the whole table when the URL names a value that does not exist" → covered by `tests/offline/queues/page.test.ts` › "renders exactly the items ?${name} matches" (`queue=decision`, `kind=Decision` → whole table)
- `tests/offline/queues/page.test.ts` › "offers a chip for every value of every facet" → covered by `tests/offline/queues/filters.test.ts` › "offers 'all' plus exactly the facet's values, in that order"
- `tests/offline/queues/page.test.ts` › "renders no control that could write anything" → covered by `tests/offline/queues/page.test.ts` › "renders exactly the items ?${name} matches" (same five-control assertion on every URL) and `tests/offline/absence/pages.test.ts` › "offers nothing at all when every object it reads is absent"
- `tests/offline/queues/page.test.ts` › "renders, names the missing table on every surface, and throws nothing" → covered by `tests/offline/queues/page.test.ts` › `says data-state="not_provisioned" and shows no figure` and `tests/offline/absence/pages.test.ts` › "survives %s being absent"
- `tests/offline/queues/page.test.ts` › "shows no count and no table — a missing table is never a zero" → covered by `tests/offline/queues/page.test.ts` › `says data-state="not_provisioned" and shows no figure` and `tests/offline/absence/pages.test.ts` › "%s names every object it asked for and invents no number"
- `tests/offline/queues/page.test.ts` › "refuses rather than rendering a partial list when the read has no count" → covered by `tests/offline/review/review-items.test.ts` › "refuses when the response carries no count at all" (the refusal) and `tests/offline/queues/page.test.ts` › "names the read that refused, on each surface, and keeps the headers" (the rendering)
- `tests/offline/queues/page.test.ts` › "refuses rather than rendering a truncated list" → covered by `tests/offline/queues/page.test.ts` › "still renders the block's error state when its OWN read is truncated"
- `tests/offline/queues/page.test.ts` › "says what each queue holds and what fills it, and shows a real zero" → covered by `tests/offline/queues/page.test.ts` › "puts the Empty card in the rows region, with no table" and "is ok with a real zero when the window holds nothing at all"
- `tests/offline/queues/page.test.ts` › "keeps the figure where it sits when the queue has rows, and the card below it" → covered by `tests/offline/queues/page.test.ts` › "keeps equal standing and both fixed positions in the mixed state"
- `tests/offline/queues/page.test.ts` › "keeps the two queues at equal standing while both are empty" → covered by `tests/offline/queues/page.test.ts` › "keeps equal standing and both fixed positions in the mixed state"
- `tests/offline/queues/page.test.ts` › "names its scope, so a filtered 0 never reads as a whole-queue 0" → covered by `tests/offline/queues/page.test.ts` › "names its scope on EITHER block when the OTHER kind's facet empties it"
- `tests/offline/queues/page.test.ts` › "does not scope a block by the one facet that cannot narrow it (BUG-0129)" → covered by `tests/offline/queues/page.test.ts` › "leaves a block untouched by EVERY value its kind implies, and by no other" (whole-block html equality, populated and empty)
- `tests/offline/queues/page.test.ts` › "blames NO filter on an empty table, whatever facet is beside the kind" → covered by `tests/offline/queues/page.test.ts` › "leaves a block untouched by EVERY value its kind implies, and by no other" (empty half) and `tests/offline/queues/filters.test.ts` › "answers false for EVERY url when the block's own queue is empty" (the combined query)
- `tests/offline/queues/page.test.ts` › "leaves a block's WHOLE rendering untouched under its own kind facet" → covered by `tests/offline/queues/page.test.ts` › "leaves a block untouched by EVERY value its kind implies, and by no other"
- `tests/offline/queues/page.test.ts` › "does not scope a block by a facet in ANOTHER NAME that cannot narrow it either (admin-window/BUG-0131)" → covered by `tests/offline/queues/page.test.ts` › "leaves a block untouched by EVERY value its kind implies, and by no other"
- `tests/offline/queues/page.test.ts` › "renders that zero as a number, never as the absence dash" → covered by `tests/offline/queues/page.test.ts` › "shows BOTH figures — the quiet queue's counted zero and the busy one's count" (`readNumber(...) === 0` throws on a dash)
- `tests/offline/queues/page.test.ts` › "gives the quiet queue the card and the busy queue the table, each in its rows region" → covered by `tests/offline/queues/page.test.ts` › "shows BOTH figures — the quiet queue's counted zero and the busy one's count" (states) and "puts the Empty card in the rows region, with no table" (the card)
- `tests/offline/queues/page.test.ts` › "lands filtered on the link the Dashboard sends, with the other queue intact" → covered by `tests/offline/queues/page.test.ts` › "renders exactly the items matching ${name}" (`kind=decision`, `kind=signal`) and "keeps them equal when a filter empties one of them"
- `tests/offline/queues/page.test.ts` › "keeps the tab it was taken from" → pins nothing: composes `clearNarrowing`/`isNarrowedBeyond`/`queuesHref` directly and renders no page; `queuesHref` with a tab is `tests/offline/queues/filters.test.ts` › "travels in every URL this module writes"
- `tests/offline/review/review-items.test.ts` › "classifies an absent column as not_provisioned, naming table and column" → covered by `tests/offline/db/result.test.ts` › "spells a column only when the message named one this app could have named" (the same four column-absent messages, review_items included); `undefinedColumnOfRelation` import removed
- `tests/offline/queues/page.test.ts` › "carries the CAUSE of a transport failure, and says how many frames it dropped" → covered by `tests/offline/dashboard/page.test.ts` › "carries the CAUSE of a transport failure, and says how many frames it dropped" and `tests/offline/db/result.test.ts` › "the part is the unit — the measured transport failure, frames and all"; `transportFailure` and `textOf` still used elsewhere in the file, nothing orphaned
**Kept with a twin outside the group (after reconciliation):**

- `tests/offline/review/one-place.test.ts` › "settles through exactly one call site, and it is the seam" — identical `.rpc(` → `[VERDICT_MODULE]` assertion in `tests/offline/edit/config.test.ts:1387`. Kept per orchestrator's correction (source-walking cases stay); flagging the twin for central reconciliation.
- `tests/offline/review/review-items.test.ts` › "classifies an absent column as not_provisioned, naming table and column" — the column classification is the db layer's, pinned in `tests/offline/db/result.test.ts` (undefinedColumnOfRelation on review_items, line 178).
- `tests/offline/queues/page.test.ts` › "carries the CAUSE of a transport failure, and says how many frames it dropped" — the same account rendering is pinned on `/` in `tests/offline/dashboard/page.test.ts:1200` and the derivation in `tests/offline/db/result.test.ts`.
- `tests/offline/gauges/queue-health.test.ts` › "carries an arbitrary failure through as the database's own words" — its `authored` shape (BUG-0196) is the db layer's, pinned in `tests/offline/db/result.test.ts`; kept as the gauge's only error-arm pin.
- Per-page absence pins in OTHER groups' files that `tests/offline/absence/pages.test.ts` ("survives %s being absent" / "%s names every object it asked for and invents no number") already grades for the same (surface, object):
  - `tests/offline/dashboard/page.test.ts` › "renders, names every missing table, and throws nothing"; "shows no count at all — a missing table is never a zero"
  - `tests/offline/claims/page.test.ts` › "renders the not-provisioned state naming the view, and nothing throws"
  - `tests/offline/sources/page.test.ts` › "names `sources` when the registry table is not in this database"; "names `runs` when the run table is not in this database"; "names the gauge's own table when the claims view is absent"
  - `tests/offline/cycles/page.test.ts` › "names resolution_runs in its not-provisioned state, and never renders a zero"
  - `tests/offline/browse/page.test.ts` › "names the missing table when events itself is absent"
  - `tests/offline/records/page.test.ts` › "renders the not-provisioned card naming it where the table is absent"
  - `tests/offline/review-item/page.test.ts` › "names the missing table when the item's own table is absent"
  - `tests/offline/runs/page.test.ts` › "names runs in its not-provisioned state, and the cycles half still renders"
  - Note: the matrix only renders each route at its bare URL, so the `/queues?tab=verdict_log` absence pins in `verdict-log.test.ts` are NOT covered by it and were kept. Cases in those files that assert a second surface still renders beside the absence (e.g. browse "still renders the event rows with field_provenance absent, and says so") carry more than the matrix does and are not listed.
**Suspected dead code (named, not touched):**

- None found. `listReviewItems` may have no page caller (the Queues page reads through `readReviewQueues` since BUG-0133); its refusal arms are kept pinned in `review-items.test.ts` either way. Not verified against `src/` beyond a grep.
**Group notes:**

- `tests/offline/review/one-place.test.ts`: planned to delete "contains the module these rules are about" (implied by "spells a shape name in shapes.ts alone"); reverted to KEEP on the orchestrator's mid-task correction that every source-walking case in that file must survive for `tests/isolated/probe-race.isolated.test.ts`. File untouched.
- `tests/offline/absence/pages.test.ts`: nothing deleted. "/claims says not_provisioned instead…" and "/browse says not_provisioned instead…" duplicate the paging-absence `it.each` for their refusal half, but each carries the non-vacuity control-drawn half, which lives nowhere else; kept.
- `tests/offline/queues/verdict-log.test.ts` › "draws the card naming verdicts and states no window (${code})" runs twice (PGRST205 / 42P01) from one `it(`; the 42P01 classification is the db layer's but trimming a loop body edits a surviving case's title, which the brief forbids. Left as is.
- Compile/lint checked by inspection only (as instructed): every import and local removed when its last use went (`columnsOfShape`, `oldestOpenedAt`, `reviewItemShapes`, `ABSENT`, `COST`, `countLegsOf`, `openFigure`, `isNarrowedBeyond`, `queuesHref`, `QueuesTab`, `clearNarrowing`, `ReviewItemFilter` in page.test). No empty describes left.
### E — review item and verdict (`review-item/*`, `ui/evidence-pair`, `verdict/*`)

163 audit lines.

  ### tests/offline/review-item/read.test.ts
- `tests/offline/review-item/read.test.ts` › "keeps a claim whose source row is missing, with its id verbatim and no tier" → covered by `tests/offline/review-item/page.test.ts` › "labels only the claims the registry answered for, and calls that no refusal"
- `tests/offline/review-item/read.test.ts` › "reports the ids that resolved to no claim" → covered by `tests/offline/review-item/page.test.ts` › "names each unresolved id once and counts it in the same accounting"
- `tests/offline/review-item/read.test.ts` › "keeps the claims when the source registry refuses, and carries the refusal" → covered by `tests/offline/review-item/page.test.ts` › "keeps the evidence when only the source registry refuses"
- `tests/offline/review-item/read.test.ts` › "carries no refusal when every leg answered" → covered by `tests/offline/review-item/page.test.ts` › "labels only the claims the registry answered for, and calls that no refusal"
- `tests/offline/review-item/read.test.ts` › "still names the column that carries the canonical table on each side" → pins nothing: asserts the test fixtures' own object keys, not app behaviour
  ### tests/offline/review-item/close-slot.test.ts
- `tests/offline/review-item/close-slot.test.ts` › "renders the not-provisioned state naming the object, and no control at all" → covered by `tests/offline/review-item/page.test.ts` › "names the absent object in the close slot, as an absence and not a failure"
- `tests/offline/review-item/close-slot.test.ts` › "offers nothing even when the shape HAS actions to offer" → covered by `tests/offline/review-item/page.test.ts` › "renders no control at all, on any shape"
- `tests/offline/review-item/close-slot.test.ts` › "renders the note field and this shape's controls, in the list's order" → covered by `tests/offline/review-item/page.test.ts` › "renders the note field and this shape's actions, on every shape"
- `tests/offline/review-item/close-slot.test.ts` › "renders the note field and no control at all for a shape with no actions yet" → pins nothing: a ready slot with zero actions is a state no shape produces (every `ACTIONS_BY_SHAPE` entry answers at least one action)
- `tests/offline/review-item/close-slot.test.ts` › "offers no control on an item that is already settled" → covered by `tests/offline/review-item/verdict-inline.test.ts` › "is in its ok state and offers no control"
- `tests/offline/review-item/close-slot.test.ts` › "names no ticket and no recommendation, in either state" → covered by `tests/offline/review-item/page.test.ts` › "says neither word, on any shape, in either state"
- `tests/offline/review-item/close-slot.test.ts` › "answers for every shape, with the actions that shape offers and no other" → covered by `tests/offline/review-item/page.test.ts` › "renders the note field and this shape's actions, on every shape"
- `tests/offline/review-item/close-slot.test.ts` › "has a withheld-line answer for every shape the action map answers for" → covered by `tests/offline/review-item/conflict-actions.test.ts` › "withholds nothing on the shapes and rows that withhold nothing" (the not-null arm by `tests/offline/review-item/link-actions.test.ts` › "is the map's own answer, not this test's")
- `tests/offline/review-item/close-slot.test.ts` › "refuses a won’t-fix with no note, and does not refuse one with a note" → covered by `tests/offline/review-item/signal-actions.test.ts` › "is refused by the form in every blank spelling, and never in a written one"
- `tests/offline/review-item/close-slot.test.ts` › "reads as words an operator can act on, never as the identifier" → covered by `tests/offline/review-item/conflict-actions.test.ts` › "has words for every identifier `closeRefusal` can produce"
- `tests/offline/review-item/close-slot.test.ts` › "carries the action and the payload, and blanks the note to null" → covered by `tests/offline/review-item/signal-actions.test.ts` › "posts one request to the one route, carrying one action and no payload"
- `tests/offline/review-item/close-slot.test.ts` › "does not carry the actor or the item: the server stamps both" → covered by `tests/offline/review-item/signal-actions.test.ts` › "posts one request to the one route, carrying one action and no payload"
- `tests/offline/review-item/close-slot.test.ts` › "sends nothing at all when the form refuses it first" → covered by `tests/offline/review-item/signal-actions.test.ts` › "puts no invisible-only note on the wire, in any spelling"
- `tests/offline/review-item/close-slot.test.ts` › "posts one request to the one route, and reports what settled" → covered by `tests/offline/review-item/signal-actions.test.ts` › "posts one request to the one route, carrying one action and no payload"
- `tests/offline/review-item/close-slot.test.ts` › "makes exactly ONE call, and it is the one function" → covered by `tests/offline/review-item/conflict-actions.test.ts` › "makes ONE call to the one function, carrying the whole typed decision"
- `tests/offline/review-item/close-slot.test.ts` › "hands the whole decision over as the one argument the function takes" → covered by `tests/offline/review-item/conflict-actions.test.ts` › "makes ONE call to the one function, carrying the whole typed decision"
- `tests/offline/review-item/close-slot.test.ts` › "never reads a table on this path" → covered by `tests/offline/review-item/conflict-actions.test.ts` › "makes ONE call to the one function, carrying the whole typed decision"
  ### tests/offline/review-item/signal-actions.test.ts
- `tests/offline/review-item/signal-actions.test.ts` › "offers neither disposition, and names the object that is missing" → covered by `tests/offline/review-item/page.test.ts` › "names the absent object in the close slot, as an absence and not a failure"
- `tests/offline/review-item/signal-actions.test.ts` › "offers neither when the readiness read itself was refused" → covered by `tests/offline/review-item/close-slot.test.ts` › "says a refused read as an error line, and still offers no control"
- `tests/offline/review-item/signal-actions.test.ts` › "are exactly two of the eight action names, in spec §7's order" → covered by `tests/offline/review-item/page.test.ts` › "renders the note field and this shape's actions, on every shape"
- `tests/offline/review-item/signal-actions.test.ts` › "are what the by-shape map answers for the source-pattern shape" → covered by `tests/offline/review-item/page.test.ts` › "renders the note field and this shape's actions, on every shape"
- `tests/offline/review-item/signal-actions.test.ts` › "are offered on no other shape" → covered by `tests/offline/review-item/page.test.ts` › "renders the note field and this shape's actions, on every shape"
- `tests/offline/review-item/signal-actions.test.ts` › "require a note on the won’t-fix and on nothing else" → covered by `tests/offline/review-item/link-actions.test.ts` › "needs a note on neither, so the field beside them says so"
- `tests/offline/review-item/signal-actions.test.ts` › "contains exactly the two controls and no other" → covered by `tests/offline/review-item/link-actions.test.ts` › "contains exactly the two controls and no other"
- `tests/offline/review-item/signal-actions.test.ts` › "prettifies neither name: no title case, and no uppercasing step" → covered by `tests/offline/review-item/page.test.ts` › "says the signal's two names on the page as hooks, and prettifies neither"
- `tests/offline/review-item/signal-actions.test.ts` › "refuses a note whose every character is invisible" → covered by `tests/offline/review-item/signal-actions.test.ts` › "puts no invisible-only note on the wire, in any spelling"
- `tests/offline/review-item/signal-actions.test.ts` › "sends nothing at all: the payload never reaches the network" → covered by `tests/offline/review-item/signal-actions.test.ts` › "puts no invisible-only note on the wire, in any spelling"
- `tests/offline/review-item/signal-actions.test.ts` › "names the reason on screen, as an interruption and not as an identifier" → covered by `tests/offline/review-item/close-slot.test.ts` › "announces work in flight politely and a refusal as an interruption"
- `tests/offline/review-item/signal-actions.test.ts` › "refuses a blank note that skipped the form, and reaches no database" → covered by `tests/offline/review-item/close-slot.test.ts` › "answers 400 naming the refusal, with no database call, on every refused decision"
- `tests/offline/review-item/signal-actions.test.ts` › "grades the decision itself, on the input it must flag and the one it must not" → covered by `tests/offline/verdict/decision.test.ts` › "flags a present-but-blank note on wont_fix"
- `tests/offline/review-item/signal-actions.test.ts` › "lets the written won’t-fix through, so the guard is not a wall" → covered by `tests/offline/review-item/signal-actions.test.ts` › "makes exactly one call to the one function, with one typed decision"
- `tests/offline/review-item/signal-actions.test.ts` › "settles the item the address names, whatever else a caller sends" → covered by `tests/offline/review-item/close-slot.test.ts` › "stamps the item from the URL and the actor from the session"
- `tests/offline/review-item/signal-actions.test.ts` › "keeps the pressed action's own name through to what the operator is told" → covered by `tests/offline/review-item/signal-actions.test.ts` › "posts one request to the one route, carrying one action and no payload"
  ### tests/offline/review-item/link-actions.test.ts
- `tests/offline/review-item/link-actions.test.ts` › "offers neither control, and names the object that is missing" → covered by `tests/offline/review-item/page.test.ts` › "names the absent object in the close slot, as an absence and not a failure"
- `tests/offline/review-item/link-actions.test.ts` › "offers neither when the readiness read itself was refused" → covered by `tests/offline/review-item/close-slot.test.ts` › "says a refused read as an error line, and still offers no control"
- `tests/offline/review-item/link-actions.test.ts` › "are exactly two of the eight action names, in spec §7's order" → covered by `tests/offline/review-item/link-actions.test.ts` › "contains exactly the two controls and no other"
- `tests/offline/review-item/link-actions.test.ts` › "gives the link control the rows the read returned, and only those" → covered by `tests/offline/review-item/link-actions.test.ts` › "offers exactly the rows the read returned, each carrying its own id"
- `tests/offline/review-item/link-actions.test.ts` › "gives the source-pattern row the dispositions and neither of these two" → covered by `tests/offline/review-item/page.test.ts` › "renders the note field and this shape's actions, on every shape"
- `tests/offline/review-item/link-actions.test.ts` › "offers link_entity on no other shape" → covered by `tests/offline/review-item/page.test.ts` › "renders the note field and this shape's actions, on every shape"
- `tests/offline/review-item/link-actions.test.ts` › "turns on source_id alone, not on which columns the row filled in" → covered by `tests/offline/review-item/link-actions.test.ts` › "is the map's own answer, not this test's"
- `tests/offline/review-item/link-actions.test.ts` › "puts the operator's words on each control and the machine's name on the hook" → covered by `tests/offline/review-item/signal-actions.test.ts` › "puts the operator's words on the control and the machine's name on the hook"
- `tests/offline/review-item/link-actions.test.ts` › "prettifies neither name: no title case, and no uppercasing step" → covered by `tests/offline/review-item/page.test.ts` › "says the signal's two names on the page as hooks, and prettifies neither"
- `tests/offline/review-item/link-actions.test.ts` › "says each name verbatim in mono where the operator reads it" → covered by `tests/offline/review-item/signal-actions.test.ts` › "says each name verbatim in mono where the operator reads it: the settled state"
- `tests/offline/review-item/link-actions.test.ts` › "cannot settle with a row the read did not return" → pins nothing: asserts only that rendering the control fires no `onChoose`
- `tests/offline/review-item/link-actions.test.ts` › "offers no live option while a settlement is in flight (admin-window/BUG-0102)" → covered by `tests/offline/review-item/link-actions.test.ts` › "goes inert as a whole while a settlement is in flight, and is live again when none is"
- `tests/offline/review-item/link-actions.test.ts` › "is refused by the envelope when the ref is missing or in the wrong slot" → covered by `tests/offline/verdict/decision.test.ts` › "flags a slot the action may not fill"
- `tests/offline/review-item/link-actions.test.ts` › "keeps the pressed action's own name through to what the operator is told" → covered by `tests/offline/review-item/link-actions.test.ts` › "posts one request to the one route, carrying one action and one payload"
  ### tests/offline/review-item/conflict-actions.test.ts
- `tests/offline/review-item/conflict-actions.test.ts` › "offers one control per evidence card, then supply, then keep current" → covered by `tests/offline/review-item/conflict-actions.test.ts` › "renders exactly one choose per card, then supply, then keep current"
- `tests/offline/review-item/conflict-actions.test.ts` › "grows and shrinks with the evidence, one choose control per card" → covered by `tests/offline/review-item/conflict-actions.test.ts` › "renders exactly one choose per card, then supply, then keep current"
- `tests/offline/review-item/conflict-actions.test.ts` › "keeps current with no payload at all" → covered by `tests/offline/review-item/conflict-actions.test.ts` › "fills exactly the payload slot its action may fill"
- `tests/offline/review-item/conflict-actions.test.ts` › "offers only keep-current when the row names no whole fact" → covered by `tests/offline/review-item/conflict-actions.test.ts` › "renders keep-current alone when the row names no whole fact"
- `tests/offline/review-item/conflict-actions.test.ts` › "is the list the by-shape map hands the data_conflict shape, and no other shape's" → covered by `tests/offline/review-item/page.test.ts` › "renders the note field and this shape's actions, on every shape"
- `tests/offline/review-item/conflict-actions.test.ts` › "is refused by nothing — `decisionRefusals` is empty for all three" → covered by `tests/offline/review-item/conflict-actions.test.ts` › "makes ONE call to the one function, carrying the whole typed decision"
- `tests/offline/review-item/conflict-actions.test.ts` › "tells the operator what to do, never the identifier (LESSONS 5)" → covered by `tests/offline/review-item/conflict-actions.test.ts` › "has words for every identifier `closeRefusal` can produce"
- `tests/offline/review-item/conflict-actions.test.ts` › "stamps the item and the actor itself, whatever the control sent" → covered by `tests/offline/review-item/close-slot.test.ts` › "stamps the item from the URL and the actor from the session"
- `tests/offline/review-item/conflict-actions.test.ts` › "answers 503 naming the absent function, still after exactly one call" → covered by `tests/offline/review-item/close-slot.test.ts` › "answers the absent function 503, naming it, after exactly one call"
- `tests/offline/review-item/conflict-actions.test.ts` › "puts the operator's words on the control and the machine's name on the hook" → covered by `tests/offline/review-item/signal-actions.test.ts` › "puts the operator's words on the control and the machine's name on the hook" (copy-oracle on "Keep current" / "Supply a different value")
- `tests/offline/review-item/conflict-actions.test.ts` › "offers nothing on an item that is already settled" → covered by `tests/offline/review-item/verdict-inline.test.ts` › "is in its ok state and offers no control"
- `tests/offline/review-item/conflict-actions.test.ts` › "renders none of the three controls, and the not-provisioned card instead" → covered by `tests/offline/review-item/page.test.ts` › "renders no control at all, on any shape" (the function-named arm by `tests/offline/review-item/page.test.ts` › "names the FUNCTION, not the table that is right there")
- `tests/offline/review-item/conflict-actions.test.ts` › "offers nothing even though this shape HAS three actions to offer" → covered by `tests/offline/review-item/page.test.ts` › "renders no control at all, on any shape"
- `tests/offline/review-item/conflict-actions.test.ts` › "says a refused read as an error line, and still offers no control" → covered by `tests/offline/review-item/close-slot.test.ts` › "says a refused read as an error line, and still offers no control"
- `tests/offline/review-item/conflict-actions.test.ts` › "renders one contender card per claim, with the canonical card last" → covered by `tests/offline/review-item/page.test.ts` › "renders it as the rightmost card, with the tier frozen at the apply"
- `tests/offline/review-item/conflict-actions.test.ts` › "renders a null claim value as the dash, with no qualifier (LESSONS 1)" → covered by `tests/offline/ui/evidence-pair.test.ts` › "renders a null contender value as the dash, keeping the anatomy identical"
- `tests/offline/review-item/conflict-actions.test.ts` › "renders its labelled empty state when the item resolved no claim at all" → covered by `tests/offline/review-item/page.test.ts` › "names a table only where the block rendered one, on every shape, in both states"
- `tests/offline/review-item/conflict-actions.test.ts` › "offers no scalar supply control for a reference field" → covered by `tests/offline/review-item/conflict-actions.test.ts` › "renders N+1 controls and the withheld line, for every card count"
- `tests/offline/review-item/conflict-actions.test.ts` › "builds no text-carrying decision for a reference fact" → covered by `tests/offline/review-item/conflict-actions.test.ts` › "fills exactly the payload slot its action may fill"
- `tests/offline/review-item/conflict-actions.test.ts` › "still offers the supply control for a scalar fact" → covered by `tests/offline/review-item/conflict-actions.test.ts` › "is exactly one control shorter than the same conflict on a scalar field"
- `tests/offline/review-item/conflict-actions.test.ts` › "renders no cell to type into, and says why it is missing" → covered by `tests/offline/review-item/conflict-actions.test.ts` › "renders N+1 controls and the withheld line, for every card count"
- `tests/offline/review-item/conflict-actions.test.ts` › "refuses a text-carrying supply_value for a reference fact" → covered by `tests/offline/verdict/decision.test.ts` › "flags a filled value slot on a reference fact whatever the action"
- `tests/offline/review-item/conflict-actions.test.ts` › "sends no venue NAME to the settle function" → covered by `tests/offline/review-item/close-slot.test.ts` › "answers 400 naming the refusal, with no database call, on every refused decision"
- `tests/offline/review-item/conflict-actions.test.ts` › "refuses it by NAME, for every fact the registry calls a reference" → covered by `tests/offline/verdict/decision.test.ts` › "flags a filled value slot on a reference fact whatever the action"
- `tests/offline/review-item/conflict-actions.test.ts` › "reaches the database with nothing at all, for every one of them" → covered by `tests/offline/review-item/close-slot.test.ts` › "answers 400 naming the refusal, with no database call, on every refused decision"
- `tests/offline/review-item/conflict-actions.test.ts` › "still settles the identical request shape for a scalar fact" → covered by `tests/offline/review-item/conflict-actions.test.ts` › "makes ONE call to the one function, carrying the whole typed decision"
- `tests/offline/review-item/conflict-actions.test.ts` › "still settles a link carrying the chosen entity for the same fact" → covered by `tests/offline/review-item/link-actions.test.ts` › "makes exactly one call to the one function, with one typed decision"
  ### tests/offline/review-item/verdict-inline.test.ts
- `tests/offline/review-item/verdict-inline.test.ts` › "answers a real null when the log holds no row for this item" → covered by `tests/offline/review-item/verdict-inline.test.ts` › "says so as an emptiness, distinguishable from the absent object"
- `tests/offline/review-item/verdict-inline.test.ts` › "keeps the verdict when only the observation leg refuses" → covered by `tests/offline/review-item/verdict-inline.test.ts` › "reports a refused observation leg beside the verdict, not instead of it"
- `tests/offline/review-item/verdict-inline.test.ts` › "leaves the rest of the detail exactly as M1 shipped it" → covered by `tests/offline/review-item/page.test.ts` › "names the absent object in the close slot, as an absence and not a failure"
- `tests/offline/review-item/verdict-inline.test.ts` › "offers no control, and reads the same on an open item" → covered by `tests/offline/review-item/page.test.ts` › "renders no control at all, on any shape"
- `tests/offline/review-item/verdict-inline.test.ts` › "is a different markup state from the absent object, on the same item" → covered by `tests/offline/review-item/verdict-inline.test.ts` › "says so as an emptiness, distinguishable from the absent object"
- `tests/offline/review-item/verdict-inline.test.ts` › "renders the dash, and says what it means, when the verdict carried no value" → covered by `tests/offline/review-item/verdict-inline.test.ts` › "draws and explains both structural dashes on a settle-only verdict"
- `tests/offline/review-item/verdict-inline.test.ts` › "dashes an actor the row left blank, and still says whose verdict it is not" → covered by `tests/offline/review-item/verdict-inline.test.ts` › "explains the dash it draws for a blank actor"
- `tests/offline/review-item/verdict-inline.test.ts` › "renders the observation id through the one identifier primitive, like the action beside it" → covered by `tests/offline/review-item/verdict-inline.test.ts` › "holds a bidi-override observation id inside its own box, verbatim, and isolates none of the block's own words"
- `tests/offline/review-item/verdict-inline.test.ts` › "leaves the close exactly as its own ticket shipped it" → covered by `tests/offline/review-item/page.test.ts` › "renders the note field and this shape's actions, on every shape"
- `tests/offline/review-item/verdict-inline.test.ts` › "comes before the evidence in all three states of the log" → covered by `tests/offline/review-item/verdict-inline.test.ts` › "keeps the verdict inside the close, above the evidence rather than between" (open-item arms by `tests/offline/review-item/page.test.ts` › "comes before the evidence on every shape, in both states of the close")
  ### tests/offline/ui/evidence-pair.test.ts
- `tests/offline/ui/evidence-pair.test.ts` › "separates the cards with hairlines and nothing else — no fills, no shadows" → pins nothing: a class-spelling pin (`border-l` count, `shadow*`) with no behavioural reader
- `tests/offline/ui/evidence-pair.test.ts` › "renders the value in data and the source line in secondary" → pins nothing: a class-spelling pin (`type-data`, `text-ink-secondary`, `type-micro`)
- `tests/offline/ui/evidence-pair.test.ts` › "puts the verdict control inside the card it acts on, never in a toolbar" → pins nothing: the `action` prop it renders is passed by no caller in `src/` (see suspected dead code)
- `tests/offline/ui/evidence-pair.test.ts` › "gives the claim's source the isolation the identifier primitive gives an identifier — admin-window/BUG-0151" → covered by `tests/offline/ui/evidence-pair.test.ts` › "keeps the app's separators and age out of the source's bidi box, and adds no text to the healthy line"
- `tests/offline/ui/evidence-pair.test.ts` › "draws a producer's em-dash name as a value and a name with no ink as the absence" → covered by `tests/offline/review-item/page.test.ts` › "keeps every source's link and words on a page that mixes all three kinds of name" (ink-less arm by `tests/offline/ui/evidence-pair.test.ts` › "draws a %s source as the app's absence element, not an empty isolated box")
- `tests/offline/ui/evidence-pair.test.ts` › "draws a %s provenance value as the app's absence element, not an empty isolated box — admin-window/BUG-0152" (3 params) → covered by `tests/offline/ui/evidence-pair.test.ts` › "keeps the app's words beside a %s provenance value and leaves no box standing empty — admin-window/BUG-0152" (5 params)
  ### tests/offline/verdict/decision.test.ts
- `tests/offline/verdict/decision.test.ts` › "has a well-formed fixture for every action it carries" → covered by `tests/offline/verdict/decision.test.ts` › "refuses nothing, for every one of the eight actions"
- `tests/offline/verdict/decision.test.ts` › "joins a domain and a field the way every surface names a fact" → covered by `tests/offline/verdict/decision.test.ts` › "is what REFERENCE_FIELDS is spelled with, so the lookup cannot miss its own key"
- `tests/offline/verdict/decision.test.ts` › "is strictly WIDER than hasVisibleContent, and differs on exactly the dash" → covered by `tests/offline/verdict/decision.test.ts` › "leaves hasVisibleContent UNWIDENED — a dash an operator typed is still content"
- `tests/offline/verdict/decision.test.ts` › "calls every field the registry declares a reference one" → covered by `tests/offline/verdict/decision.test.ts` › "is what REFERENCE_FIELDS is spelled with, so the lookup cannot miss its own key"
- `tests/offline/verdict/decision.test.ts` › "names exactly one action across the whole set" → covered by `tests/offline/verdict/decision.test.ts` › "is true for wont_fix and false for every other action"
- `tests/offline/verdict/decision.test.ts` › "refuses nothing for an override of a reference field" → covered by `tests/offline/verdict/decision.test.ts` › "does not flag a reference carried the way a reference travels"
- `tests/offline/verdict/decision.test.ts` › "accepts an optional note on an action that does not require one" → covered by `tests/offline/review-item/conflict-actions.test.ts` › "makes ONE call to the one function, carrying the whole typed decision"
- `tests/offline/verdict/decision.test.ts` › "does not flag any action inside the set" → covered by `tests/offline/verdict/decision.test.ts` › "refuses nothing, for every one of the eight actions"
- `tests/offline/verdict/decision.test.ts` › "flags an all-whitespace review_item_id, which a form alone would let through" → covered by `tests/offline/verdict/seam.test.ts` › "sends nothing at all: %s" (the `review_item_required` row)
- `tests/offline/verdict/decision.test.ts` › "flags an override that carries an item" → covered by `tests/offline/verdict/decision.test.ts` › "still flags an override that carries an item, absent key or not"
- `tests/offline/verdict/decision.test.ts` › "does not flag the item as present or absent on the eight well-formed decisions" → covered by `tests/offline/verdict/decision.test.ts` › "refuses nothing, for every one of the eight actions"
- `tests/offline/verdict/decision.test.ts` › "flags a null note on wont_fix" → covered by `tests/offline/verdict/seam.test.ts` › "sends nothing at all: %s" (the `note_required` row)
- `tests/offline/verdict/decision.test.ts` › "does not flag a missing note on any action that does not require one" → covered by `tests/offline/verdict/decision.test.ts` › "refuses nothing, for every one of the eight actions"
- `tests/offline/verdict/decision.test.ts` › "flags a value on every settle-only action" → covered by `tests/offline/verdict/decision.test.ts` › "still flags a value that IS present on every settle-only action"
- `tests/offline/verdict/decision.test.ts` › "does not flag the value as required or forbidden on the well-formed eight" → covered by `tests/offline/verdict/decision.test.ts` › "refuses nothing, for every one of the eight actions"
- `tests/offline/verdict/decision.test.ts` › "does not flag the payload of any well-formed decision" → covered by `tests/offline/verdict/decision.test.ts` › "refuses nothing, for every one of the eight actions"
- `tests/offline/verdict/decision.test.ts` › "flags a supply_value carrying text for every reference fact" → covered by `tests/offline/verdict/decision.test.ts` › "flags a filled value slot on a reference fact whatever the action"
- `tests/offline/verdict/decision.test.ts` › "flags the scalar arm of an override on a reference fact" → covered by `tests/offline/verdict/decision.test.ts` › "flags a filled value slot on a reference fact whatever the action"
- `tests/offline/verdict/decision.test.ts` › "flags a blank actor" → covered by `tests/offline/verdict/seam.test.ts` › "sends nothing at all: %s" (the `actor_required` row)
- `tests/offline/verdict/decision.test.ts` › "does not flag an actor on any well-formed decision" → covered by `tests/offline/verdict/decision.test.ts` › "refuses nothing, for every one of the eight actions"
- `tests/offline/verdict/decision.test.ts` › "grades a supply_value body that omits `value` as value_required [admin-window/BUG-0079]" → covered by `tests/offline/verdict/decision.test.ts` › "grades an absent `value` as value_required on every value-carrying action"
- `tests/offline/verdict/decision.test.ts` › "refuses nothing for a settle body that omits `value` [admin-window/BUG-0079]" → covered by `tests/offline/verdict/decision.test.ts` › "refuses nothing for an absent `value` on every settle-only action"
- `tests/offline/verdict/decision.test.ts` › "refuses nothing for an override body that omits `review_item_id` [admin-window/BUG-0079]" → covered by `tests/offline/verdict/decision.test.ts` › "grades every other key absent, on every action, without throwing"
  ### tests/offline/verdict/seam.test.ts
- `tests/offline/verdict/seam.test.ts` › "answers not_provisioned on Postgres's own 42883" → covered by `tests/offline/review-item/close-slot.test.ts` › "answers the absent function 503, naming it, after exactly one call"
- `tests/offline/verdict/seam.test.ts` › "calls the function by name with the one argument name it takes" → covered by `tests/offline/verdict/seam.test.ts` › "sends the decision the caller built, with nothing added and nothing dropped"
- `tests/offline/verdict/seam.test.ts` › "answers not_provisioned naming verdicts on PGRST205" → covered by `tests/offline/verdict/seam.test.ts` › "$world" (the "neither installed" row)
- `tests/offline/verdict/seam.test.ts` › "never asks whether the table is there by calling the function" → covered by `tests/offline/verdict/seam.test.ts` › "probes the function by READING the schema description, never by calling"
- `tests/offline/verdict/seam.test.ts` › "reports a permission refusal as an error naming the function" → covered by `tests/offline/verdict/seam.test.ts` › "carries the database's own words on both paths, on 57014"
- `tests/offline/verdict/seam.test.ts` › "never reaches the database: %s" (5 params) → covered by `tests/offline/verdict/seam.test.ts` › "sends nothing at all: %s" (11 params)
- `tests/offline/verdict/seam.test.ts` › "sends a well-formed decision through" → covered by `tests/offline/verdict/seam.test.ts` › "reads the receipt the function returned"
- `tests/offline/verdict/seam.test.ts` › "answers ready for an empty table and for a populated one" → covered by `tests/offline/verdict/seam.test.ts` › "$world" (the "both installed — staging today" row)
- `tests/offline/verdict/seam.test.ts` › "names the argument `p_decision`, the literal PostgREST resolves the call by" → covered by `tests/offline/review-item/conflict-actions.test.ts` › "makes ONE call to the one function, carrying the whole typed decision" (asserts `Object.keys(args)` equals the literal `["p_decision"]`)
  ### tests/offline/review-item/page.test.ts
- `tests/offline/review-item/page.test.ts` › "names an id that resolves to no claim instead of dropping it" → covered by `tests/offline/review-item/page.test.ts` › "names each unresolved id once and counts it in the same accounting"
- `tests/offline/review-item/page.test.ts` › "accounts for every evidence id when one is repeated" → covered by `tests/offline/review-item/page.test.ts` › "counts a claim once however many times it folded in"
- `tests/offline/review-item/page.test.ts` › "renders every folded record of a large source-pattern item" → covered by `tests/offline/review-item/page.test.ts` › "keeps the accounting whole when the distinct ids cross a chunk boundary"
- `tests/offline/review-item/page.test.ts` › "renders an honest empty block when NO id resolves" → covered by `tests/offline/review-item/page.test.ts` › "names a table only where the block rendered one, on every shape, in both states"
- `tests/offline/review-item/page.test.ts` › "accounts for an item that carries no evidence id at all" → covered by `tests/offline/review-item/page.test.ts` › "publishes a real 0 and invents no second figure when the item carries no evidence id"
- `tests/offline/review-item/page.test.ts` › "renders three distinct views over the same anatomy" → covered by `tests/offline/review-item/page.test.ts` › "gives the source-pattern item a record list and its own dial, and no pair" (with "gives the entity_link fact item the unmet requirement its claims wait on" and "keeps the per-fact views out of it: they are about one record already")
- `tests/offline/review-item/page.test.ts` › "gives no two folded records about different records the same row" → covered by `tests/offline/review-item/page.test.ts` › "tells two folded records apart by the record each one is about"
- `tests/offline/review-item/page.test.ts` › "renders the table's dash for a folded record it can name no way at all" → covered by `tests/offline/review-item/page.test.ts` › "prints the dash-meaning line exactly when the record cell draws a dash"
- `tests/offline/review-item/page.test.ts` › "leaves the signal item's own anatomy exactly as M1 shipped it" → covered by `tests/offline/review-item/page.test.ts` › "names the absent object in the close slot, as an absence and not a failure" (header figures by "carries the summary, the severity, the age and the fold count")
- `tests/offline/review-item/page.test.ts` › "renders the close as its own section, and the recommendation slot as nothing" → covered by `tests/offline/review-item/page.test.ts` › "says neither word, on any shape, in either state" (the `h2 === 3` count pins design, not behaviour)
- `tests/offline/review-item/page.test.ts` › "leaves every other part of the detail exactly as it was" → covered by `tests/offline/review-item/page.test.ts` › "comes before the evidence on every shape, in both states of the close"
- `tests/offline/review-item/page.test.ts` › "keeps the contended fact's pair in its fixed order, canonical rightmost" → covered by `tests/offline/review-item/page.test.ts` › "renders it as the rightmost card, with the tier frozen at the apply"
- `tests/offline/review-item/page.test.ts` › "keeps the third figure on its own scope when all three coincide" → copy-oracle on the dial's own words ("stuck records", "window"); the window hook is pinned by `tests/offline/review-item/page.test.ts` › "states the dial's window on a read that happened, and on no other state"
- `tests/offline/review-item/page.test.ts` › "flags the claim it is banning" → pins nothing: tests the file's own regex against its own constant
- `tests/offline/review-item/page.test.ts` › "leaves the accounting sentence and the dial's own line alone" → covered by `tests/offline/review-item/page.test.ts` › "keeps the accounting whole when the distinct ids cross a chunk boundary" (window line by "states the dial's window on a read that happened, and on no other state")
- `tests/offline/review-item/page.test.ts` › "states both figures where the folds are FEWER than the ids listed" → covered by `tests/offline/review-item/page.test.ts` › "states what a fold is, and the evidence-id count it stands over"
- `tests/offline/review-item/page.test.ts` › "links a source-pattern item to its claims and its source" → covered by `tests/offline/review-item/page.test.ts` › "names the source in both header links, in the evidence table's own words"
- `tests/offline/review-item/page.test.ts` › "names the item's own source when it has no evidence to borrow a name from" → covered by `tests/offline/review-item/page.test.ts` › "names the item's own source when its evidence carries a different one"
- `tests/offline/review-item/page.test.ts` › "renders the app's dash, on every absence the evidence table reaches" → covered by `tests/offline/review-item/page.test.ts` › "draws the app's one absence element inside each of them, not a bare character"
- `tests/offline/review-item/page.test.ts` › "renders no blank cell for a source whose registry name is blank" → covered by `tests/offline/review-item/page.test.ts` › "says the source's id verbatim wherever the row names its source"
- `tests/offline/review-item/page.test.ts` › "keeps the link and the name for a source whose registry name is an em dash" → covered by `tests/offline/review-item/page.test.ts` › "keeps every source's link and words on a page that mixes all three kinds of name"
- `tests/offline/review-item/page.test.ts` › "announces no absence anywhere on a page whose every source is named" → covered by `tests/offline/review-item/page.test.ts` › "keeps every source's link and words on a page that mixes all three kinds of name"
- `tests/offline/review-item/page.test.ts` › "reads the absent tier the same way the evidence pair one block above does" → covered by `tests/offline/review-item/page.test.ts` › "puts a labelled absence and a real tier in one pair when the registry answered for only one source"
- `tests/offline/review-item/page.test.ts` › "says the pair's absent tier with the app's absence element too" → covered by `tests/offline/review-item/page.test.ts` › "puts a labelled absence and a real tier in one pair when the registry answered for only one source"
- `tests/offline/review-item/page.test.ts` › "says a dash is on screen only when one is, in the folded-records table" → covered by `tests/offline/review-item/page.test.ts` › "prints the dash-meaning line exactly when the record cell draws a dash"
- `tests/offline/review-item/page.test.ts` › "draws SOMETHING for a claim whose only identity has no ink" → covered by `tests/offline/review-item/page.test.ts` › "prints the dash-meaning line exactly when the record cell draws a dash"
- `tests/offline/review-item/page.test.ts` › "leaves the no-such-row state to a well-formed id that matches nothing" → covered by `tests/offline/review-item/page.test.ts` › "still reads the database for %s, an id Postgres accepts" (the empty card by "renders the item's own surface for an id no row matches, and does not route")
- `tests/offline/review-item/page.test.ts` › "asks the one id grammar this repo has, and no copy of it" → covered by `tests/offline/review-item/page.test.ts` › "answers %o having read nothing at all"
- `tests/offline/review-item/page.test.ts` › "sets the name in the machine's face on an address that is no id" → covered by `tests/offline/review-item/page.test.ts` › "draws nothing but the identifier in the machine's face on %s"
- `tests/offline/review-item/page.test.ts` › "sets the name in the machine's face on an id no row has" → covered by `tests/offline/review-item/page.test.ts` › "draws nothing but the identifier in the machine's face on %s"
- `tests/offline/review-item/page.test.ts` › "offers no control at all, on any shape" → covered by `tests/offline/review-item/page.test.ts` › "names the FUNCTION, not the table that is right there" (the not-provisioned branch offering nothing by "renders no control at all, on any shape")
- `tests/offline/review-item/page.test.ts` › "keeps the controls where BOTH objects are installed" → covered by `tests/offline/review-item/page.test.ts` › "renders the note field and this shape's actions, on every shape"
- `tests/offline/review-item/page.test.ts` › "makes no rpc call to find out, on either world" → covered by `tests/offline/verdict/seam.test.ts` › "probes the function by READING the schema description, never by calling"
- `tests/offline/verdict/seam.test.ts` › "answers not_provisioned on Postgres's own 42P01" → covered by `tests/offline/db/result.test.ts` › "reads %s (an absent %s) as not_provisioned for a caller that asked for one" (the `ABSENCE_CODES` row `["42P01", "table", undefinedTable(T.verdicts), "table"]`), with the seam's own wiring by `tests/offline/verdict/seam.test.ts` › "answers not_provisioned naming settle_review_item on PGRST202"
- `tests/offline/verdict/seam.test.ts` › "keeps a missing OPERATOR an error, not an absent function" → covered by `tests/offline/db/result.test.ts` › "leaves %s red, carrying the database's own words" (the `NEIGHBOURING_CODES` row `["42883 missing OPERATOR", missingOperator()]`) and `tests/offline/db/result.test.ts` › "asks the operator exception of the database's words too, not the app's" (`classify(missingOperator(), SETTLE_FUNCTION, "function").kind === "error"`)
- `tests/offline/review-item/page.test.ts` › "names the missing table when the item's own table is absent" → covered by `tests/offline/absence/pages.test.ts` › "survives %s being absent" (the `/queues/[reviewItemId]` describe, both PGRST205 and 42P01) and `tests/offline/absence/pages.test.ts` › "%s names every object it asked for and invents no number" — the deleted case asserted only that the page text names `review_items`, nothing the matrix does not
  Orphans removed with them: `missingOperator` and `undefinedTable` imports in `seam.test.ts` (page.test.ts keeps `tableNotInSchemaCache`, still used by `SETTLEMENT_ABSENT` and the evidence/dial arms).
**Kept with a twin outside the group (after reconciliation):**

- None remaining: the two seam classifier cases listed here after the first pass were reconciled centrally and deleted in the second pass below.
**Suspected dead code (named, not touched):**

- `src/components/review/close/slot.tsx` ~line 431: the `actions.length === 0` branch of the ready `CloseSlot` ("No verdict action is offered for this item yet.") — no shape module answers an empty list (`data_conflict_fact` falls back to `keep_current`, `entity_link_fact` to `settle`, the signal always two), so only the deleted close-slot case reached it.
- `src/components/evidence/evidence-pair.tsx` lines 38/90/254/267: the `action?: ReactNode` prop on `EvidenceClaim` and on the canonical card — `shape-views.tsx` states "no card carries an action" and no `src/` caller passes one; only the deleted evidence-pair case rendered it.
**Group notes:**

- Nothing blocked. Notes for the reconciler:
  - Header doc comments: one paragraph each was deleted from `signal-actions.test.ts`, `link-actions.test.ts` and `conflict-actions.test.ts` ("the absence is graded first" — describing the deleted absent-state describes); `page.test.ts` lost the `RETIRED_CLAIM` paragraph with the deleted self-test. No prose was rewritten.
  - The comment above `verdict-inline.test.ts` › "holds a bidi-override observation id…" still says "The test above pins that the arm goes THROUGH the primitive" — that test was deleted; the prose was left as the brief forbids rewriting it.
  - `conflict-actions.test.ts` › "the kind of fact the item is about — QA attack" keeps its describe-level doc comment, whose last sentence refers to "the two pins below" that were deleted; left for the same reason.
  - Syntax was verified by parsing each file with the TypeScript compiler API (`ts.createSourceFile`, parse diagnostics only — not `tsc`); unused imports/helpers were removed by inspection and a comment-stripped identifier count.
### F1 — edit routes (`edit/*`, `records/routes`, `records/submit`, `records/provenance`)

51 audit lines.

- `tests/offline/records/routes.test.ts` › "contains the module this rule is about" → covered by `tests/offline/records/routes.test.ts` › "is the only file in src/ that builds the record URL" (`toEqual([LEAF])` reddens if the leaf is gone)
- `tests/offline/records/routes.test.ts` › "leaves the two old names spelled nowhere in src/ as code" → pins nothing: an identifier-name ban (`provenanceHref(`/`eventRecordHref(`); the one-spelling claim is "is the only file in src/ that builds the record URL"
- `tests/offline/records/submit.test.ts` › "hands the route's refusal back in its own words" → covered by `tests/offline/records/submit.test.ts` › "passes a refusal through in the words the route used" (both submitters go through the one `send()` in `src/components/records/submit.ts`)
- `tests/offline/records/submit.test.ts` › "claims no stored value on success, because none came back" → covered by `tests/offline/records/submit.test.ts` › "says nothing about the value when the answer carried no record" (same `send()`)
- `tests/offline/records/provenance.test.ts` › "reports the CURRENT decision when handed the reduction, not the history" → covered by `tests/offline/edit/records.test.ts` › "keeps only the latest decision per fact, and resolves its source name" (the composition the data layer actually makes; `currentDecisions` itself is pinned in `tests/offline/browse/views.test.ts`)
- `tests/offline/records/provenance.test.ts` › "contains the modules these rules are about" → covered by `tests/offline/records/provenance.test.ts` › "keeps the leaf below lib/db: it imports nothing but another leaf" (a closed one-entry import list reddens on a vanished leaf)
- `tests/offline/edit/records.test.ts` › "is the primary key plus exactly the editable ones" → covered by `tests/offline/edit/records.test.ts` › "adds the read-only display columns, so the surface has them to draw" (`recordColumns(config) === mappedColumns(config).join`, plus config.test's exact sandbox list)
- `tests/offline/edit/records.test.ts` › "asks for nothing the map does not carry, on a resolver-owned table too" → covered by `tests/offline/edit/records.test.ts` › "adds the read-only display columns, so the surface has them to draw" (with `tests/offline/edit/config.test.ts` › "carries Ben's answer of 2026-09-08 as the editable list of each, exactly")
- `tests/offline/edit/records.test.ts` › "refuses an id, key or timestamp column" → covered by `tests/offline/edit/records.test.ts` › "refuses a column absent from the map, naming the field" (same allowlist refusal, `created_at` driven in both)
- `tests/offline/edit/records.test.ts` › "refuses a table Ben struck from the map, whatever the column" → covered by `tests/offline/edit/records.test.ts` › "refuses a forged config whose table the map does not carry" (groups/idols lead its list; same hand-built-config forgery)
- `tests/offline/edit/records.test.ts` › "refuses the map's own config for a resolver-owned table, obtained honestly" → covered by `tests/offline/edit/records.test.ts` › "refuses every column of a resolver-owned table, mapped or not" (the forged `path: "direct"` on `events.title`/`venues.name` is the stronger half of the same "re-derive the path from the regime" claim; `edit.path === "override"` is pinned by config.test's "allows a mapped column of a resolver-owned table, by the override path")
- `tests/offline/edit/records.test.ts` › "carries the venue fact onto the reference column that displays it" → covered by `tests/offline/edit/records.test.ts` › "reduces the venue fact's own history, and shows its lock" (BUG-0090 QA pin whose fix landed; the filter half is "reads the log for this entity and this row's mapped fields")
- `tests/offline/edit/route.test.ts` › "makes exactly one settlement call, and no direct write" → covered by `tests/offline/edit/route.test.ts` › "sends each regime down its own path, on two fixtures" (asserts 1 settle / 0 direct on `events.title`; the 200 is "returns the verdict receipt, and no record it did not read")
- `tests/offline/edit/route.test.ts` › "answers a malformed id without settling anything" → covered by `tests/offline/edit/route.test.ts` › "is refused 404 and no database call is attempted" (the value arm's one `isRecordId` line, route.ts:471, is the same line the sandbox gate drives)
- `tests/offline/edit/route.test.ts` › "names the fact the DECISION LOG spells: the registry field for the reference, the column for a scalar" → covered by `tests/offline/edit/route.test.ts` › "carries the chosen id as value.ref, under the registry's field name" (exact envelope `toEqual`, `field: "venue"`, no `column` key; the scalar arm is the exact envelope in "carries the override envelope exactly, and nothing else")
- `tests/offline/edit/route.test.ts` › "refuses the same column submitted as text, before any database call" → covered by `tests/offline/edit/route.test.ts` › "refuses a column of a resolver-owned table the map does not carry, 403, naming the field" (drives `events.venue_id` with a value: 403, names the field, no settle, no write)
- `tests/offline/edit/route.test.ts` › "refuses a ref on a table the map does not carry" → covered by `tests/offline/edit/route.test.ts` › "refuses a ref for a column the map does not call a reference" (the ref arm's one refusal line; `unknown_table → 404` through the shared `statusFor` is "refuses both tables Ben struck, 404, naming the table, on every column their allowlists carried")
- `tests/offline/edit/route.test.ts` › "answers 503 naming what is absent, which is the normal case here too" → covered by `tests/offline/edit/route.test.ts` › "answers 503 naming what is absent, which is the normal case" (both arms end in the one `sendOverride`)
- `tests/offline/edit/route.test.ts` › "refuses a column the map does not carry" → covered by `tests/offline/edit/route.test.ts` › "refuses a column of a resolver-owned table the map does not carry, 403, naming the field" (same `field_not_editable → 403`; the sandbox instance is also driven by "does not take an answer the map owns: the id is asked after decideEdit", `walk_sandbox.spotify_id → 403`)
- `tests/offline/edit/route.test.ts` › "refuses a primary key, a foreign key and a timestamp" → covered by `tests/offline/edit/route.test.ts` › "refuses a column of a resolver-owned table the map does not carry, 403, naming the field" (same refusal; `events.created_at`, `events.venue_id` driven there)
- `tests/offline/edit/route.test.ts` › "refuses a table the map does not carry, the archive and a legacy table" → covered by `tests/offline/edit/route.test.ts` › "refuses both tables Ben struck, 404, naming the table, on every column their allowlists carried" (same `unknown_table → 404`; the other table names are decideEdit's, pinned in config.test's "refuses a table the map does not carry, naming the table")
- `tests/offline/edit/route.test.ts` › "is not fooled by a name inherited from Object.prototype" → covered by `tests/offline/edit/config.test.ts` › "is not fooled by a name inherited from Object.prototype" (the route only calls `decideEdit`; a refused decision cannot reach a writer)
- `tests/offline/edit/route.test.ts` › "refuses a non-finite number instead of nulling the column" → covered by `tests/offline/edit/route.test.ts` › "names the unstorable number in the refusal, as a client error" (BUG-0013 `it.fails` pin whose fix landed; same body)
- `tests/offline/edit/route.test.ts` › "refuses a body that omits `value` instead of clearing the column" → covered by `tests/offline/edit/route.test.ts` › "names the missing `value` in the refusal, as a client error" (BUG-0011 pin whose fix landed; same body — its second fixture named `name`, not a sandbox column, so it was refused by the allowlist regardless)
- `tests/offline/edit/route.test.ts` › "says nothing the database said — no error code, no syntax text, no type name" → covered by `tests/offline/edit/route.test.ts` › "says nothing the database said for any of them, and echoes no segment back" (same regex over the one `noSuchRecord` body)
- `tests/offline/edit/route.test.ts` › "still writes a well-formed id, whatever case it is spelled in" → covered by `tests/offline/edit/route.test.ts` › "does not over-refuse an id form the database itself accepts" (canonical and upper case are its first two fixtures)
- `tests/offline/edit/route.test.ts` › "gives the malformed miss and the well-formed miss the same body on every editable table" → covered by `tests/offline/edit/route.test.ts` › "answers it in the words this route already uses for a record that is not there" (same claim; the QA copy drove one table despite its title)
- `tests/offline/edit/route.test.ts` › "keeps the map's and the body parser's answers for these segments too" → covered by `tests/offline/edit/route.test.ts` › "does not take an answer the map owns: the id is asked after decideEdit" (same ordering claim, which also pins the messages)
- `tests/offline/edit/route.test.ts` › "refuses a malformed id the same way when the same request arrives twice at once" → pins nothing: a stateless handler called twice is "is refused 404 and no database call is attempted" twice
- `tests/offline/edit/config.test.ts` › "carries no groups and no idols entry: the struck direct edit left with them" → covered by `tests/offline/edit/config.test.ts` › "carries exactly the two resolver-owned tables and the walk sandbox, keyed by their own name" (exact list) and "refuses a table the map does not carry, naming the table" (groups/idols lead it; `editConfigFor` null)
- `tests/offline/edit/config.test.ts` › "refuses every column the struck allowlists used to carry" → covered by `tests/offline/edit/config.test.ts` › "refuses a table the map does not carry, naming the table" (the refusal is the table's — `decideEdit` never reaches the column)
- `tests/offline/edit/config.test.ts` › "sends every regime the map uses down exactly one write path" → covered by `tests/offline/edit/config.test.ts` › "gives a direct write path to the walk sandbox and to nothing else" (`writePathFor` on both regimes is also pinned by the sandbox and resolver-owned entry cases)
- `tests/offline/edit/config.test.ts` › "leaves created_at outside the sandbox's map, so no read ever asks for it" → covered by `tests/offline/edit/config.test.ts` › "gives the walk sandbox its staging-only key, regime and column set" (exact `editable`/`display`, with "is the primary key, then editable, then display, in declared order")
- `tests/offline/edit/config.test.ts` › "gives the sandbox every column the write path coerces, one of each" → covered by `tests/offline/edit/config.test.ts` › "gives the walk sandbox its staging-only key, regime and column set" (once the exact list holds, both of its loops run over test-local constants)
- `tests/offline/edit/config.test.ts` › "leaves the CHECK-constrained and unruled columns out of both lists" → covered by `tests/offline/edit/config.test.ts` › "carries Ben's answer of 2026-09-08 as the editable list of each, exactly" (with "leaves the reference alone in events' display list, and venues' empty")
- `tests/offline/edit/config.test.ts` › "draws the same lines in the same order the move found them in" → covered by `tests/offline/edit/config.test.ts` › "is the primary key, then editable, then display, in declared order" (given the two exact-list cases)
- `tests/offline/edit/config.test.ts` › "leaves the sandbox no display list — it edits its columns" → covered by `tests/offline/edit/config.test.ts` › "gives the walk sandbox its staging-only key, regime and column set"
- `tests/offline/edit/config.test.ts` › "keeps every reference a displayed column, never an editable one" → covered by `tests/offline/edit/config.test.ts` › "gives events the one reference the surface links through, and no other table one" (with the exact display list and exact `EDITABLE_TABLES`)
- `tests/offline/edit/config.test.ts` › "never lists one column as both editable and displayed" → covered by `tests/offline/edit/config.test.ts` › "keeps the two lists disjoint on every entry, and says so on a probe that is not"
- `tests/offline/edit/config.test.ts` › "lists no id, key, bookkeeping timestamp, link or json column as editable" → covered by `tests/offline/edit/config.test.ts` › "carries Ben's answer of 2026-09-08 as the editable list of each, exactly" (and the exact sandbox list; a forbidden name can only enter by changing a pinned list)
- `tests/offline/edit/config.test.ts` › "carries no per-column flag and no second list: the entry is six keys" → pins nothing: the entry's key shape, which changes with the design and never with behaviour
- `tests/offline/edit/config.test.ts` › "answers nothing about writing: a displayed column is still refused" → covered by `tests/offline/edit/config.test.ts` › "refuses every displayed column of every table, naming the field"
- `tests/offline/edit/config.test.ts` › "refuses an id, key or timestamp column spelled correctly" → covered by `tests/offline/edit/config.test.ts` › "refuses a column the map does not carry, naming the field" (sandbox) and "refuses an unmapped column of a resolver-owned table, naming the field" (`events.created_at`, `events.venue_id`)
- `tests/offline/edit/config.test.ts` › "takes the path from the regime alone, on two entries that differ in everything else" → covered by `tests/offline/edit/config.test.ts` › "carries the write path the REGIME decides, on every allowed decision" (its assertions were `writePathFor` on two literals)
- `tests/offline/edit/config.test.ts` › "ignores a display list entirely, however it is spelled" → covered by `tests/offline/edit/config.test.ts` › "refuses every displayed column of every table, naming the field"
- `tests/offline/edit/config.test.ts` › "does not make that column editable as a value" → covered by `tests/offline/edit/config.test.ts` › "refuses an unmapped column of a resolver-owned table, naming the field" (`events.venue_id` → `field_not_editable`)
- `tests/offline/edit/config.test.ts` › "refuses every column of a table with no reference at all" → covered by `tests/offline/edit/config.test.ts` › "refuses every column that is not the reference, naming the field" (iterates every mapped column of every table, venues and the sandbox included)
- `tests/offline/edit/config.test.ts` › "reports an editable list that carries the column" → pins nothing: asserts that vitest's `expect(...).not.toContain` throws on a test-local planted object; the real-map half is already the first pin of "builds no write path to a resolver-owned table or a link table"
- `tests/offline/edit/config.test.ts` › "leaves no probe behind for another suite to walk into" (admin_locked guard) → pins nothing in src: `fs.existsSync` after the case's own `finally`
- `tests/offline/edit/config.test.ts` › "leaves no probe behind for another suite to walk into" (string-literals scan) → pins nothing in src: same shape (`planted > 0` only counted the test's own helper calls)
- `tests/offline/edit/config.test.ts` › "leaves no probe behind for another suite to walk into" (one-call-site guard) → pins nothing in src: same shape
**Kept with a twin outside the group (after reconciliation):**

- `tests/offline/records/routes.test.ts` › "names one canonical row, whatever its domain", "encodes BOTH halves, because both are data", "answers null when there is no canonical row to lead to" — the same `recordHref` assertions live in `tests/offline/claims/filters.test.ts` (lines ~861–869) and `tests/offline/browse/views.test.ts` (~758–762). One home should survive; mine are the function's own suite.
- `tests/offline/records/routes.test.ts` › "browse draws the helper's href verbatim in the row's anchor" — `tests/offline/browse/page.test.ts` asserts the browse links contain `recordHref(...)` (plain ids); mine is the encoding fixture.
- `tests/offline/edit/config.test.ts` › "keeps config.ts a pure leaf that imports nothing" — `src/lib/edit/config.ts` is in the untouched `tests/offline/db/layering.test.ts` `LEAF_MODULES` ("imports nothing but another leaf, in any leaf"). Kept per the course correction (it is a walker).
- `tests/offline/edit/records.test.ts` › "says THIS APP wrote each refusal, so neither reads in the machine's face" — the BUG-0170→0187 account chain lives in `tests/offline/db/result.test.ts`; this case pins the two construction points in `records.ts`, so I kept it.
**Suspected dead code (named, not touched):**

- None found. No deleted case was the only reader of a `src/` path.
**Group notes:**

- Config.test.ts stayed at 54 (not ~38) because the course correction protects every tree-walking and probe-planting case; the structural half of that file (walkers, admin_locked guard, 13 string-literal probes, one-call guard) is untouched apart from the four non-walking cases listed above.
- One stale title quote in a helper docstring (`tablesWrittenIn` in config.test.ts) referenced the deleted records.test.ts case "refuses the map's own config for a resolver-owned table"; I swapped the quoted title for the surviving "refuses every column of a resolver-owned table, mapped or not" (one-line, no prose rewritten).
- Removed with their cases: the `currentDecisions` import in provenance.test.ts; the `STRUCK_TABLES` and `STRUCK_ALLOWLISTS` constants (and their doc comments) in config.test.ts. The `TABLE_NAMES` import, `CANONICAL_COLUMNS`, `withProbes`/`planted`, `refused`, `INK_LESS_ONLY`, `NOT_RECORD_IDS` etc. all still have readers.
- Not run (per the brief): vitest, tsc, eslint. Lint-cleanliness is by inspection: no empty `describe`, no unused imports/consts/helpers, no triple blank lines.
### F2 — records UI (`records/page`, `records/entity-picker`, `ui/editable-cell`)

99 audit lines.

- `tests/offline/ui/editable-cell.test.ts` › "shows the value in data type at rest" → covered by `tests/offline/ui/editable-cell.test.ts` › "keeps the statement of work off the disabled control's own label" (the button's text is the value) and › "takes the rule from the palette and from the type scale, never from a raw value" (`type-data` on the value)
- `tests/offline/ui/editable-cell.test.ts` › "is reachable by keyboard, not only by hovering a span" → covered by `tests/offline/ui/editable-cell.test.ts` › "aims at a control that can actually hold focus at rest" (a `button`) and `tests/offline/records/page.test.ts` › "names the field in each control's accessible name" (its aria-label)
- `tests/offline/ui/editable-cell.test.ts` › "shows no confirmation and no failure line before anything is saved" → covered by `tests/offline/ui/editable-cell.test.ts` › "adds nothing to the resting cell, which has no status to state"
- `tests/offline/ui/editable-cell.test.ts` › "names both keys that end an edit, on the input and the textarea alike" → covered by `tests/offline/ui/editable-cell.test.ts` › "wires the field to that line, rather than leaving it to be noticed" (the described element's text names both keys)
- `tests/offline/ui/editable-cell.test.ts` › "says something, where before it said nothing at all" → covered by `tests/offline/ui/editable-cell.test.ts` › "tells a write underway apart from one that has landed" (saving non-empty) and › "carries a break rule beside its cap, in every kind it draws a box for" (idle renders nothing)
- `tests/offline/ui/editable-cell.test.ts` › "still names the refusal, in the broken colour, as an interruption" → covered by `tests/offline/ui/editable-cell.test.ts` › "keeps the refusal one interruption, with both halves inside it" and › "keeps red on the failure line and off the value the field reverted to"
- `tests/offline/ui/editable-cell.test.ts` › "keeps the second edit's in-flight statement when the first edit's clock fires" → covered by `tests/offline/ui/editable-cell.test.ts` › "never lets an earlier edit's clock touch anything, over every status it can reach"
- `tests/offline/ui/editable-cell.test.ts` › "holds that statement for the whole of the write, however the two edits interleave" → covered by `tests/offline/ui/editable-cell.test.ts` › "never lets an earlier edit's clock touch anything, over every status it can reach" and › "holds the statement at every interval between the two edits"
- `tests/offline/ui/editable-cell.test.ts` › "keeps a refusal raised inside the window, and keeps its message" → covered by `tests/offline/ui/editable-cell.test.ts` › "never lets an earlier edit's clock touch anything, over every status it can reach" (the refused state, unchanged by reference)
- `tests/offline/ui/editable-cell.test.ts` › "puts a refusal on no clock at all, inside a window or outside one" → covered by `tests/offline/ui/editable-cell.test.ts` › "arms no clock a navigation could outlive" (no delay for `failed`) and › "keeps a refusal raised inside the window on screen indefinitely"
- `tests/offline/ui/editable-cell.test.ts` › "still retires the confirmation on its OWN clock, and only then" → covered by `tests/offline/ui/editable-cell.test.ts` › "never lets an earlier edit's clock touch anything, over every status it can reach" (own clock retires) and › "gives the second edit's own confirmation its own full 1.5s, and no more"
- `tests/offline/ui/editable-cell.test.ts` › "states the work the moment the edit is committed, on no clock" → covered by `tests/offline/ui/editable-cell.test.ts` › "arms no clock a navigation could outlive"
- `tests/offline/ui/editable-cell.test.ts` › "says nothing before any edit happens" → covered by `tests/offline/ui/editable-cell.test.ts` › "arms no clock a navigation could outlive"
- `tests/offline/ui/editable-cell.test.ts` › "leaves no silent, clickable window under the second edit's live write" → covered by `tests/offline/ui/editable-cell.test.ts` › "holds the statement at every interval between the two edits"
- `tests/offline/ui/editable-cell.test.ts` › "lets the success after a refusal confirm and clear on its own clock" → covered by `tests/offline/ui/editable-cell.test.ts` › "clears a spent status when the operator opens the cell again" and › "gives the second edit's own confirmation its own full 1.5s, and no more"
- `tests/offline/ui/editable-cell.test.ts` › "is still on no clock: what retires it is the operator, at whatever moment they act" → covered by `tests/offline/ui/editable-cell.test.ts` › "keeps a refusal raised inside the window on screen indefinitely" and › "retires when the operator abandons that edit, leaving the cell as if never edited"
- `tests/offline/ui/editable-cell.test.ts` › "does not stop a write still in flight, whatever the operator presses" → covered by `tests/offline/ui/editable-cell.test.ts` › "retires a refusal and nothing else, over every status the cell can be in" and › "never retires a write in flight, whichever move reaches it"
- `tests/offline/ui/editable-cell.test.ts` › "replaces a second refusal on the same cell rather than adding one" → covered by `tests/offline/ui/editable-cell.test.ts` › "never lets a straggler clock or a stale abandonment retire a newer edit's statement" (same twice-refused state; its retiring moves end it)
- `tests/offline/ui/editable-cell.test.ts` › "still lets the operator reopen the cell to clear it, the way that already worked" → covered by `tests/offline/ui/editable-cell.test.ts` › "clears a spent status when the operator opens the cell again"
- `tests/offline/ui/editable-cell.test.ts` › "gives QA's whole keyboard sequence at most one refusal, and never two" → covered by `tests/offline/ui/editable-cell.test.ts` › "and goes on the very next move, which on a keyboard is a focus landing elsewhere" and › "holds one refusal even when two writes are in flight at once"
- `tests/offline/ui/editable-cell.test.ts` › "leaves the 1.5s confirmation alone, however the operator moves" → covered by `tests/offline/ui/editable-cell.test.ts` › "retires a refusal and nothing else, over every status the cell can be in"
- `tests/offline/ui/editable-cell.test.ts` › "cannot be retired by a move belonging to an edit that is no longer showing" → covered by `tests/offline/ui/editable-cell.test.ts` › "never lets a straggler clock or a stale abandonment retire a newer edit's statement" (identical fixture and sweep)
- `tests/offline/ui/editable-cell.test.ts` › "listens page-wide for a press, for Escape, AND for focus landing" → covered by `tests/offline/ui/editable-cell.test.ts` › "binds every listener on the box's OWN document, in the capture phase"
- `tests/offline/ui/editable-cell.test.ts` › "reads a press and a focus landing as the same question: inside, or away" → covered by `tests/offline/ui/editable-cell.test.ts` › "reads a press inside the widget as inside, and one outside as away"
- `tests/offline/ui/editable-cell.test.ts` › "answers Escape and stays silent for every other key" → covered by `tests/offline/ui/editable-cell.test.ts` › "carries the key of a key event, and none where there was no key"
- `tests/offline/ui/editable-cell.test.ts` › "stops listening to all three when the refusal goes" → covered by `tests/offline/ui/editable-cell.test.ts` › "actually unbinds all three when the refusal goes, and hears nothing after"
- `tests/offline/ui/editable-cell.test.ts` › "hands the slot on down a chain without ever holding two" → covered by `tests/offline/ui/editable-cell.test.ts` › "retires the refusal that held the slot when a newer one takes it" and › "holds one refusal even when two writes are in flight at once" (the self-releasing holder, through the page)
- `tests/offline/ui/editable-cell.test.ts` › "adds nothing to the resting markup to do it" → covered by `tests/offline/ui/editable-cell.test.ts` › "aims at a control that can actually hold focus at rest" (no tabindex) and › "adds nothing to the resting markup, which has no field to select" (no autofocus/input/textarea)
- `tests/offline/ui/editable-cell.test.ts` › "commits a draft with nothing visible in it as the clear it looks like" → covered by `tests/offline/ui/editable-cell.test.ts` › "decides through the app's one definition, not through a second copy of it" (the identity over the same ink-less list)
- `tests/offline/ui/editable-cell.test.ts` › "agrees with the SURFACE over the class this bug arrived as" → covered by `tests/offline/ui/editable-cell.test.ts` › "decides through the app's one definition, not through a second copy of it"
- `tests/offline/ui/editable-cell.test.ts` › "draws the dash for the value it just committed, rather than an empty target" → covered by `tests/offline/ui/editable-cell.test.ts` › "renders a null value as the dash, never as an empty click target"
- `tests/offline/ui/editable-cell.test.ts` › "hands it the SAME reference every render, so typing does not re-select" → covered by `tests/offline/ui/editable-cell.test.ts` › "hands the field the select-on-open behaviour, on the input and the textarea alike" (the ref IS the module export, so identity follows)
- `tests/offline/ui/editable-cell.test.ts` › "selects a multiline value without counting characters, so no newline is lost" → covered by `tests/offline/ui/editable-cell.test.ts` › "selects the whole value, and writes nothing" (same spy, throws on the index form)
- `tests/offline/ui/editable-cell.test.ts` › "draws every part that is not the value outside the flow, wherever it is drawn at all" → covered by `tests/offline/ui/editable-cell.test.ts` › "asks its row for the same box in every state: the resting value, and nothing else"
- `tests/offline/ui/editable-cell.test.ts` › "is not vacuously true: the states really do differ from each other" → covered by `tests/offline/ui/editable-cell.test.ts` › "asks its row for the same box in every state: the resting value, and nothing else" and › "keeps the value holding the box it held, and shows it to nobody" (concrete layouts already pinned)
- `tests/offline/ui/editable-cell.test.ts` › "is drawn out of the flow and inert to the pointer, in every kind it renders" → covered by `tests/offline/ui/editable-cell.test.ts` › "stays out of the flow and inert to the pointer whichever way it grows"
- `tests/offline/ui/editable-cell.test.ts` › "stays readable over whatever it hangs over, and still says what it always said" → covered by `tests/offline/ui/editable-cell.test.ts` › "stays out of the flow and inert to the pointer whichever way it grows" (`bg-surface`)
- `tests/offline/ui/editable-cell.test.ts` › "hangs below a line that has one below it" → covered by `tests/offline/ui/editable-cell.test.ts` › "tells the record's LAST line to grow up, and every other line to grow down" (`hintSide` read off `RecordFields`)
- `tests/offline/ui/editable-cell.test.ts` › "hangs above the last line, whose only neighbour below is the table's own clip" → covered by `tests/offline/ui/editable-cell.test.ts` › "tells the record's LAST line to grow up, and every other line to grow down"
- `tests/offline/ui/editable-cell.test.ts` › "hangs below when there is no neighbour on either side" → covered by `tests/offline/ui/editable-cell.test.ts` › "tells a one-line record's only line to grow down"
- `tests/offline/ui/editable-cell.test.ts` › "grows down from a line that has one below it" → covered by `tests/offline/ui/editable-cell.test.ts` › "tells the record's LAST line to grow up, and every other line to grow down"
- `tests/offline/ui/editable-cell.test.ts` › "grows up from the last line, whose only neighbour below is the table's own clip" → covered by `tests/offline/ui/editable-cell.test.ts` › "tells the record's LAST line to grow up, and every other line to grow down"
- `tests/offline/ui/editable-cell.test.ts` › "grows down when there is no neighbour on either side" → covered by `tests/offline/ui/editable-cell.test.ts` › "tells a one-line record's only line to grow down"
- `tests/offline/ui/editable-cell.test.ts` › "keeps both halves of a refusal inside the one region, whichever way it grows" → covered by `tests/offline/ui/editable-cell.test.ts` › "keeps the refusal one interruption, with both halves inside it"
- `tests/offline/ui/editable-cell.test.ts` › "leaves the database's words exactly as they arrived, however long the token" → covered by `tests/offline/ui/editable-cell.test.ts` › "renders both halves at the field, the machine's words in mono and the fix in sans"
- `tests/offline/ui/editable-cell.test.ts` › "opens on pointerdown, and not on the click that same press ends with" → covered by `tests/offline/ui/editable-cell.test.ts` › "is not vacuously true: it says no to most of what it can be asked" (the exhaustive accept set)
- `tests/offline/ui/editable-cell.test.ts` › "never opens from a pointer's click, at any click count" → covered by `tests/offline/ui/editable-cell.test.ts` › "is not vacuously true: it says no to most of what it can be asked"
- `tests/offline/ui/editable-cell.test.ts` › "still opens from the keyboard, which sends a click and no pointer at all" → covered by `tests/offline/ui/editable-cell.test.ts` › "is not vacuously true: it says no to most of what it can be asked"
- `tests/offline/ui/editable-cell.test.ts` › "opens for the primary press only, so a context-menu press opens nothing" → covered by `tests/offline/ui/editable-cell.test.ts` › "is not vacuously true: it says no to most of what it can be asked"
- `tests/offline/ui/editable-cell.test.ts` › "refuses a press on a cell that is already open" → covered by `tests/offline/ui/editable-cell.test.ts` › "is not vacuously true: it says no to most of what it can be asked"
- `tests/offline/ui/editable-cell.test.ts` › "refuses a press while this cell's own write is in flight" → covered by `tests/offline/ui/editable-cell.test.ts` › "is not vacuously true: it says no to most of what it can be asked"
- `tests/offline/records/page.test.ts` › "never offers a control for the primary key" → covered by `tests/offline/records/page.test.ts` › "offers the cell on every mapped column once the path is open" (events/venues pk) and › "draws every mapped column, and the key without a control, where it is present" (sandbox pk)
- `tests/offline/records/page.test.ts` › "names the reason, in the app's voice and in the database's own word" → covered by `tests/offline/records/page.test.ts` › "$world" (the neither-installed row: the note once, `data-not-provisioned="verdicts"` once); the remaining assertions were copy
- `tests/offline/records/page.test.ts` › "proves that negative is not vacuous: the sandbox does draw controls" → covered by `tests/offline/records/page.test.ts` › "offers a control for every column the map carries, on the directly-written table"
- `tests/offline/records/page.test.ts` › "edits through the EditableCell primitive, not a hand-rolled input" → pins nothing: a verbatim-markup pin beside the behavioural pins of the same line
- `tests/offline/records/page.test.ts` › "shows the stored value, including a number, as the database gave it" → covered by `tests/offline/records/page.test.ts` › "draws a false boolean and a zero as their own values, never as the absence" and › "offers none for a column absent from the map, though the row carries it" (stored values render)
- `tests/offline/records/page.test.ts` › "shows an empty column as the absence, still editable" → covered by `tests/offline/records/page.test.ts` › "leaves an unset nullable column as the absence, still editable"
- `tests/offline/records/page.test.ts` › "shows the record's id whatever the read did" → covered by `tests/offline/records/page.test.ts` › "still reports a failed VALUE read without a provenance line in its place"
- `tests/offline/records/page.test.ts` › "names no source, tier, apply time or lock state anywhere" → covered by `tests/offline/records/page.test.ts` › "stands on every line, and holds an absence on the directly-written table"
- `tests/offline/records/page.test.ts` › "reports an absent table as not provisioned, naming it" → covered by `tests/offline/records/page.test.ts` › "renders the not-provisioned card naming it where the table is absent"
- `tests/offline/records/page.test.ts` › "reports a table that holds no such row as its own state" → covered by `tests/offline/records/page.test.ts` › "leaves the unknown-id state to a well-formed id that matches no row" and › "renders the not-provisioned card naming it where the table is absent"
- `tests/offline/records/page.test.ts` › "does not report a mistyped id as a failed database read" → covered by `tests/offline/records/page.test.ts` › "answers %o without reading anything, on every table the map carries"
- `tests/offline/records/page.test.ts` › "is no id as it stands, %o" (5 params) → covered by `tests/offline/records/page.test.ts` › "answers %o without reading anything, on every table the map carries" (the page's gate is `isRecordId`; no read is issued)
- `tests/offline/records/page.test.ts` › "says something different in each regime, from one map" → covered by `tests/offline/records/page.test.ts` › "tells the operator the record is reached by id, naming no surface that could list it" and › "keeps naming Browse for a resolver-owned table, which Browse does list"
- `tests/offline/records/page.test.ts` › "stops the Browse link dead-ending: the page shows more than the id" → covered by `tests/offline/records/page.test.ts` › "draws a line per mapped column, with the value the read returned"
- `tests/offline/records/page.test.ts` › "offers no cell on a displayed column, however the map lists it" → covered by `tests/offline/records/page.test.ts` › "offers the cell on every mapped column once the path is open" (identical loop over `display`)
- `tests/offline/records/page.test.ts` › "shows a displayed column the read returned nothing for as the absence" → covered by `tests/offline/records/page.test.ts` › "draws a line for a mapped column the read returned nothing for" and › "counts every mapped line when the read hands back fewer"
- `tests/offline/records/page.test.ts` › "reaches the venue record page from an event's venue line" → covered by `tests/offline/records/page.test.ts` › "shows the venue's name, and its id, on the line that links to it"
- `tests/offline/records/page.test.ts` › "leaves a field the log says nothing about as the absence" → covered by `tests/offline/records/page.test.ts` › "stands beside real provenance without denying it"
- `tests/offline/records/page.test.ts` › "tells an absent provenance table apart from a provenance table holding nothing" → covered by `tests/offline/records/page.test.ts` › "leaves a provenance leg that failed to explain its own dashes" and › "says once what an empty provenance cell means, and leaves the dash alone"
- `tests/offline/records/page.test.ts` › "makes no provenance read for the directly-written table" → covered by `tests/offline/records/page.test.ts` › "asks the settlement question once, and only where it can change anything" (sandbox reads `[walk_sandbox]` only)
- `tests/offline/records/page.test.ts` › "still has dashes to explain on the most-sourced record possible" → covered by `tests/offline/records/page.test.ts` › "says it on EVERY resolver-owned table, not only the one the ticket named" (the key carries no decision)
- `tests/offline/records/page.test.ts` › "says once, on every mapped table, how many columns the table below draws" → covered by `tests/offline/records/page.test.ts` › "states the map's own column count on the row the read actually serves" (once, one figure) and › "names the table in the face the heading above it uses, verbatim"
- `tests/offline/records/page.test.ts` › "counts the lines the table drew, not the columns the map lists" → covered by `tests/offline/records/page.test.ts` › "counts the extra lines when the read hands back more than the map" and › "claims nothing about the columns it does not draw"
- `tests/offline/records/page.test.ts` › "leaves a null value its dash and the line that says what a dash means" → covered by `tests/offline/records/page.test.ts` › "counts every mapped line when the read hands back fewer" and › "leaves an unset nullable column as the absence, still editable"
- `tests/offline/records/page.test.ts` › "says nothing where no field table was drawn" → covered by `tests/offline/records/page.test.ts` › "says nothing on any mapped table where no field table was drawn"
- `tests/offline/records/page.test.ts` › "says the same figure when the override path is closed and nothing edits" → covered by `tests/offline/records/page.test.ts` › "draws the same field lines in every world: only the WRITE path closes" and › "states the map's own column count on the row the read actually serves"
- `tests/offline/records/entity-picker.test.ts` › "has a reference to be about, so nothing below is vacuous" → covered by `tests/offline/records/entity-picker.test.ts` › "gives it the picker with no value to point at yet" (a null reference finds no line and fails it)
- `tests/offline/records/entity-picker.test.ts` › "gives the reference line the picker, never the cell" → covered by `tests/offline/records/page.test.ts` › "offers the cell on every mapped column once the path is open" (the reference line's widget is `picker`)
- `tests/offline/records/entity-picker.test.ts` › "draws no widget at all when the override path is closed" → covered by `tests/offline/records/page.test.ts` › "renders a resolver-owned table read-only when the override path is absent"
- `tests/offline/records/entity-picker.test.ts` › "gives every editable column the cell, so the two kinds are told apart" → covered by `tests/offline/records/page.test.ts` › "offers the cell on every mapped column once the path is open"
- `tests/offline/records/entity-picker.test.ts` › "offers every option while nothing is in flight, so the claim below is not vacuous" → covered by `tests/offline/records/entity-picker.test.ts` › "offers them again once the write has answered"
- `tests/offline/records/entity-picker.test.ts` › "offers no live option while saving even when the search narrowed the list" → covered by `tests/offline/records/entity-picker.test.ts` › "offers no option that would start a second write while one is saving" (the filtered list is the one rendering)
- `tests/offline/records/entity-picker.test.ts` › "starts from nothing chosen and nothing said" → covered by `tests/offline/records/entity-picker.test.ts` › "takes a first choice, and shows it once its own write answers"
- `tests/offline/records/entity-picker.test.ts` › "hands the widget back after a write, so the next choice can be made" → covered by `tests/offline/records/entity-picker.test.ts` › "never retires a newer choice's in-flight statement"
- `tests/offline/records/entity-picker.test.ts` › "takes its delay from the one rule, so the two widgets cannot drift" → covered by `tests/offline/records/entity-picker.test.ts` › "retires a confirmation on that delay, and keeps what the write chose" (the delay is read from the cell's rule)
- `tests/offline/records/entity-picker.test.ts` › "leaves a write still in flight alone" → covered by `tests/offline/records/entity-picker.test.ts` › "arms a clock for a confirmation and for no other status the app can be in" and › "offers no option that would start a second write while one is saving"
- `tests/offline/records/entity-picker.test.ts` › "arms the page-wide retire rule for a refusal the open panel cannot end (BUG-0119)" → covered by `tests/offline/records/entity-picker.test.ts` › "hears the key through the page-wide listeners, not a handler of its own" and › "arms the page-wide rule through the cell's own adapter, copying no listener"
- `tests/offline/records/entity-picker.test.ts` › "answers Escape and refuses every other move, as one decision" → covered by `tests/offline/records/entity-picker.test.ts` › "closes on Escape and on no other move the page-wide listeners carry" and › "closes the panel from outside it, exactly as it does from inside"
- `tests/offline/records/entity-picker.test.ts` › "puts focus back on a live control when an answer lands on a panel focus has slipped out of (admin-window/BUG-0149)" → covered by `tests/offline/records/entity-picker.test.ts` › "rescues focus for the SECOND refusal too, not just the first" (its first half is this walk)
- `tests/offline/records/entity-picker.test.ts` › "puts focus back on a live control when another widget supersedes a refusal it is holding (admin-window/BUG-0149)" → covered by `tests/offline/records/entity-picker.test.ts` › "takes focus once per edge and never chases it between edges"
- `tests/offline/records/entity-picker.test.ts` › "puts focus back on the Choose button when a closed panel's refusal is superseded" → covered by `tests/offline/records/entity-picker.test.ts` › "puts adrift focus on a live control at every edge that ends a write" (the closed row) and › "waits for the Choose button to be real before handing focus back"
- `tests/offline/records/entity-picker.test.ts` › "steals no focus from a page that has merely drawn a picker" → covered by `tests/offline/records/entity-picker.test.ts` › "moves focus for no edge a control did not move for"
- `tests/offline/records/entity-picker.test.ts` › "renders the resting value as the dash when the field points nowhere" → covered by `tests/offline/records/page.test.ts` › "draws an event with no venue as the absence, and reads no view for it"
- `tests/offline/records/entity-picker.test.ts` › "keeps the route out beside the control when the field does point somewhere" → covered by `tests/offline/records/page.test.ts` › "shows the venue's name, and its id, on the line that links to it"
- `tests/offline/ui/editable-cell.test.ts` › "never suppresses the focus outline" → covered by `tests/offline/ui/tokens.test.ts` › "never suppress an outline and never animate outside the motion budget"
- `tests/offline/ui/editable-cell.test.ts` › "takes its colour from the palette in every kind, in-flight included" → covered by `tests/offline/ui/tokens.test.ts` › "use no arbitrary value and no literal colour" and › "name a palette job rather than a raw ramp step — and blue stays retired"
- `tests/offline/ui/editable-cell.test.ts` › "gets its edge from a hairline and never from elevation" → covered by `tests/offline/ui/tokens.test.ts` › "draw structure with 1px hairlines, never with elevation"
- `tests/offline/records/entity-picker.test.ts` › "refuses a reference column through the one authoriser, and allows a scalar" → covered by `tests/offline/edit/config.test.ts` › "refuses every displayed column of every table, naming the field" and › "carries the write path the REGIME decides, on every allowed decision" (and › "allows the one reference the map declares, naming both of its names" for the `decideReference` half), and `tests/offline/edit/route.test.ts` › "refuses a column of a resolver-owned table the map does not carry, 403, naming the field"
  Second-pass notes: (a) tokens.test.ts verified — its SAMPLES render the resting `EditableCell` and `EditStatus` saving/saved/failed, so items 1–3 are twinned; the deleted hairline case also screened `ring-`/`outline-` prefixes, which tokens does not (only `shadow`). (b) `tests/offline/records/page.test.ts` › "makes no name read for a table the map gives no reference" — restored: carries the no-href assertion the twin does not (reinstated byte-identical to HEAD in its original position; it needed no import re-added). (c) Item 5, "renders the not-provisioned card naming it where the table is absent", is KEPT: beyond the matrix it asserts exactly one `[data-state="not_provisioned"]` card (the matrix checks names, alert texts and controls, not card count); its "the read was issued" assertion is itself twinned in this file by "asks the settlement question once, and only where it can change anything". Orphaned imports removed (`decideEdit`, `decideReference` from entity-picker); nothing else was orphaned.
**Merged chains:**

- `tests/offline/ui/editable-cell.test.ts`, the admin-window/BUG-0103 arm-selection chain → one `it.each(ARMS)` titled "derives one fix for $arm, whatever the quoted value or the row dump carries (admin-window/BUG-0103)" (4 rows: a coercion stating its code / stating no code; a not-null refusal stating its code / stating no code). Each row asserts exactly what the four pins asserted: the arm's fix is not `GENERAL_FIX`; every variant (quoted value or dumped column carrying another arm's prose or code) derives the same fix as the benign refusal of the class; the not-null rows still name `label`; the two arms stay apart. It replaces:
  - "picks the arm from the database's words, not from what the operator typed (admin-window/BUG-0103)"
  - "takes the arm from the code the refusal STATES, both directions (admin-window/BUG-0103)"
  - "picks the arm from the database's words when the refusal states no code (admin-window/BUG-0103)"
  - "reads the arm off the message's own opening, whatever the dump holds (admin-window/BUG-0103)"
  "never says stop about a refusal a retype fixes (admin-window/BUG-0103)" is kept beside it: its assertion (the corpus never derives the stop sentence) is one the table does not make.
**Kept with a twin outside the group (after reconciliation):**

- `tests/offline/ui/editable-cell.test.ts` › "never suppresses the focus outline" ↔ `tests/offline/ui/tokens.test.ts` › "never suppress an outline and never animate outside the motion budget" (tokens renders the resting `EditableCell`)
- `tests/offline/ui/editable-cell.test.ts` › "takes its colour from the palette in every kind, in-flight included" ↔ `tests/offline/ui/tokens.test.ts` › "use no arbitrary value and no literal colour" / "name a palette job rather than a raw ramp step — and blue stays retired" (tokens renders every `EditStatus` kind)
- `tests/offline/ui/editable-cell.test.ts` › "gets its edge from a hairline and never from elevation" ↔ `tests/offline/ui/tokens.test.ts` › "draw structure with 1px hairlines, never with elevation"
- `tests/offline/ui/editable-cell.test.ts` › "takes the rule from the palette and from the type scale, never from a raw value" (its raw-value/`dark:` half only; the weight/face half is unique) ↔ `tests/offline/ui/tokens.test.ts` › "use no arbitrary value and no literal colour" / "carry no dark: variant, because a palette job flips itself"
- `tests/offline/records/page.test.ts` › "reports the latest decision per fact, never a superseded source" ↔ `tests/offline/edit/records.test.ts` › "keeps only the latest decision per fact, and resolves its source name"
- `tests/offline/records/page.test.ts` › "makes no name read for a table the map gives no reference" ↔ `tests/offline/edit/records.test.ts` › "issues no query at all for a table the map gives no reference" (reconciled: restored, carries the no-href assertion the twin does not)
- `tests/offline/records/page.test.ts` › the id-grammar block ("reads a paste's surrounding whitespace as padding…" [BUG-0145], "reads %s as a paste's padding…" [BUG-0146], "keeps a printable character…", "weighs each end by CODE POINT…") ↔ `tests/offline/cycles/page.test.ts` drives the same padding family through `?cycle=`/`?run=`, and `tests/offline/edit/route.test.ts` drives the verbatim side at the wire ("refuses a ref that is not a record id…", the 404 segment block). Kept here as the pure-function home; the other two are surfaces.
- `tests/offline/records/entity-picker.test.ts` › "refuses a reference column through the one authoriser, and allows a scalar" ↔ `tests/offline/edit/config.test.ts` › "keeps every reference a displayed column, never an editable one" and `tests/offline/edit/route.test.ts` › "refuses the same column submitted as text, before any database call"
**Suspected dead code (named, not touched):**

- none found. `hintSide` and `statusGrowth` (`src/components/edit-cell-layout.ts`) lost their direct unit pins but are still reached through `RecordFields` in the two surviving placement cases; `PickerValue` lost its direct render but is reached through the record page. The `recordingHost`-style direct unit of `armRetire` is gone from tests; `armRetire` is still exercised through `domRetireHost` and both page harnesses.
**Group notes:**

- The brief says `ui/editable-cell.test.ts` carries one `it.fails`; none exists in any of the three files (grep confirms), so there was no pin to flip or delete — the ex-pins are plain `it`s and were judged as such.
- The kept case "never says stop about a refusal a retype fixes (admin-window/BUG-0103)" has a comment sentence ("The two pins above vary one dumped column and one quoted value") that now refers to the merged table; left untouched per "never rewrite prose".
- The target of roughly half gone was not reached (332 → 234 static, ~30%). Most of what survives is one pin per refusal arm, per reducer transition, per focus edge, or per layout rule — different inputs with different assertions — and the rule says keep those. I did not keep out of caution; every KEEP in the inventory names what its assertions pin that no other case does.
### G1 — db, format, url (`db/result`, `db/schema`, `db/client`, `format`, `url/*`)

47 audit lines.

- `tests/offline/db/client.test.ts` › "publishes the names it reads, so nothing else has to spell them" → covered by `tests/offline/db/client.test.ts` › "refuses when the url name is unset, naming the name" (the thrown message is built from the same constants; nothing else in src reads the exports)
- `tests/offline/db/schema.test.ts` › "is what the real supabase client carries, not a shape we invented" → covered by `tests/offline/db/schema.test.ts` › "GETs the REST root asking for the schema description, on the client's own fetch"
- `tests/offline/db/schema.test.ts` › "sees the install on the very next read, with no restart" → covered by `tests/offline/db/schema.test.ts` › "settles an INSTALLED answer for the process, and re-asks every other" (QA pin beside the builder's case; a cached absence reddens both)
- `tests/offline/db/schema.test.ts` › "carries no part of the description, and no credential, into its answer" → covered by `tests/offline/db/schema.test.ts` › "answers ok when the description lists it, and not_provisioned naming it when it does not" (`toEqual` on the exact two-field answer forbids any carried field)
- `tests/offline/format.test.ts` › "renders the same instant as absoluteUtc, without the zone token" → covered by `tests/offline/format.test.ts` › "agrees with absoluteUtc across kinds and across the day" (with "states the zone and drops the ISO punctuation" fixing the literal)
- `tests/offline/format.test.ts` › "carries whatever the caller's two forms are, verb as readily as noun" → covered by `tests/offline/format.test.ts` › "takes the one form at one and the many form at nothing and at more"
- `tests/offline/format.test.ts` › "calls absent the dash string the formatting helpers return" → covered by `tests/offline/format.test.ts` › "calls the same strings absent" (each helper's own absence case pins the dash it returns)
- `tests/offline/format.test.ts` › "keeps a real value present, including the zero and the empty-looking ones" → covered by `tests/offline/format.test.ts` › "keeps a value present when it merely contains or resembles the dash, and when it is composite" (−0 for the zero; "0"/"no value" by "calls the same strings present")
- `tests/offline/url/search-params.test.ts` › "inherits no method a consumer could reach for" → covered by `tests/offline/url/search-params.test.ts` › "is parented on nothing at all"
- `tests/offline/url/search-params.test.ts` › "is what a plain `{}` record would have got wrong" → pins nothing: its first half grades a test-local copy of the old code; its adapter half is "makes `?__proto__=x` an OWN entry rather than a prototype write" and "makes the REPEATED `?__proto__=a&__proto__=b` an own ARRAY"
- `tests/offline/url/search-params.test.ts` › "answers %j exactly as the claims route's own copy did" (11 params) → covered by `tests/offline/url/search-params.test.ts` › "carries every key the URL sent, in the order it sent them" (a byte-identical differential against a frozen test-local copy, beside the behavioural pins for single, repeated, empty-value and empty-query keys)
- `tests/offline/url/narrowing.test.ts` › "flags the generic declaration of `newestFirst`" → covered by `tests/offline/url/narrowing.test.ts` › "flags a declaration written as `export interface, generic`" (the detector's one `${name}\b` tail)
- `tests/offline/url/narrowing.test.ts` › "leaves a module that imports and CALLS `newestFirst` alone" → covered by `tests/offline/url/narrowing.test.ts` › "does not flag a mention, an import, a call or a re-export"
- `tests/offline/db/result.test.ts` › "reads a table-absent code as not_provisioned naming the table" → covered by `tests/offline/db/result.test.ts` › "reads %s (an absent %s) as not_provisioned for a caller that asked for one"
- `tests/offline/db/result.test.ts` › "reads a column-absent code as not_provisioned naming the column (%s)" (4 params) → covered by `tests/offline/db/result.test.ts` › "spells a column only when the message named one this app could have named" (its HONEST table is the same four messages byte for byte)
- `tests/offline/db/result.test.ts` › "never reports a bare table for a column-absent code that named a column" → covered by `tests/offline/db/result.test.ts` › "spells a column only when the message named one this app could have named"
- `tests/offline/db/result.test.ts` › "still classifies a foreign column-absent envelope as an absence, not an error" → covered by `tests/offline/db/result.test.ts` › "spells a column only when the message named one this app could have named"
- `tests/offline/db/result.test.ts` › "mines a column only out of what the database put in message" → covered by `tests/offline/db/result.test.ts` › "takes no column out of a message-less 400 body a real client parsed"
- `tests/offline/db/result.test.ts` › "carries the database's own message verbatim for any other failure" → covered by `tests/offline/db/result.test.ts` › "returns the database's message when the read is refused"
- `tests/offline/db/result.test.ts` › "does not treat an absence code on a different-looking error as ok" → covered by `tests/offline/db/result.test.ts` › "leaves %s red, carrying the database's own words"
- `tests/offline/db/result.test.ts` › "reads a function-absent code as not_provisioned naming the function" → covered by `tests/offline/db/result.test.ts` › "reads %s (an absent %s) as not_provisioned for a caller that asked for one"
- `tests/offline/db/result.test.ts` › "never calls a PROVISIONED table absent because a TABLE read raised 42883" → covered by `tests/offline/db/result.test.ts` › "keeps every 42883 a TABLE read can raise red, not just the operator one" (QA pin beside the builder's case; the message crossing is "keeps a TABLE read that raised 42883 red, and reads the same table again")
- `tests/offline/db/result.test.ts` › "tells the 42883s apart by what the caller asked for" → covered by `tests/offline/db/result.test.ts` › "asks the operator exception of the database's words too, not the app's" (function arm) and "keeps every 42883 a TABLE read can raise red, not just the operator one" (table arm)
- `tests/offline/db/result.test.ts` › "cannot claim a function absence for a caller that did not ask for one" → covered by `tests/offline/db/result.test.ts` › "leaves %s (an absent %s) an ERROR for a caller that asked for the other kind"
- `tests/offline/db/result.test.ts` › "carries the cause out of details when the message is only a wrapper" → covered by `tests/offline/db/result.test.ts` › "the part is the unit — the measured transport failure, frames and all"
- `tests/offline/db/result.test.ts` › "says the wrapper once, not twice, when details repeats it" → covered by `tests/offline/db/result.test.ts` › "the part is the unit — the measured transport failure, frames and all"
- `tests/offline/db/result.test.ts` › "carries message, details, hint and code, in that order" → covered by `tests/offline/db/result.test.ts` › "the part is the unit — a four-field PostgREST refusal"
- `tests/offline/db/result.test.ts` › "follows a thrown Error's cause chain" → covered by `tests/offline/db/result.test.ts` › "survives a cause chain that cycles between TWO errors"
- `tests/offline/db/result.test.ts` › "survives a cause that points back at itself" → covered by `tests/offline/db/result.test.ts` › "survives a cause chain that cycles between TWO errors"
- `tests/offline/db/result.test.ts` › "names the read that failed, in the spelling the query used" → covered by `tests/offline/db/result.test.ts` › "leaves %s red, carrying the database's own words" (every surviving error pin asserts `reading`)
- `tests/offline/db/result.test.ts` › "invents nothing when the client said nothing at all" → covered by `tests/offline/db/result.test.ts` › "the part is the unit — an intermediary's JSON envelope with no message of its own"
- `tests/offline/db/result.test.ts` › "grades ten fixtures: five the rule must reduce, five it must never touch" → pins nothing: asserts the shape of the test's own fixture table
- `tests/offline/db/result.test.ts` › "puts the DATABASE's own words, and its own code, in the machine's runs alone" → covered by `tests/offline/db/result.test.ts` › "returns the database's message when the read is refused" (with "makes the flat message the JOIN of the runs, on every shape" fixing the flat string)
- `tests/offline/db/result.test.ts` › "keeps a transport failure red rather than reading it as an absence" → covered by `tests/offline/db/result.test.ts` › "the part is the unit — the measured transport failure, frames and all"
- `tests/offline/db/result.test.ts` › "returns ok with an empty array when there are no rows" → covered by `tests/offline/db/result.test.ts` › "what a PostgREST answer is — the matching set of zero, counted"
- `tests/offline/db/result.test.ts` › "returns not_provisioned naming the column when a selected column is absent" → covered by `tests/offline/db/result.test.ts` › "still names the column from the MESSAGE when details quotes another name"
- `tests/offline/db/result.test.ts` › "reads one row, and null when there is none" → covered by `tests/offline/db/result.test.ts` › "what a PostgREST answer is — one row that really arrived" (and the `readOne: null` admit on "no array, no count and no failure — a host answering 404 with zero bytes")
- `tests/offline/db/result.test.ts` › "keeps an absent-FUNCTION code on a COUNT of a table an error, never a zero" → covered by `tests/offline/db/result.test.ts` › "refuses the absence when a call site reaches a function through a TABLE read"
- `tests/offline/db/result.test.ts` › "never turns the absent function into a number" → covered by `tests/offline/db/result.test.ts` › "returns not_provisioned when the FUNCTION is not in the schema cache" (absence arm) and "what a PostgREST answer is — no array, no count and no failure — a host answering 404 with zero bytes" (null-count arm)
- `tests/offline/db/result.test.ts` › "returns an empty ok when the database counted nothing" → covered by `tests/offline/db/result.test.ts` › "what a PostgREST answer is — the matching set of zero, counted"
- `tests/offline/db/result.test.ts` › "refuses a truncated set, naming the object, the count and the cap" → covered by `tests/offline/db/result.test.ts` › "a total smaller than the rows it came with is not a total of this set" (its truncated arm names count and cap, no data)
- `tests/offline/db/result.test.ts` › "refuses truncation regardless of where the cap bit, cap or server" → covered by `tests/offline/db/result.test.ts` › "a total smaller than the rows it came with is not a total of this set"
- `tests/offline/db/result.test.ts` › "carries a review item in each of the three shapes" → pins nothing: asserts the test fixture builders' own shape (`tests/fixtures/rows.ts`), no src behaviour
- `tests/offline/db/result.test.ts` › "carries a pending claim in every bucket, in_window included" → pins nothing: asserts the test fixture builders' own shape, no src behaviour
- `tests/offline/db/result.test.ts` › "carries a cycle, a run, a source, an observation and a provenance row" → pins nothing: asserts the test fixture builders' own shape, no src behaviour
- `tests/offline/db/result.test.ts` › "bounds the fan-out at a number a database can serve" → covered by `tests/offline/db/result.test.ts` › "issues at most CHUNK_FANOUT at once and at least two at once — a sequential implementation fails this test" (hard-codes the first batch as [0,1,2,3])
- `tests/offline/db/result.test.ts` › "returns the earlier BATCH's refusal when two batches each hold one" → covered by `tests/offline/db/result.test.ts` › "issues no further batch once a refusal is known"
**Merged chains:**

- **Account-derivation chain** (BUG-0170 → 0173 → 0179 → 0182 → 0187, plus the 0196-era "%s" table) in `tests/offline/db/result.test.ts`, describe "an account carries the parts the database authored": ONE `it.each(ACCOUNT_FIXTURES)("the part is the unit — %s")` over 35 rows, each row `[label, error, expectation]` where the expectation is a typed record of what the deleted pins asserted (`carries`, `never`, `neverMatch`, `once`, `frames` (n dropped / 0 = no frames clause), `countsWhole` (= one clause, the app's own clause for that part, at the part's length), `countsNothing`, `noLineOf`, `inOrder`, `endsWith`, `shorterThan`, `is`, `sentenceAround`, `onCard`). Plus one 3-assertion `it` ("the clause counter finds the app's own clause, and nothing else") carrying the clause-counter non-vacuity that lived inside "counts one document once on each shape QA measured". It replaces these deleted pins:
  - "does not carry an intermediary's HTML page into the account (admin-window/BUG-0170)"
  - "drops the runtime frames of a stack, keeping the cause and saying how many went"
  - "counts a body it had to serialise, and nothing of what it said"
  - "%s" (ACCOUNT_FIXTURES, 10 params)
  - "asks the code the same questions as every other part"
  - "counts a document on any line of a part, framed or not"
  - "never trails a foreign code verbatim after the clause that counted its body (admin-window/BUG-0179)"
  - "counts ONE document once, however many lines it was printed on (admin-window/BUG-0182)"
  - "counts a pretty-printed document that IS the whole part exactly once"
  - "counts one document once on each shape QA measured"
  - "counts a document whose own text is frame-shaped as one clause, saying no frames (admin-window/BUG-0187)"
  - "counts a document with frames appended once, at the whole part's length (admin-window/BUG-0187)"
  - "counts two documents in one part as two documents in ONE foreign part, no line quoted (admin-window/BUG-0187)"
  - "counts a pretty-printed document whose text sits on its own lines (admin-window/BUG-0187)"
  Kept outside the table, deliberately: "says the read was refused when the client said nothing at all" (the nothing-survived arm), "bounds the account by the clause at every text-node count, CRLF included (admin-window/BUG-0187)" (a cross-fixture growth bound and a real-client CRLF leg, neither expressible as one row), "says a repeated cause sentence once, and a prefix-sharing line twice" (DEBT-0020 dedup) and "says the cause sentence once when the cause carries a code, as node's do" (postgrest-js's real `details` shape). BUG-0181/0185 were named in the chain but are `missing`-column classification pins, not account pins; handled per rule above (two deleted, three kept).
- **Alien-host admission chain** (BUG-0224 → 0227 → 0228 → 0229) in `tests/offline/db/result.test.ts`, describe "reads against a scripted PostgREST response": ONE `it.each(ANSWERS)("what a PostgREST answer is — $label")` over 20 rows `{label, answer, refuses?, reddens?, admits?, never?}` driving each named leg (readRows / readComplete / readRowsByIds / readOne / readCount) over one scripted answer. `refuses` asserts the one-rule refusal shape (error, names the object, no `data`, authored `["this app"]`, no call-site prose, message identical to the `data: null` twin); `reddens` asserts kind alone (+ `never`), as the count pins graded it; `admits` asserts `toEqual({kind:"ok", data})`. It replaces:
  - "refuses a row set that came back with no array at all, and empties nothing"
  - "refuses a row set that came back as a JSON OBJECT, on both row-set legs, in one derivation"
  - "refuses a row set whose elements do not carry the columns the read named"
  - "refuses in the SAME words a missing row set refuses in — one derivation"
  - "still admits every answer PostgREST really gives"
  - "asks the column question of a single-row read too, and still answers ok/null"
  - "refuses a count that is not a whole number of rows, and publishes no NaN"
  - "refuses a count that is a whole number but not a number of ROWS"
  - "reads a count, and refuses a null count instead of reporting zero"
  - "refuses a null count instead of fabricating completeness, and returns no array"
  - "refuses a counted set that came back with no rows at all"
  - "refuses an ungradeable answer in ONE derivation, whichever read met it"
  BUG-0230's pin is `count(-0)` in `format.test.ts` ("renders a zero as a zero, whatever sign the number carries") and stays there; `isCount` admits −0 by design. Kept outside the table: "a single-row read admits no row only from an answer that carried one" (BUG-0234, real-client 404→204 rewrite), "holds a read that declared no columns to the element test alone" (ANY_COLUMNS, kind-only), "a total smaller than the rows it came with…" (BUG-0234 two-legs clause).
**Kept with a twin outside the group (after reconciliation):**

- `tests/offline/format.test.ts` › "is the em dash in the disabled-gray token" ↔ `tests/offline/ui/primitives.test.ts` › "renders a null cell as the dash in disabled-gray, never blank"
- `tests/offline/format.test.ts` › "re-exports the leaf's binding rather than declaring a second dash" ↔ `tests/offline/verdict/decision.test.ts` › "is the em dash and nothing else" (+ its source-tree one-spelling guard)
- `tests/offline/format.test.ts` › "calls absent a string with nothing visible in it, wherever the invisible sits" ↔ `tests/offline/verdict/decision.test.ts` › "calls absent everything with no ink in it, wherever the invisible sits" (`isAbsent`'s string arm is one call to `isAbsentText`, pinned by "is ONE body, so no input can part them")
- `tests/offline/format.test.ts` › "keeps a value present when the invisible characters merely surround it" ↔ `tests/offline/verdict/decision.test.ts` › "keeps present anything with real ink in it, the dash included"
- `tests/offline/db/result.test.ts` › "classifies an absent table on a count read too" ↔ `tests/offline/claims/read.test.ts` › "names the view when it is absent" (count read)
- `tests/offline/url/narrowing.test.ts` › the four `isFamilyNarrowing` cases ↔ `tests/offline/claims/filters.test.ts` (uses `isFamilyNarrowing` through the page's composition) — kept as the leaf's own three-state pins.
**Suspected dead code (named, not touched):**

- `src/lib/db/client.ts` exports `DB_URL_ENV_NAME` / `DB_KEY_ENV_NAME`; nothing in `src/` outside that module reads them (the deleted client case was their only consumer).
- `tests/fixtures/rows.ts` exports `fieldProvenanceRow`, `pendingClaimsInEveryBucket`, `PENDING_CLAIM_BUCKETS`, `resolutionRunRow`, `runRow`, `sourceRow`, `observationRow` were imported here only by the deleted fixture-builder cases and "reads one row…"; other suites may still use them (not checked beyond this group; helper untouched).
**Group notes:**

- Uniform refusal shape in the alien-host table: three of its source pins asserted less than the row now asserts — "asks the column question of a single-row read too…" did not compare readOne's object refusal to the `data: null` twin's words, and "holds a read that declared no columns…" was left out of the table (kept as-is) rather than widened. The widening on readOne is the same `unreadableAnswer(missing)` call (`src/lib/db/result.ts` line 1469) so it holds by construction; flagging it as the one place the merged row says more than its source. The count rows (`reddens`) keep the kind-only strength of their sources.
- The account table drops three copy-oracle negatives the sources carried (`not.toContain("something went wrong")`, `not.toContain("sorry")`) — asserted app copy in the negative; the "app-authored sentence" half of those pins survives as `sentenceAround`.
- Card-level (StateOf) assertions survive only on rows whose sources carried them (`onCard`); "bounds the account by the clause…" keeps its own.
- Not run: vitest / tsc / eslint (forbidden). All six files pass a TypeScript parser syntax check (`ts.createSourceFile` parse diagnostics: none). Unused-import sweep done by grep: every import and local in the six files is referenced.
### G2 — ui, walk, handoff (`ui/primitives`, `ui/tokens`, `ui/contrast`, `ui/copy`, `ui/link-spelling`, `walk/*`, `handoff/*`)

40 audit lines.

- `tests/offline/ui/primitives.test.ts` › "leaves a plain-string title on the h1 itself, as every other page had it" → covered by `tests/offline/ui/primitives.test.ts` › "puts the page name in an h1 and the section name in an h2, both in title type" (the no-wrapper-span half grades markup shape, not behaviour)
- `tests/offline/ui/primitives.test.ts` › "pads the page at the 16px step and spaces its sections at the same step" → pins nothing: `p-4`/`gap-4` literals; the spacing scale is swept by `tokens.test.ts`
- `tests/offline/ui/primitives.test.ts` › "sits on a surface fill inside one hairline border, and scrolls inside it" → pins nothing: container fill/border/overflow class literals
- `tests/offline/ui/primitives.test.ts` › "separates rows with hairlines and fills them on hover — no zebra, no vertical rules" → pins nothing: row separator/hover/zebra class literals
- `tests/offline/ui/primitives.test.ts` › "renders a null cell as the dash in disabled-gray, never blank" → covered by `tests/offline/ui/primitives.test.ts` › "shows a helper-produced dash in disabled-gray, like every other dash in the row" (its `raw` column is the same null cell)
- `tests/offline/ui/primitives.test.ts` › "keeps the chrome fill for every tone — colour lands on the text" → pins nothing: fill literal per tone; the ink half is "renders the very ink it publishes, so a consumer of the map cannot drift"
- `tests/offline/ui/primitives.test.ts` › "are four separate components, each rendering its own shape" → pins nothing: four renders with four different texts are four distinct strings whatever their shape
- `tests/offline/ui/primitives.test.ts` › "renders empty as a surface card carrying both what it holds and what fills it" → covered by `tests/offline/ui/primitives.test.ts` › "adds no element of its own around a string caller's two lines" (both texts; the fill/border are look literals)
- `tests/offline/ui/primitives.test.ts` › "falls back to the failure alone when the read it was given names nothing" → covered by `tests/offline/ui/primitives.test.ts` › "gets the account alone rather than a dangling em dash when the read names nothing" (same `isAbsent` branch on `reading`)
- `tests/offline/ui/primitives.test.ts` › "keeps the object name verbatim in both the hook and the card" → covered by `tests/offline/ui/primitives.test.ts` › "wraps each refusal in the hook that NAMES the read it refused" (hook value; the card's text by "names the missing table in mono and stays gray — unavailable is not broken")
- `tests/offline/ui/primitives.test.ts` › "puts this app's clause in the sans run and the database's words in the mono one" → covered by `tests/offline/ui/primitives.test.ts` › "derives the face from the carried fact alone: the same words, both ways round" (the same property with the stricter fixture)
- `tests/offline/ui/primitives.test.ts` › "publishes the same three facts on a scanned window and on a drawn one" → covered by `tests/offline/ui/primitives.test.ts` › "states the row count and the cap the read actually carried" (held/limit values on both; truncated by "states truncation as a confident boolean…" and "takes the held-back verdict from `truncated` alone…"; data-window by "publishes the window it was handed, attribute by attribute")
- `tests/offline/ui/primitives.test.ts` › "states the rows on screen once the window has been continued" → covered by `tests/offline/ui/primitives.test.ts` › "never says a continued window did not fill, in either direction of its verdict" (asserts `count(120)` in both directions)
- `tests/offline/ui/primitives.test.ts` › "leaves every state but the two the ruling moves byte-identical [admin-window/BUG-0186]" → covered by `tests/offline/ui/primitives.test.ts` › "renders a DISTINCT sentence for each of the four states its two reads leave it in [admin-window/BUG-0186]" (byte-identical/copy-oracle pin of product sentences beside the behavioural pins of the same states; the drew-none figures by "says what the count read found and stops, where the window drew no rows [admin-window/BUG-0197]")
- `tests/offline/ui/primitives.test.ts` › "clears the same card once the identifier is out of the sans label" → covered by `tests/offline/ui/primitives.test.ts` › "keeps an identifier verbatim, in mono, and out of the uppercasing element" (StatCard renders its label through `Eyebrow`; that case asserts `uppercasedIdentifiers` is `[]`)
- `tests/offline/ui/primitives.test.ts` › "clears the same page once the identifier is out of the title element" → covered by `tests/offline/ui/primitives.test.ts` › "keeps an identifier title verbatim, in mono, and out of the uppercasing h1" (same render, same `uppercasedIdentifiers` `[]`)
- `tests/offline/ui/tokens.test.ts` › "render markup at all, so the rules below are asserted against something" → pins nothing: non-vacuity of this file's own sample list; a primitive rendering nothing reddens its own cases in `primitives.test.ts`
- `tests/offline/ui/contrast.test.ts` › "defines every palette job in both themes" → covered by `tests/offline/ui/contrast.test.ts` › "%s on %s reads at 4.5:1 or better" (`value()` fails on a missing job in every ratio case; only the unread `hairline` token is lost)
- `tests/offline/ui/contrast.test.ts` › "keeps the disabled gray out of the text jobs it is exempted from" → pins nothing: compares two constants of this test file
- `tests/offline/ui/copy.test.ts` › "reads every file of a tree, not the three the bug happened to name" → covered by `tests/offline/ui/copy.test.ts` › "flags the spelling that reached the screen and clears the ones that did not" (the scanner; the fixture-tree walk is `tests/offline/toolchain.test.ts` › "reaches the probe through the unfiltered walk"). The describe's `base`/`GLUED`/`EXPLICIT` fixture and its `beforeAll`/`afterAll` were removed with it.
- `tests/offline/ui/copy.test.ts` › "does not yet read a one-word run of rendered text (QA residual)" (`it.fails`) → pins nothing: documents a blind spot of this test's own scanner; no app regression reddens it and it needs editing whenever the scanner changes
- `tests/offline/ui/copy.test.ts` › "flags the retired advice and clears the sentence that replaced it" → pins nothing: `sitesOf` is `String.includes` over lines
- `tests/offline/ui/link-spelling.test.ts` › "is looking at the real tree, including the files that carried the defect" → pins nothing: a list of eight file paths that needs editing on any rename; the walk is proved in `toolchain.test.ts`
- `tests/offline/ui/link-spelling.test.ts` › "reads the chip's fill off the component, not off a literal here" → pins nothing: grades the fixture's own derivation; an empty `CHIP_FILL` reddens the sweep loudly
- `tests/offline/ui/link-spelling.test.ts` › "stays green on a link whose body is its own words" → covered by `tests/offline/ui/link-spelling.test.ts` › "stays green when the chip sits beside the anchor, which is the ruling" (strict subset)
- `tests/offline/ui/link-spelling.test.ts` › "takes an anchor drawn in the app's own ink as its subject" → covered by `tests/offline/ui/link-spelling.test.ts` › "finds links in the app's own ink on more than one route, and words inside them"
- `tests/offline/ui/link-spelling.test.ts` › "has teeth: the same claim fails on that anchor with the spelling taken off it" → covered by `tests/offline/ui/link-spelling.test.ts` › "rejects an anchor whose ink waits for the pointer" (`expectLinkSpellingReachesTheGlyphs` calls `expectDrawnAsLinkAtRest`, whose missing-class throw that case pins)
- `tests/offline/walk/reset-sandbox.test.ts` › "names the table and the paste when it refuses an absent one" → pins nothing: copy-oracle on the refusal message; the refusal's presence is pinned by "refuses an absent table having written nothing, whichever code says so"
- `tests/offline/walk/reset-sandbox.test.ts` › "refuses an unparseable URL without echoing it" → covered by `tests/offline/live-guard.test.ts` › "refuses a url that is not a url, without echoing it" (same `resolveStagingTarget`; the CLI's wiring of that guard and its no-leak is pinned by "refuses a host that is not the declared staging target, and leaks no key")
- `tests/offline/walk/sandbox-fixture.test.ts` › "would catch a marker if one were there" → pins nothing: `includes` on a planted object, not even the predicate the case above uses
- `tests/offline/walk/session-cookie.test.ts` › "refuses a whitespace-only secret the same way" → covered by `tests/offline/walk/session-cookie.test.ts` › "treats unset, empty and whitespace-only alike" (the same refusal state from a second input; the CLI refusal itself is pinned by "refuses an empty secret, names the name, and mints nothing")
- `tests/offline/handoff/settle-review-item.test.ts` › "grades clean" → covered by `tests/offline/handoff/settle-review-item.test.ts` › "flags another source name, in the registration and in the function alike" (asserts `gradeSettle(shipped)` is `[]`; every per-property case on the shipped block names its own behaviour)
- `tests/offline/handoff/settle-review-item.test.ts` › "raises only in the sibling's KS grammar, and allocates the next free codes" → covered by `tests/offline/handoff/settle-review-item.test.ts` › "allocates codes the sibling has not already taken" (every raised code is allocated-in-the-note or taken next door)
- `tests/offline/handoff/settle-review-item.test.ts` › "does not call the sibling's own next code a claim on ours" → covered by `tests/offline/handoff/settle-review-item.test.ts` › "tells this handoff's own registry entries from a stranger's claim on the same codes" (a code not ours in `theirs` is no claim; a pinned list declares nothing per the "standing in a list" row of the BUG-0220 table)
- `tests/offline/handoff/settle-review-item.test.ts` › "reads a registry declaration in every form the sibling's own parser declares one" → covered by `tests/offline/handoff/settle-review-item.test.ts` › "reads a declaration in every form its owner's parser calls one, and in no other" (annotated, commented and single-quoted are rows of that table; QA pin whose fix landed beside the builder's property case)
- `tests/offline/handoff/settle-review-item.test.ts` › "flags a commit, which would break the one-transaction guarantee" → covered by `tests/offline/handoff/verdicts.test.ts` › "flags a commit inside the artifact" (same shared `forbiddenConstructs`)
- `tests/offline/handoff/settle-review-item.test.ts` › "reads a banned word in a comment or a string as prose, not as a construct" → covered by `tests/offline/handoff/verdicts.test.ts` › "reads a banned word in a comment or a string as prose, not as a construct" (same shared reader, same fixture shape, both outside `$$`)
- `tests/offline/handoff/verdicts.test.ts` › "grades clean" → covered by `tests/offline/handoff/verdicts.test.ts` › "flags the artifact as BUG-0082 authored it: the grant alone, no revoke" (asserts `gradeVerdicts(shipped)` is `[]`)
- `tests/offline/handoff/verdicts.test.ts` › "creates spec §7's seven columns, in order, and no eighth" → covered by `tests/offline/handoff/verdicts.test.ts` › "gives each column its type, nullability and default" (equality on the whole ordered column list)
- `tests/offline/handoff/verdicts.test.ts` › "revokes both the client roles and service_role, and grants exactly once" → covered by `tests/offline/handoff/verdicts.test.ts` › "leaves service_role holding SELECT alone and the client roles nothing" (grades the installed ACL; the deleted case graded statement spelling, which its own comment calls free)
**Kept with a twin outside the group (after reconciliation):**

- `tests/offline/ui/link-spelling.test.ts` › "sweeps exactly the routes the filesystem offers" — identical assertion in `tests/offline/absence/pages.test.ts` (line ~110, `SURFACES.map(route).sort() == WINDOW_ROUTES`).
- `tests/offline/ui/link-spelling.test.ts` › "reads a docstring quoting the rejected spelling as documentation" — the comment-stripping it proves is `codeLinesIn`'s, pinned in `tests/offline/url/narrowing.test.ts` › "does not flag a mention, an import, a call or a re-export".
- `tests/offline/ui/primitives.test.ts` › "flags a hand-spelled face and clears the primitive's own call" — same `codeLinesIn` twin as above; the `includes` half is trivial.
- `tests/offline/ui/copy.test.ts` › the three `disagreeingCounts` cases ("flags the three strings the walk read off the running app", "flags a count and its noun that a gauge card splits across two elements", "leaves alone the counts that are already correct") — the only tests of `tests/offline/ui/markup.ts`'s `disagreeingCounts`, which page suites in other groups lean on; kept as the scanner's proof, flagged in case another group also self-tests it.
- `tests/offline/ui/link-spelling.test.ts` › the four fixture self-tests under "the assertion every page test spells this rule with" — the only tests of `tests/fixtures/link-spelling.ts`'s `expectDrawnAsLinkAtRest*` / `expectNotDrawnAsLink`, used by ten page suites in other groups.
- `tests/offline/walk/reset-sandbox.test.ts` › "does not read a staging name in place of the two it takes" and "refuses in its own name when neither credential is set" — the guard they drive through the CLI is unit-tested in untouched `tests/offline/live-guard.test.ts` ("refuses and names the url when it is unset", "says the walk-sandbox reset tool refuses, when that is who asked"); kept because the CLI wiring is a separate regression, but worth a central look.
**Suspected dead code (named, not touched):**

- None found. No deleted case was the sole reachable path into anything under `src/`.
**Group notes:**

- Pre-existing double blank line at `tests/offline/handoff/settle-review-item.test.ts` (after the BUG-0220 table case, originally lines 1223-1224) left as found — not introduced by this prune and outside "delete cases".
- The `offenders(base?: string)` helper in `copy.test.ts` keeps its optional `base` parameter (still used in its body via `sourceFiles(base)`); only the fixture tree that passed it was removed.
- Did not run vitest/lint per the brief; compile/lint cleanliness checked by inspection (every import and top-level/describe-scoped helper still referenced; brace/paren balance identical to HEAD per file).

## For the factory

- Nothing under `agenticflow/**`, `.env*`, `package.json`, `vitest.config.mts`
  or `tests/suite-globs.ts` was touched; `tests/fixtures/*`, the `population.ts`
  helpers, `tests/offline/ui/markup.ts` and `tests/offline/absence/surfaces.ts`
  are byte-identical (some exports lost their last importer; listed above).
- Stale prose remains where the brief forbade rewriting it: a handful of
  comments say "the test above"/"the two pins below" about a case that is now
  gone or merged (`review-item/verdict-inline`, `review-item/conflict-actions`,
  `ui/editable-cell`). Comment-only.
- Stored ticket checks that name a deleted case by title would now report "no
  test found"; none were edited (the `tickets/` and `archive/` trees are
  untouchable from here).
- The untracked `agenticflow/visions/admin-window/tracker/inbox/2026-10-16-external-scraper-side-done.md`
  and `agenticflow/visions/admin-window/CLOSED` in the working tree are not
  mine and were not committed.
