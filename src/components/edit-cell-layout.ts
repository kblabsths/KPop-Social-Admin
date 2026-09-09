/**
 * How an editable cell is laid out — the pure half of campaign
 * admin-window/BUG-0086.
 *
 * A module of its own, and NOT part of `EditableCell.tsx`, for one runtime
 * reason: that file is `"use client"`, and `RecordFields` — a synchronous
 * server component (ARCHITECTURE.md §5) — has to call `hintSide` while it
 * renders. Next 16 refuses that across the boundary ("Attempted to call
 * hintSide() from the server but hintSide is on the client"), and the refusal
 * is a 500 on the record page, invisible to `tests/offline` because that tier
 * is plain node with no client boundary in it. Measured on a production build,
 * 2026-09-08. A pure rule both sides need therefore lives outside the
 * boundary; the cell imports it like anyone else.
 */

/**
 * Where each part of the cell is drawn — the whole of campaign
 * admin-window/BUG-0086.
 *
 * Measured by QA on the TASK-0053 attack (2026-09-08, production build against
 * staging, viewport 1400x950): opening the `label` cell moved the `note`
 * cell's resting button 101px left and 26px down, because the open field
 * claimed the column's full width and the hint line was added to the row's
 * flow. A single human-timed click on `note` then landed on its button at
 * mousedown and on a `<td>` of a different row at mouseup: the click was
 * swallowed, nothing opened, and the operator had to click twice. Correcting
 * several fields of one record is this surface's whole job, so it failed at
 * the second field.
 *
 * The rule: **an open cell puts nothing into the row's flow that a resting one
 * does not, and takes nothing out of it.** The resting value stays in the flow
 * while the cell is open — hidden, but still holding exactly the box it held —
 * and everything edit mode adds is drawn OUT of the flow, over the top of it.
 * A row whose size cannot change cannot move another row's control out from
 * under a pointer, and that is the entire fix.
 *
 * Pure and exported for the reason `focusVerdict` and `selectOnOpen` are: a
 * bounding box is a browser fact and `tests/offline` is environment node with
 * `renderToStaticMarkup` and no jsdom (STACK.md §4). The decision is pinned
 * offline; the boxes themselves are measured in a walk.
 */
export type PartPlacement =
  /** Not drawn at all in this state. */
  | "absent"
  /**
   * In the row's flow: its size is the table's business, so it is what decides
   * where every other row's controls sit.
   */
  | "flow"
  /**
   * In the flow, holding exactly the box it held, and shown to nobody — not to
   * the eye, not to the pointer, not to the accessibility tree.
   */
  | "flow-hidden"
  /** Out of the flow, over whatever is around it, and hit-testable. */
  | "float"
  /**
   * Out of the flow AND transparent to the pointer, so a single click aimed at
   * what it hangs over reaches that thing rather than this one.
   */
  | "float-inert";

/** The three parts of a cell, and where each one goes. */
export interface CellLayout {
  /** The resting value — the button an operator clicks to open the cell. */
  readonly value: PartPlacement;
  /** The input or textarea, while the cell is open. */
  readonly field: PartPlacement;
  /** The line saying how the edit ends (`editHint`). */
  readonly hint: PartPlacement;
}

/**
 * Does this placement take space in the row? Only a part that does can move
 * another row's control, which is the property BUG-0086 turns on.
 */
export function occupiesFlow(placement: PartPlacement): boolean {
  return placement === "flow" || placement === "flow-hidden";
}

/** Where the cell's three parts go, in the state it is in. */
export function cellLayout(editing: boolean): CellLayout {
  return editing
    ? { value: "flow-hidden", field: "float", hint: "float-inert" }
    : { value: "flow", field: "absent", hint: "absent" };
}

/** Which side of the field the hint hangs on. */
export type HintSide = "below" | "above";

/**
 * Which side the hint hangs on for the `row`-th cell of `rows` — campaign
 * admin-window/BUG-0086.
 *
 * The hint is out of the flow, so it hangs OVER a neighbouring row instead of
 * pushing one down. Below the last row there is no neighbour, only the table's
 * own container: `DataTable` wraps its table in `overflow-x-auto`, and a box
 * whose other axis is `visible` computes to `auto` — it clips. So the last
 * line's hint hangs above, where the rows are. Every other line hangs below,
 * which is where an operator reading top to bottom expects it.
 *
 * A caller that knows nothing about its neighbours (the review-item close
 * form's supplied-value cell) passes nothing and gets `below`.
 */
export function hintSide(row: number, rows: number): HintSide {
  return rows > 1 && row === rows - 1 ? "above" : "below";
}
