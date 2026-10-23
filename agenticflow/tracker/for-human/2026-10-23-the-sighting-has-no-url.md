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
