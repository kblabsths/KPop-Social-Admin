# External ticket — prune the offline suite to tests that earn their place

*For an agent working outside the factory. Written by the admin-window
dispatcher on 2026-09-16 from Ben's testing rules of the same day (rules in
`agenticflow/tracker/proposals/2026-09-16-testing-rules.md`).*

## The problem, in numbers

`tests/offline/` holds 81 files and 3,282 cases (plus http 37, isolated 8) for
an admin dashboard with six pages. It grew one pin per QA finding across three
milestones, one property at a time; many pins restate a rule an earlier pin
already holds, and some grade how a thing happened to be written rather than
what it does. The suite is the largest cost every builder pays per ticket, and
size is not confidence.

## The rule

A test earns its place by naming a bug it would catch that no other test
catches. If two tests would both fail on the same regression, keep the one that
names the behaviour, delete the other. If a test would need editing whenever
the design changes without any behaviour changing, it pins nothing — delete it.

## What to do

1. **Inventory first, by file:** for each offline file, the cases, what
   behaviour each pins, and which other case (if any) already covers the same
   regression. Use the test titles and the assertions, not the comments. Write
   this to a scratch table before deleting anything.
2. **Delete duplicates and copy-pins.** Examples of the shapes to remove:
   - the same refusal message asserted from three call sites;
   - a `data-*` attribute pinned alongside the visible text it mirrors;
   - a "byte-identical" pin next to a behavioural pin of the same screen;
   - a QA `it.fails` pin whose fix landed, sitting beside the builder's own
     case for the same behaviour;
   - a case that asserts a sentence verbatim (the copy-oracle the QA brief
     already bans) unless it is the only pin on a refusal's PRESENCE.
3. **Merge chains.** Where a class was fixed one property at a time (the
   account-derivation chain BUG-0170→0187, the alien-host chain BUG-0224→0230,
   the paging state chain BUG-0216→0226), one table-driven case over the class's
   fixtures replaces the per-property pins. ARCHITECTURE §4.1 ("What a PostgREST
   ANSWER is") and the Common violations ledger name the classes.
4. **Keep, untouched:** the layering/structure tests (`tests/offline/layering*`,
   `toolchain.test.ts`, `shell/**`), the client-boundary test (it caught the
   2026-09-14 P1), the http tier, and anything whose deletion would drop the
   only pin on a refusal arm.
5. **Measure:** `npm test` wall time and case count before and after; the
   after must be green and the run time lower. Target: roughly half the cases
   with no behaviour uncovered — but the rule decides, not the number.
6. **Do not rewrite product code** to make a test deletable. If a test is the
   only reason a code path is reachable, say so in the hand-back; it may be
   dead code, which is a separate finding.

## Proof bar

- Before/after: files, cases, `npm test` wall time (three runs each).
- For every deleted case, one line: which surviving case covers the regression
  it pinned, or "pins nothing: <why>". Keep this list in the hand-back note
  (it is the whole audit trail).
- Green: `npm test`, `npm run test:http`, `tsc --noEmit`, `npm run lint`.
- Repo rules as in the other external tickets (branch off `run/admin-window`,
  commit by pathspec, never open `.env`, no product code changes).

## Hand-back

Inbox note `agenticflow/tracker/inbox/<date>-external-prune-done.md` with the
numbers and the deletion list. The factory's next run re-pins nothing from it.
