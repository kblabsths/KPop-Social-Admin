import { count } from "@/lib/format";
import { IN_PAGE_LINK, anchorFor } from "./links";

/**
 * The line a `?cycle=<run_id>` link earns — campaign admin-window/DEBT-0004,
 * moved here whole from `src/app/cycles/page.tsx`.
 *
 * The page decides WHICH of the three states this is (it is the half holding
 * the read); this file renders whichever it is handed.
 */

/**
 * What this page actually knows about the cycle a `?cycle=<run_id>` link asked
 * for. Three states, because the page has three to be honest about — and the
 * third is not a shade of "absent" (admin-window/BUG-0023).
 */
export type AskedCycleState =
  | { kind: "found" }
  | { kind: "absent" }
  /** No window was read at all; `reading` is the object whose read said so. */
  | { kind: "unchecked"; reading: string };

/**
 * The line a visitor who arrived from a `?cycle=<run_id>` link reads.
 *
 * Three answers, one per state: the row is in this window and is marked; it is
 * not in this window — a real possibility, because the table holds the newest
 * cycles and the linked one may be older; or the window was never read, in
 * which case the line says only that, and names the read that returned none.
 *
 * The third answer is the whole of admin-window/BUG-0023. A refused or absent
 * read hands the page NO window, so "this cycle is not in the window" is a
 * verdict it has no evidence for — and on the not-provisioned path it sat
 * directly above the card naming `resolution_runs` as missing, contradicting
 * itself on one screen. The Dashboard's `lineHref` sends an operator here
 * exactly during an outage, so that sentence sent them after a phantom data
 * problem instead of the table the same screen already named. Saying nothing
 * would leave the link looking broken; saying which read failed does not.
 */
export function AskedCycle({
  askedFor,
  state,
  limit,
}: {
  askedFor: string;
  state: AskedCycleState;
  /** The window's row cap — what "not among the N newest cycles" counts. */
  limit: number;
}) {
  if (state.kind === "unchecked") {
    return (
      <p
        data-cycle-asked={askedFor}
        data-cycle-unchecked={state.reading}
        className="type-body text-ink-secondary"
      >
        Whether cycle <span className="type-data text-ink">{askedFor}</span>{" "}
        is in this window is not something this page can say: the read of{" "}
        <span className="type-data text-ink">{state.reading}</span>{" "}
        returned no window to look in. What is below says why.
      </p>
    );
  }
  return state.kind === "found" ? (
    <p data-cycle-asked={askedFor} data-cycle-found="true" className="type-body text-ink-secondary">
      Cycle{" "}
      <a href={`#${anchorFor(askedFor)}`} className={`type-data ${IN_PAGE_LINK}`}>
        {askedFor}
      </a>{" "}
      is marked in the table below.
    </p>
  ) : (
    <p data-cycle-asked={askedFor} data-cycle-found="false" className="type-body text-ink-secondary">
      Cycle <span className="type-data text-ink">{askedFor}</span>{" "}
      is not among the {count(limit)} newest cycles, so it is not in this
      window — it ran
      earlier, or no cycle carries that id.
    </p>
  );
}
