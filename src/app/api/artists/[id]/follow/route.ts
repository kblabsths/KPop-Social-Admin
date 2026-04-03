import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { NextRequest } from "next/server";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const artist = await prisma.artist.findUnique({ where: { id } });
  if (!artist) {
    return Response.json({ error: "Artist not found" }, { status: 404 });
  }

  const existing = await prisma.userArtistFollow.findUnique({
    where: { userId_artistId: { userId: session.user.id, artistId: id } },
  });

  if (existing) {
    return Response.json({ error: "Already following" }, { status: 409 });
  }

  const follow = await prisma.userArtistFollow.create({
    data: {
      userId: session.user.id,
      artistId: id,
    },
  });

  return Response.json(follow, { status: 201 });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const existing = await prisma.userArtistFollow.findUnique({
    where: { userId_artistId: { userId: session.user.id, artistId: id } },
  });

  if (!existing) {
    return Response.json({ error: "Not following this artist" }, { status: 404 });
  }

  await prisma.userArtistFollow.delete({
    where: { userId_artistId: { userId: session.user.id, artistId: id } },
  });

  return Response.json({ removed: true });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const artist = await prisma.artist.findUnique({ where: { id } });
    if (!artist) {
      return Response.json({ error: "Artist not found" }, { status: 404 });
    }

    const followerCount = await prisma.userArtistFollow.count({
      where: { artistId: id },
    });

    let isFollowing = false;
    const session = await auth();
    if (session?.user?.id) {
      const follow = await prisma.userArtistFollow.findUnique({
        where: { userId_artistId: { userId: session.user.id, artistId: id } },
      });
      isFollowing = !!follow;
    }

    return Response.json({ followerCount, isFollowing });
  } catch (error) {
    console.error("Failed to fetch follow data:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
