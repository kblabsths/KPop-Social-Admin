import * as cheerio from "cheerio";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PENDING_CLAIMS_DEFAULTS } from "@/lib/gauges/pending-claims";
// The app's own phrase for a CHIP narrowing, imported rather than retyped: a
// literal here would pass while the two surfaces said different things.
import { NARROWED_BY_FILTERS } from "@/components/ui";
import { ANY_LABEL, CLEAR_LABEL } from "@/lib/claims/filters";
import { UNRENDERABLE_BUCKET } from "@/lib/db/claims";
import { count } from "@/lib/format";
import { STANDING_BUCKET } from "@/lib/gauges/standing-disagreements";
import { claimLines, type ClaimLine } from "@/lib/claims/lines";
import {
  DEFAULT_WINDOW_SIZE,
  PAGE_PARAM,
  PAGE_ROUTES,
  SIZE_PARAM,
  WINDOW_SIZES,
  largestPage,
  windowBound,
  type PageAnswer,
  type PageWindow,
} from "@/lib/paging/bounds";
import {
  requestPage,
  type PageDeps,
  type PageState,
  type RowIdKey,
} from "@/lib/paging/machine";
import { ROW_CAP } from "@/lib/db/result";
import { T } from "@/lib/db/tables";
import { functionPaths } from "../../fixtures/client-props";
import { implicitInterElementSpaces } from "../source-tree";
import {
  disagreeingCounts,
  factoryTicketIds,
  h,
  render,
  runTogetherWords,
} from "../ui/markup";
import {
  classesOf,
  expectDrawnAsLinkAtRest,
  expectNotDrawnAsLink,
} from "../../fixtures/link-spelling";
import {
  CLAIMS,
  ENTITY,
  OBSERVATIONS,
  OBSERVED_AT,
  REGISTRY,
  SOURCE,
  SOURCE_NAME,
  claimView,
  nameOf,
} from "./population";
import { oneEach, surfaceHooks } from "../../fixtures/surface-state";
import {
  observationRow,
  pendingClaimRow,
  type PendingClaimBucket,
  type PendingClaimRow,
} from "../../fixtures/rows";
import {
  isCountLeg,
  permissionDenied,
  stubClient,
  tableNotInSchemaCache,
  transportFailure,
  type RecordedCall,
  type Script,
  type StubClient,
} from "../../fixtures/stub-client";

/**
 * The Claims page, rendered (campaign admin-window/TASK-0012).
 *
 * The page function is the only async component on the route
 * (ARCHITECTURE.md §5), so the whole test is
 * `renderToStaticMarkup(await ClaimsPage(props))` — no jsdom, no Testing
 * Library, no database. Every read is stubbed at its module boundary, so all
 * four states are reachable offline.
 *
 * **Every expectation about WHICH claims and WHICH counts render is computed
 * here, from the fixture population, with this file's own predicates.**
 * Acceptance test 3 says the rendered bucket counts equal the classification
 * view's, per bucket and per source filter; asking `selectClaims` what it
 * expects would only prove the page calls it.
 *
 * Assertions are STRUCTURE and BEHAVIOUR — which claims render, in which
 * order, under which count, in which state, linking where — plus the machine's
 * own strings where rendering them VERBATIM is the requirement (the bucket
 * names, the unmet requirement, the missing table). No class LITERAL and no
 * copy of the app's own words is pinned — the one rendering rule asserted
 * below reads the app's own link constant rather than repeating it
 * (`tests/fixtures/link-spelling.ts`, admin-window/BUG-0108).
 */

const readWith = vi.hoisted(() => ({ client: undefined as unknown }));

vi.mock("@/lib/db/claims", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/db/claims")>();
  return {
    ...actual,
    readClaimWindow: (options: Parameters<typeof actual.readClaimWindow>[0]) =>
      actual.readClaimWindow(options, readWith.client as never),
    readClaimCount: (filter?: Parameters<typeof actual.readClaimCount>[0]) =>
      actual.readClaimCount(filter, readWith.client as never),
    // The gauge section's fact 2 — the unnarrowed count inside the gauge's own
    // window (admin-window/BUG-0163), over BOTH its edges since
    // admin-window/TASK-0070. Stubbed at the same boundary as every other
    // read; without it this one leg would reach for a real client.
    readClaimCountIn: (
      bounds: Parameters<typeof actual.readClaimCountIn>[0],
      filter?: Parameters<typeof actual.readClaimCountIn>[1],
    ) => actual.readClaimCountIn(bounds, filter, readWith.client as never),
    readBucketOldest: (
      bucket: Parameters<typeof actual.readBucketOldest>[0],
      filter?: Parameters<typeof actual.readBucketOldest>[1],
    ) => actual.readBucketOldest(bucket, filter, readWith.client as never),
  };
});

// The registry leg (admin-window/BUG-0043) is its own module and its own read,
// so it is stubbed at its own boundary like every other one. It is
// `readSources` since admin-window/BUG-0138: the page cannot know which ids to
// ask for before its list read returns, and asking afterwards would put the
// sequential round trip back — so the registry is BOTH the labels and the chip
// vocabulary, read concurrently with everything else.
vi.mock("@/lib/db/sources", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/db/sources")>();
  return {
    ...actual,
    readSources: () => actual.readSources(readWith.client as never),
  };
});

vi.mock("@/lib/gauges/pending-claims", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/gauges/pending-claims")>();
  return {
    ...actual,
    readPendingClaims: (options?: unknown) =>
      actual.readPendingClaims((options ?? {}) as never, readWith.client as never),
  };
});

vi.mock("@/lib/gauges/standing-disagreements", async (importActual) => {
  const actual =
    await importActual<typeof import("@/lib/gauges/standing-disagreements")>();
  return {
    ...actual,
    readStandingDisagreements: (options?: unknown) =>
      actual.readStandingDisagreements(
        (options ?? {}) as never,
        readWith.client as never,
      ),
  };
});

/**
 * The surface's PROVIDER, spied rather than replaced — campaign
 * admin-window/TASK-0067, moved from the hook to the provider by
 * admin-window/BUG-0172, which made the provider the one thing that holds a
 * paged surface's state (the list consumes it, and so does the window line).
 *
 * Two things this tier cannot do on its own, and one it can:
 *
 *  - it has NO DOM, so the control the page renders cannot be clicked. The
 *    press is taken from the widget's own `onPress` prop as the surface hands
 *    it over, which is the same function a click would call;
 *  - `renderToStaticMarkup` renders ONCE, so a state published after the
 *    render never reaches markup. `override` is the one substitution this file
 *    makes: the state the provider STARTS from is replaced by a state the REAL
 *    driver produced from the REAL deps the page built, and the page is
 *    rendered again with it. Nothing else is faked — the provider, the deps,
 *    the driver, the widget, the row markup and the request are all the app's,
 *    and the line and the rows read that one state exactly as they do in a
 *    browser;
 *  - what it CAN do is watch the wire: the press reaches the network through
 *    `fetch`, so "one press, one request" is read off a stubbed global and
 *    needs no DOM at all (the arrangement `tests/offline/ui/paging.test.ts`
 *    established for the hook itself).
 *
 * By default it DELEGATES, so every other render in this file is unchanged.
 */
const paging = vi.hoisted(() => ({
  calls: [] as {
    initial: { rows: readonly unknown[]; window: unknown; status: string; refusal: unknown };
    deps: { route: string; path: string; params: string; idKey: string };
    /**
     * THE WINDOW THE PAGE COMPOSED, as it handed it to the provider
     * (admin-window/BUG-0180). The page's own fact, recorded so a test can
     * grade what the page stated, never what the provider derived.
     */
    window: unknown;
  }[],
  /** The move, taken from the surface the provider publishes — what a click calls. */
  goTo: null as null | ((window: { page: number; size: 20 | 50 | 100 }) => void),
  override: null as unknown,
}));

vi.mock("@/components/ui/paging", async (importActual) => {
  const actual = await importActual<typeof import("@/components/ui/paging")>();
  // A probe beside the page's own children: it draws nothing and hands the
  // provider's `goTo` out, the same function a click on a move link calls, in
  // a tier with no DOM to click.
  function Probe(): null {
    paging.goTo = actual.usePaging().goTo;
    return null;
  }
  return {
    ...actual,
    PagingProvider: (props: {
      initial: (typeof paging.calls)[number]["initial"];
      deps: (typeof paging.calls)[number]["deps"];
      window: unknown;
      children: unknown;
    }) => {
      paging.calls.push({ initial: props.initial, deps: props.deps, window: props.window });
      // The REAL provider, started from the state under test. The WINDOW is
      // the page's own, passed straight through: this file overrides the
      // paging STATE and nothing the page composed (admin-window/BUG-0180).
      return h(
        actual.PagingProvider as never,
        {
          initial: (paging.override === null ? props.initial : paging.override) as never,
          window: props.window as never,
          deps: props.deps as never,
        },
        props.children as never,
        h(Probe),
      );
    },
  };
});

const claimsModule = await import("@/app/claims/page");
const ClaimsPage = claimsModule.default;

/**
 * A window of the shape `/claims` composes — a cap, and a `held` that came
 * from a SEPARATE count read over the matching set (`heldFrom: "a count
 * read"`, admin-window/BUG-0174), which is what makes this surface the one
 * where two reads can disagree.
 *
 * Handed to the provider by the renders below that build a wrapper directly,
 * the way the page hands its own (admin-window/BUG-0180).
 */
/** The window size every address in this suite that names none renders at. */
const CLAIM_WINDOW = DEFAULT_WINDOW_SIZE;

/** This surface's own address, as the page spells it. */
const CLAIMS_PATH = "/claims";

/* ── the population, and this file's own reading of it ───────────────────── */

/**
 * The bucket that is empty by rule and must never reach the UI. Spelled in
 * two halves so that this file — which asserts the string's ABSENCE from the
 * markup — cannot be the thing that puts it there, and so the page's own
 * absence check stays honest about the product rather than about its tests.
 */
/**
 * WHAT ONE CLAIM LINE IS CALLED, for a fixture that builds the surface's deps
 * by hand — the same field the page spells (admin-window/BUG-0222), as the
 * NAME the page hands across the client boundary (admin-window/BUG-0226).
 */
const OBSERVATION_ID: RowIdKey<ClaimLine> = "observationId";

const PARKED = "in_" + "window";

/** The five buckets a page may show, spelled from the migration, in its order. */
const RENDERED_BUCKETS = [
  "standing_disagreement",
  "awaiting_link",
  "awaiting_row",
  "escalated",
  "agreeing",
];

/** Every claim the view holds that the UI may show. */
const SHOWABLE = CLAIMS.filter((claim) => claim.bucket !== PARKED);

/** Every claim the URL's facets keep — this file's own predicate. */
function matching(params: Record<string, string> = {}): PendingClaimRow[] {
  return SHOWABLE.filter(
    (claim) =>
      (params.bucket === undefined || claim.bucket === params.bucket) &&
      (params.source_id === undefined || claim.source_id === params.source_id) &&
      (params.domain === undefined || claim.domain === params.domain),
  );
}

/** The claims of one bucket under a source/domain narrowing. */
function inBucket(bucket: string, params: Record<string, string> = {}): PendingClaimRow[] {
  // The bucket facet is dropped: the table is the whole classification under
  // the current source and domain, whichever bucket the list is narrowed to.
  const scope = { ...params };
  delete scope.bucket;
  return matching(scope).filter((claim) => claim.bucket === bucket);
}

/** Oldest first, unknown last, the id breaking every tie — spec §4's order. */
function oldestFirst(claims: readonly PendingClaimRow[]): string[] {
  return [...claims]
    .sort((a, b) => {
      const at = OBSERVED_AT.get(a.observation_id);
      const bt = OBSERVED_AT.get(b.observation_id);
      if (at !== undefined && bt !== undefined && Date.parse(at) !== Date.parse(bt)) {
        return Date.parse(at) - Date.parse(bt);
      }
      if ((at === undefined) !== (bt === undefined)) return at === undefined ? 1 : -1;
      return a.observation_id < b.observation_id ? -1 : 1;
    })
    .map((claim) => claim.observation_id);
}

/* ── rendering ───────────────────────────────────────────────────────────── */

function healthyScript(overrides: Script = {}): Script {
  return {
    // The view, answering the QUERY it is asked — a window, six counts and
    // five `limit 1` seeks are twelve different questions of one object
    // (`claimView`, ./population.ts), and it holds the parked claim, so the
    // exclusion is still asked of a database that carries one.
    [T.pendingClaims]: claimView(CLAIMS),
    [T.observations]: { data: [...OBSERVATIONS] },
    // Two of the three sources are registered; `SOURCE.third` is not, so every
    // label assertion has a row it must name and a row it must not
    // (admin-window/BUG-0043).
    [T.sources]: { data: [...REGISTRY], count: REGISTRY.length },
    ...overrides,
  };
}

async function renderClaims(
  script: Script,
  params: Record<string, string | string[]> = {},
): Promise<string> {
  return (await renderWithStub(script, params)).markup;
}

/** The same render, with the call log the page's reads left behind. */
async function renderWithStub(
  script: Script,
  params: Record<string, string | string[]> = {},
): Promise<{ markup: string; stub: StubClient }> {
  const stub = stubClient(script);
  readWith.client = stub.asSupabaseClient();
  const markup = render(await ClaimsPage({ searchParams: Promise.resolve(params) }));
  // THE SWEEP OVER EVERY FIRST SCREEN THIS FILE RENDERS (campaign
  // admin-window/TASK-0067, QA off the admin-window/BUG-0168 close). Every
  // render of `/claims` in this suite goes through here, so the rule is graded
  // on every fixture at once rather than on the ones someone remembered.
  //
  // `data-paging="limit"` is the controls' honest answer to a window that
  // starts at the ceiling `windowBound` enforces: no "next", and a sentence
  // that does not claim the set has ended. On a FIRST screen it is neither —
  // it is a dead end the operator was handed before pressing anything, which
  // is what `initialPage(37, true)` produces when a count of 900 meets a
  // window read that returned 37 rows. The page's answer to that state is to
  // draw no paging element at all; this is the proof it never draws this one.
  expect(
    markup.includes('data-paging="limit"'),
    `a first screen of /claims drew the limit arm for ${JSON.stringify(params)}`,
  ).toBe(false);
  return { markup, stub };
}

/* ── reading the markup, structurally ────────────────────────────────────── */

/** Every figure a sentence states, in the order it states them. */

/** The standing tab's per-source splits, by the id each row is keyed on. */

/**
 * The bucket rows: the bucket and its count, in order.
 *
 * The distinct-SOURCES figure is gone with the column (admin-window/BUG-0138,
 * Ben's A2): a distinct count needs an aggregate PostgREST refuses, and the
 * only other way to it was the read of the whole population this page no
 * longer makes.
 */
function bucketRows(markup: string) {
  const $ = cheerio.load(markup);
  return $("[data-bucket]")
    .toArray()
    .map((element) => {
      const row = $(element).closest("tr");
      return {
        bucket: $(element).attr("data-bucket") ?? "",
        active: $(element).attr("aria-current") === "true",
        href: $(element).attr("href") ?? "",
        claims: Number(row.find("[data-bucket-claims]").attr("data-bucket-claims")),
      };
    });
}

/** The claim ids the list rendered, in rendered order. */
function claimIds(markup: string): string[] {
  const $ = cheerio.load(markup);
  return $("[data-claim]")
    .toArray()
    .map((element) => $(element).attr("data-claim") ?? "");
}

/** One claim's row, as its hooks. */
function claimRow(markup: string, id: string) {
  const $ = cheerio.load(markup);
  const row = $(`[data-claim="${id}"]`).closest("tr");
  return {
    bucket: row.find("[data-claim-bucket]").attr("data-claim-bucket"),
    sourceHref: row.find("[data-claim-source]").attr("href"),
    sourceId: row.find("[data-claim-source]").attr("data-claim-source"),
    /** What the SOURCE cell says, as against the id it is keyed and linked by. */
    sourceLabel: row.find("[data-claim-source]").text().trim(),
    provenanceHref: row.find("[data-claim-provenance]").attr("href"),
    requirement: row.find("[data-claim-requirement]").attr("data-claim-requirement"),
    text: row.text().replace(/\s+/g, " ").trim(),
    titles: row
      .find("[title]")
      .toArray()
      .map((element) => $(element).attr("title")),
  };
}

/** The chips of one facet: their labels, hrefs and active state. */
function chipsOf(markup: string, facet: string) {
  const $ = cheerio.load(markup);
  return $(`[data-facet="${facet}"] a`)
    .toArray()
    .map((element) => ({
      label: $(element).text().trim(),
      href: $(element).attr("href") ?? "",
      active: $(element).attr("aria-current") === "true",
    }));
}

/* ── the buckets, with counts and age ────────────────────────────────────── */

describe("the classification view, rendered", () => {
  it("keeps the bucket counts whole when a bucket filter narrows the list", async () => {
    // The table answers "how many claims are in every bucket" — narrowing it
    // to the one bucket being listed would answer nobody's question with four
    // blanks.
    const markup = await renderClaims(healthyScript(), { bucket: "awaiting_row" });
    for (const row of bucketRows(markup)) {
      expect(row.claims, row.bucket).toBe(inBucket(row.bucket).length);
    }
    expect(bucketRows(markup).find((row) => row.bucket === "awaiting_row")?.active).toBe(
      true,
    );
    expect(claimIds(markup)).toEqual(oldestFirst(matching({ bucket: "awaiting_row" })));
  });

  it("shows the oldest age of a bucket, absolutely in the title", async () => {
    const markup = await renderClaims(healthyScript());
    const $ = cheerio.load(markup);
    const escalated = $('[data-bucket="escalated"]').closest("tr");
    const oldest = OBSERVED_AT.get(
      inBucket("escalated")[0].observation_id,
    ) as string;
    // Relative on screen, with the absolute instant in the title (Voice bar 6):
    // the title carries the year and the UTC zone the row's text does not.
    const titles = escalated
      .find("[title]")
      .toArray()
      .map((element) => $(element).attr("title") ?? "");
    expect(titles.some((title) => title.includes("UTC"))).toBe(true);
    expect(titles.some((title) => title.includes(oldest.slice(0, 4)))).toBe(true);
  });
});

/* ── the claims ──────────────────────────────────────────────────────────── */

describe("the claim list", () => {
  it("renders every claim the view holds, oldest first", async () => {
    const markup = await renderClaims(healthyScript());
    expect(claimIds(markup)).toEqual(oldestFirst(SHOWABLE));
  });

  it("names what an awaiting_row claim is waiting for, never a bare bucket", async () => {
    const markup = await renderClaims(healthyScript(), { bucket: "awaiting_row" });
    const waiting = inBucket("awaiting_row");
    expect(waiting.length).toBeGreaterThan(1);
    for (const claim of waiting) {
      const row = claimRow(markup, claim.observation_id);
      expect(row.bucket, claim.observation_id).toBe("awaiting_row");
      // The view's own words, verbatim — the requirement is why this claim is
      // stuck, and the two rows here are stuck on different things.
      expect(row.requirement, claim.observation_id).toBe(claim.unmet_requirement);
      expect(row.text).toContain(claim.unmet_requirement as string);
    }
    expect(new Set(waiting.map((claim) => claim.unmet_requirement)).size).toBe(2);
  });

  it("shows an unknown age as an absence, never as a zero age", async () => {
    const markup = await renderClaims(healthyScript());
    const unobserved = SHOWABLE.filter(
      (claim) => !OBSERVED_AT.has(claim.observation_id),
    );
    expect(unobserved.length).toBeGreaterThan(0);
    for (const claim of unobserved) {
      const row = claimRow(markup, claim.observation_id);
      // Nothing in the row carries an instant, so nothing claims an age.
      expect(row.titles.some((title) => title?.includes("UTC")), claim.observation_id).toBe(
        false,
      );
      // And it sorts last, behind every claim whose age is known.
      expect(claimIds(markup).at(-1)).toBe(
        oldestFirst(SHOWABLE).at(-1),
      );
    }
  });
});

/* ── the list's window ───────────────────────────────────────────────────── */

/**
 * The list's BOUND (campaign admin-window/BUG-0041).
 *
 * The read stays complete — the bucket counts are the view's — but the table
 * is drawn as a window, because an unbounded list made the page's own sections
 * move with the backlog: measured on staging 2026-09-03, 877 claims rendered a
 * 30,079px page with the gauge heading at y=29,486.
 *
 * These tests are over a population BIGGER than the cap, generated here, so
 * they fail the moment the bound is removed, raised silently, or applied
 * before the order instead of after it. `CLAIM_WINDOW` is imported rather than
 * spelled: the number is the product's to choose, the BEHAVIOUR is what is
 * pinned.
 */
/**
 * Bar 10 on the page with the most routes off it: 61 of the 132 anchors
 * admin-window/BUG-0108 counted are here — every bucket name and every claim
 * row's source and record — and each of them was drawn in plain ink with no
 * decoration, so the tab read as a list of names rather than a set of ways in.
 */
describe("what on this page says it goes somewhere", () => {
  const HOOKS = ["[data-bucket]", "[data-claim-source]", "[data-claim-provenance]"];

  it("draws the bucket names and the claim row's links as links at rest", async () => {
    const markup = await renderClaims(healthyScript());
    const $ = cheerio.load(markup);
    for (const hook of HOOKS) {
      const anchors = $(`${hook}[href]`).toArray();
      expect(anchors.length, `${hook} rendered no links at all`).toBeGreaterThan(0);
      for (const anchor of anchors) {
        expectDrawnAsLinkAtRest(classesOf($(anchor)), `${hook} on the buckets tab`);
      }
    }
  });

  it("draws the standing tab's per-source rows as links at rest", async () => {
    const markup = await renderClaims(healthyScript(), { tab: "standing" });
    const $ = cheerio.load(markup);
    const anchors = $("[data-split-source][href]").toArray();
    expect(anchors.length, "the standing tab rendered no source links").toBeGreaterThan(0);
    for (const anchor of anchors) {
      expectDrawnAsLinkAtRest(classesOf($(anchor)), "a standing-disagreement source");
    }
  });

  it("keeps the values that go nowhere out of the link's ink", async () => {
    const markup = await renderClaims(healthyScript());
    const $ = cheerio.load(markup);
    for (const inert of ["[data-claim-bucket]", "[data-bucket-claims]"]) {
      const cells = $(inert).toArray();
      expect(cells.length, `no ${inert} to compare against`).toBeGreaterThan(0);
      for (const cell of cells) expectNotDrawnAsLink(classesOf($(cell)), inert);
    }
  });
});

