import { getSupabaseAdmin } from "@/lib/supabase";
import { NextRequest } from "next/server";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = getSupabaseAdmin();
  const { id } = await params;

  const { data: concert, error } = await supabase
    .from("concerts")
    .select("*, venue:venues(*), artists:concert_artists(artist:artists(*))")
    .eq("id", id)
    .maybeSingle();

  if (error) return Response.json({ error: error.message }, { status: 500 });

  if (!concert) {
    return Response.json({ error: "Concert not found" }, { status: 404 });
  }

  const flat = {
    ...concert,
    artists: (concert.artists as { artist: unknown }[]).map((a) => a.artist),
  };

  return Response.json(flat);
}
