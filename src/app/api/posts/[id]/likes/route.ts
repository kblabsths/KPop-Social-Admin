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

  const post = await prisma.post.findUnique({ where: { id } });
  if (!post) {
    return Response.json({ error: "Post not found" }, { status: 404 });
  }

  await prisma.postLike.upsert({
    where: { userId_postId: { userId: session.user.id, postId: id } },
    create: { userId: session.user.id, postId: id },
    update: {},
  });

  const count = await prisma.postLike.count({ where: { postId: id } });
  return Response.json({ liked: true, count });
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

  await prisma.postLike.deleteMany({
    where: { userId: session.user.id, postId: id },
  });

  const count = await prisma.postLike.count({ where: { postId: id } });
  return Response.json({ liked: false, count });
}
