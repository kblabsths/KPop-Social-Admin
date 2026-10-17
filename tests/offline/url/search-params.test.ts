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
});
