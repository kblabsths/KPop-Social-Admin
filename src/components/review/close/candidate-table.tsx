"use client";

import { Identifier } from "@/components/ui";
import { cx } from "@/components/ui/cx";
import type { PickerOption } from "@/components/records/entity-picker";

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
              {["", "name", "which one", "record"].map((head, index) => (
                <th
                  key={head === "" ? `blank-${index}` : head}
                  scope="col"
                  className="type-micro px-2 py-1.5 text-ink-secondary"
                >
                  {head}
                </th>
              ))}
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
                    ONE button, spanning the row's content, so the whole row is
                    the control. It carries `aria-pressed` rather than
                    `aria-current`: this is a selection the operator toggles,
                    not the page they are on.
                  */}
                  <td colSpan={4} className="p-0">
                    <button
                      type="button"
                      onClick={() => onChoose(option.id)}
                      disabled={disabled}
                      aria-pressed={selected}
                      className={cx(
                        "grid w-full grid-cols-[auto_1fr_2fr_auto] items-center gap-2 px-2 py-1.5 text-left",
                        disabled && "cursor-not-allowed opacity-50",
                      )}
                    >
                      {/* A face where the catalog holds one. Fixed box either
                          way, so a row without a picture is the same height as
                          a row with one and the table does not jump. */}
                      <span className="flex size-6 items-center justify-center">
                        {option.imageUrl === null ||
                        option.imageUrl === undefined ? null : (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={option.imageUrl}
                            alt=""
                            loading="lazy"
                            width={24}
                            height={24}
                            className="size-6 rounded-control object-cover"
                          />
                        )}
                      </span>
                      <span className="type-body text-ink">{option.name}</span>
                      <span className="type-body text-ink-secondary">
                        {option.detail}
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
