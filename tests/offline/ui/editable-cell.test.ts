import * as cheerio from "cheerio";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { RecordFields } from "@/components/records/record-fields";
import { FieldEditor } from "@/components/records/field-editor";
import type { RecordField } from "@/components/records/fields";
import {
  type CellLayout,
  type CellState,
  type HintSide,
  type StatusGrowth,
  cellLayout,
  hintSide,
  occupiesFlow,
  type StatusBounds,
  statusGrowth,
  statusShift,
} from "@/components/edit-cell-layout";
import {
  type EditEnding,
  type EditEvent,
  type EditState,
  EditableCell,
  EditField,
  EditStatus,
  IDLE_EDIT_STATE,
  type OpenPress,
  type SaveOutcome,
  type Status,
  confirmationDelayMs,
  editHint,
  committedValue,
  focusVerdict,
  opensCell,
  reduceEdit,
  selectOnOpen,
} from "@/components/EditableCell";
import { GENERAL_FIX, refusalFix } from "@/components/edit-refusal";
import { EM_DASH, isAbsent } from "@/lib/format";
import { hasVisibleContent } from "@/lib/verdict/decision";

import { classesOf, h, render, tagsOf, textOf } from "./markup";

/**
 * The click-to-edit cell (campaign admin-window, TASK-0004). Rendered server
 * side, so these cover the resting surface and its tokens; the edit, save and
 * revert interactions belong to the walk.
 */

const noop = async () => ({ ok: true }) as const;

describe("EditableCell", () => {
  it("shows the value in data type at rest", () => {
    const html = render(h(EditableCell, { value: "BLACKPINK", onSave: noop, label: "name" }));
    expect(html).toContain("BLACKPINK");
    expect(classesOf(html)).toContain("type-data");
  });

  it("is reachable by keyboard, not only by hovering a span", () => {
    const html = render(h(EditableCell, { value: "BLACKPINK", onSave: noop, label: "name of BLACKPINK" }));
    expect(tagsOf(html)).toContain("button");
    expect(html).toContain('aria-label="name of BLACKPINK"');
  });

  it("renders a null value as the dash, never as an empty click target", () => {
    const html = render(h(EditableCell, { value: null, onSave: noop, label: "spotify_id" }));
    expect(html).toContain(EM_DASH);
    expect(html).toContain("text-ink-disabled");
  });

  it("never suppresses the focus outline", () => {
    const html = render(h(EditableCell, { value: "x", onSave: noop, label: "name" }));
    expect(classesOf(html)).not.toContain("outline-none");
  });

  it("shows no confirmation and no failure line before anything is saved", () => {
    const html = render(h(EditableCell, { value: "x", onSave: noop, label: "name" }));
    expect(classesOf(html)).not.toContain("text-healthy");
    expect(classesOf(html)).not.toContain("text-broken");
  });
});


/**
 * How an edit ENDS, said on screen — campaign admin-window/BUG-0060.
 *
 * The cell in edit mode was one bare input and nothing else: no control, no
 * hint, no `aria-describedby`, and entering edit mode added zero text to the
 * page, so the only commit path M1 ships was discoverable by guessing.
 *
 * These render `EditField` — the pure edit-mode subtree — because
 * `renderToStaticMarkup` cannot click a button, so the state that carries the
 * hint is unreachable through `EditableCell` in this suite. They assert what
 * the operator is TOLD, never the sentence that tells them: which keys are
 * named, that the field is wired to the line naming them, and that the
 * multiline rendering does not promise something Enter does not do there.
 * A reworded hint that still names the three ways out stays green.
 */
function editMode(multiline: boolean): string {
  return render(
    h(EditField, {
      value: "Tuzi",
      label: "short_name of groups",
      hintId: "hint-1",
      multiline,
      onChange: () => {},
      onBlur: () => {},
      onKeyDown: () => {},
    }),
  );
}

/** The text of the element the field says describes it, or `null` if none. */
function describedBy(html: string): string | null {
  const $ = cheerio.load(html);
  const field = $("input, textarea").first();
  const id = field.attr("aria-describedby");
  if (!id) return null;
  const description = $(`#${id}`);
  return description.length === 0 ? null : description.text().replace(/\s+/g, " ").trim();
}

describe("a cell in edit mode says how the edit ends", () => {
  it("names both keys that end an edit, on the input and the textarea alike", () => {
    for (const multiline of [false, true]) {
      const said = textOf(editMode(multiline));
      // The verifier's own probe over the whole page, which matched nothing:
      // no prose anywhere named the commit key or the cancel key.
      expect(said, `multiline=${multiline}`).toMatch(/\bEnter\b/);
      expect(said, `multiline=${multiline}`).toMatch(/\bEscape\b/);
    }
  });

  it("says what LEAVING the field does, which is the half nothing else reveals", () => {
    // Blur commits (measured against staging on admin-window/BUG-0060: PATCH
    // 200, the value survives a reload). A surface that writes the catalog
    // when you click away has to say so before you click away.
    for (const multiline of [false, true]) {
      const said = textOf(editMode(multiline));
      expect(said, `multiline=${multiline}`).toMatch(/leav|away/i);
      expect(said, `multiline=${multiline}`).toMatch(/save/i);
    }
  });

  it("does not tell a textarea operator that Enter saves, because there it does not", () => {
    // `onKeyDown` commits on Enter only when `multiline` is false; in a
    // textarea Enter inserts a line. One sentence for both renderings would be
    // false on half of them.
    expect(editHint(true)).not.toEqual(editHint(false));
    expect(editHint(false)).toMatch(/Enter[^.]*save/i);
    expect(editHint(true)).not.toMatch(/Enter[^.]*save/i);
  });

  it("wires the field to that line, rather than leaving it to be noticed", () => {
    for (const multiline of [false, true]) {
      const description = describedBy(editMode(multiline));
      expect(description, `multiline=${multiline}`).not.toBeNull();
      expect(description, `multiline=${multiline}`).toMatch(/\bEnter\b/);
      expect(description, `multiline=${multiline}`).toMatch(/\bEscape\b/);
    }
  });

  it("still renders exactly one field, and still the right one", () => {
    // The hint is a line beside the field, never a second thing to type into.
    expect(tagsOf(editMode(false)).filter((tag) => tag === "input")).toEqual(["input"]);
    expect(tagsOf(editMode(false))).not.toContain("textarea");
    expect(tagsOf(editMode(true)).filter((tag) => tag === "textarea")).toEqual([
      "textarea",
    ]);
    expect(tagsOf(editMode(true))).not.toContain("input");
    expect(editMode(false)).toContain('aria-label="short_name of groups"');
  });

  it("says none of it at rest: a table of values is not a table of instructions", () => {
    // The hint belongs to the one cell being edited, not to every row of every
    // record page (Ben's ruling on admin-window/TASK-0025: a reason stands
    // with the record, never repeated on every line).
    const resting = render(
      h(EditableCell, { value: "Tuzi", onSave: noop, label: "short_name of groups" }),
    );
    expect(resting).not.toMatch(/\bEnter\b/);
    expect(resting).not.toMatch(/\bEscape\b/);
    expect(resting).not.toContain("aria-describedby");
  });
});


/**
 * What the cell says WHILE the write is in flight — campaign
 * admin-window/BUG-0066.
 *
 * From commit until the PATCH answered, the cell rendered only the new value
 * in a disabled button and stated no work anywhere: a write in flight and a
 * write that had landed differed by 50% opacity and nothing else (measured on
 * a production build, 2026-09-03 — a 2.087s write, zero live regions, no page
 * text matching /settl|saving|writing/). That is the state that produced
 * BUG-0060's false data-loss report.
 *
 * These render `EditStatus` — the pure status subtree — because
 * `renderToStaticMarkup` cannot click a button, so `saving` is unreachable
 * through `EditableCell` in this suite; the same wall `EditField` was
 * extracted for. They assert what the operator is TOLD and how they are told
 * it — that work is stated, in a live region, in words that are not the
 * confirmation's — never the sentence that states it. A reworded "saving…"
 * stays green; a silent in-flight state does not.
 */
const KINDS: Status[] = [
  { kind: "idle" },
  { kind: "saving" },
  { kind: "saved" },
  { kind: "failed", message: "short_name is not editable on groups" },
];

function statusMarkup(status: Status, growth?: StatusGrowth): string {
  return render(h(EditStatus, growth === undefined ? { status } : { status, growth }));
}

/** The text of the one element carrying `role`, or `null` if there is none. */
function announced(html: string, role: string): string | null {
  const $ = cheerio.load(html);
  const region = $(`[role="${role}"]`);
  if (region.length === 0) return null;
  expect(region.length, `one ${role} region`).toBe(1);
  return region.text().replace(/\s+/g, " ").trim();
}

describe("a cell whose write is in flight states that work", () => {
  it("says something, where before it said nothing at all", () => {
    // The bug, at the seam: this markup was empty.
    const said = textOf(statusMarkup({ kind: "saving" })).trim();
    expect(said.length).toBeGreaterThan(0);
    // ...and the negative fixture that keeps the check above honest: a cell
    // with no edit behind it still says nothing, so "non-empty" is a real
    // discriminator and not a property of every render.
    expect(textOf(statusMarkup({ kind: "idle" })).trim()).toEqual("");
  });

  it("announces it to assistive technology, as the confirmation already was", () => {
    // Politely: a save underway is not an interruption. The failure is.
    expect(announced(statusMarkup({ kind: "saving" }), "status")).toMatch(/\S/);
    expect(announced(statusMarkup({ kind: "saving" }), "alert")).toBeNull();
  });

  it("tells a write underway apart from one that has landed", () => {
    // The whole ticket: before, these two differed only by the button's
    // opacity, so an operator reading the row could not tell them apart.
    const inFlight = textOf(statusMarkup({ kind: "saving" })).trim();
    const landed = textOf(statusMarkup({ kind: "saved" })).trim();
    expect(inFlight).not.toEqual(landed);
    expect(inFlight).not.toEqual("");
    expect(landed).not.toEqual("");
  });

  it("keeps the statement of work off the disabled control's own label", () => {
    // LOOK_AND_FEEL's button rule: "Disabled = 50% opacity, not-allowed
    // cursor, and the label does not change — a working button never becomes
    // '…'". So the status is a sibling of the button, never inside it, and the
    // button carries the value it carried before the write started.
    const cell = render(
      h(EditableCell, { value: "Tuzi", onSave: noop, label: "short_name of groups" }),
    );
    const $ = cheerio.load(cell);
    expect($("button").length).toBe(1);
    expect($("button").text().trim()).toEqual("Tuzi");
    expect($("button [role]").length).toBe(0);
    expect(tagsOf(statusMarkup({ kind: "saving" }))).not.toContain("button");
  });

  it("still confirms in the healthy colour after the response", () => {
    const saved = statusMarkup({ kind: "saved" });
    expect(announced(saved, "status")).toMatch(/\S/);
    expect(classesOf(saved)).toContain("text-healthy");
    expect(classesOf(saved)).toContain("type-data");
  });

  it("still names the refusal, in the broken colour, as an interruption", () => {
    const message = "short_name is not editable on groups";
    const failed = statusMarkup({ kind: "failed", message });
    expect(announced(failed, "alert")).toContain(message);
    expect(classesOf(failed)).toContain("text-broken");
    expect(classesOf(failed)).toContain("type-data");
  });

  it("takes its colour from the palette in every kind, in-flight included", () => {
    // tokens.test.ts holds this rule for the primitives; it only ever rendered
    // the resting cell, so the three states reachable solely from React state
    // were unbound by it. Both files now render them.
    const RAW = (className: string) =>
      /-(gray|slate|zinc|neutral|stone|purple|violet|green|emerald|amber|orange|yellow|red|rose|blue|sky|indigo|pink|fuchsia)-\d{2,3}$/.test(
        className,
      ) || className.includes("[");
    for (const status of KINDS) {
      expect(classesOf(statusMarkup(status)).filter(RAW), status.kind).toEqual([]);
    }
    // the guard flags what it is for, so its silence above means something
    expect(["text-gray-400", "text-[13px]"].filter(RAW)).toHaveLength(2);
  });
});


