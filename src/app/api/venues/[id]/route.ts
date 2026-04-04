import { getSupabaseAdmin } from "@/lib/supabase";
import { NextRequest } from "next/server";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = getSupabaseAdmin();
  const { id } = await params;

  const { data: venue, error } = await supabase
    .from("venues")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) return Response.json({ error: error.message }, { status: 500 });

  if (!venue) {
    return Response.json({ error: "Venue not found" }, { status: 404 });
  }

  // Fetch upcoming concerts for this venue with their artists
  const now = new Date().toISOString();
  const { data: concertsRaw } = await supabase
    .from("concerts")
    .select("*, artists:concert_artists(artist:artists(*))")
    .eq("venue_id", id)
    .gte("date", now)
    .order("date", { ascending: true });

  const concerts = (concertsRaw ?? []).map((c) => ({
    ...c,
    artists: (c.artists as { artist: unknown }[]).map((a) => a.artist),
  }));

  return Response.json({ ...venue, concerts });
}
