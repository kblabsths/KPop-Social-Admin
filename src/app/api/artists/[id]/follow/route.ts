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

  const { data: artist } = await supabase
    .from("artists")
    .select("id")
    .eq("id", id)
    .maybeSingle();

  if (!artist) {
    return Response.json({ error: "Artist not found" }, { status: 404 });
  }

  const { data: existing } = await supabase
    .from("user_artist_follows")
    .select("id")
    .eq("user_id", session.user.id)
    .eq("artist_id", id)
    .maybeSingle();

  if (existing) {
    return Response.json({ error: "Already following" }, { status: 409 });
  }

  const { data: follow, error } = await supabase
    .from("user_artist_follows")
    .insert({ id: crypto.randomUUID(), user_id: session.user.id, artist_id: id })
    .select()
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json(follow, { status: 201 });
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

  const { data: existing } = await supabase
    .from("user_artist_follows")
    .select("id")
    .eq("user_id", session.user.id)
    .eq("artist_id", id)
    .maybeSingle();

  if (!existing) {
    return Response.json({ error: "Not following this artist" }, { status: 404 });
  }

  const { error } = await supabase
    .from("user_artist_follows")
    .delete()
    .eq("user_id", session.user.id)
    .eq("artist_id", id);

  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ removed: true });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = getSupabaseAdmin();
  const { id } = await params;

  try {
    const { data: artist } = await supabase
      .from("artists")
      .select("id")
      .eq("id", id)
      .maybeSingle();

    if (!artist) {
      return Response.json({ error: "Artist not found" }, { status: 404 });
    }

    const { count: followerCount } = await supabase
      .from("user_artist_follows")
      .select("*", { count: "exact", head: true })
      .eq("artist_id", id);

    let isFollowing = false;
    const session = await auth();
    if (session?.user?.id) {
      const { data: follow } = await supabase
        .from("user_artist_follows")
        .select("id")
        .eq("user_id", session.user.id)
        .eq("artist_id", id)
        .maybeSingle();
      isFollowing = !!follow;
    }

    return Response.json({ followerCount: followerCount ?? 0, isFollowing });
  } catch (error) {
    console.error("Failed to fetch follow data:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
