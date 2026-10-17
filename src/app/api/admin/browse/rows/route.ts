import { requireAdmin } from "@/lib/admin";
import type { BrowseRow } from "@/lib/browse/rows";
import { RECENT_EVENTS } from "@/lib/browse/views";
import { readRecentEvents, type BrowseLegNotes } from "@/lib/db/browse";
import { pageAnswerOf } from "@/lib/db/paging";
import {
  PAGE_ANSWER_CACHE_CONTROL,
  PAGE_PARAM,
  SIZE_PARAM,
  windowBound,
  type NotedPageAnswer,
} from "@/lib/paging/bounds";
import { searchParamsOf } from "@/lib/url/search-params";

/**
 * ONE WINDOW of Browse's rows — campaign admin-window/TASK-0068, SPEC F14,
 * page windows since 2026-10-16.
 *
 * `GET /api/admin/browse/rows?page=<n>&size=<s>` answers the window
 * `/browse?page=<n>&size=<s>` would server-render: the recent-events rows of
 * that window, newest first by arrival, and whether the set ends inside it.
 * It is the read a client move makes between windows (ARCHITECTURE.md §4.3
 * read kind 3); a cold load of the same URL renders the same window on the
 * server.
 *
 * **The same steps, in the same order, as the claims paging route** — read
 * that file beside this one; where the two share a step, the step lives in
 * `lib/paging/**` or `lib/db/paging.ts` and neither route spells it
 * (LESSONS 5):
 *
 *  1. **The gate first, and always.** `requireAdmin()` is the first statement
 *     of the body, and `src/middleware.ts` has already turned away a request
 *     with no session before this module is reached at all (M3 EC6).
 *  2. **The view, from the ONE definition layer** (`lib/browse/views.ts`).
 *     Browse ships exactly one curated view and this route names it in code:
 *     no `view` parameter, no table picker, no column list and no search box
 *     reaches a query here. `?cols=` decides which columns RENDER and never
 *     which rows are READ (admin-window/BUG-0114); the rows this route serves
 *     carry every column the view configures whatever the URL said. **Browse
 *     gains no width here** (SPEC F14, §4.3 kind 3).
 *  3. **The WINDOW**, through `windowBound` — asked of the same two parameters
 *     the page reads. A refusal is HTTP 400 carrying the `refused` answer,
 *     naming the parameter and its value AS SENT, and NO read is issued.
 *     Never clamped, never defaulted beyond the stated first-window default.
 *  4. **The read**: `readRecentEvents(view, undefined, offset, size)` — the
 *     same four queries the first screen makes, over this window.
 *  5. **The answer**: `pageAnswerOf`, the one place `DbResult` meets the wire.
 *
 * **THE RAW PARAMETERS REACH NOTHING BUT `windowBound`.** No coercion, no
 * repair, no default of this file's own (QA, admin-window/TASK-0065 close: a
 * `NaN` range answers an ok page of zero rows, which reads as exhaustion).
 *
 * **FULL-OR-EXHAUSTED** (ARCHITECTURE.md §4.3, admin-window/BUG-0168's
 * ruling): `pageAnswerOf` sets `exhausted` from THIS read's row count against
 * the window's size and nothing else, and nothing between `.range()` and here
 * removes a row (`lib/db/browse.ts`).
 *
 * **THE TWO LEGS THAT FILL COLUMNS TRAVEL WITH THE ANSWER OR NOT AT ALL.** A
 * window whose provenance leg refused must not reach the client as events
 * with a silently empty Sources column, so the `ok` arm carries both notes and
 * the client renders them the way the first screen renders them.
 *
 * **A GATED ANSWER IS NEVER STORABLE, AND THIS ROUTE SAYS SO ITSELF.**
 * `PAGE_ANSWER_CACHE_CONTROL` — spelled ONCE, in `lib/paging/bounds.ts` — goes
 * on EVERY arm (admin-window/BUG-0171).
 *
 * **GET only.** No POST, no PATCH, no DELETE — this route reads, and Next
 * answers any other method 405.
 *
 * **No service-role material crosses to the client**: the answer carries
 * shaped rows and the legs' own refusal notes, and nothing else.
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

/** The FIRST value of a parameter, as `URLSearchParams.get()` answers it. */
function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
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

  // The window, before the read exists: a refused window issues no query at
  // all. `windowBound` is handed the parameters VERBATIM and is the only
  // reader of them.
  const bound = windowBound({ page: first(params[PAGE_PARAM]), size: first(params[SIZE_PARAM]) });
  if (bound.kind === "refused") {
    return answer(
      { kind: "refused", reason: bound.reason, param: bound.param, bound: bound.bound },
      400,
    );
  }

  const listing = await readRecentEvents(
    view,
    // The read resolves its own client; this route hands it none.
    undefined,
    // The ONLY values that reach the read: `windowBound`'s own answer.
    bound.offset,
    bound.window.size,
  );

  // `not_provisioned` and `error` cross UNCHANGED (§4.1): the client's refusal
  // names the same object this page's own not-provisioned card would name.
  const page = pageAnswerOf<BrowseRow>(listing.events, bound.window);
  if (page.kind !== "ok") return answer(page);

  // The rows the READ returned, and the two legs' own reports beside them —
  // neither dropped, neither folded into the page's state.
  return answer({
    ...page,
    notes: { venues: listing.venues, provenance: listing.provenance },
  });
}
