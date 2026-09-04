import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The record PATCH route's own decisions, offline — campaign
 * admin-window/TASK-0017, acceptance test 7 ("a column in the map edits; a
 * column absent refuses even a forged request").
 *
 * Why this tier exists. `tests/offline/edit/records.test.ts` proves the DATA
 * LAYER refuses and issues no query; `tests/http/edit.http.test.ts` proves the
 * route is reachable only past the gate — but under TASK-0027's DB sentinels
 * `requireAdmin()` fails closed there, so every PATCH is refused BY THE GATE
 * and no assertion at that tier can tell a gate refusal from a map refusal.
 * Between the two sits the question acceptance test 7 actually asks: with an
 * admin session in hand, what does the HANDLER do with a forged body?
 *
 * The gate is stubbed open here on purpose — that is the adversary's premise:
 * a caller who IS an allowlisted admin (or a stolen admin session) is still
 * held to the map. The data layer is spied rather than exercised, so "no write
 * was even attempted" is observable as "the writer was never called".
 */

const updateRecordField = vi.fn();

vi.mock("@/lib/admin", () => ({
  requireAdmin: vi.fn(async () => ({ user: { email: "qa@example.invalid" } })),
}));

// The writer alone is replaced by the spy; every other export stays REAL —
// `isRecordId` above all, because the route must ask the record page's own id
// question and not a copy of it (admin-window/BUG-0068). A stubbed
// `isRecordId` would prove the route calls *something*, which is not the claim.
vi.mock("@/lib/db/records", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/records")>();
  return {
    ...actual,
    updateRecordField: (...args: unknown[]) => updateRecordField(...args),
  };
});

const { PATCH } = await import("@/app/api/admin/records/[table]/[id]/route");

const RECORD_ID = "2f0bc11e-0000-4000-8000-000000000001";

