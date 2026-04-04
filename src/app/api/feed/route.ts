import { getSupabaseAdmin } from "@/lib/supabase";
import { auth } from "@/lib/auth";

export async function GET() {
  const supabase = getSupabaseAdmin();
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Get all groups the user is a member of
  const { data: memberships, error: memberError } = await supabase
    .from("group_members")
    .select("group_id")
    .eq("user_id", session.user.id);

  if (memberError) return Response.json({ error: memberError.message }, { status: 500 });

  const groupIds = (memberships ?? []).map((m) => m.group_id);

  if (groupIds.length === 0) {
    return Response.json([]);
  }

  // Get top-level posts from all joined groups
  const { data: posts, error } = await supabase
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
    .limit(50);

  if (error) return Response.json({ error: error.message }, { status: 500 });

  const result = (posts ?? []).map((p) => ({
    ...p,
    _count: {
      replies: (p.replies_count as { count: number }[])?.[0]?.count ?? 0,
      likes: (p.likes_count as { count: number }[])?.[0]?.count ?? 0,
    },
    replies_count: undefined,
    likes_count: undefined,
  }));

  return Response.json(result);
}
