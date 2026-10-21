"use client";

import type { ChangeEvent } from "react";

/**
 * One filter, as a dropdown — campaign admin-window, Ben 2026-10-21.
 *
 * It replaces a chip ROW. The chips were right about the state (every filter
 * is in the URL, bookmarkable, survives Back) and wrong about the shape: a
 * facet with eight values drew eight controls, four facets drew four rows of
 * them, and the Queues page spent a third of its height on filters that were
 * mostly not set. Ben's ruling: *"the shape filter should be replaced with a
 * filter dropdown (on tabs that find it useful) which is empty by default, and
 * empty means show all."*
 *
 * **Every option carries a whole href, and the server wrote it.** That is the
 * one design decision here and it is deliberate: this component composes no
 * URL, knows no parameter name and drops no facet, so the dropdown cannot come
 * to disagree with the chips, the window line or the query about what a
 * narrowing means. It is the same `facetChips` vocabulary the chip rows were
 * built from, rendered as one control instead of N — which is why there is no
 * `onChange` handler anywhere that edits a search param by hand.
 *
 * Why a client component at all: a `<select>` is not a link, and a filter is a
 * NAVIGATION (the read changes, so the server must re-render — unlike a page
 * move, which this app answers from a route handler). So the change event
 * follows the option's own address. With no JavaScript the control renders and
 * selects but does not navigate; the chip rows it replaces were real links and
 * this is the one thing lost, which is why a surface that must work without
 * scripting keeps its chips.
 *
 * `all` is the EMPTY option, first and selected when no value is set — "empty
 * means show all", in Ben's words. It is the app's own word for "no
 * narrowing", so it is sans; the values under it are the database's and are
 * mono (`ui/Chip`'s `face`, the same split).
 */
export function FilterSelect({
  facet,
  options,
  value,
  emptyLabel = "all",
}: {
  /**
   * The parameter this filter sets, which is also its visible label and its
   * accessible name. A machine identifier, rendered verbatim — never
   * prettified into Title Case prose (Voice bar 5).
   */
  facet: string;
  /** Every choice, each carrying the whole address that selects it. */
  options: readonly { label: string; value: string; href: string }[];
  /** The value in force, or `""` where the URL names none. */
  value: string;
  /** What the no-narrowing choice is called. The app's own word. */
  emptyLabel?: string;
}) {
  const follow = (event: ChangeEvent<HTMLSelectElement>): void => {
    const chosen = options.find((option) => option.value === event.target.value);
    if (chosen === undefined) return;
    globalThis.location?.assign(chosen.href);
  };

  return (
    <span className="flex items-baseline gap-1.5">
      <label
        htmlFor={`filter-${facet}`}
        data-filter-label={facet}
        className="type-data text-ink-secondary"
      >
        {facet}
      </label>
      <select
        id={`filter-${facet}`}
        data-filter={facet}
        value={value}
        onChange={follow}
        className="type-body rounded-control border border-hairline bg-chrome px-2 py-0.5 text-ink"
      >
        <option value="">{emptyLabel}</option>
        {options
          .filter((option) => option.value !== "")
          .map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
      </select>
    </span>
  );
}

/**
 * The filter row: every configured filter for a surface, above its table and
 * to the RIGHT (Ben: "the filter UI should appear to the top right above the
 * table"), and NOTHING AT ALL where a surface configures none — "if there are
 * no configured filters, then this should be hidden", which means no element,
 * not an empty row that still takes a gap.
 */
export function FilterRow({
  filters,
}: {
  filters: readonly {
    facet: string;
    value: string;
    options: readonly { label: string; value: string; href: string }[];
  }[];
}) {
  if (filters.length === 0) return null;
  return (
    <div data-filter-row="" className="flex flex-wrap items-baseline justify-end gap-4">
      {filters.map((filter) => (
        <FilterSelect
          key={filter.facet}
          facet={filter.facet}
          value={filter.value}
          options={filter.options}
        />
      ))}
    </div>
  );
}
