import fs from "node:fs";
import path from "node:path";
import * as cheerio from "cheerio";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  IDLE_EDIT_STATE,
  armConfirmationClock,
  confirmationDelayMs,
  reduceEdit,
  type Status,
} from "@/components/EditableCell";
import {
  IDLE_PICK_STATE,
  PickerOptions,
  PickerPanel,
  PickerValue,
  matchOptions,
  noMatchWords,
  optionFor,
  pickerWindowName,
  reducePick,
  type PickEvent,
  type PickState,
  type PickerOption,
  type PickerWindow,
} from "@/components/records/entity-picker";
import { recordFields } from "@/components/records/fields";
import { EDIT_CONFIG, decideEdit, decideReference } from "@/lib/edit/config";
import { EM_DASH } from "@/lib/format";
import { codeLinesIn, codeText, repoRoot, sourceFiles, sourceText } from "../source-tree";

/**
 * The entity picker — how a `kind: reference` field is edited (campaign
 * admin-window/TASK-0055, SPEC F12, spec §8: "the widget follows the field's
 * kind").
 *
 * Three claims are graded here and each is a different kind of test:
 *
 *  - **the widget follows the kind** — `recordFields` gives the reference line
 *    `picker` and never `cell`, in every state of the map;
 *  - **the picker offers only rows the read returned, and creates nothing** —
 *    driven over the pure units the component exports, because `tests/offline`
 *    is environment node with no jsdom (STACK.md §4) and a state reached only
 *    by clicking is a state `renderToStaticMarkup` cannot produce;
 *  - **no code path submits a reference field's value as a string** — a
 *    structural rule over the source tree, proved on a probe it must flag and
 *    a shipped file it must not (LESSONS 3).
 *
 * The payload the choice becomes is graded where it is built, against the
 * recording spy the route suite already owns
 * (`tests/offline/edit/route.test.ts`, "the picker's choice").
 */

const VENUE = "01920000-0000-7000-8000-0000000000a4";
const DOME = "01920000-0000-7000-8000-0000000000b1";
const NAMELESS = "01920000-0000-7000-8000-0000000000b2";

const OPTIONS: readonly PickerOption[] = [
  { id: VENUE, name: "Olympic Hall" },
  { id: DOME, name: "Gocheok Sky Dome" },
  { id: NAMELESS, name: null },
];

function windowOf(
  options: readonly PickerOption[] = OPTIONS,
  facts: Partial<PickerWindow> = {},
): PickerWindow {
  return {
    options,
    limit: 1000,
    held: options.length,
    truncated: false,
    over: "table",
    domain: "venues",
    ...facts,
  };
}

/** A panel, rendered at rest with whatever query the operator has typed. */
function panel(query: string, info: PickerWindow = windowOf()): string {
  return renderToStaticMarkup(
    createElement(PickerPanel, {
      window: info,
      query,
      current: null,
      status: { kind: "idle" },
      onQuery: () => {},
      onChoose: () => {},
    }),
  );
}

/** Every option button the panel drew, as `id` values in document order. */
function offered(markup: string): string[] {
  const $ = cheerio.load(markup);
  return $("li button")
    .toArray()
    .map((button) => $(button).find(".type-data").text().trim());
}

/* ── the widget follows the field's kind ──────────────────────────────────── */

describe("which widget a reference field draws", () => {
  const config = EDIT_CONFIG.events;
  const reference = config.reference;
  const row = { event_id: "01920000-0000-7000-8000-0000000000a3", venue_id: VENUE };

  it("has a reference to be about, so nothing below is vacuous", () => {
    expect(reference).not.toBeNull();
  });

  it("gives the reference line the picker, never the cell", () => {
    const line = recordFields(config, row, new Map(), null, "open").find(
      (field) => field.name === reference?.field,
    );
    expect(line?.widget).toBe("picker");
  });

  it("gives it the picker with no value to point at yet", () => {
    // An empty reference is exactly the record an operator most needs to be
    // able to point at a row: a control that appears only once a value exists
    // could never set the first one.
    const line = recordFields(
      config,
      { event_id: row.event_id, venue_id: null },
      new Map(),
      null,
      "open",
    ).find((field) => field.name === reference?.field);
    expect(line?.widget).toBe("picker");
    expect(line?.reference).toBeNull();
  });

  it("draws no widget at all when the override path is closed", () => {
    // THE graded normal case: with `settle_review_item` absent the reference
    // field is read-only with the reason named above the table — no picker, no
    // disabled control, nothing toward a write path that does not exist.
    const line = recordFields(config, row, new Map(), null, "closed").find(
      (field) => field.name === reference?.field,
    );
    expect(line?.widget).toBe("read_only");
  });

  it("gives every editable column the cell, so the two kinds are told apart", () => {
    // The second fixture: if `recordFields` answered `picker` for everything
    // the assertions above would be green for the wrong reason.
    const fields = recordFields(
      config,
      { ...row, title: "A title" },
      new Map(),
      null,
      "open",
    );
    for (const column of config.editable) {
      expect(fields.find((field) => field.name === column)?.widget, column).toBe(
        "cell",
      );
    }
  });
});

/* ── it offers only rows that exist, and creates none ─────────────────────── */

