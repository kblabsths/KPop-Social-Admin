import { auth } from "./auth";
import { getSupabaseAdmin } from "./supabase";

export async function requireAdmin() {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const supabase = getSupabaseAdmin();
  const { data: user } = await supabase
    .from("web_users")
    .select("id, role")
    .eq("id", session.user.id)
    .maybeSingle();

  if (!user || user.role !== "ADMIN") {
    return { error: Response.json({ error: "Forbidden" }, { status: 403 }) };
  }

  return { user };
}

export function paginationParams(searchParams: URLSearchParams) {
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("pageSize") || "20", 10)));
  const skip = (page - 1) * pageSize;
  return { page, pageSize, skip };
}