/**
 * WHOSE status is on screen — campaign admin-window/BUG-0075.
 *
 * The confirmation's 1.5s clock used to be a bare `setTimeout` over a ref
 * cleared in exactly one place (the next successful save), so a clock armed by
 * an EARLIER save later reset an UNRELATED status to idle. Measured on a
 * production build 2026-09-03, `groups.short_name`: a second edit committed
 * 226ms after the first one's confirmation lost its in-flight statement at
 * +1671ms and re-enabled its button while its own PATCH was still running (it
 * answered at +1834ms — 163ms of silent, clickable window under a live write);
 * and a 403 raised inside the same window was readable for 1374ms and then
 * erased itself, leaving a cell holding the pre-edit value and nothing saying
 * the edit was refused.
 *
 * These drive `reduceEdit` and `confirmationDelayMs` — the pure seam — because
 * `renderToStaticMarkup` cannot click a button or run a clock, the same wall
 * `EditField` and `EditStatus` were extracted for (STACK.md §4). They assert
 * WHICH status is showing and until when, never the words it shows: the
 * rendering of each kind is `EditStatus`'s job above.
 *
 * The button the operator can click again is `disabled={status.kind ===
 * "saving"}` in the component, so "keeps its statement" and "stays busy" are
 * the same assertion at this seam; the walk measures the button itself.
 */
function replay(...events: EditEvent[]): EditState {
  return events.reduce(reduceEdit, IDLE_EDIT_STATE);
}

/** Edit 1 opened, committed, and confirmed — its clock is now running. */
const AFTER_FIRST_SAVE: EditEvent[] = [
  { kind: "editing", edit: 1 },
  { kind: "committed", edit: 1 },
  { kind: "settled", edit: 1, outcome: { ok: true } },
];

const REFUSAL = "short_name is not editable on groups";

describe("a status belongs to the edit that produced it", () => {
  it("keeps the second edit's in-flight statement when the first edit's clock fires", () => {
    // Measurement (1): +1671ms, the previous save's clock reached a write that
    // was still 163ms from answering, and the cell went silent under it.
    const state = replay(
      ...AFTER_FIRST_SAVE,
      { kind: "editing", edit: 2 },
      { kind: "committed", edit: 2 },
      { kind: "elapsed", edit: 1 },
    );
    expect(state.status.kind).toEqual("saving");
    expect(state.edit).toEqual(2);
  });

  it("holds that statement for the whole of the write, however the two edits interleave", () => {
    // "at any interval between the two edits" is the acceptance criterion, so
    // the earlier clock is fired at every point of the later edit's life.
    const later: EditEvent[] = [
      { kind: "editing", edit: 2 },
      { kind: "committed", edit: 2 },
    ];
    for (let at = 0; at <= later.length; at += 1) {
      const where = `first save's clock fired after ${at} of the second edit's events`;
      // whatever the clock lands between, the second edit still ends up
      // stating its own work...
      const state = replay(
        ...AFTER_FIRST_SAVE,
        ...later.slice(0, at),
        { kind: "elapsed", edit: 1 },
        ...later.slice(at),
      );
      expect(state.status.kind, where).toEqual("saving");
      // ...and the clock retired only what it was armed for: the first save's
      // own confirmation, and only while that confirmation was the one showing.
      const struck = replay(...AFTER_FIRST_SAVE, ...later.slice(0, at), {
        kind: "elapsed",
        edit: 1,
      });
      // idle before the second edit is committed (the first's own clock, or
      // the operator's reopen), and its in-flight statement once it is.
      const standing = ["idle", "idle", "saving"][at];
      expect(struck.status.kind, where).toEqual(standing);
    }
    // ...and it is that edit's OWN answer that ends it, not a clock.
    const settled = replay(
      ...AFTER_FIRST_SAVE,
      ...later,
      { kind: "elapsed", edit: 1 },
      { kind: "settled", edit: 2, outcome: { ok: true } },
    );
    expect(settled.status.kind).toEqual("saved");
  });

  it("keeps a refusal raised inside the window, and keeps its message", () => {
    // Measurement (2): readable for 1374ms, then gone — indistinguishable
    // from never having typed, since the field has already reverted.
    const state = replay(
      ...AFTER_FIRST_SAVE,
      { kind: "editing", edit: 2 },
      { kind: "committed", edit: 2 },
      { kind: "settled", edit: 2, outcome: { ok: false, message: REFUSAL } },
      { kind: "elapsed", edit: 1 },
    );
    expect(state.status).toEqual({ kind: "failed", message: REFUSAL });
  });

  it("puts a refusal on no clock at all, inside a window or outside one", () => {
    // The refusal raised OUTSIDE a window persisted indefinitely (measured at
    // +3000ms); this is what makes the two the same behaviour.
    expect(confirmationDelayMs({ kind: "failed", message: REFUSAL })).toBeNull();
    const outside = replay(
      { kind: "editing", edit: 1 },
      { kind: "committed", edit: 1 },
      { kind: "settled", edit: 1, outcome: { ok: false, message: REFUSAL } },
    );
    expect(confirmationDelayMs(outside.status)).toBeNull();
    // even its own edit's clock, were one somehow armed, does not retire it
    expect(reduceEdit(outside, { kind: "elapsed", edit: 1 })).toBe(outside);
  });

  it("still retires the confirmation on its OWN clock, and only then", () => {
    const confirmed = replay(...AFTER_FIRST_SAVE);
    expect(confirmed.status.kind).toEqual("saved");
    expect(confirmationDelayMs(confirmed.status)).toEqual(1500);
    expect(reduceEdit(confirmed, { kind: "elapsed", edit: 1 }).status.kind).toEqual("idle");
  });

  it("states the work the moment the edit is committed, on no clock", () => {
    // BUG-0066's bar, still met: the statement appears with the commit rather
    // than after a delay, and nothing retires it but its own answer.
    const committed = replay({ kind: "editing", edit: 1 }, { kind: "committed", edit: 1 });
    expect(committed.status.kind).toEqual("saving");
    expect(confirmationDelayMs(committed.status)).toBeNull();
  });

  it("never lets an earlier edit's clock touch anything, over every status it can reach", () => {
    // The general rule behind both measurements, swept rather than sampled.
    const reached: EditState[] = [
      replay(...AFTER_FIRST_SAVE, { kind: "editing", edit: 2 }),
      replay(...AFTER_FIRST_SAVE, { kind: "editing", edit: 2 }, { kind: "committed", edit: 2 }),
      replay(
        ...AFTER_FIRST_SAVE,
        { kind: "editing", edit: 2 },
        { kind: "committed", edit: 2 },
        { kind: "settled", edit: 2, outcome: { ok: true } },
      ),
      replay(
        ...AFTER_FIRST_SAVE,
        { kind: "editing", edit: 2 },
        { kind: "committed", edit: 2 },
        { kind: "settled", edit: 2, outcome: { ok: false, message: REFUSAL } },
      ),
    ];
    for (const state of reached) {
      // unchanged, and unchanged BY REFERENCE — which is what makes the
      // component's own running clock survive a stale event untouched.
      expect(reduceEdit(state, { kind: "elapsed", edit: 1 }), state.status.kind).toBe(state);
    }
    // the sweep's negative fixture: the clock that DOES belong to what is
    // showing still retires it, so "unchanged" above is a real discriminator.
    const own = reached[2];
    expect(reduceEdit(own, { kind: "elapsed", edit: own.edit }).status.kind).toEqual("idle");
  });

  it("does not let a superseded write's answer overwrite the newer edit's status", () => {
    const state = replay(
      { kind: "editing", edit: 1 },
      { kind: "committed", edit: 1 },
      { kind: "editing", edit: 2 },
      { kind: "committed", edit: 2 },
      { kind: "settled", edit: 1, outcome: { ok: false, message: REFUSAL } },
    );
    expect(state.status.kind).toEqual("saving");
    expect(state.edit).toEqual(2);
  });

  it("clears a spent status when the operator opens the cell again", () => {
    // Reopening is how a refusal ends: the operator has acted on it.
    for (const outcome of [{ ok: true } as const, { ok: false, message: REFUSAL } as const]) {
      const spent = replay(
        { kind: "editing", edit: 1 },
        { kind: "committed", edit: 1 },
        { kind: "settled", edit: 1, outcome },
      );
      expect(reduceEdit(spent, { kind: "editing", edit: 2 }).status.kind).toEqual("idle");
    }
  });

  it("never speaks over a write still in flight when the cell is reopened", () => {
    const inFlight = replay({ kind: "editing", edit: 1 }, { kind: "committed", edit: 1 });
    expect(reduceEdit(inFlight, { kind: "editing", edit: 2 })).toBe(inFlight);
  });

  it("says nothing before any edit happens", () => {
    expect(IDLE_EDIT_STATE.status.kind).toEqual("idle");
    expect(confirmationDelayMs(IDLE_EDIT_STATE.status)).toBeNull();
  });
});

/**
 * The seam driven the way the COMPONENT composes it — QA, admin-window/BUG-0075.
 *
 * The tests above fire `elapsed` by hand, which proves the reducer's rule but
 * not the rule the defect actually lived in: WHICH clock is running, and for
 * how long. In the component that is `confirmationDelayMs` read from the state
 * inside a `useEffect` keyed on the state OBJECT (`EditableCell`'s clock
 * effect, which arms from `cell` and nothing else), so an event that returns
 * the state by reference leaves the running clock alone and every real
 * transition tears it down and re-arms from scratch.
 * `driveCell` is exactly that arming rule over a virtual clock: it is the
 * cheapest thing that can answer "what is on screen at t=1630ms", which is the
 * question both measured divergences were.
 *
 * Behaviour only: which status is showing, and until when. The words are
 * `EditStatus`'s, and the button an operator can click again is
 * `disabled={status.kind === "saving"}`, so "still states its work" and "still
 * refuses a second click" are one assertion here — the walk measures the
 * button itself.
 */
type Beat = { at: number; event: EditEvent };

/**
 * `leakClocks: true` is the shape the defect had: a timeout armed by a save
 * and NOT torn down when the state moved on (the old `timer` ref was cleared
 * at exactly one call site). Every timeline below is driven BOTH ways, so the
 * cell is required to survive a straggler clock rather than merely never to
 * have one — two independent defenses, and only one of them is the reducer's.
 */
function driveCell(script: Beat[], { leakClocks = false }: { leakClocks?: boolean } = {}) {
  let state = IDLE_EDIT_STATE;
  let pending: Array<{ at: number; edit: number }> = [];
  const timeline: Array<{ at: number; state: EditState }> = [{ at: 0, state }];

  function apply(at: number, event: EditEvent) {
    const next = reduceEdit(state, event);
    // useReducer bails out on an unchanged reference: no re-render, so the
    // effect does not re-run and the clock already running is untouched.
    if (next === state) return;
    state = next;
    // React runs the effect's cleanup and the effect itself on every change.
    if (!leakClocks) pending = [];
    const delay = confirmationDelayMs(state.status);
    if (delay !== null) pending.push({ at: at + delay, edit: state.edit });
    pending.sort((a, b) => a.at - b.at);
    timeline.push({ at, state });
  }

  function fireDueClocks(before: number) {
    while (pending.length > 0 && pending[0].at <= before) {
      const firing = pending.shift();
      if (firing !== undefined) apply(firing.at, { kind: "elapsed", edit: firing.edit });
    }
  }

  for (const beat of [...script].sort((a, b) => a.at - b.at)) {
    fireDueClocks(beat.at);
    apply(beat.at, beat.event);
  }
  fireDueClocks(Number.MAX_SAFE_INTEGER);

  return {
    timeline,
    /** What the cell is showing at `at` — the last transition at or before it. */
    at(when: number): Status {
      let showing = IDLE_EDIT_STATE.status;
      for (const entry of timeline) if (entry.at <= when) showing = entry.state.status;
      return showing;
    },
  };
}

/** One edit, opened → committed → answered, as the component emits them. */
function edit(ordinal: number, opened: number, committed: number, answered: number, outcome: SaveOutcome): Beat[] {
  return [
    { at: opened, event: { kind: "editing", edit: ordinal } },
    { at: committed, event: { kind: "committed", edit: ordinal } },
    { at: answered, event: { kind: "settled", edit: ordinal, outcome } },
  ];
}

