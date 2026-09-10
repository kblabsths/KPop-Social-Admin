import {
  ID,
  observationRow,
  pendingClaimRow,
  sourceRow,
  type ObservationRow,
  type PendingClaimBucket,
  type PendingClaimRow,
  type SourceRow,
} from "../../fixtures/rows";
import type { RecordedCall, ScriptedResponse } from "../../fixtures/stub-client";

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
 *  - a registry that names two of its three sources and NOT the third, so a
 *    label test has one row it must name and one it must leave as the uuid
 *    (admin-window/BUG-0043);
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

/**
 * The registry rows behind those sources — **two of the three, on purpose**
 * (campaign admin-window/BUG-0043).
 *
 * `pending_claims` carries `source_id` and no name, so every claims surface
 * labels its sources from `sources`. A fixture that named all three would let
 * a page that never looked one up pass just as well as one that did, and a
 * fixture that named none would let the id-verbatim fallback pass vacuously.
 * `SOURCE.third` is deliberately unregistered: it is the id an operator must
 * still see, spelled out, wherever the other two read as words.
 *
 * Full rows, not just the two label columns: the standing-disagreements gauge
 * reads this same table for tier and lifecycle, and a fixture short of them
 * would render an `undefined` no database can produce.
 */
export const SOURCE_NAME: ReadonlyMap<string, string> = new Map([
  [SOURCE.first, "ticketmaster"],
  [SOURCE.second, "bandsintown"],
]);

/** The `sources` rows a healthy read returns for this population. */
export const REGISTRY: readonly SourceRow[] = [...SOURCE_NAME].map(([id, name]) =>
  sourceRow({
    source_id: id,
    source: name,
    tier: name === "ticketmaster" ? "official" : "standard",
  }),
);

/** What a source is CALLED on screen: its registry name, or its id verbatim. */
export function nameOf(sourceId: string): string {
  return SOURCE_NAME.get(sourceId) ?? sourceId;
}

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
    // The view carries the instant itself now (admin-window/BUG-0138). The one
    // claim whose spec states none carries `null` here as well as having no
    // `observations` row: it is the claim of unknown age, whichever side of
    // the handoff a reader comes at it from.
    observed_at: spec.observedAt ?? null,
  }),
);

