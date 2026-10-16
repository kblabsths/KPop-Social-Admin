import {
  decideEdit,
  mappedColumns,
  writePathFor,
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

/**
 * What a line offers: the click-to-edit cell, the entity picker, or nothing
 * but its value.
 *
 * **The widget follows the field's KIND** (spec §8, SPEC F12): a scalar column
 * the map allows edits as a `cell`, and the one column the map calls a
 * reference edits as a `picker` — never as a cell, because a reference names a
 * ROW and a cell can only send text (`entity-picker.tsx`,
 * ARCHITECTURE.md §9.2). There is no state in which a reference column is
 * offered as a cell: the two arms are decided from different questions of the
 * one map (`decideEdit` and `config.reference`), and `decideEdit` refuses a
 * reference column for the ordinary reason — it is not in `editable`.
 */
export type FieldWidget = "cell" | "picker" | "read_only";

/**
 * Is the table's write path OPEN — the second half of "may this line offer a
 * control", and a fact about the DATABASE rather than about the map
 * (campaign admin-window/TASK-0054, FEAT-0011 criterion 2).
 *
 * The map says which columns may be written; whether the path that writes them
 * exists is a different question, and for the override path the answer is
 * usually NO — the settlement function is not installed on staging or in
 * production, and absence is the graded normal case of this milestone
 * (ARCHITECTURE §9.2). A closed path draws no control at all: not a disabled
 * input, which could be re-enabled from a console, and never a button toward a
 * write path that does not exist. The page names the reason once, above the
 * table.
 *
 * The direct path is always open — its table is either there or the read
 * already failed — so `walk_sandbox` passes `true` and nothing about it
 * changes.
 */
export type WriteAccess = "open" | "closed";

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
 * directly-written table has none, and the page then says so once in words
 * rather
 * than per field (Ben's ruling on admin-window/TASK-0025). A field the map
 * carries and the log says nothing about keeps its line and gets `null`, which
 * the surface draws as the app's absence.
 *
 * `access` is the write path's own state, which this function does not and
 * cannot read: the page asks the seam and hands the answer down. Both halves
 * must hold for a control to be drawn — the map allows the column AND the path
 * that writes it exists.
 */
export function recordFields(
  config: TableEditConfig,
  record: Record<string, unknown>,
  provenance: ReadonlyMap<string, FieldProvenance> = new Map(),
  referenceName: string | null = null,
  access: WriteAccess = "closed",
): RecordField[] {
  return orderedNames(config, record).map((name) => {
    const raw = record[name];
    const value = scalarText(raw);
    const decision = decideEdit(config.table, name);
    // A non-scalar could never be sent back through the write path, so it is
    // shown and not offered — whatever the map says about the column. A closed
    // write path draws none either: the default is `closed` on purpose, so a
    // caller that says nothing gets the read-only surface rather than a
    // control over a path it never established.
    const editable =
      decision.allowed && isEditableValue(raw) && access === "open";
    return {
      name,
      value: value ?? (raw === null || raw === undefined ? null : JSON.stringify(raw)),
      widget: editable ? "cell" : pickable(config, name, access) ? "picker" : "read_only",
      multiline: editable && value !== null && value.includes("\n"),
      isKey: name === config.pk,
      provenance: provenance.get(name) ?? null,
      reference: referenceOf(config, name, value, referenceName),
    };
  });
}

/**
 * Does this line edit through the PICKER — campaign admin-window/TASK-0055.
 *
 * Three things must hold, and none of them is the row's value: the MAP calls
 * this column a reference, that reference's edit is written through the
 * override path, and the path is OPEN. The value is deliberately not asked
 * about — an event with no venue is exactly the record an operator most needs
 * to be able to point at one, and a control that appears only once a value
 * exists can never set the first one.
 *
 * The path is checked rather than assumed: a reference on a directly-written
 * table would have no way to carry a confirmed match (a `ref` travels in a
 * verdict decision and nowhere else), so it draws no picker instead of a
 * control over a write this app cannot make. No such entry is in the map
 * today, and the check is what keeps that from mattering.
 *
 * A closed path draws NOTHING here, exactly as it does for a cell: no picker,
 * no disabled button, no control toward a write path that is not installed.
 */
function pickable(
  config: TableEditConfig,
  name: string,
  access: WriteAccess,
): boolean {
  return (
    config.reference !== null &&
    config.reference.field === name &&
    writePathFor(config.regime) === "override" &&
    access === "open"
  );
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
