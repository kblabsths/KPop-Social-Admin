import type { SupabaseClient } from "@supabase/supabase-js";
import {
  readComplete,
  readOne,
  readRowsByIds,
  type DbCountedResponse,
  type DbResponse,
  type DbResult,
  type DbUnavailable,
} from "./result";
import { REVIEW_ITEM_COLUMNS } from "./review-items";
import { T } from "./tables";
import { currentDecisions, type EventProvenanceRow } from "../browse/rows";
import type { ReviewItemRow } from "../review/shapes";

/**
 * The review-item DETAIL reads — campaign admin-window/TASK-0011.
 *
 * Authority: spec §6 (the anatomy — "the `evidence` observation ids resolved
 * to rows: value, source, tier, `observed_at`, payload link; the fact's
 * current canonical value and provenance beside them"), `contracts/resolver.md`
 * §11, `contracts/data-model.md` (the observation envelope, per-field
 * provenance), ARCHITECTURE.md §6 traps 1, 5, 7, 8 and 10.
 *
 * Every export returns a `DbResult` and never throws (§4.1); every table is
 * named through `T` alone (§4 rule 4); every join is §4.2's two-step — query A
 * returns rows, query B takes its ids — because PostgREST embedding needs a
 * foreign key and this app does its joins in TypeScript.
 *
 * **Three schema facts this module exists to get right** (ARCHITECTURE.md §6):
 *
 *  - trap 1 — `review_items` and `observations` spell the canonical table
 *    `domain`; `field_provenance` spells it `entity_type`. They hold the same
 *    value. `observations` used to carry BOTH, and this module selected the
 *    `entity_type` it never read — scraper migration
 *    `20260819000002_the_domain_is_the_entity_type.sql` dropped that column
 *    ("domain becomes the first part of both identities") while keeping
 *    `field_provenance`'s ("field_provenance IS NOT TOUCHED"), so the evidence
 *    read failed 42703 on every chunk and every item rendered zero evidence
 *    rows (admin-window/BUG-0024). Each read below uses its own table's
 *    spelling and the fact key translates once, in `factOf`.
 *  - trap 5 — **a claim has no tier of its own.** An evidence row's tier is
 *    `sources.tier`, the source's CURRENT tier, which drifts; the canonical
 *    side's tier is `field_provenance.tier_at_apply`, frozen at the apply.
 *    They are carried in different fields here so no caller can confuse them.
 *  - trap 7 — **the current canonical value** is the observation named by the
 *    LATEST `field_provenance` row for `(entity_type, entity_id, field)`,
 *    ordered `applied_at desc, provenance_id desc`, and only while that
 *    observation is still live. Both halves are honoured: the log is read
 *    COMPLETE and reduced by `currentDecisions` (the app's one "which decision
 *    is later" rule, `src/lib/browse/rows.ts`), and the winning observation's
 *    own `status` decides whether there is a current value at all.
 */

/* ── rows, exactly as the scraper repo's migrations declare them ─────────── */

/**
 * The `observations` columns this surface renders (migration
 * `20260818000000`, as amended by `20260819000002`, which dropped
 * `entity_type`). Explicit (§4.2): a page asking for a different set would
 * defeat the not-provisioned classification, which names the column the
 * database complained about — and every name here must be a column the table
 * really has, because an explicit select of a retired one is a 42703 that
 * empties the whole surface, not a missing field (admin-window/BUG-0024).
 * `tests/offline/review-item/read.test.ts` checks each name against the
 * fixture that states the table's columns.
 *
 * `value` is jsonb — the one json column in the system (trap 8) — so it
 * arrives as `unknown` and is rendered as its JSON text, never assumed to be
 * a string.
 */