const OK: SaveOutcome = { ok: true };
const NO: SaveOutcome = { ok: false, message: REFUSAL };

describe.each([{ leaked: false }, { leaked: true }])(
  "the clock the component arms retires only its own confirmation (straggler clock: $leaked)",
  ({ leaked }) => {
    const drive = (script: Beat[]) => driveCell(script, { leakClocks: leaked });

  it("leaves no silent, clickable window under the second edit's live write", () => {
    // Measurement (1) as a clock: edit 1 confirms at 130 (its clock would fire
    // at 1630), edit 2 commits at 200 and its write answers at 2200.
    const cell = drive([
      ...edit(1, 0, 10, 130, OK),
      ...edit(2, 200, 210, 2200, OK),
    ]);
    for (let t = 210; t < 2200; t += 10) {
      expect(cell.at(t).kind, `t=${t}ms, mid-write`).toEqual("saving");
    }
    expect(cell.at(1630).kind, "the previous save's clock fires here").toEqual("saving");
    expect(cell.at(2200).kind).toEqual("saved");
  });

  it("gives the second edit's own confirmation its own full 1.5s, and no more", () => {
    const cell = drive([...edit(1, 0, 10, 130, OK), ...edit(2, 200, 210, 2200, OK)]);
    expect(cell.at(3699).kind, "still confirming").toEqual("saved");
    expect(cell.at(3700).kind, "its own clock, 1500ms after its own save").toEqual("idle");
    // and it is retired once: nothing fires again afterwards.
    expect(cell.timeline.filter((entry) => entry.at > 3700)).toEqual([]);
  });

  it("holds the statement at every interval between the two edits", () => {
    // "at any interval between the two edits, no silent clickable window."
    for (let gap = 0; gap <= 1600; gap += 50) {
      const commit = 130 + gap;
      const answer = commit + 1800;
      const cell = drive([...edit(1, 0, 10, 130, OK), ...edit(2, commit - 5, commit, answer, OK)]);
      for (let t = commit; t < answer; t += 25) {
        expect(cell.at(t).kind, `gap=${gap}ms, t=${t}ms`).toEqual("saving");
      }
      expect(cell.at(answer).kind, `gap=${gap}ms`).toEqual("saved");
    }
  });

  it("keeps a refusal raised inside the window on screen indefinitely", () => {
    // Measurement (2): readable 1374ms, then erased. Its own edit never armed
    // a clock, and the earlier save's clock is not its to answer to.
    const cell = drive([...edit(1, 0, 10, 130, OK), ...edit(2, 200, 210, 400, NO)]);
    for (const t of [401, 1630, 4000, 60_000]) {
      expect(cell.at(t), `t=${t}ms`).toEqual({ kind: "failed", message: REFUSAL });
    }
    expect(cell.timeline.at(-1)?.at, "nothing happens after the refusal").toEqual(400);
  });

  it("lets the success after a refusal confirm and clear on its own clock", () => {
    const cell = drive([
      ...edit(1, 0, 10, 400, NO),
      ...edit(2, 5_000, 5_010, 5_200, OK),
    ]);
    expect(cell.at(4_999).kind, "the refusal stands until the operator acts").toEqual("failed");
    expect(cell.at(5_000).kind, "reopening acknowledges it").toEqual("idle");
    expect(cell.at(5_100).kind).toEqual("saving");
    expect(cell.at(6_699).kind).toEqual("saved");
    expect(cell.at(6_700).kind, "1500ms after ITS save, not the refusal's age").toEqual("idle");
  });

  it("survives a third edit committed inside the second's window", () => {
    const cell = drive([
      ...edit(1, 0, 10, 130, OK),
      ...edit(2, 200, 210, 900, OK),
      ...edit(3, 950, 960, 3_000, OK),
    ]);
    for (let t = 960; t < 3_000; t += 10) {
      expect(cell.at(t).kind, `t=${t}ms, third write in flight`).toEqual("saving");
    }
    expect(cell.at(1_630).kind, "edit 1's clock").toEqual("saving");
    expect(cell.at(2_400).kind, "edit 2's clock").toEqual("saving");
    expect(cell.at(3_000).kind).toEqual("saved");
    expect(cell.at(4_500).kind).toEqual("idle");
  });

  it("does not let a stale event stretch the confirmation that is running", () => {
    // The bail-out is load-bearing, not tidiness: a stale event that returned
    // a new-but-equal state would re-run the effect and re-arm the clock, and
    // the confirmation would outlive its 1.5s by however late the straggler is.
    const stragglers: EditEvent[] = [
      { kind: "settled", edit: 1, outcome: NO },
      { kind: "settled", edit: 1, outcome: OK },
      { kind: "committed", edit: 1 },
      { kind: "editing", edit: 1 },
      { kind: "elapsed", edit: 1 },
    ];
    for (const straggler of stragglers) {
      const cell = drive([
        ...edit(1, 0, 10, 100, OK),
        ...edit(2, 200, 210, 300, OK),
        { at: 1_000, event: straggler },
      ]);
      const where = `straggler ${straggler.kind}(edit 1) at t=1000ms`;
      expect(cell.at(1_000).kind, where).toEqual("saved");
      expect(cell.at(1_799).kind, where).toEqual("saved");
      expect(cell.at(1_800).kind, `${where}: its own clock still runs out`).toEqual("idle");
    }
  });

  it("arms no clock a navigation could outlive", () => {
    // Unmounting mid-write is the operator navigating away: the only status
    // that can be on screen then is the in-flight one, and it is on no clock,
    // so nothing is pending to fire into a component that is gone.
    const inFlight = drive(edit(1, 0, 10, 9_999, OK).slice(0, 2));
    expect(inFlight.at(5_000).kind).toEqual("saving");
    expect(inFlight.timeline.at(-1)?.at, "no clock ever fired").toEqual(10);
    for (const status of [
      { kind: "idle" } as const,
      { kind: "saving" } as const,
      { kind: "failed", message: REFUSAL } as const,
    ]) {
      expect(confirmationDelayMs(status), status.kind).toBeNull();
    }
  });
  },
);

/**
 * WHERE FOCUS GOES when an edit ends — campaign admin-window/BUG-0069.
 *
 * Measured by QA on the BUG-0060 pass (2026-09-03, production build against
 * staging): committing with Enter left `document.activeElement` as `<body>`,
 * so the operator's next Tab restarted at the top of the document instead of
 * continuing to the next field. `commit()` unmounts the input, the resting
 * button is `disabled` for the whole of the write, and nothing caught what was
 * dropped. Escape is the same seam.
 *
 * `document.activeElement` is a browser fact and `tests/offline` is
 * environment node with `renderToStaticMarkup` and no jsdom (STACK.md §4), so
 * these drive `focusVerdict` — the pure rule the component's effect obeys —
 * plus what a static render CAN see about the control focus is returned to.
 * The focus itself, and the Tab that follows it, are measured in a browser
 * walk exactly the way their absence was.
 */
const SETTLED: Status[] = [
  { kind: "idle" },
  { kind: "saved" },
  { kind: "failed", message: REFUSAL },
];
const IN_FLIGHT: Status = { kind: "saving" };
const ENDINGS: EditEnding[] = ["committed", "cancelled", "left"];

describe("an edit that ends gives focus back to the cell", () => {
  it("returns it after a commit — but not while the control is still disabled", () => {
    // The bug's own window: the button is `disabled` until the write answers,
    // and focusing a disabled control is a no-op that leaves focus on <body>.
    expect(
      focusVerdict({
        editing: false,
        ending: "committed",
        status: IN_FLIGHT,
        focusIsAdrift: true,
      }),
    ).toEqual("wait");
    // ...and once the write has settled, however it settled, focus comes back.
    for (const status of SETTLED) {
      expect(
        focusVerdict({ editing: false, ending: "committed", status, focusIsAdrift: true }),
        status.kind,
      ).toEqual("return");
    }
  });

  it("returns it after a cancel too, which has no write to wait for", () => {
    // Escape unmounts the same input and re-enables the same button
    // immediately; a fix that covered only the commit path leaves half the
    // defect standing.
    expect(
      focusVerdict({
        editing: false,
        ending: "cancelled",
        status: { kind: "idle" },
        focusIsAdrift: true,
      }),
    ).toEqual("return");
  });

  it("never takes focus off something the operator moved to themselves", () => {
    // A write can run for seconds; an operator who clicked a link or tabbed on
    // during it went somewhere on purpose, and yanking focus back from there
    // would be a worse bug than the one being fixed.
    for (const ending of ENDINGS) {
      for (const status of [...SETTLED, IN_FLIGHT]) {
        expect(
          focusVerdict({ editing: false, ending, status, focusIsAdrift: false }),
          `${ending}/${status.kind}`,
        ).not.toEqual("return");
      }
    }
  });

  it("leaves an edit ended BY leaving the field entirely alone", () => {
    // Blur commits, so clicking or tabbing away is also an ending — and the
    // one ending whose focus is already where the operator wants it.
    for (const status of [...SETTLED, IN_FLIGHT]) {
      expect(
        focusVerdict({ editing: false, ending: "left", status, focusIsAdrift: true }),
        status.kind,
      ).toEqual("leave");
    }
  });

  it("does nothing while the operator is still typing", () => {
    // In edit mode the field holds focus; the rule only ever fires on the way
    // out, so it can never fight `autoFocus` for the way in.
    for (const ending of [null, ...ENDINGS]) {
      expect(
        focusVerdict({
          editing: true,
          ending,
          status: { kind: "idle" },
          focusIsAdrift: true,
        }),
        String(ending),
      ).toEqual("wait");
    }
  });

  it("does not chase focus when no edit ended", () => {
    // Every status change re-asks the question, so "nothing ended" has to be a
    // real answer: a confirmation retiring 1.5s later must not grab focus.
    for (const status of [...SETTLED, IN_FLIGHT]) {
      expect(
        focusVerdict({ editing: false, ending: null, status, focusIsAdrift: true }),
        status.kind,
      ).toEqual("leave");
    }
  });

  it("aims at a control that can actually hold focus at rest", () => {
    // What a static render can see: the thing focus is returned to is a real
    // button, in the tab order, not disabled and not tabindex'd out of it.
    const resting = render(
      h(EditableCell, { value: "Tuzi", onSave: noop, label: "short_name of groups" }),
    );
    const $ = cheerio.load(resting);
    expect($("button").length).toBe(1);
    expect($("button").attr("disabled")).toBeUndefined();
    expect($("button").attr("tabindex")).toBeUndefined();
  });

  it("adds nothing to the resting markup to do it", () => {
    // records/page.test.ts asserts a mapped field is markup-identical to this
    // primitive; a hidden focus target, an autofocus at rest, or a tabindex
    // would all be new surface. The ref that carries the fix renders nothing.
    const resting = render(
      h(EditableCell, { value: "Tuzi", onSave: noop, label: "short_name of groups" }),
    );
    expect(resting).not.toMatch(/tabindex/i);
    expect(resting).not.toMatch(/autofocus/i);
    expect(tagsOf(resting)).not.toContain("input");
    expect(tagsOf(resting)).not.toContain("textarea");
  });
});

/* ── the two affordances the M1 walks earned ───────────────────────────────
 *
 * campaign admin-window/TASK-0053, LOOK_AND_FEEL "Inputs and inline edit":
 * an editable value looks editable AT REST, and a cell opens with its value
 * selected. Both are the shared control's, so every regime with a write path
 * inherits them from one place.
 */

/** The one editable line and the one read-only line, drawn as the surface draws them. */
function recordLines(): string {
  return render(
    h(RecordFields, {
      table: "walk_sandbox",
      id: "00000000-0000-4000-8000-000000000001",
      fields: [
        {
          name: "label",
          value: "A label a walker may rewrite.",
          widget: "cell",
          multiline: false,
          isKey: false,
          provenance: null,
          reference: null,
        },
        {
          name: "sandbox_id",
          value: "00000000-0000-4000-8000-000000000001",
          widget: "read_only",
          multiline: false,
          isKey: true,
          provenance: null,
          reference: null,
        },
      ] satisfies RecordField[],
    }),
  );
}

