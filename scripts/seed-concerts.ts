import "dotenv/config";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import * as fs from "fs";
import * as path from "path";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

interface ScrapedConcert {
  title: string;
  date: string | null;
  status: string;
  eventType: string;
  source: string;
  sourceUrl: string;
  imageUrl: string | null;
  artist: { name: string };
  venue: { city: string | null; country: string | null };
}

interface ScrapedData {
  concerts: ScrapedConcert[];
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim();
}

async function main() {
  const dataPath = path.join(__dirname, "..", "data", "scraped-concerts.json");
  const raw = fs.readFileSync(dataPath, "utf-8");
  const data: ScrapedData = JSON.parse(raw);

  console.log(`Loaded ${data.concerts.length} concert entries`);

  // Deduplicate artists by name
  const artistNames = [...new Set(data.concerts.map((c) => c.artist.name))];
  console.log(`Found ${artistNames.length} unique artists`);

  const artistMap = new Map<string, string>(); // name -> id
  for (const name of artistNames) {
    const slug = slugify(name);
    const artist = await prisma.artist.upsert({
      where: { slug },
      create: { name, slug, type: "group" },
      update: {},
    });
    artistMap.set(name, artist.id);
  }
  console.log(`Upserted ${artistMap.size} artists`);

  // Deduplicate venues by city+country, skip entries with no city
  const venueKeys = new Map<string, { city: string; country: string }>();
  for (const c of data.concerts) {
    const city = c.venue.city;
    if (!city) continue;
    const country = c.venue.country || "Unknown";
    const key = `${city}|${country}`;
    if (!venueKeys.has(key)) {
      venueKeys.set(key, { city, country });
    }
  }
  console.log(`Found ${venueKeys.size} unique venues`);

  const venueMap = new Map<string, string>(); // "city|country" -> id
  for (const [key, { city, country }] of venueKeys) {
    const slug = slugify(`${city}-${country}`);
    const venue = await prisma.venue.upsert({
      where: { slug },
      create: { name: city, slug, city, country },
      update: {},
    });
    venueMap.set(key, venue.id);
  }
  console.log(`Upserted ${venueMap.size} venues`);

  // Create concerts
  let created = 0;
  let skipped = 0;
  for (const c of data.concerts) {
    const artistId = artistMap.get(c.artist.name);
    if (!artistId) {
      console.warn(`Skipping concert "${c.title}": artist not found`);
      skipped++;
      continue;
    }

    const city = c.venue.city;
    const country = c.venue.country || "Unknown";
    const venueKey = `${city}|${country}`;
    const venueId = city ? venueMap.get(venueKey) : null;

    if (!venueId) {
      console.warn(
        `Skipping concert "${c.title}": no venue (city=${city}, country=${country})`
      );
      skipped++;
      continue;
    }

    // All dates are null in this dataset; use a placeholder date
    const concertDate = c.date ? new Date(c.date) : new Date("2026-12-31");
    const slug = slugify(c.title) || slugify(`${c.artist.name}-${city}`);

    // Use sourceUrl as unique key to avoid duplicates
    const existing = await prisma.concert.findFirst({
      where: { sourceUrl: c.sourceUrl },
    });

    if (existing) {
      skipped++;
      continue;
    }

    // Ensure slug uniqueness by appending city if needed
    const existingSlug = await prisma.concert.findUnique({
      where: { slug },
    });
    const finalSlug = existingSlug ? slugify(`${c.title}-${city}`) : slug;

    // Check again for slug collision
    const existingFinalSlug = await prisma.concert.findUnique({
      where: { slug: finalSlug },
    });
    if (existingFinalSlug) {
      // Already exists with this slug, skip
      skipped++;
      continue;
    }

    await prisma.concert.create({
      data: {
        title: c.title,
        slug: finalSlug,
        date: concertDate,
        status: c.status || "scheduled",
        eventType: c.eventType || "concert",
        source: "kpopofficial.com",
        sourceUrl: c.sourceUrl,
        imageUrl: c.imageUrl,
        venueId,
        artists: { connect: [{ id: artistId }] },
      },
    });
    created++;
  }

  console.log(
    `Done: ${created} concerts created, ${skipped} skipped (duplicate or missing venue)`
  );
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