export interface ObservationRow {
  observation_id: string;
  entity_id: string | null;
  field: string;
  /**
   * `observations` spells the canonical table `domain` — its only spelling of
   * it since migration `20260819000002` dropped `entity_type` from this table
   * (trap 1). `field_provenance` keeps `entity_type` and holds the same value.
   */
  domain: string;
  value: unknown;
  source_id: string;
  external_ref: string | null;
  payload_ref: string | null;
  observed_at: string;
  /** `pending | applied | superseded | rejected | quarantined`. */
  status: string;
}

/**
 * One row of the append-only decision log, with the tier frozen at the apply.
 *
 * The lock flag `field_provenance` also carries is deliberately NOT read here.
 * The repo's write-surface guard (`tests/offline/edit/config.test.ts`, "builds
 * no write path to a resolver-owned table or a link table") forbids that
 * column name on any code line under `src/`, and spec §6's anatomy does not
 * ask this surface for it — LOOK_AND_FEEL asks for it on the EDIT surface, so
 * whichever ticket builds that line is the one that has to settle the collision
 * with the guard. Reading a column this page does not render would be the
 * wrong way to start that argument (admin-window/TASK-0011).
 */
export interface ProvenanceRow extends EventProvenanceRow {
  provenance_id: string;
  entity_type: string;
  entity_id: string;
  field: string;
  /** Null on an unset: the row's authority is the decision, not a claim. */
  source_id: string | null;
  observation_id: string | null;
  /** The tier AT THE APPLY — frozen, unlike `sources.tier` (trap 5). */
  tier_at_apply: string;
  applied_at: string;
}

/** A source's id, the name an operator reads, and its CURRENT tier. */
export interface SourceRow {
  source_id: string;
  source: string;
  tier: string;
}

const OBSERVATION_COLUMNS = [
  "observation_id",
  "entity_id",
  "field",
  "domain",
  "value",
  "source_id",
  "external_ref",
  "payload_ref",
  "observed_at",
  "status",
].join(", ");

const PROVENANCE_COLUMNS = [
  "provenance_id",
  "entity_type",
  "entity_id",
  "field",
  "source_id",
  "observation_id",
  "tier_at_apply",
  "applied_at",
].join(", ");

const SOURCE_COLUMNS = ["source_id", "source", "tier"].join(", ");

/**
 * The statuses that are LIVE (`contracts/data-model.md`: "live means `pending`
 * or `applied`; resolution only ever weighs live rows"). A canonical value
 * exists only while the observation the decision named is one of these.
 */
const LIVE_STATUSES: ReadonlySet<string> = new Set(["pending", "applied"]);

/** Is this observation still live? The one definition this module has. */
export function isLive(observation: ObservationRow): boolean {
  return LIVE_STATUSES.has(observation.status);
}

/* ── the fact a per-fact item is about ───────────────────────────────────── */

/**
 * The fact identity, in the spelling `field_provenance` uses. `review_items`
 * and `observations` spell the same value `domain` (trap 1); the only read
 * that filters on `entity_type` is the one against `field_provenance`, whose
 * column it still is.
 */
export interface FactKey {
  entityType: string;
  entityId: string;
  field: string;
}

/**
 * The fact a review item names, or `null` when it names none.
 *
 * A per-source item (the stuck-record pattern) carries no fact at all, and an
 * `entity_link` fact item usually has a null `entity_id` — its record does not
 * exist yet, which is the whole reason it is stuck. Neither has a canonical
 * side to read, and neither is an error.
 */
export function factOf(item: ReviewItemRow): FactKey | null {
  if (item.domain === null || item.entity_id === null || item.field === null) {
    return null;
  }
  return { entityType: item.domain, entityId: item.entity_id, field: item.field };
}

/* ── the reads ───────────────────────────────────────────────────────────── */

/**
 * One review item by id.
 *
 * Addresses exactly one row by primary key with `.maybeSingle()`, so it is
 * neither a window nor a complete read (§4.3): there is no set to be silently
 * partial. `ok` carrying `null` means the table answered and holds no such
 * row — a different state from the table being absent, and the page renders
 * it as its own surface rather than as a routing outcome
 * (admin-window/BUG-0017).
 */
