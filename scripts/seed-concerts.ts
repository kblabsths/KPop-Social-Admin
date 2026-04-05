import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

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

async function upsertArtist(name: string, slug: string): Promise<string> {
  const { data: existing } = await supabase
    .from("artists")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  if (existing) return existing.id;

  const id = crypto.randomUUID();
  const { error } = await supabase
    .from("artists")
    .insert({ id, name, slug, type: "group" });
  if (error) throw error;
  return id;
}

async function upsertVenue(
  name: string,
  slug: string,
  city: string,
  country: string
): Promise<string> {
  const { data: existing } = await supabase
    .from("venues")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  if (existing) return existing.id;

  const id = crypto.randomUUID();
  const { error } = await supabase
    .from("venues")
    .insert({ id, name, slug, city, country });
  if (error) throw error;
  return id;
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
    const id = await upsertArtist(name, slug);
    artistMap.set(name, id);
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
    const id = await upsertVenue(city, slug, city, country);
    venueMap.set(key, id);
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
    const concertDate = c.date ? new Date(c.date).toISOString() : new Date("2026-12-31").toISOString();
    const slug = slugify(c.title) || slugify(`${c.artist.name}-${city}`);

    // Use sourceUrl as unique key to avoid duplicates
    const { data: existing } = await supabase
      .from("concerts")
      .select("id")
      .eq("source_url", c.sourceUrl)
      .maybeSingle();

    if (existing) {
      skipped++;
      continue;
    }

    // Ensure slug uniqueness by appending city if needed
    const { data: existingSlug } = await supabase
      .from("concerts")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();
    const finalSlug = existingSlug ? slugify(`${c.title}-${city}`) : slug;

    // Check again for slug collision
    const { data: existingFinalSlug } = await supabase
      .from("concerts")
      .select("id")
      .eq("slug", finalSlug)
      .maybeSingle();
    if (existingFinalSlug) {
      skipped++;
      continue;
    }

    const concertId = crypto.randomUUID();
    const { error: insertError } = await supabase.from("concerts").insert({
      id: concertId,
      title: c.title,
      slug: finalSlug,
      date: concertDate,
      status: c.status || "scheduled",
      event_type: c.eventType || "concert",
      source: "kpopofficial.com",
      source_url: c.sourceUrl,
      image_url: c.imageUrl,
      venue_id: venueId,
    });
    if (insertError) throw insertError;

    const { error: junctionError } = await supabase
      .from("concert_artists")
      .insert({ concert_id: concertId, artist_id: artistId });
    if (junctionError) throw junctionError;

    created++;
  }

  console.log(
    `Done: ${created} concerts created, ${skipped} skipped (duplicate or missing venue)`
  );
}

main().catch((e) => {
  console.error("Seed failed:", e);
  process.exit(1);
});
