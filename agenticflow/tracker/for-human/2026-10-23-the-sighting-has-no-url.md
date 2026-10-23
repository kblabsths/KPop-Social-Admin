# For Ben — the resolver should record where a sighting came from

*Small, and worth filing because Admin is working around it. 2026-10-23.*

## What you asked for

> I need to see the source page, ticketmaster here, where this observation came
> from.

Right, and it was the missing piece. It is now on the item — but constructed,
not read, and that is the part worth fixing at the source.

## Why Admin had to construct it

The reference `K8vZ917-Rw0` appears in **no table in production**. Checked:

- `observations.external_ref` — 0 rows
- `confirmed_matches.external_ref` — 0 rows
- `scraped_events.source_event_id` — 0 rows
- `event_sources.source_event_id` — the column is not exposed

The item carries the source's own reference and the pipeline keeps no URL for
it. Nor is the sighting's origin event reachable: `scraped_events.artist` holds
no "Yeonjun" row, and the attraction id is inside `payload` (jsonb), which
PostgREST will not let Admin cast and search.

So `src/lib/review/sighting-url.ts` builds the address from the id, with one
verified template per source:

```
ticketmaster -> https://www.ticketmaster.com/artist/<ref>
```

Verified live on 2026-10-23: that URL resolves to the real Yeonjun page and
shows the iHeartRadio Jingle Ball dates the sighting came from. An unknown
source gets NO link rather than a guessed one.

## What would be better, and why it is yours

A constructed URL is a pattern this app believes about someone else's site. It
will be wrong eventually — a path change, a source whose ids are not addressable
at all — and Admin will not know. The scraper holds the real URL at ingest:
the adapter fetched the page.

**The ask:** when the resolver opens a reference item, record the sighting's
source URL on it. A nullable `sighting_url text` on `review_items` would do, or
the same column on whatever row the 4b step already writes. Then Admin reads
one column and deletes its template table, and a source nobody verified still
gets a working link.

Not urgent — what is there now works for `ticketmaster`, which is every
reference item in production today. It becomes urgent the first time a second
source opens one.

## Also worth knowing

There is no stored link between a reference item and the EVENT its sighting
appeared on. For "which Yeonjun is this" the performer page is enough. For a
harder call — two acts of the same name, one of which plays that venue — the
bill would settle it, and nothing on the item can reach it. Mentioning it as a
known edge, not asking for it.

## Second ask — CORRECTED, and downgraded

*An earlier version of this section asked you to record which EVENTS the folds
were, on the grounds that an operator cannot open the bills. That was built on
a wrong model of what the item asks. Read the correction before acting on it —
the ask survives, much smaller.*

### What the item actually asks

Not "is Yeonjun the right artist for this event". The scraper says so in its
own words, and I should have read it before filing anything:

> THE SUBJECT IS THE REFERENCE (contracts/entity-linking.md): `source_id` and
> `external_ref` are the two halves the review item opens under, and they are
> two of the three columns the store is keyed by — so the answer, when it
> comes, is one lookup away from the item's own subject and no column records
> it.
> — `resolver/ledger.py`, `AnUnsettledReference`

> A reference nothing has SETTLED … opens ONE entity-link item with the subject
> `(entity_link, source_id, external_ref)`, and a second open for that subject
> is an insert the widened index refuses, **which is the fold**. They are per
> REFERENCE and not per fact.
> — `resolver/cycle.py`

So the question is: **which catalog row is Ticketmaster's performer
`K8vZ917-Rw0`?** One question about one identity. The 88 folds are 88 times the
pipeline met that same reference and still had no answer for it — not 88
separate questions.

And the answer is **durable and global for that reference**: it lands in
`confirmed_matches` under `(source_id, 'idols', 'K8vZ917-Rw0')`, the resolver
links it on its next cycle, and every one of the 88 events resolves along with
every future bill that names the same attraction. One decision, 88 events, and
the item settles itself.

### What that means for the asks above

