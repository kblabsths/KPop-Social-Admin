# 2026-10-16 — external scraper-side work done: index inventory + registry-owned current version

*From an engineer outside the factory, working the two for-human tickets
`tracker/for-human/external-ticket-index-inventory.md` and
`tracker/for-human/external-ticket-domain-current-version.md`. Nothing is committed
anywhere; nothing was `git add`ed; the database was only ever read. Ben's steps are
marked **BEN**.*

## 1. What was created in `kspace Scraper` (full paths)

New files (all untracked, left for Ben to commit):

- `/Users/ben-m4/Desktop/Coding/KPOP/kspace Scraper/docs/INDEXES.md` — the inventory: 181
  indexes over all 57 `public` tables, 7 views listed with the tables they read through,
  a provenance line, a Notes block, and an "Observations, not changes" section.
- `/Users/ben-m4/Desktop/Coding/KPOP/kspace Scraper/tools/index_inventory.py` — the
  generator (reads `pg_index`/`pg_class`/`pg_am`/`pg_constraint` read-only through
  `door.clients.read_connection()`; preserves the hand-written `serves` and `guarded by`
  cells by index name and the Notes/Observations sections by heading; `--names DOC` is
  the offline reader the tests use).
- `/Users/ben-m4/Desktop/Coding/KPOP/kspace Scraper/tests/live_safety/test_every_index_is_in_the_inventory.py`
  — offline witness (migrations replayed as text vs the doc, both directions, name-level,
  with the two negative controls).
- `/Users/ben-m4/Desktop/Coding/KPOP/kspace Scraper/tests/acceptance/test_the_index_inventory_matches_staging.py`
  — `live`-marked companion (whole catalog vs the doc, read-only). Not run by me (see §7).
- `/Users/ben-m4/Desktop/Coding/KPOP/kspace Scraper/supabase/migrations/20261016000001_the_registry_states_the_current_version.sql`
  — ticket 2's migration (NOT applied anywhere).
- `/Users/ben-m4/Desktop/Coding/KPOP/kspace Scraper/tests/live_safety/test_the_registry_states_the_current_version.py`
  — offline witness for the migration (arms = registry YAML = latest `domain_schema`;
  re-issued body == original body with exactly the two edits; no `generate_series`, no
  `c_version_top`; KS001 arm intact; grants; reload; no new KS code).
- `/Users/ben-m4/Desktop/Coding/KPOP/kspace Scraper/tests/acceptance/test_the_registry_states_the_current_version.py`
  — `live`-marked companion: the three version cases, the installed body searches
  nothing, `{}` → KS029, unknown domain → KS001, all inside a read-only transaction.
  Red by construction until the migration is applied (42883); not run by me (§7).

One existing file modified (**the only tracked-file change**):

- `/Users/ben-m4/Desktop/Coding/KPOP/kspace Scraper/tests/acceptance/test_refusal_shape.py`
  — +15 lines, nothing removed: the two new `tests/acceptance/` files pinned with EMPTY
  tables in both `PINNED` and `PINNED_AT_THE_DOOR`. That witness refuses any file under
  `tests/acceptance/` it does not know (it reddened the full suite with exactly 3
  failures until the pin went in), so this is the house's own required companion edit.

## 2. Scraper `git status`, before and after

Before (first thing I ran; branch `main`, up to date with `origin/main`, DIRTY — so per
the rule I did not branch, stash, checkout or commit):

```
 M agenticflow/tracker/gate_fires.tsv
?? .railway-config-pull-42420/
```

After (same branch; the two pre-existing entries untouched):

```
 M agenticflow/tracker/gate_fires.tsv
 M tests/acceptance/test_refusal_shape.py
?? .railway-config-pull-42420/
?? docs/INDEXES.md
?? supabase/migrations/20261016000001_the_registry_states_the_current_version.sql
?? tests/acceptance/test_the_index_inventory_matches_staging.py
?? tests/acceptance/test_the_registry_states_the_current_version.py
?? tests/live_safety/test_every_index_is_in_the_inventory.py
?? tests/live_safety/test_the_registry_states_the_current_version.py
?? tools/index_inventory.py
```

## 3. BEN — applying ticket 2's migration (staging first; production is yours alone)

