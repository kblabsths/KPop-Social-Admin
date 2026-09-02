import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TABLE_NAMES } from "@/lib/db/tables";
import { stubClient, tableNotInSchemaCache, type Script } from "../../fixtures/stub-client";

/**
 * The parked bucket appears NOWHERE in the window (campaign
 * admin-window/TASK-0019).
 *
 * Acceptance test 3 — "`in_window` appears nowhere in the UI" — M1 EC5, and
 * ARCHITECTURE.md §6 trap 4. The classification view can spell a bucket for
 * claims still inside their corroboration window; it is empty by rule today,
 * the rule is a `when false` in someone else's migration, and a UI that shows
 * it as an empty bucket teaches an operator to expect a number there. So the
 * proof is total: every page, every filter state the page itself offers, and
 * every hand-typed URL that names the bucket — zero occurrences of the string
 * in the emitted markup. Not as a bucket, not as an empty bucket, not as a
 * filter option, not as a zero.
 *
 * The string is spelled in two halves here, exactly as the Claims page suite
 * spells it, so this file cannot be what puts it in the markup it scans.
 *
 * Non-vacuity is asserted, not assumed: the database these renders read hands
 * over a parked claim in the view, and the sweep checks the pages actually
 * read that view. A zero-occurrence proof against a database that never
 * mentioned the bucket would prove nothing at all.
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

const { emptyScript, hrefs, loadSurfaces, populatedScript, renderSurface, tablesRead } =
  await import("./surfaces");
import type { Params, Surface } from "./surfaces";
const { UNRENDERABLE_BUCKET } = await import("@/lib/db/claims");

const SURFACES = await loadSurfaces();

/** The parked bucket, assembled rather than written. */
const PARKED = "in_" + "window";

function scriptDatabase(script: Script) {
  const stub = stubClient(script);
  readWith.client = stub.asSupabaseClient();
  return stub;
}

/**
 * The filter states a surface OFFERS, read off its own rendered links.
 *
 * Derived rather than listed: whatever chips, tabs and column toggles a page
 * grows, the sweep follows them. One hop is enough — a chip's href carries the
 * whole facet state, so the second hop revisits states the first already
 * covered.
 */
function offeredStates(surface: Surface, markup: string): Params[] {
  const states: Params[] = [];
  const seen = new Set<string>();
  for (const href of hrefs(markup)) {
    let url: URL;
    try {
      url = new URL(href, `http://window.invalid${surface.path}`);
    } catch {
      continue;
    }
    if (url.pathname !== surface.path) continue;
    if (url.search === "") continue;
    if (seen.has(url.search)) continue;
    seen.add(url.search);

    const params: Params = {};
    for (const key of new Set(url.searchParams.keys())) {
      const values = url.searchParams.getAll(key);
      params[key] = values.length === 1 ? values[0] : values;
    }
    states.push(params);
  }
  return states;
}

/** Every query-parameter name any surface offers — the hand-typing vocabulary. */
async function offeredParamNames(): Promise<string[]> {
  const names = new Set<string>();
  for (const surface of SURFACES) {
    scriptDatabase(populatedScript(surface));
    const markup = await renderSurface(surface);
    for (const state of offeredStates(surface, markup)) {
      for (const key of Object.keys(state)) names.add(key);
    }
  }
  return [...names].sort();
}

describe("the parked bucket", () => {
  it("is the one the app itself refuses to render", () => {
    // The two halves spell the same string the app parks, so this file cannot
    // be scanning for a bucket nobody excluded.
    expect(UNRENDERABLE_BUCKET).toBe(PARKED);
  });

  it("is in the database these renders read", async () => {
    const claims = SURFACES.find((surface) => surface.route === "/claims");
    if (claims === undefined) throw new Error("no /claims surface");
    const script = populatedScript(claims);
    expect(JSON.stringify(script["pending_claims"])).toContain(PARKED);

    // …and the page really reads that view, so a clean scan means the page
    // dropped the bucket rather than never having seen it.
    const stub = scriptDatabase(script);
    await renderSurface(claims);
    expect(tablesRead(stub).has("pending_claims")).toBe(true);
  });
});

