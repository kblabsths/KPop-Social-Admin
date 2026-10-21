# Plan — what Admin builds once the filed migrations land

*Written 2026-10-21. The companion to
`2026-10-21-the-answer-has-nowhere-to-go.md`, which is the handoff. That brief
says what the scraper repo needs; this says what Admin does with each piece,
in the order the pieces unlock it. Nothing here is started.*

## The three things filed, and what each one unlocks

### 1. An act reference field + `groups`/`idols` as registered domains

**Unlocks the whole point of the Name matches tab.** Today those items ask
"which one is this, or none of them" and the close offers two dispositions
that cannot answer it; a picker would be refused with KS029.

When it lands:

- **Give the shape the link actions it should always have had.**
  `ACTIONS_BY_SHAPE.entity_link_source_pattern` moves from
  `dispositionActions` (`fixed` / `wont_fix`) to a list built on
  `link_entity` — the same action `entity_link_fact` already uses. The
  disposition pair stays available for the case the item really was handled
  elsewhere, but it stops being the only answer.
- **Give it the entity picker.** `components/records/entity-picker.tsx` exists
  and works; `linkChoices` already feeds it on the fact shape. What this shape
  needs is the candidate set the summary already names — "3 catalog names match
  closely, none exactly (Ten, Ten, Ten-X)" means the resolver computed those
  candidates, so the picker should be seeded with them rather than making the
  operator search a catalog they were just told about. **Check first whether
  the candidates are readable from the item**; if they live only in the summary
  TEXT, that is a second handoff (the resolver should write them as rows, not
  prose) and the picker falls back to search.
- **Delete `patternNotice`.** It exists only to say the answer cannot be
  recorded. The day it can, the notice is a lie with a long tail — it is
  commented to say so.
- **Re-point the Name matches tab's close heading** if the question changes.
  It reads "Which catalog name is this?" and that stays right.

### 2. A `not_in_scope` action

**Unlocks "confirm this is not a k-pop act"** — the other half of what those
items ask, and today unexpressible: `wont_fix` means "the condition stands",
which is a different claim and files the operator's judgment as a shrug.

When it lands:

- Add it to `VERDICT_ACTIONS` in `src/lib/verdict/decision.ts` and to
  `PAYLOAD_SLOTS` as a no-value action. `tests/offline/handoff/` already
  asserts Admin's copy of the list against the migration's CHECK constraint,
  so the two cannot drift — that test is the gate, and it will redden until
  Admin's list matches.
- Offer it on both entity-link shapes with a note **required**, for the reason
  `wont_fix` requires one: "not in scope" is a judgment and the why is the
  training signal the ecosystem learns from (`verdicts.note` is "the only
  column here a reader will quote back").
- Label it as a verb plus its object, per copy bar 1 — "Confirm not in scope",
  with the machine's `not_in_scope` verbatim in mono beside it, so the word on
  the button, the word in the settled state and the word in the verdict log
  are one word (copy bar 2).

### 3. If you decide an operator may cause a canonical row to exist

**This one is a design decision, not a build, and it is the biggest.** "Add
the row" is currently forbidden to Admin outright (`AGENTS.md`: inserting
catalog rows is under Never) because every catalog fact must be provenanced
through the resolver.

Two shapes it could take, and Admin's work differs completely:

- **Admin requests, the resolver creates.** Admin writes an observation at the
  admin tier naming a record that does not exist, and the resolver's creation
  bar does the rest on its next cycle. Admin's side is small: one action, one
  form, no catalog write, and the existing provenance story is untouched. **This
  is the one I would build.**
- **Admin creates directly.** Needs an RPC in the scraper repo (Admin talks
  PostgREST and cannot execute DDL or unprovenanced inserts by design), plus a
  decision about what provenance a human-created row carries. Larger, and it
  puts a hole in the rule that makes the pipeline worth having.

Until you choose, Admin says plainly that it cannot add the row — which it now
does — rather than offering a control that quietly does something else.

## What does NOT wait for any of this

Already done, this session, and independent of the migrations:

- The item id on the title row; the close heading is the item's own question;
  `payload` gone from the evidence table and `value` read down to the name it
  carries (raw kept on the `title`); a link out to each source's listing via
  `event_sources.source_url`; the folded-records lede trimmed.

Still queued and still independent:

- **The common table component** (your spec: configurable default rows,
  default/25/50/100, arrow navigation, per-column filter dropdowns, sort icons
  with a configurable default direction). It subsumes the page-windows control
  on `/claims` and `/browse`.
- **Review item #5** (stuck records: most recent first, cap 14, navigation) and
  **general #1** (every table with a date orders most-recent-first) land WITH
  that component rather than before it — both are the component's job and
  doing them twice is the only way to get them wrong.
- **Queues #8–#12**: whole-row click, and queue health shrunk, cut to the last
  8 weeks most-recent-first with navigation, its percentile table deleted, and
  FOLDED relabelled "asked again" to match the column.
- **The queues test suite**, repaired once after #8–#12 rather than between
  them.

## One thing I would raise before you apply anything

The Name matches items are the ones you care about, and they are currently
`kind: "signal"` — which is why they were in a separate tab at all. Once
`link_entity` works for them, the only thing separating them from the
`entity_link_fact` items is whether the subject is keyed by source or by fact.
That is a distinction the operator does not care about: both are "which record
is this". **At that point your original #7 is probably right** — one list, the
type as a column — and the two tabs become a filter. Worth revisiting then
rather than now; the tabs are cheap to collapse and the current split is at
least honest about the close offering different answers.
