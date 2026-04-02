import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import JoinLeaveButton from "./join-leave-button";
import CreatePostForm from "./create-post-form";
import PostCard from "@/app/components/post-card";

export default async function GroupDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
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
    },
  });

  if (!group) notFound();

  const isMember = session?.user?.id
    ? group.members.some((m) => m.userId === session.user!.id)
    : false;

  const posts = await prisma.post.findMany({
    where: { groupId: id, parentId: null },
    include: {
      author: { select: { id: true, name: true, image: true } },
      group: { select: { id: true, name: true } },
      _count: { select: { replies: true, likes: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8">
        <Link
          href="/groups"
          className="mb-6 inline-block text-sm text-purple-600 hover:underline dark:text-purple-400"
        >
          &larr; All Groups
        </Link>

        <div className="mb-8 rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-4">
              {group.image ? (
                <img
                  src={group.image}
                  alt={group.name}
                  className="h-20 w-20 rounded-xl object-cover"
                />
              ) : (
                <div className="flex h-20 w-20 items-center justify-center rounded-xl bg-gradient-to-br from-purple-400 to-pink-400 text-2xl font-bold text-white">
                  {group.name[0]}
                </div>
              )}
              <div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                  {group.name}
                </h1>
                {group.artist && (
                  <Link
                    href={`/artists/${group.artist.id}`}
                    className="text-sm text-purple-600 hover:underline dark:text-purple-400"
                  >
                    {group.artist.name}
                  </Link>
                )}
                {group.description && (
                  <p className="mt-2 text-gray-600 dark:text-gray-300">
                    {group.description}
                  </p>
                )}
                <p className="mt-2 text-sm text-gray-400 dark:text-gray-500">
                  Created by {group.createdBy.name || "Unknown"} &middot;{" "}
                  {group.members.length} members
                </p>
              </div>
            </div>
            {session?.user && (
              <JoinLeaveButton groupId={group.id} isMember={isMember} />
            )}
          </div>
        </div>

        {/* Posts Section */}
        <h2 className="mb-4 text-xl font-semibold text-gray-900 dark:text-white">
          Discussion
        </h2>

        {isMember && <div className="mb-6"><CreatePostForm groupId={id} /></div>}

        {posts.length > 0 ? (
          <div className="mb-8 space-y-4">
            {posts.map((post) => (
              <PostCard
                key={post.id}
                post={{ ...post, createdAt: post.createdAt.toISOString() }}
                currentUserId={session?.user?.id}
              />
            ))}
          </div>
        ) : (
          <p className="mb-8 text-center text-gray-500 dark:text-gray-400">
            No posts yet. {isMember ? "Be the first to share something!" : "Join the group to start a discussion."}
          </p>
        )}

        <h2 className="mb-4 text-xl font-semibold text-gray-900 dark:text-white">
          Members ({group.members.length})
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {group.members.map((member) => (
            <Link
              key={member.id}
              href={`/profile/${member.user.id}`}
              className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-3 transition hover:border-purple-300 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-purple-700"
            >
              {member.user.image ? (
                <img
                  src={member.user.image}
                  alt={member.user.name || ""}
                  className="h-10 w-10 rounded-full object-cover"
                />
              ) : (
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-purple-400 to-pink-400 text-sm font-bold text-white">
                  {(member.user.name || "?")[0]}
                </div>
              )}
              <div>
                <p className="font-medium text-gray-900 dark:text-white">
                  {member.user.name || "Anonymous"}
                </p>
                <p className="text-xs text-gray-400 dark:text-gray-500">
                  {member.role === "admin" ? "Admin" : "Member"}
                </p>
              </div>
            </Link>
          ))}
        </div>
      </main>
  );
}
