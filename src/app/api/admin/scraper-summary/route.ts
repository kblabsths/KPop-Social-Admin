import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin";

const STALE_THRESHOLD_HOURS = 24;

export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

  const [latestRun, totalRuns, successfulRuns, totalConcerts, staleAlerts] =
    await Promise.all([
      prisma.scraperRun.findFirst({
        where: { scraperName: "kpopofficial" },
        orderBy: { startedAt: "desc" },
      }),
      prisma.scraperRun.count({ where: { scraperName: "kpopofficial" } }),
      prisma.scraperRun.count({
        where: { scraperName: "kpopofficial", status: "SUCCESS" },
      }),
      prisma.concert.count(),
      prisma.dataQualityAlert.count({
        where: {
          alertType: "STALE_DATA",
          entityType: "ScraperRun",
          entityId: "kpopofficial",
          resolvedAt: null,
        },
      }),
    ]);

  const lastScrapeTime = latestRun?.startedAt ?? null;
  const lastScrapeStatus = latestRun?.status ?? null;
  const hoursSinceLastRun = lastScrapeTime
    ? (Date.now() - lastScrapeTime.getTime()) / (60 * 60 * 1000)
    : null;
  const isStale =
    !lastScrapeTime ||
    hoursSinceLastRun! > STALE_THRESHOLD_HOURS;
  const successRate = totalRuns > 0 ? successfulRuns / totalRuns : 0;

  const totalEventsScraped = latestRun
    ? latestRun.recordsCreated + latestRun.recordsUpdated
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
          created: latestRun.recordsCreated,
          updated: latestRun.recordsUpdated,
          failed: latestRun.recordsFailed,
        }
      : null,
  });
}