/** Drive the handler the way the network would: a Request and route params. */
async function patch(table: string, body: unknown, id = RECORD_ID) {
  const request = new Request(
    `http://127.0.0.1/api/admin/records/${table}/${id}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    },
  );
  const response = await PATCH(request, {
    params: Promise.resolve({ table, id }),
  });
  const text = await response.text();
  return { status: response.status, text };
}

beforeEach(() => {
  updateRecordField.mockReset();
  updateRecordField.mockResolvedValue({
    kind: "ok",
    data: { id: RECORD_ID, bio: "written" },
  });
});

/* ── the one edit that is allowed ─────────────────────────────────────────── */

describe("a mapped column of a pre-cutover table", () => {
  it("reaches the writer with the map's own config", async () => {
    const { status } = await patch("groups", { field: "bio", value: "hello" });
    expect(status).toBe(200);
    expect(updateRecordField).toHaveBeenCalledTimes(1);
    const [edit, id, value] = updateRecordField.mock.calls[0];
    expect((edit as { config: { table: string } }).config.table).toBe("groups");
    expect((edit as { field: string }).field).toBe("bio");
    expect(id).toBe(RECORD_ID);
    expect(value).toBe("hello");
  });

  it("ignores every other key in the body — no second field is written", async () => {
    // A forged body that names a mapped column AND smuggles unmapped ones
    // beside it must apply the mapped one only, never partially apply the rest.
    await patch("groups", {
      field: "bio",
      value: "hello",
      spotify_id: "forged",
      name: "forged",
      id: "00000000-0000-4000-8000-000000000000",
      updated_at: "2026-01-01T00:00:00Z",
    });
    expect(updateRecordField).toHaveBeenCalledTimes(1);
    expect(updateRecordField.mock.calls[0][2]).toBe("hello");
    expect(updateRecordField.mock.calls[0][0]).toEqual(
      expect.objectContaining({ field: "bio" }),
    );
  });
});

/* ── the refusals: 4xx, and the writer never called ───────────────────────── */

/** Every refusal asserts BOTH halves: a non-2xx, and no write attempted. */
async function refused(table: string, body: unknown, where: string) {
  const { status } = await patch(table, body);
  expect(status, where).toBeGreaterThanOrEqual(400);
  expect(status, where).toBeLessThan(500);
  expect(updateRecordField, where).not.toHaveBeenCalled();
}

describe("the handler refuses a forged edit and attempts no write", () => {
  it("refuses a column the map does not carry", async () => {
    for (const field of ["spotify_id", "fanclub_name", "social_links", "wikipedia_url"]) {
      await refused("groups", { field, value: "forged" }, field);
      updateRecordField.mockReset();
    }
  });

  it("refuses a primary key, a foreign key and a timestamp", async () => {
    for (const [table, field] of [
      ["groups", "id"],
      ["groups", "created_at"],
      ["groups", "updated_at"],
      ["idols", "group_id"],
      ["idols", "last_synced_at"],
    ] as const) {
      await refused(table, { field, value: "forged" }, `${table}.${field}`);
      updateRecordField.mockReset();
    }
  });

  it("refuses every column of a resolver-owned table", async () => {
    for (const [table, field] of [
      ["events", "title"],
      ["events", "starts_at"],
      ["events", "venue_id"],
      ["venues", "name"],
      ["venues", "city"],
    ] as const) {
      await refused(table, { field, value: "forged" }, `${table}.${field}`);
      updateRecordField.mockReset();
    }
  });

  it("refuses a table the map does not carry, the archive and a legacy table", async () => {
    for (const table of [
      "event_performers",
      "scraped_events",
      "events_legacy",
      "groups_legacy",
      "admin_allowed_emails",
      "user_roles",
    ]) {
      await refused(table, { field: "name", value: "forged" }, table);
      updateRecordField.mockReset();
    }
  });

  it("is not fooled by a case, whitespace or homoglyph variant of a mapped column", async () => {
    // `nаme` carries a Cyrillic а (U+0430); the rest differ only in case or
    // padding. An allowlist compared loosely would let any of them through.
    for (const field of ["Name", "NAME", "name ", " name", "na me", "nаme", "bio\n"]) {
      await refused("groups", { field, value: "forged" }, JSON.stringify(field));
      updateRecordField.mockReset();
    }
  });

  it("is not fooled by a case or punctuation variant of a mapped table", async () => {
    for (const table of ["Groups", "GROUPS", "groups ", "groups/", "public.groups", "idols;"]) {
      await refused(table, { field: "name", value: "forged" }, table);
      updateRecordField.mockReset();
    }
  });

  it("is not fooled by a name inherited from Object.prototype", async () => {
    for (const field of ["__proto__", "constructor", "prototype", "toString", "hasOwnProperty"]) {
      await refused("groups", { field, value: "forged" }, `field ${field}`);
      updateRecordField.mockReset();
    }
    for (const table of ["__proto__", "constructor", "toString"]) {
      await refused(table, { field: "name", value: "forged" }, `table ${table}`);
      updateRecordField.mockReset();
    }
  });

  it("refuses a body that is not an object of the documented shape", async () => {
    for (const body of ["[]", '"a string"', "42", "true", "null", "not json at all", ""]) {
      await refused("groups", body, JSON.stringify(body));
      updateRecordField.mockReset();
    }
  });

  it("refuses a non-string or empty field name", async () => {
    for (const field of [123, true, null, [], { name: "bio" }, ""]) {
      await refused("groups", { field, value: "x" }, JSON.stringify(field));
      updateRecordField.mockReset();
    }
  });

  it("refuses a non-scalar value for a mapped column", async () => {
    // No json is ever written from here (root CLAUDE.md, AGENTS.md).
    for (const value of [{ nested: true }, ["a", "b"], [{ a: 1 }]]) {
      await refused("groups", { field: "bio", value }, JSON.stringify(value));
      updateRecordField.mockReset();
    }
  });

  /**
   * A number JSON can PARSE but cannot CARRY BACK.
   *
   * `1e999` is valid JSON and parses to `Infinity`; `typeof Infinity` is
   * `"number"`, so the scalar gate accepts it. It then reaches
   * `updateRecordField`, and supabase-js serialises the update payload with
   * `JSON.stringify` — which renders a non-finite number as `null`. The bytes
   * PostgREST receives are `{"bio":null}`, byte-identical to an explicit
   * clear, and the route answers 200 `{"ok":true}`.
   *
   * That contradicts the route's own contract (route.ts: "only an explicit
   * `null` or `\"\"` clears a column") and is BUG-0011's harm through a
   * different door: a request that asked to SET a value silently NULLs a
   * vetted catalog column with the service-role key and is told it succeeded.
   *
   * The bodies are raw strings on purpose: `JSON.stringify({value: Infinity})`
   * is `{"value":null}`, so an object body cannot express this request — a
   * test that builds its body as an object exercises the explicit-clear path
   * instead and passes for the wrong reason.
   *
   * PINNED `it.fails` (strict) for admin-window/BUG-0013: it is green only
   * while the divergence is live, so fixing the route turns it RED and the fix
   * flips it back to a plain `it()`. Watched failing as a plain `it()` against
   * run/admin-window @ 8ff70f7 before BUG-0013 was filed:
   * "AssertionError: {\"field\":\"bio\",\"value\":1e999}: expected 200 to be
   * greater than or equal to 400".
   */
  it("refuses a non-finite number instead of nulling the column", async () => {
    for (const body of [
      '{"field":"bio","value":1e999}',
      '{"field":"bio","value":-1e999}',
      '{"field":"member_count","value":1e999}',
    ]) {
      await refused("groups", body, body);
      updateRecordField.mockReset();
    }
  });

  /**
   * The finiteness guard's EDGES — campaign admin-window/BUG-0013, QA attack.
   *
   * A guard written against the literal `1e999` rather than against the parsed
   * VALUE passes the tests above and still leaks, and a guard written too wide
   * refuses legitimate edits. Three edges pin it to the value itself:
   *
   *  - key ORDER: JSON's last duplicate key wins, so `{"value":"safe",
   *    "value":1e999}` is a request to store Infinity and `{"value":1e999,
   *    "value":"safe"}` is a request to store the string. The guard must read
   *    the value `JSON.parse` produced, not any earlier one.
   *  - the BOUNDARY: `Number.MAX_VALUE` is finite and must still be written;
   *    the next literal up parses to Infinity and must be refused. Over-refusal
   *    of large finite numbers is a regression too.
   *  - a numeric-looking STRING is text, not a number: `"1e999"` must reach the
   *    writer as the six characters it is.
   */
  it("guards the parsed value, not the literal: key order, MAX_VALUE, text", async () => {
    // Last duplicate key wins — Infinity arrives last and is refused.
    await refused("groups", '{"field":"bio","value":"safe","value":1e999}', "dup key, Infinity last");
    updateRecordField.mockReset();
    updateRecordField.mockResolvedValue({ kind: "ok", data: { id: RECORD_ID } });

    // Last duplicate key wins the other way — the string arrives last and writes.
    let res = await patch("groups", '{"field":"bio","value":1e999,"value":"safe"}');
    expect(res.status, "dup key, string last").toBe(200);
    expect(updateRecordField.mock.calls[0][2], "dup key, string last").toBe("safe");
    updateRecordField.mockReset();
    updateRecordField.mockResolvedValue({ kind: "ok", data: { id: RECORD_ID } });

    // The largest finite double still edits — the guard refuses non-finite, not big.
    res = await patch("groups", '{"field":"member_count","value":1.7976931348623157e308}');
    expect(res.status, "MAX_VALUE").toBe(200);
    expect(updateRecordField.mock.calls[0][2], "MAX_VALUE").toBe(Number.MAX_VALUE);
    updateRecordField.mockReset();
    updateRecordField.mockResolvedValue({ kind: "ok", data: { id: RECORD_ID } });

    // One step past it parses to Infinity, which JSON.stringify would null.
    await refused("groups", '{"field":"member_count","value":1.8e308}', "just past MAX_VALUE");
    updateRecordField.mockReset();
    updateRecordField.mockResolvedValue({ kind: "ok", data: { id: RECORD_ID } });

    // A numeric-looking STRING is text and survives the round trip unchanged.
    res = await patch("groups", '{"field":"bio","value":"1e999"}');
    expect(res.status, "string 1e999").toBe(200);
    expect(updateRecordField.mock.calls[0][2], "string 1e999").toBe("1e999");
  });

  it("names the unstorable number in the refusal, as a client error", async () => {
    // As with an omitted `value` (admin-window/BUG-0011), a non-2xx is not
    // enough: the caller must be able to tell WHAT the request asked for that
    // could not be stored, and an unstorable number is the client's fault
    // (400), not the database's (5xx). Raw string body — see above.
    const { status, text } = await patch("groups", '{"field":"bio","value":1e999}');
    expect(status).toBe(400);
    expect(JSON.parse(text).error).toMatch(/Infinity/);
    expect(updateRecordField).not.toHaveBeenCalled();
  });

  /**
   * REGRESSION — admin-window/BUG-0011 (fixed in admin-window/TASK-0017).
   *
   * The route's documented body is `{ field, value }`. A body carrying no
   * `value` at all states no intent: it is malformed, not an instruction to
   * null a vetted catalog column. The retired route this one carries over from
   * never nulled on an omitted key — it nulled on `""` alone. This test was
   * pinned `it.fails` while the divergence was live; it is a plain `it` again.
   *
   * Note the second body: `JSON.stringify` DROPS a key whose value is
   * `undefined`, so `{ field: "name", value: undefined }` reaches the handler
   * as `{"field":"name"}` — the exact request a widget bug produces.
   */
  it("refuses a body that omits `value` instead of clearing the column", async () => {
    await refused("groups", { field: "bio" }, "value omitted");
    updateRecordField.mockReset();
    await refused("groups", { field: "name", value: undefined }, "value undefined");
  });

  it("names the missing `value` in the refusal, as a client error", async () => {
    // BUG-0011 asks for more than a non-2xx: the caller must be able to tell
    // WHAT was wrong with the request, and a malformed body is the client's
    // fault (400), not the database's (5xx).
    const { status, text } = await patch("groups", { field: "bio" });
    expect(status).toBe(400);
    expect(JSON.parse(text).error).toMatch(/value/i);
    expect(updateRecordField).not.toHaveBeenCalled();
  });

  it("still clears a column on an explicit null or an emptied input", async () => {
    // The clearing path the surface really uses stays intact.
    for (const value of [null, ""]) {
      await patch("groups", { field: "bio", value });
      expect(updateRecordField, JSON.stringify(value)).toHaveBeenCalledTimes(1);
      expect(updateRecordField.mock.calls[0][2], JSON.stringify(value)).toBeNull();
      updateRecordField.mockReset();
      updateRecordField.mockResolvedValue({ kind: "ok", data: { id: RECORD_ID } });
    }
  });
});

