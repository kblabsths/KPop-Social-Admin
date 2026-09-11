import { describe, expect, it } from "vitest";
import {
  EDIT_CONFIG,
  decideEdit,
  mappedColumns,
  mappedRegistryFields,
} from "@/lib/edit/config";
import {
  readRecord,
  readRecordProvenance,
  readReferenceChoices,
  recordColumns,
  updateRecordField,
} from "@/lib/db/records";
import { ROW_CAP } from "@/lib/db/result";
import { fieldProvenanceRow } from "../../fixtures/rows";
import {
  permissionDenied,
  stubClient,
  tableNotInSchemaCache,
  undefinedColumnOfRelation,
} from "../../fixtures/stub-client";

/**
 * The record read and the one direct update (campaign admin-window/TASK-0017),
 * offline against the stub client. No network, no database.
 *
 * The stub answers with whatever the script says regardless of the chain the
 * query built — which is exactly why the "no query at all" assertions below
 * matter: a refused edit must leave the row unchanged, and the only way to
 * prove that of the DATA LAYER rather than of the route is to show that no
 * query was ever built.
 */

/**
 * The row every case below reads or writes.
 *
 * It is a WALK SANDBOX row: Ben struck the direct catalog edit on 2026-09-08
 * and `groups`/`idols` left the map with it, so the sandbox is the only table
 * `updateRecordField` can be asked to write at all (ARCHITECTURE §9). Every
 * claim in this file is the one it made before; only the subject moved.
 */
const ROW_ID = "2f0bc11e-0000-4000-8000-000000000001";

/** An allowed edit, obtained the only way a caller can obtain one. */
function allowed(table: string, field: string) {
  const decision = decideEdit(table, field);
  if (!decision.allowed) throw new Error(`${table}.${field} should be editable`);
  return decision.edit;
}

/** The step a recorded call made under `method`, if it made one. */
function step(
  call: { steps: Array<{ method: string; args: unknown[] }> },
  method: string,
) {
  return call.steps.find((s) => s.method === method);
}

describe("the columns a record read asks for", () => {
  it("is the primary key plus exactly the editable ones", () => {
    expect(recordColumns(EDIT_CONFIG.walk_sandbox)).toBe(
      ["sandbox_id", ...EDIT_CONFIG.walk_sandbox.editable].join(", "),
    );
    // Nothing beyond the map is ever selected, so the surface cannot show —
    // and a later widget cannot offer — a column the map does not carry.
    expect(recordColumns(EDIT_CONFIG.walk_sandbox)).not.toContain("created_at");
  });

  it("adds the read-only display columns, so the surface has them to draw", () => {
    // admin-window/TASK-0029: a resolver-owned table's editable list is empty
    // by design, and its record page showed its id and nothing else because
    // the read asked for the pk alone. It asks for the map's columns now.
    for (const table of ["events", "venues"]) {
      const config = EDIT_CONFIG[table];
      expect(recordColumns(config), table).toBe(mappedColumns(config).join(", "));
      for (const column of config.display) {
        expect(recordColumns(config), `${table}.${column}`).toContain(column);
      }
    }
  });

  it("asks for nothing the map does not carry, on a resolver-owned table too", () => {
    const columns = recordColumns(EDIT_CONFIG.events).split(", ");
    // Real columns of `events` that the map does not name: still unread.
    for (const column of ["ticket_url", "event_type", "created_at", "ends_at"]) {
      expect(columns, column).not.toContain(column);
    }
  });
});

describe("readRecord", () => {
  it("reads one row by primary key and returns it", async () => {
    const row = { sandbox_id: ROW_ID, label: "a sandbox row", tally: 3 };
    const db = stubClient({ walk_sandbox: { data: row } });

    const result = await readRecord(
      EDIT_CONFIG.walk_sandbox,
      ROW_ID,
      db.asSupabaseClient(),
    );

    expect(result).toEqual({ kind: "ok", data: row });
    expect(db.tablesRead()).toEqual(["walk_sandbox"]);
    const call = db.calls[0];
    expect(step(call, "select")?.args[0]).toBe(recordColumns(EDIT_CONFIG.walk_sandbox));
    expect(step(call, "eq")?.args).toEqual(["sandbox_id", ROW_ID]);
    // Addressed by primary key: one row, so no row-set bound applies
    // (ARCHITECTURE §4.3).
    expect(step(call, "maybeSingle")).toBeDefined();
    expect(step(call, "limit")).toBeUndefined();
    expect(step(call, "range")).toBeUndefined();
  });

  it("reports no such row as ok/null, distinct from an absent table", async () => {
    const present = stubClient({ walk_sandbox: { data: null } });
    expect(
      await readRecord(EDIT_CONFIG.walk_sandbox, ROW_ID, present.asSupabaseClient()),
    ).toEqual({ kind: "ok", data: null });

    const absent = stubClient({
      walk_sandbox: { error: tableNotInSchemaCache("walk_sandbox") },
    });
    expect(
      await readRecord(EDIT_CONFIG.walk_sandbox, ROW_ID, absent.asSupabaseClient()),
    ).toEqual({ kind: "not_provisioned", missing: "walk_sandbox" });
  });
});

