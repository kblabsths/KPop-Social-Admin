/**
 * The ONE hand-written config that drives the edit surface — spec §8, the
 * acceptance doc's ground rule ("One hand-written config drives the edit
 * surface: the {table -> editable columns} map. Write path and widget
 * derive"), ARCHITECTURE.md §9 (campaign admin-window/TASK-0017).
 *
 * There is no second allowlist anywhere in this repo. The route, the data
 * layer and (later) the widget all read this map; adding a table or a column
 * to the edit surface is an entry here and nothing else.
 *
 * **A pure domain leaf** (ARCHITECTURE.md §4 rule 7): this module imports
 * NOTHING — not `lib/db/**`, not `@supabase/supabase-js`, not `process.env`.
 * `lib/db/records.ts` imports it, never the other way.
 *
 * Judgment recorded, because two rules meet here: §4 rule 4 says only
 * `lib/db/tables.ts` spells a table name, and §4 rule 7 says this leaf may not
 * import `lib/db/**` — importing `T` would write exactly the directory-level
 * cycle rule 7 forbids (`lib/db/records.ts` -> `lib/edit/config.ts` ->
 * `lib/db/tables.ts`). Rule 7 wins, being the later and file-specific ruling,
 * and rule 4's *reason* is preserved instead by a test: every name below is
 * asserted to exist in `T` (`tests/offline/edit/config.test.ts`), so a typo
 * here is still one grep and one red test away, and the name the query uses is
 * the name the not-provisioned card reports.
 *
 * Schema truth is the scraper repo's `supabase/migrations/`, never this file.
 */

/**
 * How a table is written — and therefore whether Admin may write it at all.
 * The regime belongs to the TABLE; it is never configured per column.
 */
export type Regime =
  /**
   * Not yet cut over to the resolver (`groups`, `idols`, until catalog
   * maintenance at ROADMAP queue item 9). Admin edits the row DIRECTLY within
   * its allowlist — legal and unprovenanced, as the ownership rules allow
   * (spec §8, AGENTS.md data-ownership).
   */
  | "pre_cutover"
  /**
   * Produced by the resolver (`events`, `venues`). **Read-only from Admin in
   * M1**: no write path to these tables exists — no PATCH branch, no helper,
   * no scaffold. Their override path is M2's, through `settle_review_item`,
   * and building toward it now is out of scope.
   */
  | "resolver_owned";

export interface TableEditConfig {
  /** The canonical table, spelled as the database spells it. */
  readonly table: string;
  /** Its primary-key column — `id` for groups/idols, `event_id`, `venue_id`. */
  readonly pk: string;
  /** Decides the write path. Never configured per column. */
  readonly regime: Regime;
  /**
   * The user-facing scalar columns that may be edited. **Never an id, a key
   * or a timestamp**, and never a link or a non-scalar: performers and venues
   * are `event_performers` / `venues` ROWS, not fields of `events`
   * (AGENTS.md). A `resolver_owned` table carries an empty list in M1.
   */
  readonly editable: readonly string[];
}

/**
 * The entries, as a list; `EDIT_CONFIG` is built from it so each table name is
 * spelled exactly once in this file.
 *
 * `groups` and `idols` are seeded from the columns the retired per-table PATCH
 * routes allowed — that is the vetted set, carried over unchanged (the routes
 * as of commit 5cf4199^, `src/app/api/admin/{groups,idols}/[id]/route.ts`).
 * Every one is a scalar column of that table in the scraper's schema snapshot
 * (`20260818000000_the_schema_arrives_as_one_snapshot.sql`); `social_links`
 * (jsonb), the `source_*` / `last_*` provenance columns, `group_id` and the
 * timestamps are all deliberately absent.
 */
const ENTRIES: readonly TableEditConfig[] = [
  {
    table: "groups",
    pk: "id",
    regime: "pre_cutover",
    editable: [
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
    regime: "pre_cutover",
    editable: [
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
  // Resolver-owned. Present in the map so the surface knows they exist and
  // renders them READ-ONLY — with an empty `editable` list, which is what
  // makes every column of theirs refuse through the same one code path.
  { table: "events", pk: "event_id", regime: "resolver_owned", editable: [] },
  { table: "venues", pk: "venue_id", regime: "resolver_owned", editable: [] },
];

/** The map itself: table name -> its edit config. */
export const EDIT_CONFIG: Readonly<Record<string, TableEditConfig>> =
  Object.freeze(
    Object.fromEntries(ENTRIES.map((entry) => [entry.table, entry])),
  );

/** Every table the edit surface knows about, in config order. */
export const EDITABLE_TABLES: readonly string[] = ENTRIES.map(
  (entry) => entry.table,
);

/** The config for a table, or `null` when the map does not carry it. */
export function editConfigFor(table: string): TableEditConfig | null {
  return Object.prototype.hasOwnProperty.call(EDIT_CONFIG, table)
    ? EDIT_CONFIG[table]
    : null;
}

/** Why an edit was refused. Each carries the words the caller is given. */
export type EditRefusal =
  | { readonly kind: "unknown_table"; readonly table: string; readonly message: string }
  | { readonly kind: "resolver_owned"; readonly table: string; readonly message: string }
  | {
      readonly kind: "field_not_editable";
      readonly table: string;
      readonly field: string;
      readonly message: string;
    };

/**
 * An edit the map allows. Only `decideEdit` produces one, so no caller can
 * reach the write path without having consulted the map.
 */
export interface AllowedEdit {
  readonly config: TableEditConfig;
  readonly field: string;
}

export type EditDecision =
  | { readonly allowed: true; readonly edit: AllowedEdit }
  | { readonly allowed: false; readonly refusal: EditRefusal };

/**
 * **The single decision**: may this table's this column be written from Admin?
 *
 * Pure, so the map's semantics are provable without a database, and shared, so
 * the route and the data layer cannot drift apart. A refusal names the field
 * (or the table) — hiding a widget is not a refusal (acceptance test 7).
 *
 * An id, key or timestamp column refuses for the ordinary reason: it is not in
 * `editable`. There is no special case for it, and none is needed.
 */
export function decideEdit(table: string, field: string): EditDecision {
  const config = editConfigFor(table);
  if (config === null) {
    return {
      allowed: false,
      refusal: {
        kind: "unknown_table",
        table,
        message: `${table} is not an editable table`,
      },
    };
  }
  if (config.regime !== "pre_cutover") {
    return {
      allowed: false,
      refusal: {
        kind: "resolver_owned",
        table,
        message:
          `${table} is resolver-owned and read-only from Admin; its values ` +
          `change through the resolution pipeline, not by a direct edit`,
      },
    };
  }
  if (!config.editable.includes(field)) {
    return {
      allowed: false,
      refusal: {
        kind: "field_not_editable",
        table,
        field,
        message: `${field} is not an editable field of ${table}`,
      },
    };
  }
  return { allowed: true, edit: { config, field } };
}

/** Shorthand for the decision above when only the yes/no is wanted. */
export function isEditable(table: string, field: string): boolean {
  return decideEdit(table, field).allowed;
}