describe("every page, in every state it offers", () => {
  it.each(SURFACES.map((surface) => [surface.route, surface] as const))(
    "%s never emits the parked bucket",
    async (route, surface) => {
      const script = () => populatedScript(surface);

      scriptDatabase(script());
      const first = await renderSurface(surface);
      expect(first, `${route} (default state)`).not.toContain(PARKED);

      const states = offeredStates(surface, first);
      for (const params of states) {
        scriptDatabase(script());
        const markup = await renderSurface(surface, params);
        expect(markup, `${route}?${new URLSearchParams(
          Object.entries(params).flatMap(([key, value]) =>
            Array.isArray(value)
              ? value.map((one) => [key, one] as [string, string])
              : [[key, String(value)] as [string, string]],
          ),
        ).toString()}`).not.toContain(PARKED);
      }
    },
  );

  it("follows more than one state on the pages that have them", async () => {
    // A crawl that found no links would pass the sweep above in silence.
    const filtered = SURFACES.filter((surface) => surface.takesParams);
    let states = 0;
    for (const surface of filtered) {
      scriptDatabase(populatedScript(surface));
      states += offeredStates(surface, await renderSurface(surface)).length;
    }
    // Measured 2026-09-02 on this tree: 31 offered states — /queues 9,
    // /claims 12, /browse 7, /sources 3, /cycles 0 (its own facets are reached
    // from the Dashboard, not from chips of its own). A floor, not a pin; the
    // hand-typed pass below covers every page with every facet name regardless.
    expect(states).toBeGreaterThanOrEqual(25);
  });
});

describe("a hand-typed URL naming the parked bucket", () => {
  it("is answered by every page without ever echoing it", async () => {
    const names = await offeredParamNames();
    expect(names.length).toBeGreaterThan(0);

    for (const surface of SURFACES) {
      // One parameter at a time, then all of them at once: a page that drops
      // an unknown value from one facet may still carry it in another's href.
      const states: Params[] = names.map((name) => ({ [name]: PARKED }));
      states.push(Object.fromEntries(names.map((name) => [name, PARKED])));
      // …and the shapes a URL can actually arrive in: repeated, and mixed with
      // a value the page does know.
      states.push({ bucket: [PARKED, PARKED] });
      states.push({ tab: "standing", bucket: PARKED });

      for (const params of states) {
        scriptDatabase(populatedScript(surface));
        const markup = await renderSurface(surface, params);
        expect(markup, `${surface.route} with ${JSON.stringify(params)}`).not.toContain(
          PARKED,
        );
      }
    }
  });
});

describe("a database the pages cannot read", () => {
  /**
   * The states where a page has no rows to derive its options from and falls
   * back to a constant list of buckets — the other way the parked one could
   * reach the markup (`RENDERABLE_BUCKETS`, `src/app/claims/page.tsx`).
   */
  const DATABASES: ReadonlyArray<readonly [string, () => Script]> = [
    ["an empty database", () => emptyScript()],
    [
      "a database with no ecosystem objects",
      () => {
        const script: Script = {};
        for (const name of TABLE_NAMES) {
          script[name] = { error: tableNotInSchemaCache(name) };
        }
        return script;
      },
    ],
  ];

  it.each(DATABASES)("%s still emits the bucket nowhere", async (_label, script) => {
    for (const surface of SURFACES) {
      scriptDatabase(script());
      const markup = await renderSurface(surface);
      expect(markup, surface.route).not.toContain(PARKED);

      for (const params of offeredStates(surface, markup)) {
        scriptDatabase(script());
        expect(
          await renderSurface(surface, params),
          `${surface.route} ${JSON.stringify(params)}`,
        ).not.toContain(PARKED);
      }
    }
  });
});