export async function readReviewItem(
  reviewItemId: string,
  db?: SupabaseClient,
): Promise<DbResult<ReviewItemRow | null>> {
  return readOne<ReviewItemRow>(
    T.reviewItems,
    (client) =>
      client
        .from(T.reviewItems)
        .select(REVIEW_ITEM_COLUMNS)
        .eq("review_item_id", reviewItemId)
        .maybeSingle() as unknown as PromiseLike<DbResponse<ReviewItemRow>>,
    db,
  );
}

/** The observations behind a set of ids — the evidence join's first leg (§4.2). */
function readObservations(
  ids: readonly string[],
  db?: SupabaseClient,
): Promise<DbResult<ObservationRow[]>> {
  return readRowsByIds<ObservationRow>(
    T.observations,
    ids,
    (client, chunkIds) =>
      client
        .from(T.observations)
        .select(OBSERVATION_COLUMNS)
        .in("observation_id", chunkIds)
        // At most one row per id — `observation_id` is the table's key — so
        // the leg can never ask for more rows than the ids it filtered on.
        .limit(chunkIds.length) as unknown as PromiseLike<
        DbResponse<ObservationRow[]>
      >,
    db,
  );
}

/** The sources behind a set of ids: the name and the tier they carry NOW. */
function readSources(
  ids: readonly string[],
  db?: SupabaseClient,
): Promise<DbResult<SourceRow[]>> {
  return readRowsByIds<SourceRow>(
    T.sources,
    ids,
    (client, chunkIds) =>
      client
        .from(T.sources)
        .select(SOURCE_COLUMNS)
        .in("source_id", chunkIds)
        .limit(chunkIds.length) as unknown as PromiseLike<DbResponse<SourceRow[]>>,
    db,
  );
}

/**
 * Every decision ever applied to one fact — a COMPLETE read (§4.3).
 *
 * Complete rather than windowed because the surface presents ONE row of it as
 * "the current provenance", and "the latest" is only knowable over the whole
 * log: a truncated read would name some other decision the current one, which
 * is the exact failure `readComplete` exists to refuse. The order is total —
 * `applied_at desc` then the primary key — so both the reduction and any
 * refusal are reproducible.
 */
function readFactProvenance(
  fact: FactKey,
  db?: SupabaseClient,
): Promise<DbResult<ProvenanceRow[]>> {
  return readComplete<ProvenanceRow>(
    T.fieldProvenance,
    (client, cap) =>
      client
        .from(T.fieldProvenance)
        .select(PROVENANCE_COLUMNS, { count: "exact" })
        .eq("entity_type", fact.entityType)
        .eq("entity_id", fact.entityId)
        .eq("field", fact.field)
        .order("applied_at", { ascending: false })
        .order("provenance_id", { ascending: false })
        .range(0, cap - 1) as unknown as PromiseLike<
        DbCountedResponse<ProvenanceRow[]>
      >,
    db,
  );
}

/* ── the resolved evidence ───────────────────────────────────────────────── */

/**
 * One evidence id, resolved: the claim, who made it, and that source's tier
 * TODAY (trap 5).
 *
 * `source` falls back to the source id verbatim when the `sources` row did not
 * come back — the claim is real whether or not its registry row was read, and
 * a blank there would understate the evidence. `tier` stays `null` in that
 * case rather than borrowing a tier from anywhere.
 */
export interface ResolvedClaim {
  observation: ObservationRow;
  /** `sources.source`, or the id verbatim when the registry row is missing. */
  source: string;
  /** `sources.tier` — the source's CURRENT tier. Null when unknown. */
  tier: string | null;
}

/**
 * The decision that put the current value in canonical, resolved.
 *
 * `observation` is the row the decision NAMED, live or not, because "the
 * applied claim is no longer live" is a fact the operator needs; `live` is
 * what decides whether there is a current canonical VALUE at all (trap 7).
 */
