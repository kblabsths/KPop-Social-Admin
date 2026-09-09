import * as cheerio from "cheerio";
import { describe, expect, it, vi } from "vitest";
import { EDITABLE_TABLES, EDIT_CONFIG } from "@/lib/edit/config";
import { EM_DASH } from "@/lib/format";
import { codeOf, independentClient, renderPage } from "./parity";
import { resetSandbox } from "../walk/reset-sandbox.mjs";
import {
  SANDBOX_COLUMNS,
  SANDBOX_FIXTURE,
  SANDBOX_PK,
  SANDBOX_TABLE,
  SANDBOX_WALK_KEY,
} from "../walk/sandbox-fixture";

/**
 * The edit surface against staging (campaign admin-window/TASK-0018) —
 * acceptance test 7, acceptance test 13, M1 EC10.
 *
 * **It writes ONE table, and that table is not a catalog table.** Ben struck
 * the direct catalog edit on 2026-09-08 — *"admin edits catalog tables only
 * through the observation pipeline; do not re-implement direct edits"* — and
 * `groups`/`idols` left `EDIT_CONFIG` with it (ARCHITECTURE §9,
 * admin-window/TASK-0040). The case that used to write one field of one
 * catalog row and restore it in a `finally` is INVERTED at the head of this
 * file rather than deleted: it proves the refusal on both struck tables and
 * re-reads each row, every column, to show it is untouched.
 *
 * What still writes is the walk-sandbox block at the foot
 * (admin-window/TASK-0037): a staging-only fixture table in nobody's
 * ecosystem domain, and now the live suite's ONLY proof that a mapped column
 * can be written at all. Its undo is `resetSandbox` in a `finally`, which puts
 * every row of that table back rather than the one column that was written —
 * the same rule as `withSweep` (`tests/live/sweep.ts`, unchanged and still
 * graded by `tests/offline/live-guard.test.ts`), by a mechanism that suits a
 * table whose whole purpose is to be reset.
 *
 * Two paths to one answer (ARCHITECTURE.md §10): the request goes through the
 * app — the PATCH route, and the record page's own render — and every
 * verification is a query this file issues itself through
 * `independentClient()`, written without `lib/db`.
 *
 * **The gate is stubbed open on purpose.** That is the adversary's premise,
 * and it is the only interesting question here: a caller who IS an allowlisted
 * admin is still held to the map. That the route is unreachable WITHOUT a
 * session is proved over http (`tests/http/edit.http.test.ts`) and by the
 * middleware; re-proving it here would only hide the map's own refusal behind
 * a 401.
 *
 * It refuses to run at all until `STAGING_SUPABASE_URL` and
 * `STAGING_SUPABASE_SERVICE_ROLE_KEY` are set and `agenticflow/docs/SERVICES.md`
 * declares the target — `tests/live/setup.ts` throws first, non-zero. That
 * refusal is the correct state until staging is named, and is not a failure of
 * this file.
 *
 * There is no residue to sweep: this file issues no write of any kind, so no
 * row is created, deleted or changed by it — not even an `updated_at` trigger
 * fires on its account.
 */

vi.mock("@/lib/admin", () => ({
  requireAdmin: vi.fn(async () => ({
    user: { email: "live-suite@example.invalid" },
  })),
}));

const { PATCH } = await import("@/app/api/admin/records/[table]/[id]/route");
const { default: RecordPage } = await import("@/app/records/[table]/[id]/page");

/** Stamped into every value this test writes, so residue is identifiable. */
const PROBE = "admin-window/TASK-0018 probe";

type Row = Record<string, unknown>;

/** Drive the route exactly as the network would. */
async function patch(
  table: string,
  id: string,
  body: unknown,
): Promise<{ status: number; body: unknown }> {
  const request = new Request(
    `http://127.0.0.1/api/admin/records/${table}/${id}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  const response = await PATCH(request, { params: Promise.resolve({ table, id }) });
  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: response.status, body: parsed };
}

/**
 * A table and the column it is keyed by — all the two readers below need.
 *
 * `TableEditConfig` satisfies it structurally, and so does a hand-written pair
 * for a table the map no longer carries: since Ben's strike the struck tables
 * have no config, and they are still read here to prove they are untouched.
 */
interface Keyed {
  readonly table: string;
  readonly pk: string;
}

/** This test's own read of one whole row, written without `lib/db`. */
async function wholeRow(config: Keyed, id: string): Promise<Row> {
  const { data, error } = await independentClient()
    .from(config.table)
    .select("*")
    .eq(config.pk, id)
    .maybeSingle();
  if (error) {
    throw new Error(`reading ${config.table} ${id} failed: ${error.message}`);
  }
  if (!data) throw new Error(`${config.table} holds no row ${id}`);
  return data as Row;
}

/**
 * A row of `table` to work on, chosen deterministically by primary key.
 *
 * An empty table is a loud failure, never a skip: this test is the only proof
 * that a mapped column edits, and passing because there was nothing to edit
 * would be worse than no test.
 */
async function subject(config: Keyed): Promise<{ id: string; row: Row }> {
  const { data, error } = await independentClient()
    .from(config.table)
    .select("*")
    .order(config.pk, { ascending: true })
    .limit(1);
  if (error) {
    throw new Error(`reading ${config.table} failed: ${error.message}`);
  }
  const row = (data ?? [])[0] as Row | undefined;
  if (!row) {
    throw new Error(
      `staging's ${config.table} holds no row, so the edit this milestone ` +
        `must prove cannot be exercised against it.`,
    );
  }
  return { id: String(row[config.pk]), row };
}

