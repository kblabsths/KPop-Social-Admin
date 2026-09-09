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
/**
 * The settlement seam, spied — the override path's whole database side
 * (campaign admin-window/TASK-0054). Spied rather than exercised for the same
 * reason the writer is: "no write was even attempted" has to be observable,
 * and so does "exactly one call, carrying exactly this".
 */
const settleReviewItem = vi.fn();

vi.mock("@/lib/admin", () => ({
  requireAdmin: vi.fn(async () => ({ user: { email: ADMIN_EMAIL } })),
}));

vi.mock("@/lib/db/verdict", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/verdict")>();
  return {
    ...actual,
    settleReviewItem: (...args: unknown[]) => settleReviewItem(...args),
  };
});

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

/** The signed-in admin the stubbed gate hands the handler. */
const ADMIN_EMAIL = "qa@example.invalid";

/** A receipt shaped like the one the settlement function returns. */
const RECEIPT = {
  verdict_id: "01920000-0000-7000-8000-000000000901",
  review_item_id: null,
  action: "override",
  observation_id: "01920000-0000-7000-8000-000000000902",
  created_at: "2026-09-08T12:00:00Z",
};

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
    data: { sandbox_id: RECORD_ID, label: "written" },
  });
  settleReviewItem.mockReset();
  settleReviewItem.mockResolvedValue({ kind: "ok", data: RECEIPT });
});

/* ── the one edit that is allowed ─────────────────────────────────────────── */

describe("a mapped column of the one directly-written table", () => {
  it("reaches the writer with the map's own config", async () => {
    const { status } = await patch("walk_sandbox", { field: "label", value: "hello" });
    expect(status).toBe(200);
    expect(updateRecordField).toHaveBeenCalledTimes(1);
    const [edit, id, value] = updateRecordField.mock.calls[0];
    expect((edit as { config: { table: string } }).config.table).toBe("walk_sandbox");
    expect((edit as { field: string }).field).toBe("label");
    expect(id).toBe(RECORD_ID);
    expect(value).toBe("hello");
  });

  it("ignores every other key in the body — no second field is written", async () => {
    // A forged body that names a mapped column AND smuggles unmapped ones
    // beside it must apply the mapped one only, never partially apply the rest.
    await patch("walk_sandbox", {
      field: "label",
      value: "hello",
      created_at: "2026-01-01T00:00:00Z",
      note: "forged",
      sandbox_id: "00000000-0000-4000-8000-000000000000",
      tally: 99,
    });
    expect(updateRecordField).toHaveBeenCalledTimes(1);
    expect(updateRecordField.mock.calls[0][2]).toBe("hello");
    expect(updateRecordField.mock.calls[0][0]).toEqual(
      expect.objectContaining({ field: "label" }),
    );
  });
});

/* ── the override path: one call, and nothing else ────────────────────────── */

/**
 * The resolver-owned half of the route — campaign admin-window/TASK-0054,
 * FEAT-0011 criteria 1 and 3.
 *
 * A mapped column of `events` or `venues` is written as ONE admin-tier
 * observation through the settlement seam, and Admin performs none of the
 * steps behind it: no second write, no provenance insert, no lock update. The
 * writer spy is what makes "and never the direct path" observable.
 */
