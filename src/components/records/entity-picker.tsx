"use client";

import { useId, useState } from "react";
import {
  EditStatus,
  type SaveOutcome,
  type Status,
} from "@/components/EditableCell";
import { IN_PAGE_LINK } from "@/components/cycles/links";
import { cx } from "@/components/ui/cx";
import { Empty } from "@/components/ui/empty";
import { WindowLine, type WindowObject } from "@/components/ui/window-line";
import { orDash } from "@/lib/format";
import { recordHref } from "@/lib/records/routes";
import { submitReferenceEdit } from "./submit";

/**
 * The entity picker: how a `kind: reference` field is edited — campaign
 * admin-window/TASK-0055, SPEC F12, spec §8 ("the widget follows the field's
 * kind": a scalar column edits as a cell, a reference as an entity picker).
 *
 * **It links a row; it never writes text.** The choice is submitted as the
 * chosen entity's own id in the decision's `ref` slot, and the settlement
 * function writes the confirmed match before applying — so the apply produces
 * a `venue_id` row link rather than a string in a column (ARCHITECTURE.md
 * §9.2). Nothing here can submit what the operator typed: the search box
 * FILTERS the rows the read returned and is not a value, and the only control
 * that submits anything is a button carrying one of those rows' ids.
 *
 * **It offers only rows that exist, and creates nothing.** There is no
 * "add a venue" control, no free-text fallback and no insert anywhere behind
 * it — entity creation is the resolver's, not Admin's (spec §8, AGENTS.md).
 *
 * **It is not a door** (SPEC F12's second hard limit). It renders only on a
 * reference field of a record page that is already open; it is not a nav item,
 * not a Browse view and not a global search box.
 *
 * **Absent the settlement function it does not render at all.** The page asks
 * the one seam whether the override path is open and draws no picker when it
 * is not — no disabled control, and never a button toward a write path that
 * does not exist. That is the graded normal case of this milestone, and it is
 * the read-only reference line M1 already shipped (`fields.ts`, FEAT-0011).
 *
 * ## What is a pure unit here, and why
 *
 * `tests/offline` is environment node with `renderToStaticMarkup` and no jsdom
 * (STACK.md §4), so a state this component reaches only from a click is a
 * state no offline test can render. The panel, its list and the match rule are
 * therefore exported units over plain props — the same answer `EditField` and
 * `EditStatus` give for the click-to-edit cell — and the stateful shell below
 * holds nothing but the query, the panel's open flag and the save status.
 */

/** One row the picker may choose. `lib/db/records.ts`'s option satisfies it. */
export interface PickerOption {
  /** The entity's own id — what travels in the decision's `ref`. */
  readonly id: string;
  /** Its readable name, or `null` when the row holds none. */
  readonly name: string | null;
}

/**
 * The window the picker chooses from — its rows and the facts of the read that
 * produced them (ARCHITECTURE.md §4.3, read kind 2).
 *
 * Declared here rather than imported from `lib/db/records.ts` for the reason
 * `window-line.tsx` declares `WindowObject`: a component imports nothing that
 * can reach a database, and `lib/db` is not a leaf (§4). `ReferenceWindow`
 * satisfies this structurally, so the page hands one straight over.
 */
export interface PickerWindow {
  readonly options: readonly PickerOption[];
  readonly limit: number;
  readonly held: number;
  readonly truncated: boolean;
  readonly over: WindowObject;
  /** What is being chosen, spelled as the map keys the table: `venues`. */
  readonly domain: string;
}

/**
 * The rows of the window that match what the operator typed.
 *
 * A FILTER over rows already read, never a query: the picker offers what the
 * search read returned and nothing else, so a name nobody has heard of matches
 * nothing and stays unmatched. The alternative — sending the typed text — is
 * exactly the write §8 exists to prevent.
 *
 * It matches on the NAME and on the ID, because both are on screen and an
 * operator who pasted a uuid out of a query is searching with it. Blank (or
 * whitespace-only) matches everything: that is the window as read, which is
 * what the line above the list describes.
 */
export function matchOptions(
  options: readonly PickerOption[],
  query: string,
): readonly PickerOption[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return options;
  return options.filter(
    (option) =>
      (option.name !== null && option.name.toLowerCase().includes(needle)) ||
      option.id.toLowerCase().includes(needle),
  );
}

/**
 * The option with this id, or `null` — the guard that makes "only rows that
 * exist" true of the SUBMISSION and not only of the list.
 *
 * Every path that submits goes through it, so an id that is not in the window
 * cannot be sent however it was produced: a stale click, a re-render between
 * two reads, or a console call on the handler all land here.
 */
