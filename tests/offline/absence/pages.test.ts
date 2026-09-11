import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import * as cheerio from "cheerio";
import { T, TABLE_NAMES } from "@/lib/db/tables";
import {
  stubClient,
  tableNotInSchemaCache,
  undefinedTable,
  type Script,
  type ScriptedAnswer,
} from "../../fixtures/stub-client";
import { pendingClaimRow } from "../../fixtures/rows";
import { claimView } from "../claims/population";

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
import type { Params, Surface } from "./surfaces";

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

/** A database that holds none of the ecosystem's objects at all. */
function nothingProvisioned(): Script {
  const script: Script = {};
  for (const name of TABLE_NAMES) script[name] = { error: tableNotInSchemaCache(name) };
  return script;
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

/**
 * Objects one surface reads as ONE COMPOSED read that returns ONE refusal —
 * the first of them (campaign admin-window/BUG-0139).
 *
 * `/sources` matches the registry to the run log BY NAME (there is no key to
 * join on, ARCHITECTURE.md §6 trap 6) and, since BUG-0139, issues both reads
 * CONCURRENTLY — so with the whole database absent it asks for `runs` as well
 * as `sources` and reports the first refusal, naming `sources`. Naming both
 * would put two object names in one card's mono span, where §11 and
 * LOOK_AND_FEEL's state 3 put exactly one.
 *
 * The exemption is only for the LATER members of a composition, only when an
 * earlier member of the same composition is absent too, and it never excuses
 * silence: the first member must still be named (asserted below), and each
 * later member absent ON ITS OWN is named by the matrix above — which is what
 * keeps `/sources` from passing this file while saying nothing about a missing
 * `runs` table (the case a reader should check first is
 * `tests/offline/sources/page.test.ts`, "names `runs` when the run table is
 * not in this database").
 */
const COMPOSED_READS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["/sources", [T.sources, T.runs]],
  // The pending-claims gauge, which `/sources` draws its `awaiting_row` trend
  // from, is the second composition of the same kind (admin-window/TASK-0074).
  // Its two legs — the `observations` scan and the `pending_claims` window —
  // are issued TOGETHER now rather than one after the other, so with the whole
  // database absent the page asks for both and reports ONE refusal. Which one
  // is pinned rather than raced: the OBSERVATIONS refusal wins, because that
  // is the answer the sequential shape gave, and a card's mono span holds
  // exactly one object name (§11, LOOK_AND_FEEL state 3).
  //
  // The exemption is only ever for the SECOND name and only while the first is
  // absent too. `pending_claims` missing ON ITS OWN is named on `/sources` by
  // the matrix above, and by "names the classification view when the gauge's
  // claims leg cannot be read" in `tests/offline/sources/page.test.ts`.
  ["/sources", [T.observations, T.pendingClaims]],
];

