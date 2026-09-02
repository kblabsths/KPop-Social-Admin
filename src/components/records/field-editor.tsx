"use client";

import { EditableCell } from "@/components/EditableCell";
import { submitFieldEdit } from "./submit";

/**
 * The click-to-edit cell, wired to the record write route
 * (campaign admin-window/TASK-0018).
 *
 * `EditableCell` knows nothing about routes or tables (TASK-0004) — this is
 * the one place that knowledge is added, and it is the whole of it. The cell
 * gets a callback and gives back an outcome; the failure it renders is the
 * route's own refusal, unchanged.
 *
 * It is rendered ONLY for a field the map allows (`fields.ts` decides that
 * from `decideEdit`), so there is no disabled variant of this component and
 * none is added: a read-only field renders no widget at all rather than an
 * input that could be re-enabled from the console (spec §8).
 */
export function FieldEditor({
  table,
  id,
  field,
  value,
  multiline = false,
}: {
  table: string;
  id: string;
  field: string;
  value: string | null;
  multiline?: boolean;
}) {
  return (
    <EditableCell
      value={value}
      multiline={multiline}
      label={`${field} of ${table}`}
      onSave={(next) => submitFieldEdit(table, id, field, next, fetch)}
    />
  );
}
