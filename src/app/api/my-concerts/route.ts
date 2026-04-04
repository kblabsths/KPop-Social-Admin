import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
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

  const now = new Date();
  const dateFilter = showPast ? { lt: now } : { gte: now };

  // 1. Get concerts the user RSVP'd to
  const [rsvpConcerts, rsvpTotal] = await Promise.all([
    prisma.userConcert.findMany({
      where: {
        userId,
        concert: { date: dateFilter },
      },
      include: {
        concert: {
          include: {
            venue: { select: { id: true, name: true, city: true, country: true } },
            artists: { select: { id: true, name: true, slug: true, image: true } },
          },
        },
      },
      orderBy: { concert: { date: "asc" } },
    }),
    prisma.userConcert.count({
      where: {
        userId,
        concert: { date: dateFilter },
      },
    }),
  ]);

  // 2. Get concerts from followed artists that the user hasn't RSVP'd to
  const followedArtistIds = await prisma.userArtistFollow.findMany({
    where: { userId },
    select: { artistId: true },
  });

  const artistIds = followedArtistIds.map((f) => f.artistId);

  const rsvpConcertIds = rsvpConcerts.map((r) => r.concertId);

  let followedArtistConcerts: Array<{
    concert: typeof rsvpConcerts[number]["concert"];
    source: "followed_artist";
  }> = [];

  if (artistIds.length > 0) {
    const faConcerts = await prisma.concert.findMany({
      where: {
        date: dateFilter,
        artists: { some: { id: { in: artistIds } } },
        id: { notIn: rsvpConcertIds },
      },
      include: {
        venue: { select: { id: true, name: true, city: true, country: true } },
        artists: { select: { id: true, name: true, slug: true, image: true } },
      },
      orderBy: { date: "asc" },
    });

    followedArtistConcerts = faConcerts.map((concert) => ({
      concert,
      source: "followed_artist" as const,
    }));
  }

  // 3. Merge and sort by date
  const allItems = [
    ...rsvpConcerts.map((r) => ({
      id: r.concert.id,
      title: r.concert.title,
      slug: r.concert.slug,
      date: r.concert.date,
      endDate: r.concert.endDate,
      status: r.concert.status,
      eventType: r.concert.eventType,
      imageUrl: r.concert.imageUrl,
      venue: r.concert.venue,
      artists: r.concert.artists,
      rsvpStatus: r.status,
      source: "rsvp" as const,
    })),
    ...followedArtistConcerts.map((f) => ({
      id: f.concert.id,
      title: f.concert.title,
      slug: f.concert.slug,
      date: f.concert.date,
      endDate: f.concert.endDate,
      status: f.concert.status,
      eventType: f.concert.eventType,
      imageUrl: f.concert.imageUrl,
      venue: f.concert.venue,
      artists: f.concert.artists,
      rsvpStatus: null,
      source: f.source,
    })),
  ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

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
