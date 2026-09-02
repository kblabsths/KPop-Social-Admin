import { Empty, Page } from "@/components/ui";

/**
 * Dashboard — "did anything happen last night, and does anything need me"
 * (campaign admin-window/TASK-0005 stands the route up; its gauges and counts
 * are its own ticket).
 *
 * The Dashboard owns health: the deprecated app's global STALE/FRESH strip is
 * gone from the root layout and does not come back as a strip here.
 */
export default async function DashboardPage() {
  return (
    <Page title="Dashboard">
      <Empty
        holds="review items, cycles or runs to report"
        filledBy="The resolver and the adapters fill this in as they work."
      />
    </Page>
  );
}
