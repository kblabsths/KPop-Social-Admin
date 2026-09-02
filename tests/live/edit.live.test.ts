import { describe, expect, it, vi } from "vitest";
import { EDIT_CONFIG, type TableEditConfig } from "@/lib/edit/config";
import { independentClient, renderPage } from "./parity";
import { withSweep } from "./sweep";

/**
 * The edit surface against staging (campaign admin-window/TASK-0018) —
 * acceptance test 7's pre-cutover half, acceptance test 13, M1 EC10.
 *
 * **This file is the milestone's only writer.** Every write it makes is
 * recorded before it happens and undone in a `finally` by `withSweep`, so a
 * failing assertion — the case that actually leaves residue — still restores
 * the row. Each edit is then read back a THIRD time, after the sweep, to prove
 * the restore landed rather than merely being attempted.
 *
 * Two paths to one answer (ARCHITECTURE.md §10): the write goes through the
 * app — the PATCH route, then the record page's own read for the reload — and
 * every verification is a query this file issues itself through
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
 * One residue this cannot sweep and does not pretend to: a table with an
 * `updated_at` trigger keeps the touched stamp. No ROW is created, deleted or
 * left changed in any column this test wrote.
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

/** This test's own read of one whole row, written without `lib/db`. */
async function wholeRow(config: TableEditConfig, id: string): Promise<Row> {
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
async function subject(config: TableEditConfig): Promise<{ id: string; row: Row }> {
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

/** The first mapped column the row actually carries. */
function mappedColumn(config: TableEditConfig, row: Row): string {
  const column = config.editable.find((name) => name in row);
  if (!column) {
    throw new Error(
      `no column of ${config.table}'s allowlist exists on staging's row — ` +
        `the map and the schema have drifted apart.`,
    );
  }
  return column;
}

/* ── a mapped column edits, and the value survives a reload ───────────────── */

describe.each(["groups", "idols"])("a %s record", (table) => {
  it("edits a mapped column, persists it, and leaves nothing behind", async () => {
    const config = EDIT_CONFIG[table];
    const { id, row } = await subject(config);
    const field = mappedColumn(config, row);
    const before = row[field] ?? null;
    const probe = `${PROBE} ${table} ${field} ${Date.now()}`;

    await withSweep(independentClient(), async (sweep) => {
      // Recorded BEFORE the write, so the undo exists even if the write half
      // of this body throws.
      await sweep.restore(config.table, { [config.pk]: id }, [field]);
      expect(sweep.pending).toBe(1);

      const written = await patch(table, id, { field, value: probe });
      expect(written.status, JSON.stringify(written.body)).toBe(200);

      // Reload 1: the database itself, read by this test's own client.
      expect((await wholeRow(config, id))[field]).toBe(probe);

      // Reload 2: the surface an operator would come back to.
      const markup = await renderPage(RecordPage, {
        params: Promise.resolve({ table, id }),
      });
      expect(markup).toContain(probe);
    });

    // The sweep ran: the catalog holds what it held before this test.
    expect((await wholeRow(config, id))[field]).toBe(before);
  });
});

/* ── the map refuses, server-side, with the row unchanged ─────────────────── */

describe("a forged edit", () => {
  it("is refused on a pre-cutover table and changes nothing", async () => {
    const config = EDIT_CONFIG.groups;
    const { id } = await subject(config);
    const before = await wholeRow(config, id);

    const forgeries: ReadonlyArray<readonly [string, string, unknown]> = [
      ["a column the map does not carry", "spotify_id", `${PROBE} forged`],
      ["the primary key itself", config.pk, "00000000-0000-4000-8000-000000000000"],
      ["a provenance column", "source_url", `${PROBE} forged`],
      ["a timestamp", "updated_at", "2000-01-01T00:00:00Z"],
    ];
    for (const [why, field, value] of forgeries) {
      const { status, body } = await patch(config.table, id, { field, value });
      expect(status, `${why}: ${JSON.stringify(body)}`).toBe(403);
    }

    // The point of the criterion: not "the widget was hidden" but "the row is
    // unchanged". Every column, compared.
    expect(await wholeRow(config, id)).toEqual(before);
  });

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
});