- **The source URL ask stands, and is stronger than I argued.** The attraction
  page IS the subject of the question — not context around it. An operator
  deciding "which catalog row is this Ticketmaster performer" is looking at
  exactly the right page.
- **The "record which events" ask is DOWNGRADED to a nice-to-have.** The events
  are not what is being asked about and are not needed to answer. They are
  tie-breaking context for a genuinely ambiguous call — two same-named acts
  where the venue or the co-headliners would settle it. Worth having
  eventually; not worth a schema change now, and I was wrong to put it beside
  the URL ask as though it were the same change.

### The one thing in this section that still deserves your attention

88 unanswered sightings of one reference, 2026-10-15 to 2026-10-23, still
arriving. Whatever the escalation thresholds are, a reference re-asked 88 times
is not being escalated by them — and because the answer is one row with 88
events behind it, this is the highest-leverage unanswered question in the
queue. That is a resolver question, not an Admin one.

## Third thing — "none of these rows" has no answer

Ben's own account of the three responses he expects:

> select one of those rows, select none of the rows, or select that it is not a
> KPOP act, and provide reasoning

The first and third are now buildable: `link_entity` with `{domain, ref}` and
`rule_not_kpop`, both with a note Admin requires. **The middle one is not.**

"None of these rows" means: it IS a k-pop act, and the catalog does not hold
it. Nothing in the nine actions says that. The nearest is `settle`, whose own
documented meaning is "leave it held; the claim keeps waiting in its bucket" —
a shrug, not an answer. And it writes no `confirmed_matches` row, so the store
has not settled the reference: as far as `resolver/cycle.py`'s self-settling
read is concerned the question is still unanswered, while the item now reads
`settled` and no longer reaches a human.

That is the worst of the three outcomes — the question disappears from the
queue without being answered — and it is reachable today by one click on an
item whose honest answer is "none of them".

**Two ways out, and the choice is yours:**

1. A tenth action — `needs_row`, or whatever you call it — that records "a
   k-pop act the catalog is missing" and keeps the reference unsettled so it
   stays visible, or settles it into a list of rows to create. This is the
   honest version of "add the row" with Admin still inserting nothing.
2. Or rule that `settle` is correct here and make the resolver treat a settled
   reference item with no store row as a standing request for a row.

Until one of them exists, Admin will not offer `settle` on a reference item at
all: an operator reaching for "none of them" and finding only a control that
quietly buries the question is worse served than one who finds nothing. That is
a decision I have made in the UI and you can overrule.


---

# CORRECTED PRIORITIES, 2026-10-23 (later)

*Ben pushed back on two things and was right on both. This section supersedes
the priorities above; the asks themselves are unchanged in substance but one
that I downgraded is now the most valuable of them. Read this before acting.*

## 1. Candidate pictures are half a comparison — capture the source's

Ben: *"It doesn't matter if we have pictures if the source does not have a
picture. How am I supposed to match a face if the thing we care about has no
face."*

Correct, and it was the flaw in what I built. Admin now shows a face for nine
of the Yeonjun item's ten candidates and there is nothing to compare them
against.

**But Ticketmaster DOES have a photo.** Fetched and checked on 2026-10-23, the
attraction page for `K8vZ917-Rw0` shows a portrait of the performer, plus a
genre ("Pop"). It shows **no** bio and **no** agency.

So the comparison Ben wants — *"a table with all options, including a picture
of the source, as well as of the options"* — is possible and is blocked only by
us not keeping the source's side.

**ASK: when the 4b step opens a reference item, record what the adapter saw
about the entry itself** — the image URL at minimum, the classification if it
is free. That plus the candidate pictures Admin already has is the table he
described.

This also kills a claim I made in the commit before it: I said `BigHit Music`
against nine unknown agencies made the call "checkable". It does not.
Ticketmaster shows no agency, so our agency column compares against nothing and
I had simply guessed a second time, as Ben said.

## 2. The events ARE the evidence — I downgraded this wrongly

