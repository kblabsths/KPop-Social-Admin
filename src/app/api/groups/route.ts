import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const query = searchParams.get("q") || "";
  const artistId = searchParams.get("artistId") || undefined;

  const groups = await prisma.group.findMany({
    where: {
      AND: [
        query
          ? { name: { contains: query, mode: "insensitive" } }
          : {},
        artistId ? { artistId } : {},
      ],
    },
    include: {
      artist: { select: { id: true, name: true, image: true } },
      _count: { select: { members: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return Response.json(groups);
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { name, description, artistId, image } = body;

  if (!name || typeof name !== "string" || name.trim().length === 0) {
    return Response.json({ error: "Name is required" }, { status: 400 });
  }

  const group = await prisma.group.create({
    data: {
      name: name.trim(),
      description: description || null,
      image: image || null,
      artistId: artistId || null,
      createdById: session.user.id,
      members: {
        create: {
          userId: session.user.id,
          role: "admin",
        },
      },
    },
    include: {
      artist: { select: { id: true, name: true } },
      _count: { select: { members: true } },
    },
  });

  return Response.json(group, { status: 201 });
}