describe("updateRecordField writes an allowlisted column", () => {
  it("issues one update on the right table, keyed by the primary key", async () => {
    const stored = { sandbox_id: ROW_ID, label: "the stored label" };
    const db = stubClient({ walk_sandbox: { data: stored } });

    const result = await updateRecordField(
      allowed("walk_sandbox", "label"),
      ROW_ID,
      "the stored label",
      db.asSupabaseClient(),
    );

    expect(result).toEqual({ kind: "ok", data: stored });
    expect(db.tablesRead()).toEqual(["walk_sandbox"]);
    const call = db.calls[0];
    expect(step(call, "update")?.args[0]).toEqual({ label: "the stored label" });
    expect(step(call, "eq")?.args).toEqual(["sandbox_id", ROW_ID]);
    // The row as stored comes back, so the surface shows what was kept.
    expect(step(call, "select")?.args[0]).toBe(recordColumns(EDIT_CONFIG.walk_sandbox));
  });

  it("clears a field when the value is null", async () => {
    const db = stubClient({ walk_sandbox: { data: { sandbox_id: ROW_ID, note: null } } });
    await updateRecordField(
      allowed("walk_sandbox", "note"),
      ROW_ID,
      null,
      db.asSupabaseClient(),
    );
    expect(step(db.calls[0], "update")?.args[0]).toEqual({ note: null });
  });

  it("writes a numeric column as a number", async () => {
    const db = stubClient({ walk_sandbox: { data: { sandbox_id: ROW_ID, tally: 4 } } });
    await updateRecordField(
      allowed("walk_sandbox", "tally"),
      ROW_ID,
      4,
      db.asSupabaseClient(),
    );
    expect(step(db.calls[0], "update")?.args[0]).toEqual({ tally: 4 });
  });

  it("reports no matching row as ok/null — nothing was written", async () => {
    const db = stubClient({ walk_sandbox: { data: null } });
    const result = await updateRecordField(
      allowed("walk_sandbox", "label"),
      ROW_ID,
      "…",
      db.asSupabaseClient(),
    );
    expect(result).toEqual({ kind: "ok", data: null });
  });
});