export interface CanonicalDecision {
  decision: ProvenanceRow;
  /** The winning source's name, or its id verbatim; null on an unset. */
  source: string | null;
  /** The observation the decision named; null on an unset or when it is gone. */
  observation: ObservationRow | null;
  /** The named observation is still live — only then is its value canonical. */
  live: boolean;
}

/**
 * The canonical side of the anatomy, in the four states it actually has.
 *
 * Each is a different sentence on screen, and none of them is an error:
 *  - `no_fact` — the item's subject is a SOURCE (the stuck-record pattern), so
 *    there is no fact to hold a canonical value;
 *  - `no_row` — the item names a fact whose record does not exist yet
 *    (`entity_id` null), which is what an `entity_link` fact item IS;
 *  - `no_decision` — the record exists and the log holds no decision for this
 *    field: nothing has ever been applied to it;
 *  - `decided` — the latest decision, and the value it applied.
 */
export type CanonicalSide =
  | { kind: "no_fact" }
  | { kind: "no_row" }
  | { kind: "no_decision" }
  | { kind: "decided"; decided: CanonicalDecision };

/**
 * What `review_items.evidence` carried, and what it deduplicated to.
 *
 * `stored` is the array's own length; `distinct` is the number of ids this
 * read actually looked up. **`claims.length + unresolved.length === distinct`,
 * always** — the two figures a surface divides come from this one accounting,
 * which is what stops a deduplicated numerator being reported over a raw
 * denominator (admin-window/BUG-0021: `[A, A, B]` with both ids resolving
 * rendered "2 of 3 resolved" while naming no unresolved id).
 *
 * The two differ whenever the same id sits in `evidence` twice, which needs no
 * malformed row: the column is `uuid[]` with no uniqueness
 * (`20260901000002`) and `contracts/resolver.md` §11 folds by APPENDING to it.
 * `stored` is kept rather than dropped so a surface can say so out loud
 * instead of quietly showing a smaller number than the row holds.
 */
export interface EvidenceIdCount {
  stored: number;
  distinct: number;
}

/** The whole evidence half of the anatomy, resolved and ready to render. */
export interface ItemEvidence {
  /** The `evidence` ids resolved to rows, in the item's stored FOLD ORDER. */
  claims: ResolvedClaim[];
  /**
   * The evidence ids that resolved to no observation row, in fold order. An
   * item may carry an id whose row was never written or has since been
   * deleted; the page names them rather than dropping them, because a silently
   * shorter list would read as an item with less evidence than it has.
   */
  unresolved: string[];
  /** The ids this read looked at: how many were stored, how many distinct. */
  ids: EvidenceIdCount;
  canonical: CanonicalSide;
  /**
   * The `sources` leg's refusal, when that one leg refused — `null` otherwise.
   *
   * It is carried BESIDE the claims rather than returned instead of them
   * because a missing registry row costs this surface a LABEL, never a value:
   * `source` falls back to the id verbatim and `tier` stays null, exactly as
   * they do when the row is simply absent. The claims themselves were read,
   * and dropping them would tell the operator the item has no evidence when it
   * has all of it (admin-window/BUG-0021; the page already reports the
   * `pending_claims` leg this way).
   *
   * The other legs are NOT treated this way and still refuse the whole read:
   * `observations` IS the evidence, and `field_provenance` decides the
   * canonical value — reporting either beside a rendered block would need the
   * canonical side to carry a "the log refused" state it does not have. That
   * is a design call, recorded as the open residual on admin-window/TASK-0011.
   */
  sourcesUnavailable: DbUnavailable | null;
}

