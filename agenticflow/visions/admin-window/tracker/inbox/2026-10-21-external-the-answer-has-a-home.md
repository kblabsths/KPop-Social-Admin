# 2026-10-21 — external scraper-side work done: the answer has a home

*From the engineer working the scraper repo, answering
`tracker/for-human/2026-10-21-the-answer-has-nowhere-to-go.md` under Ben's approval of
the same day. Committed in `kspace Scraper` on `main`; applied to STAGING; production is
Ben's supervised push and has not happened yet. Nothing in this repo was changed except
`agenticflow/docs/DECISIONS.md` and `agenticflow/docs/LESSONS.md`.*

## 1. Two corrections to the handoff, before the build

- **No domain registration is needed.** A Name-matches answer lands in
  `confirmed_matches` keyed by the SIGHTING source's own reference —
  `(source_id, 'groups' | 'idols' | 'venues', external_ref)` — with the chosen row's id
  and `matched_by = 'verdict'`, or with `ruling = 'not_kpop'` and no entity. The store
  has accepted that since `20260911000001`, and the resolver reads it end to end
  (`resolver/ledger.py a_reference_is_settled`, `resolver/cycle.py THE_LINK_COLUMNS` →
  `event_performers.group_id / idol_id`) and self-settles the item on its next cycle.
  No observation is written against `groups` or `idols`, so the registry is never asked
  about them. ROADMAP 9 stays a design-queue item on its own merits.
- **"Not in scope" already exists and is spelled `not_kpop`** (contracts/entity-linking.md
  "A ruling is a store row"; admin-observability.md §7 "rule `not_kpop`"). The action
  name is `rule_not_kpop`.

## 2. What the scraper migration installs — `20261021000002_a_reference_item_takes_its_answer.sql`

1. `verdicts_action_check` grows one value: **`rule_not_kpop`** (ninth). The eight
   keep their order.
2. `settle_review_item` is re-issued with a **reference arm**, taken when the item's
   `external_ref` is not null (the `entity_link_source_pattern` shape):
   - **`link_entity`** — `value` is **`{ "domain": <groups|idols|venues>, "ref": <row uuid> }`**
     and nothing else. `entity_id`, `field`, `observation_id`, `value` are REFUSED on a
     reference item (KS029). The row must exist in the named table (KS029 otherwise).
     Writes the `confirmed_matches` row under the item's own `source_id` + `external_ref`,
     re-pointing a row already standing. No observation; `observation_id` on the receipt
     is null.
   - **`rule_not_kpop`** — no `value` (KS029 if one is sent). Writes a `not_kpop` ruling
     row under `groups` AND under `idols`. Note optional in the function (Ben: enforce it
     on the Admin form).
   - **`settle`, `fixed`, `wont_fix`** — unchanged.
   - `choose_claimed_value`, `supply_value`, `keep_current` on a reference item → KS029.
   - **Venue reference items**: the arm tells a venue item from a catalog item by its
     `evidence` (a venue item's candidate ids are `venues` rows; a catalog item's are
     `groups`/`idols` rows or none). On a venue item `link_entity` must name `venues`,
     and `rule_not_kpop` is refused.
   - `rule_not_kpop` on any non-reference item → KS029.
3. Everything else in the function is `20261016000001`'s body unchanged (the fact-shaped
   `link_entity` for `events.venue`, the gate path, the codes). No new KS code.

Receipts in the scraper repo: `tests/acceptance/resolver/test_a_reference_item_takes_its_answer.py`
(live: both answers driven through the installed function and read back, the resolver's
own reader confirming "settled", every refusal KS029 with the item left open, zero
residue) and `tests/live_safety/test_a_reference_item_takes_its_answer.py` (offline).

## 3. What Admin can now build (your `2026-10-21-plan-after-the-migrations.md`, adjusted)

- `VERDICT_ACTIONS` + `PAYLOAD_SLOTS`: add `rule_not_kpop` as a no-value action. The
  handoff test that grades the M2 note's fenced SQL stays as it is (dated record).
- `ACTIONS_BY_SHAPE.entity_link_source_pattern`: `link_entity` (picker) and
  `rule_not_kpop` (note **required** on the form), plus the disposition pair.
- **The picker's candidates ARE readable from the item**: `review_items.evidence` on a
  reference item holds the ranked candidate entity ids, best first (not observation
  ids). Resolve each id against `groups` (`id`, `name`) and `idols` (`id`, `stage_name`)
  — an id is in exactly one of them — and seed the picker; fall back to search over both
  when `evidence` is empty. The picker sends `{domain: <the table the row came from>, ref: <id>}`.
  Admin still inserts no catalog row: the arm refuses an id no row holds.
- **The sighted name is in `summary` only**, in the resolver's fixed template:
  `{source} "{name}": {candidates} - {question}` / `{source} "{name}": {question}`
  (`resolver/summary.py`). Read the first quoted segment. Ben ruled ids out of the
  summary on 2026-10-13, so this is the designed split: names in prose, ids in `evidence`.
- Delete `patternNotice`; the close heading "Which catalog name is this?" stays right.
- Your tab-collapse observation holds: once `link_entity` works on both entity-link
  shapes, the kind distinction is a filter.

## 4. BEN — production

Staging carries `20261016000001` and `20261021000002` (pushed 2026-10-21 through a
scratch workdir with `--include-all`; both recorded in `schema_migrations`). Production
is a supervised push from the scraper repo, Ben's act. Until then the installed
production function still refuses the picker exactly as the handoff describes.
