# External ticket — the registry answers "current version"; the settle function stops searching (scraper repo)

*For an agent working outside the factory, in the `kspace Scraper` repo (the
schema owner). Written by the admin-window dispatcher on 2026-09-15 from Ben's
decision of the same day ("Isn't registry owned better?" — yes; "let's write
the ticket then").*

## The defect in one paragraph

`public.settle_review_item(p_decision jsonb)` (installed by
`supabase/migrations/20260908000002_the_verdict_settles_the_item.sql`) needs
the CURRENT schema version of a domain to validate an adopted or supplied
value. Nothing installed answers that question directly:
`public.domain_schema(p_domain text, p_version integer)` is a compiled `case`
that returns the schema for versions the registry knows and NULL for the rest.
So the function searches — lines 541–547 of that migration:

```sql
select max(candidate.version)
  into v_version
  from generate_series(1, c_version_top) as candidate(version)
 where public.domain_schema(v_domain, candidate.version) is not null;
```

64 evaluations of an immutable function per settlement, correct today (events
= 3, venues = 2), and a workaround for the registry lacking one answer. Ben's
ruling: the registry owns versions, so the registry states the current one.

## What to build

1. **One new migration** (forward-only, next timestamp after the newest file in
   `supabase/migrations/`; read the newest few first for house style — the
   header comment, the revoke/grant pair pattern from
   `20260821000002_the_foundation_functions_get_their_revoke_grant_pair.sql`,
   and how `20260829000004_events_take_up_the_third_schema.sql` compiles the
   registry into `domain_schema`):
   - `public.domain_current_version(p_domain text) returns integer`, `immutable`,
     `security invoker` (it reads no table — it is registry knowledge compiled
     into SQL exactly like `domain_schema`), answering 3 for `events`, 2 for
     `venues`, and **NULL for a domain the registry does not know** (the caller
     decides what NULL means; do not raise here).
   - The one place the registry's version list is spelled: wherever
     `domain_schema`'s compiled `case` gets a new version, this function must
     move with it. Put both in the same file region and say so in a comment, or
     derive one from the other if the compile step allows it — pick whichever
     the registry's compile path makes single-sourced.
   - `create or replace function public.settle_review_item(...)` re-issued
     **verbatim from the installed body** except the search block above, which
     becomes one call:
     ```sql
     v_version := public.domain_current_version(v_domain);
     ```
     The `if v_version is null then raise … KS001` arm that follows stays
     exactly as it is — that is the "unknown domain" refusal and it already has
     its code (`KS001`, `UNKNOWN_DOMAIN` in `tests/helpers/ks_codes.py`). **No
     new KS code**, so `tests/live_safety/test_codes_named_once.py` needs no
     companion edit. Delete `c_version_top` if nothing else reads it.
   - Grants: mirror what the foundation functions carry (revoke from public,
     grant execute to the roles that call `settle_review_item`; read the
     revoke/grant pair migration and copy its pattern, not its list).
   - End with `notify pgrst, 'reload schema';` like every function migration
     here.
2. **Tests in the scraper's own suite** (Python, `tests/…`, house style):
   `domain_current_version('events') = 3`, `('venues') = 2`, `('nope') is
   null`; and the settlement path still refuses an unknown domain with
   `KS001` (the existing acceptance case for that, if one exists — extend it
   rather than duplicate).
3. **Admin side (this repo, `/Users/ben-m4/Desktop/Coding/KPOP/kspace Admin`):**
   nothing to change in product code — the envelope never carried a version
   (ARCHITECTURE §9.2). But `tests/offline/handoff/settle-review-item.test.ts`
   grades the handoff NOTE's fenced SQL block, not the installed function, so
   it stays green; add one line to `agenticflow/docs/DECISIONS.md` (dated,
   "registry-owned current version replaces the search; scraper migration
   `<file>`") so the factory's next run knows the world moved. Do not edit the
   M2 handoff note itself — it is a dated record of what was pasted.

## Rules

- Apply to **staging only** (`ubfjjqlvnpnoborczbdb`); production is Ben's
  call alone. The scraper repo is currently linked to the production project —
  do not run a bare `supabase db push`; apply through the staging SQL editor
  (Ben's practice) or re-link to staging first and say so. Ben has three
  hand-applied migrations there (`20260908000001/2`, `20260910000001`) that a
  push would try to re-apply; a push against staging needs
  `supabase migration repair --status applied` for those first.
- After applying, verify read-only: `select public.domain_current_version('events')`
  → 3; an empty `settle_review_item` decision still answers `KS029`; a decision
  naming an unknown domain answers `KS001`.
- Never call `apply_resolution` or settle a real review item to test this: a
  settlement writes `verdicts` and canonical rows on a shared staging project.
  The unit tests and the refusal probes above are the whole proof.

## Done when

- The migration is committed in the scraper repo and applied to staging.
- `settle_review_item` contains no `generate_series` and no `c_version_top`.
- The three unit cases pass; `KS001` still refuses an unknown domain.
- Admin's DECISIONS.md carries the dated line.
