import { DataTable, type Column } from "@/components/ui";
import { FieldEditor } from "./field-editor";
import type { RecordField } from "./fields";

/**
 * One record, one line per field: the field, its value, its provenance
 * (campaign admin-window/TASK-0018; LOOK_AND_FEEL "Key screens — Edit
 * surface": "the field, its value, its provenance, and whether it is
 * admin-locked, on one line — editing must never hide where the value came
 * from").
 *
 * A pure sync component over plain props: the page reads and shapes, this
 * draws. It contains no allowlist and makes no decision about what may be
 * edited — `field.widget` is `decideEdit`'s answer, carried here by
 * `fields.ts`.
 *
 * **The provenance column in M1.** Per-field provenance lives in
 * `field_provenance`, which carries rows for RESOLVER-OWNED entities. The two
 * tables that edit here — `groups` and `idols` — are pre-cutover and
 * unprovenanced by construction: no `field_provenance` row exists for them, so
 * every cell in this column is an absence and renders as the em dash the whole
 * app uses for "no value". Nothing is invented into the slot, and the page
 * says in words that no provenance is recorded for such a table
 * (admin-window/TASK-0025 is the open question of what, if anything, should
 * eventually stand there).
 */
export function RecordFields({
  table,
  id,
  fields,
}: {
  table: string;
  /** The record's primary-key value — the write route's path segment. */
  id: string;
  fields: readonly RecordField[];
}) {
  const columns: Column<RecordField>[] = [
    {
      key: "field",
      label: "Field",
      cell: (field) => field.name,
    },
    {
      key: "value",
      label: "Value",
      cell: (field) =>
        field.widget === "cell" ? (
          <FieldEditor
            table={table}
            id={id}
            field={field.name}
            value={field.value}
            multiline={field.multiline}
          />
        ) : (
          // No widget at all — not a disabled input, which could be re-enabled
          // from the console and would read as "editable, later" (spec §8).
          field.value
        ),
    },
    {
      key: "provenance",
      label: "Provenance",
      // Absent, always, in M1 — see the note above. `DataTable` draws the
      // absence; this cell never decides how a null looks.
      cell: () => null,
    },
  ];

  return (
    <DataTable<RecordField>
      columns={columns}
      rows={[...fields]}
      rowKey={(field) => field.name}
      label={`${table} fields`}
    />
  );
}
