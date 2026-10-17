"use client";

import type { ReactNode } from "react";
import { WindowControls, usePaging } from "@/components/ui/paging";
import { StateOf } from "@/components/ui/state-of";
import type { BrowseRow } from "@/lib/browse/rows";
import type { BrowseColumnKey, BrowseView } from "@/lib/browse/views";
import type { PageNote } from "@/lib/paging/bounds";
import { BrowseTable } from "./browse-table";

/**
 * Browse's one curated view, ONE WINDOW AT A TIME, with the controls that
 * move it — campaign admin-window/TASK-0069, SPEC F14, page windows since
 * 2026-10-16.
 *
 * **The controls are ABOVE the table** (LOOK_AND_FEEL bar 14). The rows are
 * the window the paging state holds — the server's own on a cold load, the
 * route's after a move — through the same `BrowseTable` and the same cell
 * markup. This component derives no row and fetches nothing itself.
 *
 * **THE WRAPPER OWNS THE `data-surface` DIV, AND IT WRAPS THE TABLE ALONE.**
 * `[data-surface="events"]` names the events BODY and nothing else: a leg
 * note rendered INSIDE it would grade an unreadable provenance leg as an
 * unreadable events window. So the notes a moved-to window brought are
 * SIBLINGS above the table — beside the page's own first-screen leg notes,
 * which stand where they always have — and the controls above them.
 *
 * **THE LEGS A WINDOW BROUGHT ARE RENDERED THE WAY THE FIRST SCREEN RENDERS
 * ITS OWN** (admin-window/TASK-0076): each non-null note through the SAME
 * `StateOf` primitive, the database's own object and account, neither reworded
 * nor truncated. **ONE OBJECT, REPORTED ONCE**: a note is rendered only when
 * the object it names is not already reported by the page above.
 */

/** What this surface holds, in the app's own word. */
const HOLDS = "events";

/** The object a leg's report is ABOUT, in the database's own spelling. */
function objectOf(note: PageNote): string {
  return note.kind === "not_provisioned" ? note.missing : note.reading;
}

/** @see the module docstring above — the whole rule lives there. */
export function PagedBrowseTable({
  surface,
  view,
  shown,
  reported,
}: {
  /** The name the events BODY answers to — `data-surface`, spelled by the page. */
  surface: string;
  view: BrowseView;
  /** The columns the URL says are shown, as the page resolved them. */
  shown: readonly BrowseColumnKey[];
  /** The objects the PAGE has already reported above the table. */
  reported: readonly string[];
}): ReactNode {
  const { state } = usePaging<BrowseRow>();

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
      {/* NO NEXT STEP, because this surface has none to offer
          (admin-window/BUG-0198): `/browse`'s single parameter is `columns`,
          which chooses which COLUMNS render and never which rows are read. */}
      <WindowControls holds={HOLDS} nextStep={null} />
      {notes.map(([key, note]) => (
        <StateOf key={key} result={note} />
      ))}
      {/* The events BODY, and nothing else, under the name the oracle grades. */}
      <div data-surface={surface}>
        <BrowseTable view={view} shown={shown} rows={state.rows} />
      </div>
    </div>
  );
}
