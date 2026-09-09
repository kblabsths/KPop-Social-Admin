# ASK BEN: install the `verdicts` table (handoff 1 of 2, scraper repo)

*Authored 2026-09-08 by campaign `admin-window` (TASK-0045), against the
migrations installed in `kspace Scraper` as of that date. **Nothing in the Admin
repo applies this** — no agent runs it, no ticket touches the scraper repo, and
the scraper's working tree and git log are untouched by this campaign.*

`verdicts` is the first of M2's two schema pieces. The second — the
`settle_review_item` function that is this table's only writer — is authored in
its own note (`M2-handoff-settle-review-item.md`) and is meant to be applied
**after** this one. Until the table exists, every M2 surface renders the
ordinary `not_provisioned` card naming `verdicts` and offers no verdict control
(that is `readSettlementReadiness`, `src/lib/db/verdict.ts`); nothing queues,
nothing retries, and no value is written another way.

## 1. Where it goes, and the command you run

| | |
| --- | --- |
| target file | `kspace Scraper/supabase/migrations/20260908000001_the_verdict_becomes_a_row.sql` |
| create it by | pasting §2 below into that new file, verbatim |
| apply command | `supabase db push`, run **from the `kspace Scraper` repo root** — the only repo that pushes migrations (root `CLAUDE.md`) |
| order | this file first, `settle_review_item` second (its file name must sort after this one; the function references this table) |
| rollback | `drop table public.verdicts;` — safe while the function is not yet installed, and it takes nothing else with it: no other object references this table |

Paste-ready, from the scraper repo root (`/Users/ben-m4/Desktop/Coding/KPOP/kspace Scraper`):

```sh
# 1. create the file, paste section 2 into it
#    supabase/migrations/20260908000001_the_verdict_becomes_a_row.sql
# 2. apply it
supabase db push
```

Staging is a separate apply from production, as every file in that directory
has been. Applying it twice errors on the existing table — the migration is
forward-only in the sibling's own style (no `if not exists`), which is what
makes a re-run loud rather than silent.

## 2. The migration

