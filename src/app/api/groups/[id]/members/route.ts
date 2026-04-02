import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { NextRequest } from "next/server";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const group = await prisma.group.findUnique({ where: { id } });
  if (!group) {
    return Response.json({ error: "Group not found" }, { status: 404 });
  }

  const existing = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId: session.user.id, groupId: id } },
  });

  if (existing) {
    return Response.json({ error: "Already a member" }, { status: 409 });
  }

  const member = await prisma.groupMember.create({
    data: {
      userId: session.user.id,
      groupId: id,
    },
    include: {
      user: { select: { id: true, name: true, image: true } },
    },
  });

  return Response.json(member, { status: 201 });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const membership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId: session.user.id, groupId: id } },
  });

  if (!membership) {
    return Response.json({ error: "Not a member" }, { status: 404 });
  }

  await prisma.groupMember.delete({
    where: { id: membership.id },
  });

  return Response.json({ success: true });
}
