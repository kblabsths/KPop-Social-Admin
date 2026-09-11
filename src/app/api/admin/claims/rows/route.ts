import { CLAIM_WINDOW } from "@/components/claims";
import { requireAdmin } from "@/lib/admin";
import {
  filterFrom,
  listFilterOf,
  tabFrom,
  type SearchParams,
} from "@/lib/claims/filters";
import { claimLines, type ClaimLine } from "@/lib/claims/lines";
import { RENDERABLE_BUCKETS, readClaimWindow } from "@/lib/db/claims";
import { pageAnswerOf } from "@/lib/db/paging";
import { readSourceNames } from "@/lib/db/sources";
import { idsOf } from "@/lib/gauges/gauge";
import { STANDING_BUCKET } from "@/lib/gauges/standing-disagreements";
import { OFFSET_PARAM, pageBound, type PageAnswer } from "@/lib/paging/bounds";
import { sourceNamesOf } from "@/lib/sources/names";

/**
 * The claims list, CONTINUED — campaign admin-window/TASK-0066, SPEC F14.
 *
 * `GET /api/admin/claims/rows?<the page's own facets>&offset=<n>` answers ONE
 * page of the same window `/claims` server-rendered, at an explicit bound. It
 * is the app's second read route and the first that serves rows; the first
 * screen is unchanged, and this is what the operator can do AFTER it
 * (ARCHITECTURE.md §4.3 read kind 3).
 *
 * **The order of the guards is `src/app/api/admin/records/[table]/[id]/
 * route.ts`'s**, because a read route is gated exactly as a write route is:
 *
 *  - **The gate first, and always.** `requireAdmin()` is the first statement
 *    of the body, and `src/middleware.ts` — `export { auth as middleware }`,
 *    never `auth(handler)` — has already turned away a request with no session
 *    before this module is reached at all. Nothing below runs for a visitor
 *    who is not an allowlisted admin (M3 EC6).
 *  - **Then the facets, through the PAGE's own derivation.** `filterFrom` +
 *    `tabFrom` + `listFilterOf` (`lib/claims/filters.ts`) are the same
 *    functions `src/app/claims/page.tsx` calls, given the same search
 *    parameters — so the rows a press appends belong to the narrowing the rows
 *    above them came from. **No facet is parsed in this file** (common
 *    violations row 20; LESSONS 5).
 *  - **Then the BOUND**, through `pageBound` — the one guard that decides
 *    which offsets this app may serve. A refusal is HTTP 400 carrying the
 *    `refused` answer, naming the reason and the bound AS SENT, and no read is
 *    issued. Never clamped, never defaulted (M3 EC6).
 *  - **Then the read**: `readClaimWindow` at that offset, the source-name
 *    registry for exactly this page's `source_id`s, and `claimLines` — the
 *    leaf the first screen shapes its own rows with (admin-window/TASK-0065).
 *
 * **THE RAW PARAMETER REACHES NOTHING BUT `pageBound`.** This file does no
 * arithmetic of its own on it — no coercion, no repair, no default — and the
 * only value that reaches `readClaimWindow`'s `offset` is the number
 * `pageBound` returned on its `ok` arm. That is not tidiness: QA measured
 * (admin-window/TASK-0065 close) that a hand-rolled numeric coercion of
 * `"abc"` is `NaN`, that staging answers `.range(NaN, NaN)` with an `ok` page
 * of ZERO rows, and that a zero-row `ok` page is EXHAUSTION — so a malformed
 * URL would render to the operator as a set that has ended rather than as a
 * refusal.
 *
 * **FULL-OR-EXHAUSTED** (ARCHITECTURE.md §4.3, admin-window/BUG-0168's
 * ruling). `pageAnswerOf` sets `exhausted === rows.length < CLAIM_WINDOW`
 * from THIS read and from nothing else: a full window continues, a short one
 * — zero rows included — says the set has ended, and no other combination is
 * emitted. The window read is `.range(offset, offset + CLAIM_WINDOW - 1)`, so
 * a page longer than the window is not a page this route can ask for. The
 * client's driver holds the same contract as an invariant it CHECKS
 * (`requestPage`, `lib/paging/machine.ts`) and refuses any other combination
 * out loud, so an answer that broke it would turn every press on `/claims`
 * into a refusal line.
 *
 * **Absence is a normal answer, not an error**: a database with no
 * `pending_claims` answers `not_provisioned` naming it, and it is the PAGE
 * that decides what a not-provisioned surface looks like — by then no
 * affordance is drawn at all (SPEC F10, admin-window/TASK-0067). A registry
 * that refuses does NOT refuse the rows: `sourceLabel` renders the id verbatim
 * when the registry names nothing, exactly as the first screen does today.
 *
 * **GET only.** No POST, no PATCH, no DELETE — this route reads, and Next
 * answers any other method 405.
 *
 * **No service-role material crosses to the client**: the answer carries
 * shaped rows and nothing else — no client, no URL, no key, no env name, and
 * no raw PostgREST error object beyond the `message` §4.1 already renders on
 * the page today.
 */

