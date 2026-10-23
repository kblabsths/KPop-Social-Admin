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