/** Every class on the innermost element that draws `text`, or `[]` when nothing does. */
function classesDrawing(html: string, text: string): string[] {
  const $ = cheerio.load(html);
  const holder = $("*")
    .toArray()
    .filter((element) => $(element).text().trim() === text)
    .pop();
  return holder === undefined ? [] : ($(holder).attr("class") ?? "").split(/\s+/).filter(Boolean);
}

/**
 * The classes of the element that UNDERLINES `text`, or `[]` when nothing on
 * its ancestry does.
 *
 * Self-or-ancestor because `text-decoration` is drawn by the element that sets
 * it and inherited by the inline text inside it: an absent value renders its
 * em dash in a span of its own (`format.ts`'s dash), so asking only the
 * innermost element would call an underlined dash un-underlined. The walk
 * measures the delivered `text-decoration-line` on the real cell.
 */
function underliningClasses(html: string, text: string): string[] {
  const $ = cheerio.load(html);
  const holder = $("*")
    .toArray()
    .filter((element) => $(element).text().trim() === text)
    .pop();
  if (holder === undefined) return [];
  const carrier = $(holder)
    .parents()
    .toArray()
    .reduce<string[][]>(
      (found, element) => {
        const classes = ($(element).attr("class") ?? "").split(/\s+/).filter(Boolean);
        return classes.includes("underline") ? [...found, classes] : found;
      },
      classesDrawing(html, text).includes("underline") ? [classesDrawing(html, text)] : [],
    );
  return carrier[0] ?? [];
}

/** Does anything on the way to `text` underline it? */
function isUnderlined(html: string, text: string): boolean {
  return underliningClasses(html, text).length > 0;
}

/** The decoration classes in a class set: the colour and the thickness. */
function decoration(classes: string[]): string[] {
  return classes.filter((className) => className.startsWith("decoration-"));
}

describe("an editable value looks editable before anything touches it", () => {
  it("underlines the value at rest, where a read-only value on the same surface carries none", () => {
    // Two fixtures on one surface: the guard would pass vacuously against
    // either alone (LESSONS 3).
    const html = recordLines();
    expect(isUnderlined(html, "A label a walker may rewrite.")).toBe(true);
    expect(isUnderlined(html, "00000000-0000-4000-8000-000000000001")).toBe(false);
  });

  it("draws it with no hover, no focus and no click — the markup as it is served carries it", () => {
    // The whole finding: a stranger found the affordance by TABBING. Anything
    // behind a state variant is invisible to the mouse-first colleague they
    // named, so the affordance may carry no variant prefix at all.
    const classes = underliningClasses(recordLines(), "A label a walker may rewrite.");
    const affordance = classes.filter(
      (className) => className === "underline" || className.startsWith("decoration-"),
    );
    expect(affordance.length).toBeGreaterThan(0);
    expect(affordance.filter((className) => className.includes(":"))).toEqual([]);
  });

  it("carries it on an ABSENT value too, which is the one an operator most needs to fill in", () => {
    const html = render(h(EditableCell, { value: null, onSave: noop, label: "note of walk_sandbox" }));
    expect(isUnderlined(html, EM_DASH)).toBe(true);
    // and the dash's own span does not cancel what it inherits.
    const dash = classesDrawing(html, EM_DASH);
    expect(dash).not.toContain("no-underline");
    expect(decoration(dash)).toEqual([]);
  });

  it("is a hairline rather than the app's link, which is accent ink plus an underline", () => {
    // `components/cycles/links.ts` spells a link at rest `text-accent
    // underline`. An accent underline here would say "this goes somewhere".
    const classes = underliningClasses(recordLines(), "A label a walker may rewrite.");
    expect(classes).not.toContain("text-accent");
    expect(decoration(classes)).not.toContain("decoration-accent");
    expect(decoration(classes)).toContain("decoration-hairline");
  });

  it("takes the rule from the palette and from the type scale, never from a raw value", () => {
    // A token flips itself between themes (globals.css), so there is no
    // `dark:` variant to keep in step and no hex to drift; the values
    // themselves are measured in tests/offline/ui/contrast.test.ts.
    const classes = underliningClasses(recordLines(), "A label a walker may rewrite.");
    const affordance = [...decoration(classes), "underline"];
    expect(affordance.filter((className) => className.includes("["))).toEqual([]);
    expect(affordance.filter((className) => /#[0-9a-f]{3,8}/i.test(className))).toEqual([]);
    expect(affordance.filter((className) => className.startsWith("dark:"))).toEqual([]);
    // Not weight and not colour: the value stays primary ink at the data step.
    expect(classes).toContain("type-data");
    expect(classes).toContain("text-ink");
    expect(classes.filter((className) => /^font-(medium|semibold|bold)$/.test(className))).toEqual([]);
  });

  it("is 1px: the hairline width, not a second border weight", () => {
    const classes = underliningClasses(recordLines(), "A label a walker may rewrite.");
    expect(decoration(classes)).toContain("decoration-1");
    // and it is drawn as a text decoration, not as a box border that would
    // underline the cell's padding and shift the row.
    expect(classes.filter((className) => /^border(-[trblxy])?(-\d+)?$/.test(className))).toEqual([]);
  });
});

/**
 * A field element out of `EditField`'s returned tree, without rendering it —
 * the ref that carries the selection is a prop, and a prop that never reaches
 * the markup (campaign admin-window/TASK-0053).
 */
function fieldOf(multiline: boolean): ReactElement<Record<string, unknown>> {
  const tree = EditField({
    value: "Tuzi",
    label: "label of walk_sandbox",
    hintId: "hint-1",
    multiline,
    onChange: () => {},
    onBlur: () => {},
    onKeyDown: () => {},
  }) as ReactElement<{ children: ReactNode }>;
  const found: ReactElement<Record<string, unknown>>[] = [];
  const walk = (node: ReactNode) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!isValidElement(node)) return;
    const element = node as ReactElement<{ children?: ReactNode }>;
    if (element.type === "input" || element.type === "textarea") {
      found.push(element as ReactElement<Record<string, unknown>>);
    }
    walk(element.props.children);
  };
  walk(tree.props.children);
  expect(found.length, `exactly one field, multiline=${multiline}`).toBe(1);
  return found[0];
}

/**
 * A field that records what was done to it and refuses to be written —
 * `selectOnOpen` reads the field and selects it, and a future version that
 * rewrote the value would fail here rather than in a walk.
 */
function spyField(value: string) {
  let selects = 0;
  const field = {
    select: () => {
      selects += 1;
    },
    setSelectionRange: (start: number, end: number) => {
      throw new Error(`computed an index range (${start}, ${end}) instead of selecting`);
    },
    focus: () => {},
  };
  Object.defineProperty(field, "value", {
    get: () => value,
    set: () => {
      throw new Error("selecting a value must never write it");
    },
  });
  return {
    field: field as unknown as HTMLInputElement,
    selects: () => selects,
    value: () => value,
  };
}

/* ── what an edit commits ──────────────────────────────────────────────────
 *
 * campaign admin-window/BUG-0095. The cell used to decide blank with
 * `draft.trim() === ""`, which knows only the Unicode `White_Space` set — so a
 * draft of U+200B ZERO WIDTH SPACE, U+2060 WORD JOINER, U+00AD SOFT HYPHEN or
 * U+FEFF (what a paste out of a web page or a PDF carries) committed as
 * CONTENT, while `isAbsent` — asking the app's ONE definition of blank — drew
 * that same value as the em dash. QA measured it on staging: the record page
 * showed no value and the column held one code point; on the `not null`
 * `walk_sandbox.label` the paste also answered 200 where an ordinary clear
 * answers Postgres 23502.
 *
 * Typing into a field is a browser fact this tier cannot produce (environment
 * node, `renderToStaticMarkup`, no jsdom — STACK.md §4), which is why the
 * decision is an exported unit: `committedValue` is pinned here exactly as
 * `focusVerdict` and `selectOnOpen` pin theirs, and the same class is pinned
 * at the route — the contract — in `tests/offline/edit/route.test.ts`.
 */

describe("an edit commits what a person could read, and nothing else", () => {
  /** The class of ink-less drafts, each on its own and each padded. */
  const INVISIBLE = ["\u200b", "\u2060", "\u00ad", "\ufeff", "\u3164", "  \u200b  ", "   ", ""];

  it("commits a draft with nothing visible in it as the clear it looks like", () => {
    for (const draft of INVISIBLE) {
      const seen = JSON.stringify(draft);
      // The app's own answer about this string on the surface it renders on —
      // which is what the commit must agree with.
      expect(isAbsent(draft), seen).toBe(true);
      expect(committedValue(draft), seen).toBeNull();
    }
  });

  it("commits a draft with anything visible in it, byte-identical but for its ends", () => {
    // The fixtures it must NOT flag, or it says nothing (LESSONS 3): the
    // invisible characters are an absence only when they are ALL there is, and
    // U+2800 BRAILLE PATTERN BLANK is an assigned printable character the one
    // definition rules as content.
    for (const draft of ["\u200bBLACKPINK\u200b", "\u2800", "0", "a", " x "]) {
      const seen = JSON.stringify(draft);
      expect(hasVisibleContent(draft), seen).toBe(true);
      expect(isAbsent(draft), seen).toBe(false);
      expect(committedValue(draft), seen).toBe(draft.trim());
    }
    // Padding a real value is still stripped at the ends, as it always was.
    expect(committedValue("  BLACKPINK  ")).toBe("BLACKPINK");
    expect(committedValue("\n line one\n line two \n")).toBe("line one\n line two");
  });

  it("decides through the app's one definition, not through a second copy of it", () => {
    // The whole point of one definition, stated as an identity rather than as
    // two lists: for ANY draft, committing null and `hasVisibleContent` saying
    // "nothing to read" are the same answer. A future edit that reintroduces
    // `trim()` breaks this on a character neither list above happens to name —
    // U+115F HANGUL CHOSEONG FILLER and U+FE0F VARIATION SELECTOR-16 are here
    // for exactly that.
    for (const draft of [...INVISIBLE, "\u200bBLACKPINK\u200b", "\u2800", "0", " x ", "\u115f", "\ufe0f"]) {
      const seen = JSON.stringify(draft);
      expect(committedValue(draft) === null, seen).toBe(!hasVisibleContent(draft));
    }
  });

  it("agrees with the SURFACE over the class this bug arrived as", () => {
    // The disagreement admin-window/BUG-0095 is: a draft the page draws as an
    // absence must not commit as content. Asserted over the ink-less class
    // rather than over every string, because `isAbsent` deliberately says one
    // thing more than the one definition does — it also calls a bare EM DASH
    // an absence, since that is what `format.ts`'s own helpers RETURN for a
    // null (`count(null)`), so a cell that typed the dash still commits it.
    // That divergence is `isAbsent`'s and is not this ticket's to settle.
    for (const draft of INVISIBLE) {
      const seen = JSON.stringify(draft);
      expect(isAbsent(draft), seen).toBe(true);
      expect(committedValue(draft), seen).toBeNull();
    }
    expect(isAbsent(EM_DASH)).toBe(true);
    expect(committedValue(EM_DASH)).toBe(EM_DASH);
  });

  it("draws the dash for the value it just committed, rather than an empty target", () => {
    // The end of the round trip at this tier: a cleared cell renders as an
    // absence, which is the same thing the operator saw before they saved.
    const html = render(
      h(EditableCell, { value: committedValue("\u200b"), onSave: noop, label: "label of walk_sandbox" }),
    );
    expect(html).toContain(EM_DASH);
    expect(html).not.toContain("\u200b");
  });
});


