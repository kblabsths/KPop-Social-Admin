import { getSupabaseAdmin } from "@/lib/supabase";
import { auth } from "@/lib/auth";
import { NextRequest } from "next/server";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = getSupabaseAdmin();
  const { id } = await params;

  const session = await auth();
  if (!session?.user?.id || session.user.id !== id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { count, error } = await supabase
    .from("web_notifications")
    .select("*", { count: "exact", head: true })
    .eq("user_id", id)
    .eq("read", false);

  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ count: count ?? 0 });
}
