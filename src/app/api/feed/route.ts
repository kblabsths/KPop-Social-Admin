import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Get all groups the user is a member of
  const memberships = await prisma.groupMember.findMany({
    where: { userId: session.user.id },
    select: { groupId: true },
  });

  const groupIds = memberships.map((m) => m.groupId);

  if (groupIds.length === 0) {
    return Response.json([]);
  }

  // Get top-level posts from all joined groups
  const posts = await prisma.post.findMany({
    where: { groupId: { in: groupIds }, parentId: null },
    include: {
      author: { select: { id: true, name: true, image: true } },
      group: { select: { id: true, name: true } },
      _count: { select: { replies: true, likes: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return Response.json(posts);
}
