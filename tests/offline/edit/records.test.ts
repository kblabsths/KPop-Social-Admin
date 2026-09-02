import { describe, expect, it } from "vitest";
import { EDIT_CONFIG, decideEdit } from "@/lib/edit/config";
import {
  readRecord,
  recordColumns,
  updateRecordField,
} from "@/lib/db/records";
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

const GROUP_ID = "2f0bc11e-0000-4000-8000-000000000001";

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
    expect(recordColumns(EDIT_CONFIG.groups)).toBe(
      ["id", ...EDIT_CONFIG.groups.editable].join(", "),
    );
    // Nothing beyond the map is ever selected, so the surface cannot show —
    // and a later widget cannot offer — a column the map does not carry.
    expect(recordColumns(EDIT_CONFIG.groups)).not.toContain("spotify_id");
    expect(recordColumns(EDIT_CONFIG.groups)).not.toContain("created_at");
  });
});

describe("readRecord", () => {
  it("reads one row by primary key and returns it", async () => {
    const row = { id: GROUP_ID, name: "BLACKPINK", company: "YG" };
    const db = stubClient({ groups: { data: row } });

    const result = await readRecord(EDIT_CONFIG.groups, GROUP_ID, db.asSupabaseClient());

    expect(result).toEqual({ kind: "ok", data: row });
    expect(db.tablesRead()).toEqual(["groups"]);
    const call = db.calls[0];
    expect(step(call, "select")?.args[0]).toBe(recordColumns(EDIT_CONFIG.groups));
    expect(step(call, "eq")?.args).toEqual(["id", GROUP_ID]);
    // Addressed by primary key: one row, so no row-set bound applies
    // (ARCHITECTURE §4.3).
    expect(step(call, "maybeSingle")).toBeDefined();
    expect(step(call, "limit")).toBeUndefined();
    expect(step(call, "range")).toBeUndefined();
  });

  it("reports no such row as ok/null, distinct from an absent table", async () => {
    const present = stubClient({ groups: { data: null } });
    expect(
      await readRecord(EDIT_CONFIG.groups, GROUP_ID, present.asSupabaseClient()),
    ).toEqual({ kind: "ok", data: null });

    const absent = stubClient({ groups: { error: tableNotInSchemaCache("groups") } });
    expect(
      await readRecord(EDIT_CONFIG.groups, GROUP_ID, absent.asSupabaseClient()),
    ).toEqual({ kind: "not_provisioned", missing: "groups" });
  });
});

