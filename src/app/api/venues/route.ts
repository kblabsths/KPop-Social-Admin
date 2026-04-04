import { getSupabaseAdmin } from "@/lib/supabase";
import { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const supabase = getSupabaseAdmin();
  const { searchParams } = request.nextUrl;
  const query = searchParams.get("q") || "";
  const city = searchParams.get("city") || undefined;
  const country = searchParams.get("country") || undefined;
  const limit = Math.min(Number(searchParams.get("limit")) || 50, 100);
  const offset = Number(searchParams.get("offset")) || 0;

  let queryBuilder = supabase
    .from("venues")
    .select("*")
    .order("name", { ascending: true })
    .range(offset, offset + limit - 1);

  if (query) queryBuilder = queryBuilder.ilike("name", `%${query}%`);
  if (city) queryBuilder = queryBuilder.ilike("city", `%${city}%`);
  if (country) queryBuilder = queryBuilder.ilike("country", `%${country}%`);

  const { data: venues, error } = await queryBuilder;
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json(venues ?? []);
}
