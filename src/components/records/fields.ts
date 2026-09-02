import {
  decideEdit,
  mappedColumns,
  type TableEditConfig,
} from "@/lib/edit/config";
import type { FieldProvenance } from "@/lib/records/provenance";
import { recordHref } from "@/lib/records/routes";
import { isEditableValue, scalarText } from "./values";

/**
 * One record, as lines the edit surface can draw
 * (campaign admin-window/TASK-0018; spec §8, ARCHITECTURE.md §9).
 *
 * **The widget follows the field, and the field's answer comes from the ONE
 * map.** Every line below asks `decideEdit()` — the same function the PATCH
 * route asks — so "editable at the surface" and "accepted by the route" are
 * one decision with one implementation. There is no list of editable columns
 * in this file, in the component that renders it, or anywhere else; adding a
 * column to the surface is an entry in `src/lib/edit/config.ts` and nothing
 * else.
 *
 * A pure function over plain data: it reads no database and imports nothing
 * that can (ARCHITECTURE.md §4 rule 1). The page reads and hands the record
 * here; this decides what each line is; the component draws it.
 */

/** What a line offers: the click-to-edit cell, or nothing but its value. */
export type FieldWidget = "cell" | "read_only";

/**
 * The linked entity behind a reference column — what the line shows INSTEAD of
 * the raw id (campaign admin-window/BUG-0034).
 *
 * The map says which column links and where (`reference` in
 * `lib/edit/config.ts`); the read says what the linked row is called
 * (`readRecordReference`); this is the two put together for one line. The
 * href is the app's one record URL, built by the one helper every surface
 * builds a record link with (`recordHref` in `lib/records/routes.ts`) —
 * never a second spelling of the template.
 */
export interface FieldReference {
  /** The record surface this line leads to: `/records/<domain>/<id>`. */
  readonly href: string;
  /** The stored id, verbatim — the machine's word, kept on screen. */
  readonly id: string;
  /**
   * The linked row's readable name, or `null` when the name read produced
   * none. A line with no name still LINKS, with the id as its own label: the
   * route out is what the operator came for.
   */
  readonly name: string | null;
}

/** One line of the edit surface: the field, its value, and its widget. */
export interface RecordField {
  /** The column, spelled as the database spells it. */
  readonly name: string;
  /** Its value as text — `null` is an absence and renders as the em dash. */
  readonly value: string | null;
  /** `cell` only when the map allows this column of this table. */
  readonly widget: FieldWidget;
  /**
   * Edit in a textarea rather than an input. Derived from the VALUE (it
   * already holds a line break), never from a per-field setting: a second
   * hand-written map of "which columns are long" is exactly what §8 forbids,
   * and this surface has one map.
   */
  readonly multiline: boolean;
  /** True for the primary key — the record's identity, never an edit target. */
  readonly isKey: boolean;
  /**
   * The current provenance of this field, or `null` when the log says nothing
   * about it — which the surface draws as the app's absence, never as a blank
   * and never as an invented source (admin-window/TASK-0029).
   */
  readonly provenance: FieldProvenance | null;
  /**
   * The record this line points at, when the map calls the column a reference
   * and the row carries an id for it; `null` on every other line
   * (admin-window/BUG-0034).
   */
  readonly reference: FieldReference | null;
}

/**
 * The columns to draw, in a stable order: **the map's columns first, in the
 * one order the map declares** (`mappedColumns` — the primary key, then the
 * editable columns, then the read-only `display` ones), then anything else the
 * read returned.
 *
 * There is ONE ordering rule and this is it: the same helper the read uses to
 * choose its columns chooses the order they are drawn in, so a `display`
 * column needs no rule of its own (admin-window/TASK-0029).
 *
 * The second group is not dead code: it is what makes this surface render
 * whatever a table's read hands it, so a column arriving in the read shows up
 * here as a READ-ONLY line — never as an editable one, because the widget is
 * `decideEdit`'s answer and not "was it in the row".
 */
function orderedNames(
  config: TableEditConfig,
  record: Record<string, unknown>,
): string[] {
  const names: string[] = [...mappedColumns(config)];
  for (const column of Object.keys(record)) {
    if (!names.includes(column)) names.push(column);
  }
  return names;
}

/**
 * The lines for one record.
 *
 * Every column the map declares is drawn even when the read returned no value
 * for it: an empty column renders as the em dash and is still editable, which
 * is how a missing value is ever filled in. Absence is a state, not a reason
 * to hide the field (LOOK_AND_FEEL, the four states).
 *
 * `provenance` is the current provenance per column (`readRecordProvenance` in
 * `lib/db/records.ts`), keyed by column name and defaulting to empty — a
 * pre-cutover table has none, and the page then says so once in words rather
 * than per field (Ben's ruling on admin-window/TASK-0025). A field the map
 * carries and the log says nothing about keeps its line and gets `null`, which
 * the surface draws as the app's absence.
 */
export function recordFields(
  config: TableEditConfig,
  record: Record<string, unknown>,
  provenance: ReadonlyMap<string, FieldProvenance> = new Map(),
  referenceName: string | null = null,
): RecordField[] {
  return orderedNames(config, record).map((name) => {
    const raw = record[name];
    const value = scalarText(raw);
    const decision = decideEdit(config.table, name);
    // A non-scalar could never be sent back through the write path, so it is
    // shown and not offered — whatever the map says about the column.
    const editable = decision.allowed && isEditableValue(raw);
    return {
      name,
      value: value ?? (raw === null || raw === undefined ? null : JSON.stringify(raw)),
      widget: editable ? "cell" : "read_only",
      multiline: editable && value !== null && value.includes("\n"),
      isKey: name === config.pk,
      provenance: provenance.get(name) ?? null,
      reference: referenceOf(config, name, value, referenceName),
    };
  });
}

/**
 * The link on a reference line, or `null` when this line is not one.
 *
 * Three things must hold, and each `null` is a different fact: the MAP calls
 * this column a reference, the row carries an id for it (an event with no
 * venue links nowhere and renders as the absence), and the id survives the
 * app's own href helper. The linked NAME is not one of them — a reference
 * whose name could not be read still links, labelled with its id, because the
 * uuid was never the complaint: having no way through was
 * (admin-window/BUG-0034).
 */
function referenceOf(
  config: TableEditConfig,
  name: string,
  value: string | null,
  referenceName: string | null,
): FieldReference | null {
  const reference = config.reference;
  if (reference === null || reference.field !== name) return null;
  if (value === null || value.length === 0) return null;

  const href = recordHref(reference.domain, value);
  if (href === null) return null;
  return { href, id: value, name: referenceName };
}
