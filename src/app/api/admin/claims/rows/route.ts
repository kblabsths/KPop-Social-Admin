import { requireAdmin } from "@/lib/admin";
import { filterFrom, listFilterOf, tabFrom } from "@/lib/claims/filters";
import { claimLines, type ClaimLine } from "@/lib/claims/lines";
import { RENDERABLE_BUCKETS, readClaimWindow } from "@/lib/db/claims";
import { pageAnswerOf } from "@/lib/db/paging";
import { readSourceNames } from "@/lib/db/sources";
import { idsOf } from "@/lib/gauges/gauge";
import { STANDING_BUCKET } from "@/lib/gauges/standing-disagreements";
import {
  PAGE_ANSWER_CACHE_CONTROL,
  PAGE_PARAM,
  SIZE_PARAM,
  windowBound,
  type PageAnswer,
} from "@/lib/paging/bounds";
import { sourceNamesOf } from "@/lib/sources/names";
import { searchParamsOf } from "@/lib/url/search-params";

/**
 * ONE WINDOW of the claims list — campaign admin-window/TASK-0066, SPEC F14,
 * page windows since 2026-10-16.
 *
 * `GET /api/admin/claims/rows?<the page's own facets>&page=<n>&size=<s>`
 * answers the window `/claims?page=<n>&size=<s>` would server-render, over
 * the same narrowing: the rows of that window, in the list's own order, and
 * whether the set ends inside it. It is the read a client move makes between
 * windows (ARCHITECTURE.md §4.3 read kind 3); a cold load of the same URL
 * renders the same window on the server.
 *
 * **The order of the guards is `src/app/api/admin/records/[table]/[id]/
 * route.ts`'s**, because a read route is gated exactly as a write route is:
 *
 *  - **The gate first, and always.** `requireAdmin()` is the first statement
 *    of the body, and `src/middleware.ts` has already turned away a request
 *    with no session before this module is reached at all (M3 EC6).
 *  - **Then the WINDOW**, through `windowBound` — the one guard that decides
 *    which windows this app serves, asked of the same two parameters the page
 *    reads. A refusal is HTTP 400 carrying the `refused` answer, naming the
 *    parameter and its value AS SENT, and no read is issued. Never clamped
 *    (M3 EC6).
 *  - **Then the facets, through the PAGE's own derivation.** `filterFrom` +
 *    `tabFrom` + `listFilterOf` (`lib/claims/filters.ts`) are the same
 *    functions `src/app/claims/page.tsx` calls, given the same search
 *    parameters — so the rows of a window belong to the narrowing every other
 *    window came from. **No facet is parsed in this file** (LESSONS 5).
 *  - **Then the read**: `readClaimWindow` at that offset and size, the
 *    source-name registry for exactly this window's `source_id`s, and
 *    `claimLines` — the leaf the first screen shapes its own rows with.
 *
 * **THE RAW PARAMETERS REACH NOTHING BUT `windowBound`.** This file does no
 * arithmetic of its own on them — no coercion, no repair, no default — and the
 * only values that reach `readClaimWindow` are the offset and size
 * `windowBound` returned on its `ok` arm. QA measured (admin-window/TASK-0065
 * close) that a hand-rolled numeric coercion of `"abc"` is `NaN`, that staging
 * answers `.range(NaN, NaN)` with an `ok` page of ZERO rows, and that a
 * zero-row `ok` page reads as exhaustion — so a malformed URL would render to
 * the operator as a set that has ended rather than as a refusal.
 *
 * **FULL-OR-EXHAUSTED** (ARCHITECTURE.md §4.3, admin-window/BUG-0168's
 * ruling). `pageAnswerOf` sets `exhausted` from THIS read's row count against
 * the window's size and from nothing else: a full window continues, a short
 * one — zero rows included — says the set has ended inside it. The client's
 * driver holds the same contract as an invariant it CHECKS (`requestPage`,
 * `lib/paging/machine.ts`) and refuses any other combination out loud.
 *
 * **Absence is a normal answer, not an error**: a database with no
 * `pending_claims` answers `not_provisioned` naming it. A registry that
 * refuses does NOT refuse the rows: `sourceLabel` renders the id verbatim when
 * the registry names nothing, exactly as the first screen does.
 *
 * **A GATED ANSWER IS NEVER STORABLE, AND THIS ROUTE SAYS SO ITSELF**
 * (admin-window/BUG-0171): `PAGE_ANSWER_CACHE_CONTROL`, declared once in
 * `lib/paging/bounds.ts`, goes on EVERY arm.
 *
 * **GET only.** No POST, no PATCH, no DELETE — this route reads, and Next
 * answers any other method 405.
 *
 * **No service-role material crosses to the client**: the answer carries
 * shaped rows and nothing else.
 */

/** Every answer this route emits, on every arm. */
function answer(body: PageAnswer<ClaimLine>, status?: number): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": PAGE_ANSWER_CACHE_CONTROL },
  });
}

export async function GET(request: Request): Promise<Response> {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;

  const url = new URL(request.url);

  // The window, before the read exists: a refused window issues no query at
  // all. `windowBound` is handed the parameters VERBATIM and is the only
  // reader of them; a repeated key takes the FIRST value, as
  // `URLSearchParams.get()` does and as the page does.
  const bound = windowBound({
    page: url.searchParams.get(PAGE_PARAM),
    size: url.searchParams.get(SIZE_PARAM),
  });
  if (bound.kind === "refused") {
    return answer(
      { kind: "refused", reason: bound.reason, param: bound.param, bound: bound.bound },
      400,
    );
  }

  // The page's own narrowing, derived by the page's own functions, off the
  // record the ONE shared adapter builds (`lib/url/search-params.ts`).
  const params = searchParamsOf(url.searchParams);
  const filter = listFilterOf(
    filterFrom(params, RENDERABLE_BUCKETS),
    tabFrom(params),
    STANDING_BUCKET,
  );

  const read = await readClaimWindow({
    filter,
    limit: bound.window.size,
    // The ONE value that reaches an offset here: `windowBound`'s own answer.
    offset: bound.offset,
  });
  if (read.kind !== "ok") {
    // `not_provisioned` and `error` cross UNCHANGED (§4.1).
    return answer(pageAnswerOf<ClaimLine>(read, bound.window));
  }

  // The names for exactly THIS window's sources, and no others.
  const registry = await readSourceNames(idsOf(read.data, (claim) => claim.source_id));
  const names = sourceNamesOf(registry.kind === "ok" ? registry.data : []);

  // `claimLines` is one line per claim, in the order the database returned
  // them, so the row count `pageAnswerOf` grades full-or-exhausted against is
  // the count the READ returned — nothing here adds, drops or re-sorts a row.
  return answer(
    pageAnswerOf<ClaimLine>({ kind: "ok", data: claimLines(read.data, names) }, bound.window),
  );
}
