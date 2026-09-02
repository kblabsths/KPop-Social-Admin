/**
 * The cross-page proof harness (campaign admin-window/TASK-0019).
 *
 * Three proofs in this directory need the same thing: EVERY surface of the
 * window rendered offline, against a database this file decides the answers
 * for. No single page ticket can carry them, and none of them may be satisfied
 * by a hand-kept list of pages — a page added later must be swept too or the
 * proof rots the day it matters.
 *
 * So the inventory is DERIVED: `pageRoutes()` walks `src/app/**` for
 * `page.tsx`, and `loadSurfaces()` fails loudly if the render map does not
 * cover exactly what it found (`pages.test.ts` asserts that). Adding a page
 * without adding it here reddens the suite.
 *
 * The seam is `getDbClient()` (`src/lib/db/client.ts`) — the ONE place the app
 * resolves a database client (ARCHITECTURE.md §4 rule 3). Mocking that single
 * function routes every read of every page through the stub, so these files
 * need no per-module mock and cannot miss a read some page makes through a
 * module they forgot to name. Each test file installs the mock itself
 * (`vi.mock` is per file) and hands the client in through `readWith`.
 */
import fs from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";
import * as cheerio from "cheerio";
import { renderToStaticMarkup } from "react-dom/server";
import { T, TABLE_NAMES, type TableName } from "@/lib/db/tables";
import {
  ID,
  eventListingRow,
  eventRow,
  reviewItemDataConflict,
  reviewItemShapes,
} from "../../fixtures/rows";
import { CLAIMS, OBSERVATIONS } from "../claims/population";
import { APPLIES, CYCLES, OBSERVED } from "../cycles/population";
import {
  PENDING_CLAIMS,
  PENDING_OBSERVATIONS,
  REJECTIONS,
  RUNS,
  SOURCES,
} from "../sources/population";
import type { Script, ScriptedResponse, StubClient } from "../../fixtures/stub-client";

export const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const appDir = path.join(repoRoot, "src", "app");

/* ── the derived inventory ───────────────────────────────────────────────── */

/** Every file named `name` under `dir`, as paths relative to `dir`. */
function filesNamed(dir: string, name: string): string[] {
  const found: string[] = [];
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === name) found.push(path.relative(dir, full));
    }
  };
  walk(dir);
  return found;
}

/** `queues/[reviewItemId]/page.tsx` → `/queues/[reviewItemId]`; `page.tsx` → `/`. */
function routeOf(relative: string, file: string): string {
  const dir = path.dirname(relative);
  if (dir === ".") return "/";
  // Route groups `(name)` and private folders `_name` do not appear in the URL.
  const segments = dir
    .split(path.sep)
    .filter((segment) => !(segment.startsWith("(") && segment.endsWith(")")))
    .filter((segment) => !segment.startsWith("_"));
  void file;
  return `/${segments.join("/")}`;
}

/**
 * Every route with a `page.tsx`, derived from the filesystem, sorted.
 *
 * Includes `/login`; callers that mean "the window" drop it themselves, so the
 * exclusion is visible at the call site rather than buried here.
 */
export function pageRoutes(): string[] {
  return filesNamed(appDir, "page.tsx")
    .map((relative) => routeOf(relative, "page.tsx"))
    .sort();
}

/** Every route with a `route.ts` handler, derived the same way. */
export function handlerRoutes(): string[] {
  return filesNamed(appDir, "route.ts")
    .map((relative) => routeOf(relative, "route.ts"))
    .sort();
}

/* ── the surfaces ────────────────────────────────────────────────────────── */

/** A URL's query, as Next hands it to a page. */
export type Params = Record<string, string | string[] | undefined>;

export interface Surface {
  /** The route path as `src/app` spells it, dynamic segments and all. */
  readonly route: string;
  /** The URL an operator is at when this renders — the dynamic ones filled in. */
  readonly path: string;
  /** Does this surface read its query string at all? */
  readonly takesParams: boolean;
  /** Render it, awaiting the page function (the route's only async component). */
  render(params: Params): Promise<ReactNode>;
}

/** The ids the dynamic surfaces are asked for. Fixture ids, never real ones. */
export const SUBJECT = {
  reviewItem: ID.reviewItemDataConflict,
  recordTable: "groups",
  recordId: ID.groupEntity,
} as const;

/**
 * Every page of the window, with the props its route hands it.
 *
 * Dynamic imports so the module graph is entered AFTER the calling file's
 * `vi.mock` has registered — the pattern every page test in this repo uses.
 */
