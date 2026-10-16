import * as cheerio from "cheerio";
import { describe, expect, it, vi } from "vitest";
import { T } from "@/lib/db/tables";
import { CLAMP_LIMIT, ELLIPSIS, EM_DASH } from "@/lib/format";
import { VERDICT_ACTIONS } from "@/lib/verdict/decision";
import { Identifier } from "@/components/ui/identifier";
import { h, render } from "../ui/markup";
import {
  classesOf,
  expectDrawnAsLinkAtRest,
  expectNotDrawnAsLink,
} from "../../fixtures/link-spelling";
import { stateOf as surfaceStateOf } from "../../live/parity";
import {
  ID,
  observationRow,
  verdictLogEntry,
  type ObservationRow,
  type VerdictLogEntry,
} from "../../fixtures/rows";
import {
  permissionDenied,
  stubClient,
  tableNotInSchemaCache,
  transportFailure,
  undefinedTable,
  type Script,
} from "../../fixtures/stub-client";

/**
 * The verdict log, as the Queues page's own tab renders it (campaign
 * admin-window/TASK-0058, spec F13).
 *
 * The page function is the route's only async component (ARCHITECTURE.md §5),
 * so the whole test is `renderToStaticMarkup(await QueuesPage(props))` — no
 * jsdom, no database. The read is stubbed at `getDbClient`, the ONE seam this
 * app resolves a client through, so both of the tab's legs (`verdicts`, and
 * the `observations` leg that only supplies a link) go through one script.
 *
 * **Absence is the graded normal case**: `verdicts` arrives with M2's handoff
 * migration and is on neither staging nor production, so the state this file
 * exercises first is the one an operator sees today.
 *
 * Assertions are STRUCTURE and BEHAVIOUR — which rows render in which order,
 * which hooks they carry, which state the surface declares — plus the
 * machine's own strings where rendering them VERBATIM is the requirement (the
 * eight actions, the missing table's name). No class LITERAL and no copy of
 * the app's own words is pinned — the one rendering rule asserted below reads
 * the app's own link constant rather than repeating it
 * (`tests/fixtures/link-spelling.ts`, admin-window/BUG-0108).
 */

const readWith = vi.hoisted(() => ({ client: undefined as unknown }));

vi.mock("@/lib/db/client", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/db/client")>();
  return {
    ...actual,
    getDbClient: () => {
      if (readWith.client === undefined) {
        throw new Error("a verdict-log render was made with no database scripted");
      }
      return readWith.client as never;
    },
  };
});

const QueuesPage = (await import("@/app/queues/page")).default;

/** The tab this file is about, as a URL facet — never a path segment. */
const TAB = { tab: "verdict_log" } as const;

/** The log's surface and its provenance sub-surface, by name, never by position. */
const LOG = '[data-surface="verdict_log"]';
const PROVENANCE = '[data-surface="verdict_provenance"]';

/** The window the tab draws, spelled here rather than imported from the read. */
const WINDOW = "100";

async function renderQueues(
  script: Script,
  params: Record<string, string | string[]> = TAB,
): Promise<string> {
  readWith.client = stubClient(script).asSupabaseClient();
  return render(await QueuesPage({ searchParams: Promise.resolve(params) }));
}

/** A database holding these verdicts, these observations, and no review items. */
function scriptOf(
  verdicts: VerdictLogEntry[],
  observations: ObservationRow[] = [],
): Script {
  return {
    [T.verdicts]: { data: verdicts, count: verdicts.length },
    [T.observations]: { data: observations, count: observations.length },
    [T.reviewItems]: { data: [], count: 0 },
  };
}

/* ── the population ──────────────────────────────────────────────────────── */

const OTHER_OBSERVATION = "01920000-0000-7000-8000-000000000399";
const OTHER_ITEM = "01920000-0000-7000-8000-000000000599";

/**
 * Four verdicts covering the shapes of row §7's table admits, written out of
 * order on purpose so "newest first" is a claim this file can fail.
 *
 * One `created_at` is spelled `Z` and one `+00:00`, for the reason
 * `reviewItemEdgePopulation` does the same: PostgREST spells the offset where
 * a fixture spells `Z`, and the two orderings disagree lexicographically for
 * one and the same instant.
 */
const SETTLEMENT = verdictLogEntry({
  verdict_id: "01920000-0000-7000-8000-000000000801",
  action: "choose_claimed_value",
  note: "The Ticketmaster title matches the venue listing.",
  created_at: "2026-09-07T09:00:00Z",
});
const OVERRIDE = verdictLogEntry({
  verdict_id: "01920000-0000-7000-8000-000000000802",
  action: "override",
  // The item-less row: an override settles nothing.
  review_item_id: null,
  observation_id: OTHER_OBSERVATION,
  note: null,
  created_at: "2026-09-08T12:00:00+00:00",
});
const SETTLE_ONLY = verdictLogEntry({
  verdict_id: "01920000-0000-7000-8000-000000000803",
  action: "wont_fix",
  review_item_id: OTHER_ITEM,
  // The value-less row: a disposition observes nothing.
  observation_id: null,
  note: "The source is paused; the condition stands.",
  created_at: "2026-09-06T08:00:00Z",
});
const NEWEST = verdictLogEntry({
  verdict_id: "01920000-0000-7000-8000-000000000804",
  action: "link_entity",
  observation_id: null,
  note: null,
  created_at: "2026-09-08T18:30:00Z",
});

const POPULATION = [SETTLE_ONLY, NEWEST, SETTLEMENT, OVERRIDE];

/** Newest first, spelled here from the instants rather than asked of the app. */
const NEWEST_FIRST = [NEWEST, OVERRIDE, SETTLEMENT, SETTLE_ONLY].map(
  (row) => row.action,
);

const OBSERVATIONS = [
  observationRow({
    observation_id: ID.observationA,
    domain: "events",
    entity_id: ID.eventEntity,
  }),
  observationRow({
    observation_id: OTHER_OBSERVATION,
    domain: "venues",
    entity_id: ID.groupEntity,
  }),
];