describe("a cell opens with its value selected, so a retype replaces", () => {
  it("hands the field the select-on-open behaviour, on the input and the textarea alike", () => {
    for (const multiline of [false, true]) {
      const field = fieldOf(multiline);
      // A function, and THE function: an absent export would make both sides
      // of the identity check undefined and pass vacuously (LESSONS 3).
      expect(typeof field.props.ref, `multiline=${multiline}`).toBe("function");
      expect(field.props.ref, `multiline=${multiline}`).toBe(selectOnOpen);
      // and it still opens focused: the selection is made on a field that
      // already holds focus, because React commits autoFocus before the ref.
      expect(field.props.autoFocus, `multiline=${multiline}`).toBe(true);
    }
  });

  it("hands it the SAME reference every render, so typing does not re-select", () => {
    // React re-invokes a ref callback whose identity changed. An inline arrow
    // here would reselect the whole field after every keystroke — a worse bug
    // than the one being fixed.
    expect(fieldOf(false).props.ref).toBe(fieldOf(false).props.ref);
    expect(fieldOf(true).props.ref).toBe(fieldOf(false).props.ref);
  });

  it("selects the whole value, and writes nothing", () => {
    const spy = spyField("A label a walker may rewrite.");
    selectOnOpen(spy.field);
    expect(spy.selects()).toBe(1);
    expect(spy.value()).toBe("A label a walker may rewrite.");
  });

  it("selects a multiline value without counting characters, so no newline is lost", () => {
    // `select()` rather than `setSelectionRange(0, value.length)`: the spy
    // throws on the index form, because a textarea's newlines are exactly
    // where computed lengths go wrong.
    const spy = spyField("first line\nsecond line\n\nfourth");
    selectOnOpen(spy.field);
    expect(spy.selects()).toBe(1);
    expect(spy.value()).toBe("first line\nsecond line\n\nfourth");
  });

  it("opens an empty cell without erroring, and selects nothing there is", () => {
    const spy = spyField("");
    expect(() => selectOnOpen(spy.field)).not.toThrow();
    expect(spy.selects()).toBe(1);
    expect(spy.value()).toBe("");
  });

  it("does nothing at all when the field is gone", () => {
    expect(() => selectOnOpen(null)).not.toThrow();
  });

  it("adds nothing to the resting markup, which has no field to select", () => {
    const resting = render(h(EditableCell, { value: "Tuzi", onSave: noop, label: "label of walk_sandbox" }));
    expect(tagsOf(resting)).not.toContain("input");
    expect(tagsOf(resting)).not.toContain("textarea");
    expect(resting).not.toMatch(/autofocus/i);
  });
});


/* ── a cell moves nothing, in any state ────────────────────────────
 *
 * campaign admin-window/BUG-0086. Measured by QA on the TASK-0053 attack
 * (2026-09-08, production build against staging, viewport 1400x950): with
 * `label` open, the `note` cell's resting button had moved 101px left and 26px
 * down — the open field claimed the column's full width and the hint line was
 * added to the row's flow. One human-timed click on `note` then hit its button
 * at mousedown and a `<td>` of a different row at mouseup: nothing opened, and
 * the operator had to click twice to correct a second field.
 *
 * REOPENED 2026-09-09 on the same criterion, one state later. The first cut
 * floated the field and the hint and left `EditStatus` in the flow, so the
 * reflow moved to the COMMIT window: QA opened `label`, typed, and clicked
 * `tally`'s resting centre 120ms later; as `saving…` (46x16, plus the
 * container's 8px gap) appeared, the cell's in-flow content crossed the Value
 * column's max-content, every value in the column moved 12.09px left (48.76px
 * in dark theme), and nothing opened. Hence the states below: the rule is
 * asserted over EVERY (editing, statusShown) pair, not over the open one.
 *
 * A bounding box is a browser fact and this tier is environment node with
 * `renderToStaticMarkup` and no jsdom (STACK.md §4), so what is pinned here is
 * `cellLayout` — the rule the rendering obeys — exactly as `focusVerdict` and
 * `selectOnOpen` pin theirs. The boxes themselves are measured in the walk.
 */

const PARTS = ["value", "field", "hint", "status"] as const;

/** The parts of a cell that take space in the row, in a given layout. */
function flowing(layout: CellLayout): string[] {
  return PARTS.filter((part) => occupiesFlow(layout[part]));
}

/**
 * Every state this cell's layout can be asked about. The second one is the
 * commit window — closed, `saving…` on screen — which is where the operator's
 * next click lands and where the reopened defect lived.
 */
const STATES: CellState[] = [
  { editing: false, statusShown: false },
  { editing: false, statusShown: true },
  { editing: true, statusShown: false },
  { editing: true, statusShown: true },
];

describe("a cell moves no other row, in any state it can be in", () => {
  it("asks its row for the same box in every state: the resting value, and nothing else", () => {
    // The whole fix in one line: only a part that takes space in the row can
    // move another row's control out from under a pointer. If any state adds
    // a part to this set, that state can re-apportion the table's columns.
    for (const state of STATES) {
      expect(flowing(cellLayout(state)), JSON.stringify(state)).toEqual(["value"]);
    }
  });

  it("keeps the value holding the box it held, and shows it to nobody", () => {
    // Something has to hold the row's height while the field is open, and the
    // only box that is certainly the right one is the one that was there.
    expect(occupiesFlow(cellLayout({ editing: true, statusShown: false }).value)).toBe(true);
    expect(cellLayout({ editing: true, statusShown: false }).value).toEqual("flow-hidden");
    expect(cellLayout({ editing: false, statusShown: false }).value).toEqual("flow");
  });

  it("draws every part that is not the value outside the flow, wherever it is drawn at all", () => {
    for (const state of STATES) {
      const layout = cellLayout(state);
      for (const part of ["field", "hint", "status"] as const) {
        if (layout[part] === "absent") continue;
        expect(occupiesFlow(layout[part]), `${part}, ${JSON.stringify(state)}`).toBe(false);
      }
    }
  });

  it("takes the line stating the write out of the flow too, in the window the next click lands in", () => {
    // The reopening, pinned: `saving…` / `saved` / the refusal appear while
    // the cell is CLOSED and on their own clock, so a status that took space
    // would move another row's control between mousedown and mouseup — which
    // is measured, not hypothetical (12.09px left, click swallowed).
    expect(cellLayout({ editing: false, statusShown: true }).status).toEqual("float-inert");
    expect(cellLayout({ editing: true, statusShown: true }).status).toEqual("float-inert");
    // ...and the negative fixture that keeps it honest: no status, nothing drawn.
    expect(cellLayout({ editing: false, statusShown: false }).status).toEqual("absent");
    expect(cellLayout({ editing: true, statusShown: false }).status).toEqual("absent");
  });

  it("lets a click pass through the two parts that hang over another row's control", () => {
    // A float that swallowed the click would be the same defect wearing the
    // fix's clothes: the operator would still have to click twice.
    expect(cellLayout({ editing: true, statusShown: false }).hint).toEqual("float-inert");
    expect(cellLayout({ editing: false, statusShown: true }).status).toEqual("float-inert");
    // The field is not inert — it is the thing being typed into.
    expect(cellLayout({ editing: true, statusShown: false }).field).toEqual("float");
  });

  it("is not vacuously true: the states really do differ from each other", () => {
    // A rule both sides of which are the same object proves nothing (LESSONS 3).
    const seen = new Set(STATES.map((state) => JSON.stringify(cellLayout(state))));
    expect(seen.size).toBe(STATES.length);
    expect(occupiesFlow("float")).toBe(false);
    expect(occupiesFlow("float-inert")).toBe(false);
    expect(occupiesFlow("flow")).toBe(true);
  });
});

describe("the status line the row cannot feel", () => {
  it("is drawn out of the flow and inert to the pointer, in every kind it renders", () => {
    // The markup half of `cellLayout(...).status`: the model says float-inert
    // and this is where the rendering says the same thing. `idle` renders
    // nothing at all, which is `absent`.
    for (const status of KINDS) {
      const classes = classesOf(statusMarkup(status));
      if (status.kind === "idle") {
        expect(classes, "idle").toEqual([]);
        continue;
      }
      expect(classes, status.kind).toContain("absolute");
      expect(classes, status.kind).toContain("pointer-events-none");
    }
  });

  it("stays readable over whatever it hangs over, and still says what it always said", () => {
    // Out of the flow means over something, and on this surface that something
    // is another line of the record: an unfilled box would print two texts on
    // top of each other. The words and the live regions are unchanged
    // (BUG-0066) — those are asserted above.
    for (const status of KINDS.filter((kind) => kind.kind !== "idle")) {
      expect(classesOf(statusMarkup(status)), status.kind).toContain("bg-surface");
    }
    // Still announced, and still two different statements — the words
    // themselves are nobody's to pin here (see the block above).
    expect(announced(statusMarkup({ kind: "saving" }), "status")).toMatch(/\S/);
    expect(announced(statusMarkup({ kind: "failed", message: REFUSAL }), "alert")).toContain(
      REFUSAL,
    );
  });

  it("adds nothing to the resting cell, which has no status to state", () => {
    const resting = render(
      h(EditableCell, { value: "Tuzi", onSave: noop, label: "label of walk_sandbox" }),
    );
    const $ = cheerio.load(resting);
    expect($("[role=\"status\"]").length).toBe(0);
    expect($("[role=\"alert\"]").length).toBe(0);
    expect(classesOf(resting)).not.toContain("absolute");
  });
});

/** The classes on the hint of an open cell told to hang on `side`. */
function hintClasses(side: HintSide, multiline = false): string[] {
  const html = render(
    h(EditField, {
      value: "Tuzi",
      label: "label of walk_sandbox",
      hintId: "hint-1",
      multiline,
      side,
      onChange: () => {},
      onBlur: () => {},
      onKeyDown: () => {},
    }),
  );
  const $ = cheerio.load(html);
  return ($("#hint-1").attr("class") ?? "").split(/\s+/).filter(Boolean);
}

describe("the hint hangs over a line that is there", () => {
  it("hangs below a line that has one below it", () => {
    expect(hintSide(0, 6)).toEqual("below");
    expect(hintSide(4, 6)).toEqual("below");
  });

  it("hangs above the last line, whose only neighbour below is the table's own clip", () => {
    // `DataTable` wraps its table in `overflow-x-auto`, and a box whose other
    // axis is `visible` computes to `auto` — a float below the last row is
    // clipped, so the operator would read half a hint or none.
    expect(hintSide(5, 6)).toEqual("above");
    expect(hintSide(1, 2)).toEqual("above");
  });

  it("hangs below when there is no neighbour on either side", () => {
    expect(hintSide(0, 1)).toEqual("below");
  });

  it("draws the open subtree over the value rather than beside it", () => {
    // Positioned, therefore out of the flow: the mechanism `cellLayout` names.
    expect(classesOf(editMode(false))).toContain("absolute");
    expect(classesOf(editMode(true))).toContain("absolute");
  });

  it("carries the inertness to the markup, on the hint and not on the field", () => {
    for (const multiline of [false, true]) {
      const html = editMode(multiline);
      const $ = cheerio.load(html);
      const hint = ($("#hint-1").attr("class") ?? "").split(/\s+/);
      const field = ($("input, textarea").attr("class") ?? "").split(/\s+/);
      expect(hint, `multiline=${multiline}`).toContain("pointer-events-none");
      expect(field, `multiline=${multiline}`).toContain("pointer-events-auto");
    }
  });

  it("positions the hint from the field on the side it was told, both ways", () => {
    // Two fixtures: a rule that only ever saw one side passes vacuously.
    expect(hintClasses("below")).toContain("top-full");
    expect(hintClasses("below")).not.toContain("bottom-full");
    expect(hintClasses("above")).toContain("bottom-full");
    expect(hintClasses("above")).not.toContain("top-full");
  });

  it("adds none of it to the resting markup: a closed cell is laid out as it always was", () => {
    const resting = render(
      h(EditableCell, { value: "Tuzi", onSave: noop, label: "label of walk_sandbox" }),
    );
    expect(classesOf(resting)).not.toContain("absolute");
    expect(classesOf(resting)).not.toContain("invisible");
    expect(classesOf(resting)).not.toContain("pointer-events-none");
  });
});


