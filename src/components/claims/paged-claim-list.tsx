"use client";

import type { ReactNode } from "react";
import { PageMore, usePaging } from "@/components/ui/paging";
import type { ClaimLine } from "@/lib/claims/lines";
import { ClaimList } from "./claim-list";

/**
 * The claims list, WITH the affordance that continues it — campaign
 * admin-window/TASK-0067, SPEC F14.
 *
 * **The first screen does not change.** The rows above the control are the
 * ones the page server-rendered, in the order it rendered them, through the
 * same `ClaimList` and the same row markup; a press appends beneath them. This
 * component derives no row, sorts nothing and counts nothing — and it fetches
 * nothing itself: `usePageRows` (admin-window/TASK-0064) owns the press and
 * `lib/paging/machine.ts` owns every decision the press makes.
 *
 * **Whether the affordance is drawn AT ALL is the PAGE's decision, not this
 * component's** (`src/app/claims/page.tsx`). The page draws this wrapper only
 * where a COUNT established there is more AND the rows it rendered are a bound
 * this surface can page from; in every other state it renders the plain
 * `ClaimList` and no paging element exists in the markup. That is why nothing
 * below reads a count, a state kind or a window line.
 *
 * **The state is the SURFACE's, not this component's** (admin-window/BUG-0172).
 * The page wraps its window line and this wrapper in ONE `PagingProvider`,
 * which owns the press; this file consumes that state through `usePaging` and
 * derives nothing from it. That is what lets the sentence above the rows and
 * the control below them read one derivation — before this ticket the line was
 * server-rendered above a wrapper that could change the rows underneath it,
 * and after a press the two contradicted each other in the hooks.
 *
 * **The window is spelled ONCE per surface** (admin-window/BUG-0168, QA
 * residual 4 off admin-window/TASK-0064). The PAGE spells it — the window
 * constant `src/components/claims/claim-list.tsx` declares — into the deps it
 * hands the provider, and `PageMore` is fed the number the driver hands BACK
 * through the context. This file never names it. The two copies that used to
 * be reconciled nowhere are one value, so a control that says "the next 50"
 * and a driver grading against 25 cannot happen here.
 *
 * **The BOUND CEILING is not asked here, and that is deliberate** (the
 * architect's ruling of 2026-09-10 on admin-window/BUG-0168). A count and a
 * window read are two reads and can disagree — a count of 900 beside a window
 * read that returned 37 rows is reachable — and `initialPage(37, true)` is a
 * state whose every press `pageBound` refuses for ever. Two different
 * questions answer that:
 *
 *  - the PAGE decides not to draw this component at all, so `/claims` emits no
 *    paging element in that state;
 *  - and where one is drawn anyway, the ceiling is the WIDGET's rule: it draws
 *    no control and says `data-paging="limit"`, which does NOT claim the set
 *    has ended.
 *
 * A third check here would be a worse answer, not a safer one: refusing `more`
 * for an off-grid `held` starts the state `exhausted`, and the surface would
 * then say "All claims in this view are shown" about a view a count says holds
 * 900 — the one sentence that ruling forbids for this state.
 */

/** What this surface holds, in the app's own word. */
const HOLDS = "claims";

/**
 * WHAT THIS SURFACE OFFERS THE OPERATOR once this app has stopped paging at
 * its own bound ceiling — this surface's sentence, living on this surface
 * (admin-window/BUG-0198).
 *
 * `PageMore`'s ceiling arm names what stopped the paging and that it is not
 * the end of the set; the step after that is per-surface, because only a
 * surface knows whether its own URL can remove a row. `/claims` can: the page
 * draws the bucket tabs and the `source_id` filter bar above this list
 * (`src/app/claims/page.tsx`), and every one of them reads FEWER claims — so
 * narrowing really is how this surface is worked, and this instruction is one
 * an operator here can carry out. It is exported so the surface's own test
 * reads the sentence rather than retyping it (LESSONS 5); it is deliberately
 * NOT in `@/components/claims`' barrel, which may re-export a component from
 * this client module and nothing else (admin-window/BUG-0094).
 *
 * A surface that cannot be narrowed hands `PageMore` no next step at all
 * rather than this one — see `../browse/paged-browse-table.tsx`.
 */
export const NARROW_THE_VIEW = "Narrow the view and page the smaller set.";

/** @see the module docstring above — the whole rule lives there. */
export function PagedClaimList({
  label,
  initial,
  line,
}: {
  label: string;
  /** The first screen's rows — already shaped by the page (`claimLines`). */
  initial: readonly ClaimLine[];
  line?: ReactNode;
}): ReactNode {
  // The surface's one state, published by the provider the page wrapped this
  // in: the rows a press appended, the press itself, the window the driver
  // graded them against, and whether this window's two reads agree. Nothing
  // here decides any of the four — the verdict in particular is derived once,
  // by `readsAgree` over the provider's one window (admin-window/BUG-0180),
  // and is carried to the control rather than re-asked of a count this file
  // deliberately never sees.
  const { state, press, size, readsAgree } = usePaging<ClaimLine>();

  return (
    <div className="flex flex-col gap-4">
      <ClaimList label={label} rows={[...initial, ...state.rows]} line={line} />
      {/* The app's own noun for what this surface holds, in the glossary's
          one word (LESSONS 6) — the same word the page's empty card uses, and
          the word the control's label is built from: "Show the next 50
          claims". It is a literal rather than a prop because the props are the
          interface this ticket was given, and this surface holds exactly one
          kind of thing on both of its tabs — a standing disagreement is a
          claim, not a second noun. */}
      <PageMore
        state={state}
        holds={HOLDS}
        size={size}
        readsAgree={readsAgree}
        nextStep={NARROW_THE_VIEW}
        onPress={press}
      />
    </div>
  );
}
