# Data Model — Design

- Status: **EXTRACTED** — reviewed content relocated from ECOSYSTEM.md (2026-08-10);
  deeper implementation design pending (TODO at bottom).
- Parent: [ECOSYSTEM.md](../ECOSYSTEM.md) §2 (core architecture), §5 (domain
  registry), §6.1 (source registry). ROADMAP queue item 1.
- Depends on — concepts owned elsewhere:
  - **canonical** — the master tables the app reads; observations are evidence,
    canonical is the answer ([ECOSYSTEM §2](../ECOSYSTEM.md#2-core-architecture-hybrid-ledger--locked))
  - **resolver** — the sole writer of canonical; weighs live claims per fact
    ([resolver.md](resolver.md))
  - **tier** — a source's trust level, admin → untrusted ([resolver.md](resolver.md))
  - **adapter** — the per-source code that turns fetched content into observations
    ([adapters.md](adapters.md))
  - **entity linking** — matching an observation to its canonical row (child design
    pending, ROADMAP; interim policy in [adapters.md](adapters.md))
  - **search verifier** — the agent that gathers web evidence for contested facts
    ([resolver.md](resolver.md))
  - **trial / quarantine** — a new source's proving period; its observations are
    held from canonical until promoted ([source-intake.md](source-intake.md))

## Overview

The data model is the foundation everything else builds on. It consists of a set
of core data tables, the observation envelope, and the domain and source
registries.

### Core data tables

- `observations` — every claim made by every data source; the system's evidence
  record.
- `field_provenance` — which observation won each canonical field.
- `sources` — each data source's runtime state.

### `observations` envelope

Every data source in the system — scraper, admin, user, AI — writes claims into
one `observations` table using one envelope shape.

Two identities organize the table:

- The **fact identity** (domain + entity_id + field) names the slot in
  canonical a claim targets — it's what resolution groups by.
- The **claim identity** (fact identity + source) names one voice's position on
  that fact — the latest row per claim identity is that source's current claim,
  and disagreement is simply multiple live rows sharing one fact identity.

Growth is controlled by the change-only rule: a new row appears only when a source
changes its own claim; re-confirmations bump a timestamp in place.

The resolver compares all claim identities and selects the best one to write to
the canonical table. Every canonical field knows which observation won it.

### Domain and source registries

Each registry is a repo config file — reviewed, historied commits:

- The **domain registry** declares what kinds of data exist. A domain is one
  entity type — it declares exactly one canonical table. Registering a domain
  stands up everything at once: value schema, canonical table, resolver config.
- The **source registry** declares who supplies the data: identity, starting
  tier, operation dials, legal snapshot. A source's *runtime state* (lifecycle,
  current tier, checkpoint) lives in the `sources` table, not in config — config
  changes by commit, state changes at runtime.

## Design

### The observation envelope

```
observation {
  observation_id,         -- unique row id (primary key)

  -- fact identity: the slot in canonical this claim targets
  domain,                 -- one entity type = one domain = one canonical table
  entity_id,              -- row id in canonical table; NULL until linked
  field,                  -- canonical field name; never NULL — one claim per field

  -- the claim: what is asserted
  value,                  -- normalized value (jsonb, validated against domain schema)
  schema_version,         -- domain schema version

  -- attribution & evidence: who said it, and proof
  source_id,              -- references the sources registry; tier derives from this
  external_ref,           -- the source's own id for THIS entity; NULL when it has
                          -- none (empty/whitespace-only normalize to NULL — one
                          -- spelling of "no reference")
  payload_ref,            -- pointer to raw payload in object storage (never in PG)
  observed_at,            -- first time this (source, entity, field, value) was seen

  -- lifecycle: system-managed; the only fields that change after write
  last_confirmed_at,      -- bumped when the source re-asserts the SAME value (no new row)
  status                  -- pending | applied | superseded | rejected | quarantined
}
```

### The write path

- **One ingest gate**: every observation enters through a single shared write
  path — it validates `value` against the field's declaration in the domain
  schema, applies the
  change-only rule (same value → bump `last_confirmed_at`; changed value → new
  row, previous row marked `superseded`), and stamps the initial `status`. No
  writer implements this logic itself.
- **The gate refuses what it cannot stand behind**: an unknown domain or
  schema version; a field the domain schema doesn't declare; a value that
  violates its field's declaration; a NULL `field`; a string value that is
  empty after normalization (an empty extraction is no claim — absence is
  silence on the wire and NULL in canonical); an `observed_at` more than
  5 minutes in the future (clock skew passes, bad data doesn't). Every
  refusal carries a stable error code — see the gate implementation note.
- **Time orders claims per source**: a claim whose `observed_at` is older
  than the source's current live claim is recorded as history (born
  `superseded`), never displacing the newer claim. An exact replay of a row
  the gate already holds (same claim identity, value, and `observed_at`)
  writes nothing and bumps nothing.
- **Batches are atomic**: a batch lands whole or not at all, and resubmitting
  an identical batch is idempotent. A batch asserting two different
  normalized values for one claim identity is refused whole — a
  self-contradicting batch is an adapter bug, and write-order must never
  decide which value wins.
- **Server-side only**: no client writes `observations` directly. Adapters,
  admin edits, user feedback, and AI proposals all reach the gate through their
  own flows; RLS admits writes only from the service role.

### The observations table

- Identity — two layers:
  - **Fact identity** = (domain, entity_id, field): the canonical slot a claim
    targets; what the resolver groups by.
  - **Claim identity** = fact identity + source_id: one voice's position. The latest
    row per claim identity is that source's current claim; earlier rows are marked
    `superseded`. **Disagreement = multiple live rows sharing one fact identity.**
  - The change-only rule operates per claim identity: a new row only when a source
    changes *its own* claim; a flip A→B→A writes a new row (history stays ordered).
  - Rows before linking have no fact identity yet: claim identity =
    (source_id, domain, external_ref, field); fact identity exists once entity
    linking fills entity_id.
  - `external_ref` is the source's own id **for the claimed entity**: venue
    claims carry the venue's reference, never the reference of the event that
    mentioned the venue — otherwise one venue's claims fragment across every
    event it hosts. "No reference" has one spelling: NULL (empty and
    whitespace-only refs normalize to it at the gate).
- Granularity — per-field only: every observation is one claim about one field;
  there are no whole-record rows. How a source's output is chunked into claims
  is the adapter's business ([adapters.md](adapters.md)) — the data model sees
  claims, never records. A field absent from a source's output produces no row:
  silence is not a claim.
- One entity per observation:
  - Adapters emit many observations from one payload, across domains (a
    Ticketmaster concert payload → per-field claims about the event in the
    `events` domain and about its venue in the `venues` domain, all sharing
    `payload_ref`).
  - Cross-entity mentions inside a record are **references** resolved by entity
    linking, never embedded data. A reference travels as a claim on a
    **reference-class field** (an event's `venue`, its `performers`) whose value
    names the other entity in the source's own terms — its `external_ref`, its
    billed name, any external identifiers — never a canonical id; the link
    stage and the resolver turn it into the link column or link-table rows
    ([adapters.md](adapters.md), [entity-linking.md](entity-linking.md)). A
    reference that cannot link yet holds the claim at `pending` or escalates to
    the entity-link queue.
  - Whether canonical holds a row for a newly sighted entity is the target's
    **creation policy** (domain registry): an `open` target gets its canonical
    row created at resolution on first sight; a `curated` target never does — a
    human creates the row, and claims hold at `pending` until it exists.
    Creation mechanics are the resolver's ([resolver.md](resolver.md)).
  - Creation and visibility are separate bars: a created row becomes
    user-visible only once its target's `publish_requires` fields are all
    resolved. Below that bar the row exists for the system and the admin —
    accumulating fields as claims resolve — but never for users.
- Mutability after write — exactly five columns change:
  - `entity_id` — system-managed by linking: written NULL → id when entity
    linking resolves the row. A **merge** is the one rewrite: when open
    creation has produced duplicate canonical rows for one real entity, the
    duplicate's observations are re-pointed at the surviving row and the merge
    is recorded. Nothing else ever rewrites it (merge mechanics: the
    entity-linking design, ROADMAP).
  - `status` and `last_confirmed_at` — system-managed lifecycle.
  - `rejected_at` and `rejected_by` — written once, when a claim is
    adjudicated out ([resolver.md](resolver.md)).
  - Everything else is immutable.
- Status — **live** means `pending` or `applied`; resolution only ever weighs
  live rows:
  - `pending` — a live contender that is not the current winner. A losing claim
    stays `pending`; it can win later when tiers or evidence shift.
  - `applied` — the current winner of its fact identity; at most one per fact,
    and only a linked claim (a NULL `entity_id` has no fact identity to win) —
    both enforced by constraint, not convention. A displaced winner returns to
    `pending`, not `superseded`.
  - `superseded` — replaced by a newer row from the same source (the change-only
    rule); terminal.
  - `rejected` — adjudicated out: by a verdict, or by the resolver
    mechanically re-rejecting a value a verdict already settled; stamped
    `rejected_at` / `rejected_by` ([resolver.md](resolver.md)). Excluded from
    resolution; terminal.
  - `quarantined` — written while the source is in trial. Promotion flips the
    source's quarantined rows to `pending`, entering resolution normally.

### Per-field provenance

- **HARD RULE**: every canonical write appends per-field provenance in the same
  transaction — the `field_provenance` table is an append-only decision log,
  one row per canonical write: `{fact identity, source_id, observation_id,
  tier_at_apply, applied_at, admin_locked}`. The latest row per fact identity
  is the current provenance; the rows before it are that fact's decision
  history. Rows are never updated or deleted. On an unset row — a verdict
  unsetting a nullable column ([resolver.md §8](resolver.md#8-applying-the-transaction)) —
  `observation_id` and `source_id` are null: the row's authority is the
  verdict, not a winning observation.

### Payload storage

- Object storage (R2), content-addressed:
  `payloads/<source>/<yyyy-mm>/<body-hash>.json.gz` — identical payloads dedupe by
  construction.
- One payload may back many observations (one sweep response covers many events).
- Retention: kept while any referencing observation exists, then governed by the
  per-source re-fetchability policy (ECOSYSTEM §7).

### Domain registry (config file)

- **A domain is one entity type.** Each domain declares exactly one canonical
  table; "domain" and "entity type" are one concept with one name. Kind
  distinctions within an entity (a concert vs. a fansign vs. a cup-sleeve
  event) are **data** — a field on the entity — never registry structure:
  a new kind of event is a new value, not a new domain registration.
- Per domain: value schema (a versioned schema file), the canonical table
  (with its creation policy and `publish_requires`), per-field mutability and
  freshness scope/rate, resolver settings. Feeding sources are declared
  source-side (a source names its domains), keeping the mapping
  single-authority.
- Schema feedback, continuous for every domain:
  - **fill-rate reports** — per field, how often sources actually supply it; a field
    at 3% needs a new source or deletion
  - **unmapped-data candidates** — a schema-change proposal raised when a source
    repeatedly supplies data no declared field covers. Discovery is adapter-side
    ([adapters.md](adapters.md)) — structured payloads expose unmapped keys
    mechanically, extraction sources report leftovers — the registry only
    receives the proposal.
  - the schema evolves through ordinary config commits (plus migrations when columns
    change); rows already written are never rewritten — each keeps its
    `schema_version`.
- Adding a domain — the definitive flow:
  1. **Candidate** — name it, why, a few real example items.
  2. **Register** — AI-drafted, human-approved: config entry (schema v1 from the
     examples, field classes) + the migration (tables, FKs, RLS) +
     resolver config. One flow; everything stood up together.
  3. **Collect** — sources join by their own config commits: an existing source
     adds the domain to its declaration; a new source arrives via source-intake.
     A source can only declare registered domains, so a source bringing a new
     domain registers the domain first. A domain with no sources yet is valid —
     registered, empty.
  4. **Operate** — schema feedback drives config commits and follow-up migrations.

### Domain roster

| Domain | What it covers |
|---|---|
| groups | the catalog of groups — `curated` while only ticketing feeds sight acts (a feed cannot tell a group from a soloist); `open` once the catalog source is an adapter (ROADMAP queue item 9) |
| idols | the catalog of idols — same policy as groups |
| events | every kind of event — concerts, tours, fansigns, fanmeets, showcases, pop-ups, cup-sleeve events, birthday cafes. The kind is a field (`event_type`); unstructured-source kinds get the same schema treatment as structured ones |
| venues | where events happen; venue facts usually arrive inside event payloads, and their claims carry the venue's own reference |
| releases | releases and their presale benefits |

News is not a domain: a news source's adapter emits claims into whichever
domains its articles concern, and additionally feeds change-signals into other
domains via extraction (ECOSYSTEM §5).

Within the `events` table, kind-specific data defaults to nullable columns on
the one table; a per-kind detail table joined on the event id is available
when a kind accumulates enough unique fields to earn it — and a kind with
substantially distinct data should be weighed as its own domain instead. The
concrete layout is decided at the events build (ROADMAP queue item 5).

### Source registry (config + state)

- **Config** (repo): identity — name, what it is, how we reach it, domains fed (not
  necessarily a URL: a partner API, a data drop, and a scraped site are all just
  adapters; transport is the adapter's business); starting tier by class; usage
  `full | verify_only`; operation dials (collect cadence, verification budgets, rate
  limits — per-adapter, uniquely shaped); the legal snapshot (`legal_status`, notes,
  computed `launch_blocker`).
- **State** (`sources` table — exactly one row per source): lifecycle
  (`candidate → trial → active ⇄ paused → retired`) + free-text `note`; current
  tier; `checkpoint` — one opaque resume token, readable/writable only by its
  adapter. Idempotency makes stale checkpoints safe: resuming re-confirms claims,
  never duplicates them.
- **Discovered sources**: sources have two kinds — `registered` (config + adapter +
  state row, via source-intake) and `cited` (a minimal state row auto-created the
  first time the search verifier cites a website: no adapter, no config, tier
  `untrusted`, cannot collect). The cited row is what `source_id` points at and
  where the site's reliability record accumulates; a consistently strong record
  makes the site a Stage-0 source-intake candidate.

### Rationale

- The config/state split falls out of cardinality: config is heterogeneous per
  source (→ files); state is homogeneous across sources (same typed columns, many
  rows → one table). The table also earns its keep operationally: pause must be
  commit-free, and fleet state must be queryable.
- The change-only rule makes table growth track the real-world per-field change
  rate, not the scrape schedule: first sight of an entity writes one row per
  supplied field; after that, one row per actual field change. Single-digit
  millions of rows/yr worst case — trivial for Postgres.
- `tier_at_apply` in `field_provenance` is a snapshot: tiers drift with measured
  reliability; provenance records the tier a decision was made with, so past
  decisions stay explicable.

## Implementation notes

### Domain registry — config format

- **One file per domain**, YAML: `registry/domains/<domain>.yaml`. YAML over
  JSON/TOML because reviewed config needs comments — these files are read at
  review time more than at runtime.
- **Repo location**: the scraper repo owns the data layer, so the registry
  lives there, in an isolated top-level `registry/` folder (domain configs,
  source configs, schema files). Config and schema files only — a hard rule;
  no code lives under `registry/`. Other repos never read the folder directly:
  they consume generated artifacts ([infrastructure.md](infrastructure.md)).
  Every path inside a registry file (e.g. `schema.file`) is relative to
  `registry/`.
- **Validity rules** — part of the format definition; enforcement is the
  validation framework's job ([infrastructure.md](infrastructure.md)):
  unknown keys are errors; `fields` and `publish_requires` are cross-checked
  against the domain's schema file — a name the schema doesn't declare is an
  error, and a schema field with no `fields` entry falls back to `defaults`;
  immutable fields carry no freshness expectation; a source config naming a
  domain with no registry file is an error (a cross-file check against the
  source registry).
- **Feeding sources are not listed here**: a source declares the domains it
  feeds in its own config — one intake commit touches one file, and the
  domain↔source mapping has a single authority.

Key reference — the format definition. The machine-readable version is a JSON
Schema file enforced by the validation framework
([infrastructure.md](infrastructure.md)); the reference below documents it.

Top level:

| Key | Type | Required | Meaning |
|---|---|---|---|
| `domain` | string, `[a-z_]+`, unique across the registry | yes | the key observations stamp as `domain`; one domain = one entity type |
| `description` | string | yes | one line, for humans |
| `schema.file` | path | yes | the domain's versioned value schema (JSON Schema) |
| `schema.version` | integer ≥ 1 | yes | the version new observations validate against |
| `table` | string | yes | the domain's one canonical table, stood up by its migration |
| `creation` | `open \| curated` | yes — always explicit, no default | `open`: a canonical row may be created on first sight; `curated`: only humans create rows |
| `publish_requires` | list of field names | no — default empty | fields that must be resolved before the row is user-visible; empty = visible from creation |
| `defaults` | field settings | no | inherited by every field unless overridden |
| `fields` | map of field name → field settings | no | per-field overrides; an absent field gets `defaults` |
| `resolver` | resolver settings | yes | domain-level knobs; semantics owned by [resolver.md](resolver.md) |

Field settings — every key optional; unset falls to `defaults`, then to the
built-in default:

| Key | Type | Built-in default | Meaning |
|---|---|---|---|
| `mutability` | `immutable \| mutable \| selection` | `mutable` | weighing class ([resolver.md](resolver.md)) |
| `severity` | `low \| high` (values owned by resolver.md) | `low` | feeds the resolver's escalation cutoffs |
| `freshness` | `none` or `{scope, expected_change}` | `none` | the expectation that the field gets re-confirmed — currently read by nothing (withdrawal decided against; [resolver.md](resolver.md)), recorded for a future re-opening |
| `freshness.scope` | `upcoming \| all` | — | which rows the expectation applies to |
| `freshness.expected_change` | duration | — | how often the value really changes; tunes windows and verification budgets |
| `selection` | enum of implemented policies — initially `newest_wins` | — | required iff `mutability: selection`, forbidden otherwise; a name outside the implemented set is an error |
| `kind` | `fact \| reference` | `fact` | a `reference` field's value names another entity in the source's own terms; entity linking resolves it into a link column or link-table rows, and no canonical fact column carries it |
| `references` | list of domain names, ≥ 1 | — | required iff `kind: reference`, forbidden otherwise; each must exist in the domain registry (cross-file check) |

Resolver settings:

| Key | Type | Required | Meaning |
|---|---|---|---|
| `windows.fast` | duration | no — absent means zero-length | corroboration window for fast-moving facts (windows deferred; [resolver.md](resolver.md)) |
| `windows.slow` | duration | no — absent means zero-length | corroboration window for slow-moving facts (windows deferred; [resolver.md](resolver.md)) |

Duration syntax: `<integer><unit>`, units `h` / `d` — `24h`, `30d`.

Example:

```yaml
# registry/domains/events.yaml
domain: events
description: Every kind of event — concerts, tours, fansigns, fan-run events
schema: {file: schemas/events.schema.json, version: 3}
creation: open
publish_requires: [title, starts_at]
defaults: {mutability: mutable, severity: low, freshness: none}
fields:
  starts_at:
    severity: high
    freshness: {scope: upcoming, expected_change: 30d}
  poster_url: {mutability: selection, selection: newest_wins}
  venue: {kind: reference, references: [venues]}
  performers: {kind: reference, references: [groups, idols]}
resolver:
  windows: {fast: 24h, slow: 72h}
```

The canonical table is always named for the domain, so no key names it.

Venue facts live in their own domain file (`registry/domains/venues.yaml`,
same shape); a source that supplies both declares both.

- **Schema version bumps** are one commit: the schema file edit + the `version`
  bump (+ a migration when canonical columns change). Observations keep
  the version they validated against; nothing is rewritten.
- **Adding a domain is one PR**: this file + schema v1 + the migration — all in
  the scraper repo, which owns the schema. The gate validates the trio
  together; merge is the registration.

### Source registry — config format

One YAML file per registered source: `registry/sources/<source>.yaml`, same
treatment as the domain registry (JSON Schema format definition, unknown keys
are errors). Cited sources have no config file — they exist only as state
rows.

| Key | Type | Required | Meaning |
|---|---|---|---|
| `source` | string, `[a-z0-9_]+`, unique across the registry | yes | the source's stable identifier |
| `description` | string | yes | what it is and how we reach it, for humans |
| `domains` | list of domain names, ≥ 1 | yes | the domains this source feeds; each must exist in the domain registry (cross-file check) |
| `tier` | `admin \| official \| trusted \| standard \| untrusted` (owned by [resolver.md](resolver.md)) | yes | starting tier; the *current* tier lives on the state row |
| `usage` | `full \| verify_only` | yes | whether the source collects, or only corroborates |
| `dials` | map | no — default empty | operational knobs (cadence, budgets, rate limits). Opaque to this format — the checker requires only that it is a map; shape and validation belong to the source's adapter ([adapters.md](adapters.md)) |
| `resolver` | map | no — default empty | per-source resolver overrides. Unlike `dials`, the shape is fixed and format-validated; exact shape and semantics: [resolver.md §12](resolver.md#12-thresholds) |
| `legal.status` | string | yes | recorded legal posture; vocabulary is fixed at the pre-launch audit (ECOSYSTEM §7) — recorded, never enforced in development |
| `legal.notes` | string | no | the facts behind the status |

`launch_blocker` is computed from the legal snapshot, never written by hand.

```yaml
# registry/sources/ticketmaster.yaml
source: ticketmaster
description: Ticketmaster Discovery API — structured concerts and venues
domains: [events, venues]
tier: official
usage: full
dials: {collect_cadence: 6h, rate_limit_ms: 200}
legal: {status: api_terms, notes: key-based Discovery API}
```

### Value schemas — JSON Schema

- One schema file per domain — `registry/schemas/<domain>.schema.json` — the
  file the registry's `schema.file` points at. The same technology defines the
  registry config formats ([infrastructure.md](infrastructure.md)): one schema
  language and one validator stack across the system; TypeScript types are
  generated from the schema files, Python validates with a stock validator.
- Every field declares a `type`; a field the schema doesn't declare is an
  error (`additionalProperties: false`). All fields are optional at the claim
  level — a claim asserts one field at a time, so record-level `required` has
  no meaning here. The minimum a row needs before users see it is
  `publish_requires` (registry, below).
- The gate validates each claim's `value` against its field's declaration.
- **Reference-class fields have one shape**, declared in the schema like any
  object: a single reference is `{ "ref": <external_ref> }`; a multi-valued
  one is an array of `{ "ref", "name", "ids": { <scheme>: <id>, … }, "order" }`
  with `ref` required and the rest present only when the source supplies them.
  A value never carries a canonical id. The events schema v3 declares `venue`
  (single) and `performers` (multi-valued) this way; the columns they resolve
  into (`venue_id`, the `event_performers` rows) are not fields.

### Value normalization

- Normalization is the gate's job — the one point every value passes through;
  writers submit raw values and cannot get normalization wrong.
- Rules are type-level, one set system-wide:
  - timestamps — UTC, ISO-8601 strings (`format: date-time`)
  - strings — Unicode NFC, outer whitespace trimmed
  - enum values — exact match after string normalization
- Two values equal after normalization are the same claim: the change-only
  rule compares normalized values.
- A string value that is empty after normalization is refused — an empty
  extraction is no claim. Absence has one spelling per layer: silence on the
  wire, NULL in the canonical column. The adapter framework filters empty
  extractions before batching ([adapters.md](adapters.md)); the gate's
  refusal is the backstop that makes a leak loud.
- Per-field tightening (patterns, formats, value sets) lives in the domain
  schema, never in code.

### The ingest gate — Postgres functions

- The gate is a set of Postgres functions (RPC). This makes it
  language-neutral (every writer, in any language, calls the same functions),
  transactional where the same-transaction provenance rule lives, and
  physically enforced: table grants make the gate functions the only write
  path to `observations` — "no writer implements this logic itself" is
  construction, not convention.
- Value validation inside the gate uses the `pg_jsonschema` extension.
- **Refusals are an API**: every refusal raises a stable `KS`-prefixed
  SQLSTATE (KS001 unknown domain, KS002 undeclared field, KS003 schema
  violation, …) with message, DETAIL, and HINT. Callers branch on the code,
  never on message text. The allocated roster lives in the build's
  gate-interface artifact; codes are frozen once adapters ship — adding a
  code is cheap, changing one's meaning is a breaking change.

### Identifiers

- Every new table keys on UUIDv7 — globally unique and time-sortable, so any
  writer can generate ids without coordination.

### Deferred columns & counters

- **Per-claim confidence** — deferred until the first extraction domain
  (news) lands; an additive nullable column then. Nothing stored today needs
  it.
- **Gauge counters** — land with the admin-observability build (ROADMAP queue
  item 4), which defines what is worth counting; the first migration ships
  none.

## Legacy

The pre-ecosystem tables (`groups`, `idols`, `events`, `venues`,
`scraped_events`), the code that fills them, and the app code that reads them
are all **replaced** by this design — the build is greenfield, not a
migration. Rules for any build that encounters them:

- **The new tables own the real names.** At each domain's build (events:
  ROADMAP queue item 5; catalog: queue item 9), the legacy table is renamed
  aside (`legacy_events`, …) and the new canonical table takes its name. A
  renamed table is dead weight awaiting deletion (LAUNCH.md): nothing writes
  it, nothing references it.
- **No data survives.** Canonical starts empty and the resolver fills it from
  observations. No observation is ever fabricated from a legacy row; there is
  no synthetic `legacy` source. Provenance is real or absent.
- **Consumers update at the same build.** The current app and scraper predate
  launch; each domain's build updates them to the new tables — there is no
  compatibility window to maintain.
- **The staging machinery retires with its domain** — `scraped_events` and
  the reconciler go at the events build.
- **Anything else: flag it.** A legacy question not covered above is escalated
  to the human, never settled by judgment call.

Until a domain's build arrives, its legacy tables run untouched. The
data-model build itself (`observations`, `field_provenance`, `sources`) has no
legacy counterparts and renames nothing.

## TODO — completing this document

- [ ] Exact DDL: enum representations, constraints, index plan (the two hot
      paths: live claims per fact identity; latest row per claim identity) —
      builder-resolvable within the stated constraints, decisions recorded
- [ ] Format check against DESIGN_STYLE.md, then review with Ben
