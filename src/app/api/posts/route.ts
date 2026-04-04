import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { createGroupPostNotification } from "@/lib/notifications";
import { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const groupId = searchParams.get("groupId");

  if (!groupId) {
    return Response.json({ error: "groupId is required" }, { status: 400 });
  }

  const posts = await prisma.post.findMany({
    where: { groupId, parentId: null },
    include: {
      author: { select: { id: true, name: true, image: true } },
      _count: { select: { replies: true, likes: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return Response.json(posts);
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { content, groupId, imageUrl, linkUrl, parentId } = body;

  if (!content || typeof content !== "string" || content.trim().length === 0) {
    return Response.json({ error: "Content is required" }, { status: 400 });
  }

  if (!groupId) {
    return Response.json({ error: "groupId is required" }, { status: 400 });
  }

  // Verify user is a member of the group
  const membership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId: session.user.id, groupId } },
  });

  if (!membership) {
    return Response.json(
      { error: "You must be a member of this group to post" },
      { status: 403 }
    );
  }

  const post = await prisma.post.create({
    data: {
      content: content.trim(),
      imageUrl: imageUrl || null,
      linkUrl: linkUrl || null,
      authorId: session.user.id,
      groupId,
      parentId: parentId || null,
    },
    include: {
      author: { select: { id: true, name: true, image: true } },
      _count: { select: { replies: true, likes: true } },
    },
  });

  // Fire-and-forget: notify group members of the new post
  void createGroupPostNotification(session.user.id, groupId, post.id);

  return Response.json(post, { status: 201 });
}
