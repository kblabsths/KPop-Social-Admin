import { prisma } from "@/lib/prisma";
import { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const query = searchParams.get("q") || "";

  if (!query.trim()) {
    return Response.json({ concerts: [], artists: [], venues: [] });
  }

  const [concerts, artists, venues] = await Promise.all([
    prisma.concert.findMany({
      where: {
        title: { contains: query, mode: "insensitive" },
      },
      include: {
        artists: true,
        venue: true,
      },
      orderBy: { date: "asc" },
      take: 10,
    }),
    prisma.artist.findMany({
      where: {
        OR: [
          { name: { contains: query, mode: "insensitive" } },
          { koreanName: { contains: query, mode: "insensitive" } },
        ],
      },
      orderBy: { name: "asc" },
      take: 10,
    }),
    prisma.venue.findMany({
      where: {
        OR: [
          { name: { contains: query, mode: "insensitive" } },
          { city: { contains: query, mode: "insensitive" } },
        ],
      },
      orderBy: { name: "asc" },
      take: 10,
    }),
  ]);

  return Response.json({ concerts, artists, venues });
}
