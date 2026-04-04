import { getSupabaseAdmin } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin";

const STALE_THRESHOLD_HOURS = 24;

export async function GET() {
  const supabase = getSupabaseAdmin();
  const { error } = await requireAdmin();
  if (error) return error;

  const [
    latestRunResult,
    totalRunsResult,
    successfulRunsResult,
    totalConcertsResult,
    staleAlertsResult,
  ] = await Promise.all([
    supabase
      .from("scraper_runs")
      .select("*")
      .eq("scraper_name", "kpopofficial")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("scraper_runs")
      .select("*", { count: "exact", head: true })
      .eq("scraper_name", "kpopofficial"),
    supabase
      .from("scraper_runs")
      .select("*", { count: "exact", head: true })
      .eq("scraper_name", "kpopofficial")
      .eq("status", "SUCCESS"),
    supabase.from("concerts").select("*", { count: "exact", head: true }),
    supabase
      .from("data_quality_alerts")
      .select("*", { count: "exact", head: true })
      .eq("alert_type", "STALE_DATA")
      .eq("entity_type", "ScraperRun")
      .eq("entity_id", "kpopofficial")
      .is("resolved_at", null),
  ]);

  const latestRun = latestRunResult.data;
  const totalRuns = totalRunsResult.count ?? 0;
  const successfulRuns = successfulRunsResult.count ?? 0;
  const totalConcerts = totalConcertsResult.count ?? 0;
  const staleAlerts = staleAlertsResult.count ?? 0;

  const lastScrapeTime = latestRun?.started_at ?? null;
  const lastScrapeStatus = latestRun?.status ?? null;
  const hoursSinceLastRun = lastScrapeTime
    ? (Date.now() - new Date(lastScrapeTime).getTime()) / (60 * 60 * 1000)
    : null;
  const isStale = !lastScrapeTime || hoursSinceLastRun! > STALE_THRESHOLD_HOURS;
  const successRate = totalRuns > 0 ? successfulRuns / totalRuns : 0;

  const totalEventsScraped = latestRun
    ? (latestRun.records_created ?? 0) + (latestRun.records_updated ?? 0)
    : 0;

  return Response.json({
    lastScrapeTime,
    lastScrapeStatus,
    hoursSinceLastRun: hoursSinceLastRun ? Math.round(hoursSinceLastRun * 10) / 10 : null,
    isStale,
    staleThresholdHours: STALE_THRESHOLD_HOURS,
    totalRuns,
    successRate: Math.round(successRate * 1000) / 10,
    totalEventsScraped,
    totalConcertsInDb: totalConcerts,
    hasActiveStaleAlert: staleAlerts > 0,
    lastRunRecords: latestRun
      ? {
          created: latestRun.records_created ?? 0,
          updated: latestRun.records_updated ?? 0,
          failed: latestRun.records_failed ?? 0,
        }
      : null,
  });
}
