import { getSupabaseAdmin } from "@/lib/supabase";
import { NextRequest } from "next/server";

const CONCERT_LIMIT = 10;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = getSupabaseAdmin();
  const { id: userId } = await params;
  const now = new Date().toISOString();

  const { data: user } = await supabase
    .from("web_users")
    .select("id")
    .eq("id", userId)
    .maybeSingle();

  if (!user) {
    return Response.json({ error: "User not found" }, { status: 404 });
  }

  const [followsResult, rsvpsResult] = await Promise.all([
    supabase
      .from("user_artist_follows")
      .select("artist_id, artist:artists(id, name)")
      .eq("user_id", userId),
    supabase
      .from("user_concerts")
      .select("concert_id")
      .eq("user_id", userId),
  ]);

  const rsvpdConcertIds = (rsvpsResult.data ?? []).map((r) => r.concert_id);
  const followedArtistIds = (followsResult.data ?? []).map((f) => f.artist_id);
  const artistNameById = new Map(
    (followsResult.data ?? []).map((f) => [
      f.artist_id,
      (f.artist as unknown as { id: string; name: string } | null)?.name ?? "",
    ])
  );

  type ConcertRow = Record<string, unknown>;
  type ConcertResult = { concert: ConcertRow; reason: string };

  const flattenConcert = (c: ConcertRow): ConcertRow => ({
    ...c,
    artists: ((c.artists as { artist: unknown }[]) ?? []).map((a) => a.artist),
  });

  // Fallback for users with no followed artists
  if (followedArtistIds.length === 0) {
    let popularQuery = supabase
      .from("concerts")
      .select("*, venue:venues(id, name, city, country), artists:concert_artists(artist:artists(id, name, slug, image)), rsvp_count:user_concerts(count)")
      .gte("date", now)
      .neq("status", "cancelled")
      .order("date", { ascending: true })
      .limit(CONCERT_LIMIT);

    if (rsvpdConcertIds.length > 0) {
      popularQuery = popularQuery.not("id", "in", `(${rsvpdConcertIds.join(",")})`);
    }

    const { data: popular } = await popularQuery;
    if (!popular || popular.length === 0) {
      return Response.json([]);
    }

    return Response.json(
      popular.map((c) => ({ concert: flattenConcert(c as ConcertRow), reason: "Popular upcoming concert" }))
    );
  }

  // Primary: concerts featuring followed artists, excluding already-RSVPd ones
  // We need to find concerts that have at least one of the followed artists
  // Fetch concerts from concert_artists join for the followed artist IDs
  const { data: concertArtistLinks } = await supabase
    .from("concert_artists")
    .select("concert_id")
    .in("artist_id", followedArtistIds);

  const matchingConcertIds = [...new Set((concertArtistLinks ?? []).map((ca) => ca.concert_id))];

  let directMatches: ConcertRow[] = [];

  if (matchingConcertIds.length > 0) {
    const eligibleIds = matchingConcertIds.filter((cid) => !rsvpdConcertIds.includes(cid));

    if (eligibleIds.length > 0) {
      let directQuery = supabase
        .from("concerts")
        .select("*, venue:venues(id, name, city, country), artists:concert_artists(artist:artists(id, name, slug, image))")
        .in("id", eligibleIds)
        .gte("date", now)
        .neq("status", "cancelled")
        .order("date", { ascending: true })
        .limit(CONCERT_LIMIT);

      const { data } = await directQuery;
      directMatches = (data ?? []) as ConcertRow[];
    }
  }

  const results: ConcertResult[] = [];
  const usedIds = new Set<string>();

  for (const concert of directMatches) {
    const flatArtists = ((concert.artists as { artist: { id: string; name: string } }[]) ?? []).map((a) => a.artist);
    const matched = flatArtists.find((a) => followedArtistIds.includes(a.id));
    const artistName = matched ? (artistNameById.get(matched.id) ?? matched.name) : "";
    results.push({ concert: flattenConcert(concert), reason: `Because you follow ${artistName}` });
    usedIds.add(concert.id as string);
  }

  // Fill remaining slots with popular concerts
  if (results.length < CONCERT_LIMIT) {
    const excludeIds = [...rsvpdConcertIds, ...usedIds];

    let popularQuery = supabase
      .from("concerts")
      .select("*, venue:venues(id, name, city, country), artists:concert_artists(artist:artists(id, name, slug, image))")
      .gte("date", now)
      .neq("status", "cancelled")
      .order("date", { ascending: true })
      .limit(CONCERT_LIMIT - results.length);

    if (excludeIds.length > 0) {
      popularQuery = popularQuery.not("id", "in", `(${excludeIds.join(",")})`);
    }

    const { data: popular } = await popularQuery;
    for (const c of popular ?? []) {
      results.push({ concert: flattenConcert(c as ConcertRow), reason: "Popular with KPop fans" });
    }
  }

  return Response.json(results);
}
