# M2 roadmap — for Ben, before M2 builds

*Strategist, 2026-09-04, at the M1 close. Two decisions of yours are in here, and
one fork question at the bottom.*

## The build order, one line per milestone

- **M1 — the read slice, plus editing what was safe to edit today. SHIPPED**
  (tag `m1`, 26cec8d). Six pages showing real staging rows whose numbers match
  the database, six gauges, the review item and its evidence rendered, Browse's
  recent events, and `groups`/`idols` editable through one hand-written map.
  *Deliberately left out:* every verdict action, the settle button, the
  `verdicts` log, `settle_review_item`, the events/venues override path, the
  reference picker, both migrations, and every parked section.
- **M2 — the verdict slice. The campaign's LAST milestone.** The close slot fills
  in: choose a claimed value / supply a different one / keep current & settle on
  a conflict; link or settle on an entity-link item; `fixed` or `wont_fix` (note
  required) on a signal. `events` and `venues` become editable only as recorded
  overrides — an admin-tier observation through the gate, applied through
  `apply_resolution`, stamped `admin_locked`, logged as an `override` row. A
  reference field becomes a picker that links rows instead of writing text. The
  verdict log renders as a tab on Queues. And the two migrations are **authored
  complete for you to install** — nothing here applies them.
  *Deliberately left out:* installing either migration; any third schema item;
  any workaround for the absent function; **any dial, threshold, or dial-shaped
  control** — you build those yourself after this closes; a groups/idols listing
  or search (that is the fork question below); phone/responsive work; the parked
  sections, in full.
- **A patch run after you install the migrations — deferred, not a hole.** Every
  §7 action proven end to end on staging, one transaction per settlement, apply
  and rejection stamps sharing a timestamp, a killed call leaving no partial
  write, grant introspection proving `verdicts` is written by
  `settle_review_item` alone, and a reference override producing `venue_id` /
  `event_performers` rows rather than text. That is acceptance tests 6, 8 and
  test 7's override half — the one acceptance item VISION defers on purpose.
  *Deliberately left out:* everything else. It is a proof run, not a build.

**There is no M3.** VISION's own words say the campaign is satisfied when the
verdict UI is built and both handoffs are complete and reviewed. When M2 closes,
the run stops and you verify.

## What M1 actually cost, in one line

129 tickets, ~3.07M output tokens, ~51 agent-hours across 280 spawns, one run.
Builders and QA were 87% of it. Zero commits in the scraper repo, zero schema,
no key in any client bundle.

## Three things waiting on you (none is a ticket you have to write)

1. **Paste `walk_sandbox` into staging** — the ready-to-copy SQL block is in
   `agenticflow/tracker/for-human/TASK-0034.md`. Until it exists, walk agents
   that want to test the edit cell are editing one field of a real `groups` row
   and restoring it. M2 changes that cell twice, so the walks grading those
   changes would rather have the sandbox. Not a blocker; just a narrower walk.
2. **TASK-0031 is still uninstalled** — the `pending_claims` index or view
   rewrite, authored for you. The Claims page currently renders in 4.94 s against
   an 8 s statement timeout. It works today and is one dataset's growth from not
   working.
3. **Two things from the M1 close that are yours, already written up** in
   `agenticflow/tracker/for-human/M1-contract-gaps.md`: `groups.updated_at` does
   not move when Admin writes a field (the only honest fix is a trigger, which is
   schema, which this repo may never carry), and the local `.env` `AUTH_SECRET`
   is the published placeholder from `.env.example` — worth rotating.

## Two tuning knobs I'd flip for M2, if you agree

Both are `agenticflow/run.yaml`, both are yours, and neither changes what gets
built:

- `qa_batch_patience: 0 → 2`. QA was 40% of the run's tokens and spawned 1:1 with
  builders, including for lone P3 tickets that touch no rendered surface. Its
  quality is not in question — 44 of 48 tickets it opened were real fixes and
  **zero** were closed `no_change`, the best signal-to-noise of any role. This
  just batches the small ones. P0/P1 are unaffected.
- `compact_threshold_bytes: 16000 → 20000`. Six of thirteen compactor spawns
  concluded, correctly, that the ticket's History could not shrink because it was
  a verbatim architect ruling a builder had to obey. That knob is documented for
  exactly this house style.

## The second question, small and cheap

**The group row's own provenance is on the row and not on the screen.** A
`groups` row carries `source`, `source_url`, `source_page_id`, `source_rev_id`,
`source_license` and `last_synced_at` — a stranger found `source: fandom` with a
live wiki URL and a revision id sitting in the database — while the record page
shows none of them and says "no provenance recorded (pre-cutover table)". You
ruled the wording of that slot on 2026-09-02, so nobody here is overturning it.
It is a display list on an already-vetted table, not schema, and it is the
cheapest thing in either walk report that would have changed a walk's outcome.
**Want it? One patch ticket. Say no and it stays as you ruled it.**

## The fork question

**Groups and idols have no door, and only you can open one.**

M1 shipped `/records/groups/<uuid>` complete and keyboard-navigable — it was the
single most-praised surface of either stranger walk ("the part of the tool I'd
come back for"). Nothing in the app lists it, links it, or searches for it. One
stranger spent fifteen minutes and twenty-one page loads establishing that the
entity she was asked about could not be reached, and finished in a SQL client:
*"Once I've opened a SQL client to find the row, I have very little reason to
come back to the browser to edit it."* Her verdict on the shape of it: *"'Why did
it win' has an honest answer for events and no answer at all for groups."*

This is excluded by contract, not overlooked — the spec ships **one** curated
view and forbids a second, so I cannot trace a listing or a search to VISION
honestly and I have not built one. Three prices, cheapest first:

1. **Nothing.** The operator pastes a uuid. Costs zero; the asymmetry is
   deliberate and the app's copy no longer lies about it (BUG-0052 is fixed).
2. **A groups/idols entry point on Browse** — a row count or a link. Still one
   curated view by a narrow reading. Small.
3. **A name lookup** — type "Seven O'Clock", land on the record. This is a second
   view and it is the thing the stranger said would make the tool her default.
   It needs your word, and it is the largest of the three.

M2 will connect idols and groups to each other regardless (a reference renders as
a link, which the events→venue rendering already does) — but that is not a door:
you still need one uuid to get in.

---

**This is the build order — does it match what you want to see working first?**
