import { Empty, Page } from "@/components/ui";

/**
 * Claims — what is stuck, and whose fault: the buckets with their counts, and
 * the standing-disagreements tab (campaign admin-window/TASK-0005 stands the
 * route up; the buckets and gauges are their own ticket).
 */
export default async function ClaimsPage() {
  return (
    <Page title="Claims">
      <Empty
        holds="pending claims"
        filledBy="A claim waits here until the resolver can apply it or a human settles it."
      />
    </Page>
  );
}