Earlier in this file I downgraded "record which events the folds were" to a
nice-to-have, on the grounds that the events are not what the item asks about.
The first half of that is right and the conclusion was wrong.

The Ticketmaster page's lineups name **TXT on the same bills as this Yeonjun.**
That is the decisive evidence for the identification, and it is a fact about
the EVENTS, not about the performer. "This reference appears on bills that also
bill TOMORROW X TOGETHER" is derivable; "BigHit Music, so it must be TXT" is a
guess.

Reachable today? No. We hold `Kiss 108's Jingle Ball Presented By Capital One`
(2026-12-13, matching Ticketmaster exactly) and it carries **one** linked
performer — `Adéla` — with no `scraped_events` row matched to it. So the bill's
other acts are either unlinked references themselves or not kept at all.

**ASK, promoted to first priority: keep the sighting's event ids on the
reference item.** Then Admin can show, per candidate, the one thing that
actually decides it: who else is on those bills. Even unlinked, "this bill also
carries an unplaced reference named TOMORROW X TOGETHER" settles the question.

## 3. How a row gets created — the pipeline already has an answer

Ben: *"the admin would need to create a row. However, I don't know how to go
about doing that. The row create should integrate perfectly into the pipeline,
while providing an easy input UI for the admin to fill out."*

The pipeline's own answer, from `resolver/creation.py`'s header:

> CREATION IS A SIDE EFFECT OF THE FIRST APPLY (contracts/resolver.md section
> 9), so this module opens no second path into canonical… There is NO draft,
> stub or partial row before creation — **the ledger is the staging area.**

So the shape is already decided and it is a good one: **you do not create a
row, you make claims until the creation bar is met, and the resolver creates it
as a side effect.** Admin's "easy input UI" is therefore a form over the
required fields that writes ADMIN-TIER CLAIMS — and Admin still inserts
nothing, which keeps `AGENTS.md`'s rule and the provenance story intact.

**What is in the way, and it reconciles the disagreement in this file.** Your
scraper agent corrected my first handoff with "no domain registration is
needed", and that is right *for linking* — a `confirmed_matches` row needs no
schema. It is **not** right for creating. `resolver/ledger.py`'s
`_creation_of` requires a domain that registers creation `open` or `curated`,
the bar reads required columns off the registered target table, and
`registry/schemas/` holds **only** `events.schema.json` and
`venues.schema.json`. There is no schema for `groups` or `idols`.

So: **linking needs no registration; creating needs it.** Both were half right.

**The question only you can answer:** does `domain_target('idols')` resolve
today, and would you want `idols`/`groups` registered `open` (rows grow by
resolution, so an admin's claims create them) or `curated` (humans only, and
the resolver never creates)? `open` is what makes the form above work with no
new verdict action at all. That decision is ROADMAP item 9 and this is now its
first concrete consumer.

Until it is answered, Admin offers no "none of these rows" control, for the
reason given further up: a button that buries the question is worse than no
button.

---

## BUG to fix separately: two Yeonjuns from TXT in the catalog

Ben, 2026-10-23: *"There are 2 yeonjuns from TXT in our database. This is a
separate bug, and we shouldn't tackle it here, but maybe just leave a note that
we should fix this and try to prevent it from happening in the future."*

Noted here rather than fixed. Two observations to go with it:

- The Yeonjun review item's ten candidates include exactly ONE under
  `TOMORROW X TOGETHER` (`4d2af96c…`, `Choi Yeon-jun`, 1999). So the duplicate
  is NOT among the candidates the resolver ranked — which means the item's
  candidate list is not where it will be noticed, and an admin answering this
  item would link the one they were shown and never learn there is a second.
- This is the same class already recorded in `../MIGRATE_LATER.md` from the
  intake: *"dedupe the duplicate rows the intake found (two BLACKPINK Lisas,
  `Mamamoo`/`MAMAMOO`, Wonho as member + soloist, WJSN Dayoung ×2)"*. The
  `Lisa, Lisa` pair in the LISA reference item is the same thing surfacing as a
  decision. So this is not a new bug — it is the known catalog-dedupe debt
  showing up where an operator now has to act on it.

