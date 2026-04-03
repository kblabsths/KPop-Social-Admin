import { prisma } from "@/lib/prisma";
import { NextRequest } from "next/server";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const venue = await prisma.venue.findUnique({
    where: { id },
    include: {
      concerts: {
        where: { date: { gte: new Date() } },
        include: { artists: true },
        orderBy: { date: "asc" },
      },
    },
  });

  if (!venue) {
    return Response.json({ error: "Venue not found" }, { status: 404 });
  }

  return Response.json(venue);
}
