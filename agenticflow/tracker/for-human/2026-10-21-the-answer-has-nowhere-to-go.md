# For Ben — the operator's answer has nowhere to be written

*Written by the dispatcher on 2026-10-21, from your queues feedback. This is
the one item in that whole list Admin cannot fix from inside Admin, and it is
the item that decides whether the Queues page is ever actually usable. Nothing
here has been changed; the scraper repo and every migration are yours.*

## What you observed

> `ticketmaster "K Pop Dreamworld": no catalog name is close — confirm this is
> not a k-pop act, or add the row`
>
> `ticketmaster "TEN": 3 catalog names match closely, none exactly (Ten, Ten,
> Ten-X) — which one is this, or none of them`

Both ask a question only you can answer. Neither offers a control that answers
it: the only closes are **Mark fixed** and **Close as won't fix**.

## Why — and it is not an Admin oversight

`settle_review_item` (`20260908000002_the_verdict_settles_the_item.sql`) can
record a reference link for exactly one field:

```sql
if v_domain = 'events' and v_field = 'venue' then
  v_ref_domain := 'venues';
  v_column     := 'venue_id';
else
  raise exception 'verdict refused: %.% is not a reference field this '
                  'function can link'  -- KS029
```

and the reference-field registry is one triple, repeated identically in five
migrations (`20260901000004`, `20260903000001`, `20260910000001`,
`20260911000005`, `20260911000008`):

```sql
values ('events'::text, 'venue'::text, 'venues'::text),
```

Matching `TEN` to a catalog act means `groups` / `idols`. Those are **not
registered ecosystem domains** — the first entry of `../MIGRATE_LATER.md` is
"register `groups` and `idols` as domains (value schemas, provenance, the
resolver as writer)" — and there is no act reference field for the function to
link through.

So if Admin drew you a picker for these items, `settle_review_item` would
refuse your answer with KS029. `fixed`/`wont_fix` is the machinery's way of
saying *we cannot store what you decided* — and the signal-actions module says
as much in its own words: "this app does not perform that fix and offers no
control for it, it records that it happened."

One thing in the function's favour: the fact-match guard is already lenient
enough for these items. Its own comment says it compares only where the item
names a part, because "a per-source item names none of the three, and an
entity_link item often has no canonical row yet". So a per-source item would
NOT be refused for carrying a value — the blocker is purely the reference-field
table and the unregistered domains, not the item's shape.

## What unlocks it, smallest first

1. **Declare an act reference field.** Whatever the real column is — an
   `events` → performer link, or `event_performers` as the subject — the triple
   has to exist in the reference-field registry and the `if v_domain = ...`
   arm in `settle_review_item` has to learn it. That arm already says a second
   reference field "is a PATCH TO THIS ARM, never a silent guess", so the
   shape of the change is anticipated.
2. **Register `groups` / `idols` as domains** so a value written against them
   is provenanced like every other catalog fact. This is the ROADMAP item 9
   / MIGRATE_LATER entry, not new work I am inventing.
3. **A `not_in_scope` action**, for "confirm this is not a k-pop act". None of
   the eight actions means it. `wont_fix` means "the condition stands", which
   is a different claim and loses your judgment in a row that reads as a
   shrug. The action list is the CHECK constraint on `verdicts.action`
   (`20260908000001`), so this is a migration plus the function arm.

Decide 1 and 2 together: a picker is worth building only once the answer can
land somewhere provenanced.

## What Admin is doing meanwhile, and what it will NOT do

- These items are presented as **decisions**. The tab is "Name matches". They
  are never hidden, never folded into a lesser queue, and never relabelled as
  alerts. (They were briefly labelled "Source alerts" — my error, from reading
  the shape name instead of the summaries. Corrected.)
- The item page is being made legible: the evidence table readable, the value
  parsed to the name it carries, and a link out to the source's own listing
  (`event_sources.source_url` — a read Admin can make on its own).
- **Admin will not offer a control the function would refuse.** Where your
  answer cannot be recorded, the close will say so plainly rather than
  accepting a disposition that quietly discards it. A control that cannot be
  honoured is the one thing SPEC F10 forbids, and pretending here would be
  worse than the current blunt pair.
- Admin will not insert a catalog row. `AGENTS.md` puts that under Never, and
  the whole provenance argument depends on it.