/* ── the struck tables: no surface, no write, and the row untouched ───────── */

/**
 * The two tables Ben struck on 2026-09-08, with the primary key each is
 * addressed by and the columns their retired allowlists carried.
 *
 * The keys and column names are spelled HERE because `EDIT_CONFIG` no longer
 * carries them — which is the whole point — and the columns are the vetted set
 * as of `config.ts` at the commit before the strike, so the refusal is proved
 * over everything that used to be writable rather than over a sample.
 */
const STRUCK: ReadonlyArray<{
  readonly table: string;
  readonly pk: string;
  readonly columns: readonly string[];
}> = [
  {
    table: "groups",
    pk: "id",
    columns: [
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
  },
  {
    table: "idols",
    pk: "id",
    columns: [
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
  },
];

describe.each(STRUCK)("the struck table $table", ({ table, pk, columns }) => {
  it("has left the map, has no record page, and refuses every column its allowlist carried — with the row identical", async () => {
    // It is really gone from the one allowlist...
    expect(EDIT_CONFIG[table]).toBeUndefined();
    expect(EDITABLE_TABLES).not.toContain(table);

    // ...a REAL row of it is read first, whole, by this file's own client.
    const { id, row } = await subject({ table, pk });
    expect(Object.keys(row).length).toBeGreaterThan(0);

    // 1. The record URL has no surface. The page throws Next's routing 404
    //    (`notFound()`); in the served app `next.config.ts` rewrites the URL
    //    to a path no route matches first, which the http suite proves.
    await expect(
      RecordPage({ params: Promise.resolve({ table, id }) }),
    ).rejects.toThrow(/404/);

    // 2. Every column the retired allowlist carried is refused server-side —
    //    404, the unknown-table sentence, naming the table. A forged PATCH is
    //    the only way to ask at all now, which is the adversary's premise.
    for (const field of columns) {
      const { status, body } = await patch(table, id, {
        field,
        value: `${PROBE} forged`,
      });
      expect(status, `${table}.${field}: ${JSON.stringify(body)}`).toBe(404);
      expect(body, `${table}.${field}`).toEqual({
        error: `${table} is not an editable table`,
      });
    }

    // 3. The point of the criterion: not "the widget was hidden" but "the row
    //    is unchanged". Every column, compared against the read taken before
    //    the forgeries ran.
    expect(await wholeRow({ table, pk }, id)).toEqual(row);
  });
});

/* ── the map refuses, server-side, with the row unchanged ─────────────────── */

describe("a forged edit", () => {
  // The same claim about the one table that CAN be written — an unmapped
  // column refused 403 with the row unchanged — is "the walk sandbox > refuses
  // a column the map does not carry" at the foot of this file
  // (admin-window/TASK-0037). It is not repeated here.

  it("is refused on a resolver-owned table, which has no write path at all", async () => {
    for (const table of ["events", "venues"]) {
      const config = EDIT_CONFIG[table];
      expect(config.regime).toBe("resolver_owned");
      const { id, row } = await subject(config);

      // A REAL column of the table, and its identity column: neither is
      // writable from Admin, because no write path to this table exists.
      const real = Object.keys(row).find((name) => name !== config.pk);
      const fields = real ? [real, config.pk] : [config.pk];
      for (const field of fields) {
        const { status, body } = await patch(config.table, id, {
          field,
          value: `${PROBE} forged`,
        });
        expect(status, `${config.table}.${field}: ${JSON.stringify(body)}`).toBe(403);
      }

      expect(await wholeRow(config, id)).toEqual(row);
    }
  });
});

/* ── and the read-only surface offers no way to try ───────────────────────── */

/** The field names the rendered surface drew a line for. */
function drawnFields(markup: string): string[] {
  const $ = cheerio.load(markup);
  return $("tbody tr")
    .toArray()
    .map((tr) => $(tr).find("td").eq(0).text().trim());
}

/** The provenance cell of one field line, as text. */
function provenanceOf(markup: string, field: string): string | null {
  const $ = cheerio.load(markup);
  const row = $("tbody tr")
    .toArray()
    .find((tr) => $(tr).find("td").eq(0).text().trim() === field);
  return row ? $(row).find("td").eq(2).text().trim() : null;
}

describe("a resolver-owned record page", () => {
  it("renders from staging with no editable widget on it", async () => {
    for (const table of ["events", "venues"]) {
      const { id } = await subject(EDIT_CONFIG[table]);
      const markup = await renderPage(RecordPage, {
        params: Promise.resolve({ table, id }),
      });
      expect(markup, table).toContain(id);
      expect(markup, table).not.toMatch(/<(button|input|textarea|select)[\s>]/);
    }
  });

  /**
   * Campaign admin-window/TASK-0029. The map's `display` names are asserted
   * against the scraper's migration offline; THIS is the assertion that they
   * are the names STAGING actually has. A typo'd column makes PostgREST refuse
   * the whole select (`PGRST204`), which the page classifies as
   * not-provisioned and renders as a card with no field lines at all — so
   * "every displayed column drew a line, carrying the row's own value" is the
   * two-path check: the page's read against this test's independent read of
   * the same row.
   */
  it("displays every column the map names, with staging's own value", async () => {
    for (const table of ["events", "venues"]) {
      const config = EDIT_CONFIG[table];
      const { id, row } = await subject(config);
      const markup = await renderPage(RecordPage, {
        params: Promise.resolve({ table, id }),
      });

      const drawn = drawnFields(markup);
      expect(drawn, table).toContain(config.pk);
      for (const column of config.display) {
        // The column exists on staging's row at all — the map and the schema
        // have not drifted apart.
        expect(Object.keys(row), `${table}.${column}`).toContain(column);
        expect(drawn, `${table}.${column}`).toContain(column);

        // ...and the line carries what this test's own read found there.
        const value = row[column];
        if (typeof value === "string" && value.trim() !== "") {
          const $ = cheerio.load(markup);
          const line = $("tbody tr")
            .toArray()
            .find((tr) => $(tr).find("td").eq(0).text().trim() === column);
          expect($(line).find("td").eq(1).text(), `${table}.${column}`).toContain(
            value,
          );
        }
      }
    }
  });

  /**
   * The provenance leg, against the real log. Staging's rows may carry no
   * decisions yet, so this asserts the two things that must hold either way:
   * a field the log covers names its source on the line, and a field it does
   * not covers renders the app's absence — never a blank and never a source
   * that is not behind the value.
   */
  it("shows the source behind each field the decision log covers", async () => {
    const config = EDIT_CONFIG.events;
    const { id } = await subject(config);

    // This test's own read of the log, written without `lib/db`.
    const { data, error } = await independentClient()
      .from("field_provenance")
      .select("field, source_id, applied_at, admin_locked, provenance_id")
      .eq("entity_type", config.table)
      .eq("entity_id", id)
      .in("field", [...config.display])
      .order("applied_at", { ascending: true })
      .order("provenance_id", { ascending: true });
    if (error) throw new Error(`reading field_provenance failed: ${error.message}`);

    // The latest decision per field, by this test's own reckoning — the read
    // above is ordered ascending, so the last row wins.
    const latest = new Map<string, Record<string, unknown>>();
    for (const decision of (data ?? []) as Record<string, unknown>[]) {
      latest.set(String(decision.field), decision);
    }

    const names = new Map<string, string>();
    const sourceIds = [...latest.values()]
      .map((decision) => decision.source_id)
      .filter((sourceId): sourceId is string => typeof sourceId === "string");
    if (sourceIds.length > 0) {
      const named = await independentClient()
        .from("sources")
        .select("source_id, source")
        .in("source_id", [...new Set(sourceIds)]);
      for (const source of (named.data ?? []) as Record<string, unknown>[]) {
        names.set(String(source.source_id), String(source.source));
      }
    }

    const markup = await renderPage(RecordPage, {
      params: Promise.resolve({ table: config.table, id }),
    });

    for (const column of config.display) {
      const line = provenanceOf(markup, column);
      expect(line, column).not.toBeNull();
      const decision = latest.get(column);
      if (decision === undefined) {
        // No decision on this fact: the app's one absence marker, nothing else.
        expect(line, column).toBe(EM_DASH);
      } else if (decision.admin_locked === true) {
        expect(line, column).not.toBe(EM_DASH);
      } else if (typeof decision.source_id === "string") {
        expect(line, column).toContain(
          names.get(decision.source_id) ?? decision.source_id,
        );
      }
    }
  });
});

/* ── the walk sandbox: the write path's own table ─────────────────────────── */

/**
 * `public.walk_sandbox` against the real PostgREST (campaign
 * admin-window/TASK-0037).
 *
 * The offline suite proves the reset tool's DML shape against a stub client
 * and its refusals against the real binary, and says in its own docstring what
 * it cannot prove: "the present-case round trip against a real PostgREST",
 * because the table did not exist when it was written. Ben pasted the DDL onto
 * staging on 2026-09-08 and it does, so this is that missing half — and with
 * `groups`/`idols` gone from the direct-write side, it is the live suite's
 * ONLY proof that a mapped column can be written at all.
 *
 * It is also the automated form of the walk's own discipline (STACK.md §5
 * step 3): reset, edit through the surface, reset again, and read the rows
 * back to show the second reset restored the checked-in fixture exactly. The
 * `finally` is the reset, not `withSweep` — the sandbox's undo IS its reset,
 * which restores every row rather than the one column that was touched, so a
 * failure part-way through still leaves the next walk the state it expects.
 *
 * The probe value carries the campaign marker like every other write here, so
 * `residue.live.test.ts` — which now finds the table present and sweeps its
 * text columns instead of skipping it — would catch a reset that did not run.
 */
describe("the walk sandbox", () => {
  /** This block's own stamp, so residue here names the ticket that wrote it. */
  const SANDBOX_PROBE = "admin-window/TASK-0037 probe";

  /** The fixture's columns of a row PostgREST returned, and nothing else. */
  function projected(row: Row): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const column of SANDBOX_COLUMNS) out[column] = row[column];
    return out;
  }

  /** Every sandbox row, in key order, projected onto the fixture's columns. */
  async function sandboxRows(): Promise<Record<string, unknown>[]> {
    const { data, error } = await independentClient()
      .from(SANDBOX_TABLE)
      .select(SANDBOX_COLUMNS.join(","))
      .order(SANDBOX_PK, { ascending: true });
    if (error) {
      throw new Error(
        `reading ${SANDBOX_TABLE} failed (${codeOf(error)}): ${error.message}. ` +
          `If the code is an absence code the table is not on this project — ` +
          `it is created BY HAND from the SQL in ` +
          `agenticflow/tracker/for-human/TASK-0034.md, and without it this ` +
          `suite has no write surface at all.`,
      );
    }
    return (data ?? []).map((row) => projected(row as unknown as Row));
  }

  /** The checked-in fixture, in the same shape `sandboxRows` returns. */
  function fixtureRows(): Record<string, unknown>[] {
    return [...SANDBOX_FIXTURE]
      .sort((left, right) => left.sandbox_id.localeCompare(right.sandbox_id))
      .map((row) => projected(row as unknown as Row));
  }

  it("edits a mapped column through the surface, and a reset restores the fixture", async () => {
    const config = EDIT_CONFIG[SANDBOX_TABLE];
    const id = SANDBOX_WALK_KEY;
    // `note` is nullable text: the column the walk recipe's absence-then-fill
    // path uses, and one the residue sweep can actually scan.
    const field = "note";
    expect(config.editable).toContain(field);
    const probe = `${SANDBOX_PROBE} ${field} ${Date.now()}`;

    await resetSandbox(independentClient());
    expect(await sandboxRows()).toEqual(fixtureRows());

    try {
      const written = await patch(SANDBOX_TABLE, id, { field, value: probe });
      expect(written.status, JSON.stringify(written.body)).toBe(200);

      // Reload 1: the database, read by this test's own client.
      expect((await wholeRow(config, id))[field]).toBe(probe);

      // Reload 2: the surface an operator comes back to — and it is the OK
      // state with a control on that field, not the not-provisioned card and
      // not the not-an-id empty state.
      const markup = await renderPage(RecordPage, {
        params: Promise.resolve({ table: SANDBOX_TABLE, id }),
      });
      expect(markup).toContain(probe);
      expect(drawnFields(markup)).toContain(field);
      const $ = cheerio.load(markup);
      for (const editable of config.editable) {
        expect(
          $(`[aria-label="${editable} of ${SANDBOX_TABLE}"]`).length,
          `${editable} drew no edit control, so this page is not the OK state`,
        ).toBeGreaterThan(0);
      }
    } finally {
      await resetSandbox(independentClient());
    }

    // The point of the sandbox: two consecutive walks start from identical
    // rows, however thoroughly the first one edited them.
    expect(await sandboxRows()).toEqual(fixtureRows());
  });

  it("refuses a column the map does not carry, and changes nothing", async () => {
    const config = EDIT_CONFIG[SANDBOX_TABLE];
    const id = SANDBOX_WALK_KEY;
    const before = await wholeRow(config, id);

    for (const field of [SANDBOX_PK, "created_at"]) {
      const { status, body } = await patch(SANDBOX_TABLE, id, {
        field,
        value: `${SANDBOX_PROBE} forged`,
      });
      expect(status, `${SANDBOX_TABLE}.${field}: ${JSON.stringify(body)}`).toBe(403);
    }

    expect(await wholeRow(config, id)).toEqual(before);
  });
});
