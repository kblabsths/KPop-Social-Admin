import * as cheerio from "cheerio";
import { describe, expect, it, vi } from "vitest";
import { CLAIM_WINDOW } from "@/components/claims";
import { T } from "@/lib/db/tables";
import { render } from "../ui/markup";
import {
  CLAIMS,
  ENTITY,
  OBSERVATIONS,
  OBSERVED_AT,
  REGISTRY,
  SOURCE,
  SOURCE_NAME,
  nameOf,
} from "./population";
import {
  observationRow,
  pendingClaimRow,
  type PendingClaimRow,
} from "../../fixtures/rows";
import {
  permissionDenied,
  stubClient,
  tableNotInSchemaCache,
  transportFailure,
  type Script,
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
 * names, the unmet requirement, the missing table). No class name and no copy
 * of the app's own words is pinned.
 */

const readWith = vi.hoisted(() => ({ client: undefined as unknown }));

vi.mock("@/lib/db/claims", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/db/claims")>();
  return { ...actual, listClaims: () => actual.listClaims(readWith.client as never) };
});

// The label leg (admin-window/BUG-0043) is its own module and its own read,
// so it is stubbed at its own boundary like every other one.
vi.mock("@/lib/db/sources", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/db/sources")>();
  return {
    ...actual,
    readSourceNames: (ids: readonly string[]) =>
      actual.readSourceNames(ids, readWith.client as never),
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

const claimsModule = await import("@/app/claims/page");
const ClaimsPage = claimsModule.default;

/* ── the population, and this file's own reading of it ───────────────────── */

/**
 * The bucket that is empty by rule and must never reach the UI. Spelled in
 * two halves so that this file — which asserts the string's ABSENCE from the
 * markup — cannot be the thing that puts it there, and so the page's own
 * absence check stays honest about the product rather than about its tests.
 */
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
    // The whole view, `in_window` included: the shape of a database whose
    // server-side exclusion did nothing.
    [T.pendingClaims]: { data: [...CLAIMS], count: CLAIMS.length },
    [T.observations]: { data: [...OBSERVATIONS] },
    // Two of the three sources are registered; `SOURCE.third` is not, so every
    // label assertion has a row it must name and a row it must not
    // (admin-window/BUG-0043).
    [T.sources]: { data: [...REGISTRY] },
    ...overrides,
  };
}

async function renderClaims(
  script: Script,
  params: Record<string, string | string[]> = {},
): Promise<string> {
  readWith.client = stubClient(script).asSupabaseClient();
  return render(await ClaimsPage({ searchParams: Promise.resolve(params) }));
}

/* ── reading the markup, structurally ────────────────────────────────────── */

/** The bucket rows: the bucket, its count and its source count, in order. */
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
        sources: Number(row.find("[data-bucket-sources]").attr("data-bucket-sources")),
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
  it("shows every bucket it may show, in the view's own order", async () => {
    const markup = await renderClaims(healthyScript());
    expect(bucketRows(markup).map((row) => row.bucket)).toEqual(RENDERED_BUCKETS);
  });

  it("counts each bucket exactly as the view holds it", async () => {
    const markup = await renderClaims(healthyScript());
    for (const row of bucketRows(markup)) {
      expect(row.claims, row.bucket).toBe(inBucket(row.bucket).length);
      expect(row.sources, `${row.bucket} sources`).toBe(
        new Set(inBucket(row.bucket).map((claim) => claim.source_id)).size,
      );
    }
  });

  it("counts each bucket exactly as the view holds it, per source filter", async () => {
    for (const source of Object.values(SOURCE)) {
      const markup = await renderClaims(healthyScript(), { source_id: source });
      const rows = bucketRows(markup);
      // Every bucket still has a row, so a bucket this source is not in reads
      // as a real zero rather than vanishing.
      expect(rows.map((row) => row.bucket), source).toEqual(RENDERED_BUCKETS);
      for (const row of rows) {
        expect(row.claims, `${source} / ${row.bucket}`).toBe(
          inBucket(row.bucket, { source_id: source }).length,
        );
      }
      expect(rows.reduce((total, row) => total + row.claims, 0), source).toBe(
        matching({ source_id: source }).length,
      );
    }
  });

  it("counts each bucket exactly as the view holds it, per domain filter", async () => {
    for (const domain of [...new Set(CLAIMS.map((claim) => claim.domain))]) {
      const markup = await renderClaims(healthyScript(), { domain });
      for (const row of bucketRows(markup)) {
        expect(row.claims, `${domain} / ${row.bucket}`).toBe(
          inBucket(row.bucket, { domain }).length,
        );
      }
    }
  });

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

