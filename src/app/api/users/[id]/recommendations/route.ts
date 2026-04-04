import { prisma } from "@/lib/prisma";
import { NextRequest } from "next/server";

const CONCERT_LIMIT = 10;

const concertSelect = {
  id: true,
  title: true,
  slug: true,
  date: true,
  imageUrl: true,
  status: true,
  venue: { select: { id: true, name: true, city: true, country: true } },
  artists: { select: { id: true, name: true, slug: true, image: true } },
  _count: { select: { rsvps: true } },
} as const;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: userId } = await params;
  const now = new Date();

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    return Response.json({ error: "User not found" }, { status: 404 });
  }

  const [follows, rsvps] = await Promise.all([
    prisma.userArtistFollow.findMany({
      where: { userId },
      select: { artistId: true, artist: { select: { id: true, name: true } } },
    }),
    prisma.userConcert.findMany({
      where: { userId },
      select: { concertId: true },
    }),
  ]);

  const rsvpdConcertIds = rsvps.map((r) => r.concertId);
  const followedArtistIds = follows.map((f) => f.artistId);
  const artistNameById = new Map(follows.map((f) => [f.artistId, f.artist.name]));

  // Fallback for users with no followed artists
  if (followedArtistIds.length === 0) {
    const popular = await prisma.concert.findMany({
      where: {
        date: { gte: now },
        status: { not: "cancelled" },
        id: { notIn: rsvpdConcertIds },
      },
      select: concertSelect,
      orderBy: [{ rsvps: { _count: "desc" } }, { date: "asc" }],
      take: CONCERT_LIMIT,
    });

    if (popular.length === 0) {
      return Response.json([]);
    }

    return Response.json(
      popular.map((c) => ({ concert: c, reason: "Popular upcoming concert" }))
    );
  }

  // Primary: concerts featuring followed artists, excluding already-RSVPd ones
  const directMatches = await prisma.concert.findMany({
    where: {
      date: { gte: now },
      status: { not: "cancelled" },
      id: { notIn: rsvpdConcertIds },
      artists: { some: { id: { in: followedArtistIds } } },
    },
    select: concertSelect,
    orderBy: { date: "asc" },
    take: CONCERT_LIMIT,
  });

  type ConcertResult = { concert: (typeof directMatches)[0]; reason: string };
  const results: ConcertResult[] = [];
  const usedIds = new Set<string>();

  for (const concert of directMatches) {
    const matched = concert.artists.find((a) => followedArtistIds.includes(a.id));
    const artistName = matched ? (artistNameById.get(matched.id) ?? matched.name) : "";
    results.push({ concert, reason: `Because you follow ${artistName}` });
    usedIds.add(concert.id);
  }

  // Fill remaining slots with popular concerts
  if (results.length < CONCERT_LIMIT) {
    const excludeIds = [...rsvpdConcertIds, ...usedIds];
    const popular = await prisma.concert.findMany({
      where: {
        date: { gte: now },
        status: { not: "cancelled" },
        id: { notIn: excludeIds },
      },
      select: concertSelect,
      orderBy: [{ rsvps: { _count: "desc" } }, { date: "asc" }],
      take: CONCERT_LIMIT - results.length,
    });
    for (const c of popular) {
      results.push({ concert: c, reason: "Popular with KPop fans" });
    }
  }

  return Response.json(results);
}
