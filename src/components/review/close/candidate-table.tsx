"use client";

import { Identifier } from "@/components/ui";
import { cx } from "@/components/ui/cx";
import type { PickerOption } from "@/components/records/entity-picker";
import { CandidateImage } from "./candidate-image";

/**
 * The columns, and the grid that holds them aligned with the header.
 *
 * Declared together on purpose: the header is `th`s and a row is one grid
 * button, so nothing but this pair keeps them lined up. Changing one without
 * the other is the defect, which is why they sit on adjacent lines.
 */
/**
 * The six columns a row's own grid lays out, and that grid's template.
 *
 * **The header uses the SAME grid, which is the whole point of them being
 * declared together.** They did not, and the labels did not line up with the
 * values (Ben, 2026-10-23: "the column title doesn't line up with the column
 * correctly for some reason"). The reason: the header was `th`s laid out by
 * the TABLE while a row's values are a GRID inside one spanning cell. Two
 * layout systems, each sizing its own tracks, with nothing making them agree —
 * so they agreed only by accident and only at some widths.
 *
 * Now both are the same grid with the same template. The image sits outside it
 * in its own fixed-width cell, mirrored by a fixed-width blank `th`, so the
 * two halves line up by construction rather than by coincidence.
 */
const COLUMNS = ["name", "group", "agency", "full name", "birthday", "record"] as const;
/*
 * `minmax(0,1fr)` and a FIXED last column, not `1fr` and `auto`.
 *
 * This is the third attempt at the alignment and the first one aimed at the
 * real cause, which browser measurement finally showed: the header's cell and
 * the row's cell were byte-identical and 1350px wide in both, and the labels
 * still drifted up to 223px from their values.
 *
 * `1fr` is `minmax(AUTO, 1fr)`. The auto minimum means a track can never be
 * narrower than its own content's min-content width — so the header's `agency`
 * and the row's `Star Bay Entertainment` set different minima, the leftover
 * space divides differently, and two grids with the same template resolve to
 * different tracks. `auto` on the last column has the same fault: `record`
 * against a uuid.
 *
 * `minmax(0,1fr)` drops the floor, so the three flexible tracks are purely
 * proportional and identical wherever they appear. The uuid column is given a
 * width instead of measuring one. Content that no longer fits is truncated
 * with its full value on the `title`, which is the trade: a column that
 * stays put beats a column that says everything.
 */
const GRID =
  "grid-cols-[6rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_6rem_19rem]";
/**
 * The picture's column, and the classes its cell takes — IDENTICAL in the
 * header and in every row.
 *
 * One constant per shared thing, because the misalignment Ben kept seeing was
 * three near-misses rather than one mistake: the header's grid lacked
 * `w-full` and so shrank to its content, the two face cells had different
 * padding (`px-2` against `pl-2`), and `table-layout: auto` let the content
 * decide the column widths anyway. Near-identical class strings in two places
 * is the shape of that bug, so there are no longer two places.
 */
const FACE_CELL = "w-14 px-2 py-1.5 align-middle";

/**
 * The classes BOTH grid containers take. `w-full` is the load-bearing one: a
 * grid that is not full-width resolves its `1fr` tracks against its content
 * box, so the header's labels drifted left of the values under them.
 */
const GRID_CELL = "grid w-full items-center gap-2 px-2 py-1.5 text-left";

/**
 * A reference item's candidates, as a TABLE whose rows are the choice — Ben,
 * 2026-10-23: *"This should not be a closed form; this is some of the most
 * important information for this review item and should be visible on page
 * load. Additionally, I feel like it should be a table"* and *"you can click a
 * row on the table to select the correct artist"*.
 *
 * **Why not the shared entity picker.** That picker searches a window of up to
 * a thousand rows an operator has to narrow, so it is a search box, a window
 * line and a list — and it SUBMITS on a row press, because a chosen venue is
 * the whole decision. None of that fits here. These are a handful of fixed
 * ranked rows that are the question's options, there is nothing to search, and
 * pressing one must not settle anything: the operator picks a row, writes why,
 * and then presses the control that writes. Select-then-confirm, which is also
 * what keeps a mis-click from writing to canonical.
 *
 * **Why not `ui/DataTable`.** That primitive's rows are not interactive and its
 * cells are not controls; making them so would change the one table every
 * surface in this app shares. A row here is a real `<button>` inside its cell,
 * which is what makes the whole row clickable AND keyboard-reachable without
 * inventing a clickable `<tr>` (quality bar 9 — and a `<tr onClick>` is
 * reachable by pointer alone).
 */
