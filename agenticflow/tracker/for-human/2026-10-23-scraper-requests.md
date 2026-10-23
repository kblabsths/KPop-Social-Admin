# Scraper requests from the Admin review-item work

*Written for Ben to share with whoever works `kspace Scraper`. Standalone: every
claim here was checked against the repo or against production, and the check is
named so you can repeat it. Nothing in the scraper repo has been touched from
Admin.*

**Context in one paragraph.** Admin's Queues page now models the REFERENCE
subject correctly — `(source_id, external_ref)`, the thing `20260911000002`
added — and an operator can answer "which catalog row is Ticketmaster's
performer `K8vZ917-Rw0`?" by picking from the resolver's ranked candidates. The
answer writes `confirmed_matches` through `settle_review_item`'s reference arm
(`20261021000002`, already live in production) and the resolver links it on its
next cycle. What follows is what the ITEM does not carry that the reviewer
needs, plus two blockers.

---

## 1. Drop the question from the reference summary — trivial

`resolver/summary.py`:

```python
THE_REFERENCE_READS = '{source} "{name}": {candidates} - {question}'
```

renders

> `ticketmaster "Yeonjun": 11 catalog names match closely, none exactly - which one is this, or none of them`

**Ask:** drop `- {question}` from the reference templates. Keep it in the
question constants for anything else that reads them.

**Why:** Admin now asks the question itself, as the heading of the control that
answers it ("Please identify ticketmaster's performer K8vZ917-Rw0"). The item
states it twice, once as prose and once as the thing you act on.

**Why Admin will not trim it instead:** the summary is the resolver's own
sentence and Admin renders machine values verbatim. Editing one on the way to
the screen is what makes "this is what the database said" stop being true.

---

## 2. Record where the sighting can be SEEN — high value, small

The reference `K8vZ917-Rw0` appears in **no table in production**. Checked:
`observations.external_ref` (0 rows), `confirmed_matches.external_ref` (0),
`scraped_events.source_event_id` (0), `event_sources.source_event_id` (column
not exposed).

Admin therefore CONSTRUCTS the URL from the id, with one verified template per
source (`ticketmaster -> /artist/<ref>`, checked live). That is a pattern this
app believes about someone else's website; it will be wrong eventually and
Admin will not know.

**Ask:** when 4b opens a reference item, record the sighting's source URL on
it. A nullable `sighting_url text` on `review_items` would do.

**Also record the entry's own attributes** if they are cheap at ingest — the
**image URL** above all. Ticketmaster's attraction page carries a portrait and
a genre (checked); Admin shows the CANDIDATES' faces but has nothing of the
source's to compare them against, which Ben rightly called useless on its own.
With both, the reviewer compares a face to a face.

---

## 3. Record which EVENTS the folds were — the real evidence

`folded_count` is a bare counter (88 on production's Yeonjun item, 11 on
staging's). No table records which events the sightings were, so no bill can be
opened.

**Why this is the most valuable item here.** The decisive evidence for "which
Yeonjun" is the LINEUP: Ticketmaster's page shows this one billed alongside TXT
on three iHeartRadio Jingle Ball dates. "Appears on bills that also bill
TOMORROW X TOGETHER" is derivable. Everything else Admin can offer — agency,
birth year — is recognition, and Ben caught me guessing twice from it.

Not reachable today: we hold `Kiss 108's Jingle Ball Presented By Capital One`
(2026-12-13, matching Ticketmaster exactly) and it carries ONE linked performer,
`Adéla`, with no `scraped_events` row matched to it.

**Ask:** keep the sighting's event ids on the reference item — a second array,
or a child row per sighting. Admin would then list the bills and, per
candidate, who else is on them.

**Caveat Ben raised, worth building for:** TXT could be on a bill alongside a
*different* Yeonjun. Korean given names are common. So the lineup narrows and
does not decide — which is why the reviewer's note is mandatory in Admin.

---

## 4. Let the ITEM say what its candidate columns are — generalisation

Admin currently derives the candidate table's columns (group, agency, full
name, birthday) by knowing that an artist candidate is an `idols` row and which
of its columns matter.

That is a judgment about the DOMAIN living in the consumer. Two costs: a VENUE
reference item wants an address and a city and currently borrows an artist's
columns; and the day the catalog grows a better disambiguator, Admin has to
learn about it independently.