describe("the claim list's window", () => {
  /** A claim per index, oldest first by index, alternating bucket and source. */
  function crowd(size: number): {
    claims: PendingClaimRow[];
    observations: ReturnType<typeof observationRow>[];
    instants: Map<string, string>;
  } {
    const claims: PendingClaimRow[] = [];
    const observations: ReturnType<typeof observationRow>[] = [];
    const instants = new Map<string, string>();
    for (let index = 0; index < size; index += 1) {
      const id = `01920000-0000-7000-8000-0000000${(70000 + index).toString()}`;
      const bucket = index % 2 === 0 ? "awaiting_row" : "awaiting_link";
      const source = index % 3 === 0 ? SOURCE.first : SOURCE.second;
      // Ascending instants from a fixed origin: index 0 is the oldest, so the
      // expected window is the first `CLAIM_WINDOW` indices, in index order.
      const observedAt = new Date(Date.UTC(2026, 0, 1) + index * 3_600_000).toISOString();
      claims.push(
        pendingClaimRow(bucket, {
          observation_id: id,
          domain: "events",
          entity_id: bucket === "awaiting_row" ? null : ENTITY.event,
          field: "title",
          source_id: source,
          observed_at: observedAt,
        }),
      );
      observations.push(
        observationRow({
          observation_id: id,
          entity_id: bucket === "awaiting_row" ? null : ENTITY.event,
          domain: "events",
          field: "title",
          source_id: source,
          observed_at: observedAt,
          status: "pending",
        }),
      );
      instants.set(id, observedAt);
    }
    return { claims, observations, instants };
  }

  /** The window line's own hooks — the app's stated bound, read structurally. */
  function windowLine(markup: string) {
    const line = cheerio.load(markup)('[data-window="claims"]');
    return {
      present: line.length === 1,
      limit: Number(line.attr("data-window-limit")),
      held: Number(line.attr("data-window-held")),
      truncated: line.attr("data-window-truncated") === "true",
      text: line.text().replace(/\s+/g, " ").trim(),
    };
  }

  function crowdedScript(size: number): Script {
    const population = crowd(size);
    return {
      [T.pendingClaims]: claimView(population.claims),
      [T.observations]: { data: population.observations },
      [T.sources]: { data: [] },
    };
  }


  /*
   * "names the rows ON SCREEN, never its cap, under %s" stood here until 2026-10-21.
   *
   * It read the claim list's window SENTENCE. Ben deleted every window-line
   * sentence in the app on 2026-10-21, so the line publishes its facts as
   * `data-window-*` hooks and says nothing at all. The read's honesty is still
   * graded — limit, held, truncated, from, drawn and oldest are each pinned in
   * `tests/offline/ui/primitives.test.ts`, and the cases still passing in this
   * very describe grade them on this page — but the English this case asserted
   * no longer exists.
   */

  /*
   * "states what the COUNT read found and nothing about rows, where the window drew NONE [admin-window/BUG-0197]" stood here until 2026-10-21.
   *
   * It read the claim list's window SENTENCE. Ben deleted every window-line
   * sentence in the app on 2026-10-21, so the line publishes its facts as
   * `data-window-*` hooks and says nothing at all. The read's honesty is still
   * graded — limit, held, truncated, from, drawn and oldest are each pinned in
   * `tests/offline/ui/primitives.test.ts`, and the cases still passing in this
   * very describe grade them on this page — but the English this case asserted
   * no longer exists.
   */

  it("does not claim to be truncated when every matching claim is drawn", async () => {
    const line = windowLine(await renderClaims(crowdedScript(CLAIM_WINDOW)));
    expect(line.truncated).toBe(false);
    expect(line.held).toBe(CLAIM_WINDOW);
    expect(line.text).not.toContain(String(CLAIM_WINDOW * 2));
    // The fixture population is well under the cap, so nothing there is held
    // back either — the window never hides a row it did not have to.
    const small = windowLine(await renderClaims(healthyScript()));
    expect(small.truncated).toBe(false);
    expect(small.held).toBe(SHOWABLE.length);
  });


  /*
   * "counts the population a FILLED window NAMES, not the view it read from" stood here until 2026-10-21.
   *
   * It read the claim list's window SENTENCE. Ben deleted every window-line
   * sentence in the app on 2026-10-21, so the line publishes its facts as
   * `data-window-*` hooks and says nothing at all. The read's honesty is still
   * graded — limit, held, truncated, from, drawn and oldest are each pinned in
   * `tests/offline/ui/primitives.test.ts`, and the cases still passing in this
   * very describe grade them on this page — but the English this case asserted
   * no longer exists.
   */

  it("counts held claims per narrowing, not per rendered page", async () => {
    // Big enough that EACH bucket alone overflows the cap, so a narrowing is
    // windowed too and its held count is the narrowing's, not the page's.
    const size = CLAIM_WINDOW * 2 + 17;
    const population = crowd(size);
    for (const bucket of ["awaiting_row", "awaiting_link"]) {
      const expected = population.claims.filter((claim) => claim.bucket === bucket);
      expect(expected.length, bucket).toBeGreaterThan(CLAIM_WINDOW);
      const markup = await renderClaims(crowdedScript(size), { bucket });
      const line = windowLine(markup);
      expect(line.held, bucket).toBe(expected.length);
      expect(claimIds(markup).length, bucket).toBe(
        Math.min(CLAIM_WINDOW, expected.length),
      );
      expect(line.truncated, bucket).toBe(expected.length > CLAIM_WINDOW);
    }
  });

  /**
   * The whole view with the standing bucket taken out of it: the database the
   * standing TAB reads as empty while the buckets tab reads as populated.
   * `count` is the row count of that same array — a complete read whose exact
   * count outruns its rows is an ERROR by design (`readComplete`), which would
   * grade the wrong state below.
   */
  const NO_STANDING = CLAIMS.filter(
    (claim) => claim.bucket !== "standing_disagreement",
  );

  /**
   * A narrowing of the FULL population that matches no claim at all: both
   * values are in the view's own vocabulary — so the page keeps them rather
   * than dropping an unknown facet — and no claim carries both.
   */
  const MATCHES_NOTHING = { bucket: "escalated", source_id: SOURCE.third };

  it("states the window it read when the read found nothing, beside the Empty card", async () => {
    // ARCHITECTURE.md §4.3, admin-window/BUG-0070: the line follows the READ,
    // not the rows. All three of this page's emptinesses are ok reads — the
    // page looked — so each keeps its line with a real `data-window-held="0"`,
    // the one value that tells an honest empty read from a read that never
    // happened (and the value the live oracle grades the empty case by). The
    // card and the line say different things and both are true: the card says
    // what would fill the surface, the line says where the app looked.
    const cases: Array<[string, Script, Record<string, string>]> = [
      // The view holds nothing at all.
      ["the view holds nothing", healthyScript({ [T.pendingClaims]: claimView([]) }), {}],
      // The view holds claims; this narrowing matches none of them — the one
      // escalated claim in the population belongs to another source.
      ["the filter matched nothing", healthyScript(), MATCHES_NOTHING],
      // The standing tab's own subset, empty while the view is not.
      [
        "the standing subset is empty",
        healthyScript({ [T.pendingClaims]: claimView(NO_STANDING) }),
        { tab: "standing" },
      ],
    ];

    // Non-vacuous: the narrowing case is a narrowing OF a populated view, so
    // its emptiness is the filter's doing and not the database's.
    expect(
      claimIds(await renderClaims(healthyScript(), {})).length,
      "the population the narrowing narrows",
    ).toBeGreaterThan(0);

    for (const [label, script, params] of cases) {
      const markup = await renderClaims(script, params);
      // The emptiness itself: no rows, and the list is a card rather than a
      // headers-only table.
      expect(claimIds(markup), label).toEqual([]);
      const $ = cheerio.load(markup);
      expect($(SURFACE_HOOKS.claims).find('[data-state="empty"]'), label).toHaveLength(1);

      // ...and the window line stands WITH it, stating a read that happened.
      const line = windowLine(markup);
      expect(line.present, label).toBe(true);
      expect(line.limit, label).toBe(CLAIM_WINDOW);
      expect(line.held, label).toBe(0);
      expect(line.truncated, label).toBe(false);
      // The line lives inside the list's own surface, where the oracle reads
      // it — not loose on the page.
      expect($(SURFACE_HOOKS.claims).find('[data-window="claims"]'), label).toHaveLength(1);
    }
  });

  it("keeps the three emptinesses three different renderings, line and all", async () => {
    // The line is the same sentence in all three; the CARD is what
    // distinguishes them, and it still does (LOOK_AND_FEEL, Emptiness). Read
    // as three distinct texts rather than by pinning any one of them, so the
    // words stay free to change and only their distinctness is the contract.
    const cardText = async (script: Script, params: Record<string, string>) => {
      const $ = cheerio.load(await renderClaims(script, params));
      return $(SURFACE_HOOKS.claims)
        .find('[data-state="empty"]')
        .text()
        .replace(/\s+/g, " ")
        .trim();
    };
    const holdsNothing = await cardText(
      healthyScript({ [T.pendingClaims]: claimView([]) }),
      {},
    );
    const matchedNothing = await cardText(healthyScript(), MATCHES_NOTHING);
    const standingEmpty = await cardText(
      healthyScript({ [T.pendingClaims]: claimView(NO_STANDING) }),
      { tab: "standing" },
    );
    for (const [label, text] of [
      ["the view holds nothing", holdsNothing],
      ["the filter matched nothing", matchedNothing],
      ["the standing subset is empty", standingEmpty],
    ] as const) {
      expect(text.length, label).toBeGreaterThan(0);
    }
    expect(new Set([holdsNothing, matchedNothing, standingEmpty]).size).toBe(3);
  });
});

/* ── the standing-disagreements tab ──────────────────────────────────────── */

describe("the standing-disagreements tab", () => {
  it("offers both tabs, marking the one we are on, each keeping the filter", async () => {
    const markup = await renderClaims(healthyScript(), {
      tab: "standing",
      domain: "groups",
    });
    const $ = cheerio.load(markup);
    const tabs = $("[data-tab]")
      .toArray()
      .map((element) => ({
        tab: $(element).attr("data-tab"),
        active: $(element).attr("data-active") === "true",
        href: $(element).find("a").attr("href") ?? "",
      }));
    expect(tabs.map((tab) => tab.tab)).toEqual(["buckets", "standing"]);
    expect(tabs.filter((tab) => tab.active).map((tab) => tab.tab)).toEqual(["standing"]);
    for (const tab of tabs) expect(tab.href).toContain("domain=groups");
  });

  it("offers no bucket chip, because the tab IS the bucket", async () => {
    // A chip that looks like a narrowing and does nothing is worse than no
    // chip: the tab strip already says which bucket this is.
    const markup = await renderClaims(healthyScript(), { tab: "standing" });
    expect(chipsOf(markup, "bucket")).toEqual([]);
    expect(chipsOf(markup, "source_id").length).toBeGreaterThan(1);
    // The domain facet has no chip row on either tab (admin-window/BUG-0138).
    expect(chipsOf(markup, "domain")).toEqual([]);
    // And a bucket asked for by hand does not travel in the tab's own URLs.
    const handTyped = await renderClaims(healthyScript(), {
      tab: "standing",
      bucket: "escalated",
    });
    expect(handTyped).not.toContain("bucket=escalated");
    expect(claimIds(handTyped)).toEqual(
      oldestFirst(matching({ bucket: "standing_disagreement" })),
    );
  });
});

/* ── the gauge's own window line ─────────────────────────────────────────── */

describe("the gauge's window line", () => {
  /** Every window this page publishes, by name, in document order. */
  function windowNames(markup: string): string[] {
    const $ = cheerio.load(markup);
    return $("[data-window]")
      .toArray()
      .map((element) => $(element).attr("data-window") ?? "");
  }

  /** The gauge section's own window line, read structurally. */
  function gaugeWindow(markup: string) {
    const $ = cheerio.load(markup);
    const line = $('[data-surface="gauge"]').find("[data-window]");
    return {
      count: line.length,
      name: line.attr("data-window"),
      since: line.attr("data-window-since"),
      until: line.attr("data-window-until"),
      truncated: line.attr("data-window-truncated"),
    };
  }

  it("publishes the window it read, on both tabs, where an oracle can read it", async () => {
    // This page published the SENTENCE and none of the attributes until
    // admin-window/DEBT-0003 folded the three hand-copied window lines into
    // one primitive: its gauge window was the one window in the app no live
    // oracle could read structurally (ARCHITECTURE.md §4.3, §10).
    for (const tab of ["buckets", "standing"]) {
      const line = gaugeWindow(await renderClaims(healthyScript(), { tab }));
      expect(line.count, tab).toBe(1);
      expect(line.since, tab).toBeDefined();
      expect(line.until, tab).toBeDefined();
      // Real bounds, in order: a window is an interval the read actually used.
      expect(Date.parse(line.since ?? ""), tab).not.toBeNaN();
      expect(Date.parse(line.until ?? ""), tab).not.toBeNaN();
      expect(Date.parse(line.since ?? "") < Date.parse(line.until ?? ""), tab).toBe(true);
      // A confident boolean, never an absent attribute.
      expect(line.truncated, tab).toBe("false");
    }
  });

  it("is its own window, never the list's, and the two tabs' are not one", async () => {
    // The list window (`claims`) and the gauge window are different reads over
    // different bounds; one name for both would let an oracle grade one while
    // reading the other (common violation 7).
    const buckets = windowNames(await renderClaims(healthyScript()));
    const standing = windowNames(await renderClaims(healthyScript(), { tab: "standing" }));
    expect(new Set(buckets).size).toBe(buckets.length);
    expect(new Set(standing).size).toBe(standing.length);
    expect(buckets).toContain("claims");
    expect(standing).toContain("claims");
    expect(buckets.filter((name) => name !== "claims")).not.toEqual(
      standing.filter((name) => name !== "claims"),
    );
  });

  it("states no window at all where the read never happened", async () => {
    // The other half of the rule: the line follows the READ. A refused gauge
    // renders its refusal card and publishes nothing an oracle could mistake
    // for a window it looked in (admin-window/BUG-0063, BUG-0067, BUG-0070).
    for (const tab of ["buckets", "standing"]) {
      const markup = await renderClaims(
        {
          [T.pendingClaims]: { error: tableNotInSchemaCache(T.pendingClaims) },
          [T.observations]: { error: tableNotInSchemaCache(T.observations) },
          [T.sources]: { data: [] },
        },
        { tab },
      );
      expect(windowNames(markup), tab).toEqual([]);
      // …and the refusal it renders instead names the object, structurally.
      expect(
        cheerio.load(markup)('[data-surface="gauge"]').find("[data-not-provisioned]").length,
        tab,
      ).toBe(1);
    }
  });

  /**
   * The gauge's window line states the scope its own read had
   * (admin-window/BUG-0163, filed against the landed BUG-0160).
   *
   * `gaugeFilter` (`src/app/claims/page.tsx`) hands the source and domain
   * facets to the gauge read, so `?domain=` narrows every figure this section
   * draws — measured on staging 2026-09-10 against the landed fix: the same
   * sentence, to the byte, stands over 877 claims (`/claims`), 849
   * (`?domain=events`) and 0 (`?domain=groups`). BUG-0160 gave the list's
   * window line and the bucket caption the words for that narrowing; this
   * section, whose figures the same facet moved, still says "Claims observed
   * since …, read to … — a window of at most 1,000 rows, not the whole table"
   * and names nothing, and the facet has no chip row to read it off
   * (`CHIP_FACETS`, admin-window/BUG-0138) — so the whole gauge card is a
   * narrowed figure under an unnarrowed sentence (LOOK_AND_FEEL bar 13, "no
   * screen claims a mark it did not draw"; LESSONS 2).
   *
   * Graded from the QUERY the page built rather than from its copy: the
   * gauge's own read carried the facet, so the sentence stating the window
   * those figures came from must carry the facet and the value the URL asked
   * for — the same oracle the list's line is already held to above.
   */
  // FIXED by admin-window/BUG-0163: the scan arm of `WindowLine` takes a
  // `scope`, the page composes it from the same object `gaugeFilter` handed
  // the read, and this pin is a plain `it(...)`.
  /*
   * "says what narrowed its own read, where no chip row can say it" stood here until 2026-10-21.
   *
   * It read the GAUGE's window sentence: the scan arm's `measured`, `scope` and
   * `answersFor` phrases. Those props went with the sentence layer on 2026-10-21.
   * The narrowing itself still reaches the query and still draws its chips; what
   * is retired is the paragraph that described it.
   */

  /*
   * "says the bucket filter does not narrow the gauge [admin-window/BUG-0204]" stood here until 2026-10-21.
   *
   * It read the GAUGE's window sentence: the scan arm's `measured`, `scope` and
   * `answersFor` phrases. Those props went with the sentence layer on 2026-10-21.
   * The narrowing itself still reaches the query and still draws its chips; what
   * is retired is the paragraph that described it.
   */

  /*
   * "names a chip narrowing its read carried, in the app's one phrase for it" stood here until 2026-10-21.
   *
   * It read the GAUGE's window sentence: the scan arm's `measured`, `scope` and
   * `answersFor` phrases. Those props went with the sentence layer on 2026-10-21.
   * The narrowing itself still reaches the query and still draws its chips; what
   * is retired is the paragraph that described it.
   */

  /**
   * …and what it costs when that read REFUSES.
   *
   * Fact 2 is a count that renders no figure: it only decides which words an
   * empty card takes. So a refusal of it may cost the operator those words and
   * nothing else — the window line, the figures and the cards the gauge read
   * DID answer all stay on screen, and the refusal is published beside them,
   * named, rather than standing in for the section (the rule the list's own
   * population takes, admin-window/BUG-0135). Nothing here was covered until
   * the QA pass on admin-window/BUG-0163: this leg is the section's only
   * read whose failure could take a healthy gauge down.
   */
  it("keeps the gauge on screen when its population count refuses, and names the refusal", async () => {
    const refusingCount: Script = {
      ...healthyScript(),
      // Healthy for every read of the view EXCEPT the windowed count — the one
      // carrying the window's lower bound (admin-window/BUG-0163).
      [T.pendingClaims]: (call: RecordedCall) =>
        call.steps.some(
          (step) => step.method === "gte" && step.args[0] === "observed_at",
        ) && isCountLeg(call)
          ? { error: permissionDenied(T.pendingClaims) }
          : claimView(CLAIMS)(call),
    };

    for (const tab of ["buckets", "standing"]) {
      const markup = await renderClaims(refusingCount, { tab, domain: "idols" });
      const $ = cheerio.load(markup);
      // The gauge still states the window it read, narrowing and all.
      expect($('[data-surface="gauge"] [data-window]'), tab).toHaveLength(1);
      // The refusal is published, on its own surface, naming the object.
      const refusal = $('[data-surface="gauge_population"]');
      expect(refusal, tab).toHaveLength(1);
      expect(refusal.text(), tab).toContain(T.pendingClaims);
      // Non-vacuous: a healthy page publishes that surface never.
      expect(
        cheerio.load(await renderClaims(healthyScript(), { tab, domain: "idols" }))(
          '[data-surface="gauge_population"]',
        ),
        tab,
      ).toHaveLength(0);
    }
  });
});

/* ── the four states ─────────────────────────────────────────────────────── */

describe("absence and failure", () => {
  /**
   * **EXPECTED CHANGE, admin-window/BUG-0138.** `observations` used to be the
   * list's second leg — the view carried no age, so an absent `observations`
   * took the whole list down with it. The view carries the instant now, so the
   * only leg that reads that table is the tab's GAUGE: it names it, in its own
   * Section, and every claim still renders beside it.
   */
  it("names the gauge's own object when observations is absent, and still lists every claim", async () => {
    const markup = await renderClaims({
      [T.pendingClaims]: claimView(CLAIMS),
      [T.observations]: { error: tableNotInSchemaCache(T.observations) },
      [T.sources]: { data: [], count: 0 },
    });
    const $ = cheerio.load(markup);
    expect(claimIds(markup)).toEqual(oldestFirst(SHOWABLE));
    // The absence is reported, on the gauge's surface and nowhere else.
    expect($(`[data-not-provisioned="${T.observations}"]`)).toHaveLength(1);
    expect(
      $('[data-surface="gauge"]').find(`[data-not-provisioned="${T.observations}"]`),
    ).toHaveLength(1);
    expect($('[data-surface="claims"]').find("[data-not-provisioned]")).toHaveLength(0);
    // ...and every age is still on screen, from the view's own column.
    for (const claim of SHOWABLE) {
      if (OBSERVED_AT.has(claim.observation_id)) {
        expect(claimRow(markup, claim.observation_id).titles.length).toBeGreaterThan(0);
      }
    }
  });

  it("shows the database's own words when a read fails", async () => {
    const markup = await renderClaims({
      [T.pendingClaims]: { error: permissionDenied(T.pendingClaims) },
      [T.observations]: { data: [] },
      [T.sources]: { data: [] },
    });
    expect(markup).toContain("permission denied");
    // The line names WHICH read refused (admin-window/BUG-0016, TASK-0030).
    expect(markup).toContain(T.pendingClaims);
    expect(claimIds(markup)).toEqual([]);
  });

  it("drops the whole window line, not just its count, on a read it never made", async () => {
    // The stronger form the fix took, and the one `/runs` already pins
    // ("claims no window it never read", tests/offline/runs/page.test.ts): the
    // sentence claims a window of at most N rows "not the whole view", which
    // is a claim about a window nobody looked in when the read failed. The
    // count hook alone going absent would leave that sentence standing.
    for (const [label, script] of [
      [
        "refused",
        {
          [T.pendingClaims]: { error: permissionDenied(T.pendingClaims) },
          [T.observations]: { data: [] },
          [T.sources]: { data: [] },
        },
      ],
      [
        "transport",
        {
          [T.pendingClaims]: { error: transportFailure("bad port") },
          [T.observations]: { data: [] },
          [T.sources]: { data: [] },
        },
      ],
      [
        "absent",
        {
          [T.pendingClaims]: { error: tableNotInSchemaCache(T.pendingClaims) },
          [T.observations]: { error: tableNotInSchemaCache(T.observations) },
          [T.sources]: { data: [] },
        },
      ],
    ] as const) {
      const markup = await renderClaims(script);
      expect(cheerio.load(markup)('[data-window="claims"]'), label).toHaveLength(0);
      // The refusal itself is still on screen: the line went, the state did not.
      expect(markup, label).toContain(T.pendingClaims);
    }
    // ... and a read that DID happen still states its window, on both tabs.
    for (const tab of ["buckets", "standing"]) {
      const read = await renderClaims(healthyScript(), { tab });
      expect(cheerio.load(read)('[data-window="claims"]'), tab).toHaveLength(1);
    }
  });

  it("keeps the transport failure's cause, which the message alone does not carry", async () => {
    const markup = await renderClaims({
      [T.pendingClaims]: { error: transportFailure("bad port") },
      [T.observations]: { data: [] },
      [T.sources]: { data: [] },
    });
    expect(markup).toContain("bad port");
  });

  it("renders an empty view as empty, with every bucket a real zero", async () => {
    const markup = await renderClaims({
      [T.pendingClaims]: { data: [], count: 0 },
      [T.observations]: { data: [] },
      [T.sources]: { data: [] },
    });
    expect(claimIds(markup)).toEqual([]);
    // The bucket table still stands, because the view exists and holds nothing
    // — a different state from "the view is not in this database".
    expect(bucketRows(markup).map((row) => row.claims)).toEqual(
      RENDERED_BUCKETS.map(() => 0),
    );
    expect(markup).not.toContain(T.pendingClaims);
    // The list itself is a card, not a headers-only table.
    expect(cheerio.load(markup)('table[aria-label="All claims"]')).toHaveLength(0);
  });

  it("renders the gauge's own state when its window cannot be read", async () => {
    const markup = await renderClaims({
      [T.pendingClaims]: claimView(CLAIMS),
      // The list's own read answers; the gauge's window read over
      // `observations` is the one that refuses, and it says so without taking
      // the list down with it.
      [T.observations]: { error: permissionDenied(T.observations) },
      [T.sources]: { data: [], count: 0 },
    });
    expect(claimIds(markup)).toEqual(oldestFirst(SHOWABLE));
    expect(markup).toContain("permission denied");
  });

  /**
   * A sentence about counts stands only where the counts do — the bucket
   * table's caption, over a read that refused (admin-window/BUG-0144, QA on
   * admin-window/DEBT-0008).
   *
   * The list one Section down already has this rule: its window line follows
   * the READ and not the rows, so a refused read publishes no line at all
   * ("drops the whole window line, not just its count, on a read it never
   * made", above; ARCHITECTURE.md §4.3, admin-window/BUG-0063,
   * admin-window/BUG-0070). The caption below the bucket table makes the same
   * kind of claim — what the figures in that table are figures OF — and it was
   * rendered for every `kind` but `not_provisioned`, so it stood over an error
   * card with no bucket row and no count hook beneath it, telling the operator
   * the table lists every bucket with every claim in it. Worse under a facet:
   * a refusal empties both sides of the narrowing comparison, so the arm that
   * rendered was the UNNARROWED one, whose "nothing above narrows these
   * counts" denies a facet the same page shows as applied.
   *
   * Both directions are pinned, because a gate that deleted the caption
   * outright would satisfy the second alone: every state whose read RETURNED
   * still carries it (rows, and an empty view — an empty read is still a
   * read), and every state whose read did not — permission denied, a transport
   * failure, the view outgrowing ROW_CAP, and the view absent — carries
   * neither arm, with the refusal card and the table's own state line
   * untouched.
   *
   * Copy-independent: both arms are read off the app itself, from a healthy
   * render of each, rather than typed here — this file pins no sentence of the
   * page, and a rewording of either arm moves this test with it.
   *
   * Non-vacuous in three directions: the refused render really is in its
   * refused state (it carries that state hook and names the object), it really
   * drew no counts, and the page really applied the facet in the second URL
   * (no dropped-parameters line), so the sentence is not being denied a
   * parameter the page threw away.
   */
  it("says nothing about bucket counts a refused read never produced [admin-window/BUG-0144]", async () => {
    /** Every paragraph the Buckets surface renders, in order. */
    const bucketParagraphs = (markup: string): string[] => {
      const $ = cheerio.load(markup);
      return $('[data-surface="buckets"] p')
        .toArray()
        .map((element) => $(element).text().replace(/\s+/g, " ").trim());
    };
    const bucketState = (markup: string): string | undefined =>
      cheerio.load(markup)('[data-surface="buckets"] [data-state]').attr("data-state");

    // The THREE sentences the page owns, read off the app rather than typed
    // here: the arm it renders when nothing narrows the counts, the arm it
    // renders when something does, and the arm it renders where a BUCKET
    // facet is in force — the facet this table drops, so it narrows nothing
    // here and the caption says what the table answers for instead
    // (architect ruling 2026-09-11, admin-window/TASK-0071). The third arm is
    // read off the app exactly as the other two are.
    const whole = bucketCaption(await renderClaims(healthyScript()));
    const narrowed = bucketCaption(
      await renderClaims(healthyScript(), { source_id: SOURCE.first }),
    );
    const everyBucket = bucketCaption(
      await renderClaims(healthyScript(), { bucket: "escalated" }),
    );
    const arms = [whole, narrowed, everyBucket];
    expect(whole).not.toBe("");
    expect(narrowed).not.toBe("");
    expect(everyBucket).not.toBe("");
    expect(new Set(arms).size).toBe(arms.length);

    // ── the read HAPPENED: the caption stands, on both arms ──────────────
    const emptyView: Script = {
      [T.pendingClaims]: { data: [], count: 0 },
      [T.observations]: { data: [] },
      [T.sources]: { data: [...REGISTRY], count: REGISTRY.length },
    };
    for (const [label, script, params] of [
      ["rows, bare", healthyScript(), {}],
      ["rows, source facet", healthyScript(), { source_id: SOURCE.first }],
      ["rows, bucket facet", healthyScript(), { bucket: "escalated" }],
      // An empty view is a read that returned: it drew a real zero for every
      // bucket, so the sentence saying what those zeros are zeros OF is true.
      ["empty view, bare", emptyView, {}],
      ["empty view, bucket facet", emptyView, { bucket: "escalated" }],
    ] as [string, Script, Record<string, string>][]) {
      const markup = await renderClaims(script, params);
      const said = bucketCaption(markup);
      expect(arms, label).toContain(said);
      // Non-vacuous: this really is the healthy surface — no refusal card, and
      // a table that drew a count hook per bucket for the sentence to be about.
      expect(bucketState(markup), label).toBeUndefined();
      expect(
        cheerio.load(markup)("[data-bucket-claims]").length,
        label,
      ).toBe(RENDERED_BUCKETS.length);
    }

    // ── the read did NOT happen: neither arm, in any state or URL ─────────
    const refusals: [string, string, Script][] = [
      [
        "permission denied",
        "error",
        {
          [T.pendingClaims]: { error: permissionDenied(T.pendingClaims) },
          [T.observations]: { data: [] },
          [T.sources]: { data: [...REGISTRY], count: REGISTRY.length },
        },
      ],
      [
        "transport failure",
        "error",
        {
          [T.pendingClaims]: { error: transportFailure("bad port") },
          [T.observations]: { data: [] },
          [T.sources]: { data: [...REGISTRY], count: REGISTRY.length },
        },
      ],
      [
        // A count the database did not GIVE — exactly what a select written
        // without `{ count: "exact" }` comes back with — is a
        // refusal and never a zero (ARCHITECTURE.md §4.3, common violations
        // row 2). The rows it did return are not a count either, so no
        // sentence stands over them. This replaces the truncated-complete-read
        // case admin-window/BUG-0138 retired: no read this page makes can
        // reach `ROW_CAP` any more.
        "no count at all",
        "error",
        {
          [T.pendingClaims]: { data: null, count: null, error: null },
          [T.observations]: { data: [...OBSERVATIONS] },
          [T.sources]: { data: [...REGISTRY], count: REGISTRY.length },
        },
      ],
      [
        // The card already replaces the whole surface here; this pins that it
        // stays that way.
        "view absent",
        "not_provisioned",
        {
          [T.pendingClaims]: { error: tableNotInSchemaCache(T.pendingClaims) },
          [T.observations]: { data: [] },
          [T.sources]: { data: [...REGISTRY], count: REGISTRY.length },
        },
      ],
    ];
    for (const [state, hook, script] of refusals) {
      for (const params of [{}, { bucket: "escalated" }] as Record<string, string>[]) {
        const markup = await renderClaims(script, params);
        const label = `${state} ${JSON.stringify(params)}`;
        // Non-vacuous: the surface really is in its refused state, and it drew
        // no bucket row and no count hook for either sentence to be about.
        expect(markup, label).toContain(T.pendingClaims);
        expect(bucketState(markup), label).toBe(hook);
        expect(bucketRows(markup), label).toEqual([]);
        expect(
          cheerio.load(markup)("[data-bucket-claims]").length,
          label,
        ).toBe(0);
        // ...and the page applied every parameter the URL carried, so the
        // sentence below is not being denied a facet the page dropped.
        expect(droppedLine(markup).lines, label).toBe(0);
        // Neither arm, anywhere in the surface — not as the paragraph below
        // the table, and not moved somewhere else inside it.
        const said = bucketParagraphs(markup);
        for (const arm of arms) expect(said, `${label} / ${arm}`).not.toContain(arm);
      }
    }
  });
});

