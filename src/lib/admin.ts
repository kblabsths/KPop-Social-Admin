import { auth } from "./auth";
import { getSupabaseAdmin } from "./supabase";

// Admin status is derived from the same `admin_allowed_emails` allowlist that
// gates sign-in. The old `web_users.role` check pointed at a table that was
// never created in the shared Supabase project, so every request 403'd.
export async function requireAdmin() {
  const session = await auth();
  if (!session?.user?.email) {
    return { error: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const supabase = getSupabaseAdmin();
  const { data: allowed, error: lookupError } = await supabase
    .from("admin_allowed_emails")
    .select("id")
    .eq("email", session.user.email)
    .maybeSingle();

  if (lookupError || !allowed) {
    return { error: Response.json({ error: "Forbidden" }, { status: 403 }) };
  }

  return { user: session.user };
}

export function paginationParams(searchParams: URLSearchParams) {
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("pageSize") || "20", 10)));
  const skip = (page - 1) * pageSize;
  return { page, pageSize, skip };
}
