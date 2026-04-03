import { prisma } from "@/lib/prisma";
import { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const query = searchParams.get("q") || "";
  const city = searchParams.get("city") || undefined;
  const country = searchParams.get("country") || undefined;
  const limit = Math.min(Number(searchParams.get("limit")) || 50, 100);
  const offset = Number(searchParams.get("offset")) || 0;

  const venues = await prisma.venue.findMany({
    where: {
      AND: [
        query
          ? { name: { contains: query, mode: "insensitive" } }
          : {},
        city ? { city: { contains: city, mode: "insensitive" } } : {},
        country ? { country: { contains: country, mode: "insensitive" } } : {},
      ],
    },
    include: {
      _count: { select: { concerts: true } },
    },
    orderBy: { name: "asc" },
    take: limit,
    skip: offset,
  });

  return Response.json(venues);
}
