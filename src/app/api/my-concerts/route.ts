import { getSupabaseAdmin } from "@/lib/supabase";
import { auth } from "@/lib/auth";
import { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const supabase = getSupabaseAdmin();
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const { searchParams } = request.nextUrl;
  const showPast = searchParams.get("past") === "true";
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? "20", 10)));
  const skip = (page - 1) * limit;

  const now = new Date().toISOString();

  // 1. Get concerts the user RSVP'd to
  let rsvpQuery = supabase
    .from("user_concerts")
    .select(`
      id, status, concert_id,
      concert:concerts(
        *,
        venue:venues(id, name, city, country),
        artists:concert_artists(artist:artists(id, name, slug, image))
      )
    `)
    .eq("user_id", userId)
    .order("concert(date)", { ascending: true });

  if (showPast) {
    rsvpQuery = rsvpQuery.lt("concert.date", now);
  } else {
    rsvpQuery = rsvpQuery.gte("concert.date", now);
  }

  const { data: rsvpConcerts } = await rsvpQuery;
  const validRsvps = (rsvpConcerts ?? []).filter((r) => r.concert !== null);

  const rsvpConcertIds = validRsvps.map((r) => r.concert_id);

  // 2. Get concerts from followed artists that the user hasn't RSVP'd to
  const { data: followedArtistRows } = await supabase
    .from("user_artist_follows")
    .select("artist_id")
    .eq("user_id", userId);

  const artistIds = (followedArtistRows ?? []).map((f) => f.artist_id);

  type FollowedConcertItem = {
    concert: Record<string, unknown>;
    source: "followed_artist";
  };

  let followedArtistConcerts: FollowedConcertItem[] = [];

  if (artistIds.length > 0) {
    // Find concert IDs that have these artists
    const { data: concertArtistLinks } = await supabase
      .from("concert_artists")
      .select("concert_id")
      .in("artist_id", artistIds);

    const matchingConcertIds = [...new Set((concertArtistLinks ?? []).map((ca) => ca.concert_id))];
    const eligibleIds = matchingConcertIds.filter((cid) => !rsvpConcertIds.includes(cid));

    if (eligibleIds.length > 0) {
      let faQuery = supabase
        .from("concerts")
        .select(`
          *,
          venue:venues(id, name, city, country),
          artists:concert_artists(artist:artists(id, name, slug, image))
        `)
        .in("id", eligibleIds)
        .order("date", { ascending: true });

      if (showPast) {
        faQuery = faQuery.lt("date", now);
      } else {
        faQuery = faQuery.gte("date", now);
      }

      const { data: faConcerts } = await faQuery;
      followedArtistConcerts = (faConcerts ?? []).map((c) => ({
        concert: c as Record<string, unknown>,
        source: "followed_artist" as const,
      }));
    }
  }

  const flatConcert = (c: Record<string, unknown>) => ({
    ...c,
    artists: ((c.artists as { artist: unknown }[]) ?? []).map((a) => a.artist),
  });

  // 3. Merge and sort by date
  const allItems = [
    ...validRsvps.map((r) => {
      const concert = r.concert as unknown as Record<string, unknown>;
      return {
        id: concert.id as string,
        title: concert.title,
        slug: concert.slug,
        date: concert.date,
        end_date: concert.end_date,
        status: concert.status,
        event_type: concert.event_type,
        image_url: concert.image_url,
        venue: concert.venue,
        artists: ((concert.artists as { artist: unknown }[]) ?? []).map((a) => a.artist),
        rsvpStatus: r.status,
        source: "rsvp" as const,
      };
    }),
    ...followedArtistConcerts.map((f) => ({
      id: f.concert.id as string,
      title: f.concert.title,
      slug: f.concert.slug,
      date: f.concert.date,
      end_date: f.concert.end_date,
      status: f.concert.status,
      event_type: f.concert.event_type,
      image_url: f.concert.image_url,
      venue: f.concert.venue,
      artists: ((f.concert.artists as { artist: unknown }[]) ?? []).map((a) => a.artist),
      rsvpStatus: null,
      source: f.source,
    })),
  ].sort((a, b) => new Date(a.date as string).getTime() - new Date(b.date as string).getTime());

  const total = allItems.length;
  const paginated = allItems.slice(skip, skip + limit);

  return Response.json({
    concerts: paginated,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}
