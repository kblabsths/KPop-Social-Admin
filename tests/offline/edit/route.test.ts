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

vi.mock("@/lib/db/records", () => ({
  updateRecordField: (...args: unknown[]) => updateRecordField(...args),
}));

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
