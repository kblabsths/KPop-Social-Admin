import { requireAdmin } from "@/lib/admin";
import { decideEdit, type AllowedEdit, type EditRefusal } from "@/lib/edit/config";
import {
  isRecordId,
  updateRecordField,
  type EditableValue,
} from "@/lib/db/records";
import { settleReviewItem } from "@/lib/db/verdict";
import { decisionRefusals, type VerdictDecision } from "@/lib/verdict/decision";
import type { DbResult } from "@/lib/db/result";

/**
 * The ONE write path of the edit surface — campaign admin-window/TASK-0017.
 *
 * `PATCH /api/admin/records/{table}/{id}` with `{ "field": …, "value": … }`
 * sets one column of one record. It is the only mutating route in the app.
 *
 *  - **The gate first**: `requireAdmin()`, like every route before it
 *    (STACK §3). Nothing below runs for a visitor who is not an allowlisted
 *    admin, and `src/middleware.ts` has already turned away anyone without a
 *    session before the handler is reached at all.
 *  - **Then the id**: `isRecordId()` (`src/lib/db/records.ts`), the record
 *    PAGE's own question, asked AFTER the map so every refusal the map owns
 *    keeps the status it has (campaign admin-window/BUG-0068). See
 *    `noSuchRecord` below for why a segment that is not an id is an answer and
 *    not a database call.
 *  - **Then the map**: `decideEdit()` in `src/lib/edit/config.ts`. A column
 *    absent from the map and a table the map does not carry are both refused
 *    HERE, server-side, with the row unchanged and the refusal naming the
 *    field or the table — hiding a widget is not a refusal (acceptance test
 *    7). There is no allowlist in this file; there is no second allowlist
 *    anywhere in the repo.
 *  - **Then the PATH, and the path alone**: the decision carries
 *    `edit.path` — `writePathFor(regime)`'s answer, resolved in the map
 *    (ARCHITECTURE §9, campaign admin-window/TASK-0054). `direct` writes the
 *    row; `override` records an admin-tier observation through the settlement
 *    function. **This file branches on that value and never on a table name or
 *    a config key**: configuration says WHICH columns, the regime says HOW, and
 *    a route re-deriving the second from the first is how the two drift apart.
 *  - **PATCH only.** No GET, no POST, no DELETE: no catalog row is inserted or
 *    deleted from Admin, and nothing here reads a record (the page does that
 *    through `lib/db/records.ts`). Next answers any other method with 405.
 *    Having no GET also means `next build` never invokes this file, so it is
 *    not a build-time database read.
 *
 * **The override path, in one call** (spec §7/§8, ARCHITECTURE §9.2). A
 * resolver-owned column's edit is ONE call to the settlement seam carrying
 * `action: "override"`, a null review item — spec §7's "an override is the
 * same row without the item" — the admin's own identity from the gate, and the
 * value the operator typed. Admin performs none of the steps behind it: the
 * function writes the observation through the gate, applies it, stamps the
 * fact `admin_locked` and logs the verdict. There is no second write here, no
 * provenance insert, no lock update.
 *
 * **The absent function is the normal answer** for the whole of M2, and it is
 * not an error: the seam comes back `not_provisioned` naming what it called,
 * and this route answers 503 naming the same object. Nothing queues, buffers,
 * retries or writes around it (spec §10's one forbidden move) — the surface
 * degrades to the read-only page M1 already shipped.
 *
 * **A refusal the GATE makes is the database's own** — the registry patterns
 * on `venues.country` and `events.poster_url` are enforced there, and this app
 * holds no copy of them. Such a refusal arrives as an `error` carrying the
 * function's words and is answered 500 with those words unchanged, exactly as
 * a `23502` from the direct path already is (LOOK_AND_FEEL state 4). Never a
 * 2xx, never a silent success, and the row is whatever the database left it.
 *
 * The request body carries a SCALAR value or null, and the `value` key must be
 * PRESENT: an object or an array is refused, so is a body that omits `value`
 * entirely, and so is a number that is not finite (it cannot survive the
 * JSON round trip to PostgREST — campaign admin-window/BUG-0013). The
 * catalog's editable columns are typed scalars, no json column is written from
 * here (root CLAUDE.md, AGENTS.md), and only an explicit `null` or `""` clears
 * a column.
 */

