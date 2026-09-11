"use client";

import type { ReactNode } from "react";
import { PageMore, usePageRows } from "@/components/ui/paging";
import { StateOf } from "@/components/ui/state-of";
import type { BrowseRow } from "@/lib/browse/rows";
import type { BrowseColumnKey, BrowseView } from "@/lib/browse/views";
import { PAGE_ROUTES, pageBound, type PageNote } from "@/lib/paging/bounds";
import { initialPage } from "@/lib/paging/machine";
import { BrowseTable } from "./browse-table";

/**
 * Browse's one curated view, WITH the affordance that continues it — campaign
 * admin-window/TASK-0069, SPEC F14.
 *
 * **The first screen does not change.** The rows above the control are the
 * ones the page server-rendered, in the order it rendered them, through the
 * same `BrowseTable` and the same cell markup; a press appends beneath them.
 * This component derives no row, sorts nothing and counts nothing — and it
 * fetches nothing itself: `usePageRows` (admin-window/TASK-0064) owns the
 * press and `lib/paging/machine.ts` owns every decision the press makes.
 *
 * **THE DRAWING RULE IS A FULL FIRST WINDOW, AND THERE IS NO TOTAL TO ASK.**
 * Browse's events read is a WINDOW read with no count beside it at all
 * (`readRecentEvents` returns rows and nothing else), so a `total` prop here
 * would always be `null` and an affordance derived from one would never be
 * reachable. The honest signal that there is more is that the window came back
 * FULL, and that question is asked of the one function that answers it:
 * `pageBound(String(held), size)` is `ok` exactly when `held` is a bound this
 * surface can page from, which on a window read of at most `size` rows is the
 * same question as "did it fill". A SHORT window is therefore never
 * `more: true`, so no state is ever constructed off the bound grid — the
 * defect QA measured on `/claims` (admin-window/BUG-0168), where a first
 * screen could be handed a state whose every press `pageBound` refuses for
 * ever. The surface still says "the newest N by arrival" and nothing here
 * presents the rows it holds as a total.
 *
 * The PAGE asks the same question of the same function before it draws this
 * component at all (`src/app/browse/page.tsx`), so a short window, an empty
 * one, a refused read and an absent table render exactly what they rendered
 * before this ticket, with no paging element in the markup. The two calls
 * cannot disagree — same function, same `held`, same window — and this one
 * stands because the state has to be built from something, and a `more` prop
 * would be a second opinion where the contract wants an answer.
 *
 * **The window is spelled ONCE per surface** (admin-window/BUG-0168, QA
 * residual 4 off admin-window/TASK-0064). It arrives as the `size` prop — the
 * view's own window, which the PAGE spells and this file deliberately never
 * names — neither the view registry nor the view's own window field. That one
 * value is handed to `usePageRows` as the number the driver grades a page
 * full-or-short against, and `PageMore` is fed the number the hook hands BACK,
 * so the number the label renders and the number the driver grades against
 * cannot disagree.
 *
 * **THE WRAPPER OWNS THE `data-surface` DIV, AND IT WRAPS THE TABLE ALONE.**
 * `[data-surface="events"]` names the events BODY and nothing else: the live
 * oracle (`tests/live/browse.live.test.ts`) grades the STATE of that element
 * as the state of the events read, and `StateOf` carries
 * `data-state="error"` / `data-state="not_provisioned"`. A paged leg note
 * rendered INSIDE it would therefore grade an unreadable provenance leg as an
 * unreadable events window — precisely what this page's own pin ("holds the
 * events body and nothing else — the leg notes stay outside it") exists to
 * forbid. So the notes and the control are SIBLINGS after that element, and
 * the page's own first-screen leg notes stand where they always have, above
 * the table and outside the surface.
 *
 * **THE LEGS A PAGE BROUGHT ARE RENDERED, THE SAME WAY THE FIRST SCREEN
 * RENDERS ITS OWN.** Browse is read by four queries: the events window decides
 * the rows, and the venue and provenance legs FILL columns over that window's
 * ids. The route puts both legs' reports on its `ok` arm and the driver merges
 * them into `state.notes` (admin-window/TASK-0076), so a page whose provenance
 * leg refused never reaches the operator as events with a silently empty
 * Sources column. Each non-null note renders through the SAME `StateOf`
 * primitive the page uses — same `data-not-provisioned` / `data-read-failed`
 * hooks, same words, the database's own object and the database's own account,
 * neither reworded nor truncated here. This file writes no note of its own,
 * imports nothing from `lib/db` (the `StateOf` seam, ARCHITECTURE.md §4) and
 * SPELLS NO LEG KEY: it renders the non-null notes the record holds, in the
 * record's own order, so its output cannot drift from the route's spelling.
 *
 * **ONE OBJECT, REPORTED ONCE.** The page already names its own refused legs
 * above the table; repeating the same object below the rows tells the operator
 * nothing and doubles a red line. A paged note is rendered only when the
 * OBJECT it names — `missing` or `reading` — is not already reported. The
 * identity is the object and not the leg key, and it is the same string on
 * both sides because it comes from the same read.
 *
 * **The column selector and paging do not fight.** Changing columns is URL
 * state and re-renders the first screen from the server (paged-in rows are
 * discarded); paging never rewrites the URL.
 */

