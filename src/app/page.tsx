import { getSupabaseAdmin } from "@/lib/supabase";
import Link from "next/link";

export const revalidate = 30;

const STALE_THRESHOLD_HOURS = 24;

function formatAge(isoString: string): string {
  const ms = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function formatDuration(start: string, end: string | null | undefined): string {
  if (!end) return "running…";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

export default async function AdminOverview() {
  const supabase = getSupabaseAdmin();
  const now = new Date().toISOString();

  const [
    // Current entities
    totalGroupsResult,
    activeGroupsResult,
    totalIdolsResult,
    totalEventsResult,
    upcomingEventsResult,
    totalUsersResult,
    // Data completeness — events
    eventsWithImageResult,
    eventsWithTicketUrlResult,
    eventsWithVenueResult,
    // Data completeness — groups / idols
    groupsWithImageResult,
    idolsWithImageResult,
    // Alerts
    activeAlertsResult,
    criticalAlertsResult,
    recentAlertsResult,
    // Scraper runs
    allRunsResult,
  ] = await Promise.all([
    supabase.from("groups").select("*", { count: "exact", head: true }),
    supabase.from("groups").select("*", { count: "exact", head: true }).eq("status", "active"),
    supabase.from("idols").select("*", { count: "exact", head: true }),
    supabase.from("events").select("*", { count: "exact", head: true }),
    supabase.from("events").select("*", { count: "exact", head: true }).gte("date", now),
    supabase.from("web_users").select("*", { count: "exact", head: true }),
    supabase.from("events").select("*", { count: "exact", head: true }).not("image_url", "is", null),
    supabase.from("events").select("*", { count: "exact", head: true }).not("ticket_url", "is", null),
    supabase.from("events").select("*", { count: "exact", head: true }).not("venue_id", "is", null),
    supabase.from("groups").select("*", { count: "exact", head: true }).not("image_url", "is", null),
    supabase.from("idols").select("*", { count: "exact", head: true }).not("image_url", "is", null),
    supabase
      .from("data_quality_alerts")
      .select("*", { count: "exact", head: true })
      .is("resolved_at", null),
    supabase
      .from("data_quality_alerts")
      .select("*", { count: "exact", head: true })
      .is("resolved_at", null)
      .in("severity", ["CRITICAL", "HIGH"]),
    supabase
      .from("data_quality_alerts")
      .select("*")
      .is("resolved_at", null)
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("scraper_runs")
      .select("id, source, status, started_at, completed_at, events_new, events_updated, events_errored")
      .order("started_at", { ascending: false })
      .limit(200),
  ]);

  const totalGroups = totalGroupsResult.count ?? 0;
  const activeGroups = activeGroupsResult.count ?? 0;
  const totalIdols = totalIdolsResult.count ?? 0;
  const totalEvents = totalEventsResult.count ?? 0;
  const upcomingEvents = upcomingEventsResult.count ?? 0;
  const totalUsers = totalUsersResult.count ?? 0;

  const eventsWithImage = eventsWithImageResult.count ?? 0;
  const eventsWithTicketUrl = eventsWithTicketUrlResult.count ?? 0;
  const eventsWithVenue = eventsWithVenueResult.count ?? 0;
  const groupsWithImage = groupsWithImageResult.count ?? 0;
  const idolsWithImage = idolsWithImageResult.count ?? 0;

  const activeAlerts = activeAlertsResult.count ?? 0;
  const criticalAlerts = criticalAlertsResult.count ?? 0;
  const recentAlerts = recentAlertsResult.data ?? [];

  const allRuns = allRunsResult.data ?? [];
  const latestRun = allRuns[0] ?? null;

  // ── Per-source health ──────────────────────────────────────────────────────
  type SourceHealth = {
    source: string;
    totalRuns: number;
    successCount: number;
    lastRun: (typeof allRuns)[0] | null;
  };
  const sourceMap = new Map<string, SourceHealth>();
  for (const run of allRuns) {
    const entry = sourceMap.get(run.source) ?? {
      source: run.source,
      totalRuns: 0,
      successCount: 0,
      lastRun: null,
    };
    entry.totalRuns += 1;
    if (run.status === "completed") entry.successCount += 1;
    if (entry.lastRun === null) entry.lastRun = run; // already ordered desc
    sourceMap.set(run.source, entry);
  }
  const sourceHealthList = Array.from(sourceMap.values());

  // ── Overall freshness ─────────────────────────────────────────────────────
  const hoursSinceLastRun = latestRun
    ? (Date.now() - new Date(latestRun.started_at).getTime()) / 3600000
    : null;
  const isStale = !latestRun || (hoursSinceLastRun ?? Infinity) > STALE_THRESHOLD_HOURS;

  // ── Activity feed (last 10) ────────────────────────────────────────────────
  const recentRuns = allRuns.slice(0, 10);
  const activityFeed = [
    ...recentRuns.map((r) => ({
      type: "scraper" as const,
      time: new Date(r.started_at),
      label: `${r.source} — ${r.status}`,
      detail: `+${r.events_new ?? 0} new, ~${r.events_updated ?? 0} updated${(r.events_errored ?? 0) > 0 ? `, ${r.events_errored} err` : ""}`,
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
    completed: "text-green-600 dark:text-green-400",
    failed: "text-red-600 dark:text-red-400",
    running: "text-blue-600 dark:text-blue-400",
    CRITICAL: "text-red-600 dark:text-red-400",
    HIGH: "text-orange-600 dark:text-orange-400",
    MEDIUM: "text-yellow-600 dark:text-yellow-400",
    LOW: "text-blue-500 dark:text-blue-400",
  };

  const statusBadge: Record<string, string> = {
    completed: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
    failed: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
    running: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  };

  function pct(n: number, total: number) {
    return total > 0 ? Math.round((n / total) * 1000) / 10 : 0;
  }

  return (
    <div className="space-y-4">
      <h1 className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
        Overview
      </h1>

      {/* ── Freshness bar ── */}
      <div
        className={`w-full border-l-4 px-3 py-2 text-xs font-mono flex flex-wrap items-center gap-x-4 gap-y-1 ${
          isStale
            ? "border-red-500 bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-300"
            : "border-green-500 bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-300"
        }`}
      >
        <span className="font-bold">{isStale ? "⚠ DATA STALE" : "✓ DATA FRESH"}</span>
        {latestRun ? (
          <span className="opacity-80">
            Last scrape: {new Date(latestRun.started_at).toISOString().replace("T", " ").slice(0, 16)} UTC
            &nbsp;({formatAge(latestRun.started_at)})
          </span>
        ) : (
          <span className="opacity-80">No scraper runs recorded.</span>
        )}
        {criticalAlerts > 0 && (
          <span className="font-semibold text-red-700 dark:text-red-300">
            ▲ {criticalAlerts} critical alert{criticalAlerts !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* ── Entity counts ── */}
      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          Entities
        </h2>
        <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
          <StatCard label="Groups" value={totalGroups} />
          <StatCard label="Active Groups" value={activeGroups} color="text-green-600 dark:text-green-400" />
          <StatCard label="Idols" value={totalIdols} />
          <StatCard label="Events" value={totalEvents} />
          <StatCard label="Upcoming" value={upcomingEvents} color="text-blue-600 dark:text-blue-400" />
          <StatCard label="Users" value={totalUsers} />
        </div>
      </section>

      {/* ── Alerts ── */}
      {activeAlerts > 0 && (
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            Active Alerts
          </h2>
          <div className="grid grid-cols-2 gap-2 md:max-w-xs">
            <StatCard label="Total Active" value={activeAlerts} alert={activeAlerts > 0} />
            <StatCard label="Critical / High" value={criticalAlerts} alert={criticalAlerts > 0} />
          </div>
          {recentAlerts.length > 0 && (
            <div className="mt-2 border border-gray-300 dark:border-gray-700 divide-y divide-gray-200 dark:divide-gray-800">
              {recentAlerts.map((a) => (
                <div key={a.id} className="flex items-start gap-3 px-3 py-1.5 text-xs font-mono hover:bg-gray-50 dark:hover:bg-gray-900">
                  <span className={`shrink-0 font-semibold w-20 ${statusColor[a.severity] ?? ""}`}>{a.severity}</span>
                  <span className="shrink-0 text-gray-500 dark:text-gray-400 w-28">{a.alert_type}</span>
                  <span className="truncate text-gray-700 dark:text-gray-300">{a.message}</span>
                </div>
              ))}
            </div>
          )}
          <p className="mt-1 text-[10px] font-mono text-gray-400">
            <Link href="/alerts" className="underline hover:text-gray-600">View all alerts →</Link>
          </p>
        </section>
      )}

      {/* ── Scraper source health ── */}
      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          Scraper Health
        </h2>
        {sourceHealthList.length === 0 ? (
          <div className="border border-gray-300 dark:border-gray-700 px-3 py-4 text-center text-xs font-mono text-gray-400">
            No scraper runs recorded yet.
          </div>
        ) : (
          <div className="border border-gray-300 dark:border-gray-700 overflow-hidden">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="bg-gray-200 dark:bg-gray-800 text-gray-600 dark:text-gray-400 text-left">
                  <th className="px-3 py-1.5 font-medium">Source</th>
                  <th className="px-3 py-1.5 font-medium">Last Run</th>
                  <th className="px-3 py-1.5 font-medium">Status</th>
                  <th className="px-3 py-1.5 font-medium">Duration</th>
                  <th className="px-3 py-1.5 font-medium text-right">+New</th>
                  <th className="px-3 py-1.5 font-medium text-right">~Upd</th>
                  <th className="px-3 py-1.5 font-medium text-right">Err</th>
                  <th className="px-3 py-1.5 font-medium text-right">Success Rate</th>
                  <th className="px-3 py-1.5 font-medium text-right">Total Runs</th>
                </tr>
              </thead>
              <tbody>
                {sourceHealthList.map((s) => {
                  const lr = s.lastRun;
                  const rate = s.totalRuns > 0 ? Math.round((s.successCount / s.totalRuns) * 1000) / 10 : 0;
                  const rateColor =
                    rate >= 90
                      ? "text-green-600 dark:text-green-400"
                      : rate >= 70
                        ? "text-yellow-600 dark:text-yellow-400"
                        : "text-red-600 dark:text-red-400";
                  return (
                    <tr key={s.source} className="border-t border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-900">
                      <td className="px-3 py-1.5 font-medium text-gray-800 dark:text-gray-200">
                        <Link href="/scrapers" className="hover:underline">{s.source}</Link>
                      </td>
                      <td className="px-3 py-1.5 text-gray-500 dark:text-gray-400">
                        {lr ? formatAge(lr.started_at) : "—"}
                      </td>
                      <td className="px-3 py-1.5">
                        {lr ? (
                          <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${statusBadge[lr.status] ?? ""}`}>
                            {lr.status}
                          </span>
                        ) : "—"}
                      </td>
                      <td className="px-3 py-1.5 text-gray-500 dark:text-gray-400">
                        {lr ? formatDuration(lr.started_at, lr.completed_at) : "—"}
                      </td>
                      <td className="px-3 py-1.5 text-right text-green-700 dark:text-green-400">
                        {lr ? `+${lr.events_new ?? 0}` : "—"}
                      </td>
                      <td className="px-3 py-1.5 text-right text-gray-500 dark:text-gray-400">
                        {lr ? `~${lr.events_updated ?? 0}` : "—"}
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        {lr && (lr.events_errored ?? 0) > 0 ? (
                          <span className="text-red-600 dark:text-red-400">{lr.events_errored}</span>
                        ) : (
                          <span className="text-gray-300 dark:text-gray-700">{lr ? "0" : "—"}</span>
                        )}
                      </td>
                      <td className={`px-3 py-1.5 text-right font-semibold ${rateColor}`}>
                        {rate}%
                      </td>
                      <td className="px-3 py-1.5 text-right text-gray-500 dark:text-gray-400">
                        {s.totalRuns}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-1 text-[10px] font-mono text-gray-400">
          <Link href="/scrapers" className="underline hover:text-gray-600">View all scraper runs →</Link>
        </p>
      </section>

      {/* ── Data completeness ── */}
      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          Data Completeness
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
          <CompletenessCard label="Events w/ Image" value={pct(eventsWithImage, totalEvents)} count={eventsWithImage} total={totalEvents} />
          <CompletenessCard label="Events w/ Ticket URL" value={pct(eventsWithTicketUrl, totalEvents)} count={eventsWithTicketUrl} total={totalEvents} />
          <CompletenessCard label="Events w/ Venue" value={pct(eventsWithVenue, totalEvents)} count={eventsWithVenue} total={totalEvents} />
          <CompletenessCard label="Groups w/ Image" value={pct(groupsWithImage, totalGroups)} count={groupsWithImage} total={totalGroups} />
          <CompletenessCard label="Idols w/ Image" value={pct(idolsWithImage, totalIdols)} count={idolsWithImage} total={totalIdols} />
        </div>
        <p className="mt-1 text-[10px] font-mono text-gray-400">
          <Link href="/database" className="underline hover:text-gray-600">Full field-level completeness →</Link>
        </p>
      </section>

      {/* ── Recent activity feed ── */}
      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          Recent Activity
        </h2>
        <div className="border border-gray-300 dark:border-gray-700 divide-y divide-gray-200 dark:divide-gray-800">
          {activityFeed.length === 0 ? (
            <div className="px-3 py-2 text-xs text-gray-400 text-center font-mono">No recent activity.</div>
          ) : (
            activityFeed.map((item, i) => (
              <div
                key={i}
                className="flex items-start gap-3 px-3 py-1.5 text-xs font-mono hover:bg-gray-50 dark:hover:bg-gray-900"
              >
                <span className="shrink-0 text-gray-400 dark:text-gray-500 w-32">
                  {item.time.toISOString().replace("T", " ").slice(0, 16)}
                </span>
                <span className={`shrink-0 w-4 text-center ${item.type === "alert" ? "text-orange-500" : "text-blue-500"}`}>
                  {item.type === "alert" ? "▲" : "⟳"}
                </span>
                <span className={`shrink-0 font-semibold ${statusColor[item.status] ?? "text-gray-600 dark:text-gray-300"}`}>
                  {item.label}
                </span>
                <span className="text-gray-500 dark:text-gray-400 truncate">{item.detail}</span>
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
      <p className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1">{label}</p>
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
      <p className="text-[10px] font-mono text-gray-400">{count}/{total}</p>
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
      <p className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1">{label}</p>
      <p
        className={`text-lg font-bold font-mono ${
          color ? color : alert ? "text-red-600 dark:text-red-400" : "text-gray-800 dark:text-gray-200"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
