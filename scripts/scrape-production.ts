/**
 * KPop Concert Production Scraper
 *
 * Integrates the PoC scraper with ScraperRun tracking and direct DB writes.
 * Creates ScraperRun, ScraperLog, and DataQualityAlert records.
 * Upserts Artist, Venue, and Concert records via Prisma.
 *
 * Usage: npx tsx scripts/scrape-production.ts
 */

import "dotenv/config";
import * as cheerio from "cheerio";
import { PrismaClient, Prisma } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const TARGET_URL = "https://kpopofficial.com/kpop-concerts/";
const SCRAPER_NAME = "kpopofficial";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const COUNTRY_MAP: Record<string, string> = {
  MY: "Malaysia",
  JP: "Japan",
  PH: "Philippines",
  TW: "Taiwan",
  US: "USA",
  USA: "USA",
  UK: "United Kingdom",
};

interface ParsedConcert {
  artistName: string | null;
  concertTitle: string;
  city: string | null;
  country: string | null;
  eventType: string;
  status: string;
  sourceUrl: string | null;
  imageUrl: string | null;
  source: string;
}

// --- Scraping logic (from PoC) ---

async function fetchPage(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  return response.text();
}

function parseConcertsIndex(html: string): ParsedConcert[] {
  const $ = cheerio.load(html);
  const concerts: ParsedConcert[] = [];
  const seen = new Set<string>();

  $(".gspbgrid_item, .wp-block-post, article").each((_i, el) => {
    const $el = $(el);
    const title = $el
      .find(".gspb-dynamic-title-element, .entry-title, h2, h3")
      .text()
      .trim();
    const link = $el.find("a").first().attr("href") || null;
    const image =
      $el.find("img").first().attr("src") ||
      $el.find("img").first().attr("data-src") ||
      null;

    if (!title || !link || title.length > 200) return;
    if (seen.has(link)) return;
    seen.add(link);
    if (link === TARGET_URL) return;
    if (
      title.toLowerCase().includes("upcoming kpop comebacks") ||
      title.toLowerCase().includes("schedule 2026/2027")
    )
      return;

    const parsed = parseConcertTitle(title);
    concerts.push({
      ...parsed,
      sourceUrl: link,
      imageUrl: image,
      source: "kpopofficial.com",
    });
  });

  return concerts;
}

function parseConcertTitle(title: string) {
  const result = {
    artistName: null as string | null,
    concertTitle: title,
    city: null as string | null,
    country: null as string | null,
    eventType: detectEventType(title),
    status: "scheduled",
  };

  if (title.toLowerCase().includes("[postponed]")) {
    result.status = "postponed";
  }

  const parts = title.split(/\s*[–—]\s*/);

  if (parts.length >= 3) {
    result.artistName = cleanArtistName(parts[0]);
    result.concertTitle = parts.slice(0, -1).join(" – ");
    parseLocation(parts[parts.length - 1], result);
  } else if (parts.length === 2) {
    const lastPart = parts[1].trim();
    if (
      lastPart.toLowerCase().includes("lineup") ||
      lastPart.toLowerCase().includes("winners")
    ) {
      result.concertTitle = title;
      result.artistName = extractArtistFromEventTitle(parts[0]);
    } else {
      result.concertTitle = parts[0].trim();
      parseLocation(lastPart, result);
      result.artistName = extractArtistFromEventTitle(parts[0]);
    }
  } else {
    result.artistName = extractArtistFromEventTitle(title);
  }

  return result;
}

function parseLocation(
  locationStr: string,
  result: { city: string | null; country: string | null }
) {
  const cleaned = locationStr.replace(/\s*\(.*?\)\s*$/, "").trim();
  if (!cleaned) return;
  const parts = cleaned.split(/,\s*/);
  if (parts.length >= 3) {
    result.city = parts[0];
    result.country = COUNTRY_MAP[parts[2]] || parts[2];
  } else if (parts.length === 2) {
    result.city = parts[0];
    result.country = COUNTRY_MAP[parts[1]] || parts[1];
  } else {
    result.city = parts[0];
  }
}

