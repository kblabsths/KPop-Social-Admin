# Admin Observability & Review Surfaces — Design

- Status: **DESIGN** — drafted 2026-09-01, superseding the extracted stub of
  2026-08-10; reviewed section by section and **approved in full 2026-09-01**.
- Purpose: the Admin window into the data ecosystem — what it renders, the one
  write it performs (the verdict), what happens to the existing Admin app's
  surfaces, and the build's exact schema footprint.
- Parent: [ECOSYSTEM.md](../ECOSYSTEM.md) §8. ROADMAP queue item 4.
- Depends on — concepts owned elsewhere:
  - **observation / claim** — the one per-field claim format every source
    writes through the gate; a verdict becomes an admin-tier one
    ([data-model.md](data-model.md))
  - **resolver / cycle** — the sole writer of canonical, on a 15-minute cron;
    verdicts flow through it, never around it ([resolver.md](resolver.md))
  - **`apply_resolution`** — the one Postgres function allowed to write
    canonical; settlements call it too ([resolver.md §8](resolver.md#8-applying-the-transaction))
  - **`review_items`** — the two escalation queues (`data_conflict`,
    `entity_link`), one open item per subject
    ([resolver.md §11](resolver.md#11-review-items-and-settlements))
  - **rejection stamps** — `rejected_at` / `rejected_by` on observations; what
    step 0b reads to keep settled values settled
    ([resolver.md §7](resolver.md#7-the-weighing-function))
  - **classification view** — every live pending claim in exactly one of six
    buckets ([resolver.md §7](resolver.md#7-the-weighing-function))
  - **tier** — a source's trust level; `admin` is the top and only human
    verdicts carry it ([resolver.md](resolver.md))
  - **sources state** — the per-source lifecycle/tier/checkpoint rows
    ([data-model.md](data-model.md))

## 1. Goals

**Admin is the single window into the ecosystem — rendered surfaces, never a
SQL prompt.** Health overview, escalation pathway, and inspection: every
question an operator asks at breakfast — did anything happen last night, what
needs me, who keeps being wrong — is a page, and a query asked often enough
becomes a curated view defined in code ([§4](#4-the-window)). What stays out
is the generic instrument: whole-table browsing and free SQL. *"If it isn't
in the database, it didn't happen"*: every run, escalation, and verdict is a
row Admin can render; console logs are diagnostics, never the record.

**The rebuild replaces the Admin app on its own stack.** The existing
dashboard is deprecated wholesale — reference while the rebuild runs,
precedent for nothing ([§3](#3-the-existing-app-and-what-happens-to-it));
what carries over is infrastructure: the Next.js app on Railway, its sign-in
gate, its server-side service-role access. Built, the app is what this
design describes.

**Reading ships before writing, and the one write is the verdict.** The
resolver is filling `review_items` with items whose only interface today is a
summary column; this design gives them a renderer first and a settle button
second. Everything else an admin might do — free-form commands, config
changes — waits for its producer ([parked sections](#parked-the-operator-and-the-free-form-door)).

**Every threshold ships with its gauge.** Each knob in
[resolver.md §12](resolver.md#12-thresholds) has one view that shows, at a
glance, whether it needs tuning ([§5](#5-the-gauges)).

**A verdict is the training signal, not just a fix.** Every settlement writes
an admin-tier observation through the normal pipeline *and* lands as a labeled
example with the admin's optional reasoning note — the seed data for every
future AI role ([§7](#7-the-verdict), [ai-learning.md](ai-learning.md)).

**HARD RULE: admins never modify the database directly.** Every action enters
through a recorded pathway, so every change is attributed, provenanced, and
learnable. The one designed exception is emergency access — time-boxed,
audited, break-glass — designed pre-launch (LAUNCH.md).

## 2. What v1 builds

- **v1 is two slices: the read surfaces, then the verdict path.** The read
  slice renders what the resolver and adapter builds already write
  ([§4](#4-the-window), [§5](#5-the-gauges), [§6](#6-a-review-item-rendered)) and
  needs zero schema. The verdict slice is the settlement write path
  ([§7](#7-the-verdict)) and owns this build's whole schema footprint
  ([§9](#9-schema-manifest)); events become editable only with it
  ([§8](#8-the-edit-surface)).
- **Nothing ships without a producer.** Surfaces whose writers don't exist yet
  — recommendations, incidents, agent runs, free-form commands — are parked in
  the bottom sections with the trigger that revives each. The typed-queue
  contract stays open: new queues appear as their producers do.
- **The two slices land on different clocks.** The read slice starts
  immediately — it touches only the Admin repo. The verdict slice's migrations
  live in the scraper repo ([§9](#9-schema-manifest)) and land after the
  resolver campaign closes, since campaigns are serial there and builders
  never share a repo with a running campaign.

`Rationale`

- Read-only v1 with no verdict at all (the original queue-item title): 4/10 —
  by the time this ships, resolver M2 is escalating real conflicts; a queue
  you can see but not settle converts an invisible backlog into a visible,
  untouchable one. The verdict is one function and one table, and it is the
  keystone of the learning design — cutting it saves little and costs the
  training signal's start date.
- Shipping the full §8 surface (commands, incidents, recommendations) now:
  2/10 — every one of those tables would be written by nothing. The
  no-consumer standard that cut windows and the confidence column from the
  resolver cuts these identically.

## 3. The existing app, and what happens to it

The deployed dashboard (`kspace Admin`, Next.js on Railway, deploying from
`main`) carries surfaces from before the ecosystem existed: Overview (count
cards), Analytics (app-user stats from `profiles`), Data Management (catalog
editors on per-table `ALLOWED_FIELDS` PATCH routes, plus a completeness gap
list), and a Database table browser.

- **The app is rebuilt in place; the stack carries over, the surfaces do
  not.** What persists is infrastructure: the Next.js app on Railway
  deploying from `main`, NextAuth sign-in gated by `admin_allowed_emails`,
  every read and write server-side through the service role. Changing any of
  these is a design change, not a build choice.
- **Every existing surface is deprecated** — reference while the rebuild
  runs, precedent for nothing. Built, the app is what this design describes —
  the window ([§4](#4-the-window)) and the edit surface
  ([§8](#8-the-edit-surface)) — and an old page or component survives only by
  re-earning its place.
- **Events stop being hand-editable until the verdict slice lands.** Today's
  events editor updates the table directly — no observation, no provenance,
  no `admin_locked` — so the resolver can neither see nor protect the edit,
  and its next apply on the fact overwrites it. The rebuild removes the
  surface rather than converting it ([§8](#8-the-edit-surface)).
- **Server-side reads reach the internal tables**: `resolution_runs`,
  `review_items`, the classification view and `verdicts` grant client roles
  nothing; Admin reads them the same way it reads everything — service role,
  server-side only.

`Rationale`

- Extending the existing surfaces instead of rebuilding: 3/10 — they were
  built with little investment against pre-cutover tables, and a rebuild
  that must dodge legacy pages inherits their structure and their
  maintenance. Reference is the value left in them, and it expires with the
  rebuild.
- A second app for the ecosystem window: 2/10 — second auth gate, second
  deploy, second place to be signed into. The existing app already holds the
  right privilege and the right audience.

## 4. The window

- **The rebuilt app is six pages plus the edit surface
  ([§8](#8-the-edit-surface))**, each mapped one-to-one onto what exists in
  the database:
  - **Dashboard** — the breakfast view: attention summary with decision and
    signal counts separate (open counts, max severity, oldest age), last
    night's cycles and runs, error lines. Everything on it links into the
    pages below.
  - **Queues** — `review_items` as two queues of equal standing
    ([§6](#6-a-review-item-rendered)): the decision queue and the signal
    queue, each open first, severity then age, filterable by shape; settled
    items browsable.
  - **Claims** — the classification view rendered: buckets with counts, age,
    filterable by source / domain / bucket; the standing-disagreements subset
    gets its own tab ([resolver.md §4](resolver.md#4-mutability-classes)).
    The `in_window` bucket — empty by rule while corroboration windows stay
    parked — is not rendered until it can hold a row.
  - **Sources** — the sources state rows: lifecycle, current tier, checkpoint,
    last run, per-source gauge trends ([§5](#5-the-gauges)).
  - **Cycles & runs** — `resolution_runs` and the adapter framework's `runs`,
    newest first, with the counts as columns and `error_summary` inline.
  - **Browse** — curated data views: a recurring question promoted to a page.
    Each view is defined in code — the query, the columns it may show, the
    default sort — with a runtime column selector over the configured set;
    new views are added as recurring questions prove themselves. v1 ships
    one: **recent events** — everything that came through the pipeline,
    newest first, with spot-verification columns (e.g. title, description,
    poster image, date, venue, and the source(s) behind the row, read from
    `field_provenance`).
- **Navigation is entity-crossing**: a review item links to its claims, a
  claim to its source and its fact's provenance, a source to its items and
  runs, an event to its edit surface — the investigation path never leaves
  the app.

`Rationale`

- A single "everything" page: 3/10 — the dashboard already is the summary; the
  investigation surfaces need their own URLs to be linkable from anywhere
  (including future notifications).
- A primary inbox with signals as a side list: 3/10 — a signal is the machine
  breaking, a decision is a question about one datum; tuned signals outrank
  the inbox they'd be filed under.
- Rendering `field_provenance` as its own page: 5/10 — provenance matters at
  the *fact*, shown on item and claim detail and at the edit surface; a global
  provenance browser is a database viewer by another name. Revisit if
  investigations keep dead-ending.
- Reusing the existing Database page for inspection: 3/10 — it renders whole
  tables, no joins and no curation; "which sources produced this event" needs
  the provenance join. A SQL runner in Admin: 1/10 — the recurring query
  belongs in code where it is reviewed once, not retyped; one-off queries
  keep their existing read-only paths.

## 5. The gauges

Every threshold in [resolver.md §12](resolver.md#12-thresholds) ships with a
gauge — one glance per knob, enough to judge "does this need tuning" from a
table or chart. They read only rows and views the resolver and adapter builds
already write; this build adds queries and charts, never tables.

| view | one glance shows | the knob it judges |
| --- | --- | --- |
| cycle health | recent `resolution_runs`: duration vs cadence, facts examined vs writes, outcome counts, errors | resolver cadence; when to buy the watermark |
| resolution latency | `observed_at` → outcome latency percentiles, per domain | resolver cadence (and windows, if they ever land) |
| pending claims | the classification buckets with counts and age percentiles, filterable by source and domain; per-source `awaiting_row` trend against its pattern threshold | stuck-record pattern; escalation |
| queue health | per queue: open count, age distribution, opens vs settles per week, fold rates | escalation cutoffs; severity assignments |
| standing disagreements | live contradictions with age and per-source split — who keeps losing, and who keeps being right from below | silent-win tier gap; promotion evidence |
| settled values | per-source re-reject counts over time — who keeps pushing adjudicated values | source health; tier moves |

- **The gauges are server-side queries in the Admin app, not database views.**
  The database keeps exactly the views the resolver design names; every gauge
  above is SQL the Admin server runs read-only.

`Rationale`

- Gauge views as migrations in the scraper repo: 4/10 — every chart tweak
  becomes a migration in a repo a campaign may own, for views with exactly one
  consumer. App-side SQL iterates at UI speed. Revisit per-view if a second
  consumer appears (the correctness auditor is the likely first).

## 6. A review item, rendered

- **Every review item is one of two kinds.** A **decision item** asks a
  question only a verdict can close — sources disagree, a record cannot
  link. A **signal item** reports a breakage; it closes as fixed or
  won't-fix ([§7](#7-the-verdict)), and the fix itself is made on another
  surface. The kind belongs to the shape and is derived in code — no column
  carries it.
- **Review-item anatomy — the base contract, typed per shape:**
  1. **what happened** — the item's summary sentence, its severity, age, and
     `folded_count` ("asked again ×N")
  2. **evidence, side by side** — the `evidence` observation ids resolved to
     rows: value, source, tier, `observed_at`, payload link; the fact's
     current canonical value and provenance beside them
  3. **the close** — verdict actions on a decision item, fixed / won't-fix
     on a signal item ([§7](#7-the-verdict)), with the note field beside
     them
- **The shapes today** — an open set that moves with the queues (a new queue
  or escalation type brings its shape; a retired one takes it away): a
  `data_conflict` fact item (decision: values disagree — evidence is the
  contenders), an `entity_link` fact item (decision: a record that cannot
  link or create — evidence is the stuck claims and the unmet requirement),
  and an `entity_link` source-pattern item (signal: a source crossing its
  stuck-record threshold — evidence is the folded records, rendered as a
  list, with the per-source dial beside it).
- **Each shape is its own detail view** over the shared anatomy — the
  evidence block renders what that shape's evidence is, not one generic
  layout — and the queue lists filter by shape as well as by queue.
- The anatomy's recommendation slot — the specialist's proposed action with
  rationale and confidence — exists in the contract and renders nothing until
  the first recommender ships
  ([parked](#parked-recommendations-incidents-and-agent-runs)).
- Status: **weakest-held section** — revisit the anatomy once real M2 items
  exist to render.

## 7. The verdict

- **A verdict does two jobs at once**: it settles the subject through the
  normal pipeline, and it lands in `verdicts` as a labeled example the system
  later learns from. Human rows are the training signal; machine rows, when
  autonomy ever earns them, are audit only — track records are measured
  against human rows, never self-graded.
- **The verdict actions, per decision-item shape:**
  - `data_conflict`: **choose a claimed value** (one tap per evidence card),
    **supply a different value** (the override form,
    [§8](#8-the-edit-surface)), or **keep current & settle** (the
    disagreement is fine as it stands).
  - `entity_link` fact item: **link to an existing entity** (picker), or
    **settle** (leave it held; the claim keeps waiting in its bucket).
- **A signal item takes no verdict — it closes with a disposition:**
  **`fixed`** — the breakage was addressed (the fix itself — a tier move, a
  source pause, a dial change — is a source-state or registry change, made
  and recorded on its own surface) — or **`wont_fix`**, on which the note is
  required: why the condition stands. Either way the item settles and the
  `verdicts` row carries the disposition.
- **One entry point, one transaction — `settle_review_item`**, a Postgres
  function in the shared database, called the way the gate and
  `apply_resolution` are called. Every action arrives as one typed decision
  and branches inside: a value-carrying
  verdict writes the admin-tier observation through the gate and applies it
  through `apply_resolution` with the rejections the verdict implies
  (`rejected_by = 'verdict'`); a keep-current verdict carries rejections
  alone, canonical standing; a link verdict writes the confirmed match, which
  the resolver's next cycle reads to unlock the waiting claims. Every branch
  ends the same way: the item marked settled, the `verdicts` row inserted.
  One transaction means the settlement's apply and its rejections share a
  timestamp — exactly what step 0b's strictly-newer guard assumes
  ([resolver.md §7](resolver.md#7-the-weighing-function)).
- **An override is the same row without the item**: the edit surface's
  admin-tier writes ([§8](#8-the-edit-surface)) land in `verdicts` with
  `action = 'override'` and a null `review_item_id`, so the verdict log is
  the one record of every admin data action.
- **The `verdicts` table:**

| column | type | constraints / default | meaning |
| --- | --- | --- | --- |
| `verdict_id` | uuid | PK, `default uuid_generate_v7()` | the verdict |
| `review_item_id` | uuid | nullable, FK → `review_items` | the item settled; null on an override from the editor |
| `actor` | text | not null | who decided; a human identity in v1, a model identity if autonomy ever lands |
| `action` | text | not null, CHECK on [§7](#7-the-verdict)'s action names + `override` | which action was taken |
| `observation_id` | uuid | nullable, FK → `observations` | the admin-tier observation written; null on a settle-only verdict |
| `note` | text | nullable | the admin's "why", at their discretion — the reasoning half of the training signal; required by the function on `wont_fix` |
| `created_at` | timestamptz | not null, `default now()` | when |

- The values a verdict rejected are not columns here — they are the rejection
  stamps on the observations themselves, written in the same transaction.

`Rationale`

- Writing the observation and letting the next cycle apply it (no settlement function): 5/10
  — mechanically sound, resolver step 0 handles it, but the admin watches a
  spinner for up to 15 minutes to see their own decision land, and the
  rejection stamps would need a second writer anyway. The synchronous function is
  the same machinery the resolver design already requires of settlements.
- One function per verdict action: 3/10 — five grant-and-revoke surfaces for
  branches that share their ending (settle + log); a new action becomes a
  migration instead of a new decision type. The typed-decision envelope is
  how `apply_resolution` already takes its input.
- A `chosen_value` column on `verdicts`: 3/10 — copies a value that already
  lives on the referenced observation; two spellings of one fact.
- A separate overrides log: 3/10 — same actor, same tier, same write path,
  second table to join for "what did admins change"; one nullable FK carries
  the difference.

## 8. The edit surface

- **The edit surface is one config**: a map in code from table name to its
  editable columns — user-facing fields only, never ids, keys, or
  timestamps; everything absent is read-only at the surface, whatever the
  route could technically reach. Adding a table or column to the surface is
  an entry in that map.
- **Everything else derives; nothing else is configured.** The write path
  follows the table's regime: a resolver-owned domain (`events`, `venues`,
  and each domain that cuts over later) edits only as overrides — an
  admin-tier observation through the gate, applied synchronously through
  `apply_resolution`, provenance stamped `admin_locked`, logged in
  `verdicts` as an `override` ([§7](#7-the-verdict)) — while a pre-cutover
  table (`groups` / `idols`, until catalog maintenance at ROADMAP queue
  item 9) edits directly, legal and unprovenanced as the ownership rules
  allow. The widget follows the registry's field settings: a scalar column
  edits as a cell, a `kind: reference` field as an entity picker.
- **A reference field's override carries the chosen entity**: the picker's
  choice lands as the admin-tier observation plus its confirmed match, so
  the apply links rows (`venue_id`, `event_performers`) instead of writing
  text.
- **Per-field provenance shows at the edit surface** ("ticketmaster, applied
  3d ago" / "admin-set Jun 12"), read from `field_provenance`; admin
  stickiness is visible, and releasing a lock is itself a verdict action on
  the fact.

## 9. Schema manifest

The verdict slice owns this build's entire database footprint — the read
slice adds none. Everything lands as migrations in the scraper repo after the
resolver campaign closes:

- **`verdicts`** — the table in [§7](#7-the-verdict); RLS on, zero policies,
  client roles hold nothing.
- **`settle_review_item`** — the settlement function; the only writer of
  `verdicts` and the only setter of `review_items.status`, calling
  `apply_resolution` for the canonical write; standard revoke pair. Overrides
  enter through it too, item-less.
- **Zero new canonical columns; zero json columns; no other schema change.**

## 10. Build mechanics

- **Two repos, two slices**: the read slice and verdict UI are the Admin
  repo's (Next.js, existing auth and deploy); the schema slice is two
  migrations in the scraper repo, after the resolver campaign closes.
- **The existing app's code is reference, never constraint**: the build owns
  `src/` wholesale, carries no backward-compatibility obligation, and leaves
  no deprecated surface standing; the repo's agent guide (AGENTS.md) is
  rewritten to say so before the build starts, so no builder wastes a step
  maintaining what is being replaced.
- **The build runs as a factory campaign in the Admin repo** — the factory
  machinery installs there before kickoff; this campaign and the scraper
  repo's never share a repo.
- **The scraper repo: read freely, write by size.** Always reference —
  schema truth, registry formats, resolver behavior. A scraper-side change
  that is minor, necessary, and reversible — a grant line, a config value
  the contract already names — the agents make on their own, as its own
  commit there, noted on the ticket that needed it. **Major is a handoff**:
  the complete artifact authored in this repo — exact file content, target
  path, apply command — filed as a blocked ticket for Ben, who installs it
  from the scraper repo. Major means: every migration, every
  registry-semantics change, anything touching gate or resolver behavior,
  anything irreversible — and *everything*, whatever its size, while a
  campaign is running in the scraper repo (its tracker says). Unsure means
  major. The two [§9](#9-schema-manifest) migrations are expected handoffs.
  The one forbidden move is Admin-side workaround code written to dodge a
  scraper-side edit — worse than deciding either way.
- **Reuse over reimplementation, the database over files**: knowledge the
  repos share is consumed where it is shared — domain value schemas and
  source state are rows Admin already reads; nothing is re-encoded from
  scraper YAML by hand. Reuse that would need scraper files at runtime is a
  flagged gap, not a silent copy; the common home for cross-repo artifacts
  is [infrastructure.md](infrastructure.md)'s (registry hosting, codegen),
  extracted when that design lands.

## Parked: the operator and the free-form door

Deferred with the AI layer (ROADMAP queue item 7); the contract is fixed, the
machinery waits for its producer.

- Two front doors, one pathway: **structured controls** (deterministic
  switches and buttons — v1 ships only the verdict actions) and **free-form
  tickets** (natural language the operator interprets into the same actions,
  asking back when intent is ambiguous).
- Operator-first routing: every item passes through the operator before the
  inbox — classes with earned autonomy settle autonomously and are logged;
  only the remainder reaches the human, recommendation attached
  ([ai-learning.md](ai-learning.md)).
- Async operations land as `commands` rows picked up by agents and crons;
  config changes become commits made by an agent from a filed command. The
  `commands` table ships with its first consumer.

## Parked: recommendations, incidents, and agent runs

Each table ships with its first writer, columns designed then:

- `recommendations` — every specialist proposal: item, proposed action,
  rationale, confidence, evidence refs, outcome. First writer: the first
  propose-only AI role (queue item 7).
- `incidents` — source-health cases: opened-by, evidence, actions, state,
  resolution. First writer: incident triage.
- `agent_runs` — every autonomous agent action: kind, trigger, status,
  summary, token cost, artifact links. First writer: the first `ai` adapter
  or agent. Bulky artifacts (transcripts, case files) live in R2, referenced
  from rows.
- Read-only mirrors of the config registries (domains, source config), synced
  at deploy so Admin displays what production runs. Ships when config changes
  become commands; until then the registry is read in its repo.
- A severity ranking formula (visibility × impact) and its gauges — v1 ranks
  by the registry's `low` / `high` alone.
