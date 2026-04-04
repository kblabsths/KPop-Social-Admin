import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { NextRequest } from "next/server";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const session = await auth();
  if (!session?.user?.id || session.user.id !== id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const data: { bio?: string | null; name?: string | null; favoriteArtists?: string[] } = {};

  if ("bio" in body) {
    data.bio = typeof body.bio === "string" ? body.bio.trim() || null : null;
  }
  if ("name" in body) {
    data.name = typeof body.name === "string" ? body.name.trim() || null : null;
  }
  if ("favoriteArtists" in body && Array.isArray(body.favoriteArtists)) {
    data.favoriteArtists = body.favoriteArtists.filter(
      (a: unknown) => typeof a === "string"
    );
  }

  const user = await prisma.user.update({
    where: { id },
    data,
    select: { id: true, name: true, bio: true, favoriteArtists: true },
  });

  return Response.json(user);
}