/**
 * QA's pins on the same caption (admin-window/BUG-0144), on the two clauses
 * the fix's own pin grades only as "one of the two arms":
 *
 * 1. **Which arm a bucket facet takes.** The criterion says the UNNARROWED
 *    arm stands "over a facet that removes no row of that table", and the
 *    bucket facet is exactly that facet — `bucketStats` drops it on purpose,
 *    so `?bucket=escalated` removes not one row of this table. A regression
 *    that decided the arm from the URL again (`hasNarrowingFacet`, what
 *    admin-window/DEBT-0008 replaced) still puts one of the two arms on the
 *    page and passes a membership check; it fails this one, on every bucket.
 * 2. **A source or domain facet the WHOLE VIEW carries.** The caption's own
 *    contract (`BUCKET_CAPTION`'s docstring, "a source or domain the whole
 *    view carries anyway does not [narrow] — so the unnarrowed arm is what
 *    stands") is the row fact, never the chip. Over a view whose every claim
 *    carries the facet's value, the chip is active, the page dropped nothing,
 *    and the figures are identical to the bare page's — so the sentence that
 *    blames the filters above would be false.
 *
 * Copy-independent throughout: every expectation is the BARE page's own
 * caption, read off the app, never a sentence typed here.
 */
describe("which arm the bucket caption takes", () => {
  it("does not blame the bucket facet, which removes no row of that table", async () => {
    const bare = await renderClaims(healthyScript());
    const bareCaption = bucketCaption(bare);
    const bareCounts = bucketRows(bare).map((row) => row.claims);
    expect(bareCaption).not.toBe("");
    expect(bareCounts.reduce((total, held) => total + held, 0)).toBeGreaterThan(0);

    // The BLAMING arm, read off the app: the sentence `?source_id=` takes over
    // a view it really narrows. Never typed here — a literal would pass while
    // the page said something else (admin-window/TASK-0071).
    const blaming = bucketCaption(
      await renderClaims(healthyScript(), { source_id: SOURCE.first }),
    );
    expect(blaming).not.toBe(bareCaption);

    // The arm a bucket facet takes, read off the FIRST of the five renders
    // below; the other four are then graded against it, which is what says
    // the clause names no bucket value without this file typing the clause.
    let bucketArm: string | undefined;

    for (const bucket of RENDERED_BUCKETS) {
      const markup = await renderClaims(healthyScript(), { bucket });
      // The page really applied it: the chip is the current one and nothing
      // was reported dropped, so the sentence is not being spared a facet the
      // page threw away.
      expect(chipsOf(markup, "bucket").filter((chip) => chip.active), bucket).toHaveLength(1);
      expect(droppedLine(markup).lines, bucket).toBe(0);
      // ...and this table's figures did not move, so nothing above narrowed
      // these counts and the caption may not say otherwise.
      expect(bucketRows(markup).map((row) => row.claims), bucket).toEqual(bareCounts);

      // THE ARM RULE (architect ruling 2026-09-11, admin-window/TASK-0071),
      // which replaced byte-identity with the bare caption: this table stays
      // unnarrowed by its own facet AND says so, so the sentence is neither
      // the bare page's denial nor the blaming arm — and it is the SAME
      // sentence under every bucket, so no clause of it names the bucket.
      const said = bucketCaption(markup);
      expect(said, bucket).not.toBe(blaming);
      expect(said, bucket).not.toBe(bareCaption);
      expect(said, bucket).not.toContain(bucket);
      bucketArm ??= said;
      expect(said, bucket).toBe(bucketArm);
    }
  });

  it("blames a source or domain only when it removed a row of this table", async () => {
    /** The same view with every claim moved onto one value of `facet`. */
    const allOn = (facet: "source_id" | "domain", value: string): Script => {
      const rows = CLAIMS.map((claim) => ({ ...claim, [facet]: value }));
      return healthyScript({ [T.pendingClaims]: claimView(rows) });
    };

    for (const [facet, value] of [
      ["source_id", SOURCE.first],
      ["domain", "events"],
    ] as ["source_id" | "domain", string][]) {
      const script = allOn(facet, value);
      const bare = await renderClaims(script);
      const markup = await renderClaims(script, { [facet]: value });
      const label = `${facet}=${value}`;

      // Applied, and current: the facet that HAS a chip row shows it as the
      // active one, and neither facet is reported as dropped — `domain` has no
      // chip row since admin-window/BUG-0138 and narrows all the same.
      if (facet === "source_id") {
        expect(chipsOf(markup, facet).filter((chip) => chip.active), label).toHaveLength(1);
      } else {
        expect(chipsOf(markup, facet), label).toEqual([]);
      }
      expect(droppedLine(markup).lines, label).toBe(0);
      // It removed nothing, so the caption is the bare page's.
      expect(bucketRows(markup).map((row) => row.claims), label).toEqual(
        bucketRows(bare).map((row) => row.claims),
      );
      expect(bucketCaption(markup), label).toBe(bucketCaption(bare));
    }

    // Non-vacuous, the other direction: over the real population the same
    // shape of facet DOES remove rows, and there the caption moves.
    const plain = await renderClaims(healthyScript());
    const removed = await renderClaims(healthyScript(), { source_id: SOURCE.first });
    expect(bucketRows(removed).map((row) => row.claims)).not.toEqual(
      bucketRows(plain).map((row) => row.claims),
    );
    expect(bucketCaption(removed)).not.toBe(bucketCaption(plain));
  });
});

/* ── an empty surface is explained from TWO facts (DEBT-0008) ────────────── */

/**
 * "Nothing here yet" and "nothing matched" never share a rendering, and the
 * URL alone cannot tell them apart (ARCHITECTURE.md §4.3, promoted at the M2
 * structure walk; admin-window/BUG-0133's rule, admin-window/DEBT-0008 for
 * this page).
 *
 * This page decided the arm from `hasNarrowingFacet(filter)` (then named
 * `isNarrowed`) — the URL and nothing
 * else — so a facet over a tab holding zero claims said "no claims matched
 * these filters" and pointed the operator at a filter that had removed
 * nothing. The ledger records staging holding 0 standing disagreements, which
 * is exactly that state.
 *
 * The second fact is the SURFACE'S OWN POPULATION, and the two surfaces here
 * hold different sets: the list's is the tab's (the standing tab is one
 * bucket's subset), the bucket table's is the whole view (that table drops the
 * bucket facet on purpose). Both come out of the complete read the page
 * already makes, so neither costs a query.
 *
 * **Copy-independent, and two fixtures per claim** (LESSONS 8): each case
 * renders the same shape of URL against a population the facet emptied and one
 * it never touched, and compares the surface with its own UNFACETED rendering
 * rather than with a sentence typed here. A page whose narrowing arm was
 * deleted outright fails the first and last cases below.
 */
describe("which emptiness this is", () => {
  const emptyHook = (markup: string): string | undefined =>
    cheerio.load(markup)('[data-surface="claims"] [data-empty]').attr("data-empty");

  const emptyCard = (markup: string): string =>
    cheerio
      .load(markup)('[data-surface="claims"] [data-empty]')
      .text()
      .replace(/\s+/g, " ")
      .trim();

  const listLine = (markup: string): string =>
    cheerio.load(markup)('[data-window="claims"]').text().replace(/\s+/g, " ").trim();

  /** The same view with one bucket's claims removed entirely. */
  function withoutBucket(bucket: string): Script {
    const kept = CLAIMS.filter((claim) => claim.bucket !== bucket);
    return {
      [T.pendingClaims]: claimView(kept),
      [T.observations]: { data: [...OBSERVATIONS] },
      [T.sources]: { data: [...REGISTRY], count: REGISTRY.length },
    };
  }

  /** A view holding no claims at all, over a registry that still answers. */
  function noClaims(): Script {
    return {
      [T.pendingClaims]: { data: [], count: 0 },
      [T.observations]: { data: [] },
      [T.sources]: { data: [...REGISTRY], count: REGISTRY.length },
    };
  }

  it("blames no facet when the tab holds nothing for it to remove", async () => {
    // The same shape of URL over a view with NO standing disagreements: the
    // source facet removed not one row, because there was none to remove.
    const script = withoutBucket(STANDING_BUCKET);
    const narrowed = await renderClaims(script, {
      tab: "standing",
      source_id: SOURCE.first,
    });
    const bare = await renderClaims(script, { tab: "standing" });

    expect(claimIds(narrowed)).toEqual([]);
    expect(claimIds(bare)).toEqual([]);
    expect(emptyHook(narrowed)).not.toBe("narrowing");
    // …and it says exactly what the unfaceted tab says, which is the whole
    // claim: the facet changed nothing, so it explains nothing.
    expect(emptyHook(narrowed)).toBe(emptyHook(bare));
    expect(emptyCard(narrowed)).toBe(emptyCard(bare));
    // The card and the window line beside it describe ONE set, so the line
    // may not claim a narrowing the card refuses to blame.
    expect(listLine(narrowed)).toBe(listLine(bare));
    // Non-vacuous: the fixture still holds claims, so what is empty here is
    // the TAB's population and not the database.
    expect(claimIds(await renderClaims(script)).length).toBeGreaterThan(0);
  });

  it("blames no facet when the whole view holds nothing", async () => {
    // A bucket is the one facet a hand-typed URL can still apply over an empty
    // view: its vocabulary is the app's `RENDERABLE_BUCKETS`, not the rows'.
    const narrowed = await renderClaims(noClaims(), { bucket: "escalated" });
    const bare = await renderClaims(noClaims());

    expect(claimIds(narrowed)).toEqual([]);
    expect(emptyHook(narrowed)).not.toBe("narrowing");
    expect(emptyCard(narrowed)).toBe(emptyCard(bare));
    // The bucket table's caption is this page's other sentence about the same
    // question, and it blames nothing either: the arm rule, not byte-identity
    // with the bare caption (architect ruling 2026-09-11,
    // admin-window/TASK-0071). A bucket facet over an empty view still leaves
    // this table answering for every bucket, so the caption says that and
    // never takes the arm `?source_id=` takes over a view it really narrows.
    const blaming = bucketCaption(
      await renderClaims(healthyScript(), { source_id: SOURCE.first }),
    );
    expect(blaming).not.toBe(bucketCaption(await renderClaims(healthyScript())));
    expect(bucketCaption(narrowed)).not.toBe(blaming);
    expect(bucketCaption(narrowed)).not.toContain("escalated");
    // Every bucket row is still a real zero, so the surface saying "nothing
    // here yet" is still showing what would fill it.
    expect(bucketRows(narrowed).map((row) => row.claims)).toEqual(
      RENDERED_BUCKETS.map(() => 0),
    );
  });

  /* ── the same rule, over the GAUGE's set (admin-window/BUG-0163) ──────── */

  /**
   * The gauge section's set is a WINDOW, not the whole view, so it answers the
   * two-fact question with a population of its own: the claims this tab holds
   * INSIDE the gauge's window, with no facet at all.
   *
   * Two fixtures per claim (LESSONS 8): a facet that really emptied the
   * window, and a window that is empty whatever the URL says — which is the
   * case the page's existing whole-view population would get wrong, since that
   * count knows nothing about the window's lower bound.
   */
  const gaugeCard = (markup: string): string =>
    cheerio
      .load(markup)('[data-surface="gauge"] [data-state="empty"]')
      .text()
      .replace(/\s+/g, " ")
      .trim();

  /** A database whose view holds claims and whose gauge WINDOW holds none. */
  function emptyWindow(): Script {
    return {
      // The windowed count is the one read carrying `gte` on the instant, so
      // this answers the two questions the page asks of the view separately:
      // the whole view still holds every claim, and the window holds none.
      [T.pendingClaims]: (call: RecordedCall) =>
        call.steps.some(
          (step) => step.method === "gte" && step.args[0] === "observed_at",
        )
          ? { data: [], count: 0 }
          : claimView(CLAIMS)(call),
      [T.observations]: { data: [] },
      [T.sources]: { data: [...REGISTRY], count: REGISTRY.length },
    };
  }

  it("blames no facet on the gauge card when the window is empty whatever the URL says", async () => {
    const script = emptyWindow();
    const narrowed = await renderClaims(script, { domain: "idols" });
    const bare = await renderClaims(script);

    expect(gaugeCard(bare)).not.toBe("");
    // The facet removed nothing from a window that holds nothing, so the card
    // says exactly what the unfaceted page says.
    expect(gaugeCard(narrowed)).toBe(gaugeCard(bare));
    expect(gaugeCard(narrowed)).not.toContain("idols");
    expect(gaugeCard(narrowed)).not.toContain(CLEAR_LABEL);
    // …while the LIST, whose set is the whole view, blames the facet on the
    // same render: two surfaces, two populations, one rule (DEBT-0008). This
    // is also what makes the assertion above non-vacuous — the URL really did
    // narrow this page.
    expect(emptyHook(narrowed)).toBe("narrowing");
  });

  /* ── the same rule at the window's OTHER edge (admin-window/TASK-0070) ── */

  /**
   * A claim dated AFTER the instant the read was resolved at — clock skew at a
   * source, or a source dating ahead — is outside the window this section's
   * line prints, so it must be outside BOTH reads under that line: the scan,
   * and the population count printed beside it.
   *
   * The count had no upper bound at all (`readClaimCountSince`) while the scan
   * beside it was `[since, until]`, so this claim was counted in fact 2 and
   * rendered in nothing — and the section then blamed the URL's facet for a
   * zero the facet had not caused, which is the LESSONS 3 misattribution
   * BUG-0163 landed here to prevent, arriving through the other edge.
   *
   * The two fixtures differ in ONE character-for-character respect: the
   * claim's instant, on one side of `until` or the other (LESSONS 8).
   */
  const PAST = () => new Date(Date.now() - 86_400_000).toISOString();
  const AHEAD = () => new Date(Date.now() + 86_400_000).toISOString();

  /** A view holding exactly one claim, at the instant given, and no observation. */
  function oneClaimAt(observedAt: string): Script {
    return {
      [T.pendingClaims]: claimView([
        pendingClaimRow("standing_disagreement", {
          observation_id: "01920000-0000-7000-8000-0000000009f1",
          observed_at: observedAt,
        }),
      ]),
      [T.observations]: { data: [] },
      [T.sources]: { data: [...REGISTRY], count: REGISTRY.length },
    };
  }

  it("blames no facet on the gauge card when the one claim is dated after until", async () => {
    const script = oneClaimAt(AHEAD());
    const narrowed = await renderClaims(script, { domain: "idols" });
    const bare = await renderClaims(script);

    expect(gaugeCard(bare)).not.toBe("");
    // The claim is outside the window at its UPPER edge, so the gauge's
    // window holds nothing whatever the URL says — and the facet removed
    // nothing from it.
    expect(gaugeCard(narrowed)).toBe(gaugeCard(bare));
    expect(gaugeCard(narrowed)).not.toContain("idols");
    expect(gaugeCard(narrowed)).not.toContain(CLEAR_LABEL);
    // Non-vacuous, and the reason the old count got this wrong: the LIST's
    // population is the whole view with no time bound at all, so it DOES hold
    // that claim and the list's card blames the facet on the same render.
    expect(emptyHook(narrowed)).toBe("narrowing");
  });

  it("blames the facet on the gauge card when that same claim is inside the window", async () => {
    // The twin, differing only in the instant: now the window really does hold
    // a claim with no facet, and the facet really is what emptied the section.
    const script = oneClaimAt(PAST());
    const narrowed = await renderClaims(script, { domain: "idols" });
    const bare = await renderClaims(script);

    expect(gaugeCard(narrowed)).not.toBe(gaugeCard(bare));
    expect(gaugeCard(narrowed)).toContain("idols");
    expect(gaugeCard(narrowed)).toContain(CLEAR_LABEL);
  });

  it("takes the count's two edges from the window its line prints", async () => {
    // The relationship, at the read: the population count and the scan are
    // handed ONE bounds object, so the interval the count ran over is the
    // interval the line above it states — read off the rendered line and the
    // recorded query, never off a constant this test chose.
    const { markup, stub } = await renderWithStub(oneClaimAt(AHEAD()), {
      domain: "idols",
    });
    const line = cheerio.load(markup)('[data-window="pending"]');
    expect(line.length, "the gauge's window line").toBe(1);

    const counted = stub.calls.filter(
      (call) =>
        call.table === T.pendingClaims &&
        isCountLeg(call) &&
        call.steps.some((step) => step.method === "gte" && step.args[0] === "observed_at"),
    );
    expect(counted, "the gauge window's population count").toHaveLength(1);
    const edge = (method: string) =>
      counted[0].steps.find(
        (step) => step.method === method && step.args[0] === "observed_at",
      )?.args[1];

    expect(edge("gte")).toBe(line.attr("data-window-since"));
    expect(
      edge("lt"),
      "the line states an upper edge; the count printed under it must read to it",
    ).toBe(line.attr("data-window-until"));
    // And the scan beside it ran over the very same interval — one object, two
    // reads, never two intervals.
    const scan = stub.calls.find(
      (call) =>
        call.table === T.pendingClaims &&
        call.steps.some((step) => step.method === "limit") &&
        call.steps.some((step) => step.method === "gte" && step.args[0] === "observed_at"),
    );
    expect(scan, "the gauge's claims leg").toBeDefined();
    const scanEdge = (method: string) =>
      scan?.steps.find((step) => step.method === method && step.args[0] === "observed_at")
        ?.args[1];
    expect(scanEdge("gte")).toBe(edge("gte"));
    expect(scanEdge("lt")).toBe(edge("lt"));
  });
});

/* ── a narrowing with no control on screen (admin-window/BUG-0160) ───────── */

/**
 * `?domain=` narrows every figure on this page and the page renders no chip
 * row for it (`CHIP_FACETS`, admin-window/BUG-0138). Measured on staging at
 * `/claims?domain=events` (designer, 2026-09-10): the bucket table read
 * `awaiting_row` 741 against 769 unnarrowed, the gauge card 849 against 877,
 * the window line said "849 claims match these filters", the caption said the
 * counts were "under the filters above" — and both chip rows read `all`, with
 * the words "domain" and "events" nowhere in the rendered page.
 *
 * Two clauses were false in that state and one fact was missing, so this
 * grades three things at once (the ticket's criteria 1-4):
 *
 *  - the narrowing is NAMED — the facet and its value — in every state the
 *    narrowed arm renders: the filled window line, the window line that did
 *    not fill, and the "nothing matched" card;
 *  - "these filters" and "the filters above" appear only where a CHIP facet
 *    is set, and where both kinds are set the sentence is true of both;
 *  - the window line and the bucket caption agree, including the case that
 *    made the old caption honest and the old line dishonest — a domain the
 *    whole view carries anyway, which narrows nothing and is claimed by
 *    neither.
 *
 * The expectations are computed from the URL and the fixture, never from the
 * page's copy: what must appear is the value the URL carried and the facet's
 * own name, and what must not appear is the two phrases the ticket names.
 */
