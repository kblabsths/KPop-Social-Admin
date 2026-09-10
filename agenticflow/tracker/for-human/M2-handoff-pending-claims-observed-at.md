# ASK BEN: carry `observed_at` through `public.pending_claims` (scraper repo, one migration)

*Authored 2026-09-10 by campaign `admin-window` (architect, on BUG-0138), against
the migrations installed in `kspace Scraper` as of that date. **Nothing in the
Admin repo applies this** — no agent runs it, no Admin ticket touches the scraper
repo, and the scraper's working tree and git log are untouched by this campaign.
This file is the whole artifact: there is no `.sql` file in the Admin repo, by
design.*

You ruled **Answer A + A2** on BUG-0138 (2026-09-10). Answer A is this migration.
Until it is on **staging**, the Admin builder can build and prove the whole fix
offline but **cannot** prove the four live checks — and the ticket says those
checks must **refuse**, loudly, rather than fall back to the old two-step read.

## 0. The one correction to the ticket's text, and why this file differs from it

BUG-0138's Description says "re-issue `public.pending_claims` exactly as
migration `20260901000004` defines it". **Do not do that** — `20260901000004` is
no longer the installed definition. `20260903000001_the_creation_bar_is_read_once_and_the_incumbent_is_one_seek.sql`
(the one you licensed on 2026-09-03, off the last Admin handoff) re-issued the
view with the word **`materialized`** on the `required_column` CTE. Re-issuing
`20260901000004`'s body verbatim would silently drop that word and put the view
back to 8.1 s and `57014` at the statement timeout — the exact defect that
migration was written to fix, reverted by a migration whose stated subject is one
new column.

So **§2 below is derived line-for-line from `20260903000001`**, not from
`20260901000004`: `materialized` is present at line 120 of the view body, every
other line is byte-identical to what is installed, and the only differences are
the three `observed_at` places (each marked with a `HANDOFF 2026-09-10, place N
of 3` comment you can grep for and delete if you prefer a clean file).

## 1. Where it goes, and the command you run

| | |
| --- | --- |
| target repo | `/Users/ben-m4/Desktop/Coding/KPOP/kspace Scraper` — the only repo that owns migrations or pushes them (root `CLAUDE.md`) |
| target file | `supabase/migrations/20260910000001_a_pending_claim_carries_its_instant.sql` |
| create it by | pasting §2 below into that new file, verbatim |
| apply command | `supabase db push`, run **from the `kspace Scraper` repo root** |
| order | after `20260903000001` (whose `materialized` this file preserves) and independent of the two verdict handoffs `20260908000001/2` — it touches no function, no table and no queue |
| target environment | **STAGING first, and staging is all this factory needs.** Production is your call alone and is never a target for this campaign; no agent will ask for it and no criterion depends on it |
| companion edit | **none.** This file raises no `KSnnn`, defines no function, and adds nothing your `tests/helpers/ks_codes.py` admission rule can see |
| rollback | re-run `20260903000001`'s view block verbatim (it is `create or replace`), then `notify pgrst, 'reload schema';`. Dropping the view is **not** a rollback — the resolver reads it |

Paste-ready, from the scraper repo root:

```sh
# 1. create the file, paste section 2 into it
#    supabase/migrations/20260910000001_a_pending_claim_carries_its_instant.sql
# 2. apply it
supabase db push
```

Applying it twice is a no-op (`create or replace view`, `comment on column`).

## 2. The migration, verbatim

