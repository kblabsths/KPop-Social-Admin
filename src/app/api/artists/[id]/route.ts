import { prisma } from "@/lib/prisma";
import { NextRequest } from "next/server";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const artist = await prisma.artist.findUnique({
    where: { id },
    include: {
      groups: {
        include: {
          _count: { select: { members: true } },
        },
      },
    },
  });

  if (!artist) {
    return Response.json({ error: "Artist not found" }, { status: 404 });
  }

  return Response.json(artist);
}