/* ── the status grows towards the rows, never past the table's edge ──────
 *
 * campaign admin-window/BUG-0101, and `hintSide`'s problem one part later. The
 * status is out of the row's flow (BUG-0086) and was anchored to the row's TOP
 * edge with no side at all, so it always grew downward — and below the last
 * line there is no line, only `DataTable`'s `overflow-x-auto` container, which
 * clips. QA measured a refusal on the last field drawn from y 337 to y 393
 * against a container ending at y 363: the mono half cut 8px mid-word and the
 * app-voice half BUG-0098 shipped painted nowhere at all.
 *
 * The rule is pinned here and the boxes are measured in a walk, exactly as
 * `hintSide`'s are: `tests/offline` is environment node with no jsdom
 * (STACK.md §4), so a bounding box is unobservable in this tier and the
 * DECISION is the part that must not be.
 */

/**
 * What the surface tells each of its lines, read off the elements
 * `RecordFields` builds rather than off markup.
 *
 * The status only exists while a write is in flight or has been refused, and
 * neither state is reachable through `renderToStaticMarkup` — the same wall
 * `EditField` and `EditStatus` were extracted for. So this walks the tree the
 * component returns, the way `fieldOf` does for the selection ref: the Value
 * column's cell function is what the surface hands each field, and its props
 * are what that field's cell is told about where it sits.
 */
function cellPropsByField(names: readonly string[]): Map<string, Record<string, unknown>> {
  const fields: RecordField[] = names.map((name) => ({
    name,
    value: `a value of ${name}`,
    widget: "cell",
    multiline: false,
    isKey: false,
    provenance: null,
    reference: null,
  }));
  const table = RecordFields({
    table: "walk_sandbox",
    id: "00000000-0000-4000-8000-000000000001",
    fields,
  }) as ReactElement<{
    columns: readonly { key: string; cell: (field: RecordField) => ReactNode }[];
  }>;
  const value = table.props.columns.find((column) => column.key === "value");
  if (value === undefined) throw new Error("the record's fields table has no Value column");
  const told = new Map<string, Record<string, unknown>>();
  for (const field of fields) {
    const cell = value.cell(field);
    expect(isValidElement(cell), field.name).toBe(true);
    told.set(field.name, (cell as ReactElement<Record<string, unknown>>).props);
  }
  return told;
}

describe("the status hangs over a line that is there", () => {
  it("grows down from a line that has one below it", () => {
    expect(statusGrowth(0, 6)).toEqual("down");
    expect(statusGrowth(4, 6)).toEqual("down");
  });

  it("grows up from the last line, whose only neighbour below is the table's own clip", () => {
    expect(statusGrowth(5, 6)).toEqual("up");
    expect(statusGrowth(1, 2)).toEqual("up");
  });

  it("grows down when there is no neighbour on either side", () => {
    // One line: growing up would leave over the table's header instead, and
    // there is no row up there to hang over. `hintSide` answers the same.
    expect(statusGrowth(0, 1)).toEqual("down");
  });

  it("anchors the box to the edge it was told, both ways and in every kind it renders", () => {
    // Two fixtures per kind: a rule that only ever saw one direction passes
    // vacuously (LESSONS 3). `top-0` pins the box's top to the row's top and
    // it extends downward; `bottom-0` pins its bottom to the row's bottom and
    // it extends upward, over the lines above.
    for (const status of KINDS.filter((kind) => kind.kind !== "idle")) {
      const down = classesOf(statusMarkup(status, "down"));
      expect(down, status.kind).toContain("top-0");
      expect(down, status.kind).not.toContain("bottom-0");
      const up = classesOf(statusMarkup(status, "up"));
      expect(up, status.kind).toContain("bottom-0");
      expect(up, status.kind).not.toContain("top-0");
    }
  });

  it("grows down for a caller that says nothing about its neighbours", () => {
    // The review-item close form's supplied-value cell passes no growth, and
    // every line but the last one of a record gets this too: what the box has
    // always done.
    for (const status of KINDS.filter((kind) => kind.kind !== "idle")) {
      expect(classesOf(statusMarkup(status)), status.kind).toContain("top-0");
    }
  });

  it("stays out of the flow and inert to the pointer whichever way it grows", () => {
    // BUG-0086 is not paid for by BUG-0101: a box that grows upward is still
    // a box the row cannot feel and a click cannot land on.
    for (const growth of ["down", "up"] satisfies StatusGrowth[]) {
      for (const status of KINDS.filter((kind) => kind.kind !== "idle")) {
        const classes = classesOf(statusMarkup(status, growth));
        expect(classes, `${status.kind}/${growth}`).toContain("absolute");
        expect(classes, `${status.kind}/${growth}`).toContain("pointer-events-none");
        expect(classes, `${status.kind}/${growth}`).toContain("bg-surface");
      }
    }
  });

  it("keeps both halves of a refusal inside the one region, whichever way it grows", () => {
    // BUG-0098's anatomy is what this ticket exists to make readable, so it
    // is asserted on the side that moved.
    for (const growth of ["down", "up"] satisfies StatusGrowth[]) {
      const markup = statusMarkup({ kind: "failed", message: REFUSAL }, growth);
      const announcement = announced(markup, "alert");
      expect(announcement, growth).toContain(REFUSAL);
      expect(announcement, growth).toContain(refusalFix(REFUSAL));
    }
  });

  it("tells the record's LAST line to grow up, and every other line to grow down", () => {
    // The surface is the one that knows the order; the cell only knows what it
    // was told (the split `hintSide` already draws).
    const told = cellPropsByField(["label", "note", "tally", "is_flagged", "observed_on"]);
    expect(told.get("label")?.statusGrowth).toEqual("down");
    expect(told.get("is_flagged")?.statusGrowth).toEqual("down");
    expect(told.get("observed_on")?.statusGrowth).toEqual("up");
    // ...and the hint's own side is still decided beside it, unchanged.
    expect(told.get("label")?.hintSide).toEqual("below");
    expect(told.get("observed_on")?.hintSide).toEqual("above");
  });

  it("tells a one-line record's only line to grow down", () => {
    const told = cellPropsByField(["label"]);
    expect(told.get("label")?.statusGrowth).toEqual("down");
    expect(told.get("label")?.hintSide).toEqual("below");
  });

  it("carries what it was told through to the cell, unchanged", () => {
    // `FieldEditor` adds route knowledge and nothing else: a placement it
    // dropped on the way would be invisible in markup, since a resting cell
    // draws no status at all.
    const editor = FieldEditor({
      table: "walk_sandbox",
      id: "00000000-0000-4000-8000-000000000001",
      field: "observed_on",
      value: "2026-09-08",
      statusGrowth: "up",
      hintSide: "above",
    }) as ReactElement<Record<string, unknown>>;
    expect(editor.props.statusGrowth).toEqual("up");
    expect(editor.props.hintSide).toEqual("above");
  });
});


/* ── ...and is then MEASURED against the container it must stay inside ──
 *
 * campaign admin-window/BUG-0104. `statusGrowth` above is ordinal — it asks
 * which line this is — but a box overflows because it is taller than the room
 * below its OWN row, and its height is the database's sentence. QA measured
 * the same defect one line up from the one BUG-0101 fixed (2026-09-08,
 * production build against staging, 1440x900, both themes, `walk_sandbox` row
 * …0001): clearing `is_flagged`, the second-to-last of six fields and
 * correctly told `down`, drew the 23502 refusal from y 304 to y 424 against a
 * container of y 143 → 363 — the mono half cut 39px mid-word, the app-voice
 * half (404 → 422) painted nowhere at all.
 *
 * The DECISION the fix introduces is `statusShift`: given where the box would
 * be drawn and where the container's edges are, how far must it move. It is
 * pinned here on QA's own numbers, both ways — the three boxes measured INSIDE
 * must not move by a pixel, and the one measured outside must move by exactly
 * the overflow. The boxes themselves are a browser fact this tier cannot see
 * (no jsdom, STACK.md §4), so the walk measures them and this pins the rule.
 */

/** The container QA measured every one of these boxes against. */
const CLIP = { clipTop: 143, clipBottom: 363 } as const;

/** Where a box ends up once `statusShift` has answered about it. */
function corrected(box: StatusBounds): { top: number; bottom: number; shift: number } {
  const shift = statusShift(box);
  return { top: box.boxTop + shift, bottom: box.boxBottom + shift, shift };
}

describe("the status is measured against the container, not only anchored", () => {
  it("moves a box that already fits by nothing at all", () => {
    // The three refusals QA measured INSIDE the container, at the pixels it
    // measured them at: `label` (23502, row 2), `tally` (22P02, row 4) and
    // `observed_on` (22007, the last row, anchored `bottom-0` by
    // `statusGrowth`). A correction that touched these would be a regression
    // of what already works.
    for (const [field, box] of [
      ["label", { boxTop: 205, boxBottom: 325, ...CLIP }],
      ["tally", { boxTop: 271, boxBottom: 327, ...CLIP }],
      ["observed_on", { boxTop: 301, boxBottom: 357, ...CLIP }],
    ] satisfies [string, StatusBounds][]) {
      expect(statusShift(box), field).toEqual(0);
    }
  });

  it("lifts a box that runs past the container's floor by exactly the overflow", () => {
    // The defect, in QA's numbers: 424 against a floor of 363 is 61px outside,
    // so the box moves 61px and lands ON the floor — not a pixel further, so
    // the app-voice half is the last thing inside rather than the first thing
    // out.
    const flagged: StatusBounds = { boxTop: 304, boxBottom: 424, ...CLIP };
    expect(statusShift(flagged)).toEqual(-61);
    expect(corrected(flagged)).toEqual({ top: 243, bottom: 363, shift: -61 });
  });

  it("drops a box that runs past the container's ceiling by exactly the overflow", () => {
    // The mirror case, which `statusGrowth`'s `up` can produce on a short
    // record: a box hanging from the first line's bottom edge reaches over the
    // table's own header. Same rule, other sign — a fix that only ever looked
    // down would pass this ticket and leave the other half open.
    const box: StatusBounds = { boxTop: 100, boxBottom: 200, ...CLIP };
    expect(statusShift(box)).toEqual(43);
    expect(corrected(box)).toEqual({ top: 143, bottom: 243, shift: 43 });
  });

  it("aligns a box taller than the whole container with its top edge", () => {
    // Nothing can put 300px inside 220px. The refusal then reads from its
    // FIRST word — the database's own sentence, which is the half that names
    // what happened — and the container's scroll reaches the rest.
    const box: StatusBounds = { boxTop: 304, boxBottom: 604, ...CLIP };
    expect(corrected(box).top).toEqual(143);
  });

  it("leaves a box flush with either edge exactly where it is", () => {
    // The boundary is inside, not outside: a box whose bottom is the floor is
    // painted whole, and moving it would be motion for nothing.
    expect(statusShift({ boxTop: 243, boxBottom: 363, ...CLIP })).toEqual(0);
    expect(statusShift({ boxTop: 143, boxBottom: 263, ...CLIP })).toEqual(0);
  });

  it("ships no correction in the markup: the box is measured, never guessed", () => {
    // The rule needs the box's real height, which is the refusal's words in
    // the operator's own browser — so the correction is applied after
    // measuring, and nothing here carries a baked-in offset that would be
    // wrong for the next refusal. Every kind, both anchors.
    for (const growth of ["down", "up"] satisfies StatusGrowth[]) {
      for (const status of KINDS.filter((kind) => kind.kind !== "idle")) {
        const $ = cheerio.load(statusMarkup(status, growth));
        const rendered = $("[role='status'], [role='alert']");
        expect(rendered.length, `${status.kind}/${growth}`).toBe(1);
        expect(rendered.attr("style"), `${status.kind}/${growth}`).toBeUndefined();
        expect(classesOf(statusMarkup(status, growth)), `${status.kind}/${growth}`).not.toContain(
          "translate-y-0",
        );
      }
    }
  });
});


