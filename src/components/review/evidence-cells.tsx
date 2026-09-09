import type { Column } from "@/components/ui";
import { IN_PAGE_LINK } from "@/components/cycles/links";
import { EM_DASH, isAbsent, orDash, relativeAge } from "@/lib/format";

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
  /**
   * WHICH record the claim is about: `observations.entity_id`, the canonical
   * row's id — the same value `/claims` draws in its own `record` column. Null
   * while the record does not exist yet, which is what puts a claim in
   * `awaiting_row`.
   */
  entityId: string | null;
  /**
   * The SOURCE's own name for that record — `observations.external_ref`, the
   * id it keys the record by on its side. It is the only identity a claim with
   * no canonical row has (the link stage resolves
   * `(source, domain, external_ref)` into an `entity_id` later), so it is what
   * the record column falls back to. Null when the source published none.
   */
  externalRef: string | null;
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
 * An evidence column, plus the row value it draws (campaign
 * admin-window/BUG-0132).
 *
 * `value` is the SAME accessor the cell reads, exposed so the block around the
 * table can ask whether a dash reaches the screen without a second spelling of
 * which columns can be absent — two spellings is how a rule and its rendering
 * drift apart. A column with no `value` carries nothing nullable (`source`,
 * `observed`, `status`, `fact`) and can never dash.
 */
export type EvidenceColumn = Column<EvidenceRow> & {
  value?: (row: EvidenceRow) => string | null;
};

/**
 * A column over a nullable value, decided ONCE for all four of them
 * (campaign admin-window/BUG-0132).
 *
 * Each of these cells carries a `data-` hook the suite addresses the row or
 * the cell by, so the body handed to `DataTable` is always an ELEMENT — and an
 * element is never absent to `isAbsent` (`src/lib/format.ts` has no branch for
 * one, by design: an element with a hook in it is not nothing). The table's own
 * `orDash` therefore never fired and the cell rendered EMPTY, while the same
 * absent tier drew the app's dash in the evidence pair one block above.
 *
 * So the hook and the value are split: the hook stays on the span, and the
 * VALUE goes through `orDash` inside it. The cell still does not decide what an
 * absence looks like (`Column.cell`'s contract) — `lib/format.ts` does, in its
 * one spelling: an em dash in disabled ink, labelled `no value`.
 *
 * `addresses` is what the hook attribute carries, which is only sometimes the
 * value: the value column's hook is the row's `observation_id`, because that is
 * how the whole suite addresses an evidence ROW (`[data-evidence="<id>"]`).
 * It defaults to the value itself, empty string when there is none — the
 * spelling those hooks already had, kept so every selector that reads them
 * still matches.
 */
function nullableColumn({
  key,
  label,
  hook,
  value,
  addresses,
}: {
  key: string;
  label: string;
  hook: string;
  value: (row: EvidenceRow) => string | null;
  addresses?: (row: EvidenceRow) => string;
}): EvidenceColumn {
  const hookValue = addresses ?? ((row: EvidenceRow) => value(row) ?? "");
  return {
    key,
    label,
    value,
    cell: (row) => <span {...{ [hook]: hookValue(row) }}>{orDash(value(row))}</span>,
  };
}

/**
 * What a dash means in the claims table, said once above it (LESSONS 1: "a
 * column of dashes carries one line saying what a dash means"; campaign
 * admin-window/BUG-0132).
 *
 * One sentence for all five nullable columns, because one sentence is true of
 * all of them: a producer publishes no value and no payload pointer, a source
 * carries no tier or its registry row could not be read, the bucket view names
 * nothing holding the claim, a folded record has no id on either side. The
 * table cannot tell those apart and does not pretend to — the dash says the
 * app holds nothing there, and the block's own state lines say why a read did
 * not answer.
 */
export const DASH_MEANS =
  `A ${EM_DASH} is a value this row does not carry: the claim states none, or ` +
  "the read that would name it did not answer.";

/**
 * Does this table put the app's dash on screen at all?
 *
 * Asked over the columns the SHAPE actually renders and the rows it actually
 * has, through each column's own `value` accessor — so a shape that draws no
 * nullable column, or a table whose every cell is filled, is not handed a
 * sentence explaining a character its operator cannot see (the condition
 * `close/slot.tsx` already carries, campaign admin-window/BUG-0092).
 */
