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
   * The walk sandbox alone (`walk_sandbox`) — a staging-only fixture table in
   * nobody's ecosystem domain, which is why Ben's 2026-09-08 strike of the
   * direct catalog edit does not reach it (ARCHITECTURE §9.1 item 5). It is
   * the app's ONLY direct write, and the only writable surface at all until
   * `settle_review_item` is installed.
   */
  | "sandbox"
  /**
   * Produced by the resolver (`events`, `venues`). Their values change through
   * the resolution pipeline: an admin edit lands as an admin-tier observation
   * through the gate (ARCHITECTURE §9.2), applied through `apply_resolution`,
   * stamped `admin_locked` and logged as an item-less `override` verdict —
   * never as a direct write. That is the ONLY way a catalog value changes from
   * Admin, and `writePathFor` is what says so.
   */
  | "resolver_owned";

/** How a table's values are written, once the regime has decided. */
export type WritePath =
  /** A PATCH straight at the row, within `editable`. `sandbox` only. */
  | "direct"
  /** An admin-tier observation through the resolver gate (ARCHITECTURE §9.2). */
  | "override";

/**
 * The regime DECIDES the write path — the single arm of that question, so no
 * caller re-derives it from a table name.
 *
 * **Total over `Regime`, deliberately**: there is no "no path" arm to fall
 * into, because a table Admin may not write is not in the map at all. That is
 * Ben's ruling of 2026-09-08 as the architect ruled it into ARCHITECTURE §9
 * ("TWO REGIMES, and no map entry for a table Admin may not write") — the
 * struck direct catalog edit is not re-implementable by flipping a regime
 * name, and `tests/offline/edit/config.test.ts` pins the teeth where they now
 * live: the ONLY table whose write path is `direct` is `walk_sandbox`.
 */
export function writePathFor(regime: Regime): WritePath {
  return regime === "sandbox" ? "direct" : "override";
}

/**
 * A displayed column that POINTS AT another record rather than holding a value
 * an operator can read — `events.venue_id` is the only one in M1 (campaign
 * admin-window/BUG-0034).
 *
 * It says what a `display` column IS, never that it may be written:
 * `decideEdit` reads `regime` and `editable` and nothing else, so a reference
 * column is drawn with no control at all, exactly like every other displayed
 * column. What changes is the RENDERING — the linked entity's name with a
 * route to its own record — because a bare uuid shows the operator strictly
 * LESS than the venue name on the Browse row they clicked through to get here
 * (spec §8: a reference field shows its linked entity).
 *
 * **Where that name is READ from is deliberately not here.** It is a relation
 * name, and ARCHITECTURE.md §4 rule 4 — pinned by
 * `tests/offline/db/layering.test.ts` — leaves `lib/db/tables.ts` the only
 * file in `src/` that spells one. So the map says which column links and where
 * the link goes; the data layer says how the linked row is named
 * (`readRecordReference` in `lib/db/records.ts`).
 */
export interface ReferenceColumn {
  /** The `display` column holding the linked row's id. */
  readonly field: string;
  /**
   * The table whose record surface it points at, spelled as the map keys that
   * table: the link is `/records/<domain>/<id>`, the one record URL this app
   * has.
   */
  readonly domain: string;
  /**
   * The REGISTRY FIELD NAME the same fact is logged under — `venue` for the
   * `venue_id` column (admin-window/BUG-0090).
   *
   * The two names are the same string for every other column this app deals
   * in, which is exactly why a reference needs this one: the registry's field
   * names ARE the canonical columns' names, and `events.venue` -> `venue_id`
   * is the one exception, which is what makes the column a reference rather
   * than a cell (`lib/verdict/decision.ts`, ARCHITECTURE §9.2). The scraper's
   * resolver stamps the FIELD into `field_provenance.field` and writes the
   * COLUMN separately (`v_column := coalesce(p_decision ->> 'column',
   * v_field)`, scraper migration `20260901000005`), so a decision log filtered
   * by column name can never match the venue fact — the em dash
   * admin-window/BUG-0090 measured on staging, where 11 rows spell `venue`
   * and none spells `venue_id`.
   *
   * **The pairing lives HERE and nowhere else**: `reference` is already the
   * one place that says this column links rather than holds, so it is the one
   * place that says what the fact behind it is called. `registryFieldOf` and
   * `columnOfRegistryField` below are the only two readers, and no caller
   * re-derives either direction.
   *
   * A mirrored literal, like `REFERENCE_FIELDS` in `lib/verdict/decision.ts`
   * and for the same reason: `kind: reference` lives only in the scraper's
   * `registry/domains/events.yaml`, no read this app can make answers it, and
   * this leaf may import nothing. `tests/offline/edit/config.test.ts` pins the
   * two spellings to each other so the mirror cannot drift silently.
   */
  readonly registryField: string;
}

