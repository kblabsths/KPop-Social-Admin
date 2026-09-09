import fs from "node:fs";
import path from "node:path";
import * as cheerio from "cheerio";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Status } from "@/components/EditableCell";
import {
  PickerOptions,
  PickerPanel,
  PickerValue,
  matchOptions,
  noMatchWords,
  optionFor,
  pickerWindowName,
  type PickerOption,
  type PickerWindow,
} from "@/components/records/entity-picker";
import { recordFields } from "@/components/records/fields";
import { EDIT_CONFIG, decideEdit, decideReference } from "@/lib/edit/config";
import { EM_DASH } from "@/lib/format";
import { codeText, repoRoot, sourceFiles, sourceText } from "../source-tree";

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
   * A strict xfail pin for admin-window/BUG-0097 — `it.fails` passes only
   * while the assertion below FAILS, so the day the guard lands this turns red
   * and sends the reader to the ticket. Flip it back to a plain `it(...)` then.
   *
   * Today every option is still clickable under `saving`, so a second click
   * sends a second PATCH for the same field: two override decisions for one
   * intent, and the value the panel settles on is whichever answer came back
   * last rather than the choice made last.
   */
  it.fails("offers no option that would start a second write while one is saving", () => {
    expect(liveOptions(panelAt({ kind: "saving" }))).toBe(0);
  });

  it("offers them again once the write has answered", () => {
    expect(liveOptions(panelAt({ kind: "saved" }))).toBe(OPTIONS.length);
    expect(liveOptions(panelAt({ kind: "failed", message: "refused" }))).toBe(
      OPTIONS.length,
    );
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

  it("says the window filled its cap when it did, on top of the same sentence", () => {
    const open = cheerio.load(panel("", windowOf(OPTIONS, { truncated: false })))(
      "[data-window]",
    ).text();
    const filled = cheerio.load(panel("", windowOf(OPTIONS, { truncated: true })))(
      "[data-window]",
    ).text();
    expect(filled.startsWith(open)).toBe(true);
    expect(filled.length).toBeGreaterThan(open.length);
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
