import type { ReactNode } from "react";
import { IN_PAGE_LINK } from "@/components/cycles/links";
import { type Column, DataTable } from "@/components/ui";
import { count, relativeAge } from "@/lib/format";

/**
 * The classification view rendered — **buckets with counts and age**
 * (campaign admin-window/TASK-0012; spec §4, LOOK_AND_FEEL quality bar 1:
 * "Claims shows every bucket with its count").
 *
 * One row per bucket the page may render, always, in the view's own
 * precedence order — so a bucket holding nothing shows a REAL zero rather than
 * disappearing. That zero is a fact of a view that exists: the three states it
 * is not are the missing table, the failed read and the empty page, and none
 * of them renders through this table (ARCHITECTURE §7; LOOK_AND_FEEL,
 * Emptiness).
 *
 * The one bucket that never gets a row here is the parked one, and it is not
 * this component's business: it never reaches the UI at all, because
 * `src/lib/db/claims.ts` excludes it from the read and from the predicate
 * (ARCHITECTURE.md §6 trap 4). There is no branch below that could re-admit
 * it.
 *
 * A pure component: plain props, no fetching (ARCHITECTURE.md §4 rule 1).
 */
export interface BucketStat {
  /** The bucket, spelled as the view spells it — a machine identifier. */
  bucket: string;
  /** Claims in this bucket under the current source/domain narrowing. */
  claims: number;
  /** The oldest claim's instant here, or null when nothing is measurable. */
  oldestObservedAt: string | null;
  /** Distinct sources holding a claim in this bucket. */
  sources: number;
  /** Where the bucket's own name links: this page, narrowed to it. */
  href: string;
  /** Is the page currently narrowed to this bucket? */
  active: boolean;
}

export function BucketTable({
  rows,
  label,
  card,
  line,
}: {
  rows: readonly BucketStat[];
  /** Accessible name for the table. */
  label: string;
  /** A CARD state — `Empty` or `NotProvisioned` — replacing the whole table. */
  card?: ReactNode;
  /** A LINE state — `ErrorLine` — inside the table, so the header stays put. */
  line?: ReactNode;
}) {
  const columns: Column<BucketStat>[] = [
    {
      key: "bucket",
      label: "bucket",
      // A bare link, carrying the words itself. It wore a <Badge> until
      // admin-window/BUG-0113: the chip re-inked the bucket name `text-ink` on
      // a fill of its own, which took CSS priority over the anchor's inherited
      // accent and painted over the anchor's underline, so the anchor MEASURED
      // as a link while rendering byte-identically to plain text. A badge
      // never sits inside a link, and a link never wears one (LOOK_AND_FEEL,
      // "Chips and badges"): badge classifies, link navigates, and this one
      // navigates. No type class is added here — the DataTable cell already
      // draws its body `type-data` (src/components/ui/data-table.tsx), so the
      // bucket stays mono as the machine identifier it is (spec §11).
      cell: (row) => (
        <a
          href={row.href}
          data-bucket={row.bucket}
          aria-current={row.active ? "true" : undefined}
          className={IN_PAGE_LINK}
        >
          {row.bucket}
        </a>
      ),
    },
    {
      key: "claims",
      label: "claims",
      align: "right",
      // A real zero, not an absence: the bucket exists and holds nothing.
      cell: (row) => <span data-bucket-claims={row.claims}>{count(row.claims)}</span>,
    },
    {
      key: "oldest",
      label: "oldest",
      align: "right",
      cell: (row) => {
        // Relative, with the absolute instant in the title (Voice bar 6). A
        // bucket with no claims has no age, and the table's own dash says so.
        if (row.oldestObservedAt === null) return null;
        const age = relativeAge(row.oldestObservedAt);
        return <span title={age.title}>{age.text}</span>;
      },
    },
    {
      key: "sources",
      label: "sources",
      align: "right",
      cell: (row) => <span data-bucket-sources={row.sources}>{count(row.sources)}</span>,
    },
  ];

  if (card !== undefined) return <>{card}</>;

  return (
    <DataTable<BucketStat>
      columns={columns}
      rows={line === undefined ? [...rows] : []}
      rowKey={(row) => row.bucket}
      label={label}
      placeholder={line}
    />
  );
}
