/**
 * KPop Concert Web Scraper - Proof of Concept
 *
 * Target: kpopofficial.com/kpop-concerts/
 *
 * Site assessment:
 * - WordPress + Greenshift blocks, but server-renders article elements
 * - Static HTML fetch yields ~80 concert entries (no headless browser needed for index)
 * - Individual tour pages may need headless browser for full date tables
 * - No Cloudflare or CAPTCHA protection detected
 * - Content loaded via WP REST API is also available at /wp-json/ endpoints
 * - Site updates regularly (weekly or on new tour announcements)
 * - Last observed content update: 2026-01-29
 *
 * Output: Structured JSON matching planned Concert/Venue/Artist schema
 */

import * as cheerio from "cheerio";
import { writeFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const TARGET_URL = "https://kpopofficial.com/kpop-concerts/";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// Country code mapping for common abbreviations found on the site
const COUNTRY_MAP = {
  MY: "Malaysia",
  JP: "Japan",
  PH: "Philippines",
  TW: "Taiwan",
  US: "USA",
  USA: "USA",
  UK: "United Kingdom",
};

async function fetchPage(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return response.text();
}

/**
 * Parse the main kpopofficial.com concerts listing page.
 * Extracts individual concert/event entries from server-rendered articles.
 */
function parseConcertsIndex(html) {
  const $ = cheerio.load(html);
  const concerts = [];
  const seen = new Set();

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

    // Skip the first mega-entry (page header that concatenates all titles)
    // and skip entries without individual event links
    if (!title || !link || title.length > 200) return;

    // Deduplicate by URL
    if (seen.has(link)) return;
    seen.add(link);

    // Skip non-event pages (comebacks lists, general articles)
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

/**
 * Parse concert titles using the common patterns found on the site:
 *   "BTS World Tour ARIRANG 2026 – Tokyo, Japan"
 *   "IVE – "SHOW WHAT I AM" World Tour 2026 – Kuala Lumpur, MY"
 *   "Stray Kids Fan Meeting 2026 – Incheon, South Korea"
 *   "2026 LOVESOME FESTIVAL – Artist Lineup"
 *   "KCON JAPAN 2026 – Artists Lineup"
 */
function parseConcertTitle(title) {
  const result = {
    artistName: null,
    concertTitle: title,
    city: null,
    country: null,
    eventType: detectEventType(title),
    status: "scheduled",
  };

  if (title.toLowerCase().includes("[postponed]")) {
    result.status = "postponed";
  }

  // Split on dash/em-dash, which the site uses as delimiters
  const parts = title.split(/\s*[–—]\s*/);

  if (parts.length >= 3) {
    // Pattern: "ARTIST – Tour Name Year – City, Country"
    result.artistName = cleanArtistName(parts[0]);
    result.concertTitle = parts.slice(0, -1).join(" – ");
    parseLocation(parts[parts.length - 1], result);
  } else if (parts.length === 2) {
    // Pattern: "Artist Tour Name Year – City, Country"
    // or "Event Name – Lineup"
    const lastPart = parts[1].trim();

    if (
      lastPart.toLowerCase().includes("lineup") ||
      lastPart.toLowerCase().includes("winners")
    ) {
      // Festival/awards — no city extraction
      result.concertTitle = title;
      result.artistName = extractArtistFromEventTitle(parts[0]);
    } else {
      result.concertTitle = parts[0].trim();
      parseLocation(lastPart, result);
      result.artistName = extractArtistFromEventTitle(parts[0]);
    }
  } else {
    // Single segment — try to extract artist
    result.artistName = extractArtistFromEventTitle(title);
  }

  return result;
}

/**
 * Extract city and country from location strings like:
 *   "Tokyo, Japan"
 *   "Kuala Lumpur, MY"
 *   "Los Angeles, CA, USA"
 *   "Incheon, South Korea"
 *   "Incheon (Lineup)"
 */
function parseLocation(locationStr, result) {
  // Remove parenthetical notes like "(Lineup)", "(Winners & Lineup)"
  const cleaned = locationStr.replace(/\s*\(.*?\)\s*$/, "").trim();
  if (!cleaned) return;

  const parts = cleaned.split(/,\s*/);

  if (parts.length >= 3) {
    // "Los Angeles, CA, USA" or "Tampa, Florida, US"
    result.city = parts[0];
    result.country = COUNTRY_MAP[parts[2]] || parts[2];
  } else if (parts.length === 2) {
    result.city = parts[0];
    result.country = COUNTRY_MAP[parts[1]] || parts[1];
  } else {
    result.city = parts[0];
  }
}

/**
 * Extract artist name from a tour/event title.
 * Handles: "BTS World Tour ARIRANG 2026", "Stray Kids Fan Meeting 2026"
 */
function extractArtistFromEventTitle(titlePart) {
  const tourKeywords =
    /\b(world tour|concert|live tour|live party|fan ?meeting|fanmeeting|tour|showcase|festival|awards|song festival|gayo)\b/i;
  const match = titlePart.match(tourKeywords);
  if (match) {
    const before = titlePart.substring(0, match.index).trim();
    // Remove year prefixes like "2026"
    const cleaned = before.replace(/^\d{4}\s+/, "").trim();
    return cleaned || null;
  }

  // Remove year and common suffixes
  const cleaned = titlePart
    .replace(/\s+\d{4}(\/\d{4})?\s*$/, "")
    .replace(/\s*[–—-]\s*$/, "")
    .trim();
  return cleaned || null;
}

function cleanArtistName(name) {
  return name
    .replace(/^\[POSTPONED\]\s*/i, "")
    .replace(/\s+\d{4}\s*$/, "")
    .trim();
}

function detectEventType(title) {
  const lower = title.toLowerCase();
  if (lower.includes("fan meeting") || lower.includes("fanmeeting"))
    return "fan_meeting";
  if (lower.includes("festival") || lower.includes("fest")) return "festival";
  if (lower.includes("showcase")) return "showcase";
  if (lower.includes("awards")) return "awards";
  if (lower.includes("countdown")) return "festival";
  return "concert";
}

/**
 * Transform parsed concert into the planned schema format.
 */
function toSchemaFormat(concert) {
  return {
    title: concert.concertTitle,
    date: null, // Requires individual tour page scraping for specific dates
    status: concert.status,
    eventType: concert.eventType,
    source: concert.source,
    sourceUrl: concert.sourceUrl,
    imageUrl: concert.imageUrl,
    artist: {
      name: concert.artistName,
    },
    venue: {
      city: concert.city,
      country: concert.country,
    },
  };
}

/**
 * Parse an individual tour/event page for date/venue details.
 * Tour pages typically have tables with Date | Venue | City | Country columns.
 */
function parseTourPage(html) {
  const $ = cheerio.load(html);
  const dates = [];

  // Table-based tour dates
  $("table").each((_i, table) => {
    const rows = $(table).find("tr");
    rows.each((_j, row) => {
      const cells = $(row).find("td");
      if (cells.length >= 2) {
        const texts = [];
        cells.each((_k, cell) => texts.push($(cell).text().trim()));
        dates.push({
          date: texts[0] || null,
          venue: texts[1] || null,
          city: texts[2] || null,
          country: texts[3] || null,
          ticketUrl:
            $(row).find('a[href*="ticket"]').attr("href") ||
            $(row).find("a").first().attr("href") ||
            null,
        });
      }
    });
  });

  return dates;
}

async function main() {
  console.log("=== KPop Concert Scraper - Proof of Concept ===\n");
  console.log(`Target: ${TARGET_URL}`);
  console.log(`Timestamp: ${new Date().toISOString()}\n`);

  // Fetch and parse the main concerts listing
  const html = await fetchPage(TARGET_URL);
  console.log(`Fetched ${html.length.toLocaleString()} bytes of HTML\n`);

  const concerts = parseConcertsIndex(html);
  console.log(`Extracted ${concerts.length} unique concert/event entries\n`);

  // Transform to schema format
  const schemaOutput = concerts.map(toSchemaFormat);

  // Show stats
  const artists = new Set(
    concerts.map((c) => c.artistName).filter(Boolean)
  );
  const cities = new Set(concerts.map((c) => c.city).filter(Boolean));
  const countries = new Set(
    concerts.map((c) => c.country).filter(Boolean)
  );
  const eventTypes = {};
  concerts.forEach((c) => {
    eventTypes[c.eventType] = (eventTypes[c.eventType] || 0) + 1;
  });

  console.log("--- Data Summary ---");
  console.log(`  Unique artists: ${artists.size}`);
  console.log(`  Unique cities:  ${cities.size}`);
  console.log(`  Unique countries: ${countries.size}`);
  console.log(`  Event types:`, eventTypes);
  console.log(`  Artists found: ${[...artists].sort().join(", ")}`);
  console.log("");

  // Print first 10 entries as sample
  console.log("--- Sample entries (first 10) ---\n");
  schemaOutput.slice(0, 10).forEach((entry, i) => {
    console.log(
      `${i + 1}. ${entry.artist.name || "?"} | ${entry.title} | ${entry.venue.city || "?"}, ${entry.venue.country || "?"}`
    );
  });

  // Write full output to JSON file
  const outputPath = join(__dirname, "..", "data", "scraped-concerts.json");
  const outputDir = join(__dirname, "..", "data");

  // Ensure data directory exists
  const { mkdir } = await import("fs/promises");
  await mkdir(outputDir, { recursive: true });

  const output = {
    scrapedAt: new Date().toISOString(),
    source: TARGET_URL,
    totalEntries: schemaOutput.length,
    summary: {
      uniqueArtists: artists.size,
      uniqueCities: cities.size,
      uniqueCountries: countries.size,
      eventTypes,
    },
    concerts: schemaOutput,
  };

  await writeFile(outputPath, JSON.stringify(output, null, 2));
  console.log(`\nFull output written to: data/scraped-concerts.json`);

  // --- Site Assessment ---
  console.log("\n=== Site Assessment: kpopofficial.com ===\n");
  console.log("Anti-scraping measures:");
  console.log("  - No Cloudflare or CAPTCHA protection");
  console.log("  - Server-renders article elements (cheerio works for index page)");
  console.log(
    "  - Individual tour pages may use more JS rendering (Greenshift blocks)"
  );
  console.log("  - WP REST API endpoints available at /wp-json/");
  console.log("");
  console.log("Data freshness:");
  console.log("  - Pages updated regularly on tour announcements");
  console.log("  - Index page covers 2025-2027 events");
  console.log("  - Recommend daily or weekly sync for production use");
  console.log("");
  console.log("Schema compatibility:");
  console.log("  - Artist name: extracted from title heuristics");
  console.log("  - Concert title: full event title");
  console.log("  - City/Country: parsed from location suffix");
  console.log("  - Venue: requires individual page scraping");
  console.log("  - Date: requires individual page scraping");
  console.log("  - Ticket URL: available on individual pages");
  console.log("  - Image: available for most entries");
  console.log("");
  console.log("Recommended next steps for production:");
  console.log("  1. Crawl individual tour pages for date/venue/ticket details");
  console.log("  2. Add rate limiting (1-2 sec delay between requests)");
  console.log("  3. Explore WP REST API (/wp-json/) for structured data access");
  console.log("  4. Combine with Ticketmaster API for richer data");
  console.log("  5. Set up periodic sync with lastSyncedAt tracking");
}

main().catch(console.error);
