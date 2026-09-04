import * as cheerio from "cheerio";
import { describe, expect, it } from "vitest";

import {
  EditableCell,
  EditField,
  EditStatus,
  type Status,
  editHint,
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