export function optionFor(
  options: readonly PickerOption[],
  id: string,
): PickerOption | null {
  return options.find((option) => option.id === id) ?? null;
}

/**
 * What fills an empty result — the app's words for the one thing that would
 * put a row in this list (LOOK_AND_FEEL state 2, LESSONS 1).
 *
 * It says where the rows come from rather than inviting one to be made: the
 * picker creates nothing, so "add it" is advice this surface cannot honour.
 */
export function noMatchWords(domain: string): string {
  return (
    `The picker offers the ${domain} the search read returned, and creates ` +
    `none: a row arrives when the resolver applies one. Clear the search to ` +
    `see the window again.`
  );
}

/** How the operator ends a choice, said where they are about to make one. */
const PICKER_HINT =
  "Choosing a row records the change and closes the picker. Escape cancels.";

/** The `data-window` hook this surface publishes, one per referenced table. */
export function pickerWindowName(domain: string): string {
  return `${domain}_choices`;
}

const SEARCH_CLASS =
  "type-data block w-full rounded-control border border-accent bg-surface px-1 py-0.5 text-ink";

const OPTION_CLASS =
  "type-body block w-full rounded-control px-1 py-0.5 text-left text-ink transition-colors hover:bg-chrome";

/**
 * The list of choices, or the labelled emptiness where there are none.
 *
 * Every row that comes back is offered, INCLUDING one whose name is null: the
 * row exists and can be linked, and its label is the app's own absence marker
 * with no qualifier beside it (LESSONS 1 — a dash is never annotated, and a
 * nameless row is never dropped). The id stands beside the name in mono
 * either way, because it is the machine's word for the row and it is what
 * actually travels.
 */
