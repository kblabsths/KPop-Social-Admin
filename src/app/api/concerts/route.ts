import { prisma } from "@/lib/prisma";
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
