import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { NextRequest } from "next/server";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await auth();

  const post = await prisma.post.findUnique({
    where: { id },
    include: {
      author: { select: { id: true, name: true, image: true } },
      group: { select: { id: true, name: true } },
      replies: {
        include: {
          author: { select: { id: true, name: true, image: true } },
          _count: { select: { likes: true } },
        },
        orderBy: { createdAt: "asc" },
      },
      _count: { select: { replies: true, likes: true } },
    },
  });

  if (!post) {
    return Response.json({ error: "Post not found" }, { status: 404 });
  }

  let userLiked = false;
  if (session?.user?.id) {
    const like = await prisma.postLike.findUnique({
      where: { userId_postId: { userId: session.user.id, postId: id } },
    });
    userLiked = !!like;
  }

  return Response.json({ ...post, userLiked });
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

  const post = await prisma.post.findUnique({ where: { id } });
  if (!post) {
    return Response.json({ error: "Post not found" }, { status: 404 });
  }

  if (post.authorId !== session.user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  await prisma.post.delete({ where: { id } });
  return Response.json({ success: true });
}