```sql
-- The verdict becomes a row.
--
-- contracts/admin-observability.md section 7: a verdict does two jobs at once -
-- it settles the subject through the normal pipeline, and it lands here as a
-- labelled example the system later learns from. Nothing in this schema carried
-- that record before this file. review_items.status has an open value and a
-- settled one (20260901000002) and no table said WHO settled an item, WHY, or
-- WHAT the settlement wrote; an admin override of a canonical value left no
-- record at all beyond the observation it produced.
--
-- Seven columns and no eighth. The values a verdict REJECTED are not columns
-- here: they are the rejection stamps on the observations themselves
-- (observations.rejected_at / rejected_by, 20260901000003), written in the same
-- transaction as the settlement. A chosen_value column would be a second
-- spelling of a value that already lives on the observation this row points at.
--
-- The two nullable columns are STRUCTURAL, and each carries one fact rather
-- than an absence: review_item_id null is what makes a row an override from the
-- Admin editor, and observation_id null is what makes it a settle-only verdict.
-- Neither is an optional field someone forgot to fill.
--
-- Internal table: RLS on with zero policies and no client grant, per
-- 20260901000002 section 4. One deliberate departure from that file's grant
-- line, and it is the point of the table: service_role holds SELECT and nothing
-- else. settle_review_item is the ONLY writer (section 7's "one entry point,
-- one transaction"), and like apply_resolution (20260901000005) it is security
-- definer, so it inserts as its owner and needs no table grant of its own.
-- Handing service_role INSERT would leave a second write path open to every
-- holder of that key, including the Admin dashboard, which is exactly the door
-- this design closes.
--
-- Zero json columns: this schema admits one, observations.value (ECOSYSTEM
-- section 10). No alter table on any canonical table, and no data.
--
-- Forward-only. This file authors the table; the staging apply is separate and
-- human-gated, and production is separate again.

-- ── 1. The table ─────────────────────────────────────────────────────────────
-- Column order follows contracts/admin-observability.md section 7: identity,
-- the item, who decided and what they decided, the observation the decision
-- wrote, the why, and the when.

create table public.verdicts (
    verdict_id uuid default public.uuid_generate_v7() not null,
    review_item_id uuid,
    actor text not null,
    action text not null,
    observation_id uuid,
    note text,
    created_at timestamp with time zone default now() not null,
    constraint verdicts_pkey primary key (verdict_id),
    constraint verdicts_action_check check ((action = any (array['choose_claimed_value'::text, 'supply_value'::text, 'keep_current'::text, 'link_entity'::text, 'settle'::text, 'fixed'::text, 'wont_fix'::text, 'override'::text]))),
    constraint verdicts_review_item_id_fkey foreign key (review_item_id) references public.review_items(review_item_id),
    constraint verdicts_observation_id_fkey foreign key (observation_id) references public.observations(observation_id)
);

alter table public.verdicts owner to postgres;

-- ── 2. How it is read ────────────────────────────────────────────────────────
-- The verdict log reads newest-first and is the one read that grows without
-- bound as verdicts accumulate; nothing bounds it but the ordering.

create index verdicts_created_at_idx on public.verdicts (created_at desc);

-- Every verdict on one item, for an item's own history beside its settled
-- status. A btree stores the nulls too, so "the overrides" - the item-less rows
-- - is the same index read from the other end.

create index verdicts_review_item_idx on public.verdicts (review_item_id);

-- ── 3. What each column means ────────────────────────────────────────────────

comment on table public.verdicts is 'One row per decided verdict: the settlement of a review item, or an admin override of a canonical value, which is the same row without the item. Human rows are the training signal the ecosystem later learns from; a machine row, if autonomy ever earns one, is audit only and is never graded against itself. Written by settle_review_item and by nothing else (contracts/admin-observability.md section 7)';

comment on column public.verdicts.review_item_id is 'The item this verdict settled. NULL is not a missing value: it is what makes the row an override from the Admin record surface, which carries the same actor, tier and write path as a settlement but answers no queued question. One nullable FK carries that difference instead of a second table';

comment on column public.verdicts.actor is 'Who decided - a human identity in v1, a model identity if autonomy ever lands. Never blank: the verdict log is the record of every admin data action, and a row that cannot say whose action it was is not one';

comment on column public.verdicts.action is 'Which of the eight actions was taken. The three data_conflict answers (choose_claimed_value, supply_value, keep_current), the two entity_link ones (link_entity, settle), the two signal dispositions (fixed, wont_fix) and the item-less override. Exactly these eight - the CHECK is the list, adding one is a migration, and the Admin build asserts its own copy against this constraint';

comment on column public.verdicts.observation_id is 'The admin-tier observation this verdict wrote, applied through apply_resolution in the same transaction. NULL is structural again: a keep_current, settle, fixed or wont_fix verdict writes no observation, and its whole effect is the settlement and the rejections it implies';

comment on column public.verdicts.note is 'The admin''s why, at their discretion - the reasoning half of the training signal, and the only column here a reader will quote back. Nullable in the table and REQUIRED BY THE FUNCTION on wont_fix, where the note is the answer to why the condition stands. A CHECK could not carry that rule for the value-carrying actions, which do not need one, so the one entry point enforces it where it applies';

comment on column public.verdicts.created_at is 'When the verdict was decided. It is also the settlement''s timestamp: one transaction means the apply, the rejection stamps and this row share it, which is what the resolver''s strictly-newer guard assumes (contracts/resolver.md section 7, step 0b)';

-- ── 4. Who may touch it ──────────────────────────────────────────────────────
-- Client roles hold nothing, at both the grant and the RLS layer: RLS on with
-- zero policies, and the grants this project's ALTER DEFAULT PRIVILEGES hands
-- every new public table revoked outright. TRUNCATE is why the revoke is
-- necessary rather than decorative - RLS does not govern it (20260825000007).
--
-- service_role gets SELECT only, and that is the whole enforcement of "one
-- entry point": the Admin dashboard holds that key and reads this table to know
-- whether the verdict path is installed at all, but it cannot write a verdict
-- except through settle_review_item, which runs security definer as the owner.

alter table public.verdicts enable row level security;

revoke all on table public.verdicts from anon, authenticated;
grant select on table public.verdicts to service_role;

-- PostgREST caches the schema; the Admin dashboard reads this table over it and
-- would go on answering PGRST205 until the next reload without this.
notify pgrst, 'reload schema';
```

