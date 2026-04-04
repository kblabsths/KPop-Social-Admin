import { getSupabaseAdmin } from "@/lib/supabase";
import { auth } from "@/lib/auth";
import { createGroupPostNotification } from "@/lib/notifications";
import { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const supabase = getSupabaseAdmin();
  const { searchParams } = request.nextUrl;
  const groupId = searchParams.get("groupId");

  if (!groupId) {
    return Response.json({ error: "groupId is required" }, { status: 400 });
  }

  const { data: posts, error } = await supabase
    .from("posts")
    .select(`
      *,
      author:web_users(id, name, image),
      replies_count:posts!parent_id(count),
      likes_count:post_likes(count)
    `)
    .eq("group_id", groupId)
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

export async function POST(request: NextRequest) {
  const supabase = getSupabaseAdmin();
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { content, groupId, imageUrl, linkUrl, parentId } = body;

  if (!content || typeof content !== "string" || content.trim().length === 0) {
    return Response.json({ error: "Content is required" }, { status: 400 });
  }

  if (!groupId) {
    return Response.json({ error: "groupId is required" }, { status: 400 });
  }

  // Verify user is a member of the group
  const { data: membership } = await supabase
    .from("group_members")
    .select("id")
    .eq("user_id", session.user.id)
    .eq("group_id", groupId)
    .maybeSingle();

  if (!membership) {
    return Response.json(
      { error: "You must be a member of this group to post" },
      { status: 403 }
    );
  }

  const postId = crypto.randomUUID();

  const { data: post, error } = await supabase
    .from("posts")
    .insert({
      id: postId,
      content: content.trim(),
      image_url: imageUrl || null,
      link_url: linkUrl || null,
      author_id: session.user.id,
      group_id: groupId,
      parent_id: parentId || null,
    })
    .select(`
      *,
      author:web_users(id, name, image),
      replies_count:posts!parent_id(count),
      likes_count:post_likes(count)
    `)
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });

  const result = {
    ...post,
    _count: {
      replies: (post.replies_count as { count: number }[])?.[0]?.count ?? 0,
      likes: (post.likes_count as { count: number }[])?.[0]?.count ?? 0,
    },
    replies_count: undefined,
    likes_count: undefined,
  };

  // Fire-and-forget: notify group members of the new post
  void createGroupPostNotification(session.user.id, groupId, postId);

  return Response.json(result, { status: 201 });
}
