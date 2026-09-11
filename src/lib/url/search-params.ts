import type { UrlParams } from "./dropped-params";

/**
 * A URL's query as NEXT hands `searchParams` to a page — campaign
 * admin-window/TASK-0068.
 *
 * It was declared inside `src/app/api/admin/claims/rows/route.ts`
 * (admin-window/TASK-0066), which said in its own docstring that it belonged
 * in a shared leaf "the day it has a second caller, never a second copy". The
 * browse paging route is that second caller, so this is the LIFT, not a copy:
 * the claims route keeps no adapter of its own and both routes import this one
 * (LESSONS 5 — a shared spelling gets imported, never retyped).
 *
 * A PURE DOMAIN LEAF (ARCHITECTURE.md §4 rule 7): it reaches no database, no
 * `process.env` and no React, and its ONE import is the type `lib/url` already
 * owns for this record (`UrlParams`, `lib/url/dropped-params.ts`) — a type-only
 * import, so nothing survives to runtime. Re-declaring that record's type here
 * would be the retyped spelling this lift exists to stop.
 *
 * It is a SHAPE adapter and parses no facet: every question about what a value
 * MEANS stays in the reading leaf — `lib/claims/filters.ts` for claims,
 * `lib/browse/views.ts` for browse.
 *
 * **A repeated key becomes an ARRAY in the order it was sent**, which is what
 * Next does with `?bucket=a&bucket=b`; the reading leaf's own `firstValue`
 * then takes the first, as `URLSearchParams.get()` would. Building a record
 * that kept the LAST value instead would make a route and its page disagree
 * about which narrowing a hand-edited URL asked for.
 *
 * **THE RECORD HAS NO PROTOTYPE** (`Object.create(null)`), so a key the URL
 * carries is always an OWN property of the answer and can never reach an
 * object's prototype. That is not a hypothetical: on a plain `{}`,
 * `params["__proto__"] = value` goes through `Object.prototype`'s `__proto__`
 * SETTER rather than creating a property — a single `?__proto__=x` silently
 * drops the value, and the repeated `?__proto__=a&__proto__=b` this adapter's
 * array branch produces RE-PARENTS the params object to an array (QA walked
 * `?__proto__=x&offset=50` on admin-window/TASK-0066's close; it answered 200
 * only because every facet the page reads happens to be an own property).
 * With a null prototype both spellings are plain own entries the reading leaf
 * ignores, and no object's prototype is touched.
 *
 * One consequence for every consumer: the record inherits no methods at all,
 * so it has no `hasOwnProperty` — ask `Object.hasOwn(params, key)` or
 * `key in params` instead.
 */
export function searchParamsOf(query: URLSearchParams): UrlParams {
  const params = Object.create(null) as UrlParams;
  for (const [key, value] of query) {
    const seen = params[key];
    if (seen === undefined) params[key] = value;
    else if (Array.isArray(seen)) seen.push(value);
    else params[key] = [seen, value];
  }
  return params;
}
