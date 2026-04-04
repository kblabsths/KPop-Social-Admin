import { getSupabaseAdmin } from "@/lib/supabase";
import { auth } from "@/lib/auth";
import { NextRequest } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = getSupabaseAdmin();
  const { id } = await params;

  const session = await auth();
  if (!session?.user?.id || session.user.id !== id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const limit = Math.min(Number(searchParams.get("limit")) || 20, 100);
  const offset = Number(searchParams.get("offset")) || 0;
  const readFilter = searchParams.get("read");

  let queryBuilder = supabase
    .from("web_notifications")
    .select("*", { count: "exact" })
    .eq("user_id", id)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (readFilter === "true") queryBuilder = queryBuilder.eq("read", true);
  if (readFilter === "false") queryBuilder = queryBuilder.eq("read", false);

  const { data: notifications, count: total, error } = await queryBuilder;
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ notifications: notifications ?? [], total: total ?? 0, limit, offset });
}
