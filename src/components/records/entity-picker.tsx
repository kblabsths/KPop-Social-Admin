"use client";

import { useId, useReducer, useRef, useState } from "react";
import {
  EditStatus,
  IDLE_EDIT_STATE,
  reduceEdit,
  type EditState,
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
 * **A write in flight owns the widget** (campaign admin-window/BUG-0097). One
 * field takes one override at a time: while a choice is saving, every OPTION
 * is disabled — they are the controls that start a write — and no answer to a
 * superseded write may overwrite a newer statement. That is the same rule the
 * click-to-edit cell carries (`reduceEdit`, admin-window/BUG-0069/0075), and
 * `reducePick` below delegates the status half to it rather than restating it.
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

/**
 * What the picker's line is saying, and WHICH choice put it there — campaign
 * admin-window/BUG-0097.
 *
 * It is the click-to-edit cell's `EditState` with the one extra thing this
 * widget displays: the row the field points at. The status half is not
 * re-derived here — `reduceEdit` decides it, so "a status is only ever
 * replaced or retired by the edit that produced it, or by a later one"
 * (admin-window/BUG-0075) has exactly one implementation in this app and the
 * two widgets cannot drift apart.
 */
export interface PickState extends EditState {
  /** The row the resting line links to, set only by an answered write. */
  readonly chosen: PickerOption | null;
}

/** Nothing chosen, nothing said, and no choice owning a statement. */
export const IDLE_PICK_STATE: PickState = { ...IDLE_EDIT_STATE, chosen: null };

/**
 * What happens to the picker. Every event names the CHOICE it belongs to,
 * because "which choice is this answer about" is what the defect could not
 * answer: two overrides for one field were in the air and the display went to
 * whichever PostgREST answered last, not to what was last decided.
 */
export type PickEvent =
  /** The operator chose `option`; `edit` is the ordinal of this choice. */
  | { kind: "choosing"; edit: number; option: PickerOption }
  /** That choice's write answered. */
  | { kind: "settled"; edit: number; option: PickerOption; outcome: SaveOutcome }
  /** The operator reopened the picker, acknowledging the last statement. */
  | { kind: "cleared" };

/**
 * The rule: a write in flight owns the widget until its own answer arrives.
 *
 * Pure and total over (state, event); a stale event returns the state
 * unchanged BY REFERENCE, so `useReducer` bails out rather than re-rendering
 * under a running write.
 *
 *  - `choosing` while a write is in flight is **not a choice**. This is the
 *    guard that has to live in the reducer rather than in the click handler:
 *    two clicks inside one commit window read the SAME rendered closure, so a
 *    handler-local check sees `idle` twice, while the reducer sees the state
 *    the first click already produced.
 *  - `settled` answers only the choice still on screen. A superseded write's
 *    answer — success or refusal — never overwrites a newer statement, and
 *    never moves the line to the row a stale write happened to carry.
 *  - `cleared` acknowledges a spent confirmation or refusal and says nothing
 *    over a write still running.
 */
export function reducePick(state: PickState, event: PickEvent): PickState {
  switch (event.kind) {
    case "choosing": {
      const next = reduceEdit(state, { kind: "committed", edit: event.edit });
      if (state.status.kind === "saving" || next === state) return state;
      return { ...next, chosen: state.chosen };
    }
    case "settled": {
      const next = reduceEdit(state, {
        kind: "settled",
        edit: event.edit,
        outcome: event.outcome,
      });
      if (next === state) return state;
      // The line moves only on this choice's OWN successful answer; a refusal
      // leaves it pointing where it pointed (there was no change to show).
      return {
        ...next,
        chosen: event.outcome.ok ? event.option : state.chosen,
      };
    }
    case "cleared": {
      if (state.status.kind === "idle") return state;
      const next = reduceEdit(state, { kind: "editing", edit: state.edit });
      if (next === state) return state;
      return { ...next, chosen: state.chosen };
    }
    default:
      return state;
  }
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
  busy = false,
  onChoose,
}: {
  options: readonly PickerOption[];
  /** The id this field already points at, so the list can say which it is. */
  current: string | null;
  /**
   * A write for this field is in flight, so no option may start another —
   * campaign admin-window/BUG-0097. The rows stay DRAWN and readable (the
   * operator keeps the list they were choosing from, and the panel does not
   * jump mid-write); they simply cannot act. Same rule, same spelling, as the
   * click-to-edit cell's `disabled={status.kind === "saving"}`.
   */
  busy?: boolean;
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
            disabled={busy}
            className={cx(
              OPTION_CLASS,
              option.id === current && "bg-chrome",
              busy && "cursor-not-allowed opacity-50",
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
        // No floor to name, and that is a fact of this read: the choices are
        // the first N rows BY NAME, so the window's bottom row is the one
        // latest in the alphabet and never its oldest. A window that did not
        // fill still says it holds every choice the read found
        // (admin-window/BUG-0109).
        // Unnarrowed: the read is the first N rows of the table by name, and
        // the search box below filters what is DRAWN from that window rather
        // than what was read — the line follows the read
        // (admin-window/BUG-0114).
        window={{ ...info, oldest: null, scope: null }}
        shows={{ of: "alphabetical", rows: info.domain }}
      />
      {matches.length === 0 ? (
        <Empty
          holds={`${info.domain} matching that search`}
          filledBy={noMatchWords(info.domain)}
        />
      ) : (
        <PickerOptions
          options={matches}
          current={current}
          busy={status.kind === "saving"}
          onChoose={onChoose}
        />
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
  const [pick, dispatch] = useReducer(reducePick, undefined, () => ({
    ...IDLE_PICK_STATE,
    chosen:
      reference === null ? null : { id: reference.id, name: reference.name },
  }));
  /** Ordinals handed out one per choice; see `PickState.edit`. */
  const picks = useRef(0);
  /**
   * Whether a write for this field is in the air — campaign
   * admin-window/BUG-0097.
   *
   * A ref rather than the reducer's own status because this gate has to hold
   * WITHIN a tick: two clicks landing before React re-renders both read the
   * same `pick`, so a check against that snapshot would let both through and
   * two `override` decisions would be recorded for one intent. A ref is
   * written synchronously, so the second click sees the first one's write.
   * The reducer's epoch is the other half — it decides whose ANSWER counts.
   */
  const inFlight = useRef(false);
  const status = pick.status;
  const chosen = pick.chosen;

  async function choose(optionId: string) {
    // Only a row the read returned may be sent, whatever produced the id.
    const option = optionFor(info.options, optionId);
    if (option === null) return;
    // A choice while a choice is still saving is not a second write. The
    // options are `disabled` for the whole of it, so this is the door behind
    // the door: a stale click already in the air, or a hand-called handler.
    if (inFlight.current) return;
    inFlight.current = true;

    picks.current += 1;
    const edit = picks.current;
    dispatch({ kind: "choosing", edit, option });

    let outcome: SaveOutcome;
    try {
      outcome = await submitReferenceEdit(table, id, field, option.id, fetch);
    } catch (thrown) {
      outcome = {
        ok: false,
        message: thrown instanceof Error ? thrown.message : String(thrown),
      };
    }

    inFlight.current = false;
    if (outcome.ok) {
      setOpen(false);
      setQuery("");
    }
    // Success moves the line to this option and failure keeps the route's own
    // refusal, unchanged, over the list the operator was choosing from
    // (LOOK_AND_FEEL state 4) — but only if this choice is still the one on
    // screen. A superseded write's answer changes nothing.
    dispatch({ kind: "settled", edit, option, outcome });
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
            dispatch({ kind: "cleared" });
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
