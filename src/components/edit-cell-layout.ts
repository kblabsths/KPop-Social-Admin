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
 * The rule: **the cell's in-flow content is the resting value, in EVERY state
 * it is ever in.** The resting value stays in the flow while the cell is open
 * — hidden, but still holding exactly the box it held — and everything else
 * the cell ever draws (the field, its hint, and the line stating what the
 * write is doing) is drawn OUT of the flow, over the top of it. A row whose
 * size cannot change cannot move another row's control out from under a
 * pointer, and that is the entire fix.
 *
 * **Reopened 2026-09-09, and the rule is why: it was applied to two of the
 * three things the cell draws.** The first cut floated the field and the hint
 * and left `EditStatus` — `saving…`, measured 46x16 at `position: static`,
 * plus the container's 8px gap — in the row's flow. So the reflow simply moved
 * to the commit window: QA opened `label`, typed, and clicked `tally`'s
 * resting centre 120ms later; the cell's in-flow content grew ~54px as the
 * statement appeared, crossed the Value column's max-content, the auto table
 * layout re-apportioned, every value in the column moved 12.09px LEFT
 * (48.76px in dark theme), `elementFromPoint` at the press point became a
 * `<td>` of another row, and nothing opened — the same defect, one state
 * later. A part is either in the flow or it is not; there is no third state
 * for a part that is "only transient".
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

/** The parts of a cell, and where each one goes. */
export interface CellLayout {
  /** The resting value — the button an operator clicks to open the cell. */
  readonly value: PartPlacement;
  /** The input or textarea, while the cell is open. */
  readonly field: PartPlacement;
  /** The line saying how the edit ends (`editHint`). */
  readonly hint: PartPlacement;
  /**
   * The line saying what the write is doing or did (`EditStatus`): `saving…`,
   * `saved`, or the refusal. It appears and disappears on its own while the
   * cell is CLOSED — during the commit window, which is exactly when an
   * operator's next click is in the air — so it is the part that must least of
   * all be allowed to take space (campaign admin-window/BUG-0086, reopened).
   */
  readonly status: PartPlacement;
}

/** What the cell is doing, as far as its layout is concerned. */
export interface CellState {
  /** Is the cell open — a field on screen instead of the resting value? */
  readonly editing: boolean;
  /**
   * Is a status on screen at all? True for `saving`, `saved` and `failed`;
   * false for `idle`, which renders nothing (`EditStatus`).
   */
  readonly statusShown: boolean;
}

/**
 * Does this placement take space in the row? Only a part that does can move
 * another row's control, which is the property BUG-0086 turns on.
 */
export function occupiesFlow(placement: PartPlacement): boolean {
  return placement === "flow" || placement === "flow-hidden";
}

/**
 * Where the cell's parts go, in the state it is in.
 *
 * Every branch answers the same in-flow set — `value`, and nothing else — so
 * no state this cell can be in changes the width its row asks the table for.
 */
export function cellLayout({ editing, statusShown }: CellState): CellLayout {
  return {
    value: editing ? "flow-hidden" : "flow",
    field: editing ? "float" : "absent",
    hint: editing ? "float-inert" : "absent",
    // Inert like the hint, and for the same reason: it hangs over whatever is
    // beside the value — on this surface another line's control — and a click
    // aimed at that control has to reach it.
    status: statusShown ? "float-inert" : "absent",
  };
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
  return lastOfSeveral(row, rows) ? "above" : "below";
}

/**
 * Is this the LAST of several lines — the one whose neighbour on the far side
 * is not another line but the table's own clipping container?
 *
 * One predicate, because two rules turn on it (`hintSide`, `statusGrowth`) and
 * a copy of it would be free to drift from the other. A single line (`rows`
 * 1) is not "last": it has no neighbour on either side, so neither rule has a
 * row to hang over and both take their ordinary direction.
 */
function lastOfSeveral(row: number, rows: number): boolean {
  return rows > 1 && row === rows - 1;
}

/** Which way the status line grows away from the row it belongs to. */
export type StatusGrowth =
  /** Pinned to the row's top edge; the box extends downward, over the lines below. */
  | "down"
  /** Pinned to the row's bottom edge; the box extends upward, over the lines above. */
  | "up";

