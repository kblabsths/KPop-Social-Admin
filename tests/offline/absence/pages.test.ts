import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TABLE_NAMES } from "@/lib/db/tables";
import {
  stubClient,
  tableNotInSchemaCache,
  undefinedTable,
  type Script,
} from "../../fixtures/stub-client";

/**
 * Graceful absence, every page (campaign admin-window/TASK-0019).
 *
 * Acceptance test 9 — "against a database lacking the resolver tables, every
 * ecosystem page renders its not-provisioned state; nothing throws" — M1 EC11.
 * No page ticket can carry this: the claim is about the WHOLE window, and the
 * page it would fail on next is the one nobody thought to check.
 *
 * The sweep is a matrix, and both of its axes are derived:
 *
 *  - **the pages** come from the filesystem (`pageRoutes()`), and the render
 *    map is asserted to cover exactly what it found, so a page added later
 *    cannot escape the sweep;
 *  - **the tables** come from `lib/db/tables.ts` (`TABLE_NAMES`), the one place
 *    an object name is spelled, and each one is made absent in turn against
 *    both an empty and a populated database — the populated pass is what
 *    reaches the SECOND leg of a two-step join, which an empty database never
 *    asks for at all.
 *
 * For every cell of that matrix: the render must not throw, the page must
 * still be a page (one `h1`, words under it), and if the read of the absent
 * object happened at all, the object must be NAMED — in a not-provisioned
 * card, never in an error line and never as a zero.
 *
 * This ticket adds no product code. A page that fails a cell here is a BUG on
 * that page's ticket; the proof stays as written.
 */

const readWith = vi.hoisted(() => ({ client: undefined as unknown }));

vi.mock("@/lib/db/client", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/db/client")>();
  return {
    ...actual,
    getDbClient: () => {
      if (readWith.client === undefined) {
        throw new Error(
          "the absence sweep rendered a page without scripting a database first",
        );
      }
      return readWith.client as SupabaseClient;
    },
  };
});

const {
  alertTexts,
  emptyScript,
  figures,
  loadSurfaces,
  namesExactly,
  pageRoutes,
  populatedScript,
  renderSurface,
  tablesRead,
} = await import("./surfaces");
import type { Surface } from "./surfaces";

/** Script the database the next render reads, and keep the stub to ask it what it was asked for. */
function scriptDatabase(script: Script) {
  const stub = stubClient(script);
  readWith.client = stub.asSupabaseClient();
  return stub;
}

const SURFACES = await loadSurfaces();

/** The window's pages: every `page.tsx` on disk except the sign-in page. */
const WINDOW_ROUTES = pageRoutes().filter((route) => route !== "/login");

/* ── unhandled rejections, for the whole file ────────────────────────────── */

/**
 * "Zero unhandled errors" is not the same claim as "nothing threw".
 *
 * A page that starts a read and never awaits it survives every assertion below
 * and still poisons the process. This catches that class for the whole file.
 */
const unhandled: unknown[] = [];
const onUnhandled = (reason: unknown) => unhandled.push(reason);

beforeAll(() => {
  process.on("unhandledRejection", onUnhandled);
});

afterAll(() => {
  process.off("unhandledRejection", onUnhandled);
  expect(unhandled.map((reason) => String(reason))).toEqual([]);
});

/* ── the inventory is derived, and complete ──────────────────────────────── */

describe("the surfaces this file sweeps", () => {
  it("is every page on disk, the sign-in page aside", () => {
    expect(SURFACES.map((surface) => surface.route).sort()).toEqual(WINDOW_ROUTES);
    // The six pages of the window plus the two dynamic children.
    expect(SURFACES.length).toBe(8);
  });

  it("reads at least one object per surface, so no cell below is vacuous", async () => {
    for (const surface of SURFACES) {
      const stub = scriptDatabase(emptyScript());
      await renderSurface(surface);
      expect([...tablesRead(stub)], surface.route).not.toEqual([]);
    }
  });

  it("exercises the naming assertion on every surface, and on enough objects", async () => {
    let covered = 0;
    for (const surface of SURFACES) {
      const read: string[] = [];
      for (const missing of TABLE_NAMES) {
        const stub = scriptDatabase({
          ...populatedScript(surface),
          [missing]: { error: tableNotInSchemaCache(missing) },
        });
        await renderSurface(surface);
        if (tablesRead(stub).has(missing)) read.push(missing);
      }
      expect(read, `${surface.route} names no object under absence`).not.toEqual([]);
      covered += read.length;
    }
    expect(covered).toBeGreaterThanOrEqual(COVERED_PAIRS);
  });
});

/* ── the matrix ──────────────────────────────────────────────────────────── */

/**
 * How many (surface, object) pairs the matrix below actually exercises.
 *
 * The naming assertion only fires for an object the page ASKED for, which is
 * right — a page cannot name a table it never read — but it also means the
 * sweep could quietly hollow out. Measured on this tree 2026-09-02, against
 * the populated database:
 *
 *   /                        review_items, resolution_runs, runs
 *   /queues                  review_items
 *   /queues/[reviewItemId]   review_items, observations, field_provenance, sources
 *   /claims                  observations, pending_claims
 *   /sources                 observations, pending_claims, sources, runs
 *   /cycles                  observations, field_provenance, resolution_runs
 *   /browse                  field_provenance, sources, events, event_listings
 *   /records/[table]/[id]    groups
 *
 * A FLOOR, not a pin: a page may grow a read, and that is not a failure. A
 * page losing every read, or the seam ceasing to route reads through the stub,
 * is — and either would drop this number.
 */
