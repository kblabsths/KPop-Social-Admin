import * as cheerio from "cheerio";
import { describe, expect, it, vi } from "vitest";
import { T } from "@/lib/db/tables";
import { render } from "../ui/markup";
import { CLAIMS, ENTITY, OBSERVATIONS, OBSERVED_AT, SOURCE } from "./population";
import type { PendingClaimRow } from "../../fixtures/rows";
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
    [T.sources]: { data: [] },
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
      ...[...new Set(CLAIMS.map((claim) => claim.source_id))].sort(),
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
      SOURCE.second,
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

/* ── the fixture the assertions rest on ──────────────────────────────────── */

describe("the population this file reads", () => {
  it("carries every bucket, including the one that must never render", () => {
    expect(new Set(CLAIMS.map((claim) => claim.bucket))).toEqual(
      new Set([...RENDERED_BUCKETS, PARKED]),
    );
    expect(CLAIMS.filter((claim) => claim.bucket === PARKED)).toHaveLength(1);
    expect(new Set(CLAIMS.map((claim) => claim.source_id)).size).toBe(3);
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
