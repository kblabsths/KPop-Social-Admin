import { DataTable, type Column } from "@/components/ui";
import { relativeAge } from "@/lib/format";
import type { FieldProvenance } from "@/lib/records/provenance";
import { FieldEditor } from "./field-editor";
import type { RecordField } from "./fields";

/**
 * One record, one line per field: the field, its value, its provenance
 * (campaign admin-window/TASK-0018, TASK-0029; LOOK_AND_FEEL "Key screens —
 * Edit surface": "the field, its value, its provenance, and whether it is
 * admin-locked, on one line — editing must never hide where the value came
 * from").
 *
 * A pure sync component over plain props: the page reads and shapes, this
 * draws. It contains no allowlist and makes no decision about what may be
 * edited — `field.widget` is `decideEdit`'s answer, carried here by
 * `fields.ts` — and none about which decision is current, which is
 * `currentDecisions`' answer, carried here by `lib/records/provenance.ts`.
 *
 * **The provenance column, per table.** `field_provenance` carries rows for
 * RESOLVER-OWNED entities. `events` and `venues` therefore show a real line
 * per displayed field — the authority behind the value and how long ago it was
 * applied. `groups` and `idols` are pre-cutover and unprovenanced by
 * construction: no row exists for them, so every cell in this column is an
 * absence and renders as the em dash the whole app uses for "no value", with
 * the page saying ONCE, in words, that no provenance is recorded for such a
 * table (Ben's ruling on admin-window/TASK-0025 — the reason stands with the
 * record, not repeated on every line).
 */

/**
 * One provenance line: who the value answers to, and how long ago it was
 * applied.
 *
 * "ticketmaster, applied 3d ago" — the authority in MONO, because a source
 * name is the machine's word and must be readable verbatim, the rest in the
 * app's voice. The age is relative with the absolute instant on hover
 * (LOOK_AND_FEEL, Voice bar 6), from the app's one age helper, so this line
 * climbs the same unit ladder as every other age on screen.
 *
 * A pinned fact reads "admin-set" rather than naming a source: the authority
 * an operator has to see is the human who pinned it (spec §8, "admin
 * stickiness is visible"). A fact whose current decision is a verdict unset
 * names no winning observation at all, and says so.
 */
function ProvenanceLine({ fact }: { fact: FieldProvenance }) {
  const age = relativeAge(fact.appliedAt);
  const authority =
    fact.authority === "admin"
      ? "admin-set"
      : fact.authority === "unset"
        ? "verdict unset"
        : fact.source;
  return (
    <span className="type-body text-ink-secondary">
      <span className="type-data text-ink">{authority}</span>, applied{" "}
      <span title={age.title || undefined}>{age.text}</span>
    </span>
  );
}

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
      // `null` when the log says nothing about this field. `DataTable` draws
      // the absence; this cell never decides how a null looks.
      cell: (field) =>
        field.provenance === null ? null : (
          <ProvenanceLine fact={field.provenance} />
        ),
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