/**
 * Which way the status line grows for the `row`-th cell of `rows` — campaign
 * admin-window/BUG-0101.
 *
 * `hintSide`'s problem, one part later. The status is out of the row's flow
 * too (`cellLayout(...).status`, campaign admin-window/BUG-0086) and was
 * anchored to the row's TOP edge with no side at all, so it always grew
 * downward — and on the last line there is nothing below but `DataTable`'s
 * `overflow-x-auto` container, which clips.
 *
 * Measured by QA on a production build against staging, 2026-09-08, 1440x900,
 * both themes, `walk_sandbox` row `…0001`: refusing `observed_on` (the
 * record's last field) drew the refusal box from y 337 to y 393 against a
 * container whose bottom edge is y 363. The mono half was cut 8px mid-word and
 * the app-voice half — 373 to 391, the whole of what BUG-0098 shipped — was
 * painted nowhere at all, 28px outside the container, readable only by
 * scrolling the container itself.
 *
 * It gets worse with the refusal's own words, not better: the box is
 * `max-w-xs`, so its height is a function of the database's sentence, and the
 * 23502 DETAIL this surface already renders measures 120px.
 *
 * So the last line's status grows UP from its bottom edge, where the rows are,
 * exactly as its hint hangs above. Every other line grows down, which is what
 * it has always done and what an operator reading top to bottom expects.
 *
 * Pure and exported for `hintSide`'s reason: a bounding box is a browser fact
 * and `tests/offline` is environment node with `renderToStaticMarkup` and no
 * jsdom (STACK.md §4). The decision is pinned offline; the boxes themselves
 * are measured in a walk.
 *
 * A caller that knows nothing about its neighbours (the review-item close
 * form's supplied-value cell) passes nothing and gets `down`.
 */
export function statusGrowth(row: number, rows: number): StatusGrowth {
  return lastOfSeveral(row, rows) ? "up" : "down";
}

/**
 * The vertical geometry a status box is fitted into, in viewport pixels —
 * everything `statusShift` needs and nothing else.
 *
 * `box*` are the box's OWN edges, as it would be drawn with no correction at
 * all (`statusGrowth`'s anchor and nothing more). `clip*` are the content
 * edges of the nearest ancestor that clips it — on the record surface,
 * `DataTable`'s `overflow-x-auto`, whose other axis computes to `auto`.
 */
export interface StatusBounds {
  /** The box's top edge, uncorrected. */
  readonly boxTop: number;
  /** The box's bottom edge, uncorrected. */
  readonly boxBottom: number;
  /** The clipping container's content top edge. */
  readonly clipTop: number;
  /** The clipping container's content bottom edge. */
  readonly clipBottom: number;
}

/**
 * How far to move the status box, in pixels, so that ALL of it is inside the
 * container that clips it — campaign admin-window/BUG-0104.
 *
 * `statusGrowth` is ORDINAL: it asks which line this is, and answers `up` only
 * for the last of several. That rescues exactly one line, and the box does not
 * overflow because of its ordinal — it overflows because it is TALLER THAN THE
 * ROOM BELOW ITS OWN ROW. QA measured the same defect undiminished one line up
 * (2026-09-08, production build against staging, 1440x900, both themes,
 * `walk_sandbox` row …0001): clearing `is_flagged`, the second-to-last of six
 * fields, drew the 23502 refusal from y 304 to y 424 against a container of
 * y 143 → 363 — the mono half cut 39px mid-word at `A note a`, the app-voice
 * half (404 → 422) painted nowhere at all. Row 5 was told `down` before
 * BUG-0101 and after it, so nothing about that fix reached this.
 *
 * No ordinal rule can: the box's height is the DATABASE's sentence (the box is
 * `max-w-xs`, and this surface's 23502 measures 120px against 62px of room),
 * so which lines overflow is a fact about the refusal, not about the record's
 * shape. Hence a MEASURED correction, applied over whatever `statusGrowth`
 * anchored — the two rules do not compete: the anchor decides which way the
 * box grows by default (and `hintSide` stays in step with it, one predicate
 * for both), and this decides how far it must move when that default still
 * leaves it outside. A box already inside gets `0` and is drawn exactly where
 * it has always been drawn, which is what keeps every refusal QA measured
 * inside at the pixel it was measured at (`label` 205 → 325, `tally`
 * 271 → 327, `observed_on` 301 → 357).
 *
 * The correction is applied as a TRANSFORM by the caller, never as a layout
 * property: a translated box changes no one's flow, so BUG-0086's invariant —
 * nothing this cell draws may move another row's control — survives the fix
 * by construction.
 *
 * Preference order, when both edges cannot be honoured (a refusal taller than
 * the whole container, which no refusal this surface produces today at six
 * fields): the TOP wins, so the box starts at the container's first pixel and
 * the operator reads the refusal from its beginning, with the container's own
 * scroll — which exists, since it is what clips — reaching the rest.
 *
 * Pure and exported for `hintSide`'s and `statusGrowth`'s reason: a bounding
 * box is a browser fact and `tests/offline` is environment node with
 * `renderToStaticMarkup` and no jsdom (STACK.md §4). The rule is pinned
 * offline on the measured numbers; the boxes themselves are measured in a walk.
 */
export function statusShift({
  boxTop,
  boxBottom,
  clipTop,
  clipBottom,
}: StatusBounds): number {
  // Below the container's floor: lift it by exactly the overflow, never more —
  // a box that already fits must not move at all.
  const below = boxBottom - clipBottom;
  let shift = below > 0 ? -below : 0;
  // Above its ceiling — either where it was drawn, or where lifting it just
  // put it. The top wins: the refusal reads from its first word.
  const above = clipTop - (boxTop + shift);
  if (above > 0) shift += above;
  return shift;
}