describe("a mapped column of a resolver-owned table", () => {
  it("makes exactly one settlement call, and no direct write", async () => {
    const { status } = await patch("events", { field: "title", value: "A new title" });
    expect(status).toBe(200);
    expect(settleReviewItem).toHaveBeenCalledTimes(1);
    expect(updateRecordField).not.toHaveBeenCalled();
  });

  it("carries the override envelope exactly, and nothing else", async () => {
    await patch("venues", { field: "city", value: "Seoul" });
    const [client, decision] = settleReviewItem.mock.calls[0] as [
      unknown,
      Record<string, unknown>,
    ];
    // The seam resolves the app's own client (§4.1): a route that built one
    // would throw outside the try that classifies every failure.
    expect(client).toBeUndefined();
    // The whole envelope, key for key — a field the function does not read is
    // scraper registry knowledge re-encoded by hand (ARCHITECTURE §9.2), and
    // an extra one would be exactly that.
    expect(decision).toEqual({
      action: "override",
      // Item-less: spec §7's "an override is the same row without the item".
      review_item_id: null,
      // The signed-in admin, from the gate — never from the body.
      actor: ADMIN_EMAIL,
      note: null,
      value: {
        domain: "venues",
        entity_id: RECORD_ID,
        field: "city",
        observation_id: null,
        value: "Seoul",
        ref: null,
      },
    });
  });

  it("takes the actor from the gate, whatever the body claims", async () => {
    await patch("events", {
      field: "title",
      value: "A new title",
      actor: "someone.else@example.invalid",
      action: "keep_current",
      review_item_id: "01920000-0000-7000-8000-000000000999",
    });
    const [, decision] = settleReviewItem.mock.calls[0] as [
      unknown,
      Record<string, unknown>,
    ];
    expect(decision.actor).toBe(ADMIN_EMAIL);
    expect(decision.action).toBe("override");
    expect(decision.review_item_id).toBeNull();
  });

  it("carries a number and a boolean as themselves, not as text", async () => {
    // The envelope's `value` is the scalar the operator typed; the coercion is
    // the database's, as it is on the direct path.
    await patch("events", { field: "starts_at", value: "2026-10-01T19:00:00Z" });
    let [, decision] = settleReviewItem.mock.calls[0] as [unknown, { value: { value: unknown } }];
    expect(decision.value.value).toBe("2026-10-01T19:00:00Z");
    settleReviewItem.mockClear();

    await patch("venues", { field: "name", value: 12 });
    [, decision] = settleReviewItem.mock.calls[0] as [unknown, { value: { value: unknown } }];
    expect(decision.value.value).toBe(12);
  });

  it("answers 503 naming what is absent, which is the normal case", async () => {
    // `settle_review_item` is on no database this app deploys against yet, so
    // this is the graded-first answer (ARCHITECTURE §9.2). Never a fake
    // success, and never a direct write instead.
    settleReviewItem.mockResolvedValue({
      kind: "not_provisioned",
      missing: "settle_review_item",
    });
    const { status, text } = await patch("events", { field: "title", value: "x" });
    expect(status).toBe(503);
    const body = JSON.parse(text);
    expect(body.error).toContain("settle_review_item");
    expect(body.missing).toBe("settle_review_item");
    expect(body.ok).toBeUndefined();
    expect(updateRecordField).not.toHaveBeenCalled();
  });

  it("hands the gate's own refusal back in its words, and claims nothing", async () => {
    // Two of Ben's eight columns carry a registry PATTERN the gate enforces —
    // `venues.country` is `^[A-Z]{2}$`, `events.poster_url` is `^https://` —
    // and this app holds no copy of either rule (admin-window/TASK-0044 QA).
    // What comes back is the database's own refusal, verbatim, with the row
    // unchanged: the same shape the direct path already gives a `23502`.
    const REFUSALS: ReadonlyArray<readonly [string, string, unknown, string]> = [
      [
        "venues",
        "country",
        "USA",
        'KS004: value for field "country" fails the registered pattern ^[A-Z]{2}$',
      ],
      [
        "events",
        "poster_url",
        "http://example.invalid/poster.jpg",
        'KS004: value for field "poster_url" fails the registered pattern ^https://',
      ],
    ];
    for (const [table, field, value, said] of REFUSALS) {
      settleReviewItem.mockResolvedValue({
        kind: "error",
        reading: "settle_review_item",
        message: said,
      });
      const { status, text } = await patch(table, { field, value });
      const where = `${table}.${field}`;
      expect(status, where).toBe(500);
      // Verbatim — the app never paraphrases what the database said.
      expect(JSON.parse(text).error, where).toBe(said);
      expect(JSON.parse(text).ok, where).toBeUndefined();
      expect(updateRecordField, where).not.toHaveBeenCalled();
      expect(settleReviewItem, where).toHaveBeenCalledTimes(1);
      settleReviewItem.mockClear();
    }
  });

  it("refuses a clear rather than sending an override that says nothing", async () => {
    // An override carries exactly one filled payload slot and a null value
    // fills none (`decisionRefusals`, invariant 5). Clearing a resolver-owned
    // field is therefore not expressible as an override, and the route says so
    // — named, 400, before the database — instead of sending a decision the
    // function would raise on.
    for (const value of [null, ""]) {
      const { status, text } = await patch("events", { field: "title", value });
      expect(status, JSON.stringify(value)).toBe(400);
      expect(JSON.parse(text).refusals, JSON.stringify(value)).toContain(
        "value_payload_missing",
      );
      expect(settleReviewItem, JSON.stringify(value)).not.toHaveBeenCalled();
      expect(updateRecordField, JSON.stringify(value)).not.toHaveBeenCalled();
    }
  });

  it("answers a malformed id without settling anything", async () => {
    const { status } = await patch("events", { field: "title", value: "x" }, "walk-1");
    expect(status).toBe(404);
    expect(settleReviewItem).not.toHaveBeenCalled();
  });

  it("returns the verdict receipt, and no record it did not read", async () => {
    // The value the operator typed became an OBSERVATION; what the canonical
    // row holds now is the pipeline's answer, read on the next render.
    // Reporting the request back as the stored value would be a fake success.
    const { status, text } = await patch("events", { field: "title", value: "x" });
    expect(status).toBe(200);
    expect(JSON.parse(text)).toEqual({ ok: true, verdict: RECEIPT });
  });
});

/* ── the picker's choice: a ref, never a value ────────────────────────────── */

/**
 * The entity picker's submission, as the decision the function actually takes
 * — campaign admin-window/TASK-0055, SPEC F12, ARCHITECTURE §9.2.
 *
 * The spy is the recording stub: what is asserted is the ENVELOPE the route
 * built, key for key, because that is what `settle_review_item` reads and the
 * whole claim of this ticket is about its shape — the chosen entity's id in
 * `ref`, the REGISTRY's field name, and no free text anywhere for that field.
 */