```sql
-- `pending_claims` classifies every live pending claim but carries no age, so
-- every reader that wants to know how long a claim has waited must fetch the
-- instant back out of `observations` by `observation_id` - a second, chunked
-- leg over the whole population, and the largest single cost of the Admin
-- dashboard's Claims page (BUG-0138: ~14 sequential round trips, 2.9-3.8s warm,
-- measured by Ben on the walk instance 2026-09-09). Worse, the column's absence
-- makes "the 50 longest-waiting claims" inexpressible from a client at all:
-- PostgREST exposes no relationship between this view and `observations`
-- (PGRST200 on all three embed shapes, measured read-only against staging
-- 2026-09-09), and it refuses aggregates on this deployment (PGRST123), so no
-- reader can order by wait time in the database and no reader can group.
--
-- This file adds the one column that fixes both, and does nothing else. It is
-- not a new view, not an RPC and not a json column: `observations.observed_at`
-- is an existing NOT NULL timestamptz on a table the view's first CTE already
-- selects from, carried through the three places it has to pass. No bucket
-- condition changes, no precedence changes, no row enters or leaves the view,
-- no grant moves, and nothing new is scanned or joined.
--
-- The view below is `20260903000001`'s body line-for-line but for the three
-- marked places, `materialized` on required_column included. That word is
-- load-bearing: it is what took this view from 8.1s and 57014 to ~300ms, and
-- re-issuing the older `20260901000004` body would silently revert it.
--
-- Requested by the `admin-window` Admin campaign (BUG-0138, Answer A),
-- 2026-09-10; applied by Ben.

create or replace view public.pending_claims with (security_invoker = true) as
with live_pending_claim as (
    -- The population section 7 classifies: the live `pending` claims. An
    -- `applied` claim is not one of them - it is the incumbent, and the
    -- incumbent is what the others are compared against below.
    select claim.observation_id,
           claim.domain,
           claim.entity_id,
           claim.field,
           claim.source_id,
           claim.value,
           claim.external_ref,
           -- HANDOFF 2026-09-10, place 1 of 3: the instant the source
           -- observed this claim. No new join and no new scan - this CTE
           -- already selects from public.observations as claim.
           claim.observed_at
      from public.observations as claim
     where claim.status = 'pending'
),
field_reference_target (domain, field, referenced_domain) as (
    -- WHICH DOMAINS A REFERENCE FIELD MAY RESOLVE INTO, mirrored here as a
    -- literal (resolver/BUG-0003). A reference resolves through the WHOLE key
    -- confirmed_matches is stored under - its primary key (source_id, domain,
    -- external_ref), 20260829000003 - which contracts/entity-linking.md and
    -- contracts/adapters.md both write out as (source, venues, external_ref).
    -- The referenced domain is registry knowledge and the database does not
    -- hold it: domain_target carries the target table, creation and
    -- publish_requires, domain_schema the value schema, while `kind: reference`
    -- and `references:` live only in registry/domains/<domain>.yaml. So it
    -- ships as code, for the reason domain_schema and domain_target ship as
    -- code (20260818000000). A field may reference MORE THAN ONE domain -
    -- `performers` is why `references:` is a list - and a match in any declared
    -- target resolves the entry. A (domain, field) with NO row here reads
    -- UNRESOLVED, never any-domain: the wrong answer is then a VISIBLE hold the
    -- next cycle re-examines, not a row silently dropped from the view. A live
    -- test reads this list back out of pg_get_viewdef and compares it against
    -- the registry, so a reference field added there without a row here reddens.
    values ('events'::text, 'venue'::text, 'venues'::text),
           ('events', 'performers', 'groups'),
           ('events', 'performers', 'idols')
),
reference_entry as (
    -- Every reference a claim's stored value carries, and whether this source
    -- has a confirmed match for it IN A DOMAIN THE CLAIM'S FIELD REFERENCES.
    -- `ref` is the one key a reference entry carries in every shape
    -- (contracts/adapters.md section 4), so the entries are read off the value
    -- itself; the referenced domain comes from the mapping above, because the
    -- database does not hold the registry's field settings. All three key
    -- columns are matched, so a match this source holds for the same
    -- external_ref in another domain leaves the entry unresolved. An
    -- object-shaped reference is one entry, an array-shaped one is its
    -- elements; a value with no `ref` at all produces no row here.
    select live_pending_claim.observation_id,
           entry.value ->> 'ref' as referenced_external_ref,
           exists (
               select 1
                 from field_reference_target as target
                 join public.confirmed_matches as confirmed
                   on confirmed.domain = target.referenced_domain
                where target.domain = live_pending_claim.domain
                  and target.field = live_pending_claim.field
                  and confirmed.source_id = live_pending_claim.source_id
                  and confirmed.external_ref = entry.value ->> 'ref'
           ) as resolved
      from live_pending_claim
      cross join lateral jsonb_array_elements(
               case
                   when jsonb_typeof(live_pending_claim.value) = 'array'
                       then live_pending_claim.value
                   else jsonb_build_array(live_pending_claim.value)
               end
           ) as entry
     where jsonb_typeof(entry.value) = 'object'
       and entry.value ? 'ref'
),
reference_claim as (
    -- WHICH CLAIMS APPLY AS LINKS, and whether their references have resolved WHOLE.
    -- The registry decides the first half (resolver/TASK-0015): a (domain, field)
    -- with a row in the mapping above is a reference claim whatever its value looks
    -- like, and one with no row is not a reference claim even when its value carries
    -- a `ref`. The second half is all-or-nothing over the entries above, byte for
    -- byte resolver/ledger.py's `reference_target`: a claim applies as ALL of its
    -- links, so a claim carrying no entry at all has resolved none and holds. The
    -- creation bar asks the other question of one bill - ANY entry, BUG-0004 - and
    -- reads `reference_entry` directly rather than through this.
    select claim.observation_id,
           exists (
               select 1
                 from reference_entry as entry
                where entry.observation_id = claim.observation_id
           )
           and not exists (
               select 1
                 from reference_entry as entry
                where entry.observation_id = claim.observation_id
                  and not entry.resolved
           ) as every_entry_resolved
      from live_pending_claim as claim
     where exists (
               select 1
                 from field_reference_target as target
                where target.domain = claim.domain
                  and target.field = claim.field
           )
),
uncreated_record as (
    -- A claim with no entity_id belongs to a record that has no canonical row
    -- yet (observations.entity_id is null until linking resolves one). Before
    -- linking, a claim identity is (source_id, domain, external_ref, field)
    -- (20260819000002), so the record is its first three. external_ref is
    -- grouped as not-distinct because the gate stores an empty one as null and
    -- a record cannot be grouped by a key that never equals itself.
    select distinct
           live_pending_claim.source_id,
           live_pending_claim.domain,
           live_pending_claim.external_ref
      from live_pending_claim
     where live_pending_claim.entity_id is null
),
required_column as materialized (
    -- The creation bar is the target table's NOT NULL columns (section 9), read
    -- off the catalog rather than listed here, so a column added by a later
    -- migration joins the bar without editing this view. A defaulted column is
    -- not a bar: the row can be created without a claim for it.
    select distinct
           uncreated.domain,
           attribute.attname::text as column_name,
           attribute.attnum as column_position
      from uncreated_record as uncreated
      cross join lateral public.domain_target(uncreated.domain) as registration
      join pg_catalog.pg_class as canonical
        on canonical.relname = registration.target_table
       and canonical.relnamespace = 'public'::regnamespace
      join pg_catalog.pg_attribute as attribute
        on attribute.attrelid = canonical.oid
     where attribute.attnum > 0
       and not attribute.attisdropped
       and attribute.attnotnull
       and not attribute.atthasdef
),
record_bar as (
    -- What each uncreated record still needs, named. A bare `awaiting_row` is a
    -- defect: the bucket exists so a stuck record says what it is stuck on. The
    -- three answers are section 9's own - a `curated` domain never grows a row
    -- by resolution at all, a missing NOT NULL column is named by its own name,
    -- and an events record additionally needs one linked performer
    -- (contracts/events-canonical-storage.md section 2's invariant, which is why
    -- that one names its domain). A record that needs nothing is one the next
    -- cycle creates, and its claims are in no bucket.
    select uncreated.source_id,
           uncreated.domain,
           uncreated.external_ref,
           coalesce(
               curated.requirement,
               missing_column.requirement,
               performers.requirement
           ) as unmet_requirement
      from uncreated_record as uncreated
      left join lateral (
          select 'curated domain'::text as requirement
            from public.domain_target(uncreated.domain) as registration
           where registration.creation = 'curated'
      ) as curated on true
      left join lateral (
          select required.column_name as requirement
            from required_column as required
           where required.domain = uncreated.domain
             and not exists (
                 select 1
                   from live_pending_claim as covering
                  where covering.source_id = uncreated.source_id
                    and covering.domain = uncreated.domain
                    and covering.external_ref is not distinct from uncreated.external_ref
                    and covering.field = required.column_name
             )
           order by required.column_position
           limit 1
      ) as missing_column on true
      left join lateral (
          select 'at least one linked performer'::text as requirement
           where uncreated.domain = 'events'
             and not exists (
                 select 1
                   from live_pending_claim as bill
                   join reference_entry as entry
                     on entry.observation_id = bill.observation_id
                  where bill.source_id = uncreated.source_id
                    and bill.domain = uncreated.domain
                    and bill.external_ref is not distinct from uncreated.external_ref
                    and bill.field = 'performers'
                    and entry.resolved
             )
      ) as performers on true
),
classified as (
    select claim.observation_id,
           claim.domain,
           claim.entity_id,
           claim.field,
           claim.source_id,
           -- HANDOFF 2026-09-10, place 2 of 3: carried through.
           claim.observed_at,
           record_bar.unmet_requirement,
           case
               when exists (
                   select 1
                     from public.review_items as item
                    where item.status = 'open'
                      and item.source_id is null
                      and item.domain is not distinct from claim.domain
                      and item.entity_id is not distinct from claim.entity_id
                      and item.field is not distinct from claim.field
               ) then 'escalated'::text
               when record_bar.unmet_requirement is not null then 'awaiting_row'::text
               when exists (
                   select 1
                     from reference_claim as reference
                    where reference.observation_id = claim.observation_id
                      and not reference.every_entry_resolved
               ) then 'awaiting_link'::text
               when incumbent.observation_id is not null
                    and claim.value <> incumbent.value then 'standing_disagreement'::text
               when incumbent.observation_id is not null
                    and claim.value = incumbent.value then 'agreeing'::text
               -- Every window is zero-length by rule, so the condition that
               -- would put a claim in one is false for every claim.
               when false then 'in_window'::text
           end as bucket
      from live_pending_claim as claim
      left join record_bar
        on record_bar.source_id = claim.source_id
       and record_bar.domain = claim.domain
       and record_bar.external_ref is not distinct from claim.external_ref
       and claim.entity_id is null
      left join lateral (
          -- The incumbent, byte for byte as resolver/weighing.py reads it: the
          -- fact's CURRENT provenance row first - latest is what current means
          -- for an append-only log, not a recency rule about claims - and then
          -- the liveness of the row it names. A provenance row pointing at a
          -- superseded or rejected observation yields no incumbent, which is
          -- section 6's "no applied value" and not a fallback to an older row.
          select applied.observation_id, applied.value
            from (
                select provenance.observation_id
                  from public.field_provenance as provenance
                 where provenance.entity_type = claim.domain
                   and provenance.entity_id = claim.entity_id
                   and provenance.field = claim.field
                 order by provenance.applied_at desc, provenance.provenance_id desc
                 limit 1
            ) as current_provenance
            join public.observations as applied
              on applied.observation_id = current_provenance.observation_id
           where applied.status in ('pending', 'applied')
      ) as incumbent on true
)
select classified.observation_id,
       classified.domain,
       classified.entity_id,
       classified.field,
       classified.source_id,
       classified.bucket,
       case
           when classified.bucket = 'awaiting_row' then classified.unmet_requirement
       end as unmet_requirement,
       -- HANDOFF 2026-09-10, place 3 of 3: APPENDED, last, so that
       -- create-or-replace stays legal (Postgres permits new columns only
       -- at the end of an existing view's column list).
       classified.observed_at
  from classified
 where classified.bucket is not null;

comment on column public.pending_claims.observed_at is 'The instant the source observed this claim, carried through from observations unchanged - the claim''s age, which the view previously made every reader fetch back by observation_id. NOT NULL upstream (observations.observed_at defaults to now()), so a null here means only that a reader''s own projection allowed one';

-- PostgREST caches the schema, so until it reloads it goes on advertising the
-- view's old six columns and a client selecting observed_at gets 42703.
notify pgrst, 'reload schema';
```