describe("a narrowing with no chip row", () => {
  const line = (markup: string) =>
    cheerio.load(markup)('[data-window="claims"]').text().replace(/\s+/g, " ").trim();
  const card = (markup: string) =>
    cheerio
      .load(markup)('[data-surface="claims"] [data-empty]')
      .text()
      .replace(/\s+/g, " ")
      .trim();





  /** The facet with no chip row, and a value the fixture population carries. */
  const NARROWING = "venues";

  /**
   * A SECOND pair, where the chip facet really removes rows — the state a
   * chip-clause derivation has to be read in since admin-window/BUG-0192.
   *
   * `NARROWING` is served by `SOURCE.first` ALONE in this fixture, so
   * `{source_id: SOURCE.first, domain: NARROWING}` draws exactly the rows
   * `{domain: NARROWING}` draws: the domain did all of it, and under the
   * attribution rule those renders carry NO chip clause at all. A derivation
   * that subtracted them would be subtracting two identical sentences and
   * would grade the rule vacuously (`expect(chipClause).not.toBe("")` is what
   * catches that). `SHARED_DOMAIN` is served by two sources, so
   * `PARTIAL_SOURCE` really removes rows of it and the clause is there to be
   * read off. Both figures are computed from the fixture below, never typed.
   */
  const SHARED_DOMAIN = "events";
  const PARTIAL_SOURCE = SOURCE.second;



  /*
   * "names the facet and its value in every state the narrowed arm renders" stood here until 2026-10-21.
   *
   * It read one of the explanatory captions Ben deleted on 2026-10-21 — the
   * bucket caption ("Every bucket the classification view can hold, with …"), the
   * Tier-drifts note, or the per-source `stuck_pattern` dial note. The figures and
   * identifiers those sentences wrapped are still on screen; the sentences are not.
   */

  /*
   * "says what the gauge says about a chip narrowing, in both directions" stood here until 2026-10-21.
   *
   * It read the GAUGE's window sentence: the scan arm's `measured`, `scope` and
   * `answersFor` phrases. Those props went with the sentence layer on 2026-10-21.
   * The narrowing itself still reaches the query and still draws its chips; what
   * is retired is the paragraph that described it.
   */

  /*
   * "adds the bucket clause and nothing else, whatever else narrowed the table" stood here until 2026-10-21.
   *
   * It read one of the explanatory captions Ben deleted on 2026-10-21 — the
   * bucket caption ("Every bucket the classification view can hold, with …"), the
   * Tier-drifts note, or the per-source `stuck_pattern` dial note. The figures and
   * identifiers those sentences wrapped are still on screen; the sentences are not.
   */

  /*
   * "points at the chip bar only where the chip bar removed rows of the surface saying so" stood here until 2026-10-21.
   *
   * It read one of the explanatory captions Ben deleted on 2026-10-21 — the
   * bucket caption ("Every bucket the classification view can hold, with …"), the
   * Tier-drifts note, or the per-source `stuck_pattern` dial note. The figures and
   * identifiers those sentences wrapped are still on screen; the sentences are not.
   */

  /**
   * THE THIRD SURFACE: the empty card, which points at the same chip bar and
   * is graded on the same rule (admin-window/BUG-0192).
   *
   * Both states are reached on the standing tab, where a domain facet really
   * can empty the list — and the tab's OWN bucket is not a control above, so
   * the widened count keeps it and the comparison stays inside this tab's set
   * (`withoutChipFacets`). The card's chip clause is the app's own exported
   * phrase, never typed here.
   */
  it("blames the chip bar for an empty list only where the chip bar emptied it", async () => {
    const standing = (params: Record<string, string>) =>
      matching({ ...params, bucket: STANDING_BUCKET });

    for (const [state, domain, claimsOne] of [
      ["a domain no standing claim carries at all", NARROWING, false],
      ["a domain a standing claim of ANOTHER source carries", "groups", true],
    ] as [string, string, boolean][]) {
      const params = { tab: "standing", source_id: SOURCE.first, domain };
      // Non-vacuous, from the fixture: the list really is empty in both
      // states, and the source is what emptied it in exactly one of them —
      // dropping the source leaves no standing claim in the first and a real
      // one in the second.
      expect(standing({ source_id: SOURCE.first, domain }), state).toHaveLength(0);
      expect(standing({ domain }).length > 0, state).toBe(claimsOne);

      const markup = await renderClaims(healthyScript(), params);
      expect(claimIds(markup), state).toEqual([]);
      // The card is the NARROWED one in both states — it names the domain the
      // read carried, which is the clause that states what the read did, not
      // what a control did.
      expect(card(markup), state).toContain(domain);
      // …and it points at the chip bar only where a chip emptied it.
      expect(card(markup).includes(NARROWED_BY_FILTERS), state).toBe(claimsOne);
    }
  });

  /**
   * WHAT THE ATTRIBUTION FACT COSTS, IN REQUESTS (LESSONS 10,
   * admin-window/DEBT-0012).
   *
   * The single state the two facts cannot answer is both families in force, so
   * that is the only state that buys a count — and it buys a bounded
   * `countRead` one, in the composition the page already awaits, never a
   * second round trip. The four states are graded by the SHAPE of every count
   * the page issued over the view: which facets it carried, and whether it
   * carried the gauge window's edges. A shape census rather than a total, so a
   * leg that moved from one question to another cannot pass as the same cost.
   */
  it("buys the attribution fact with one count per surface, and only where both families are in force", async () => {
    /** Every count over the view, as `kind:facets` — sorted, so the census is
     *  about which questions were asked and not their order. */
    const countShapes = (stub: StubClient): string[] =>
      stub.calls
        .filter((call) => call.table === T.pendingClaims && isCountLeg(call))
        .map((call) => {
          const windowed = call.steps.some(
            (step) => step.method === "gte" && step.args[0] === "observed_at",
          );
          const facets = call.steps
            .filter((step) => step.method === "eq")
            .map((step) => `${step.args[0]}=${step.args[1]}`)
            .sort();
          return `${windowed ? "window" : "view"}:${facets.join(",")}`;
        })
        .sort();

    /** The same spelling, for an expectation built from a filter. */
    const shape = (kind: "view" | "window", facets: Record<string, string>) =>
      `${kind}:${Object.entries(facets)
        .map(([facet, value]) => `${facet}=${value}`)
        .sort()
        .join(",")}`;

    const SOURCE_ONLY = { source_id: PARTIAL_SOURCE };
    const DOMAIN_ONLY = { domain: SHARED_DOMAIN };
    const BOTH = { ...SOURCE_ONLY, ...DOMAIN_ONLY };

    for (const [state, params, attribution] of [
      ["bare", {}, []],
      ["a chip facet alone", SOURCE_ONLY, []],
      ["an unchipped facet alone", DOMAIN_ONLY, []],
      // The one state the two facts cannot separate: one count for the list,
      // the caption and the empty card at once, and one for the gauge's
      // window. Both carry the domain — the family that is NOT being
      // subtracted — and neither carries the chip facet.
      ["both families", BOTH, [shape("view", DOMAIN_ONLY), shape("window", DOMAIN_ONLY)]],
    ] as [string, Record<string, string>, string[]][]) {
      const { stub } = await renderWithStub(healthyScript(), params);
      const narrowing = Object.keys(params).length > 0;
      const gaugeNarrowing = params.source_id !== undefined || params.domain !== undefined;
      expect(countShapes(stub), state).toEqual(
        [
          // The page's own counts: the matching total, one per bucket...
          shape("view", params),
          ...RENDERED_BUCKETS.map((bucket) => shape("view", { ...params, bucket })),
          // ...fact 2 for the list and the table, and fact 2 for the gauge's
          // window, each issued only where a facet can narrow that surface.
          ...(narrowing ? [shape("view", {})] : []),
          ...(gaugeNarrowing ? [shape("window", {})] : []),
          // ...and the attribution fact, in the one state that needs it.
          ...attribution,
        ].sort(),
      );
    }
  });

  /*
   * "is true of both kinds of narrowing when both are set" stood here until 2026-10-21.
   *
   * It read one of the explanatory captions Ben deleted on 2026-10-21 — the
   * bucket caption ("Every bucket the classification view can hold, with …"), the
   * Tier-drifts note, or the per-source `stuck_pattern` dial note. The figures and
   * identifiers those sentences wrapped are still on screen; the sentences are not.
   */

  it("claims nothing at all for a domain the whole view carries anyway", async () => {
    // The other direction, and the reason the fix is not "always name it":
    // `claimsNarrowed` takes TWO facts (admin-window/DEBT-0008), and a facet
    // that removed not one row shaped nothing. Both sentences say so by
    // being, to the byte, the sentences of the page with no facet at all.
    const oneDomain: Script = {
      [T.pendingClaims]: claimView(CLAIMS.filter((claim) => claim.domain === "events")),
      [T.observations]: {
        data: OBSERVATIONS.filter((row) => row.domain === "events"),
      },
      [T.sources]: { data: [...REGISTRY], count: REGISTRY.length },
    };
    const narrowed = await renderClaims(oneDomain, { domain: "events" });
    const bare = await renderClaims(oneDomain);

    // Non-vacuous: the page really applied the facet (nothing was dropped) and
    // really drew rows under it.
    expect(droppedLine(narrowed).lines).toBe(0);
    expect(claimIds(narrowed)).toEqual(claimIds(bare));
    expect(claimIds(narrowed).length).toBeGreaterThan(0);

    expect(line(narrowed)).toBe(line(bare));
    expect(bucketCaption(narrowed)).toBe(bucketCaption(bare));
  });

  /*
   * "says a chip narrowed the list in exactly the states a chip removed a row" stood here until 2026-10-21.
   *
   * It read one of the explanatory captions Ben deleted on 2026-10-21 — the
   * bucket caption ("Every bucket the classification view can hold, with …"), the
   * Tier-drifts note, or the per-source `stuck_pattern` dial note. The figures and
   * identifiers those sentences wrapped are still on screen; the sentences are not.
   */

  it("puts a space between the value and the words around it", async () => {
    // The rule the tree-wide scanner cannot see in this file's transform
    // (`tests/offline/ui/copy.test.ts`), asserted on the rendering it now
    // reaches: the value goes into prose inside the app's identifier box, so
    // the words before and after it must not be glued to the element.
    const markup = await renderClaims(healthyScript(), {
      domain: NARROWING,
      source_id: SOURCE.first,
    });
    expect(runTogetherWords(markup)).toEqual([]);
    expect(implicitInterElementSpaces("src/app/claims/page.tsx")).toEqual([]);
  });
});

/* ── the way out of a narrowing (admin-window/BUG-0161) ──────────────────── */

/**
 * **The exit the empty card names works** — admin-window/BUG-0161.
 *
 * Measured on staging at `/claims?domain=zzz` (designer, 2026-09-10): all five
 * bucket rows read `0`, the window line said the read found nothing, and the
 * empty card said "Widen a filter above; the 'all' chip on any row shows
 * everything again" — while every anchor on the page carried `domain=zzz`
 * forward, both `all` chips included:
 *
 *     all (bucket)     -> /claims?domain=zzz
 *     all (source_id)  -> /claims?domain=zzz
 *
 * So the one action the card named returned the operator to the same zeroed
 * page, and the only exits left were the sidebar and the address bar.
 *
 * The property graded here is the ticket's human-check, run as a test: from a
 * narrowed-empty page, follow ONLY the control the card names, and arrive
 * somewhere that renders claims. It is graded by FOLLOWING the href the page
 * wrote — rendering the page again at it — rather than by comparing it against
 * a URL spelled here, so a page that keeps a facet in that href fails even
 * where the string looks right.
 */
describe("the way out of a narrowing", () => {
  const card = (markup: string): string =>
    cheerio
      .load(markup)('[data-surface="claims"] [data-empty]')
      .text()
      .replace(/\s+/g, " ")
      .trim();

  const emptyHook = (markup: string): string | undefined =>
    cheerio.load(markup)('[data-surface="claims"] [data-empty]').attr("data-empty");

  /** The exit control the filter bar draws, or `undefined` where it draws none. */
  function exitOf(markup: string): { label: string; href: string } | undefined {
    const anchor = cheerio.load(markup)("[data-clear-narrowing] a");
    if (anchor.length === 0) return undefined;
    return { label: anchor.text().trim(), href: anchor.attr("href") ?? "" };
  }

  /** The same, insisting there is one — so a missing exit names its own state. */
  function theExit(markup: string, state: string): { label: string; href: string } {
    const exit = exitOf(markup);
    if (exit === undefined) throw new Error(`no exit is drawn on ${state}`);
    return exit;
  }

  /**
   * The search params of an HREF the page wrote, as a page takes them.
   *
   * Local to this describe on purpose: the module-level `paramsOf` further
   * down takes a bare QUERY STRING, and handing it an href makes `/claims`
   * itself the first parameter name ({"/claims": ""}) — which is what an
   * accidental removal of this helper produced on 2026-10-21, turning an
   * assertion that the exit carries NO parameters into one that passed only
   * for the wrong reason. Two readings, one word; kept apart deliberately.
   */
  const hrefParams = (href: string): Record<string, string> =>
    Object.fromEntries(new URLSearchParams(href.split("?")[1] ?? ""));

  /**
   * Every URL below empties this page's list through a narrowing it applied —
   * the ticket's own `?domain=zzz`, the same with a chip facet set beside it,
   * a pair of real vocabulary values that share no claim, and the control-less
   * facet on the other tab.
   */
  const DEAD_ENDS: ReadonlyArray<readonly [string, Record<string, string>]> = [
    ["the facet with no chip row, alone", { domain: "zzz" }],
    ["that facet beside a chip facet", { domain: "zzz", source_id: SOURCE.first }],
    ["two real values that share no claim", { bucket: "escalated", domain: "groups" }],
    ["the standing tab, narrowed away", { tab: "standing", domain: "venues" }],
  ];

  it.each(DEAD_ENDS)("is on the screen when %s emptied the page", async (state, params) => {
    const markup = await renderClaims(healthyScript(), params);
    // Non-vacuous: this really is the zeroed page, blamed on the narrowing.
    expect(claimIds(markup), state).toEqual([]);
    expect(emptyHook(markup), state).toBe("narrowing");

    // Criterion 1: the card names the control, in the control's own word.
    const exit = theExit(markup, state);
    expect(card(markup), state).toContain(exit.label);

    // ...and following it — clicking only what the card named — arrives at a
    // page that renders claims, with nothing left to clear.
    const arrived = await renderClaims(healthyScript(), hrefParams(exit.href));
    expect(claimIds(arrived).length, state).toBeGreaterThan(0);
    expect(exitOf(arrived), state).toBeUndefined();
  });

  it("draws no exit where the URL narrowed nothing", async () => {
    // A control that clears nothing is a control that lies (LOOK_AND_FEEL bar
    // 13), so the row is absent from the unnarrowed page on both tabs — and
    // from a page carrying a parameter this one never applied, which the
    // dropped-parameter line explains instead.
    const UNNARROWED: ReadonlyArray<Record<string, string>> = [
      {},
      { tab: "standing" },
      { domain: "  " },
      { nonsense: "1" },
    ];
    for (const params of UNNARROWED) {
      const markup = await renderClaims(healthyScript(), params);
      expect(exitOf(markup), JSON.stringify(params)).toBeUndefined();
    }
  });

  it("leaves the chip rows doing exactly the job they did", async () => {
    // Criterion 3. The exit is a row of its own; it takes nothing away from
    // the chips, whose `all` still means "this facet, unset" and still
    // composes with the other facet.
    const markup = await renderClaims(healthyScript(), {
      domain: "zzz",
      source_id: SOURCE.first,
    });
    for (const facet of ["bucket", "source_id"]) {
      const chips = chipsOf(markup, facet);
      expect(chips.length, facet).toBeGreaterThan(1);
      expect(chips[0].label, facet).toBe(ANY_LABEL);
      // "this facet, unset" — the other facets are carried, the control-less
      // one included, which is why an `all` chip can never be the exit.
      expect(chips[0].href, facet).not.toContain(`${facet}=`);
      expect(chips[0].href, facet).toContain("domain=zzz");
      // ...and every OTHER narrowing is kept, which is the whole difference
      // between widening one row and taking the exit.
      if (facet !== "source_id") {
        expect(chips[0].href, facet).toContain(encodeURIComponent(SOURCE.first));
      }
    }
    // The exit is not a facet, so it renders no facet group and sets no
    // parameter of its own...
    expect(cheerio.load(markup)("[data-clear-narrowing] [data-facet]")).toHaveLength(0);
    expect(hrefParams(theExit(markup, "both facets set").href)).toEqual({});
    // ...and the parked bucket is still nowhere on the page or in its hrefs.
    expect(markup).not.toContain(UNRENDERABLE_BUCKET);
  });

  /**
   * Criterion 2's other half, which the cases above cannot reach: a narrowing
   * with no chip row is un-clearable in EVERY state it reaches, not only the
   * one where it emptied the list. `?domain=` over a domain the view does
   * carry still draws rows, still moves every figure on the page, and still
   * has nothing on screen that drops it — measured on staging 2026-09-10
   * against this landed tree, `/claims?domain=events`: 50 rows, gauge 849
   * against 877 unnarrowed, and one exit whose href is the bare path.
   *
   * Graded from the rows the page drew rather than from the URL, so a page
   * that hid the exit whenever the read came back non-empty fails here.
   */
  it("is on the screen while the narrowing still leaves rows to draw", async () => {
    const markup = await renderClaims(healthyScript(), { domain: "events" });
    // Non-vacuous: this narrowing removed claims without emptying the list.
    const narrowed = claimIds(markup);
    const all = claimIds(await renderClaims(healthyScript(), {}));
    expect(narrowed.length).toBeGreaterThan(0);
    expect(narrowed.length).toBeLessThan(all.length);

    // No empty card to name it, so the bar is the only place it can be...
    expect(emptyHook(markup)).toBeUndefined();
    const exit = theExit(markup, "?domain=events with rows drawn");
    // ...and it still drops the facet no chip row carries.
    expect(hrefParams(exit.href)).toEqual({});
    const arrived = await renderClaims(healthyScript(), hrefParams(exit.href));
    expect(claimIds(arrived)).toEqual(all);
  });

  it("says nothing about an exit where no filter is what emptied the page", async () => {
    // Criterion 4, from the other side: with the tab's own population empty,
    // no facet removed a row, so the card is the "nothing here yet" one and
    // names no way out — it is not a narrowing that has to be undone.
    const script: Script = {
      [T.pendingClaims]: claimView(CLAIMS.filter((claim) => claim.bucket !== STANDING_BUCKET)),
      [T.observations]: { data: [...OBSERVATIONS] },
      [T.sources]: { data: [...REGISTRY], count: REGISTRY.length },
    };
    const markup = await renderClaims(script, { tab: "standing", domain: "events" });
    const bare = await renderClaims(script, { tab: "standing" });

    expect(claimIds(markup)).toEqual([]);
    expect(emptyHook(markup)).not.toBe("narrowing");
    // The card is word for word the unfaceted tab's card: it blames nothing,
    // so it offers to undo nothing.
    expect(card(markup)).toBe(card(bare));
    expect(card(markup)).not.toContain(theExit(markup, "?tab=standing&domain=events").label);
  });
});

/* ── what a filled window promises (admin-window/BUG-0162) ───────────────── */

/**
 * **A filled window names no remedy this page cannot perform** —
 * admin-window/BUG-0162.
 *
 * Measured on staging (designer, 2026-09-10): the line ended every filled
 * window by telling the operator to narrow with the filters above to get at
 * the rest, and no state of the two chip rows gets there. The list is a hard
 * `CLAIM_WINDOW` window since admin-window/BUG-0138, so narrowing reveals a
 * row past the last one only where it takes the matching count BELOW the cap —
 * and the narrowest state on offer still held 108 claims against the same 50
 * rows (877 unnarrowed, 769 / 108 by bucket, unchanged by the one source that
 * holds any claim).
 *
 * The premise is graded here rather than asserted: the first case walks EVERY
 * chip state the page draws, over a population every one of them leaves above
 * the cap, and reads the window's own truncation hook in each — so this is a
 * fixture in which "narrow to reach the rest" is false at every combination,
 * and the second case reads what the line says in exactly those states.
 *
 * The states are reached by FOLLOWING the chips' own hrefs, not by spelling
 * facets here, so a page that adds a third chip row is walked by this test
 * without it being edited.
 */
describe("what a filled window promises", () => {
  const line = (markup: string): string =>
    cheerio.load(markup)('[data-window="claims"]').text().replace(/\s+/g, " ").trim();

  /** Did the window say it filled its cap? Structurally, from its own hook. */
  const filledItsCap = (markup: string): boolean =>
    cheerio.load(markup)('[data-window="claims"]').attr("data-window-truncated") ===
    "true";


  /**
   * A population that leaves EVERY chip combination above the cap: every
   * rendered bucket, under every registered source, holds more claims than one
   * window can draw. That is the staging shape — no facet the page offers
   * takes the count under 50 — and it is what makes the promise false rather
   * than merely unhelpful.
   */
  function overflowingEverywhere(): Script {
    const claims: PendingClaimRow[] = [];
    const observations: ReturnType<typeof observationRow>[] = [];
    let index = 0;
    for (const bucket of RENDERED_BUCKETS) {
      for (const source of REGISTRY) {
        for (let n = 0; n < CLAIM_WINDOW + 3; n += 1) {
          const observedAt = new Date(
            Date.UTC(2026, 0, 1) + index * 60_000,
          ).toISOString();
          const claim = pendingClaimRow(bucket as PendingClaimBucket, {
            observation_id: `01920000-0000-7000-8000-${(700000 + index)
              .toString()
              .padStart(12, "0")}`,
            // Two domains, so `?domain=` is a narrowing that really removes
            // rows here — the state the shared clause could not be said in.
            domain: index % 4 === 0 ? "groups" : "events",
            field: "name",
            source_id: source.source_id,
            observed_at: observedAt,
          });
          claims.push(claim);
          observations.push(
            observationRow({
              observation_id: claim.observation_id,
              entity_id: claim.entity_id,
              domain: claim.domain,
              field: claim.field,
              source_id: claim.source_id,
              observed_at: observedAt,
              status: "pending",
            }),
          );
          index += 1;
        }
      }
    }
    return {
      [T.pendingClaims]: claimView(claims),
      [T.observations]: { data: observations },
      [T.sources]: { data: [...REGISTRY], count: REGISTRY.length },
    };
  }


  /*
   * "says what it is not showing and offers no way to it" stood here until 2026-10-21.
   *
   * It read the claim list's window SENTENCE. Ben deleted every window-line
   * sentence in the app on 2026-10-21, so the line publishes its facts as
   * `data-window-*` hooks and says nothing at all. The read's honesty is still
   * graded — limit, held, truncated, from, drawn and oldest are each pinned in
   * `tests/offline/ui/primitives.test.ts`, and the cases still passing in this
   * very describe grade them on this page — but the English this case asserted
   * no longer exists.
   */

  it("says the same of a state no chip can undo", async () => {
    // The control-less facet, which admin-window/BUG-0160 gave its own wording
    // of the same promise: it is not a special case any more, because the
    // sentence no longer names a control in either arm.
    const script = overflowingEverywhere();
    const domained = await renderClaims(script, { domain: "events" });
    expect(filledItsCap(domained)).toBe(true);
    for (const remedy of ["narrow", "Narrow", "reach", "widen", "Widen"]) {
      expect(line(domained), remedy).not.toContain(remedy);
    }
  });
});

/* ── the filter bar ──────────────────────────────────────────────────────── */

describe("the filters", () => {
  /**
   * **EXPECTED CHANGE, admin-window/BUG-0138 (Ben's A2, 2026-09-10).**
   *
   * The source chip row's MEMBERSHIP is the REGISTRY's rows now, not the
   * distinct sources of the claim population — the page cannot read that
   * population any more, and the registry read it already makes runs
   * concurrently with everything else. So a registered source holding no claim
   * is a real chip (and a real zero when you narrow to it), and a source the
   * registry has no row for is not offered as a chip even where the view
   * carries its claims — its id still renders verbatim in every row, and
   * `?source_id=` still narrows by it.
   *
   * The DOMAIN chip row is gone: there is no bounded read of "the domains in
   * play" (`domain_target` is a function, not an enumerable registry).
   * `?domain=` narrows server-side, which its own pin covers.
   *
   * The spelling and the sort rule do not change: the registry's name, in the
   * order those names sort, with the id breaking the tie.
   */
  it("offers every REGISTERED source, 'all' first, and no domain chips at all", async () => {
    const markup = await renderClaims(healthyScript());
    expect(chipsOf(markup, "source_id").map((chip) => chip.label)).toEqual([
      "all",
      // The registry's rows, named, in the order those names sort — the same
      // facet `/sources` renders, reading the same way (admin-window/BUG-0043).
      ...REGISTRY.map((source) => source.source).sort(),
    ]);
    expect(chipsOf(markup, "domain")).toEqual([]);
    expect(cheerio.load(markup)('[data-facet="domain"]')).toHaveLength(0);
    // Not vacuous in either direction: the view carries a source the registry
    // does not name, and it is not a chip...
    expect(CLAIMS.some((claim) => !SOURCE_NAME.has(claim.source_id))).toBe(true);
    expect(chipsOf(markup, "source_id").map((chip) => chip.href).join(" ")).not.toContain(
      SOURCE.third,
    );
    // ...and the view carries domains, which no chip row offers.
    expect(new Set(CLAIMS.map((claim) => claim.domain)).size).toBeGreaterThan(1);
  });

  it("gives a registered source with no claim a real chip and a real zero", async () => {
    // The other half of that change, and the reason it is an improvement: a
    // source that has filed nothing is a fact about the registry, and the page
    // says so with a counted zero rather than by hiding the chip.
    const idle = REGISTRY[0].source_id;
    const markup = await renderClaims(
      healthyScript({
        [T.pendingClaims]: claimView(
          CLAIMS.filter((claim) => claim.source_id !== idle),
        ),
      }),
    );
    const chip = chipsOf(markup, "source_id").find(
      (candidate) => candidate.label === nameOf(idle),
    );
    expect(chip, `${nameOf(idle)} has no chip`).toBeDefined();

    const narrowed = await renderClaims(
      healthyScript({
        [T.pendingClaims]: claimView(
          CLAIMS.filter((claim) => claim.source_id !== idle),
        ),
      }),
      { source_id: idle },
    );
    expect(claimIds(narrowed)).toEqual([]);
    for (const row of bucketRows(narrowed)) expect(row.claims, row.bucket).toBe(0);
  });

  it("marks the chip the URL is on, and offers the others from there", async () => {
    const markup = await renderClaims(healthyScript(), {
      source_id: SOURCE.second,
      tab: "standing",
    });
    const chips = chipsOf(markup, "source_id");
    expect(chips.filter((chip) => chip.active).map((chip) => chip.label)).toEqual([
      nameOf(SOURCE.second),
    ]);
    // The chip SAYS the name and still narrows by the id.
    expect(chips.filter((chip) => chip.active).map((chip) => chip.href)).toEqual([
      expect.stringContaining(encodeURIComponent(SOURCE.second)),
    ]);
    // Every chip keeps the tab, so crossing a filter does not change the view.
    for (const chip of chips) expect(chip.href).toContain("tab=standing");
    // The bucket chips still offer every other source's page.
    expect(chips.length).toBeGreaterThan(2);
  });
});