/* ── ...and its width cap binds on the database's own words ────────
 *
 * campaign admin-window/BUG-0105. The box is `w-max max-w-xs`, so the BOX is
 * at most 20rem wide — but a width cap caps a box, not the text in it, and the
 * text had no rule saying it may break inside a word. A refusal quotes the
 * value the operator typed, so its longest token is the database's business
 * and not this app's.
 *
 * Measured by QA on a production build against staging (2026-09-09, 1440x900,
 * `walk_sandbox` row …0001, `observed_on` typed `nope-` + 300 `x`): the alert
 * box itself sat inside the container at x 549.3 → 869.3, and the mono half
 * inside it reported `scrollWidth` 1987 against its own 312px box — the
 * database's words were painted to x ~2540, 1117px past the container's right
 * edge at 1423, across the Provenance column with no background behind them,
 * and the fields table's `scrollWidth` went from 1214 to 2331. It starts at
 * ~60 characters (97px outside the box) and leaves the container at ~180.
 *
 * **The fix carries no new pure rule** — there is nothing to put beside
 * `statusGrowth` and `statusShift` here, only the wrapping the cap always
 * implied — so what is pinned is what this tier can observe. Two things, and
 * the second is the one with a decision in it: the box carries a break rule
 * beside its cap in every kind it draws, and it never CLIPS. Hiding the
 * overflow would stop the painting too, and would stop it by swallowing the
 * database's own words, which this surface may never do (LOOK_AND_FEEL: "the
 * function's own refusal in mono"; admin-window/BUG-0098).
 *
 * On the BOX rather than on the mono half: `overflow-wrap` inherits, the cap
 * being made to bind is the box's own, and a half added later — the app-voice
 * sentence was itself added to this box by BUG-0098 — is then covered by
 * construction instead of by remembering. The painted extents are a browser
 * fact this tier cannot see (no jsdom, STACK.md §4) and are measured in the walk.
 */

/** The classes on the status BOX itself, not on the halves inside it. */
function boxClasses(status: Status, growth?: StatusGrowth): string[] {
  const $ = cheerio.load(statusMarkup(status, growth));
  const box = $("[role='status'], [role='alert']");
  expect(box.length, status.kind).toBe(1);
  return (box.attr("class") ?? "").split(/\s+/).filter(Boolean);
}

/**
 * Ways of making text stop at a box's edge by not showing it. Any one of these
 * on the status box would hide the tail of a refusal instead of wrapping it.
 */
const CLIPPING = ["truncate", "overflow-hidden", "text-ellipsis", "text-clip", "whitespace-nowrap"];

describe("the status box's width cap binds on the words inside it", () => {
  it("carries a break rule beside its cap, in every kind it draws a box for", () => {
    // `max-w-xs` alone is a promise about the box that the text is free to
    // ignore, and did: 1117px of it, past the container and unbacked.
    for (const status of KINDS.filter((kind) => kind.kind !== "idle")) {
      for (const growth of ["down", "up"] satisfies StatusGrowth[]) {
        const classes = boxClasses(status, growth);
        expect(classes, `${status.kind}/${growth}`).toContain("max-w-xs");
        expect(classes, `${status.kind}/${growth}`).toContain("wrap-break-word");
      }
    }
    // ...and the negative fixture that keeps that honest (LESSONS 3): the
    // resting cell draws no box at all, so "contains" really does discriminate.
    const resting = render(
      h(EditableCell, { value: "Tuzi", onSave: noop, label: "label of walk_sandbox" }),
    );
    expect(classesOf(resting)).not.toContain("wrap-break-word");
    expect(classesOf(statusMarkup({ kind: "idle" }))).toEqual([]);
  });

  it("wraps the overflow rather than hiding it, so no refusal is ever cut short", () => {
    // The decision in the fix: a clipped box would also stop the painting QA
    // measured, by swallowing the end of the database's sentence — the half
    // this surface exists to show verbatim.
    for (const status of KINDS.filter((kind) => kind.kind !== "idle")) {
      for (const clip of CLIPPING) {
        expect(boxClasses(status), `${status.kind}/${clip}`).not.toContain(clip);
      }
      expect(
        boxClasses(status).filter((name) => name.startsWith("line-clamp-")),
        status.kind,
      ).toEqual([]);
    }
  });

  it("leaves the database's words exactly as they arrived, however long the token", () => {
    // A break rule is a rendering instruction, never an edit: no hyphen is
    // inserted into the text, nothing is elided, and both halves are still
    // inside the one region a screen reader is interrupted with.
    const token = `nope-${"x".repeat(300)}`;
    const message = `invalid input syntax for type date: "${token}" (22007)`;
    const { failed, fix } = halves(message);
    expect(failed).toEqual(message);
    expect(fix).toEqual(refusalFix(message));
    expect(announced(statusMarkup({ kind: "failed", message }), "alert")).toContain(token);
  });
});


/* ── a refused write says what to do about it ──────────────────────
 *
 * campaign admin-window/BUG-0098. Measured by the designer on the M2 early
 * walk (2026-09-08, walk instance on 8771 against staging, `walk_sandbox` row
 * …0001): the whole of what a refused save told the operator was the
 * database's sentence in red mono. Typing `seven` into `tally` said `invalid
 * input syntax for type integer: "seven" (22P02)` and nothing about tally
 * holding a whole number; clearing `label` said Postgres's entire DETAIL line,
 * every column value of the row included, and nothing about label not being
 * emptiable. Every READ in this app already carries both halves
 * (`ui/error-line.tsx`), which is the two lines of LOOK_AND_FEEL this broke.
 *
 * These assert the ANATOMY and the DERIVATION, never the sentences: which
 * half is in which face, that the machine's words survive untouched, that
 * three different refusals get three different fixes, and that an unrecognised
 * refusal still gets one. Reworded fixes stay green; a bare refusal does not.
 */

/** The three refusals of criterion 3, each in the words its producer uses. */
const REFUSALS = {
  /** The walk's own measurement, verbatim (`tally`, typed `seven`). */
  coercion: 'invalid input syntax for type integer: "seven" (22P02)',
  /** The walk's own measurement, verbatim (`label`, select-all + Delete). */
  notNull:
    'null value in column "label" of relation "walk_sandbox" violates ' +
    "not-null constraint Failing row contains " +
    "(00000000-0000-4000-8000-000000000001, null, walk probe 0908, 7, f, " +
    "2026-01-15, 2026-09-09 05:10:25.030369+00). (23502)",
  /**
   * The shape FEAT-0011's override half will produce, assembled from the
   * gate's OWN `raise` — message, then `detail`, then `hint`, then the code,
   * which is the order `errorMessage` joins them in (`lib/db/result.ts`). The
   * format strings are the scraper's, in
   * `supabase/migrations/20260818000000_the_schema_arrives_as_one_snapshot.sql`
   * (the `KS003` arm on `jsonb_matches_schema`); the pattern is the one
   * `lib/edit/config.ts` names for `venues.country`.
   */
  registry:
    'observation rejected: value for field "venues.country" violates domain ' +
    '"venues" schema v3 source=admin domain=venues entity_type=venue ' +
    'field=country value="usa" reason="usa" does not match "^[A-Z]{2}$" ' +
    "correct the value, or widen the field's declaration in " +
    "registry/schemas/venues.schema.json and bump schema.version (KS003)",
} as const;

/** The two halves of a refused write's line, addressed by their faces. */
function halves(message: string): { failed: string; fix: string } {
  const $ = cheerio.load(statusMarkup({ kind: "failed", message }));
  const read = (face: string) => {
    const parts = $(`.${face}`);
    expect(parts.length, `one ${face} half`).toBe(1);
    return parts.text().replace(/\s+/g, " ").trim();
  };
  return { failed: read("type-data"), fix: read("type-body") };
}

/**
 * Words this app never says (LOOK_AND_FEEL copy bar 3: "with no apology"), and
 * the reassurance the Look bans beside them.
 */
const APOLOGY = /\b(sorry|oops|unfortunately|whoops|apolog\w*)\b|something went wrong|don't worry|please try/i;

