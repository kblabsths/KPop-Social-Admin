# External ticket — the §7 acceptance walk, done by Ben (replaces TASK-0084/0085/0086 as automated tests)

*Written by the admin-window dispatcher on 2026-09-15 from Ben's decision of
the same day: a proof that must write shared staging state is a human act, not
a suite that runs on every push. You do the walk on your own instance; every
row it leaves is legitimate operator usage, not test residue.*

## Before you start

- Your instance: `http://localhost:8771` (dev server on the primary checkout,
  `run/admin-window`, Google login). If it is down, launch it with the block
  in `agenticflow/docs/STACK.md` §5 step 1.
- The read-only checks below are `SELECT`s for the **staging** SQL editor
  (project `ubfjjqlvnpnoborczbdb`). Nothing here asks you to write SQL.
- What staging holds today (measured read-only 2026-09-15): 85 review items —
  56 open `entity_link` source-pattern items and 28 settled (the entity-linking
  campaign's), and **one** open `data_conflict` item, which the pipeline opened
  on the very event the 2026-09-11 test damaged. So the walk can prove **five
  of the eight actions today**; the other three need item kinds the pipeline
  has not opened yet (see the last section).

## Step A — `choose_claimed_value` (test 6), and it repairs BUG-0215's residue

The pipeline noticed the probe title and opened a conflict: ticketmaster claims
`XG`, admin claims `admin-window/TASK-0018 probe override`. Adopting the
ticketmaster claim through the UI is both the acceptance proof and the proper
repair — a verdict, through the one write path — which is why the SQL update
was never the right tool.

1. Open `http://localhost:8771/queues/01a092e9-830d-7d3a-b2ee-07794a5dcf43`.
2. In the close slot, choose the **ticketmaster** claim (`XG`) as the value
   (the action is "choose claimed value"). Confirm.
3. Expect on screen: the item reads as settled; the record link shows title `XG`.
4. Check, read-only:
   ```sql
   select status from public.review_items where review_item_id = '01a092e9-830d-7d3a-b2ee-07794a5dcf43';          -- settled
   select action, actor, review_item_id, observation_id, created_at from public.verdicts order by created_at desc limit 1;  -- choose_claimed_value, your email, that item
   select title from public.events where event_id = '01a03c9b-1d28-707d-9873-f73ab3add10c';                        -- XG
   select source_id, admin_locked, applied_at from public.field_provenance
    where entity_id = '01a03c9b-1d28-707d-9873-f73ab3add10c' and field = 'title' order by applied_at desc limit 1; -- newest row is the verdict's
   ```
5. From the Admin repo: `npm run test:live -- tests/live/residue.live.test.ts` → green (the marker title is gone).

## Step B — `fixed` and `wont_fix` (test 6, signal dispositions)

These are the entity-linking campaign's items; you own both campaigns, so
settling two of 56 is your call. Pick two open ones from
`http://localhost:8771/queues` (queue `entity_link`, the source-pattern rows).

1. On the first: **fixed**. Confirm. Expect: settled; a verdict row `fixed`.
2. On the second: **wont_fix** with the note left blank → expect the refusal
   naming the note (KS030 behind it); then with a note → settled.
3. Check:
   ```sql
   select action, note, review_item_id, created_at from public.verdicts order by created_at desc limit 2;
   ```

## Step C — an override on a scalar field (test 7's override half, TASK-0085)

1. Open a record page for an event you do not mind editing, e.g.
   `http://localhost:8771/records/events/01a09c5e-5c1d-71cf-8044-fc1cf992db20`
   (ITZY, Amsterdam; no venue yet, which Step D uses).
2. Edit one editable text field (the page shows which columns are editable);
   append ` (walk)` to its value and save. Expect: the page says the edit was
   recorded as an admin override and shows the new value.
3. Check:
   ```sql
   select action, review_item_id, observation_id, created_at from public.verdicts order by created_at desc limit 1;   -- override, review_item_id NULL
   select value, status, observed_at from public.observations
    where entity_id = '01a09c5e-5c1d-71cf-8044-fc1cf992db20' and source_id = (select source_id from public.sources where source = 'admin')
    order by observed_at desc limit 1;                                                                                  -- your value, applied
   select field, admin_locked, applied_at from public.field_provenance
    where entity_id = '01a09c5e-5c1d-71cf-8044-fc1cf992db20' order by applied_at desc limit 1;                         -- that field, admin_locked = true
   ```
4. Optionally set the value back with a second override (it will also be
   admin-locked; that is the design: an admin value is not displaced by a scraper).

## Step D — a reference-field override lands as a link, never text (test 8, TASK-0086)

1. Same record page. The venue is a **picker**, not a text cell. Pick a real
   venue (any Amsterdam venue in the list). Save.
2. Expect: the page shows the linked venue by name; no text was written into
   an events column.
3. Check:
   ```sql
   select venue_id from public.events where event_id = '01a09c5e-5c1d-71cf-8044-fc1cf992db20';   -- a uuid, not null
   select * from public.confirmed_matches where external_ref = '<that venue uuid>' order by matched_at desc limit 1;  -- matched_by = 'verdict'
   select action, created_at from public.verdicts order by created_at desc limit 1;               -- override
   ```
   `event_performers` is untouched by this step (no performer edit was made).

## Not walkable today — say so in your report

- `supply_value` and `keep_current` need further open `data_conflict` items;
  staging has only the one Step A consumes. They become walkable the next time
  the resolver opens a conflict.
- `link_entity` and `settle` need `entity_link` **fact** items (an event whose
  venue claim is awaiting a link). Staging's 56 open items are all
  source-pattern signals, so neither action has an item to act on yet.

## Report back

Tell me, per step, "passed", "failed at <n>: <what you saw>", or "skipped". I
route your report so the three tasks close on it (TASK-0084 partially — five of
eight actions proven, three pending the item kinds above), and I record in
DECISIONS that §7 acceptance is a human walk, not an automated live test.
