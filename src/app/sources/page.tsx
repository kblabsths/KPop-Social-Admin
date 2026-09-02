import { Empty, Page } from "@/components/ui";

/**
 * Sources — each source's lifecycle and tier, its last run and its per-source
 * trends (campaign admin-window/TASK-0005 stands the route up; the table and
 * the gauges are their own ticket).
 */
export default async function SourcesPage() {
  return (
    <Page title="Sources">
      <Empty
        holds="sources registered"
        filledBy="A source appears once the scraper repo registers it and it reports a lifecycle and a tier."
      />
    </Page>
  );
}