describe("a refused write names what failed and what to do", () => {
  it("renders both halves at the field, the machine's words in mono and the fix in sans", () => {
    for (const [name, message] of Object.entries(REFUSALS)) {
      const { failed, fix } = halves(message);
      // Half one: the database's own refusal, not paraphrased, not shortened.
      expect(failed, name).toEqual(message);
      // Half two: the app's own words — present, and not a slice of the
      // machine's, which is what "in the app's voice" has to mean if it means
      // anything.
      expect(fix, name).toMatch(/\S/);
      expect(message.includes(fix), `${name}: the fix is the machine's words`).toBe(false);
    }
  });

  it("said nothing but the refusal before, which is the bug: the second half is new", () => {
    // The negative fixture that keeps the check above honest — the failure
    // line is the ONLY status with two faces on it. `saving…` and `saved` are
    // one word each and gained nothing.
    for (const kind of ["saving", "saved"] as const) {
      const $ = cheerio.load(statusMarkup({ kind }));
      expect($(".type-body").length, kind).toBe(0);
      expect($(".type-data").length, kind).toBe(1);
    }
  });

  it("derives a different fix for each of the three refusals, none of them the fallback", () => {
    const fixes = Object.entries(REFUSALS).map(([name, message]) => {
      const fix = refusalFix(message);
      expect(fix, `${name} fell through to the general sentence`).not.toEqual(GENERAL_FIX);
      return fix;
    });
    expect(new Set(fixes).size, "three refusals, three fixes").toBe(fixes.length);
  });

  it("says what to type when the database refused the value's TYPE", () => {
    // Not the wording — that a coercion refusal's fix speaks about the form
    // the column stores, which the walk's operator was told nothing about.
    // One per coercion the sandbox's columns can be asked for, plus a type
    // nobody listed, which still names that type rather than falling back.
    const forms: [string, RegExp][] = [
      ['invalid input syntax for type integer: "seven" (22P02)', /whole number/i],
      ['invalid input syntax for type boolean: "yes" (22P02)', /true or false/i],
      ['invalid input syntax for type date: "yesterday" (22P02)', /2026-01-15/],
      ['invalid input syntax for type numeric: "lots" (22P02)', /number/i],
      ['invalid input syntax for type uuid: "not-a-uuid" (22P02)', /uuid/i],
      ['invalid input syntax for type inet: "here" (22P02)', /inet/i],
    ];
    for (const [message, form] of forms) {
      expect(refusalFix(message), message).toMatch(form);
    }
  });

  it("names the column a not-null refusal is about, out of the refusal's own words", () => {
    expect(refusalFix(REFUSALS.notNull)).toContain("label");
    // A not-null refusal that names no column still gets the same advice,
    // about the column rather than about nothing.
    const unnamed = refusalFix("violates not-null constraint");
    expect(unnamed).toMatch(/\S/);
    expect(unnamed).not.toEqual(GENERAL_FIX);
    expect(unnamed).not.toContain("label");
  });

  it("names the field a registry pattern refused, unqualified as the line is drawn", () => {
    // The gate spells it `venues.country`; the operator is looking at a line
    // called `country` (admin-window/FEAT-0011's refusal, spec'd here before
    // it can be walked).
    const fix = refusalFix(REFUSALS.registry);
    expect(fix).toContain("country");
    expect(fix).not.toContain("venues.country");
    // And it does not invent an example of the pattern: this repo holds no
    // copy of any registry pattern by design (`lib/edit/config.ts`), so the
    // pattern stays in the mono half where the gate put it.
    expect(fix).not.toContain("^[A-Z]{2}$");
  });

  it("falls back to a general fix rather than to nothing, for a refusal it has never seen", () => {
    for (const message of [
      REFUSAL,
      "the edit was refused (502)",
      "TypeError: fetch failed",
      "",
    ]) {
      expect(refusalFix(message), message).toEqual(GENERAL_FIX);
    }
    expect(GENERAL_FIX).toMatch(/\S/);
  });

  it("does not send an operator round a loop when the refusal is not about the value", () => {
    // The override path's normal answer for the whole of M2 (the route's 503).
    // "Correct the value and save again" is advice that cannot work here, so
    // this arm exists to not give it.
    const fix = refusalFix("settle_review_item is not present in this database");
    expect(fix).not.toEqual(GENERAL_FIX);
    expect(fix).not.toMatch(/save again/i);
  });

  it("speaks in the app's voice in every arm it has: no apology, one sentence, sentence case", () => {
    const everyFix = [
      ...Object.values(REFUSALS).map(refusalFix),
      refusalFix("settle_review_item is not present in this database"),
      refusalFix("violates not-null constraint"),
      refusalFix('invalid input syntax for type inet: "here"'),
      GENERAL_FIX,
    ];
    for (const fix of everyFix) {
      expect(fix, fix).not.toMatch(APOLOGY);
      // One sentence, finished: nothing after a full stop starts another, and
      // the fix fits the 320px box the walk measured this line in.
      expect(fix, `${fix}: ends`).toMatch(/\.$/);
      expect(fix, `${fix}: one sentence`).not.toMatch(/[.!?]\s+\S/);
      expect(fix, `${fix}: no shouting`).not.toContain("!");
    }
    // The guard proves itself on an input it MUST flag (LESSONS 3): a check
    // that has only ever seen text it passes passes vacuously.
    expect("Sorry, something went wrong. Please try again.").toMatch(APOLOGY);
  });

  it("keeps the refusal one interruption, with both halves inside it", () => {
    // `role="alert"` is criterion 4: it was on the refusal before and the
    // second half must not have split it into two regions, or a screen reader
    // is interrupted with half of what the screen says.
    for (const message of Object.values(REFUSALS)) {
      const markup = statusMarkup({ kind: "failed", message });
      const said = announced(markup, "alert");
      expect(said, message).toContain(message);
      expect(said, message).toContain(refusalFix(message));
      expect(announced(markup, "status"), message).toBeNull();
    }
  });

  // Was a PIN (`it.fails`) while the divergence stood; admin-window/BUG-0103
  // closed it and the pin became a plain expectation, which is what the pin
  // was written to become.
  it("picks the arm from the database's words, not from what the operator typed (admin-window/BUG-0103)", () => {
    // The refusal a coercion produces QUOTES the operator's own value back
    // (`invalid input syntax for type integer: "<what they typed>"`), and the
    // arms match on the whole string, so a value carrying another arm's prose
    // steers the sentence. Asserted relationally, never against copy: two
    // refusals of the SAME class, differing only in the quoted value, must
    // carry the same fix, whatever the operator typed.
    const quoted = (value: string) =>
      `invalid input syntax for type integer: "${value}" (22P02)`;
    const benign = refusalFix(quoted("seven"));
    for (const typed of [
      "violates not-null constraint",
      "is not present in this database",
      "does not match",
      "(23502)",
    ]) {
      expect(refusalFix(quoted(typed)), typed).toEqual(benign);
    }
  });

  it("takes the arm from the code the refusal STATES, both directions (admin-window/BUG-0103)", () => {
    // The two halves of the same rule, each stated on its own so a regression
    // says which direction broke. Relational throughout: no sentence of copy
    // appears here, only "these two refusals derive the same fix" and "these
    // two derive different ones".

    // One: a coercion whose quoted value is ANOTHER arm's code. The code that
    // decides is the one the database appended last, never one the operator
    // typed inside the quotes.
    const quotesACode = 'invalid input syntax for type integer: "(23502)" (22P02)';
expect(refusalFix(quotesACode)).toEqual(refusalFix(REFUSALS.coercion));

    // Two: a genuine 23502 whose failing-row DETAIL carries an earlier arm's
    // prose — a value in some OTHER column of the row Postgres dumps — is
    // still a not-null refusal, and still names the column that was emptied.
    const carriesAnotherArmsProse = REFUSALS.notNull.replace(
      "walk probe 0908",
      "settle_review_item is not present in this database",
    );
    expect(carriesAnotherArmsProse, "the fixture really carries it").not.toEqual(
      REFUSALS.notNull,
    );
    expect(refusalFix(carriesAnotherArmsProse)).toEqual(refusalFix(REFUSALS.notNull));
    expect(refusalFix(carriesAnotherArmsProse)).toContain("label");

    // ...and the two arms are distinguishable, so neither equality above is
    // satisfied by every refusal collapsing onto one sentence.
    expect(refusalFix(REFUSALS.coercion)).not.toEqual(refusalFix(REFUSALS.notNull));
    for (const fix of [refusalFix(quotesACode), refusalFix(carriesAnotherArmsProse)]) {
      expect(fix).not.toEqual(GENERAL_FIX);
    }
  });

  /*
   * PIN — admin-window/BUG-0103, second cut. Measured live 2026-09-09 on a
   * production build of the landed tree (127.0.0.1:8840, staging
   * ubfjjqlvnpnoborczbdb, walk_sandbox row …0001, bundled Chromium 1440x900),
   * through the cell.
   *
   * The structural guard is the SQLSTATE the refusal states LAST — but the
   * refusal does not always state it. `errorMessage` appends the code "only
   * when the account does not already spell it" (`lib/db/result.ts`), so a
   * refusal whose own text happens to contain `23502` arrives WITHOUT the
   * trailing code, the guard falls through to prose, and a not-null refusal's
   * prose is a whole failing-row dump whose values Postgres writes UNQUOTED —
   * where `QUOTED_RUN` cannot strike them out. A value in any other column of
   * the row then chooses the sentence again, which is the defect this ticket
   * is about.
   */
  it.fails("picks the arm from the database's words when the refusal states no code (admin-window/BUG-0103)", () => {
    // One shape, one class, one column emptied: a genuine 23502 about `label`,
    // varying only in a value the operator typed into ANOTHER cell — and in
    // every variant the row dump spells `23502`, so none of them carries the
    // trailing code. Relational: same class, same fix.
    const dumped = (note: string) =>
      'null value in column "label" of relation "walk_sandbox" violates ' +
      "not-null constraint Failing row contains " +
      `(00000000-0000-4000-8000-000000000001, null, ${note}, 7, f, ` +
      "2026-01-15, 2026-09-09 07:14:27.7384+00).";
    const benign = refusalFix(dumped("a note 23502"));
    expect(benign, "the codeless not-null still reaches its own arm").not.toEqual(
      GENERAL_FIX,
    );
    for (const note of [
      "is not present in this database 23502",
      "23502 is not present in this database",
    ]) {
      expect(refusalFix(dumped(note)), note).toEqual(benign);
    }
  });

  it("keeps red on the failure line and off the value the field reverted to", () => {
    // LOOK_AND_FEEL: "Red means broken, never unavailable." The reverted value
    // is the button's, in primary ink, and the only thing carrying the broken
    // colour is the line stating the refusal.
    const $ = cheerio.load(statusMarkup({ kind: "failed", message: REFUSALS.notNull }));
    const broken = $('[class*="text-broken"]');
    expect(broken.length, "one broken element, the line itself").toBe(1);
    expect(broken.attr("role")).toEqual("alert");

    const cell = cheerio.load(
      render(h(EditableCell, { value: "walk probe 0908", onSave: noop, label: "note of walk_sandbox" })),
    );
    const button = (cell("button").attr("class") ?? "").split(/\s+/);
    expect(button).toContain("text-ink");
    expect(button).not.toContain("text-broken");
  });
});

/* ── the press opens the cell, not the release ─────────────────────
 *
 * campaign admin-window/BUG-0086, the third cut. The two before it took every
 * part but the value out of the row's flow (`cellLayout` above) and the defect
 * still came back, because the last thing left in the flow is the value the
 * operator just corrected: blur commits, the resting button reappears carrying
 * the longer value, and an auto-layout table re-apportions its columns on that
 * alone.
 *
 * Measured by QA on a production build against staging, 2026-09-09, both
 * themes, from the same fixture state: with an ordinary 56-character
 * correction committed in `note`, every other value in the Value column moved
 * 59.48px LEFT inside one 120ms press, `elementFromPoint` at the press point
 * became a `<td>` of another row, and nothing opened. The ladder from that
 * start, one click each: 34 chars -> 0.00px and the press opens; 56 ->
 * -59.48px, swallowed; 71 -> -86.51px; 122 -> -138.59px. No cell chrome is
 * involved, and no layout rule of this cell's can reach it — the resting value
 * IS the row's box, and something has to be.
 *
 * So the fix is on the other side of the race: `opensCell` opens the cell at
 * `pointerdown`, before anything can move, and refuses the `click` a pointer
 * press produces — which is dispatched at whatever the reflow left under the
 * pointer, and which QA named as the risk this defect carries (that may be
 * another editable value's button, and a cell opens with its whole value
 * selected). Keyboard activation arrives as a click carrying no pointer
 * (`detail === 0`) and is the one click that still opens.
 *
 * Which event opened the cell is a browser fact and this tier is environment
 * node with `renderToStaticMarkup` and no jsdom (STACK.md §4) — handlers do
 * not survive into markup at all. What is pinned here is the rule, exactly as
 * `focusVerdict` and `selectOnOpen` pin theirs; that the button is wired to it
 * at `onPointerDown` is measured in the walk, as their focus and selection are.
 */

/** A press with everything ordinary, overridden a field at a time. */
function press(overrides: Partial<OpenPress> = {}): OpenPress {
  return {
    source: "pointerdown",
    button: 0,
    detail: 1,
    editing: false,
    disabled: false,
    ...overrides,
  };
}

describe("a pointer opens the cell at the press, which no reflow can outrun", () => {
  it("opens on pointerdown, and not on the click that same press ends with", () => {
    // The whole fix in two lines. The click is the event that arrives after
    // the table has re-apportioned, i.e. after the button it was aimed at has
    // moved: it opens nothing, so nothing is swallowed and nothing is missed.
    expect(opensCell(press({ source: "pointerdown" }))).toBe(true);
    expect(opensCell(press({ source: "click", detail: 1 }))).toBe(false);
  });

  it("never opens from a pointer's click, at any click count", () => {
    // The risk QA stated: at the measured deltas the release landed on a
    // `<td>`, but a layout where it lands on ANOTHER value's button would open
    // the wrong field — and a cell opens with its value selected, so the next
    // keystroke would replace it. A pointer-borne click opens nothing here.
    for (const detail of [1, 2, 3, 4]) {
      expect(opensCell(press({ source: "click", detail })), `detail=${detail}`).toBe(false);
    }
  });

  it("still opens from the keyboard, which sends a click and no pointer at all", () => {
    // Enter and Space on the resting button, and an assistive technology's
    // `.click()`, are all a click with no pointer behind it (`detail === 0`).
    // Losing them would trade one operator's defect for another's.
    expect(opensCell(press({ source: "click", detail: 0 }))).toBe(true);
  });

  it("opens for the primary press only, so a context-menu press opens nothing", () => {
    expect(opensCell(press({ button: 0 }))).toBe(true);
    for (const button of [1, 2, 3, 4]) {
      expect(opensCell(press({ button })), `button=${button}`).toBe(false);
      expect(opensCell(press({ source: "click", detail: 0, button })), `key button=${button}`)
        .toBe(false);
    }
  });

  it("refuses a press on a cell that is already open", () => {
    // The open cell's own button is hidden under its field, but a press that
    // reached it would hand out a second edit ordinal for one visit.
    for (const source of ["pointerdown", "click"] as const) {
      expect(opensCell(press({ source, detail: 0, editing: true })), source).toBe(false);
    }
  });

  it("refuses a press while this cell's own write is in flight", () => {
    // The resting control is `disabled` for the whole write (`focusVerdict`
    // waits on the same fact), and a disabled button dispatches no click —
    // but pointer events reach one in some browsers, so the rule says it.
    for (const source of ["pointerdown", "click"] as const) {
      expect(opensCell(press({ source, detail: 0, disabled: true })), source).toBe(false);
    }
  });

  it("is not vacuously true: it says no to most of what it can be asked", () => {
    // Over every press this control can see, exactly the two openings above
    // are accepted (LESSONS 3: a rule that never refused proves nothing).
    const opened: string[] = [];
    for (const source of ["pointerdown", "click"] as const) {
      for (const button of [0, 1, 2]) {
        for (const detail of [0, 1, 2]) {
          for (const editing of [false, true]) {
            for (const disabled of [false, true]) {
              const what = { source, button, detail, editing, disabled };
              if (opensCell(what)) opened.push(JSON.stringify(what));
            }
          }
        }
      }
    }
    expect(opened.sort()).toEqual(
      [
        { source: "pointerdown", button: 0, detail: 0, editing: false, disabled: false },
        { source: "pointerdown", button: 0, detail: 1, editing: false, disabled: false },
        { source: "pointerdown", button: 0, detail: 2, editing: false, disabled: false },
        { source: "click", button: 0, detail: 0, editing: false, disabled: false },
      ]
        .map((what) => JSON.stringify(what))
        .sort(),
    );
  });
});