## 3. Every identifier this file names, and where it is defined

Read from `/Users/ben-m4/Desktop/Coding/KPOP/kspace Scraper/supabase/migrations/`
on 2026-09-08. Nothing above was invented to make the file read well: an
identifier that did not resolve there would have been a question for you rather
than a line in this block.

| identifier | what it is | defined in |
| --- | --- | --- |
| `public.uuid_generate_v7()` | zero-arg function returning `uuid`; the PK default, time-sortable, used by every table this ecosystem adds | `20260818000000_the_schema_arrives_as_one_snapshot.sql` (definition); `20260821000002_the_foundation_functions_get_their_revoke_grant_pair.sql` (its revoke/grant pair) |
| `public.review_items` | the resolver's queue table; `review_items_pkey` is on `review_item_id`, which is what `verdicts_review_item_id_fkey` references | `20260901000002_the_review_item_opens_once_per_subject.sql` |
| `public.observations` | every claim by every source; `observations_pkey` is on `observation_id`, which is what `verdicts_observation_id_fkey` references | `20260818000000_the_schema_arrives_as_one_snapshot.sql` |
| `observations.rejected_at`, `observations.rejected_by` | the rejection stamps a verdict writes instead of copying rejected values here (comment only — this file does not touch them) | `20260901000003_an_adjudicated_claim_carries_its_stamp.sql` |
| `public.apply_resolution(p_decisions jsonb)` | the canonical write path a value-carrying verdict applies through, and the `security definer` precedent this table's grant line assumes (comment only) | `20260901000005_canonical_gets_its_one_write_path.sql` |
| `anon`, `authenticated`, `service_role` | Supabase's managed roles. The revoke line copies `20260901000002` §4; the TRUNCATE reasoning is the project-wide sweep's | `20260901000002_the_review_item_opens_once_per_subject.sql` §4; `20260825000007_revoke_client_truncate_across_public.sql` |
| `public` schema, `now()`, `timestamp with time zone` | Postgres and Supabase built-ins; `public` is the REST-exposed schema, which is why the grants above are the whole story | — |

## 4. The three things worth a second look before you paste

1. **`grant select` and not `grant select, insert, update, delete`.** Every
   other internal table in that repo (`review_items`, `resolution_runs`,
   `confirmed_matches`) hands `service_role` all four. This one does not, on
   purpose: `settle_review_item` is the only writer, it is `security definer`,
   and the deferred proof run's "grant introspection proving `verdicts` is
   written by `settle_review_item` alone" only passes if `service_role` holds no
   write here. **This couples the two files**: if you ever make the function
   `security invoker`, this grant line has to widen with it.
2. **Two indexes, neither required by the contract.** `created_at desc` for the
   verdict-log tab, `review_item_id` for an item's own history. Drop either line
   if you would rather add them when a read is slow; nothing in Admin depends on
   an index existing.
3. **Eight action names, and they are asserted from both ends.** The CHECK's
   list is `VERDICT_ACTIONS` in `src/lib/verdict/decision.ts`, and
   `tests/offline/handoff/verdicts.test.ts` imports that constant and compares
   it to the set parsed out of the block above — so the SQL you paste and the UI
   that calls it cannot drift apart silently. If you want a different spelling,
   change it here and the Admin test goes red until the code follows.
