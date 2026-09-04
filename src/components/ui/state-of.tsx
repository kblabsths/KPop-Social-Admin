import type { ReactNode } from "react";

import { ErrorLine } from "./error-line";
import type { MicroLabel } from "./micro-label";
import { NotProvisioned } from "./not-provisioned";

/**
 * What creates the ecosystem objects this window reads — the `arrivesWith`
 * half of every not-provisioned card (LOOK_AND_FEEL state 3, Voice bar 4).
 *
 * One constant, spelled once. It stood hand-copied in all EIGHT pages, so a
 * copy edit to one sentence was eight edits nobody could see from inside a
 * single worktree (common violation 9, admin-window/DEBT-0003).
 */
export const ARRIVES_WITH = "the scraper repo's migrations";

/**
 * One retry sentence, in the app's voice, for every failed read in the window
 * (LOOK_AND_FEEL state 4: the database's own words, then what to do about it).
 * Hand-copied into four pages before admin-window/DEBT-0003.
 */
export const RETRY = "Reload to try the read again.";

/**
 * A read that produced no rows: the two non-`ok` arms of `DbResult`, spelled
 * exactly as `lib/db/result.ts` spells them.
 *
 * Declared here rather than imported, because a component never imports
 * `lib/db` (ARCHITECTURE.md §4 — `components/**` sits below the pages and
 * fetches nothing; `components/gauges/state.tsx` carries the same seam for the
 * same reason). The page reads, narrows the result, and hands the plain object
 * down; `DbUnavailable` satisfies this structurally, so no page translates.
 */
export type UnavailableRead =
  | { kind: "not_provisioned"; missing: string }
  | { kind: "error"; reading: string; message: string };

/**
 * The state a failed or absent read renders as. `reading` and `missing` come
 * from the result itself, so the line names the object the query named
 * (admin-window/BUG-0016, TASK-0030).
 *
 * ONE definition, for every page (admin-window/DEBT-0003). It stood four
 * times — `/cycles`, `/sources`, `/claims` and `/queues/[reviewItemId]` — and
 * two of those copies had already lost the wrappers below, which is the drift
 * this primitive exists to make impossible: the hooks are what an oracle reads
 * to tell state 3 from state 4 structurally, and a page that publishes neither
 * can be graded as a pass while it is broken (ARCHITECTURE.md §10, common
 * violation 6).
 */
export function StateOf({
  result,
  eyebrow,
}: {
  result: UnavailableRead;
  /** Passed only where no `Section` heading already names the surface. */
  eyebrow?: MicroLabel;
}): ReactNode {
  // The wrapper carries which read refused, in the object's own spelling — the
  // one thing that distinguishes state 3 from state 4 and from an empty
  // surface without reading the card's words back (the three never share a
  // rendering, LOOK_AND_FEEL, Emptiness).
  return result.kind === "not_provisioned" ? (
    <div data-not-provisioned={result.missing}>
      <NotProvisioned
        missing={result.missing}
        arrivesWith={ARRIVES_WITH}
        eyebrow={eyebrow}
      />
    </div>
  ) : (
    <div data-read-failed={result.reading}>
      <ErrorLine reading={result.reading} failed={result.message} retry={RETRY} />
    </div>
  );
}
