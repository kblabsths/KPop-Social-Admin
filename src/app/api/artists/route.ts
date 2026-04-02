import { prisma } from "@/lib/prisma";
import { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const query = searchParams.get("q") || "";
  const type = searchParams.get("type") || undefined;

  const artists = await prisma.artist.findMany({
    where: {
      AND: [
        query
          ? {
              OR: [
                { name: { contains: query, mode: "insensitive" } },
                { koreanName: { contains: query, mode: "insensitive" } },
              ],
            }
          : {},
        type ? { type } : {},
      ],
    },
    include: {
      _count: { select: { groups: true } },
    },
    orderBy: { name: "asc" },
  });

  return Response.json(artists);
}