export function CandidateTable({
  options,
  chosen,
  disabled,
  onChoose,
  label,
}: {
  options: readonly PickerOption[];
  /** The row the operator has selected, or `null` before they have. */
  chosen: string | null;
  /** A settlement is in flight, so no row may change the selection. */
  disabled: boolean;
  onChoose: (id: string) => void;
  /** The table's accessible name — what is being chosen. */
  label: string;
}) {
  if (options.length === 0) return null;
  return (
    <div
      data-candidate-table=""
      className="min-w-0 border border-hairline bg-surface"
    >
      <div className="overflow-x-auto">
        {/* `table-fixed`: the two columns are decided by the widths declared on
            the header's cells, not measured from the content. Under `auto`, a
            long agency name could widen the picture's column in one row and
            not another, and no amount of matching classes fixes that. */}
          <table
            className="w-full table-fixed border-collapse text-left"
            aria-label={label}
          >
          <thead>
            <tr className="bg-chrome">
              {/* The picture's column: blank, and the same cell as the one
                  below it. */}
              <th scope="col" className={FACE_CELL} />
              {/* The other six, in the row's OWN grid classes so each label
                  sits over its values. Left-aligned, here and in the rows —
                  there is no numeric column to right-align. */}
              <th scope="col" className="p-0">
                <span className={cx("type-micro text-ink-secondary", GRID_CELL, GRID)}>
                  {COLUMNS.map((head) => (
                    <span key={head} className="truncate">
                      {head}
                    </span>
                  ))}
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {options.map((option) => {
              const selected = option.id === chosen;
              return (
                <tr
                  key={option.id}
                  data-candidate={option.id}
                  data-candidate-chosen={selected ? "true" : undefined}
                  className={cx(
                    "border-t transition-colors",
                    selected
                      ? // The marked row's device, borrowed from `DataTable`'s
                        // own: page fill and an accent rule down the left edge,
                        // both existing tokens, no new colour.
                        "border-t-hairline border-l border-l-accent bg-page"
                      : "border-hairline hover:bg-chrome",
                  )}
                >
                  {/*
                    ONE button spanning every column, so the whole row is the
                    control. It carries `aria-pressed` rather than
                    `aria-current`: this is a selection the operator toggles,
                    not the page they are on.

                    The columns are a GRID on the button rather than real
                    `td`s, because a row has to be one control to be one
                    click — and a grid whose template matches the header keeps
                    them aligned.
                  */}
                  {/*
                    THE IMAGE HAS ITS OWN CELL, because the row is one button
                    and a button may not contain a button. Clicking the face
                    opens a dialog; clicking anywhere else in the row selects
                    it — which is what Ben asked for, and the only shape in
                    which both are reachable by keyboard.
                  */}
                  <td className={FACE_CELL}>
                    {option.imageUrl === null || option.imageUrl === undefined ? (
                      // A fixed box either way, so a row without a picture is
                      // the same height as one with it.
                      <span className="block size-12" />
                    ) : (
                      <CandidateImage url={option.imageUrl} name={option.name} />
                    )}
                  </td>
                  <td className="p-0">
                    <button
                      type="button"
                      onClick={() => onChoose(option.id)}
                      disabled={disabled}
                      aria-pressed={selected}
                      className={cx(
                        GRID_CELL,
                        GRID,
                        disabled && "cursor-not-allowed opacity-50",
                      )}
                    >
                      {/* `truncate` on every cell, because `minmax(0,…)` lets
                          a track be narrower than its content and the
                          alternative is a value spilling into the next
                          column. The full text is on the `title`, so nothing
                          is unreachable. */}
                      <span
                        className="type-body truncate text-ink"
                        title={option.name ?? undefined}
                      >
                        {option.name}
                      </span>
                      <span
                        className="type-body truncate text-ink-secondary"
                        title={option.group ?? undefined}
                      >
                        {option.group}
                      </span>
                      <span
                        className="type-body truncate text-ink-secondary"
                        title={option.agency ?? undefined}
                      >
                        {option.agency}
                      </span>
                      <span
                        className="type-body truncate text-ink-secondary"
                        title={option.fullName ?? undefined}
                      >
                        {option.fullName}
                      </span>
                      <span
                        className="type-body truncate text-ink-secondary"
                        title={option.birthday ?? undefined}
                      >
                        {option.birthday}
                      </span>
                      <Identifier muted>{option.id}</Identifier>
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
