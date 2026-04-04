import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin";
import { createConcertNotification } from "@/lib/notifications";
import { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
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

  const concerts = await prisma.concert.findMany({
    where: {
      AND: [
        query
          ? { title: { contains: query, mode: "insensitive" } }
          : {},
        artistId
          ? { artists: { some: { id: artistId } } }
          : {},
        venueId ? { venueId } : {},
        status ? { status } : {},
        eventType ? { eventType } : {},
        dateFrom ? { date: { gte: new Date(dateFrom) } } : {},
        dateTo ? { date: { lte: new Date(dateTo) } } : {},
      ],
    },
    include: {
      artists: true,
      venue: true,
    },
    orderBy: { date: "asc" },
    take: limit,
    skip: offset,
  });

  return Response.json(concerts);
}

export async function POST(request: NextRequest) {
  const { error } = await requireAdmin();
  if (error) return error;

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

  const concert = await prisma.concert.create({
    data: {
      title,
      slug,
      tourName: tourName ?? null,
      date: new Date(date),
      endDate: endDate ? new Date(endDate) : null,
      doorsOpen: doorsOpen ? new Date(doorsOpen) : null,
      status: status ?? "scheduled",
      ticketUrl: ticketUrl ?? null,
      priceRange: priceRange ?? null,
      imageUrl: imageUrl ?? null,
      description: description ?? null,
      eventType: eventType ?? "concert",
      externalIds: externalIds ?? null,
      venueId,
      source: source ?? null,
      sourceUrl: sourceUrl ?? null,
      artists: artistIds?.length
        ? { connect: (artistIds as string[]).map((id: string) => ({ id })) }
        : undefined,
    },
    include: { artists: true, venue: true },
  });

  // Fire-and-forget: notify followers of each artist on this concert
  if (concert.artists.length > 0) {
    const artistIds = concert.artists.map((a) => a.id);
    prisma.userArtistFollow
      .findMany({ where: { artistId: { in: artistIds } }, select: { userId: true } })
      .then((follows) => {
        const userIds = [...new Set(follows.map((f) => f.userId))];
        return Promise.all(
          userIds.map((userId) => createConcertNotification(userId, concert.id))
        );
      })
      .catch(() => {});
  }

  return Response.json(concert, { status: 201 });
}
