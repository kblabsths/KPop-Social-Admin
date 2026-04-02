import { prisma } from "@/lib/prisma";

export default async function AdminOverview() {
  const [users, artists, venues, concerts, scraperRuns, activeAlerts] =
    await Promise.all([
      prisma.user.count(),
      prisma.artist.count(),
      prisma.venue.count(),
      prisma.concert.count(),
      prisma.scraperRun.count(),
      prisma.dataQualityAlert.count({ where: { resolvedAt: null } }),
    ]);

  const recentRuns = await prisma.scraperRun.findMany({
    orderBy: { startedAt: "desc" },
    take: 5,
  });

  const alertsBySeverity = await prisma.dataQualityAlert.groupBy({
    by: ["severity"],
    where: { resolvedAt: null },
    _count: true,
  });

  const stats = [
    { label: "Users", value: users },
    { label: "Artists", value: artists },
    { label: "Venues", value: venues },
    { label: "Concerts", value: concerts },
    { label: "Scraper Runs", value: scraperRuns },
    { label: "Active Alerts", value: activeAlerts },
  ];

  const severityColors: Record<string, string> = {
    CRITICAL: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
    HIGH: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
    MEDIUM: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
    LOW: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  };

  const statusColors: Record<string, string> = {
    RUNNING: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
    SUCCESS: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
    FAILED: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
    PARTIAL: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  };

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
        Dashboard Overview
      </h1>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900"
          >
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {stat.label}
            </p>
            <p className="text-2xl font-bold text-gray-900 dark:text-white">
              {stat.value}
            </p>
          </div>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
            Recent Scraper Runs
          </h2>
          {recentRuns.length === 0 ? (
            <p className="text-sm text-gray-500">No scraper runs yet.</p>
          ) : (
            <div className="space-y-2">
              {recentRuns.map((run) => (
                <div
                  key={run.id}
                  className="flex items-center justify-between rounded-md border border-gray-100 p-2 dark:border-gray-800"
                >
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    {run.scraperName}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[run.status] || ""}`}
                  >
                    {run.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
            Active Alerts by Severity
          </h2>
          {alertsBySeverity.length === 0 ? (
            <p className="text-sm text-gray-500">No active alerts.</p>
          ) : (
            <div className="space-y-2">
              {alertsBySeverity.map((group) => (
                <div
                  key={group.severity}
                  className="flex items-center justify-between"
                >
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${severityColors[group.severity] || ""}`}
                  >
                    {group.severity}
                  </span>
                  <span className="text-sm font-bold text-gray-900 dark:text-white">
                    {group._count}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
