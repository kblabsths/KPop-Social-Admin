import type { ReactNode } from "react";
import { Badge, type Column, DataTable } from "@/components/ui";
import { relativeAge } from "@/lib/format";

/**
 * The claims themselves — campaign admin-window/TASK-0012.
 *
 * A row reads as one sentence: what is held, about which fact, from which
 * source, how long it has waited, and — where the bucket has one — what it is
 * waiting for. **An `awaiting_row` claim always names its
 * `unmet_requirement`** (the view's own words: a missing NOT NULL column by
 * its own name, `at least one linked performer`, or `curated domain`); a bare
 * bucket name there is the defect that column exists to prevent (migration
 * `20260901000004`).
 *
 * **Every claim leads somewhere twice** (LOOK_AND_FEEL bar 10): to its SOURCE,
 * and to the record where its fact's provenance is shown — each one click,
 * each a real URL, both built by `src/lib/claims/filters.ts`. A claim whose
 * record does not exist yet has no provenance link and says why in the same
 * row, which is the honest half of that bar.
 *
 * It re-derives nothing: rows arrive already narrowed by the app's one
 * predicate and already in `claimOrder` (`src/lib/db/claims.ts`), and this
 * component neither filters, sorts nor pages them. Machine identifiers render
 * verbatim, in the table's mono `data` cells.
 *
 * A pure component: plain props, no fetching (ARCHITECTURE.md §4 rule 1).
 * Nothing here settles anything — every control in this markup is a link.
 */
export interface ClaimLine {
  /** `pending_claims.observation_id` — the claim, and the row's key. */
  observationId: string;
  bucket: string;
  domain: string;
  field: string;
  /** The canonical row this claim is about; null while it has none. */
  entityId: string | null;
  sourceId: string;
  /** When the claim was made — `observations.observed_at`; null if unknown. */
  observedAt: string | null;
  /** What an `awaiting_row` claim still needs, named. Null in other buckets. */
  unmetRequirement: string | null;
  /** The source's page, narrowed to it. */
  sourceHref: string;
  /** Where the fact's provenance is shown, or null when there is no row yet. */
  provenanceHref: string | null;
}

/**
 * The list's BOUND — campaign admin-window/BUG-0041.
 *
 * The claims read is complete on purpose (`src/lib/db/claims.ts`: the bucket
 * counts must equal the view's), but rendering every row it holds made the
 * page a function of the backlog: 877 claims on staging rendered a 30,079px
 * page with the pending-claims gauge's heading at y=29,486, so the gauge's
 * position moved by tens of thousands of pixels as the resolver drained the
 * queue — the operator relearnt where it sat every morning (LOOK_AND_FEEL,
 * Interaction, "Repeat use").
 *
 * So the LIST is a window, in the app's existing idiom (`/cycles`, `/browse`,
 * the four gauges): at most this many rows, the longest-waiting ones, with the
 * cap and the number held stated on screen. **It bounds only what is drawn** —
 * nothing above it re-derives a count from these rows, and the bucket table
 * still counts the whole view under the current filters, so no figure on the
 * page becomes a window aggregate wearing a total's clothes.
 *
 * 50, the same bound `/browse` puts on a list of records: at the ~33px per row
 * this table measures, a full window is ~1,650px of list, so every section
 * heading keeps a position the backlog cannot move by thousands of pixels.
 */
export const CLAIM_WINDOW = 50;

/** A bounded list: the rows drawn, how many were held, whether it filled. */
export interface ClaimWindow {
  /** The rows to draw — at most `limit`, in the order they arrived in. */
  rows: ClaimLine[];
  /** How many rows the caller had — the honest figure the sentence states. */
  held: number;
  /** Did the window fill its cap, leaving rows undrawn? */
  truncated: boolean;
}

/**
 * The first `limit` rows, and the truth about the rest. Pure: it re-orders
 * nothing, so the window is the HEAD of whatever order it was handed —
 * `claimOrder`'s oldest-first, which makes it the longest-waiting claims.
 */
export function claimWindow(
  rows: readonly ClaimLine[],
  limit: number = CLAIM_WINDOW,
): ClaimWindow {
  return {
    rows: rows.slice(0, limit),
    held: rows.length,
    truncated: rows.length > limit,
  };
}

export function ClaimList({
  rows,
  label,
  card,
  line,
}: {
  rows: readonly ClaimLine[];
  /** Accessible name for the table. */
  label: string;
  /** A CARD state — `Empty` or `NotProvisioned` — replacing the whole table. */
  card?: ReactNode;
  /** A LINE state — `ErrorLine` — inside the table, so the header stays put. */
  line?: ReactNode;
}) {
  const columns: Column<ClaimLine>[] = [
    {
      key: "bucket",
      label: "bucket",
      cell: (row) => (
        <span data-claim-bucket={row.bucket}>
          <Badge>{row.bucket}</Badge>
        </span>
      ),
    },
    {
      key: "fact",
      label: "fact",
      cell: (row) => (
        <span
          data-claim={row.observationId}
          data-claim-domain={row.domain}
        >{`${row.domain}.${row.field}`}</span>
      ),
    },
    {
      key: "record",
      label: "record",
      cell: (row) =>
        row.provenanceHref === null ? (
          // No canonical row yet — and no invented link to one. The `waiting
          // for` cell on this same row says what it is stuck on.
          null
        ) : (
          <a
            href={row.provenanceHref}
            data-claim-provenance={row.observationId}
            className="transition-colors hover:text-accent"
          >
            {row.entityId}
          </a>
        ),
    },
    {
      key: "source",
      label: "source",
      cell: (row) => (
        <a
          href={row.sourceHref}
          data-claim-source={row.sourceId}
          className="transition-colors hover:text-accent"
        >
          {row.sourceId}
        </a>
      ),
    },
    {
      key: "waiting",
      label: "waiting",
      align: "right",
      cell: (row) => {
        // Relative, with the absolute instant in the title (Voice bar 6). An
        // unknown instant is the table's dash — never a zero age.
        if (row.observedAt === null) return null;
        const age = relativeAge(row.observedAt);
        return <span title={age.title}>{age.text}</span>;
      },
    },
    {
      key: "requirement",
      label: "waiting for",
      // `null` goes to the cell as `null` so the table's own `orDash` draws
      // the absence — one dash, defined once (`lib/format.ts`). Only
      // `awaiting_row` carries a requirement, and it always does.
      cell: (row) =>
        row.unmetRequirement === null ? null : (
          <span data-claim-requirement={row.unmetRequirement}>
            {row.unmetRequirement}
          </span>
        ),
    },
  ];

  if (card !== undefined) return <>{card}</>;

  return (
    <DataTable<ClaimLine>
      columns={columns}
      rows={line === undefined ? [...rows] : []}
      rowKey={(row) => row.observationId}
      label={label}
      placeholder={line}
    />
  );
}
