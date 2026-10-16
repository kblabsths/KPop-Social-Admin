# Ben, 2026-09-16: §7 acceptance walk report (closes TASK-0084 partially, TASK-0085, TASK-0086)

Ben's words: "Test D: Looks like the edit worked, but the sql does not run. Overall, all the tests succeeded other than this point."

Dispatcher's read-only verification on staging, 2026-09-16 ~00:10Z:
- Step A (choose_claimed_value, item 01a092e9-…): PASSED — event 01a03c9b-… title is `XG` again (admin observation applied 00:01:14Z); BUG-0215's residue is repaired through the one write path. `residue.live` should now be green.
- Step B (fixed / wont_fix on two entity_link signal items): PASSED per Ben.
- Step C (scalar override): PASSED — Ben used event MONSTA X CONNECT X (01a09c5e-5d61-…): title override at 00:05:10Z, admin_locked provenance row, verdict `override` with null review_item_id.
- Step D (reference-field override): PASSED — same event: venue ref observations at 00:07:25Z (superseded) and 00:08:55Z (applied); `events.venue_id` = 01a09c5d-ffdb-…; `confirmed_matches` row matched_by `verdict`; provenance admin_locked. Ben's "the sql does not run" was the script's fault: it named a `matched_at` column that does not exist (`confirmed_at` does) and left a placeholder; the link itself landed.
- Skipped, not walkable on today's staging: supply_value, keep_current (no further data_conflict items), link_entity, settle (no entity_link fact items).

Routing: TASK-0085 and TASK-0086 → done (verified by Ben's walk); TASK-0084 → done for the five actions proven, with the three skipped actions recorded as pending the item kinds above (strategist's call whether that is a partial close or a follow-up note). DECISIONS: §7 acceptance is a human walk on staging, never an automated live test (Ben, 2026-09-15).
