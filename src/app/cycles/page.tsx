import { Empty, Page } from "@/components/ui";

/**
 * Cycles & runs — the resolver's cycles and the adapters' runs, each row
 * diagnosable without a click (campaign admin-window/TASK-0005 stands the
 * route up; the tables and the cycle-health gauge are their own ticket).
 */
export default async function CyclesPage() {
  return (
    <Page title="Cycles & runs">
      <Empty
        holds="cycles or runs recorded"
        filledBy="The resolver files a cycle each time it runs, and each adapter files a run."
      />
    </Page>
  );
}