/* ── one id, one narrowing ───────────────────────────────────────────────── */

/**
 * **A source id in any spelling Postgres accepts narrows the same rows** —
 * admin-window/BUG-0140's property, on `/claims` (admin-window/DEBT-0009).
 *
 * `source_id` is a uuid column: Postgres matches every spelling of one id, and
 * JavaScript matches exactly one. This page compares both ways — the gauges at
 * the query, `selectClaims` and the chip's `active` test in code — and it
 * compared the URL's RAW value against the ids the view carries, so a real
 * source's id uppercased or hyphen-less selected nothing, was reported as a
 * dropped parameter, and the page rendered every claim under a filter bar
 * showing "all". `/sources` was fixed for exactly this a route away; `/claims`
 * could not be until the grammar moved to a leaf `lib/claims/filters.ts` may
 * import (ARCHITECTURE §4 rule 7).
 *
 * Graded against the CANONICAL render rather than against a literal: what is
 * claimed is that the two are the same page, whichever spelling asked for it.
 */
describe("a source id in another spelling", () => {
  const CANONICAL = SOURCE.first;

  /**
   * Spellings of `CANONICAL` a URL can carry that Postgres would match.
   *
   * **The case arm is not here, and its absence is the fixture's**: every
   * source id in this population is hex digits with no letter in it, so
   * `toUpperCase()` returns the same string and an uppercased arm would grade
   * nothing. It is graded where a fixture can carry a letter — the leaf's own
   * `tests/offline/claims/filters.test.ts`, on `259e2030-00bd-…` — and the
   * page reaches the same function, so what is left to prove here is that the
   * PAGE asks it.
   */
  const SPELLINGS = [
    CANONICAL.replace(/-/g, ""),
    // The padding a paste brings — a `?source_id=%20<id>` reaches the page as
    // a real space (admin-window/BUG-0145).
    ` ${CANONICAL}\n`,
    ` ${CANONICAL.replace(/-/g, "")}\t`,
  ];

  /**
   * The whole PAGE, and not an enumerated list of its parts (QA,
   * admin-window/DEBT-0009).
   *
   * The pins above grade four surfaces a spelling could move — the claim ids,
   * the bucket rows, the chip bar, the dropped line — each chosen by hand. The
   * property the canonicalising facet reader actually owes is stronger and
   * cheaper to state: a spelling of one id renders THE SAME RENDER. Every
   * caption, count, state card, window line and href on this page is then
   * covered at once, including the ones nobody thought to enumerate, and a
   * spelling that leaks into any of them fails HERE naming the spelling
   * instead of shipping under four green assertions that never looked at it.
   *
   * **`Date` is frozen for the pair, and that is the assertion's own doing,
   * not the page's.** The gauge window line carries the instants the read was
   * made over (`data-window-since` / `data-window-until`, to the millisecond),
   * so two renders a few milliseconds apart differ in four digits and nothing
   * else — measured before this was frozen, on all three spellings. Faking
   * `Date` alone (`toFake: ["Date"]`, as `tests/offline/absence/pages.test.ts`
   * does) leaves every real promise in the render resolving normally, so what
   * is held still is the clock and not the page.
   */
  it.each(SPELLINGS)("renders the page the canonical spelling renders, for %o", async (spelling) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-09T12:00:00.000Z"));
    try {
      const asked = await renderClaims(healthyScript(), { source_id: spelling });
      const canonical = await renderClaims(healthyScript(), { source_id: CANONICAL });
      expect(asked).toBe(canonical);
    } finally {
      vi.useRealTimers();
    }
  });
});

/* ── what a source is called ─────────────────────────────────────────────── */

/**
 * admin-window/BUG-0043 — a source is a NAME on this page, not a uuid.
 *
 * `pending_claims` keys a source by `source_id`, and this page used to print
 * that uuid in all 877 rows of the SOURCE column and in its one `source_id`
 * chip, while `/sources`' identical facet, `/browse`'s SOURCES column and a
 * record's provenance line all read `ticketmaster`. The id keeps every job it
 * had — it keys the row, it travels in the href, it is what a chip narrows by —
 * and it stays on screen verbatim for a source the registry has no row for,
 * which is the only case where it is the only true thing to say.
 */
describe("a source is named", () => {
  it("says the registry's name in the SOURCE cell, and still narrows by the id", async () => {
    const markup = await renderClaims(healthyScript());
    const named = SHOWABLE.filter((claim) => SOURCE_NAME.has(claim.source_id));
    expect(named.length).toBeGreaterThan(1);

    for (const claim of named) {
      const row = claimRow(markup, claim.observation_id);
      const name = SOURCE_NAME.get(claim.source_id) as string;
      expect(row.sourceLabel, claim.observation_id).toBe(name);
      // The uuid is gone from the cell, and gone from the row's text with it.
      expect(row.text, claim.observation_id).not.toContain(claim.source_id);
      // ... while the row's key and its link still carry it.
      expect(row.sourceId, claim.observation_id).toBe(claim.source_id);
      expect(row.sourceHref, claim.observation_id).toContain(
        encodeURIComponent(claim.source_id),
      );
    }
    // Both registered sources are exercised, not one of them twice.
    expect(new Set(named.map((claim) => claim.source_id)).size).toBe(SOURCE_NAME.size);
  });

  it("spells out the id of a source the registry holds no row for", async () => {
    const markup = await renderClaims(healthyScript());
    const unregistered = SHOWABLE.filter((claim) => !SOURCE_NAME.has(claim.source_id));
    expect(unregistered.length).toBeGreaterThan(0);

    for (const claim of unregistered) {
      // Verbatim, in the table's own mono cell — never a blank and never a
      // guess (LOOK_AND_FEEL Voice bar 5).
      expect(claimRow(markup, claim.observation_id).sourceLabel).toBe(claim.source_id);
    }
    // **EXPECTED CHANGE, admin-window/BUG-0138**: it is no longer a CHIP.
    // The chip row is the registry's rows, so a source the registry has no row
    // for is not offered as a narrowing to click — its id still renders
    // verbatim in every row above, and `?source_id=<that id>` still narrows.
    const labels = chipsOf(markup, "source_id").map((chip) => chip.label);
    expect(labels).not.toContain(unregistered[0].source_id);
    const narrowed = await renderClaims(healthyScript(), {
      source_id: unregistered[0].source_id,
    });
    expect(new Set(claimIds(narrowed))).toEqual(
      new Set(
        matching({ source_id: unregistered[0].source_id }).map(
          (claim) => claim.observation_id,
        ),
      ),
    );
  });

  /*
   * "states the number of standing splits it named by id, on a row the registry left blank" stood here until 2026-10-21.
   *
   * It read one of the explanatory captions Ben deleted on 2026-10-21 — the
   * bucket caption ("Every bucket the classification view can hold, with …"), the
   * Tier-drifts note, or the per-source `stuck_pattern` dial note. The figures and
   * identifiers those sentences wrapped are still on screen; the sentences are not.
   */
});

/* ── the URL as an operator (or a stale bookmark) can actually spell it ───── */

/**
 * `searchParams` the way Next hands a REAL query string over: the value for a
 * key, or an array of them when the key repeats
 * (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md`).
 *
 * The cases above pass parameter objects; these drive the whole URL — the
 * percent-encoding, the repeats, the empty values — because that is what a
 * hand-edited address bar and a bookmark from a previous build actually
 * deliver. The same class QA drove at `/queues` (admin-window/TASK-0010),
 * asked of the page whose one absolute rule is a string that must never
 * appear.
 */
function paramsOf(query: string): Record<string, string | string[]> {
  const params: Record<string, string | string[]> = {};
  for (const key of new URLSearchParams(query).keys()) {
    const values = new URLSearchParams(query).getAll(key);
    params[key] = values.length === 1 ? values[0] : values;
  }
  return params;
}

describe("a hand-edited URL", () => {
  /**
   * Each case: the query string, and the narrowing it is allowed to apply.
   * `{}` means "narrows nothing" — an unusable value shows every claim rather
   * than an empty page that reads as an empty database.
   */
  const cases: [string, Record<string, string>][] = [
    // Individually valid, jointly matching nothing: the AND is real, not "the
    // last one wins", so this must render EXACTLY nothing.
    [
      `bucket=escalated&domain=groups`,
      { bucket: "escalated", domain: "groups" },
    ],
    [
      `source_id=${SOURCE.second}&domain=venues`,
      { source_id: SOURCE.second, domain: "venues" },
    ],
    // A repeated key is ambiguous state; the first value is the answer.
    ["bucket=escalated&bucket=agreeing", { bucket: "escalated" }],
    [`domain=events&domain=venues`, { domain: "events" }],
    // Unusable values, every way one arrives.
    ["bucket=Escalated", {}],
    ["bucket=escalated%20", {}],
    ["domain=", {}],
    ["source_id=", {}],
    // A domain nothing carries NARROWS now, and matches nothing
    // (admin-window/BUG-0138): the page has no domain vocabulary left to check
    // it against, so it goes to the query and every figure comes back 0.
    ["domain=standing_disagreement", { domain: "standing_disagreement" }],
    [`source_id=${"x".repeat(10_000)}`, {}],
    // The parked bucket, spelled every way a URL can carry it.
    [`bucket=${PARKED}`, {}],
    [`bucket=${PARKED}&bucket=escalated`, {}],
    [`bucket=in%5Fwindow`, {}],
    [`bucket=${PARKED.toUpperCase()}`, {}],
    // A value that would be markup if anything ever interpolated it unescaped.
    ["source_id=%3Cscript%3Ealert(1)%3C%2Fscript%3E", {}],
  ];

  for (const [query, expected] of cases) {
    const name = query.length > 60 ? `${query.slice(0, 40)}… (${query.length} chars)` : query;

    it(`renders exactly the claims ?${name} matches`, async () => {
      const markup = await renderClaims(healthyScript(), paramsOf(query));
      const rendered = claimIds(markup);

      expect(new Set(rendered)).toEqual(
        new Set(matching(expected).map((claim) => claim.observation_id)),
      );
      expect(rendered).toHaveLength(matching(expected).length);
      // Whatever the URL said: the buckets still all stand, the parked one is
      // still nowhere, and nothing on the page writes.
      expect(bucketRows(markup).map((row) => row.bucket)).toEqual(RENDERED_BUCKETS);
      expect(markup).not.toContain(PARKED);
      expect(cheerio.load(markup)("button, form, input")).toHaveLength(0);
    });
  }

  it("escapes a value that arrives shaped like markup", async () => {
    const markup = await renderClaims(
      healthyScript(),
      paramsOf("source_id=%3Cscript%3Ealert(1)%3C%2Fscript%3E"),
    );
    expect(markup).not.toContain("<script>");
  });
});

/* ── what the URL asked for and the page did not do (admin-window/BUG-0123) ─ */

/**
 * The line beside the filter bar, read structurally: how many parameters the
 * page says it dropped, and which of them it spelled.
 *
 * The count and the names are separate on purpose — a parameter whose own NAME
 * is a word this app may not render (`?in_window=1`) is counted and not
 * spelled, so the two can disagree and the test can say which.
 */
function droppedLine(markup: string) {
  const $ = cheerio.load(markup);
  const line = $("[data-dropped-params]");
  return {
    present: line.length === 1,
    lines: line.length,
    total: Number(line.attr("data-dropped-params")),
    names: line
      .find("[data-dropped-param]")
      .toArray()
      .map((element) => $(element).text()),
    mono: line
      .find("span.type-data")
      .toArray()
      .map((element) => $(element).text()),
    text: line.text().replace(/\s+/g, " ").trim(),
  };
}

/**
 * What the bucket table's caption says, read out of the bucket surface itself.
 *
 * It reads the LAST paragraph of the surface, which is the caption only while
 * the read behind the table RETURNED: over a refusal the last paragraph is the
 * state card's own text, and a pin asserting `!== whole` there passes without
 * grading anything (the trap admin-window/BUG-0144's fix leaves behind, since
 * that state now renders no caption at all). So asking is an error rather than
 * an answer, and the caption's ABSENCE is asserted over EVERY paragraph of the
 * surface instead — what the BUG-0144 pins above do.
 */

function bucketCaption(markup: string): string {
  const $ = cheerio.load(markup);
  const surface = $('[data-surface="buckets"]');
  const state = surface.find("[data-state]").attr("data-state");
  if (state !== undefined) {
    throw new Error(
      "bucketCaption() was asked what the caption says on a surface whose read " +
        `did not happen (data-state="${state}"), where the page renders none. ` +
        "Assert its ABSENCE across every paragraph of the surface instead.",
    );
  }
  return surface
    .find("p")
    .last()
    .text()
    .replace(/\s+/g, " ")
    .trim();
}