export async function loadSurfaces(): Promise<Surface[]> {
  const [dashboard, queues, reviewItem, claims, sources, cycles, browse, record] =
    await Promise.all([
      import("@/app/page"),
      import("@/app/queues/page"),
      import("@/app/queues/[reviewItemId]/page"),
      import("@/app/claims/page"),
      import("@/app/sources/page"),
      import("@/app/cycles/page"),
      import("@/app/browse/page"),
      import("@/app/records/[table]/[id]/page"),
    ]);

  const withSearch = (
    route: string,
    page: (props: { searchParams?: Promise<Params> }) => Promise<ReactNode>,
  ): Surface => ({
    route,
    path: route,
    takesParams: true,
    render: (params) => page({ searchParams: Promise.resolve(params) }),
  });

  return [
    {
      route: "/",
      path: "/",
      takesParams: false,
      render: () => dashboard.default(),
    },
    withSearch("/queues", queues.default),
    {
      route: "/queues/[reviewItemId]",
      path: `/queues/${SUBJECT.reviewItem}`,
      takesParams: false,
      render: () =>
        reviewItem.default({
          params: Promise.resolve({ reviewItemId: SUBJECT.reviewItem }),
        }),
    },
    withSearch("/claims", claims.default),
    withSearch("/sources", sources.default),
    withSearch("/cycles", cycles.default),
    withSearch("/browse", browse.default),
    {
      route: "/records/[table]/[id]",
      path: `/records/${SUBJECT.recordTable}/${SUBJECT.recordId}`,
      takesParams: false,
      render: () =>
        record.default({
          params: Promise.resolve({
            table: SUBJECT.recordTable,
            id: SUBJECT.recordId,
          }),
        }),
    },
  ];
}

/** Render one surface to markup. */
export async function renderSurface(
  surface: Surface,
  params: Params = {},
): Promise<string> {
  return renderToStaticMarkup(await surface.render(params));
}

/* ── the databases these proofs render against ───────────────────────────── */

/**
 * A database that holds every object and no rows.
 *
 * `count: 0` as well as no data, because a complete read refuses a response
 * with no count and would render an error line rather than the empty state
 * (`readComplete` / `readCount`, `lib/db/result.ts`). `data: null` rather than
 * `[]` so a single-row read (`.maybeSingle()`) reads as "no such row" instead
 * of handing an array to a page that asked for one row; `readRows` turns the
 * null into `[]` itself.
 */
export function emptyScript(): Script {
  const script: Script = {};
  for (const name of TABLE_NAMES) script[name] = { data: null, count: 0 };
  return script;
}

/**
 * A database that holds rows in every object a page reads.
 *
 * Assembled from the populations the page suites already own, so the rows are
 * the ones those pages are known to render. Its job here is narrow: with the
 * first leg of a two-step join carrying rows, the SECOND leg is actually read,
 * which is the only way the absence matrix can cover a table that is never
 * touched against an empty database (`readRowsByIds`, ARCHITECTURE.md §4.2).
 *
 * `surface` matters for exactly one reason: the two dynamic routes address a
 * row by primary key with `.maybeSingle()`, which answers with ONE ROW rather
 * than a set (`readOne`, `lib/db/result.ts`). The stub scripts a response per
 * table, not per query shape, so the table each dynamic surface reads that way
 * is scripted as the object it would really receive.
 */
export function populatedScript(surface?: Surface): Script {
  const rows: Partial<Record<TableName, ScriptedResponse>> = {
    [T.reviewItems]: { data: reviewItemShapes(), count: reviewItemShapes().length },
    [T.pendingClaims]: { data: [...CLAIMS], count: CLAIMS.length },
    [T.observations]: {
      data: [...OBSERVATIONS, ...OBSERVED],
      count: OBSERVATIONS.length + OBSERVED.length,
    },
    [T.sources]: { data: [...SOURCES], count: SOURCES.length },
    [T.resolutionRuns]: { data: [...CYCLES], count: CYCLES.length },
    [T.runs]: { data: [...RUNS], count: RUNS.length },
    [T.fieldProvenance]: { data: [...APPLIES], count: APPLIES.length },
    [T.events]: { data: [eventRow()], count: 1 },
    [T.eventListings]: { data: [eventListingRow()], count: 1 },
    [T.groups]: { data: [{ id: SUBJECT.recordId, name: "A group" }], count: 1 },
  };

  const script = emptyScript();
  for (const [table, response] of Object.entries(rows)) {
    script[table] = response as ScriptedResponse;
  }

  // Where a page suite owns a population written for that page, the page gets
  // ITS rows: a cross-page fixture is a fine database, but the page's own is
  // the one its groupings and keys were written against.
  if (surface?.route === "/sources") {
    script[T.observations] = {
      data: [...PENDING_OBSERVATIONS, ...REJECTIONS],
      count: PENDING_OBSERVATIONS.length + REJECTIONS.length,
    };
    script[T.pendingClaims] = { data: [...PENDING_CLAIMS], count: PENDING_CLAIMS.length };
  }
  if (surface?.route === "/cycles") {
    script[T.observations] = { data: [...OBSERVED], count: OBSERVED.length };
  }
  if (surface?.route === "/claims") {
    script[T.observations] = { data: [...OBSERVATIONS], count: OBSERVATIONS.length };
  }

  if (surface?.route === "/queues/[reviewItemId]") {
    script[T.reviewItems] = {
      data: reviewItemDataConflict({ review_item_id: SUBJECT.reviewItem }),
      count: 1,
    };
  }
  if (surface?.route === "/records/[table]/[id]") {
    script[SUBJECT.recordTable] = {
      data: { id: SUBJECT.recordId, name: "A group" },
      count: 1,
    };
  }
  return script;
}

