# ASK BEN: register the `admin` source and install `settle_review_item` (handoff 2 of 2, scraper repo)

*Authored 2026-09-08 by campaign `admin-window` (TASK-0046), against the
migrations installed in `kspace Scraper` as of that date. **Nothing in the Admin
repo applies this** — no agent runs it, no ticket touches the scraper repo, and
the scraper's working tree and git log are untouched by this campaign.*

`settle_review_item` is the second of M2's two schema pieces and it **depends on
the first**: it is the only writer of `verdicts`, so apply
`M2-handoff-verdicts.md` before this file. Until both are installed, every M2
surface renders the ordinary `not_provisioned` card naming `verdicts`, offers no
verdict control, and writes nothing another way (`readSettlementReadiness`,
`src/lib/db/verdict.ts`).

**One paste does two things** (your answer of 2026-09-08): §2's block first
registers the admin voice as a `sources` row — staging has none today — and then
installs the function that writes through it. The registration is
`on conflict (source) do nothing`, never `do update`, so a second paste, or a row
you inserted yourself, is never rewritten from Admin's copy of it.

## 1. Where it goes, and the command you run

| | |
| --- | --- |
| target file | `kspace Scraper/supabase/migrations/20260908000002_the_verdict_settles_the_item.sql` |
| create it by | pasting §2 below into that new file, verbatim |
| apply command | `supabase db push`, run **from the `kspace Scraper` repo root** — the only repo that pushes migrations (root `CLAUDE.md`) |
| order | **after** `20260908000001_the_verdict_becomes_a_row.sql`: this function inserts into `verdicts`, and `create function` does not check that, so a wrong order installs a function that raises `42P01` on its first call instead of failing at install |
| rollback | `drop function public.settle_review_item(jsonb);` then `notify pgrst, 'reload schema';`. The `sources` row is left standing on purpose — deleting a registered source is a registry decision, not a rollback step, and an `observations` row may already reference it. The reload is not optional: PostgREST caches the schema, so until it reloads it goes on advertising a function that is gone |

Paste-ready, from the scraper repo root (`/Users/ben-m4/Desktop/Coding/KPOP/kspace Scraper`):

```sh
# 1. create the file, paste section 2 into it
#    supabase/migrations/20260908000002_the_verdict_settles_the_item.sql
# 2. apply it
supabase db push
```

Staging is a separate apply from production, as every file in that directory has
been. Applying it twice re-creates the function (it is `create or replace`) and
re-runs the idempotent `sources` insert, which writes nothing the second time.

## 2. The migration

