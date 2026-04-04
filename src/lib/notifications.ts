import { prisma } from "@/lib/prisma";

/**
 * Creates a notification for a user when a followed artist has a new concert.
 * Fire-and-forget — do not await in the request path.
 */
export async function createConcertNotification(
  userId: string,
  concertId: string
): Promise<void> {
  const concert = await prisma.concert.findUnique({
    where: { id: concertId },
    select: { title: true },
  });
  if (!concert) return;

  await prisma.notification.create({
    data: {
      userId,
      type: "new_concert",
      title: "New concert announced",
      body: concert.title,
      link: `/concerts/${concertId}`,
    },
  });
}

/**
 * Creates a notification for all group members when someone posts in a group.
 * Skips the post author. Fire-and-forget — do not await in the request path.
 */
export async function createGroupPostNotification(
  authorId: string,
  groupId: string,
  postId: string
): Promise<void> {
  const [group, members] = await Promise.all([
    prisma.group.findUnique({ where: { id: groupId }, select: { name: true } }),
    prisma.groupMember.findMany({
      where: { groupId, userId: { not: authorId } },
      select: { userId: true },
    }),
  ]);

  if (!group || members.length === 0) return;

  await prisma.notification.createMany({
    data: members.map(({ userId }) => ({
      userId,
      type: "group_post" as const,
      title: `New post in ${group.name}`,
      body: "Someone posted in a group you belong to.",
      link: `/groups/${groupId}/posts/${postId}`,
    })),
  });
}
