import { prisma } from "@/lib/prisma";

const STALE_THRESHOLD_HOURS = 24;

export default async function AdminOverview() {
  const [
    totalConcerts,
    concertsWithDescription,
    concertsWithArtists,
    concertsWithTicketUrl,
    totalArtists,
    totalVenues,
    totalUsers,
    activeAlerts,
    latestRun,
    scraperStats,
    recentRuns,
    recentAlerts,
  ] = await Promise.all([
    prisma.concert.count(),
    prisma.concert.count({ where: { description: { not: null } } }),
    prisma.concert.count({
      where: { artists: { some: {} } },
    }),
    prisma.concert.count({
      where: { ticketUrl: { not: null } },
    }),
    prisma.artist.count(),
    prisma.venue.count(),
    prisma.user.count(),
    prisma.dataQualityAlert.count({ where: { resolvedAt: null } }),
    prisma.scraperRun.findFirst({ orderBy: { startedAt: "desc" } }),
    prisma.scraperRun.groupBy({
      by: ["scraperName"],
      _count: { _all: true },
      _sum: { recordsCreated: true, recordsUpdated: true, recordsFailed: true },
    }),
    prisma.scraperRun.findMany({
      orderBy: { startedAt: "desc" },
      take: 10,
    }),
    prisma.dataQualityAlert.findMany({
      where: { resolvedAt: null },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);

  // Per-scraper latest run and success rate
  const scraperNames = scraperStats.map((s) => s.scraperName);
  const scraperLatestRuns = await Promise.all(
    scraperNames.map((name) =>
      prisma.scraperRun.findFirst({
        where: { scraperName: name },
        orderBy: { startedAt: "desc" },
      })
    )
  );
  const scraperSuccessCounts = await Promise.all(
    scraperNames.map((name) =>
      prisma.scraperRun.count({
        where: { scraperName: name, status: "SUCCESS" },
      })
    )
  );

  const hoursSinceLastRun = latestRun
    ? (Date.now() - latestRun.startedAt.getTime()) / (60 * 60 * 1000)
    : null;
  const isStale =
    !latestRun ||
    (hoursSinceLastRun !== null && hoursSinceLastRun > STALE_THRESHOLD_HOURS);

  // Completeness percentages
  const pctDescription =
    totalConcerts > 0
      ? Math.round((concertsWithDescription / totalConcerts) * 1000) / 10
      : 0;
  const pctArtists =
    totalConcerts > 0
      ? Math.round((concertsWithArtists / totalConcerts) * 1000) / 10
      : 0;
  const pctTicketUrl =
    totalConcerts > 0
      ? Math.round((concertsWithTicketUrl / totalConcerts) * 1000) / 10
      : 0;

  // Merge recent runs + alerts into activity feed, sorted by time
  const activityFeed = [
    ...recentRuns.map((r) => ({
      type: "scraper" as const,
      time: r.startedAt,
      label: `${r.scraperName} — ${r.status}`,
      detail: `${r.recordsCreated} created, ${r.recordsUpdated} updated${r.recordsFailed > 0 ? `, ${r.recordsFailed} failed` : ""}`,
      status: r.status,
    })),
    ...recentAlerts.map((a) => ({
      type: "alert" as const,
      time: a.createdAt,
      label: `${a.severity} ${a.alertType}`,
      detail: a.message,
      status: a.severity,
    })),
  ]
    .sort((a, b) => b.time.getTime() - a.time.getTime())
    .slice(0, 10);

  const statusColor: Record<string, string> = {
    SUCCESS: "text-green-600 dark:text-green-400",
    FAILED: "text-red-600 dark:text-red-400",
    RUNNING: "text-blue-600 dark:text-blue-400",
    PARTIAL: "text-yellow-600 dark:text-yellow-400",
    CRITICAL: "text-red-600 dark:text-red-400",
    HIGH: "text-orange-600 dark:text-orange-400",
    MEDIUM: "text-yellow-600 dark:text-yellow-400",
    LOW: "text-blue-600 dark:text-blue-400",
  };

  return (
    <div className="space-y-4">
      <h1 className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
        Overview
      </h1>

      {/* Freshness bar */}
      <div
        className={`w-full border-l-4 px-3 py-2 text-xs font-mono ${
          isStale
            ? "border-red-500 bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-300"
            : "border-green-500 bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-300"
        }`}
      >
        <span className="font-bold">{isStale ? "⚠ DATA STALE" : "✓ DATA FRESH"}</span>
        {latestRun && (
          <span className="ml-3">
            Last scrape: {latestRun.startedAt.toISOString().replace("T", " ").slice(0, 19)} UTC
            {hoursSinceLastRun !== null && (
              <span className="ml-1 opacity-70">
                ({hoursSinceLastRun < 1
                  ? `${Math.round(hoursSinceLastRun * 60)}m ago`
                  : `${Math.round(hoursSinceLastRun * 10) / 10}h ago`})
              </span>
            )}
          </span>
        )}
        {isStale && !latestRun && <span className="ml-3">No scraper runs recorded.</span>}
      </div>

      {/* Data completeness panels */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
        <CompletenessCard label="Concerts w/ description" value={pctDescription} count={concertsWithDescription} total={totalConcerts} />
        <CompletenessCard label="Concerts w/ artist" value={pctArtists} count={concertsWithArtists} total={totalConcerts} />
        <CompletenessCard label="Concerts w/ ticket URL" value={pctTicketUrl} count={concertsWithTicketUrl} total={totalConcerts} />
        <StatCard label="Total concerts" value={totalConcerts} />
        <StatCard label="Total artists" value={totalArtists} />
        <StatCard label="Total venues" value={totalVenues} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <StatCard label="Users" value={totalUsers} />
        <StatCard label="Active alerts" value={activeAlerts} alert={activeAlerts > 0} />
        <StatCard label="Scraper runs" value={recentRuns.length > 0 ? `${recentRuns.length} recent` : "0"} />
        <StatCard
          label="Latest status"
          value={latestRun?.status ?? "NONE"}
          color={statusColor[latestRun?.status ?? ""] ?? "text-gray-600 dark:text-gray-400"}
        />
      </div>

      {/* Data source assessment table */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">
          Data Sources
        </h2>
        <div className="border border-gray-300 dark:border-gray-700 overflow-hidden">
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="bg-gray-200 dark:bg-gray-800 text-gray-600 dark:text-gray-400 text-left">
                <th className="px-3 py-1.5 font-medium">Source</th>
                <th className="px-3 py-1.5 font-medium text-right">Total Runs</th>
                <th className="px-3 py-1.5 font-medium text-right">Records</th>
                <th className="px-3 py-1.5 font-medium text-right">Success Rate</th>
                <th className="px-3 py-1.5 font-medium">Last Run</th>
                <th className="px-3 py-1.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {scraperStats.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-2 text-gray-400 text-center">
                    No scraper data yet.
                  </td>
                </tr>
              ) : (
                scraperStats.map((stat, i) => {
                  const latest = scraperLatestRuns[i];
                  const totalRuns = stat._count._all;
                  const successCount = scraperSuccessCounts[i];
                  const rate =
                    totalRuns > 0 ? Math.round((successCount / totalRuns) * 1000) / 10 : 0;
                  const totalRecords =
                    (stat._sum.recordsCreated ?? 0) + (stat._sum.recordsUpdated ?? 0);
                  return (
                    <tr
                      key={stat.scraperName}
                      className="border-t border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-900"
                    >
                      <td className="px-3 py-1.5 text-gray-800 dark:text-gray-200">
                        {stat.scraperName}
                      </td>
                      <td className="px-3 py-1.5 text-right text-gray-600 dark:text-gray-400">
                        {totalRuns}
                      </td>
                      <td className="px-3 py-1.5 text-right text-gray-600 dark:text-gray-400">
                        {totalRecords}
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        <span
                          className={
                            rate >= 90
                              ? "text-green-600 dark:text-green-400"
                              : rate >= 70
                                ? "text-yellow-600 dark:text-yellow-400"
                                : "text-red-600 dark:text-red-400"
                          }
                        >
                          {rate}%
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-gray-500 dark:text-gray-400">
                        {latest
                          ? latest.startedAt.toISOString().replace("T", " ").slice(0, 16)
                          : "—"}
                      </td>
                      <td className="px-3 py-1.5">
                        <span className={statusColor[latest?.status ?? ""] ?? "text-gray-400"}>
                          {latest?.status ?? "—"}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Recent activity feed */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">
          Recent Activity
        </h2>
        <div className="border border-gray-300 dark:border-gray-700 divide-y divide-gray-200 dark:divide-gray-800">
          {activityFeed.length === 0 ? (
            <div className="px-3 py-2 text-xs text-gray-400 text-center font-mono">
              No recent activity.
            </div>
          ) : (
            activityFeed.map((item, i) => (
              <div
                key={i}
                className="flex items-start gap-3 px-3 py-1.5 text-xs font-mono hover:bg-gray-50 dark:hover:bg-gray-900"
              >
                <span className="shrink-0 text-gray-400 dark:text-gray-500 w-32">
                  {item.time.toISOString().replace("T", " ").slice(0, 16)}
                </span>
                <span
                  className={`shrink-0 w-4 text-center ${
                    item.type === "alert" ? "text-orange-500" : "text-blue-500"
                  }`}
                >
                  {item.type === "alert" ? "▲" : "⟳"}
                </span>
                <span className={`font-semibold ${statusColor[item.status] ?? "text-gray-600 dark:text-gray-300"}`}>
                  {item.label}
                </span>
                <span className="text-gray-500 dark:text-gray-400 truncate">
                  {item.detail}
                </span>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function CompletenessCard({
  label,
  value,
  count,
  total,
}: {
  label: string;
  value: number;
  count: number;
  total: number;
}) {
  return (
    <div className="border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1">
        {label}
      </p>
      <p
        className={`text-lg font-bold font-mono ${
          value >= 90
            ? "text-green-600 dark:text-green-400"
            : value >= 70
              ? "text-yellow-600 dark:text-yellow-400"
              : "text-red-600 dark:text-red-400"
        }`}
      >
        {value}%
      </p>
      <p className="text-[10px] font-mono text-gray-400">
        {count}/{total}
      </p>
    </div>
  );
}

function StatCard({
  label,
  value,
  alert,
  color,
}: {
  label: string;
  value: string | number;
  alert?: boolean;
  color?: string;
}) {
  return (
    <div className="border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1">
        {label}
      </p>
      <p
        className={`text-lg font-bold font-mono ${
          color
            ? color
            : alert
              ? "text-red-600 dark:text-red-400"
              : "text-gray-800 dark:text-gray-200"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
