import { requireAdmin } from "@/lib/admin";
import type { BrowseRow } from "@/lib/browse/rows";
import { RECENT_EVENTS } from "@/lib/browse/views";
import { readRecentEvents, type BrowseLegNotes } from "@/lib/db/browse";
import { pageAnswerOf } from "@/lib/db/paging";
import {
  OFFSET_PARAM,
  PAGE_ANSWER_CACHE_CONTROL,
  pageBound,
  type NotedPageAnswer,
} from "@/lib/paging/bounds";
import { searchParamsOf } from "@/lib/url/search-params";

/**
 * Browse's rows, CONTINUED — campaign admin-window/TASK-0068, SPEC F14.
 *
 * `GET /api/admin/browse/rows?offset=<n>` answers ONE page of the same
 * recent-events window `/browse` server-rendered, at an explicit bound. The
 * first screen does not change; this is what the operator can do AFTER it
 * (ARCHITECTURE.md §4.3 read kind 3).
 *
 * **The same five steps, in the same order, as the claims paging route** —
 * read that file beside this one; where the two share a step, the step lives
 * in `lib/paging/**` or `lib/db/paging.ts` and neither route spells it
 * (LESSONS 5: the second copy is what drifts).
 *
 *  1. **The gate first, and always.** `requireAdmin()` is the first statement
 *     of the body, and `src/middleware.ts` has already turned away a request
 *     with no session before this module is reached at all (M3 EC6).
 *  2. **The view, from the ONE definition layer** (`lib/browse/views.ts`).
 *     Browse ships exactly one curated view and this route names it in code:
 *     no `view` parameter, no table picker, no column list and no search box
 *     reaches a query here, so a request cannot name a view or a column the
 *     config does not carry — the strongest form of that rule, since the
 *     request is never asked. `?cols=` decides which columns RENDER and never
 *     which rows are READ (admin-window/BUG-0114), so it is the page's to
 *     resolve and it reaches nothing below; the rows this route serves carry
 *     every column the view configures whatever the URL said. **Browse gains
 *     no width here** (SPEC F14, §4.3 kind 3).
 *  3. **The BOUND**, through `pageBound` — the one guard that decides which
 *     offsets this app may serve. A refusal is HTTP 400 carrying the `refused`
 *     answer, naming the reason and the bound AS SENT, and NO read is issued.
 *     Never clamped, never defaulted.
 *  4. **The read**: `readRecentEvents(view, undefined, offset)` — the same
 *     four queries the first screen makes, one window further in.
 *  5. **The answer**: `pageAnswerOf`, the one place `DbResult` meets the wire.
 *
 * **THE URL'S OFFSET REACHES NOTHING BUT `pageBound`.** This file does no
 * arithmetic of its own on the raw parameter — no coercion, no repair, no
 * default — and the only value that reaches `readRecentEvents`' `offset` is
 * the number `pageBound` returned on its `ok` arm. That is not tidiness: QA
 * measured (admin-window/TASK-0065 close) that a hand-rolled numeric coercion
 * of `"abc"` is `NaN`, that staging answers `.range(NaN, NaN)` with an `ok`
 * page of ZERO rows, and that a zero-row `ok` page is EXHAUSTION — so a
 * malformed URL would render to the operator as a set that has ENDED rather
 * than as a refusal.
 *
 * **FULL-OR-EXHAUSTED** (ARCHITECTURE.md §4.3, admin-window/BUG-0168's
 * ruling). `pageAnswerOf` sets `exhausted === rows.length < view.window` from
 * THIS read and nothing else, and nothing between `.range()` and here removes
 * a row (`lib/db/browse.ts`): a full window continues, a short one — zero rows
 * included — says the set has ended, and no other combination is emitted. The
 * client's driver holds the same contract as an invariant it CHECKS and
 * refuses any other combination out loud, so an answer that broke it would
 * turn every press on `/browse` into a refusal line.
 *
 * **THE TWO LEGS THAT FILL COLUMNS TRAVEL WITH THE ANSWER OR NOT AT ALL.** A
 * page whose provenance leg refused must not reach the client as events with a
 * silently empty Sources column, so the `ok` arm carries both notes and the
 * client renders them the way the first screen renders them today. They ride
 * the `ok` arm only — the other three arms have no rows, so no column of
 * theirs went unfilled.
 *
 * **A GATED ANSWER IS NEVER STORABLE, AND THIS ROUTE SAYS SO ITSELF.** Every
 * dynamically rendered page here already answers
 * `private, no-cache, no-store, max-age=0, must-revalidate` because Next sets
 * it; a Route Handler answers with NO `Cache-Control` unless it writes one, so
 * without this the first screen and its continuation would be one surface
 * under two cache policies. `PAGE_ANSWER_CACHE_CONTROL` is the value, declared
 * once in `lib/paging/bounds.ts` and never a second string typed here, and it
 * goes on EVERY arm — the `ok` page, `not_provisioned`, `error` and the 400
 * refusal alike.
 *
 * **GET only.** No POST, no PATCH, no DELETE — this route reads, and Next
 * answers any other method 405.
 *
 * **No service-role material crosses to the client**: the answer carries
 * shaped rows and the legs' own refusal notes, and nothing else — no client,
 * no URL, no key, no env name, and no raw PostgREST error object beyond the
 * `message` §4.1 already renders on the page today.
 */

/** Every answer this route emits, on every arm. */
function answer(
  body: NotedPageAnswer<BrowseRow, BrowseLegNotes>,
  status?: number,
): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": PAGE_ANSWER_CACHE_CONTROL },
  });
}

export async function GET(request: Request): Promise<Response> {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;

  const view = RECENT_EVENTS;
  // The URL's query, through the ONE adapter both paging routes share: a
  // repeated key becomes an array in the order it was sent, and the record has
  // no prototype, so `?__proto__=…` is an own entry that reaches no object's
  // prototype (`lib/url/search-params.ts`).
  const params = searchParamsOf(new URL(request.url).searchParams);

  // The bound, before the read exists: a refused bound issues no query at all.
  // `pageBound` is handed the parameter VERBATIM and is the only reader of it;
  // a repeated `offset` takes the FIRST value, exactly as
  // `URLSearchParams.get()` does on the claims route.
  const asked = params[OFFSET_PARAM];
  const bound = pageBound(Array.isArray(asked) ? asked[0] : asked, view.window);
  if (bound.kind === "refused") {
    return answer({ kind: "refused", reason: bound.reason, bound: bound.bound }, 400);
  }

  const listing = await readRecentEvents(
    view,
    // The read resolves its own client; this route hands it none.
    undefined,
    // The ONE value that reaches an offset here: `pageBound`'s own answer.
    bound.offset,
  );

  // `not_provisioned` and `error` cross UNCHANGED (§4.1): the client's refusal
  // names the same object this page's own not-provisioned card would name, and
  // by then no affordance is drawn at all (SPEC F10).
  const page = pageAnswerOf<BrowseRow>(listing.events, bound.offset, view.window);
  if (page.kind !== "ok") return answer(page);

  // The rows the READ returned, and the two legs' own reports beside them —
  // neither dropped, neither folded into the page's state.
  return answer({
    ...page,
    notes: { venues: listing.venues, provenance: listing.provenance },
  });
}