describe("what the picker offers", () => {
  it("offers every row the read returned when nothing is typed", () => {
    expect(matchOptions(OPTIONS, "")).toEqual(OPTIONS);
    expect(matchOptions(OPTIONS, "   ")).toEqual(OPTIONS);
  });

  it("filters within those rows, case-insensitively, by name and by id", () => {
    expect(matchOptions(OPTIONS, "olympic").map((option) => option.id)).toEqual([
      VENUE,
    ]);
    expect(matchOptions(OPTIONS, "SKY").map((option) => option.id)).toEqual([DOME]);
    // An operator who pasted a uuid out of a query is searching with it.
    expect(matchOptions(OPTIONS, NAMELESS).map((option) => option.id)).toEqual([
      NAMELESS,
    ]);
  });

  it("matches nothing a row does not carry, rather than offering the text", () => {
    // The whole point of the widget: a venue nobody has heard of is not a
    // choice, and there is no control that would submit what was typed.
    expect(matchOptions(OPTIONS, "A venue that does not exist")).toEqual([]);
    const markup = panel("A venue that does not exist");
    expect(offered(markup)).toEqual([]);
    expect(cheerio.load(markup)('[data-state="empty"]').length).toBe(1);
  });

  it("refuses to choose an id the read did not return", () => {
    // The guard the submission itself goes through, so a stale click or a
    // hand-called handler cannot send a row that is not in the window.
    expect(optionFor(OPTIONS, VENUE)?.id).toBe(VENUE);
    expect(optionFor(OPTIONS, "01920000-0000-7000-8000-00000000ffff")).toBeNull();
    expect(optionFor([], VENUE)).toBeNull();
  });

  it("draws one button per matching row, and nothing else that acts", () => {
    const markup = panel("");
    expect(offered(markup)).toEqual([VENUE, DOME, NAMELESS]);
    const $ = cheerio.load(markup);
    // The controls are: the search box, and one button per row. There is no
    // create affordance, no submit button, and no second way in — entity
    // creation is the resolver's, not Admin's (spec §8).
    expect($("button").length).toBe(OPTIONS.length);
    expect($("input").length).toBe(1);
    expect($("form, [type='submit']").length).toBe(0);
  });

  it("names the search box for the entity it searches, and describes the ending", () => {
    const $ = cheerio.load(panel(""));
    const search = $("input");
    expect(search.attr("aria-label")).toBe("Search venues by name");
    // The hint is wired, not merely nearby: a screen-reader operator lands on
    // the box and hears how a choice ends.
    const described = search.attr("aria-describedby");
    expect(described).toBeTruthy();
    expect($(`#${described}`).text().length).toBeGreaterThan(0);
  });
});

/* ── a write in flight ────────────────────────────────────────────────────── */

/**
 * A second choice while the first one is still being written (QA,
 * admin-window/TASK-0055).
 *
 * The rule is the cell's, and it was paid for once already: a status belongs to
 * the edit that produced it, and the control that could start a second write is
 * `disabled` while one is in flight (`EditableCell`, admin-window/BUG-0069 —
 * "the button the operator can click again is disabled={status.kind ===
 * 'saving'}"). The picker is the same seam with a different widget: its options
 * are the controls that start the write, so they are what has to go busy.
 *
 * Driven over `PickerPanel`, which takes the status as a prop, because
 * `tests/offline` has no jsdom and cannot click (STACK.md §4). Nothing here
 * reads a word the panel says — only WHICH controls it still offers.
 */
describe("a choice while a choice is still saving", () => {
  function panelAt(status: Status): string {
    return renderToStaticMarkup(
      createElement(PickerPanel, {
        window: windowOf(),
        query: "",
        current: null,
        status,
        onQuery: () => {},
        onChoose: () => {},
      }),
    );
  }

  /** Every option button the panel drew that is still live to a click. */
  function liveOptions(markup: string): number {
    const $ = cheerio.load(markup);
    return $("li button").filter((_, button) => $(button).attr("disabled") === undefined)
      .length;
  }

  it("offers every option while nothing is in flight, so the claim below is not vacuous", () => {
    expect(liveOptions(panelAt({ kind: "idle" }))).toBe(OPTIONS.length);
  });

  /**
   * QA's pin for admin-window/BUG-0097, flipped from `it.fails` to a plain
   * `it` by the fix. Before it: every option was still clickable under
   * `saving`, so a second click sent a second PATCH for the same field — two
   * override decisions for one intent, and the value the panel settled on was
   * whichever answer came back last rather than the choice made last.
   */
  it("offers no option that would start a second write while one is saving", () => {
    const markup = panelAt({ kind: "saving" });
    expect(liveOptions(markup)).toBe(0);
    // The rows are still DRAWN: the operator keeps the list they were reading
    // and the panel does not blank itself mid-write. Going busy is not the
    // same move as going away.
    expect(cheerio.load(markup)("li button").length).toBe(OPTIONS.length);
  });

  /**
   * The busy rule follows the FILTER, not just the resting list — QA,
   * admin-window/BUG-0097. The operator who typed before choosing is looking
   * at a subset, and that subset is what their second click would land on;
   * `busy` reaching only the unfiltered rendering would leave exactly the
   * buttons that are on screen live.
   */
  it("offers no live option while saving even when the search narrowed the list", () => {
    const markup = renderToStaticMarkup(
      createElement(PickerPanel, {
        window: windowOf(),
        query: "Gocheok",
        current: null,
        status: { kind: "saving" } as Status,
        onQuery: () => {},
        onChoose: () => {},
      }),
    );
    const $ = cheerio.load(markup);
    expect($("li button").length).toBe(1); // the filter really did narrow it
    expect(liveOptions(markup)).toBe(0);
  });

  it("offers them again once the write has answered", () => {
    expect(liveOptions(panelAt({ kind: "saved" }))).toBe(OPTIONS.length);
    expect(liveOptions(panelAt({ kind: "failed", message: "refused" }))).toBe(
      OPTIONS.length,
    );
  });
});

