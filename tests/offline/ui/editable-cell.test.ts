import * as cheerio from "cheerio";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { RecordFields } from "@/components/records/record-fields";
import type { RecordField } from "@/components/records/fields";
import {
  type CellLayout,
  type HintSide,
  cellLayout,
  hintSide,
  occupiesFlow,
} from "@/components/edit-cell-layout";
import {
  type EditEnding,
  type EditEvent,
  type EditState,
  EditableCell,
  EditField,
  EditStatus,
  IDLE_EDIT_STATE,
  type SaveOutcome,
  type Status,
  confirmationDelayMs,
  editHint,
  focusVerdict,
  reduceEdit,
  selectOnOpen,
} from "@/components/EditableCell";
import { EM_DASH } from "@/lib/format";

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

function statusMarkup(status: Status): string {
  return render(h(EditStatus, { status }));
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


/* ── an open cell moves nothing ────────────────────────────────────────────
 *
 * campaign admin-window/BUG-0086. Measured by QA on the TASK-0053 attack
 * (2026-09-08, production build against staging, viewport 1400x950): with
 * `label` open, the `note` cell's resting button had moved 101px left and 26px
 * down — the open field claimed the column's full width and the hint line was
 * added to the row's flow. One human-timed click on `note` then hit its button
 * at mousedown and a `<td>` of a different row at mouseup: nothing opened, and
 * the operator had to click twice to correct a second field.
 *
 * A bounding box is a browser fact and this tier is environment node with
 * `renderToStaticMarkup` and no jsdom (STACK.md §4), so what is pinned here is
 * `cellLayout` — the rule the rendering obeys — exactly as `focusVerdict` and
 * `selectOnOpen` pin theirs. The boxes themselves are measured in the walk.
 */

/** The parts of a cell that take space in the row, in a given layout. */
function flowing(layout: CellLayout): string[] {
  return (["value", "field", "hint"] as const).filter((part) =>
    occupiesFlow(layout[part]),
  );
}

describe("opening a cell moves no other row", () => {
  it("puts nothing into the row's flow that a resting cell does not, and takes nothing out", () => {
    // The whole fix in one line: only a part that takes space in the row can
    // move another row's control out from under a pointer.
    expect(flowing(cellLayout(true))).toEqual(flowing(cellLayout(false)));
  });

  it("keeps the value holding the box it held, and shows it to nobody", () => {
    // Something has to hold the row's height while the field is open, and the
    // only box that is certainly the right one is the one that was there.
    expect(occupiesFlow(cellLayout(true).value)).toBe(true);
    expect(cellLayout(true).value).toEqual("flow-hidden");
    expect(cellLayout(false).value).toEqual("flow");
  });

  it("draws everything edit mode adds outside the flow, in every state it is drawn at all", () => {
    for (const editing of [false, true]) {
      const layout = cellLayout(editing);
      for (const part of ["field", "hint"] as const) {
        if (layout[part] === "absent") continue;
        expect(occupiesFlow(layout[part]), `${part}, editing=${editing}`).toBe(false);
      }
    }
  });

  it("lets a click pass through the hint, which hangs over another row's control", () => {
    // A float that swallowed the click would be the same defect wearing the
    // fix's clothes: the operator would still have to click twice.
    expect(cellLayout(true).hint).toEqual("float-inert");
    // The field is not inert — it is the thing being typed into.
    expect(cellLayout(true).field).toEqual("float");
  });

  it("is not vacuously true: the two states really do differ", () => {
    // A rule both sides of which are the same object proves nothing (LESSONS 3).
    expect(cellLayout(true)).not.toEqual(cellLayout(false));
    expect(occupiesFlow("float")).toBe(false);
    expect(occupiesFlow("flow")).toBe(true);
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
