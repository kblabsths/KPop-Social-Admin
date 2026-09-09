import { requireAdmin } from "@/lib/admin";
import { isRecordId } from "@/lib/db/records";
import { settleReviewItem } from "@/lib/db/verdict";
import { decisionRefusals, type VerdictDecision } from "@/lib/verdict/decision";

/**
 * The ONE settlement path — campaign admin-window/TASK-0049, spec §7,
 * ARCHITECTURE.md §9.2.
 *
 * `POST /api/admin/review-items/{reviewItemId}/settle` with
 * `{ "action": …, "note": …, "value": … }` settles one review item, in one
 * call, in one transaction. It is the second and last mutating route in this
 * app; the first is the record PATCH route, whose order of business this one
 * follows exactly:
 *
 *  - **the gate first**: `requireAdmin()` (STACK §3). Nothing below runs for a
 *    visitor who is not an allowlisted admin, and `src/middleware.ts` has
 *    already turned away anyone without a session before the handler is
 *    reached at all.
 *  - **then the body**, parsed into a `VerdictDecision` — with the item taken
 *    from the URL and the actor from the session, never from the caller (see
 *    below);
 *  - **then `decisionRefusals`**: a refused decision is a 400 naming every
 *    refusal that applies and NEVER reaches the database. It is the campaign's
 *    one pre-database guard and it never throws, so a body that is not an
 *    object at all, a wrongly-typed field or an absent key is a named refusal
 *    rather than a 500 (admin-window/BUG-0079);
 *  - **then the id**, asked after the refusals so the map of refusals above
 *    keeps its status, exactly as the record route asks it
 *    (admin-window/BUG-0068). A segment that is not a uuid can equal no
 *    primary key, so it is answered without a database call at all;
 *  - **then the ONE call**, `settleReviewItem` — the only database interaction
 *    on this path. No second write path, no `"use server"` action, no direct
 *    write to the review table or to the verdict log from anywhere in `src/`
 *    (`tests/offline/review/one-place.test.ts`,
 *    `tests/offline/edit/config.test.ts`).
 *
 * **POST only.** Next answers every other method 405: this route reads
 * nothing, creates nothing and deletes nothing, and having no GET also means
 * `next build` never invokes the file.
 *
 * **Two fields the caller does not get to choose**, and both are security
 * rather than convenience:
 *
 *  - `review_item_id` is THE URL's segment. A body naming a different item is
 *    a 400 rather than a silent redirect of the settlement to whichever id the
 *    server preferred.
 *  - `actor` is the signed-in admin's own identity, from the gate. The verdict
 *    log is the record of every admin data action (spec §7), so an actor a
 *    caller could type would be a log anyone past the gate could write in
 *    someone else's name.
 *
 * **The absent function is the normal answer** for the whole of M2 and it is
 * not an error: `settle_review_item` is not installed on staging or in
 * production, so the one call comes back `not_provisioned` naming it and this
 * route answers 503 naming the same object — the same card the slot already
 * draws before the click (ARCHITECTURE.md §9.2). Nothing here queues, buffers
 * or retries the write, and nothing writes around it (spec §10).
 */

/** The parts of the decision the caller supplies. Graded, never trusted. */
type ParsedBody =
  | { ok: true; action: unknown; note: unknown; value: unknown }
  | { ok: false; message: string };

/**
 * Read `{ action, note, value }` off the request.
 *
 * Every field stays `unknown`: `decisionRefusals` grades an arbitrary body
 * into NAMED refusals without throwing, and re-deciding here which types are
 * acceptable would be a second, quieter copy of that vocabulary. Only the
 * things it cannot see are decided here — a body that is not JSON at all, and
 * a body that names an item other than the one in the address.
 */
async function parseBody(request: Request, reviewItemId: string): Promise<ParsedBody> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { ok: false, message: "the request body is not valid JSON" };
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, message: "the request body must be a JSON object" };
  }

  const fields = body as Record<string, unknown>;
  const named = fields.review_item_id;
  if (named !== undefined && named !== null && named !== reviewItemId) {
    return {
      ok: false,
      message:
        "the body names a different review item than the address; the item " +
        "settled is the one in the URL",
    };
  }

  return { ok: true, action: fields.action, note: fields.note, value: fields.value };
}

/** "No review item at this address" — one sentence, both ways of reaching it. */
function noSuchItem(): Response {
  return Response.json({ error: "no review item with that id" }, { status: 404 });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ reviewItemId: string }> },
) {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;

  const { reviewItemId } = await params;

  const body = await parseBody(request, reviewItemId);
  if (!body.ok) return Response.json({ error: body.message }, { status: 400 });

  // Built, not trusted: the three caller-supplied fields are `unknown` and the
  // two that matter are the server's own. `decisionRefusals` grades this
  // whatever it holds — that is why it takes the type the caller MEANT rather
  // than a narrowed one (admin-window/BUG-0079).
  const decision = {
    action: body.action,
    review_item_id: reviewItemId,
    actor: gate.user?.email ?? "",
    note: body.note,
    value: body.value,
  } as unknown as VerdictDecision;

  const refusals = decisionRefusals(decision);
  if (refusals.length > 0) {
    return Response.json(
      {
        error: `the decision was refused: ${refusals.join(", ")}`,
        // The identifiers, so a surface can branch on them and say its own
        // words (LESSONS 5) instead of parsing the sentence above.
        refusals,
      },
      { status: 400 },
    );
  }

  if (!isRecordId(reviewItemId)) return noSuchItem();

  const result = await settleReviewItem(undefined, decision);

  if (result.kind === "not_provisioned") {
    return Response.json(
      {
        error: `${result.missing} is not present in this database`,
        missing: result.missing,
      },
      { status: 503 },
    );
  }
  if (result.kind === "error") {
    // The database's own words, unchanged (LOOK_AND_FEEL state 4).
    return Response.json({ error: result.message }, { status: 500 });
  }

  return Response.json({ ok: true, verdict: result.data });
}
