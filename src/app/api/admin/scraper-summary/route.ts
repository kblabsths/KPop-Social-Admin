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
  ] = await Promise.all([
    supabase
      .from("scraper_runs")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("scraper_runs")
      .select("*", { count: "exact", head: true }),
    supabase
      .from("scraper_runs")
      .select("*", { count: "exact", head: true })
      .eq("status", "completed"),
    supabase.from("concerts").select("*", { count: "exact", head: true }),
  ]);

  const latestRun = latestRunResult.data;
  const totalRuns = totalRunsResult.count ?? 0;
  const successfulRuns = successfulRunsResult.count ?? 0;
  const totalConcerts = totalConcertsResult.count ?? 0;

  const lastScrapeTime = latestRun?.started_at ?? null;
  const lastScrapeStatus = latestRun?.status ?? null;
  const hoursSinceLastRun = lastScrapeTime
    ? (Date.now() - new Date(lastScrapeTime).getTime()) / (60 * 60 * 1000)
    : null;
  const isStale = !lastScrapeTime || hoursSinceLastRun! > STALE_THRESHOLD_HOURS;
  const successRate = totalRuns > 0 ? successfulRuns / totalRuns : 0;

  const totalEventsScraped = latestRun
    ? (latestRun.events_new ?? 0) + (latestRun.events_updated ?? 0)
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
    lastRunRecords: latestRun
      ? {
          created: latestRun.events_new ?? 0,
          updated: latestRun.events_updated ?? 0,
          failed: latestRun.events_errored ?? 0,
        }
      : null,
  });
}