describe("a parameter the page did not apply", () => {
  /**
   * The uuid Priya pasted, and deliberately NOT one this population carries:
   * the value must be absent from the markup because the page refused to echo
   * it, never because a row happened to spell it anyway.
   */
  const TYPED = "01a03f78-a122-7baf-acf7-6f997a030048";

  it("says nothing when every parameter the URL carried was applied", async () => {
    // Both directions of the guard live in this file, so the assertions below
    // are not passing over a page that never renders the line at all.
    for (const params of [
      {},
      { tab: "standing" },
      { bucket: "escalated" },
      { bucket: "escalated", domain: "events", source_id: SOURCE.first },
      // A parameter carrying no value asked for nothing, so nothing was dropped.
      { record_id: "" },
      { bucket: "" },
    ] as Record<string, string>[]) {
      const line = droppedLine(await renderClaims(healthyScript(), params));
      expect(line.lines, JSON.stringify(params)).toBe(0);
    }
  });

  it("names a parameter it does not filter by, once, and never its value", async () => {
    const markup = await renderClaims(healthyScript(), { record_id: TYPED });
    const line = droppedLine(markup);
    expect(line.present).toBe(true);
    expect(line.total).toBe(1);
    // The name, verbatim and in mono (Voice bar 5) — and nothing else in mono.
    expect(line.names).toEqual(["record_id"]);
    expect(line.mono).toEqual(["record_id"]);
    // The VALUE is the operator's, and the page does not read it back to them:
    // an echo is how a hand-typed URL gets a foothold in the markup.
    expect(line.text).not.toContain(TYPED);
    expect(markup).not.toContain(TYPED);
  });

  it("counts a parameter whose own NAME this app may not render, and spells none of it", async () => {
    // The URL may use the parked bucket as a KEY, and bar 3 is about the
    // string on the screen, not about which half of a query pair it came from.
    // The page still says it dropped one — silence is what the bug was.
    const markup = await renderClaims(healthyScript(), { [PARKED]: "1" });
    const line = droppedLine(markup);
    expect(line.present).toBe(true);
    expect(line.total).toBe(1);
    expect(line.names).toEqual([]);
    expect(markup).not.toContain(PARKED);
    expect(line.text.length).toBeGreaterThan(20);

    // admin-window/BUG-0137, criterion 3: nor when an ink-less mark rides
    // along inside or beside the parked word. `/claims?in_window%EF%B8%8F=1`
    // and `/claims?in_win%CD%8Fdow=1` each drew `in_window` legibly into the
    // mono span (59.41px in Chromium, the `record_id` control's exact width,
    // 2026-09-09); the allowlist rules all three unspellable, so each is
    // counted exactly as the exact spelling above is and the word is in the
    // body nowhere.
    for (const key of [PARKED + "\uFE0F", "in_win\u034Fdow", PARKED + "\u2800"]) {
      const where = [...key]
        .map((c) => "U+" + c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0"))
        .join(" ");
      const rendered = await renderClaims(healthyScript(), { [key]: "1" });
      const dropped = droppedLine(rendered);
      expect(dropped.present, where).toBe(true);
      expect(dropped.total, where).toBe(1);
      expect(dropped.names, where).toEqual([]);
      expect(rendered, where).not.toContain(PARKED);
    }
  });

  it("names every dropped parameter in one line, and only the ones it dropped", async () => {
    const markup = await renderClaims(healthyScript(), {
      record_id: TYPED,
      bucket: PARKED,
      // Applied, so it is not in the line — and the tab never is.
      domain: "events",
      tab: "buckets",
    });
    const line = droppedLine(markup);
    expect(line.lines).toBe(1);
    expect(line.total).toBe(2);
    expect(line.names).toEqual(["record_id", "bucket"]);
    expect(line.names).not.toContain("domain");
    expect(line.names).not.toContain("tab");
    expect(markup).not.toContain(PARKED);
  });

  it("names the bucket the STANDING tab took away, because that tab did not apply it", async () => {
    // The standing tab is one bucket's subset and carries no bucket facet at
    // all, so `?tab=standing&bucket=awaiting_row` really is a narrowing this
    // page did not perform — the same silence, arrived at by another route.
    const markup = await renderClaims(healthyScript(), {
      tab: "standing",
      bucket: "awaiting_row",
    });
    expect(droppedLine(markup).names).toEqual(["bucket"]);
    // …and the rows below are the standing bucket's, exactly as they were.
    expect(claimIds(markup)).toEqual(
      oldestFirst(matching({ bucket: "standing_disagreement" })),
    );
  });

  it("stands on a read that failed as well as one that answered", async () => {
    // It is a fact of the URL, not of a read, so it does not disappear with
    // the rows (LOOK_AND_FEEL states 3 and 4).
    for (const script of [
      healthyScript({ [T.pendingClaims]: { error: tableNotInSchemaCache(T.pendingClaims) } }),
      healthyScript({ [T.pendingClaims]: { error: transportFailure() } }),
    ]) {
      const line = droppedLine(await renderClaims(script, { record_id: TYPED }));
      expect(line.present).toBe(true);
      expect(line.names).toEqual(["record_id"]);
    }
  });

  it("changes nothing else about the page it reports on", async () => {
    // Acceptance criterion 5: the parameter is reported, not applied. The rows,
    // the bucket figures and every chip href are the unnarrowed page's.
    const plain = await renderClaims(healthyScript());
    const typed = await renderClaims(healthyScript(), { record_id: TYPED });
    expect(claimIds(typed)).toEqual(claimIds(plain));
    expect(bucketRows(typed)).toEqual(bucketRows(plain));
    for (const facet of ["bucket", "source_id", "domain"]) {
      expect(chipsOf(typed, facet), facet).toEqual(chipsOf(plain, facet));
    }

    /**
     * What an operator READS, minus the gauge — whose window line is measured
     * back from `Date.now()`, so two renders of the same page never carry the
     * same instants and a raw markup comparison would be true for a reason
     * that has nothing to do with this ticket.
     */
    const reads = (markup: string, withoutTheLine = false): string => {
      const $ = cheerio.load(markup);
      $('[data-surface="gauge"]').remove();
      if (withoutTheLine) $("[data-dropped-params]").remove();
      return $.root().text().replace(/\s+/g, " ").trim();
    };

    // Criterion 6: the walk fetched both URLs, diffed the rendered text and got
    // nothing. They no longer read alike…
    expect(reads(typed)).not.toBe(reads(plain));
    // …and the difference is the one line and nothing else, which is the other
    // half of criterion 5: take it away and the two pages are the same page.
    expect(reads(typed, true)).toBe(reads(plain, true));
    expect(droppedLine(plain).lines).toBe(0);
  });

  it("ignores a key with no visible content the way it ignores an empty value, and moves nothing else", async () => {
    // admin-window/BUG-0127, criterion 2: `?=x` and `?%20%20=1` name no
    // facet, so they are the URL saying nothing rather than the page
    // dropping a narrowing — no line, and the page underneath is the
    // unnarrowed one it was before.
    //
    // admin-window/BUG-0136, criterion 2: the six keys below are the same
    // sentence reached through codepoints `trim()` cannot see, so they get
    // the same answer and move the page just as little — the rows, the bucket
    // figures, the caption and every chip href are the bare page's.
    const plain = await renderClaims(healthyScript());
    const blankOrInkLess = [
      { "": "x" },
      { "  ": "1" },
      { "\u0000": "1" },
      { "\u200B": "1" },
      { "\u00AD": "1" },
      { "\u2060": "1" },
      { "\u200E": "1" },
      { "\u007F": "1" },
    ] as Record<string, string>[];
    for (const params of blankOrInkLess) {
      const markup = await renderClaims(healthyScript(), params);
      const line = droppedLine(markup);
      expect(line.lines, JSON.stringify(params)).toBe(0);
      expect(claimIds(markup), JSON.stringify(params)).toEqual(claimIds(plain));
      expect(bucketRows(markup), JSON.stringify(params)).toEqual(bucketRows(plain));
      expect(bucketCaption(markup), JSON.stringify(params)).toBe(bucketCaption(plain));
      for (const facet of ["bucket", "source_id", "domain"]) {
        expect(chipsOf(markup, facet), `${JSON.stringify(params)} ${facet}`).toEqual(
          chipsOf(plain, facet),
        );
      }
    }
    // The other direction, so the assertions above are not passing over a
    // page that stopped reporting dropped parameters altogether.
    expect(droppedLine(await renderClaims(healthyScript(), { record_id: TYPED })).names)
      .toEqual(["record_id"]);
  });
});

/* ══ the adversary's cross-product (admin-window/TASK-0012, QA) ═══════════ */

/**
 * A SECOND population, written by QA against the same page, and read with
 * QA's own predicate.
 *
 * The suite above proves each facet one at a time against a fixture where
 * every source and every domain also carries a renderable claim. Two things
 * that population structurally cannot see, and this one is built to:
 *
 *  - **a source and a domain that exist in the raw view ONLY on parked rows.**
 *    If the parked bucket leaked anywhere into the vocabularies, it would
 *    surface here as a filter chip nobody can use and a source id on a page
 *    that must not know it exists — the leak `?bucket=…` cannot produce.
 *  - **the whole tab x bucket x source x domain cross-product**, not a
 *    diagonal of it: 300 renderings, each one checked against a tally
 *    computed here from the rows, so "the counts equal the view's, per bucket
 *    and per source filter" (acceptance test 3) is asserted over every
 *    combination an operator can reach rather than over the ones the page's
 *    author thought of.
 *
 * The stub hands the parked rows over on every read — the shape of a database
 * whose server-side `neq` did nothing — so only the code-side exclusion is
 * under test.
 */

/** Three sources that hold renderable claims, and a fourth that holds only parked ones. */
const QA_SOURCE = {
  a: "01920000-0000-7000-8000-00000000a001",
  b: "01920000-0000-7000-8000-00000000a002",
  c: "01920000-0000-7000-8000-00000000a003",
  /** Every claim from this source is in the parked bucket. It must not exist to the UI. */
  parkedOnly: "01920000-0000-7000-8000-00000000a004",
} as const;

/** A domain carried by parked rows alone — the domain twin of the source above. */
const QA_PARKED_DOMAIN = "idols";

interface QaSpec {
  id: string;
  bucket: string;
  source: string;
  domain: string;
  field: string;
  entity: string | null;
  requirement?: string;
  /** Absent when this claim has no observation row: unknown age, never zero. */
  observedAt?: string;
}

const QA_SPECS: readonly QaSpec[] = [
  // standing_disagreement x three sources, two domains
  { id: "01920000-0000-7000-8000-00000000b001", bucket: "standing_disagreement", source: QA_SOURCE.a, domain: "events", field: "title", entity: ENTITY.event, observedAt: "2026-08-10T00:00:00Z" },
  { id: "01920000-0000-7000-8000-00000000b002", bucket: "standing_disagreement", source: QA_SOURCE.b, domain: "groups", field: "agency", entity: ENTITY.group, observedAt: "2026-08-11T00:00:00Z" },
  // No observation row: unknown age, and it sorts last wherever it renders.
  { id: "01920000-0000-7000-8000-00000000b003", bucket: "standing_disagreement", source: QA_SOURCE.c, domain: "events", field: "starts_at", entity: ENTITY.event },
  // awaiting_link
  { id: "01920000-0000-7000-8000-00000000b004", bucket: "awaiting_link", source: QA_SOURCE.a, domain: "venues", field: "address", entity: ENTITY.venue, observedAt: "2026-08-12T00:00:00Z" },
  { id: "01920000-0000-7000-8000-00000000b005", bucket: "awaiting_link", source: QA_SOURCE.b, domain: "events", field: "venue", entity: ENTITY.otherEvent, observedAt: "2026-08-13T00:00:00Z" },
  // awaiting_row — each naming its own unmet requirement, and neither with a record
  { id: "01920000-0000-7000-8000-00000000b006", bucket: "awaiting_row", source: QA_SOURCE.c, domain: "groups", field: "name", entity: null, requirement: "debut_date", observedAt: "2026-08-14T00:00:00Z" },
  { id: "01920000-0000-7000-8000-00000000b007", bucket: "awaiting_row", source: QA_SOURCE.a, domain: "events", field: "performers", entity: null, requirement: "at least one linked performer", observedAt: "2026-08-15T00:00:00Z" },
  // escalated — one source only, so most (source, escalated) cells are real zeros
  { id: "01920000-0000-7000-8000-00000000b008", bucket: "escalated", source: QA_SOURCE.b, domain: "venues", field: "name", entity: ENTITY.venue, observedAt: "2026-08-16T00:00:00Z" },
  // agreeing
  { id: "01920000-0000-7000-8000-00000000b009", bucket: "agreeing", source: QA_SOURCE.a, domain: "groups", field: "name", entity: ENTITY.group, observedAt: "2026-08-17T00:00:00Z" },
  { id: "01920000-0000-7000-8000-00000000b010", bucket: "agreeing", source: QA_SOURCE.b, domain: "events", field: "title", entity: ENTITY.event, observedAt: "2026-08-18T00:00:00Z" },
  { id: "01920000-0000-7000-8000-00000000b011", bucket: "agreeing", source: QA_SOURCE.c, domain: "venues", field: "address", entity: ENTITY.venue, observedAt: "2026-08-19T00:00:00Z" },
  { id: "01920000-0000-7000-8000-00000000b012", bucket: "agreeing", source: QA_SOURCE.c, domain: "events", field: "starts_at", entity: ENTITY.event, observedAt: "2026-08-20T00:00:00Z" },
  // The parked bucket: on a source nothing else carries, on a domain nothing
  // else carries, and on two ordinary source/domain pairs as well.
  { id: "01920000-0000-7000-8000-00000000b013", bucket: PARKED, source: QA_SOURCE.parkedOnly, domain: QA_PARKED_DOMAIN, field: "birth_date", entity: ENTITY.group, observedAt: "2026-08-21T00:00:00Z" },
  { id: "01920000-0000-7000-8000-00000000b014", bucket: PARKED, source: QA_SOURCE.parkedOnly, domain: "events", field: "title", entity: ENTITY.event, observedAt: "2026-08-22T00:00:00Z" },
  { id: "01920000-0000-7000-8000-00000000b015", bucket: PARKED, source: QA_SOURCE.a, domain: QA_PARKED_DOMAIN, field: "real_name", entity: ENTITY.group, observedAt: "2026-08-23T00:00:00Z" },
  { id: "01920000-0000-7000-8000-00000000b016", bucket: PARKED, source: QA_SOURCE.c, domain: "events", field: "title", entity: ENTITY.event, observedAt: "2026-08-24T00:00:00Z" },
];

const QA_CLAIMS: readonly PendingClaimRow[] = QA_SPECS.map((spec) =>
  pendingClaimRow(spec.bucket as PendingClaimRow["bucket"], {
    observation_id: spec.id,
    domain: spec.domain,
    entity_id: spec.entity,
    field: spec.field,
    source_id: spec.source,
    unmet_requirement: spec.requirement ?? null,
    observed_at: spec.observedAt ?? null,
  }),
);

const QA_OBSERVATIONS = QA_SPECS.filter((spec) => spec.observedAt !== undefined).map(
  (spec) =>
    observationRow({
      observation_id: spec.id,
      entity_id: spec.entity,
      domain: spec.domain,
      field: spec.field,
      source_id: spec.source,
      observed_at: spec.observedAt as string,
      status: "pending",
    }),
);

/** Every claim the UI may show — QA's own reading of the rule, not the app's. */
const QA_SHOWABLE = QA_SPECS.filter((spec) => spec.bucket !== PARKED);

/** The vocabularies the page is ALLOWED to offer, derived from the showable rows alone. */
const QA_SOURCE_VOCAB = [...new Set(QA_SHOWABLE.map((s) => s.source))].sort();
const QA_DOMAIN_VOCAB = [...new Set(QA_SHOWABLE.map((s) => s.domain))].sort();

/** The claims a narrowing keeps. QA's predicate, written from the spec, not from the app's. */
function qaMatching(filter: {
  bucket?: string;
  source_id?: string;
  domain?: string;
}): QaSpec[] {
  return QA_SHOWABLE.filter(
    (spec) =>
      (filter.bucket === undefined || spec.bucket === filter.bucket) &&
      (filter.source_id === undefined || spec.source === filter.source_id) &&
      (filter.domain === undefined || spec.domain === filter.domain),
  );
}

/**
 * The narrowing a URL value is allowed to apply: only a value the page may
 * offer narrows anything. Anything else — the parked bucket, a case variant, a
 * 10k string, a source that exists only on parked rows — constrains NOTHING,
 * so a hand-typed URL lands on a real state instead of an empty page that
 * reads as an empty database.
 */
function qaApplied(
  vocabulary: readonly string[],
  value: string | undefined,
): string | undefined {
  return value !== undefined && vocabulary.includes(value) ? value : undefined;
}

function qaScript(overrides: Script = {}): Script {
  return {
    // The view, answering the query — and holding the parked rows, so every
    // assertion below is made against a database that really carries them.
    [T.pendingClaims]: claimView(QA_CLAIMS),
    [T.observations]: { data: [...QA_OBSERVATIONS] },
    // A registry that holds no row — read completely, so the chip row is
    // honestly empty rather than a refusal (admin-window/BUG-0138: the chips
    // are the registry's rows now).
    [T.sources]: { data: [], count: 0 },
    ...overrides,
  };
}

/** Every link on the page, so a value can be hunted in an href as well as in text. */
function hrefsOf(markup: string): string[] {
  const $ = cheerio.load(markup);
  return $("a[href]")
    .toArray()
    .map((element) => $(element).attr("href") ?? "");
}

describe("QA: the whole tab x bucket x source x domain cross-product", () => {
  /** The bucket parameters an operator can reach, valid and hostile alike. */
  const BUCKET_PARAMS: (string | undefined)[] = [
    undefined,
    "standing_disagreement",
    "awaiting_row",
    "agreeing",
    PARKED,
    "ESCALATED",
  ];
  const SOURCE_PARAMS: (string | undefined)[] = [
    undefined,
    ...Object.values(QA_SOURCE),
  ];
  const DOMAIN_PARAMS: (string | undefined)[] = [
    undefined,
    ...QA_DOMAIN_VOCAB,
    QA_PARKED_DOMAIN,
  ];

  // One case per (tab, bucket) rather than one per tab: the same cross-product,
  // the same assertions, sliced so no single it() carries the whole
  // bucket x source x domain grid of renders (admin-window/BUG-0029).
  for (const tab of ["buckets", "standing"] as const) {
    for (const bucket of BUCKET_PARAMS) {
      it(`renders exactly the claims and counts the view holds, on the ${tab} tab, under bucket=${bucket ?? "(absent)"}`, async () => {
        for (const source of SOURCE_PARAMS) {
          for (const domain of DOMAIN_PARAMS) {
            const params: Record<string, string> = { tab };
            if (bucket !== undefined) params.bucket = bucket;
            if (source !== undefined) params.source_id = source;
            if (domain !== undefined) params.domain = domain;
            const where = new URLSearchParams(params).toString();
            const markup = await renderClaims(qaScript(), params);

            // 1. The parked bucket, in text, in an attribute, in an href, and
            //    in the one encoding a URL can smuggle its underscore through.
            expect(markup, where).not.toContain(PARKED);
            expect(markup, where).not.toContain("in%5Fwindow");
            // 2. Nor the source that exists only on parked rows — unless
            //    THIS URL asked to narrow by it, in which case the page really
            //    did narrow by it and every chip and tab link carries the
            //    state you are in (admin-window/BUG-0138). What it may never
            //    do is learn that source from the parked ROWS, which is what
            //    every unnarrowed and differently-narrowed case here checks.
            if (source !== QA_SOURCE.parkedOnly) {
              expect(markup, where).not.toContain(QA_SOURCE.parkedOnly);
            }

            // 3. The claims rendered are exactly the ones QA's own predicate
            //    keeps — the standing tab being that predicate with the bucket
            //    the tab IS, whatever the URL asked for.
            // What the page really applies (admin-window/BUG-0138): the
            // BUCKET is still checked against the closed vocabulary this app
            // declares, so a hostile or unknown bucket narrows nothing; the
            // source and the domain have no vocabulary left to check against
            // and are applied AS ASKED at the query, so a value nothing
            // carries narrows to nothing rather than being ignored.
            const applied = {
              bucket: qaApplied(RENDERED_BUCKETS, bucket),
              source_id: source,
              domain,
            };
            const expected = qaMatching(
              tab === "standing"
                ? { ...applied, bucket: "standing_disagreement" }
                : applied,
            );
            const rendered = claimIds(markup);
            expect(new Set(rendered), where).toEqual(
              new Set(expected.map((spec) => spec.id)),
            );
            expect(rendered, where).toHaveLength(expected.length);

            // 4. The bucket table: every bucket a row, every count and every
            //    source count QA's own tally, under the source/domain scope
            //    alone — and the standing tab carries no bucket table at all.
            const rows = bucketRows(markup);
            if (tab === "standing") {
              expect(rows, where).toHaveLength(0);
            } else {
              expect(rows.map((row) => row.bucket), where).toEqual(RENDERED_BUCKETS);
              const scope = {
                source_id: applied.source_id,
                domain: applied.domain,
              };
              for (const row of rows) {
                const held = qaMatching({ ...scope, bucket: row.bucket });
                expect(row.claims, `${where} / ${row.bucket}`).toBe(held.length);
              }
              // The table is the WHOLE classification under this scope: its
              // counts sum to every claim in scope, and — when no bucket
              // narrows the list — to the list rendered beneath it.
              const total = rows.reduce((sum, row) => sum + row.claims, 0);
              expect(total, where).toBe(qaMatching(scope).length);
              if (applied.bucket === undefined) {
                expect(total, where).toBe(rendered.length);
              }
            }

            // 5. Nothing settles anything, and no link on the page carries a
            //    value the page does not offer — the parked bucket and the
            //    parked-only source can therefore not travel in a URL either.
            expect(cheerio.load(markup)("button, form, input"), where).toHaveLength(0);
            for (const href of hrefsOf(markup)) {
              if (!href.startsWith("/claims") && !href.startsWith("/sources")) continue;
              const query = new URLSearchParams(
                href.includes("?") ? href.slice(href.indexOf("?") + 1) : "",
              );
              for (const [key, value] of query) {
                if (key === "bucket") {
                  // The closed vocabulary: no href may ever carry a bucket
                  // this app does not render, the parked one above all.
                  expect(RENDERED_BUCKETS, `${where} -> ${href}`).toContain(value);
                } else if (key === "source_id") {
                  // A narrowing the page APPLIED travels forward — otherwise
                  // every chip would silently drop the state you are in. What
                  // may not travel is a value the page did not apply.
                  expect(
                    [...QA_SOURCE_VOCAB, applied.source_id],
                    `${where} -> ${href}`,
                  ).toContain(value);
                } else if (key === "domain") {
                  expect(
                    [...QA_DOMAIN_VOCAB, applied.domain],
                    `${where} -> ${href}`,
                  ).toContain(value);
                } else {
                  expect(["tab"], `${where} -> ${href}`).toContain(key);
                }
              }
            }
          }
        }
      });
    }
  }
});

/**
 * The CODE half of ARCHITECTURE.md §6 trap 4 (admin-window/BUG-0138).
 *
 * `src/lib/db/claims.ts` excludes the parked bucket twice — in every query and
 * again in the predicate — so the rendered set is decided by ONE rule whether
 * or not the server narrowed. Every other case in this file reads a database
 * that honours the `.neq`, so the second exclusion is invisible to all of
 * them: measured on this tree by deleting it, with the whole offline suite
 * still green. This is the fixture that sees it — a database whose bucket
 * exclusion did nothing.
 *
 * What it grades is the ROWS, and deliberately not the counts: a count is the
 * database's own word about a query it was asked, and a server that answers
 * the wrong question cannot be caught by the page that asked the right one.
 * The rows it hands back CAN be checked, and are.
 */
describe("a server that ignored the exclusion", () => {
  it("still renders no parked claim, and no parked row's source", async () => {
    const ignored = claimView(QA_CLAIMS, { ignoring: "neq" });
    const states: Record<string, string>[] = [{}, { tab: "standing" }, { bucket: "agreeing" }];
    for (const params of states) {
      const markup = await renderClaims(qaScript({ [T.pendingClaims]: ignored }), params);
      const where = JSON.stringify(params);
      expect(markup, where).not.toContain(PARKED);
      expect(markup, where).not.toContain(QA_SOURCE.parkedOnly);
      // Not vacuous: the parked rows really did come back — the same fixture
      // with the exclusion honoured draws the same claims, and this one drew
      // no MORE of them.
      const rendered = new Set(claimIds(markup));
      for (const spec of QA_SPECS) {
        if (spec.bucket === PARKED) expect(rendered.has(spec.id), spec.id).toBe(false);
      }
    }

    // The fixture really is ignoring the exclusion: asked with the page's own
    // window query, it hands a parked claim straight back.
    const answered = claimView(QA_CLAIMS, { ignoring: "neq" })({
      table: T.pendingClaims,
      steps: [
        { method: "select", args: ["observation_id, bucket"] },
        { method: "neq", args: ["bucket", PARKED] },
      ],
    });
    expect(JSON.stringify(answered.data)).toContain(PARKED);
  });
});

describe("QA: what the parked bucket alone carries", () => {
  it("narrows to NOTHING when the URL names one of them, and says where it looked", async () => {
    // **EXPECTED CHANGE, admin-window/BUG-0138.** These used to narrow nothing
    // — they were outside the vocabularies the page read off the population —
    // and the page rendered every claim under a dropped-parameter line. The
    // page has no such vocabulary now, so the narrowing really happens at the
    // query: a source and a domain that only parked rows carry match no
    // RENDERABLE claim, so the honest answer is the "nothing matched" card
    // over a window line holding 0. The parked bucket is unchanged: its
    // vocabulary is still closed, and it still narrows nothing.
    const hostile: Record<string, string>[] = [
      { source_id: QA_SOURCE.parkedOnly },
      { domain: QA_PARKED_DOMAIN },
      { source_id: QA_SOURCE.parkedOnly, domain: QA_PARKED_DOMAIN },
    ];
    for (const params of hostile) {
      const markup = await renderClaims(qaScript(), params);
      const where = new URLSearchParams(params).toString();
      const $ = cheerio.load(markup);
      expect(claimIds(markup), where).toEqual([]);
      expect($('[data-empty="narrowing"]'), where).toHaveLength(1);
      expect(
        Number($('[data-window="claims"]').attr("data-window-held")),
        where,
      ).toBe(0);
      // Every bucket row is a real, counted zero — not a blank and not a hole.
      for (const row of bucketRows(markup)) {
        expect(row.claims, `${where} / ${row.bucket}`).toBe(0);
      }
      expect(markup, where).not.toContain(PARKED);
    }

    // The bucket the URL cannot use narrows nothing, exactly as before.
    const parkedBucket = await renderClaims(qaScript(), { bucket: PARKED });
    expect(claimIds(parkedBucket)).toHaveLength(QA_SHOWABLE.length);
    expect(parkedBucket).not.toContain(PARKED);
    expect(parkedBucket).not.toContain(QA_SOURCE.parkedOnly);
  });

  it("takes the first value of every repeated parameter, hostile ones included", async () => {
    const markup = await renderClaims(qaScript(), {
      bucket: [PARKED, "escalated"],
      source_id: [QA_SOURCE.parkedOnly, QA_SOURCE.a],
      domain: [QA_PARKED_DOMAIN, "events"],
      tab: ["standing", "buckets"],
    });
    // First values: the bucket is unusable so it narrows nothing, the source
    // and the domain are applied as asked and match no renderable claim, and
    // the tab is standing.
    expect(claimIds(markup)).toEqual([]);
    expect(bucketRows(markup)).toHaveLength(0);
    expect(markup).not.toContain(PARKED);
    // The SECOND value of each parameter never reaches the page at all.
    expect(markup).not.toContain(QA_SOURCE.a);
    expect(markup).not.toContain("domain=events");
  });

  /**
   * **EXPECTED CHANGE, admin-window/BUG-0138 (criterion 4).** A view larger
   * than `ROW_CAP` used to refuse the whole page: the read was COMPLETE, so a
   * count above the cap was a refusal carrying the real number, and `/claims`
   * rendered nothing but that line. No read this page makes can reach the cap
   * now — the list is a `limit 50` window and every figure is a zero-row
   * `{ count: "exact" }` read — so a view of any size renders its window and states the true
   * number beside it. That is the point of the fix, not a regression.
   */
  it("renders a view far larger than the row cap, and states its real size", async () => {
    const crowd = Array.from({ length: ROW_CAP * 4 }, (_, index) =>
      pendingClaimRow("agreeing", {
        observation_id: `0192bbbb-0000-7000-8000-${String(index).padStart(12, "0")}`,
        observed_at: new Date(Date.UTC(2026, 0, 1) + index * 1000).toISOString(),
      }),
    );
    const markup = await renderClaims(qaScript({ [T.pendingClaims]: claimView(crowd) }));
    const $ = cheerio.load(markup);

    expect(claimIds(markup)).toHaveLength(CLAIM_WINDOW);
    expect(Number($('[data-window="claims"]').attr("data-window-held"))).toBe(
      ROW_CAP * 4,
    );
    expect($('[data-window="claims"]').attr("data-window-truncated")).toBe("true");
    expect(
      bucketRows(markup).find((row) => row.bucket === "agreeing")?.claims,
    ).toBe(ROW_CAP * 4);
    expect(markup).not.toContain(PARKED);
  });
});

describe("QA: the clauses of the criterion, driven over QA's own population", () => {
  it("names what every awaiting_row claim waits for, and nothing else does", async () => {
    const markup = await renderClaims(qaScript());
    for (const spec of QA_SHOWABLE) {
      const row = claimRow(markup, spec.id);
      expect(row.bucket, spec.id).toBe(spec.bucket);
      // The view's own words, verbatim — a bare bucket name is the defect the
      // column exists to prevent (migration 20260901000004).
      expect(row.requirement, spec.id).toBe(spec.requirement);
      if (spec.bucket === "awaiting_row") {
        expect(row.requirement, spec.id).toBeDefined();
      } else {
        expect(row.requirement, spec.id).toBeUndefined();
      }
    }
  });

  it("leads from every claim to its source, and to its fact where there is one", async () => {
    const markup = await renderClaims(qaScript());
    for (const spec of QA_SHOWABLE) {
      const row = claimRow(markup, spec.id);
      // Its source, always — one click, a real URL naming that source.
      expect(row.sourceId, spec.id).toBe(spec.source);
      expect(row.sourceHref, spec.id).toContain(encodeURIComponent(spec.source));
      if (spec.entity === null) {
        // No canonical row yet, so no invented link to one: that absence is
        // exactly what the `waiting for` cell on the same row explains.
        expect(row.provenanceHref, spec.id).toBeUndefined();
        expect(row.requirement, spec.id).toBeDefined();
      } else {
        expect(row.provenanceHref, spec.id).toBe(
          `/records/${encodeURIComponent(spec.domain)}/${encodeURIComponent(spec.entity)}`,
        );
      }
    }
  });

  it("puts the standing-disagreements gauge on the standing tab and nowhere else", async () => {
    const splitsOn = async (tab: string) => {
      const markup = await renderClaims(qaScript(), { tab });
      const $ = cheerio.load(markup);
      return $("[data-split-source]")
        .toArray()
        .map((element) => $(element).attr("data-split-source") ?? "");
    };
    const standing = await splitsOn("standing");
    expect(standing.length).toBeGreaterThan(0);
    // Every source the gauge splits by is one the page may name at all.
    for (const source of standing) expect(QA_SOURCE_VOCAB).toContain(source);
    // The buckets tab carries the other gauge; this one is not read there.
    expect(await splitsOn("buckets")).toEqual([]);
  });
});

/**
 * The prose the page ships, checked against the RENDERED markup rather than
 * the source (campaign admin-window/BUG-0045).
 *
 * Both tabs, because the paragraph under a gauge belongs to whichever gauge
 * the tab selected, and only one of them was ever looked at.
 */
describe("the copy the operator actually reads", () => {
  for (const tab of ["buckets", "standing"] as const) {
    it(`names no factory ticket on the ${tab} tab`, async () => {
      // The guard proves itself before it clears the page.
      expect(factoryTicketIds("<p>an open question (admin-window/TASK-0024)</p>")).toEqual([
        "admin-window/TASK-0024",
      ]);
      const markup = await renderClaims(healthyScript(), { tab });
      expect(factoryTicketIds(markup)).toEqual([]);
    });

    it(`puts a space between a mono identifier and the word after it on the ${tab} tab`, async () => {
      expect(runTogetherWords('<span class="type-data">stuck_pattern</span>dial is a')).toEqual([
        "</span>dial",
      ]);
      expect(runTogetherWords(await renderClaims(healthyScript(), { tab }))).toEqual([]);
    });

    it(`agrees every count with its noun on the ${tab} tab when one source holds the window`, async () => {
      // The staging shape that produced "1 sources, 2 domains" and "0 sources
      // holding one" on the walk (admin-window/BUG-0046). The whole population
      // spans three sources and three domains, so the defect cannot render
      // against it; narrowing to the one source whose claims are all `events`
      // is what makes the guard below non-vacuous — it puts a 1 under both
      // gauges, on both tabs.
      expect(disagreeingCounts("<p>1 sources, 2 domains</p>")).toEqual(["1 sources"]);

      const held = CLAIMS.filter((claim) => claim.source_id === SOURCE.second);
      expect(new Set(held.map((claim) => claim.source_id)).size).toBe(1);
      expect(new Set(held.map((claim) => claim.domain)).size).toBe(1);
      expect(
        held.filter((claim) => claim.bucket === "standing_disagreement"),
      ).toHaveLength(1);

      const markup = await renderClaims(
        healthyScript({
          [T.pendingClaims]: { data: held, count: held.length },
          [T.observations]: {
            data: OBSERVATIONS.filter((row) => row.source_id === SOURCE.second),
          },
        }),
        { tab },
      );
      expect(disagreeingCounts(markup)).toEqual([]);
    });
  }

  /*
   * "spells the dial the way Sources spells it — the identifier, verbatim, in mono" stood here until 2026-10-21.
   *
   * It read one of the explanatory captions Ben deleted on 2026-10-21 — the
   * bucket caption ("Every bucket the classification view can hold, with …"), the
   * Tier-drifts note, or the per-source `stuck_pattern` dial note. The figures and
   * identifiers those sentences wrapped are still on screen; the sentences are not.
   */
});

/* ── the addressing the live oracle depends on ───────────────────────────── */

/**
 * The name each surface answers to (`data-surface`, `src/app/claims/page.tsx`),
 * as `tests/live/claims.live.test.ts` addresses them.
 */
const SURFACE_HOOKS = {
  buckets: '[data-surface="buckets"]',
  claims: '[data-surface="claims"]',
  gauge: '[data-surface="gauge"]',
} as const;

const HOOKS = Object.values(SURFACE_HOOKS);

/**
 * How many elements each hook reaches, per tab. `buckets` is the one surface
 * that does not always render — the standing tab draws no bucket table — which
 * is a count of 0 or 1 and never 2, the only value `stateOf` cannot read.
 */
const EXPECTED: Record<string, Record<string, number>> = {
  buckets: oneEach(HOOKS),
  standing: { ...oneEach(HOOKS), [SURFACE_HOOKS.buckets]: 0 },
};

describe("the surface hooks the live parity oracle addresses", () => {
  /**
   * The live oracle grades ONE surface at a time and `stateOf`
   * (`tests/fixtures/surface-state.ts`) refuses any selector matching other than exactly
   * one element. Until admin-window/DEBT-0002 it addressed these
   * POSITIONALLY — `section:nth-of-type(n)` — and on THIS page the position
   * was already tab-dependent, so the oracle carried a `listOf(tab)` function
   * whose only job was to guess a number. One added section, or one `<div>`
   * around an existing one, either duplicates a match or silently repoints the
   * selector at the neighbouring surface; on `/cycles` exactly that made
   * `:nth-of-type(1)` match two surfaces and four live tests threw
   * (admin-window/BUG-0040, admin-window/BUG-0056).
   *
   * Nothing offline could see any of that — `npm test` runs the offline and
   * isolated projects only — so the live oracle's addressing had no pin in CI.
   * These cases are that pin, in the file that owns this page's markup.
   */
  it("gives each surface its own one element, on both tabs and in every state", async () => {
    for (const [tab, counts] of Object.entries(EXPECTED)) {
      const states: [string, string][] = [
        ["populated", await renderClaims(healthyScript(), { tab })],
        // The narrowing that matched nothing, and the view that holds nothing:
        // both swap the list's table for a card.
        [
          "narrowed to nothing",
          await renderClaims(healthyScript(), { tab, source_id: SOURCE.third }),
        ],
        [
          "empty",
          await renderClaims(
            healthyScript({ [T.pendingClaims]: claimView([]) }),
            { tab },
          ),
        ],
        // The states that swap a surface's table for a card are exactly where
        // a wrapper is most likely to appear or vanish.
        [
          "absent",
          await renderClaims(
            {
              [T.pendingClaims]: { error: tableNotInSchemaCache(T.pendingClaims) },
              [T.observations]: { error: tableNotInSchemaCache(T.observations) },
              [T.sources]: { error: tableNotInSchemaCache(T.sources) },
            },
            { tab },
          ),
        ],
        [
          "refused",
          await renderClaims(
            {
              [T.pendingClaims]: { error: permissionDenied(T.pendingClaims) },
              [T.observations]: { error: permissionDenied(T.observations) },
              [T.sources]: { error: permissionDenied(T.sources) },
            },
            { tab },
          ),
        ],
        // One read failing while its neighbours succeed: only the registry
        // refused, so the claims render and an extra state line appears inside
        // the list surface.
        [
          "registry refused",
          await renderClaims(
            healthyScript({ [T.sources]: { error: permissionDenied(T.sources) } }),
            { tab },
          ),
        ],
      ];
      for (const [name, markup] of states) {
        // `nested` empty is the second half: a hook can be unique and still
        // swallow its neighbour's state cards.
        expect(surfaceHooks(markup, HOOKS), `${tab}: ${name}`).toEqual({
          counts,
          nested: [],
        });
      }
    }
  });

  it("keeps each surface's own rows and window line inside its own hook", async () => {
    // A hook that is unique but points at the wrong surface is the same bug
    // wearing a different hat, so each name is checked against what that
    // surface actually reads.
    const $ = cheerio.load(await renderClaims(healthyScript()));

    expect($(SURFACE_HOOKS.buckets).find("[data-bucket]").length).toBeGreaterThan(0);
    expect($(SURFACE_HOOKS.claims).find("[data-claim]").length).toBeGreaterThan(0);
    expect($(SURFACE_HOOKS.claims).find('[data-window="claims"]').length).toBe(1);

    // The bucket table and the claim list never bleed into each other, and the
    // gauge holds neither.
    expect($(SURFACE_HOOKS.buckets).find("[data-claim], [data-window]").length).toBe(0);
    expect($(SURFACE_HOOKS.claims).find("[data-bucket]").length).toBe(0);
    expect($(SURFACE_HOOKS.gauge).find("[data-claim], [data-bucket]").length).toBe(0);
  });
});

/* ── what this page COSTS, and what each read of it may claim ────────────── */

/**
 * The reads themselves (campaign admin-window/BUG-0138).
 *
 * The bug was never a slow query: `/claims` awaited a COMPLETE read of the
 * view, then a second leg over `observations` chunked 100 ids at a time, then
 * the registry, then the gauge — ~14 requests in a chain, 2.9-3.8 s of warm
 * server time on staging's 877 claims (Ben, walking the M2 endgame instance,
 * 2026-09-09). What is graded here is therefore the SHAPE of the read, on the
 * one artefact that can show it offline: the stub's own call log.
 */
describe("the reads this page makes", () => {
  /** Every step one call recorded, as `method(arg, …)` — readable in a diff. */
  function shapeOf(call: RecordedCall): string {
    return call.steps
      .map((step) => `${step.method}(${step.args.map((arg) => JSON.stringify(arg)).join(", ")})`)
      .join(".");
  }

  const callsOver = (stub: StubClient, table: string) =>
    stub.calls.filter((call) => call.table === table);

  /**
   * Criterion 1's pin, and the fixture that would have caught the defect: the
   * same page, over a view holding 20 claims and over one holding 2,000.
   */
  function viewOf(size: number): Script {
    const claims = Array.from({ length: size }, (_, index) =>
      pendingClaimRow(index % 2 === 0 ? "agreeing" : "awaiting_row", {
        observation_id: `0192eeee-0000-7000-8000-${String(index).padStart(12, "0")}`,
        source_id: index % 3 === 0 ? SOURCE.first : SOURCE.second,
        domain: index % 2 === 0 ? "events" : "groups",
        observed_at: new Date(Date.UTC(2026, 0, 1) + index * 1000).toISOString(),
      }),
    );
    return {
      [T.pendingClaims]: claimView(claims),
      [T.observations]: { data: [] },
      [T.sources]: { data: [...REGISTRY], count: REGISTRY.length },
    };
  }

  it("page cost is invariant to the size of the view", async () => {
    // `Date` is frozen for the pair, and that is this assertion's own doing:
    // the gauge's window read carries the instant it was made over, so two
    // renders a few milliseconds apart differ in the last digits of one `gte`
    // and in nothing else.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-10T12:00:00.000Z"));
    const small = await renderWithStub(viewOf(20));
    const large = await renderWithStub(viewOf(2000));
    vi.useRealTimers();

    // The same requests, in the same shapes, over a view a hundred times
    // bigger. Not "about the same number" — the same log.
    expect(large.stub.calls.map(shapeOf)).toEqual(small.stub.calls.map(shapeOf));
    expect(large.stub.tablesRead()).toEqual(small.stub.tablesRead());

    // Every read over the view asks for a FIXED number of rows: the list's
    // window, one row for a bucket's oldest seek, or the gauge's own cap
    // (admin-window/TASK-0074 moved the gauge's claims leg onto this view,
    // where it carries the cap it always carried over `observations`). Three
    // declared caps, none of which is a function of the 2,000 rows the view
    // holds — which is the invariance this test is named for. The complete
    // read and its ROW_CAP are still gone; what a `range` may be here is the
    // list's window at an explicit offset (admin-window/TASK-0065), which is
    // the same fixed number of rows spelled the way a paged read spells it.
    for (const call of callsOver(large.stub, T.pendingClaims)) {
      const limit = call.steps.find((step) => step.method === "limit")?.args[0];
      const range = call.steps.find((step) => step.method === "range")?.args as
        | [number, number]
        | undefined;
      if (isCountLeg(call)) {
        // A COUNT asks for NO rows at all — `limit(0)`, and never a range
        // (admin-window/BUG-0210). Zero is as fixed a number as the caps
        // below, so the invariance this test is named for still holds.
        expect(Number(limit), shapeOf(call)).toBe(0);
        expect(range, shapeOf(call)).toBeUndefined();
        continue;
      }
      if (limit !== undefined) {
        expect([1, CLAIM_WINDOW, PENDING_CLAIMS_DEFAULTS.limit], shapeOf(call)).toContain(
          Number(limit),
        );
      }
      if (range !== undefined) {
        expect(range[1] - range[0] + 1, shapeOf(call)).toBe(CLAIM_WINDOW);
      }
      // A ROW read carries ONE bound, never both.
      expect(
        [limit !== undefined, range !== undefined].filter(Boolean),
        shapeOf(call),
      ).toHaveLength(1);
    }

    // And the 2,000-row view really did render: the window's rows, and a count
    // far larger than them.
    expect(claimIds(large.markup)).toHaveLength(CLAIM_WINDOW);
    expect(
      Number(cheerio.load(large.markup)('[data-window="claims"]').attr("data-window-held")),
    ).toBe(2000);
  });

  it("issues two window reads, six counts and five oldest seeks, and no more", async () => {
    const { stub } = await renderWithStub(viewOf(200));
    const overView = callsOver(stub, T.pendingClaims);

    const counts = overView.filter((call) => isCountLeg(call));
    const rowReads = overView.filter((call) => !counts.includes(call));
    /** The number of rows a row read asked for, however it spelled the bound. */
    const boundOf = (call: RecordedCall): number | undefined => {
      const limit = call.steps.find((step) => step.method === "limit")?.args[0];
      if (limit !== undefined) return Number(limit);
      const range = call.steps.find((step) => step.method === "range")?.args as
        | [number, number]
        | undefined;
      return range === undefined ? undefined : range[1] - range[0] + 1;
    };
    // The renderable total plus one per bucket — one count per question,
    // because PostgREST refuses the grouped read (PGRST123, measured).
    expect(counts).toHaveLength(1 + RENDERED_BUCKETS.length);
    // TWO windows — the list's and the GAUGE's — and one `limit 1` seek per
    // bucket. The gauge's is the second one since admin-window/TASK-0074: its
    // claims leg used to be a chunked `.in()` over the ids the `observations`
    // scan returned, which cost the page the same rows and three more
    // SEQUENTIAL waits. One request replaced it, and it is issued beside the
    // scan rather than after it.
    expect(rowReads).toHaveLength(2 + RENDERED_BUCKETS.length);
    expect(rowReads.filter((call) => boundOf(call) === 1)).toHaveLength(
      RENDERED_BUCKETS.length,
    );
    const windows = rowReads.filter((call) => boundOf(call) !== 1);
    // The list's window is a `.range()` at an explicit offset since
    // admin-window/TASK-0065; the gauge's scan is still a `.limit()`. Both ask
    // for a fixed number of rows, which is what this census is counting.
    expect(windows.map(boundOf)).toEqual([CLAIM_WINDOW, PENDING_CLAIMS_DEFAULTS.limit]);
    expect(
      windows[0].steps.filter((step) => step.method === "range").map((step) => step.args),
    ).toEqual([[0, CLAIM_WINDOW - 1]]);
    // Neither of them is an id-set lookup any more: no read this page makes
    // over the view filters on a list of ids some other read produced.
    expect(
      overView.filter((call) => call.steps.some((step) => step.method === "in")),
    ).toHaveLength(0);

    // The registry is read once, and the observations table only by the gauge.
    expect(callsOver(stub, T.sources)).toHaveLength(1);
    expect(stub.tablesRead().filter((name) => name === T.observations).length).toBe(1);
  });

  it("narrows every count and the window server-side, and re-sorts nothing", async () => {
    const { stub } = await renderWithStub(viewOf(200), {
      source_id: SOURCE.first,
      domain: "events",
    });
    const overView = callsOver(stub, T.pendingClaims);
    expect(overView.length).toBeGreaterThan(1);

    // The POPULATION counts are the reads that must NOT carry the facets: they
    // answer "what does this surface hold with no URL facet at all", and
    // narrowing one would make that population equal its rendered set, so no
    // surface would ever name its scope again (BUG-0141's rule on `/queues`).
    // Every other read of the view carries the whole narrowing.
    //
    // There are TWO of them, over two different sets, and the window bound is
    // what tells them apart (admin-window/BUG-0163): the LIST's population is
    // the whole view, and the GAUGE's is the same view inside the gauge's own
    // window — a count with no facet is not fact 2 of a surface whose set is a
    // window, since a window empty because nothing was observed in 90 days
    // would be reported as one a facet emptied.
    const population = overView.filter(
      (call) => !call.steps.some((step) => step.method === "eq"),
    );
    const windowed = population.filter((call) =>
      call.steps.some((step) => step.method === "gte" && step.args[0] === "observed_at"),
    );
    expect(
      population.filter((call) => !windowed.includes(call)),
      "the unnarrowed population count",
    ).toHaveLength(1);
    expect(windowed, "the unnarrowed population count inside the gauge window").toHaveLength(1);

    // …and the reads that carry the narrowing MINUS ONE FAMILY, which is the
    // other kind of read that must not carry the whole of it
    // (admin-window/BUG-0192). They answer "did the chip family remove any of
    // these rows", so the chip facets are exactly what they drop and the
    // control-less ones are exactly what they keep — a count carrying the
    // source as well could never differ from the rendered set, and the clause
    // it decides would never render again. There are two, for the same two
    // sets the two population counts above answer for, told apart the same
    // way.
    const withoutChips = overView.filter((call) => {
      const eqs = call.steps
        .filter((step) => step.method === "eq")
        .map((step) => String(step.args[0]));
      return eqs.length > 0 && !eqs.includes("source_id") && !eqs.includes("bucket");
    });
    for (const call of withoutChips) {
      const eqs = call.steps
        .filter((step) => step.method === "eq")
        .map((step) => `${step.args[0]}=${step.args[1]}`);
      expect(eqs, shapeOf(call)).toEqual(["domain=events"]);
      // A bounded count and never a row read — the shape the two-fact rule
      // prescribes for a fact it costs a query, GET-shaped over zero rows so
      // an absent view answers with its own body (admin-window/BUG-0210).
      expect(
        call.steps.find((step) => step.method === "select")?.args[1],
        shapeOf(call),
      ).toEqual({ count: "exact" });
      expect(isCountLeg(call), shapeOf(call)).toBe(true);
    }
    const windowedWithoutChips = withoutChips.filter((call) =>
      call.steps.some((step) => step.method === "gte" && step.args[0] === "observed_at"),
    );
    expect(
      withoutChips.filter((call) => !windowedWithoutChips.includes(call)),
      "the chip-family-dropped count over the view",
    ).toHaveLength(1);
    expect(
      windowedWithoutChips,
      "the chip-family-dropped count inside the gauge window",
    ).toHaveLength(1);

    for (const call of overView.filter(
      (call) => !population.includes(call) && !withoutChips.includes(call),
    )) {
      const eqs = call.steps
        .filter((step) => step.method === "eq")
        .map((step) => `${step.args[0]}=${step.args[1]}`);
      // Every read of the view — count, window and seek alike — carries the
      // page's narrowing as `.eq()` on the query, never as a filter over rows.
      expect(eqs, shapeOf(call)).toContain(`source_id=${SOURCE.first}`);
      expect(eqs, shapeOf(call)).toContain("domain=events");
      // ...and the parked bucket is excluded on every one of them.
      expect(
        call.steps.some(
          (step) =>
            step.method === "neq" && step.args[0] === "bucket" && step.args[1] === PARKED,
        ),
        shapeOf(call),
      ).toBe(true);
    }

    // The population count DEBT-0008's fact 2 needs is issued only where a
    // facet could have removed a row, and it carries no facet of its own —
    // the shape `/queues` landed on (admin-window/DEBT-0012, BUG-0135).
    const bare = await renderWithStub(viewOf(200));
    expect(callsOver(bare.stub, T.pendingClaims).length).toBeLessThan(overView.length);
  });

  it("draws the list in the order the DATABASE returned it", async () => {
    // A database that answers the window read in a deliberately wrong order:
    // if the page re-sorted, this would come out right anyway. It must not.
    const claims = CLAIMS.filter((claim) => claim.bucket !== PARKED);
    const reversed = (call: RecordedCall) => {
      const answer = claimView(claims)(call);
      return Array.isArray(answer.data)
        ? { ...answer, data: [...answer.data].reverse() }
        : answer;
    };
    const markup = await renderClaims(
      healthyScript({ [T.pendingClaims]: reversed }),
    );
    expect(claimIds(markup)).toEqual([...oldestFirst(SHOWABLE)].reverse());
  });
});

/* ── one refused leg never takes another leg's rows down ─────────────────── */

/**
 * Criterion 5 (admin-window/BUG-0138): the legs are independent, so each keeps
 * its own `DbResult` and its own rendering. A page that composed them into one
 * result would fail every case here by rendering one refusal for all of them —
 * the shape ARCHITECTURE.md's common violations row 14 names.
 */
describe("each read answers for itself", () => {
  /** A `pending_claims` whose COUNT reads refuse while its row reads answer. */
  function countsRefuse(refusal: unknown, only?: string): (call: RecordedCall) => ReturnType<ReturnType<typeof claimView>> {
    return (call) => {
      const head = isCountLeg(call);
      const bucket = call.steps.find(
        (step) => step.method === "eq" && step.args[0] === "bucket",
      )?.args[1];
      if (head && (only === undefined || bucket === only)) {
        return { data: null, error: refusal };
      }
      return claimView(CLAIMS)(call);
    };
  }

  it("renders ONE bucket's refusal in its own row, and the others' counts", async () => {
    const markup = await renderClaims(
      healthyScript({
        [T.pendingClaims]: countsRefuse(permissionDenied(T.pendingClaims), "escalated"),
      }),
    );
    const $ = cheerio.load(markup);

    // Every bucket still has a row...
    expect(
      $("[data-bucket]").toArray().map((element) => $(element).attr("data-bucket")),
    ).toEqual(RENDERED_BUCKETS);
    // ...the four that answered carry their real counts...
    for (const row of bucketRows(markup).filter((row) => row.bucket !== "escalated")) {
      expect(row.claims, row.bucket).toBe(inBucket(row.bucket).length);
    }
    // ...and the one that refused says so, in that row, naming the view.
    const escalated = $('[data-bucket="escalated"]').closest("tr");
    expect(escalated.find("[data-bucket-claims]")).toHaveLength(0);
    expect(escalated.find(`[data-read-failed="${T.pendingClaims}"]`)).toHaveLength(1);
    // The list is untouched: every claim still renders.
    expect(claimIds(markup)).toEqual(oldestFirst(SHOWABLE));
  });

  it("keeps the rows when the count that would state the window line refuses", async () => {
    const markup = await renderClaims(
      healthyScript({
        [T.pendingClaims]: countsRefuse(permissionDenied(T.pendingClaims)),
      }),
    );
    const $ = cheerio.load(markup);
    // The window read answered, so the claims render...
    expect(claimIds(markup)).toEqual(oldestFirst(SHOWABLE));
    // ...but the LINE does not stand: a `held` nobody counted is not a number
    // this page may print, and the rows' own length is exactly what a window
    // line may never be (§4.3).
    expect($('[data-window="claims"]')).toHaveLength(0);
    // The refusal is reported on its own sub-surface, inside the list.
    expect($('[data-surface="claims_count"]')).toHaveLength(1);
    expect(
      $('[data-surface="claims"]').find('[data-surface="claims_count"]'),
    ).toHaveLength(1);
  });

  it("costs the LABELS and the chip vocabulary, and nothing else, when the registry refuses", async () => {
    const markup = await renderClaims(
      healthyScript({ [T.sources]: { error: permissionDenied(T.sources) } }),
    );
    const $ = cheerio.load(markup);
    expect(claimIds(markup)).toEqual(oldestFirst(SHOWABLE));
    for (const claim of SHOWABLE) {
      expect(claimRow(markup, claim.observation_id).sourceLabel).toBe(claim.source_id);
    }
    expect($(`[data-read-failed="${T.sources}"]`)).toHaveLength(1);
    // Every count and the window still stand: the registry names nothing they
    // needed.
    expect($('[data-window="claims"]')).toHaveLength(1);
    for (const row of bucketRows(markup)) {
      expect(row.claims, row.bucket).toBe(inBucket(row.bucket).length);
    }
  });
});

/* ── the affordance that continues the list ──────────────────────────────── */

/**
 * `/claims` draws the paging affordance only where it can be honoured, and
 * pages past the window — campaign admin-window/TASK-0067, SPEC F14.
 *
 * **The first screen does not change.** Every case below asserts the rows and
 * the window line the page renders BESIDE whatever it draws underneath, so a
 * wrapper that re-ordered, re-sorted or re-counted the server-rendered window
 * fails here rather than on a walk. Measured as byte identity against the
 * pre-ticket tree once, out of band, on seven fixtures (the ticket's History
 * carries the numbers); what stands in the suite is the property.
 *
 * **The drawing rule is the PAGE's, and it has three parts** — a COUNT that
 * established there is more, rows that are a bound this surface can page from,
 * and an `ok` read that drew something. The four honest arms where the answer
 * is "no affordance at all" are each a case below, and the not-provisioned one
 * is graded for every surface of the window at once in
 * `tests/offline/absence/pages.test.ts` rather than here.
 *
 * What is NOT re-proved here, because it is the widget's and the driver's and
 * is pinned where they live (`tests/offline/ui/paging.test.ts`,
 * `tests/offline/paging/machine.test.ts`): the arms the controls draw
 * from props, the double-press guard, and what an answer does to a row list.
 */

/** One claim row of a long population, built so ids and instants both ascend. */
function longClaim(index: number, bucket: PendingClaimBucket = "escalated") {
  return pendingClaimRow(bucket, {
    observation_id: `01920000-0000-7000-8000-0000000009${String(index).padStart(2, "0")}`,
    observed_at: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
  });
}

/** A population of `count` claims, oldest first by construction. */
function longPopulation(count: number, bucket: PendingClaimBucket = "escalated") {
  return Array.from({ length: count }, (_, index) => longClaim(index, bucket));
}

/** A database whose claims view holds more rows than one window. */
function pagedScript(count = 130, bucket: PendingClaimBucket = "escalated"): Script {
  return healthyScript({ [T.pendingClaims]: claimView(longPopulation(count, bucket)) });
}

/** A database whose claims view answers rows but refuses every COUNT. */
function countRefusesScript(rows: number, error: unknown): Script {
  const view = claimView(longPopulation(rows));
  return healthyScript({
    [T.pendingClaims]: (call) => (isCountLeg(call) ? { error } : view(call)),
  });
}

/** Every paging element in the markup, by the arm it drew. */
function pagingArms(markup: string): string[] {
  const $ = cheerio.load(markup);
  return $("[data-paging]")
    .toArray()
    .map((element) => $(element).attr("data-paging") ?? "");
}

/** How many times the paging hook is spelled at all — refusals included. */
function pagingOccurrences(markup: string): number {
  return (markup.match(/data-paging/g) ?? []).length;
}

/** Every move link in the markup, by the direction it offers, in order. */
function movesOf(markup: string): string[] {
  const $ = cheerio.load(markup);
  return $("[data-paging-move]")
    .toArray()
    .map((element) => $(element).attr("data-paging-move") ?? "");
}

/** The window one address or request names, read as the guard reads it. */
function windowOf(url: string): PageWindow | null {
  const query = new URLSearchParams(url.split("?")[1]);
  const bound = windowBound({ page: query.get(PAGE_PARAM), size: query.get(SIZE_PARAM) });
  return bound.kind === "ok" ? bound.window : null;
}

/** A recording stub for the ONE network call this app makes. */
function recordingFetch(answer: PageAnswer<ClaimLine>): string[] {
  const urls: string[] = [];
  vi.stubGlobal("fetch", (url: string) => {
    urls.push(url);
    // `Response.json`, because that is what `/api/admin/claims/rows` really
    // answers with (its three `Response.json(...)` returns) and `fetchJson`
    // now reads the DECLARED content type before it reads a body
    // (admin-window/TASK-0076). `new Response(JSON.stringify(...))` declares
    // `text/plain`, which is the wire shape of something that is NOT this
    // app's route — the measured expired-session login page.
    return Promise.resolve(Response.json(answer));
  });
  return urls;
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** The window line's own figures, as the live oracle reads them. */
function windowFigures(markup: string) {
  const line = cheerio.load(markup)('[data-window="claims"]');
  return {
    lines: line.length,
    limit: Number(line.attr("data-window-limit")),
    held: Number(line.attr("data-window-held")),
    truncated: line.attr("data-window-truncated") === "true",
    from: Number(line.attr("data-window-from")),
    drawn: Number(line.attr("data-window-drawn")),
  };
}

describe("the window that moves the claim list", () => {
  beforeEach(() => {
    paging.calls = [];
    paging.goTo = null;
    paging.override = null;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    // An override left standing would be drawn by every later render of a
    // surface that windows — which, under page windows, is every `ok` read
    // with a count beside it.
    paging.override = null;
    paging.calls = [];
  });

  /** The page's own deps, as it handed them to the driver. */
  const depsOf = () => paging.calls[0].deps as Omit<PageDeps<ClaimLine>, "fetchJson">;
  const initialOf = () => paging.calls[0].initial as unknown as PageState<ClaimLine>;
  const answering = (state: PageState<ClaimLine>, to: PageWindow, answer: unknown) =>
    requestPage<ClaimLine>(state, { ...depsOf(), fetchJson: () => Promise.resolve(answer) }, to);
  const okFor = (window: PageWindow, rows: ClaimLine[]): PageAnswer<ClaimLine> => ({
    kind: "ok",
    rows,
    page: window.page,
    size: window.size,
    exhausted: rows.length < window.size,
  });
  const lineText = (markup: string): string =>
    cheerio.load(markup)('[data-window="claims"]').text().replace(/\s+/g, " ").trim();
  const lineHtml = (markup: string): string =>
    cheerio.load(markup)('[data-window="claims"]').toString();
  const idsOf = (claims: readonly PendingClaimRow[], from: number, to: number): string[] =>
    claims.slice(from, to).map((claim) => claim.observation_id);

  it.each([
    ["the first window, by default", {}, [0, 50], { limit: 50, from: 1, drawn: 50, truncated: true }, "more", ["next"]],
    ["rows 21–40", { [PAGE_PARAM]: "2", [SIZE_PARAM]: "20" }, [20, 40], { limit: 20, from: 21, drawn: 20, truncated: true }, "more", ["previous", "next"]],
    ["the last window, short", { [PAGE_PARAM]: "3" }, [100, 130], { limit: 50, from: 101, drawn: 30, truncated: false }, "exhausted", ["previous"]],
    ["rows 101–130 at 100, the whole rest", { [PAGE_PARAM]: "2", [SIZE_PARAM]: "100" }, [100, 130], { limit: 100, from: 101, drawn: 30, truncated: false }, "exhausted", ["previous"]],
    ["an empty window past the end", { [PAGE_PARAM]: "4" }, [150, 150], { limit: 50, from: 151, drawn: 0, truncated: false }, "exhausted", ["previous"]],
  ] as const)("renders %s for the address, with the controls ABOVE the rows and the line stating the window", async (_what, params, [from, to], figures, arm, moves) => {
    const claims = longPopulation(130);
    const markup = await renderClaims(pagedScript(130), { ...params });

    // The rows are the window the address names — and nothing else.
    expect(claimIds(markup)).toEqual(idsOf(claims, from, to));
    expect(windowFigures(markup)).toEqual({ lines: 1, held: 130, ...figures });
    expect(pagingArms(markup)).toEqual([arm]);
    expect(movesOf(markup)).toEqual([...moves]);
    expect(lineText(markup)).not.toContain("did not fill");

    const $ = cheerio.load(markup);
    // ABOVE the list (LOOK_AND_FEEL bar 14): inside the list's own surface,
    // before its table, and nothing of the affordance after the last row.
    const surface = $('[data-surface="claims"]');
    expect(surface.find("[data-paging]")).toHaveLength(1);
    const html = surface.html() ?? "";
    expect(html.indexOf("data-paging")).toBeLessThan(html.indexOf("<table"));
    expect(html.slice(html.lastIndexOf("</table>"))).not.toMatch(/data-paging/);
    // Every move link is this surface's own address at the neighbouring
    // window, and the size chips keep the row the operator is reading from.
    for (const move of moves) {
      const href = $(`[data-paging-move="${move}"]`).attr("href") ?? "";
      expect(href.startsWith(CLAIMS_PATH), move).toBe(true);
      expect(windowOf(href), move).toEqual({
        page: figures.from === 1 ? 2 : Math.floor((figures.from - 1) / figures.limit) + (move === "next" ? 2 : 0),
        size: figures.limit,
      });
    }
    expect($('[data-paging-size][aria-current="true"]').attr("data-paging-size")).toBe(String(figures.limit));
    for (const size of WINDOW_SIZES) {
      expect(windowOf($(`[data-paging-size="${size}"]`).attr("href") ?? ""), String(size)).toEqual({
        page: Math.floor((figures.from - 1) / size) + 1,
        size,
      });
    }
  });

  it("draws no paging element where the read refused, the count refused, or the first window is empty — and keeps the first screen's words there", async () => {
    // A REFUSED or ABSENT count: the window line needs the count, and a
    // control drawn without it would be the page claiming a window it cannot
    // state (§4.3, LESSONS 2). Both spellings of "no count" (LESSONS 8).
    for (const [why, error] of [
      ["a count that failed", permissionDenied(T.pendingClaims)],
      ["a count of an absent view", tableNotInSchemaCache(T.pendingClaims)],
    ] as const) {
      const refused = await renderClaims(countRefusesScript(130, error));
      expect(claimIds(refused), why).toHaveLength(CLAIM_WINDOW);
      expect(pagingOccurrences(refused), why).toBe(0);
      expect(cheerio.load(refused)('[data-surface="claims_count"]'), why).toHaveLength(1);
    }
    // An EMPTY first window: the Empty card and the window line stand exactly
    // as they did (admin-window/BUG-0070), and no control over no rows.
    const empty = await renderClaims(healthyScript({ [T.pendingClaims]: claimView([]) }));
    expect(claimIds(empty)).toEqual([]);
    expect(windowFigures(empty).held).toBe(0);
    expect(cheerio.load(empty)("[data-empty]")).toHaveLength(1);
    expect(pagingOccurrences(empty)).toBe(0);
    // A read that REFUSED, and an absent view: the state they render today.
    for (const error of [transportFailure(), tableNotInSchemaCache(T.pendingClaims)]) {
      expect(pagingOccurrences(await renderClaims(healthyScript({ [T.pendingClaims]: { error } })))).toBe(0);
    }
    // The small complete set this file's own population is: nothing to move.
    const complete = await renderClaims(healthyScript());
    expect(claimIds(complete)).toEqual(oldestFirst(SHOWABLE));
    // No more rows than the smallest size: no size changes the screen, so no
    // control is drawn at all.
    expect(SHOWABLE.length).toBeLessThanOrEqual(WINDOW_SIZES[0]);
    expect(pagingOccurrences(complete)).toBe(0);
  });

  /*
   * "states each read as its own where the count and the window disagree, and still offers the sizes" stood here until 2026-10-21.
   *
   * It read the claim list's window SENTENCE. Ben deleted every window-line
   * sentence in the app on 2026-10-21, so the line publishes its facts as
   * `data-window-*` hooks and says nothing at all. The read's honesty is still
   * graded — limit, held, truncated, from, drawn and oldest are each pinned in
   * `tests/offline/ui/primitives.test.ts`, and the cases still passing in this
   * very describe grade them on this page — but the English this case asserted
   * no longer exists.
   */

  it.each([
    ["a page that is a word", { [PAGE_PARAM]: "abc" }, PAGE_PARAM],
    ["page zero", { [PAGE_PARAM]: "0" }, PAGE_PARAM],
    ["a size this app does not offer", { [SIZE_PARAM]: "30" }, SIZE_PARAM],
    ["a page past the ceiling", { [PAGE_PARAM]: String(largestPage(50) + 1) }, PAGE_PARAM],
  ] as const)("refuses an address naming %s BY NAME: no list read, no rows, no control, and the first window offered", async (_what, params, param) => {
    const { markup, stub } = await renderWithStub(pagedScript(130), { source_id: SOURCE.first, ...params });
    const $ = cheerio.load(markup);
    const refusal = $(`[data-window-refused="${param}"]`);
    expect(refusal).toHaveLength(1);
    expect(refusal.attr("role")).toBe("alert");
    expect(claimIds(markup)).toEqual([]);
    expect($('[data-window="claims"]')).toHaveLength(0);
    expect(pagingOccurrences(markup)).toBe(0);
    expect(paging.calls).toEqual([]);
    // No window of the list was read: the view was asked only for counts.
    const rowReads = stub.calls.filter(
      (call) => call.table === T.pendingClaims && !isCountLeg(call) && call.steps.some((step) => step.method === "range"),
    );
    expect(rowReads).toEqual([]);
    // The way back carries the narrowing this page applied, and nothing names
    // the window's parameters as "dropped" — they were refused by name.
    const back = refusal.find("a").attr("href") ?? "";
    expect(back.startsWith(CLAIMS_PATH)).toBe(true);
    expect(new URLSearchParams(back.split("?")[1]).get("source_id")).toBe(SOURCE.first);
    expect($("[data-dropped-param]")).toHaveLength(0);
    // The VALUE is never echoed (`tests/offline/absence/in-window.test.ts`).
    expect(refusal.text()).not.toContain(String(Object.values(params)[0]));
  });

  it("hands the client provider DATA only, and seeds it with the window the address named", async () => {
    // admin-window/BUG-0226: a function prop takes both paged pages to 500,
    // and no offline render can see it — so the VALUE handed across is graded.
    const claims = longPopulation(130);
    await renderClaims(pagedScript(130), { [PAGE_PARAM]: "2", [SIZE_PARAM]: "20" });
    const { initial, deps, window } = paging.calls[0];
    expect(functionPaths({ initial, deps, window })).toEqual([]);

    const seeded = initialOf();
    expect(seeded.window).toEqual({ page: 2, size: 20 });
    expect(seeded.rows.map((row) => row.observationId)).toEqual(idsOf(claims, 20, 40));
    expect(seeded.exhausted).toBe(false);
    expect(seeded.status).toBe("idle");
    expect(seeded.notes).toBeNull();
    // The screen signature names the ids this screen drew, so a server
    // screen re-rendered under a kept client state is told apart.
    expect(seeded.screen).toContain(idsOf(claims, 20, 21)[0]);
    expect(seeded.screen).not.toBe("");
    expect(depsOf()).toEqual({
      route: PAGE_ROUTES.claims,
      path: CLAIMS_PATH,
      params: "",
      idKey: OBSERVATION_ID,
    });
  });

  it("one move issues one request for the window asked, carrying the narrowing the page APPLIED and no parameter it dropped", async () => {
    // admin-window/BUG-0141: a facet the page could not read narrowed no row
    // above, so it must not narrow the rows a move draws. The bucket below is
    // outside the offered vocabulary and the page drops it; the source is
    // real and the page applies it.
    const urls = recordingFetch(okFor({ page: 2, size: 50 }, []));
    const markup = await renderClaims(pagedScript(130), { source_id: SOURCE.first, bucket: "not_a_bucket" });
    expect(pagingArms(markup)).toEqual(["more"]);
    const carried = new URLSearchParams(depsOf().params);
    expect([...carried.keys()]).toEqual(["source_id"]);
    expect(depsOf().params).not.toContain("not_a_bucket");

    // Zero moves, zero requests: the first screen is the server's.
    expect(urls).toEqual([]);
    paging.goTo?.({ page: 2, size: 50 });
    await settle();
    expect(urls).toHaveLength(1);
    expect(urls[0].startsWith(PAGE_ROUTES.claims)).toBe(true);
    const asked = new URLSearchParams(urls[0].split("?")[1]);
    expect(asked.get("source_id")).toBe(SOURCE.first);
    expect(asked.get("bucket")).toBeNull();
    expect(windowOf(urls[0])).toEqual({ page: 2, size: 50 });

    // The standing tab travels by the tab, never as a bucket nobody can see.
    paging.calls = [];
    await renderClaims(pagedScript(130, STANDING_BUCKET), { tab: "standing" });
    const standing = new URLSearchParams(depsOf().params);
    expect(standing.get("tab")).toBe("standing");
    expect(standing.get("bucket")).toBeNull();
  });

  it("a refused move leaves the window exactly as it was and names the object; a landed move REPLACES it", async () => {
    const claims = longPopulation(130);
    const script = pagedScript(130);
    const first = await renderClaims(script);
    expect(claimIds(first)).toEqual(idsOf(claims, 0, 50));
    const initial = initialOf();
    const to: PageWindow = { page: 2, size: 50 };

    // A. the move that must REFUSE — the view went away between two reads:
    //    the clause, and no control of any kind (admin-window/BUG-0211).
    paging.override = await answering(initial, to, { kind: "not_provisioned", missing: T.pendingClaims });
    const afterRefusal = await renderClaims(script);
    expect(claimIds(afterRefusal)).toEqual(idsOf(claims, 0, 50));
    const $ = cheerio.load(afterRefusal);
    expect($("[data-paging-refusal]")).toHaveLength(1);
    expect($("[data-paging-refusal]").text()).toContain(T.pendingClaims);
    expect($("table").find("[data-paging-refusal]")).toHaveLength(0);
    expect(pagingArms(afterRefusal)).toEqual([]);
    expect($("[data-paging-move], [data-paging-size]")).toHaveLength(0);
    expect(lineHtml(afterRefusal)).toBe(lineHtml(first));

    // A′. THE MUST-NOT-FLAG TWIN (LESSONS 8): a READ that failed is retryable,
    //     so the controls stand and the line is what it was.
    paging.override = await answering(initial, to, {
      kind: "error",
      reading: T.pendingClaims,
      message: "canceling statement due to statement timeout",
    });
    const afterReadFailure = await renderClaims(script);
    expect(claimIds(afterReadFailure)).toEqual(idsOf(claims, 0, 50));
    expect(cheerio.load(afterReadFailure)("[data-paging-refusal]")).toHaveLength(1);
    expect(pagingArms(afterReadFailure)).toEqual(["more"]);
    expect(lineHtml(afterReadFailure)).toBe(lineHtml(first));

    // B. the move that LANDS: window 2, and ONLY window 2, under a line that
    //    says so — the first window's rows are gone, not appended to.
    paging.override = await answering(initial, to, okFor(to, claimLines(claims.slice(50, 100), new Map())));
    const afterMove = await renderClaims(script);
    expect(claimIds(afterMove)).toEqual(idsOf(claims, 50, 100));
    expect(cheerio.load(afterMove)("[data-paging-refusal]")).toHaveLength(0);
    expect(windowFigures(afterMove)).toEqual({ lines: 1, limit: 50, held: 130, truncated: true, from: 51, drawn: 50 });
    expect(movesOf(afterMove)).toEqual(["previous", "next"]);
  });

  /*
   * "the window line in every state a move can end in" stood here until
   * 2026-10-21.
   *
   * It walked the paged window line through every arm a press can land on —
   * drawn, refused, not-provisioned, exhausted, empty — and read the SENTENCE
   * each one said. Ben deleted that prose, so there is no sentence to walk.
   *
   * The arms themselves are still graded, by the cases around this one: the
   * refusal card, the withdrawn control, the rows drawn per address and the
   * `data-window-*` facts a move replaces. What is gone is the English.
   */
});

/* ── two figures on one page never silently disagree (SPEC F15, M3 EC7) ──── */

/**
 * The Claims page prints per-bucket claim counts TWICE and reads them two
 * different ways (campaign admin-window/TASK-0071).
 *
 * The bucket table's counts are `{ count: "exact" }` reads of the
 * WHOLE narrowing, one per bucket. The gauge's bucket distribution is computed
 * over a scan capped at `GAUGE_ROW_CAP` rows. Below that cap the two agree;
 * above it they diverge, and until this ticket nothing on screen said which
 * was which. Staging held 877 claims on 2026-09-11 — this is live within
 * months, not theoretical.
 *
 * The ruling is LABEL, not equalise: capping those counts would make the
 * page's totals wrong rather than windowed, and scanning the whole view to
 * fill the gauge is the ~14-round-trip read admin-window/BUG-0138 removed. So
 * each set of figures says, IN RENDERED TEXT, what kind of fact it is — and no
 * sentence relates the two, because no single read established a relationship
 * between them (LESSONS 2).
 *
 * **This suite's population is deliberately larger than the cap.** Every other
 * fixture in this file is far below it, so on all of them the two figures are
 * equal and the defect is invisible: a test written against `CLAIMS` would
 * grade the labelling vacuously. Non-vacuity is asserted rather than assumed —
 * every bucket really diverges here, in every URL walked.
 *
 * **Its instants are derived from the clock, which is this file's one
 * exception to the fixed-instant rule** (`./population.ts`, "an age fixture
 * that moved with the clock would make a failure unreproducible"). The gauge's
 * window is `[now - 90 days, now)`, so a fixed instant falls out of it as the
 * calendar moves and the divergence this suite exists to produce would quietly
 * stop happening. Nothing here asserts on an AGE — only on counts, which are
 * fully determined by the row INDEX — so a failure is still reproducible.
 */
const OVER_CAP_CLAIMS = 3_600;

/**
 * A population well BELOW the cap, built the same way — the twin fixture
 * (LESSONS 8). The suite's other fixtures are below the cap too, but not one
 * of them has the two figures EQUAL: `CLAIMS` deliberately holds a claim with
 * no `observations` row, so the gauge's window is one short of the view and
 * the small case would grade agreement over a divergence.
 */
const UNDER_CAP_CLAIMS = 300;

/** The three sources and two domains the over-cap population spreads across. */
const OVER_CAP_SOURCES = [SOURCE.first, SOURCE.second, SOURCE.third];
const OVER_CAP_DOMAINS = ["events", "venues"];

/**
 * One claim per row, round-robin across buckets, sources and domains — the
 * cycle lengths (5, 3, 2) are pairwise coprime, so every combination of the
 * three appears the same number of times and every bucket has claims under
 * every facet this suite walks.
 *
 * Oldest first by index: row 0 is the oldest, so the scan's cap keeps rows
 * `0 … ROW_CAP - 1` and drops the rest.
 */
const OVER_CAP_BASE = Date.now();

function scaledRows(total: number): PendingClaimRow[] {
  return Array.from({ length: total }, (_unused, index) =>
    pendingClaimRow(
      RENDERED_BUCKETS[index % RENDERED_BUCKETS.length] as PendingClaimBucket,
      {
        observation_id: `01930000-0000-7000-8000-${String(index).padStart(12, "0")}`,
        source_id: OVER_CAP_SOURCES[index % OVER_CAP_SOURCES.length],
        domain: OVER_CAP_DOMAINS[index % OVER_CAP_DOMAINS.length],
        observed_at: new Date(OVER_CAP_BASE - (total - index) * 60_000).toISOString(),
      },
    ),
  );
}

const OVER_CAP_ROWS = scaledRows(OVER_CAP_CLAIMS);
const UNDER_CAP_ROWS = scaledRows(UNDER_CAP_CLAIMS);

/**
 * The database behind one of those populations.
 *
 * `claimView` is the fixture DATABASE — it answers the query it was asked,
 * whatever rows it holds — so the `observations` leg is answered by the same
 * one rather than by a second hand-written responder that would drift from it
 * (LESSONS 5). The cast is the whole of what the reuse costs: the parameter is
 * typed for the view this suite's other fixtures use, and the body treats its
 * rows as `Record<string, unknown>` from its first line.
 *
 * Every claim here HAS its observation, so the gauge's window is short of the
 * view for exactly one reason: the scan's cap.
 */
function scaledScript(rows: readonly PendingClaimRow[]): Script {
  const observations = rows.map((claim) =>
    observationRow({
      observation_id: claim.observation_id,
      entity_id: claim.entity_id,
      source_id: claim.source_id,
      domain: claim.domain,
      field: claim.field,
      observed_at: claim.observed_at as string,
      status: "pending",
    }),
  );
  return {
    [T.pendingClaims]: claimView(rows),
    [T.observations]: claimView(observations as unknown as readonly PendingClaimRow[]),
    [T.sources]: { data: [...REGISTRY], count: REGISTRY.length },
  };
}

/** Every claim of a population the URL's source/domain facets keep. */
function scaledMatching(
  rows: readonly PendingClaimRow[],
  params: Record<string, string> = {},
): PendingClaimRow[] {
  return rows.filter(
    (claim) =>
      (params.source_id === undefined || claim.source_id === params.source_id) &&
      (params.domain === undefined || claim.domain === params.domain),
  );
}

/**
 * What the GAUGE's window holds, computed here rather than asked of the app:
 * the narrowed population, oldest first, cut at the scan's cap.
 */
function scaledWindow(
  rows: readonly PendingClaimRow[],
  params: Record<string, string> = {},
): PendingClaimRow[] {
  return [...scaledMatching(rows, params)]
    .sort((left, right) => {
      const at = String(left.observed_at);
      const bt = String(right.observed_at);
      if (at !== bt) return at < bt ? -1 : 1;
      return left.observation_id < right.observation_id ? -1 : 1;
    })
    .slice(0, ROW_CAP);
}

/** How many rows of a set are in one bucket. */
const inOneBucket = (rows: readonly PendingClaimRow[], bucket: string): number =>
  rows.filter((claim) => claim.bucket === bucket).length;

/**
 * A region of figures, by the kind of fact it says they are: the
 * `data-figures` hook, the text of the eyebrow the reader sees, and the
 * per-bucket figure the table inside it drew.
 *
 * The gauge's trend table publishes no per-row hook — it is the shared
 * `TrendTable`, and this ticket adds no hook to a shared component — so its
 * figure is read the way a reader reads it: the row whose first cell is the
 * bucket, and the cell under the `claims` header.
 */
function figureRegion(markup: string, kind: "total" | "window") {
  const $ = cheerio.load(markup);
  const region = $(`[data-figures="${kind}"]`);
  const table = region.find("table");
  const headers = table
    .find("thead th")
    .toArray()
    .map((element) => $(element).text().trim());
  const claimsColumn = headers.indexOf("claims");
  /** The eyebrow's own words, read off the element that carries them. */
  const said = region
    .find(`[data-figures-label="${kind}"]`)
    .text()
    .replace(/\s+/g, " ")
    .trim();
  return {
    regions: region.length,
    said,
    figure(bucket: string): string | undefined {
      const row = table
        .find("tbody tr")
        .toArray()
        .find((element) => $(element).find("td").first().text().trim() === bucket);
      if (row === undefined || claimsColumn < 0) return undefined;
      return $(row).find("td").eq(claimsColumn).text().trim();
    },
  };
}

describe("two figures on one page never silently disagree", () => {
  /**
   * The three URLs the criterion names, each over a population the gauge's
   * scan cannot reach the end of: bare, a source narrowing, and a domain
   * narrowing. Both figures move under all three.
   */
  const WALKED: [string, Record<string, string>][] = [
    ["bare", {}],
    ["source facet", { source_id: SOURCE.second }],
    ["domain facet", { domain: "venues" }],
  ];

  it("prints each bucket's two figures under a label saying which kind it is", async () => {
    for (const [label, params] of WALKED) {
      const markup = await renderClaims(scaledScript(OVER_CAP_ROWS), params);
      const totals = figureRegion(markup, "total");
      const windowed = figureRegion(markup, "window");
      // Exactly one region of each kind, and each says its kind in TEXT a
      // reader sees — never in the attribute alone (M3 EC7).
      expect(totals.regions, label).toBe(1);
      expect(windowed.regions, label).toBe(1);
      expect(totals.said, label).not.toBe("");
      expect(windowed.said, label).not.toBe("");
      expect(totals.said, label).not.toBe(windowed.said);

      for (const bucket of RENDERED_BUCKETS) {
        const whole = inOneBucket(scaledMatching(OVER_CAP_ROWS, params), bucket);
        const inWindow = inOneBucket(scaledWindow(OVER_CAP_ROWS, params), bucket);
        const where = `${label} / ${bucket}`;
        // NON-VACUOUS: this bucket really does read two different numbers in
        // the two places, which is the state the labels exist for.
        expect(whole, where).toBeGreaterThan(inWindow);
        // …and each place printed the figure its own read produced.
        expect(totals.figure(bucket), where).toBe(count(whole));
        expect(windowed.figure(bucket), where).toBe(count(inWindow));
      }
    }
  });

  it("relates the two figures in no sentence, because no read established one", async () => {
    for (const [label, params] of WALKED) {
      const markup = await renderClaims(scaledScript(OVER_CAP_ROWS), params);
      const text = cheerio.load(markup).root().text().replace(/\s+/g, " ");
      // A percentage is a ratio across two reads however it is spelled, and
      // this page has no honest one to print.
      expect(text, label).not.toContain("%");
      for (const bucket of RENDERED_BUCKETS) {
        const whole = count(inOneBucket(scaledMatching(OVER_CAP_ROWS, params), bucket));
        const inWindow = count(inOneBucket(scaledWindow(OVER_CAP_ROWS, params), bucket));
        const gap = count(
          inOneBucket(scaledMatching(OVER_CAP_ROWS, params), bucket) -
            inOneBucket(scaledWindow(OVER_CAP_ROWS, params), bucket),
        );
        const where = `${label} / ${bucket}`;
        // "N of M" across the two, either way round…
        expect(text, where).not.toContain(`${inWindow} of ${whole}`);
        expect(text, where).not.toContain(`${whole} of ${inWindow}`);
        // …and their difference, which is a third figure no read produced.
        expect(text, where).not.toContain(`${gap} of`);
      }
    }
  });

  it("says the same thing where the two figures agree, with no extra apology", async () => {
    // The under-cap population's window holds every claim it has, so the two
    // figures are EQUAL — and the page's words are the same words it uses
    // where they are not. A label that appeared only on divergence would make
    // the quiet state and the loud one two different screens, and would
    // itself be a sentence about the RELATIONSHIP between two figures.
    const small = await renderClaims(scaledScript(UNDER_CAP_ROWS));
    const big = await renderClaims(scaledScript(OVER_CAP_ROWS));
    const smallTotals = figureRegion(small, "total");
    const smallWindow = figureRegion(small, "window");
    // Non-vacuous in the other direction too: a page that labelled NEITHER
    // region would satisfy an equality between two empty strings.
    expect(smallTotals.said).not.toBe("");
    expect(smallWindow.said).not.toBe("");
    expect(smallTotals.said).toBe(figureRegion(big, "total").said);
    expect(smallWindow.said).toBe(figureRegion(big, "window").said);

    // Non-vacuous: on THIS fixture the two figures really are equal, so the
    // words above are standing over agreement rather than over a divergence
    // this case failed to notice.
    for (const bucket of RENDERED_BUCKETS) {
      expect(smallTotals.figure(bucket), bucket).toBe(smallWindow.figure(bucket));
    }
  });

  it("labels the gauge's figures on the standing tab too", async () => {
    // The standing tab draws no bucket table, so nothing collides there — the
    // rule is the page's and not the pending tab's, so its gauge figures still
    // say what kind of fact they are.
    const markup = await renderClaims(healthyScript(), { tab: "standing" });
    const windowed = figureRegion(markup, "window");
    expect(windowed.regions).toBe(1);
    expect(windowed.said).toBe(figureRegion(await renderClaims(healthyScript()), "window").said);
    // …and there is no totals region to disagree with it.
    expect(cheerio.load(markup)('[data-figures="total"]')).toHaveLength(0);
  });
});
