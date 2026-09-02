import { decideEdit, type TableEditConfig } from "@/lib/edit/config";
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
}

/**
 * The columns to draw, in a stable order: the primary key first (the record's
 * identity), then the map's editable columns in the order the map declares
 * them, then anything else the read returned.
 *
 * The third group is not dead code: it is what makes this surface render
 * whatever a table's read hands it, so a column arriving in the read shows up
 * here as a READ-ONLY line — never as an editable one, because the widget is
 * `decideEdit`'s answer and not "was it in the row".
 */
function orderedNames(
  config: TableEditConfig,
  record: Record<string, unknown>,
): string[] {
  const names: string[] = [config.pk];
  for (const column of config.editable) {
    if (!names.includes(column)) names.push(column);
  }
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
 */
export function recordFields(
  config: TableEditConfig,
  record: Record<string, unknown>,
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
    };
  });
}
