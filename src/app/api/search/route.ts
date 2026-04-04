import { getSupabaseAdmin } from "@/lib/supabase";
import { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const supabase = getSupabaseAdmin();
  const { searchParams } = request.nextUrl;
  const query = searchParams.get("q") || "";

  if (!query.trim()) {
    return Response.json({ concerts: [], artists: [], venues: [] });
  }

  const [concertsResult, artistsResult, venuesResult] = await Promise.all([
    supabase
      .from("concerts")
      .select("*, venue:venues(*), artists:concert_artists(artist:artists(*))")
      .ilike("title", `%${query}%`)
      .order("date", { ascending: true })
      .limit(10),
    supabase
      .from("artists")
      .select("*")
      .or(`name.ilike.%${query}%,korean_name.ilike.%${query}%`)
      .order("name", { ascending: true })
      .limit(10),
    supabase
      .from("venues")
      .select("*")
      .or(`name.ilike.%${query}%,city.ilike.%${query}%`)
      .order("name", { ascending: true })
      .limit(10),
  ]);

  const concerts = (concertsResult.data ?? []).map((c) => ({
    ...c,
    artists: (c.artists as { artist: unknown }[]).map((a) => a.artist),
  }));

  return Response.json({
    concerts,
    artists: artistsResult.data ?? [],
    venues: venuesResult.data ?? [],
  });
}
