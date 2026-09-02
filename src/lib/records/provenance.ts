/**
 * Per-field provenance for one record — campaign admin-window/TASK-0029.
 *
 * A PURE DOMAIN LEAF, the sibling of `lib/browse/rows.ts` (ARCHITECTURE.md §4
 * rule 7): it imports NOTHING, it declares the row shape both sides need, and
 * both sides use it — `lib/db/records.ts` reads rows of this shape and hands
 * them here to be joined; `components/records/**` renders what comes out. That
 * is the rule's own prescription for a type two layers share, and it is why
 * neither the data layer nor a component declares a second copy of it
 * (a hand-copied shape drifts — admin-window/BUG-0016).
 *
 * **The latest-per-fact rule is NOT here.** `field_provenance` is append-only,
 * so a fact carries as many rows as it has had decisions and only the last of
 * them is current — and that reduction has exactly one implementation in this
 * repo, `currentDecisions` in `lib/browse/rows.ts` (ARCHITECTURE.md §6 trap 7,
 * the ticket's own criterion). The caller reduces, then calls in here; the
 * function below says so in its own contract rather than re-deriving it.
 */

/**
 * One decision row of `field_provenance`, as this surface reads it.
 *
 * Structurally a superset of the row `currentDecisions` reduces over, so it
 * passes that generic helper with no import and no cast: it reads
 * `entity_id`, `field`, `applied_at` and `provenance_id`, and keeps whatever
 * else the row carries — here `admin_locked`.
 *
 * `source_id` is null on a verdict unset, the one row shape whose authority is
 * a human verdict rather than a winning observation (scraper migration
 * `20260901000005`).
 *
 * `admin_locked` is READ here and written nowhere: "a human pinned this field,
 * so resolution leaves it alone" (the column's own comment, migration
 * `20260818000000`), which spec §8 asks this surface to show. Admin never
 * writes it — the guard in `tests/offline/edit/config.test.ts` pins that, and
 * admin-window/BUG-0028 narrowed the guard to writes precisely so this read
 * could exist.
 */
export interface FieldDecisionRow {
  /** The primary key — uuid v7, so it is itself time-ordered. */
  provenance_id: string;
  entity_id: string;
  /** The canonical column this decision applied. */
  field: string;
  /** The source whose claim won the field; null on a verdict unset. */
  source_id: string | null;
  /** When the decision was applied — the log's own ordering. */
  applied_at: string;
  /** A human pinned this field; resolution leaves it alone. */
  admin_locked: boolean;
}

/** A source's id and the name an operator reads. */
export interface SourceNameRow {
  source_id: string;
  source: string;
}

/**
 * WHO the current value answers to. Three answers, because the log carries
 * three row shapes and they are not the same fact about the value:
 *  - `source` — a source's claim won the field and still holds it;
 *  - `admin`  — a human pinned the field (`admin_locked`), so the authority is
 *    the admin whatever source's value they pinned;
 *  - `unset`  — the current decision is a verdict unset: it names no winning
 *    observation, and the canonical column went back to null under a verdict.
 */
export type FieldAuthority = "source" | "admin" | "unset";

/**
 * The current provenance of ONE displayed field, ready to be drawn.
 *
 * A DISCRIMINATED UNION rather than a record with a nullable `source`, so the
 * surface cannot render a sourced line with no source in it: only the
 * `"source"` arm carries a name, and the compiler is what says so.
 *
 * On that arm, a source id with no row in `sources` keeps its ID VERBATIM
 * rather than disappearing: the decision behind the field is real whether or
 * not the name lookup answered, and `lib/browse/rows.ts` resolves a missing
 * name the same way.
 */
export type FieldProvenance = {
  /** The column, spelled as the database spells it. */
  readonly field: string;
  /** When the decision was applied — rendered as a relative age. */
  readonly appliedAt: string;
} & (
  | { readonly authority: "source"; readonly source: string }
  | { readonly authority: "admin" }
  | { readonly authority: "unset" }
);

/**
 * The provenance of each field, keyed by column name.
 *
 * **Hand this the CURRENT decisions** (`currentDecisions` in
 * `lib/browse/rows.ts`), never the raw log: this function does no reduction of
 * its own, so a superseded decision handed in here would be reported as
 * current. Every row is expected to belong to the one record being rendered —
 * the read filters `entity_id` to it — so the key is the field alone.
 *
 * A field the log says nothing about gets no entry, and the surface renders
 * the app's absence for it rather than inventing a source or a zero.
 */
export function fieldProvenanceOf(
  current: readonly FieldDecisionRow[],
  sources: readonly SourceNameRow[],
): Map<string, FieldProvenance> {
  const nameOf = new Map<string, string>();
  for (const row of sources) nameOf.set(row.source_id, row.source);

  const byField = new Map<string, FieldProvenance>();
  for (const row of current) {
    const at = { field: row.field, appliedAt: row.applied_at };
    // The lock is read FIRST: an admin-pinned fact still names the source
    // whose value was pinned, and the authority the operator needs to see is
    // the human who pinned it (spec §8, "admin stickiness is visible").
    if (row.admin_locked) {
      byField.set(row.field, { ...at, authority: "admin" });
    } else if (row.source_id === null) {
      byField.set(row.field, { ...at, authority: "unset" });
    } else {
      byField.set(row.field, {
        ...at,
        authority: "source",
        source: nameOf.get(row.source_id) ?? row.source_id,
      });
    }
  }
  return byField;
}

/**
 * The source ids the given decisions name, in first-seen order — what the
 * name lookup asks for.
 *
 * A decision naming no source (a verdict unset) contributes no id: there is
 * nothing to look a name up by. An admin-locked decision's source id is
 * dropped for the same reason its name is not shown — the line names the
 * admin, so the lookup asks for nothing on its account.
 */
export function namedSourceIds(
  decisions: readonly FieldDecisionRow[],
): string[] {
  const named = decisions
    .filter((row) => !row.admin_locked)
    .map((row) => row.source_id)
    .filter((id): id is string => id !== null);
  return [...new Set(named)];
}
