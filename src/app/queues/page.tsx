import { Empty, Page } from "@/components/ui";

/**
 * Queues — the decision queue and the signal queue, two lists of equal
 * standing (campaign admin-window/TASK-0005 stands the route up; the lists,
 * their filters and the queue-health gauge are their own ticket).
 */
export default async function QueuesPage() {
  return (
    <Page title="Queues">
      <Empty
        holds="open review items"
        filledBy="The resolver files a decision when sources disagree, and a signal when a fact needs a look."
      />
    </Page>
  );
}