describe("updateRecordField refuses, and issues no query at all", () => {
  /**
   * The row-unchanged half of acceptance test 7, proven at the data layer: a
   * refusal that reached the database and was rejected there would still be a
   * write attempt. These assert the stub was never asked anything.
   */
  async function refuse(table: string, field: string) {
    const db = stubClient({
      walk_sandbox: { data: { sandbox_id: ROW_ID } },
      events: { data: { event_id: ROW_ID } },
      venues: { data: { venue_id: ROW_ID } },
      groups: { data: { id: ROW_ID } },
      idols: { data: { id: ROW_ID } },
    });
    const config = EDIT_CONFIG[table] ?? EDIT_CONFIG.walk_sandbox;
    // `path: "direct"` is the FORGERY, and after the override path landed it
    // is the one that matters: `decideEdit` allows a mapped column of
    // `events`/`venues` now, so the only thing standing between a caller and
    // an `.update()` on a catalog row is the data layer re-deriving the path
    // from the config's own regime (admin-window/TASK-0054, FEAT-0011
    // criterion 4).
    const result = await updateRecordField(
      { config, field, path: "direct" },
      ROW_ID,
      "forged",
      db.asSupabaseClient(),
    );
    return { result, calls: db.calls };
  }

  it("refuses a column absent from the map, naming the field", async () => {
    const { result, calls } = await refuse("walk_sandbox", "created_at");
    expect(result.kind).toBe("error");
    if (result.kind === "error") expect(result.message).toContain("created_at");
    expect(calls).toEqual([]);
  });

  it("refuses an id, key or timestamp column", async () => {
    for (const field of ["sandbox_id", "created_at"]) {
      const { result, calls } = await refuse("walk_sandbox", field);
      expect(result.kind, field).toBe("error");
      expect(calls, field).toEqual([]);
    }
  });

  it("refuses a table Ben struck from the map, whatever the column", async () => {
    // The strike, at the data layer. `groups`/`idols` left `EDIT_CONFIG` on
    // 2026-09-08, so `decideEdit` cannot produce an `AllowedEdit` for either;
    // the only way to ASK is the adversarial one — a hand-built config naming
    // the struck table and the columns its retired allowlist carried. The data
    // layer consults the map again and never builds a query. The stub scripts
    // both tables on purpose: had a write been attempted it would have
    // succeeded, so an empty call list is a real negative.
    const db = stubClient({
      groups: { data: { id: ROW_ID } },
      idols: { data: { id: ROW_ID } },
    });
    for (const [table, field] of [
      ["groups", "name"],
      ["groups", "bio"],
      ["groups", "member_count"],
      ["idols", "stage_name"],
      ["idols", "mbti"],
    ] as const) {
      const result = await updateRecordField(
        {
          config: {
            table,
            pk: "id",
            regime: "sandbox",
            editable: [field],
            display: [],
            reference: null,
          },
          field,
          path: "direct",
        },
        ROW_ID,
        "forged",
        db.asSupabaseClient(),
      );
      expect(result.kind, `${table}.${field}`).toBe("error");
      if (result.kind === "error") {
        expect(result.message, `${table}.${field}`).toContain(table);
      }
    }
    expect(db.calls).toEqual([]);
  });

  it("refuses every column of a resolver-owned table, mapped or not", async () => {
    // Both halves, because they refuse for different reasons and BOTH have to
    // hold: `venue_id` and `event_type` are not in `editable` at all, while
    // `title`, `starts_at` and `venues.name` ARE — they are exactly what the
    // override path writes — and a direct write of them is what this layer
    // must never build (FEAT-0011 criterion 4). The stub scripts all three
    // tables, so an empty call list is a real negative: had a query been
    // built, it would have been answered.
    for (const [table, field] of [
      ["events", "title"],
      ["events", "starts_at"],
      ["events", "venue_id"],
      ["events", "event_type"],
      ["venues", "name"],
      ["venues", "country"],
      ["venues", "timezone"],
    ] as const) {
      const { result, calls } = await refuse(table, field);
      expect(result.kind, `${table}.${field}`).toBe("error");
      if (result.kind === "error") {
        expect(result.message, `${table}.${field}`).toContain(table);
      }
      expect(calls, `${table}.${field}`).toEqual([]);
    }
  });

  it("refuses the map's own config for a resolver-owned table, obtained honestly", async () => {
    // Not a forgery at all: `decideEdit("events", "title")` ALLOWS the edit —
    // that is the override path — and its `AllowedEdit` carries
    // `path: "override"`. Handing it here must still write nothing, so that
    // "no `.update()` targets a catalog table on any path" is a property of
    // the data layer and not of the route's branch (FEAT-0011 criterion 4).
    const db = stubClient({
      events: { data: { event_id: ROW_ID } },
      venues: { data: { venue_id: ROW_ID } },
    });
    for (const [table, field] of [
      ["events", "title"],
      ["venues", "city"],
    ] as const) {
      const edit = allowed(table, field);
      expect(edit.path, `${table}.${field}`).toBe("override");
      const result = await updateRecordField(
        edit,
        ROW_ID,
        "forged",
        db.asSupabaseClient(),
      );
      expect(result.kind, `${table}.${field}`).toBe("error");
      if (result.kind === "error") {
        expect(result.message, `${table}.${field}`).toContain(table);
      }
    }
    expect(db.calls).toEqual([]);
  });

  it("refuses a forged config whose table the map does not carry", async () => {
    // The strongest form: a caller that hand-builds the config object instead
    // of going through `decideEdit`. The data layer consults the map again and
    // never reaches the database.
    const db = stubClient({
      groups: { data: { id: ROW_ID } },
      walk_sandbox: { data: { sandbox_id: ROW_ID } },
    });
    // `groups` leads the list: a forged config is exactly how the struck
    // direct edit would be smuggled back, and the map is consulted again here.
    for (const table of ["groups", "idols", "event_performers", "scraped_events", "profiles"]) {
      const result = await updateRecordField(
        {
          config: {
            table,
            pk: "id",
            regime: "sandbox",
            editable: ["name"],
            display: [],
            reference: null,
          },
          field: "name",
          path: "direct",
        },
        ROW_ID,
        "forged",
        db.asSupabaseClient(),
      );
      expect(result.kind, table).toBe("error");
    }
    expect(db.calls).toEqual([]);
  });

  it("uses the map's own config, not a forged one that widens the allowlist", async () => {
    // A caller claiming `walk_sandbox.created_at` is editable by handing in
    // its own `editable` list gets the map's answer, not its own.
    const db = stubClient({ walk_sandbox: { data: { sandbox_id: ROW_ID } } });
    const result = await updateRecordField(
      {
        config: {
          table: "walk_sandbox",
          pk: "sandbox_id",
          regime: "sandbox",
          editable: ["created_at", "label"],
          display: [],
          reference: null,
        },
        field: "created_at",
        path: "direct",
      },
      ROW_ID,
      "forged",
      db.asSupabaseClient(),
    );
    expect(result.kind).toBe("error");
    expect(db.calls).toEqual([]);
  });

  it("keys the write by the map's primary key, not a forged one", async () => {
    const db = stubClient({ walk_sandbox: { data: { sandbox_id: ROW_ID } } });
    await updateRecordField(
      {
        config: {
          table: "walk_sandbox",
          pk: "created_at",
          regime: "sandbox",
          editable: ["label"],
          display: [],
          reference: null,
        },
        field: "label",
        path: "direct",
      },
      ROW_ID,
      "a forged key",
      db.asSupabaseClient(),
    );
    expect(step(db.calls[0], "eq")?.args).toEqual(["sandbox_id", ROW_ID]);
  });

  it("says THIS APP wrote each refusal, so neither reads in the machine's face", async () => {
    // admin-window/BUG-0200 ruled the class: every `kind: "error"` account
    // this app composes under `src/lib/db/**` carries its authorship at its
    // one construction point. Both arms here are wholly this app's prose —
    // `decideEdit`'s sentence about its own allowlist, and this app's sentence
    // about its own write paths — so each is ONE `"this app"` segment, the
    // interpolated table name included.
    //
    // STRUCTURAL only: who the runs say wrote them, and that the flat account
    // is still the join of them. Nothing here pins the product's prose, so
    // rewording either refusal moves nothing in this case.
    for (const [name, table, field] of [
      ["the allowlist refusal", "walk_sandbox", "created_at"],
      ["the not-written-directly refusal", "events", "title"],
    ] as const) {
      const { result } = await refuse(table, field);
      expect(result.kind, name).toBe("error");
      if (result.kind !== "error") continue;
      expect(result.authored, `${name}: the arm carries no authorship`).toBeDefined();
      expect(
        (result.authored ?? []).map((run) => run.author),
        `${name}: every run of an account this app wrote is this app's`,
      ).toEqual(["this app"]);
      expect((result.authored ?? []).map((run) => run.words).join(" "), name).toBe(result.message);
    }
  });
});