describe("updateRecordField writes an allowlisted column", () => {
  it("issues one update on the right table, keyed by the primary key", async () => {
    const stored = { id: GROUP_ID, name: "BLACKPINK", company: "YG Entertainment" };
    const db = stubClient({ groups: { data: stored } });

    const result = await updateRecordField(
      allowed("groups", "company"),
      GROUP_ID,
      "YG Entertainment",
      db.asSupabaseClient(),
    );

    expect(result).toEqual({ kind: "ok", data: stored });
    expect(db.tablesRead()).toEqual(["groups"]);
    const call = db.calls[0];
    expect(step(call, "update")?.args[0]).toEqual({ company: "YG Entertainment" });
    expect(step(call, "eq")?.args).toEqual(["id", GROUP_ID]);
    // The row as stored comes back, so the surface shows what was kept.
    expect(step(call, "select")?.args[0]).toBe(recordColumns(EDIT_CONFIG.groups));
  });

  it("clears a field when the value is null", async () => {
    const db = stubClient({ idols: { data: { id: GROUP_ID, mbti: null } } });
    await updateRecordField(allowed("idols", "mbti"), GROUP_ID, null, db.asSupabaseClient());
    expect(step(db.calls[0], "update")?.args[0]).toEqual({ mbti: null });
  });

  it("writes a numeric column as a number", async () => {
    const db = stubClient({ groups: { data: { id: GROUP_ID, member_count: 4 } } });
    await updateRecordField(allowed("groups", "member_count"), GROUP_ID, 4, db.asSupabaseClient());
    expect(step(db.calls[0], "update")?.args[0]).toEqual({ member_count: 4 });
  });

  it("reports no matching row as ok/null — nothing was written", async () => {
    const db = stubClient({ groups: { data: null } });
    const result = await updateRecordField(
      allowed("groups", "bio"),
      GROUP_ID,
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
      groups: { data: { id: GROUP_ID } },
      idols: { data: { id: GROUP_ID } },
      events: { data: { event_id: GROUP_ID } },
      venues: { data: { venue_id: GROUP_ID } },
    });
    const config = EDIT_CONFIG[table] ?? EDIT_CONFIG.groups;
    const result = await updateRecordField(
      { config, field },
      GROUP_ID,
      "forged",
      db.asSupabaseClient(),
    );
    return { result, calls: db.calls };
  }

  it("refuses a column absent from the map, naming the field", async () => {
    const { result, calls } = await refuse("groups", "spotify_id");
    expect(result.kind).toBe("error");
    if (result.kind === "error") expect(result.message).toContain("spotify_id");
    expect(calls).toEqual([]);
  });

  it("refuses an id, key or timestamp column", async () => {
    for (const field of ["id", "created_at", "updated_at", "profile_image_id"]) {
      const { result, calls } = await refuse("groups", field);
      expect(result.kind, field).toBe("error");
      expect(calls, field).toEqual([]);
    }
  });

  it("refuses every column of a resolver-owned table", async () => {
    for (const [table, field] of [
      ["events", "title"],
      ["events", "venue_id"],
      ["venues", "name"],
    ] as const) {
      const { result, calls } = await refuse(table, field);
      expect(result.kind, table).toBe("error");
      if (result.kind === "error") expect(result.message).toContain(table);
      expect(calls, table).toEqual([]);
    }
  });

  it("refuses a forged config whose table the map does not carry", async () => {
    // The strongest form: a caller that hand-builds the config object instead
    // of going through `decideEdit`. The data layer consults the map again and
    // never reaches the database.
    const db = stubClient({ groups: { data: { id: GROUP_ID } } });
    for (const table of ["event_performers", "scraped_events", "profiles"]) {
      const result = await updateRecordField(
        { config: { table, pk: "id", regime: "pre_cutover", editable: ["name"] }, field: "name" },
        GROUP_ID,
        "forged",
        db.asSupabaseClient(),
      );
      expect(result.kind, table).toBe("error");
    }
    expect(db.calls).toEqual([]);
  });

  it("uses the map's own config, not a forged one that widens the allowlist", async () => {
    // A caller claiming `groups.spotify_id` is editable by handing in its own
    // `editable` list gets the map's answer, not its own.
    const db = stubClient({ groups: { data: { id: GROUP_ID } } });
    const result = await updateRecordField(
      {
        config: {
          table: "groups",
          pk: "id",
          regime: "pre_cutover",
          editable: ["spotify_id", "name"],
        },
        field: "spotify_id",
      },
      GROUP_ID,
      "forged",
      db.asSupabaseClient(),
    );
    expect(result.kind).toBe("error");
    expect(db.calls).toEqual([]);
  });

  it("keys the write by the map's primary key, not a forged one", async () => {
    const db = stubClient({ groups: { data: { id: GROUP_ID } } });
    await updateRecordField(
      {
        config: { table: "groups", pk: "spotify_id", regime: "pre_cutover", editable: ["name"] },
        field: "name",
      },
      GROUP_ID,
      "TWICE",
      db.asSupabaseClient(),
    );
    expect(step(db.calls[0], "eq")?.args).toEqual(["id", GROUP_ID]);
  });
});

describe("updateRecordField surfaces what the database said", () => {
  it("classifies an absent table as not provisioned, naming it", async () => {
    const db = stubClient({ groups: { error: tableNotInSchemaCache("groups") } });
    expect(
      await updateRecordField(allowed("groups", "bio"), GROUP_ID, "…", db.asSupabaseClient()),
    ).toEqual({ kind: "not_provisioned", missing: "groups" });
  });

  it("classifies an absent column as not provisioned, naming table and column", async () => {
    const db = stubClient({ groups: { error: undefinedColumnOfRelation("groups", "bio") } });
    expect(
      await updateRecordField(allowed("groups", "bio"), GROUP_ID, "…", db.asSupabaseClient()),
    ).toEqual({ kind: "not_provisioned", missing: "groups.bio" });
  });

  it("passes any other failure through in the database's own words", async () => {
    const denied = permissionDenied("groups");
    const db = stubClient({ groups: { error: denied } });
    expect(
      await updateRecordField(allowed("groups", "bio"), GROUP_ID, "…", db.asSupabaseClient()),
    ).toEqual({
      kind: "error",
      reading: "groups",
      message: expect.stringContaining(denied.message),
    });
  });

  it("never throws, even when the client itself fails", async () => {
    const exploding = {
      from() {
        throw new Error("no client");
      },
    } as never;
    const result = await updateRecordField(allowed("groups", "bio"), GROUP_ID, "…", exploding);
    expect(result.kind).toBe("error");
  });
});