/* ── the id is a question about the REQUEST ───────────────────────────────── */

/**
 * A URL segment that is not a record id — campaign admin-window/BUG-0068,
 * the write half of admin-window/BUG-0065.
 *
 * Every table in the map is keyed by a uuid, so a segment that is not one can
 * match no row anywhere: "no record at this address" is knowable without a
 * database, which is exactly what the record PAGE decides before it reads. The
 * route used to hand the segment to PostgREST instead, and Postgres's own
 * `22P02 invalid input syntax for type uuid` came back to the caller as an
 * HTTP 500 — the app claiming it broke over a request that was malformed, in
 * the database's words, to the caller who supplied the bad input.
 *
 * Both halves are asserted everywhere below: the answer the caller gets, and
 * that the writer was never invoked — the spy is what makes "no database call
 * was attempted" observable at this tier.
 *
 * Watched RED before the fix (the route reached the spied writer and answered
 * 200): "AssertionError: walk-1: expected 200 to be 404".
 */
const NOT_RECORD_IDS: readonly string[] = [
  "walk-1",
  "1",
  "groups",
  "not-a-uuid",
  // A uuid with one character too few, one too many, and one out of alphabet.
  "2f0bc11e-0000-4000-8000-00000000000",
  "2f0bc11e-0000-4000-8000-0000000000011",
  "2f0bc11e-0000-4000-8000-00000000000g",
  // Padding and punctuation around an otherwise well-formed id.
  " 2f0bc11e-0000-4000-8000-000000000001",
  "2f0bc11e-0000-4000-8000-000000000001'",
  "2f0bc11e-0000-4000-8000-000000000001; drop table groups",
  "%00",
  "",
];