/* ── the parked bucket, nowhere ──────────────────────────────────────────── */

describe("the parked bucket", () => {
  const URLS: Record<string, string>[] = [
    {},
    { tab: "standing" },
    { bucket: "agreeing" },
    // The claim carrying it belongs to this source and this domain, so a page
    // narrowed to either is the one most likely to leak it.
    { source_id: SOURCE.third },
    { domain: "events" },
    // Hand-typed: the bucket the UI does not offer, asked for by name.
    { bucket: PARKED },
    { bucket: PARKED, tab: "standing" },
    { bucket: PARKED, source_id: SOURCE.third },
  ];

  it("appears nowhere in the markup, under any filter or tab", async () => {
    for (const params of URLS) {
      const markup = await renderClaims(healthyScript(), params);
      expect(markup, JSON.stringify(params)).not.toContain(PARKED);
    }
  });

  it("appears nowhere in any of the four states either", async () => {
    const scripts: Script[] = [
      healthyScript(),
      { [T.pendingClaims]: { data: [], count: 0 }, [T.observations]: { data: [] } },
      {
        [T.pendingClaims]: { error: tableNotInSchemaCache(T.pendingClaims) },
        [T.observations]: { error: tableNotInSchemaCache(T.observations) },
      },
      {
        [T.pendingClaims]: { error: transportFailure() },
        [T.observations]: { error: transportFailure() },
        [T.sources]: { error: transportFailure() },
      },
    ];
    for (const script of scripts) {
      for (const tab of ["buckets", "standing"]) {
        const markup = await renderClaims(script, { tab });
        expect(markup, tab).not.toContain(PARKED);
      }
    }
  });

  it("is not a bucket row, not a chip, and not a claim", async () => {
    const markup = await renderClaims(healthyScript());
    expect(bucketRows(markup).map((row) => row.bucket)).not.toContain(PARKED);
    expect(chipsOf(markup, "bucket").map((chip) => chip.label)).toEqual([
      "all",
      ...RENDERED_BUCKETS,
    ]);
    const parkedClaim = CLAIMS.find((claim) => claim.bucket === PARKED);
    expect(parkedClaim).toBeDefined();
    expect(claimIds(markup)).not.toContain(parkedClaim?.observation_id);
  });

  it("does not narrow the page when a URL names it", async () => {
    // A value outside the offered vocabulary constrains nothing, so the page
    // shows everything rather than an empty list that reads as an empty
    // database.
    const markup = await renderClaims(healthyScript(), { bucket: PARKED });
    expect(claimIds(markup)).toEqual(oldestFirst(SHOWABLE));
  });
});

/* ── the claims ──────────────────────────────────────────────────────────── */

