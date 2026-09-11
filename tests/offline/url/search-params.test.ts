import { describe, expect, it } from "vitest";
import { searchParamsOf } from "@/lib/url/search-params";
import type { UrlParams } from "@/lib/url/dropped-params";

/**
 * The ONE `URLSearchParams` -> Next-shaped-`searchParams` adapter — campaign
 * admin-window/TASK-0068.
 *
 * It was declared inside the claims paging route and is LIFTED here because
 * the browse paging route is its second caller (LESSONS 5). Two things are
 * asserted: that the lift changed NOTHING about how a normal key reads, and
 * that the one thing it did change — the record's prototype — really closes
 * the hazard QA measured on admin-window/TASK-0066's close.
 *
 * A pure leaf: no database, no network, no Next.
 */

function paramsOf(query: string): UrlParams {
  return searchParamsOf(new URLSearchParams(query));
}

/**
 * THE ADAPTER AS IT WAS BEFORE THE LIFT — byte for byte, plain `{}` and all.
 *
 * It is here as the differential the criteria ask for: every non-`__proto__`
 * key must read EXACTLY as it read before, so the lift cannot have changed the
 * narrowing a URL asks for. It is also the fixture that proves the hazard is
 * real rather than theoretical — the guard that never saw a failing spelling
 * passes vacuously (LESSONS 8).
 */
function beforeTheLift(query: URLSearchParams): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const [key, value] of query) {
    const seen = params[key];
    if (seen === undefined) params[key] = value;
    else if (Array.isArray(seen)) seen.push(value);
    else params[key] = [seen, value];
  }
  return params;
}

describe("the record a URL's query reads as", () => {
  it("reads a single key as its one value", () => {
    expect(paramsOf("bucket=agreeing").bucket).toBe("agreeing");
  });

  it("reads a repeated key as an ARRAY, in the order it was sent", () => {
    // The reading leaf then takes the FIRST, as `URLSearchParams.get()` would.
    expect(paramsOf("bucket=a&bucket=b").bucket).toEqual(["a", "b"]);
    expect(paramsOf("bucket=a&bucket=b&bucket=c").bucket).toEqual(["a", "b", "c"]);
  });

  it("keeps an empty value as the empty string, not as an absence", () => {
    // `?bucket=` is a key that NAMES something — the empty narrowing — and a
    // record that dropped it would be a different URL.
    const params = paramsOf("bucket=");
    expect(params.bucket).toBe("");
    expect(Object.hasOwn(params, "bucket")).toBe(true);
  });

  it("reads an empty query as an empty record", () => {
    const params = paramsOf("");
    expect(Object.keys(params)).toEqual([]);
    expect(Object.getOwnPropertyNames(params)).toEqual([]);
  });

  it("carries every key the URL sent, in the order it sent them", () => {
    const params = paramsOf("tab=standing&domain=events&offset=50");
    expect(Object.keys(params)).toEqual(["tab", "domain", "offset"]);
  });
});