describe("the picker's choice", () => {
  /** The chosen venue's id — a real record id, as the picker only offers those. */
  const VENUE = "01920000-0000-7000-8000-0000000000a4";

  it("carries the chosen id as value.ref, under the registry's field name", async () => {
    const { status } = await patch("events", { field: "venue_id", ref: VENUE });
    expect(status).toBe(200);
    expect(settleReviewItem).toHaveBeenCalledTimes(1);
    const [client, decision] = settleReviewItem.mock.calls[0] as [
      unknown,
      Record<string, unknown>,
    ];
    expect(client).toBeUndefined();
    expect(decision).toEqual({
      action: "override",
      review_item_id: null,
      actor: ADMIN_EMAIL,
      note: null,
      value: {
        domain: "events",
        entity_id: RECORD_ID,
        // The REGISTRY field, not the column: `events.venue` is what the gate
        // knows, and `venue_id` is what the link stage produces from it. A
        // decision naming the column would be registry knowledge re-encoded.
        field: "venue",
        observation_id: null,
        // No free text for this field, and no scalar at all: the reference is
        // observed as a ref, so the apply LINKS a row.
        value: null,
        ref: VENUE,
      },
    });
    // ...and never the direct path, whatever the body said.
    expect(updateRecordField).not.toHaveBeenCalled();
  });

  it("names the fact the DECISION LOG spells: the registry field for the reference, the column for a scalar", async () => {
    // The mirror image of admin-window/BUG-0090, pinned on BOTH fixtures
    // (QA finding relayed 2026-09-09). The resolver stamps
    // `field_provenance.field` with the REGISTRY field and derives the column
    // itself (`v_column := 'venue_id'`, scraper migration `20260901000005`
    // and the handoff artifact's reference arm), and the record page's
    // provenance read now asks in the log's vocabulary
    // (`mappedRegistryFields`). So a write that stamped `venue_id` would make
    // that read miss the fact it just wrote, and the em dash BUG-0090
    // measured would come back from the other side.
    //
    // Both arms go through `registryFieldOf`, so this is one rule with two
    // answers rather than two code paths that happen to agree today.
    const cases: ReadonlyArray<readonly [string, unknown, string]> = [
      // The reference: the two names differ, and the LOG's name is sent.
      ["venue_id", { ref: "01920000-0000-7000-8000-0000000000a4" }, "venue"],
      // A scalar: the two names are the same, so nothing moves.
      ["title", { value: "A new title" }, "title"],
    ];
    for (const [field, payload, expected] of cases) {
      settleReviewItem.mockClear();
      await patch("events", { field, ...(payload as object) });
      const [, decision] = settleReviewItem.mock.calls[0] as [
        unknown,
        { value: Record<string, unknown> },
      ];
      expect(decision.value.field, field).toBe(expected);
      // ...and the envelope still names no COLUMN. The function derives it
      // (`c_value_keys` carries no `column`, and an unknown key is refused),
      // so sending one would be registry knowledge re-encoded by hand — and,
      // on the shipped artifact, a refusal.
      expect(
        Object.prototype.hasOwnProperty.call(decision.value, "column"),
        field,
      ).toBe(false);
    }
  });

  it("sends exactly the reference arm the settlement artifact will accept", async () => {
    // Coupled to the artifact rather than to a builder's memory of it: its
    // reference arm links `(domain='events', field='venue')` and RAISES on
    // anything else carrying a ref, so a decision this route builds has to
    // match that pair exactly (SPEC named gap 6, the same coupling
    // `tests/offline/handoff/settle-review-item.test.ts` makes for the action
    // names and the key sets).
    const { readSqlArtifact } = await import("../handoff/extract");
    // `code` is the artifact with comments stripped and its literals INTACT —
    // the arm is a comparison against a literal, so `scan` (which empties
    // them) would match the same regex on any two field names.
    const sql = readSqlArtifact("M2-handoff-settle-review-item.md").code;
    await patch("events", {
      field: "venue_id",
      ref: "01920000-0000-7000-8000-0000000000a4",
    });
    const [, decision] = settleReviewItem.mock.calls[0] as [
      unknown,
      { value: { domain: string; field: string } },
    ];
    const arm = new RegExp(
      `v_domain\\s*=\\s*'${decision.value.domain}'\\s+and\\s+v_field\\s*=\\s*'${decision.value.field}'`,
    );
    expect(arm.test(sql), `no reference arm for ${decision.value.domain}.${decision.value.field}`).toBe(true);
    // The second fixture: the pair the artifact does NOT carry is the column
    // spelling, which is what makes the assertion above non-vacuous.
    expect(/v_domain\s*=\s*'events'\s+and\s+v_field\s*=\s*'venue_id'/.test(sql)).toBe(
      false,
    );
  });

  it("refuses the same column submitted as text, before any database call", async () => {
    // The shipped path criterion 1 names: `venue_id` is not in `editable`, so
    // a value submission for it is refused by the ONE authoriser — no
    // settlement, no write, and the refusal names the field.
    const { status, text } = await patch("events", {
      field: "venue_id",
      value: "Olympic Hall",
    });
    expect(status).toBe(403);
    expect(JSON.parse(text).error).toContain("venue_id");
    expect(settleReviewItem).not.toHaveBeenCalled();
    expect(updateRecordField).not.toHaveBeenCalled();
  });

  it("refuses a ref for a column the map does not call a reference", async () => {
    for (const [table, field] of [
      ["events", "title"],
      ["venues", "name"],
      ["walk_sandbox", "label"],
    ] as const) {
      const { status, text } = await patch(table, { field, ref: VENUE });
      expect(status, `${table}.${field}`).toBe(403);
      expect(JSON.parse(text).error, `${table}.${field}`).toContain(field);
      expect(settleReviewItem, `${table}.${field}`).not.toHaveBeenCalled();
      expect(updateRecordField, `${table}.${field}`).not.toHaveBeenCalled();
    }
  });

  it("refuses a ref on a table the map does not carry", async () => {
    const { status } = await patch("groups", { field: "group_id", ref: VENUE });
    expect(status).toBe(404);
    expect(settleReviewItem).not.toHaveBeenCalled();
  });

  it("refuses a ref that is not a record id, rather than sending it", async () => {
    // A ref is the chosen row's own id; anything else can link to no row and
    // would become an external_ref nothing ever resolves.
    for (const ref of ["Olympic Hall", "", "  ", 12, null, { id: VENUE }]) {
      const { status } = await patch("events", { field: "venue_id", ref });
      expect(status, JSON.stringify(ref)).toBe(400);
      expect(settleReviewItem, JSON.stringify(ref)).not.toHaveBeenCalled();
    }
  });

  it("refuses a body carrying both a value and a ref", async () => {
    const { status, text } = await patch("events", {
      field: "venue_id",
      value: "Olympic Hall",
      ref: VENUE,
    });
    expect(status).toBe(400);
    expect(JSON.parse(text).error).toContain("ref");
    expect(settleReviewItem).not.toHaveBeenCalled();
  });

  it("answers 503 naming what is absent, which is the normal case here too", async () => {
    settleReviewItem.mockResolvedValue({
      kind: "not_provisioned",
      missing: "settle_review_item",
    });
    const { status, text } = await patch("events", { field: "venue_id", ref: VENUE });
    expect(status).toBe(503);
    expect(JSON.parse(text).missing).toBe("settle_review_item");
    expect(JSON.parse(text).ok).toBeUndefined();
    expect(updateRecordField).not.toHaveBeenCalled();
  });

  it("answers a malformed record id without settling anything", async () => {
    const { status } = await patch(
      "events",
      { field: "venue_id", ref: VENUE },
      "not-a-uuid",
    );
    expect(status).toBe(404);
    expect(settleReviewItem).not.toHaveBeenCalled();
  });
});