export function drawsDash(
  rows: readonly EvidenceRow[],
  columns: readonly EvidenceColumn[],
): boolean {
  return columns.some((column) => {
    const value = column.value;
    return value !== undefined && rows.some((row) => isAbsent(value(row)));
  });
}

/**
 * The value, carrying the row's hook.
 *
 * Every view draws this column, so `[data-evidence="<id>"]` finds the row one
 * claim renders in, whichever shape rendered it and wherever in that shape's
 * column order the value sits.
 */
export const valueColumn: EvidenceColumn = nullableColumn({
  key: "value",
  label: "value",
  hook: "data-evidence",
  // The hook is the row's key, never the value: `[data-evidence="<id>"]` has to
  // find the row of a claim that says nothing as surely as one that does.
  addresses: (row) => row.observationId,
  value: (row) => row.value,
});

/**
 * The source, in one click (LOOK_AND_FEEL bar 10).
 *
 * In the app's one link spelling (`IN_PAGE_LINK`), so the column reads as the
 * way through with nothing hovering it: an evidence table runs to dozens of
 * rows of mono values, and a route out that only the pointer reveals is one
 * the reader scanning the column never finds (admin-window/BUG-0099).
 */
export const sourceColumn: Column<EvidenceRow> = {
  key: "source",
  label: "source",
  cell: (row) => (
    <a href={row.sourceHref} data-claim-source={row.source} className={IN_PAGE_LINK}>
      {row.source}
    </a>
  ),
};

/** The source's CURRENT tier — the header states which tier this is, once. */
export const tierColumn: EvidenceColumn = nullableColumn({
  key: "tier",
  label: "tier now",
  hook: "data-tier-now",
  value: (row) => row.tier,
});

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
export const payloadColumn: EvidenceColumn = nullableColumn({
  key: "payload",
  label: "payload",
  hook: "data-payload",
  value: (row) => row.payloadRef,
});

/** What is holding this claim, and what it is waiting for. */
export const heldColumn: EvidenceColumn = nullableColumn({
  key: "held",
  label: "held by",
  hook: "data-held",
  value: (row) => row.held,
});

/**
 * WHICH record this row is about (campaign admin-window/BUG-0122).
 *
 * A source-pattern item folds records that agree on everything but the record
 * — one source, many records stuck the same way — so this is the only cell that
 * can tell two of its rows apart, and the table read as 91 identical dead ends
 * without it (user-sims Priya and Devin, 2026-09-09). Three states, in the
 * order of what the app actually holds:
 *
 *  - a canonical row exists: its id, drawn as the link to `/records/<domain>/…`
 *    in the app's one link spelling — the same value, destination and rendering
 *    `/claims` gives its own `record` column (`components/claims/claim-list.tsx`);
 *  - no canonical row yet: the SOURCE's reference for that record, verbatim in
 *    the table's mono `data` cell and NOT a link. This app links nothing whose
 *    address it does not hold, and a record with no row has no address;
 *  - neither: `null`, so `DataTable`'s own `orDash` draws the app's one dash.
 *    An absence is rendered, never blanked and never filled with a borrowed id.
 */
export const recordColumn: EvidenceColumn = {
  key: "record",
  label: "record",
  // The value the cell draws, in the same three states its body does — so the
  // dash-meaning line counts this column too (admin-window/BUG-0132).
  value: (row) =>
    row.entityId !== null && row.recordHref !== null ? row.entityId : row.externalRef,
  cell: (row) => {
    if (row.entityId !== null && row.recordHref !== null) {
      return (
        <a href={row.recordHref} data-record={row.entityId} className={IN_PAGE_LINK}>
          {row.entityId}
        </a>
      );
    }
    if (row.externalRef === null) return null;
    return <span data-record={row.externalRef}>{row.externalRef}</span>;
  },
};

/**
 * The fact the row states about that record, as `domain.field`.
 *
 * Named `fact` because that is what `/claims` calls this exact value, and an
 * anatomy does not change its glossary between screens (LOOK_AND_FEEL's
 * consistency rule). It was labelled `record` until admin-window/BUG-0122,
 * which made the word name two different things on two screens — and left the
 * review item with no column for the record at all.
 *
 * It goes nowhere: `recordColumn` beside it is the row's one route to the
 * record, so the row has one destination under one label (admin-window/BUG-0043)
 * rather than two links to the same page saying different things.
 */
export const factColumn: Column<EvidenceRow> = {
  key: "fact",
  label: "fact",
  cell: (row) => <span data-fact={row.fact}>{row.fact}</span>,
};
