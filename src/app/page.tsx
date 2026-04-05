import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const STALE_THRESHOLD_HOURS = 24;

export default async function AdminOverview() {
  const supabase = getSupabaseAdmin();

  const [
    totalConcertsResult,
    concertsWithDescriptionResult,
    concertsWithArtistsResult,
    concertsWithTicketUrlResult,
    totalArtistsResult,
    totalVenuesResult,
    totalUsersResult,
    activeAlertsResult,
    latestRunResult,
    allRunsResult,
    recentAlertsResult,
  ] = await Promise.all([
    supabase.from("concerts").select("*", { count: "exact", head: true }),
    supabase
      .from("concerts")
      .select("*", { count: "exact", head: true })
      .not("description", "is", null),
    supabase
      .from("concerts")
      .select("id, concert_artists!inner(concert_id)", { count: "exact", head: true }),
    supabase
      .from("concerts")
      .select("*", { count: "exact", head: true })
      .not("ticket_url", "is", null),
    supabase.from("artists").select("*", { count: "exact", head: true }),
    supabase.from("venues").select("*", { count: "exact", head: true }),
    supabase.from("web_users").select("*", { count: "exact", head: true }),
    supabase
      .from("data_quality_alerts")
      .select("*", { count: "exact", head: true })
      .is("resolved_at", null),
    supabase
      .from("scraper_runs")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("scraper_runs")
      .select("id, scraper_name, status, started_at, finished_at, records_created, records_updated, records_failed, error_message")
      .order("started_at", { ascending: false }),
    supabase
      .from("data_quality_alerts")
      .select("*")
      .is("resolved_at", null)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  const totalConcerts = totalConcertsResult.count ?? 0;
  const concertsWithDescription = concertsWithDescriptionResult.count ?? 0;
  const concertsWithArtists = concertsWithArtistsResult.count ?? 0;
  const concertsWithTicketUrl = concertsWithTicketUrlResult.count ?? 0;
  const totalArtists = totalArtistsResult.count ?? 0;
  const totalVenues = totalVenuesResult.count ?? 0;
  const totalUsers = totalUsersResult.count ?? 0;
  const activeAlerts = activeAlertsResult.count ?? 0;
  const latestRun = latestRunResult.data;
  const allRuns = allRunsResult.data ?? [];
  const recentAlerts = recentAlertsResult.data ?? [];

  const scraperMap = new Map<
    string,
    { count: number; recordsCreated: number; recordsUpdated: number; recordsFailed: number }
  >();
  for (const run of allRuns) {
    const existing = scraperMap.get(run.scraper_name) ?? {
      count: 0,
      recordsCreated: 0,
      recordsUpdated: 0,
      recordsFailed: 0,
    };
    scraperMap.set(run.scraper_name, {
      count: existing.count + 1,
      recordsCreated: existing.recordsCreated + (run.records_created ?? 0),
      recordsUpdated: existing.recordsUpdated + (run.records_updated ?? 0),
      recordsFailed: existing.recordsFailed + (run.records_failed ?? 0),
    });
  }
  const scraperNames = Array.from(scraperMap.keys());

  const scraperLatestRuns = scraperNames.map((name) =>
    allRuns.find((r) => r.scraper_name === name) ?? null
  );
  const scraperSuccessCounts = scraperNames.map(
    (name) => allRuns.filter((r) => r.scraper_name === name && r.status === "SUCCESS").length
  );

  const scraperStats = scraperNames.map((name) => ({
    scraperName: name,
    ...scraperMap.get(name)!,
  }));

  const recentRuns = allRuns.slice(0, 10);

  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const hoursSinceLastRun = latestRun
    ? (now - new Date(latestRun.started_at).getTime()) / (60 * 60 * 1000)
    : null;
  const isStale =
    !latestRun ||
    (hoursSinceLastRun !== null && hoursSinceLastRun > STALE_THRESHOLD_HOURS);

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

  const activityFeed = [
    ...recentRuns.map((r) => ({
      type: "scraper" as const,
      time: new Date(r.started_at),
      label: `${r.scraper_name} — ${r.status}`,
      detail: `${r.records_created} created, ${r.records_updated} updated${r.records_failed > 0 ? `, ${r.records_failed} failed` : ""}`,
      status: r.status,
    })),
    ...recentAlerts.map((a) => ({
      type: "alert" as const,
      time: new Date(a.created_at),
      label: `${a.severity} ${a.alert_type}`,
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
            Last scrape: {new Date(latestRun.started_at).toISOString().replace("T", " ").slice(0, 19)} UTC
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
                  const totalRuns = stat.count;
                  const successCount = scraperSuccessCounts[i];
                  const rate =
                    totalRuns > 0 ? Math.round((successCount / totalRuns) * 1000) / 10 : 0;
                  const totalRecords = stat.recordsCreated + stat.recordsUpdated;
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
                          ? new Date(latest.started_at).toISOString().replace("T", " ").slice(0, 16)
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
