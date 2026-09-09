import fs from "node:fs";
import path from "node:path";
import * as cheerio from "cheerio";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  IDLE_EDIT_STATE,
  armConfirmationClock,
  armRetire,
  confirmationDelayMs,
  reduceEdit,
  retiresRefusal,
  takeRefusalSlot,
  type EditState,
  type RetireHost,
  type RetireMove,
  type RetireSignal,
  type SaveOutcome,
  type Status,
} from "@/components/EditableCell";
import {
  IDLE_PICK_STATE,
  PickerOptions,
  PickerPanel,
  PickerValue,
  closesPanel,
  matchOptions,
  noMatchWords,
  optionFor,
  pickerFocus,
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
   * Escape ends a refusal, which is BUG-0107's rule reaching this widget: the
   * move is dispatched through the same `abandoned` event and decided by the
   * same `retiresRefusal`, whichever listener saw it. Where the moves now come
   * from — three page-wide listeners and the page's one slot, not the open
   * panel's `onKeyDown` (admin-window/BUG-0119) — is graded in the block after
   * this describe.
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
   * `abandoned` is delegated whole, so every BUG-0107 move decides correctly
   * through `retiresRefusal` — a press outside, focus landing elsewhere,
   * Escape, and the page's `superseded`. The reducer being ready is what made
   * admin-window/BUG-0119 a wiring ticket rather than a state-machine one; the
   * retirement also must not un-say the row an EARLIER successful write
   * linked.
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
   * PIN — QA's, for admin-window/BUG-0119, flipped from `it.fails` to `it` by
   * the fix. It was red because the clock came over from the cell and
   * BUG-0107's page-wide half did not: a picker refusal ended only on an
   * Escape pressed while focus was still inside the open panel, and it never
   * took the page's one refusal slot, so it could stand stacked with a cell's.
   * The block below this describe grades what those two names now do.
   */
  it(
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

/* ── the page-wide retire, and the page's one refusal slot ────────────────── */

/**
 * A record page's widgets — the picker and the cells beside it — driven
 * through the units the components arm, campaign admin-window/BUG-0119.
 *
 * The picker's refusal used to end on exactly one move (Escape pressed while
 * focus was still inside the OPEN panel, its only listener) and it never took
 * the page's one refusal slot, so it outlived every other move an operator
 * makes and could stand stacked with a cell's.
 *
 * Each widget here is its own reducer's state — `reducePick` for the picker,
 * `reduceEdit` for a cell — and the harness stands in for the one effect each
 * component runs: while a widget shows a refusal it holds `armRetire`'s three
 * page-wide listeners and `takeRefusalSlot`, and it drops both the moment the
 * refusal goes. Every verb below is one thing an operator does, delivered to
 * every armed widget exactly as a document-level listener would deliver it —
 * which is how "at most ONE refusal is on screen at any moment, on any record
 * page" (admin-window/BUG-0107 criterion 2) becomes a claim about two widgets
 * sharing one slot rather than about one widget's model of itself.
 *
 * What no test here can drive is the adapter from a real element and its owner
 * document to `RetireHost` (`domRetireHost`) or React's effect scheduling —
 * browser facts, and `tests/offline` is environment node with no jsdom
 * (STACK.md §4). That the picker arms THIS rule rather than a second copy of
 * it is graded as structure, in the test that closes the block.
 */
const CHOICE: PickerOption = { id: VENUE, name: "Olympic Hall" };
/** A second row, for a choice made after one was refused. */
const SECOND: PickerOption = { id: DOME, name: "Gocheok Sky Dome" };

function refusalPage(widgets: readonly { name: string; kind: "picker" | "cell" }[]) {
  const names = widgets.map((widget) => widget.name);
  /** A stand-in for each widget's box, so `contains` has something to answer. */
  const boxes = new Map(names.map((name) => [name, {} as EventTarget]));
  const picks = new Map<string, PickState>();
  const cells = new Map<string, EditState>();
  for (const widget of widgets) {
    if (widget.kind === "picker") picks.set(widget.name, IDLE_PICK_STATE);
    else cells.set(widget.name, IDLE_EDIT_STATE);
  }
  const ordinals = new Map<string, number>(names.map((name) => [name, 0]));
  const armed = new Map<
    string,
    { handlers: Map<string, (signal: RetireSignal) => void>; teardown: () => void }
  >();
  const peak = { alerts: 0 };

  const stateOf = (name: string): EditState =>
    picks.get(name) ?? cells.get(name) ?? IDLE_EDIT_STATE;
  const refusing = () => names.filter((name) => stateOf(name).status.kind === "failed");
  const alerts = () => refusing().length;

  /** The operator chose (picker) or committed an edit (cell); one ordinal each. */
  function commit(name: string) {
    const edit = (ordinals.get(name) ?? 0) + 1;
    ordinals.set(name, edit);
    const pick = picks.get(name);
    if (pick !== undefined) {
      picks.set(name, reducePick(pick, { kind: "choosing", edit, option: CHOICE }));
    } else {
      const opened = reduceEdit(stateOf(name), { kind: "editing", edit });
      cells.set(name, reduceEdit(opened, { kind: "committed", edit }));
    }
    syncArming();
    return page;
  }

  /** That write answered — and a refusal then takes the page's one slot. */
  function answer(name: string, outcome: SaveOutcome) {
    const edit = ordinals.get(name) ?? 0;
    const pick = picks.get(name);
    if (pick !== undefined) {
      picks.set(name, reducePick(pick, { kind: "settled", edit, option: CHOICE, outcome }));
    } else {
      cells.set(name, reduceEdit(stateOf(name), { kind: "settled", edit, outcome }));
    }
    syncArming();
    return page;
  }

  function abandon(name: string, edit: number, move: RetireMove) {
    const pick = picks.get(name);
    if (pick !== undefined) {
      picks.set(name, reducePick(pick, { kind: "abandoned", edit, move }));
    } else {
      cells.set(name, reduceEdit(stateOf(name), { kind: "abandoned", edit, move }));
    }
  }

  /** The effect: armed while, and only while, this widget shows a refusal. */
  function syncArming() {
    for (const name of names) {
      const showing = stateOf(name).status.kind === "failed";
      const running = armed.get(name);
      if (showing && running === undefined) {
        const edit = stateOf(name).edit;
        const handlers = new Map<string, (signal: RetireSignal) => void>();
        const retire = (move: RetireMove) => {
          abandon(name, edit, move);
          syncArming();
        };
        const host: RetireHost = {
          contains: (target) => target === boxes.get(name),
          listen: (type, handler) => {
            handlers.set(type, handler);
            return () => handlers.delete(type);
          },
        };
        const disarm = armRetire(host, retire);
        // registered BEFORE the slot is taken, so a displaced holder that
        // retires itself re-enters this function and finds its own entry.
        armed.set(name, { handlers, teardown: () => disarm() });
        const release = takeRefusalSlot(() => retire({ kind: "superseded" }));
        const entry = armed.get(name);
        if (entry !== undefined) {
          entry.teardown = () => {
            release();
            disarm();
          };
        }
      } else if (!showing && running !== undefined) {
        armed.delete(name);
        running.teardown();
      }
    }
    peak.alerts = Math.max(peak.alerts, alerts());
  }

  /** One page-wide signal, seen by every widget that is listening for it. */
  function broadcast(type: string, signal: RetireSignal) {
    for (const entry of [...armed.values()]) entry.handlers.get(type)?.(signal);
    syncArming();
  }

  const page = {
    commit,
    answer,
    /** Focus landed in `name` — a Tab, or the field an opening widget focuses. */
    focusOn(name: string) {
      broadcast("focusin", { target: boxes.get(name) ?? null });
      return page;
    },
    /** A pointer press landed in `name`, or on the page itself (`null`). */
    pressOn(name: string | null) {
      broadcast("pointerdown", {
        target: name === null ? null : (boxes.get(name) ?? null),
      });
      return page;
    },
    escape() {
      broadcast("keydown", { target: null, key: "Escape" });
      return page;
    },
    /** What `document.querySelectorAll('[role=alert]').length` would read. */
    alerts,
    refusing,
    statusOf: (name: string) => stateOf(name).status,
    chosenBy: (name: string) => picks.get(name)?.chosen ?? null,
    /** The most alerts that were ever on screen at one moment. */
    peakAlerts: () => peak.alerts,
    /** What the open panel draws for a picker — the operator's own evidence. */
    panelOf: (name: string): cheerio.CheerioAPI =>
      cheerio.load(
        renderToStaticMarkup(
          createElement(PickerPanel, {
            window: windowOf(),
            query: "",
            current: picks.get(name)?.chosen?.id ?? null,
            status: stateOf(name).status,
            onQuery: () => {},
            onChoose: () => {},
          }),
        ),
      ),
    /** Release everything this page still holds — the page navigating away. */
    close() {
      for (const [name, entry] of [...armed.entries()]) {
        armed.delete(name);
        entry.teardown();
      }
    },
  };
  return page;
}

const VENUE_REFUSED: SaveOutcome = {
  ok: false,
  message: 'insert or update on table "events" violates foreign key constraint (23503)',
};
const NOTE_REFUSED: SaveOutcome = {
  ok: false,
  message: 'null value in column "note" violates not-null constraint (23502)',
};

/** Both widgets, so the page's one slot has two claimants — the whole point. */
const PAGE = [
  { name: "venue_id", kind: "picker" },
  { name: "note", kind: "cell" },
] as const;

describe("a refused choice ends on the moves that end a refused edit", () => {
  it("stands where it arrived, so nothing below is vacuous", () => {
    // A refused choice is REPORTED, never swallowed: it is on no clock and it
    // stands until the operator moves (campaign admin-window/BUG-0107).
    const page = refusalPage(PAGE).commit("venue_id").answer("venue_id", VENUE_REFUSED);
    expect(page.statusOf("venue_id")).toEqual({
      kind: "failed",
      message: VENUE_REFUSED.message,
    });
    expect(page.alerts()).toEqual(1);
    expect(page.panelOf("venue_id")('[role="alert"]')).toHaveLength(1);
    page.close();
  });

  it("ends on a press outside the widget, on focus landing elsewhere, and on Escape", () => {
    // The three page-wide moves the picker armed none of: its only listener
    // was the OPEN panel's `onKeyDown`, so a press anywhere else, a Tab, and an
    // Escape from anywhere but inside the panel all left the red line standing.
    const moves: Record<string, (page: ReturnType<typeof refusalPage>) => unknown> = {
      "a press outside": (page) => page.pressOn(null),
      "focus landing on another field": (page) => page.focusOn("note"),
      "Escape from wherever focus is": (page) => page.escape(),
    };
    for (const [move, make] of Object.entries(moves)) {
      const page = refusalPage(PAGE).commit("venue_id").answer("venue_id", VENUE_REFUSED);
      make(page);
      expect(page.statusOf("venue_id").kind, move).toEqual("idle");
      expect(page.alerts(), move).toEqual(0);
      expect(page.panelOf("venue_id")('[role="alert"]'), `${move}, on screen`).toHaveLength(
        0,
      );
      page.close();
    }
  });

  it("keeps it while the operator is still inside the widget", () => {
    // The negative fixture the rule is bought on (LESSONS 3): a picker that
    // retired on every move would pass every test above and delete the
    // sentence under the operator reaching back into the list to choose again.
    const page = refusalPage(PAGE).commit("venue_id").answer("venue_id", VENUE_REFUSED);
    page.pressOn("venue_id");
    expect(page.alerts(), "a press on the panel is not walking away").toEqual(1);
    page.focusOn("venue_id");
    expect(page.alerts(), "nor is the search box taking focus").toEqual(1);
    expect(page.panelOf("venue_id")('[role="alert"]')).toHaveLength(1);
    page.pressOn(null);
    expect(page.alerts(), "a press outside it is").toEqual(0);
    page.close();
  });

  it("never retires a choice whose write is still in flight", () => {
    // admin-window/BUG-0107 criterion 3, on this widget: Escape does not
    // cancel a PATCH, and retiring here would hide a failed write rather than
    // report it. Nothing is even armed while a choice is saving.
    const saving = reducePick(IDLE_PICK_STATE, {
      kind: "choosing",
      edit: 1,
      option: CHOICE,
    });
    for (const move of [
      { kind: "press", inside: false },
      { kind: "press", inside: true },
      { kind: "focus", inside: false },
      { kind: "focus", inside: true },
      { kind: "escape" },
      { kind: "superseded" },
    ] as const) {
      expect(retiresRefusal(saving.status, move), `${move.kind} on a saving choice`).toBe(
        false,
      );
      expect(
        reducePick(saving, { kind: "abandoned", edit: 1, move }),
        `${move.kind} on a saving choice`,
      ).toBe(saving);
    }
    const page = refusalPage(PAGE).commit("venue_id");
    page.pressOn(null).focusOn("note").escape();
    expect(page.statusOf("venue_id").kind, "the write is still running").toEqual("saving");
    page.answer("venue_id", VENUE_REFUSED);
    expect(page.alerts(), "and its answer still reaches the screen").toEqual(1);
    page.close();
  });

  it("never stands beside a cell's refusal, in either arrival order", () => {
    // admin-window/BUG-0107 criterion 2, across the two widgets: both writes
    // are committed before either answers, so NO move of the operator's falls
    // between the two answers and only the page's one slot can decide. The
    // measured cost of two panels was one painted over the other, 273x28px.
    for (const [first, second] of [
      ["venue_id", "note"],
      ["note", "venue_id"],
    ]) {
      const page = refusalPage(PAGE);
      // an earlier choice that DID land, so the retirement below has a linked
      // row it must not un-say
      page.commit("venue_id").answer("venue_id", { ok: true });
      expect(page.chosenBy("venue_id")).toBe(CHOICE);

      page.commit(first);
      page.commit(second);
      page.answer(first, first === "note" ? NOTE_REFUSED : VENUE_REFUSED);
      expect(page.refusing(), `${first} answered first`).toEqual([first]);
      page.answer(second, second === "note" ? NOTE_REFUSED : VENUE_REFUSED);
      expect(page.refusing(), `${second} took the page's one slot`).toEqual([second]);
      expect(page.peakAlerts(), "at every moment of the sequence").toEqual(1);
      expect(page.chosenBy("venue_id"), "and the linked row is not un-said").toBe(CHOICE);
      page.close();
    }
  });

  /**
   * Criterion 3: ONE adapter, shared — not a second copy of the listener
   * wiring, which is the defect this ticket is about one level up. The picker
   * names the cell's exported units and owns no listener of its own; the DOM
   * adapter is exported from the cell, where it used to be inline.
   */
  it("arms the page-wide rule through the cell's own adapter, copying no listener", () => {
    const listening = (text: string) =>
      codeLinesIn(text).filter((line) => /\.(?:add|remove)EventListener\s*\(/.test(line));
    const picker = sourceText("src/components/records/entity-picker.tsx");
    expect(picker, "the one DOM adapter, the cell's").toContain("domRetireHost");
    expect(listening(picker), "and no listener wiring of its own").toEqual([]);

    // The two fixtures the guard is proved on: one it MUST flag, and one it
    // must not (a comment naming the mechanism is not a listener).
    expect(listening("owner.addEventListener(type, wrapped, true);\n")).toHaveLength(1);
    expect(
      listening("/** The moves reach it by addEventListener(...) — the cell's. */\n"),
    ).toEqual([]);

    // ...and the adapter is exported from the cell, so the two cannot drift.
    expect(
      sourceText("src/components/EditableCell.tsx"),
      "extracted from the cell's effect, not copied out of it",
    ).toContain("export function domRetireHost");
  });
});

/* ── focus, and the one meaning of Escape ─────────────────────────────────── */

/**
 * Where focus is, as this widget's own controls see it — campaign
 * admin-window/DEBT-0013.
 *
 * `tests/offline` is environment node with no jsdom (STACK.md §4), so
 * `document.activeElement` is modelled rather than read: five places focus can
 * be, one of which is nowhere at all. The moves below are the browser's own
 * rules about it, written once — a disabled control loses focus, an unmounted
 * one loses focus, a press on a button focuses it — and everything the PICKER
 * decides comes from the shipped `pickerFocus`, `closesPanel`, `armRetire` and
 * `reducePick`. Nothing about the decision is restated here.
 */
type Where = "nowhere" | "toggle" | "search" | "option" | "elsewhere";

/**
 * The picker's shell, composed the way the component composes it: the reducer,
 * the two `armRetire` arms (the panel's Escape and the refusal's retirement),
 * and the focus effect, each run after every move exactly as React runs an
 * effect after a render.
 *
 * It is the cheapest thing that can answer "where is focus after the operator
 * does this", which is the whole of admin-window/DEBT-0013 — `grep -c
 * '\.focus()'` was 2 in `EditableCell.tsx` and 0 here, and the three moments
 * below are what that zero cost the operator.
 */
function pickerShell() {
  /** Stand-ins for the widget's own box and something else on the page. */
  const box = {} as EventTarget;
  const away = {} as EventTarget;

  let open = false;
  /** What the focus effect last settled for — `pickerFocus`'s `was`. */
  let was = false;
  /** And the status it settled for — `pickerFocus`'s `wasStatus`. */
  let wasStatus: Status["kind"] = IDLE_PICK_STATE.status.kind;
  let pick: PickState = IDLE_PICK_STATE;
  let picks = 0;
  /** The operator arrived on this page and is somewhere on it, not here. */
  let where: Where = "elsewhere";
  /** Every place focus has been left after a settled move, in order. */
  const trail: Where[] = [];

  const listeners = new Map<string, Set<(signal: RetireSignal) => void>>();
  const host: RetireHost = {
    contains: (target) => target === box,
    listen: (type, handler) => {
      const set = listeners.get(type) ?? new Set();
      listeners.set(type, set);
      set.add(handler);
      return () => set.delete(handler);
    },
  };

  let panelArm: (() => void) | null = null;
  let refusalArm: { disarm: () => void; release: () => void } | null = null;

  /** The panel going away takes whatever focus it was holding with it. */
  function panelUnmounted() {
    if (where === "search" || where === "option") where = "nowhere";
  }

  function closePanel() {
    if (!open) return;
    open = false;
    panelUnmounted();
  }

  /** The two effects' arming, kept in step with the state they are keyed on. */
  function syncArming() {
    if (open && panelArm === null) {
      panelArm = armRetire(host, (move) => {
        if (!closesPanel(move)) return;
        closePanel();
      });
    } else if (!open && panelArm !== null) {
      panelArm();
      panelArm = null;
    }

    const refusing = pick.status.kind === "failed";
    if (refusing && refusalArm === null) {
      const edit = pick.edit;
      const retire = (move: RetireMove) => {
        pick = reducePick(pick, { kind: "abandoned", edit, move });
        syncArming();
      };
      const disarm = armRetire(host, retire);
      refusalArm = { disarm, release: () => {} };
      const release = takeRefusalSlot(() => retire({ kind: "superseded" }));
      if (refusalArm !== null) refusalArm.release = release;
    } else if (!refusing && refusalArm !== null) {
      const arm = refusalArm;
      refusalArm = null;
      arm.release();
      arm.disarm();
    }
  }

  /**
   * What the focus effect was last RUN for. The shipped effect is keyed
   * `[open, status]` (entity-picker.tsx), so React runs it when one of those
   * two changes and on no other move — a press that focuses nothing, a Tab,
   * a keystroke in the search box all leave it asleep. Modelling it as "after
   * every move" would let the rule re-decide focus at moments the browser
   * never asks it to, and hide what it does with the moments it is asked
   * (admin-window/BUG-0149).
   */
  let ranForOpen: boolean | null = null;
  let ranForStatus: Status | null = null;

  /** The focus effect: the shipped rule, and the one line of browser it buys. */
  function runFocus() {
    if (ranForStatus !== null && open === ranForOpen && pick.status === ranForStatus) {
      return;
    }
    ranForOpen = open;
    ranForStatus = pick.status;
    const verdict = pickerFocus({
      open,
      was,
      status: pick.status,
      wasStatus,
      // `focusIsAdrift(root.current)` reads exactly this: the widget's root is
      // a `div` no browser makes `activeElement`, so the answer is the plain
      // page-level one — focus is on nothing at all.
      adrift: where === "nowhere",
    });
    if (verdict === "wait") return;
    was = open;
    wasStatus = pick.status.kind;
    if (verdict === "search") where = "search";
    else if (verdict === "toggle") where = "toggle";
  }

  /** React, after a render: the effects, then what the operator can see. */
  function settle() {
    syncArming();
    runFocus();
    trail.push(where);
  }

  function broadcast(type: string, signal: RetireSignal) {
    for (const handler of [...(listeners.get(type) ?? [])]) handler(signal);
  }

  const shell = {
    /** The operator presses — or Enters on — the Choose button. */
    chooseButton() {
      where = "toggle";
      if (open) closePanel();
      else open = true;
      settle();
      return shell;
    },
    /** They activate a row of the list: Enter on the option they tabbed to. */
    pickRow(option: PickerOption = CHOICE) {
      where = "option";
      picks += 1;
      pick = reducePick(pick, { kind: "choosing", edit: picks, option });
      // Every option goes `disabled` while the write runs
      // (admin-window/BUG-0097), and a browser drops focus off a control it
      // disables — the measured way this widget lost it.
      if (pick.status.kind === "saving" && where === "option") where = "nowhere";
      settle();
      return shell;
    },
    /** That write answered. A landed choice closes the panel. */
    answer(outcome: SaveOutcome, option: PickerOption = CHOICE) {
      if (outcome.ok) closePanel();
      pick = reducePick(pick, { kind: "settled", edit: picks, option, outcome });
      settle();
      return shell;
    },
    /** Escape, from wherever focus happens to be — the page hears it. */
    escape() {
      broadcast("keydown", { target: null, key: "Escape" });
      settle();
      return shell;
    },
    /** A pointer press on a part of the page that is not this widget. */
    pressAway() {
      broadcast("pointerdown", { target: away });
      settle();
      return shell;
    },
    /**
     * A pointer press INSIDE the widget that lands on nothing focusable — the
     * panel's own hint line, its window line, the gap between two rows. The
     * browser blurs whatever held focus and leaves it on `document.body`; the
     * press is inside the box, so it is not the operator walking away and
     * `retiresRefusal` is right to make nothing of it.
     */
    pressInsideOnNothing() {
      where = "nowhere";
      broadcast("pointerdown", { target: box });
      settle();
      return shell;
    },
    /** A Tab landing somewhere else on the page. */
    tabAway() {
      where = "elsewhere";
      broadcast("focusin", { target: away });
      settle();
      return shell;
    },
    /** A Tab landing back inside this widget. */
    tabBackIn() {
      where = "search";
      broadcast("focusin", { target: box });
      settle();
      return shell;
    },
    /** Another widget on the page states a refusal and takes the page's slot. */
    otherWidgetRefuses() {
      const release = takeRefusalSlot(() => {});
      settle();
      return { ...shell, release };
    },
    isOpen: () => open,
    focus: () => where,
    trail: () => [...trail],
    status: () => pick.status,
    chosen: () => pick.chosen,
    /** The page navigating away: everything this shell still holds, released. */
    close() {
      panelArm?.();
      panelArm = null;
      const arm = refusalArm;
      refusalArm = null;
      arm?.release();
      arm?.disarm();
    },
  };
  return shell;
}

describe("Escape means one thing wherever focus is", () => {
  /**
   * `PICKER_HINT` says "Escape cancels" where the operator is about to choose,
   * with no qualification. The handler was the OPEN PANEL's `onKeyDown`, so it
   * fired only while focus was still inside the panel — and after a refusal
   * the same key, heard page-wide by admin-window/BUG-0119's rule, retired the
   * red line and left the panel standing. One sentence, two outcomes.
   */
  it("closes the panel from outside it, exactly as it does from inside", () => {
    const inside = pickerShell().chooseButton();
    expect(inside.focus(), "the panel opens focused").toEqual("search");
    inside.escape();
    expect(inside.isOpen(), "Escape with focus in the panel").toBe(false);
    inside.close();

    const outside = pickerShell().chooseButton();
    outside.tabAway();
    expect(outside.focus(), "the operator has tabbed out of the widget").toEqual(
      "elsewhere",
    );
    outside.escape();
    expect(outside.isOpen(), "Escape with focus anywhere else on the page").toBe(false);
    outside.close();
  });

  it("gives a refused choice the same two outcomes from inside and from outside", () => {
    const ends: Record<string, ReturnType<typeof pickerShell>> = {};
    for (const from of ["inside the panel", "outside the widget"]) {
      const shell = pickerShell().chooseButton().pickRow().answer(VENUE_REFUSED);
      expect(shell.status().kind, `${from}: the refusal is on screen`).toEqual("failed");
      expect(shell.isOpen(), `${from}: and the panel is still open`).toBe(true);
      if (from === "outside the widget") shell.tabAway();
      shell.escape();
      ends[from] = shell;
    }
    // The same key, the same two things: the red line retired and the panel
    // closed — whichever side of the widget focus was on.
    expect(ends["inside the panel"].status()).toEqual(ends["outside the widget"].status());
    expect(ends["inside the panel"].status().kind).toEqual("idle");
    for (const [from, shell] of Object.entries(ends)) {
      expect(shell.isOpen(), from).toBe(false);
      shell.close();
    }
  });

  it("closes on Escape and on no other move the page-wide listeners carry", () => {
    // admin-window/BUG-0119's ruling, not reopened: a retirement retires the
    // SENTENCE beside the field and never shuts the list the operator is
    // reading. The negative fixtures this rule is bought on (LESSONS 8).
    const moves: Record<string, (shell: ReturnType<typeof pickerShell>) => unknown> = {
      "a press elsewhere on the page": (shell) => shell.pressAway(),
      "a Tab landing outside the widget": (shell) => shell.tabAway(),
      "a Tab landing back inside it": (shell) => shell.tabBackIn(),
    };
    for (const [move, make] of Object.entries(moves)) {
      const shell = pickerShell().chooseButton().pickRow().answer(VENUE_REFUSED);
      make(shell);
      expect(shell.isOpen(), `${move}: the panel is still the operator's`).toBe(true);
      shell.close();
    }

    // ...including the page's one refusal slot changing hands under it.
    const shell = pickerShell().chooseButton().pickRow().answer(VENUE_REFUSED);
    const other = shell.otherWidgetRefuses();
    expect(shell.status().kind, "the older refusal yielded the page's slot").toEqual(
      "idle",
    );
    expect(shell.isOpen(), "and the panel the operator is reading stayed open").toBe(true);
    other.release();
    shell.close();
  });

  it("answers Escape and refuses every other move, as one decision", () => {
    expect(closesPanel({ kind: "escape" })).toBe(true);
    for (const move of [
      { kind: "press", inside: true },
      { kind: "press", inside: false },
      { kind: "focus", inside: true },
      { kind: "focus", inside: false },
      { kind: "superseded" },
    ] as const) {
      expect(closesPanel(move), `${move.kind}`).toBe(false);
    }
  });

  it("hears the key through the page-wide listeners, not a handler of its own", () => {
    // The structural half: a key handler bound to the panel is exactly the
    // defect — it hears Escape only while focus is inside the panel. One path,
    // through the shared adapter, or the two meanings come back.
    const picker = sourceText("src/components/records/entity-picker.tsx");
    expect(codeLinesIn(picker).filter((line) => /onKeyDown/.test(line))).toEqual([]);
    expect(picker, "the shared arming rule").toContain("armRetire(domRetireHost(box)");
    expect(picker, "and the one answer about what a move means").toContain(
      "closesPanel(move)",
    );
  });
});

describe("where the picker leaves focus", () => {
  it("moves focus into the panel when the picker opens", () => {
    // LOOK_AND_FEEL bar 9: a panel that opens without receiving focus is
    // reachable only by tabbing forward through however many rows the search
    // returned. It opens at the place the operator acts — the search field.
    const shell = pickerShell();
    expect(shell.focus(), "before: wherever the operator was").toEqual("elsewhere");
    shell.chooseButton();
    expect(shell.focus()).toEqual("search");
    shell.close();
  });

  it("returns focus to the Choose button on every way the panel closes", () => {
    const landed = pickerShell().chooseButton().pickRow().answer({ ok: true });
    expect(landed.isOpen(), "a choice that lands closes the panel").toBe(false);
    expect(landed.focus(), "a choice that lands").toEqual("toggle");
    expect(landed.chosen(), "and the row it chose is linked").toEqual(CHOICE);
    landed.close();

    const escaped = pickerShell().chooseButton().escape();
    expect(escaped.focus(), "Escape").toEqual("toggle");
    escaped.close();

    const toggled = pickerShell().chooseButton().chooseButton();
    expect(toggled.isOpen(), "the Choose button closes it again").toBe(false);
    expect(toggled.focus(), "the Choose button, which already holds it").toEqual("toggle");
    toggled.close();
  });

  it("keeps focus on a live control while the write disables every option", () => {
    // The measured drop: the activated option goes `disabled`
    // (admin-window/BUG-0097) and the browser blurs it to `document.body`, so
    // the operator's next Tab restarts at the top of the document. The Choose
    // button is disabled for the same write, so the search field — the one
    // control of this widget still able to hold focus — is where it goes.
    const shell = pickerShell().chooseButton().pickRow();
    expect(shell.status().kind).toEqual("saving");
    expect(shell.focus()).toEqual("search");
    shell.close();
  });

  it("never leaves focus on the document, on any path a choice can take", () => {
    const paths: Record<string, () => ReturnType<typeof pickerShell>> = {
      "a choice that lands": () =>
        pickerShell().chooseButton().pickRow().answer({ ok: true }),
      "a choice that is refused": () =>
        pickerShell().chooseButton().pickRow().answer(VENUE_REFUSED),
      "a refusal the operator then escapes": () =>
        pickerShell().chooseButton().pickRow().answer(VENUE_REFUSED).escape(),
      "a refusal another widget supersedes": () => {
        const shell = pickerShell().chooseButton().pickRow().answer(VENUE_REFUSED);
        shell.otherWidgetRefuses().release();
        return shell;
      },
      "a second choice made after the first was refused": () =>
        pickerShell()
          .chooseButton()
          .pickRow()
          .answer(VENUE_REFUSED)
          .pickRow(SECOND)
          .answer({ ok: true }, SECOND),
    };
    for (const [path, walk] of Object.entries(paths)) {
      const shell = walk();
      expect(shell.trail(), path).not.toContain("nowhere");
      expect(shell.focus(), `${path}, at rest`).not.toEqual("nowhere");
      shell.close();
    }
  });

  // QA's pin for admin-window/BUG-0149, flipped from `it.fails` to a plain
  // `it` by the fix: `pickerFocus` now acts on the status EDGE, so the answer
  // arriving is a moment it has something to say about.
  it("puts focus back on a live control when an answer lands on a panel focus has slipped out of (admin-window/BUG-0149)", () => {
    // admin-window/BUG-0149. Criterion 3 names three moments at which focus
    // must be on a real focusable element of this widget: after a refusal,
    // after a save that lands, and after a save another widget supersedes.
    // `pickerFocus`'s no-transition branch used to rescue focus for exactly
    // ONE status — `open && status.kind === "saving"` — so a panel still open
    // when the answer arrived was left with focus wherever it was, and
    // "wherever it was" includes `document.body`. Nothing about that is
    // hypothetical: the operator presses the panel's own hint line, or the
    // gap between two rows, while the write runs. That press focuses nothing,
    // so the browser leaves focus on the body; it is INSIDE the widget, so it
    // is not the operator walking away and no rule reads it as a choice.
    const shell = pickerShell().chooseButton().pickRow();
    expect(shell.focus(), "the write parked it on the search field").toEqual("search");
    shell.pressInsideOnNothing();
    expect(shell.focus(), "and the press blurred it to the document").toEqual("nowhere");
    expect(shell.status().kind, "the write is still in flight").toEqual("saving");

    shell.answer(VENUE_REFUSED);
    expect(shell.status().kind, "the choice is refused").toEqual("failed");
    expect(shell.isOpen(), "and a refusal keeps the panel open").toBe(true);
    expect(
      shell.focus(),
      "criterion 3: after a refusal, focus is on a real control of this widget",
    ).not.toEqual("nowhere");
    shell.close();
  });

  // QA's pin for admin-window/BUG-0149, flipped from `it.fails` to a plain
  // `it` by the fix: the `idle` a retirement leaves behind is an edge too.
  it("puts focus back on a live control when another widget supersedes a refusal it is holding (admin-window/BUG-0149)", () => {
    // admin-window/BUG-0149, the same branch and criterion 3's third moment:
    // the page's one refusal slot changes hands and this picker's statement
    // goes `idle` with the panel still open — an edge the no-transition branch
    // had no answer for either.
    const shell = pickerShell().chooseButton().pickRow();
    shell.pressInsideOnNothing();
    shell.answer(VENUE_REFUSED);
    const other = shell.otherWidgetRefuses();
    expect(shell.status().kind, "the older refusal yielded the page's slot").toEqual(
      "idle",
    );
    expect(shell.isOpen(), "and the panel the operator is reading stayed open").toBe(true);
    expect(
      shell.focus(),
      "criterion 3: after a superseded save, focus is on a real control of this widget",
    ).not.toEqual("nowhere");
    other.release();
    shell.close();
  });

  it("puts adrift focus on a live control at every edge that ends a write", () => {
    // admin-window/BUG-0149, the whole transition table rather than the two
    // moments that were measured. An edge that ends a write is `failed` or
    // `saved` arriving from the write, and the `idle` a retirement leaves
    // behind; the panel is open or closed; focus is adrift or the operator's.
    // Every arm is pinned BOTH ways, because a rule that only ever moved focus
    // would pass the criterion and yank it out of wherever the operator went.
    const ends: Record<string, { status: Status; wasStatus: Status["kind"] }> = {
      "a refusal": { status: { kind: "failed", message: "no" }, wasStatus: "saving" },
      "a save that landed": { status: { kind: "saved" }, wasStatus: "saving" },
      "a refusal another widget superseded": {
        status: { kind: "idle" },
        wasStatus: "failed",
      },
    };
    for (const [end, { status, wasStatus }] of Object.entries(ends)) {
      for (const open of [true, false]) {
        expect(
          pickerFocus({ open, was: open, status, wasStatus, adrift: true }),
          `${end}, panel ${open ? "open" : "closed"}, focus on nothing at all`,
        ).toEqual(open ? "search" : "toggle");
        expect(
          pickerFocus({ open, was: open, status, wasStatus, adrift: false }),
          `${end}, panel ${open ? "open" : "closed"}, focus where they put it`,
        ).toEqual("leave");
      }
    }
  });

  it("moves focus for no edge a control did not move for", () => {
    // The negative half of the rule above, and what keeps it from being the
    // one-line fix (dropping `&& status.kind === "saving"`), which would yank
    // an operator sitting in an open panel into the search box for a status
    // they were never shown changing.
    for (const open of [true, false]) {
      for (const kind of ["idle", "saved", "failed"] as const) {
        const status: Status = kind === "failed" ? { kind, message: "no" } : { kind };
        expect(
          pickerFocus({ open, was: open, status, wasStatus: kind, adrift: true }),
          `${kind} still ${kind}, panel ${open ? "open" : "closed"}: nothing happened`,
        ).toEqual("leave");
      }
    }
    // A confirmation retiring on its own 1.5s clock (admin-window/BUG-0111) is
    // a status edge that moves no control: it takes a word off the screen
    // seconds after the fact, so focus is not jumped for it even when adrift.
    for (const open of [true, false]) {
      expect(
        pickerFocus({
          open,
          was: open,
          status: { kind: "idle" },
          wasStatus: "saved",
          adrift: true,
        }),
        `a confirmation elapsing, panel ${open ? "open" : "closed"}`,
      ).toEqual("leave");
    }
    // And a write STARTING is still the one edge with nowhere to aim once the
    // panel is closed: the Choose button is disabled for the whole of it, so
    // the verdict waits rather than spending itself on a no-op.
    expect(
      pickerFocus({
        open: false,
        was: false,
        status: { kind: "saving" },
        wasStatus: "idle",
        adrift: true,
      }),
      "a write in flight with the panel closed: nothing can hold focus yet",
    ).toEqual("wait");
  });

  it("puts focus back on the Choose button when a closed panel's refusal is superseded", () => {
    // admin-window/BUG-0149's closed arm, walked rather than asserted on the
    // rule: Escape during the write closes the panel (it does not cancel the
    // PATCH), the refusal arrives on the button, the operator presses a part
    // of the row that focuses nothing, and then another widget takes the
    // page's one refusal slot.
    const shell = pickerShell().chooseButton().pickRow().escape();
    shell.answer(VENUE_REFUSED);
    expect(shell.isOpen(), "Escape closed the panel mid-write").toBe(false);
    expect(shell.focus(), "the refusal landed focus on the button").toEqual("toggle");
    shell.pressInsideOnNothing();
    expect(shell.focus(), "and a press on nothing blurred it to the document").toEqual(
      "nowhere",
    );
    const other = shell.otherWidgetRefuses();
    expect(shell.status().kind, "the older refusal yielded the page's slot").toEqual(
      "idle",
    );
    expect(
      shell.focus(),
      "criterion 3: the widget's live control with the panel closed is the button",
    ).toEqual("toggle");
    other.release();
    shell.close();
  });

  it("waits for the Choose button to be real before handing focus back", () => {
    // The ordering that makes this a rule rather than a `.focus()` at the end
    // of `choose()` (admin-window/BUG-0069): Escape does not cancel a PATCH,
    // and the button it would aim at is `disabled` for the whole of that
    // write — focusing a disabled control is a no-op that leaves focus on the
    // body anyway.
    expect(
      pickerFocus({
        open: false,
        was: true,
        status: { kind: "saving" },
        wasStatus: "saving",
        adrift: true,
      }),
    ).toEqual("wait");
    const shell = pickerShell().chooseButton().pickRow().escape();
    expect(shell.isOpen(), "Escape closed the panel mid-write").toBe(false);
    expect(shell.status().kind, "and the write is still running").toEqual("saving");
    // The ONE window in which this widget holds no focus, and it is the cell's
    // own: the operator dismissed the panel while the write was in flight, so
    // the search field is gone and the Choose button is disabled until the
    // answer arrives — there is no control of this widget left to hold focus,
    // and aiming at the disabled one would leave it on the body regardless.
    expect(shell.focus(), "nothing of this widget can hold it yet").toEqual("nowhere");
    shell.answer(VENUE_REFUSED);
    expect(shell.focus(), "and it lands the moment the button is real").toEqual("toggle");
    shell.close();
  });

  it("leaves focus where the operator has since put it, on every leg", () => {
    // The negative fixture the rule is bought on: a picker that focused
    // unconditionally would pass every test above and yank focus out of
    // whatever the operator walked to during a seconds-long write.
    for (const status of [{ kind: "saved" }, { kind: "failed", message: "no" }] as const) {
      expect(
        pickerFocus({ open: false, was: true, status, wasStatus: "saving", adrift: false }),
        `${status.kind}: the panel closed while they were elsewhere`,
      ).toEqual("leave");
    }
    expect(
      pickerFocus({
        open: true,
        was: true,
        status: { kind: "saving" },
        wasStatus: "idle",
        adrift: false,
      }),
      "the write disabled the options while they were elsewhere",
    ).toEqual("leave");

    const shell = pickerShell().chooseButton().pickRow();
    shell.tabAway();
    expect(shell.focus(), "they walked off mid-write, on purpose").toEqual("elsewhere");
    shell.answer({ ok: true });
    expect(shell.focus(), "and its answer does not yank focus back").toEqual("elsewhere");
    expect(shell.isOpen(), "the panel still closed on the choice that landed").toBe(false);
    shell.close();
  });

  it("steals no focus from a page that has merely drawn a picker", () => {
    // Acting on the TRANSITION, not on the flag: a record page draws one of
    // these at rest, and a widget that focused itself on mount would fight
    // every other one on the page.
    for (const adrift of [true, false]) {
      expect(
        pickerFocus({
          open: false,
          was: false,
          status: { kind: "idle" },
          wasStatus: "idle",
          adrift,
        }),
        `adrift=${adrift}`,
      ).toEqual("leave");
    }
    // ...and an operator who deliberately shift-tabs back to the Choose button
    // with the panel open is not bounced forward into the list again.
    expect(
      pickerFocus({
        open: true,
        was: true,
        status: { kind: "idle" },
        wasStatus: "idle",
        adrift: true,
      }),
      "no edge at all — no panel move, no answer: focus is the operator's",
    ).toEqual("leave");
  });

  it("offers the whole path to a keyboard, with nothing taken out of the order", () => {
    // LOOK_AND_FEEL bar 9 and criterion 4's offline half: choose, search, pick
    // — every control the panel draws is a natively focusable element in
    // document order, and none is taken out of the tab order. The ring itself
    // is one rule in `globals.css` and is graded at the walk.
    const $ = cheerio.load(panel(""));
    expect($("[tabindex]"), "nothing is taken out of the tab order").toHaveLength(0);
    const search = $("input");
    expect(search.attr("type"), "the search field is a real input").toEqual("search");
    expect(search.attr("disabled")).toBeUndefined();
    expect($("li button"), "and every choice is a real button").toHaveLength(
      OPTIONS.length,
    );
    // Nothing that acts is a div wearing a click handler.
    expect($("[onclick]")).toHaveLength(0);
  });
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
