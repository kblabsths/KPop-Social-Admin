"use client";

import type { ReactNode } from "react";
import { PageMore, usePageRows } from "@/components/ui/paging";
import type { ClaimLine } from "@/lib/claims/lines";
import { PAGE_ROUTES } from "@/lib/paging/bounds";
import { initialPage } from "@/lib/paging/machine";
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
 * **The window is spelled ONCE per surface** (admin-window/BUG-0168, QA
 * residual 4 off admin-window/TASK-0064). It arrives as the `size` prop: the
 * window constant `src/components/claims/claim-list.tsx` declares, which the
 * PAGE spells and this file deliberately never names. That one value is handed
 * to `usePageRows` as the number the driver grades a page full-or-short
 * against, and `PageMore` is fed the number the hook hands BACK. The two
 * copies that used to be reconciled nowhere are one value, so a control that
 * says "the next 50" and a driver grading against 25 cannot happen here.
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

/** @see the module docstring above — the whole rule lives there. */
export function PagedClaimList({
  label,
  initial,
  total,
  params,
  size: window,
  line,
}: {
  label: string;
  /** The first screen's rows — already shaped by the page (`claimLines`). */
  initial: readonly ClaimLine[];
  /** How many rows the whole narrowing holds, when a count established it. */
  total: number | null;
  /** The narrowing this page RENDERED, serialized — never the raw URL. */
  params: string;
  /** The surface's window, spelled by the page and by nothing here. */
  size: number;
  line?: ReactNode;
}): ReactNode {
  // What the page actually RENDERED is the bound the next press carries: the
  // rows on screen, never a count and never the window the read asked for.
  const held = initial.length;
  // A COUNT, or no affordance: `initialPage` starts `exhausted` where nothing
  // established there is more, because a control that cannot be honoured is
  // never offered (SPEC F10). The page reaches this with a count that already
  // said there is more, so the `null` arm is the honest default and not a
  // state this surface renders.
  const more = total !== null && total > held;

  const { state, press, size } = usePageRows<ClaimLine>(initialPage<ClaimLine>(held, more), {
    route: PAGE_ROUTES.claims,
    params,
    size: window,
  });

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
      <PageMore state={state} holds={HOLDS} size={size} onPress={press} />
    </div>
  );
}
