"use client";

import { useEffect, useId, useReducer, useRef, useState, type Ref } from "react";
import {
  EditStatus,
  IDLE_EDIT_STATE,
  armConfirmationClock,
  armRetire,
  domRetireHost,
  focusIsAdrift,
  reduceEdit,
  takeRefusalSlot,
  type EditState,
  type RetireMove,
  type SaveOutcome,
  type Status,
} from "@/components/EditableCell";
import { IN_PAGE_LINK } from "@/components/cycles/links";
import { cx } from "@/components/ui/cx";
import { Empty } from "@/components/ui/empty";
import { Identifier } from "@/components/ui/identifier";
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
  /** The confirmation clock ARMED BY `edit` fired — admin-window/BUG-0111. */
  | { kind: "elapsed"; edit: number }
  /**
   * The operator ended `edit` without choosing again — a press outside the
   * widget, focus landing elsewhere, Escape from wherever focus is, or a
   * refusal elsewhere on the page taking its one slot (campaign
   * admin-window/BUG-0107, wired to this widget by admin-window/BUG-0119).
   * The MOVE travels with the event, so what each one means is
   * `retiresRefusal`'s one answer rather than a condition per listener.
   */
  | { kind: "abandoned"; edit: number; move: RetireMove }
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
 *  - `elapsed` and `abandoned` are `reduceEdit`'s two retirements, delegated
 *    whole (campaign admin-window/BUG-0111): a confirmation goes on the app's
 *    one clock, a refusal goes on none and ends when the operator does, and
 *    both are checked against the ordinal that owns the statement. Neither
 *    un-links the row a successful write chose.
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
    case "elapsed": {
      // A spent confirmation, and only that: `reduceEdit` re-checks whose
      // clock this was, so a straggler cannot retire a newer statement and no
      // clock ever touches a refusal or a write in flight.
      const next = reduceEdit(state, { kind: "elapsed", edit: event.edit });
      if (next === state) return state;
      // The row the write actually linked stays linked: what retires is the
      // WORD beside the field, never the value it confirmed.
      return { ...next, chosen: state.chosen };
    }
    case "abandoned": {
      const next = reduceEdit(state, {
        kind: "abandoned",
        edit: event.edit,
        move: event.move,
      });
      if (next === state) return state;
      return { ...next, chosen: state.chosen };
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

/**
 * Does this move CLOSE the panel? — campaign admin-window/DEBT-0013.
 *
 * Escape, and nothing else. The picker's Escape handler used to be the open
 * panel's `onKeyDown`, so the key worked only while focus was still inside the
 * panel — while `PICKER_HINT` promises "Escape cancels" without qualification,
 * and while the page-wide rule armed by admin-window/BUG-0119 heard the SAME
 * key from anywhere and retired the refusal with it. One sentence, one key, two
 * outcomes depending on where focus happened to be. Escape now reaches the
 * panel through the same page-wide listeners the refusal rule uses, so it means
 * the one thing wherever focus is.
 *
 * The other moves are `false` on purpose, and that is BUG-0119's ruling
 * restated as code rather than as a comment: **a retirement does not close the
 * panel on its own.** An unrelated cell's refusal taking the page's one slot
 * (`superseded`), a press somewhere else, or focus landing elsewhere retires
 * the SENTENCE beside the field; shutting the list the operator is reading —
 * and losing their search — is not what any of those means.
 *
 * Pure and exported for the reason `retiresRefusal` is: a press, a Tab and a
 * keystroke are browser facts, and `tests/offline` is environment node with no
 * jsdom (STACK.md §4). It takes `RetireMove` rather than a key string because
 * the moves reaching it are `armRetire`'s — the picker adds no listener of its
 * own (admin-window/BUG-0119) and no second vocabulary of moves.
 */
export function closesPanel(move: RetireMove): boolean {
  return move.kind === "escape";
}

/**
 * What to do about focus right now — the picker's half of `focusVerdict`
 * (campaign admin-window/DEBT-0013).
 */
export type PickerFocus =
  /** Not yet: the control this would aim at is disabled and cannot take it. */
  | "wait"
  /** Put it in the panel's search field — where the operator acts. */
  | "search"
  /** Put it back on the Choose button, the control the panel opened from. */
  | "toggle"
  /** Nothing to do: it is where it belongs, or where the operator put it. */
  | "leave";

/**
 * Where focus belongs as the picker opens, saves and closes — campaign
 * admin-window/DEBT-0013.
 *
 * **The measurement**: `grep -c '\.focus()'` was 2 in `EditableCell.tsx` and
 * **0** here. The picker opened a panel without focusing it (so a keyboard
 * operator reached the search box only by tabbing through the whole reference
 * line), disabled the option they had just activated while the write ran (so
 * the browser dropped focus to `<body>` mid-edit), and closed the panel
 * without giving focus back (so the next Tab restarted at the top of the
 * document). LOOK_AND_FEEL bar 9 and the cell's own contract at `focusVerdict`
 * — "an edit the operator ends with Enter or Escape puts focus back on that
 * button" — are one rule, and this is the picker keeping it.
 *
 * Three orderings are the whole of it:
 *
 *  - **Opening focuses the panel, unconditionally.** The only way `open` turns
 *    true is the Choose button, so focus is on that button and moving it into
 *    the search field is following the operator, never stealing from them.
 *    Acting on the TRANSITION rather than on `open` is what keeps this from
 *    being a focus trap: an operator who deliberately shift-tabs back to the
 *    Choose button with the panel open is not bounced forward again.
 *  - **`saving` waits, exactly as the cell's rule does.** Both the options and
 *    the Choose button are `disabled` while a write is in flight
 *    (admin-window/BUG-0097), and a disabled control cannot hold focus —
 *    aiming at one is a no-op that leaves focus on `<body>` anyway. So a panel
 *    closed mid-flight (Escape does not cancel a PATCH) takes its verdict
 *    again when the answer arrives and the button is real; and while the panel
 *    is OPEN and saving, the search field is the widget's one control still
 *    able to hold focus, which is where the activated option's focus goes.
 *    That keeps focus inside the widget's own box, so the move cannot read as
 *    the operator walking away from a refusal (`retiresRefusal`).
 *  - **Anything the operator has since focused is left alone.** `adrift` is
 *    the caller's reading of `document.activeElement` (`focusIsAdrift`, the
 *    cell's own), true only when focus is on nothing at all — so a seconds-long
 *    write the operator walks away from mid-flight never has its focus yanked
 *    back when the answer lands.
 *
 * Pure and exported because focus is a browser fact the offline tier cannot
 * see (`tests/offline` is environment node with no jsdom, STACK.md §4): the
 * decision is pinned here and the `.focus()` itself is measured in a walk,
 * exactly as `focusVerdict`'s is.
 */
export function pickerFocus({
  open,
  was,
  status,
  adrift,
}: {
  /** Is the panel drawn now? */
  open: boolean;
  /** Was it drawn when focus was last settled — so is this a transition? */
  was: boolean;
  /** What this field's choice is doing, or did. */
  status: Status;
  /** Is focus on nothing the operator chose? Read from `document`. */
  adrift: boolean;
}): PickerFocus {
  if (open !== was) {
    if (open) return "search";
    if (status.kind === "saving") return "wait";
    return adrift ? "toggle" : "leave";
  }
  // No transition, so the only thing that moves focus is a control going away
  // under the operator's hands: the option they activated, going `disabled`.
  if (open && status.kind === "saving") return adrift ? "search" : "leave";
  return "leave";
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
            <Identifier muted>{option.id}</Identifier>
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
  searchRef,
  onQuery,
  onChoose,
}: {
  window: PickerWindow;
  query: string;
  current: string | null;
  status: Status;
  /**
   * The search field, handed back to the shell so `pickerFocus` can aim at it
   * — the panel opens focused here, and this is also the one control of the
   * widget still able to hold focus while a write is in flight
   * (admin-window/DEBT-0013). Optional, so every state of this panel still
   * renders from plain props with no browser at all.
   */
  searchRef?: Ref<HTMLInputElement>;
  onQuery: (next: string) => void;
  onChoose: (id: string) => void;
}) {
  const hintId = useId();
  const matches = matchOptions(info.options, query);
  return (
    <div className="mt-1 flex w-max min-w-full flex-col gap-2 rounded-control border border-hairline bg-surface p-2">
      <input
        ref={searchRef}
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
        <Identifier muted>{id}</Identifier>
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
  /** The whole widget's box: what "inside" means to the retire rule below. */
  const root = useRef<HTMLDivElement | null>(null);
  /** The control the panel opens from, and the one focus comes back to. */
  const toggle = useRef<HTMLButtonElement | null>(null);
  /** The panel's search field: where focus goes in, and where it waits out a
   * write that disabled every option (campaign admin-window/DEBT-0013). */
  const search = useRef<HTMLInputElement | null>(null);
  /**
   * Whether the panel was open when focus was last settled, so `pickerFocus`
   * can act on the TRANSITION rather than on the flag — see its third
   * ordering. A ref rather than state: it records what this widget has already
   * DONE about focus, and nothing renders from it.
   */
  const focusedFor = useRef(false);
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

  /**
   * The confirmation's clock — the click-to-edit cell's, not a second one
   * (campaign admin-window/BUG-0111).
   *
   * The picker rendered the same `EditStatus` from the same `Status` and armed
   * nothing, so a successful override's green word stood until this picker was
   * reopened while the cell a few rows above retired its own after 1.5s — one
   * status renderer, two lifetimes. `armConfirmationClock` is the cell's own
   * arming rule and the one place `CONFIRMATION_MS` is read, so the two
   * widgets cannot drift; keying the effect on the state OBJECT is what makes
   * it a function of the STATE rather than of the click handler, so a
   * confirmation reached by any path retires, and React tears the timeout down
   * on every real transition and on unmount.
   */
  useEffect(() => armConfirmationClock(pick, dispatch), [pick]);

  /**
   * A refused choice ends when the operator does — the cell's page-wide rule,
   * reaching this widget (campaign admin-window/BUG-0119).
   *
   * The clock came over with admin-window/BUG-0111; BUG-0107's other half did
   * not. The picker's only Escape handler was the OPEN panel's `onKeyDown`, so
   * it heard the key only while focus was still inside the panel — and a
   * refusal left the panel open with focus wherever the operator put it. Every
   * other move they make (a press anywhere else, a Tab, an Escape from
   * outside) reached no handler of this widget's at all, so the red line stood
   * until this same picker was toggled open again; and because the widget
   * never took the page's one refusal slot, its refusal could stand stacked
   * with a cell's. (That `onKeyDown` is gone: admin-window/DEBT-0013 put the
   * panel's own Escape on these same page-wide listeners, so the key now
   * means one thing wherever focus is — `closesPanel`.)
   *
   * So the arming is `armRetire`'s over `domRetireHost` — the cell's own three
   * page-wide listeners and its one DOM adapter, not a second copy — and
   * `takeRefusalSlot` is the page-level half: at most ONE refusal on screen at
   * any moment, whichever widget put it there (BUG-0107 criterion 2). Armed
   * only while a refusal is showing, so a picker at rest adds no listener at
   * all; what each move MEANS is `retiresRefusal`'s single answer, so a move
   * that reaches a `saving` or a `saved` is a no-op rather than a listener
   * that had to remember not to fire.
   *
   * **A retirement does not close the panel** — the decision this ticket
   * carried, stated plainly, and now `closesPanel`'s answer rather than a
   * sentence here. The panel is where the operator is working: it opens on the
   * Choose button, closes on that button, on a choice that lands, and on
   * Escape (`PICKER_HINT` says so, and since admin-window/DEBT-0013 that is
   * true from wherever focus is), and this rule retires a SENTENCE rather than
   * ending the widget. Closing it here would mean an unrelated cell's refusal
   * (`superseded`) or a press on some other part of the page could shut a list
   * the operator is reading and lose their search — while leaving it open
   * costs nothing, since the panel is drawn in the row's flow and covers
   * nothing.
   */
  useEffect(() => {
    if (pick.status.kind !== "failed") return;
    const edit = pick.edit;
    const box = root.current;
    if (box === null) return;
    const retire = (move: RetireMove) => dispatch({ kind: "abandoned", edit, move });
    const disarm = armRetire(domRetireHost(box), retire);
    const release = takeRefusalSlot(() => retire({ kind: "superseded" }));
    return () => {
      release();
      disarm();
    };
  }, [pick]);

  /**
   * Escape closes the panel from wherever focus is — campaign
   * admin-window/DEBT-0013.
   *
   * It used to be the open panel's own `onKeyDown`, which hears a key only
   * while focus is inside the panel — and nothing puts focus there
   * (`pickerFocus`, the effect below, is this ticket's other half) and nothing
   * kept it there once a choice went in flight. So `PICKER_HINT`'s "Escape
   * cancels" was true from inside the list and false from anywhere else, while
   * the same key, heard page-wide by the refusal rule above, retired the red
   * line from anywhere at all: one promise, two outcomes.
   *
   * Armed over the SAME `armRetire` and the same `domRetireHost` the refusal
   * rule uses — the app's one set of retire listeners and its one DOM adapter
   * (admin-window/BUG-0119), not a keydown handler of this widget's — and what
   * a move MEANS for the panel is `closesPanel`'s single answer. The other two
   * moves `armRetire` carries reach it and are refused there, which is where
   * BUG-0119's ruling belongs: a retirement does not close the panel.
   *
   * Armed only while the panel is open, so a picker at rest adds no listener.
   */
  useEffect(() => {
    if (!open) return;
    const box = root.current;
    if (box === null) return;
    return armRetire(domRetireHost(box), (move) => {
      if (!closesPanel(move)) return;
      setOpen(false);
      setQuery("");
    });
  }, [open]);

  /**
   * Focus, kept on this widget's own controls — campaign
   * admin-window/DEBT-0013.
   *
   * The rule is `pickerFocus`; this is the two lines of browser it decides
   * for. Sequenced against the open flag and the settled status rather than
   * fired from a handler, for the reason the cell's is
   * (admin-window/BUG-0069): the controls it aims at are `disabled` for the
   * whole of a write, so the verdict has to be taken again the moment they are
   * real. `focusIsAdrift` is the cell's own reading of `document`, imported
   * rather than restated.
   */
  useEffect(() => {
    const verdict = pickerFocus({
      open,
      was: focusedFor.current,
      status,
      adrift: focusIsAdrift(root.current),
    });
    if (verdict === "wait") return;
    // Decided: this transition is spent either way, so a later status change
    // cannot re-fire it at whatever the operator has focused by then.
    focusedFor.current = open;
    if (verdict === "search") search.current?.focus();
    else if (verdict === "toggle") toggle.current?.focus();
  }, [open, status]);

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
    <div data-widget="picker" ref={root}>
      <div className="flex flex-wrap items-baseline gap-2">
        <PickerValue
          id={chosen?.id ?? null}
          name={chosen?.name ?? null}
          domain={info.domain}
        />
        <button
          type="button"
          ref={toggle}
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
        // No `onKeyDown` here, and that is the fix: a handler bound to the
        // panel hears Escape only while focus is inside it, and Escape is a
        // page-wide move for this widget exactly as it is for the statement
        // beside it (`closesPanel`, armed above). One key, one path, one
        // meaning — a second path to the same decision is the shape of the
        // defect admin-window/BUG-0107 was bounced for.
        <PickerPanel
          window={info}
          query={query}
          current={chosen?.id ?? null}
          status={status}
          searchRef={search}
          onQuery={setQuery}
          onChoose={(optionId) => void choose(optionId)}
        />
      ) : null}
    </div>
  );
}
