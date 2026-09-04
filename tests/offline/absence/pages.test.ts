import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import * as cheerio from "cheerio";
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

describe("against a database that lacks every ecosystem object", () => {
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
function windowHooks(markup: string): string[] {
  const $ = cheerio.load(markup);
  return $("[data-window]")
    .toArray()
    .map((element) => $(element).attr("data-window") ?? "")
    .sort();
}

/**
 * Every surface that publishes a window on a healthy read, and the hooks it
 * publishes — measured on this tree 2026-09-04 (admin-window/BUG-0070, and
 * again after admin-window/DEBT-0003 folded the three hand-copied window lines
 * into one primitive): three routes, eight hooks. The eighth is `/claims`'s
 * gauge window, which stated its sentence and published no hook at all until
 * the fold gave every page the same line.
 *
 * A FLOOR, not a pin, in the sense the matrix's `COVERED_PAIRS` is one: a
 * surface may GROW a window line and that is not a failure — the legs below
 * measure what each surface really publishes and grade every hook of it. What
 * this list makes impossible is the opposite, a surface quietly ceasing to
 * publish, which would otherwise let both legs pass over a page that says
 * nothing in any state.
 */
const WINDOWED: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["/claims", ["claims", "pending"]],
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

    for (const surface of SURFACES) {
      scriptDatabase(populatedScript(surface));
      const healthy = windowHooks(await renderSurface(surface));
      if (healthy.length === 0) continue;
      publishes.set(surface.route, healthy);

      // The same surface, against a database that holds none of the objects
      // it reads: every one of those hooks is a claim about a table it could
      // not read, and `data-window-truncated="false"` a confident boolean
      // about a read that returned nothing (ARCHITECTURE.md, "a null count is
      // a refusal, never a zero"; LOOK_AND_FEEL states 3 and 4).
      scriptDatabase(nothingProvisioned());
      expect(
        windowHooks(await renderSurface(surface)),
        `${surface.route} still stated [${healthy.join(", ")}] over tables it could not read`,
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

    for (const surface of SURFACES) {
      scriptDatabase(populatedScript(surface));
      const healthy = windowHooks(await renderSurface(surface));
      if (healthy.length === 0) continue;
      publishes.set(surface.route, healthy);

      // The same surface, against a database that holds every object it reads
      // and no rows in any of them: every read RETURNED, so every one of those
      // hooks is a claim the page may still make — and `data-window-held="0"`
      // means "it happened and found nothing", the value a live oracle grades
      // the empty case by (ARCHITECTURE.md §4.3).
      scriptDatabase(emptyScript());
      expect(
        windowHooks(await renderSurface(surface)),
        `${surface.route} dropped a window line on a read that happened and found nothing`,
      ).toEqual(healthy);
    }

    coversTheFloor(publishes);
  });
});

/**
 * One read, one sentence — graded across the pages that share it.
 *
 * `/claims`'s pending-claims gauge and `/sources`'s awaiting-row gauge render
 * the SAME `WindowInfo`: both call `fetchPendingClaims`
 * (`lib/gauges/pending-claims.ts`), whose window is `windowOf(bounds,
 * observations.data.length)` over `observations` — one object, one set of
 * bounds, one cap. Two surfaces describing one read must therefore describe it
 * identically; where they do not, a reader comparing the two pages is told the
 * app looked in two different places, which is the drift DEBT-0003 set out to
 * end and did not (the `over` word was parameterised, not settled).
 *
 * Copy-independent by construction: both lines come from the ONE `WindowLine`
 * primitive, so a copy edit moves both together and this stays green. It can
 * only redden when the two CALL SITES disagree about the read they share.
 */
describe("two surfaces over one read describe it the same way", () => {
  const lineText = (markup: string, gauge: string): string =>
    cheerio.load(markup)(`[data-window="${gauge}"]`).text().replace(/\s+/g, " ").trim();

  // STRICT xfail while admin-window/BUG-0077 stands: the modifier below passes
  // only while the two call sites disagree, so the day the divergence is fixed
  // this turns RED and sends the reader to the ticket, which is where the
  // modifier comes off. Campaign-qualified on purpose — ids restart per
  // campaign, and a pin outlives one.
  it.fails("states the pending-claims window the same on /claims and /sources", async () => {
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