The scraper checkout's `supabase/.temp` is linked to **production**
(`nexuvegwukhyhrktxhha`). Do not run a bare `supabase db push`. Also do not push with
`--db-url` at staging: staging's `supabase_migrations.schema_migrations` (read 2026-10-16)
does not record `20260908000001`, `20260908000002` (both installed by hand; `verdicts`
exists and the installed `settle_review_item` body is byte-identical to the file) or
`20261014000001` (NOT installed there — its policy is absent from `pg_policies`), and it
records `20261015000001`–`20261015000005` that `main` has no files for, so a push would
try to replay the first two (the `create table public.verdicts` would fail), apply
`20261014000001` as a side effect, and complain about the five remote-only versions.

Apply the one file by hand, the way you applied `20260908000001/2`:

- **Route A (your practice):** paste the whole of
  `supabase/migrations/20261016000001_the_registry_states_the_current_version.sql` into
  the **staging** SQL editor (`ubfjjqlvnpnoborczbdb`) and run it. It is one transaction's
  worth of DDL: two `create or replace function`, their owner/comment lines, the
  revoke/grant pairs, `notify pgrst`.
- **Route B (CLI, if you have `psql`; it is not installed on this machine):** from the
  scraper repo root, with the staging URL loaded by name and never printed —

  ```sh
  ( set -a && source "/Users/ben-m4/Desktop/Coding/KPOP/kspace Admin/.env" && set +a && \
    cd "/Users/ben-m4/Desktop/Coding/KPOP/kspace Scraper" && \
    psql "$STAGING_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 --single-transaction \
      -f supabase/migrations/20261016000001_the_registry_states_the_current_version.sql )
  ```

  (`supabase db query --db-url … -f` cannot carry this file: that channel refuses more
  than one statement per prepared statement, BUG-0071.)
- Whether to record the version in staging's `schema_migrations` afterwards
  (`supabase migration repair --status applied 20261016000001 --db-url "$STAGING_SUPABASE_DB_URL"`)
  is your call; your two September hand-applies are unrecorded, `20260910000001` is
  recorded. Either way the inventory's header reports what it finds.