/* ── reading the markup, structurally ────────────────────────────────────── */

/** How many rows the log drew. */
function rowCount(markup: string): number {
  return cheerio.load(markup)(`${LOG} tbody tr`).length;
}

/** The verdicts rendered, in rendered order, read off each row's action hook. */
function renderedOrder(markup: string): string[] {
  const $ = cheerio.load(markup);
  return $(`${LOG} tbody tr`)
    .toArray()
    .map((tr) => $(tr).find("[data-verdict-action]").attr("data-verdict-action") ?? "");
}

function cellsOf(markup: string, verdictAction: string) {
  const $ = cheerio.load(markup);
  const row = $(`${LOG} [data-verdict-action="${verdictAction}"]`).closest("tr");
  return {
    text: row.text().replace(/\s+/g, " ").trim(),
    cells: row
      .find("td")
      .toArray()
      .map((td) => $(td).text().trim()),
    item: row.find("[data-verdict-item]").attr("data-verdict-item"),
    itemHref: row.find("[data-verdict-item]").attr("href"),
    observation: row.find("[data-verdict-observation]").attr("data-verdict-observation"),
    observationHref: row.find("[data-verdict-observation]").attr("href"),
    actor: row.find("[data-verdict-actor]").attr("data-verdict-actor"),
  };
}

/**
 * Two of the log's columns by POSITION, named once — `cellsOf` returns the
 * row's cells in render order, and an index spelled at a call site is a number
 * a reader has to count out. Order is §7's: actor, action, item, observation,
 * note, when.
 */
const ACTOR = 0;
const ACTION = 1;
const ITEM = 2;
const OBSERVATION = 3;
const NOTE = 4;
const WHEN = 5;

/**
 * How many of the APP's dashes a given cell holds — `nullDash`'s marked
 * element (`lib/format.ts`), not the character. A cell that spells an em dash
 * itself would satisfy a text assertion and still be a surface writing its own
 * absence rendering; this asks for the one the whole app draws.
 */
function dashesIn(markup: string, verdictAction: string, at: number): number {
  const $ = cheerio.load(markup);
  return $(`${LOG} [data-verdict-action="${verdictAction}"]`)
    .closest("tr")
    .find("td")
    .eq(at)
    .find('[aria-label="no value"]').length;
}

/** The `title` the note cell's own element carries, if it drew one. */
function noteTitle(markup: string, verdictAction: string): string | undefined {
  const $ = cheerio.load(markup);
  return $(`${LOG} [data-verdict-action="${verdictAction}"]`)
    .closest("tr")
    .find("td")
    .eq(NOTE)
    .find("span")
    .attr("title");
}

/**
 * The cell texts of a log rendered with exactly ONE verdict, in render order —
 * `cellsOf` selects its row by the action's own value, which a hostile action
 * would have to be escaped into a selector to reach.
 */
function soleRowCells(markup: string): string[] {
  const $ = cheerio.load(markup);
  const rows = $(`${LOG} tbody tr`);
  if (rows.length !== 1) throw new Error(`expected one row, drew ${rows.length}`);
  return rows
    .find("td")
    .toArray()
    .map((td) => $(td).text().trim());
}

function windowHooks(markup: string): Record<string, string | undefined> {
  const line = cheerio.load(markup)('[data-window="verdict_log"]');
  return {
    held: line.attr("data-window-held"),
    limit: line.attr("data-window-limit"),
    truncated: line.attr("data-window-truncated"),
  };
}

/* ── absence, first, because it is the normal case ───────────────────────── */

describe("the tab against a database without verdicts", () => {
  for (const [code, absence] of [
    ["PGRST205", tableNotInSchemaCache],
    ["42P01", undefinedTable],
  ] as const) {
    it(`draws the card naming verdicts and states no window (${code})`, async () => {
      const markup = await renderQueues({
        [T.verdicts]: { error: absence(T.verdicts) },
        [T.observations]: { data: [], count: 0 },
        [T.reviewItems]: { data: [], count: 0 },
      });
      const $ = cheerio.load(markup);

      // The state is read structurally, never off the card's words: `Empty`
      // and `NotProvisioned` draw the identical container.
      expect(surfaceStateOf(markup, LOG)).toBe("not_provisioned");
      expect($("[data-not-provisioned]").attr("data-not-provisioned")).toBe(T.verdicts);
      // A read that never returned publishes no window line at all — the rule
      // graded for every surface at once in tests/offline/absence/pages.test.ts.
      expect($('[data-window="verdict_log"]')).toHaveLength(0);
      // …and no row, and no number invented for a table that is not there.
      expect(rowCount(markup)).toBe(0);
    });
  }

  it("asks observations nothing when verdicts was not there", async () => {
    const stub = stubClient({
      [T.verdicts]: { error: tableNotInSchemaCache(T.verdicts) },
      [T.observations]: { data: [], count: 0 },
      [T.reviewItems]: { data: [], count: 0 },
    });
    readWith.client = stub.asSupabaseClient();
    render(await QueuesPage({ searchParams: Promise.resolve(TAB) }));

    expect(stub.tablesRead()).toContain(T.verdicts);
    expect(stub.tablesRead()).not.toContain(T.observations);
  });

  it("reports a REFUSED read as an error, never as an absence", async () => {
    for (const failure of [permissionDenied(T.verdicts), transportFailure()]) {
      const markup = await renderQueues({
        [T.verdicts]: { error: failure },
        [T.observations]: { data: [], count: 0 },
        [T.reviewItems]: { data: [], count: 0 },
      });
      expect(surfaceStateOf(markup, LOG)).toBe("error");
      expect(cheerio.load(markup)('[data-window="verdict_log"]')).toHaveLength(0);
    }
  });
});

/* ── the read that happened and found nothing ────────────────────────────── */