export function PickerOptions({
  options,
  current,
  onChoose,
}: {
  options: readonly PickerOption[];
  /** The id this field already points at, so the list can say which it is. */
  current: string | null;
  onChoose: (id: string) => void;
}) {
  if (options.length === 0) return null;
  return (
    <ul className="max-h-64 overflow-y-auto">
      {options.map((option) => (
        <li key={option.id}>
          <button
            type="button"
            onClick={() => onChoose(option.id)}
            aria-current={option.id === current ? "true" : undefined}
            className={cx(
              OPTION_CLASS,
              option.id === current && "bg-chrome",
            )}
          >
            {orDash(option.name)}{" "}
            <span className="type-data text-ink-secondary">{option.id}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * The open picker: the search box, the window it is searching, the rows, and
 * how the choice ends.
 *
 * Pure over its props, so the offline suite renders every state of it — a
 * filled list, an empty result, a refusal — with no browser at all.
 *
 * The window line is rendered from the one primitive every windowed surface in
 * this app uses (`WindowLine`), so the picker states which window it is
 * showing and cannot make an exactness claim about the whole table
 * (ARCHITECTURE.md §4.3, quality bar 13). It stands with the LIST, because the
 * list is what it describes.
 */
export function PickerPanel({
  window: info,
  query,
  current,
  status,
  onQuery,
  onChoose,
}: {
  window: PickerWindow;
  query: string;
  current: string | null;
  status: Status;
  onQuery: (next: string) => void;
  onChoose: (id: string) => void;
}) {
  const hintId = useId();
  const matches = matchOptions(info.options, query);
  return (
    <div className="mt-1 flex w-max min-w-full flex-col gap-2 rounded-control border border-hairline bg-surface p-2">
      <input
        type="search"
        value={query}
        onChange={(event) => onQuery(event.target.value)}
        aria-label={`Search ${info.domain} by name`}
        aria-describedby={hintId}
        className={SEARCH_CLASS}
      />
      <WindowLine
        gauge={pickerWindowName(info.domain)}
        window={info}
        shows={{ of: "alphabetical", rows: info.domain }}
      />
      {matches.length === 0 ? (
        <Empty
          holds={`${info.domain} matching that search`}
          filledBy={noMatchWords(info.domain)}
        />
      ) : (
        <PickerOptions options={matches} current={current} onChoose={onChoose} />
      )}
      <p id={hintId} className="type-body text-ink-secondary">
        {PICKER_HINT}
      </p>
      <EditStatus status={status} />
    </div>
  );
}

/**
 * The reference line at rest: what it points at now, and the way to change it.
 *
 * The link is the same anchor the read-only reference line draws — a route out
 * is what the operator came for, and it stays whether or not the picker is
 * open (admin-window/BUG-0034). An empty reference renders the app's absence
 * and still offers the control: a field with no value is exactly the one an
 * operator most needs to be able to fill in.
 *
 * "The same anchor" is now literal, and has to be: this component draws the
 * reference line whenever the choices read answered, and `RecordFields`'
 * `ReferenceValue` draws it when it did not, so a reader who cannot tell the
 * two apart must never be shown a difference. Both spell the anchor with
 * `IN_PAGE_LINK` and both put the label in the machine's face
 * (admin-window/BUG-0099).
 */
export function PickerValue({
  id,
  name,
  domain,
}: {
  id: string | null;
  name: string | null;
  domain: string;
}) {
  const href = recordHref(domain, id);
  if (id === null || href === null) return <>{orDash(null)}</>;
  return (
    <span className="flex flex-wrap items-baseline gap-2">
      <a href={href} className={`type-data ${IN_PAGE_LINK}`}>
        {name ?? id}
      </a>
      {name === null ? null : (
        <span className="type-data text-ink-secondary">{id}</span>
      )}
    </span>
  );
}

/**
 * The picker, wired to the record write route.
 *
 * The panel is drawn IN the row's flow rather than floated over it, unlike the
 * click-to-edit cell's field (admin-window/BUG-0086): `DataTable` wraps its
 * table in `overflow-x-auto`, and a box whose other axis is `visible` computes
 * to `auto` and clips — so a panel this tall, floated below the reference
 * line, would be cut off exactly where its list is. The reference line is
 * drawn LAST on this surface (`mappedColumns` orders pk, then editable, then
 * display), so opening it moves no other control on the page; a second
 * reference column arriving above other lines is what would make the choice
 * worth revisiting.
 *
 * The route knowledge is `submitReferenceEdit`'s, in the widget's own
 * directory, exactly as the cell's is (`field-editor.tsx`): this component
 * decides what was chosen, and that module decides how it is sent.
 */
export function EntityPicker({
  table,
  id,
  field,
  window: info,
  reference,
}: {
  /** The record's table — `events`. */
  table: string;
  /** The record's primary-key value: the write route's path segment. */
  id: string;
  /** The COLUMN this line draws, which is what the route is told: `venue_id`. */
  field: string;
  /** The rows this field may be pointed at, and the read that produced them. */
  window: PickerWindow;
  /** What the field points at now: the linked id and its name, if any. */
  reference: { id: string; name: string | null } | null;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [chosen, setChosen] = useState<PickerOption | null>(
    reference === null ? null : { id: reference.id, name: reference.name },
  );

  async function choose(optionId: string) {
    // Only a row the read returned may be sent, whatever produced the id.
    const option = optionFor(info.options, optionId);
    if (option === null) return;
    setStatus({ kind: "saving" });

    let outcome: SaveOutcome;
    try {
      outcome = await submitReferenceEdit(table, id, field, option.id, fetch);
    } catch (thrown) {
      outcome = {
        ok: false,
        message: thrown instanceof Error ? thrown.message : String(thrown),
      };
    }

    if (outcome.ok) {
      setChosen(option);
      setOpen(false);
      setQuery("");
      setStatus({ kind: "saved" });
    } else {
      // The route's own refusal, unchanged, and the panel stays open over the
      // list the operator was choosing from (LOOK_AND_FEEL state 4).
      setStatus({ kind: "failed", message: outcome.message });
    }
  }

  return (
    // The widget this line drew, named so a test and a live oracle can ask
    // WHICH control a field offers rather than counting elements — the
    // distinction this ticket is about is picker versus cell, and both are
    // "a control" to anything that only counts (ARCHITECTURE §10).
    <div data-widget="picker">
      <div className="flex flex-wrap items-baseline gap-2">
        <PickerValue
          id={chosen?.id ?? null}
          name={chosen?.name ?? null}
          domain={info.domain}
        />
        <button
          type="button"
          onClick={() => {
            setStatus({ kind: "idle" });
            setOpen((was) => !was);
          }}
          aria-expanded={open}
          disabled={status.kind === "saving"}
          className={cx(
            "type-body rounded-control border border-hairline px-2 py-0.5 text-ink transition-colors hover:bg-chrome",
            status.kind === "saving" && "cursor-not-allowed opacity-50",
          )}
        >
          Choose {info.domain}
        </button>
        {open ? null : <EditStatus status={status} />}
      </div>
      {open ? (
        <div
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            setOpen(false);
            setQuery("");
          }}
        >
          <PickerPanel
            window={info}
            query={query}
            current={chosen?.id ?? null}
            status={status}
            onQuery={setQuery}
            onChoose={(optionId) => void choose(optionId)}
          />
        </div>
      ) : null}
    </div>
  );
}