describe("a segment that is not a record id", () => {
  it("is refused 404 and no database call is attempted", async () => {
    for (const id of NOT_RECORD_IDS) {
      const { status } = await patch("groups", { field: "bio", value: "x" }, id);
      expect(status, JSON.stringify(id)).toBe(404);
      expect(updateRecordField, JSON.stringify(id)).not.toHaveBeenCalled();
      updateRecordField.mockReset();
    }
  });

  it("answers it in the words this route already uses for a record that is not there", async () => {
    // One sentence, one status, two ways to reach it: a well-formed id that
    // matches no row (the writer read and found nothing) and a segment that
    // could match none. The caller cannot tell them apart, and should not.
    updateRecordField.mockResolvedValue({ kind: "ok", data: null });
    const wellFormedMiss = await patch("groups", { field: "bio", value: "x" });
    expect(wellFormedMiss.status).toBe(404);
    updateRecordField.mockReset();

    const malformed = await patch("groups", { field: "bio", value: "x" }, "walk-1");
    expect(malformed.status).toBe(404);
    expect(JSON.parse(malformed.text)).toEqual(JSON.parse(wellFormedMiss.text));
    expect(updateRecordField).not.toHaveBeenCalled();
  });

  it("says nothing the database said — no error code, no syntax text, no type name", async () => {
    for (const id of NOT_RECORD_IDS) {
      const { text } = await patch("groups", { field: "bio", value: "x" }, id);
      expect(text, JSON.stringify(id)).not.toMatch(/22P02|invalid input syntax|uuid|postgres|pgrst/i);
      updateRecordField.mockReset();
    }
  });

  it("still writes a well-formed id, whatever case it is spelled in", async () => {
    // The guard refuses non-ids, not ids — over-refusal would break the one
    // path the surface actually uses.
    for (const id of [RECORD_ID, RECORD_ID.toUpperCase()]) {
      const { status } = await patch("groups", { field: "bio", value: "x" }, id);
      expect(status, id).toBe(200);
      expect(updateRecordField.mock.calls[0][1], id).toBe(id);
      updateRecordField.mockReset();
      updateRecordField.mockResolvedValue({ kind: "ok", data: { id: RECORD_ID } });
    }
  });

  it("does not take an answer the map owns: the id is asked after decideEdit", async () => {
    // Each of these carries a malformed id AND a refusal the map or the body
    // parser owns. The status must stay the one that refusal has today —
    // adding this gate adds exactly one new answer, it does not relabel four.
    const bad = "walk-1";
    const cases: readonly [string, unknown, number, RegExp][] = [
      ["nosuchtable", { field: "name", value: "x" }, 404, /not an editable table/],
      ["events", { field: "title", value: "x" }, 403, /resolver-owned/],
      ["groups", { field: "spotify_id", value: "x" }, 403, /spotify_id/],
      ["groups", { field: "bio" }, 400, /value/i],
    ];
    for (const [table, body, status, message] of cases) {
      const answer = await patch(table, body, bad);
      expect(answer.status, `${table} ${JSON.stringify(body)}`).toBe(status);
      expect(JSON.parse(answer.text).error, table).toMatch(message);
      expect(updateRecordField, table).not.toHaveBeenCalled();
      updateRecordField.mockReset();
    }
  });
});

