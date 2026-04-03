import { prisma } from "@/lib/prisma";
import { NextRequest } from "next/server";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const concert = await prisma.concert.findUnique({
    where: { id },
    include: {
      artists: true,
      venue: true,
    },
  });

  if (!concert) {
    return Response.json({ error: "Concert not found" }, { status: 404 });
  }

  return Response.json(concert);
}
