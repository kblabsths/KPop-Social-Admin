import type { Column } from "@/components/ui";
import { relativeAge } from "@/lib/format";

/**
 * The shared evidence anatomy, one column at a time (campaign
 * admin-window/TASK-0011).
 *
 * Spec §6 gives every review item ONE evidence anatomy — "the `evidence`
 * observation ids resolved to rows: value, source, tier, `observed_at`,
 * payload link" — and then says each shape renders its own view over it. That
 * is exactly this file plus `shape-views.tsx`: the cells are shared so a value
 * or an age cannot read differently between two shapes, and each shape picks
 * the columns its evidence actually HAS, rather than one layout being
 * parameterised into three.
 *
 * **The tier here is the source's tier NOW** and its header says so
 * (ARCHITECTURE.md §6 trap 5: "a claim has no tier of its own — the evidence
 * row's tier is `sources.tier`, the source's *current* tier; the canonical
 * card's tier is `field_provenance.tier_at_apply`, frozen at the apply. Label
 * each as what it is"). The canonical side does its own labelling, in its
 * provenance line.
 *
 * Pure and synchronous, plain props (ARCHITECTURE.md §5). Every control is a
 * link.
 */

/** One resolved evidence claim, as a detail view renders it. */
export interface EvidenceRow {
  /** `observations.observation_id` — the row's key and its hook. */
  observationId: string;
  /**
   * The claim's value as text. `observations.value` is jsonb (§6 trap 8), so a
   * non-scalar arrives here as its JSON text; `null` is a real absence and
   * renders as the app's dash.
   */
  value: string | null;
  /** `sources.source`, or the source id verbatim when the registry row is absent. */
  source: string;
  /** That source's own page. */
  sourceHref: string;
  /** `sources.tier` — the tier the source carries NOW. Null when unknown. */
  tier: string | null;
  /** `observations.observed_at`. */
  observedAt: string;
  /** `observations.status`, verbatim — `pending`, `applied`, `superseded`… */
  status: string;
  /**
   * `observations.payload_ref` — the pointer to the raw payload in object
   * storage, verbatim. It is NOT an href: the object-storage base URL is not a
   * name this app holds (`.env.example`), and inventing one would be a link
   * that goes nowhere. Named as a gap rather than guessed, the way the
   * per-source threshold seam is (`src/lib/gauges/pending-claims.ts`).
   */
  payloadRef: string | null;
  /** The fact this claim is about, as `domain.field`. */
  fact: string;
  /** The record surface for this claim's own entity; null while it has no row. */
  recordHref: string | null;
  /**
   * What holds this claim: its `pending_claims` bucket, and — on
   * `awaiting_row` — the unmet requirement the view names (a missing NOT NULL
   * column, "at least one linked performer", or a curated domain). Null when
   * the claim is in no bucket the classification view carries.
   */
  held: string | null;
}

/**
 * The value, carrying the row's hook.
 *
 * Every view puts this column first, so `[data-evidence="<id>"]` finds the row
 * one claim renders in, whichever shape rendered it.
 */
export const valueColumn: Column<EvidenceRow> = {
  key: "value",
  label: "value",
  cell: (row) => <span data-evidence={row.observationId}>{row.value}</span>,
};

/** The source, in one click (LOOK_AND_FEEL bar 10). */
export const sourceColumn: Column<EvidenceRow> = {
  key: "source",
  label: "source",
  cell: (row) => (
    <a
      href={row.sourceHref}
      data-claim-source={row.source}
      className="transition-colors hover:text-accent"
    >
      {row.source}
    </a>
  ),
};

/** The source's CURRENT tier — the header states which tier this is, once. */
export const tierColumn: Column<EvidenceRow> = {
  key: "tier",
  label: "tier now",
  cell: (row) => <span data-tier-now={row.tier ?? ""}>{row.tier}</span>,
};

/** When the claim was made: relative, with the absolute in the title (Voice bar 6). */
export const observedColumn: Column<EvidenceRow> = {
  key: "observed",
  label: "observed",
  cell: (row) => {
    const age = relativeAge(row.observedAt);
    return (
      <span data-observed={row.observedAt} title={age.title}>
        {age.text}
      </span>
    );
  },
};

/** The claim's lifecycle status, the machine's own word. */
export const statusColumn: Column<EvidenceRow> = {
  key: "status",
  label: "status",
  cell: (row) => <span data-claim-status={row.status}>{row.status}</span>,
};

/** The raw payload's pointer, verbatim. See `EvidenceRow.payloadRef`. */
export const payloadColumn: Column<EvidenceRow> = {
  key: "payload",
  label: "payload",
  cell: (row) => <span data-payload={row.payloadRef ?? ""}>{row.payloadRef}</span>,
};

/** What is holding this claim, and what it is waiting for. */
export const heldColumn: Column<EvidenceRow> = {
  key: "held",
  label: "held by",
  cell: (row) => <span data-held={row.held ?? ""}>{row.held}</span>,
};

/** The fact a folded record is about, linking to the record where it has one. */
export const factColumn: Column<EvidenceRow> = {
  key: "fact",
  label: "record",
  cell: (row) =>
    row.recordHref === null ? (
      <span data-fact={row.fact}>{row.fact}</span>
    ) : (
      <a
        href={row.recordHref}
        data-fact={row.fact}
        className="transition-colors hover:text-accent"
      >
        {row.fact}
      </a>
    ),
};
