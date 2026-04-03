import { prisma } from "@/lib/prisma";

const STALE_THRESHOLD_HOURS = 24;

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

  const latestRun = recentRuns[0] ?? null;
  const successfulRuns = await prisma.scraperRun.count({
    where: { scraperName: "kpopofficial", status: "SUCCESS" },
  });
  const hoursSinceLastRun = latestRun
    ? (Date.now() - latestRun.startedAt.getTime()) / (60 * 60 * 1000)
    : null;
  const isStale =
    !latestRun || (hoursSinceLastRun !== null && hoursSinceLastRun > STALE_THRESHOLD_HOURS);
  const successRate =
    scraperRuns > 0 ? Math.round((successfulRuns / scraperRuns) * 1000) / 10 : 0;

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

      <div
        className={`rounded-lg border p-4 mb-6 ${
          isStale
            ? "border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950"
            : "border-green-300 bg-green-50 dark:border-green-800 dark:bg-green-950"
        }`}
      >
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Data Freshness
          </h2>
          <span
            className={`rounded-full px-3 py-1 text-xs font-bold ${
              isStale
                ? "bg-red-200 text-red-800 dark:bg-red-900 dark:text-red-200"
                : "bg-green-200 text-green-800 dark:bg-green-900 dark:text-green-200"
            }`}
          >
            {isStale ? "STALE" : "FRESH"}
          </span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <p className="text-gray-500 dark:text-gray-400">Last Scrape</p>
            <p className="font-medium text-gray-900 dark:text-white">
              {latestRun
                ? latestRun.startedAt.toLocaleString()
                : "Never"}
            </p>
          </div>
          <div>
            <p className="text-gray-500 dark:text-gray-400">Time Ago</p>
            <p className="font-medium text-gray-900 dark:text-white">
              {hoursSinceLastRun !== null
                ? hoursSinceLastRun < 1
                  ? `${Math.round(hoursSinceLastRun * 60)}m`
                  : `${Math.round(hoursSinceLastRun * 10) / 10}h`
                : "N/A"}
            </p>
          </div>
          <div>
            <p className="text-gray-500 dark:text-gray-400">Success Rate</p>
            <p className="font-medium text-gray-900 dark:text-white">
              {successRate}%
            </p>
          </div>
          <div>
            <p className="text-gray-500 dark:text-gray-400">Last Run Events</p>
            <p className="font-medium text-gray-900 dark:text-white">
              {latestRun
                ? `${latestRun.recordsCreated} new, ${latestRun.recordsUpdated} updated`
                : "N/A"}
            </p>
          </div>
        </div>
        {isStale && (
          <p className="mt-2 text-xs text-red-700 dark:text-red-300">
            Data has not been refreshed in over {STALE_THRESHOLD_HOURS} hours.
            Run <code className="bg-red-100 dark:bg-red-900 px-1 rounded">npm run scrape:scheduled</code> or set up a cron job.
          </p>
        )}
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