describe("the tab against an empty verdicts table", () => {
  it("keeps its window line, stating a held zero, beside the empty card", async () => {
    const markup = await renderQueues(scriptOf([]));

    expect(surfaceStateOf(markup, LOG)).toBe("empty");
    // An empty window is still a window the page looked in: the line and the
    // card stand TOGETHER (ARCHITECTURE.md §4.3, admin-window/BUG-0070).
    expect(windowHooks(markup)).toEqual({
      held: "0",
      limit: WINDOW,
      truncated: "false",
    });
    expect(rowCount(markup)).toBe(0);
  });
});

/* ── the rows ────────────────────────────────────────────────────────────── */

describe("the rows the log renders", () => {
  it("renders every verdict of the window, newest first", async () => {
    const markup = await renderQueues(scriptOf(POPULATION, OBSERVATIONS));

    expect(surfaceStateOf(markup, LOG)).toBe("ok");
    expect(renderedOrder(markup)).toEqual(NEWEST_FIRST);
    expect(windowHooks(markup).held).toBe(String(POPULATION.length));
  });

  it("carries actor, action, item, observation, note and time on one row", async () => {
    const markup = await renderQueues(scriptOf(POPULATION, OBSERVATIONS));
    const row = cellsOf(markup, "choose_claimed_value");

    expect(row.actor).toBe(SETTLEMENT.actor);
    expect(row.item).toBe(SETTLEMENT.review_item_id);
    expect(row.itemHref).toBe(["", "queues", SETTLEMENT.review_item_id].join("/"));
    expect(row.observation).toBe(SETTLEMENT.observation_id);
    // The one place a rendered observation already leads in this app: the
    // record surface of the fact it is about.
    expect(row.observationHref).toBe(["", "records", "events", ID.eventEntity].join("/"));
    expect(row.text).toContain(SETTLEMENT.note);
    // The instant is relative, with the absolute value on a title (Voice 6).
    expect(row.text).not.toContain(SETTLEMENT.created_at);
  });

  /**
   * The log is the first screen an operator sees after the `verdicts`
   * migration lands, and both of its routes — the item a verdict settled and
   * the observation it acted on — shipped the spelling admin-window/BUG-0108
   * swept out of the other four surfaces: ink parked behind `hover:`, so a row
   * of ids reads as a row of ids.
   */
  it("draws the item and observation it links to as links at rest", async () => {
    const markup = await renderQueues(scriptOf(POPULATION, OBSERVATIONS));
    const $ = cheerio.load(markup);
    for (const hook of ["[data-verdict-item]", "[data-verdict-observation]"]) {
      const anchors = $(`${LOG} ${hook}[href]`).toArray();
      expect(anchors.length, `${hook} rendered no links at all`).toBeGreaterThan(0);
      for (const anchor of anchors) {
        expectDrawnAsLinkAtRest(classesOf($(anchor)), hook);
      }
    }
    // An observation this app cannot resolve is rendered verbatim and goes
    // nowhere (the leg's own case below): it must not wear the ink of the ones
    // that do, or the log would promise a route it has none of.
    const unlinked = cheerio.load(await renderQueues(scriptOf([SETTLEMENT], [])));
    const unresolved = unlinked(`${LOG} [data-verdict-observation]`).toArray();
    expect(unresolved.length, "no unresolved observation to compare against").toBe(1);
    for (const cell of unresolved) {
      expect(unlinked(cell).attr("href")).toBeUndefined();
      expectNotDrawnAsLink(classesOf(unlinked(cell)), "an unresolved observation id");
    }
  });

  it("orders two verdicts on one instant by id, whichever way the transport spells it", async () => {
    const first = verdictLogEntry({
      verdict_id: "0192bbbb-0000-7000-8000-00000000000a",
      action: "fixed",
      created_at: "2026-09-08T12:00:00Z",
    });
    const second = verdictLogEntry({
      verdict_id: "0192bbbb-0000-7000-8000-00000000000b",
      action: "keep_current",
      created_at: "2026-09-08T12:00:00+00:00",
    });

    const markup = await renderQueues(scriptOf([first, second]));
    const reversed = await renderQueues(scriptOf([second, first]));

    // Total order: the later id first, and the same order either way the rows
    // arrived, so the window is the same window twice running.
    expect(renderedOrder(markup)).toEqual(["keep_current", "fixed"]);
    expect(renderedOrder(reversed)).toEqual(renderedOrder(markup));
  });

  it("renders a verdict whose created_at will not parse, at the end, with no zero age", async () => {
    const unparseable = verdictLogEntry({
      verdict_id: "0192cccc-0000-7000-8000-000000000001",
      action: "settle",
      created_at: "not a timestamp",
    });
    const markup = await renderQueues(scriptOf([...POPULATION, unparseable]));

    expect(renderedOrder(markup).at(-1)).toBe("settle");
    expect(cellsOf(markup, "settle").cells.at(-1)).toBe(EM_DASH);
  });

  it("states a filled window as a floor rather than as the whole log", async () => {
    const full = Array.from({ length: 100 }, (unused, index) =>
      verdictLogEntry({
        verdict_id: `0192dddd-0000-7000-8000-${String(index).padStart(12, "0")}`,
        action: "keep_current",
        created_at: new Date(Date.UTC(2026, 8, 8, 0, index)).toISOString(),
      }),
    );
    const markup = await renderQueues(scriptOf(full));

    expect(rowCount(markup)).toBe(full.length);
    expect(windowHooks(markup)).toEqual({
      held: String(full.length),
      limit: WINDOW,
      truncated: "true",
    });
  });
});

/* ── the two structural nulls ────────────────────────────────────────────── */