/** The HTTP status each refusal deserves. */
function statusFor(refusal: EditRefusal): number {
  switch (refusal.kind) {
    // No such editable record surface at this path.
    case "unknown_table":
      return 404;
    // The table exists and is understood; the map refuses this column of it.
    case "field_not_editable":
      return 403;
  }
}

/**
 * "No record at this address" — the ONE sentence this route has for it, and
 * both ways of reaching it (campaign admin-window/BUG-0068).
 *
 * A well-formed id the writer looked for and did not find, and a URL segment
 * that is not a record id at all, are the same answer to the caller: there is
 * no such record here. The second needs no database to say so — every table in
 * the map is keyed by a uuid, so a segment that is not one can equal no
 * primary key anywhere (`isRecordId` carries why, and carries the grammar;
 * this file writes no second one — ARCHITECTURE §9.1 item 9).
 *
 * What it replaces: handing the segment to PostgREST, which returned Postgres's
 * `22P02 invalid input syntax for type uuid`, which the data layer classified —
 * correctly, for a read it did make — as an arbitrary failure, which this route
 * then answered as HTTP 500 carrying the database's own words. The status said
 * the app broke when the request was malformed, and the body handed raw
 * Postgres syntax text back to the caller who supplied the bad input. The 500
 * branch below is unchanged and still says what the database said: that rule is
 * for a read or write that really happened.
 */
function noSuchRecord(table: string): Response {
  return Response.json(
    { error: `no ${table} record with that id` },
    { status: 404 },
  );
}

/** The parsed body, or the reason it is unusable. */
type ParsedBody =
  | { ok: true; field: string; value: EditableValue }
  | { ok: false; message: string };

/**
 * Read `{ field, value }` off the request — the shape the retired per-table
 * routes used and the shape `EditableCell` produces, carried over unchanged.
 *
 * Clearing is EXPLICIT and requires the key to be there: an empty string or a
 * literal `null` sets the column to `null`, which is what a cleared input
 * means; that normalisation belongs here, at the HTTP edge, and not in the
 * data layer. A body carrying NO `value` key states no intent at all and is
 * refused — see the guard below (campaign admin-window/BUG-0011).
 */
async function parseBody(request: Request): Promise<ParsedBody> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { ok: false, message: "the request body is not valid JSON" };
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, message: "the request body must be a JSON object" };
  }

  const { field } = body as { field?: unknown };
  if (typeof field !== "string" || field.length === 0) {
    return { ok: false, message: "field must be a non-empty string" };
  }

  // An ABSENT `value` key is malformed, never a clear — campaign
  // admin-window/BUG-0011. `JSON.stringify` drops a key whose value is
  // `undefined`, so folding the missing key into the clearing branch let a
  // widget bug null a vetted catalog column and be told `{"ok":true}`. The
  // retired route this shape comes from
  // (`git show 5cf4199^:'src/app/api/admin/groups/[id]/route.ts'`, line 28:
  // `{ [field]: value === "" ? null : value }`) nulled on `""` alone and let
  // an explicit `null` through as itself; an omitted key reached PostgREST as
  // an empty patch, never as a NULL. Both explicit clears are kept below.
  if (!Object.prototype.hasOwnProperty.call(body, "value")) {
    return {
      ok: false,
      message: 'value is required; send null or "" to clear the field',
    };
  }
  const { value } = body as { value?: unknown };

  if (value === null || value === "") {
    return { ok: true, field, value: null };
  }
  if (
    typeof value !== "string" &&
    typeof value !== "number" &&
    typeof value !== "boolean"
  ) {
    return {
      ok: false,
      message: "value must be a string, a number, a boolean or null",
    };
  }
  // A NON-FINITE number is malformed too, and for the same reason an absent
  // key is — campaign admin-window/BUG-0013. `1e999` is valid JSON and parses
  // to `Infinity`, whose `typeof` is `"number"`, so the scalar gate above
  // admits it; supabase-js then serialises the update body with
  // `JSON.stringify`, and `JSON.stringify(Infinity)` is `"null"` (ECMA-262).
  // PostgREST would receive `{"<column>":null}` — byte-identical to an
  // explicit clear — so a request that asked to SET a value would silently
  // NULL a vetted catalog column with the service-role key and be answered
  // 200 `{"ok":true}`. Only an explicit `null` or `""` clears (see above), so
  // this is refused here, before `decideEdit` and before any update query
  // exists. `NaN` and `-Infinity` cannot arrive through `JSON.parse` at all;
  // the guard is on the VALUE, not on the literal that produced it, so they
  // are covered whatever hands this body over.
  if (typeof value === "number" && !Number.isFinite(value)) {
    return {
      ok: false,
      message: `value must be a finite number; ${String(value)} cannot be stored`,
    };
  }
  return { ok: true, field, value };
}

