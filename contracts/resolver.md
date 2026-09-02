# Resolver Mechanics — Design

- Status: **DESIGN** — drafted 2026-08-31, reviewed section by section and
  **approved in full 2026-09-01** (§1–§13, Implementation notes, and the three
  parked sections).
- Purpose: the sole writer of canonical — how claims are weighed, applied, held,
  and escalated; ROADMAP queue item 3.
- Parent: [ECOSYSTEM.md](../ECOSYSTEM.md) §3 (trust & resolution), §4 (freshness).
- Depends on — concepts owned elsewhere:
  - **observation / envelope / fact & claim identity / status lifecycle /
    change-only rule** — the one claim format; live = `pending` or `applied`
    ([data-model.md](data-model.md))
  - **the ingest gate** — the only write path into `observations`; Postgres
    functions with stable KS refusal codes ([data-model.md](data-model.md))
  - **canonical / `field_provenance`** — the master tables the app reads; every
    canonical write appends per-field provenance in the same transaction
    ([data-model.md](data-model.md), [events-canonical-storage.md](events-canonical-storage.md))
  - **domain registry** — per-field `mutability`, `severity`, `freshness`,
    `kind: reference`; per-domain `creation` and `resolver.windows`. A
    domain's `creation` is `open` — a canonical row may be created at
    resolution on first sight (`events`, `venues`) — or `curated` — only
    humans create rows (`groups`, `idols` today)
    ([data-model.md](data-model.md))
  - **adapter / run loop / `runs` rows** — how observations arrive and how a
    run's success is recorded ([adapters.md](adapters.md))
  - **record** — the claims sharing one `(source, domain, external_ref)`: one
    source's whole picture of one entity, as the adapter emitted it
    ([adapters.md](adapters.md), [entity-linking.md](entity-linking.md))
  - **entity linking / the matcher / `confirmed_matches`** — matching a claim to
    its canonical row; cascade steps 1–3 built, step 4 pending
    ([entity-linking.md](entity-linking.md))
  - **review item / queues / verdict** — the escalation surface; a verdict writes
    an admin-tier observation ([admin-observability.md](admin-observability.md))
  - **earned autonomy / audit sampling** — how machine judgment graduates and
    stays checked ([ai-learning.md](ai-learning.md))
  - **trust scores** — the outcome record and the future formula
    ([trust-scores.md](trust-scores.md))
  - **interim writer** — the hand-run event writer that filled canonical before
    the resolver existed; its rows are unprovenanced (`intake/` in the scraper
    repo)

## 1. Goals

