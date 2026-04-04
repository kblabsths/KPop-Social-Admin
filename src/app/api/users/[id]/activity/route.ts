import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { NextRequest } from "next/server";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: userId } = await params;

  // Verify user exists
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    return Response.json({ error: "User not found" }, { status: 404 });
  }

  // Check if this is the authenticated user's own profile
  const session = await auth();
  const isOwnProfile = session?.user?.id === userId;

  const now = new Date();

  // Run all queries in parallel
  const [concerts, artists, groups, posts, concertCount, artistFollowCount, groupCount, postCount] =
    await Promise.all([
      // Upcoming concerts with RSVP
      prisma.userConcert.findMany({
        where: {
          userId,
          concert: { date: { gte: now } },
        },
        include: {
          concert: {
            include: {
              artists: { select: { id: true, name: true, slug: true, image: true } },
              venue: { select: { id: true, name: true, city: true, country: true } },
            },
          },
        },
        orderBy: { concert: { date: "asc" } },
      }),

      // Followed artists
      prisma.userArtistFollow.findMany({
        where: { userId },
        include: {
          artist: {
            select: { id: true, name: true, slug: true, image: true, type: true, company: true },
          },
        },
        orderBy: { createdAt: "desc" },
      }),

      // Group memberships
      prisma.groupMember.findMany({
        where: { userId },
        include: {
          group: {
            select: { id: true, name: true, image: true, isOfficial: true, artistId: true },
          },
        },
        orderBy: { joinedAt: "desc" },
      }),

      // Recent top-level posts (limit 10)
      prisma.post.findMany({
        where: { authorId: userId, parentId: null },
        include: {
          group: { select: { id: true, name: true } },
          _count: { select: { likes: true, replies: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),

      // Stats counts
      prisma.userConcert.count({ where: { userId } }),
      prisma.userArtistFollow.count({ where: { userId } }),
      prisma.groupMember.count({ where: { userId } }),
      prisma.post.count({ where: { authorId: userId, parentId: null } }),
    ]);

  return Response.json({
    concerts: concerts.map((uc) => ({
      id: uc.id,
      status: uc.status,
      concert: uc.concert,
      createdAt: uc.createdAt,
    })),
    artists: artists.map((ua) => ({
      id: ua.id,
      artist: ua.artist,
      createdAt: ua.createdAt,
    })),
    groups: groups.map((gm) => ({
      id: gm.id,
      role: gm.role,
      group: gm.group,
      joinedAt: gm.joinedAt,
    })),
    posts: posts.map((p) => ({
      id: p.id,
      content: p.content,
      imageUrl: p.imageUrl,
      linkUrl: p.linkUrl,
      group: p.group,
      likeCount: p._count.likes,
      replyCount: p._count.replies,
      createdAt: p.createdAt,
    })),
    stats: {
      concertCount,
      artistFollowCount,
      groupCount,
      postCount,
    },
    isOwnProfile,
  });
}