describe("updateRecordField surfaces what the database said", () => {
  it("classifies an absent table as not provisioned, naming it", async () => {
    const db = stubClient({
      walk_sandbox: { error: tableNotInSchemaCache("walk_sandbox") },
    });
    expect(
      await updateRecordField(
        allowed("walk_sandbox", "label"),
        ROW_ID,
        "…",
        db.asSupabaseClient(),
      ),
    ).toEqual({ kind: "not_provisioned", missing: "walk_sandbox" });
  });

  it("classifies an absent column as not provisioned, naming table and column", async () => {
    const db = stubClient({
      walk_sandbox: { error: undefinedColumnOfRelation("walk_sandbox", "label") },
    });
    expect(
      await updateRecordField(
        allowed("walk_sandbox", "label"),
        ROW_ID,
        "…",
        db.asSupabaseClient(),
      ),
    ).toEqual({ kind: "not_provisioned", missing: "walk_sandbox.label" });
  });

  it("passes any other failure through in the database's own words", async () => {
    const denied = permissionDenied("walk_sandbox");
    const db = stubClient({ walk_sandbox: { error: denied } });
    expect(
      await updateRecordField(
        allowed("walk_sandbox", "label"),
        ROW_ID,
        "…",
        db.asSupabaseClient(),
      ),
    ).toEqual({
      kind: "error",
      reading: "walk_sandbox",
      message: expect.stringContaining(denied.message),
      // The account's runs, as `lib/db/result.ts` decided them: every run of
      // this one is the DATABASE's, its own code included (admin-window/BUG-0196).
      authored: [
        { words: denied.message, author: "the machine" },
        { words: `(${denied.code})`, author: "the machine" },
      ],
    });
  });

  it("never throws, even when the client itself fails", async () => {
    const exploding = {
      from() {
        throw new Error("no client");
      },
    } as never;
    const result = await updateRecordField(
      allowed("walk_sandbox", "label"),
      ROW_ID,
      "…",
      exploding,
    );
    expect(result.kind).toBe("error");
  });
});

/* ── the entity picker's choices leg ──────────────────────────────────────── */

