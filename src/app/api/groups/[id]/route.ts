import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { NextRequest } from "next/server";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await auth();

  const group = await prisma.group.findUnique({
    where: { id },
    include: {
      artist: true,
      createdBy: { select: { id: true, name: true, image: true } },
      members: {
        include: {
          user: { select: { id: true, name: true, image: true } },
        },
        orderBy: { joinedAt: "asc" },
      },
      _count: { select: { members: true } },
    },
  });

  if (!group) {
    return Response.json({ error: "Group not found" }, { status: 404 });
  }

  const isMember = session?.user?.id
    ? group.members.some((m) => m.userId === session.user!.id)
    : false;

  return Response.json({ ...group, isMember });
}
