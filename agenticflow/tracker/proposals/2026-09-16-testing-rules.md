# Proposal — testing rules (Ben, 2026-09-16), and where they must be installed

*Not a machinery diff: a rule set from the human, recorded by the dispatcher
so the next run and every outside agent work under it. Install between runs:
paste the doc text into the files named in §3 and the two brief lines into
the QA and verifier definitions.*

## 1. The rules, in Ben's words and ours

1. **No test asserts a value it did not write.** A count, an id, a title or a
   population read from a shared database is not a fixture.
2. **No test writes anywhere shared.** Not production, not staging, not a
   sandbox table on staging. If a proof seems to need a shared write, the
   proof is in the wrong place — redesign it, never grant an exception.
3. **Live tests are expensive.** Few, read-only, each with a one-line reason it
   must be live. Their only job is to prove the offline stubs are honest about
   how the real service answers. (All tests should be clear; live ones must
   also justify their cost.)
4. **A test earns its place** by naming a bug it would catch that no other test
   catches. A pin that restates an existing rule, or grades how a thing happened
   to be written, is deleted.

## 2. Proof versus test — the misunderstanding that produced the writes

"Proven end to end" in an acceptance list means: a person or an agent walks the
real thing ONCE, watches it, and leaves a dated note. It never means "write a
re-runnable test that does it on every run". The M2/M3 acceptance items 6, 7
and 8 were read the second way, became `tests/live/settle.live.test.ts` and
three tasks that had to write staging (TASK-0084/0085/0086), and produced
BUG-0215's residue. Ben walked them instead on 2026-09-16 (five of eight
actions; the report is in the inbox). Reword acceptance items to "walked and
recorded" wherever "proven" appears, and treat the verifier's close walk as the
mechanism.

A release-time live suite against a **disposable** database (never staging or
production) is the one legitimate re-runnable end-to-end run. Deferred: not
worth building until there is a production release to protect. Record it so it
is not reinvented as a staging test.

## 3. Where the text goes

- `README.md`, a "Testing" section under the tier table: the four rules and the
  proof/test distinction, verbatim from §1–§2.
- `agenticflow/docs/vision/ARCHITECTURE.md` §10 (or wherever the test tiers are
  ruled): the same four rules as contract, plus "the live tier is
  `tests/live/contract.live.test.ts` alone".
- The acceptance list (VISION "What success looks like" / `../builds/admin-build.md`):
  "proven" → "walked and recorded".
- `agenticflow/docs/DECISIONS.md`: dated entry, Ben's ruling, the deferral of the
  release suite.
- `.claude/agents/qa-adversary.md` (Ben installs): after "owns the tests", add:
  *"Rules 1–4 of `tracker/proposals/2026-09-16-testing-rules.md` bind every pin
  you write: never a shared-state read as a value, never a shared write, live
  only with a LIVE BECAUSE line, and no pin that restates a pin. One
  table-driven case per class beats one pin per property."*
- `.claude/agents/verifier.md` (Ben installs): *"Your walk IS the end-to-end
  proof; write the note, never a re-runnable test that writes."*

## 4. The two tickets that apply the rules to the tree

- `agenticflow/tracker/for-human/external-ticket-live-tier-read-only.md`
- `agenticflow/tracker/for-human/external-ticket-prune-offline-suite.md`

## 5. Why this is worth installing (the incident record)

- BUG-0215: a live test wrote real overrides on staging on every run once the
  settle function existed; residue on a catalog row for five days.
- BUG-0219: live cases graded a population read minutes earlier on a project
  another campaign writes.
- BUG-0208: a live case timed out under its own parallelism; the fix was a
  180 s budget, i.e. paying for the cost instead of removing it.
- Four one-property-at-a-time chains = 42 of M3's 72 bugs, each leaving a pin;
  3,282 offline cases for six pages.
