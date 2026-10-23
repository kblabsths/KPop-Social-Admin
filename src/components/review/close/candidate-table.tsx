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
const GRID = "grid-cols-[6rem_1fr_1fr_1fr_6rem_auto]";
/** The picture's column, held to one width in the header and in every row. */
const FACE_WIDTH = "w-14";

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
        <table className="w-full border-collapse text-left" aria-label={label}>
          <thead>
            <tr className="bg-chrome">
              {/* The picture's column: blank, and exactly as wide as the cell
                  below it. */}
              <th scope="col" className={cx(FACE_WIDTH, "px-2 py-1.5")} />
              {/* The other six, in the row's own grid so each label sits over
                  its values. LEFT-ALIGNED, here and in the rows — Ben asked for
                  it everywhere and there is no numeric column to right-align. */}
              <th scope="col" colSpan={2} className="p-0">
                <span
                  className={cx(
                    "type-micro grid items-center gap-2 px-2 py-1.5 text-left text-ink-secondary",
                    GRID,
                  )}
                >
                  {COLUMNS.map((head) => (
                    <span key={head}>{head}</span>
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
                  <td className={cx(FACE_WIDTH, "p-0 pl-2 align-middle")}>
                    {option.imageUrl === null || option.imageUrl === undefined ? (
                      // A fixed box either way, so a row without a picture is
                      // the same height as one with it.
                      <span className="block size-12" />
                    ) : (
                      <CandidateImage url={option.imageUrl} name={option.name} />
                    )}
                  </td>
                  <td colSpan={2} className="p-0">
                    <button
                      type="button"
                      onClick={() => onChoose(option.id)}
                      disabled={disabled}
                      aria-pressed={selected}
                      className={cx(
                        "grid w-full items-center gap-2 px-2 py-1.5 text-left",
                        GRID,
                        disabled && "cursor-not-allowed opacity-50",
                      )}
                    >
                      <span className="type-body text-ink">{option.name}</span>
                      <span className="type-body text-ink-secondary">
                        {option.group}
                      </span>
                      <span className="type-body text-ink-secondary">
                        {option.agency}
                      </span>
                      <span className="type-body text-ink-secondary">
                        {option.fullName}
                      </span>
                      <span className="type-body text-ink-secondary">
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
