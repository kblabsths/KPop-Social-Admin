import { getSupabaseAdmin } from "@/lib/supabase";
import { NextRequest } from "next/server";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = getSupabaseAdmin();
  const { id } = await params;

  const { data: artist, error } = await supabase
    .from("artists")
    .select("*, groups(*)")
    .eq("id", id)
    .maybeSingle();

  if (error) return Response.json({ error: error.message }, { status: 500 });

  if (!artist) {
    return Response.json({ error: "Artist not found" }, { status: 404 });
  }

  return Response.json(artist);
}
