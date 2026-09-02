import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { stubClient, type Script } from "../../fixtures/stub-client";

/**
 * No cell of any table on any page renders BLANK (campaign
 * admin-window/TASK-0019).
 *
 * A repo-wide latent defect, found on Cycles (admin-window/TASK-0014) and
 * relayed to this ticket to sweep: `DataTable` passes every cell body through
 * `orDash`, but a body that is a child COMPONENT element is never absent to it
 * — `isAbsent` sees a React element, not a null — so a component that renders
 * null leaves an EMPTY `td` instead of the em dash the table promises
 * ("a null renders as an em dash … never blank", `src/components/ui/data-table.tsx`).
 *
 * The state that provokes it is a database whose nullable columns are all
 * null, so this drives every page through exactly that and asserts what an
 * operator can see: no cell is empty. Where the fix belongs — the column
 * returning the null itself, as Cycles did, or the primitive learning to look
 * inside an element — is the page ticket's call; this only says the operator
 * must never be shown a cell that says nothing.
 */

const readWith = vi.hoisted(() => ({ client: undefined as unknown }));

vi.mock("@/lib/db/client", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/db/client")>();
  return {
    ...actual,
    getDbClient: () => {
      if (readWith.client === undefined) throw new Error("no database scripted");
      return readWith.client as SupabaseClient;
    },
  };
});

const { blankCells, loadSurfaces, nullableFields, renderSurface, sparseScript } =
  await import("./surfaces");

const SURFACES = await loadSurfaces();

function scriptDatabase(script: Script) {
  const stub = stubClient(script);
  readWith.client = stub.asSupabaseClient();
  return stub;
}

/**
 * The surfaces whose blank cells are a KNOWN, open defect — pinned with
 * `it.fails` rather than excluded, so the day one is fixed this file reddens
 * and the pin comes off. Each entry names what renders blank and who owns it.
 *
 * `/` — the Dashboard's two `error` columns (cycles and runs) render their
 * body through the `ErrorSummary` COMPONENT, which returns null when
 * `error_summary` is null (`src/app/page.tsx`). `orDash` sees a React element,
 * never an absence, so 10 of the 10 rows in the fixture population leave an
 * empty cell — measured 2026-09-02 by this file. Cycles hit the same thing and
 * fixed it by returning the null itself from the column (a plain function, not
 * a component). Found by campaign admin-window/TASK-0019, whose ticket adds no
 * product code; the fix belongs to the Dashboard's own ticket
 * (admin-window/TASK-0009).
 */
const KNOWN_BLANK: Readonly<Record<string, string>> = {
  "/": "the two error_summary columns render a component that returns null",
};

describe("a page whose rows carry nothing but nulls", () => {
  for (const surface of SURFACES) {
    const known = KNOWN_BLANK[surface.route];
    const run = known === undefined ? it : it.fails;
    run(
      known === undefined
        ? `${surface.route} renders no blank table cell`
        : `${surface.route} renders no blank table cell [known: ${known}]`,
      async () => {
        scriptDatabase(sparseScript(surface));
        const markup = await renderSurface(surface);
        expect(
          blankCells(markup),
          `${surface.route} rendered a cell with nothing in it`,
        ).toBe(0);
      },
    );
  }
});

describe("the blank-cell reader", () => {
  it("sees a blank cell, and does not call a dash blank", () => {
    expect(blankCells("<table><tbody><tr><td></td></tr></tbody></table>")).toBe(1);
    expect(blankCells("<table><tbody><tr><td>   </td></tr></tbody></table>")).toBe(1);
    expect(blankCells("<table><tbody><tr><td>—</td></tr></tbody></table>")).toBe(0);
    // A cell holding only an element — a link, a badge — is not blank.
    expect(blankCells('<table><tbody><tr><td><a href="/">x</a></td></tr></tbody></table>')).toBe(
      0,
    );
  });

  it("has nullable columns to null in the first place", () => {
    const nullable = nullableFields();
    expect(nullable.size).toBeGreaterThan(10);
    expect(nullable.has("ended_at")).toBe(true);
    expect(nullable.has("error_summary")).toBe(true);
    // Not everything is nullable: a column the fixtures declare NOT NULL must
    // not be nulled, or a page would be asked to survive an impossible row.
    expect(nullable.has("severity")).toBe(false);
    expect(nullable.has("review_item_id")).toBe(false);
  });
});