/* ── what the route makes of each writer outcome ──────────────────────────── */

describe("a write that really happened", () => {
  it("answers 500 with the database's own words when it failed", async () => {
    // The 500 branch is untouched by the id gate: a read or write that really
    // was made and really failed still reports what the database said
    // (LOOK_AND_FEEL), and only that branch may.
    updateRecordField.mockResolvedValue({
      kind: "error",
      message: 'column groups.bio is of type text but expression is of type integer',
    });
    const { status, text } = await patch("groups", { field: "bio", value: "x" });
    expect(status).toBe(500);
    expect(JSON.parse(text).error).toMatch(/expression is of type integer/);
    expect(updateRecordField).toHaveBeenCalledTimes(1);
  });

  it("answers 503 naming what is not provisioned", async () => {
    updateRecordField.mockResolvedValue({ kind: "not_provisioned", missing: "groups" });
    const { status, text } = await patch("groups", { field: "bio", value: "x" });
    expect(status).toBe(503);
    expect(JSON.parse(text).error).toMatch(/groups/);
  });

  it("answers 404 for a well-formed id that matches no row", async () => {
    updateRecordField.mockResolvedValue({ kind: "ok", data: null });
    const { status, text } = await patch("groups", { field: "bio", value: "x" });
    expect(status).toBe(404);
    expect(JSON.parse(text).error).toMatch(/no groups record/);
    expect(updateRecordField).toHaveBeenCalledTimes(1);
  });

  it("answers 200 with the record it wrote", async () => {
    const { status, text } = await patch("groups", { field: "bio", value: "hello" });
    expect(status).toBe(200);
    expect(JSON.parse(text)).toEqual({
      ok: true,
      record: { id: RECORD_ID, bio: "written" },
    });
  });
});

/* ── the gate runs before anything else ───────────────────────────────────── */

describe("the gate", () => {
  it("is consulted before the body is even parsed", async () => {
    const admin = await import("@/lib/admin");
    vi.mocked(admin.requireAdmin).mockResolvedValueOnce({
      error: Response.json({ error: "Forbidden" }, { status: 403 }),
    } as unknown as { user: { email: string } });

    const { status } = await patch("groups", { field: "bio", value: "hello" });
    expect(status).toBe(403);
    expect(updateRecordField).not.toHaveBeenCalled();
  });
});