Verify read-only afterwards (the ticket's three checks), e.g. in the SQL editor:

```sql
select public.domain_current_version('events');   -- 3
select public.domain_current_version('venues');   -- 2
select public.domain_current_version('nope');     -- null
select position('generate_series' in pg_get_functiondef('public.settle_review_item(jsonb)'::regprocedure)); -- 0
select * from public.settle_review_item('{}'::jsonb);                                              -- KS029
select * from public.settle_review_item('{"action":"override","actor":"ben","value":{"domain":"nope","entity_id":"00000000-0000-4000-8000-000000000001","field":"title","value":"x"}}'::jsonb); -- KS001
```

The last two raise before any write (envelope check / version check both precede the
gate), so nothing is settled and no verdict row is written. Or run the live receipt,
which does the same inside a read-only transaction:
`.venv/bin/python -m pytest -q -m live tests/acceptance/test_the_registry_states_the_current_version.py`
(note: anything `live` under `tests/acceptance/` takes the regime's harness lease, a row
in `harness_run_leases`, which is why I did not run it).

Production: your call alone; the file is forward-only and the same paste applies.

## 4. The DECISIONS line — for BEN to add (not written by me)

The Admin checkout was on `main` at my first check and on `external/prune-offline` at
every later check (never `run/admin-window`), so by the rule I did not touch
`agenticflow/docs/DECISIONS.md`. The entry, in that file's heading style:

```
## 2026-10-16 — registry-owned current version replaces the search (scraper migration, external ticket)

`public.settle_review_item` no longer probes `domain_schema` over `generate_series(1, 64)`
for a domain's current schema version; the registry states it through
`public.domain_current_version(p_domain text) returns integer` (immutable, security
invoker; events 3, venues 2, NULL for an unknown domain) and the function assigns
`v_version := public.domain_current_version(v_domain);`. The KS001 unknown-domain arm is
unchanged and no new KS code exists. Scraper migration
`supabase/migrations/20261016000001_the_registry_states_the_current_version.sql`
(ticket `tracker/for-human/external-ticket-domain-current-version.md`); applied to staging
by Ben on <date>, production <date or pending>. Nothing in Admin product code moves —
the envelope never carried a version (ARCHITECTURE §9.2) — and
`tests/offline/handoff/settle-review-item.test.ts` grades the M2 handoff note's fenced
SQL, which is a dated record and stays as pasted.
```

## 5. The re-issue, shown: the body diff is two hunks

`settle_review_item`'s body in the new file vs `20260908000002` (unified diff, context 2):

```
@@ -42,13 +42,4 @@
   -- The three payload slots of a VerdictValue; exactly one is filled.
   c_slots          constant text[] := array['observation_id', 'value', 'ref'];
-
-  -- How far up this function will ask the registry about a domain before it
-  -- concludes the domain has no schema. domain_schema is a branch over the
-  -- versions the registry has compiled into SQL and answers NULL for every
-  -- other one, so the domain's current version is the highest it answers for -
-  -- events is at 3 and venues at 2 today (20260829000004), and this is a
-  -- SEARCH BOUND rather than a version this file believes in. If a domain ever
-  -- passes 64 registered versions, this constant moves; nothing else does.
-  c_version_top    constant integer := 64;
 
   -- A reference is the chosen row's own id, so it is read as one before it is
@@ -432,11 +423,9 @@
 
     -- THE DOMAIN'S CURRENT SCHEMA VERSION, resolved here and never sent. The
-    -- gate validates against domain_schema(domain, version) and answers NULL
-    -- for a version the registry has not compiled, so the current one is the
-    -- highest it answers for.
-    select max(candidate.version)
-      into v_version
-      from generate_series(1, c_version_top) as candidate(version)
-     where public.domain_schema(v_domain, candidate.version) is not null;
+    -- registry states it: domain_current_version (20261016000001, section 1)
+    -- is registry knowledge compiled into SQL exactly as domain_schema is, and
+    -- answers NULL for a domain the registry does not know, which the arm
+    -- below refuses as KS001.
+    v_version := public.domain_current_version(v_domain);
 
     if v_version is null then
```

Hunk 1 is the `c_version_top` constant the ticket says to delete (nothing else read
it) with its own comment; hunk 2 is the search → the one assignment, with the four
comment lines above it rewritten because the old ones described the search. The
KS001 arm that follows is untouched. The body was not retyped: a scratch script
applied those two string replacements to the original file (refusing unless each span
occurred exactly once), and the offline witness rebuilds the body the same way and
asserts equality. Staging's INSTALLED body (`pg_get_functiondef`) was compared read-only
to the original file's body: byte-identical, so "verbatim from the installed body"
holds. `domain_current_version`'s arms are pinned, offline, to both the registry YAML
versions (events 3, venues 2) and the max arm of the latest `domain_schema` body; a
future bump that moves one spelling and not the other is red before any apply.

## 6. Ticket 1 — what the inventory says, and the facts under it

- Generated from **staging** on 2026-10-16: 181 indexes (78 constraint-backed, 103
  plain), 57 tables, 7 views; `select count(*) from pg_indexes where schemaname='public'`
  = 181 the same day. The document's 181 (table, index) rows were compared read-only
  to the catalog through the door after the final write: nothing on staging missing
  from the doc, nothing in the doc missing from staging.
- **The premise in the brief needs one correction:** staging ALSO carries
  `20261015000001`–`20261015000005` (recorded in its `schema_migrations`; the
  `profile_page_lineup/answers/songs/stickers/photos` tables stand there). So the
  inventory already includes the fan-page indexes; what it says in its header and Notes
  is that this CHECKOUT has no file for those five (they are on
  `origin/feat/page-look-kit`), that production was not read, and that
  `20261014000001` is not on staging. Their "defined in" cells were resolved by reading
  the branch files with `git show origin/feat/page-look-kit:<path>` into a scratch
  directory (no checkout, no stash) and passing each to the generator as
  `--extra-sql "<file name> (feat/page-look-kit, unmerged)=<scratch path>"`; once the
  branch is merged a plain regeneration resolves them.
- Every "defined in" cell is resolved: migrations, `tools/staging/harness_objects.sql`
  (`harness_run_leases`, `synthetic_fixture_slices`) and the Admin TASK-0034 paste
  (`walk_sandbox`).
- Every one of the 181 `serves` cells is written (from the index definition, the
  migration comment beside each `create index`, the catalog's own `comment on index`
  texts, and the three contracts, which the doc links rather than restates). `guarded by`
  names t17 for the two observations hot-path indexes and the linking name-pool receipt
  for the three `*_aliases_gin_idx`; everything else is `—`.
- Regeneration proved: running the generator again over the hand-filled document
  produced a byte-identical file (empty diff; "181 hand-written rows carried over").
- Regenerate command (repo root; the URL by name only):
  `( set -a && source "/Users/ben-m4/Desktop/Coding/KPOP/kspace Admin/.env" && set +a && cd "/Users/ben-m4/Desktop/Coding/KPOP/kspace Scraper" && .venv/bin/python -m tools.index_inventory )`
  — the door also reads `STAGING_SUPABASE_DB_URL` from the scraper's own `staging.env`
  if that is where you keep it. Interpretation: "schema order" is table-name order
  (deterministic across projects and regenerations).
- **Observations filed for you (no change made):** twelve single-column btrees on
  kspace app tables are leading prefixes of a wider btree on the same table (listed by
  name in the doc); three btrees duplicate a unique constraint's index on the same
  column (`idx_groups_name`, `idx_invite_links_code`, `idx_profiles_username`);
  `idx_scraped_events_run` indexes a column whose FK was dropped in 20260825000009 on
  the read-only archive; no missing index was found for any read the contracts name.

## 7. Test and gate results, verbatim

- `npm run typecheck` in the scraper repo: `npm error Missing script: "typecheck"` —
  the repo is Python now (`package.json` holds only Railway's IaC SDK; no scripts block),
  so I ran its actual three bars instead.
- `.venv/bin/ruff check` (repo root): `All checks passed!` exit 0.
- `.venv/bin/mypy --strict` (repo root): `Success: no issues found in 406 source files`.
- `.venv/bin/python -m pytest -q -m "not live"` (full offline suite, after the pin edit):
  `6053 passed, 5 skipped, 1361 deselected, 6 xfailed, 2 warnings in 432.71s (0:07:12)`
  (the run before the pin edit was `3 failed, 6050 passed …`, the three being
  `test_refusal_shape.py`'s "file on disk and not pinned" cases for my two acceptance
  files).
- The two new offline witnesses alone: `24 passed in 1.02s` — including the ticket's
  "would fail on a deleted row" proof (`test_a_deleted_row_is_reported_by_name` deletes
  one standing index's row from a COPY and the comparison names exactly it) and the
  reverse control (a planted row for an index the snapshot created and later dropped
  with its table is reported by name).
- `tools/index_inventory.py` explicitly: mypy strict clean; ruff clean under the project
  rules except `TID251` on `pathlib` and `door` — that is the `adapters/` ban list
  leaking into an explicit-file run (`tools/` is outside the root lint walk by design,
  and only the eight product roots are exempted from the ban); not a finding.
- Not run: the two `live` files (see §1). Reason: anything `live` under
  `tests/acceptance/` takes the regime's shared harness lease, which is a row written to
  `harness_run_leases` on staging, and my brief was read-only — and ticket 2's three
  version cases cannot pass before the apply anyway. Their read-only equivalents were
  run through the door from a scratch script: doc rows == catalog rows (181 = 181), and
  for ticket 2 the pre-apply facts above (no `domain_current_version` yet; installed body
  == file body; `domain_schema` answers events at 3 not 4, venues at 2 not 3).

## 8. What I could not do, and deviations

- DECISIONS line not written (branch rule, §4). Nothing committed in either repo.
- No `supabase` command of any kind was run; no `db push`, `db reset`, `migration up`,
  `migration repair`, no link change. The migration file exists and is unapplied.
- No credential value was printed; the staging URL was only ever sourced into a
  `( … )` subshell and read by the door by name; every scratch invocation's output was
  piped through a redactor for the `postgres://` shape as belt-and-braces (nothing ever
  matched).
- Scratch files (the branch extracts, the JSON catalog dump, the diff, the suite logs)
  live only in this session's scratchpad directory, outside both repos.
- One tracked file edited (`tests/acceptance/test_refusal_shape.py`, +15), explained in
  §1; if you would rather not carry that, the alternative is moving the two live files
  out of `tests/acceptance/`, which evades the witness and is worse.