/**
 * `readReferenceChoices` (campaign admin-window/TASK-0055): the rows a
 * reference field may be pointed at.
 *
 * A WINDOW read (ARCHITECTURE §4.3, read kind 2), so what is graded is that it
 * is one: an explicit order, an explicit limit, and a result carrying the
 * facts the surface's window line states. It never claims to be the whole
 * table, and it never creates a row.
 */
describe("readReferenceChoices", () => {
  const VENUE = "01920000-0000-7000-8000-0000000000a4";
  const DOME = "01920000-0000-7000-8000-0000000000b1";

  const VENUE_ROWS = [
    { venue_id: VENUE, name: "Olympic Hall" },
    { venue_id: DOME, name: "Gocheok Sky Dome" },
  ];

  it("issues no query at all for a table the map gives no reference", async () => {
    for (const table of ["venues", "walk_sandbox"]) {
      expect(EDIT_CONFIG[table].reference, table).toBeNull();
      const db = stubClient({});
      const choices = await readReferenceChoices(
        EDIT_CONFIG[table],
        db.asSupabaseClient(),
      );
      expect(db.calls, table).toEqual([]);
      expect(choices.window, table).toBeNull();
      expect(choices.note, table).toBeNull();
    }
  });

  it("reads the referenced table, by name, with an explicit order and limit", async () => {
    const db = stubClient({ venues: { data: VENUE_ROWS } });
    await readReferenceChoices(EDIT_CONFIG.events, db.asSupabaseClient());

    expect(db.tablesRead()).toEqual(["venues"]);
    const read = db.calls[0];
    // The columns explicitly (§4.2): the key that travels in the decision, and
    // the name an operator reads.
    expect(step(read, "select")?.args).toEqual(["venue_id, name"]);
    // A TOTAL order — name, then key — so the window's edge is the same edge
    // on every read and two venues sharing a name cannot swap places.
    expect(
      read.steps.filter((s) => s.method === "order").map((s) => s.args),
    ).toEqual([
      ["name", { ascending: true }],
      ["venue_id", { ascending: true }],
    ]);
    // An explicit limit is what makes it a named window rather than a set.
    expect(step(read, "limit")?.args).toEqual([ROW_CAP]);
    // It is a READ: no insert, no upsert, no update anywhere in the chain.
    for (const forbidden of ["insert", "upsert", "update", "delete"]) {
      expect(
        read.steps.map((s) => s.method),
        forbidden,
      ).not.toContain(forbidden);
    }
  });

  it("returns the rows with the window's own facts, claiming no total", async () => {
    const db = stubClient({ venues: { data: VENUE_ROWS } });
    const choices = await readReferenceChoices(
      EDIT_CONFIG.events,
      db.asSupabaseClient(),
    );
    expect(choices.note).toBeNull();
    expect(choices.window).toEqual({
      options: [
        { id: VENUE, name: "Olympic Hall" },
        { id: DOME, name: "Gocheok Sky Dome" },
      ],
      limit: ROW_CAP,
      held: 2,
      truncated: false,
      over: "table",
      domain: "venues",
    });
  });

  it("calls a window that filled its cap truncated, so the surface can say so", async () => {
    const full = Array.from({ length: ROW_CAP }, (_, index) => ({
      venue_id: `01920000-0000-7000-8000-${String(index).padStart(12, "0")}`,
      name: `Venue ${index}`,
    }));
    const db = stubClient({ venues: { data: full } });
    const choices = await readReferenceChoices(
      EDIT_CONFIG.events,
      db.asSupabaseClient(),
    );
    expect(choices.window?.truncated).toBe(true);
    expect(choices.window?.held).toBe(ROW_CAP);
  });

  it("offers a row whose name is null, and drops a row with no key", async () => {
    const db = stubClient({
      venues: {
        data: [
          { venue_id: VENUE, name: null },
          { venue_id: VENUE, name: "" },
          // Nothing could be pointed at this, so it is not a choice.
          { venue_id: null, name: "A venue with no key" },
        ],
      },
    });
    const choices = await readReferenceChoices(
      EDIT_CONFIG.events,
      db.asSupabaseClient(),
    );
    expect(choices.window?.options).toEqual([
      { id: VENUE, name: null },
      { id: VENUE, name: null },
    ]);
    // `held` is what the READ came back with, not what survived shaping: it is
    // a fact of the window, and the window really did hold three rows.
    expect(choices.window?.held).toBe(3);
  });

  it("answers with an empty window when the table holds nothing", async () => {
    const db = stubClient({ venues: { data: [] } });
    const choices = await readReferenceChoices(
      EDIT_CONFIG.events,
      db.asSupabaseClient(),
    );
    expect(choices.note).toBeNull();
    expect(choices.window?.options).toEqual([]);
    expect(choices.window?.held).toBe(0);
  });

  it("reports an absent table as not_provisioned, naming it, and shows no window", async () => {
    const db = stubClient({ venues: { error: tableNotInSchemaCache("venues") } });
    const choices = await readReferenceChoices(
      EDIT_CONFIG.events,
      db.asSupabaseClient(),
    );
    expect(choices.window).toBeNull();
    expect(choices.note?.kind).toBe("not_provisioned");
    if (choices.note?.kind === "not_provisioned") {
      expect(choices.note.missing).toBe("venues");
    }
  });

  it("reports a refused read for itself, in the database's own words", async () => {
    const refusal = permissionDenied("venues");
    const db = stubClient({ venues: { error: refusal } });
    const choices = await readReferenceChoices(
      EDIT_CONFIG.events,
      db.asSupabaseClient(),
    );
    expect(choices.window).toBeNull();
    expect(choices.note?.kind).toBe("error");
    if (choices.note?.kind === "error") {
      expect(choices.note.message).toContain(refusal.message);
      expect(choices.note.reading).toBe("venues");
    }
  });
});