/** What this surface holds, in the app's own word. */
const HOLDS = "events";

/**
 * The object a leg's report is ABOUT, in the database's own spelling — the
 * same string the page's own card for that read would carry.
 *
 * This is the identity "reported once" is keyed on, and it is the note's own
 * field rather than the record's key: the key is the surface's vocabulary, the
 * object is the database's, and only the latter is the same string on both
 * sides of the wire.
 */
function objectOf(note: PageNote): string {
  return note.kind === "not_provisioned" ? note.missing : note.reading;
}

/** @see the module docstring above — the whole rule lives there. */
export function PagedBrowseTable({
  surface,
  view,
  shown,
  initial,
  params,
  size: window,
  reported,
}: {
  /** The name the events BODY answers to — `data-surface`, spelled by the page. */
  surface: string;
  view: BrowseView;
  /** The columns the URL says are shown, as the page resolved them. */
  shown: readonly BrowseColumnKey[];
  /** The rows the page RENDERED, in the order it rendered them. */
  initial: readonly BrowseRow[];
  /** The view + column state the page RENDERED, serialized — never the raw URL. */
  params: string;
  /** The surface's window, spelled by the page and by nothing here. */
  size: number;
  /**
   * The objects the PAGE has already reported above the table — its own legs'
   * `missing` / `reading`. A leg named once is not named again below.
   */
  reported: readonly string[];
}): ReactNode {
  // What the page actually RENDERED is the bound the next press carries, and
  // it is the only thing this surface has to go on: there is no count beside
  // the window read.
  const held = initial.length;
  // A FULL first window, asked of the one function that answers it. A short
  // one starts `exhausted`, which is honest — the read that filled this screen
  // is the read that says the set has ended — and it is never a state off the
  // bound grid.
  const more = pageBound(String(held), window).kind === "ok";

  const { state, press, size } = usePageRows<BrowseRow>(
    initialPage<BrowseRow>(held, more),
    { route: PAGE_ROUTES.browse, params, size: window },
  );

  // The legs the pages THIS STATE took in reported, in the record's own order
  // (the route composes them and JSON preserves it), each named at most once
  // across the whole page: the objects the page already reported are seeded
  // in, so a leg the first screen named is not named again here.
  const named = new Set<string>(reported);
  const notes: [string, PageNote][] = [];
  for (const [key, note] of Object.entries(state.notes ?? {})) {
    if (note === null) continue;
    const object = objectOf(note);
    if (named.has(object)) continue;
    named.add(object);
    notes.push([key, note]);
  }

  return (
    <div className="flex flex-col gap-4">
      {/* The events BODY, and nothing else, under the name the oracle grades:
          the notes below are separate reads with separate states. */}
      <div data-surface={surface}>
        <BrowseTable view={view} shown={shown} rows={[...initial, ...state.rows]} />
      </div>
      {notes.map(([key, note]) => (
        <StateOf key={key} result={note} />
      ))}
      {/* The app's own noun for what this surface holds, in the glossary's one
          word (LESSONS 6) — the same word the page's window line uses, and the
          word the control's label is built from: "Show the next 50 events". */}
      <PageMore state={state} holds={HOLDS} size={size} onPress={press} />
    </div>
  );
}