/**
 * A URL's query as NEXT hands `searchParams` to a page — the shape
 * `lib/claims/filters.ts` reads, so this route and `/claims` answer a repeated
 * key identically.
 *
 * A repeated key becomes an ARRAY in the order it was sent, which is what Next
 * does with `?bucket=a&bucket=b`; `firstValue` in that leaf then takes the
 * first, as `URLSearchParams.get()` would. Building a plain record instead
 * would silently keep the LAST value and the two surfaces would disagree about
 * which narrowing a hand-edited URL asked for.
 *
 * It is a SHAPE adapter and parses no facet: every question about what a value
 * MEANS is the leaf's (admin-window/TASK-0066). The browse paging route
 * (admin-window/TASK-0068) needs the same adapter — it belongs in a shared
 * leaf the day it has a second caller, never a second copy.
 */
function searchParamsOf(query: URLSearchParams): SearchParams {
  const params: SearchParams = {};
  for (const [key, value] of query) {
    const seen = params[key];
    if (seen === undefined) params[key] = value;
    else if (Array.isArray(seen)) seen.push(value);
    else params[key] = [seen, value];
  }
  return params;
}

export async function GET(request: Request): Promise<Response> {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;

  const url = new URL(request.url);

  // The bound, before the read exists: a refused bound issues no query at all.
  // `pageBound` is handed the parameter VERBATIM and is the only reader of it.
  const bound = pageBound(url.searchParams.get(OFFSET_PARAM), CLAIM_WINDOW);
  if (bound.kind === "refused") {
    const refusal: PageAnswer<ClaimLine> = {
      kind: "refused",
      reason: bound.reason,
      bound: bound.bound,
    };
    return Response.json(refusal, { status: 400 });
  }

  // The page's own narrowing, derived by the page's own functions.
  const params = searchParamsOf(url.searchParams);
  const filter = listFilterOf(
    filterFrom(params, RENDERABLE_BUCKETS),
    tabFrom(params),
    STANDING_BUCKET,
  );

  const read = await readClaimWindow({
    filter,
    limit: CLAIM_WINDOW,
    // The ONE value that reaches an offset here: `pageBound`'s own answer.
    offset: bound.offset,
  });
  if (read.kind !== "ok") {
    // `not_provisioned` and `error` cross UNCHANGED (§4.1): the client's
    // refusal names the same object this page's own card would name.
    const answer: PageAnswer<ClaimLine> = pageAnswerOf<ClaimLine>(
      read,
      bound.offset,
      CLAIM_WINDOW,
    );
    return Response.json(answer);
  }

  // The names for exactly THIS page's sources, and no others. A refusal costs
  // the labels and nothing else — `sourceLabel` then renders each id verbatim,
  // which is the first screen's own answer to an unnamed source.
  const registry = await readSourceNames(idsOf(read.data, (claim) => claim.source_id));
  const names = sourceNamesOf(registry.kind === "ok" ? registry.data : []);

  // `claimLines` is one line per claim, in the order the database returned
  // them, so the row count `pageAnswerOf` grades full-or-exhausted against is
  // the count the READ returned — nothing here adds, drops or re-sorts a row.
  const answer: PageAnswer<ClaimLine> = pageAnswerOf<ClaimLine>(
    { kind: "ok", data: claimLines(read.data, names) },
    bound.offset,
    CLAIM_WINDOW,
  );
  return Response.json(answer);
}
