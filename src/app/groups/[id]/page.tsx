import Link from "next/link";
import { notFound } from "next/navigation";
import { getSupabaseAdmin } from "@/lib/supabase";
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
  const supabase = getSupabaseAdmin();
  const session = await auth();

  const { data: group } = await supabase
    .from("groups")
    .select(`
      *,
      artist:artists(*),
      created_by:web_users!groups_created_by_id_fkey(id, name, image),
      members:group_members(*, user:web_users(id, name, image))
    `)
    .eq("id", id)
    .maybeSingle();

  if (!group) notFound();

  type RawMember = {
    id: string;
    user_id: string;
    role: string;
    joined_at: string;
    user: { id: string; name: string | null; image: string | null };
  };

  const members = ((group.members as RawMember[]) ?? []).sort(
    (a, b) => new Date(a.joined_at).getTime() - new Date(b.joined_at).getTime()
  );

  const isMember = session?.user?.id
    ? members.some((m) => m.user_id === session.user!.id)
    : false;

  const { data: postRows } = await supabase
    .from("posts")
    .select(`
      *,
      author:web_users(id, name, image),
      group:groups(id, name),
      replies_count:posts!parent_id(count),
      likes_count:post_likes(count)
    `)
    .eq("group_id", id)
    .is("parent_id", null)
    .order("created_at", { ascending: false })
    .limit(50);

  const posts = (postRows ?? []).map((p) => ({
    id: p.id as string,
    content: p.content as string,
    imageUrl: p.image_url as string | null,
    linkUrl: p.link_url as string | null,
    createdAt: p.created_at as string,
    author: p.author as { id: string; name: string | null; image: string | null },
    group: p.group as { id: string; name: string },
    _count: {
      replies: ((p.replies_count as { count: number }[])?.[0]?.count ?? 0),
      likes: ((p.likes_count as { count: number }[])?.[0]?.count ?? 0),
    },
  }));

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
                  src={group.image as string}
                  alt={group.name as string}
                  className="h-20 w-20 rounded-xl object-cover"
                />
              ) : (
                <div className="flex h-20 w-20 items-center justify-center rounded-xl bg-gradient-to-br from-purple-400 to-pink-400 text-2xl font-bold text-white">
                  {(group.name as string)[0]}
                </div>
              )}
              <div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                  {group.name as string}
                </h1>
                {group.artist && (
                  <Link
                    href={`/artists/${(group.artist as { id: string }).id}`}
                    className="text-sm text-purple-600 hover:underline dark:text-purple-400"
                  >
                    {(group.artist as { name: string }).name}
                  </Link>
                )}
                {group.description && (
                  <p className="mt-2 text-gray-600 dark:text-gray-300">
                    {group.description as string}
                  </p>
                )}
                <p className="mt-2 text-sm text-gray-400 dark:text-gray-500">
                  Created by {(group.created_by as { name: string | null } | null)?.name || "Unknown"} &middot;{" "}
                  {members.length} members
                </p>
              </div>
            </div>
            {session?.user && (
              <JoinLeaveButton groupId={group.id as string} isMember={isMember} />
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
                post={post}
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
          Members ({members.length})
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {members.map((member) => (
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