/**
 * Every column name the fixture row types declare NULLABLE, parsed from
 * `tests/fixtures/rows.ts`.
 *
 * Derived rather than listed, so a column that becomes nullable later is
 * swept without anyone remembering to add it. The fixture interfaces are the
 * repo's own description of what the database may hand a page — `severity` is
 * never null, `ended_at` may be — and only the `| null` ones are nulled below,
 * so no page is asked to survive a value its schema forbids.
 */
export function nullableFields(): Set<string> {
  const source = fs.readFileSync(
    path.join(repoRoot, "tests", "fixtures", "rows.ts"),
    "utf8",
  );
  const fields = new Set<string>();
  for (const block of source.matchAll(/export interface \w+Row \{([\s\S]*?)\n\}/g)) {
    for (const line of block[1].split("\n")) {
      const field = /^\s*(\w+)\s*:\s*(.+);\s*$/.exec(line);
      if (field && /\|\s*null\b/.test(field[2])) fields.add(field[1]);
    }
  }
  if (fields.size === 0) {
    throw new Error(
      "no nullable field was parsed out of tests/fixtures/rows.ts; the sparse " +
        "population would assert nothing",
    );
  }
  return fields;
}

/** The same row with every nullable column it carries set to null. */
function sparse<Row>(row: Row, nullable: ReadonlySet<string>): Row {
  const copy: Record<string, unknown> = { ...(row as Record<string, unknown>) };
  for (const key of Object.keys(copy)) {
    if (nullable.has(key)) copy[key] = null;
  }
  return copy as Row;
}

/**
 * The populated database with every nullable value ABSENT.
 *
 * The state that produces the blank cell: a table column whose body is
 * rendered through a child COMPONENT is never absent to `orDash` — an element
 * is not `null` — so a component that renders null leaves the cell empty
 * instead of showing the em dash (found on Cycles, campaign
 * admin-window/TASK-0014, relayed as repo-wide). Every column of every page is
 * driven through that state here.
 */
export function sparseScript(surface?: Surface): Script {
  const nullable = nullableFields();
  const script = populatedScript(surface);
  for (const [table, response] of Object.entries(script)) {
    const scripted = response as ScriptedResponse;
    const data = scripted.data;
    if (Array.isArray(data)) {
      script[table] = { ...scripted, data: data.map((row) => sparse(row, nullable)) };
    } else if (data !== null && typeof data === "object") {
      script[table] = { ...scripted, data: sparse(data, nullable) };
    }
  }
  return script;
}

/* ── reading markup, structurally ────────────────────────────────────────── */

function normalize(text: string): string {
  return text.replace(/ /g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Does any element render EXACTLY this text?
 *
 * How the not-provisioned card names its missing object — the name stands
 * alone in its own element (`src/components/ui/not-provisioned.tsx`) — without
 * reading a class name or a word of the app's copy.
 */
export function namesExactly(markup: string, text: string): boolean {
  const $ = cheerio.load(markup);
  const wanted = normalize(text);
  return $("*").toArray().some((element) => normalize($(element).text()) === wanted);
}

/** The text of every element the app marked as an error line (`role="alert"`). */
export function alertTexts(markup: string): string[] {
  const $ = cheerio.load(markup);
  return $('[role="alert"]').toArray().map((element) => normalize($(element).text()));
}

/**
 * Every rendered FIGURE: a leaf element whose whole text is a bare number.
 *
 * Leaves only, so one figure inside three wrapping divs counts once and a
 * card whose only content is its figure is not counted as a second one.
 */
export function figures(markup: string): string[] {
  const $ = cheerio.load(markup);
  return $("*")
    .toArray()
    .filter((element) => $(element).children().length === 0)
    .map((element) => normalize($(element).text()))
    .filter((text) => /^-?\d+(?:[.,]\d+)*$/.test(text));
}

/** Table cells that rendered NOTHING AT ALL — no text, no element, no dash. */
export function blankCells(markup: string): number {
  const $ = cheerio.load(markup);
  return $("td").toArray().filter((cell) => ($(cell).html() ?? "").trim() === "")
    .length;
}

/** Every `href` the markup offers. */
export function hrefs(markup: string): string[] {
  const $ = cheerio.load(markup);
  return $("a[href]").toArray().map((element) => $(element).attr("href") ?? "");
}

/** The tables a stub was actually asked for, deduplicated. */
export function tablesRead(stub: StubClient): Set<string> {
  return new Set(stub.tablesRead());
}