describe("the nulls that are structure, not missing data", () => {
  it("dashes the item on an override and the observation on a settle-only verdict", async () => {
    const markup = await renderQueues(scriptOf(POPULATION, OBSERVATIONS));

    const override = cellsOf(markup, "override");
    expect(override.item).toBeUndefined();
    expect(override.cells[2]).toBe(EM_DASH);
    // …and the override's own observation is still there, and still a link.
    expect(override.observation).toBe(OTHER_OBSERVATION);

    const settleOnly = cellsOf(markup, "wont_fix");
    expect(settleOnly.observation).toBeUndefined();
    expect(settleOnly.cells[3]).toBe(EM_DASH);
    expect(settleOnly.item).toBe(OTHER_ITEM);
  });

  it("dashes a null note, with no qualifier beside it", async () => {
    const markup = await renderQueues(scriptOf(POPULATION, OBSERVATIONS));
    expect(cellsOf(markup, "override").cells[4]).toBe(EM_DASH);
  });

  it("says ONCE, on the surface, what a dash means here", async () => {
    const markup = await renderQueues(scriptOf(POPULATION, OBSERVATIONS));
    const $ = cheerio.load(markup);
    // Behaviour, not copy: the note carries its own hook, so this counts notes
    // rather than sentences. Counting em dashes instead would pass on a
    // surface with no note at all, because the window line above carries one
    // (measured on this tree — the first spelling of this case did exactly
    // that, and stayed green with the note deleted).
    const note = $(`${LOG} [data-absence-note]`);
    expect(note).toHaveLength(1);
    // It really is about the dash, and it stands outside the table's cells —
    // a qualifier inside a cell would read as an explanation of missing data.
    expect(note.text()).toContain(EM_DASH);
    expect(note.closest("td")).toHaveLength(0);
    // Every dash on a row is bare: the cell holds the character and nothing
    // else, whatever the note above says.
    for (const [action, index] of [
      ["override", 2],
      ["wont_fix", 3],
    ] as const) {
      expect(cellsOf(markup, action).cells[index]).toBe(EM_DASH);
    }
  });

  it("leaves no cell of any row blank", async () => {
    const markup = await renderQueues(scriptOf(POPULATION, OBSERVATIONS));
    expect(markup).not.toMatch(/<td[^>]*>\s*<\/td>/);
  });

  /**
   * A note that is PRESENT but blank — `""` or all whitespace — is an absence
   * everywhere else in this app: `isAbsent` (`lib/format.ts`) trims before it
   * decides, and `DataTable` passes every cell body through `orDash` for
   * exactly that reason. The log used to escape that rule because its note
   * column returned an ELEMENT (`<span title=...>`), which `isAbsent` never
   * looks inside — the shape `tests/offline/absence/blank-cells.test.ts` was
   * written to sweep, and which that sweep cannot reach here because it
   * renders one view per route and this surface is a TAB.
   *
   * The value is reachable: `src/app/api/admin/review-items/[reviewItemId]/settle/route.ts`
   * forwards `body.note` verbatim (the app's own control nulls a blank in
   * `components/review/close/actions.ts`, the ROUTE does not), and
   * `decisionRefusals` refuses a blank note only on `wont_fix`, so a settle
   * carrying `"note": ""` reaches `settle_review_item` and `verdicts.note` —
   * a nullable `text` with no CHECK (`for-human/M2-handoff-verdicts.md`).
   *
   * Fixed by admin-window/BUG-0085 in the column itself — it hands the `null`
   * over and lets the table draw the one dash, the way `/cycles`, `/sources`,
   * `/claims` and `/browse` all do. Was QA's strict `it.fails`; flipped in the
   * fixing commit, the way admin-window/BUG-0067's pin was flipped in
   * `tests/offline/cycles/page.test.ts`.
   *
   * All four shapes of the column at once, because the fix must not buy the
   * blank cell by eating a real note.
   */
  it("dashes a note that is present but blank [admin-window/BUG-0085]", async () => {
    const REAL = "The venue confirmed the reschedule.";
    const EMPTY_NOTE = verdictLogEntry({
      verdict_id: "01920000-0000-7000-8000-000000000811",
      action: "settle",
      note: "",
      observation_id: null,
      created_at: "2026-09-08T10:00:00Z",
    });
    const SPACES_NOTE = verdictLogEntry({
      verdict_id: "01920000-0000-7000-8000-000000000812",
      action: "fixed",
      // Whitespace of more than one kind: a tab and a newline are as blank on
      // screen as three spaces, and `isAbsent` trims all of them.
      note: " \t\n ",
      observation_id: null,
      created_at: "2026-09-08T09:00:00Z",
    });
    const NULL_NOTE = verdictLogEntry({
      verdict_id: "01920000-0000-7000-8000-000000000813",
      action: "keep_current",
      note: null,
      observation_id: null,
      created_at: "2026-09-08T08:00:00Z",
    });
    const REAL_NOTE = verdictLogEntry({
      verdict_id: "01920000-0000-7000-8000-000000000814",
      action: "supply_value",
      note: REAL,
      observation_id: null,
      created_at: "2026-09-08T07:00:00Z",
    });
    const markup = await renderQueues(
      scriptOf([EMPTY_NOTE, SPACES_NOTE, NULL_NOTE, REAL_NOTE], []),
    );

    // A present-but-blank note reads exactly as a null one does, and it is the
    // APP's dash — `nullDash`'s marked element — not a character some cell
    // drew for itself, so the three absences are indistinguishable to a reader
    // and to a screen reader.
    for (const action of ["settle", "fixed", "keep_current"] as const) {
      expect(cellsOf(markup, action).cells[NOTE]).toBe(EM_DASH);
      expect(dashesIn(markup, action, NOTE)).toBe(1);
    }
    // …and a note that says something still says it, unmarked and whole.
    expect(cellsOf(markup, "supply_value").cells[NOTE]).toBe(REAL);
    expect(dashesIn(markup, "supply_value", NOTE)).toBe(0);
    // Nothing was bought by leaving an empty element behind, either.
    expect(markup).not.toMatch(/<td[^>]*>\s*<\/td>/);
  });

  /**
   * The same shape one column to the left. `verdicts.actor` is `not null` and
   * its column comment says "never blank", but the settle route's fallback is
   * `gate.user?.email ?? ""` (line ~124), so an empty actor is reachable — and
   * it wrapped in an element exactly as the note did. Guarded in the same
   * commit as admin-window/BUG-0085, in the same file and the same way.
   */
  it("dashes an actor that is present but blank", async () => {
    const BLANK_ACTOR = verdictLogEntry({
      verdict_id: "01920000-0000-7000-8000-000000000815",
      action: "link_entity",
      actor: "  ",
      observation_id: null,
      created_at: "2026-09-08T06:00:00Z",
    });
    const markup = await renderQueues(scriptOf([BLANK_ACTOR], []));

    expect(cellsOf(markup, "link_entity").cells[ACTOR]).toBe(EM_DASH);
    expect(dashesIn(markup, "link_entity", ACTOR)).toBe(1);
    expect(markup).not.toMatch(/<td[^>]*>\s*<\/td>/);
  });

  /**
   * The blanks that are not the space bar. `isAbsent` asks `visibleContent`
   * (`lib/verdict/decision.ts`), so U+00A0 (a non-breaking space, what a paste
   * out of a rendered page yields), U+FEFF (a byte-order mark, out of a
   * spreadsheet export) and the Cf format characters U+200B / U+2060 / U+00AD
   * (out of a web page or a PDF) all read as the one dash. The last three did
   * NOT until admin-window/BUG-0089: `trim()` left them, so the cell took the
   * content branch and drew an empty `td` with no dash at all — this row is
   * that defect, at the surface it was visible on.
   *
   * It also grades what the absence guard COSTS: the dashed row's other five
   * columns are asserted whole in the same breath, because a cell that returns
   * `null` early is a cell that can take its row's links with it.
   */
  it("dashes a note of non-ASCII blanks, and leaves the rest of the row whole", async () => {
    const blanks = [
      ["settle", "\u00a0"],
      ["fixed", "\ufeff\u00a0\ufeff"],
      // The Cf class: a zero-width space, a word joiner and a soft hyphen —
      // nothing `trim()` removes, and nothing a reader can see.
      ["keep_current", "\u200b\u2060\u00ad"],
    ] as const;
    const markup = await renderQueues(
      scriptOf(
        blanks.map(([action, note], index) =>
          verdictLogEntry({
            verdict_id: `0192abcd-0000-7000-8000-${String(index).padStart(12, "0")}`,
            action,
            note,
            created_at: new Date(Date.UTC(2026, 8, 8, 11, index)).toISOString(),
          }),
        ),
        OBSERVATIONS,
      ),
    );

    for (const [action] of blanks) {
      const row = cellsOf(markup, action);
      expect(row.cells[NOTE]).toBe(EM_DASH);
      expect(dashesIn(markup, action, NOTE)).toBe(1);
      // …and the note cell is the ONLY thing the guard touched: the actor is
      // still the actor, both links still lead where they led, the action is
      // still verbatim, and the instant still renders an age.
      expect(row.actor).toBe(verdictLogEntry({}).actor);
      expect(row.item).toBe(verdictLogEntry({}).review_item_id);
      expect(row.itemHref).toBe(["", "queues", verdictLogEntry({}).review_item_id].join("/"));
      expect(row.observation).toBe(ID.observationA);
      expect(row.observationHref).toBe(["", "records", "events", ID.eventEntity].join("/"));
      for (const column of [ACTOR, ITEM, OBSERVATION, WHEN]) {
        expect(dashesIn(markup, action, column)).toBe(0);
      }
    }
  });

  /**
   * Two absences on ONE row, which is the shape a settle from a session with
   * no email leaves behind (`gate.user?.email ?? ""` in the settle route, with
   * `body.note` forwarded verbatim). Each absent cell draws exactly one dash
   * and neither borrows the other's: the row still says which action it was
   * and still opens the item it settled.
   */
  it("dashes actor and note together without dashing the columns that have values", async () => {
    const BOTH_BLANK = verdictLogEntry({
      verdict_id: "01920000-0000-7000-8000-000000000816",
      action: "supply_value",
      actor: "",
      note: "\t",
      created_at: "2026-09-08T05:00:00Z",
    });
    const markup = await renderQueues(scriptOf([BOTH_BLANK], OBSERVATIONS));
    const row = cellsOf(markup, "supply_value");

    expect(row.cells[ACTOR]).toBe(EM_DASH);
    expect(row.cells[NOTE]).toBe(EM_DASH);
    expect(dashesIn(markup, "supply_value", ACTOR)).toBe(1);
    expect(dashesIn(markup, "supply_value", NOTE)).toBe(1);
    for (const column of [ITEM, OBSERVATION, WHEN]) {
      expect(dashesIn(markup, "supply_value", column)).toBe(0);
    }
    expect(row.itemHref).toBe(["", "queues", BOTH_BLANK.review_item_id].join("/"));
    expect(markup).not.toMatch(/<td[^>]*>\s*<\/td>/);
  });

  /**
   * The other end of the same guard: a note far past the clamp is a note, not
   * an absence. It renders clamped and marked as clamped, carries the WHOLE of
   * itself on the element's own title (`clamped`, `lib/format.ts`) so nothing
   * an admin wrote is lost to the surface, and draws no dash.
   */
  it("keeps a note far past the clamp, whole, on its own title, and dashes nothing", async () => {
    const HUGE = `${"why ".repeat(2500)}end`;
    const markup = await renderQueues(
      scriptOf(
        [
          verdictLogEntry({
            verdict_id: "01920000-0000-7000-8000-000000000817",
            action: "keep_current",
            note: HUGE,
            created_at: "2026-09-08T04:00:00Z",
          }),
        ],
        OBSERVATIONS,
      ),
    );
    const shown = cellsOf(markup, "keep_current").cells[NOTE];

    expect(HUGE.length).toBeGreaterThan(CLAMP_LIMIT * 10);
    expect(shown.length).toBeLessThanOrEqual(CLAMP_LIMIT);
    expect(shown.endsWith(ELLIPSIS)).toBe(true);
    expect(HUGE.startsWith(shown.slice(0, -1))).toBe(true);
    // The whole value survives on the title — the surface clamps what it
    // DRAWS, never what it holds.
    expect(noteTitle(markup, "keep_current")).toBe(HUGE);
    expect(dashesIn(markup, "keep_current", NOTE)).toBe(0);
  });
});