/* ── the per-field provenance leg ─────────────────────────────────────────── */

/**
 * `readRecordProvenance` (campaign admin-window/TASK-0029): the record's
 * values and its provenance are two reads and two answers, so every case below
 * asks what the leg did on its own — including the cases where it did nothing.
 */
describe("readRecordProvenance", () => {
  const EVENT_ID = "01920000-0000-7000-8000-0000000000a3";
  const TICKETMASTER = "01920000-0000-7000-8000-000000000101";

  /** A complete read's response: the rows plus the exact count they claim. */
  function complete(rows: unknown[]) {
    return { data: rows, count: rows.length };
  }

  it("issues no query at all for a table Admin writes directly", async () => {
    // The walk sandbox's case. `field_provenance` carries rows for
    // resolver-owned entities; reading it for a staging fixture could only
    // ever answer "no rows" — or hand a page with no provenance to miss a
    // not-provisioned card. It keys on the WRITE PATH: `venues` displays no
    // column at all now and is exactly the table whose provenance is wanted.
    const db = stubClient({});
    const result = await readRecordProvenance(
      EDIT_CONFIG.walk_sandbox,
      ROW_ID,
      db.asSupabaseClient(),
    );
    expect(db.calls).toEqual([]);
    expect(result.note).toBeNull();
    expect(result.fields.size).toBe(0);
  });

  it("reads the log for this entity and this row's mapped fields", async () => {
    const db = stubClient({
      field_provenance: complete([
        fieldProvenanceRow({ entity_id: EVENT_ID, field: "title" }),
      ]),
      sources: complete([{ source_id: TICKETMASTER, source: "ticketmaster" }]),
    });
    await readRecordProvenance(EDIT_CONFIG.events, EVENT_ID, db.asSupabaseClient());

    const log = db.calls[0];
    expect(log.table).toBe("field_provenance");
    // The fact identity's three parts: the canonical table, the row, and the
    // fields this surface actually displays.
    expect(step(log, "eq")?.args).toEqual(["entity_type", "events"]);
    expect(
      log.steps.filter((s) => s.method === "eq").map((s) => s.args),
    ).toContainEqual(["entity_id", EVENT_ID]);
    // The MAP's columns, not `display` alone: the columns an operator
    // overrides are the ones an admin decision stamps, and a filter on
    // `display` would drop every one of them (FEAT-0011 criterion 6).
    //
    // ...asked for by the name the LOG spells each fact with, which is the
    // column's own name for every one of them but the reference
    // (admin-window/BUG-0090): `field_provenance.field` holds the registry
    // field, so a filter built from `mappedColumns` asks for `venue_id`, a
    // name that table has never held.
    expect(step(log, "in")?.args).toEqual([
      "field",
      [...mappedRegistryFields(EDIT_CONFIG.events)],
    ]);
    expect(step(log, "in")?.args[1]).toContain("title");
    expect(step(log, "in")?.args[1]).toContain("venue");
    expect(step(log, "in")?.args[1]).not.toContain("venue_id");
    // Every scalar is still asked for by its own column name — the one
    // translation is the reference's, and nothing else moved.
    for (const column of mappedColumns(EDIT_CONFIG.events)) {
      if (column === EDIT_CONFIG.events.reference?.field) continue;
      expect(step(log, "in")?.args[1], column).toContain(column);
    }
  });

  it("is a complete read: exact count, total order, capped range", async () => {
    const db = stubClient({
      field_provenance: complete([]),
    });
    await readRecordProvenance(EDIT_CONFIG.events, EVENT_ID, db.asSupabaseClient());

    const log = db.calls[0];
    expect(step(log, "select")?.args[1]).toEqual({ count: "exact" });
    // The order ends in the primary key, which is what lets a truncated set be
    // told from a whole one reproducibly.
    const orders = log.steps.filter((s) => s.method === "order").map((s) => s.args[0]);
    expect(orders[orders.length - 1]).toBe("provenance_id");
    expect(step(log, "range")).toBeDefined();
  });

  it("refuses rather than reporting a superseded source as current", async () => {
    // The log says there are more rows than it returned — "the latest
    // decision" is not knowable, so the leg refuses instead of answering from
    // the rows it happens to hold.
    const db = stubClient({
      field_provenance: {
        data: [fieldProvenanceRow({ entity_id: EVENT_ID })],
        count: 4000,
      },
    });
    const result = await readRecordProvenance(
      EDIT_CONFIG.events,
      EVENT_ID,
      db.asSupabaseClient(),
    );
    expect(result.note?.kind).toBe("error");
    expect(result.fields.size).toBe(0);
  });

  it("keeps only the latest decision per fact, and resolves its source name", async () => {
    const db = stubClient({
      field_provenance: complete([
        fieldProvenanceRow({
          provenance_id: "01920000-0000-7000-8000-000000000401",
          entity_id: EVENT_ID,
          field: "title",
          applied_at: "2026-08-01T00:00:00Z",
          source_id: "01920000-0000-7000-8000-000000000102",
        }),
        fieldProvenanceRow({
          provenance_id: "01920000-0000-7000-8000-000000000402",
          entity_id: EVENT_ID,
          field: "title",
          applied_at: "2026-09-01T00:00:00Z",
          source_id: TICKETMASTER,
        }),
      ]),
      sources: complete([
        { source_id: TICKETMASTER, source: "ticketmaster" },
        { source_id: "01920000-0000-7000-8000-000000000102", source: "bandsintown" },
      ]),
    });
    const result = await readRecordProvenance(
      EDIT_CONFIG.events,
      EVENT_ID,
      db.asSupabaseClient(),
    );
    const title = result.fields.get("title");
    expect(title?.authority).toBe("source");
    expect(title && "source" in title ? title.source : null).toBe("ticketmaster");
    expect(title?.appliedAt).toBe("2026-09-01T00:00:00Z");
  });

  it("reports an absent field_provenance without touching the values", async () => {
    const db = stubClient({
      field_provenance: { error: tableNotInSchemaCache("field_provenance") },
    });
    const result = await readRecordProvenance(
      EDIT_CONFIG.events,
      EVENT_ID,
      db.asSupabaseClient(),
    );
    expect(result.note).toEqual({
      kind: "not_provisioned",
      missing: "field_provenance",
    });
    expect(result.fields.size).toBe(0);
  });

  it("names field_provenance when the read is refused", async () => {
    const db = stubClient({
      field_provenance: { error: permissionDenied("field_provenance") },
    });
    const result = await readRecordProvenance(
      EDIT_CONFIG.events,
      EVENT_ID,
      db.asSupabaseClient(),
    );
    expect(result.note?.kind).toBe("error");
    if (result.note?.kind === "error") {
      expect(result.note.reading).toBe("field_provenance");
    }
  });

  it("skips the source lookup when no current decision names a source", async () => {
    const db = stubClient({
      field_provenance: complete([
        fieldProvenanceRow({
          entity_id: EVENT_ID,
          field: "title",
          source_id: null,
          observation_id: null,
        }),
      ]),
    });
    const result = await readRecordProvenance(
      EDIT_CONFIG.events,
      EVENT_ID,
      db.asSupabaseClient(),
    );
    expect(db.tablesRead()).toEqual(["field_provenance"]);
    expect(result.fields.get("title")?.authority).toBe("unset");
  });

  it("keeps the facts when the source names cannot be read, and says so", async () => {
    // The decision behind the field is real whether or not the name lookup
    // answered: the id stands in for the name, and the leg still reports.
    const db = stubClient({
      field_provenance: complete([
        fieldProvenanceRow({ entity_id: EVENT_ID, field: "title" }),
      ]),
      sources: { error: permissionDenied("sources") },
    });
    const result = await readRecordProvenance(
      EDIT_CONFIG.events,
      EVENT_ID,
      db.asSupabaseClient(),
    );
    const title = result.fields.get("title");
    expect(title && "source" in title ? title.source : null).toBe(TICKETMASTER);
    expect(result.note?.kind).toBe("error");
  });

  // STRICT XFAIL — admin-window/BUG-0090. `it.fails` reddens the day the
  // behaviour is fixed and this marker is left behind, which sends the reader
  // to the ticket instead of letting the pin rot silently.
  it("carries the venue fact onto the reference column that displays it", async () => {
    // QA, admin-window/TASK-0054 criterion 6; filed as admin-window/BUG-0090.
    //
    // `field_provenance.field` holds the REGISTRY field name, and
    // `lib/verdict/decision.ts` states the one place that name differs from
    // the canonical column: `events.venue` (field) -> `events.venue_id`
    // (column). `provenanceFor` filters `.in("field", mappedColumns(config))`,
    // which spells `venue_id`, so the venue fact's decision can never match —
    // and the record page draws the em dash under a note that says the value
    // has no source behind it.
    //
    // Measured on staging (ubfjjqlvnpnoborczbdb) 2026-09-08:
    // `field_provenance` holds 11 `(entity_type=events, field=venue)` rows and
    // ZERO `field=venue_id` rows; event 01a03c9b-1d28-707d-9873-f73ab3add10c
    // carries `field=venue`, source ticketmaster, tier official, applied_at
    // 2026-09-02T15:41:43Z, and its record page renders `venue_id` as `—`
    // while `title`, `poster_url` and `starts_at` render
    // "ticketmaster, applied 6d ago".
    //
    // Two halves, because the defect has two: the read must ASK for the
    // registry name, and a returned row must LAND on the column it is drawn
    // as.
    const db = stubClient({
      field_provenance: complete([
        fieldProvenanceRow({
          entity_id: EVENT_ID,
          field: "venue",
          source_id: TICKETMASTER,
        }),
      ]),
      sources: complete([{ source_id: TICKETMASTER, source: "ticketmaster" }]),
    });
    const result = await readRecordProvenance(
      EDIT_CONFIG.events,
      EVENT_ID,
      db.asSupabaseClient(),
    );

    // 1. The filter names the fact this surface displays.
    expect(step(db.calls[0], "in")?.args[1]).toContain("venue");

    // 2. The decision lands on the line the operator reads.
    const venue = result.fields.get("venue_id");
    expect(venue?.authority).toBe("source");
    expect(venue && "source" in venue ? venue.source : null).toBe("ticketmaster");
  });

  it("reduces the venue fact's own history, and shows its lock", async () => {
    // admin-window/BUG-0090's second consequence, in the ticket's own words:
    // "the same mismatch will hide `admin_locked` on the venue fact the day
    // `settle_review_item` lands, so an admin-locked venue would read as
    // unprovenanced" — the one column spec §8 asks this surface to show
    // stickiness for.
    //
    // The re-keying happens at the READ BOUNDARY, before the latest-per-fact
    // reduction, so the venue's history reduces like any other fact's: two
    // decisions on `venue`, one line, the later one. Re-keying afterwards
    // would work here too, and this is what pins which of the two the data
    // layer does.
    const db = stubClient({
      field_provenance: complete([
        fieldProvenanceRow({
          provenance_id: "01920000-0000-7000-8000-000000000411",
          entity_id: EVENT_ID,
          field: "venue",
          applied_at: "2026-08-01T00:00:00Z",
          source_id: TICKETMASTER,
        }),
        fieldProvenanceRow({
          provenance_id: "01920000-0000-7000-8000-000000000412",
          entity_id: EVENT_ID,
          field: "venue",
          applied_at: "2026-09-01T00:00:00Z",
          source_id: TICKETMASTER,
          admin_locked: true,
        }),
      ]),
      sources: complete([{ source_id: TICKETMASTER, source: "ticketmaster" }]),
    });
    const result = await readRecordProvenance(
      EDIT_CONFIG.events,
      EVENT_ID,
      db.asSupabaseClient(),
    );

    // One line for the fact, on the column the operator reads, and nothing
    // left keyed by the log's own spelling.
    expect(result.fields.size).toBe(1);
    expect(result.fields.has("venue")).toBe(false);
    const venue = result.fields.get("venue_id");
    expect(venue?.authority).toBe("admin");
    expect(venue?.appliedAt).toBe("2026-09-01T00:00:00Z");
    // The line names the column it is drawn on, not the fact it was logged as.
    expect(venue?.field).toBe("venue_id");
  });

  it("writes nothing, whatever the log says", async () => {
    const db = stubClient({
      field_provenance: complete([
        fieldProvenanceRow({ entity_id: EVENT_ID, admin_locked: true }),
      ]),
    });
    await readRecordProvenance(EDIT_CONFIG.events, EVENT_ID, db.asSupabaseClient());
    for (const call of db.calls) {
      for (const s of call.steps) {
        expect(["update", "upsert", "insert", "delete"], call.table).not.toContain(
          s.method,
        );
      }
    }
  });
});