```sql
-- The verdict settles the item.
--
-- contracts/admin-observability.md section 7: "one entry point, one
-- transaction". This function is the ONLY writer of public.verdicts and the ONLY
-- setter of review_items.status. Every action arrives as ONE typed decision and
-- branches inside; every branch ends the same way - the item marked settled and
-- one verdicts row inserted - and the whole of it is one transaction, because
-- contracts/resolver.md section 7 step 0b's strictly-newer guard assumes a
-- settlement's apply and its rejections share a timestamp. There is no commit
-- here, no dblink, and no autonomous transaction: the caller's transaction is
-- the settlement's transaction, and a branch that raises takes the whole
-- settlement back.
--
-- WHAT IT IS AUTHORED AGAINST. Every identifier below was read out of this
-- directory on 2026-09-08 and resolves here with matching arity - the gate
-- ingest_observation (20260821000003, the nine-argument signature that
-- 20260819000002 left after p_entity_type was dropped), apply_resolution
-- (20260901000006, whose five decision kinds and seven fact keys this file
-- uses), review_items (20260901000002), observations and sources
-- (20260818000000), confirmed_matches (20260829000003), domain_schema
-- (20260829000004). The one thing it names that is NOT in this directory is
-- public.verdicts, which is the companion migration 20260908000001 and must be
-- applied first.
--
-- THE ADMIN VOICE TRAVELS IN THIS FILE (Ben, 2026-09-08). The gate refuses an
-- unregistered source with KS007, so every value-carrying verdict needs a
-- sources row whose tier is admin. Section 1 below registers it, idempotently.
--
-- NO SCHEMA VERSION AND NO SOURCE NAME ARRIVE FROM ADMIN. The decision envelope
-- carries neither: the version is resolved here off domain_schema itself, and
-- the source name is this file's own constant. A version number spelled in the
-- dashboard would be the scraper's registry re-encoded by hand.
--
-- ZERO json COLUMNS, no new table, no new column, no alter table on anything
-- vetted, and no data beyond the one sources row. p_decision is a jsonb
-- ARGUMENT, following the two shipped idioms next door - apply_resolution's
-- own comment records that "the ban is on jsonb COLUMNS, and a batch argument
-- is not a column".
--
-- Forward-only. Staging is a separate apply and production is separate again.

-- ── 1. The admin voice is registered ─────────────────────────────────────────
-- One row, and this file writes no other and updates none. `do nothing` rather
-- than `do update` so that a second apply, or a row Ben inserted himself with a
-- different lifecycle, is never rewritten from this file's copy of it. The
-- conflict target is sources_source_key, the UNIQUE on ("source")
-- (20260818000000); kind, lifecycle and tier are values of source_kind,
-- source_lifecycle and source_tier, and the name passes sources_source_shape's
-- ^[a-z0-9_]+$.
--
-- The tier is what makes this voice authoritative: an admin-tier claim wins the
-- weighing and stamps field_provenance.admin_locked, which is how an override
-- sticks (contracts/resolver.md section 7, step 0). The lifecycle is active
-- because a trial source's claims are QUARANTINED at the gate and inert to
-- resolution - an admin verdict that lands quarantined would settle the item and
-- change nothing.

insert into public.sources (source, kind, lifecycle, tier)
values ('admin', 'registered', 'active', 'admin')
on conflict (source) do nothing;

-- ── 2. The one entry point ───────────────────────────────────────────────────
-- The answer is the verdict receipt: five of the seven columns of verdicts, the
-- ones a surface shows or links (VerdictReceipt, src/lib/db/verdict.ts). actor
-- and note are the caller's own decision echoed back and are not returned.
--
-- THE ARGUMENT NAME IS PART OF THE CONTRACT. PostgREST resolves an RPC by name
-- AND by argument names and answers PGRST202 for a wrong one - the same code it
-- answers for a function that is not installed at all - so a rename here makes a
-- provisioned function read as permanently and silently absent. It is p_decision,
-- and the Admin repo spells it once (SETTLE_ARGUMENT, src/lib/db/verdict.ts),
-- with tests/offline/handoff/settle-review-item.test.ts asserting this line
-- against that constant.
--
-- THE EIGHT ACTIONS are the CHECK of the verdicts table (20260908000001) and
-- VERDICT_ACTIONS in src/lib/verdict/decision.ts; the same test asserts the
-- array below against it, so the SQL and the UI cannot drift apart in silence.
--
-- WHAT EACH BRANCH DOES:
--
--   choose_claimed_value, supply_value, override  the admin-tier observation is
--     written THROUGH THE GATE and applied THROUGH apply_resolution, carrying
--     the rejections the verdict implies (rejected_by = verdict). override
--     enters item-less: review_item_id null, nothing settled, the verdicts row
--     and the canonical write alone.
--   link_entity  the same write, for a reference field: the observation carries
--     {"ref": ...}, a confirmed_matches row for (admin source, referenced
--     domain, ref) with matched_by = verdict lets the link stage resolve that
--     ref in later cycles, and the apply carries reference_entity_id so the
--     link COLUMN moves now rather than next cycle. It rejects nothing: the
--     other sources' claims are waiting to link, not disagreeing.
--   keep_current  rejections alone, canonical standing - apply_resolution's
--     adjudicate kind, which stamps without applying.
--   settle, fixed, wont_fix  no canonical write at all. wont_fix with a null or
--     blank note RAISES: the form's refusal is a courtesy, this one is the
--     contract.
--
-- WHAT IT DOES NOT DECIDE. It does not police which action fits which item
-- shape - that is the surface's - and it does not weigh anything. What it
-- refuses is a decision that would write something other than what it says.
--
-- security definer, like the gate and apply_resolution, so it inserts into
-- verdicts as its owner and needs no table grant: service_role holds SELECT on
-- verdicts and nothing else (20260908000001 section 4), which is the whole
-- enforcement of "one entry point". search_path is empty and every identifier
-- below is schema-qualified.

create or replace function public.settle_review_item(p_decision jsonb)
    returns table(
      verdict_id uuid,
      review_item_id uuid,
      action text,
      observation_id uuid,
      created_at timestamp with time zone
    )
    language plpgsql
    security definer
    set search_path to ''
    as $$
declare
  -- The admin voice, spelled here and in section 1 and nowhere else. Both
  -- spellings are pinned to ADMIN_SOURCE (src/lib/verdict/decision.ts) by
  -- tests/offline/handoff/settle-review-item.test.ts.
  c_admin_source   constant text := 'admin';

  -- The decision envelope: VerdictDecision and VerdictValue of
  -- src/lib/verdict/decision.ts, exactly. An unaccepted key is REFUSED rather
  -- than ignored, the way apply_one_resolution refuses one: a caller who
  -- misspells a key has a decision that means something other than what it
  -- says, and silence would settle it anyway. Note what is absent from both
  -- lists and stays absent - schema_version, source, tier, rejected_by, column:
  -- the database already knows all five, and a dashboard that named one would
  -- be re-encoding registry knowledge by hand.
  c_decision_keys  constant text[] := array[
    'action', 'review_item_id', 'actor', 'note', 'value'
  ];
  c_value_keys     constant text[] := array[
    'domain', 'entity_id', 'field', 'observation_id', 'value', 'ref'
  ];

  c_actions        constant text[] := array[
    'choose_claimed_value', 'supply_value', 'keep_current', 'link_entity',
    'settle', 'fixed', 'wont_fix', 'override'
  ];
  -- The actions that write a value: gate, then apply.
  c_value_actions  constant text[] := array[
    'choose_claimed_value', 'supply_value', 'link_entity', 'override'
  ];
  -- The three payload slots of a VerdictValue; exactly one is filled.
  c_slots          constant text[] := array['observation_id', 'value', 'ref'];

  -- How far up this function will ask the registry about a domain before it
  -- concludes the domain has no schema. domain_schema is a branch over the
  -- versions the registry has compiled into SQL and answers NULL for every
  -- other one, so the domain's current version is the highest it answers for -
  -- events is at 3 and venues at 2 today (20260829000004), and this is a
  -- SEARCH BOUND rather than a version this file believes in. If a domain ever
  -- passes 64 registered versions, this constant moves; nothing else does.
  c_version_top    constant integer := 64;

  -- A reference is the chosen row's own id, so it is read as one before it is
  -- cast: an id the cast refuses would otherwise raise 22P02 out of a function
  -- whose refusals are all coded.
  c_uuid_shape     constant text :=
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

  v_unreadable    text[];
  v_filled        text[];
  v_action        text;
  v_actor         text;
  v_note          text;
  v_item_id       uuid;
  v_item          public.review_items%rowtype;
  v_value         jsonb;
  v_domain        text;
  v_entity_id     uuid;
  v_field         text;
  v_column        text;
  v_ref           text;
  v_ref_domain    text;
  v_reference     uuid;
  v_claim         jsonb;
  v_version       integer;
  v_source_id     uuid;
  v_observation   uuid;
  v_incumbent     uuid;
  v_kept          jsonb;
  v_rejections    jsonb;
  v_decision      jsonb;
  v_outcome       text;
  v_code          text;
  v_explanation   text;
  v_verdict_id    uuid;
  v_created_at    timestamp with time zone;
begin
  -- ── the envelope ───────────────────────────────────────────────────────────
  if jsonb_typeof(p_decision) is distinct from 'object' then
    raise exception 'verdict refused: a decision is %, not an object',
                    coalesce(jsonb_typeof(p_decision), '<null>')
      using errcode = 'KS027',
            detail  = format('decision=%s',
                             coalesce(jsonb_typeof(p_decision), '<null>')),
            hint    = 'send one decision object carrying action, review_item_id, '
                      'actor, note and value';
  end if;

  select array_agg(named.key order by named.key)
    into v_unreadable
    from jsonb_object_keys(p_decision) as named(key)
   where named.key <> all (c_decision_keys);

  if v_unreadable is not null then
    raise exception 'verdict refused: the decision carries a key this function '
                    'does not accept: %', array_to_string(v_unreadable, ', ')
      using errcode = 'KS027',
            detail  = format('unaccepted=%s', array_to_string(v_unreadable, ',')),
            hint    = 'send only the five keys of the decision envelope; the '
                      'function comment lists them';
  end if;

  v_action := p_decision ->> 'action';
  if v_action is null or not (v_action = any (c_actions)) then
    raise exception 'verdict refused: % is not one of the eight actions',
                    coalesce(v_action, '<null>')
      using errcode = 'KS027',
            detail  = format('action=%s', coalesce(v_action, '<null>')),
            hint    = 'name one of choose_claimed_value, supply_value, '
                      'keep_current, link_entity, settle, fixed, wont_fix, '
                      'override';
  end if;

  -- Who decided. verdicts.actor is not null, and a row that cannot say whose
  -- action it was is not a record of an admin data action.
  v_actor := p_decision ->> 'actor';
  if v_actor is null or v_actor ~ '^[[:space:]]*$' then
    raise exception 'verdict refused: the verdict names no actor'
      using errcode = 'KS027',
            detail  = format('action=%s actor=%s', v_action,
                             coalesce(v_actor, '<null>')),
            hint    = 'send the signed-in identity that decided this verdict';
  end if;

  -- THE ONE REFUSAL THE CONTRACT NAMES. The note is required on wont_fix and
  -- nowhere else, and it is required NON-BLANK: a present-but-blank note is
  -- exactly the shape a form alone lets through, and "why the condition stands"
  -- is not answered by spaces.
  v_note := p_decision ->> 'note';
  if v_action = 'wont_fix'
     and (v_note is null or v_note ~ '^[[:space:]]*$') then
    raise exception 'verdict refused: wont_fix carries the note that says why '
                    'the condition stands'
      using errcode = 'KS028',
            detail  = format('action=%s note=%s', v_action,
                             coalesce(v_note, '<null>')),
            hint    = 'write why the condition stands; every other action takes '
                      'a note at the operator discretion';
  end if;

  -- The item, and the one action that enters without one.
  if p_decision ->> 'review_item_id' is not null
     and lower(p_decision ->> 'review_item_id') !~ c_uuid_shape then
    raise exception 'verdict refused: review_item_id is not an id'
      using errcode = 'KS027',
            detail  = format('action=%s review_item_id=%s', v_action,
                             p_decision ->> 'review_item_id'),
            hint    = 'send the review item id as a uuid, or omit it on an '
                      'override';
  end if;
  v_item_id := (p_decision ->> 'review_item_id')::uuid;

  if v_action = 'override' then
    if v_item_id is not null then
      raise exception 'verdict refused: an override answers no queued question '
                      'and settles no item'
        using errcode = 'KS027',
              detail  = format('action=%s review_item_id=%s', v_action, v_item_id),
              hint    = 'omit review_item_id on an override; every other action '
                        'settles one';
    end if;
  elsif v_item_id is null then
    raise exception 'verdict refused: % settles a review item and names none',
                    v_action
      using errcode = 'KS027',
            detail  = format('action=%s', v_action),
            hint    = 'name the review item this verdict settles; only an '
                      'override enters item-less';
  end if;

  -- ── the value the verdict carries, when it carries one ─────────────────────
  v_value := p_decision -> 'value';

  if v_action = any (c_value_actions) then
    if jsonb_typeof(v_value) is distinct from 'object' then
      raise exception 'verdict refused: % carries a value, and this one is %',
                      v_action, coalesce(jsonb_typeof(v_value), '<null>')
        using errcode = 'KS027',
              detail  = format('action=%s value=%s', v_action,
                               coalesce(jsonb_typeof(v_value), '<null>')),
              hint    = 'send value as an object naming domain, entity_id, '
                        'field and exactly one of observation_id, value, ref';
    end if;

    select array_agg(named.key order by named.key)
      into v_unreadable
      from jsonb_object_keys(v_value) as named(key)
     where named.key <> all (c_value_keys);

    if v_unreadable is not null then
      raise exception 'verdict refused: the value carries a key this function '
                      'does not accept: %', array_to_string(v_unreadable, ', ')
        using errcode = 'KS027',
              detail  = format('action=%s unaccepted=%s', v_action,
                               array_to_string(v_unreadable, ',')),
              hint    = 'send only the six keys of the value envelope; the '
                        'function comment lists them';
    end if;

    v_domain := v_value ->> 'domain';
    v_field := v_value ->> 'field';
    if v_value ->> 'entity_id' is not null
       and lower(v_value ->> 'entity_id') !~ c_uuid_shape then
      raise exception 'verdict refused: entity_id is not an id'
        using errcode = 'KS027',
              detail  = format('action=%s entity_id=%s', v_action,
                               v_value ->> 'entity_id'),
              hint    = 'name the canonical row this value lands on by its uuid';
    end if;
    v_entity_id := (v_value ->> 'entity_id')::uuid;

    if v_domain is null or v_field is null or v_entity_id is null then
      raise exception 'verdict refused: a value names its domain, its row and '
                      'its field'
        using errcode = 'KS027',
              detail  = format('action=%s domain=%s entity_id=%s field=%s',
                               v_action, coalesce(v_domain, '<null>'),
                               coalesce(v_entity_id::text, '<null>'),
                               coalesce(v_field, '<null>')),
              hint    = 'send domain, entity_id and field on every value-carrying '
                        'verdict';
    end if;

    -- Exactly one payload slot is filled, and it is one this action may fill.
    -- Two filled slots are two spellings of one fact, which is what the verdicts
    -- table declines a chosen_value column for.
    select array_agg(slot.key order by slot.key)
      into v_filled
      from unnest(c_slots) as slot(key)
     where v_value ? slot.key
       and jsonb_typeof(v_value -> slot.key) <> 'null';

    if coalesce(array_length(v_filled, 1), 0) <> 1 then
      raise exception 'verdict refused: a value fills exactly one of '
                      'observation_id, value, ref, and this one fills %',
                      coalesce(array_to_string(v_filled, ', '), 'none')
        using errcode = 'KS027',
              detail  = format('action=%s filled=%s', v_action,
                               coalesce(array_to_string(v_filled, ','), '')),
              hint    = 'choose_claimed_value fills observation_id, supply_value '
                        'fills value, link_entity fills ref, and an override '
                        'fills value or ref';
    end if;

    if (v_action = 'choose_claimed_value' and v_filled[1] <> 'observation_id')
       or (v_action = 'supply_value' and v_filled[1] <> 'value')
       or (v_action = 'link_entity' and v_filled[1] <> 'ref')
       or (v_action = 'override' and v_filled[1] = 'observation_id') then
      raise exception 'verdict refused: % may not carry its value as %',
                      v_action, v_filled[1]
        using errcode = 'KS027',
              detail  = format('action=%s filled=%s', v_action, v_filled[1]),
              hint    = 'a reference chosen by an operator arrives as an '
                        'override or a link_entity, never as a supply_value';
    end if;
  elsif v_value is not null and jsonb_typeof(v_value) <> 'null' then
    raise exception 'verdict refused: % writes no value and carries one',
                    v_action
      using errcode = 'KS027',
            detail  = format('action=%s value=%s', v_action,
                             jsonb_typeof(v_value)),
            hint    = 'omit value on keep_current, settle, fixed and wont_fix; '
                      'their whole effect is the settlement and the rejections '
                      'it implies';
  end if;

  -- ── the item, locked ───────────────────────────────────────────────────────
  -- Locked before it is read, so two operators answering the same question
  -- queue here rather than both settling it. A settled item is refused: this
  -- function is the only setter of the column, and settling one twice would
  -- write a second verdict for a question that was already answered.
  if v_item_id is not null then
    select * into v_item
      from public.review_items as item
     where item.review_item_id = v_item_id
       for update;

    if not found then
      raise exception 'verdict refused: no review item %', v_item_id
        using errcode = 'KS029',
              detail  = format('action=%s review_item_id=%s', v_action, v_item_id),
              hint    = 'name an item the queue holds';
    end if;

    if v_item.status is distinct from 'open' then
      raise exception 'verdict refused: review item % is already %',
                      v_item_id, v_item.status
        using errcode = 'KS029',
              detail  = format('action=%s review_item_id=%s status=%s', v_action,
                               v_item_id, v_item.status),
              hint    = 'a settled item stays settled; a question that comes '
                        'back opens a new item';
    end if;

    -- The fact the decision writes is the fact the item is about. Compared only
    -- where the item NAMES a part - a per-source item names none of the three,
    -- and an entity_link item often has no canonical row yet - so this refuses
    -- a mismatch without inventing a constraint the queue does not carry.
    if v_domain is not null
       and ((v_item.domain is not null and v_item.domain is distinct from v_domain)
            or (v_item.entity_id is not null
                and v_item.entity_id is distinct from v_entity_id)
            or (v_item.field is not null
                and v_item.field is distinct from v_field)) then
      raise exception 'verdict refused: the decision writes %.% of %, and item '
                      '% is about a different fact',
                      v_domain, v_field, v_entity_id, v_item_id
        using errcode = 'KS027',
              detail  = format('review_item_id=%s item=%s.%s/%s decision=%s.%s/%s',
                               v_item_id, coalesce(v_item.domain, '<none>'),
                               coalesce(v_item.field, '<none>'),
                               coalesce(v_item.entity_id::text, '<none>'),
                               v_domain, v_field, v_entity_id),
              hint    = 'settle the item the decision is about';
    end if;
  end if;

  -- ── the value-carrying branches: the gate, then the apply ──────────────────
  if v_action = any (c_value_actions) then
    if v_filled[1] = 'ref' then
      -- A REFERENCE IS OBSERVED AS A REF, NEVER AS AN ID. The admin source's own
      -- external_ref for an entity IS that entity's id (ARCHITECTURE section
      -- 9.2), so the confirmed match below is what lets the link stage resolve
      -- this claim in a later cycle, and reference_entity_id is what moves the
      -- link column now.
      --
      -- THE ONE REFERENCE FIELD THE REGISTRY DECLARES TODAY is events.venue,
      -- whose canonical column is venue_id and whose referenced domain is
      -- venues (20260829000004 declares the field; 20260825000002 declares
      -- events_venue_id_fkey). It is spelled here because a field is a
      -- reference in the registry and neither the column nor the referenced
      -- domain is derivable from the schema JSON. A second reference field is a
      -- PATCH TO THIS ARM, never a silent guess: anything else carrying a ref
      -- is refused below.
      v_ref := v_value ->> 'ref';
      if v_domain = 'events' and v_field = 'venue' then
        v_ref_domain := 'venues';
        v_column := 'venue_id';
      else
        raise exception 'verdict refused: %.% is not a reference field this '
                        'function can link', v_domain, v_field
          using errcode = 'KS027',
                detail  = format('action=%s domain=%s field=%s', v_action,
                                 v_domain, v_field),
                hint    = 'events.venue is the one reference field the registry '
                          'declares; adding another is a migration here';
      end if;

      if lower(v_ref) !~ c_uuid_shape then
        raise exception 'verdict refused: a reference names the chosen row by '
                        'its id, and this one is %', left(v_ref, 200)
          using errcode = 'KS027',
                detail  = format('action=%s domain=%s field=%s ref=%s', v_action,
                                 v_domain, v_field, left(v_ref, 200)),
                hint    = 'the picker sends the chosen row id; it never creates '
                          'an entity and never sends free text';
      end if;
      v_reference := v_ref::uuid;
      v_claim := jsonb_build_object('ref', v_ref);

    elsif v_filled[1] = 'observation_id' then
      -- choose_claimed_value: the admin ADOPTS a claimed value, which means
      -- re-asserting it in their own voice. The value is read off the claim
      -- rather than re-sent by the dashboard, so the two cannot differ.
      if lower(v_value ->> 'observation_id') !~ c_uuid_shape then
        raise exception 'verdict refused: observation_id is not an id'
          using errcode = 'KS027',
                detail  = format('action=%s observation_id=%s', v_action,
                                 v_value ->> 'observation_id'),
                hint    = 'name the claim being adopted by its uuid';
      end if;

      select claim.value
        into v_claim
        from public.observations as claim
       where claim.observation_id = (v_value ->> 'observation_id')::uuid;

      if v_claim is null then
        raise exception 'verdict refused: no observation %',
                        v_value ->> 'observation_id'
          using errcode = 'KS027',
                detail  = format('action=%s observation_id=%s', v_action,
                                 v_value ->> 'observation_id'),
                hint    = 'choose a claim the evidence names';
      end if;

    else
      v_claim := v_value -> 'value';
    end if;

    -- THE DOMAIN'S CURRENT SCHEMA VERSION, resolved here and never sent. The
    -- gate validates against domain_schema(domain, version) and answers NULL
    -- for a version the registry has not compiled, so the current one is the
    -- highest it answers for.
    select max(candidate.version)
      into v_version
      from generate_series(1, c_version_top) as candidate(version)
     where public.domain_schema(v_domain, candidate.version) is not null;

    if v_version is null then
      raise exception 'observation rejected: domain "%" has no registered schema',
                      v_domain
        using errcode = 'KS001',
              detail  = format('action=%s domain=%s field=%s', v_action, v_domain,
                               v_field),
              hint    = 'register the domain in registry/domains/ and ship its '
                        'registration migration';
    end if;

    -- THROUGH THE GATE, which is the only way an observation is ever written:
    -- it refuses an unregistered source (KS007), validates the value against the
    -- domain schema, normalizes it, and applies the change-only rule - so an
    -- admin re-asserting a value they already hold gets the row they already
    -- wrote rather than a second one. observed_at is now(), which is the
    -- transaction's own instant, so this claim, the apply below it and the
    -- rejections it carries share one timestamp.
    v_observation := public.ingest_observation(
                       p_source         => c_admin_source,
                       p_domain         => v_domain,
                       p_entity_id      => v_entity_id,
                       p_field          => v_field,
                       p_value          => v_claim,
                       p_schema_version => v_version,
                       p_observed_at    => now()
                     );

    -- What the ledger now holds for this claim, AFTER normalization. The
    -- rejection set below compares against this rather than against what
    -- arrived, so a claim that agrees with the settled value is never stamped
    -- out over a difference normalization already removed.
    select claim.value
      into v_kept
      from public.observations as claim
     where claim.observation_id = v_observation;

    if v_reference is not null then
      -- The gate answered, so KS007 did not fire and the admin source is
      -- registered; its id is read here for the match.
      select registered.source_id
        into v_source_id
        from public.sources as registered
       where registered.source = c_admin_source;

      -- matched_by = verdict is already in confirmed_matches_matched_by_check
      -- (20260829000003). `do nothing`, because the admin's ref for an entity IS
      -- that entity - the row can never need a different entity_id - and a merge
      -- that rewrote it knows better than this file does.
      insert into public.confirmed_matches as matched
             (source_id, domain, external_ref, entity_id, matched_by)
      values (v_source_id, v_ref_domain, v_ref, v_reference, 'verdict')
      on conflict (source_id, domain, external_ref) do nothing;
    end if;

    -- The incumbent the apply is decided against: apply_resolution re-reads it
    -- under the fact identity's advisory lock and SKIPS a decision whose fact
    -- moved, which is caught below.
    select applied.observation_id
      into v_incumbent
      from public.observations as applied
     where applied.domain = v_domain
       and applied.entity_id = v_entity_id
       and applied.field = v_field
       and applied.status = 'applied';

    -- THE REJECTIONS THE VERDICT IMPLIES: the item's own evidence claims that
    -- are still live and DISAGREE with the value that now stands. A claim
    -- agreeing with it is left alone - a rejection covers a value, not a row
    -- (contracts/resolver.md section 7, step 0b), and stamping the claim the
    -- admin just adopted would block the source that was right from ever
    -- re-asserting it. link_entity rejects nothing at all: the other sources'
    -- claims are waiting to link, not disagreeing. An override has no item and
    -- so has no evidence to reject.
    if v_action <> 'link_entity' and v_item.review_item_id is not null then
      select coalesce(jsonb_agg(jsonb_build_object('observation_id',
                                                   claim.observation_id,
                                                   'rejected_by', 'verdict')
                                order by claim.observation_id), '[]'::jsonb)
        into v_rejections
        from public.observations as claim
       where claim.observation_id = any (v_item.evidence)
         and claim.status in ('pending', 'applied')
         and claim.observation_id is distinct from v_observation
         and claim.value is distinct from v_kept;
    else
      v_rejections := '[]'::jsonb;
    end if;

    -- One apply decision. tier_at_apply and admin_locked are this function's,
    -- never the dashboard's: every claim it writes is admin-tier, and
    -- contracts/resolver.md section 8 stamps admin_locked when the winning
    -- claim is admin-tier - which is the whole of section 8's admin stickiness,
    -- produced by this fact key and by no second write.
    v_decision := jsonb_build_object(
                    'kind', 'apply',
                    'domain', v_domain,
                    'entity_id', v_entity_id,
                    'field', v_field,
                    'observation_id', v_observation,
                    'tier_at_apply', 'admin',
                    'admin_locked', true,
                    'incumbent_observation_id', v_incumbent,
                    'rejections', v_rejections
                  );

    if v_column is not null then
      v_decision := v_decision || jsonb_build_object('column', v_column);
    end if;
    if v_reference is not null then
      v_decision := v_decision
                    || jsonb_build_object('reference_entity_id', v_reference);
    end if;

  elsif v_action = 'keep_current' then
    -- CANONICAL STANDS, and the disagreements are stamped out: the adjudicate
    -- kind is the arm that writes rejections and nothing else.
    if v_item.domain is null then
      raise exception 'verdict refused: keep_current settles a fact, and item % '
                      'is about no fact', v_item_id
        using errcode = 'KS027',
              detail  = format('review_item_id=%s queue=%s', v_item_id,
                               v_item.queue),
              hint    = 'keep_current answers a data_conflict about one fact; a '
                        'per-source item settles with settle, fixed or wont_fix';
    end if;

    select applied.observation_id, applied.value
      into v_incumbent, v_kept
      from public.observations as applied
     where applied.domain = v_item.domain
       and applied.entity_id is not distinct from v_item.entity_id
       and applied.field = v_item.field
       and applied.status = 'applied';

    select coalesce(jsonb_agg(jsonb_build_object('observation_id',
                                                 claim.observation_id,
                                                 'rejected_by', 'verdict')
                              order by claim.observation_id), '[]'::jsonb)
      into v_rejections
      from public.observations as claim
     where claim.observation_id = any (v_item.evidence)
       and claim.status in ('pending', 'applied')
       and claim.value is distinct from v_kept;

    -- An adjudicate that stamps nothing is refused by apply_resolution, and
    -- rightly: there is nothing to write. The item still settles below, which is
    -- the whole of what this verdict asked for.
    if jsonb_array_length(v_rejections) > 0 then
      v_decision := jsonb_build_object(
                      'kind', 'adjudicate',
                      'domain', v_item.domain,
                      'entity_id', v_item.entity_id,
                      'field', v_item.field,
                      'incumbent_observation_id', v_incumbent,
                      'rejections', v_rejections
                    );
    end if;
  end if;

  -- settle, fixed and wont_fix reach here with v_decision null and write no
  -- canonical value at all: their whole effect is the settlement and the row.

  -- ── the canonical write, if this verdict makes one ─────────────────────────
  -- apply_resolution does not raise on a decision it refuses: it answers
  -- outcome failed with the SQLSTATE that refused it, or skipped when the fact
  -- moved under the decision. Either would leave a verdicts row and a settled
  -- item claiming a write that did not happen, so anything but settled is
  -- raised here and takes the whole settlement back.
  if v_decision is not null then
    select settled.outcome, settled.refusal_code, settled.explanation
      into v_outcome, v_code, v_explanation
      from public.apply_resolution(jsonb_build_array(v_decision)) as settled;

    if v_outcome is distinct from 'settled' then
      raise exception 'verdict refused: the canonical write was %: %',
                      coalesce(v_outcome, '<no answer>'),
                      coalesce(v_explanation, '<no explanation>')
        using errcode = 'KS030',
              detail  = format('action=%s outcome=%s refusal_code=%s', v_action,
                               coalesce(v_outcome, '<none>'),
                               coalesce(v_code, '<none>')),
              hint    = 'a skipped decision means the fact moved while the '
                        'verdict was being made - read the item again and '
                        'decide against what the ledger now holds';
    end if;
  end if;

  -- ── the ending every branch shares ─────────────────────────────────────────
  -- The item is settled here and in no other statement of this file, and by no
  -- other writer in the schema.
  if v_item_id is not null then
    update public.review_items as item
       set status = 'settled'
     where item.review_item_id = v_item_id;
  end if;

  -- And the verdict lands: the settlement and the override are one row, the
  -- difference between them carried by the nullable review_item_id.
  insert into public.verdicts as written
         (review_item_id, actor, action, observation_id, note)
  values (v_item_id, v_actor, v_action, v_observation, v_note)
  returning written.verdict_id, written.created_at
       into v_verdict_id, v_created_at;

  return query
    select v_verdict_id, v_item_id, v_action, v_observation, v_created_at;
end;
$$;

alter function public.settle_review_item(p_decision jsonb) owner to postgres;

comment on function public.settle_review_item(p_decision jsonb) is 'The one entry point for a verdict (contracts/admin-observability.md section 7): the ONLY writer of public.verdicts and the ONLY setter of review_items.status. Takes ONE typed decision - action, review_item_id, actor, note, value{domain, entity_id, field, observation_id, value, ref} - and branches inside, in one transaction, so a settlement''s apply and its rejections share a timestamp. choose_claimed_value, supply_value and override write the admin-tier observation through ingest_observation and apply it through apply_resolution with the rejections the verdict implies (rejected_by = verdict); link_entity does the same for a reference field and writes the confirmed match the link stage reads; keep_current carries rejections alone through the adjudicate kind, canonical standing; settle, fixed and wont_fix write no canonical value. An override enters item-less (review_item_id null) and settles nothing. wont_fix with a null or blank note is refused KS028. Refuses KS027 a decision whose shape, keys, action or payload this function does not accept, KS029 an item that is absent or already settled, KS030 a canonical write that did not settle, and KS001 a domain with no registered schema; the gate''s own KS codes reach the caller unchanged. Neither the schema version nor the source name arrives from the caller: both are resolved here';

-- ── 3. Who may call it ───────────────────────────────────────────────────────
-- The standard revoke pair, exactly as apply_resolution carries it
-- (20260901000006). The revoke is the half that does the work: on this project
-- ALTER DEFAULT PRIVILEGES grants a newly created function EXECUTE to public,
-- anon, authenticated AND service_role, so a create with a grant beside it and
-- no revoke installs an open door while reading as if it did not. service_role
-- is what the Admin dashboard holds, and it is the only role that keeps EXECUTE.

revoke all on function public.settle_review_item(p_decision jsonb) from public, anon, authenticated;
grant execute on function public.settle_review_item(p_decision jsonb) to service_role;

-- PostgREST resolves an RPC out of its cached schema and would go on answering
-- PGRST202 for this function until the next reload, which the dashboard reads as
-- "not installed".
notify pgrst, 'reload schema';
```