/* ── the action, verbatim, for all eight ─────────────────────────────────── */

describe("the action column", () => {
  it("renders all eight of VERDICT_ACTIONS verbatim", async () => {
    // Iterated from the constant the settlement seam and the handoff artifact
    // share, never from a hand-written list (SPEC named gap 6).
    const everyAction = VERDICT_ACTIONS.map((action, index) =>
      verdictLogEntry({
        verdict_id: `0192aaaa-0000-7000-8000-${String(index).padStart(12, "0")}`,
        action,
        created_at: new Date(Date.UTC(2026, 8, 8, 12, index)).toISOString(),
      }),
    );
    const markup = await renderQueues(scriptOf(everyAction, OBSERVATIONS));
    const $ = cheerio.load(markup);

    const rendered = $(`${LOG} [data-verdict-action]`)
      .toArray()
      .map((element) => $(element).text().trim());
    // Verbatim means verbatim: never title-cased, never uppercased, never
    // mapped to friendlier words (ARCHITECTURE.md §11, admin-window/BUG-0049).
    expect(rendered.slice().sort()).toEqual([...VERDICT_ACTIONS].sort());
  });
});

/* ── the observation leg degrades, and never takes the log with it ───────── */

describe("the observation leg", () => {
  it("renders the id verbatim, unlinked, when the observation has no row", async () => {
    // A verdict pointing at an observation this database no longer holds: the
    // id is real, so a dash there would claim the verdict observed nothing.
    const markup = await renderQueues(scriptOf([SETTLEMENT], []));
    const row = cellsOf(markup, "choose_claimed_value");

    expect(row.observation).toBe(SETTLEMENT.observation_id);
    expect(row.observationHref).toBeUndefined();
    expect(surfaceStateOf(markup, LOG)).toBe("ok");
  });

  /**
   * STRICT PIN — QA, filed as admin-window/BUG-0150 while attacking BUG-0148.
   *
   * BUG-0148 put the review-item block's unlinked observation id through the
   * shared `Identifier` primitive (DEBT-0011 criterion 2: "every call site
   * that renders a machine identifier — ... an id — imports the primitive",
   * and criterion 4, which hangs the ARCHITECTURE §7 bidi isolation off that
   * one place). The verdict LOG renders the same two machine values — the
   * action and the same `verdicts.observation_id` column, unlinked — as bare
   * spans, taking the mono face from `DataTable`'s own `td` and the isolation
   * from nowhere.
   *
   * That the table is not a boundary is not an argument, it is measured:
   * `components/cycles/run-columns.tsx` renders two of ITS cells (`source`,
   * `failure_class`) through the primitive already.
   *
   * Landed as `it.fails` while the divergence stands — the day both cells go
   * through the primitive this XPASSes, turns the file red, and sends the
   * reader to the ticket. No class literal and no attribute value is typed
   * here: the isolation marker is read off the primitive's own render.
   */
  it(
    "renders the log's machine values through the one identifier primitive, like the run table's cells",
    async () => {
      const markup = await renderQueues(scriptOf([SETTLEMENT], []));
      const $ = cheerio.load(markup);
      const primitive = cheerio.load(
        render(h(Identifier, { children: SETTLEMENT.action })),
      )("span");

      // Non-vacuous: the primitive really does mark the box it renders.
      expect(primitive.attr("dir"), "the primitive isolates its own box").toBeDefined();

      const observation = $(`${LOG} [data-verdict-observation]`);
      expect(observation, "the unlinked id is the cell under test").toHaveLength(1);
      expect(observation.is("a"), "unlinked, so no anchor exception covers it").toBe(
        false,
      );
      expect(
        observation.attr("dir"),
        "an id the database produced is isolated here too",
      ).toBe(primitive.attr("dir"));
      expect(
        $(`${LOG} [data-verdict-action]`).attr("dir"),
        "and so is the action beside it",
      ).toBe(primitive.attr("dir"));
    },
  );

  /**
   * ...and the isolation that swap bought is graded on the input it exists for
   * (admin-window/BUG-0150; the same grading BUG-0148 got one tab over, in
   * `tests/offline/review-item/verdict-inline.test.ts`).
   *
   * `verdicts.observation_id` is text this app did not author, and ARCHITECTURE
   * §7 (Common violations row 15) says such text reaches the app's surfaces
   * inside its own bidi-isolated box, never by scrubbing. So an unterminated
   * RIGHT-TO-LEFT OVERRIDE arrives on the id and:
   *
   *  - the id still reaches the screen and its hook VERBATIM — isolation
   *    reorders nothing and removes nothing, so an operator can still paste it
   *    into a query;
   *  - the override reaches no OTHER cell of its own row: every sibling cell
   *    renders byte-identical to the same row carrying a clean id, and the
   *    override character itself is inside exactly one `td`; and
   *  - the isolated boxes in the whole log are exactly the row's two machine
   *    values. The table's own column labels and the dash-meaning line sit
   *    outside them, which is the half a component that isolated everything
   *    would also pass.
   *
   * Both machine values are read off the fixture and the isolation marker off
   * the primitive's own render: no literal is typed here.
   */
  it("holds a bidi-override observation id inside its own cell, verbatim, and isolates none of the table's own words", async () => {
    const RLO = "\u202E";
    const hostile = `01920000-0000-7000-8000${RLO}-000000000501`;
    // Observations empty, so the leg resolves nothing: this is the UNLINKED
    // arm, the one the fix changed.
    const markup = await renderQueues(
      scriptOf([{ ...SETTLEMENT, observation_id: hostile }], []),
    );
    const clean = await renderQueues(scriptOf([SETTLEMENT], []));
    const $ = cheerio.load(markup);
    const primitive = cheerio.load(render(h(Identifier, { children: hostile })))("span");

    const shown = $(`${LOG} [data-verdict-observation]`);
    expect(shown, "the hostile id is on screen at all").toHaveLength(1);
    expect(shown.is("a"), "and unlinked, which is the arm under test").toBe(false);
    // Verbatim, on screen and on the hook an oracle addresses it by.
    expect(shown.text()).toBe(hostile);
    expect(shown.attr("data-verdict-observation")).toBe(hostile);
    // Isolated — non-vacuously: the primitive really does mark its own box.
    expect(primitive.attr("dir"), "the primitive isolates its own box").toBeDefined();
    expect(shown.attr("dir"), "so the id the database produced is isolated").toBe(
      primitive.attr("dir"),
    );

    // The box it is isolated in is its OWN CELL: the override is inside exactly
    // one `td` of the row, and every other cell renders what it renders when
    // the id is clean.
    const row = shown.closest("tr");
    const cells = row.find("td");
    const carrying = cells
      .toArray()
      .map((td, index) => ($(td).html()?.includes(RLO) === true ? index : -1))
      .filter((index) => index !== -1);
    expect(carrying, "the override sits in the observation cell and nowhere else").toEqual([
      OBSERVATION,
    ]);
    const before = cellsOf(clean, SETTLEMENT.action).cells;
    const after = cellsOf(markup, SETTLEMENT.action).cells;
    expect(after.length).toBe(before.length);
    for (const [index, text] of before.entries()) {
      if (index === OBSERVATION) continue;
      expect(after[index], `cell ${index} is untouched by the override`).toBe(text);
    }

    // ...and nothing the TABLE wrote is inside an isolated box: the isolated
    // set is exactly the row's two machine values.
    const isolated = $(LOG)
      .find("[dir]")
      .toArray()
      .map((element) => $(element).text());
    expect(isolated.slice().sort()).toEqual([SETTLEMENT.action, hostile].sort());
  });

  it("keeps every verdict, and names its own object, when observations refuses", async () => {
    const markup = await renderQueues({
      [T.verdicts]: { data: POPULATION, count: POPULATION.length },
      [T.observations]: { error: tableNotInSchemaCache(T.observations) },
      [T.reviewItems]: { data: [], count: 0 },
    });
    const $ = cheerio.load(markup);

    // Every verdict is still here — a leg that only supplies a link costs this
    // surface a link, never a verdict (admin-window/BUG-0021).
    expect(renderedOrder(markup)).toHaveLength(POPULATION.length);
    expect($(PROVENANCE).find("[data-not-provisioned]").attr("data-not-provisioned")).toBe(
      T.observations,
    );
    // The log's own state is `ok`: the refusal belongs to its own sub-surface,
    // exactly as the gauge's per-queue slices belong to theirs.
    expect(surfaceStateOf(markup, LOG, PROVENANCE)).toBe("ok");
  });
});

