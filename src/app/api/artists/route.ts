import { getSupabaseAdmin } from "@/lib/supabase";
import { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const supabase = getSupabaseAdmin();
  const { searchParams } = request.nextUrl;
  const query = searchParams.get("q") || "";
  const type = searchParams.get("type") || undefined;

  let queryBuilder = supabase
    .from("artists")
    .select("*")
    .order("name", { ascending: true });

  if (type) queryBuilder = queryBuilder.eq("type", type);

  if (query) {
    queryBuilder = queryBuilder.or(
      `name.ilike.%${query}%,korean_name.ilike.%${query}%`
    );
  }

  const { data: artists, error } = await queryBuilder;
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json(artists ?? []);
}
