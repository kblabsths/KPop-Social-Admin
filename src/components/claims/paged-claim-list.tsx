"use client";

import type { ReactNode } from "react";
import { WindowControls, usePaging } from "@/components/ui/paging";
import type { ClaimLine } from "@/lib/claims/lines";
import { ClaimList } from "./claim-list";

/**
 * The claims list, ONE WINDOW AT A TIME, with the controls that move it —
 * campaign admin-window/TASK-0067, SPEC F14, page windows since 2026-10-16.
 *
 * **The controls are ABOVE the list** (LOOK_AND_FEEL bar 14, Ben's ruling of
 * 2026-09-11: nothing the operator must find sits below a long list). The
 * rows below them are the window the paging state holds — the server's own
 * rows on a cold load, the route's after a move — through the same
 * `ClaimList` and the same row markup. This component derives no row, sorts
 * nothing and counts nothing, and it fetches nothing itself: `usePageWindows`
 * owns the move and `lib/paging/machine.ts` owns every decision it makes.
 *
 * **Whether the affordance is drawn AT ALL is the PAGE's decision**
 * (`src/app/claims/page.tsx`): it wraps this in a `PagingProvider` only on an
 * `ok` read with a count beside it; in every other state it renders the plain
 * `ClaimList` and no paging element exists in the markup. The state is the
 * SURFACE's, published by that provider (admin-window/BUG-0172).
 */

/** What this surface holds, in the app's own word. */
const HOLDS = "claims";

/**
 * WHAT THIS SURFACE OFFERS THE OPERATOR once this app has stopped paging at
 * its own bound ceiling — this surface's sentence, living on this surface
 * (admin-window/BUG-0198). `/claims` can be narrowed: the page draws the
 * bucket tabs and the `source_id` filter bar above this list, and every one
 * of them reads FEWER claims. Exported so the surface's own test reads the
 * sentence rather than retyping it (LESSONS 5); deliberately NOT in
 * `@/components/claims`' barrel (admin-window/BUG-0094).
 */
export const NARROW_THE_VIEW = "Narrow the view and page the smaller set.";

/** @see the module docstring above — the whole rule lives there. */
export function PagedClaimList({ label, line }: { label: string; line?: ReactNode }): ReactNode {
  const { state } = usePaging<ClaimLine>();
  return (
    <div className="flex flex-col gap-4">
      <WindowControls holds={HOLDS} nextStep={NARROW_THE_VIEW} />
      <ClaimList label={label} rows={state.rows} line={line} />
    </div>
  );
}