**The resolver is the only writer of canonical: it compares all live claims for
a fact and decides what the app should see.** Weighing is deterministic and
replaceable policy, never per-case code: the v1 procedure weighs the claiming
source's tier and the field's mutability class — one versioned function over a
ledger that keeps every losing claim, so a finer algorithm later (corroboration
when windows land, per-source reliability, learned weights) is a function swap,
not a redesign ([§7](#7-the-weighing-procedure)).

**Every examined fact's resolution ends in exactly one of three outcomes —
apply, hold, or escalate — and leaves a record.** A fact with no live
contender is not examined at all, and a claim adjudicated out is stamped,
never silently dropped ([§7](#7-the-weighing-procedure)). An apply updates
canonical and stamps
provenance in one transaction ([§8](#8-applying-the-transaction)); a hold
waits on an unlinked reference (later: in a corroboration window), and every
hold names its reason in a view; an escalate opens a review item
([§11](#11-escalation-and-review-items)). Silent wins stay
browsable in the standing-disagreements view.

**Nothing is trusted or discarded on arrival.** Tier rules bound what a
low-trust claim can displace; corroboration windows — designed, deferred from
the v1 build until the first below-`trusted` source collects
([out of scope](#out-of-scope-for-v1-corroboration-windows)) — will
additionally make such claims wait for contradiction. Conflicts escalate to the inbox
([§11](#11-escalation-and-review-items)); active verification — deferred to
the AI-assists build — later screens what reaches it
([out of scope](#out-of-scope-for-v1-active-verification)).

**Freshness is part of resolution: time alone never changes confidence — only
evidence does.** Confidence itself is a property of claims, not canonical
rows: per-claim confidence arrives with AI extraction as a weighing input
([§10](#10-confidence)); a row's "contested" is derived from its open review
items, never stored.

## 2. Trust tiers

| Tier | Sources start here |
|---|---|
| **admin** | admin edits / override tickets — definitional, not earned or measured |
| **official** | official structured APIs (Ticketmaster, Spotify) |
| **trusted** | licensed wikis (kpop.fandom.com); sources promoted by track record |
| **standard** | HTML scrapes, AI extraction from unstructured text |
| **untrusted** | user submissions, cited websites |

- **Low-tier** in this document means `standard` or `untrusted`.

## 3. Trust score mechanics

- Every upheld/overruled outcome is recorded with its context (domain, field, tier
  gap, etc.). A single accuracy percent is deliberately not the model — sources report
  different kinds of facts, at different difficulty and volume. The scoring
  formula is a child design ([trust-scores.md](trust-scores.md)), built from
  this data once enough exists.
- Tier movement: demotion automatic and prompt (a large drop opens an incident);
  promotion above the starting tier needs sign-off. Until the trust-score formula
  lands, every tier move takes human sign-off. Changes require clear, sustained
  evidence — no bouncing at boundaries.

## 4. Mutability classes

- **Immutable** (e.g. birth_date, real_name, debut_date, a venue's name):
  disagreement = someone is wrong, and recency is irrelevant; how such a
  conflict resolves is the weighing procedure's
  ([§7](#7-the-weighing-procedure)). Immutability is a
  weighing class, not a column lock: the canonical value still changes through a
  merge, an admin verdict, or a corrected higher-tier claim — a venue's
  sponsorship rename is a `name` update under the same row, the old name joining
  its aliases ([events-canonical-storage.md §5](events-canonical-storage.md#5-venues)).
  Immutable fields carry no freshness expectation, so a source need not re-assert
  them ([adapters.md §4](adapters.md#4-references-and-linking)).
- **Mutable** (e.g. event status/date/venue, agency, group status): the world
  changes, so recency matters — newer supersedes older; which tiers may
  displace which is the weighing procedure's
  ([§7](#7-the-weighing-procedure)).
- **Selection** (images, galleries): candidates pool as ordinary observations;
  canonical holds a selection made by the resolver's curation rule ([§7](#7-the-weighing-procedure));
  admin pin overrides and sticks. A factually wrong candidate exits via user
  report or admin verdict rejecting that observation from the pool.
- Assignment: per field, once, at registration — AI-drafted, human-approved during
  bootstrap, automated via earned autonomy. Misclassification self-detects: an
  "immutable" field that keeps legitimately changing → review item.
- Silent never means unrecorded: the losing claim stays a live row, browsable in the
  standing-disagreements view, spot-checked by audit sampling. A pattern of the
  lower source being right is promotion evidence.

## 5. Admin stickiness

- Scrapers never silently overwrite an admin-tier value.
- New contradicting evidence after an admin edit opens a review item; one open item
  per fact — repeats fold in.
- Reopen verdicts are labeled data from day one ("kept" / "released"); classes of
  systematically-releasable locks get designed later from that data.

## 6. The cycle

- **The resolver is one process on a cron** — `python -m resolver.run`, every 15
  minutes (a dial), on Railway beside the collection crons. One per-resolver
  advisory lock; a cycle that finds the lock held ends `skipped` and writes its
  row.
- **A cycle is stateless: it recomputes outcomes from the ledger.** Work is
  discovered by query, not by queue — the facts worth a look are exactly:
  - any fact identity with a live `pending` claim whose value differs, as
    stored, from the applied value — a contender: new, or a standing
    disagreement (no applied value counts as differing). A live claim that
    agrees with canonical is not a contender and does not put its fact up
    for examination: the fact stays out of `facts_examined`, and the claim
    rests `agreeing` in the pending-claims view (§7). It still sits in
    the pool as an other live claim, which is what defends the value if a
    real contender later triggers a contest.
  - any unlinked live claim (entity linking's re-attempt, then creation —
    [§9](#9-entity-creation-and-adoption))
- **Writes happen only on an outcome change** — a held fact that stays held
  writes nothing; recomputing it is idempotent and, at this catalog's scale,
  cheap. `facts_examined` vs writes is a gauge; a watermark is the known
  optimization when it hurts.
- **Domains resolve in reference order** — a cycle processes `venues`, then the
  catalog domains, then `events`, so a reference's target has its chance to
  exist before the referencing record is weighed.
- **One `resolution_runs` row per cycle**; client roles hold no privilege on
  it:

| column | type | constraints / default | meaning |
| --- | --- | --- | --- |
| `run_id` | uuid | PK, `default uuid_generate_v7()` | the cycle |
| `started_at` | timestamptz | not null, `default now()` | inserted at cycle start |
| `ended_at` | timestamptz | nullable | set at completion; null = still running |
| `outcome` | text | CHECK (`succeeded`, `failed`, `skipped`); null until completion | `skipped` = the advisory lock was held |
| `facts_examined` | integer | not null, `default 0` | fact identities weighed |
| `applied` | integer | not null, `default 0` | facts whose winner was written to canonical |
| `held` | integer | not null, `default 0` | facts left waiting: unlinked reference, creation bar, standing disagreement |
| `escalated` | integer | not null, `default 0` | review items opened or folded into |
| `entities_created` | integer | not null, `default 0` | canonical rows created ([§9](#9-entity-creation-and-adoption)) |
| `claims_linked` | integer | not null, `default 0` | unlinked claims the matcher resolved this cycle |
| `claims_rerejected` | integer | not null, `default 0` | step 0b re-rejects; the per-source breakdown (who keeps pushing settled values) derives from the rejection stamps |
| `errors` | integer | not null, `default 0` | per-fact failures, skipped and retried next cycle |
| `error_summary` | text | nullable | first failure |

  Per-fact records are the artifacts the outcomes themselves write: an apply
  is a `field_provenance` row, an escalate is a review item, a hold is
  recomputable — "every run is recorded" is carried by the cycle row plus
  those, not by a per-fact log row per cycle.

`Rationale`

- Event-driven resolution (trigger per arriving claim, LISTEN/NOTIFY or a gate
  hook): 4/10 — the gate is frozen and would need a breaking change to enqueue;
  claims arrive in six-hourly bursts anyway, so latency is set by collection
  cadence, not resolver cadence; a 15-minute poll is indistinguishable in effect
  and has no queue to corrupt.
- A dirty-facts queue table: 5/10 — saves the scan, but adds the one thing a
  stateless cycle doesn't have: state that can disagree with the ledger. The
  scan is over live `pending` claims — thousands of rows, indexed; buy the
  watermark only when the gauge says so.
- A per-fact resolution log row every cycle: 2/10 — a held fact would write a
  row every 15 minutes forever; the append-only decision record already exists
  where it matters (`field_provenance`, review items).

## 7. The weighing procedure

The steps below are the v1 policy. They run per fact identity, over the
fact's live claims (the latest row per claim identity), with the registry's
field settings — one pure function: claims and registry in, one outcome out,
which is what makes the policy unit-testable offline. The function is the only
place policy lives: versioned in git, called only by the cycle
([§6](#6-the-cycle)). A better algorithm later replaces the function body and
nothing else; because the cycle is stateless, a new policy re-adjudicates
every standing disagreement on its first cycle, with no migration and no
backfill.

- **Step 0 — admin lock.** If the fact's current provenance is `admin_locked`:
  any live non-admin claim disagreeing with canonical folds into the fact's one
  review item ([§5](#5-admin-stickiness)); nothing applies. A newer admin-tier
  claim applies (admin supersedes admin) and re-locks.
- **Step 0b — settled values.** A rejection covers a value, not a single row.
  When a source re-asserts a value that was already rejected for this fact,
  the new claim is rejected again, automatically — no escalation, and the
  settled review item stays untouched. The block lifts by itself in exactly
  two cases, because both are new evidence: the source asserts a *different*
  value, or the fact moves (a new apply lands after the rejection). Either
  enters resolution normally.
- **Step 1 — by mutability class**:
  - **selection** → no true value to adjudicate; the resolver curates from
    the pool (the fact's live claims). The rule — `newest_wins`, the one
    policy name the registry may use: the newest claim (`observed_at`) from
    the highest tier that has live claims. An applied admin-tier claim is a
    pin — the rule is bypassed until a verdict releases it
    ([§5](#5-admin-stickiness)). A `rejected` candidate never re-enters the
    pool.
  - **immutable** → if all live claims agree after normalization: apply, highest
    tier stamps provenance. On disagreement: tier gap ≥2 → apply the higher
    silently (losers stay `pending`, visible in the standing view); gap ≤1 →
    escalate (`data_conflict`).
  - **mutable** → the candidate is the newest claim (by `observed_at`) whose
    tier ≥ the currently applied claim's tier; a claim from a lower tier than
    the incumbent is a **challenger** and goes to step 2. No incumbent → the
    newest claim of the highest tier present is the candidate; a low-tier
    candidate still passes step 2 before applying.
- **Step 2 — the contest.** The candidate against the incumbent and the other
  live claims:
  (A claim agreeing with canonical never reaches this step — §6 excludes it
  from contention; it rests `agreeing`.)
  - **uncontested** — no incumbent, no live disagreement → apply.
  - **contested from an equal-or-higher tier** — the newest such claim applies
    ([§4](#4-mutability-classes)); displaced and losing claims stay `pending`.
  - **a challenger** (lower tier than the incumbent) never displaces: high
    severity → escalate (`data_conflict`); low severity → it stays `pending`,
    a standing disagreement.
  - When corroboration windows land
    ([Out of scope](#out-of-scope-for-v1-corroboration-windows)), a
    below-`trusted` candidate's contest additionally waits a window before
    these outcomes.
- **Step 3 — unlinked references.** A reference field's claim (an event's
  `venue`, its `performers`) applies as a link — `venue_id`, `event_performers`
  rows — so it can apply only once its reference has resolved to a canonical
  row. How a reference resolves is [entity-linking.md](entity-linking.md)'s:
  the same matcher cascade and confirmed-match store the adapters' link stage
  runs, built in that campaign. The resolver's part: each cycle re-runs the
  matcher over every unlinked live claim ([§6](#6-the-cycle)); a claim whose
  reference is still unresolved holds (`awaiting_link`) and is re-examined
  next cycle — one confirmation can unlock a backlog.
- **Every hold is typed and visible.** The weighing function's hold outcome
  carries a reason and, where one exists, a deadline; a database view
  classifies every live `pending` claim into exactly one of: `in_window` (with
  its deadline; empty until windows land), `standing_disagreement`,
  `awaiting_link`, `awaiting_row` (creation bar unmet — the unmet requirement
  named — or a `curated` domain), `escalated` (its fact has an open review
  item), `agreeing` (a live `pending` claim agreeing with canonical —
  §6's non-contenders). `agreeing` is computed at read time by comparing
  the stored claim value against the applied value, so a claim moves between
  `agreeing` and `standing_disagreement` purely by what canonical
  currently says — no transition is stored. It is checked last: the
  `escalated` and `awaiting_*` conditions take precedence, so only an
  otherwise-unheld claim rests `agreeing` (an unlinked reference claim
  cannot agree with anything yet). The classification is exhaustive by test, and a staging
  test asserts the view agrees with the weighing function — the SQL cannot
  drift from the policy. The standing-disagreements view
  ([§4](#4-mutability-classes)) is this view filtered to contradictions;
  rendering both is admin-observability's.

`Rationale`

- The uncontested apply holds at every tier: a fact only one `standard`-tier
  source ever mentions (a fan café's fansign) applies rather than waiting for
  a second source that usually doesn't exist — the tier system and
  `publish_requires` bound the damage, and a wrong low-severity fact is
  exactly what user reports catch. Requiring corroboration for sole-witness
  facts: 3/10.
- Step 0b's "fact has moved" check is a `field_provenance` row strictly newer
  than the rejection's stamp. A settlement's apply and its rejections share
  one transaction timestamp, so a settlement can never lift its own block.
- `newest_wins` sorts tier before recency. Pure recency: 4/10 — it lets an
  untrusted submission displace an official poster on arrival; tier-first
  keeps the pool useful while the tier system does the vetting.
- Step 0b exists because the built gate's current-claim anchor reads only live
  rows (`pending` / `applied` / `quarantined` — migration `20260821000003`), so
  a source re-asserting a rejected value births a fresh `pending` row every
  sweep by construction; without 0b, every rejection would last one sweep and
  the review item would reopen forever. Changing the frozen gate to bump
  rejected rows instead: 3/10 — a breaking change mid-campaign, it muddies
  what "live" means, and it would hide that the source still pushes the value;
  the pending rebirth plus a counted mechanical re-reject keeps the
  persistence visible.
- Resolver adjudication writing `rejected` extends data-model.md's gloss
  (`rejected` = "adjudicated out by the admin") to cover settlements
  ([§11](#11-escalation-and-review-items)) and, later, window auto-rejects;
  the `rejected_at` / `rejected_by` stamp grows its "exactly three columns
  change after write" list — both flagged as cross-doc edits.

## 8. Applying: the transaction

- **Application is a Postgres function, like the gate.** The weighing runs in
  Python; the outcome is applied by one RPC —
  `apply_resolution(p_decisions)` — that, per fact, in one transaction:
  updates the canonical column (or creates the row, [§9](#9-entity-creation-and-adoption)),
  inserts the `field_provenance` row (`tier_at_apply` from the source's current
  tier, `admin_locked` when the winning claim is admin-tier), flips the winning
  observation to `applied`, returns the displaced winner to `pending`, and
  writes any status adjudications (`rejected`) the decision carries.
- **The function is the only write path to canonical** — table grants make it
  so, the same construction the gate uses for `observations`; it carries the
  standard revoke pair. Client roles keep zero write privilege.
- **Batched per domain, atomic per fact** — one call carries many facts'
  decisions; each fact settles or fails alone (a refused decision never takes
  its batch down — the situations differ from the gate's: decisions are
  computed against a live database and may lose benign races).
- **Canonical never un-writes by weighing.** Rejecting the applied winner
  without a successor leaves the last-applied value standing — provenance
  history shows the rejection; the column changes only on a later apply. The
  one exception is the verdict unset (below).
- **Admins write through the same function.** An admin never edits canonical
  directly (admin-observability's hard rule): an override or verdict becomes an
  admin-tier observation and applies through `apply_resolution` like any other
  claim, locked ([§5](#5-admin-stickiness)). A verdict may additionally
  **unset a nullable column** — the fact's live claims are rejected, the
  column returns to NULL, and the provenance row records the verdict as its
  authority: the one sanctioned un-write, and the absence is admin-locked like
  any admin value. A NOT NULL column is never unset; a verdict there
  supplies the replacement value. Removing a whole row (a phantom entity)
  belongs to the merge family ([entity-linking.md](entity-linking.md), with
  merge mechanics).
- **Stale-read guard** — every decision names the `observation_id` it read as
  the incumbent (null when none); the function re-checks and skips the fact
  (counted, retried next cycle) when the ledger moved underneath.

`Rationale`

- Applying from Python over PostgREST without a function: impossible to do
  atomically — one RPC is one transaction, and the same-transaction provenance
  rule is a HARD RULE.
- A direct psycopg connection for multi-statement transactions: 4/10 — atomic,
  but it opens the second database access path the gate's construction
  deliberately closed, and every guarantee ("only write path to canonical")
  becomes convention again.
- Per-fact atomicity over batch atomicity: the gate refuses batches whole
  because a self-contradicting batch is an adapter bug; a resolution batch is
  the resolver's own computation racing reality, where skip-and-retry is the
  honest outcome.

## 9. Entity creation and adoption

- **Creation is a side effect of the first apply.** When a winning claim's
  record has no canonical row and the domain's `creation` is `open`, the
  resolver — immediately before creating — re-runs the matcher on the record
  ([entity-linking.md](entity-linking.md)); a hit links instead of creating.
  `curated` domains — where only humans create rows (`groups` / `idols`) —
  never create; their unlinked claims hold.
- **The creation bar is the table's NOT NULL columns**: the record's winning
  claims must cover every non-defaulted NOT NULL column (venues: `name`;
  events: `title`, `starts_at`) — each having passed weighing. An `events` row additionally requires at least one linked
  performer at creation ([events-canonical-storage.md §2](events-canonical-storage.md#2-events-resolved-facts)'s
  performer invariant); until a performer reference links, the whole record
  holds.
- **Before creation there is no row anywhere.** A record short of the bar is
  not stored as a draft: its claims are ordinary observations (`pending`,
  classified `awaiting_row` in the view with the unmet requirement named —
  the missing column, or the performer invariant). The ledger is the staging
  area; nothing is lost, and creation happens in whichever later cycle
  completes the bar.
- **Individual stuck records never escalate — patterns do.** One record short
  of its bar is ordinary (the information may simply not exist); it stays
  visible in the `awaiting_row` bucket and costs nothing. Escalation is per
  source: when its stuck records within the trailing window pass the pattern
  threshold ([§12](#12-thresholds), initial: 20 records in 7 days — a
  consistent couple of bad items is realistic and stays quiet; a global
  default, overridable per source in its registry config), one
  `entity_link` item opens for the source, folding as the count moves. A
  patterned failure is one question — an ambiguous name family, a missing
  catalog row, a source problem — never twenty separate items. A required
  field the source simply never supplies is schema feedback, not escalation:
  the fill-rate report ([data-model.md](data-model.md)) is what argues a NOT
  NULL column is too strict, and loosening one is a storage-design change
  with its migration.
- **Creation writes everything it has**: the row, its `event_performers` rows,
  provenance per field, `applied` flips, and the `confirmed_matches` entry for
  the creating source's `external_ref` — one transaction in the same
  `apply_resolution` call.
- **Until matcher step 4 exists, near-duplicate creation is a known, bounded
  risk** — steps 1–3 are exact-after-normalization, so "Ziggo Dome Club" and
  "Ziggo Dome" become two venues until similarity lands or a human merges.
  Merge mechanics are entity-linking's (its TODO); the resolver's part is that
  a merge re-points observations and the next cycle re-resolves the survivor.
- **`publish_requires` needs no machinery yet** — for both live domains it
  equals the NOT NULL creation bar, so every created row is publishable;
  visibility gating is built when a domain first requires more than its NOT
  NULLs.
- **The interim writer's rows are adopted, not replaced** — `events` and
  `venues` rows the interim writer created keep their ids: linking already
  points observations and `confirmed_matches` at them, and the first apply per
  field gives them real provenance (an unprovenanced field is simply one with
  no provenance row yet — first resolution stamps it). **This settles
  [events-canonical-storage.md §7](events-canonical-storage.md#7-social-state)'s
  open item: ids survive, so `event_attendees` survives.** The interim writer
  retires at the events cutover (ROADMAP queue item 5), not at this build.

`Rationale`

- A creation bar above weighing (e.g. requiring corroboration to create): 3/10
  — creation already inherits every trust control weighing has, and will
  inherit windows when they land; a second bar would re-implement them.
- The creation re-probe is a stateless re-query, and most cycles it is
  redundant — deliberately. Records are stored nowhere: a cycle loads the
  unlinked live claims (one indexed query), groups them into records in
  process memory, and discards the groups when it ends. The creation-bar
  check costs no SQL at all — the claims are already in memory, so "does this
  record have `title` and `starts_at`?" is a key lookup — and the matcher
  re-runs as three set-based queries for the whole batch (refs against
  `confirmed_matches`, external ids against the catalog, identity keys
  against the canonical unique indexes). An idle cycle is therefore ~4
  indexed reads total, independent of the stuck-set size. Remembering
  "nothing changed for this record" instead could only skip the in-memory
  part — the queries must run anyway for newly arrived claims — while adding
  the invalidation state a stateless cycle exists to avoid. A stuck set in
  the thousands is both the pattern escalation firing and the moment
  [§6](#6-the-cycle)'s watermark optimization gets bought.
- Re-keying instead of adopting interim rows: 2/10 — it invalidates every
  `confirmed_matches` row and RSVP for zero gain; adoption is why the M1
  verifier checked canonical was byte-identical under linking.

## 10. Confidence

- **Confidence is a property of claims, never of canonical rows.**
- **Per-claim confidence arrives with AI extraction** — data-model.md's
  deferred column, landing with the first extraction domain. When it lands it
  becomes an input to the weighing function
  ([§7](#7-the-weighing-procedure)'s swap point takes new inputs by design):
  policy may discount or refuse a claim below a confidence bar, and the value
  rides the claim so a decision stays explicable to admin. Its exact use is
  decided with that domain's build.

`Rationale`

- A row-level `confirmed` / `disputed` column: 3/10 — no reader exists (the
  app has no hedging surface designed, and `event_listings` does not expose
  it), and "disputed" is a join against open review items whenever a reader
  appears; storing it would cache derived state ahead of any consumer.
  ECOSYSTEM's row-state phrasing is trimmed under the §4 flag
  ([§13](#13-schema-additions-this-build-carries)).

## 11. Escalation and review items

- **`review_items` lands with this build** (columns owned by
  [admin-observability.md](admin-observability.md); the resolver is its first
  writer, as the run loop was for `runs`); client roles hold no privilege on
  it:

| column | type | constraints / default | meaning |
| --- | --- | --- | --- |
| `review_item_id` | uuid | PK, `default uuid_generate_v7()` | the item |
| `queue` | text | not null, CHECK (`data_conflict`, `entity_link`) | the typed queue; extending the list is a migration (`freshness` arrives with withdrawal) |
| `source_id` | uuid | nullable, FK → `sources(source_id)` | set on per-source items (the stuck-record pattern); null on per-fact ones |
| `domain` | text | nullable | with `entity_id` and `field`: the fact a per-fact item is about |
| `entity_id` | uuid | nullable | see `domain` |
| `field` | text | nullable | see `domain` |
| `severity` | text | not null, CHECK (`low`, `high`) | from the registry's field settings |
| `status` | text | not null, `default 'open'`, CHECK (`open`, `settled`) | settled by a verdict (Admin build) |
| `summary` | text | not null | one sentence: what happened |
| `evidence` | uuid[] | not null, `default '{}'` | observation ids, rendered side by side |
| `folded_count` | integer | not null, `default 0` | repeats folded into this item |
| `opened_at` | timestamptz | not null, `default now()` | — |
| `last_evidence_at` | timestamptz | not null, `default now()` | bumped when evidence folds in |
- **One open item per subject** — a subject is a fact (`data_conflict`) or a
  source (the stuck-record pattern); enforced by a partial unique index on
  `(queue, source_id, domain, entity_id, field)` where `status = 'open'`
  (`NULLS NOT DISTINCT`); new evidence folds in: `folded_count` increments,
  `evidence` appends, `last_evidence_at` bumps. Secondary indexes:
  `(status, queue)`, `(entity_id)`.
- **Items are opened by the resolver and settled by verdicts** — settling
  arrives with the Admin build (queue item 4); until then items accumulate,
  which is the correct bootstrap state (the queue *is* the record that human
  attention is owed). Every verdict is recorded as a labeled example with an
  optional free-text note ([admin-observability.md](admin-observability.md)) —
  the future verifier's seed training data accumulates from the first verdict,
  verifier or no verifier.
- **Severity comes from the registry** (`severity` per field); the visibility ×
  impact ranking formula is admin-observability's.
- **A settlement is an apply plus adjudications.** A verdict that chooses a
  value — human, or machine once its judgment class has earned autonomy
  ([out of scope](#out-of-scope-for-v1-active-verification)) — applies the chosen claim and rejects the
  live claims it overrules, in one transaction (`rejected_by = 'verdict'`).
  The rejection is what makes the settlement durable: a rejected value stays
  rejected, so the overruled source's re-assertions are re-rejected
  automatically by the weighing procedure ([§7](#7-the-weighing-procedure),
  step 0b) until the source changes its value or the fact moves.
- **Only a human verdict carries admin weight.** A machine settlement applies
  an ordinary claim at its source's tier and locks nothing: a genuinely new
  claim from an equal-or-higher tier supersedes it through ordinary weighing,
  and a second source asserting the overruled value is new evidence (a
  rejection binds only the source it adjudicated) that escalates a fresh
  item.
- **The verifier's training data accumulates with no extra machinery** — the
  items are its questions, the verdicts and notes its answers; severity and
  timestamps are on the row, and the worth-it gate's popularity input is read
  live when the verifier runs.

`Rationale`

- Snapshotting entity popularity on each item (for calibrating the future
  worth-it gate): cut — the resolver runs pre-launch, when app engagement is
  ~zero, so the column would accumulate zeros; post-launch the gate tunes
  from its own both-ways decision log against live popularity.
- A settlement that applies without rejecting the overruled claims: 2/10 — the
  weighing function is pure and memoryless, so the next cycle recomputes the
  same conflict and can re-apply the claim the verdict overruled; settlement
  durability has to live in the ledger, which is what claim statuses are for.
  The human path never exposed this (an admin-tier observation locks); the
  machine path has no lock by design (the out-of-scope verification Rationale), so the rejection is its
  entire persistence.

## 12. Thresholds

All gauge-tuned; these are the initial values, chosen to be honest defaults
rather than measurements — the gauges exist to replace them.

| knob | initial value | gauge that tunes it |
| --- | --- | --- |
| resolver cadence | 15 min | claim→outcome latency; cycle duration vs cadence |
| silent-win tier gap | ≥2 (LOCKED, [§7](#7-the-weighing-procedure)) | overrule rate on silent wins (audit sampling) |
| escalation | high severity → item; low → standing view | queue depth and age; expire rate |
| stuck-record pattern | 20 records per source in 7 days (global default; per-source override below) → one folding `entity_link` item | awaiting-row depth and age per source |
| verification gate | never clears (no verifier — [out of scope](#out-of-scope-for-v1-active-verification)) | inbox volume it would have absorbed |

The per-source override is one registry key with a fixed shape, uniform across
sources and validated by the source-registry format schema (an unknown key
inside it is an error):

```yaml
resolver:
  stuck_pattern: {count: 20, window: 7d}  # both optional; absent falls back to the global default
```

`count`: integer ≥ 1. `window`: the registry's duration syntax
([data-model.md](data-model.md)).

## 13. Schema additions this build carries

Each a migration, each Ben-approved before it lands; typed columns only; every
function carries the revoke pair:

- `resolution_runs` — the cycle record; columns in [§6](#6-the-cycle)
- `review_items` — the escalation record; columns in
  [§11](#11-escalation-and-review-items)
- `rejected_at` / `rejected_by` on `observations` — nullable, written once at
  adjudication ([§7](#7-the-weighing-procedure))
- the pending-claims classification view ([§7](#7-the-weighing-procedure)) —
  derived, no stored state
- `apply_resolution` and the canonical-table grant tightening
  ([§8](#8-applying-the-transaction))
## Implementation notes

- **Package** (scraper repo, Python): `resolver/` — cycle loop, the weighing
  function (pure), creation, selection policies, the
  verification-gate stub. Imports the matcher from `linking/`; talks to the
  database only through the gate's read surface and `apply_resolution`.
  Entry point: `python -m resolver.run`; `mypy --strict`, ruff, the
  conversion build's target guard before any client is constructed.
- **Tests** — the weighing function is exercised offline with table-driven
  claim-set cases (every §10 branch, every mutability class); the cycle,
  creation and adoption run against staging with the
  `test_harness` source, zero residue after. The offline suite is the
  acceptance bar's center of gravity: weighing bugs are policy bugs.
- **Rollout** — the resolver runs on staging against the adapters build's
  observations first; production waits for the events cutover (queue item 5),
  where the interim writer retires.

## Out of scope for v1: active verification

**Deferred — no v1 code implements anything in this section.** The verifier is
the AI-assists build (ROADMAP queue item 7), alongside the proactive
correctness auditor (ai-learning.md §5), which reuses its two-channel
contract. In v1 the worth-it gate never clears: every inbox-bound conflict
goes to the inbox, and the items and their verdicts accumulate from the first
review item ([§11](#11-escalation-and-review-items)) — the backlog the
verifier is first tuned on. The key design, as reviewed:

- Trigger & gate: only conflicts already bound for the inbox, and only when the
  worth-it gate clears — severity × entity popularity (app follow counts) × the
  cost dial. Gate decisions logged both ways.
- Two outputs, two channels:
  - **Evidence** → ordinary observations attributed to the cited website, never the
    searcher (courier model), conforming to the target domain's schema. On first
    citation of a site, a minimal `cited` source row is auto-created so `source_id`
    resolves; cited sites start `untrusted`.
  - **Judgment** → a recommendation on the review item: proposes an action, never a
    claim, never enters resolution. Accepting it writes an admin-tier observation;
    the recommendation stays process metadata. Low-tier-but-decisive evidence
    escalates with a strong recommendation instead of falling through.
- Independence: trace origins — ten echoes of one rumor are one witness; prefer
  primary sources; ambiguous origin analysis stays human.
- Giving up: no reputable corroboration / genuine conflict / budget exhausted →
  inbox with the case file. "Found nothing" weights toward the status quo.
- Bootstrap → autonomy: propose-only behind an admin-reviewed queue. Once a judgment
  class earns autonomy, execution is authorization, not assertion: the resolver
  applies evidence already in the ledger; the recommendation records
  `auto-executed`; audit sampling applies. Synthesizing a value not present in any
  observation always requires a human verdict.

`Rationale`

- Rejected: auto-executed recommendations entering the observations route at a top
  tier below admin — a judgment adds no new witness (its evidence is already in the
  ledger), so a claim would double-count; it merges authority into trust; and a
  sticky near-admin machine claim would block ordinary source updates the way only
  deliberate human locks should.

## Out of scope for v1: corroboration windows

**Deferred — no v1 code implements anything in this section.** It lands once
more sources exist: concretely, when the first below-`trusted` source collects
(news, user submissions). The contest step ([§7](#7-the-weighing-procedure))
is the insertion site — a window is one parameter of the rule already there,
no schema changes, and `rejected_by = 'window'` is reserved in the v1
migration. The key design, so it is not re-derived later:

- **The window rule** — length zero for a candidate from a tier ≥ the
  incumbent's (no incumbent: ≥ `trusted`); otherwise the domain's
  `windows.fast` when the field's `freshness.expected_change` ≤ 7d, else
  `windows.slow` (`freshness: none` → slow). It opens at the claim's
  `observed_at`; `0h` is valid — a domain opts out by config.
- **During the window** — a high-severity contested fact shows `disputed`; the
  pending-claims view's `in_window` bucket shows every waiting claim and its
  deadline.
- **Ending early** — a second independent source asserting the same normalized
  value (both live) applies without waiting for the deadline; the incumbent's
  source re-confirming its value during the window auto-rejects the challenger
  (`rejected_by = 'window'`).
- **At the deadline** — uncontested → apply; contested → high severity
  escalates, low severity stays a standing disagreement: the same outcomes v1
  reaches immediately, delayed to give contradiction time to arrive.
- **Initial thresholds, tuned by gauges once real data exists** — corroboration
  auto-apply: 2 independent sources (gauge: measured time-to-corroboration);
  windows: fast 24h / slow 72h (disputed dwell time); fast/slow boundary: 7d
  (share of window outcomes decided before the deadline).

## Decided against: withdrawal and freshness expectations

**Decided against — not merely deferred: no roadmap item builds this, and the
resolver reads no `freshness` registry settings.** The case it existed for is
the silently delisted upcoming event, and it lost on three counts: the v1
source marks cancellations explicitly (Ticketmaster's status codes — silent
deletion is its rare path); a delisting blip re-confirming a day later would
false-positive; and once more sources exist a real cancellation arrives as
positive evidence from another source. The one re-open condition is evidence:
the proactive correctness auditor (ai-learning.md §5) measures how often
silent delisting actually happens, and only that number re-opens this. The
key design, kept so it is not re-derived if it does:

- **`withdrawn`** — entity-level implicit negative evidence, per the owning
  source: set when the source whose claims own the row's freshness-bearing
  facts has completed two consecutive successful runs since those facts were
  last confirmed (`last_confirmed_at`), for rows inside the freshness scope
  (`upcoming`: `starts_at` in the future). One missed run is noise; two is the
  source no longer listing it. No extra scraping: the check reads what the
  sweep already produced.
- **The freshness declaration is the meaning of silence** — it separates
  silence-as-evidence (a delisted upcoming event) from silence-as-normal (an
  immutable fact under the hash rule). Without it, a source going quiet on a
  fact means nothing.
- **Cleared by evidence, in either direction** — a re-confirmation or a fresh
  apply flips `withdrawn` back to `confirmed`; an explicit `status: cancelled`
  claim is the ordinary mutable-field path and outranks implication.
- **A withdrawn upcoming event escalates** (a `freshness` queue, added to the
  `review_items` CHECK when this lands) when any of its facts is
  high-severity; low-severity withdrawals just hedge in the app.
- **Field-level withdrawal waits further** — for structured sweeps a listing
  vanishes whole; per-field silence becomes meaningful only when sources
  assert overlapping partial records.
- **Coverage is read from `runs` + the registry, not declared anew**: a
  successful run is a `runs` row with outcome `succeeded`; the freshness scope
  bounds which rows the source is expected to re-assert; a source whose sweep
  can't re-assert its scope every run declares a longer
  `freshness.expected_change`, stretching the two-run rule's reach.
- **Initial threshold** — 2 consecutive successful runs; gauge:
  false-withdrawal rate (rows that re-confirm on the next run).

`Rationale`

- The two-run rule over a wall-clock grace period: a source's cadence already
  is its clock; wall-clock grace re-introduces "time alone changes confidence",
  which [§10](#10-confidence) forbids.
- A `withdrawn` row is deliberately not deleted or archived — the listing may
  return (Ticketmaster relists postponed shows under the same id), and deletion
  would orphan RSVPs on rumor-grade evidence.