export interface TableEditConfig {
  /** The canonical table, spelled as the database spells it. */
  readonly table: string;
  /** Its primary-key column — `event_id`, `venue_id`, `sandbox_id`. */
  readonly pk: string;
  /** Decides the write path. Never configured per column. */
  readonly regime: Regime;
  /**
   * The user-facing scalar columns that may be edited. **Never an id, a key
   * or a timestamp**, and never a link or a non-scalar: performers and venues
   * are `event_performers` / `venues` ROWS, not fields of `events`
   * (AGENTS.md).
   *
   * It says WHICH columns, never HOW they are written: the regime decides that
   * (`writePathFor`), so this one list serves the direct path and the override
   * path alike. **Widening it later is one edit to one entry** (Ben,
   * 2026-09-08) — never a second list, never a per-column flag.
   */
  readonly editable: readonly string[];
  /**
   * The columns shown READ-ONLY — the other half of the ONE map, and never a
   * second allowlist (Ben's ruling, 2026-09-02, campaign
   * admin-window/TASK-0029): "a resolver-owned record page shows the columns
   * an operator came to see, read-only, with per-field provenance beside
   * each."
   *
   * **Listing a column here can never make it writable.** `decideEdit` below
   * reads `editable` and nothing else, so a `display` column refuses through
   * the same one code path every unmapped column refuses through, and the
   * surface draws it with no control at all. That is why a LINK column may
   * stand here (`events.venue_id`) though it may never stand in `editable`:
   * showing which venue a resolver-owned event points at is a read, and
   * AGENTS.md's rule bans WIDENING AN EDIT set to a link, not looking at one.
   *
   * **A column MOVES here or into `editable`, and never stands in both**
   * (Ben, 2026-09-08; DECISIONS 2026-09-08): a column in both would be
   * writable while this half of the map called it read-only. `mappedColumns`
   * orders pk -> editable -> display, so moving a column between the two lists
   * cannot reorder the lines a record page draws.
   *
   * The walk sandbox carries an empty list: its columns are already on screen
   * through `editable`, and a column named in both would be drawn once either
   * way.
   */
  readonly display: readonly string[];
  /**
   * The one `display` column that LINKS to another record, or `null` when the
   * table has none (admin-window/BUG-0034). A third question about the same
   * columns, not a third list of them: the column named here must already
   * stand in `display`, and naming it changes only how that line is drawn.
   */
  readonly reference: ReferenceColumn | null;
}

/**
 * The entries, as a list; `EDIT_CONFIG` is built from it so each table name is
 * spelled exactly once in this file.
 *
 * **`groups` and `idols` are not here, and that is the whole of Ben's strike**
 * (2026-09-08: *"admin edits catalog tables only through the observation
 * pipeline; do not re-implement direct edits"*, with no listing, no search and
 * no entry point for either table). Absence from this map is the mechanism:
 * `editConfigFor` answers null, `/records/groups/<uuid>` is a routed 404
 * through `next.config.ts`, and a PATCH is refused `unknown_table`. The
 * allowlist those two carried until then is gone with them; restoring an entry
 * would be re-implementing what was struck (ARCHITECTURE §9, DECISIONS
 * 2026-09-08). The TABLES themselves are untouched — the table registry
 * (`lib/db/tables.ts`) keeps both names and the schema description still
 * describes both tables. The residue sweep does NOT read them: it iterates the
 * MAPPED tables (`tests/live/residue.live.test.ts` over `EDITABLE_TABLES`), so
 * no column of either is swept any more (DECISIONS 2026-09-08, corrected the
 * same day).
 */