**Ask (Ben's wording):** generalise to "for a review item that requires the
reviewer to select from a list of options, here is the candidate table with the
relevant columns" — the resolver choosing what identifies this kind of subject.
Then every consumer renders the same table and none of them knows what an idol
is.

Not urgent: what Admin derives works for artists and venues, which is every
reference item that exists.

---

## 5. BLOCKER: register `groups` and `idols` as domains

**What this blocks:** "none of these rows" — a k-pop act the catalog does not
hold. It is one of the three answers Ben expects and the only one Admin cannot
offer.

The pipeline already decides the shape, and it is a good one
(`resolver/creation.py`):

> CREATION IS A SIDE EFFECT OF THE FIRST APPLY … There is NO draft, stub or
> partial row before creation — **the ledger is the staging area.**

So Admin would not create a row. It would write admin-tier CLAIMS for the
required fields and the resolver would create the row on first apply — Admin
inserting nothing, `AGENTS.md`'s rule and the provenance story both intact.
That is exactly what Ben asked for ("integrate perfectly into the pipeline,
while providing an easy input UI").

**What stops it:** `settle_review_item` refuses a value-carrying verdict for a
domain with no compiled schema —

```
raise exception 'observation rejected: domain "%" has no registered schema'
  errcode = 'KS001'
  hint = 'register the domain in registry/domains/ and ship its registration migration'
```

— and `registry/schemas/` holds only `events.schema.json` and
`venues.schema.json`.

**Ask:** register `idols` and `groups`, with creation **`open`** rather than
`curated`. `open` means rows grow by resolution, so an admin's claims create
them and no new verdict action is needed. `curated` means the resolver never
creates and we need a different path entirely.

**A precision that matters, because it caused a disagreement:** registration is
NOT needed to LINK an existing row — a `confirmed_matches` row needs no schema,
which is why the picker works today. It IS needed to CREATE one. Both halves
are true of different paths.

Until this lands, Admin draws "Create a new artist" and answers "Not yet
implemented" when pressed, and offers no `settle` on a reference item at all —
`settle` writes no store row, so the reference stays unanswered while the item
leaves the queue, which buries the question.

---

## 6. Decide what "none of these rows" records

Follows from 5. Either:

- **a tenth action** (`needs_row`?) recording "a k-pop act the catalog is
  missing", keeping the reference unsettled so it stays visible — or settling
  it onto a list of rows to create; or
- **a resolver rule** that treats a settled reference item with no
  `confirmed_matches` row as a standing request for a row.

Admin will offer the control the moment either exists.

---

## 7. Duplicate catalog rows make some items unanswerable

On STAGING's Yeonjun item, two of the eleven candidates are the same person:

```
Yeonjun   TXT                   (no agency)     Choi Yeonjun
Yeonjun   TOMORROW X TOGETHER   BigHit Music    Choi Yeon-jun
```

The duplicate is at the **group** level — `TXT` and `TOMORROW X TOGETHER` are
two group rows — and `YOUNG POSSE` is duplicated the same way. Ben found this
by reading the candidate list.

This is the known debt (`../MIGRATE_LATER.md`: *"dedupe the duplicate rows the
intake found — two BLACKPINK Lisas, Mamamoo/MAMAMOO, Wonho as member +
soloist, WJSN Dayoung ×2"*), and the `Lisa, Lisa` pair in another reference
item is the same thing.

**Why it matters more now:** every duplicate pair makes a reference item
unanswerable in principle. "Which one is this" has two correct answers, and
linking either is half right — so the reviewer's decision is wrong whatever
they pick, through no fault of theirs.

`resolver/creation.py` names the cause:

> There is no similarity step: the cascade is steps 1-3, exact after
> normalization, and near-duplicate creation ("Ziggo Dome Club" beside "Ziggo
> Dome") is a known, bounded risk whose merge mechanics belong to
> contracts/entity-linking.md's TODO.

**Ask:** prevention matters more than the backfill. A `merges` table already
exists (`20260913000001`), so the mechanism is partly built — worth checking
whether it can point at `idols`/`groups` as part of item 5, since that is the
same change.

---

## 8. Two things to look at that are not Admin asks

- **88 unanswered sightings of one reference**, 2026-10-15 to 2026-10-23, still
  arriving. Whatever the escalation thresholds are, they are not catching the
  highest-leverage unanswered question in the queue — and because the answer is
  ONE row that resolves 88 events, it is the cheapest fix available.
- **Mixed-genre ingestion.** The one linked performer on that Jingle Ball bill
  is `Adéla`, who is not a k-pop act, and Jingle Ball is not a k-pop event.
  Ben's own note. If a large share of the 125 reference items are Charlie Puth
  and the Jonas Brothers, the queue's volume is a source-SCOPING question
  rather than an identification one — worth measuring before anyone optimises
  the review flow for it.