/* ── and whose answer it accepts ──────────────────────────────────────────── */

/**
 * The other half of the same rule, and it fails separately: which controls the
 * panel offers is one property, whose ANSWER the state accepts is another
 * (campaign admin-window/BUG-0097).
 *
 * Graded over `reducePick` rather than the component because a second click is
 * a state no offline test can reach — `tests/offline` is environment node with
 * no jsdom (STACK.md §4) — and because the reducer is where the guard has to
 * live: two clicks inside one commit window read the same rendered closure, so
 * only the reducer sees what the first click already did.
 */
describe("whose answer the picker's state accepts", () => {
  const A: PickerOption = { id: VENUE, name: "Olympic Hall" };
  const B: PickerOption = { id: DOME, name: "Gocheok Sky Dome" };

  /** Choice `n` of `option`, and the answer it eventually gets. */
  const choosing = (edit: number, option: PickerOption) =>
    ({ kind: "choosing", edit, option }) as const;
  const settled = (
    edit: number,
    option: PickerOption,
    ok: boolean,
  ): PickEvent => ({
    kind: "settled",
    edit,
    option,
    outcome: ok ? { ok: true } : { ok: false, message: `${option.id} refused` },
  });

  it("starts from nothing chosen and nothing said", () => {
    expect(IDLE_PICK_STATE.status.kind).toBe("idle");
    expect(IDLE_PICK_STATE.chosen).toBeNull();
  });

  it("takes a first choice, and shows it once its own write answers", () => {
    // The fixture the rule must NOT flag: an ordinary choice still lands.
    const saving = reducePick(IDLE_PICK_STATE, choosing(1, A));
    expect(saving.status.kind).toBe("saving");
    expect(saving.chosen).toBeNull(); // not yet: the write has not answered
    const done = reducePick(saving, settled(1, A, true));
    expect(done.status.kind).toBe("saved");
    expect(done.chosen).toBe(A);
  });

  it("is not a second choice at all while the first write is in flight", () => {
    const saving = reducePick(IDLE_PICK_STATE, choosing(1, A));
    const second = reducePick(saving, choosing(2, B));
    // Unchanged BY REFERENCE: the first write still owns the statement, and
    // React bails out rather than re-rendering under it.
    expect(second).toBe(saving);
  });

  it("never lets a superseded write's late answer win the display", () => {
    // The measured symptom of admin-window/BUG-0097: two writes in the air for
    // one field, and the line ends up showing whichever ANSWERED last rather
    // than what was last decided.
    let state: PickState = reducePick(IDLE_PICK_STATE, choosing(1, A));
    state = reducePick(state, settled(1, A, false)); // write 1 refused
    expect(state.chosen).toBeNull();

    state = reducePick(state, choosing(2, B)); // the operator chooses B
    expect(state.status.kind).toBe("saving");

    // Write 1's answer arrives LATE, and it is a success for A.
    const late = reducePick(state, settled(1, A, true));
    expect(late).toBe(state); // no statement of A's, and B's write still runs
    expect(late.chosen).toBeNull();

    // B's own answer is the one that speaks.
    const settledB = reducePick(late, settled(2, B, true));
    expect(settledB.status.kind).toBe("saved");
    expect(settledB.chosen).toBe(B);
  });

  it("never lets a superseded write's late refusal erase a newer statement", () => {
    let state: PickState = reducePick(IDLE_PICK_STATE, choosing(1, A));
    state = reducePick(state, settled(1, A, true));
    state = reducePick(state, choosing(2, B));
    const late = reducePick(state, settled(1, A, false));
    // A 403 for a write nobody is waiting on does not speak over the write
    // that IS in flight (admin-window/BUG-0075's rule, this widget).
    expect(late).toBe(state);
    expect(late.status.kind).toBe("saving");
    expect(late.chosen).toBe(A); // still what the last ANSWERED write set
  });

  it("hands the widget back after a write, so the next choice can be made", () => {
    const saved = reducePick(
      reducePick(IDLE_PICK_STATE, choosing(1, A)),
      settled(1, A, true),
    );
    const again = reducePick(saved, choosing(2, B));
    expect(again.status.kind).toBe("saving");
    expect(again.chosen).toBe(A); // the line still says what it says until B answers
  });

  it("clears a spent statement without speaking over a write in flight", () => {
    // Reopening the picker acknowledges the last confirmation or refusal — and
    // does nothing at all to a write still running.
    const failed = reducePick(
      reducePick(IDLE_PICK_STATE, choosing(1, A)),
      settled(1, A, false),
    );
    expect(reducePick(failed, { kind: "cleared" }).status.kind).toBe("idle");

    const saving = reducePick(IDLE_PICK_STATE, choosing(1, A));
    expect(reducePick(saving, { kind: "cleared" })).toBe(saving);
  });
});

/* ── and the confirmation it makes retires itself ─────────────────────────── */