function extractArtistFromEventTitle(titlePart: string): string | null {
  const tourKeywords =
    /\b(world tour|concert|live tour|live party|fan ?meeting|fanmeeting|tour|showcase|festival|awards|song festival|gayo)\b/i;
  const match = titlePart.match(tourKeywords);
  if (match) {
    const before = titlePart.substring(0, match.index).trim();
    const cleaned = before.replace(/^\d{4}\s+/, "").trim();
    return cleaned || null;
  }
  const cleaned = titlePart
    .replace(/\s+\d{4}(\/\d{4})?\s*$/, "")
    .replace(/\s*[–—-]\s*$/, "")
    .trim();
  return cleaned || null;
}

function cleanArtistName(name: string): string {
  return name
    .replace(/^\[POSTPONED\]\s*/i, "")
    .replace(/\s+\d{4}\s*$/, "")
    .trim();
}

function detectEventType(title: string): string {
  const lower = title.toLowerCase();
  if (lower.includes("fan meeting") || lower.includes("fanmeeting"))
    return "fan_meeting";
  if (lower.includes("festival") || lower.includes("fest")) return "festival";
  if (lower.includes("showcase")) return "showcase";
  if (lower.includes("awards")) return "awards";
  if (lower.includes("countdown")) return "festival";
  return "concert";
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// --- DB integration ---

async function log(
  scraperRunId: string,
  level: "INFO" | "WARN" | "ERROR",
  message: string,
  metadata?: Record<string, unknown>
) {
  await prisma.scraperLog.create({
    data: { scraperRunId, level, message, metadata: (metadata ?? undefined) as Prisma.InputJsonValue | undefined },
  });
}

async function createAlert(
  alertType: "MISSING_FIELD" | "DUPLICATE" | "STALE_DATA" | "INCONSISTENCY",
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
  entityType: string,
  entityId: string,
  message: string
) {
  await prisma.dataQualityAlert.create({
    data: { alertType, severity, entityType, entityId, message },
  });
}

async function upsertArtist(name: string): Promise<string> {
  const slug = slugify(name);
  const artist = await prisma.artist.upsert({
    where: { slug },
    create: { name, slug },
    update: { updatedAt: new Date() },
  });
  return artist.id;
}

async function upsertVenue(
  city: string,
  country: string | null
): Promise<string> {
  const venueName = country ? `${city}, ${country}` : city;
  const slug = slugify(venueName);
  const venue = await prisma.venue.upsert({
    where: { slug },
    create: { name: venueName, slug, city, country: country || "Unknown" },
    update: { updatedAt: new Date() },
  });
  return venue.id;
}

async function main() {
  console.log("=== KPop Concert Production Scraper ===\n");

  // Step 1: Create ScraperRun
  const run = await prisma.scraperRun.create({
    data: { scraperName: SCRAPER_NAME, status: "RUNNING" },
  });
  console.log(`ScraperRun created: ${run.id}`);

  let recordsCreated = 0;
  let recordsUpdated = 0;
  let recordsFailed = 0;

  try {
    // Step 2: Fetch and parse
    await log(run.id, "INFO", `Starting scrape of ${TARGET_URL}`);
    const html = await fetchPage(TARGET_URL);
    await log(run.id, "INFO", `Fetched ${html.length} bytes of HTML`);

    const concerts = parseConcertsIndex(html);
    await log(run.id, "INFO", `Parsed ${concerts.length} concert entries`);
    console.log(`Parsed ${concerts.length} concert entries\n`);

    // Step 3: Process each concert
    const seenSlugs = new Set<string>();

    for (const concert of concerts) {
      try {
        const concertSlug = slugify(concert.concertTitle);

        // Check for duplicate slugs within this run
        if (seenSlugs.has(concertSlug)) {
          await log(run.id, "WARN", `Duplicate concert entry: ${concert.concertTitle}`, {
            slug: concertSlug,
          });
          await createAlert(
            "DUPLICATE",
            "LOW",
            "Concert",
            concertSlug,
            `Duplicate concert entry detected: "${concert.concertTitle}"`
          );
          recordsFailed++;
          continue;
        }
        seenSlugs.add(concertSlug);

        // Alert: missing date (all entries from index page lack dates)
        await createAlert(
          "MISSING_FIELD",
          "MEDIUM",
          "Concert",
          concertSlug,
          `Missing date field for concert: "${concert.concertTitle}"`
        );

        // Alert: missing venue/country
        if (!concert.city || !concert.country) {
          await createAlert(
            "MISSING_FIELD",
            "LOW",
            "Concert",
            concertSlug,
            `Missing venue/country info for: "${concert.concertTitle}" (city: ${concert.city ?? "null"}, country: ${concert.country ?? "null"})`
          );
        }

        // Upsert Artist
        let artistId: string | null = null;
        if (concert.artistName) {
          artistId = await upsertArtist(concert.artistName);
          await log(run.id, "INFO", `Upserted artist: ${concert.artistName}`, {
            artistId,
          });
        } else {
          await log(run.id, "WARN", `No artist name for: ${concert.concertTitle}`);
        }

        // Upsert Venue (use city or fallback)
        const venueCity = concert.city || "Unknown";
        const venueId = await upsertVenue(venueCity, concert.country);
        await log(run.id, "INFO", `Upserted venue: ${venueCity}, ${concert.country ?? "Unknown"}`, {
          venueId,
        });

        // Upsert Concert
        const existing = await prisma.concert.findUnique({
          where: { slug: concertSlug },
        });

        if (existing) {
          await prisma.concert.update({
            where: { slug: concertSlug },
            data: {
              title: concert.concertTitle,
              status: concert.status,
              eventType: concert.eventType,
              source: concert.source,
              sourceUrl: concert.sourceUrl,
              imageUrl: concert.imageUrl,
              venueId,
              lastSyncedAt: new Date(),
            },
          });
          if (artistId) {
            await prisma.concert.update({
              where: { slug: concertSlug },
              data: { artists: { set: [{ id: artistId }] } },
            });
          }
          recordsUpdated++;
          await log(run.id, "INFO", `Updated concert: ${concert.concertTitle}`, {
            concertId: existing.id,
          });
        } else {
          const created = await prisma.concert.create({
            data: {
              title: concert.concertTitle,
              slug: concertSlug,
              date: new Date(), // placeholder — date extraction requires individual page scraping
              status: concert.status,
              eventType: concert.eventType,
              source: concert.source,
              sourceUrl: concert.sourceUrl,
              imageUrl: concert.imageUrl,
              venueId,
              lastSyncedAt: new Date(),
              ...(artistId
                ? { artists: { connect: [{ id: artistId }] } }
                : {}),
            },
          });
          recordsCreated++;
          await log(run.id, "INFO", `Created concert: ${concert.concertTitle}`, {
            concertId: created.id,
          });
        }

        console.log(
          `  ✓ ${concert.artistName || "?"} | ${concert.concertTitle}`
        );
      } catch (err) {
        recordsFailed++;
        const message =
          err instanceof Error ? err.message : String(err);
        await log(
          run.id,
          "ERROR",
          `Failed to process: ${concert.concertTitle} — ${message}`,
          { concert }
        );
        console.error(
          `  ✗ ${concert.concertTitle}: ${message}`
        );
      }
    }

    // Step 4: Finalize ScraperRun
    const finalStatus =
      recordsFailed > 0 && recordsCreated + recordsUpdated > 0
        ? "PARTIAL"
        : recordsFailed > 0
          ? "FAILED"
          : "SUCCESS";

    await prisma.scraperRun.update({
      where: { id: run.id },
      data: {
        status: finalStatus,
        finishedAt: new Date(),
        recordsCreated,
        recordsUpdated,
        recordsFailed,
      },
    });

    await log(
      run.id,
      "INFO",
      `Scraper finished: ${finalStatus} — created: ${recordsCreated}, updated: ${recordsUpdated}, failed: ${recordsFailed}`
    );

    console.log(`\n=== Scraper Complete ===`);
    console.log(`Status: ${finalStatus}`);
    console.log(
      `Records — created: ${recordsCreated}, updated: ${recordsUpdated}, failed: ${recordsFailed}`
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.scraperRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        recordsCreated,
        recordsUpdated,
        recordsFailed,
        errorMessage: message,
      },
    });
    await log(run.id, "ERROR", `Scraper failed: ${message}`);
    console.error(`\nScraper FAILED: ${message}`);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("Fatal error:", err.message || err);
  process.exit(1);
});
