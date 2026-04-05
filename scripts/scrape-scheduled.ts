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
import { createClient } from "@supabase/supabase-js";
import { execSync } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const STALE_THRESHOLD_HOURS = 24;

async function getLatestRun() {
  const { data } = await supabase
    .from("scraper_runs")
    .select("*")
    .eq("scraper_name", "kpopofficial")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

async function getScraperStats() {
  const [latestRun, totalRunsResult, successfulRunsResult, totalConcertsResult] =
    await Promise.all([
      getLatestRun(),
      supabase
        .from("scraper_runs")
        .select("id", { count: "exact", head: true })
        .eq("scraper_name", "kpopofficial"),
      supabase
        .from("scraper_runs")
        .select("id", { count: "exact", head: true })
        .eq("scraper_name", "kpopofficial")
        .eq("status", "SUCCESS"),
      supabase
        .from("concerts")
        .select("id", { count: "exact", head: true }),
    ]);

  const totalRuns = totalRunsResult.count ?? 0;
  const successfulRuns = successfulRunsResult.count ?? 0;
  const totalConcerts = totalConcertsResult.count ?? 0;

  const isStale =
    !latestRun ||
    Date.now() - new Date(latestRun.started_at).getTime() >
      STALE_THRESHOLD_HOURS * 60 * 60 * 1000;

  const hoursSinceLastRun = latestRun
    ? (Date.now() - new Date(latestRun.started_at).getTime()) / (60 * 60 * 1000)
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
  const { data: existing } = await supabase
    .from("data_quality_alerts")
    .select("id")
    .eq("alert_type", "STALE_DATA")
    .eq("entity_type", "ScraperRun")
    .eq("entity_id", "kpopofficial")
    .is("resolved_at", null)
    .maybeSingle();

  if (!existing) {
    await supabase.from("data_quality_alerts").insert({
      id: crypto.randomUUID(),
      alert_type: "STALE_DATA",
      severity: "HIGH",
      entity_type: "ScraperRun",
      entity_id: "kpopofficial",
      message: `Scraper data is stale. No successful scrape in the last ${STALE_THRESHOLD_HOURS} hours.`,
    });
    console.log("[ALERT] Created STALE_DATA alert for kpopofficial scraper");
  }
}

async function resolveStaleAlerts() {
  const { data: resolved } = await supabase
    .from("data_quality_alerts")
    .update({ resolved_at: new Date().toISOString() })
    .eq("alert_type", "STALE_DATA")
    .eq("entity_type", "ScraperRun")
    .eq("entity_id", "kpopofficial")
    .is("resolved_at", null)
    .select("id");

  const count = resolved?.length ?? 0;
  if (count > 0) {
    console.log(`[ALERT] Resolved ${count} STALE_DATA alert(s)`);
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
      `[STATUS] Last run: ${stats.latestRun.started_at} (${stats.hoursSinceLastRun?.toFixed(1)}h ago) — ${stats.latestRun.status}`
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
    process.exit(stats.isStale ? 1 : 0);
  }

  if (!stats.isStale && !force) {
    console.log(
      `[SCHEDULED] Data is fresh (${stats.hoursSinceLastRun?.toFixed(1)}h old), skipping scrape`
    );
    process.exit(0);
  }

  console.log(
    force
      ? `[SCHEDULED] Force mode, running scraper`
      : `[SCHEDULED] Data is stale, running scraper`
  );

  const success = await runScraper();

  if (success) {
    await resolveStaleAlerts();
    console.log(`[SCHEDULED] Scrape completed successfully`);
  } else {
    console.error(`[SCHEDULED] Scrape failed`);
  }

  process.exit(success ? 0 : 1);
}

main().catch((err) => {
  console.error("[SCHEDULED] Fatal error:", err.message || err);
  process.exit(1);
});