## 3. What it changes, and what it must not

**Changes:** `public.pending_claims` gains a seventh column, `observed_at`
(`timestamp with time zone`), appended after `unmet_requirement`.

**Does not change:** the six existing columns, their names, order and types; the
bucket conditions; the precedence; the `in_window`-is-empty-by-rule condition;
the `materialized` hint; the `security_invoker` setting; the owner; the grants
(`create or replace view` preserves them, and the `revoke all … from anon,
authenticated` of `20260901000004` still stands — this file deliberately does not
re-issue it, because re-issuing is not what makes it true and a redundant revoke
in a migration whose subject is a column is noise). No row enters or leaves the
view: the added column is a projection, never a predicate.

**Three things to know:**

1. **`observations.observed_at` is `NOT NULL` with `default now()`**
   (`20260818000000`, the observations table), so in practice the new view column
   is never null. Admin's reader still orders `nulls last` and still renders a
   dash rather than "now" for an absent instant — defensive, not expected.
2. `create or replace view` accepts a new column **only at the end** of the
   column list. That is why place 3 of 3 appends rather than inserting beside
   `source_id`, even though the CTEs carry it earlier.
3. The `notify pgrst` at the bottom is not optional for the Admin side: without a
   schema reload the API keeps advertising six columns and every Admin read of
   `observed_at` fails with `42703`, which will look like a bad build and is
   actually a stale cache.

