import { getSupabaseAdmin } from "@/lib/supabase";
import { auth } from "@/lib/auth";
import { NextRequest } from "next/server";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = getSupabaseAdmin();
  const { id } = await params;

  const session = await auth();
  if (!session?.user?.id || session.user.id !== id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const updateData: { bio?: string | null; name?: string | null; favorite_artists?: string[] } = {};

  if ("bio" in body) {
    updateData.bio = typeof body.bio === "string" ? body.bio.trim() || null : null;
  }
  if ("name" in body) {
    updateData.name = typeof body.name === "string" ? body.name.trim() || null : null;
  }
  if ("favoriteArtists" in body && Array.isArray(body.favoriteArtists)) {
    updateData.favorite_artists = body.favoriteArtists.filter(
      (a: unknown) => typeof a === "string"
    );
  }

  const { data: user, error } = await supabase
    .from("web_users")
    .update({ ...updateData, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("id, name, bio, favorite_artists")
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json(user);
}
