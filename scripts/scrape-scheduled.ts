/**
 * Scheduled Scraper Runner
 *
 * Wraps the production scraper with scheduling-friendly features:
 * - Checks data freshness before scraping (skips if recent data exists)
 * - Creates STALE_DATA alerts when data is older than threshold
 * - Exits with code 0 on skip (cron-friendly)
 * - Logs to stdout for cron/systemd journal capture
 *
 * Usage:
 *   npx tsx scripts/scrape-scheduled.ts              # Scrape if data is stale (>24h)
 *   npx tsx scripts/scrape-scheduled.ts --force       # Always scrape
 *   npx tsx scripts/scrape-scheduled.ts --check-only  # Only check freshness, don't scrape
 */

import "dotenv/config";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { execSync } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const STALE_THRESHOLD_HOURS = 24;

async function getLatestRun() {
  return prisma.scraperRun.findFirst({
    where: { scraperName: "kpopofficial" },
    orderBy: { startedAt: "desc" },
  });
}

async function getScraperStats() {
  const [latestRun, totalRuns, successfulRuns, totalConcerts] =
    await Promise.all([
      getLatestRun(),
      prisma.scraperRun.count({ where: { scraperName: "kpopofficial" } }),
      prisma.scraperRun.count({
        where: { scraperName: "kpopofficial", status: "SUCCESS" },
      }),
      prisma.concert.count(),
    ]);

  const isStale =
    !latestRun ||
    Date.now() - latestRun.startedAt.getTime() >
      STALE_THRESHOLD_HOURS * 60 * 60 * 1000;

  const hoursSinceLastRun = latestRun
    ? (Date.now() - latestRun.startedAt.getTime()) / (60 * 60 * 1000)
    : null;

  return {
    latestRun,
    totalRuns,
    successfulRuns,
    successRate: totalRuns > 0 ? successfulRuns / totalRuns : 0,
    totalConcerts,
    isStale,
    hoursSinceLastRun,
  };
}

async function createStaleAlert() {
  const existing = await prisma.dataQualityAlert.findFirst({
    where: {
      alertType: "STALE_DATA",
      entityType: "ScraperRun",
      entityId: "kpopofficial",
      resolvedAt: null,
    },
  });

  if (!existing) {
    await prisma.dataQualityAlert.create({
      data: {
        alertType: "STALE_DATA",
        severity: "HIGH",
        entityType: "ScraperRun",
        entityId: "kpopofficial",
        message: `Scraper data is stale. No successful scrape in the last ${STALE_THRESHOLD_HOURS} hours.`,
      },
    });
    console.log("[ALERT] Created STALE_DATA alert for kpopofficial scraper");
  }
}

async function resolveStaleAlerts() {
  const resolved = await prisma.dataQualityAlert.updateMany({
    where: {
      alertType: "STALE_DATA",
      entityType: "ScraperRun",
      entityId: "kpopofficial",
      resolvedAt: null,
    },
    data: { resolvedAt: new Date() },
  });

  if (resolved.count > 0) {
    console.log(`[ALERT] Resolved ${resolved.count} STALE_DATA alert(s)`);
  }
}

async function runScraper() {
  const scriptPath = resolve(__dirname, "scrape-production.ts");
  console.log(`[SCRAPE] Running production scraper...`);
  try {
    execSync(`npx tsx "${scriptPath}"`, {
      stdio: "inherit",
      cwd: resolve(__dirname, ".."),
      env: process.env as NodeJS.ProcessEnv,
    });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const checkOnly = args.includes("--check-only");

  console.log(`[SCHEDULED] ${new Date().toISOString()}`);
  console.log(`[SCHEDULED] Stale threshold: ${STALE_THRESHOLD_HOURS}h`);

  const stats = await getScraperStats();

  console.log(`[STATUS] Total runs: ${stats.totalRuns}`);
  console.log(
    `[STATUS] Success rate: ${(stats.successRate * 100).toFixed(1)}%`
  );
  console.log(`[STATUS] Total concerts in DB: ${stats.totalConcerts}`);

  if (stats.latestRun) {
    console.log(
      `[STATUS] Last run: ${stats.latestRun.startedAt.toISOString()} (${stats.hoursSinceLastRun?.toFixed(1)}h ago) — ${stats.latestRun.status}`
    );
  } else {
    console.log(`[STATUS] No previous runs found`);
  }

  console.log(`[STATUS] Data stale: ${stats.isStale}`);

  if (stats.isStale) {
    await createStaleAlert();
  }

  if (checkOnly) {
    console.log(`[SCHEDULED] Check-only mode, exiting`);
    await prisma.$disconnect();
    process.exit(stats.isStale ? 1 : 0);
  }

  if (!stats.isStale && !force) {
    console.log(
      `[SCHEDULED] Data is fresh (${stats.hoursSinceLastRun?.toFixed(1)}h old), skipping scrape`
    );
    await prisma.$disconnect();
    process.exit(0);
  }

  console.log(
    force
      ? `[SCHEDULED] Force mode, running scraper`
      : `[SCHEDULED] Data is stale, running scraper`
  );

  // Disconnect before spawning child process (it creates its own connection)
  await prisma.$disconnect();

  const success = await runScraper();

  // Reconnect to handle post-scrape alerts
  const postAdapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL,
  });
  const postPrisma = new PrismaClient({ adapter: postAdapter });

  if (success) {
    // Resolve stale alerts after a successful scrape
    const resolved = await postPrisma.dataQualityAlert.updateMany({
      where: {
        alertType: "STALE_DATA",
        entityType: "ScraperRun",
        entityId: "kpopofficial",
        resolvedAt: null,
      },
      data: { resolvedAt: new Date() },
    });
    if (resolved.count > 0) {
      console.log(
        `[ALERT] Resolved ${resolved.count} STALE_DATA alert(s) after successful scrape`
      );
    }
    console.log(`[SCHEDULED] Scrape completed successfully`);
  } else {
    console.error(`[SCHEDULED] Scrape failed`);
  }

  await postPrisma.$disconnect();
  process.exit(success ? 0 : 1);
}

main().catch((err) => {
  console.error("[SCHEDULED] Fatal error:", err.message || err);
  process.exit(1);
});