/* ── the branch is the PATH, never the table name ─────────────────────────── */

describe("the route branches on the write path alone", () => {
  it("sends each regime down its own path, on two fixtures", async () => {
    // FEAT-0011 criterion 1: one table per path, and the route's choice is
    // `writePathFor`'s answer carried on the decision — not a table name, not
    // a config key.
    const { EDIT_CONFIG, decideEdit, writePathFor } = await import("@/lib/edit/config");
    const cases: ReadonlyArray<readonly [string, string]> = [
      ["walk_sandbox", "label"],
      ["events", "title"],
    ];
    for (const [table, field] of cases) {
      const decision = decideEdit(table, field);
      expect(decision.allowed, table).toBe(true);
      if (!decision.allowed) continue;
      expect(decision.edit.path, table).toBe(
        writePathFor(EDIT_CONFIG[table].regime),
      );

      await patch(table, { field, value: "x" });
      const direct = decision.edit.path === "direct";
      expect(updateRecordField.mock.calls.length, table).toBe(direct ? 1 : 0);
      expect(settleReviewItem.mock.calls.length, table).toBe(direct ? 0 : 1);
      updateRecordField.mockReset();
      updateRecordField.mockResolvedValue({ kind: "ok", data: { sandbox_id: RECORD_ID } });
      settleReviewItem.mockReset();
      settleReviewItem.mockResolvedValue({ kind: "ok", data: RECEIPT });
    }
  });

  it("spells no table name of its own, so no name can choose a path", async () => {
    const { codeLines } = await import("../source-tree");
    const route = codeLines("src/app/api/admin/records/[table]/[id]/route.ts");
    for (const table of ["events", "venues", "walk_sandbox", "groups", "idols"]) {
      expect(
        route.filter((line) => line.includes(`"${table}"`)),
        table,
      ).toEqual([]);
    }
    // ...and it does read the path off the decision, so the negative above is
    // not green by the branch having gone missing.
    expect(route.some((line) => line.includes("edit.path"))).toBe(true);
  });
});

/* ── the refusals: 4xx, and the writer never called ───────────────────────── */

/** Every refusal asserts BOTH halves: a non-2xx, and no write attempted. */
async function refused(table: string, body: unknown, where: string) {
  const { status } = await patch(table, body);
  expect(status, where).toBeGreaterThanOrEqual(400);
  expect(status, where).toBeLessThan(500);
  expect(updateRecordField, where).not.toHaveBeenCalled();
  // Both paths, every time: a refusal that reached the settlement function
  // would have written an observation, which is a write like any other.
  expect(settleReviewItem, where).not.toHaveBeenCalled();
}

