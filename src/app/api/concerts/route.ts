import { getSupabaseAdmin } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin";
import { createConcertNotification } from "@/lib/notifications";
import { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const supabase = getSupabaseAdmin();
  const { searchParams } = request.nextUrl;
  const query = searchParams.get("q") || "";
  const artistId = searchParams.get("artistId") || undefined;
  const venueId = searchParams.get("venueId") || undefined;
  const status = searchParams.get("status") || undefined;
  const eventType = searchParams.get("eventType") || undefined;
  const dateFrom = searchParams.get("dateFrom") || undefined;
  const dateTo = searchParams.get("dateTo") || undefined;
  const limit = Math.min(Number(searchParams.get("limit")) || 50, 100);
  const offset = Number(searchParams.get("offset")) || 0;

  let queryBuilder = supabase
    .from("concerts")
    .select("*, venue:venues(*), artists:concert_artists(artist:artists(*))")
    .order("date", { ascending: true })
    .range(offset, offset + limit - 1);

  if (query) queryBuilder = queryBuilder.ilike("title", `%${query}%`);
  if (venueId) queryBuilder = queryBuilder.eq("venue_id", venueId);
  if (status) queryBuilder = queryBuilder.eq("status", status);
  if (eventType) queryBuilder = queryBuilder.eq("event_type", eventType);
  if (dateFrom) queryBuilder = queryBuilder.gte("date", new Date(dateFrom).toISOString());
  if (dateTo) queryBuilder = queryBuilder.lte("date", new Date(dateTo).toISOString());

  const { data: concerts, error } = await queryBuilder;
  if (error) return Response.json({ error: error.message }, { status: 500 });

  // If filtering by artistId, filter in JS since Supabase doesn't easily support join filter
  let result = concerts ?? [];
  if (artistId) {
    result = result.filter((c) =>
      (c.artists as { artist: { id: string } }[]).some((a) => a.artist?.id === artistId)
    );
  }

  // Flatten nested artists for a cleaner response shape
  const flat = result.map((c) => ({
    ...c,
    artists: (c.artists as { artist: unknown }[]).map((a) => a.artist),
  }));

  return Response.json(flat);
}

export async function POST(request: NextRequest) {
  const supabase = getSupabaseAdmin();
  const { error: adminError } = await requireAdmin();
  if (adminError) return adminError;

  const body = await request.json();
  const {
    title, slug, tourName, date, endDate, doorsOpen, status,
    ticketUrl, priceRange, imageUrl, description, eventType,
    externalIds, venueId, artistIds, source, sourceUrl,
  } = body;

  if (!title || !slug || !date || !venueId) {
    return Response.json(
      { error: "title, slug, date, and venueId are required" },
      { status: 400 }
    );
  }

  const concertId = crypto.randomUUID();

  const { data: concert, error: insertError } = await supabase
    .from("concerts")
    .insert({
      id: concertId,
      title,
      slug,
      tour_name: tourName ?? null,
      date: new Date(date).toISOString(),
      end_date: endDate ? new Date(endDate).toISOString() : null,
      doors_open: doorsOpen ? new Date(doorsOpen).toISOString() : null,
      status: status ?? "scheduled",
      ticket_url: ticketUrl ?? null,
      price_range: priceRange ?? null,
      image_url: imageUrl ?? null,
      description: description ?? null,
      event_type: eventType ?? "concert",
      external_ids: externalIds ?? null,
      venue_id: venueId,
      source: source ?? null,
      source_url: sourceUrl ?? null,
    })
    .select()
    .single();

  if (insertError) return Response.json({ error: insertError.message }, { status: 500 });

  // Connect artists via concert_artists join table
  if (artistIds?.length) {
    const joins = (artistIds as string[]).map((aid) => ({
      concert_id: concertId,
      artist_id: aid,
    }));
    await supabase.from("concert_artists").insert(joins);
  }

  // Fetch full concert with relations
  const { data: fullConcert } = await supabase
    .from("concerts")
    .select("*, venue:venues(*), artists:concert_artists(artist:artists(*))")
    .eq("id", concertId)
    .single();

  const flatConcert = fullConcert
    ? {
        ...fullConcert,
        artists: (fullConcert.artists as { artist: unknown }[]).map((a) => a.artist),
      }
    : concert;

  // Fire-and-forget: notify followers of each artist on this concert
  if (artistIds?.length) {
    Promise.resolve(
      supabase
        .from("user_artist_follows")
        .select("user_id")
        .in("artist_id", artistIds as string[])
    )
      .then(({ data: follows }) => {
        if (!follows) return;
        const userIds = [...new Set(follows.map((f) => f.user_id))];
        return Promise.all(
          userIds.map((userId) => createConcertNotification(userId, concertId))
        );
      })
      .catch(() => {});
  }

  return Response.json(flatConcert, { status: 201 });
}
