import { getSupabaseAdmin } from "@/lib/supabase";
import { auth } from "@/lib/auth";
import { NextRequest } from "next/server";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = getSupabaseAdmin();
  const { id } = await params;
  const session = await auth();

  const { data: post, error } = await supabase
    .from("posts")
    .select(`
      *,
      author:web_users(id, name, image),
      group:groups(id, name),
      replies:posts!parent_id(
        *,
        author:web_users(id, name, image),
        likes_count:post_likes(count)
      ),
      replies_count:posts!parent_id(count),
      likes_count:post_likes(count)
    `)
    .eq("id", id)
    .maybeSingle();

  if (error) return Response.json({ error: error.message }, { status: 500 });

  if (!post) {
    return Response.json({ error: "Post not found" }, { status: 404 });
  }

  // Sort replies by created_at asc and flatten counts
  const replies = ((post.replies as Record<string, unknown>[]) ?? [])
    .sort((a, b) => new Date(a.created_at as string).getTime() - new Date(b.created_at as string).getTime())
    .map((r) => ({
      ...r,
      _count: { likes: (r.likes_count as { count: number }[])?.[0]?.count ?? 0 },
      likes_count: undefined,
    }));

  let userLiked = false;
  if (session?.user?.id) {
    const { data: like } = await supabase
      .from("post_likes")
      .select("id")
      .eq("user_id", session.user.id)
      .eq("post_id", id)
      .maybeSingle();
    userLiked = !!like;
  }

  const result = {
    ...post,
    replies,
    _count: {
      replies: (post.replies_count as { count: number }[])?.[0]?.count ?? 0,
      likes: (post.likes_count as { count: number }[])?.[0]?.count ?? 0,
    },
    replies_count: undefined,
    likes_count: undefined,
    userLiked,
  };

  return Response.json(result);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = getSupabaseAdmin();
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: post } = await supabase
    .from("posts")
    .select("id, author_id")
    .eq("id", id)
    .maybeSingle();

  if (!post) {
    return Response.json({ error: "Post not found" }, { status: 404 });
  }

  if (post.author_id !== session.user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { error } = await supabase.from("posts").delete().eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ success: true });
}