const ENTRIES: readonly TableEditConfig[] = [
  // Resolver-owned. The columns are Ben's ruling of 2026-09-02 (events: title,
  // description, poster, starts_at, venue; venues: name, city, country,
  // address), spelled as the DATABASE spells them — the map's names are the
  // names the query uses, and `tests/offline/edit/config.test.ts` asserts
  // every one against the scraper's canonical-storage migration. Two of Ben's
  // five are shorthand for the real column and are resolved the only way they
  // can be:
  //   poster -> poster_url  (the events column holding the poster art)
  //   venue  -> venue_id    (the only venue-bearing column of `events`; the
  //                          venue's own name/city/country/address are the
  //                          `venues` record page, one click on from here —
  //                          a claim this file made before the click existed,
  //                          which is what `reference` below now carries
  //                          (admin-window/BUG-0034))
  //
  // WHICH of them may be WRITTEN is Ben's second answer, of 2026-09-08
  // (`EDIT_ALLOWLIST_EVENTS_VENUES`, SPEC named gap 7; DECISIONS 2026-09-08):
  // the four scalars of each below. They MOVED out of `display` rather than
  // being copied into `editable`, so `events.display` is the reference alone
  // and `venues.display` is empty, and the record pages draw the same lines in
  // the same order they drew before. `event_type`, `status` and
  // `time_precision` stay out because all three are CHECK-constrained;
  // `ends_at`, `ticket_url` and every unlisted `venues` column stay out for
  // want of a ruling. Neither exclusion is a builder's judgment, and adding one
  // later is one string in one array here.
  //
  // Two of the eight carry a registry PATTERN the gate enforces on the way in —
  // `venues.country` is `^[A-Z]{2}$` and `events.poster_url` is `^https://`
  // (the scraper's own registration migrations) — and this file states no copy
  // of either. The gate is the authority: a value it refuses comes back as the
  // database's own words at the field, which is why there is no client-side
  // validator anywhere in this repo (admin-window/TASK-0044 QA, 2026-09-08).
  {
    table: "events",
    pk: "event_id",
    regime: "resolver_owned",
    editable: ["title", "description", "poster_url", "starts_at"],
    display: ["venue_id"],
    // The one link on this surface: `venue_id` is drawn as the venue itself —
    // its name, and a route to its own record — never as the bare uuid that
    // told the operator less than the Browse row they clicked
    // (admin-window/BUG-0034). It is a LINK, so it stays read-only: a
    // reference is F12's picker, never a cell (AGENTS.md).
    // `registryField` is the name the DECISION LOG spells the same fact with
    // (`events.venue`), which is not the column's own name and is the only
    // place in this map where the two differ (admin-window/BUG-0090).
    reference: { field: "venue_id", domain: "venues", registryField: "venue" },
  },
  {
    table: "venues",
    pk: "venue_id",
    regime: "resolver_owned",
    editable: ["name", "city", "country", "address"],
    display: [],
    reference: null,
  },
  // The walk sandbox: a STAGING-ONLY table an agent walking the edit surface
  // may safely write, created by hand on the staging project alone and absent
  // everywhere else — in production every read of it answers `PGRST205` and
  // the record page draws the not-provisioned card, permanently and by design
  // (ARCHITECTURE.md §9.1, campaign admin-window/TASK-0034, TASK-0035).
  //
  // It is in the map so a walker can reach
  // `/records/walk_sandbox/00000000-0000-4000-8000-000000000001`, the first of
  // the three rows the staging fixture seeds — `sandbox_id` is a uuid like
  // every other key in this map, because `isRecordId` (`lib/records/id.ts`)
  // gates every record page before any read: a key it refuses would draw the
  // not-an-id card at this table's own address, leaving both the absent and
  // the present rendering unreachable there (architect ruling, 2026-09-04,
  // §9.1 item 9, from a measurement on TASK-0035). The entry is in NOTHING else — no nav entry, no Browse row, no link — so an operator
  // never trips over it. Its five editable columns are one per coercion the
  // write path can be asked for (text, nullable text, integer, boolean, date),
  // and `note` / `observed_on` are nullable so the em-dash absence-then-fill
  // path is walkable. `created_at` is deliberately OUTSIDE the map: the read
  // selects `mappedColumns` explicitly, so a column the map does not name is
  // never read and never drawn.
  //
  // Its regime is `sandbox`, re-ruled 2026-09-08 (§9.1 item 5). It had shared
  // the retired regime name with `groups`/`idols` on the grounds that `Regime`
  // answers which WRITE PATH and this table's answer was identical to theirs;
  // Ben's strike removed those two from the map entirely, so this table's
  // answer is now shared with nothing, and the old name claimed a history a
  // staging fixture never had. The rename also pays off the inaccuracy that
  // section carried on purpose: the record page's regime note now says a value
  // written here goes to a staging fixture, which is what it does.
  {
    table: "walk_sandbox",
    pk: "sandbox_id",
    regime: "sandbox",
    editable: ["label", "note", "tally", "is_flagged", "observed_on"],
    display: [],
    reference: null,
  },
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

/**
 * Every column the map declares for a table, in ONE declared order: the
 * primary key, then `editable`, then `display`, de-duplicated.
 *
 * The single answer to "which columns does this table's record surface deal
 * in", so the READ (`recordColumns` in `lib/db/records.ts`) and the ORDER the
 * lines are drawn in (`orderedNames` in `components/records/fields.ts`) cannot
 * disagree: a column the surface draws is a column the read asked for, by
 * construction rather than by two lists kept in step by hand
 * (admin-window/TASK-0029).
 *
 * It answers nothing about WRITING — that is `decideEdit` alone.
 */
export function mappedColumns(config: TableEditConfig): readonly string[] {
  const columns: string[] = [];
  for (const column of [config.pk, ...config.editable, ...config.display]) {
    if (!columns.includes(column)) columns.push(column);
  }
  return columns;
}

/**
 * The name the DECISION LOG spells this column's fact with — the registry
 * field name (admin-window/BUG-0090).
 *
 * Identity for every column but a reference: `title` is `title`, and only
 * `events.venue_id` answers something else (`venue`). So a scalar is queried
 * by its own name, exactly as it always was, and the one column whose fact has
 * a different name gets that name from the entry that already pairs them.
 *
 * Total, and deliberately not a lookup table: a table with no `reference`, or
 * a column that is not the reference, is its own answer.
 */
export function registryFieldOf(
  config: TableEditConfig,
  column: string,
): string {
  const reference = config.reference;
  return reference !== null && reference.field === column
    ? reference.registryField
    : column;
}

/**
 * The INVERSE: the column a logged registry field is drawn as, so a decision
 * on `events.venue` lands on the `venue_id` line an operator reads.
 *
 * The surface keys provenance by column name (`recordFields` in
 * `components/records/fields.ts`), so a decision that arrives under the
 * registry name has to be re-keyed once, at the read boundary, or it lands on
 * a line that does not exist and the page renders the absence for a fact the
 * log holds.
 */
export function columnOfRegistryField(
  config: TableEditConfig,
  field: string,
): string {
  const reference = config.reference;
  return reference !== null && reference.registryField === field
    ? reference.field
    : field;
}

/**
 * `mappedColumns` as the DECISION LOG spells them — what a `field_provenance`
 * read filters on (admin-window/BUG-0090).
 *
 * Same columns, same order, one name translated: the surface's own question
 * ("which facts does this record page draw?") asked in the log's vocabulary
 * rather than the schema's. `mappedColumns` stays the answer for everything
 * that addresses real COLUMNS — the value select and the drawn order — and
 * this is the answer for the one read that addresses FACTS.
 */
export function mappedRegistryFields(
  config: TableEditConfig,
): readonly string[] {
  return mappedColumns(config).map((column) => registryFieldOf(config, column));
}

/** The config for a table, or `null` when the map does not carry it. */
export function editConfigFor(table: string): TableEditConfig | null {
  return Object.prototype.hasOwnProperty.call(EDIT_CONFIG, table)
    ? EDIT_CONFIG[table]
    : null;
}

/**
 * Why an edit was refused. Each carries the words the caller is given.
 *
 * TWO refusals, since the override path landed (FEAT-0011): the table is not
 * in the map, or the column is not in that table's `editable`. There is no
 * arm for "this table is read-only from Admin" any more — a resolver-owned
 * table is written through the override path, and a column of it the map does
 * not carry is refused for the ordinary reason, NAMING THE FIELD, exactly as
 * an unmapped column of the sandbox is (ARCHITECTURE §9; FEAT-0011 criterion
 * 5). One vocabulary for both regimes.
 */
export type EditRefusal =
  | { readonly kind: "unknown_table"; readonly table: string; readonly message: string }
  | {
      readonly kind: "field_not_editable";
      readonly table: string;
      readonly field: string;
      readonly message: string;
    }
  /**
   * A column asked for as a REFERENCE that the map does not call one
   * (campaign admin-window/TASK-0055). Its own arm rather than
   * `field_not_editable`'s, because it answers a different question about a
   * different submission: `venue_id` is not editable AND is a reference, and
   * `title` is editable AND is not one, so one refusal cannot serve both
   * without saying something false about half its subjects.
   */
  | {
      readonly kind: "field_not_reference";
      readonly table: string;
      readonly field: string;
      readonly message: string;
    };

/**
 * An edit the map allows. Only `decideEdit` produces one, so no caller can
 * reach a write path without having consulted the map.
 */
export interface AllowedEdit {
  readonly config: TableEditConfig;
  readonly field: string;
  /**
   * HOW this edit is written, carried on the decision itself — the regime's
   * answer through `writePathFor`, resolved once, here.
   *
   * The caller branches on THIS and never on the table name or a config key
   * (ARCHITECTURE §9, FEAT-0011 criterion 1): a route reading `config.table`
   * to pick a path would be the map's answer re-derived by hand, and the day
   * a table changed regime the two would disagree.
   */
  readonly path: WritePath;
}

export type EditDecision =
  | { readonly allowed: true; readonly edit: AllowedEdit }
  | { readonly allowed: false; readonly refusal: EditRefusal };

/**
 * **The single decision**: may this table's this column be written from Admin,
 * and by which path?
 *
 * Pure, so the map's semantics are provable without a database, and shared, so
 * the route and the data layer cannot drift apart. A refusal names the field
 * (or the table) — hiding a widget is not a refusal (acceptance test 7).
 *
 * An id, key or timestamp column refuses for the ordinary reason: it is not in
 * `editable`. There is no special case for it, and none is needed. So does a
 * `display` column: this function does not read `display` at all, which is
 * what makes the read-only half of the map read-only by construction rather
 * than by the surface remembering to hide a control (admin-window/TASK-0029).
 *
 * It answers nothing about whether the path is OPEN. A resolver-owned column
 * is allowed here and still refuses at the write when the settlement function
 * is absent, which is the graded normal case of this whole milestone: the
 * surface asks the seam, and the refusal names what is missing rather than
 * this map pretending to know (ARCHITECTURE §9.2).
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
  // The map allows it; the REGIME says how it is written. The two questions are
  // answered in one place so no caller re-derives the second one.
  return {
    allowed: true,
    edit: { config, field, path: writePathFor(config.regime) },
  };
}

/** Shorthand for the decision above when only the yes/no is wanted. */
export function isEditable(table: string, field: string): boolean {
  return decideEdit(table, field).allowed;
}

/* ── the reference decision: the picker's half of the same map ────────────── */

/**
 * A reference edit the map allows — what the entity picker submits
 * (campaign admin-window/TASK-0055, SPEC F12).
 *
 * Only `decideReference` produces one, so no caller can build a reference
 * decision without having consulted the map — the same property `AllowedEdit`
 * has for a cell.
 */
export interface AllowedReference {
  readonly config: TableEditConfig;
  /** The COLUMN the surface draws and the client names: `venue_id`. */
  readonly column: string;
  /** The REGISTRY field the decision carries: `venue`. */
  readonly field: string;
  /** How this edit is written — the regime's answer, resolved once. */
  readonly path: WritePath;
}

export type ReferenceDecision =
  | { readonly allowed: true; readonly reference: AllowedReference }
  | { readonly allowed: false; readonly refusal: EditRefusal };

/**
 * **The reference decision**: is this column of this table the one the map
 * calls a reference, and what does a decision about it name?
 *
 * The THIRD question this one map answers about the same columns — after "may
 * it be written as a cell" (`decideEdit`) and "does this line link somewhere"
 * (`reference`) — and it is asked by exactly two callers: the surface, which
 * draws a picker instead of a cell, and the write route, which builds the
 * override envelope. Neither spells `venue_id`, `venues` or `venue` for
 * itself.
 *
 * **It is not a widening of `editable`, and it cannot become one.** A
 * reference column stands in `display` (SPEC F8: the map holds user-facing
 * fields, never ids or keys), so `decideEdit` refuses it and goes on refusing
 * it — a `{field: "venue_id", value: "Olympic Hall"}` body is refused
 * `field_not_editable`, before any database call, exactly as it was before
 * this function existed. What this function admits is a submission of a
 * different SHAPE: an entity's id in the `ref` slot, which the apply resolves
 * into a row link rather than writing as text (ARCHITECTURE §9.2).
 *
 * Pure, like every other answer this file gives, and total over the map: a
 * table with no reference refuses every column, naming the field.
 */
export function decideReference(table: string, column: string): ReferenceDecision {
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
  const reference = config.reference;
  if (reference === null || reference.field !== column) {
    return {
      allowed: false,
      refusal: {
        kind: "field_not_reference",
        table,
        field: column,
        message: `${column} is not a reference field of ${table}`,
      },
    };
  }
  return {
    allowed: true,
    reference: {
      config,
      column: reference.field,
      // Through the ONE reader of that pairing (admin-window/BUG-0090), never
      // by reaching into `reference.registryField` here: the map already
      // answers "what is this column's fact called", and a second reader is
      // how two answers to one question start.
      field: registryFieldOf(config, reference.field),
      path: writePathFor(config.regime),
    },
  };
}
