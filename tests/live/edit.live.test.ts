import * as cheerio from "cheerio";
import { describe, expect, it, vi } from "vitest";
import type { SaveOutcome } from "@/components/EditableCell";
import { submitFieldEdit, type FetchLike } from "@/components/records/submit";
import {
  columnOfRegistryField,
  EDITABLE_TABLES,
  EDIT_CONFIG,
  mappedColumns,
  mappedRegistryFields,
} from "@/lib/edit/config";
import { FN } from "@/lib/db/tables";
import { EM_DASH } from "@/lib/format";
import {
  ABSENCE_CODES,
  assertState,
  codeOf,
  independentClient,
  renderPage,
  StateMismatchError,
  stateOf,
} from "./parity";
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
 * **What it writes, and the only thing it writes** (admin-window/TASK-0052).
 * Every write below sets a mapped column of `walk_sandbox` on the fixture row,
 * through the app. No other table is written on any path, and nothing is
 * inserted or deleted anywhere. Each write's undo is `resetSandbox` in a
 * `finally` — the sandbox's own undo, which puts every row back rather than
 * the one column that was touched — and `residue.live.test.ts` is the
 * independent check that it ran.
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

  it("is refused on a column of a resolver-owned table the map does not carry", async () => {
    for (const table of ["events", "venues"]) {
      const config = EDIT_CONFIG[table];
      expect(config.regime).toBe("resolver_owned");
      const { id, row } = await subject(config);

      // A REAL column of the table that the map leaves out, and its identity
      // column: 403 naming the field, with nothing written (FEAT-0011
      // criterion 5). `mappedColumns` is what the map DOES carry, so this
      // picks a column outside it from the row staging actually returned.
      const mapped = mappedColumns(config);
      const unmapped = Object.keys(row).find(
        (name) => !mapped.includes(name) && name !== config.pk,
      );
      const fields = unmapped ? [unmapped, config.pk] : [config.pk];
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

  /**
   * The override path against staging, where the function is ABSENT — the
   * graded normal case of the whole milestone (campaign
   * admin-window/TASK-0054, FEAT-0011 criterion 2; ARCHITECTURE §9.2).
   *
   * A MAPPED column of `events` and of `venues`, edited through the app's one
   * write route, with a real service-role client behind it. The answer must be
   * the honest one — not provisioned, naming what is missing — and the row
   * must be byte-identical afterwards, read back independently. Neither a fake
   * success nor a direct write, which is the pair this ticket exists to
   * prevent.
   *
   * It writes nothing on any path, so it needs no sweep: if it ever did write,
   * the row comparison below is what would say so.
   */
  it("answers a mapped column's override with the absence, and changes nothing", async () => {
    for (const table of ["events", "venues"]) {
      const config = EDIT_CONFIG[table];
      const field = config.editable[0];
      expect(field, `${table} has no editable column`).toBeTypeOf("string");
      const { id, row } = await subject(config);

      const { status, body } = await patch(config.table, id, {
        field,
        value: `${PROBE} override`,
      });
      const where = `${config.table}.${field}: ${JSON.stringify(body)}`;
      // 503, naming the object the seam called — never 200, never 500.
      expect(status, where).toBe(503);
      const answered = body as { error?: string; missing?: string; ok?: unknown };
      expect(answered.ok, where).toBeUndefined();
      expect(answered.missing, where).toBe(FN.settleReviewItem);
      expect(String(answered.error), where).toContain(FN.settleReviewItem);

      // The row staging holds, read again, column for column.
      expect(await wholeRow(config, id), where).toEqual(row);
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
  it("renders from staging with no editable widget on it, and names why", async () => {
    // The override path's own absence, at the surface: with nothing on staging
    // to record an override, the page degrades to the read-only surface M1
    // shipped — no control at all — and says so once, above the table
    // (FEAT-0011 criterion 2). The two halves are asserted together because
    // either alone is passable: a page with no controls and no reason is the
    // regression this ticket must not ship.
    for (const table of ["events", "venues"]) {
      const { id } = await subject(EDIT_CONFIG[table]);
      const markup = await renderPage(RecordPage, {
        params: Promise.resolve({ table, id }),
      });
      expect(markup, table).toContain(id);
      expect(markup, table).not.toMatch(/<(button|input|textarea|select)[\s>]/);
      const $ = cheerio.load(markup);
      expect($('[data-note="override-unavailable"]').length, table).toBe(1);
      expect($('[data-state="not_provisioned"]').length, table).toBeGreaterThan(0);
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
      for (const column of mappedColumns(config).filter((name) => name !== config.pk)) {
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
      .in("field", [...mappedRegistryFields(config)])
      .order("applied_at", { ascending: true })
      .order("provenance_id", { ascending: true });
    if (error) throw new Error(`reading field_provenance failed: ${error.message}`);

    // The latest decision per field, by this test's own reckoning — the read
    // above is ordered ascending, so the last row wins. Keyed by the COLUMN
    // the surface draws, because the log names a fact by its REGISTRY field
    // and `events.venue` -> `venue_id` is the one place the two differ
    // (admin-window/BUG-0090).
    const latest = new Map<string, Record<string, unknown>>();
    for (const decision of (data ?? []) as Record<string, unknown>[]) {
      latest.set(columnOfRegistryField(config, String(decision.field)), decision);
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

    for (const column of mappedColumns(config)) {
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

  /**
   * admin-window/BUG-0090, against the real log: the venue reference column
   * shows the source behind it.
   *
   * The test above walks whatever row `subject` picks and is honest either
   * way, which is exactly how the defect survived — an event with no venue
   * decision expects the dash, and the dash is what the bug produced. This one
   * SEEKS an event whose venue fact the resolver has applied, so the assertion
   * has something to be wrong about.
   *
   * It also measures the premise in place: `field_provenance` holds no row
   * spelling `venue_id` at all, so the filter this bug fixed could only ever
   * have returned nothing for that line.
   */
  it("names the source behind the venue reference, on an event that has one", async () => {
    const config = EDIT_CONFIG.events;
    const reference = config.reference;
    if (reference === null) throw new Error("events lost its reference column");

    const client = independentClient();

    // The premise: the log spells this fact with the REGISTRY field name, and
    // never with the column's.
    const byColumnName = await client
      .from("field_provenance")
      .select("provenance_id", { count: "exact", head: true })
      .eq("entity_type", config.table)
      .eq("field", reference.field);
    if (byColumnName.error) {
      throw new Error(`reading field_provenance failed: ${byColumnName.error.message}`);
    }
    expect(byColumnName.count, `field_provenance rows spelling ${reference.field}`)
      .toBe(0);

    // An event whose venue fact the resolver HAS applied.
    const recent = await client
      .from("field_provenance")
      .select("entity_id")
      .eq("entity_type", config.table)
      .eq("field", reference.registryField)
      .order("applied_at", { ascending: false })
      .limit(1);
    if (recent.error) {
      throw new Error(`reading field_provenance failed: ${recent.error.message}`);
    }
    const entityId = (recent.data ?? [])[0]?.entity_id as string | undefined;
    if (entityId === undefined) {
      throw new Error(
        `staging holds no applied ${config.table}.${reference.registryField} ` +
          `decision, so the fact this page must show a source for does not ` +
          `exist there.`,
      );
    }

    // That fact's CURRENT decision, by this test's own reckoning.
    const history = await client
      .from("field_provenance")
      .select("source_id, applied_at, admin_locked, provenance_id")
      .eq("entity_type", config.table)
      .eq("entity_id", entityId)
      .eq("field", reference.registryField)
      .order("applied_at", { ascending: true })
      .order("provenance_id", { ascending: true });
    if (history.error) {
      throw new Error(`reading field_provenance failed: ${history.error.message}`);
    }
    const rows = (history.data ?? []) as Record<string, unknown>[];
    const current = rows[rows.length - 1];
    expect(current, `the venue decision on ${entityId}`).toBeDefined();

    const markup = await renderPage(RecordPage, {
      params: Promise.resolve({ table: config.table, id: entityId }),
    });
    const line = provenanceOf(markup, reference.field);

    // The line exists, and it is NOT the app's absence marker: the page said
    // "no source behind this value" for a fact the database holds a decision
    // on, which is the defect in one assertion.
    expect(line, reference.field).not.toBeNull();
    expect(line, reference.field).not.toBe(EM_DASH);

    if (current.admin_locked !== true && typeof current.source_id === "string") {
      const named = await client
        .from("sources")
        .select("source")
        .eq("source_id", current.source_id)
        .maybeSingle();
      if (named.error) throw new Error(`reading sources failed: ${named.error.message}`);
      const sourceName = (named.data as Record<string, unknown> | null)?.source;
      expect(line, reference.field).toContain(
        typeof sourceName === "string" ? sourceName : current.source_id,
      );
    }
  });

  /**
   * QA, admin-window/BUG-0090 — the same claim over EVERY event the log holds
   * a venue decision for, not the newest one.
   *
   * The case above seeks ONE event and is satisfied by it. That is a sample of
   * size one over a translation the whole `events` surface depends on, and the
   * defect it replaced was invisible on a sample of size one for a year of
   * rows: every event rendered the dash and every event was "the" event. This
   * one drives the whole population the mapping can be wrong about, and checks
   * the OTHER half at the same time — that the re-key moved the reference's
   * line and nothing else's, per event, against each fact's own current
   * decision read independently of `lib/db`.
   */
  it("shows the venue source on EVERY event the log holds a venue decision for, and moves no scalar's line", async () => {
    const config = EDIT_CONFIG.events;
    const reference = config.reference;
    if (reference === null) throw new Error("events lost its reference column");
    const client = independentClient();

    // Every entity whose venue fact has been decided. Bounded, and the bound
    // is asserted: a truncated population would make "every" a lie.
    const CAP = 200;
    const decided = await client
      .from("field_provenance")
      .select("entity_id", { count: "exact" })
      .eq("entity_type", config.table)
      .eq("field", reference.registryField)
      .order("provenance_id", { ascending: true })
      .range(0, CAP - 1);
    if (decided.error) {
      throw new Error(`reading field_provenance failed: ${decided.error.message}`);
    }
    const rows = (decided.data ?? []) as Record<string, unknown>[];
    expect(decided.count ?? 0, "venue decisions on staging").toBeLessThanOrEqual(CAP);
    const ids = [...new Set(rows.map((row) => String(row.entity_id)))];
    expect(ids.length, "events carrying a venue decision").toBeGreaterThan(0);

    // The whole log for those events, over the fields the surface draws, read
    // by this file's own client and reduced by its own reckoning. Keyed by the
    // COLUMN, which is the translation under test applied independently.
    const log = await client
      .from("field_provenance")
      .select("entity_id, field, source_id, applied_at, admin_locked, provenance_id")
      .eq("entity_type", config.table)
      .in("entity_id", ids)
      .in("field", [...mappedRegistryFields(config)])
      .order("applied_at", { ascending: true })
      .order("provenance_id", { ascending: true });
    if (log.error) throw new Error(`reading field_provenance failed: ${log.error.message}`);
    const latest = new Map<string, Record<string, unknown>>();
    for (const row of (log.data ?? []) as Record<string, unknown>[]) {
      const column = columnOfRegistryField(config, String(row.field));
      latest.set(`${String(row.entity_id)}\u0000${column}`, row);
    }

    const names = new Map<string, string>();
    const sourceIds = [...latest.values()]
      .map((row) => row.source_id)
      .filter((id): id is string => typeof id === "string");
    if (sourceIds.length > 0) {
      const named = await client
        .from("sources")
        .select("source_id, source")
        .in("source_id", [...new Set(sourceIds)]);
      if (named.error) throw new Error(`reading sources failed: ${named.error.message}`);
      for (const source of (named.data ?? []) as Record<string, unknown>[]) {
        names.set(String(source.source_id), String(source.source));
      }
    }

    const dashed: string[] = [];
    for (const id of ids) {
      const markup = await renderPage(RecordPage, {
        params: Promise.resolve({ table: config.table, id }),
      });
      for (const column of mappedColumns(config)) {
        const line = provenanceOf(markup, column);
        expect(line, `${id}.${column}`).not.toBeNull();
        const decision = latest.get(`${id}\u0000${column}`);
        if (decision === undefined) {
          // No decision on this fact: the app's one absence marker, and the
          // re-key must not have invented a line here either.
          expect(line, `${id}.${column}`).toBe(EM_DASH);
          continue;
        }
        if (line === EM_DASH) {
          dashed.push(`${id}.${column}`);
          continue;
        }
        if (decision.admin_locked === true) {
          expect(line, `${id}.${column}`).toContain("admin-set");
        } else if (typeof decision.source_id === "string") {
          expect(line, `${id}.${column}`).toContain(
            names.get(decision.source_id) ?? decision.source_id,
          );
        }
      }
    }

    // The defect in one assertion, over the whole population: not one decided
    // fact on any of these events renders "no source behind this value".
    expect(dashed, "decided facts still rendering the absence marker").toEqual([]);
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

  /* ── is the table there at all? ─────────────────────────────────────────── */

  /**
   * The note a sandbox write SKIPS with, or `null` when this error says
   * nothing about whether the table exists (acceptance criterion 4 of
   * admin-window/TASK-0052).
   *
   * Absence is the DATABASE's own word for it and nothing else counts: the two
   * absence codes, read through the suite's one idiom (`codeOf` /
   * `ABSENCE_CODES` in `tests/live/parity.ts`, which `objectIsAbsent` is built
   * from). A permission denial, a malformed request, a broken connection — any
   * of those is a refusal about the RUN, and reading one as "the table is not
   * here" would turn a real failure into a green skip (STACK.md §5 step 3: a
   * refused tool is not an absent table).
   *
   * Pure, so both of its answers are provable without a database — which is
   * what keeps the skip branch from being code nobody has ever executed. The
   * fixtures it must flag and the fixtures it must not are in "the absence
   * branch" at the foot of this block.
   */
  function absenceNote(error: unknown): string | null {
    const code = codeOf(error);
    if (!ABSENCE_CODES.includes(code)) return null;
    return (
      `${SANDBOX_TABLE} is not on this staging project — the database answered ` +
      `${code} — so the edit surface has no write surface at all and this ` +
      `write cannot be exercised. The table is created BY HAND, once, from the ` +
      `SQL in agenticflow/tracker/for-human/TASK-0034.md; its absence is a ` +
      `state of the project, not a failure of this suite.`
    );
  }

  /** One read answers for every test in this block; `undefined` until it runs. */
  let absence: string | null | undefined;

  /**
   * The skip note for this run, or `null` when the sandbox is there.
   *
   * A read that failed for any OTHER reason throws, naming the database's code:
   * that is neither a pass nor a skip.
   */
  async function sandboxSkip(): Promise<string | null> {
    if (absence !== undefined) return absence;
    const { error } = await independentClient()
      .from(SANDBOX_TABLE)
      .select(SANDBOX_PK)
      .limit(1);
    if (error === null || error === undefined) {
      absence = null;
      return absence;
    }
    const note = absenceNote(error);
    if (note === null) {
      throw new Error(
        `reading ${SANDBOX_TABLE} failed (${codeOf(error)}): ` +
          `${String((error as { message?: unknown }).message ?? error)}. That is ` +
          `a refusal about this run, not an absent table, so it is a failure ` +
          `and not a skip.`,
      );
    }
    absence = note;
    return absence;
  }

  it("edits a mapped column through the surface, and a reset restores the fixture", async (ctx) => {
    // The write half skips, with the reason stated, when the table is not on
    // this project — see `sandboxSkip` above (admin-window/TASK-0052).
    const skip = await sandboxSkip();
    if (skip !== null) ctx.skip(skip);

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

  it("refuses a column the map does not carry, and changes nothing", async (ctx) => {
    const skip = await sandboxSkip();
    if (skip !== null) ctx.skip(skip);

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

  /* ── the five coercions, their absent cases, and the refusal ────────────── */

  /** This block's own stamp, so residue here names the ticket that wrote it. */
  const COERCION_PROBE = "admin-window/TASK-0052 probe";

  /**
   * One mapped column, the way the SURFACE writes it, and what must be true
   * afterwards.
   *
   * `sent` is a string on every line, and that is not an oversight: the edit
   * cell is a text input, so `submitFieldEdit` sends `string | null` for every
   * column whatever its declared type (`src/components/records/submit.ts`).
   * The coercion this table is about is therefore the real one an operator
   * provokes — typed text becoming an `integer`, a `boolean`, a `date` — and it
   * happens in the database, which is why only a live test can prove it.
   *
   * `stored` is what this file's own read must find, with its JavaScript TYPE:
   * a `4242` that comes back as `"4242"` is a column that never coerced.
   * `shown` is what the cell must draw, written out here rather than derived
   * with the app's own `scalarText`, so the surface and the expectation are two
   * paths to one value (ARCHITECTURE §10) — and a stored value reaches the
   * screen verbatim, never prettified (LESSONS 5).
   *
   * Only the two text columns can carry the campaign stamp; a date, an integer
   * and a boolean have nowhere to put one. They are restored by the same reset
   * as everything else, and `residue.live.test.ts` scans the text columns.
   */
  interface Coercion {
    readonly field: string;
    readonly sent: string;
    readonly stored: string | number | boolean;
    readonly shown: string;
  }

  /** The three `not null` columns: clearing one is refused by the database. */
  const REQUIRED: readonly Coercion[] = [
    {
      field: "label",
      sent: `${COERCION_PROBE} label`,
      stored: `${COERCION_PROBE} label`,
      shown: `${COERCION_PROBE} label`,
    },
    { field: "tally", sent: "4242", stored: 4242, shown: "4242" },
    { field: "is_flagged", sent: "true", stored: true, shown: "true" },
  ];

  /** The two nullable columns: the em-dash absence, and filling it in. */
  const NULLABLE: readonly Coercion[] = [
    {
      field: "note",
      sent: `${COERCION_PROBE} note`,
      stored: `${COERCION_PROBE} note`,
      shown: `${COERCION_PROBE} note`,
    },
    {
      field: "observed_on",
      sent: "2026-03-04",
      stored: "2026-03-04",
      shown: "2026-03-04",
    },
  ];

  const COERCIONS: readonly Coercion[] = [...REQUIRED, ...NULLABLE];

  /**
   * Postgres's SQLSTATE for a not-null violation. A machine identifier, which
   * the route passes through verbatim in the database's own words
   * (`errorMessage`, `src/lib/db/result.ts`) — so an operator meeting this
   * refusal can look it up, and this test can pin the refusal to its CAUSE
   * rather than to a status code three other failures also produce.
   */
  const NOT_NULL_VIOLATION = "23502";

  /**
   * Save one field the way the CELL does: `submitFieldEdit` — the module
   * `FieldEditor` calls — over a `fetch` that hands the request to the route
   * handler.
   *
   * This is what makes "the surface never claims the save landed" assertable
   * rather than inferred from a status: a `SaveOutcome` IS the claim the cell
   * renders (`{ ok: true }` becomes the green confirmation, `{ ok: false }` the
   * red line carrying the route's words unchanged).
   *
   * The value is `string | null` because that is all a text input can produce.
   */
  async function save(
    id: string,
    field: string,
    value: string | null,
  ): Promise<SaveOutcome> {
    const toTheRoute: FetchLike = (input, init) => {
      const url = new URL(input, "http://127.0.0.1");
      // `/api/admin/records/<table>/<id>` — the one mutating URL this app has
      // (`recordFieldApiPath`), unpacked the way Next unpacks the two dynamic
      // segments before it calls the handler.
      const [, , , , table, key] = url.pathname.split("/");
      return PATCH(new Request(url, init), {
        params: Promise.resolve({
          table: decodeURIComponent(table ?? ""),
          id: decodeURIComponent(key ?? ""),
        }),
      });
    };
    return submitFieldEdit(SANDBOX_TABLE, id, field, value, toTheRoute);
  }

  /**
   * The record page's one surface, addressed by NAME (ARCHITECTURE §10: never
   * by position). `src/app/records/[table]/[id]/page.tsx` renders every state
   * card it can draw inside this section, so the name addresses the whole read.
   */
  const RECORD_SURFACE = '[data-surface="fields"]';

  /**
   * The rendered record page, with its STATE KIND named before anything on it
   * is compared (ARCHITECTURE §10 rule 6, and the same rule's item 4: an
   * `error` is a FAIL). A not-provisioned card or a leg's error line would
   * otherwise read as "the value is not there".
   */
  async function sandboxMarkup(id: string): Promise<string> {
    const markup = await renderPage(RecordPage, {
      params: Promise.resolve({ table: SANDBOX_TABLE, id }),
    });
    assertState(markup, RECORD_SURFACE, "ok");
    return markup;
  }

  /** The text of one field's cell, read off the rendered page. */
  function cellText(markup: string, field: string): string {
    const cell = cheerio.load(markup)(
      `[aria-label="${field} of ${SANDBOX_TABLE}"]`,
    );
    if (cell.length !== 1) {
      throw new Error(
        `the rendered ${SANDBOX_TABLE} record draws ${cell.length} cell(s) ` +
          `for ${field}; a value is read off exactly one.`,
      );
    }
    // `&nbsp;` survives server rendering; a value read off the page must
    // not care, exactly as `parity.ts` does not.
    return cell.text().replace(/\u00a0/g, " ").trim();
  }

  /**
   * The state oracle every assertion below leans on, proved on TWO fixtures
   * (LESSONS 3): a guard that has only ever seen the input it passes is a
   * guard that passes vacuously.
   *
   * The id is a well-formed uuid the fixture does not seed, so the page's
   * value read answers and holds no such row — the EMPTY state, which
   * `sandboxMarkup` must refuse. `error` and `not_provisioned` are the other
   * two kinds, and neither can be reached here without breaking staging on
   * purpose.
   */
  it("grades this page's ok state apart from its emptiness", async (ctx) => {
    const skip = await sandboxSkip();
    if (skip !== null) ctx.skip(skip);

    // Seeded: the fixture's own row renders OK, and `sandboxMarkup` says so.
    await sandboxMarkup(SANDBOX_WALK_KEY);

    // Not seeded: the same surface, a different kind, and a refusal that names
    // both. No write of any sort is involved in either half.
    const missing = "00000000-0000-4000-8000-00000000f052";
    expect(SANDBOX_FIXTURE.map((row) => row.sandbox_id)).not.toContain(missing);
    const markup = await renderPage(RecordPage, {
      params: Promise.resolve({ table: SANDBOX_TABLE, id: missing }),
    });
    expect(stateOf(markup, RECORD_SURFACE)).toBe("empty");
    await expect(sandboxMarkup(missing)).rejects.toThrow(StateMismatchError);
  });

  for (const { field, sent, stored, shown } of COERCIONS) {
    it(`writes ${field}, and the database keeps it as ${field}'s own type`, async (ctx) => {
      const skip = await sandboxSkip();
      if (skip !== null) ctx.skip(skip);

      const config = EDIT_CONFIG[SANDBOX_TABLE];
      const id = SANDBOX_WALK_KEY;
      expect(config.editable).toContain(field);

      try {
        // The cell's own claim: it saved, and the value it now shows is the
        // one the DATABASE kept, not the text that was typed.
        expect(await save(id, field, sent), field).toEqual({
          ok: true,
          value: shown,
        });

        // Path two: this file's own read. The TYPE first — the coercion is the
        // point, and an integer column holding the string "4242" would satisfy
        // an equality check on its own.
        const kept = (await wholeRow(config, id))[field];
        expect(typeof kept, `${field} came back as ${typeof kept}`).toBe(
          typeof stored,
        );
        expect(kept, field).toEqual(stored);

        // ...and the surface an operator comes back to shows it verbatim.
        expect(cellText(await sandboxMarkup(id), field), field).toBe(shown);
      } finally {
        await resetSandbox(independentClient());
      }
    });
  }

  for (const { field, sent, stored, shown } of NULLABLE) {
    it(`clears ${field} to the app's own absence, then fills it in again`, async (ctx) => {
      const skip = await sandboxSkip();
      if (skip !== null) ctx.skip(skip);

      const config = EDIT_CONFIG[SANDBOX_TABLE];
      const id = SANDBOX_WALK_KEY;

      try {
        expect(await save(id, field, null), field).toEqual({
          ok: true,
          value: null,
        });
        expect((await wholeRow(config, id))[field], field).toBeNull();

        // The app's ONE absence marker and nothing else: no qualifier, because
        // nothing was measured (LESSONS 1).
        expect(cellText(await sandboxMarkup(id), field), field).toBe(EM_DASH);

        // ...and an emptied column is still editable, which is how it is ever
        // filled in again.
        expect(await save(id, field, sent), field).toEqual({
          ok: true,
          value: shown,
        });
        expect((await wholeRow(config, id))[field], field).toEqual(stored);
        expect(cellText(await sandboxMarkup(id), field), field).toBe(shown);
      } finally {
        await resetSandbox(independentClient());
      }
    });
  }

  for (const { field } of REQUIRED) {
    it(`reports the database's refusal when ${field} is cleared, and ${field} still stands`, async (ctx) => {
      const skip = await sandboxSkip();
      if (skip !== null) ctx.skip(skip);

      const config = EDIT_CONFIG[SANDBOX_TABLE];
      const id = SANDBOX_WALK_KEY;
      const before = await wholeRow(config, id);

      try {
        // Clearing a `not null` column is a walkable error path put there on
        // purpose (STACK.md §5). The refusal is the DATABASE's, and it is a
        // pass: what would be a failure is the surface claiming otherwise.
        const outcome = await save(id, field, null);
        expect(outcome.ok, `clearing ${field}: ${JSON.stringify(outcome)}`).toBe(
          false,
        );
        const said = outcome.ok ? "" : outcome.message;
        expect(said, field).toContain(NOT_NULL_VIOLATION);
        expect(said, field).toContain(field);

        // The point of the criterion: not "it said no" but "the value is
        // unchanged" — every column, against the read taken before the clear.
        expect(await wholeRow(config, id), field).toEqual(before);
        // ...and the surface still draws the value that stands, not an absence.
        expect(cellText(await sandboxMarkup(id), field), field).toBe(
          String(before[field]),
        );
      } finally {
        await resetSandbox(independentClient());
      }
    });
  }

  describe("the absence branch", () => {
    /**
     * The skip is not dead code (criterion 4): it is exercised here on a
     * STUBBED absence, both codes, and on four errors it must refuse to call
     * an absence. A guard that has only ever seen the input it flags passes
     * vacuously (LESSONS 3).
     */
    it("skips on the database's own absence code, and on nothing else", () => {
      for (const code of ABSENCE_CODES) {
        const note = absenceNote({
          code,
          message: `Could not find the table 'public.${SANDBOX_TABLE}'`,
        });
        expect(note, code).not.toBeNull();
        expect(note, code).toContain(SANDBOX_TABLE);
        expect(note, code).toContain(code);
      }

      // Refusals about the RUN. None of them says the table is missing, so
      // none of them may buy a green skip.
      const refusals: readonly unknown[] = [
        { code: "42501", message: "permission denied for table walk_sandbox" },
        { code: "22P02", message: "invalid input syntax for type uuid" },
        { message: "TypeError: fetch failed" },
        null,
      ];
      for (const refusal of refusals) {
        expect(absenceNote(refusal), JSON.stringify(refusal)).toBeNull();
      }
    });
  });
});