describe("against a database that lacks every ecosystem object", () => {
  it.each(SURFACES.map((surface) => [surface.route, surface] as const))(
    "%s names every object it asked for and invents no number",
    async (route, surface) => {
      const stub = scriptDatabase(nothingProvisioned());
      const markup = await renderSurface(surface);

      const mustName = new Set(tablesRead(stub));
      for (const [composedRoute, objects] of COMPOSED_READS) {
        if (composedRoute !== route) continue;
        const asked = objects.filter((object) => mustName.has(object));
        if (asked.length < 2) continue;
        // The refusal the composed read returned is the first one, and it is
        // required by name; its companions are the same refusal's other half.
        expect(namesExactly(markup, asked[0]), `${route} never names ${asked[0]}`).toBe(
          true,
        );
        for (const later of asked.slice(1)) mustName.delete(later);
      }

      for (const missing of mustName) {
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

/* ── the object's name is a WORD of the sentence, not glued to it ────── */

/**
 * Every object a not-provisioned card names, and the ONE character the card
 * carries on with (campaign admin-window/BUG-0059).
 *
 * The card puts the missing object's name in an element of its own and
 * continues in prose (`src/components/ui/not-provisioned.tsx`). Lose the
 * separator between the two and an operator reads a single word —
 * `eventsisn’t` — so the state EC11 requires stops being a sentence while
 * every structural assertion above still passes: the name is present, in its
 * own element, in a not-provisioned card.
 *
 * Read structurally, and deliberately not as copy: the name is recognised by
 * matching `TABLE_NAMES` (the one place an object name is spelled), never a
 * class, and only where it is a LEAF's whole text; `after` is taken from the
 * TEXT NODE that follows the naming element,
 * not by searching the paragraph for the name, so a card whose eyebrow happens
 * to spell an object name cannot fool it; and the assertion is about a
 * separator, so the sentence’s words stay free to change.
 *
 * What it can and cannot see. This is the markup `renderToStaticMarkup`
 * produces, and that transform KEEPS a JSX whitespace run `next build` is free
 * to drop (measured on delivered HTML, campaign admin-window/BUG-0045), so it
 * cannot see the fragile spelling on its own. The source-side rule, repo-wide,
 * is `tests/offline/ui/copy.test.ts`; the two are complements — that file
 * forbids the spelling a transform may eat, this one pins the rendered result
 * on every page of the window at once, whatever future edit removes it.
 */
function namedObjects(markup: string): Array<{ named: string; after: string }> {
  const $ = cheerio.load(markup);
  const spelled = TABLE_NAMES as readonly string[];
  const found: Array<{ named: string; after: string }> = [];
  for (const card of $('[data-state="not_provisioned"]').toArray()) {
    for (const element of $(card).find("*").toArray()) {
      // Leaves only, as `figures()` reads a figure: an ancestor whose whole
      // text is the name (a card that renders nothing else) is the same name
      // twice, not two names.
      if ($(element).children().length > 0) continue;
      const named = $(element).text();
      if (!spelled.includes(named)) continue;
      const next = element.next;
      const after =
        next !== null && next.type === "text" ? (next.data.slice(0, 1) as string) : "";
      found.push({ named, after });
    }
  }
  return found;
}

describe("the not-provisioned card reads as a sentence", () => {
  it.each(SURFACES.map((surface) => [surface.route, surface] as const))(
    "%s leaves a space after every object name it renders",
    async (route, surface) => {
      scriptDatabase(nothingProvisioned());
      const named = namedObjects(await renderSurface(surface));

      // Non-vacuous per page: this surface really did draw one of these cards.
      expect(named, `${route} rendered no not-provisioned card`).not.toEqual([]);
      for (const { named: object, after } of named) {
        expect(after, `${route} rendered "${object}${after}…" as one word`).toBe(" ");
      }
    },
  );
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

  it("tells a name glued to the next word from a name that is spaced", () => {
    const card = (between: string) =>
      `<div data-state="not_provisioned"><p><span>events</span>${between}is missing.</p></div>`;
    expect(namedObjects(card(""))).toEqual([{ named: "events", after: "i" }]);
    expect(namedObjects(card(" "))).toEqual([{ named: "events", after: " " }]);
    // Not every element holding the name is the card's naming element: a card
    // with no text after it names nothing to space.
    expect(
      namedObjects('<div data-state="not_provisioned"><p><span>events</span></p></div>'),
    ).toEqual([{ named: "events", after: "" }]);
  });

  it("reads a figure as a figure and prose as prose", () => {
    expect(figures("<div><span>0</span></div>")).toEqual(["0"]);
    expect(figures("<div><span>1,234</span></div>")).toEqual(["1,234"]);
    expect(figures("<p>a window of 6, not a count</p>")).toEqual([]);
  });
});

/* ── a window line describes a window the page actually read ─────────────── */

/**
 * The window-line rule, graded across every surface at once
 * (ARCHITECTURE.md §4.3; admin-window/BUG-0063 on `/claims`,
 * admin-window/BUG-0067 on `/cycles`, admin-window/BUG-0070 on `/claims`).
 *
 * Three window lines on two routes fixed the same divergence one ticket at a
 * time — `/cycles`'s cycles line, `/cycles`'s runs line (`AdapterRuns`) and
 * `/claims`'s claims line — and each fix was pinned only in its own page
 * suite, so the fourth surface to grow a window line inherits nothing. This
 * grades the rule itself, on whatever surfaces publish a `data-window` hook:
 *
 *   a page that could not read its table publishes NO window hook for it;
 *   an EMPTY window is still a window the page looked in, and keeps its line.
 *
 * Behaviour, not copy: it reads the `data-window` hooks the live suites
 * already select by (`tests/live/cycles.live.test.ts`) and asserts nothing
 * about the sentences around them.
 *
 * Non-vacuous by construction. Both legs measure which surfaces publish a
 * window at all against a database that HOLDS rows, and only those surfaces
 * are then asked to drop it (leg 1) or keep it (leg 2) — so a page that
 * stopped rendering its window line entirely cannot pass by publishing
 * nothing in both states. `WINDOWED` is the floor both legs check the
 * measurement against: lose a surface or a hook from it and this file fails
 * rather than thinning out.
 */
/**
 * A surface at ONE of its URLs.
 *
 * Every page is one view of itself, with one exception: a route whose TAB is a
 * `searchParams` facet renders a different read on each tab, so the rule below
 * has to be asked of each. `/queues` grew the verdict log as its second tab
 * (campaign admin-window/TASK-0058, spec F13) — a windowed surface reached
 * only at `?tab=verdicts` — and grading the route at its bare URL alone would
 * leave the newest windowed surface in the app outside the one file that
 * grades the rule for every surface at once.
 *
 * The map is deliberately small and explicit: a tab is not derivable from the
 * filesystem the way a route is, so it is named here, and a route with no
 * entry is still swept exactly as it was.
 */
const TAB_VIEWS: Readonly<Record<string, readonly Params[]>> = {
  "/queues": [{}, { tab: "verdict_log" }],
};

interface View {
  /** The URL this view is at — the key `WINDOWED` names it by. */
  label: string;
  surface: Surface;
  params: Params;
}

/** Every surface at every URL the map gives it; a bare route by default. */
function viewsOf(surfaces: readonly Surface[]): View[] {
  return surfaces.flatMap((surface) =>
    (TAB_VIEWS[surface.route] ?? [{}]).map((params) => {
      const query = new URLSearchParams(
        Object.entries(params).map(([key, value]) => [key, String(value)]),
      ).toString();
      return {
        label: query.length === 0 ? surface.route : `${surface.route}?${query}`,
        surface,
        params,
      };
    }),
  );
}

const VIEWS = viewsOf(SURFACES);

function windowHooks(markup: string): string[] {
  const $ = cheerio.load(markup);
  return $("[data-window]")
    .toArray()
    .map((element) => $(element).attr("data-window") ?? "")
    .sort();
}

/**
 * Every surface that publishes a window on a healthy read, and the hooks it
 * publishes — measured on this tree 2026-09-04 (admin-window/BUG-0070, then
 * again after admin-window/DEBT-0003 folded three hand-copied window lines
 * into one primitive, and again after admin-window/DEBT-0006 folded the six
 * that stood outside it): FIVE routes, ten hooks.
 *
 * The two routes DEBT-0006 added are the two that stated a window in prose and
 * published no `data-window` hook at all, so the rule below could not reach
 * them: `/queues`'s queue-health gauge, and `/browse`'s recent events — which
 * additionally stated its window over a read that had refused, the defect
 * class BUG-0063, BUG-0067 and BUG-0070 were each filed out of. Both are
 * graded here now, by the same two legs as every other surface.
 *
 * A FLOOR, not a pin, in the sense the matrix's `COVERED_PAIRS` is one: a
 * surface may GROW a window line and that is not a failure — the legs below
 * measure what each surface really publishes and grade every hook of it. What
 * this list makes impossible is the opposite, a surface quietly ceasing to
 * publish, which would otherwise let both legs pass over a page that says
 * nothing in any state.
 *
 * One windowed surface is deliberately NOT here: the per-source dial on
 * `/queues/[reviewItemId]` (`data-window="awaiting_row"`), which renders only
 * for a source-pattern review item and this file's populated fixture builds a
 * fact item. Its own suite drives it (`tests/offline/review-item/page.test.ts`).
 */
const WINDOWED: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["/browse", ["events"]],
  ["/claims", ["claims", "pending"]],
  ["/queues", ["queue_health"]],
  ["/queues?tab=verdict_log", ["verdict_log"]],
  ["/sources", ["awaiting_row", "rejections"]],
  ["/cycles", ["cycle_health", "cycles", "resolution_latency", "runs"]],
];

/** Assert the measured healthy set covers the floor, hook by hook. */
function coversTheFloor(publishes: ReadonlyMap<string, readonly string[]>): void {
  expect(
    [...publishes.keys()].sort(),
    "no surface published a window line at all",
  ).not.toEqual([]);
  for (const [route, hooks] of WINDOWED) {
    const measured = publishes.get(route);
    expect(measured, `${route} published no window line on a healthy read`).toBeDefined();
    for (const hook of hooks) {
      expect(measured, `${route} stopped publishing [${hook}]`).toContain(hook);
    }
  }
}

describe("a window line describes a window the page read", () => {
  it("drops every window it publishes on a healthy read when the read never happened", async () => {
    const publishes = new Map<string, string[]>();

    for (const view of VIEWS) {
      scriptDatabase(populatedScript(view.surface));
      const healthy = windowHooks(await renderSurface(view.surface, view.params));
      if (healthy.length === 0) continue;
      publishes.set(view.label, healthy);

      // The same surface, against a database that holds none of the objects
      // it reads: every one of those hooks is a claim about a table it could
      // not read, and `data-window-truncated="false"` a confident boolean
      // about a read that returned nothing (ARCHITECTURE.md, "a null count is
      // a refusal, never a zero"; LOOK_AND_FEEL states 3 and 4).
      scriptDatabase(nothingProvisioned());
      expect(
        windowHooks(await renderSurface(view.surface, view.params)),
        `${view.label} still stated [${healthy.join(", ")}] over tables it could not read`,
      ).toEqual([]);
    }

    coversTheFloor(publishes);
  });

  it("keeps every window it publishes on a read that happened and found nothing", async () => {
    // The other half of the rule, and the reason the fix is not "drop the
    // line whenever the row count is zero": the page looked in the window,
    // and an empty window is still a window it read.
    //
    // Asked of EVERY surface that publishes a window, not of `/cycles` alone.
    // While this leg named one route, `/claims` diverged from the rule under a
    // test whose docstring claims to grade the rule itself — it dropped its
    // line on an ok-but-empty matching set, leaving that state one hook away
    // from the state where the read never happened (admin-window/BUG-0070).
    // A surface that grows a window line now inherits the rule instead of a
    // comment about it.
    const publishes = new Map<string, string[]>();

    for (const view of VIEWS) {
      scriptDatabase(populatedScript(view.surface));
      const healthy = windowHooks(await renderSurface(view.surface, view.params));
      if (healthy.length === 0) continue;
      publishes.set(view.label, healthy);

      // The same surface, against a database that holds every object it reads
      // and no rows in any of them: every read RETURNED, so every one of those
      // hooks is a claim the page may still make — and `data-window-held="0"`
      // means "it happened and found nothing", the value a live oracle grades
      // the empty case by (ARCHITECTURE.md §4.3).
      scriptDatabase(emptyScript());
      expect(
        windowHooks(await renderSurface(view.surface, view.params)),
        `${view.label} dropped a window line on a read that happened and found nothing`,
      ).toEqual(healthy);
    }

    coversTheFloor(publishes);
  });
});

/* ── a control is offered only where the read behind it answered ─────────── */

/**
 * **No surface offers a control it cannot honour** — the state rule, graded
 * across every page at once (campaign admin-window/TASK-0049; M2 EC9: "no
 * control is offered that would call a missing function"; LOOK_AND_FEEL
 * state 3).
 *
 * The window-line rule above says a page may not describe a read that did not
 * happen. This is the same rule about the other half of a surface: a page may
 * not offer an ACTION whose read did not happen either. M2's close slot is the
 * first surface where the two come apart — its controls are backed by a read
 * of the verdict log, which is absent on staging and in production for the
 * whole milestone — and the edit surface is the second. A per-page assertion
 * would leave the third to whoever remembers, which is precisely how the
 * window-line class reached three bugs (admin-window/BUG-0063/0067/0070).
 *
 * Two legs, both derived and neither vacuous:
 *
 *   a card that says a read did not happen contains NO control;
 *   a surface that offers controls on a healthy read offers NONE when every
 *   object it reads is absent.
 *
 * `CONTROLLED` is the floor the second leg is measured against, in the sense
 * `WINDOWED` above is one: a surface may GROW controls, but one that quietly
 * stops offering any cannot let both legs pass by rendering nothing in every
 * state.
 */
const CONTROL = "button, input, select, textarea, form";

/** Every control the markup offers, as `tag[hook]` so a failure names it. */
function controls(markup: string): string[] {
  const $ = cheerio.load(markup);
  return $(CONTROL)
    .toArray()
    .map((element) => (element as { tagName?: string }).tagName ?? "?");
}

/** The controls standing inside a card that says its read did not happen. */
function controlsInsideRefusals(markup: string): string[] {
  const $ = cheerio.load(markup);
  return $('[data-state="not_provisioned"], [data-state="error"]')
    .find(CONTROL)
    .toArray()
    .map((element) => (element as { tagName?: string }).tagName ?? "?");
}

/**
 * Every surface that offers a control when its reads answer, and how many —
 * measured on this tree 2026-09-09 (admin-window/TASK-0049), against the
 * populated database:
 *
 *   /queues/[reviewItemId]   1   the close slot's note field
 *   /records/[table]/[id]    5   the walk sandbox's editable cells
 *
 * Every other surface of the window offers none in any state: they are reads.
 */
const CONTROLLED: ReadonlyArray<readonly [string, number]> = [
  ["/queues/[reviewItemId]", 1],
  ["/records/[table]/[id]", 5],
];

/** The controls a markup offers, counted per tag: `{button: 2, textarea: 1}`. */
function controlTally(markup: string): Record<string, number> {
  const tally: Record<string, number> = {};
  for (const tag of controls(markup)) tally[tag] = (tally[tag] ?? 0) + 1;
  return tally;
}

/**
 * Controls the second markup offers that the first does not — the shape an
 * absent object must never produce.
 *
 * A surface may offer FEWER controls when a read refuses (that is the rule
 * working); offering one it does not offer when everything is there means the
 * control is backed by nothing at all.
 */
function controlsGained(healthy: string, degraded: string): string[] {
  const before = controlTally(healthy);
  const after = controlTally(degraded);
  return Object.entries(after)
    .filter(([tag, count]) => count > (before[tag] ?? 0))
    .map(([tag, count]) => `${tag} x${count - (before[tag] ?? 0)}`);
}

describe("a surface offers a control only where the read behind it answered", () => {
  it("puts no control inside a card that says a read did not happen, and gains none", async () => {
    // Across the whole matrix, not only the all-absent database: the card that
    // matters is the one a page draws for the ONE object it could not read
    // while the rest of it rendered — and on several surfaces (this page's
    // close among them) an object going absent means the page returns before
    // that part renders at all, so the all-absent database never reaches it.
    //
    // Two readings of one rule, because a control OUTSIDE the card is the
    // same defect as one inside it: a settle button beside a card saying the
    // verdict log is not here would call a function that is not there either.
    for (const surface of SURFACES) {
      const healthy = populatedScript(surface);
      scriptDatabase(healthy);
      const whole = await renderSurface(surface);

      for (const missing of TABLE_NAMES) {
        for (const base of [emptyScript(), healthy]) {
          scriptDatabase(absentFrom(base, missing, tableNotInSchemaCache(missing)));
          const markup = await renderSurface(surface);
          const where = `${surface.route} without ${missing}`;
          expect(
            controlsInsideRefusals(markup),
            `${where} offered a control inside a refused read's card`,
          ).toEqual([]);
          expect(
            controlsGained(whole, markup),
            `${where} offered a control it does not offer when the read answers`,
          ).toEqual([]);
        }
      }
    }
  });

  it("offers nothing at all when every object it reads is absent", async () => {
    const offers = new Map<string, number>();

    for (const surface of SURFACES) {
      scriptDatabase(populatedScript(surface));
      const healthy = controls(await renderSurface(surface)).length;
      if (healthy > 0) offers.set(surface.route, healthy);

      scriptDatabase(nothingProvisioned());
      expect(
        controls(await renderSurface(surface)),
        `${surface.route} still offered a control with every object it reads absent`,
      ).toEqual([]);
    }

    // The floor: the surfaces that DO offer controls still offer them, so the
    // leg above cannot pass on a window that offers nothing anywhere.
    for (const [route, atLeast] of CONTROLLED) {
      expect(offers.get(route), `${route} offers no control on a healthy read`).toBeGreaterThanOrEqual(
        atLeast,
      );
    }
  });

  it("reads a control inside a card, and one outside it, as different things", () => {
    // The guard on two fixtures (LESSONS 3): the reader must flag the shape it
    // forbids and must not flag the one it permits.
    const card = (inside: string) =>
      `<div data-state="not_provisioned"><p><span>verdicts</span> isn’t here.</p>${inside}</div>`;
    expect(controlsInsideRefusals(card("<button>Settle</button>"))).toEqual(["button"]);
    expect(controlsInsideRefusals(card(""))).toEqual([]);
    // A control the page offers BESIDE a card it drew for another read is not
    // this rule's business; the second leg is what grades those.
    expect(
      controlsInsideRefusals(`${card("")}<form><textarea></textarea></form>`),
    ).toEqual([]);
    expect(controls(`${card("")}<form><textarea></textarea></form>`)).toEqual([
      "form",
      "textarea",
    ]);
    // …and the second reader catches exactly that one: a control the degraded
    // markup offers and the healthy markup does not.
    expect(controlsGained("<textarea></textarea>", `${card("<button></button>")}`)).toEqual([
      "button x1",
    ]);
    expect(controlsGained("<textarea></textarea>", "<textarea></textarea>")).toEqual([]);
    // Fewer controls is the rule working, never a failure.
    expect(controlsGained("<button></button><button></button>", "<button></button>")).toEqual(
      [],
    );
  });
});

/**
 * One read, one sentence — graded across the pages that share it.
 *
 * `/claims`'s pending-claims gauge and `/sources`'s awaiting-row gauge render
 * the SAME `WindowInfo`: both call `fetchPendingClaims`
 * (`lib/gauges/pending-claims.ts`), whose window is `windowOf(bounds,
 * observations.data.length, T.observations)` over `observations` — one object,
 * one set of bounds, one cap. Two surfaces describing one read must therefore
 * describe it identically; where they do not, a reader comparing the two pages
 * is told the app looked in two different places, which is the drift DEBT-0003
 * set out to end and did not (the `over` word was parameterised, not settled).
 *
 * It stood here as a STRICT xfail while that divergence stood. It runs for
 * real since admin-window/BUG-0077 moved the word off the call sites and onto
 * the window `windowOf` builds, so neither page is asked what it read over.
 *
 * Copy-independent by construction: both lines come from the ONE `WindowLine`
 * primitive, so a copy edit moves both together and this stays green. It can
 * only redden when the two surfaces stop sharing one description of the read
 * they share.
 */
describe("two surfaces over one read describe it the same way", () => {
  const lineText = (markup: string, gauge: string): string =>
    cheerio.load(markup)(`[data-window="${gauge}"]`).text().replace(/\s+/g, " ").trim();

  it("states the pending-claims window the same on /claims and /sources", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-04T12:00:00.000Z"));
    try {
      const claims = SURFACES.find((surface) => surface.route === "/claims");
      const sources = SURFACES.find((surface) => surface.route === "/sources");
      if (claims === undefined || sources === undefined) {
        throw new Error("the two surfaces sharing the pending-claims read are not both here");
      }

      scriptDatabase(populatedScript(claims));
      const onClaims = lineText(await renderSurface(claims), "pending");
      scriptDatabase(populatedScript(sources));
      const onSources = lineText(await renderSurface(sources), "awaiting_row");

      expect(onClaims, "/claims published no gauge window line").not.toBe("");
      expect(onSources, "/sources published no gauge window line").not.toBe("");
      expect(
        onClaims,
        "the same pending-claims window is described differently on the two pages that read it",
      ).toBe(onSources);
    } finally {
      vi.useRealTimers();
    }
  });
});

/* ── an empty surface is explained from TWO facts, never one ─────────────── */

/**
 * The two-fact rule, graded across every surface that has an empty state at
 * once (ARCHITECTURE.md §4.3, promoted at the M2 structure walk 2026-09-09;
 * admin-window/BUG-0129, BUG-0131, BUG-0133, BUG-0135, DEBT-0008).
 *
 * "A table with no rows" and "a filter that matched nothing" never share a
 * rendering, and the URL ALONE cannot tell them apart. A surface deciding
 * which arm it renders owes two facts:
 *
 *   1. structural — can a facet of this URL remove a row of this surface's
 *      kind at all;
 *   2. population — does the surface hold any row with no URL facet at all.
 *
 * `/queues` was given both by BUG-0133 and `/claims` and `/sources` decided
 * from fact 1 alone until DEBT-0008 — so the rule had one owner and two
 * surfaces that had never met it. It is graded HERE, once, for every surface
 * that publishes the `data-empty` hook, so a fourth surface inherits the rule
 * rather than a comment about it.
 *
 * Behaviour, not copy: it reads the hook `/sources` and `/queues` already
 * publish and asserts nothing about the words in the card.
 *
 * **Two fixtures per surface, and neither leg can pass vacuously** (LESSONS 8).
 * The SAME URL is rendered against two databases:
 *
 *   - over a population that the facet really did shrink, the surface must say
 *     `narrowing` — a test that only ever saw the empty fixture would pass by
 *     deleting the narrowing arm outright;
 *   - over a population that holds nothing at all, no surface of that page may
 *     say `narrowing` — nothing was removed, so no filter may be blamed.
 *
 * Each leg additionally asserts the page rendered an empty hook at all, so a
 * page that stopped publishing one cannot pass both legs by saying nothing.
 */
function emptyHooks(markup: string): string[] {
  const $ = cheerio.load(markup);
  return $("[data-empty]")
    .toArray()
    .map((element) => $(element).attr("data-empty") ?? "")
    .sort();
}

/**
 * One URL per surface whose facet EMPTIES that surface over the populated
 * fixture, and empties it again — for the other reason — over the empty one.
 *
 * `/claims`: `escalated` claims are `venues`-domain in the claims population,
 * so the pair matches nothing while both values are real vocabulary.
 * `/sources`: a well-formed id the registry does not hold (BUG-0140's rule —
 * it is still an id, so it still narrows). `/queues`: `?kind=signal` empties
 * the decision block, whose own kind the facet really does remove.
 */
const TWO_FACT: ReadonlyArray<readonly [string, Params]> = [
  ["/claims", { bucket: "escalated", domain: "groups" }],
  ["/sources", { source_id: "00000000-0000-7000-8000-000000000000" }],
  ["/queues", { kind: "signal" }],
];

describe("an empty surface is explained from two facts", () => {
  const surfaceOf = (route: string): Surface => {
    const found = SURFACES.find((surface) => surface.route === route);
    if (found === undefined) throw new Error(`${route} is not in the swept surfaces`);
    return found;
  };

  it.each(TWO_FACT)("%s blames the facet that really removed rows", async (route, params) => {
    const surface = surfaceOf(route);
    scriptDatabase(populatedScript(surface));
    const hooks = emptyHooks(await renderSurface(surface, params));
    expect(hooks, `${route} rendered no empty surface under a facet that empties one`)
      .not.toEqual([]);
    expect(hooks, `${route} did not name the narrowing that emptied it`).toContain(
      "narrowing",
    );
  });

  it.each(TWO_FACT)(
    "%s blames no facet over a population that holds nothing",
    async (route, params) => {
      const surface = surfaceOf(route);
      scriptDatabase(emptyScript());
      const hooks = emptyHooks(await renderSurface(surface, params));
      expect(hooks, `${route} rendered no empty surface over an empty database`).not.toEqual(
        [],
      );
      expect(
        hooks,
        `${route} told the operator to widen a filter that removed nothing`,
      ).not.toContain("narrowing");
    },
  );
});

/* ── an affordance is only drawn where it can be honoured ────────────────── */

/**
 * The PAGING affordance's absence, graded for every surface at once — campaign
 * admin-window/TASK-0067, SPEC F10 ("a control that cannot be honoured is
 * never offered") and F14.
 *
 * It belongs HERE rather than in a per-page comment for the same reason the
 * window-line rule below does (ARCHITECTURE.md §4.3, admin-window/BUG-0070):
 * absence is one rule about the whole window, and the surface it would fail on
 * next is the one nobody thought to check. `/claims` is the first surface to
 * grow the control and `/browse` is the second (admin-window/TASK-0068); the
 * sweep is over whatever the filesystem holds, so the second one inherits the
 * rule instead of a comment about it.
 *
 * **The rule.** A page that could not read its rows draws NO paging element of
 * any kind — not the control, not the refusal, and not either of the two
 * sentences that stand where a control cannot: every one of them is a claim
 * about a set this page never read. The hook is `data-paging`
 * (`src/components/ui/paging.tsx`), so this reads structure and no copy.
 *
 * **And it is not vacuous**: the second case renders `/claims` against a
 * database that ANSWERS, holding more claims than one window, and requires the
 * control to be there — the two fixtures a guard needs (LESSONS 8). Without
 * it, a page that stopped drawing the affordance entirely would pass the first
 * case forever.
 *
 * **Why this is not the block above it.** "A surface offers a control only
 * where the read behind it answered" counts CONTROLS — `button`, `form`,
 * `textarea` — so it already forbids a paging button over an absent table, and
 * it is the stronger rule for that one arm. It cannot see the other three:
 * `PageMore` answers an exhausted set and a state past the bound ceiling with
 * a SENTENCE and no control at all, and a refusal is a paragraph. Those are
 * claims about a set too, and against a database that answered nothing they
 * are claims made off no read, so they are graded here by the hook rather than
 * by the tag.
 */

/** Every paging element in the markup, by the arm it drew. */
function pagingArms(markup: string): string[] {
  const $ = cheerio.load(markup);
  return $("[data-paging]")
    .toArray()
    .map((element) => $(element).attr("data-paging") ?? "")
    .sort();
}

/** How many times the paging hook is spelled at all — refusals included. */
function pagingOccurrences(markup: string): number {
  return (markup.match(/data-paging/g) ?? []).length;
}

/** `count` claims, oldest first by construction. */
function longPopulation(count: number) {
  return Array.from({ length: count }, (_, index) =>
    pendingClaimRow("escalated", {
      observation_id: `01920000-0000-7000-8000-0000000009${String(index).padStart(2, "0")}`,
      observed_at: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
    }),
  );
}

/** A claims view holding more rows than one window, so a first screen fills. */
function overOneWindow(): ScriptedAnswer {
  return claimView(longPopulation(130));
}

/**
 * A claims view whose COUNT and WINDOW READ disagree — 37 rows under a count
 * of 900.
 *
 * They are two reads, and nothing makes them agree. The state it produces is
 * off the bound grid, which is the ONE state that draws the limit arm, so it
 * is what keeps the leg below from being a check that cannot fail.
 */
function countDisagrees(): ScriptedAnswer {
  const view = claimView(longPopulation(37));
  return (call) => {
    const answer = view(call);
    return answer.count === null ? answer : { ...answer, count: 900 };
  };
}

describe("a paging affordance is only drawn where it can be honoured", () => {
  it.each(SURFACES.map((surface) => [surface.route, surface] as const))(
    "%s draws no paging element against a database that holds none of its objects",
    async (route, surface) => {
      for (const [code, absence] of ABSENCES) {
        const script: Script = {};
        for (const name of TABLE_NAMES) script[name] = { error: absence(name) };
        scriptDatabase(script);
        const markup = await renderSurface(surface);
        expect(
          pagingArms(markup),
          `${route} offered paging over tables it could not read (${code})`,
        ).toEqual([]);
        expect(pagingOccurrences(markup), `${route} (${code})`).toBe(0);
      }
    },
  );

  it("draws no LIMIT arm on any first screen, whatever the database holds", async () => {
    // The other half of the rule the page suite sweeps over its own fixtures
    // (`tests/offline/claims/page.test.ts`, inside the render funnel): a first
    // screen may never emit `data-paging="limit"`, the arm that stands where
    // no press can be honoured. Here it is asked of every surface against the
    // two databases this file already builds, so a page reached only from the
    // absence suite is swept too.
    for (const surface of SURFACES) {
      for (const [label, base] of DATABASES) {
        scriptDatabase(base(surface));
        expect(
          (await renderSurface(surface)).includes('data-paging="limit"'),
          `${surface.route} drew the limit arm on a first screen (${label})`,
        ).toBe(false);
      }
    }

    // …and on the one fixture that can actually produce the state: a count and
    // a window read that disagree. Without this the leg above would be a check
    // that cannot fail on this tree — every database it builds holds fewer
    // claims than one window.
    const claims = SURFACES.find((surface) => surface.route === "/claims");
    if (claims === undefined) throw new Error("no /claims surface");
    scriptDatabase({ ...populatedScript(claims), [T.pendingClaims]: countDisagrees() });
    const markup = await renderSurface(claims);
    expect(cheerio.load(markup)("[data-claim]")).toHaveLength(37);
    expect(markup.includes('data-paging="limit"')).toBe(false);
    expect(pagingOccurrences(markup)).toBe(0);
  });

  it("/claims says not_provisioned instead, and draws the control when the read answers", async () => {
    const claims = SURFACES.find((surface) => surface.route === "/claims");
    if (claims === undefined) throw new Error("no /claims surface");

    // The state EC5 names, off PostgREST's own schema-cache miss: the page
    // renders its not-provisioned state and the control appears zero times.
    const script: Script = {};
    for (const name of TABLE_NAMES) script[name] = { error: tableNotInSchemaCache(name) };
    scriptDatabase(script);
    const absent = await renderSurface(claims);
    expect(cheerio.load(absent)('[data-state="not_provisioned"]').length).toBeGreaterThan(0);
    expect(pagingOccurrences(absent)).toBe(0);

    // …and the same surface, against a database that ANSWERS with more claims
    // than one window holds: the control is drawn. Without this half the case
    // above would pass against a page that lost the affordance entirely.
    scriptDatabase({ ...populatedScript(claims), [T.pendingClaims]: overOneWindow() });
    const answered = await renderSurface(claims);
    expect(pagingArms(answered)).toEqual(["more"]);
  });
});