## 3. Every identifier this file names, and where it is defined

Read from `/Users/ben-m4/Desktop/Coding/KPOP/kspace Scraper/supabase/migrations/`
on 2026-09-08. Nothing above was invented to make the file read well: an
identifier that did not resolve there, with matching arity, would have been a
question for you rather than a line in this block.

| identifier | what it is | defined in |
| --- | --- | --- |
| `public.verdicts` | the table this function is the only writer of; `verdict_id` defaults from `public.uuid_generate_v7()` and `created_at` from `now()`, which is why the insert names neither | **not in the sibling yet** — `M2-handoff-verdicts.md`, target `20260908000001_the_verdict_becomes_a_row.sql`, which is why that file is applied first |
| `public.sources` | the source registry §1 registers the admin voice in; conflict target `sources_source_key UNIQUE ("source")`, shape CHECK `sources_source_shape` (`^[a-z0-9_]+$`), and `source_id` is what `confirmed_matches` references | `20260818000000_the_schema_arrives_as_one_snapshot.sql` |
| `public.source_kind`, `public.source_lifecycle`, `public.source_tier` | the three enums §1's values come from — `registered`, `active`, `admin` are each declared members | `20260818000000_the_schema_arrives_as_one_snapshot.sql` |
| `public.ingest_observation(p_source text, p_domain text, p_entity_id uuid, p_field text, p_value jsonb, p_schema_version integer, p_external_ref text, p_payload_ref text, p_observed_at timestamptz)` | the gate: the only way an observation is written. Refuses an unregistered source (KS007) and validates the value against `domain_schema`. Called by name here, so the two optional arguments default | `20260821000003_the_gate_refuses_empty_values_and_future_observations.sql` (current body); the nine-argument signature is `20260819000002_the_domain_is_the_entity_type.sql` |
| `public.domain_schema(p_domain text, p_version integer)` | the registry compiled into SQL; returns the value schema, or NULL for a version it does not answer for — which is what §2 resolves the domain's current version off | `20260829000004_events_take_up_the_third_schema.sql` (events v3, venues v2) |
| `public.apply_resolution(p_decisions jsonb)` | the one write path into canonical. Takes an ARRAY of decisions (`apply`, `unset`, `create`, `adjudicate`, `link`) and answers one row per decision — `outcome`, `refusal_code`, `explanation` are the three columns read here. The fact keys used (`field`, `column`, `observation_id`, `reference_entity_id`, `tier_at_apply`, `admin_locked`) are its own `c_fact_keys` | `20260901000006_the_stamp_the_bill_and_the_link_get_their_arms.sql` |
| `public.review_items` | the queue; `status` admits exactly `open` and `settled`, `evidence` is the `uuid[]` of the observation ids behind the values the summary names, and the one-open-per-subject index is PARTIAL on `open`, so settling never blocks a new item | `20260901000002_the_review_item_opens_once_per_subject.sql` |
| `public.observations` | every claim by every source; `value`, `status`, `entity_id`, `field`, `domain` are read here, and the rejection stamps this function's decisions write are `rejected_at` / `rejected_by` | `20260818000000_the_schema_arrives_as_one_snapshot.sql`; the stamps are `20260901000003_an_adjudicated_claim_carries_its_stamp.sql` |
| `public.confirmed_matches` | the confirmed-match store, keyed `(source_id, domain, external_ref)`; `matched_by`'s CHECK already admits `'verdict'` | `20260829000003_a_confirmed_match_is_stored_once.sql` |
| `events.venue_id` | the canonical column a `venue` reference produces — the one reference mapping §2 spells | `20260825000002_canonical_event_storage_stands_up.sql` (`events_venue_id_fkey`); the `venue` field is declared in `20260829000004` |
| `public.uuid_generate_v7()` | the PK default behind `verdicts.verdict_id` (named by the companion file, not by this one) | `20260818000000_the_schema_arrives_as_one_snapshot.sql`; its revoke/grant pair is `20260821000002_the_foundation_functions_get_their_revoke_grant_pair.sql` |
| `public`, `anon`, `authenticated`, `service_role` | Supabase's managed roles. This project's `ALTER DEFAULT PRIVILEGES` hands a newly created function EXECUTE to all four (measured on staging 2026-09-01 and recorded in `20260901000006`'s header), which is why §3 is written as a revoke with one grant after it — the same pair `apply_resolution` carries | `20260818000000_the_schema_arrives_as_one_snapshot.sql`; the pair is copied from `20260901000006` |
| `KS027`, `KS028`, `KS029`, `KS030` | the four SQLSTATEs this file allocates, in the sibling's own grammar. A grep of that directory on 2026-09-08 shows `KS001`–`KS026` in use and nothing above it, so these collide with none; **if the resolver campaign has since taken them, renumber here** | allocated by this file; the grammar is `20260821000003`'s and `20260901000005`'s |

## 4. The four things worth a second look before you paste

1. **The schema version is resolved by search, not by a number.** The envelope
   may not carry one (ARCHITECTURE §9.2), and nothing installed answers "what
   version is `events` at" directly: `domain_schema` is a `case` that answers for
   the versions the registry compiled and NULL for the rest. So §2 asks it for
   every version from 1 to 64 and takes the highest it answers for — 3 for
   `events`, 2 for `venues` today. It is an `immutable` SQL function, so the
   scan is 64 evaluations of a constant-folded `case` inside one transaction,
   not 64 queries. **If you would rather the function be told**, the alternative
   is a registry-owned `domain_current_version(domain)` in the scraper repo and
   one line here calling it; that is your call, and this file is written so that
   swapping the one `select max(...)` is the whole change.
2. **The one reference mapping is spelled in the function**, in the `if v_domain
   = 'events' and v_field = 'venue'` arm: the canonical column `venue_id` and
   the referenced domain `venues`. Neither is derivable from the value schema —
   it declares `venue` as `{"ref": …}` and stops there — and ARCHITECTURE §9.2
   names this as the registry's one exception. Any other field arriving with a
   `ref` is REFUSED rather than guessed at, so a second reference field fails
   loudly here and gets a patch, which is the behaviour I would want and not
   necessarily the one you would.
3. **Who gets rejected, and who does not.** The rejection set is the item's own
   `evidence` claims that are still live AND whose value differs from the value
   that stands after the settlement. The claim an admin ADOPTS is therefore not
   stamped — a rejection covers a value rather than a row (`contracts/resolver.md`
   §7 step 0b), and stamping the source that was right would block it from ever
   re-asserting its own correct value, because the settlement's apply shares the
   rejection's timestamp and so never lifts the block. A claim that arrived
   after the item last folded is not in `evidence` and is left pending, to be
   weighed next cycle: it is not stamped by a human who never saw it.
4. **`link_entity` applies now rather than next cycle.** The envelope
   (`src/lib/verdict/decision.ts`) carries `ref` as "the chosen entity id, as the
   admin source's own `external_ref`", beside a non-null `entity_id` and a
   `field` — so a `link_entity` decision is about a REFERENCE FIELD of a row that
   exists, which is F12's picker, and SPEC F12 says that choice "lands as the
   admin-tier observation plus its confirmed match, so the apply produces
   `venue_id`". This file therefore writes the observation, writes the match, and
   applies — the item settles with the link visible, instead of the operator
   waiting up to a cycle to see their own decision land. **If you meant the match
   alone**, delete the `reference_entity_id` line and the apply for that one
   action; nothing else moves.

## 5. How this file is graded before it reaches you

No database, no `psql`, no dry run (SPEC F9: the bar is your review).
`tests/offline/handoff/settle-review-item.test.ts` extracts the one fenced block
above and asserts its structure — one `create function`, the declared parameter
name against `SETTLE_ARGUMENT`, the action array against `VERDICT_ACTIONS`, both
key arrays against `VerdictDecision` and `VerdictValue`, both source literals
against `ADMIN_SOURCE`, the `wont_fix` guard keyed on a note that is null OR
blank, exactly one writer of `verdicts` and one setter of `review_items.status`,
the idempotent `sources` insert, no `commit` / `dblink` / autonomous
transaction, balanced `$$` and `begin`/`end`, no table privilege touched, and
the EXECUTE the revoke pair leaves each role holding. Each of those is proved on
a doctored copy of this block that must go red as well as on the block itself.
The stored checks on the ticket resolve every identifier of §3 in your
migrations directory by absolute path.