/** The observations behind them — one short, on purpose. */
export const OBSERVATIONS: readonly ObservationRow[] = SPECS.filter(
  (spec) => spec.observedAt !== undefined,
).map((spec) =>
  observationRow({
    observation_id: spec.id,
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

/* ── the view, as a database would answer it ─────────────────────────────── */

/**
 * A `pending_claims` that answers the QUERY it was asked (campaign
 * admin-window/BUG-0138).
 *
 * The Claims page issues up to twelve reads of this one view in a single
 * `Promise.all` — one window, six `head: true` counts and five `limit 1`
 * seeks. A fixed scripted response answers all twelve with one answer, so
 * every count on the page would read the same number and a test asserting on
 * them would be asserting on the script; a queue would pin the suite to the
 * order the promises happen to be built in, which is not a property of the
 * product. So this reads the chain the query built — `.select()`, `.eq()`,
 * `.neq()`, `.in()`, `.order()`, `.limit()`, and the `{ head, count }` options
 * — and answers it the way PostgREST would.
 *
 * It is a FIXTURE DATABASE, not an expectation: it knows nothing about the
 * page, and every test still computes what it expects from `CLAIMS` with its
 * own predicates.
 *
 * Three behaviours are the database's and are reproduced deliberately:
 *
 *  - `{ head: true }` returns NO rows and a count of everything that matched,
 *    before any `.limit()` — which is what makes a count a count;
 *  - a `timestamptz` is compared by VALUE, so `…T00:00:00Z` and
 *    `…T00:00:00+00:00` are one instant and the tie-break decides between
 *    them, exactly as Postgres does;
 *  - `nullsFirst: false` puts a null instant last whatever the direction is.
 *
 * And one that is this fixture's own: the response carries ONLY the columns
 * the `.select()` named, so a page reading a column its query did not ask for
 * reads `undefined` here rather than passing on a fixture's generosity.
 */
export function claimView(
  claims: readonly PendingClaimRow[] = CLAIMS,
  /**
   * A builder step this database IGNORES — the shape of a server that did not
   * do what the query asked. `{ ignoring: "neq" }` is the one the claims suite
   * needs: a database whose bucket exclusion did nothing, which is what leaves
   * the CODE-side exclusion (§6 trap 4) the only thing standing between the
   * parked bucket and the markup.
   */
  options: { ignoring?: string } = {},
): (call: RecordedCall) => ScriptedResponse {
  return (call) => {
    const steps = (method: string) =>
      method === options.ignoring
        ? []
        : call.steps.filter((step) => step.method === method);
    const select = steps("select")[0];
    const columns = String(select?.args[0] ?? "*");
    const asked = (select?.args[1] ?? {}) as { head?: boolean; count?: string };

    let rows = claims as readonly unknown[] as readonly Record<string, unknown>[];
    for (const step of steps("eq")) {
      rows = rows.filter((row) => row[String(step.args[0])] === step.args[1]);
    }
    for (const step of steps("neq")) {
      rows = rows.filter((row) => row[String(step.args[0])] !== step.args[1]);
    }
    for (const step of steps("in")) {
      const wanted = step.args[1] as unknown[];
      rows = rows.filter((row) => wanted.includes(row[String(step.args[0])]));
    }

    const orders = steps("order").map((step) => ({
      column: String(step.args[0]),
      ...(step.args[1] as { ascending?: boolean; nullsFirst?: boolean }),
    }));
    rows = [...rows].sort((left, right) => {
      for (const order of orders) {
        const decided = compareValues(left[order.column], right[order.column], order);
        if (decided !== 0) return decided;
      }
      return 0;
    });

    const matched = rows.length;
    const count = asked.count === "exact" ? matched : null;
    if (asked.head === true) return { data: null, count };

    const limit = steps("limit")[0]?.args[0] as number | undefined;
    const drawn = limit === undefined ? rows : rows.slice(0, limit);
    return { data: drawn.map((row) => project(row, columns)), count };
  };
}

/** One `.order()` clause, applied to two values the way Postgres applies it. */
function compareValues(
  left: unknown,
  right: unknown,
  order: { ascending?: boolean; nullsFirst?: boolean },
): number {
  const ascending = order.ascending !== false;
  const leftNull = left === null || left === undefined;
  const rightNull = right === null || right === undefined;
  if (leftNull || rightNull) {
    if (leftNull && rightNull) return 0;
    // Postgres's own default is NULLS LAST ascending, NULLS FIRST descending;
    // an explicit `nullsFirst` overrides it in either direction.
    const nullsFirst = order.nullsFirst ?? !ascending;
    return (leftNull ? 1 : -1) * (nullsFirst ? -1 : 1);
  }
  const decided = compareScalar(left, right);
  return ascending ? decided : -decided;
}

/** Two column values, compared as the column's type is compared. */
function compareScalar(left: unknown, right: unknown): number {
  if (typeof left === "string" && typeof right === "string") {
    const leftAt = Date.parse(left);
    const rightAt = Date.parse(right);
    // A timestamp is compared by VALUE, not by spelling: two instants written
    // `Z` and `+00:00` are equal and the next `.order()` decides between them.
    if (!Number.isNaN(leftAt) && !Number.isNaN(rightAt) && /[TZ:+]/.test(left)) {
      return leftAt === rightAt ? 0 : leftAt < rightAt ? -1 : 1;
    }
    return left === right ? 0 : left < right ? -1 : 1;
  }
  if (typeof left === "number" && typeof right === "number") return left - right;
  return String(left) === String(right) ? 0 : String(left) < String(right) ? -1 : 1;
}

/** The row as the `.select()` list asked for it, and nothing else. */
function project(
  row: Record<string, unknown>,
  columns: string,
): Record<string, unknown> {
  if (columns.trim() === "*") return { ...row };
  const asked: Record<string, unknown> = {};
  for (const column of columns.split(",").map((name) => name.trim())) {
    asked[column] = row[column] ?? null;
  }
  return asked;
}