describe("the handler refuses a forged edit and attempts no write", () => {
  it("refuses a column the map does not carry", async () => {
    for (const field of ["created_at", "spotify_id", "social_links", "wikipedia_url"]) {
      await refused("walk_sandbox", { field, value: "forged" }, field);
      updateRecordField.mockReset();
    }
  });

  it("refuses a primary key, a foreign key and a timestamp", async () => {
    for (const [table, field] of [
      ["walk_sandbox", "sandbox_id"],
      ["walk_sandbox", "created_at"],
      ["events", "event_id"],
      ["events", "created_at"],
      ["venues", "venue_id"],
    ] as const) {
      await refused(table, { field, value: "forged" }, `${table}.${field}`);
      updateRecordField.mockReset();
    }
  });

  it("refuses a column of a resolver-owned table the map does not carry, 403, naming the field", async () => {
    // FEAT-0011 criterion 5, server-side and at the ROUTE: the reference
    // column, the CHECK-constrained three, the unruled ones and a key. Each is
    // refused exactly as an unmapped column of the sandbox is — hiding a
    // widget is not a refusal.
    for (const [table, field] of [
      ["events", "venue_id"],
      ["events", "event_type"],
      ["events", "status"],
      ["events", "time_precision"],
      ["events", "ends_at"],
      ["events", "ticket_url"],
      ["events", "created_at"],
      ["venues", "timezone"],
      ["venues", "website"],
      ["venues", "latitude"],
    ] as const) {
      const { status, text } = await patch(table, { field, value: "forged" });
      expect(status, `${table}.${field}`).toBe(403);
      expect(JSON.parse(text).error, `${table}.${field}`).toBe(
        `${field} is not an editable field of ${table}`,
      );
      expect(updateRecordField, `${table}.${field}`).not.toHaveBeenCalled();
      expect(settleReviewItem, `${table}.${field}`).not.toHaveBeenCalled();
      updateRecordField.mockReset();
      settleReviewItem.mockReset();
      settleReviewItem.mockResolvedValue({ kind: "ok", data: RECEIPT });
    }
  });

  it("refuses both tables Ben struck, 404, naming the table, on every column their allowlists carried", async () => {
    // Criterion 2 of admin-window/TASK-0040. Until 2026-09-08 a PATCH naming
    // any of these columns wrote a catalog row; the strike removed the map
    // entries, so the route now answers exactly as it does for a table it
    // never carried — 404, `unknown_table`'s sentence, no write attempted.
    // The whole retired allowlist is driven, not a sample: a partial
    // restoration would pass a one-column check.
    const RETIRED: Readonly<Record<string, readonly string[]>> = {
      groups: [
        "name",
        "korean_name",
        "short_name",
        "company",
        "status",
        "type",
        "member_count",
        "debut_date",
        "image_url",
        "bio",
      ],
      idols: [
        "stage_name",
        "real_name",
        "korean_name",
        "position",
        "nationality",
        "gender",
        "bio",
        "birth_date",
        "image_url",
        "status",
        "height_cm",
        "weight_kg",
        "blood_type",
        "mbti",
        "agency",
        "birth_place",
      ],
    };
    for (const [table, fields] of Object.entries(RETIRED)) {
      for (const field of fields) {
        const { status, text } = await patch(table, { field, value: "forged" });
        expect(status, `${table}.${field}`).toBe(404);
        expect(JSON.parse(text).error, `${table}.${field}`).toBe(
          `${table} is not an editable table`,
        );
        expect(updateRecordField, `${table}.${field}`).not.toHaveBeenCalled();
        updateRecordField.mockReset();
      }
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
    // `lаbel` carries a Cyrillic а (U+0430); the rest differ only in case or
    // padding. An allowlist compared loosely would let any of them through.
    for (const field of ["Label", "LABEL", "label ", " label", "la bel", "lаbel", "note\n"]) {
      await refused("walk_sandbox", { field, value: "forged" }, JSON.stringify(field));
      updateRecordField.mockReset();
    }
  });

  it("is not fooled by a case or punctuation variant of a mapped table", async () => {
    for (const table of [
      "Walk_sandbox",
      "WALK_SANDBOX",
      "walk_sandbox ",
      "walk_sandbox/",
      "public.walk_sandbox",
      "walk_sandbox;",
    ]) {
      await refused(table, { field: "name", value: "forged" }, table);
      updateRecordField.mockReset();
    }
  });

  it("is not fooled by a name inherited from Object.prototype", async () => {
    for (const field of ["__proto__", "constructor", "prototype", "toString", "hasOwnProperty"]) {
      await refused("walk_sandbox", { field, value: "forged" }, `field ${field}`);
      updateRecordField.mockReset();
    }
    for (const table of ["__proto__", "constructor", "toString"]) {
      await refused(table, { field: "name", value: "forged" }, `table ${table}`);
      updateRecordField.mockReset();
    }
  });

  it("refuses a body that is not an object of the documented shape", async () => {
    for (const body of ["[]", '"a string"', "42", "true", "null", "not json at all", ""]) {
      await refused("walk_sandbox", body, JSON.stringify(body));
      updateRecordField.mockReset();
    }
  });

  it("refuses a non-string or empty field name", async () => {
    for (const field of [123, true, null, [], { name: "bio" }, ""]) {
      await refused("walk_sandbox", { field, value: "x" }, JSON.stringify(field));
      updateRecordField.mockReset();
    }
  });

  it("refuses a non-scalar value for a mapped column", async () => {
    // No json is ever written from here (root CLAUDE.md, AGENTS.md).
    for (const value of [{ nested: true }, ["a", "b"], [{ a: 1 }]]) {
      await refused("walk_sandbox", { field: "label", value }, JSON.stringify(value));
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
   * PostgREST receives are `{"label":null}`, byte-identical to an explicit
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
      '{"field":"label","value":1e999}',
      '{"field":"label","value":-1e999}',
      '{"field":"tally","value":1e999}',
    ]) {
      await refused("walk_sandbox", body, body);
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
    await refused("walk_sandbox", '{"field":"label","value":"safe","value":1e999}', "dup key, Infinity last");
    updateRecordField.mockReset();
    updateRecordField.mockResolvedValue({ kind: "ok", data: { sandbox_id: RECORD_ID } });

    // Last duplicate key wins the other way — the string arrives last and writes.
    let res = await patch("walk_sandbox", '{"field":"label","value":1e999,"value":"safe"}');
    expect(res.status, "dup key, string last").toBe(200);
    expect(updateRecordField.mock.calls[0][2], "dup key, string last").toBe("safe");
    updateRecordField.mockReset();
    updateRecordField.mockResolvedValue({ kind: "ok", data: { sandbox_id: RECORD_ID } });

    // The largest finite double still edits — the guard refuses non-finite, not big.
    res = await patch("walk_sandbox", '{"field":"tally","value":1.7976931348623157e308}');
    expect(res.status, "MAX_VALUE").toBe(200);
    expect(updateRecordField.mock.calls[0][2], "MAX_VALUE").toBe(Number.MAX_VALUE);
    updateRecordField.mockReset();
    updateRecordField.mockResolvedValue({ kind: "ok", data: { sandbox_id: RECORD_ID } });

    // One step past it parses to Infinity, which JSON.stringify would null.
    await refused("walk_sandbox", '{"field":"tally","value":1.8e308}', "just past MAX_VALUE");
    updateRecordField.mockReset();
    updateRecordField.mockResolvedValue({ kind: "ok", data: { sandbox_id: RECORD_ID } });

    // A numeric-looking STRING is text and survives the round trip unchanged.
    res = await patch("walk_sandbox", '{"field":"label","value":"1e999"}');
    expect(res.status, "string 1e999").toBe(200);
    expect(updateRecordField.mock.calls[0][2], "string 1e999").toBe("1e999");
  });

  it("names the unstorable number in the refusal, as a client error", async () => {
    // As with an omitted `value` (admin-window/BUG-0011), a non-2xx is not
    // enough: the caller must be able to tell WHAT the request asked for that
    // could not be stored, and an unstorable number is the client's fault
    // (400), not the database's (5xx). Raw string body — see above.
    const { status, text } = await patch("walk_sandbox", '{"field":"label","value":1e999}');
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
    await refused("walk_sandbox", { field: "label" }, "value omitted");
    updateRecordField.mockReset();
    await refused("walk_sandbox", { field: "name", value: undefined }, "value undefined");
  });

  it("names the missing `value` in the refusal, as a client error", async () => {
    // BUG-0011 asks for more than a non-2xx: the caller must be able to tell
    // WHAT was wrong with the request, and a malformed body is the client's
    // fault (400), not the database's (5xx).
    const { status, text } = await patch("walk_sandbox", { field: "label" });
    expect(status).toBe(400);
    expect(JSON.parse(text).error).toMatch(/value/i);
    expect(updateRecordField).not.toHaveBeenCalled();
  });

  it("still clears a column on an explicit null or an emptied input", async () => {
    // The clearing path the surface really uses stays intact.
    for (const value of [null, ""]) {
      await patch("walk_sandbox", { field: "label", value });
      expect(updateRecordField, JSON.stringify(value)).toHaveBeenCalledTimes(1);
      expect(updateRecordField.mock.calls[0][2], JSON.stringify(value)).toBeNull();
      updateRecordField.mockReset();
      updateRecordField.mockResolvedValue({ kind: "ok", data: { sandbox_id: RECORD_ID } });
    }
  });

  /**
   * A value with nothing VISIBLE in it is stored as content, while every
   * surface draws it as an absence (QA, admin-window/BUG-0089's re-check).
   *
   * The app has ONE definition of blank since admin-window/BUG-0089
   * (`hasVisibleContent` / `visibleContent`, `lib/verdict/decision.ts`), and
   * `isAbsent` reads it: a cell holding U+200B is rendered as the em dash,
   * i.e. as NO VALUE. This route never asks that question — it clears on
   * `null` and `""` alone (`readEdit`) — and `EditableCell.commit` decides
   * blank with `draft.trim()`, which leaves the Cf characters a paste out of a
   * web page or a PDF carries. So the operator pastes an invisible string into
   * a cell, the column is written with content nobody can read, and the record
   * page then answers with a confident dash: the surface says "no value", the
   * database says "one character". On a `not null` column (`walk_sandbox.label`)
   * it also fakes the clear the database is supposed to refuse (23502).
   *
   * The assertion is deliberately either/or — refuse it, or clear the column —
   * because which of the two the app should do is the fix's choice, not this
   * test's. What may not stand is storing as content what the app renders as
   * absence.
   *
   * **Strict pin for admin-window/BUG-0095**, watched RED as a plain `it()` on
   * the landed tree: `"\u200b": status 200, wrote "\u200b"`. `it.fails` is
   * strict in Vitest — the day the route stops storing it, this turns red and
   * sends the reader to the ticket; flip it back to `it()` with the fix.
   */
  it.fails("does not store as content a value every surface draws as an absence", async () => {
    const { isAbsent } = await import("@/lib/format");
    for (const value of ["\u200b", "\u2060", "\u00ad", "\ufeff", "\u3164", "  \u200b  "]) {
      const seen = JSON.stringify(value);
      // The app's own answer about this string, on the surface it renders on.
      expect(isAbsent(value), seen).toBe(true);
      const { status } = await patch("walk_sandbox", { field: "label", value });
      const wrote = updateRecordField.mock.calls[0]?.[2];
      expect(
        { [seen]: status >= 400 || wrote === null },
        `${seen}: status ${status}, wrote ${JSON.stringify(wrote)}`,
      ).toEqual({ [seen]: true });
      updateRecordField.mockReset();
      updateRecordField.mockResolvedValue({ kind: "ok", data: { sandbox_id: RECORD_ID } });
    }
  });

  it("still stores a value that has anything visible in it, however it is padded", async () => {
    // The fixture the guard above must NOT flag, or it is vacuous (LESSONS 3):
    // the invisible characters are an absence only when they are ALL there is,
    // and U+2800 is an assigned printable character the leaf rules as content.
    for (const value of ["\u200bBLACKPINK\u200b", "\u2800", "0"]) {
      const { status } = await patch("walk_sandbox", { field: "label", value });
      expect(status, JSON.stringify(value)).toBe(200);
      expect(updateRecordField.mock.calls[0][2], JSON.stringify(value)).toBe(value);
      updateRecordField.mockReset();
      updateRecordField.mockResolvedValue({ kind: "ok", data: { sandbox_id: RECORD_ID } });
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
      const { status } = await patch("walk_sandbox", { field: "label", value: "x" }, id);
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
    const wellFormedMiss = await patch("walk_sandbox", { field: "label", value: "x" });
    expect(wellFormedMiss.status).toBe(404);
    updateRecordField.mockReset();

    const malformed = await patch("walk_sandbox", { field: "label", value: "x" }, "walk-1");
    expect(malformed.status).toBe(404);
    expect(JSON.parse(malformed.text)).toEqual(JSON.parse(wellFormedMiss.text));
    expect(updateRecordField).not.toHaveBeenCalled();
  });

  it("says nothing the database said — no error code, no syntax text, no type name", async () => {
    for (const id of NOT_RECORD_IDS) {
      const { text } = await patch("walk_sandbox", { field: "label", value: "x" }, id);
      expect(text, JSON.stringify(id)).not.toMatch(/22P02|invalid input syntax|uuid|postgres|pgrst/i);
      updateRecordField.mockReset();
    }
  });

  it("still writes a well-formed id, whatever case it is spelled in", async () => {
    // The guard refuses non-ids, not ids — over-refusal would break the one
    // path the surface actually uses.
    for (const id of [RECORD_ID, RECORD_ID.toUpperCase()]) {
      const { status } = await patch("walk_sandbox", { field: "label", value: "x" }, id);
      expect(status, id).toBe(200);
      expect(updateRecordField.mock.calls[0][1], id).toBe(id);
      updateRecordField.mockReset();
      updateRecordField.mockResolvedValue({ kind: "ok", data: { sandbox_id: RECORD_ID } });
    }
  });

  it("does not take an answer the map owns: the id is asked after decideEdit", async () => {
    // Each of these carries a malformed id AND a refusal the map or the body
    // parser owns. The status must stay the one that refusal has today —
    // adding this gate adds exactly one new answer, it does not relabel four.
    const bad = "walk-1";
    const cases: readonly [string, unknown, number, RegExp][] = [
      ["nosuchtable", { field: "name", value: "x" }, 404, /not an editable table/],
      ["events", { field: "event_type", value: "x" }, 403, /event_type/],
      ["walk_sandbox", { field: "spotify_id", value: "x" }, 403, /spotify_id/],
      ["walk_sandbox", { field: "label" }, 400, /value/i],
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

/**
 * QA attack on the id gate — campaign admin-window/BUG-0068.
 *
 * The list above is the builder's. These are the segments it does not reach,
 * and the other half of the same claim: the gate must refuse non-ids WITHOUT
 * over-refusing an id the DATABASE itself accepts, because an id form Postgres
 * would resolve is a row an operator can legitimately address.
 *
 * Postgres's uuid input takes (its documented alternative forms) the canonical
 * spelling, upper case, every hyphen omitted, and a hyphen after ANY group of
 * four hex digits. Each of those must still reach the writer verbatim: a gate
 * that answered 404 for one of them would be this bug's mirror image — the
 * route telling an operator "no record at this address" about a record that IS
 * at that address.
 */
const MORE_NON_IDS: ReadonlyArray<readonly [string, string]> = [
  ["braces around a real id (a form Postgres takes, a URL cannot)", `{${RECORD_ID}}`],
  ["the same braces percent-encoded, as Next hands them over", `%7B${RECORD_ID}%7D`],
  ["a percent-encoded hyphen", RECORD_ID.replace(/-/g, "%2D")],
  ["Arabic-Indic digits", "٢f0bc11e-0000-4000-8000-00000000001"],
  ["fullwidth digits", "２f0bc11e-0000-4000-8000-00000000001"],
  ["a zero-width space inside an otherwise real id", `${RECORD_ID.slice(0, 20)}\u200B${RECORD_ID.slice(20)}`],
  ["a NUL inside an otherwise real id", `${RECORD_ID.slice(0, 10)}\u0000${RECORD_ID.slice(11)}`],
  ["a NUL after a real id", `${RECORD_ID}\u0000`],
  ["a newline after a real id", `${RECORD_ID}\n`],
  ["a carriage return after a real id", `${RECORD_ID}\r`],
  ["a tab after a real id", `${RECORD_ID}\t`],
  ["a leading hyphen", `-${RECORD_ID}`],
  ["a trailing hyphen", `${RECORD_ID}-`],
  ["a doubled hyphen", "2f0bc11e--0000-4000-8000-000000000001"],
  ["a hyphen at a position Postgres does not allow (after seven digits)", "2f0bc11-e0000-4000-8000-000000000001"],
  ["8000 characters", "a".repeat(8000)],
  ["8000 hex characters", "0123".repeat(2000)],
  ["8000 characters of hex groups and hyphens", "0123-".repeat(1600)],
  ["a path traversal", "../../groups/00000000-0000-4000-8000-000000000000"],
  ["a wildcard PostgREST would read as a pattern", "*"],
  ["a PostgREST filter operator", "eq.2f0bc11e-0000-4000-8000-000000000001"],
];

/** Every id form Postgres's own uuid input accepts — none may be over-refused. */
const POSTGRES_ID_FORMS: ReadonlyArray<readonly [string, string]> = [
  ["canonical", RECORD_ID],
  ["upper case", RECORD_ID.toUpperCase()],
  ["every hyphen omitted", RECORD_ID.replace(/-/g, "")],
  ["a hyphen after every group of four", "2f0b-c11e-0000-4000-8000-000000000001"],
  ["hyphens after some groups of four", "2f0b-c11e00004000-8000000000000001"],
  ["the nil uuid", "00000000-0000-0000-0000-000000000000"],
  // A hyphen after the 28th digit is still "after a group of four", which
  // Postgres takes and this route must therefore not refuse. Written here
  // because QA first put it in the refusal list above and the suite said no.
  ["a hyphen splitting the last group", "2f0bc11e-0000-4000-8000-00000000-0001"],
];

describe("the id gate, attacked (QA, admin-window/BUG-0068)", () => {
  it("refuses every one of these segments 404 and attempts no database call", async () => {
    for (const [what, id] of MORE_NON_IDS) {
      const { status } = await patch("walk_sandbox", { field: "label", value: "x" }, id);
      expect(status, what).toBe(404);
      expect(updateRecordField, what).not.toHaveBeenCalled();
      updateRecordField.mockReset();
    }
  });

  it("says nothing the database said for any of them, and echoes no segment back", async () => {
    for (const [what, id] of MORE_NON_IDS) {
      const { text } = await patch("walk_sandbox", { field: "label", value: "x" }, id);
      expect(text, what).not.toMatch(/22P02|invalid input syntax|uuid|postgres|pgrst/i);
      expect(JSON.parse(text), what).toEqual({ error: "no walk_sandbox record with that id" });
      updateRecordField.mockReset();
    }
  });

  it("answers a segment of 8000 characters promptly rather than backtracking on it", async () => {
    // The grammar is fixed-width groups with optional separators, so a
    // pathological input must not turn the refusal into work. The bound is
    // loose on purpose: it catches a hang, it does not police speed.
    const started = Date.now();
    for (const id of ["a".repeat(8000), "0123".repeat(2000), "0123-".repeat(1600)]) {
      const { status } = await patch("walk_sandbox", { field: "label", value: "x" }, id);
      expect(status).toBe(404);
      updateRecordField.mockReset();
    }
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("does not over-refuse an id form the database itself accepts", async () => {
    for (const [what, id] of POSTGRES_ID_FORMS) {
      const { status } = await patch("walk_sandbox", { field: "label", value: "x" }, id);
      expect(status, what).toBe(200);
      expect(updateRecordField, what).toHaveBeenCalledTimes(1);
      expect(updateRecordField.mock.calls[0][1], what).toBe(id);
      updateRecordField.mockReset();
      updateRecordField.mockResolvedValue({ kind: "ok", data: { sandbox_id: RECORD_ID } });
    }
  });

  it("gives the malformed miss and the well-formed miss the same body on every editable table", async () => {
    // One sentence, one status, per table: a caller cannot learn from the
    // answer whether the id it sent was even shaped like an id.
    for (const [table, field] of [["walk_sandbox", "label"]] as const) {
      updateRecordField.mockResolvedValue({ kind: "ok", data: null });
      const wellFormed = await patch(table, { field, value: "x" }, RECORD_ID);
      expect(wellFormed.status, table).toBe(404);
      expect(updateRecordField, table).toHaveBeenCalledTimes(1);
      updateRecordField.mockReset();

      const malformed = await patch(table, { field, value: "x" }, "walk-1");
      expect(malformed.status, table).toBe(404);
      expect(malformed.text, table).toBe(wellFormed.text);
      expect(updateRecordField, table).not.toHaveBeenCalled();
      updateRecordField.mockReset();
      updateRecordField.mockResolvedValue({ kind: "ok", data: { sandbox_id: RECORD_ID } });
    }
  });

  it("keeps the map's and the body parser's answers for these segments too", async () => {
    // The ordering claim, driven with ids the builder's list does not carry:
    // the gate added exactly one answer, it did not relabel the others.
    const cases: ReadonlyArray<readonly [string, string, unknown, number]> = [
      ["a".repeat(8000), "nosuchtable", { field: "name", value: "x" }, 404],
      [`{${RECORD_ID}}`, "events", { field: "event_type", value: "x" }, 403],
      ["٢f0b", "walk_sandbox", { field: "spotify_id", value: "x" }, 403],
      [`${RECORD_ID}\n`, "walk_sandbox", { field: "label" }, 400],
      [`${RECORD_ID}\u0000`, "walk_sandbox", "not json at all", 400],
      ["*", "scraped_events", { field: "payload", value: "x" }, 404],
    ];
    for (const [id, table, body, status] of cases) {
      const answer = await patch(table, body, id);
      expect(answer.status, `${table} ${JSON.stringify(id).slice(0, 24)}`).toBe(status);
      expect(updateRecordField, table).not.toHaveBeenCalled();
      updateRecordField.mockReset();
    }
  });

  it("makes exactly one database call for a well-formed id, whatever the writer answers", async () => {
    // The other half of "no call for a malformed id": the route never retries,
    // never double-writes, and never falls through to a second attempt.
    for (const outcome of [
      { kind: "ok", data: { sandbox_id: RECORD_ID } },
      { kind: "ok", data: null },
      { kind: "error", message: "connection refused" },
      { kind: "not_provisioned", missing: "walk_sandbox" },
    ]) {
      updateRecordField.mockResolvedValue(outcome);
      await patch("walk_sandbox", { field: "label", value: "x" }, RECORD_ID);
      expect(updateRecordField, outcome.kind).toHaveBeenCalledTimes(1);
      updateRecordField.mockReset();
    }
  });

  it("refuses a malformed id the same way when the same request arrives twice at once", async () => {
    const both = await Promise.all([
      patch("walk_sandbox", { field: "label", value: "x" }, "walk-1"),
      patch("walk_sandbox", { field: "label", value: "x" }, "walk-1"),
    ]);
    for (const answer of both) expect(answer.status).toBe(404);
    expect(both[0].text).toBe(both[1].text);
    expect(updateRecordField).not.toHaveBeenCalled();
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
      message: 'column walk_sandbox.tally is of type integer but expression is of type text',
    });
    const { status, text } = await patch("walk_sandbox", { field: "label", value: "x" });
    expect(status).toBe(500);
    expect(JSON.parse(text).error).toMatch(/expression is of type text/);
    expect(updateRecordField).toHaveBeenCalledTimes(1);
  });

  it("answers 503 naming what is not provisioned", async () => {
    updateRecordField.mockResolvedValue({
      kind: "not_provisioned",
      missing: "walk_sandbox",
    });
    const { status, text } = await patch("walk_sandbox", { field: "label", value: "x" });
    expect(status).toBe(503);
    expect(JSON.parse(text).error).toMatch(/walk_sandbox/);
  });

  it("answers 404 for a well-formed id that matches no row", async () => {
    updateRecordField.mockResolvedValue({ kind: "ok", data: null });
    const { status, text } = await patch("walk_sandbox", { field: "label", value: "x" });
    expect(status).toBe(404);
    expect(JSON.parse(text).error).toMatch(/no walk_sandbox record/);
    expect(updateRecordField).toHaveBeenCalledTimes(1);
  });

  it("answers 200 with the record it wrote", async () => {
    const { status, text } = await patch("walk_sandbox", { field: "label", value: "hello" });
    expect(status).toBe(200);
    expect(JSON.parse(text)).toEqual({
      ok: true,
      record: { sandbox_id: RECORD_ID, label: "written" },
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

    const { status } = await patch("walk_sandbox", { field: "label", value: "hello" });
    expect(status).toBe(403);
    expect(updateRecordField).not.toHaveBeenCalled();
  });
});
