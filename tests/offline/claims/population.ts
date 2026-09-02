import {
  ID,
  observationRow,
  pendingClaimRow,
  type ObservationRow,
  type PendingClaimBucket,
  type PendingClaimRow,
} from "../../fixtures/rows";

/**
 * The claim population the Claims suite reads (campaign
 * admin-window/TASK-0012).
 *
 * It is a FIXTURE, not an expectation: every test computes what it expects
 * from these rows with its own predicates, the way `tests/offline/queues/`
 * does. What it carries deliberately:
 *
 *  - **every bucket the view can spell, `in_window` included** — the one row
 *    that must never appear in any rendering, in any state, under any filter;
 *  - three sources and three domains, so a per-source and per-domain
 *    narrowing has something to be wrong about;
 *  - two `awaiting_row` claims, each naming a DIFFERENT unmet requirement
 *    (a missing NOT NULL column, and the events performer invariant);
 *  - a claim with no canonical row (`entity_id` null) and claims with one, so
 *    the provenance link exists in both directions;
 *  - a claim whose observation is ABSENT from `observations`, so its age is
 *    unknown rather than zero;
 *  - two claims made on the SAME instant, spelled `Z` and `+00:00`, so the
 *    order's tiebreak is exercised.
 *
 * Instants are fixed strings rather than offsets from now: an age fixture that
 * moved with the clock would make a failure unreproducible.
 */

/** A third source, beside the two `rows.ts` names. */
export const SOURCE_THIRD = "01920000-0000-7000-8000-000000000103";

export const SOURCE = {
  first: ID.sourceTicketmaster,
  second: ID.sourceBandsintown,
  third: SOURCE_THIRD,
} as const;

export const ENTITY = {
  event: ID.eventEntity,
  otherEvent: "01920000-0000-7000-8000-000000000203",
  venue: "01920000-0000-7000-8000-000000000204",
  group: ID.groupEntity,
} as const;

interface ClaimSpec {
  id: string;
  bucket: PendingClaimBucket;
  source: string;
  domain: string;
  field: string;
  entity: string | null;
  requirement?: string;
  /** Absent when this claim's observation is missing from `observations`. */
  observedAt?: string;
}

const SPECS: readonly ClaimSpec[] = [
  {
    id: "01920000-0000-7000-8000-000000000901",
    bucket: "standing_disagreement",
    source: SOURCE.first,
    domain: "events",
    field: "title",
    entity: ENTITY.event,
    observedAt: "2026-08-20T00:00:00Z",
  },
  {
    id: "01920000-0000-7000-8000-000000000902",
    bucket: "standing_disagreement",
    source: SOURCE.second,
    domain: "events",
    field: "title",
    entity: ENTITY.event,
    observedAt: "2026-08-21T00:00:00Z",
  },
  {
    id: "01920000-0000-7000-8000-000000000903",
    bucket: "awaiting_row",
    source: SOURCE.first,
    domain: "events",
    field: "performers",
    entity: null,
    requirement: "at least one linked performer",
    observedAt: "2026-08-19T00:00:00Z",
  },
  {
    id: "01920000-0000-7000-8000-000000000904",
    bucket: "awaiting_row",
    source: SOURCE.third,
    domain: "groups",
    field: "name",
    entity: null,
    requirement: "debut_date",
    observedAt: "2026-08-22T00:00:00Z",
  },
  {
    id: "01920000-0000-7000-8000-000000000905",
    bucket: "awaiting_link",
    source: SOURCE.second,
    domain: "events",
    field: "venue",
    entity: ENTITY.otherEvent,
    observedAt: "2026-08-23T00:00:00Z",
  },
  {
    id: "01920000-0000-7000-8000-000000000906",
    bucket: "escalated",
    source: SOURCE.first,
    domain: "venues",
    field: "name",
    entity: ENTITY.venue,
    // The oldest claim in the population — the top of an oldest-first list.
    observedAt: "2026-08-18T00:00:00Z",
  },
  {
    id: "01920000-0000-7000-8000-000000000907",
    bucket: "agreeing",
    source: SOURCE.second,
    domain: "events",
    field: "starts_at",
    entity: ENTITY.event,
    observedAt: "2026-08-24T00:00:00Z",
  },
  {
    // The row the UI may never show, under any filter, in any state.
    id: "01920000-0000-7000-8000-000000000908",
    bucket: "in_window",
    source: SOURCE.third,
    domain: "events",
    field: "title",
    entity: ENTITY.event,
    observedAt: "2026-08-25T00:00:00Z",
  },
  {
    // No observation row: its age is unknown, never zero, and it sorts last.
    id: "01920000-0000-7000-8000-000000000909",
    bucket: "standing_disagreement",
    source: SOURCE.third,
    domain: "groups",
    field: "name",
    entity: ENTITY.group,
  },
  {
    // The same instant as claim …902, spelled the other way.
    id: "01920000-0000-7000-8000-000000000910",
    bucket: "agreeing",
    source: SOURCE.first,
    domain: "events",
    field: "title",
    entity: ENTITY.event,
    observedAt: "2026-08-21T00:00:00+00:00",
  },
  {
    id: "01920000-0000-7000-8000-000000000911",
    bucket: "awaiting_link",
    source: SOURCE.first,
    domain: "venues",
    field: "address",
    entity: ENTITY.venue,
    observedAt: "2026-08-26T00:00:00Z",
  },
];

/** Every claim the view would hand over, `in_window` included. */
export const CLAIMS: readonly PendingClaimRow[] = SPECS.map((spec) =>
  pendingClaimRow(spec.bucket, {
    observation_id: spec.id,
    domain: spec.domain,
    entity_id: spec.entity,
    field: spec.field,
    source_id: spec.source,
    unmet_requirement: spec.requirement ?? null,
  }),
);

/** The observations behind them — one short, on purpose. */
export const OBSERVATIONS: readonly ObservationRow[] = SPECS.filter(
  (spec) => spec.observedAt !== undefined,
).map((spec) =>
  observationRow({
    observation_id: spec.id,
    entity_type: spec.domain,
    entity_id: spec.entity,
    domain: spec.domain,
    field: spec.field,
    source_id: spec.source,
    observed_at: spec.observedAt as string,
    status: "pending",
  }),
);

/** The instant a claim was made, as this fixture states it. */
export const OBSERVED_AT: ReadonlyMap<string, string> = new Map(
  SPECS.filter((spec) => spec.observedAt !== undefined).map((spec) => [
    spec.id,
    spec.observedAt as string,
  ]),
);

/** The claim carrying each bucket's name, for a test that needs one. */
export function claimsInBucket(bucket: string): PendingClaimRow[] {
  return CLAIMS.filter((claim) => claim.bucket === bucket);
}