/** The ids of a list, deduplicated, in first-seen order. */
function distinct(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

/**
 * The item's evidence and the canonical value it stands against — the whole of
 * spec §6's second anatomy point, in one result.
 *
 * Composed of up to four reads, and **a non-`ok` result is passed on
 * unchanged**, so the page's error line names the object that actually refused
 * (`observations`, `field_provenance`) rather than a wrapper of ours
 * (admin-window/BUG-0016). The one exception is the `sources` leg, whose
 * refusal is carried in `sourcesUnavailable` beside the claims it only labels;
 * see that field for why it alone degrades.
 *
 * `evidence` is `uuid[]` in fold order (trap 10) and the claims come back in
 * that order. Ids are deduplicated first: the same claim folded twice is one
 * claim, and rendering it twice would double-count the evidence — and `ids`
 * carries both counts, so a caller reports over the ids this read actually
 * looked at instead of dividing them by the raw array's length
 * (admin-window/BUG-0021).
 */
export async function readItemEvidence(
  item: ReviewItemRow,
  db?: SupabaseClient,
): Promise<DbResult<ItemEvidence>> {
  const evidenceIds = distinct(item.evidence);
  const observations = await readObservations(evidenceIds, db);
  if (observations.kind !== "ok") return observations;

  const byId = new Map(observations.data.map((row) => [row.observation_id, row]));
  const claims = evidenceIds.filter((id) => byId.has(id));
  const unresolved = evidenceIds.filter((id) => !byId.has(id));

  // The canonical side, when the item names a fact at all.
  const fact = factOf(item);
  let decision: ProvenanceRow | null = null;
  if (fact !== null) {
    const log = await readFactProvenance(fact, db);
    if (log.kind !== "ok") return log;
    // The app's one "which decision is later" rule, over the complete log.
    // One fact identity, so at most one row survives the reduction.
    decision = currentDecisions(log.data)[0] ?? null;
  }

  // The winning observation, if it is not already among the evidence.
  const winnerId = decision?.observation_id ?? null;
  if (winnerId !== null && !byId.has(winnerId)) {
    const winner = await readObservations([winnerId], db);
    if (winner.kind !== "ok") return winner;
    for (const row of winner.data) byId.set(row.observation_id, row);
  }

  // Every source named by anything on this page, in one read.
  const sourceIds = distinct([
    ...claims.map((id) => byId.get(id)?.source_id ?? ""),
    ...(decision?.source_id === undefined || decision.source_id === null
      ? []
      : [decision.source_id]),
  ]).filter((id) => id.length > 0);
  const sources = await readSources(sourceIds, db);
  const sourceById = new Map(
    (sources.kind === "ok" ? sources.data : []).map((row) => [row.source_id, row]),
  );

  return {
    kind: "ok",
    data: {
      ids: { stored: item.evidence.length, distinct: evidenceIds.length },
      sourcesUnavailable: sources.kind === "ok" ? null : sources,
      claims: claims.map((id) => {
        const observation = byId.get(id) as ObservationRow;
        const source = sourceById.get(observation.source_id);
        return {
          observation,
          source: source?.source ?? observation.source_id,
          tier: source?.tier ?? null,
        };
      }),
      unresolved,
      canonical: canonicalSideOf(item, fact, decision, byId, sourceById),
    },
  };
}

/** Which of the four canonical states this item is in, and its decision. */
function canonicalSideOf(
  item: ReviewItemRow,
  fact: FactKey | null,
  decision: ProvenanceRow | null,
  observations: ReadonlyMap<string, ObservationRow>,
  sources: ReadonlyMap<string, SourceRow>,
): CanonicalSide {
  if (fact === null) {
    // A per-source item names no fact column at all; a per-fact item whose
    // record does not exist yet names some of them and cannot point at a row.
    // The two read differently on screen, so they are different states here.
    const namesFact =
      item.domain !== null || item.entity_id !== null || item.field !== null;
    return namesFact ? { kind: "no_row" } : { kind: "no_fact" };
  }
  if (decision === null) return { kind: "no_decision" };

  const observation =
    decision.observation_id === null
      ? null
      : observations.get(decision.observation_id) ?? null;
  return {
    kind: "decided",
    decided: {
      decision,
      source:
        decision.source_id === null
          ? null
          : sources.get(decision.source_id)?.source ?? decision.source_id,
      observation,
      live: observation !== null && isLive(observation),
    },
  };
}
