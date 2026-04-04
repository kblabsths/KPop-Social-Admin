import { getSupabaseAdmin } from "@/lib/supabase";
import { auth } from "@/lib/auth";
import { NextRequest } from "next/server";

export async function POST(
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
    .select("id")
    .eq("id", id)
    .maybeSingle();

  if (!post) {
    return Response.json({ error: "Post not found" }, { status: 404 });
  }

  // Upsert: insert only if not already liked
  const { data: existing } = await supabase
    .from("post_likes")
    .select("id")
    .eq("user_id", session.user.id)
    .eq("post_id", id)
    .maybeSingle();

  if (!existing) {
    await supabase.from("post_likes").insert({
      id: crypto.randomUUID(),
      user_id: session.user.id,
      post_id: id,
    });
  }

  const { count } = await supabase
    .from("post_likes")
    .select("*", { count: "exact", head: true })
    .eq("post_id", id);

  return Response.json({ liked: true, count: count ?? 0 });
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

  await supabase
    .from("post_likes")
    .delete()
    .eq("user_id", session.user.id)
    .eq("post_id", id);

  const { count } = await supabase
    .from("post_likes")
    .select("*", { count: "exact", head: true })
    .eq("post_id", id);

  return Response.json({ liked: false, count: count ?? 0 });
}
