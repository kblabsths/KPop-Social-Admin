# External ticket — one index inventory for the whole schema (scraper repo)

*For an agent working outside the factory, in the `kspace Scraper` repo (the
schema owner). Written by the admin-window dispatcher on 2026-09-15 from Ben's
ask of the same day: "I do want one inventory."*

## The ask

One document that lists every index in the `public` schema, per table, with what
it is for — so nobody has to grep 125 `create index` statements across the
migrations or read one contract per table to answer "is this read indexed?".

## Where the truth lives today (read-only facts, verified 2026-09-15)

- Repo: `/Users/ben-m4/Desktop/Coding/KPOP/kspace Scraper` — the ONLY repo that
  owns or pushes schema. Indexes are defined in `supabase/migrations/*.sql`
  (125 `create [unique] index` statements as of 2026-09-15) and nowhere else.
- Per-table prose exists only for the catalog tables, in
  `contracts/events-canonical-storage.md` ("Indexes: …" lines under each
  table). The pipeline's internal tables (`observations`, `field_provenance`,
  `review_items`, `resolution_runs`, `verdicts`, `confirmed_matches`,
  `sources`, `runs`, `walk_sandbox`, …) have no prose at all.
- A hot-path acceptance test already exists:
  `tests/acceptance/test_t17_hot_path_indexes.py` (it measures that the hot
  reads reach the index that exists for them). Read it: the inventory should
  name which indexes it guards, so the doc and the test agree.
- The installed truth can be introspected read-only from staging
  (`pg_indexes` / `pg_class` / `pg_index`), which is how this repo's own
  CLAUDE.md says to verify policies — never from migration SQL alone.

## What to build

1. **`docs/INDEXES.md`** in the scraper repo. One section per table (every
   table in `public`, catalog and internal alike), in schema order, each a
   table with columns:
   `index name · columns (with order/opclass) · kind (btree / GIN / trgm GIN /
   unique / partial + predicate) · defined in (migration file) · serves
   (the read or constraint it exists for, one clause) · guarded by
   (t17 case name, or "—")`.
   Views listed with "no indexes; reads through <table>'s".
2. **Provenance line at the top:** generated from which source, on which date,
   against which project ref (staging), and the count of indexes — so a reader
   knows how stale it is.
3. **A generator, not hand-typing:** a small script (Python, matching the repo's
   test tooling; `tests/helpers/` shows the house style) that reads `pg_indexes`
   for the `public` schema read-only and emits the per-table skeleton; the
   "serves" and "guarded by" columns are the one hand-written part and are
   preserved across regenerations (read the existing doc, keep those cells by
   index name). Put it under `tools/` beside the other staging tools.
4. **A test that keeps it true:** one pytest that fails if an index exists in the
   migrations (or on staging, if the suite has staging access — follow how t17
   gets it) and is absent from the doc, or vice versa. Name-level, not prose.
5. **The three catalog contract docs stay authoritative for their tables**; the
   inventory links to them rather than restating rationale. Do not edit the
   contracts.

## Rules

- Read-only against staging (`ubfjjqlvnpnoborczbdb`); never production; never
  print a credential (source the repo's env the way its tests do).
- No migration, no schema change: this ticket adds a document, a generator and
  a test. If the inventory reveals a missing or redundant index, file that as a
  finding at the bottom of the doc ("Observations, not changes") — Ben decides.
- Follow the scraper repo's own conventions (its CLAUDE.md, `npm run typecheck`
  for TS, the Python suite's layout for tests).

## Done when

- `docs/INDEXES.md` exists, covers every `public` table, and its count matches
  `pg_indexes` on staging on the date stamped.
- The generator regenerates it without losing the hand-written cells.
- The new test passes, and would fail on a deleted row (show that once).
- The repo's own suite is still green.
