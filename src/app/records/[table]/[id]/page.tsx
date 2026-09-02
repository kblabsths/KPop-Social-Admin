import { notFound } from "next/navigation";
import { recordFields } from "@/components/records/fields";
import { RecordFields } from "@/components/records/record-fields";
import { Empty, ErrorLine, NotProvisioned, Page, Section } from "@/components/ui";
import { readRecord } from "@/lib/db/records";
import { editConfigFor, type TableEditConfig } from "@/lib/edit/config";

/**
 * The edit surface for one canonical record — campaign admin-window/TASK-0018.
 * Spec §8, ARCHITECTURE.md §9, acceptance test 7's pre-cutover half.
 *
 * One page for every table in `EDIT_CONFIG`, reached from Browse
 * (`/records/events/<id>`). The MAP decides everything below:
 *
 *  - a table the map does not carry has no record surface at all — `notFound()`,
 *    which is the page's twin of the route's 404 for the same request;
 *  - `groups` and `idols` are pre-cutover, so a column their allowlist carries
 *    edits directly, as a cell — the `EditableCell` primitive (TASK-0004),
 *    reached through `src/components/records/field-editor.tsx`. That wrapper
 *    is what holds the route knowledge `EditableCell` deliberately lacks, and
 *    it lives under `src/components/` because components do (ARCHITECTURE.md
 *    §4 rule 6) and because a server component cannot hand a callback to a
 *    client one; the page renders no input of its own and never will;
 *  - `events` and `venues` are resolver-owned and render READ-ONLY: no widget,
 *    no disabled input, no button toward a write path that does not exist.
 *
 * The surface is one half of the refusal and never the whole of it: a column
 * absent from the map draws no widget HERE and is refused server-side by the
 * route, with the row unchanged. Hiding a widget is not a refusal.
 *
 * This page function is the only async component on the route
 * (ARCHITECTURE.md §5); `RecordFields` and everything under it are pure sync
 * components over plain props, which is what lets the offline suite render
 * this with `renderToStaticMarkup(await RecordPage(props))` and no database.
 *
 * KNOWN GAP, stated rather than guessed (admin-window/TASK-0018 handoff): the
 * read this page calls asks for the primary key plus the map's EDITABLE
 * columns (`recordColumns` in `src/lib/db/records.ts`), and a resolver-owned
 * table's editable list is empty by design — so an `events` or `venues` record
 * arrives here carrying its id and nothing else, and there are no field lines
 * for a provenance line to sit beside. Which columns such a table DISPLAYS is
 * a decision for the one map, not for this page; inventing a display list here
 * would be the second allowlist §9 forbids. The page renders whatever the read
 * returns, so the day the map carries display columns this surface shows them
 * with no change.
 */

/** What creates the catalog objects this page reads. */
const ARRIVES_WITH = "the scraper repo's migrations";

/**
 * What the operator is told about how this table is written — the regime's
 * consequence, in the app's voice, and the same distinction the write path
 * makes (`Regime` in `src/lib/edit/config.ts`).
 *
 * The pre-cutover line states the provenance fact plainly: `field_provenance`
 * carries rows for resolver-owned entities, and a pre-cutover table has none,
 * so no source stands beside its values. That is a fact about the data, not a
 * placeholder value in the provenance slot (admin-window/TASK-0025 is the open
 * question of what should eventually stand there; nothing is invented until it
 * is answered).
 */
function regimeNote(config: TableEditConfig): string {
  return config.regime === "pre_cutover"
    ? `${config.table} is edited directly: a value changed here is written to ` +
        `the catalog as it stands. No field provenance is recorded for it, so ` +
        `no source is shown beside a value.`
    : `${config.table} is resolver-owned and read-only from Admin: its values ` +
        `change through the resolution pipeline, not by a direct edit.`;
}

export default async function RecordPage({
  params,
}: {
  /** Next 16 hands dynamic segments over as a promise. */
  params: Promise<{ table: string; id: string }>;
}) {
  const { table, id } = await params;

  const config = editConfigFor(table);
  // Not a table the edit surface knows about: there is no record page here,
  // and saying so with a 404 is the same answer the write route gives.
  if (config === null) notFound();

  const result = await readRecord(config, id);

  let body;
  if (result.kind === "not_provisioned") {
    body = <NotProvisioned missing={result.missing} arrivesWith={ARRIVES_WITH} />;
  } else if (result.kind === "error") {
    body = (
      <ErrorLine failed={result.message} retry="Reload to try the read again." />
    );
  } else if (result.data === null) {
    // The table answered and holds no such row — a different state from the
    // table being absent, and the two never share a rendering.
    body = (
      <Empty
        holds={`${config.table} record with that id`}
        filledBy="Browse lists the records that exist; check the id in the address bar."
      />
    );
  } else {
    body = (
      <RecordFields
        table={config.table}
        id={id}
        fields={recordFields(config, result.data)}
      />
    );
  }

  return (
    <Page title={`${config.table} record`}>
      {/* The record's identity, rendered whatever the read did: an operator
          looking at a failed read still needs to know which row they asked
          for. Mono, because it is a value the database produced. */}
      <p className="type-data text-ink-secondary">{id}</p>
      <Section title="Fields">
        <p className="type-body text-ink-secondary">{regimeNote(config)}</p>
        {body}
      </Section>
    </Page>
  );
}
