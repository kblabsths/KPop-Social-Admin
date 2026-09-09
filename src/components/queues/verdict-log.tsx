import type { ReactNode } from "react";
import { type Column, DataTable } from "@/components/ui";
import { EM_DASH, clamped, relativeAge } from "@/lib/format";

/**
 * The verdict log — campaign admin-window/TASK-0058, spec F13.
 *
 * One row per `verdicts` row, newest first, carrying all seven of the columns
 * `contracts/admin-observability.md` §7 gives the table: who decided, which
 * action, the item it settled, the observation it wrote, the note, and when.
 * It is the one record of every admin data action (spec §7), so nothing here
 * summarises, aggregates or scores: every value in a cell is a column of the
 * row it sits in.
 *
 * **No dial, no gauge, no threshold.** This is a log; the gauge components and
 * their string set appear nowhere in it (M2 out-of-scope).
 *
 * **Both nulls are structural, not missing data** (LESSONS 1,
 * admin-window/BUG-0053). `review_item_id` is null on an `override` — the
 * item-less verdict from the record surface — and `observation_id` is null on
 * a settle-only verdict, which observed nothing. Each renders the app's one
 * dash, with no qualifier, and the surface says ONCE what a dash means here.
 *
 * A pure component: plain props, no fetching (ARCHITECTURE.md §4 rule 1).
 * Every control in this markup is a link; nothing settles anything from here.
 */

/** One verdict, as the log renders it — the page shapes, this renders (§5). */
export interface VerdictLine {
  /** `verdicts.verdict_id` — the row's key. */
  verdictId: string;
  /** `verdicts.actor`, verbatim: who decided. */
  actor: string;
  /**
   * `verdicts.action`, verbatim — one of `VERDICT_ACTIONS`. A machine
   * identifier, rendered in the table's own mono cell and never prettified,
   * never uppercased (ARCHITECTURE.md §11, LESSONS 5).
   */
  action: string;
  /** `verdicts.review_item_id`. Null on an override, and only there. */
  reviewItemId: string | null;
  /** Where that item opens. Null exactly when there is no item. */
  itemHref: string | null;
  /** `verdicts.observation_id`. Null on a settle-only verdict. */
  observationId: string | null;
  /**
   * The record surface of the fact that observation is about, when this app
   * could resolve it — the one place a rendered observation already leads
   * (`components/claims/claim-list.tsx`). Null when the observation carries no
   * canonical row yet, or when the resolving read did not answer: the id is
   * then rendered verbatim rather than linked to a URL that does not exist.
   */
  observationHref: string | null;
  /** `verdicts.note` — the admin's why, at their discretion. */
  note: string | null;
  /** `verdicts.created_at`. */
  createdAt: string;
}

/**
 * What a dash means on THIS surface, said once, above the table
 * (LESSONS 1: "a column of dashes carries one line saying what a dash means").
 *
 * Both dashes are the log doing its job: they are how a settlement is told
 * from an override, and a value-carrying verdict from a settle-only one. Said
 * as prose rather than as a per-cell qualifier, because a qualifier in the
 * cell would read as an explanation of missing data.
 */
const DASH_MEANS =
  `A ${EM_DASH} here is not missing data: an override settles no review item, ` +
  "and a settle-only verdict writes no observation.";

export function VerdictLog({
  lines,
  label,
  card,
  line,
}: {
  /** The verdicts, already in the surface's order — this component re-sorts nothing. */
  lines: readonly VerdictLine[];
  /** Accessible name for the table. */
  label: string;
  /**
   * A CARD state — `Empty` or `NotProvisioned` — replacing the whole table,
   * because those two draw their own border and a card inside the table's
   * border would draw two.
   */
  card?: ReactNode;
  /** A LINE state — `ErrorLine` — inside the table, so the header stays put. */
  line?: ReactNode;
}): ReactNode {
  const columns: Column<VerdictLine>[] = [
    {
      key: "actor",
      label: "actor",
      cell: (row) => <span data-verdict-actor={row.actor}>{row.actor}</span>,
    },
    {
      key: "action",
      label: "action",
      // Verbatim, in the table's own mono cell (§11). No badge, no title case,
      // no mapping to friendlier words: `data_conflict` uppercased is the
      // defect admin-window/BUG-0049 was filed for.
      cell: (row) => <span data-verdict-action={row.action}>{row.action}</span>,
    },
    {
      key: "item",
      label: "item settled",
      // `null` goes to the cell as `null`, so the table's own `orDash` draws
      // the one dash this app has (`lib/format.ts`). An id with no href is
      // impossible here — the href is derived from the id — so the two branches
      // are the two states of the column and not three.
      cell: (row) =>
        row.reviewItemId === null || row.itemHref === null ? null : (
          <a
            href={row.itemHref}
            data-verdict-item={row.reviewItemId}
            className="transition-colors hover:text-accent"
          >
            {row.reviewItemId}
          </a>
        ),
    },
    {
      key: "observation",
      label: "observation",
      cell: (row) => {
        if (row.observationId === null) return null;
        // The id is real whether or not this app can resolve where it leads,
        // so an unresolved one is rendered verbatim rather than dashed: a dash
        // there would claim the verdict observed nothing.
        return row.observationHref === null ? (
          <span data-verdict-observation={row.observationId}>{row.observationId}</span>
        ) : (
          <a
            href={row.observationHref}
            data-verdict-observation={row.observationId}
            className="transition-colors hover:text-accent"
          >
            {row.observationId}
          </a>
        );
      },
    },
    {
      key: "note",
      label: "note",
      // Producer text, bounded and visibly clamped, with the whole of it on
      // the element's own title (`clamped`, `lib/format.ts`). A null note goes
      // to the cell as null so the table draws the dash.
      cell: (row) => {
        if (row.note === null) return null;
        const shown = clamped(row.note);
        return <span title={shown.title}>{shown.text}</span>;
      },
    },
    {
      key: "created",
      label: "when",
      align: "right",
      // Relative, with the absolute instant in the title (Voice bar 6). An
      // instant that will not parse carries an empty title, and is handed over
      // as null so the table's dash draws it — never a zero age.
      cell: (row) => {
        const age = relativeAge(row.createdAt);
        return age.title === "" ? null : <span title={age.title}>{age.text}</span>;
      },
    },
  ];

  if (card !== undefined) return <>{card}</>;

  return (
    <>
      {/* `data-absence-note` is what makes "said once" a structural claim
          rather than a copy one: an oracle counts the notes and not the
          sentences, and the window line above carries an em dash of its own. */}
      <p data-absence-note="dash" className="type-body text-ink-secondary">
        {DASH_MEANS}
      </p>
      <DataTable<VerdictLine>
        columns={columns}
        rows={line === undefined ? [...lines] : []}
        rowKey={(row) => row.verdictId}
        label={label}
        placeholder={line}
      />
    </>
  );
}