describe("the record has no prototype", () => {
  it("is parented on nothing at all", () => {
    expect(Object.getPrototypeOf(paramsOf("bucket=a"))).toBeNull();
    expect(Object.getPrototypeOf(paramsOf(""))).toBeNull();
  });

  it("inherits no method a consumer could reach for", () => {
    // Consequence a consumer must know: ask `Object.hasOwn` or `in`, never
    // `params.hasOwnProperty` — there is none to call.
    const params = paramsOf("bucket=a") as unknown as Record<string, unknown>;
    expect(params.hasOwnProperty).toBeUndefined();
    expect(params.toString).toBeUndefined();
    expect("bucket" in params).toBe(true);
    expect("toString" in params).toBe(false);
  });

  it("makes `?__proto__=x` an OWN entry rather than a prototype write", () => {
    const params = paramsOf("__proto__=x");

    expect(Object.getOwnPropertyNames(params)).toContain("__proto__");
    expect(Object.getOwnPropertyDescriptor(params, "__proto__")?.value).toBe("x");
    expect(Object.getPrototypeOf(params)).toBeNull();
  });

  it("makes the REPEATED `?__proto__=a&__proto__=b` an own ARRAY", () => {
    const params = paramsOf("__proto__=a&__proto__=b");

    expect(Object.getOwnPropertyNames(params)).toContain("__proto__");
    expect(Object.getOwnPropertyDescriptor(params, "__proto__")?.value).toEqual([
      "a",
      "b",
    ]);
    // The record is still parented on nothing: the array did not become its
    // prototype, which is exactly what the plain-`{}` control below does.
    expect(Object.getPrototypeOf(params)).toBeNull();
  });

  it("changes no object's prototype, and the facets beside it read normally", () => {
    const before = Object.getPrototypeOf({});
    const params = paramsOf("__proto__=x&offset=50&bucket=a&bucket=b");

    // Nothing about `Object.prototype` moved, and nothing was added to it.
    expect(Object.getPrototypeOf({})).toBe(before);
    expect(Object.getOwnPropertyNames(Object.prototype)).not.toContain("offset");
    expect(({} as Record<string, unknown>).offset).toBeUndefined();
    // And the request's real facets are untouched by the key beside them.
    expect(params.offset).toBe("50");
    expect(params.bucket).toEqual(["a", "b"]);
  });

  /**
   * THE HAZARD IS REAL — the fixture the guard MUST flag (LESSONS 8).
   *
   * QA walked `?__proto__=x&offset=50` on the claims route at TASK-0066's
   * close; it answered 200 only because every facet the page reads happens to
   * be an own property. These two cases are what the null prototype closes.
   */
  it("is what a plain `{}` record would have got wrong", () => {
    // Measured 2026-09-10, and WORSE than the single/repeated split suggests:
    // ONE `?__proto__=x` is already enough. On a plain `{}` the adapter's own
    // `params[key]` read hits `Object.prototype`'s `__proto__` GETTER, which
    // answers `Object.prototype` — not `undefined` — so the adapter takes its
    // "this key repeats" branch and assigns the ARRAY
    // `[Object.prototype, "x"]`. The setter accepts an object, so the params
    // record is RE-PARENTED to that array.
    const single = beforeTheLift(new URLSearchParams("__proto__=x"));
    expect(Object.getOwnPropertyNames(single)).toEqual([]);
    expect(Object.getPrototypeOf(single)).not.toBe(Object.prototype);
    expect(Array.isArray(Object.getPrototypeOf(single))).toBe(true);
    // What that costs the reader: the record now answers to array properties
    // it never carried. A URL invented `length: 2` out of nothing.
    expect((single as { length?: unknown }).length).toBe(2);

    const repeated = beforeTheLift(new URLSearchParams("__proto__=a&__proto__=b"));
    expect(Object.getPrototypeOf(repeated)).not.toBe(Object.prototype);
    expect(Array.isArray(Object.getPrototypeOf(repeated))).toBe(true);
    expect((repeated as { length?: unknown }).length).toBe(3);

    // The lifted adapter answers both with a plain own entry and no re-parent.
    for (const query of ["__proto__=x", "__proto__=a&__proto__=b"]) {
      const params = paramsOf(query);
      expect(Object.getPrototypeOf(params), query).toBeNull();
      expect(Object.getOwnPropertyNames(params), query).toEqual(["__proto__"]);
      expect((params as { length?: unknown }).length, query).toBeUndefined();
    }
  });
});

describe("every other key reads byte for byte as it did before the lift", () => {
  const QUERIES = [
    "",
    "bucket=agreeing",
    "bucket=",
    "bucket=a&bucket=b",
    "bucket=a&bucket=b&bucket=c",
    "tab=standing&bucket=agreeing&domain=events&offset=50",
    "source_id=01920000-0000-7000-8000-000000000101&offset=100",
    "cols=title%2Cvenue&offset=50",
    "=x&offset=50",
    "odd%20name=a+b&offset=50",
    "offset=50&offset=60",
  ] as const;

  it.each(QUERIES)("answers %j exactly as the claims route's own copy did", (query) => {
    const lifted = searchParamsOf(new URLSearchParams(query));
    const original = beforeTheLift(new URLSearchParams(query));

    // Own keys, in order, and each value — compared over the OWN names, which
    // is the only comparison a null-prototype record and a plain one share.
    expect(Object.getOwnPropertyNames(lifted)).toEqual(
      Object.getOwnPropertyNames(original),
    );
    for (const key of Object.getOwnPropertyNames(lifted)) {
      expect(lifted[key], key).toEqual(original[key]);
    }
  });
});