## 4. How to tell it worked, in one read

From anywhere with the staging service-role key (read-only, no writes):

```sh
curl -s "$SUPABASE_URL/rest/v1/pending_claims?select=observation_id,bucket,observed_at&order=observed_at.asc&limit=3" \
  -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY"
```

Three rows, each carrying an `observed_at` timestamp, oldest first, is the whole
proof. `PGRST204`/`42703` naming `observed_at` means the schema cache has not
reloaded yet; `PGRST200` is a different (and now irrelevant) error about embeds.

A second, optional sanity read: the row **count** must be unchanged. It was
**877** on 2026-09-03 and 2026-09-09 (`select=observation_id`, `head`,
`count=exact`) and this file must not move it by one.

## 5. What it unblocks, and what happens until you apply it

BUG-0138 rebuilds `/claims` as: one DB-ordered window read of the 50
longest-waiting claims (`order observed_at asc, observation_id asc, limit 50`),
six `readCount` head requests for the figures, five `limit 1` reads for each
bucket's oldest instant, and the registry and gauge reads — all issued together.
The nine-chunk instants leg disappears entirely. Page cost stops depending on how
many claims exist.

**Before you apply it:** the builder builds and proves the whole thing **offline**
against the stub — the offline suite is the ticket's real bar and does not touch
staging. The four live checks (`npm run test:live`) will **refuse**: the ticket
requires them to fail loudly when staging's `pending_claims` has no `observed_at`,
and forbids any fallback to the old two-step read. A refused live check is
recorded on the receipt as a refusal, never as a pass — so an unapplied migration
shows up as a red line in the tracker, not as silence.

**After you apply it to staging:** the builder re-runs the live checks, records
the warm `/claims` server time next to Ben's 2.9-3.8 s, and the ticket closes.

**Production:** not this factory's business. Nothing in the campaign reads,
writes or measures production, and no ticket will ask you to push there.
