# kspace Data Ecosystem — Design

- Status: **DESIGN**
- Last Major Update: 2026-08-10
- Scope: Everything that collects, verifies, stores, and corrects K-pop data.

This document contains high-level decisions only. Schemas, tables, mechanics, and
implementation detail live in the [designs/](designs/) children (one per
buildable unit, [ROADMAP.md](ROADMAP.md)); each child opens with a human-readable
overview.

**In one sentence**: every source — scraper, admin, user, AI — writes *claims* into
a single evidence table; a resolver weighs competing claims by trust and writes the
winners into the canonical tables the app reads, stamping every field with where it
came from; humans correct the system through one reviewed inbox, and every
correction teaches it.

---

## 1. Goals

**Collect all K-pop information the app needs, with maximum correctness and
freshness.**
- Core domains: groups, idols, events (all kinds — concerts, official
non-concert events, fan-run events), venues, releases
- Future domains must be cheap to add: one registration flow stands up schema,
tables, and collection ([§5](#5-domain-registry)).

**Correctness is measurable.** Every fact knows its origin, its last confirmation,
and what disagrees with it. Wrong data is detected by the system, never discovered
by users.

**The ecosystem heals itself.** Stale data, conflicting claims, and broken scrapers
are found and repaired by the system — automatically where it has earned that trust,
otherwise by escalating one small, well-prepared decision. Every human correction
teaches it ([§9](#9-the-ai-layer)).

**An AI operator stands between the system and the human.** Escalations of every
kind — failing pipelines, uncertain data, review items — go to the operator first.
It handles what its track record has earned, and passes up only what it cannot, with
the evidence prepared ([§9](#9-the-ai-layer)).

**Human attention is the scarcest resource.** One person operates all of this.
Attention is requested rarely, and every request is kept small. Agents write the
code; the repo must stay human-operable.

**Cost is a dial, not an architecture.** The design targets the long-term system even
though today's budget is small: every cost is tracked as it is incurred, and every
expensive component ships with a cheaper mode. Moving the dial — down now, up later —
never requires redesign ([§9](#9-the-ai-layer)).

---

## 2. Core architecture: hybrid ledger — **LOCKED**

[designs/data-model.md](designs/data-model.md) — envelope, identities, provenance table

> Sources produce **observations**. A **resolver** merges observations into
> **canonical** records. Canonical records carry per-field provenance.

- **The ledger**:
  - an **observation** = one source asserting one fact about one entity, in a
    uniform envelope, in one table — a Ticketmaster hit, an admin edit, a user
    request, and an LLM extraction differ only in trust tier
  - **canonical** tables are the master copy the app reads; observations are
    prunable evidence, never needed to rebuild canonical
  - **one write path**: everything enters as observations; the resolver is the only
    writer of canonical.
- **Invariants**:
  - **change-only growth**: a new observation row only when a source changes its
    own claim; re-confirmations bump a timestamp — tables grow with the world, not
    the scrape schedule
  - **per-field provenance**: every canonical write stamps, in the same
    transaction, which observation won each field, at what tier, and whether an
    admin locked it.
- **Vocabulary**:
  - two identities: *fact identity* (the canonical slot a claim targets — what
    resolution groups by) and *claim identity* (fact + source — one voice's
    position); disagreement = multiple live claims on one fact
  - one entity per observation; cross-entity mentions are references resolved by
    entity linking; creation policy per domain, a registry setting: events and
    venues `open` (row created on first sight); groups and idols `curated` (only
    humans create rows) until the catalog source is an adapter, then `open`
  - *domain* = which rulebook (schema + resolution policy) governs a claim;
    *entity* = which table + row it targets
  - raw payloads live in object storage, never Postgres.

**Rationale** — rejected: full ledger (replay semantics, unprunable history; 5/10 vs
hybrid 8/10); direct canonical writes for trusted pipelines (two provenance
stampers, and trial + repair need observation history from every source anyway).

---

## 3. Trust & resolution policy

[designs/resolver.md](designs/resolver.md) — tier table, mechanics

Resolution is deterministic — tier × mutability × corroboration — never per-case
code.

- **Tiers**:
  - admin / official / trusted / standard / untrusted — starting positions by
    source class, not identities; rules speak tiers, and measured reliability moves
    sources between them
  - **trust falls freely, rises with friction**: demotion automatic, promotion
    gated; every move human-signed until the scoring formula exists
  - gaps: ≥2 tiers apart = silent win allowed on immutable facts; adjacent =
    escalate or corroborate.
- **Mutability, per field**:
  - *immutable* (e.g. birth_date, real_name): disagreement means someone is
    wrong; recency irrelevant
  - *mutable* (e.g. event status, agency): newer supersedes, from an
    equal-or-higher tier only
  - *selection* (images): curated from candidate pools, not adjudicated; an admin
    pin sticks.
- **Resolving**:
  - low-tier claims wait in volatility-scaled corroboration windows: corroborated →
    apply; re-confirmed old value → reject; neither → verification / inbox /
    expire. High-severity facts show `disputed` while contested
  - every run ends apply / hold / escalate, and every run is recorded; the
    thresholds between outcomes are the attention-budget knobs, gauge-tuned.
- **Humans & verification**:
  - admin stickiness: scrapers never silently overwrite an admin value; new
    contradicting evidence reopens a review item
  - active verification: inbox-bound conflicts passing a worth-it gate get
    searched. Evidence enters as observations attributed to the cited sites;
    judgment rides as a recommendation — never a claim. Propose-only until earned;
    then execution applies ledger evidence, never asserts its own.

---

## 4. Freshness

[designs/resolver.md](designs/resolver.md) — the surviving principles;
withdrawal decided against there.

- Re-emission is confirmation, automatically (change-only rule).
- **Time alone never changes confidence — only evidence does.** Confidence is a
  property of claims, not canonical rows: per-claim confidence arrives with AI
  extraction as a weighing input; a row's "contested" is derived from its open
  review items, never stored. `withdrawn` — confidence moved by a source's
  silence — is decided against, re-opened only by the correctness auditor's
  measured silent-delisting rate.
- End-of-life is derived, never stored: past events read as `archived`; absence
  of past events from sources is expected, not a signal.
- The per-source health expectation ("yields or confirms roughly every X")
  stays with the watchdog at the source level (§11); per-field freshness
  expectations are dormant registry settings, read by nothing.

---

## 5. Domain registry

[designs/data-model.md](designs/data-model.md) — registry contents, add-a-domain flow, roster

A **domain** = one entity type (events, venues, groups, …), declared in repo
config; each domain owns exactly one canonical table. Kind distinctions within
an entity (concert vs. fansign) are data, not domains.

- Per domain: versioned value schema, the canonical table,
  per-field mutability and freshness, resolver settings. (Feeding sources are
  declared source-side, in each source's config — §6.1.) Changes are commits;
  Admin shows a read-only mirror.
- **Canonical from the get-go**: registering a domain includes its migration. No
  tables-later phase.
- **Schemas designed up front**, imperfect in two known ways (fields hard to
  obtain; fields nobody declared) — handled by continuous schema feedback
  (fill-rate reports, unmapped-data candidates).
- Event domains share one core `events` table + per-kind extension tables.

---

## 6. Sources

### 6.1 Registry — config + state

[designs/data-model.md](designs/data-model.md) — config + state field detail

*What a source is = config (repo); what changes at runtime = state (one table row);
how it works = its adapter.*

- Config: identity + domains fed, starting tier, usage (`full | verify_only`),
  operation dials, legal snapshot.
- State: lifecycle (`candidate → trial → active ⇄ paused → retired`) + note,
  current tier, checkpoint (adapter-only token).
- **Discovered sources**: sites the search verifier cites get minimal `cited` state
  rows (untrusted, cannot collect) where reliability accumulates; strong records
  become intake candidates.

### 6.2 Adapters

[designs/adapters.md](designs/adapters.md) — contract, toolkit, entity linking, knowledge base

One module per source; free-form inside, fixed boundary.

- Contract: emit the envelope, own the checkpoint, ship golden-sample tests. An
  AI-assisted source is just an adapter whose parse step is extraction.
- Shared toolkit for everything not source-specific; a colocated knowledge base
  (conventions + per-source notes) holding current truth only, rewritten on every
  repair; history lives in `incidents` rows, fixtures, and git.
- **Entity linking** (child design): at emission when the source makes it certain;
  at resolution as the backstop. Only judgment-free matches auto-link; unlinked
  claims hold and retry every cycle.

### 6.3 Source-intake

[designs/source-intake.md](designs/source-intake.md) — stages, trial mechanics

One scripted front door; ~15 minutes of human time.

- Candidate → assessment (AI-drafted config, human-approved commit) → adapter build
  (from nearest adapter + knowledge base) → **trial** (collects quarantined;
  promotion by evidence, quarantined rows released on promotion) → active (full
  authority; scrutiny scales down with track record).

### 6.4 Self-healing

[designs/self-healing.md](designs/self-healing.md) — detection, triage, repair

Only structural breaks get healed; noise is recorded and absorbed.

- Deterministic detection → read-only triage (cents; "data stopped" gets eyes within
  hours) → repair agent with a rich case file; fixes ship like any code and re-enter
  trial. Semantic breaks (dropped field, access-model change, meaning change)
  escalate immediately. Budgets capped; escalation rate itself monitored.

---

## 7. Legal policy (dev-phase)

- **Development**: collect from everything usable; legal facts recorded at intake,
  never enforced. Expected-fail sources can still serve as `verify_only`.
- **Pre-launch** (LAUNCH.md): audit every source, including `cited` sites; run the
  purge workflow — drop a source's observations, re-resolve every fact it won
  (found via provenance).
- **Post-launch**: the intake legal check becomes blocking.
- **Standing rules, regardless of phase**:
  - images are planned in advance, never deferred: no download without a declared
    per-source image policy, checked first; self-host everything displayed, with
    per-image provenance and a takedown path; image fields are selection fields —
    download only what selection shortlists
  - payload retention follows re-fetchability (ephemeral sources keep long, sweeps
    keep short), capped by contractual limits; payloads are internal evidence only
  - honor crawl-delays and rate limits; honest User-Agent.

---

## 8. Review surfaces, observability & the Admin contract

[designs/admin-observability.md](designs/admin-observability.md) — tables, queues, command pathway

Admin is the single window — health overview + escalation pathway, never a database
viewer.

- **Observability**:
  - *if it isn't in the database, it didn't happen*: every run, agent action,
    incident, escalation, recommendation, and verdict is a row Admin can render
    (`runs`, `agent_runs`, `incidents`, `review_items`, `recommendations`,
    `verdicts`, `sources`, `commands`, plus config mirrors); bulky artifacts live
    in R2, referenced from rows
  - verdicts are human or machine, by actor — human rows are the training signal;
    autonomy is never self-graded.
- **The inbox**:
  - typed review queues (never one pile), a cross-queue dashboard, and the
    standing-disagreements view (investigable on demand, demands nothing)
  - items arrive operator-routed: evidence assembled, recommendation attached,
    one-tap verdict the target
  - every verdict does double duty: an admin-tier observation through the normal
    resolver, and a labeled training example
  - override tickets: "event X is actually date Y" is a structured form that
    becomes an admin-tier observation — the same resolver path as everything.
- **Acting**:
  - two front doors: structured controls (deterministic) and free-form tickets
    (operator-interpreted); everything lands as rows
  - **HARD RULE: admins never modify the database directly**
  - user contributions (requests only at launch): the user-feedback layer is the
    users' adapter — freeform text becomes untrusted observations, deduplicated
    into priority and corroboration; never silently dropped; corrections trigger
    verification ([designs/user-feedback.md](designs/user-feedback.md)).

---

## 9. The AI layer

[designs/ai-learning.md](designs/ai-learning.md) — learning signals, memory, health


- **Shape**: a thin **operator** (router; owns the human interface — prioritizing,
  batching, phrasing every ask) plus deep **specialists** (extraction — embedded
  per adapter, linking, adjudication, source-intake assessment, incident triage,
  repair, search verification; an open set), each with role-scoped memory.
- **Authority**:
  - confidence orders work; only **earned autonomy** — per task class, measured
    against human verdicts, revocable, audit-sampled — grants the right to settle
    anything. AI never writes canonical directly
  - bootstrap costs attention — accepted: until autonomy is earned, most judgments
    reach the human, and the design makes each one cheap (evidence pre-assembled,
    clear recommendation, one tap, digests).
- **Learning** (deterministic; the AI never retrains itself):
  - verdicts become worked examples + an eval suite; deterministic memory compounds
    (confirmed matches, reliability records, the knowledge base); autonomy is earned
  - free-form admin feedback is a first-class teacher, for what verdicts can't
    express
  - guard rules: audit sampling (autonomous classes and silent wins permanently
    sampled to the inbox; evals only grow) and no dial without a gauge (every
    threshold ships with both-ways logging).
- **Cost — tracked and elastic**: every AI call metered to `agent_runs`; soft cap
  alerts, hard cap auto-pauses non-essential roles. Every expensive component ships
  with a cheaper mode; dials are config, starting low.

---

## 10. Storage

- **Postgres** (shared Supabase; the scraper repo owns migrations) stores all data tables;
  the change-only invariant keeps them small for years.
- **Config is not database storage**: registries live in the repo; only runtime
  state in tables.
- **jsonb policy**: typed columns by default; jsonb only where flexibility is the
  point (the observation `value`), always schema-validated. (Agent enforcement:
  root CLAUDE.md.)
- **Object storage is R2 from the start**: payloads (retention per
  [§7](#7-legal-policy-dev-phase)), images, and bulky run artifacts — row in
  Postgres, blob in R2. (Legacy thumbnails move at the full-res re-seed.)

## 11. Orchestration

- **Railway crons** per entry point; resumption via per-source checkpoints.
- **Runs serialized per source**: a tick skips if the previous run is active; skips
  are logged and never routine — repeated skips open an incident.
- **Secrets in the deploy environment**, referenced by name from config — never in
  the repo.
- **Watchdog** is the reliability keystone (expectations, absence detection,
  incidents, auto-pause) — with one external uptime ping watching the watchdog
  itself.

**Rationale** — rejected: orchestrator platforms (Temporal etc.), 2/10 at this
scale; `commands` + crons cover async needs.

---

## TODO — completing this design

Only what this document needs to be complete; all other work lives in
[ROADMAP.md](ROADMAP.md).

- [x] Re-read the restructured parent (all detail lives reviewed in `designs/`).
- [ ] Update both diagrams to the final document state.