**Why prevention matters more than the fix here.** Every duplicate pair makes a
reference item unanswerable-in-principle: "which one is this" has two correct
answers and linking either is half right. The resolver's own creation path
already names the risk — `resolver/creation.py`: *"There is no similarity step:
the cascade is steps 1-3, exact after normalization, and near-duplicate
creation ('Ziggo Dome Club' beside 'Ziggo Dome') is a known, bounded risk whose
merge mechanics belong to contracts/entity-linking.md's TODO."* So duplicates
are expected by design today and the merge machinery is the TODO that fixes it.

A `merges` table already exists (`20260913000001_a_duplicate_folds_into_its_survivor.sql`),
so the mechanism is partly built. Worth checking whether it can be pointed at
`idols`/`groups` as part of registering those domains — the same change this
file already asks for.

## One architectural note, for the record

Ben: *"This UI probably only works for artists… so I guess the review item UI
needs to be adjustable depending on the review item."*

It already is, and that was the design from the start. Every per-shape decision
on the review item route is a `Record<Shape, …>` the compiler forces to be
total: `EVIDENCE_VIEW_BY_SHAPE`, `ACTIONS_BY_SHAPE`, `NOTICE_BY_SHAPE`,
`DIAL_BY_SHAPE`, `CLOSE_TITLE_BY_SHAPE`. Adding the reference shape on
2026-10-22 required an entry in all five and would not compile without them —
which is how the candidate table, the sighting block and the two new actions
reached only that shape and left the other three untouched.

So the artist-shaped UI is correctly scoped to the artist-shaped item. A venue
reference item shares the shape and will want a different table (a map, an
address, not a face), which is a per-DOMAIN branch inside the reference view
rather than a fifth shape.

---

## Two more scraper asks from the UI pass

### A. The summary should not carry the question

Ben, 2026-10-23: the item's own sentence reads

> `ticketmaster "Yeonjun": 11 catalog names match closely, none exactly - which one is this, or none of them`

and he wants it to stop at `none exactly`. The trailing clause is the question,
and the question is now the close's heading ("Please identify ticketmaster's
performer K8vZ917-Rw0") — so the item states it twice, once as prose and once
as the thing you act on.

**Not trimmed in Admin on purpose.** The summary is the resolver's own
sentence and Admin renders it verbatim (Voice bar 5); editing a machine value
on the way to the screen is the one thing that makes "what the database said"
untrustworthy. So this is a request, not a patch:
`resolver/summary.py`'s `THE_REFERENCE_READS` is
`'{source} "{name}": {candidates} - {question}'` and the ask is to drop
`- {question}` from the reference template. The question strings
(`THE_CATALOG_QUESTION_READS` and friends) stay for anything else that reads
them.

### B. The candidate COLUMNS should be the resolver's, not Admin's

Ben: *"this might be something that the scraper should structure when creating
the review item. It could be generalized to: for this type of review item,
which requires the reviewer to select from a list of options, here is the
candidate table with relevant columns. And these are the relevant columns for
an artist review item."*

That is the right shape and it is worth saying why. Admin currently derives
the columns — group, agency, full name, birthday — by knowing that `idols` is
what an artist candidate is and which of its columns matter. That is a
judgment about the DOMAIN living in the consumer, and it has two costs: a venue
reference item wants an address and a city and gets an artist's columns, and
the day the catalog grows a better disambiguator Admin has to learn about it
independently.

If the item instead carried its candidates as rows with named, ordered
columns — the resolver choosing what identifies this kind of subject — every
consumer renders the same table and none of them knows what an idol is.

Worth designing alongside the two asks above, since all three are "the item
should carry what the reviewer needs". Not urgent: what Admin derives today
works for artists and venues, which is every reference item that exists.
