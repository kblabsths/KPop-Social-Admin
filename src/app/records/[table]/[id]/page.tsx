import { Empty, Page } from "@/components/ui";

/**
 * The edit surface for one canonical record — the field, its value, its
 * provenance and whether it is admin-locked, on one line.
 *
 * A stub: campaign admin-window/TASK-0005 stands the route up so the gate and
 * the shell cover it; the edit tickets fill it in against
 * `src/lib/edit/config.ts`, which is the one place a table becomes editable.
 * Nothing here reads or writes the database yet.
 */
export default async function RecordPage({
  params,
}: {
  params: Promise<{ table: string; id: string }>;
}) {
  const { table, id } = await params;
  return (
    <Page title="Record">
      <Empty
        holds={`fields for ${table} ${id}`}
        filledBy="The edit surface reads a record's canonical fields, each with the provenance of the value it shows."
      />
    </Page>
  );
}
