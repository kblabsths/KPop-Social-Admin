import { requireAdmin } from "@/lib/admin";
import { decideEdit, type EditRefusal } from "@/lib/edit/config";
import { updateRecordField, type EditableValue } from "@/lib/db/records";

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
 *  - **Then the map**: `decideEdit()` in `src/lib/edit/config.ts`. A column
 *    absent from the map, a resolver-owned table and a table the map does not
 *    carry are all refused HERE, server-side, with the row unchanged and the
 *    refusal naming the field or the table — hiding a widget is not a refusal
 *    (acceptance test 7). There is no allowlist in this file; there is no
 *    second allowlist anywhere in the repo.
 *  - **PATCH only.** No GET, no POST, no DELETE: no catalog row is inserted or
 *    deleted from Admin, and nothing here reads a record (the page does that
 *    through `lib/db/records.ts`). Next answers any other method with 405.
 *    Having no GET also means `next build` never invokes this file, so it is
 *    not a build-time database read.
 *
 * The request body carries a SCALAR value or null, and the `value` key must be
 * PRESENT: an object or an array is refused, and so is a body that omits
 * `value` entirely. The catalog's editable columns are typed scalars, no json
 * column is written from here (root CLAUDE.md, AGENTS.md), and only an
 * explicit `null` or `""` clears a column.
 */

/** The HTTP status each refusal deserves. */
function statusFor(refusal: EditRefusal): number {
  switch (refusal.kind) {
    // No such editable record surface at this path.
    case "unknown_table":
      return 404;
    // The table exists and is understood; policy refuses the write.
    case "resolver_owned":
    case "field_not_editable":
      return 403;
  }
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
  return { ok: true, field, value };
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

  const result = await updateRecordField(decision.edit, id, body.value);

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
  if (result.data === null) {
    return Response.json(
      { error: `no ${table} record with that id` },
      { status: 404 },
    );
  }

  return Response.json({ ok: true, record: result.data });
}