/**
 * The picker's `saved` is on the CELL's clock, and on no clock of its own —
 * campaign admin-window/BUG-0111.
 *
 * The defect: the picker renders the shared `EditStatus` from `reducePick`,
 * and nothing in that module ever retired a confirmation, so a successful
 * override left the green word standing until the operator reopened that same
 * picker — while the click-to-edit cell a few rows above retired its own after
 * 1.5s. One status renderer, two lifetimes.
 *
 * Driven the way the component composes it: `armConfirmationClock` is the
 * arming rule both widgets call from a `useEffect` keyed on the state OBJECT,
 * so `mountPick` below is that composition over vitest's fake timers — the
 * cheapest thing that can answer "what is the picker saying at t=1501ms", with
 * no jsdom (STACK.md §4) and no second copy of the clock to test.
 *
 * `leakClocks: true` is the shape the defect class has: a timeout that was
 * armed and NOT torn down when the state moved on. Every timeline is driven
 * both ways, so the picker is required to survive a straggler clock rather
 * than merely never to have one — the reducer's epoch rule is the second
 * defense and it is `reduceEdit`'s, not a restatement (admin-window/BUG-0075,
 * BUG-0097).
 */
describe("the picker's confirmation, on the click-to-edit cell's own clock", () => {
  const A: PickerOption = { id: VENUE, name: "Olympic Hall" };
  const B: PickerOption = { id: DOME, name: "Gocheok Sky Dome" };

  const choosing = (edit: number, option: PickerOption): PickEvent => ({
    kind: "choosing",
    edit,
    option,
  });
  const settled = (edit: number, option: PickerOption, ok: boolean): PickEvent => ({
    kind: "settled",
    edit,
    option,
    outcome: ok ? { ok: true } : { ok: false, message: `${option.id} refused` },
  });

  /**
   * How long a confirmation lives, read from the rule the cell reads. Never a
   * literal here: a number written into this file is the second copy the
   * ticket exists to prevent.
   */
  const DELAY = confirmationDelayMs({ kind: "saved" });

  /**
   * The picker's state machine plus its clock effect, over a virtual clock.
   *
   * `useReducer` bails out on an unchanged reference, so a stale event
   * re-renders nothing and the timeout already running is untouched; every
   * real transition runs the effect's cleanup and then the effect. That is
   * exactly the four lines below, and it is what the component does.
   */
  function mountPick({ leakClocks = false }: { leakClocks?: boolean } = {}) {
    let state: PickState = IDLE_PICK_STATE;
    let disarm: (() => void) | undefined;
    const dispatch = (event: PickEvent): void => {
      const next = reducePick(state, event);
      if (next === state) return;
      state = next;
      if (!leakClocks) disarm?.();
      disarm = armConfirmationClock(state, dispatch);
    };
    return {
      dispatch,
      /** What the picker is saying now. */
      now: (): PickState => state,
      /** React unmounting the widget: the effect's cleanup, and nothing after. */
      unmount: (): void => disarm?.(),
      /** What the open panel draws for it — the operator's actual evidence. */
      says: (): cheerio.CheerioAPI =>
        cheerio.load(
          renderToStaticMarkup(
            createElement(PickerPanel, {
              window: windowOf(),
              query: "",
              current: state.chosen?.id ?? null,
              status: state.status,
              onQuery: () => {},
              onChoose: () => {},
            }),
          ),
        ),
    };
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("takes its delay from the one rule, so the two widgets cannot drift", () => {
    // The cell's confirmed state and the picker's, each built by its own
    // reducer, are asked the same question and must give the same answer.
    const cellSaved = reduceEdit(
      reduceEdit(IDLE_EDIT_STATE, { kind: "committed", edit: 1 }),
      { kind: "settled", edit: 1, outcome: { ok: true } },
    );
    const pickSaved = reducePick(
      reducePick(IDLE_PICK_STATE, choosing(1, A)),
      settled(1, A, true),
    );
    expect(confirmationDelayMs(pickSaved.status)).not.toBeNull();
    expect(confirmationDelayMs(pickSaved.status)).toEqual(
      confirmationDelayMs(cellSaved.status),
    );
  });

  it("arms no clock of its own, in any spelling", () => {
    // The rule: the picker module schedules nothing. Read over CODE lines, so
    // a comment naming the mechanism is not a second clock (LESSONS 3).
    const scheduling = (text: string) =>
      codeLinesIn(text).filter((line) => /\bset(?:Timeout|Interval)\s*\(/.test(line));
    const picker = sourceText("src/components/records/entity-picker.tsx");
    expect(scheduling(picker)).toEqual([]);
    // ...because it calls the cell's, which is what makes the delay shared.
    expect(picker).toContain("armConfirmationClock");

    // The two fixtures the guard is proved on: one it MUST flag, and one it
    // must not (a comment about the clock is not a clock).
    expect(
      scheduling('const t = setTimeout(() => dispatch({ kind: "elapsed", edit }), 1500);\n'),
    ).toHaveLength(1);
    expect(
      scheduling("/** A confirmation retires on setTimeout(...) — the cell's. */\n"),
    ).toEqual([]);
  });

  it("retires a confirmation on that delay, and keeps what the write chose", () => {
    const picker = mountPick();
    picker.dispatch(choosing(1, A));
    picker.dispatch(settled(1, A, true));
    expect(picker.now().status.kind).toEqual("saved");
    // On screen at t=0: the panel is drawing a live status region.
    expect(picker.says()('[role="status"]')).toHaveLength(1);

    vi.advanceTimersByTime((DELAY ?? 0) - 1);
    expect(picker.now().status.kind, "one tick short of the delay").toEqual("saved");

    vi.advanceTimersByTime(1);
    expect(picker.now().status.kind, "the confirmation's own clock").toEqual("idle");
    // Gone from the surface, not merely from the state.
    expect(picker.says()('[role="status"]')).toHaveLength(0);
    // ...and the line still points where the write actually put it.
    expect(picker.now().chosen).toBe(A);
  });

  it("puts no clock on a refusal, however long it stands", () => {
    const picker = mountPick();
    picker.dispatch(choosing(1, A));
    picker.dispatch(settled(1, A, false));
    expect(confirmationDelayMs(picker.now().status)).toBeNull();

    vi.advanceTimersByTime((DELAY ?? 0) * 2);
    expect(picker.now().status.kind, "twice the confirmation's life").toEqual("failed");
    // Still a sentence the operator has to act on, still on screen.
    expect(picker.says()('[role="alert"]')).toHaveLength(1);
    vi.advanceTimersByTime(60_000);
    expect(picker.now().status.kind).toEqual("failed");
  });

  it("leaves a write still in flight alone", () => {
    const picker = mountPick();
    picker.dispatch(choosing(1, A));
    expect(confirmationDelayMs(picker.now().status)).toBeNull();

    vi.advanceTimersByTime((DELAY ?? 0) * 2);
    expect(picker.now().status.kind, "the write has not answered").toEqual("saving");
    expect(picker.says()('[role="status"]')).toHaveLength(1);
    // And the options are still the busy ones: no clock hands the widget back
    // early (admin-window/BUG-0097).
    expect(
      picker.says()("li button").filter((_, button) => button.attribs.disabled === undefined),
    ).toHaveLength(0);
  });

  describe.each([{ leaked: false }, { leaked: true }])(
    "and the clock belongs to the choice that armed it (straggler clock: $leaked)",
    ({ leaked }) => {
      it("never retires a newer choice's in-flight statement", () => {
        const picker = mountPick({ leakClocks: leaked });
        picker.dispatch(choosing(1, A));
        picker.dispatch(settled(1, A, true)); // choice 1's clock is running
        vi.advanceTimersByTime((DELAY ?? 0) - 200);
        picker.dispatch({ kind: "cleared" }); // the operator reopens
        picker.dispatch(choosing(2, B)); // ...and chooses again, still in flight
        expect(picker.now().status.kind).toEqual("saving");

        // Choice 1's clock fires in here somewhere. It is not its statement.
        vi.advanceTimersByTime(1_000);
        expect(picker.now().status.kind, "choice 2's write is still running").toEqual(
          "saving",
        );

        picker.dispatch(settled(2, B, true));
        expect(picker.now().status.kind).toEqual("saved");
        vi.advanceTimersByTime((DELAY ?? 0) - 1);
        expect(picker.now().status.kind, "its own full delay, and no less").toEqual(
          "saved",
        );
        vi.advanceTimersByTime(1);
        expect(picker.now().status.kind).toEqual("idle");
        expect(picker.now().chosen).toBe(B);
      });

      it("never erases a newer choice's refusal", () => {
        const picker = mountPick({ leakClocks: leaked });
        picker.dispatch(choosing(1, A));
        picker.dispatch(settled(1, A, true));
        vi.advanceTimersByTime((DELAY ?? 0) - 200);
        picker.dispatch({ kind: "cleared" });
        picker.dispatch(choosing(2, B));
        picker.dispatch(settled(2, B, false));

        vi.advanceTimersByTime(60_000);
        expect(picker.now().status.kind, "a refusal outlives every clock").toEqual(
          "failed",
        );
        expect(picker.now().chosen, "and the line still says what was written").toBe(A);
      });
    },
  );

  /* the same rule at the reducer, where a hand-fired clock can be aimed */

  it("retires only the confirmation its own choice put on screen", () => {
    const saved = reducePick(
      reducePick(IDLE_PICK_STATE, choosing(1, A)),
      settled(1, A, true),
    );
    const retired = reducePick(saved, { kind: "elapsed", edit: 1 });
    expect(retired.status.kind).toEqual("idle");
    expect(retired.chosen, "the reference line is not un-said by the clock").toBe(A);

    // An older choice's clock, arriving late: unchanged BY REFERENCE, so
    // React bails out and nothing on screen moves.
    expect(reducePick(saved, { kind: "elapsed", edit: 0 })).toBe(saved);

    const saving = reducePick(saved, choosing(2, B));
    expect(reducePick(saving, { kind: "elapsed", edit: 1 })).toBe(saving);
    expect(reducePick(saving, { kind: "elapsed", edit: 2 })).toBe(saving);

    const failed = reducePick(
      reducePick(IDLE_PICK_STATE, choosing(1, A)),
      settled(1, A, false),
    );
    expect(reducePick(failed, { kind: "elapsed", edit: 1 })).toBe(failed);
  });

  /**
   * Escape ends a refusal, which is BUG-0107's rule reaching this widget —
   * the picker owns that key already (its panel's `onKeyDown`), so the move it
   * can see is dispatched through the same `abandoned` event and decided by
   * the same `retiresRefusal`. The page-wide moves the cell also listens for
   * (a press outside, focus landing elsewhere) are NOT armed here; see the
   * ticket's handoff note.
   */
  it("ends a refusal on Escape, and speaks over nothing else", () => {
    const escape = { kind: "abandoned", edit: 1, move: { kind: "escape" } } as const;

    const failed = reducePick(
      reducePick(IDLE_PICK_STATE, choosing(1, A)),
      settled(1, A, false),
    );
    const ended = reducePick(failed, escape);
    expect(ended.status.kind).toEqual("idle");
    expect(ended.chosen).toBeNull(); // a refused write changed nothing

    // Not a confirmation (that is the clock's), not a write in flight, and
    // not a statement belonging to a later choice.
    const saved = reducePick(
      reducePick(IDLE_PICK_STATE, choosing(1, A)),
      settled(1, A, true),
    );
    expect(reducePick(saved, escape)).toBe(saved);
    const saving = reducePick(IDLE_PICK_STATE, choosing(1, A));
    expect(reducePick(saving, escape)).toBe(saving);
    const later = reducePick(
      reducePick(failed, choosing(2, B)),
      settled(2, B, false),
    );
    expect(reducePick(later, escape), "an older edit's Escape").toBe(later);
  });

  /* ── QA/BUG-0111: the corners the arming rule is bought on ──────────────── */

  /**
   * The straggler case the suite did not have: an older clock reaching a NEWER
   * CONFIRMATION. The two shipped straggler tests aim choice 1's clock at a
   * `saving` and at a `failed`, where `reduceEdit`'s guard has two reasons to
   * refuse it (wrong ordinal AND wrong status kind). Here only the ordinal
   * separates them, so this is the one that grades the ordinal alone — and it
   * is the visible harm: a second confirmation blinking out early, after a
   * fraction of the delay the operator is owed.
   */
  it("gives a second confirmation its own full delay, not the remains of the first", () => {
    const picker = mountPick({ leakClocks: true });
    picker.dispatch(choosing(1, A));
    picker.dispatch(settled(1, A, true)); // choice 1's clock is running, leaked
    vi.advanceTimersByTime((DELAY ?? 0) - 200);
    picker.dispatch({ kind: "cleared" });
    picker.dispatch(choosing(2, B));
    picker.dispatch(settled(2, B, true)); // a SECOND confirmation, 200ms from
    //                                       the first clock's firing time
    vi.advanceTimersByTime(200);
    expect(picker.now().status.kind, "choice 1's clock is not choice 2's").toEqual(
      "saved",
    );
    vi.advanceTimersByTime((DELAY ?? 0) - 200 - 1);
    expect(picker.now().status.kind, "one tick short of ITS OWN delay").toEqual("saved");
    vi.advanceTimersByTime(1);
    expect(picker.now().status.kind).toEqual("idle");
    expect(picker.now().chosen).toBe(B);
  });

  /**
   * The widget going away mid-confirmation. The clock is a `setTimeout` holding
   * a `dispatch` into a reducer that no longer has a component; the disposer
   * `armConfirmationClock` returns is what React runs on unmount, and after it
   * there must be no timer left to fire at all.
   */
  it("leaves no clock behind when the widget goes away mid-confirmation", () => {
    const picker = mountPick();
    picker.dispatch(choosing(1, A));
    picker.dispatch(settled(1, A, true));
    expect(vi.getTimerCount(), "a confirmation is on a clock").toEqual(1);

    picker.unmount();
    expect(vi.getTimerCount(), "and the cleanup takes it with it").toEqual(0);
    vi.advanceTimersByTime((DELAY ?? 0) * 4);
    expect(picker.now().status.kind, "nothing fired into the dead widget").toEqual(
      "saved",
    );
  });

  /**
   * The arming rule itself, at the seam both widgets call — criterion 2, "the
   * clock is armed by the state, not by a call site". A status that is not a
   * confirmation schedules NOTHING (not a timer that later decides to do
   * nothing), and a confirmation's timer fires exactly one `elapsed` carrying
   * the ordinal that armed it.
   */
  it("arms a clock for a confirmation and for no other status the app can be in", () => {
    const fired: { kind: "elapsed"; edit: number }[] = [];
    const spy = (event: { kind: "elapsed"; edit: number }) => fired.push(event);
    const saving = reduceEdit(IDLE_EDIT_STATE, { kind: "committed", edit: 7 });
    const failed = reduceEdit(saving, {
      kind: "settled",
      edit: 7,
      outcome: { ok: false, message: "venue_id is not a venue" },
    });

    expect(armConfirmationClock(IDLE_EDIT_STATE, spy)).toBeUndefined();
    expect(armConfirmationClock(saving, spy)).toBeUndefined();
    expect(armConfirmationClock(failed, spy)).toBeUndefined();
    expect(vi.getTimerCount(), "no status but a confirmation is on a clock").toEqual(0);

    const saved = reduceEdit(saving, { kind: "settled", edit: 7, outcome: { ok: true } });
    expect(armConfirmationClock(saved, spy)).toBeTypeOf("function");
    vi.advanceTimersByTime(DELAY ?? 0);
    expect(fired, "one firing, carrying the ordinal that armed it").toEqual([
      { kind: "elapsed", edit: 7 },
    ]);
  });

  /**
   * `abandoned` is delegated whole, so every BUG-0107 move already decides
   * correctly through `retiresRefusal` — including the two the component does
   * not yet feed it (a press outside, focus landing elsewhere) and the page's
   * `superseded`. The reducer being ready is what makes BUG-0119 a wiring
   * ticket rather than a state-machine one; the retirement also must not
   * un-say the row an EARLIER successful write linked.
   */
  it("hands every BUG-0107 move to the one decision, and un-links nothing", () => {
    const picker = mountPick();
    picker.dispatch(choosing(1, A));
    picker.dispatch(settled(1, A, true));
    vi.advanceTimersByTime(DELAY ?? 0);
    picker.dispatch(choosing(2, B));
    picker.dispatch(settled(2, B, false)); // a refusal, over a line that says A
    const failed = picker.now();

    for (const move of [
      { kind: "escape" },
      { kind: "press", inside: false },
      { kind: "focus", inside: false },
      { kind: "superseded" },
    ] as const) {
      const ended = reducePick(failed, { kind: "abandoned", edit: 2, move });
      expect(ended.status.kind, `${move.kind} ends a refusal`).toEqual("idle");
      expect(ended.chosen, "and the refused write still changed nothing").toBe(A);
    }
    for (const move of [
      { kind: "press", inside: true },
      { kind: "focus", inside: true },
    ] as const) {
      expect(
        reducePick(failed, { kind: "abandoned", edit: 2, move }),
        `${move.kind} inside the widget is not an abandonment`,
      ).toBe(failed);
    }
  });

  /**
   * PIN — admin-window/BUG-0119, strict: this is red today and `it.fails` is
   * the marker. The clock came over from the cell; BUG-0107's page-wide half
   * did not, so a picker refusal ends only on an Escape pressed while focus is
   * still inside the open panel, and it never takes the page's one refusal
   * slot — a picker refusal and a cell refusal can stand stacked. Flipping
   * this to `it` is part of BUG-0119's fix; leaving `it.fails` on a fixed
   * picker turns the file red, which is the point.
   */
  it.fails(
    "arms the page-wide retire rule for a refusal the open panel cannot end (BUG-0119)",
    () => {
      const picker = sourceText("src/components/records/entity-picker.tsx");
      expect(picker, "the three listeners a closed, refusing widget needs").toContain(
        "armRetire",
      );
      expect(picker, "and the page's one refusal slot").toContain("takeRefusalSlot");
    },
  );
});

/* ── absence renders honestly ─────────────────────────────────────────────── */

describe("the picker's empty and null renderings", () => {
  it("renders a labelled empty state for zero matches, naming what fills it", () => {
    const $ = cheerio.load(panel("nothing matches this"));
    const card = $('[data-state="empty"]');
    expect(card.length).toBe(1);
    // The app's empty state, which names what the surface holds and the one
    // thing that fills it — never a bare "no results" (LOOK_AND_FEEL state 2).
    expect(card.text()).toContain("venues");
    expect(card.text()).toContain(noMatchWords("venues"));
    // And it is the EMPTY state, never the not-provisioned one: the table
    // answered.
    expect($('[data-state="not_provisioned"]').length).toBe(0);
  });

  it("offers a row whose name is null, labelled with the dash and no qualifier", () => {
    const markup = renderToStaticMarkup(
      createElement(PickerOptions, {
        options: [{ id: NAMELESS, name: null }],
        current: null,
        onChoose: () => {},
      }),
    );
    const $ = cheerio.load(markup);
    const button = $("button");
    // The row exists, so it is offered — a nameless row is never dropped.
    expect(button.length).toBe(1);
    expect(button.text()).toContain(EM_DASH);
    expect(button.text()).toContain(NAMELESS);
    // The dash carries no qualifier: no "(no name)", no "unnamed" (LESSONS 1).
    expect(button.text().replace(NAMELESS, "").replace(EM_DASH, "").trim()).toBe("");
  });

  it("renders the resting value as the dash when the field points nowhere", () => {
    const markup = renderToStaticMarkup(
      createElement(PickerValue, { id: null, name: null, domain: "venues" }),
    );
    expect(cheerio.load(markup).text()).toContain(EM_DASH);
    expect(cheerio.load(markup)("a").length).toBe(0);
  });

  it("keeps the route out beside the control when the field does point somewhere", () => {
    const markup = renderToStaticMarkup(
      createElement(PickerValue, { id: VENUE, name: "Olympic Hall", domain: "venues" }),
    );
    const $ = cheerio.load(markup);
    expect($("a").attr("href")).toBe(`/records/venues/${VENUE}`);
    expect($.text()).toContain(VENUE);
  });
});

/* ── the window it is showing, stated ─────────────────────────────────────── */

describe("the window the picker states", () => {
  it("publishes the read's own facts, and claims no total", () => {
    const $ = cheerio.load(panel("", windowOf(OPTIONS, { limit: 1000, held: 3 })));
    const line = $(`[data-window="${pickerWindowName("venues")}"]`);
    expect(line.length).toBe(1);
    expect(line.attr("data-window-limit")).toBe("1000");
    expect(line.attr("data-window-held")).toBe("3");
    expect(line.attr("data-window-truncated")).toBe("false");
    // A window read has no time bound, so it publishes none.
    expect(line.attr("data-window-since")).toBeUndefined();
  });

  it("says which way the window went, on top of the same sentence", () => {
    // Both directions, since admin-window/BUG-0109: a window that filled its
    // cap costs choices later in the alphabet, and one that did not holds
    // every choice the read found. Each is said ON TOP of the picker's own
    // sentence, which is the part both states share.
    const open = cheerio.load(panel("", windowOf(OPTIONS, { truncated: false })))(
      "[data-window]",
    ).text();
    const filled = cheerio.load(panel("", windowOf(OPTIONS, { truncated: true })))(
      "[data-window]",
    ).text();
    let shared = 0;
    while (
      shared < open.length &&
      shared < filled.length &&
      open[shared] === filled[shared]
    ) {
      shared += 1;
    }
    expect(shared).toBeGreaterThan(20);
    expect(open.length).toBeGreaterThan(shared);
    expect(filled.length).toBeGreaterThan(shared);
    expect(open).not.toBe(filled);
    expect(
      cheerio.load(panel("", windowOf(OPTIONS, { truncated: true })))(
        "[data-window]",
      ).attr("data-window-truncated"),
    ).toBe("true");
  });

  it("names the object the read ran over from the window, not from the caller", () => {
    for (const over of ["table", "view"] as const) {
      const other = over === "table" ? "view" : "table";
      const text = cheerio.load(panel("", windowOf(OPTIONS, { over })))(
        "[data-window]",
      ).text();
      expect(text, over).toContain(`not the whole ${over}.`);
      expect(text, over).not.toContain(`not the whole ${other}.`);
    }
  });
});

/* ── no code path submits a reference field's value as a string ───────────── */

/**
 * Criterion 1's structural half, and it has three legs — because "no code path
 * submits a reference field's value as text" is three separate properties and
 * a single assertion about one of them would be a claim about the other two.
 *
 * 1. **The map refuses it.** `decideEdit` is the only thing that authorises a
 *    value submission, and it refuses every reference column — so a
 *    `{field: "venue_id", value: "Olympic Hall"}` body has no path at all.
 *    Proved on both fixtures: the reference column refuses, an editable column
 *    does not.
 * 2. **The text widget is rendered from exactly one place**, and that place
 *    hands it `cell` lines. A second module rendering `<FieldEditor` is the
 *    shape this exists to catch, and it is proved on a mirror tree carrying
 *    one file that must be flagged and one that must not.
 * 3. **The picker's own submitter carries no value key.** It calls
 *    `submitReferenceEdit` and never `submitFieldEdit`.
 */
describe("no code path submits a reference field's value as text", () => {
  it("refuses a reference column through the one authoriser, and allows a scalar", () => {
    for (const config of Object.values(EDIT_CONFIG)) {
      const reference = config.reference;
      if (reference === null) continue;
      // The input the rule MUST flag.
      const asValue = decideEdit(config.table, reference.field);
      expect(asValue.allowed, `${config.table}.${reference.field}`).toBe(false);
      if (!asValue.allowed) {
        expect(asValue.refusal.kind).toBe("field_not_editable");
      }
      // The input it must NOT flag: the same column asked for as a reference,
      // and a scalar column asked for as a value. Without these the rule above
      // would be green on a map that refuses everything.
      expect(decideReference(config.table, reference.field).allowed).toBe(true);
      expect(config.editable.length).toBeGreaterThan(0);
      expect(decideEdit(config.table, config.editable[0]).allowed).toBe(true);
    }
  });

  it("renders the text cell from exactly one module, and the picker from another", () => {
    const renderers = sourceFiles().filter((file) =>
      /<FieldEditor\b/.test(codeText(file)),
    );
    expect(renderers).toEqual(["src/components/records/record-fields.tsx"]);

    const picker = sourceText("src/components/records/entity-picker.tsx");
    expect(picker).toContain("submitReferenceEdit");
    // The picker never reaches for the value submitter, in any spelling.
    expect(picker).not.toContain("submitFieldEdit");
  });

  it("flags a second module that hands a reference column to the text cell", () => {
    // The guard's own two fixtures, on a MIRROR tree under `tests/.probes/`
    // rather than in the real `src/` — three offline suites walk that tree in
    // parallel (admin-window/BUG-0020, `../source-tree.ts`).
    const probeBase = path.join(
      repoRoot,
      "tests",
      ".probes",
      `reference-cell-${process.pid}`,
    );
    const SANCTIONED = "src/components/records/record-fields.tsx";
    const PROBE = "src/components/records/reference-cell.tsx";
    const COMMENT_ONLY = "src/components/records/notes.ts";
    const SOURCES: ReadonlyArray<readonly [string, string]> = [
      [
        SANCTIONED,
        "export function RecordFields() {\n" +
          '  return <FieldEditor field="title" />;\n' +
          "}\n",
      ],
      [
        PROBE,
        "export function ReferenceCell() {\n" +
          // The defect: a reference column handed to the text cell, whose
          // save sends `{field, value}` — a venue name written as a string.
          '  return <FieldEditor field="venue_id" />;\n' +
          "}\n",
      ],
      [
        COMMENT_ONLY,
        "/** A reference never renders as <FieldEditor />; it draws the picker. */\n" +
          "export const note = 1;\n",
      ],
    ];

    let renderers: string[] = [];
    try {
      for (const [file, source] of SOURCES) {
        const full = path.join(probeBase, file);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, source, "utf8");
      }
      renderers = sourceFiles(probeBase).filter((file) =>
        /<FieldEditor\b/.test(codeText(file, probeBase)),
      );
    } finally {
      fs.rmSync(probeBase, { force: true, recursive: true });
    }

    // The input it MUST flag: on this tree the renderer list is two files, so
    // the real assertion above fails, naming the second module.
    expect(renderers).toEqual([PROBE, SANCTIONED].sort());
    // The input it must NOT flag: a comment describing the rule is not a
    // rendering (LESSONS 3, common violation 4).
    expect(renderers).not.toContain(COMMENT_ONLY);
    // And the probe tree is gone, so no parallel walker trips over it.
    expect(fs.existsSync(probeBase)).toBe(false);
  });
});
