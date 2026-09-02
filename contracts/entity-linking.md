# Entity Linking — Design

- Status: **STUB** — created 2026-08-27 from the adapters design; parent-fixed
  decisions recorded; the Design section (confirmed-match store, normalization,
  identity keys — cascade steps 1–3) approved 2026-08-28; step 4 and the rest
  not yet designed (TODO at bottom).
- Purpose: how a claim finds its canonical row — the shared matcher that runs as
  resolution's first step, the confirmed-match store, and the dedup probe that
  decides whether an `open`-domain sighting is a new entity. ROADMAP pending
  child design, needed by queue items 2–3.
- Parent: [adapters.md §4](adapters.md#4-references-and-linking) (the link stage) and
  [resolver.md](resolver.md) (resolution side).
- Depends on — concepts owned elsewhere:
  - **observation / claim identity / `entity_id` / merge** — `entity_id` is
    written NULL → id by linking; a merge is the one rewrite ([data-model.md](data-model.md))
  - **reference fields** — `venue` and `performers` claims whose value is a
    source reference or a catalog id ([adapters.md](adapters.md))
  - **link stage / `external_ref` per record** — the framework step that calls
    this matcher for every record before the gate ([adapters.md](adapters.md))
  - **creation policy** — `open` rows are created at resolution on first sight;
    `curated` rows only by humans ([data-model.md](data-model.md))
  - **canonical `venues` uniqueness and the `(venue_id, starts_at)` probe**
    ([events-canonical-storage.md](events-canonical-storage.md))
  - **review queues / entity-link queue** ([admin-observability.md](admin-observability.md))
  - **earned autonomy** ([ai-learning.md](ai-learning.md))

## Parent-fixed decisions

- **Adapters never link.** The matcher is a library run at two times: by the
  framework's link stage (every record and reference, before the gate) and again
  by the resolver on any claim still unlinked when it processes it — always
  immediately before creating an `open`-domain row, so concurrent first sightings
  of one entity converge on one row.
- **Three answers** — a canonical id; *nothing known* (claim lands with
  `entity_id` null; resolution creates or waits); *escalate* (claim lands
  unlinked; an entity-link queue item carries the candidate).
- **The cascade, in order** — (1) the confirmed-match store `(source,
  external_ref)` → `entity_id`, written on any later step's link or a human
  verdict; (2) an external identifier both sides hold; (3) the domain's identity
  key exact after normalization; (4) the domain's similarity rule with a threshold
  — auto-link above, escalate below. Steps 1–3 run from day one; step 4 and its
  thresholds are this design's.
- **The matcher receives the whole record** — every descriptive claim the source
  supplied, so a richer source matches better without adapter work.
- **Unlinked claims hold and retry every cycle** — one confirmation can unlock a
  backlog.
- **A reference resolves through the same source's own claims** — an event's
  `venue` reference `(source, venues, external_ref)` links to the `entity_id` the
  venue's own claims received; a `performers` entry with `ref` + `name` links by
  the catalog rules above, else waits.
- **Dedup facts already measured** (intake, 2026-08-26): the same event re-sighted
  under a different listing id needs a performer-set + venue + ±12 h window
  (exact-time keys admit package variants; consecutive-night stands must stay
  distinct); the same physical venue arrives under name variants ("Ziggo Dome
  Club" / "Ziggo Dome") sharing an address; catalog name collisions are mostly
  duplicate catalog rows, not true homonyms.

## Design — what the adapters build carries (steps 1–3)

### The confirmed-match store

- **`confirmed_matches`** — one row per `(source_id, domain, external_ref)`,
  the source's own reference for an entity, resolved:

| column | type | constraints / default |
| --- | --- | --- |
| `source_id` | uuid | not null, FK → `sources(source_id)` |
| `domain` | text | not null |
| `external_ref` | text | not null — stored as the gate stores it (non-empty, byte for byte) |
| `entity_id` | uuid | not null — the canonical row |
| `matched_by` | text | not null, CHECK (`external_id`, `identity_key`, `similarity`, `verdict`) — the cascade step that wrote the row |
| `immutable_hash` | text | nullable — hash of the record's `immutable`-field values as this source last emitted them; equal hash on a later sighting drops those claims ([adapters.md §4](adapters.md#4-references-and-linking)) |
| `confirmed_at` | timestamptz | not null, `default now()` |
| `last_seen_at` | timestamptz | not null, `default now()` — bumped on every hit |

- Primary key `(source_id, domain, external_ref)`; index `(entity_id)` for
  merges.
- **Written** by the link stage on any step-2/3/4 link and by a human verdict on
  an entity-link queue item; **rewritten** only by a merge (re-pointing
  `entity_id` to the surviving row); **deleted** only when a verdict releases a
  wrong match. Service-role write through the framework and the verdict path;
  public read of nothing — the table is internal.
- **Read** by the link stage as step 1; a hit ends the cascade.

### Normalization for matching

- Text keys compare after NFKC, case-folding, whitespace collapsed to one space,
  outer whitespace trimmed. Nothing else is stripped; punctuation differences
  are step 4's business.

### Identity keys and external identifiers, per domain

| domain | step 2 — external identifiers | step 3 — identity key |
| --- | --- | --- |
| `groups`, `idols` | `spotify_id` (catalog column) against the reference's `ids.spotify`; further schemes as catalog columns are added | normalized name or alias matching **exactly one** row across `groups` ∪ `idols`; a name matching more than one row, or a group and an idol, is not linked |
| `venues` | none today | normalized `(name, city)` — the canonical unique index's key; `city` null matches only null |
| `events` | none | the storage design's probe: same `venue_id`, at least one shared linked performer, `starts_at` within ±12 h when both sightings carry a clock time; when either sighting carries `time_precision = date`, the probe matches on the same calendar date in the venue's timezone instead of the ±12 h window — the re-sighting rule; a listing collapsed in-run never reaches here as a second record |

- **A step-3 miss is *nothing known*** until step 4 exists; the claim lands
  unlinked and resolution creates or waits. Concurrent first sightings converge
  through the resolver's re-attempt before creation.

## TODO — completing this document

- [ ] Matcher strategy per domain: catalog (name, alias, external-id tables —
      populating `spotify_id` turns the homonym case into a key lookup), venues
      (alias + address/geo match under the name+city unique index), events (the
      ±12 h performer/venue probe as the re-sighting rule)
- [ ] The confirmed-match store: table shape, who writes it (human verdict,
      earned-autonomy verdict), how emission-time linking reads it
- [ ] Confidence thresholds and the escalation shape of an entity-link queue item
- [ ] Merge mechanics for `open`-domain duplicates (re-pointing observations,
      recording the merge, `event_attendees` survival)
- [ ] Alias schema for `venues.aliases` and a catalog alias table
- [ ] Format check against DESIGN_STYLE.md, then review with Ben
