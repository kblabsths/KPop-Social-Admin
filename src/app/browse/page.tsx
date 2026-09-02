import { Empty, Page } from "@/components/ui";

/**
 * Browse — the newest events with the provenance of what they carry (campaign
 * admin-window/TASK-0005 stands the route up; the listing and its provenance
 * join are their own ticket).
 */
export default async function BrowsePage() {
  return (
    <Page title="Browse">
      <Empty
        holds="recent events"
        filledBy="An adapter writes an event, and the resolver applies the fields it carries."
      />
    </Page>
  );
}