describe("the claim list", () => {
  it("renders every claim the view holds, oldest first", async () => {
    const markup = await renderClaims(healthyScript());
    expect(claimIds(markup)).toEqual(oldestFirst(SHOWABLE));
  });

  it("returns exactly the matching claims for every facet value", async () => {
    for (const [facet, values] of [
      ["bucket", RENDERED_BUCKETS],
      ["source_id", Object.values(SOURCE)],
      ["domain", [...new Set(CLAIMS.map((claim) => claim.domain))]],
    ] as const) {
      for (const value of values) {
        const markup = await renderClaims(healthyScript(), { [facet]: value });
        expect(claimIds(markup), `${facet}=${value}`).toEqual(
          oldestFirst(matching({ [facet]: value })),
        );
      }
    }
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

  it("carries no requirement cell for a bucket that has none", async () => {
    const markup = await renderClaims(healthyScript(), { bucket: "escalated" });
    for (const claim of inBucket("escalated")) {
      expect(claimRow(markup, claim.observation_id).requirement).toBeUndefined();
    }
  });

  it("links every claim to its source and to its fact's provenance", async () => {
    const markup = await renderClaims(healthyScript());
    for (const claim of SHOWABLE) {
      const row = claimRow(markup, claim.observation_id);
      expect(row.sourceId, claim.observation_id).toBe(claim.source_id);
      expect(row.sourceHref, claim.observation_id).toContain(
        encodeURIComponent(claim.source_id),
      );
      if (claim.entity_id === null) {
        // No canonical row yet: no invented link to a fact that does not exist.
        expect(row.provenanceHref, claim.observation_id).toBeUndefined();
      } else {
        expect(row.provenanceHref, claim.observation_id).toBe(
          `/records/${claim.domain}/${claim.entity_id}`,
        );
      }
    }
    // Both directions are actually exercised by this population.
    expect(SHOWABLE.some((claim) => claim.entity_id === null)).toBe(true);
    expect(SHOWABLE.some((claim) => claim.entity_id !== null)).toBe(true);
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

  it("settles nothing: every control on the page is a link", async () => {
    const markup = await renderClaims(healthyScript());
    const $ = cheerio.load(markup);
    expect($("button, form, input, select, textarea")).toHaveLength(0);
    expect($("a").length).toBeGreaterThan(0);
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

  const OVERFLOW = CLAIM_WINDOW + 17;

  function crowdedScript(size: number): Script {
    const population = crowd(size);
    return {
      [T.pendingClaims]: { data: population.claims, count: population.claims.length },
      [T.observations]: { data: population.observations },
      [T.sources]: { data: [] },
    };
  }

  it("draws at most the window's rows however many claims the view holds", async () => {
    const markup = await renderClaims(crowdedScript(OVERFLOW));
    expect(claimIds(markup)).toHaveLength(CLAIM_WINDOW);
    // And a bigger backlog draws the same number of rows: the page's height is
    // a function of the cap, not of the queue.
    const bigger = await renderClaims(crowdedScript(CLAIM_WINDOW * 3));
    expect(claimIds(bigger)).toHaveLength(CLAIM_WINDOW);
  });

  it("draws the LONGEST-WAITING claims, in the page's oldest-first order", async () => {
    const population = crowd(OVERFLOW);
    const markup = await renderClaims(crowdedScript(OVERFLOW));
    // The window is the head of the order, not the head of the read: the
    // oldest `CLAIM_WINDOW` claims, oldest first.
    expect(claimIds(markup)).toEqual(
      population.claims.slice(0, CLAIM_WINDOW).map((claim) => claim.observation_id),
    );
  });

  it("states the cap and the number of claims it holds back", async () => {
    const line = windowLine(await renderClaims(crowdedScript(OVERFLOW)));
    expect(line.present).toBe(true);
    expect(line.limit).toBe(CLAIM_WINDOW);
    // The honest figure: every claim matching, not the rows drawn.
    expect(line.held).toBe(OVERFLOW);
    expect(line.truncated).toBe(true);
    // The sentence carries both numbers, so the truncation is never silent.
    expect(line.text).toContain(String(CLAIM_WINDOW));
    expect(line.text).toContain(String(OVERFLOW));
  });

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

  it("leaves every bucket count the view's own, with the list windowed", async () => {
    // EC5 parity, under the window: the table above the list still counts the
    // whole classification, so no figure on the page became a window
    // aggregate.
    const population = crowd(OVERFLOW);
    const markup = await renderClaims(crowdedScript(OVERFLOW));
    for (const row of bucketRows(markup)) {
      const held = population.claims.filter((claim) => claim.bucket === row.bucket);
      expect(row.claims, row.bucket).toBe(held.length);
      expect(row.sources, `${row.bucket} sources`).toBe(
        new Set(held.map((claim) => claim.source_id)).size,
      );
    }
    expect(
      bucketRows(markup).reduce((total, row) => total + row.claims, 0),
    ).toBe(OVERFLOW);
    // The counted total is bigger than what the list drew — which is the whole
    // point of the sentence above it.
    expect(OVERFLOW).toBeGreaterThan(claimIds(markup).length);
  });

  it("windows the standing tab's list the same way", async () => {
    const size = CLAIM_WINDOW + 9;
    const standing = crowd(size);
    const script: Script = {
      [T.pendingClaims]: {
        data: standing.claims.map((claim) => ({
          ...claim,
          bucket: "standing_disagreement" as PendingClaimRow["bucket"],
          unmet_requirement: null,
        })),
        count: size,
      },
      [T.observations]: { data: standing.observations },
      [T.sources]: { data: [] },
    };
    const markup = await renderClaims(script, { tab: "standing" });
    expect(claimIds(markup)).toHaveLength(CLAIM_WINDOW);
    const line = windowLine(markup);
    expect(line.limit).toBe(CLAIM_WINDOW);
    expect(line.held).toBe(size);
    expect(line.truncated).toBe(true);
  });
});

/* ── the standing-disagreements tab ──────────────────────────────────────── */

describe("the standing-disagreements tab", () => {
  it("renders exactly the standing_disagreement claims", async () => {
    const markup = await renderClaims(healthyScript(), { tab: "standing" });
    expect(claimIds(markup)).toEqual(
      oldestFirst(matching({ bucket: "standing_disagreement" })),
    );
    // It is a subset, not the page: something is deliberately left out.
    expect(claimIds(markup).length).toBeLessThan(SHOWABLE.length);
  });

  it("keeps the source narrowing when the operator crosses to it", async () => {
    const markup = await renderClaims(healthyScript(), {
      tab: "standing",
      source_id: SOURCE.first,
    });
    expect(claimIds(markup)).toEqual(
      oldestFirst(
        matching({ bucket: "standing_disagreement", source_id: SOURCE.first }),
      ),
    );
  });

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
    expect(chipsOf(markup, "domain").length).toBeGreaterThan(1);
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

  it("shows the bucket table only where it belongs", async () => {
    // The standing tab is one bucket's subset; a five-row bucket table above it
    // would be the other tab's question asked twice.
    const markup = await renderClaims(healthyScript(), { tab: "standing" });
    expect(bucketRows(markup)).toHaveLength(0);
    expect(bucketRows(await renderClaims(healthyScript()))).toHaveLength(
      RENDERED_BUCKETS.length,
    );
  });
});

/* ── the four states ─────────────────────────────────────────────────────── */

describe("absence and failure", () => {
  it("renders the not-provisioned state naming the view, and nothing throws", async () => {
    for (const tab of ["buckets", "standing"]) {
      const markup = await renderClaims(
        {
          [T.pendingClaims]: { error: tableNotInSchemaCache(T.pendingClaims) },
          [T.observations]: { error: tableNotInSchemaCache(T.observations) },
          [T.sources]: { data: [] },
        },
        { tab },
      );
      expect(markup, tab).toContain(T.pendingClaims);
      expect(claimIds(markup), tab).toEqual([]);
      expect(bucketRows(markup), tab).toEqual([]);
      // Never a zero standing in for a table nobody could read.
      expect(cheerio.load(markup)("[data-bucket-claims]"), tab).toHaveLength(0);
    }
  });

  it("names the OTHER object when only the observations side is absent", async () => {
    const markup = await renderClaims({
      [T.pendingClaims]: { data: [...CLAIMS], count: CLAIMS.length },
      [T.observations]: { error: tableNotInSchemaCache(T.observations) },
      [T.sources]: { data: [] },
    });
    expect(markup).toContain(T.observations);
    expect(claimIds(markup)).toEqual([]);
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

  /**
   * PINNED `it.fails` (strict) for admin-window/BUG-0063: the window line's
   * own count hook survives a failed read as a `0`.
   *
   * This page's rule on a failed read is that a count is ABSENT, not zero —
   * the bucket table drops `data-bucket-claims` entirely two tests above
   * ("Never a zero standing in for a table nobody could read"),
   * ARCHITECTURE.md §4.3 promoted it ("a null count is a refusal, never a
   * zero"), and `/runs` pins the stronger form for a window line
   * (`tests/offline/runs/page.test.ts`, "claims no window it never read").
   * `data-window-held` is also the hook the live parity oracle grades this
   * page by (`tests/live/claims.live.test.ts`), and `0` is a value it can
   * reach in no other state: an empty matching set renders the Empty card
   * with no window line at all.
   *
   * It grades the COUNT and nothing else, so either fix passes — dropping the
   * attribute on a non-ok read, or dropping the whole line. Flip it back to a
   * plain `it(...)` in the commit that fixes it.
   */
  it.fails("claims no count it never took when the list's read fails", async () => {
    const failures: Array<[string, Script]> = [
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
    ];
    for (const [label, script] of failures) {
      const markup = await renderClaims(script);
      // The error state is what is on screen — not an empty view.
      expect(markup, label).toContain(T.pendingClaims);
      expect(claimIds(markup), label).toEqual([]);
      // ... and no count hook stands in for the count nobody could take.
      expect(cheerio.load(markup)("[data-window-held]"), label).toHaveLength(0);
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

  it("renders standing alone, with no props at all", async () => {
    // The shell's route test calls every page this way.
    readWith.client = stubClient(healthyScript()).asSupabaseClient();
    const markup = render(await ClaimsPage());
    expect(markup).not.toContain(PARKED);
    expect(claimIds(markup)).toEqual(oldestFirst(SHOWABLE));
  });

  it("renders the gauge's own state when its window cannot be read", async () => {
    const markup = await renderClaims({
      [T.pendingClaims]: { data: [...CLAIMS], count: CLAIMS.length },
      // The list's own legs answer; the gauge's window read is the one that
      // refuses, and it says so without taking the list down with it.
      [T.observations]: [
        { data: [...OBSERVATIONS] },
        { error: permissionDenied(T.observations) },
      ],
      [T.sources]: { data: [] },
    });
    expect(claimIds(markup)).toEqual(oldestFirst(SHOWABLE));
    expect(markup).toContain("permission denied");
  });
});

/* ── the filter bar ──────────────────────────────────────────────────────── */

describe("the filters", () => {
  it("offers every source and domain the view carries, and 'all' first", async () => {
    const markup = await renderClaims(healthyScript());
    expect(chipsOf(markup, "source_id").map((chip) => chip.label)).toEqual([
      "all",
      // Named, and in the order those names sort — the same facet `/sources`
      // renders, reading the same way (admin-window/BUG-0043).
      ...[...new Set(CLAIMS.map((claim) => claim.source_id))].map(nameOf).sort(),
    ]);
    expect(chipsOf(markup, "domain").map((chip) => chip.label)).toEqual([
      "all",
      ...[...new Set(CLAIMS.map((claim) => claim.domain))].sort(),
    ]);
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

  it("still offers all three facets when nothing matched", async () => {
    const markup = await renderClaims(healthyScript(), {
      source_id: SOURCE.third,
      domain: "venues",
    });
    expect(claimIds(markup)).toEqual([]);
    for (const facet of ["bucket", "source_id", "domain"]) {
      expect(chipsOf(markup, facet).length, facet).toBeGreaterThan(1);
    }
    // The way out is on screen: the "all" chip of the facet that emptied it.
    expect(chipsOf(markup, "domain")[0].href).not.toContain("domain=");
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
    // The same id, as the chip that narrows to it.
    const labels = chipsOf(markup, "source_id").map((chip) => chip.label);
    expect(labels).toContain(unregistered[0].source_id);
  });

  it("names the chips exactly as the same facet on /sources does", async () => {
    const markup = await renderClaims(healthyScript());
    for (const [id, name] of SOURCE_NAME) {
      const chip = chipsOf(markup, "source_id").find((one) => one.label === name);
      expect(chip, name).toBeDefined();
      expect((chip as { href: string }).href).toContain(encodeURIComponent(id));
    }
    // Not one chip anywhere reads as a uuid the registry could have named.
    expect(chipsOf(markup, "source_id").map((chip) => chip.label)).not.toContain(
      SOURCE.first,
    );
  });

  it("reports the registry leg when it refuses, and leaves every source its id", async () => {
    const markup = await renderClaims(
      healthyScript({ [T.sources]: { error: permissionDenied(T.sources) } }),
    );
    // The claims are still the claims: a label that could not be read takes
    // nothing down with it.
    expect(claimIds(markup)).toEqual(oldestFirst(SHOWABLE));
    for (const claim of SHOWABLE) {
      expect(claimRow(markup, claim.observation_id).sourceLabel).toBe(claim.source_id);
    }
    // ... and the failure is on screen, naming the object that refused.
    expect(markup).toContain(T.sources);
    expect(markup).toContain("permission denied");
  });
});

/* ── the fixture the assertions rest on ──────────────────────────────────── */

describe("the population this file reads", () => {
  it("carries every bucket, including the one that must never render", () => {
    expect(new Set(CLAIMS.map((claim) => claim.bucket))).toEqual(
      new Set([...RENDERED_BUCKETS, PARKED]),
    );
    expect(CLAIMS.filter((claim) => claim.bucket === PARKED)).toHaveLength(1);
    expect(new Set(CLAIMS.map((claim) => claim.source_id)).size).toBe(3);
    // Two of those three are registered and one is not, so a label assertion
    // has an input it must name and an input it must leave alone
    // (admin-window/BUG-0043).
    expect(REGISTRY.map((row) => row.source_id).sort()).toEqual(
      [...SOURCE_NAME.keys()].sort(),
    );
    expect(
      CLAIMS.some((claim) => !SOURCE_NAME.has(claim.source_id)),
      "a source the registry does not name",
    ).toBe(true);
    expect(CLAIMS.some((claim) => claim.entity_id === ENTITY.event)).toBe(true);
  });
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
    ["domain=standing_disagreement", {}],
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

  it("keeps the tab a URL asks for, however it spells the rest", async () => {
    const markup = await renderClaims(
      healthyScript(),
      paramsOf(`tab=standing&bucket=${PARKED}&source_id=${SOURCE.first}`),
    );
    expect(claimIds(markup)).toEqual(
      oldestFirst(
        matching({ bucket: "standing_disagreement", source_id: SOURCE.first }),
      ),
    );
    expect(markup).not.toContain(PARKED);
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
    // Every read hands the parked rows over: a server that ignored the `neq`.
    [T.pendingClaims]: { data: [...QA_CLAIMS], count: QA_CLAIMS.length },
    [T.observations]: { data: [...QA_OBSERVATIONS] },
    [T.sources]: { data: [] },
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
            // 2. Nor the source and the domain that exist only on parked rows.
            expect(markup, where).not.toContain(QA_SOURCE.parkedOnly);

            // 3. The claims rendered are exactly the ones QA's own predicate
            //    keeps — the standing tab being that predicate with the bucket
            //    the tab IS, whatever the URL asked for.
            const applied = {
              bucket: qaApplied(RENDERED_BUCKETS, bucket),
              source_id: qaApplied(QA_SOURCE_VOCAB, source),
              domain: qaApplied(QA_DOMAIN_VOCAB, domain),
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
                expect(row.sources, `${where} / ${row.bucket} sources`).toBe(
                  new Set(held.map((spec) => spec.source)).size,
                );
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
                  expect(RENDERED_BUCKETS, `${where} -> ${href}`).toContain(value);
                } else if (key === "source_id") {
                  expect(QA_SOURCE_VOCAB, `${where} -> ${href}`).toContain(value);
                } else if (key === "domain") {
                  expect(QA_DOMAIN_VOCAB, `${where} -> ${href}`).toContain(value);
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

describe("QA: what the parked bucket alone carries", () => {
  it("offers no chip for a source or a domain only parked rows have", async () => {
    const markup = await renderClaims(qaScript());
    expect(chipsOf(markup, "source_id").map((chip) => chip.label)).toEqual([
      "all",
      ...QA_SOURCE_VOCAB,
    ]);
    expect(chipsOf(markup, "domain").map((chip) => chip.label)).toEqual([
      "all",
      ...QA_DOMAIN_VOCAB,
    ]);
    expect(markup).not.toContain(QA_SOURCE.parkedOnly);
    expect(markup).not.toContain(PARKED);
  });

  it("narrows nothing when the URL names one of them", async () => {
    const hostile: Record<string, string>[] = [
      { source_id: QA_SOURCE.parkedOnly },
      { domain: QA_PARKED_DOMAIN },
      { source_id: QA_SOURCE.parkedOnly, domain: QA_PARKED_DOMAIN },
      { bucket: PARKED, source_id: QA_SOURCE.parkedOnly },
    ];
    for (const params of hostile) {
      const markup = await renderClaims(qaScript(), params);
      const where = new URLSearchParams(params).toString();
      // Every showable claim, not an empty page that would read as an empty
      // database — and no trace of what the URL asked for.
      expect(claimIds(markup), where).toHaveLength(QA_SHOWABLE.length);
      expect(markup, where).not.toContain(QA_SOURCE.parkedOnly);
      expect(markup, where).not.toContain(PARKED);
    }
  });

  it("takes the first value of every repeated parameter, hostile ones included", async () => {
    const markup = await renderClaims(qaScript(), {
      bucket: [PARKED, "escalated"],
      source_id: [QA_SOURCE.parkedOnly, QA_SOURCE.a],
      domain: [QA_PARKED_DOMAIN, "events"],
      tab: ["standing", "buckets"],
    });
    // First values: all three unusable, so nothing narrows; the tab is standing.
    expect(new Set(claimIds(markup))).toEqual(
      new Set(qaMatching({ bucket: "standing_disagreement" }).map((spec) => spec.id)),
    );
    expect(bucketRows(markup)).toHaveLength(0);
    expect(markup).not.toContain(PARKED);
    expect(markup).not.toContain(QA_SOURCE.parkedOnly);
  });

  it("shows no count at all when the view outgrew the cap, only the real number", async () => {
    const markup = await renderClaims(
      qaScript({
        // The database holds far more than the read could return: a complete
        // read must refuse with that number, never render the rows it got as
        // if they were the whole set.
        [T.pendingClaims]: { data: [...QA_CLAIMS], count: 4096 },
      }),
    );
    expect(markup).toContain("4096");
    expect(cheerio.load(markup)("[data-bucket-claims]")).toHaveLength(0);
    expect(claimIds(markup)).toEqual([]);
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