/* ── the primitive's BOUNDARY in this log — QA, admin-window/BUG-0150 ────── */

/**
 * BUG-0150 put two of the log's cells through `Identifier` and left two alone.
 * The builder graded the two it converted; this block grades the LINE between
 * them, and the half of the conversion its own pin did not drive.
 *
 * Nothing here types a class literal or an attribute value: the isolation
 * marker is read off `Identifier`'s own render, the ids and actions off the
 * fixtures, the href off the route parts.
 */
describe("what the identifier primitive does and does not reach in the log", () => {
  /** The `dir` value `Identifier` marks its own box with, whatever it is. */
  function isolationMarker(text: string): string | undefined {
    return cheerio.load(render(h(Identifier, { children: text })))("span").attr("dir");
  }

  /**
   * DEBT-0011's sanctioned exception is the ANCHOR, and an exception has to be
   * a boundary rather than a shrug: the resolved arm stays exactly one anchor
   * carrying the hook, with nothing nested inside it.
   *
   * The failure this pins is not cosmetic. Every reader of this column —
   * `cellsOf` here, the live oracle's `[data-verdict-action]` map
   * (`tests/live/queues.live.test.ts`), a future one — does
   * `row.find(hook).attr(...)`, which silently answers from the FIRST match. An
   * arm that carried the hook twice (an `Identifier` nested inside the anchor,
   * the shape a next sweep would reach for) would answer that read from the
   * wrapper and go unnoticed. So: one element per hook per row, and the linked
   * one holds the id as its own text.
   *
   * Non-vacuous by construction: the same render carries an UNLINKED arm one
   * row down, and it is asserted to be the other thing — no anchor, isolated.
   */
  it("leaves the resolved observation as one bare anchor while the unresolved one is isolated", async () => {
    // Exactly one of the two observations resolves, so both arms render in ONE
    // markup and the boundary is a difference this test can see.
    const markup = await renderQueues(
      scriptOf(POPULATION, [
        observationRow({
          observation_id: ID.observationA,
          domain: "events",
          entity_id: ID.eventEntity,
        }),
      ]),
    );
    const $ = cheerio.load(markup);

    const linked = $(`${LOG} [data-verdict-action="${SETTLEMENT.action}"]`)
      .closest("tr")
      .find("[data-verdict-observation]");
    expect(linked, "the resolved arm carries the hook exactly once").toHaveLength(1);
    expect(linked.is("a"), "the resolved arm is the anchor exception itself").toBe(true);
    expect(
      linked.children().toArray(),
      "nothing is nested inside the anchor — the id is the anchor's own text",
    ).toEqual([]);
    expect(linked.text()).toBe(SETTLEMENT.observation_id);
    expect(linked.attr("href")).toBe(
      ["", "records", "events", ID.eventEntity].join("/"),
    );

    // ...and the arm that is NOT an anchor took the primitive, in the same
    // render: the boundary discriminates instead of exempting everything.
    const unlinked = $(`${LOG} [data-verdict-action="${OVERRIDE.action}"]`)
      .closest("tr")
      .find("[data-verdict-observation]");
    expect(unlinked, "the unresolved arm carries the hook exactly once").toHaveLength(1);
    expect(unlinked.is("a")).toBe(false);
    expect(unlinked.text()).toBe(OVERRIDE.observation_id);
    const marker = isolationMarker(OVERRIDE.observation_id ?? "");
    expect(marker, "the primitive marks its own box").toBeDefined();
    expect(unlinked.attr("dir"), "so the unresolved id is isolated").toBe(marker);
  });

  /**
   * Every one of the log's four hooks resolves to at most one element per row,
   * across every row shape §7 admits. The reads above all depend on it and
   * none of them would fail if it stopped being true.
   */
  it("carries each of its hooks at most once per row, in every row shape", async () => {
    const markup = await renderQueues(scriptOf(POPULATION, OBSERVATIONS));
    const $ = cheerio.load(markup);
    const rows = $(`${LOG} tbody tr`).toArray();
    expect(rows).toHaveLength(POPULATION.length);

    for (const tr of rows) {
      // The two columns every row of §7's table carries: exactly one element
      // each, so `toBeLessThanOrEqual` below cannot pass by finding nothing.
      for (const hook of ["[data-verdict-actor]", "[data-verdict-action]"]) {
        expect($(tr).find(hook).length, `${hook} is not one element here`).toBe(1);
      }
      // The two structurally-nullable ones: absent or one, never two.
      for (const hook of ["[data-verdict-item]", "[data-verdict-observation]"]) {
        expect(
          $(tr).find(hook).length,
          `${hook} answers a per-row read ambiguously`,
        ).toBeLessThanOrEqual(1);
      }
    }
    // ...and both nullable hooks do render somewhere in this population, so the
    // loop above is grading elements that exist.
    for (const hook of ["[data-verdict-item]", "[data-verdict-observation]"]) {
      expect($(`${LOG} ${hook}`).length, `${hook} rendered nowhere`).toBeGreaterThan(0);
    }
  });

  /**
   * The anchor arm is the one DEBT-0011 exempts from the primitive, so the
   * containment it does NOT get from isolation is worth asserting where it does
   * come from: a `td` is a block box, and a control inside one cell cannot
   * reach another. Stated as containment rather than as `dir` being absent —
   * the day the anchor exception is revisited, this pin should still hold.
   */
  it("keeps a bidi-override in the LINKED observation id inside its own cell too", async () => {
    const RLO = "\u202E";
    const hostile = `${ID.observationA}${RLO}`;
    const linkedHostile = verdictLogEntry({
      verdict_id: "0192eeee-0000-7000-8000-000000000001",
      observation_id: hostile,
      note: "a note the override must not reach",
    });
    const resolves = [
      observationRow({
        observation_id: hostile,
        domain: "events",
        entity_id: ID.eventEntity,
      }),
    ];

    const markup = await renderQueues(scriptOf([linkedHostile], resolves));
    const $ = cheerio.load(markup);
    const shown = $(`${LOG} [data-verdict-observation]`);
    expect(shown, "the hostile id is on screen once").toHaveLength(1);
    expect(shown.is("a"), "resolved, so this is the anchor arm").toBe(true);
    expect(shown.text(), "verbatim: isolation removes nothing and nor does this").toBe(
      hostile,
    );

    const cells = shown.closest("tr").find("td");
    const carrying = cells
      .toArray()
      .map((td, index) => ($(td).html()?.includes(RLO) === true ? index : -1))
      .filter((index) => index !== -1);
    expect(carrying, "the override is in the observation cell and nowhere else").toEqual(
      [OBSERVATION],
    );
    const before = soleRowCells(
      await renderQueues(scriptOf([{ ...linkedHostile, observation_id: ID.observationA }], [
        observationRow({
          observation_id: ID.observationA,
          domain: "events",
          entity_id: ID.eventEntity,
        }),
      ])),
    );
    const after = soleRowCells(markup);
    expect(after).toHaveLength(before.length);
    for (const [index, text] of before.entries()) {
      if (index === OBSERVATION) continue;
      expect(after[index], `cell ${index} is untouched by the override`).toBe(text);
    }
  });

  /**
   * The other half of the conversion, driven on the input the isolation exists
   * for. The builder's own hostile fixture put U+202E on the observation id;
   * `verdicts.action` is text this app did not author either (the settle route
   * writes whatever it was handed), and it is the cell the reader scans first.
   *
   * Graded the same way, and on the same three claims: verbatim on screen AND
   * on the hook an oracle addresses the row by, isolated in its own box, and
   * contained to that box — the override reaches no sibling cell, each of
   * which renders byte-identical to the same row carrying a clean action.
   */
  it("holds a bidi-override action inside its own cell, verbatim, without touching the row's other cells", async () => {
    const RLO = "\u202E";
    const hostile = `choose${RLO}_claimed_value`;
    const row = verdictLogEntry({
      verdict_id: "0192dddd-0000-7000-8000-000000000001",
      action: hostile,
      observation_id: null,
      note: "a note the app must not let the override reach",
    });
    const clean = { ...row, action: "choose_claimed_value" };

    const markup = await renderQueues(scriptOf([row], OBSERVATIONS));
    const $ = cheerio.load(markup);

    const shown = $(`${LOG} [data-verdict-action]`);
    expect(shown, "the hostile action is on screen at all").toHaveLength(1);
    // Verbatim: never prettified, and still addressable by the hook a live
    // oracle reads the row's action off (`tests/live/queues.live.test.ts`).
    expect(shown.text()).toBe(hostile);
    expect(shown.attr("data-verdict-action")).toBe(hostile);
    const marker = isolationMarker(hostile);
    expect(marker, "the primitive marks its own box").toBeDefined();
    expect(shown.attr("dir"), "an action the database produced is isolated").toBe(
      marker,
    );

    // Contained: the override is inside exactly one `td`...
    const cells = shown.closest("tr").find("td");
    const carrying = cells
      .toArray()
      .map((td, index) => ($(td).html()?.includes(RLO) === true ? index : -1))
      .filter((index) => index !== -1);
    expect(carrying, "the override sits in the action cell and nowhere else").toEqual([
      ACTION,
    ]);
    // ...and every other cell of the row renders what it renders when the
    // action is clean.
    const before = soleRowCells(await renderQueues(scriptOf([clean], OBSERVATIONS)));
    const after = soleRowCells(markup);
    expect(after).toHaveLength(before.length);
    for (const [index, text] of before.entries()) {
      if (index === ACTION) continue;
      expect(after[index], `cell ${index} is untouched by the override`).toBe(text);
    }
  });
});
