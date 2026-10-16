# QA's pin commits land on the run branch with no gate, and the land gate grades the ticket branch instead of the merge

Filed by: architect, campaign `admin-window`, 2026-09-11, from BUG-0195 (filed by QA off BUG-0192's close).
**Not blocking.** The defect it let through is three characters and is folded
into BUG-0194's open lane; the run keeps moving. Recorded because the hole is
structural — it re-opens on every campaign where QA commits a failing pin, and
nothing in the kit measures the tree the next builder actually clones.

## Measurement

**Expected:** `ci_command` (agenticflow/run.yaml:32 —
`rm -rf .next/types && npm run lint && ./node_modules/.bin/tsc --noEmit && npm test`)
exits 0 on `run/admin-window` at all times, since every lane reports it green
before landing and every subsequent lane branches from it.

**Found:** `./node_modules/.bin/tsc --noEmit` exits 1 on `run/admin-window`
@ `c84f68a7` (three TS2345s, `tests/offline/sources/page.test.ts:1543-1544`),
and has since `5d82adbc` — four tracker commits and one ticket land ago. Every
lane branched from the red tree in between. Re-measured by the architect
2026-09-11 at `c84f68a7`; also the ticket's stored check.

Two independent gaps produced it, and the second is the interesting one:

1. **QA's pin commits are ungated.** `5d82adbc`
   (`admin-window/BUG-0194: pin /sources' unnamed settled-values narrowing`,
   60 lines, one file) has parent `d1e148a6` — the run-branch tip. It is a
   direct commit to the run branch, not a ticket-branch merge, so no receipt
   and no `ci_check` ran on it. QA pins are the one class of product-tree
   commit the kit writes with no gate in front of it, and a pin is TypeScript
   like any other.

2. **The land gate grades the ticket branch, not the merge result.** The very
   next commit, `2c928a80` (`land BUG-0192 (ticket branch merge)`), has parents
   `5d82adbc` + `0f0a433c`. BUG-0192's builder correctly measured `tsc` exit 0
   — on `0f0a433c`, its own branch tip. Nothing anywhere measured `2c928a80`.
   A gate that runs on one parent of a merge structurally cannot see an error
   contributed by the other parent, so this hole stays open even if gap 1 is
   closed: two green branches can merge to a red tree (a type error, a duplicate
   export, two edits to one file) and the kit will report both lanes green.

Also worth noting for whoever fixes this: on this stack the error was invisible
to everything cheaper than the type checker. `npm run lint` 0, `npm run build` 0
(Next never type-checks `tests/`), and the whole offline suite passes (vitest
transpiles without checking). Only `tsc --noEmit` sees it — so "the suite was
green" is not evidence the tree compiles.

## What I am NOT proposing

Not a per-pin receipt — QA filing a pin should stay cheap. The cheap fixes, in
order of how much they'd have caught here:

- Run `ci_check` on the **post-merge** run-branch tip after each land (both
  gaps, one place), not on the ticket branch before it.
- Failing that, have the QA pin path run `ci_command` before committing to the
  run branch, the same bar a builder clears.
- Cheapest partial: have the dispatcher run `ci_check` on the run branch once
  per dispatch round and route a red to the architect. Catches it within a
  round instead of within a milestone.

Kit fix is Ben's; this is an incident report, not a ticket.
