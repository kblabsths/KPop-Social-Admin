import { redirect } from "next/navigation";
import { getSupabaseAdmin } from "@/lib/supabase";
import { auth } from "@/lib/auth";
import Navbar from "@/app/components/navbar";
import PostCard from "@/app/components/post-card";
import Link from "next/link";

export default async function FeedPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const supabase = getSupabaseAdmin();

  const { data: memberships } = await supabase
    .from("group_members")
    .select("group_id")
    .eq("user_id", session.user.id);

  const groupIds = (memberships ?? []).map((m: { group_id: string }) => m.group_id);

  const postRows =
    groupIds.length > 0
      ? (
          await supabase
            .from("posts")
            .select(`
              *,
              author:web_users(id, name, image),
              group:groups(id, name),
              replies_count:posts!parent_id(count),
              likes_count:post_likes(count)
            `)
            .in("group_id", groupIds)
            .is("parent_id", null)
            .order("created_at", { ascending: false })
            .limit(50)
        ).data ?? []
      : [];

  const posts = postRows.map((p) => ({
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
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-purple-50 to-pink-50 dark:from-gray-950 dark:to-purple-950">
      <Navbar />
      <main className="mx-auto w-full max-w-2xl px-4 py-8">
        <h1 className="mb-6 text-2xl font-bold text-gray-900 dark:text-white">
          Your Feed
        </h1>

        {posts.length > 0 ? (
          <div className="space-y-4">
            {posts.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                showGroup
                currentUserId={session.user!.id}
              />
            ))}
          </div>
        ) : (
          <div className="text-center">
            <p className="mb-4 text-gray-500 dark:text-gray-400">
              {groupIds.length === 0
                ? "Join some groups to see posts in your feed!"
                : "No posts yet from your groups. Be the first to share something!"}
            </p>
            <Link
              href="/groups"
              className="inline-block rounded-lg bg-gradient-to-r from-purple-600 to-pink-600 px-6 py-2 text-sm font-medium text-white transition hover:from-purple-700 hover:to-pink-700"
            >
              Browse Groups
            </Link>
          </div>
        )}
      </main>
    </div>
  );
}