/**
 * The one call the override path makes — campaign admin-window/TASK-0054.
 *
 * The envelope is `VerdictDecision` and nothing else is added to it: no source
 * name, no tier, no schema version, no canonical column distinct from the
 * registry field — the function knows all of that, and a copy of it here would
 * be scraper registry knowledge re-encoded by hand (ARCHITECTURE §9.2).
 *
 * Two fields are the SERVER's, never the caller's: the item is null because an
 * override has none, and the actor is the signed-in admin from the gate — a
 * verdict log anyone past the gate could sign in another name is not a log.
 *
 * `decisionRefusals` runs before the call, as it does on the settle route: a
 * malformed decision is a NAMED 400 that never reaches the database. The one
 * shape a cell can produce that lands here is a CLEAR — an override carries
 * exactly one filled payload slot, and a null value fills none — so clearing a
 * resolver-owned field is refused `value_payload_missing` rather than being
 * quietly turned into something the envelope cannot say.
 */
async function overrideField(
  edit: AllowedEdit,
  id: string,
  value: EditableValue,
  actor: string,
): Promise<Response> {
  const decision: VerdictDecision = {
    action: "override",
    review_item_id: null,
    actor,
    note: null,
    value: {
      domain: edit.config.table,
      entity_id: id,
      field: edit.field,
      observation_id: null,
      value,
      ref: null,
    },
  };

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
    // The function's own refusal, unchanged — including the gate's, which is
    // where a registry pattern is enforced.
    return Response.json({ error: result.message }, { status: 500 });
  }

  // No record comes back: the value the operator typed became an observation,
  // and what the canonical row now holds is the pipeline's answer, read on the
  // next render. Reporting the request as the stored value would be the fake
  // success this milestone forbids.
  return Response.json({ ok: true, verdict: result.data });
}

/** What the DIRECT path makes of each writer outcome — the M1 answers, unchanged. */
function directAnswer(
  table: string,
  result: DbResult<Record<string, unknown> | null>,
): Response {
  if (result.kind === "not_provisioned") {
    return Response.json(
      { error: `${result.missing} is not present in this database` },
      { status: 503 },
    );
  }
  if (result.kind === "error") {
    // The database's own words, unchanged (LOOK_AND_FEEL: "the app shows what
    // the database said").
    return Response.json({ error: result.message }, { status: 500 });
  }
  if (result.data === null) return noSuchRecord(table);

  return Response.json({ ok: true, record: result.data });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ table: string; id: string }> },
) {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;

  const { table, id } = await params;

  const body = await parseBody(request);
  if (!body.ok) {
    return Response.json({ error: body.message }, { status: 400 });
  }

  const decision = decideEdit(table, body.field);
  if (!decision.allowed) {
    return Response.json(
      { error: decision.refusal.message },
      { status: statusFor(decision.refusal) },
    );
  }

  // The segment is not an id at all — a question about the REQUEST, settled
  // here, BEFORE any database call, exactly as the record page settles it
  // before any read (admin-window/BUG-0065, admin-window/BUG-0068). It is
  // asked AFTER `decideEdit` so the map's refusals above keep their statuses.
  if (!isRecordId(id)) return noSuchRecord(table);

  // THE branch, and it reads one value: the path the map resolved from the
  // regime. Adding a table to the map cannot move it between these two arms —
  // only its regime can (ARCHITECTURE §9).
  if (decision.edit.path === "override") {
    return overrideField(decision.edit, id, body.value, gate.user?.email ?? "");
  }

  return directAnswer(table, await updateRecordField(decision.edit, id, body.value));
}