const COVERED_PAIRS = 22;

/** A script where every object exists but `missing` is not in the database. */
function absentFrom(base: Script, missing: string, absent: unknown): Script {
  return { ...base, [missing]: { error: absent } };
}

const DATABASES: ReadonlyArray<readonly [string, (surface: Surface) => Script]> = [
  ["an empty database", () => emptyScript()],
  ["a populated database", (surface) => populatedScript(surface)],
];

/**
 * Both spellings of "the object is not there": PostgREST's schema-cache miss
 * and Postgres's own `undefined_table`. A database that lacks the resolver
 * tables answers with one or the other depending on where the miss is caught.
 */
const ABSENCES: ReadonlyArray<readonly [string, (table: string) => unknown]> = [
  ["PGRST205", tableNotInSchemaCache],
  ["42P01", undefinedTable],
];

describe.each(DATABASES)("against %s missing one object", (_label, base) => {
  for (const surface of SURFACES) {
    describe(surface.route, () => {
      it.each(TABLE_NAMES)("survives %s being absent", async (missing) => {
        for (const [code, absence] of ABSENCES) {
          const stub = scriptDatabase(absentFrom(base(surface), missing, absence(missing)));
          const where = `${surface.route} without ${missing} (${code})`;

          // 1. Nothing throws. The page function is the route's only async
          //    component, so this IS the render Next would do.
          const markup = await renderSurface(surface);

          // 2. It is still a page: one heading, and words under it.
          expect([...markup.matchAll(/<h1[\s>]/g)].length, where).toBe(1);
          expect(markup.replace(/<[^>]*>/g, "").trim().length, where).toBeGreaterThan(0);

          // 3. If the page asked for the absent object, it says so — by name,
          //    in the spelling the query used.
          if (tablesRead(stub).has(missing)) {
            expect(namesExactly(markup, missing), `${where} names nothing`).toBe(true);
            // …and says it as an ABSENCE, never as a failure. Red means
            // broken; a table that is not there yet is not broken.
            for (const alert of alertTexts(markup)) {
              expect(alert, `${where} reported absence as an error line`).not.toContain(
                missing,
              );
            }
          }
        }
      });
    });
  }
});

/* ── the whole database missing ──────────────────────────────────────────── */

describe("against a database that lacks every ecosystem object", () => {
  function nothingProvisioned(): Script {
    const script: Script = {};
    for (const name of TABLE_NAMES) script[name] = { error: tableNotInSchemaCache(name) };
    return script;
  }

  it.each(SURFACES.map((surface) => [surface.route, surface] as const))(
    "%s names every object it asked for and invents no number",
    async (route, surface) => {
      const stub = scriptDatabase(nothingProvisioned());
      const markup = await renderSurface(surface);

      for (const missing of tablesRead(stub)) {
        expect(namesExactly(markup, missing), `${route} never names ${missing}`).toBe(
          true,
        );
      }

      // Never a zero that reads like data (LOOK_AND_FEEL state 3): with
      // nothing readable there is no count, and a rendered `0` would be a
      // claim about a database this page could not read.
      expect(figures(markup), `${route} rendered a figure off an absent read`).toEqual(
        [],
      );

      // No cell of any table renders blank — the header may stand, but an
      // empty `td` tells an operator nothing (see `blank-cells.test.ts`).
      expect(markup).not.toMatch(/<td[^>]*>\s*<\/td>/);
    },
  );

  it("keeps one surface's absence off the others", async () => {
    // The rest of the app keeps working: with only the resolver's own tables
    // gone, a page that reads none of them renders its ordinary state.
    const browse = SURFACES.find((surface) => surface.route === "/browse");
    if (browse === undefined) throw new Error("no /browse surface");
    const script = populatedScript(browse);
    for (const resolverOwned of ["review_items", "resolution_runs", "pending_claims"]) {
      script[resolverOwned] = { error: tableNotInSchemaCache(resolverOwned) };
    }
    const stub = scriptDatabase(script);
    const markup = await renderSurface(browse);

    expect([...tablesRead(stub)]).not.toContain("review_items");
    for (const gone of ["review_items", "resolution_runs", "pending_claims"]) {
      expect(namesExactly(markup, gone), `/browse reported ${gone}`).toBe(false);
    }
    expect(markup.length).toBeGreaterThan(0);
  });
});

/* ── the sweep can fail ──────────────────────────────────────────────────── */

describe("the absence sweep itself", () => {
  /**
   * A proof that passes against markup which does not carry the name is not a
   * proof. These pin the two readers the matrix rests on.
   */
  it("does not read a name that is only part of a longer line", () => {
    expect(namesExactly("<p>review_items is missing</p>", "review_items")).toBe(false);
    expect(namesExactly("<p><span>review_items</span> is missing</p>", "review_items")).toBe(
      true,
    );
  });

  it("reads a figure as a figure and prose as prose", () => {
    expect(figures("<div><span>0</span></div>")).toEqual(["0"]);
    expect(figures("<div><span>1,234</span></div>")).toEqual(["1,234"]);
    expect(figures("<p>a window of 6, not a count</p>")).toEqual([]);
  });
});
